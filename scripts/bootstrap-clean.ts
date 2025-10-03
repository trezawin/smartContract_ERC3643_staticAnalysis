import { ethers, artifacts } from "hardhat";
import fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1) Deploy registries & storage (upgradeable patterns expose `init`)
  const CTR_FQN  = "@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol:ClaimTopicsRegistry";
  const TIR_FQN  = "@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol:TrustedIssuersRegistry";
  const IRS_FQN  = "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol:IdentityRegistryStorage";
  const IR_FQN   = "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol:IdentityRegistry";
  const TKN_FQN  = "@tokenysolutions/t-rex/contracts/token/Token.sol:Token";
  const CMP_FQN  = "contracts/ComplianceStub.sol:ComplianceStub";

  const ClaimTopicsRegistry = await ethers.getContractFactory(CTR_FQN);
  const TrustedIssuersRegistry = await ethers.getContractFactory(TIR_FQN);
  const IdentityRegistryStorage = await ethers.getContractFactory(IRS_FQN);
  const IdentityRegistry = await ethers.getContractFactory(IR_FQN);
  const Token = await ethers.getContractFactory(TKN_FQN);
  const ComplianceStub = await ethers.getContractFactory(CMP_FQN);

  const ctr = await ClaimTopicsRegistry.deploy(); await ctr.deployed();
  const tir = await TrustedIssuersRegistry.deploy(); await tir.deployed();
  const irs = await IdentityRegistryStorage.deploy(); await irs.deployed();
  const ir  = await IdentityRegistry.deploy(); await ir.deployed();
  const cmp = await ComplianceStub.deploy(); await cmp.deployed();
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
  const tx6 = await (tkn as any).init(
    ir.address,      // identity registry
    cmp.address,     // compliance
    "HK Green Bond", // name
    "HKGB",          // symbol
    18,              // decimals
    deployer.address // tokenOnchainID (use deployer for local)
  );
  await tx6.wait();

  // Bind token into compliance stub so canTransfer() path is clean
  await (await (cmp as any).bindToken(tkn.address)).wait();

  // 4) Seed 1 KYC claim topic (e.g., 1 = KYC_BASIC for demo)
  console.log("Seeding claim topic #1...");
  await (await ctr.addClaimTopic(1)).wait();

  // 5) Save addresses for Phase-2 engine
  const addr = {
    networkRpc: "http://127.0.0.1:8545",
    token: tkn.address,
    identityRegistry: ir.address,
    claimTopicsRegistry: ctr.address
  };
  fs.writeFileSync(".cre.addresses.json", JSON.stringify(addr, null, 2));
  console.log("Wrote .cre.addresses.json");
}

main().catch((e) => { console.error(e); process.exit(1); });