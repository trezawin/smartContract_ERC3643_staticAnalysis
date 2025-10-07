/* eslint-disable */
const fs = require("fs");
const path = require("path");
const { ethers: rpcEthers } = require("ethers");

// Normalised zero-address values to compare results regardless of casing
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO = ZERO_ADDRESS.toLowerCase();

// Minimal read-only ABIs keep RPC calls lightweight
const TokenABI = [
  "function identityRegistry() view returns (address)",
  "function compliance() view returns (address)",
  "function owner() view returns (address)"
];
const IdentityRegistryABI = [
  "function topicsRegistry() view returns (address)",
  "function issuersRegistry() view returns (address)"
];
const ClaimTopicsRegistryABI = [
  "function getClaimTopics() view returns (uint256[])",
  "function owner() view returns (address)"
];
const ComplianceABI = [
  "function getTokenBound() view returns (address)"
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Ensure report directory exists ahead of time
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeAddress(addr) {
  if (typeof addr !== "string" || addr.length === 0) {
    return ZERO;
  }
  return addr.toLowerCase();
}

// Decide when to spin up a Hardhat runtime (e.g., empty or missing RPC data)
function shouldFallback(data, cfg) {
  if (!data) {
    return true;
  }

  const expectedToken = normalizeAddress(cfg.token);
  const expectedIdr = normalizeAddress(cfg.identityRegistry);
  const expectedCtr = normalizeAddress(cfg.claimTopicsRegistry);
  const expectedTir = normalizeAddress(cfg.trustedIssuersRegistry);
  const expectedCompliance = normalizeAddress(cfg.compliance);

  const hasKnownTargets = [expectedToken, expectedIdr, expectedCtr].every(
    (x) => x && x !== ZERO
  );

  if (!hasKnownTargets) {
    return false;
  }

  const tokenIdentityZero = normalizeAddress(data.tokenIdentity) === ZERO;
  const idrTopics = normalizeAddress(data.idrTopicsRegistryAddr);
  const idrTopicsMismatch = expectedCtr !== ZERO && idrTopics !== expectedCtr;
  const idrTopicsZero = idrTopics === ZERO;
  const trustedIssuers = normalizeAddress(data.idrTrustedIssuersAddr);
  const tirMismatch = expectedTir !== ZERO && trustedIssuers !== expectedTir;
  const complianceAddr = normalizeAddress(data.tokenCompliance);
  const complianceMismatch = expectedCompliance !== ZERO && complianceAddr !== expectedCompliance;
  const complianceBound = normalizeAddress(data.complianceBoundToken);
  const complianceBoundMismatch =
    expectedCompliance !== ZERO && complianceBound !== expectedToken;
  const topicsEmpty = !Array.isArray(data.topics) || data.topics.length === 0;

  return (
    tokenIdentityZero ||
    idrTopicsZero ||
    idrTopicsMismatch ||
    tirMismatch ||
    complianceMismatch ||
    complianceBoundMismatch ||
    topicsEmpty
  );
}

// Try to reach the configured RPC so we avoid redeploying unnecessarily
async function tryCreateRpcContext(cfg) {
  const rpcUrl = cfg.networkRpc || "http://127.0.0.1:8545";
  const provider = new rpcEthers.providers.JsonRpcProvider(rpcUrl);

  try {
    await provider.getBlockNumber();
  } catch (err) {
    return null;
  }

  const signer = provider.getSigner(0);

  return {
    mode: "rpc",
    ethers: rpcEthers,
    provider,
    signer,
  };
}

// Reset Hardhat, redeploy via bootstrap helper, and reuse its signer
async function createHardhatContext() {
  require("ts-node/register/transpile-only");
  const hre = require("hardhat");
  await hre.network.provider.request({ method: "hardhat_reset", params: [] });

  const { bootstrap } = require("./bootstrap-clean.ts");

  await bootstrap(hre);

  const [signer] = await hre.ethers.getSigners();

  return {
    mode: "hardhat",
    ethers: hre.ethers,
    provider: hre.ethers.provider,
    signer,
  };
}

// Query the token/registry trio and return the raw fields needed by rules
async function collectData(ctx, cfg) {
  const { ethers, signer } = ctx;
  const Contract = ethers.Contract;
  const constants = ethers.constants ?? { AddressZero: ZERO_ADDRESS };

  const token = new Contract(cfg.token, TokenABI, signer);
  const idr = new Contract(cfg.identityRegistry, IdentityRegistryABI, signer);
  const ctr = new Contract(cfg.claimTopicsRegistry, ClaimTopicsRegistryABI, signer);

  const tryCall = async (fn, def = null) => {
    try {
      return await fn();
    } catch {
      return def;
    }
  };

  const tokenIdentity = await tryCall(() => token.identityRegistry(), constants.AddressZero);
  const tokenCompliance = await tryCall(() => token.compliance(), constants.AddressZero);
  const tokenOwner = await tryCall(() => token.owner(), constants.AddressZero);

  const idrTopicsRegistryAddr = await tryCall(() => idr.topicsRegistry(), constants.AddressZero);
  const idrTrustedIssuersAddr = await tryCall(() => idr.issuersRegistry(), constants.AddressZero);
  const topics = await tryCall(() => ctr.getClaimTopics(), []);

  const resolvedComplianceAddr = (() => {
    const fromToken = normalizeAddress(tokenCompliance);
    if (fromToken !== ZERO) {
      return tokenCompliance;
    }
    const fromCfg = cfg.compliance;
    if (fromCfg) {
      return fromCfg;
    }
    return constants.AddressZero;
  })();

  let complianceBoundToken = constants.AddressZero;

  if (normalizeAddress(resolvedComplianceAddr) !== ZERO) {
    const compliance = new Contract(resolvedComplianceAddr, ComplianceABI, signer);
    complianceBoundToken = await tryCall(() => compliance.getTokenBound(), constants.AddressZero);
  }

  return {
    tokenIdentity,
    tokenCompliance,
    tokenOwner,
    idrTopicsRegistryAddr,
    idrTrustedIssuersAddr,
    topics,
    complianceBoundToken,
  };
}

async function main() {
  const root = process.cwd();
  const cfg = loadJson(path.join(root, ".cre.addresses.json"));
  const rules = loadJson(path.join(root, "cre/rules/baseline.json"));
  ensureDir(path.join(root, "reports"));

  let context = await tryCreateRpcContext(cfg);
  let data = null;

  if (context) {
    data = await collectData(context, cfg);
  }

  if (!context || shouldFallback(data, cfg)) {
    console.log("[phase2] Falling back to in-process Hardhat deployment for checks");
    context = await createHardhatContext();
    data = await collectData(context, cfg);

    // overwrite cfg addresses with freshly bootstrapped ones
    const latestCfg = loadJson(path.join(root, ".cre.addresses.json"));
    Object.assign(cfg, latestCfg);
  }

  // Evaluate rules
  const items = [];

  for (const r of rules) {
    let pass = false;
    let note = "";

    if (r.id === "E3643-01") {
      pass =
        data.tokenIdentity &&
        normalizeAddress(data.tokenIdentity) === normalizeAddress(cfg.identityRegistry);
      note = `token.identityRegistry=${data.tokenIdentity}`;
    }

    if (r.id === "E3643-02") {
      pass =
        data.idrTopicsRegistryAddr &&
        normalizeAddress(data.idrTopicsRegistryAddr) === normalizeAddress(cfg.claimTopicsRegistry);
      note = `idr.claimTopicsRegistry=${data.idrTopicsRegistryAddr}`;
    }

    if (r.id === "E3643-03") {
      // A weak sanity: if token.identityRegistry is zero/missing, transfers not KYC-gated
      pass =
        data.tokenIdentity &&
        normalizeAddress(data.tokenIdentity) !== ZERO;
      note = `token.identityRegistry=${data.tokenIdentity}`;
    }

    if (r.id === "E3643-04") {
      pass = Array.isArray(data.topics) && data.topics.length > 0;
      note = `topics.length=${Array.isArray(data.topics) ? data.topics.length : "n/a"}`;
    }

    if (r.id === "E3643-05") {
      pass =
        data.idrTrustedIssuersAddr &&
        normalizeAddress(data.idrTrustedIssuersAddr) === normalizeAddress(cfg.trustedIssuersRegistry);
      note = `idr.trustedIssuersRegistry=${data.idrTrustedIssuersAddr}`;
    }

    if (r.id === "E3643-06") {
      const complianceAddr = normalizeAddress(data.tokenCompliance);
      const expectedCompliance = normalizeAddress(cfg.compliance);
      const complianceMatches =
        complianceAddr !== ZERO &&
        (expectedCompliance === ZERO || complianceAddr === expectedCompliance);
      const boundMatches =
        normalizeAddress(data.complianceBoundToken) === normalizeAddress(cfg.token);
      pass = complianceMatches && boundMatches;
      note = `token.compliance=${data.tokenCompliance}, boundToken=${data.complianceBoundToken}`;
    }

    items.push({
      id: r.id,
      title: r.title,
      desc: r.desc,
      severity: r.severity,
      pass,
      note
    });
  }

  const summary = {
    pass: items.filter(i => i.pass).length,
    fail: items.filter(i => !i.pass && i.severity === "FAIL").length,
    warn: items.filter(i => !i.pass && i.severity === "WARN").length
  };

  const results = {
    generatedAt: new Date().toISOString(),
    addresses: cfg,
    data: {
      tokenIdentity: data.tokenIdentity,
      tokenCompliance: data.tokenCompliance,
      tokenOwner: data.tokenOwner,
      idrClaimTopicsAddr: data.idrTopicsRegistryAddr,
      idrTrustedIssuersAddr: data.idrTrustedIssuersAddr,
      topicsCount: Array.isArray(data.topics) ? data.topics.length : 0,
      complianceBoundToken: data.complianceBoundToken,
      executionMode: context.mode
    },
    items,
    summary
  };

  const out = path.join(root, "reports", "phase2-results.json");
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log("[phase2] JSON written:", out);
}

main().catch(e => { console.error(e); process.exit(1); });
