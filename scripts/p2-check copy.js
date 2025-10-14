/* eslint-disable */
const fs = require("fs");
const path = require("path");
const { ethers: rpcEthers } = require("ethers");

// Optional ABI artifact loader (if present via abipaths.json)
function loadAbiArtifacts(root) {
  const abipathsPath = path.join(root, "abipaths.json");
  if (!fs.existsSync(abipathsPath)) return null;
  try {
    const map = JSON.parse(fs.readFileSync(abipathsPath, "utf8"));
    const loadOne = (p) => {
      if (!p) return { abi: null, path: null };
      const fp = path.isAbsolute(p) ? p : path.join(root, p);
      if (!fs.existsSync(fp)) return { abi: null, path: null };
      const j = JSON.parse(fs.readFileSync(fp, "utf8"));
      if (Array.isArray(j.abi)) return { abi: j.abi, path: fp };
      return { abi: null, path: null };
    };
    const token = loadOne(map.Token);
    const idr = loadOne(map.IdentityRegistry);
    const ctr = loadOne(map.ClaimTopicsRegistry);
    const tir = loadOne(map.TrustedIssuersRegistry);
    return {
      tokenAbi: token.abi,
      idrAbi: idr.abi,
      ctrAbi: ctr.abi,
      tirAbi: tir.abi,
      paths: {
        Token: token.path,
        IdentityRegistry: idr.path,
        ClaimTopicsRegistry: ctr.path,
        TrustedIssuersRegistry: tir.path
      }
    };
  } catch {
    return null;
  }
}
function makeAbiIndex(abi) {
  if (!Array.isArray(abi)) return { bySig: new Set(), byName: new Set(), hasEvent: new Set() };
  const bySig = new Set();
  const byName = new Set();
  const hasEvent = new Set();
  for (const e of abi) {
    if (e.type === "function") {
      const name = e.name;
      const inputs = (e.inputs || []).map(i => i.type).join(",");
      bySig.add(`${name}(${inputs})`);
      byName.add(name);
    } else if (e.type === "event") {
      hasEvent.add(e.name);
    }
  }
  return { bySig, byName, hasEvent };
}

// =====================
// Shared helpers
// =====================
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO = ZERO_ADDRESS.toLowerCase();

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function tryLoadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function safeDiv(a, b) { return b > 0 ? a / b : 0; }
function normalizeAddress(addr) {
  if (typeof addr !== "string" || addr.length === 0) return ZERO;
  return addr.toLowerCase();
}
function getByPath(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  const parts = pathStr.split(".");
  let cur = obj;
  for (const k of parts) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}
function asAddr(val, cfg, data) {
  if (typeof val === "string" && val.startsWith("cfg.")) return normalizeAddress(getByPath(cfg, val.slice(4)));
  if (typeof val === "string" && val.startsWith("data.")) return normalizeAddress(getByPath(data, val.slice(5)));
  if (typeof val === "string") return normalizeAddress(val);
  return ZERO;
}

const RULE_ALIASES = new Map(); // Clean set: use exact IDs from the rules file; no legacy aliases
function matchRule(r, canonicalId) {
  const id = String(r.id || "").toUpperCase();
  return id === String(canonicalId).toUpperCase();
}

