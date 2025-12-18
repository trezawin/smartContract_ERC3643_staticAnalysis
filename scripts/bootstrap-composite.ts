import fs from "fs";
import path from "path";
import hardhat from "hardhat";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const { ethers: hardhatEthers } = hardhat;

export interface CompositeAddresses {
  networkRpc: string;
  token: string;
  identityRegistry: string;
  claimTopicsRegistry: string;
  trustedIssuersRegistry: string;
  compliance: string;
  identityRegistryStorage: string;
}

export interface CompositeBootstrapResult {
  addresses: CompositeAddresses;
}

function requireArtifact(relPath: string) {
  return require(path.resolve(__dirname, "..", relPath));
}

export async function bootstrapComposite(
  hre?: HardhatRuntimeEnvironment,
  outputPath = ".cre.addresses.json"
): Promise<CompositeBootstrapResult> {
  const runtime = hre ?? require("hardhat");
  const ethers = runtime.ethers ?? hardhatEthers;
  const [deployer] = await ethers.getSigners();

  console.log("[bootstrap:composite] Deployer:", deployer.address);

  const ClaimTopicsRegistryArtifact = requireArtifact(
    "artifacts/contracts/test/CompositeTestSuite.sol/CompositeClaimTopicsRegistry.json"
  );
  const TrustedIssuersRegistryArtifact = requireArtifact(
    "artifacts/contracts/test/CompositeTestSuite.sol/CompositeTrustedIssuersRegistry.json"
  );
  const IdentityRegistryStorageArtifact = requireArtifact(
    "artifacts/contracts/test/CompositeTestSuite.sol/CompositeIdentityRegistryStorage.json"
  );
  const IdentityRegistryArtifact = requireArtifact(
    "artifacts/contracts/test/CompositeTestSuite.sol/CompositeIdentityRegistry.json"
  );
  const ComplianceArtifact = requireArtifact(
    "artifacts/contracts/test/CompositeTestSuite.sol/CompositeCompliance.json"
  );
  const TokenArtifact = requireArtifact(
    "artifacts/contracts/test/CompositeTestSuite.sol/CompositeToken.json"
  );

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
  const Compliance = await ethers.getContractFactory(
    ComplianceArtifact.abi,
    ComplianceArtifact.bytecode,
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

  const ctr = await ClaimTopicsRegistry.deploy(); await ctr.deployed();
  const tir = await TrustedIssuersRegistry.deploy(); await tir.deployed();
  const irs = await IdentityRegistryStorage.deploy(); await irs.deployed();
  const compliance = await Compliance.deploy(); await compliance.deployed();
  const identityRegistry = await IdentityRegistry.deploy(
    irs.address,
    ctr.address,
    tir.address
  ); await identityRegistry.deployed();
  const token = await Token.deploy(identityRegistry.address, compliance.address); await token.deployed();

  console.log("[bootstrap:composite] CTR:", ctr.address);
  console.log("[bootstrap:composite] TIR:", tir.address);
  console.log("[bootstrap:composite] IRS:", irs.address);
  console.log("[bootstrap:composite]  IR:", identityRegistry.address);
  console.log("[bootstrap:composite] CMP:", compliance.address);
  console.log("[bootstrap:composite] TKN:", token.address);

  await (await irs.bindIdentityRegistry(identityRegistry.address)).wait();
  await (await compliance.bindToken(token.address)).wait();

  console.log("[bootstrap:composite] Seeding claim topic #1 (partial compliance)...");
  await (await ctr.addClaimTopic(1)).wait();

  const addresses: CompositeAddresses = {
    networkRpc: "http://127.0.0.1:8545",
    token: token.address,
    identityRegistry: identityRegistry.address,
    claimTopicsRegistry: ctr.address,
    trustedIssuersRegistry: tir.address,
    compliance: compliance.address,
    identityRegistryStorage: irs.address
  };

  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log("[bootstrap:composite] Wrote", outputPath);

  return { addresses };
}

if (require.main === module) {
  bootstrapComposite().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
