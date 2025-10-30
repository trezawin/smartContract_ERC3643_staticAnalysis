import fs from "fs";
import path from "path";
import hardhat from "hardhat";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const { ethers: hardhatEthers } = hardhat;

export interface RegulatedAddresses {
  networkRpc: string;
  token: string;
  identityRegistry: string;
  claimTopicsRegistry: string;
  trustedIssuersRegistry: string;
  compliance: string;
  identityRegistryStorage: string;
}

export interface RegulatedBootstrapResult {
  addresses: RegulatedAddresses;
}

function requireArtifact(relPath: string) {
  const fullPath = path.resolve(__dirname, "..", relPath);
  return require(fullPath);
}

export async function bootstrapRegulated(
  hre?: HardhatRuntimeEnvironment,
  outputPath = ".cre.addresses.json"
): Promise<RegulatedBootstrapResult> {
  const runtime = hre ?? require("hardhat");
  const ethers = runtime.ethers ?? hardhatEthers;
  const [deployer] = await ethers.getSigners();

  console.log("[bootstrap:regulated] Deployer:", deployer.address);

  const IdentityRegistryArtifact = requireArtifact("artifacts/contracts/custom/RegulatedSuite.sol/IdentityRegistry.json");
  const ComplianceArtifact = requireArtifact("artifacts/contracts/custom/RegulatedSuite.sol/Compliance.json");
  const TokenArtifact = requireArtifact("artifacts/contracts/custom/RegulatedSuite.sol/RegulatedToken.json");

  const IdentityRegistry = await ethers.getContractFactory(
    IdentityRegistryArtifact.abi,
    IdentityRegistryArtifact.bytecode,
    deployer
  );
  const Compliance = await ethers.getContractFactory(
    ComplianceArtifact.abi,
    ComplianceArtifact.bytecode,
    deployer
  );
  const Token = await ethers.getContractFactory(
    TokenArtifact.abi,
    TokenArtifact.bytecode,
    deployer
  );

  const identityRegistry = await IdentityRegistry.deploy();
  await identityRegistry.deployed();
  const compliance = await Compliance.deploy(identityRegistry.address);
  await compliance.deployed();
  const token = await Token.deploy("My Regulated Token", "MRT", identityRegistry.address, compliance.address);
  await token.deployed();

  console.log("[bootstrap:regulated] IdentityRegistry:", identityRegistry.address);
  console.log("[bootstrap:regulated] Compliance:", compliance.address);
  console.log("[bootstrap:regulated] RegulatedToken:", token.address);

  const addresses: RegulatedAddresses = {
    networkRpc: "http://127.0.0.1:8545",
    token: token.address,
    identityRegistry: identityRegistry.address,
    claimTopicsRegistry: "0x0000000000000000000000000000000000000000",
    trustedIssuersRegistry: "0x0000000000000000000000000000000000000000",
    compliance: compliance.address,
    identityRegistryStorage: "0x0000000000000000000000000000000000000000"
  };

  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log("[bootstrap:regulated] Wrote", outputPath);

  return { addresses };
}

if (require.main === module) {
  bootstrapRegulated().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