// =====================
// Minimal ABIs (read-only)
// =====================
const TokenABI = [
  "function identityRegistry() view returns (address)",
  "function compliance() view returns (address)",
  "function owner() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)"
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
const TrustedIssuersRegistryABI = [
  "function owner() view returns (address)"
];
const IdentityRegistryStorageABI = [
  "function owner() view returns (address)"
];

// =====================
// Context selection (RPC first, then Hardhat fallback)
// =====================
async function tryCreateRpcContext(cfg) {
  const rpcUrl = cfg.networkRpc || "http://127.0.0.1:8545";
  const provider = new rpcEthers.providers.JsonRpcProvider(rpcUrl);
  try { await provider.getBlockNumber(); } catch { return null; }
  const signer = provider.getSigner(0);
  return { mode: "rpc", ethers: rpcEthers, provider, signer };
}

async function createHardhatContext() {
  require("ts-node/register/transpile-only");
  const hre = require("hardhat");
  await hre.network.provider.request({ method: "hardhat_reset", params: [] });
  const { bootstrap } = require("./bootstrap-clean.ts");
  await bootstrap(hre);
  const [signer] = await hre.ethers.getSigners();
  return { mode: "hardhat", ethers: hre.ethers, provider: hre.ethers.provider, signer };
}

// =====================
// On-chain collection
// =====================
async function collectData(ctx, cfg) {
  const { ethers, signer } = ctx;
  const Contract = ethers.Contract;
  const constants = ethers.constants ?? { AddressZero: ZERO_ADDRESS };

  const token = new Contract(cfg.token, TokenABI, signer);
  const idr = new Contract(cfg.identityRegistry, IdentityRegistryABI, signer);
  const ctr = new Contract(cfg.claimTopicsRegistry, ClaimTopicsRegistryABI, signer);
  const tirAddr = cfg.trustedIssuersRegistry;
  const tir = tirAddr ? new Contract(tirAddr, TrustedIssuersRegistryABI, signer) : null;
  const irsAddr = cfg.identityRegistryStorage; // optional if provided
  const irs = irsAddr ? new Contract(irsAddr, IdentityRegistryStorageABI, signer) : null;

  const tryCall = async (fn, def = null) => { try { return await fn(); } catch { return def; } };

  const tokenIdentity = await tryCall(() => token.identityRegistry(), constants.AddressZero);
  const tokenCompliance = await tryCall(() => token.compliance(), constants.AddressZero);
  const tokenOwner = await tryCall(() => token.owner(), constants.AddressZero);

  const idrTopicsRegistryAddr = await tryCall(() => idr.topicsRegistry(), constants.AddressZero);
  const idrTrustedIssuersAddr = await tryCall(() => idr.issuersRegistry(), constants.AddressZero);
  const topics = await tryCall(() => ctr.getClaimTopics(), []);
  const ctrOwner = await tryCall(() => ctr.owner(), constants.AddressZero);

  const resolvedComplianceAddr = (() => {
    const fromToken = normalizeAddress(tokenCompliance);
    if (fromToken !== ZERO) return tokenCompliance;
    const fromCfg = cfg.compliance;
    if (fromCfg) return fromCfg;
    return constants.AddressZero;
  })();

  let complianceBoundToken = constants.AddressZero;
  if (normalizeAddress(resolvedComplianceAddr) !== ZERO) {
    const compliance = new Contract(resolvedComplianceAddr, ComplianceABI, signer);
    complianceBoundToken = await tryCall(() => compliance.getTokenBound(), constants.AddressZero);
  }

  const tokenName = await tryCall(() => token.name(), "");
  const tokenSymbol = await tryCall(() => token.symbol(), "");
  const tokenDecimals = await tryCall(() => token.decimals(), 0);
  const totalSupply = await tryCall(() => token.totalSupply(), 0);
  const signerAddr = await signer.getAddress();
  const erc20Balance0 = await tryCall(() => token.balanceOf(signerAddr), 0);
  const erc20AllowanceSelf = await tryCall(() => token.allowance(signerAddr, signerAddr), 0);
  
  const tirOwner = tir ? await tryCall(() => tir.owner(), constants.AddressZero) : constants.AddressZero;
  const irsOwner = irs ? await tryCall(() => irs.owner(), constants.AddressZero) : constants.AddressZero;

  return {
    tokenIdentity,
    tokenCompliance,
    tokenOwner,
    idrTopicsRegistryAddr,
    idrTrustedIssuersAddr,
    topics,
    complianceBoundToken,
    ctrOwner,
    tokenName,
    tokenSymbol,
    tokenDecimals,
    totalSupply,
    erc20Balance0,
    erc20AllowanceSelf,
    tirOwner,
    irsOwner,
  };
}

function shouldFallback(data, cfg) {
  if (!data) return true;
  const expectedToken = normalizeAddress(cfg.token);
  const expectedIdr = normalizeAddress(cfg.identityRegistry);
  const expectedCtr = normalizeAddress(cfg.claimTopicsRegistry);
  const expectedTir = normalizeAddress(cfg.trustedIssuersRegistry);
  const expectedCompliance = normalizeAddress(cfg.compliance);

  const hasKnownTargets = [expectedToken, expectedIdr, expectedCtr].every((x) => x && x !== ZERO);
  if (!hasKnownTargets) return false;

  const tokenIdentityZero = normalizeAddress(data.tokenIdentity) === ZERO;
  const idrTopics = normalizeAddress(data.idrTopicsRegistryAddr);
  const idrTopicsMismatch = expectedCtr !== ZERO && idrTopics !== expectedCtr;
  const idrTopicsZero = idrTopics === ZERO;
  const trustedIssuers = normalizeAddress(data.idrTrustedIssuersAddr);
  const tirMismatch = expectedTir !== ZERO && trustedIssuers !== expectedTir;
  const complianceAddr = normalizeAddress(data.tokenCompliance);
  const complianceMismatch = expectedCompliance !== ZERO && complianceAddr !== expectedCompliance;
  const complianceBound = normalizeAddress(data.complianceBoundToken);
  const complianceBoundMismatch = expectedCompliance !== ZERO && complianceBound !== expectedToken;
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

// =====================
// Default declarative maps for ERC‑3643 + HKMA/SFC rule IDs
// (used when the rule JSON has no explicit 'check'/'allOf'/'anyOf')
// =====================
function defaultDeclarativeFor(ruleId) {
  const id = String(ruleId || "").toUpperCase();

  // Helpers to build common checks
  const nonZero = (field) => ({ op: "nonzeroaddress", field });
  const eqAddr  = (field, equals) => ({ op: "equalsaddress", field, equals });
  const hasFn   = (where, sig) => ({ op: "hasabifn", where, sig });
  const hasEvt  = (where, name) => ({ op: "hasevent", where, name });
  const lenGte  = (field, n) => ({ op: "lengthgte", field, value: n });

  switch (id) {
    // R-ERC3643-01 — Transfer must check identity gating
    // Heuristic: token wired to a non-zero IdentityRegistry AND IdentityRegistry exposes isVerified(address)
    case "R-ERC3643-01":
      return {
        allOf: [
          nonZero("data.tokenIdentity"),
          hasFn("idr", "isVerified(address)")
        ]
      };

    // R-ERC3643-02 — Token.identityRegistry equals configured IR
    case "R-ERC3643-02":
      return { check: eqAddr("data.tokenIdentity", "cfg.identityRegistry") };

    // R-ERC3643-03 — IdentityRegistry wired with ClaimTopicsRegistry
    case "R-ERC3643-03":
      return { check: eqAddr("data.idrTopicsRegistryAddr", "cfg.claimTopicsRegistry") };

    // R-ERC3643-04 — Claim topics exist (>=1)
    case "R-ERC3643-04":
      return { check: lenGte("data.topics", 1) };

    // R-ERC3643-05 — IdentityRegistry wired with TrustedIssuersRegistry (if provided)
    case "R-ERC3643-05":
      // If cfg.trustedIssuersRegistry is zero/absent, treat as pass (project may not use TIR explicitly)
      return {
        anyOf: [
          { op: "equalsaddress", field: "data.idrTrustedIssuersAddr", equals: "cfg.trustedIssuersRegistry" },
          // allow empty config: if config TIR is zero, this path will be equal (ZERO == ZERO) after normalization
          { op: "equalsaddress", field: "data.idrTrustedIssuersAddr", equals: "0x0000000000000000000000000000000000000000" }
        ]
      };

    // R-ERC3643-06 — Compliance bound to token
    case "R-ERC3643-06":
      return {
        allOf: [
          nonZero("data.tokenCompliance"),
          eqAddr("data.complianceBoundToken", "cfg.token")
        ]
      };

    // R-ERC3643-07 — Token exposes setIdentityRegistry(address)
    case "R-ERC3643-07":
      return { check: hasFn("token", "setIdentityRegistry(address)") };

    // R-ERC3643-08 — IdentityRegistry exposes setClaimTopicsRegistry(address)
    case "R-ERC3643-08":
      return { check: hasFn("idr", "setClaimTopicsRegistry(address)") };

    // R-ERC3643-09 — IdentityRegistry exposes setTrustedIssuersRegistry(address)
    case "R-ERC3643-09":
      return { check: hasFn("idr", "setTrustedIssuersRegistry(address)") };

    // R-ERC3643-10 — IdentityRegistry has isVerified(address)
    case "R-ERC3643-10":
      return { check: hasFn("idr", "isVerified(address)") };
    
    // ---- HKMA rules (R-HKMA-01 ... R-HKMA-05) ----
    case "R-HKMA-01": {
      // Enforce identity verification pre-transfer (heuristic):
      // require token wired to IR, IR exposes isVerified, and token has identityRegistry() getter
      return {
        allOf: [
          { op: "nonzeroaddress", field: "data.tokenIdentity" },
          { op: "hasabifn", where: "token", sig: "identityRegistry()" },
          { op: "hasabifn", where: "idr", sig: "isVerified(address)" }
        ]
      };
    }
    case "R-HKMA-02": {
      // Record keeping: presence of Transfer event (ERC20) OR transfer fn in ABI
      return {
        anyOf: [
          { op: "hasevent", where: "token", name: "Transfer" },
          { op: "hasabifn", where: "token", sig: "transfer(address,uint256)" }
        ]
      };
    }
    case "R-HKMA-03": {
      // Beneficial ownership identification: IR exposes registration/update APIs (proxy for richer KYC infra)
      return {
        anyOf: [
          { op: "hasabifn", where: "idr", sig: "registerIdentity(address,address,uint16)" },
          { op: "hasabifn", where: "idr", sig: "updateIdentity(address,address)" },
          { op: "hasabifn", where: "idr", sig: "deleteIdentity(address)" }
        ]
      };
    }
    case "R-HKMA-04": {
      // Ongoing monitoring via compliance module (bound to token)
      return {
        allOf: [
          { op: "nonzeroaddress", field: "data.tokenCompliance" },
          { op: "equalsaddress", field: "data.complianceBoundToken", equals: "cfg.token" }
        ]
      };
    }
    case "R-HKMA-05": {
      // Freezing/high-risk controls present on token
      return {
        anyOf: [
          { op: "hasabifn", where: "token", sig: "setAddressFrozen(address,bool)" },
          { op: "hasabifn", where: "token", sig: "freezePartialTokens(address,uint256)" },
          { op: "hasabifn", where: "token", sig: "unfreezePartialTokens(address,uint256)" }
        ]
      };
    }

    // ---- SFC rules (R-SFC-01 ... R-SFC-05) ----
    case "R-SFC-01": {
      // Client identity on file (pre-trade): same heuristic as HKMA-01
      return {
        allOf: [
          { op: "nonzeroaddress", field: "data.tokenIdentity" },
          { op: "hasabifn", where: "token", sig: "identityRegistry()" },
          { op: "hasabifn", where: "idr", sig: "isVerified(address)" }
        ]
      };
    }
    case "R-SFC-02": {
      // Timely disclosure: IR exposes identity accessor(s)
      return {
        anyOf: [
          { op: "hasabifn", where: "idr", sig: "identity(address)" },
          { op: "hasabifn", where: "idr", sig: "contains(address)" },
          { op: "hasabifn", where: "idr", sig: "isVerified(address)" }
        ]
      };
    }
    case "R-SFC-03": {
      // Record changes in identity/KYC: identity update functions or events present
      return {
        anyOf: [
          { op: "hasabifn", where: "idr", sig: "updateIdentity(address,address)" },
          { op: "hasevent", where: "idr", name: "IdentityUpdated" },
          { op: "hasevent", where: "idr", name: "IdentityRegistered" },
          { op: "hasevent", where: "idr", name: "IdentityRemoved" }
        ]
      };
    }
    case "R-SFC-04": {
      // Internal control & oversight: agent role management available on token
      return {
        allOf: [
          { op: "hasabifn", where: "token", sig: "addAgent(address)" },
          { op: "hasabifn", where: "token", sig: "removeAgent(address)" }
        ]
      };
    }
    case "R-SFC-05": {
      // Conflicts of interest transparency: admin/registry events exist
      return {
        anyOf: [
          { op: "hasevent", where: "token", name: "ComplianceAdded" },
          { op: "hasevent", where: "idr",   name: "IdentityUpdated" },
          { op: "hasevent", where: "ctr",   name: "ClaimTopicAdded" }
        ]
      };
    }
    default:
      return null;
  }
}
// =====================
// Normalize possible declarative shapes coming from rules JSON
function normalizeDeclarativeSpec(r) {
  if (!r || typeof r !== "object") return null;
  // direct keys
  if (r.check || r.allOf || r.anyOf) {
    return { check: r.check || null, allOf: r.allOf || null, anyOf: r.anyOf || null };
  }
  // common aliases used in some files
  if (Array.isArray(r.checks)) {
    return { allOf: r.checks };
  }
  if (Array.isArray(r.conditions)) {
    return { allOf: r.conditions };
  }
  if (r.declarative && (r.declarative.check || r.declarative.allOf || r.declarative.anyOf)) {
    const d = r.declarative;
    return { check: d.check || null, allOf: d.allOf || null, anyOf: d.anyOf || null };
  }
  return null;
}
// =====================
// Declarative rule engine
// =====================
function evalCheck(chk, data, cfg, helpers) {
  const op = (chk.op || "").toLowerCase();
  if (op === "nonzeroaddress") {
    const v = asAddr(chk.field && chk.field.startsWith("data.") ? chk.field : `data.${chk.field}`, cfg, data);
    return v !== ZERO;
  }
  if (op === "equalsaddress") {
    const left = asAddr(chk.field && chk.field.startsWith("data.") ? chk.field : `data.${chk.field}`, cfg, data);
    const right = asAddr(chk.equals ?? chk.value, cfg, data);
    return left === right;
  }
  if (op === "lengthgte") {
    const arr = getByPath(data, chk.field && chk.field.startsWith("data.") ? chk.field.slice(5) : chk.field);
    const n = typeof chk.value === "number" ? chk.value : 0;
    return Array.isArray(arr) && arr.length >= n;
  }
  if (op === "oneofaddress") {
    const left = asAddr(chk.field && chk.field.startsWith("data.") ? chk.field : `data.${chk.field}`, cfg, data);
    const list = Array.isArray(chk.values) ? chk.values.map(v => asAddr(v, cfg, data)) : [];
    return list.includes(left);
  }
  if (op === "hasabifn") { // expects { where: "token|idr|ctr|tir", sig: "transfer(address,uint256)" or name }
    const where = (chk.where || "").toLowerCase();
    const sig = String(chk.sig || chk.name || "");
    return helpers && typeof helpers.hasFn === "function" ? helpers.hasFn(where, sig) : true;
  }
  if (op === "hasevent") { // expects { where: "token|idr|ctr|tir", name: "IdentityRegistered" }
    const where = (chk.where || "").toLowerCase();
    const name = String(chk.name || "");
    return helpers && typeof helpers.hasEvent === "function" ? helpers.hasEvent(where, name) : true;
  }
  // default: unknown op -> pass to avoid false negatives for forward-compat rules
  return true;
}

function evalDeclarativeRule(r, data, cfg, helpers) {
  if (!r.check && !r.allOf && !r.anyOf) return null; // not declarative
  const notes = [];
  let result = true;

  const run = (c) => {
    const ok = evalCheck(c, data, cfg, helpers);
    // build a small note string for transparency
    const op = (c.op || "").toLowerCase();
    if (op === "nonzeroaddress") {
      const v = asAddr(c.field && c.field.startsWith("data.") ? c.field : `data.${c.field}`, cfg, data);
      notes.push(`${c.field} is non-zero: ${v}`);
    } else if (op === "equalsaddress") {
      const left = asAddr(c.field && c.field.startsWith("data.") ? c.field : `data.${c.field}`, cfg, data);
      const right = asAddr(c.equals ?? c.value, cfg, data);
      notes.push(`${c.field} equals ${c.equals || c.value} → (${left} vs ${right})`);
    } else if (op === "lengthgte") {
      const arr = getByPath(data, c.field && c.field.startsWith("data.") ? c.field.slice(5) : c.field);
      notes.push(`${c.field}.length>=${c.value} (actual ${Array.isArray(arr) ? arr.length : "n/a"})`);
    } else if (op === "oneofaddress") {
      const left = asAddr(c.field && c.field.startsWith("data.") ? c.field : `data.${c.field}`, cfg, data);
      notes.push(`${c.field} in [${(c.values||[]).join(",")}] actual=${left}`);
    } else if (op === "hasabifn") {
      const present = helpers && helpers.hasFn ? helpers.hasFn((c.where||"").toLowerCase(), String(c.sig || c.name || "")) : "n/a";
      notes.push(`ABI has ${c.where}.${c.sig || c.name}: ${present}`);
    } else if (op === "hasevent") {
      const present = helpers && helpers.hasEvent ? helpers.hasEvent((c.where||"").toLowerCase(), String(c.name||"")) : "n/a";
      notes.push(`Event on ${c.where}:${c.name} present: ${present}`);
    }
    return ok;
  };

  if (r.check) {
    result = run(r.check);
  } else if (Array.isArray(r.allOf)) {
    result = r.allOf.every(run);
  } else if (Array.isArray(r.anyOf)) {
    result = r.anyOf.some(run);
  }

  return { pass: result, note: notes.join("; ") };
}

// =====================
// Main
// =====================
async function main() {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  let rulesArg = null;
  let addressesArg = null;
  let outputArg = null;
  let groundArg = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--rules" && argv[i + 1]) {
      rulesArg = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--rules=")) {
      rulesArg = token.slice("--rules=".length);
    } else if (token === "--addresses" && argv[i + 1]) {
      addressesArg = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--addresses=")) {
      addressesArg = token.slice("--addresses=".length);
    } else if (token === "--output" && argv[i + 1]) {
      outputArg = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--output=")) {
      outputArg = token.slice("--output=".length);
    } else if (token === "--groundtruth" && argv[i + 1]) {
      groundArg = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--groundtruth=")) {
      groundArg = token.slice("--groundtruth=".length);
    }
  }

  const outputPath = outputArg
    ? (path.isAbsolute(outputArg) ? outputArg : path.join(root, outputArg))
    : path.join(root, "reports", "p2-results.json");

  const runDefs = [];
  const resolveRules = (relPath) => (path.isAbsolute(relPath) ? relPath : path.join(root, relPath));
  const resolveAddr  = (relPath) => (path.isAbsolute(relPath) ? relPath : path.join(root, relPath));

  // Support multiple rules files:
  // - If --rules is provided, accept a comma-separated list of paths.
  // - Otherwise, default to both ERC‑3643 and HK rules when present.
  const defaultRuleFiles = [
    "cre/rules/baseline.erc3643.json",
    "cre/rules/baseline.hk.json"
  ];

  const rulesPaths = (() => {
    if (rulesArg) {
      return rulesArg.split(",").map(s => s.trim()).filter(Boolean).map(resolveRules);
    }
    return defaultRuleFiles.map(resolveRules).filter(p => fs.existsSync(p));
  })();

  if (!rulesPaths.length) {
    console.error("[phase2] No rules file found. Expected at least one of:");
    for (const f of defaultRuleFiles) console.error("  - " + f);
    process.exit(1);
  }

  // Default to .cre.addresses.json if --addresses is not provided
  const addressesPath = resolveAddr(addressesArg || ".cre.addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error(`[phase2] Addresses file not found: ${addressesPath}`);
    process.exit(1);
  }

  // Used rules files (relative to root)
  const ruleFilesUsed = rulesPaths.map(p => path.relative(root, p));

  // Build runs: one per rules file. Label derived from filename.
  for (const rp of rulesPaths) {
    const label = path.basename(rp).replace(/\.json$/i, "");
    runDefs.push({
      label,
      rulesPath: rp,
      addressesPath
    });
    console.log(`[phase2] Queued rules: ${path.relative(root, rp)} (label=${label})`);
  }

  ensureDir(path.join(root, "reports"));

  // Load ground truth if provided or present by default
  const groundPath = groundArg
    ? (path.isAbsolute(groundArg) ? groundArg : path.join(root, groundArg))
    : path.join(root, "reports", "ground-truth.json");
  const groundTruth = tryLoadJson(groundPath);
  // normalize to a map id -> expected (PASS/FAIL/WARN/INFO). If array of rules was provided, turn into map.
  let gtMap = null;
  if (groundTruth) {
    if (Array.isArray(groundTruth)) {
      gtMap = new Map(groundTruth.map(r => [String(r.id || "").toUpperCase(), String(r.expected || r.verdict || r.outcome || "PASS").toUpperCase()]));
    } else if (groundTruth && typeof groundTruth === "object" && Array.isArray(groundTruth.items)) {
      gtMap = new Map(groundTruth.items.map(r => [String(r.id || "").toUpperCase(), String(r.expected || r.verdict || r.outcome || "PASS").toUpperCase()]));
    } else {
      gtMap = new Map(Object.entries(groundTruth).map(([k,v]) => [String(k).toUpperCase(), String(v).toUpperCase()]));
    }
  }

  // Load ABI artifacts once, to use for inputsMeta
  const abiArtifacts = loadAbiArtifacts(root);

  // Compose richer inputs metadata
  const inputsMeta = {
    addressesPath,
    addresses: loadJson(addressesPath),
    ruleFiles: ruleFilesUsed,
    abiArtifacts: Object.fromEntries(
      Object.entries(abiArtifacts?.paths || {}).map(
        ([k,v]) => [k, v ? path.relative(root, v) : null]
      )
    )
  };

  const aggregatedItems = [];
  const aggregatedSummary = { pass: 0, fail: 0, warn: 0, info: 0 };
  const runsMeta = [];
  const metricsOverall = { tp:0, tn:0, fp:0, fn:0, compared:0 };
  const disagreements = [];

  for (const def of runDefs) {
    const rules = loadJson(def.rulesPath);
    if (!Array.isArray(rules) || rules.length === 0) {
      console.warn(`[phase2] Skipping ${def.label}: rules file empty.`);
      continue;
    }
    const result = await evaluateRun(root, def, rules, abiArtifacts);
    // Per-run metrics vs ground truth (binary: PASS vs NONPASS)
    let runMetrics = { tp:0, tn:0, fp:0, fn:0, compared:0 };
    if (gtMap) {
      for (const it of result.items) {
        const key = String(it.id || "").toUpperCase();
        if (!gtMap.has(key)) continue;
        const expectedRaw = gtMap.get(key);
        const expected = expectedRaw === "PASS" ? "PASS" : "NONPASS";
        const predicted = it.pass ? "PASS" : "NONPASS";
        runMetrics.compared++;
        if (predicted === "PASS" && expected === "PASS") runMetrics.tp++;
        else if (predicted !== "PASS" && expected !== "PASS") runMetrics.tn++;
        else if (predicted === "PASS" && expected !== "PASS") { runMetrics.fp++; disagreements.push({ run: def.label, id: it.id, expected: expectedRaw, predicted: it.pass ? (it.severity||"PASS") : "FAIL", note: it.note||"" }); }
        else if (predicted !== "PASS" && expected === "PASS") { runMetrics.fn++; disagreements.push({ run: def.label, id: it.id, expected: expectedRaw, predicted: it.pass ? (it.severity||"PASS") : "FAIL", note: it.note||"" }); }
      }
      // attach metrics on meta
      const p = safeDiv(runMetrics.tp, (runMetrics.tp + runMetrics.fp));
      const r = safeDiv(runMetrics.tp, (runMetrics.tp + runMetrics.fn));
      const f1 = (p + r) > 0 ? (2 * p * r) / (p + r) : 0;
      result.meta.metrics = {
        compared: runMetrics.compared,
        tp: runMetrics.tp, fp: runMetrics.fp, tn: runMetrics.tn, fn: runMetrics.fn,
        precision: p, recall: r, f1, accuracy: safeDiv((runMetrics.tp + runMetrics.tn), Math.max(1, runMetrics.compared))
      };
      // fold into overall
      metricsOverall.tp += runMetrics.tp; metricsOverall.tn += runMetrics.tn; metricsOverall.fp += runMetrics.fp; metricsOverall.fn += runMetrics.fn; metricsOverall.compared += runMetrics.compared;
    }
    aggregatedItems.push(...result.items);
    aggregatedSummary.pass += result.summary.pass;
    aggregatedSummary.fail += result.summary.fail;
    aggregatedSummary.warn += result.summary.warn;
    aggregatedSummary.info += result.summary.info;
    runsMeta.push(result.meta);
  }

  if (aggregatedItems.length === 0) {
    console.error("[phase2] No rule evaluations completed; aborting.");
    process.exit(1);
  }

  const overallP = safeDiv(metricsOverall.tp, (metricsOverall.tp + metricsOverall.fp));
  const overallR = safeDiv(metricsOverall.tp, (metricsOverall.tp + metricsOverall.fn));
  const overallF1 = (overallP + overallR) > 0 ? (2 * overallP * overallR) / (overallP + overallR) : 0;

  const out = {
    generatedAt: new Date().toISOString(),
    inputs: inputsMeta,
    runs: runsMeta,
    items: aggregatedItems,
    summary: aggregatedSummary,
    metrics: gtMap ? {
      compared: metricsOverall.compared,
      tp: metricsOverall.tp, fp: metricsOverall.fp, tn: metricsOverall.tn, fn: metricsOverall.fn,
      precision: overallP, recall: overallR, f1: overallF1,
      accuracy: safeDiv((metricsOverall.tp + metricsOverall.tn), Math.max(1, metricsOverall.compared)),
      disagreements
    } : null
  };

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  if (out.metrics) {
    const metricsPath = outputPath.replace(/\.json$/, ".metrics.json");
    fs.writeFileSync(metricsPath, JSON.stringify({ generatedAt: out.generatedAt, metrics: out.metrics }, null, 2));
    console.log(`[phase2] Metrics written: ${metricsPath}`);
  } else {
    console.log(`[phase2] No ground truth found at ${groundPath}; metrics skipped.`);
  }
  console.log(`[phase2] JSON written: ${outputPath}`);
  if (abiArtifacts && abiArtifacts.paths) {
    console.log('[phase2] ABI artifacts:');
    for (const [k,v] of Object.entries(abiArtifacts.paths)) {
      console.log(`  - ${k}: ${v ? path.relative(root, v) : 'not found'}`);
    }
  }
}

