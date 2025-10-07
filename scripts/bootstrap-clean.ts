import fs from "fs";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers as hardhatEthers } from "hardhat";

export interface BootstrapAddresses {
  networkRpc: string;
  token: string;
  identityRegistry: string;
  claimTopicsRegistry: string;
  trustedIssuersRegistry: string;
  compliance: string;
}

export interface BootstrapResult {
  addresses: BootstrapAddresses;
}

export async function bootstrap(hre?: HardhatRuntimeEnvironment): Promise<BootstrapResult> {
  const runtime = hre ?? require("hardhat");
  const ethers = runtime.ethers ?? hardhatEthers;

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1) Deploy registries & storage (upgradeable patterns expose `init`)
  const artifact = (p: string) => require(p);

  const ClaimTopicsRegistryArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/registry/implementation/ClaimTopicsRegistry.sol/ClaimTopicsRegistry.json");
  const TrustedIssuersRegistryArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/registry/implementation/TrustedIssuersRegistry.sol/TrustedIssuersRegistry.json");
  const IdentityRegistryStorageArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/registry/implementation/IdentityRegistryStorage.sol/IdentityRegistryStorage.json");
  const IdentityRegistryArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/registry/implementation/IdentityRegistry.sol/IdentityRegistry.json");
  const TokenArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/token/Token.sol/Token.json");
  const ModularComplianceArtifact = artifact("@tokenysolutions/t-rex/artifacts/contracts/compliance/modular/ModularCompliance.sol/ModularCompliance.json");

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
  const IdentityRegistry = await ethers.getContractFactory(
    IdentityRegistryArtifact.abi,
    IdentityRegistryArtifact.bytecode,
    deployer
  );
  const Token = await ethers.getContractFactory(
    TokenArtifact.abi,
    TokenArtifact.bytecode,
    deployer
  );
  const ModularCompliance = await ethers.getContractFactory(
    ModularComplianceArtifact.abi,
    ModularComplianceArtifact.bytecode,
    deployer
  );

  const ctr = await ClaimTopicsRegistry.deploy(); await ctr.deployed();
  const tir = await TrustedIssuersRegistry.deploy(); await tir.deployed();
  const irs = await IdentityRegistryStorage.deploy(); await irs.deployed();
  const ir  = await IdentityRegistry.deploy(); await ir.deployed();
  const cmp = await ModularCompliance.deploy(); await cmp.deployed();
  const tkn = await Token.deploy(); await tkn.deployed();

  console.log("CTR:", ctr.address);
  console.log("TIR:", tir.address);
  console.log("IRS:", irs.address);
  console.log(" IR:", ir.address);
  console.log("CMP:", cmp.address);
  console.log("TKN:", tkn.address);

  // 2) Initialize OwnableUpgradeable registries
  // Each .init() sets msg.sender (deployer) as owner
  console.log("Initializing CTR/TIR/IRS/IR...");
  const tx1 = await ctr.init(); await tx1.wait();
  const tx2 = await tir.init(); await tx2.wait();
  const tx3 = await irs.init(); await tx3.wait();
  const tx4 = await ir.init(tir.address, ctr.address, irs.address); await tx4.wait();

  // Bind IR in its storage (owner-only)
  const tx5 = await irs.bindIdentityRegistry(ir.address); await tx5.wait();

  // 3) Initialize & wire the Token:
  // Token.init(identity, compliance, name, symbol, decimals, onchainID)
  // NOTE: Token.init is owner/agent-gated internally, but in T-REX it calls Ownable init
  // and then performs wiring. This call sets deployer as owner.
  console.log("Initializing Token...");
  const cmpInit = await (cmp as any).init(); await cmpInit.wait();
  const tx6 = await (tkn as any).init(
    ir.address,      // identity registry
    cmp.address,     // compliance
    "HK Green Bond", // name
    "HKGB",          // symbol
    18,              // decimals
    deployer.address // tokenOnchainID (use deployer for local)
  );
  await tx6.wait();

  // Token.init internally binds the compliance contract to itself, so no extra wiring needed here.

  // 4) Seed 1 KYC claim topic (e.g., 1 = KYC_BASIC for demo)
  console.log("Seeding claim topic #1...");
  await (await ctr.addClaimTopic(1)).wait();

  // 5) Save addresses for Phase-2 engine
  const addr = {
    networkRpc: "http://127.0.0.1:8545",
    token: tkn.address,
    identityRegistry: ir.address,
    claimTopicsRegistry: ctr.address,
    trustedIssuersRegistry: tir.address,
    compliance: cmp.address
  };
  fs.writeFileSync(".cre.addresses.json", JSON.stringify(addr, null, 2));
  console.log("Wrote .cre.addresses.json");

  return { addresses: addr };
}

if (require.main === module) {
  bootstrap().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
