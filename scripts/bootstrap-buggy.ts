import fs from "fs";
import path from "path";
import hardhat from "hardhat";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const { ethers: hardhatEthers } = hardhat;

export interface BuggyAddresses {
  networkRpc: string;
  token: string;
  identityRegistry: string;
  claimTopicsRegistry: string;
  trustedIssuersRegistry: string;
  compliance: string;
}

export interface BuggyBootstrapResult {
  addresses: BuggyAddresses;
}

function requireArtifact(relativePath: string) {
  const resolved = path.resolve(__dirname, "..", relativePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Artifact not found: ${resolved}. Run 'npx hardhat compile' first.`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

export async function bootstrapBuggy(
  hre?: HardhatRuntimeEnvironment,
  outputPath?: string
): Promise<BuggyBootstrapResult> {
  const runtime = hre ?? require("hardhat");
  const ethers = runtime.ethers ?? hardhatEthers;

  const [deployer] = await ethers.getSigners();
  console.log("[bootstrap:buggy] Deployer:", deployer.address);

  const artifact = (p: string) => require(p);

  const ClaimTopicsRegistryArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/registry/implementation/ClaimTopicsRegistry.sol/ClaimTopicsRegistry.json");
  const TrustedIssuersRegistryArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/registry/implementation/TrustedIssuersRegistry.sol/TrustedIssuersRegistry.json");
  const IdentityRegistryStorageArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/registry/implementation/IdentityRegistryStorage.sol/IdentityRegistryStorage.json");
  const ModularComplianceArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/compliance/modular/ModularCompliance.sol/ModularCompliance.json");
  const TokenArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/token/Token.sol/Token.json");
  const BuggyIdentityRegistryArtifact = requireArtifact("artifacts/contracts/buggy/BuggyIdentityRegistry.sol/BuggyIdentityRegistry.json");

  const ClaimTopicsRegistry = await ethers.getContractFactory(
    ClaimTopicsRegistryArtifact.abi,
    ClaimTopicsRegistryArtifact.bytecode,
    deployer
  );
  const TrustedIssuersRegistry = await ethers.getContractFactory(
    TrustedIssuersRegistryArtifact.abi,
    TrustedIssuersRegistryArtifact.bytecode,
    deployer
  );
  const IdentityRegistryStorage = await ethers.getContractFactory(
    IdentityRegistryStorageArtifact.abi,
    IdentityRegistryStorageArtifact.bytecode,
    deployer
  );
  const BuggyIdentityRegistry = await ethers.getContractFactory(
    BuggyIdentityRegistryArtifact.abi,
    BuggyIdentityRegistryArtifact.bytecode,
    deployer
  );
  const ModularCompliance = await ethers.getContractFactory(
    ModularComplianceArtifact.abi,
    ModularComplianceArtifact.bytecode,
    deployer
  );
  const Token = await ethers.getContractFactory(
    TokenArtifact.abi,
    TokenArtifact.bytecode,
    deployer
  );

  const ctr = await ClaimTopicsRegistry.deploy(); await ctr.deployed();
  const tir = await TrustedIssuersRegistry.deploy(); await tir.deployed();
  const irs = await IdentityRegistryStorage.deploy(); await irs.deployed();
  const ir = await BuggyIdentityRegistry.deploy(); await ir.deployed();
  const compliance = await ModularCompliance.deploy(); await compliance.deployed();
  const token = await Token.deploy(); await token.deployed();

  console.log("[bootstrap:buggy] CTR:", ctr.address);
  console.log("[bootstrap:buggy] TIR:", tir.address);
  console.log("[bootstrap:buggy] IRS:", irs.address);
  console.log("[bootstrap:buggy]  IR:", ir.address);
  console.log("[bootstrap:buggy] CMP:", compliance.address);
  console.log("[bootstrap:buggy] TKN:", token.address);

  // initialize registry stack
  await (await ctr.init()).wait();
  await (await tir.init()).wait();
  await (await irs.init()).wait();
  await (await ir.init(tir.address, ctr.address, irs.address)).wait();

  await (await compliance.init()).wait();
  await (await token.init(
    ir.address,
    compliance.address,
    "Buggy Compliance Token",
    "BUG",
    18,
    deployer.address
  )).wait();

  try { if (token.addAgent) await token.addAgent(deployer.address); } catch {}
  try { if (token.unpause) await token.unpause(); } catch {}
  try { if (token.mint) await token.mint(deployer.address, ethers.utils.parseUnits("1000", 18)); } catch {}

  await (await ctr.addClaimTopic(1)).wait();
  await (await irs.bindIdentityRegistry(ir.address)).wait();

  // Intentionally omit compliance monitoring modules to violate ongoing monitoring rule
  console.log("[bootstrap:buggy] Skipping compliance monitoring modules (intentional defect).");

  const addresses: BuggyAddresses = {
    networkRpc: "http://127.0.0.1:8545",
    token: token.address,
    identityRegistry: ir.address,
    claimTopicsRegistry: ctr.address,
    trustedIssuersRegistry: tir.address,
    compliance: compliance.address
  };

  const resolvedOutput = path.resolve(process.cwd(), outputPath ?? ".cre.addresses.json");
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, JSON.stringify(addresses, null, 2));
  console.log("[bootstrap:buggy] Wrote", resolvedOutput);

  const snapshot = process.env.BUGGY_SNAPSHOT || "configs/buggy.addresses.json";
  const snapshotPath = path.resolve(process.cwd(), snapshot);
  if (snapshotPath !== resolvedOutput) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(addresses, null, 2));
    console.log("[bootstrap:buggy] Snapshot", snapshotPath);
  }

  return { addresses };
}

if (require.main === module) {
  bootstrapBuggy().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