async function evaluateRun(root, def, rules, abiArtifactsArg) {
  const { label, rulesPath, addressesPath } = def;
  console.log(`[phase2] [${label}] Evaluating ${rules.length} rule(s)`);

  const cfg = loadJson(addressesPath);

  // Use abiArtifactsArg if provided, else load
  const abiArtifacts = abiArtifactsArg || loadAbiArtifacts(root);
  const idx = {
    token: makeAbiIndex(abiArtifacts?.tokenAbi),
    idr: makeAbiIndex(abiArtifacts?.idrAbi),
    ctr: makeAbiIndex(abiArtifacts?.ctrAbi),
    tir: makeAbiIndex(abiArtifacts?.tirAbi),
  };
  // Guard against missing ABI indices
  for (const k of ["token","idr","ctr","tir"]) {
    if (!idx[k]) idx[k] = { bySig: new Set(), byName: new Set(), hasEvent: new Set() };
  }
  const hasFn = (where, sigOrName) => idx[where] && (idx[where].bySig.has(sigOrName) || idx[where].byName.has(sigOrName));
  const hasEvent = (where, name) => idx[where] && idx[where].hasEvent.has(name);

  let context = await tryCreateRpcContext(cfg);
  let data = null;
  if (context) data = await collectData(context, cfg);
  const allowFallback = path.resolve(addressesPath) === path.join(root, ".cre.addresses.json");
  if ((!context || shouldFallback(data, cfg)) && allowFallback) {
    console.log(`[phase2] [${label}] Falling back to in-process Hardhat deployment for checks`);
    context = await createHardhatContext();
    data = await collectData(context, cfg);
    const latestCfg = loadJson(addressesPath);
    Object.assign(cfg, latestCfg);
  } else if (!context || shouldFallback(data, cfg)) {
    console.warn(`[phase2] [${label}] Skipping Hardhat fallback for custom addresses ${addressesPath}`);
  }

  if (!data) {
    console.warn(`[phase2] [${label}] Unable to collect on-chain data; proceeding with empty dataset.`);
    data = {};
  }

  const items = [];

  for (const r of rules) {
    let pass = false; let note = "";
    // Prefer explicit declarative checks from the rule object
    const spec = normalizeDeclarativeSpec(r);
    let dec = spec ? evalDeclarativeRule(spec, data, cfg, { hasFn, hasEvent })
                   : evalDeclarativeRule(r, data, cfg, { hasFn, hasEvent });

    // If still nothing, try auto-mapping for well-known IDs
    if (!dec) {
      const auto = defaultDeclarativeFor(r.id);
      if (auto) dec = evalDeclarativeRule(auto, data, cfg, { hasFn, hasEvent });
    }

    if (dec) {
      pass = dec.pass; note = dec.note;
    } else {
      pass = true;
      note = `no checks: rule '${r.id}' has no declarative section (check/allOf/anyOf) and no default mapping`;
    }

    items.push({
      id: r.id,
      title: r.title,
      desc: r.desc,
      snippet: r.snippet || "",
      policyRef: r.policyRef || "",
      severity: r.severity,
      pass,
      note,
      run: label
    });
  }

  const summary = {
    pass: items.filter(i => i.pass).length,
    fail: items.filter(i => !i.pass && String(i.severity).toUpperCase() === "FAIL").length,
    warn: items.filter(i => !i.pass && String(i.severity).toUpperCase() === "WARN").length,
    info: items.filter(i => !i.pass && !["FAIL","WARN"].includes(String(i.severity).toUpperCase())).length,
  };

  const meta = {
    label,
    rulesPath: path.relative(root, rulesPath),
    addressesPath: path.relative(root, addressesPath),
    summary,
    addresses: cfg,
    data: {
      tokenIdentity: data?.tokenIdentity ?? null,
      tokenCompliance: data?.tokenCompliance ?? null,
      tokenOwner: data?.tokenOwner ?? null,
      ctrOwner: data?.ctrOwner ?? null,
      idrClaimTopicsAddr: data?.idrTopicsRegistryAddr ?? null,
      idrTrustedIssuersAddr: data?.idrTrustedIssuersAddr ?? null,
      topicsCount: Array.isArray(data?.topics) ? data.topics.length : 0,
      complianceBoundToken: data?.complianceBoundToken ?? null,
      executionMode: context?.mode ?? null,
      tokenName: data?.tokenName ?? null,
      tokenSymbol: data?.tokenSymbol ?? null,
      tokenDecimals: data?.tokenDecimals ?? null,
      tirOwner: data?.tirOwner ?? null,
      irsOwner: data?.irsOwner ?? null,
    },
    abiArtifacts: Object.fromEntries(
      Object.entries(abiArtifacts?.paths || {}).map(
        ([k,v]) => [k, v ? path.relative(root, v) : null]
      )
    ),
  };

  return { items, summary, meta };
}

main().catch(e => { console.error(e); process.exit(1); });
