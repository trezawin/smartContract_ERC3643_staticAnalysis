import fs from "fs";
import path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers as hardhatEthers } from "hardhat";

export interface BoulderAddresses {
  networkRpc: string;
  token: string;
  identityRegistry: string;
  claimTopicsRegistry: string;
  trustedIssuersRegistry: string;
  compliance: string;
}

export interface BoulderBootstrapResult {
  addresses: BoulderAddresses;
}

function loadArtifact(name: string) {
  const rel = {
    ClaimTopicsRegistry: "contracts/registry/implementation/ClaimTopicsRegistry.sol/ClaimTopicsRegistry.json",
    TrustedIssuersRegistry: "contracts/registry/implementation/TrustedIssuersRegistry.sol/TrustedIssuersRegistry.json",
    IdentityRegistryStorage: "contracts/registry/implementation/IdentityRegistryStorage.sol/IdentityRegistryStorage.json",
    IdentityRegistry: "contracts/registry/implementation/IdentityRegistry.sol/IdentityRegistry.json",
    ModularCompliance: "contracts/compliance/modular/ModularCompliance.sol/ModularCompliance.json",
    Token: "contracts/token/Token.sol/Token.json",
    CountryRestrictModule: "contracts/compliance/modular/modules/CountryRestrictModule.sol/CountryRestrictModule.json",
    ExchangeMonthlyLimitsModule: "contracts/compliance/modular/modules/ExchangeMonthlyLimitsModule.sol/ExchangeMonthlyLimitsModule.json"
  }[name];
  if (!rel) throw new Error(`Unknown artifact mapping for ${name}`);
  const abs = path.resolve(__dirname, "../ERC-3643-Implementation/artifacts", rel);
  if (!fs.existsSync(abs)) throw new Error(`Artifact not found for ${name}: ${abs}`);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function loadLocalArtifact(name: string) {
  const abs = path.resolve(__dirname, "../artifacts/contracts", `${name}.sol/${name}.json`);
  if (!fs.existsSync(abs)) throw new Error(`Local artifact not found for ${name}: ${abs}. Compile contracts first.`);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

async function deployFromArtifact(ethers: typeof hardhatEthers, artifact: any, signer: any) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  await contract.deployed();
  return contract;
}

export async function bootstrapBoulder(
  hre?: HardhatRuntimeEnvironment,
  outputPath?: string
): Promise<BoulderBootstrapResult> {
  const runtime = hre ?? require("hardhat");
  const ethers = runtime.ethers ?? hardhatEthers;

  const [deployer] = await ethers.getSigners();
  const networkRpc = "http://127.0.0.1:8545";

  const mutationEnv = (process.env.BOULDER_MUTATION || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const hasMutation = (id: string) => mutationEnv.includes(id);

  const claimTopicsArtifact = loadArtifact("ClaimTopicsRegistry");
  const trustedIssuersArtifact = loadArtifact("TrustedIssuersRegistry");
  const identityStorageArtifact = loadArtifact("IdentityRegistryStorage");
  const identityRegistryArtifact = loadArtifact("IdentityRegistry");
  const complianceArtifact = loadArtifact("ModularCompliance");
  const tokenArtifact = loadArtifact("Token");
  const tokenNoIdentity = loadLocalArtifact("TokenNoIdentity");
  const tokenNoCompliance = loadLocalArtifact("TokenNoCompliance");
  const tokenAuditBug = loadLocalArtifact("TokenAuditBug");
  const countryRestrictArtifact = loadArtifact("CountryRestrictModule");
  const exchangeMonthlyArtifact = loadArtifact("ExchangeMonthlyLimitsModule");

  const ctr = await deployFromArtifact(ethers, claimTopicsArtifact, deployer);
  await (await ctr.init()).wait();

  const tir = await deployFromArtifact(ethers, trustedIssuersArtifact, deployer);
  await (await tir.init()).wait();

  const irs = await deployFromArtifact(ethers, identityStorageArtifact, deployer);
  await (await irs.init()).wait();

  const irFactory = new ethers.ContractFactory(identityRegistryArtifact.abi, identityRegistryArtifact.bytecode, deployer);
  const ir = await irFactory.deploy();
  await ir.deployed();
  await (await ir.init(tir.address, ctr.address, irs.address)).wait();

  let compliance: any;
  if (hasMutation("compliance-bypass")) {
    const bypassArtifact = loadLocalArtifact("ComplianceBypass");
    const complianceFactory = new ethers.ContractFactory(bypassArtifact.abi, bypassArtifact.bytecode, deployer);
    compliance = await complianceFactory.deploy();
    await compliance.deployed();
  } else {
    const complianceFactory = new ethers.ContractFactory(complianceArtifact.abi, complianceArtifact.bytecode, deployer);
    compliance = await complianceFactory.deploy();
    await compliance.deployed();
    if (compliance.init) {
      await (await compliance.init()).wait();
    }
  }

  let token: any;
  if (hasMutation("token-no-identity")) {
    const tokenFactory = new ethers.ContractFactory(tokenNoIdentity.abi, tokenNoIdentity.bytecode, deployer);
    token = await tokenFactory.deploy();
  } else if (hasMutation("token-no-compliance")) {
    const tokenFactory = new ethers.ContractFactory(tokenNoCompliance.abi, tokenNoCompliance.bytecode, deployer);
    token = await tokenFactory.deploy();
  } else if (hasMutation("token-audit-bug")) {
    const tokenFactory = new ethers.ContractFactory(tokenAuditBug.abi, tokenAuditBug.bytecode, deployer);
    token = await tokenFactory.deploy();
  } else {
    const tokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer);
    token = await tokenFactory.deploy();
  }
  await token.deployed();
  await (await token.init(
      hasMutation("identity-always-true")
        ? (await (async () => {
            const idTrue = await (async () => {
              const idTrueArt = loadLocalArtifact("IdentityAlwaysTrue");
              const f = new ethers.ContractFactory(idTrueArt.abi, idTrueArt.bytecode, deployer);
              const c = await f.deploy(ctr.address, tir.address);
              await c.deployed();
              return c;
            })();
            return idTrue.address;
          })())
        : ir.address,
      compliance.address,
      "Boulder Test Token",
      "BTT",
      18,
      deployer.address
    )).wait();

  // Ensure agent rights, unpause, and seed balance for deterministic runtime probes
  try { if (token.addAgent) await token.addAgent(deployer.address); } catch {}
  try { if (token.unpause) await token.unpause(); } catch {}
  try { if (token.mint) await token.mint(deployer.address, hardhatEthers.utils.parseUnits('1000', 18)); } catch {}

  if (!hasMutation("no-claim-topic")) {
    await (await ctr.addClaimTopic(1)).wait();
  }
  if (hasMutation("remove-claim-topic")) {
    const topics = await ctr.getClaimTopics();
    for (const topic of topics) {
      await (await ctr.removeClaimTopic(topic)).wait();
    }
  }

  if (!hasMutation("skip-irs-bind")) {
    await (await irs.bindIdentityRegistry(ir.address)).wait();
  }

  const addresses: BoulderAddresses = {
    networkRpc,
    token: token.address,
    identityRegistry: ir.address,
    claimTopicsRegistry: ctr.address,
    trustedIssuersRegistry: tir.address,
    compliance: compliance.address
  };

  const primary = path.resolve(
    process.cwd(),
    outputPath || process.env.BOULDER_OUTPUT || ".cre.addresses.json"
  );
  fs.mkdirSync(path.dirname(primary), { recursive: true });
  fs.writeFileSync(primary, JSON.stringify(addresses, null, 2));

  const defaultCre = path.resolve(process.cwd(), ".cre.addresses.json");
  if (primary !== defaultCre) {
    fs.mkdirSync(path.dirname(defaultCre), { recursive: true });
    fs.writeFileSync(defaultCre, JSON.stringify(addresses, null, 2));
    console.log("[bootstrap:boulder] Wrote", primary, "and", defaultCre);
  } else {
    console.log("[bootstrap:boulder] Wrote", primary);
  }

  if (mutationEnv.length) {
    console.log("[bootstrap:boulder] Applied mutations:", mutationEnv.join(", "));
  }

  const snapshot = process.env.BOULDER_SNAPSHOT && path.resolve(process.env.BOULDER_SNAPSHOT);
  if (snapshot && snapshot !== primary && snapshot !== defaultCre) {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    fs.writeFileSync(snapshot, JSON.stringify(addresses, null, 2));
    console.log("[bootstrap:boulder] Snapshot", snapshot);
  }

  return { addresses };
}

if (require.main === module) {
  bootstrapBoulder().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
  // Attach monitoring modules when available (skip for compliance bypass/mutants lacking interface)
  if (compliance && typeof compliance.addModule === "function" && !hasMutation("compliance-bypass")) {
    try {
      if (countryRestrictArtifact && exchangeMonthlyArtifact) {
        const countryFactory = new ethers.ContractFactory(countryRestrictArtifact.abi, countryRestrictArtifact.bytecode, deployer);
        const countryModule = await countryFactory.deploy();
        await countryModule.deployed();
        if (countryModule.initialize) { await (await countryModule.initialize()).wait(); }

        const exchangeFactory = new ethers.ContractFactory(exchangeMonthlyArtifact.abi, exchangeMonthlyArtifact.bytecode, deployer);
        const exchangeModule = await exchangeFactory.deploy();
        await exchangeModule.deployed();
        if (exchangeModule.initialize) { await (await exchangeModule.initialize()).wait(); }

        await (await compliance.addModule(countryModule.address)).wait();
        await (await compliance.addModule(exchangeModule.address)).wait();
        console.log("[bootstrap:boulder] Added monitoring modules:", countryModule.address, exchangeModule.address);
      }
    } catch (moduleErr) {
      console.warn("[bootstrap:boulder] Unable to bind monitoring modules:", (moduleErr as Error).message);
    }
  }
