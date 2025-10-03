/* eslint-disable */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// Minimal ABIs (read-only)
const TokenABI = [
  "function identityRegistry() view returns (address)",
  "function compliance() view returns (address)",
  "function owner() view returns (address)"
];
const IdentityRegistryABI = [
  "function claimTopicsRegistry() view returns (address)",
  "function trustedIssuersRegistry() view returns (address)"
];
const ClaimTopicsRegistryABI = [
  "function getClaimTopics() view returns (uint256[])",
  "function owner() view returns (address)"
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function yes(x) { return x ? "YES" : "NO"; }

async function main() {
  const root = process.cwd();
  const cfg = loadJson(path.join(root, ".cre.addresses.json"));
  const rules = loadJson(path.join(root, "cre/rules/baseline.json"));
  ensureDir(path.join(root, "reports"));

  // provider & signer (read-only calls don’t need signer, but OK)
  const provider = new ethers.providers.JsonRpcProvider(cfg.networkRpc || "http://127.0.0.1:8545");
  const signer = provider.getSigner(0);

  // attach contracts (handle missing getters gracefully)
  const token = new ethers.Contract(cfg.token, TokenABI, signer);
  const idr   = new ethers.Contract(cfg.identityRegistry, IdentityRegistryABI, signer);
  const ctr   = new ethers.Contract(cfg.claimTopicsRegistry, ClaimTopicsRegistryABI, signer);

  // Fetch data (with try/catch so missing getters don’t crash)
  let tokenIdentity = null;
  let tokenCompliance = null;
  let tokenOwner = null;
  let idrClaimTopicsAddr = null;
  let idrTrustedIssuersAddr = null;
  let topics = [];

  const tryCall = async (fn, def = null) => {
    try { return await fn(); } catch { return def; }
  };

  tokenIdentity = await tryCall(() => token.identityRegistry(), ethers.constants.AddressZero);
  tokenCompliance = await tryCall(() => token.compliance(), ethers.constants.AddressZero);
  tokenOwner = await tryCall(() => token.owner(), ethers.constants.AddressZero);

  idrClaimTopicsAddr = await tryCall(() => idr.claimTopicsRegistry(), ethers.constants.AddressZero);
  idrTrustedIssuersAddr = await tryCall(() => idr.trustedIssuersRegistry(), ethers.constants.AddressZero);

  topics = await tryCall(() => ctr.getClaimTopics(), []);

  // Evaluate rules
  const items = [];

  for (const r of rules) {
    let pass = false;
    let note = "";

    if (r.id === "E3643-01") {
      pass = tokenIdentity && tokenIdentity.toLowerCase() === cfg.identityRegistry.toLowerCase();
      note = `token.identityRegistry=${tokenIdentity}`;
    }

    if (r.id === "E3643-02") {
      pass = idrClaimTopicsAddr && idrClaimTopicsAddr !== ethers.constants.AddressZero;
      note = `idr.claimTopicsRegistry=${idrClaimTopicsAddr}`;
    }

    if (r.id === "E3643-03") {
      // A weak sanity: if token.identityRegistry is zero/missing, transfers not KYC-gated
      pass = tokenIdentity && tokenIdentity !== ethers.constants.AddressZero;
      note = `token.identityRegistry=${tokenIdentity}`;
    }

    if (r.id === "E3643-04") {
      pass = Array.isArray(topics) && topics.length > 0;
      note = `topics.length=${Array.isArray(topics) ? topics.length : "n/a"}`;
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
      tokenIdentity,
      tokenCompliance,
      tokenOwner,
      idrClaimTopicsAddr,
      idrTrustedIssuersAddr,
      topicsCount: Array.isArray(topics) ? topics.length : 0
    },
    items,
    summary
  };

  const out = path.join(root, "reports", "phase2-results.json");
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log("[phase2] JSON written:", out);
}

main().catch(e => { console.error(e); process.exit(1); });