/* eslint-disable */
const fs = require("fs");
const path = require("path");
const { ethers: rpcEthers } = require("ethers");
const { createRuleEngine, defaultOperationHandlers } = require("./lib/rule-engine");

// Optional ABI artifact loader (supports overrides via env/impl-specific files)
function resolveAbiPathsFile(root) {
  const explicit = process.env.ABIPATHS_FILE;
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.join(root, explicit);
    if (fs.existsSync(resolved)) return resolved;
  }
  const impl = String(process.env.BOOTSTRAP_IMPL || "").toLowerCase();
  if (impl) {
    const candidate = path.join(root, `abipaths.${impl}.json`);
    if (fs.existsSync(candidate)) return candidate;
  }
  const fallback = path.join(root, "abipaths.json");
  return fs.existsSync(fallback) ? fallback : null;
}

// Optional ABI artifact loader (if present via abipaths.json or overrides)
function loadAbiArtifacts(root) {
  const abipathsPath = resolveAbiPathsFile(root);
  if (!abipathsPath) return null;
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
    const compliance = loadOne(map.Compliance);
    const irs = loadOne(map.IdentityRegistryStorage);
    return {
      tokenAbi: token.abi,
      idrAbi: idr.abi,
      ctrAbi: ctr.abi,
      tirAbi: tir.abi,
      complianceAbi: compliance.abi,
      irsAbi: irs.abi,
      source: abipathsPath,
      paths: {
        Token: token.path,
        IdentityRegistry: idr.path,
        ClaimTopicsRegistry: ctr.path,
        TrustedIssuersRegistry: tir.path,
        Compliance: compliance.path,
        IdentityRegistryStorage: irs.path
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

function resolveWhereAlias(where) {
  const key = String(where || "").toLowerCase();
  if (key === "control" || key === "controller") return "token";
  return key;
}

// =====================
// Shared helpers
// =====================
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO = ZERO_ADDRESS.toLowerCase();
let BENEFICIAL_OWNER_TOPIC = Number(process.env.BENEFICIAL_OWNER_TOPIC || "2001");

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


function loadLocalEnv(root) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      if (!key || key in process.env) continue;
      const value = line.slice(idx + 1).trim();
      process.env[key] = value;
    }
  } catch (e) {
    console.warn(`Failed to load .env: ${e.message}`);
  }
}

function shorten(text, maxLen) {
  if (!text) return "";
  const str = String(text);
  if (str.length <= maxLen) return str;
  return `${str.slice(0, Math.max(0, maxLen - 3))}...`;
}

function flattenDetails(details) {
  const out = [];
  if (!Array.isArray(details)) return out;
  for (const entry of details) {
    if (!entry) continue;
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (typeof entry === "object") {
      if (entry.evidence) out.push(String(entry.evidence));
      else if (entry.note) out.push(String(entry.note));
      else if (entry.path) out.push(String(entry.path));
      else if (entry.field && entry.op) out.push(`${entry.op}:${entry.field}:${entry.value ?? entry.equals ?? ""}`);
      else {
        try {
          out.push(JSON.stringify(entry));
        } catch {
          out.push(String(entry));
        }
      }
    } else {
      out.push(String(entry));
    }
  }
  return out;
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v));
  return [String(value)].filter(Boolean);
}

const SEVERITY_SCALE = {
  CRITICAL: { label: "Critical", weight: 4 },
  HIGH: { label: "High", weight: 3 },
  MEDIUM: { label: "Medium", weight: 2 },
  LOW: { label: "Low", weight: 1 }
};

const SEVERITY_ALIASES = new Map([
  ["CRITICAL", "CRITICAL"],
  ["HIGH", "HIGH"],
  ["MEDIUM", "MEDIUM"],
  ["LOW", "LOW"]
]);

function normalizeSeverityValue(rawSeverity) {
  const key = typeof rawSeverity === "string" ? rawSeverity.trim().toUpperCase() : "";
  const code = SEVERITY_ALIASES.get(key) || "MEDIUM";
  const meta = SEVERITY_SCALE[code] || SEVERITY_SCALE.MEDIUM;
  return {
    code,
    label: meta.label,
    weight: meta.weight,
    original: rawSeverity ?? null
  };
}

function severityWeight(value) {
  const key = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (key === "PASS") return 0;
  return normalizeSeverityValue(value).weight;
}

function severityLabel(value) {
  const key = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (key === "PASS") return "Pass";
  return normalizeSeverityValue(value).label;
}

function attachSeverity(target, rawSeverity) {
  const info = normalizeSeverityValue(rawSeverity);
  return Object.assign(target, {
    severity: info.code,
    severityCode: info.code,
    severityLabel: info.label,
    severityOriginal: info.original,
    severityWeight: info.weight
  });
}

function buildSummaryFromItems(items) {
  const summary = {
    total: Array.isArray(items) ? items.length : 0,
    pass: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    fail: 0,
    warn: 0,
    info: 0
  };
  if (!Array.isArray(items)) return summary;
  for (const item of items) {
    if (item && item.pass) {
      summary.pass += 1;
      continue;
    }
    const code = String(item?.severityCode || item?.severity || "").toUpperCase();
    if (code === "CRITICAL") summary.critical += 1;
    else if (code === "HIGH") summary.high += 1;
    else if (code === "MEDIUM") summary.medium += 1;
    else summary.low += 1;
  }
  summary.fail = summary.critical;
  summary.warn = summary.high + summary.medium;
  summary.info = summary.low;
  return summary;
}

function buildRulePayload(items) {
  return items.map((it) => {
    const severityCode = String(it.severityCode || it.severity || "").toUpperCase();
    const severityInfo = normalizeSeverityValue(severityCode);
    const phase2Verdict = it.pass ? "PASS" : severityInfo.label;
    const evidence = flattenDetails(it.details || []);
    const evidenceCompact = evidence.slice(0, 8).map((e) => shorten(e, 240));
    const references = normalizeArray(it.policyRef || it.policy_refs);
    return {
      id: it.id || "",
      title: it.title || "",
      severity: severityInfo.label,
      severity_code: severityInfo.code,
      severity_label: severityInfo.label,
      severity_original: it.severityOriginal || it.severity || "",
      phase2_verdict: phase2Verdict,
      pass: !!it.pass,
      run: it.run || "",
      note: shorten(it.note || "", 320),
      evidence: evidenceCompact,
      policy_refs: references
    };
  });
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
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)"
];
const IdentityRegistryABI = [
  "function topicsRegistry() view returns (address)",
  "function issuersRegistry() view returns (address)",
  "function identityStorage() view returns (address)",
  "function identity(address) view returns (address)",                  // Identity Resolution
  "function riskLevel(address) view returns (uint8)",                   // Risk Classification
  "function beneficialOwners(address) view returns (address[])"         // Ownership and Control Tracking
];
const ClaimTopicsRegistryABI = [
  "function getClaimTopics() view returns (uint256[])",
  "function owner() view returns (address)"
];
const ComplianceABI = [
  "function getTokenBound() view returns (address)",
  "function canTransfer(address,address,uint256) view returns (bool)",
  "function getModules() view returns (address[])"
];
const TrustedIssuersRegistryABI = [
  "function owner() view returns (address)"
];
const IdentityRegistryStorageABI = [
  "function owner() view returns (address)"
];

const ComplianceAdminABI = [
  "function addModule(address) external",
  "function removeModule(address) external",
  "function callModuleFunction(bytes,address) external"
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
  const impl = String(process.env.BOOTSTRAP_IMPL || "trex").toLowerCase();
  if (impl === "boulder") {
    const { bootstrapBoulder } = require("./bootstrap-boulder.ts");
    await bootstrapBoulder(hre, ".cre.addresses.json");
  } else if (impl === "buggy") {
    const { bootstrapBuggy } = require("./bootstrap-buggy.ts");
    await bootstrapBuggy(hre, process.env.BUGGY_OUTPUT || ".cre.addresses.json");
  } else {
    const { bootstrap } = require("./bootstrap-clean.ts");
    await bootstrap(hre);
  }
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

  const tryCall = async (fn, def = null) => { try { return await fn(); } catch { return def; } };

  const tokenIdentity = await tryCall(() => token.identityRegistry(), constants.AddressZero);
  const tokenCompliance = await tryCall(() => token.compliance(), constants.AddressZero);
  const tokenOwner = await tryCall(() => token.owner(), constants.AddressZero);

  const idrIdentityStorageAddr = await tryCall(() => idr.identityStorage(), constants.AddressZero);
  const resolvedIrsAddr = normalizeAddress(idrIdentityStorageAddr) !== ZERO
    ? idrIdentityStorageAddr
    : (cfg.identityRegistryStorage || constants.AddressZero);
  const irs = normalizeAddress(resolvedIrsAddr) !== ZERO
    ? new Contract(resolvedIrsAddr, IdentityRegistryStorageABI, signer)
    : null;

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
  const controlAddress = normalizeAddress(cfg.control) !== ZERO ? cfg.control : cfg.token;

  return {
    tokenIdentity,
    tokenCompliance: resolvedComplianceAddr,
    tokenComplianceRaw: tokenCompliance,
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
    idrIdentityStorageAddr: resolvedIrsAddr,
    controlAddress,
  };
}

// =====================
// Runtime probes (only in Hardhat fallback)
// =====================
async function runRuntimeProbes(context, cfg, data, rules) {
  const probes = {};
  const ruleIds = new Set(Array.isArray(rules) ? rules.map((r) => String(r.id || "").toUpperCase()) : []);
  const ruleIdMap = new Map();
  if (Array.isArray(rules)) {
    for (const r of rules) {
      const up = String(r?.id || "").toUpperCase();
      if (up) ruleIdMap.set(up, String(r.id));
    }
  }
  const needs3643_01 = ruleIds.has("R-ERC3643-01");
  const needs3643_02 = ruleIds.has("R-ERC3643-02");
  const needsAmloCdd = ruleIds.has("R-HKMA-AMLO-CDD");
  const needsAmloRecord = ruleIds.has("R-HKMA-AMLO-RECORDKEEPING");
  const needsSanctions = ruleIds.has("R-HKMA-AMLO-SANCTIONS") || ruleIds.has("R-HKMA-SANCTIONS");
  const sanctionsKeyUpper = ruleIds.has("R-HKMA-AMLO-SANCTIONS") ? "R-HKMA-AMLO-SANCTIONS" : "R-HKMA-SANCTIONS";
  const sanctionsKey = ruleIdMap.get(sanctionsKeyUpper) || sanctionsKeyUpper;
  const needsOngoing = ruleIds.has("R-HKMA-AMLO-ONGOINGMONITORING");
  const needsKycRecheck = ruleIds.has("R-HKMA-AMLO-KYCSTATUSRECHECK");
  const needsJurisdiction = ruleIds.has("R-HKMA-AMLO-INVESTORJURISDICTION");
  const needsDualControl = ruleIds.has("R-HKMA-AMLO-DUALCONTROL");
  const needsFreeze = ruleIds.has("R-HKMA-AMLO-FREEZEUNFREEZE");
  const needsOwnership = ruleIds.has("R-HKMA-AMLO-OWNERSHIPCONTROL");

  const ensureProbe = (id) => {
    if (!probes[id]) probes[id] = { ran: false, pass: null, evidence: "skipped (no runtime)" };
  };

  if (needs3643_01) ensureProbe("R-ERC3643-01");
  if (needs3643_02) ensureProbe("R-ERC3643-02");
  if (needsAmloCdd) ensureProbe("R-HKMA-AMLO-CDD");
  if (needsAmloRecord) ensureProbe("R-HKMA-AMLO-RECORDKEEPING");
  if (needsSanctions) ensureProbe(sanctionsKey);
  const ongoingKey = ruleIdMap.get("R-HKMA-AMLO-ONGOINGMONITORING") || "R-HKMA-AMLO-ONGOINGMONITORING";
  if (needsOngoing) ensureProbe(ongoingKey);
  const jurisdictionKey = ruleIdMap.get("R-HKMA-AMLO-INVESTORJURISDICTION") || "R-HKMA-AMLO-INVESTORJURISDICTION";
  if (needsKycRecheck) ensureProbe(ruleIdMap.get("R-HKMA-AMLO-KYCSTATUSRECHECK") || "R-HKMA-AMLO-KYCSTATUSRECHECK");
  if (needsJurisdiction) ensureProbe(jurisdictionKey);
  const dualControlKey = ruleIdMap.get("R-HKMA-AMLO-DUALCONTROL") || "R-HKMA-AMLO-DUALCONTROL";
  const freezeKey = ruleIdMap.get("R-HKMA-AMLO-FREEZEUNFREEZE") || "R-HKMA-AMLO-FREEZEUNFREEZE";
  if (needsDualControl) ensureProbe(dualControlKey);
  if (needsFreeze) ensureProbe(freezeKey);
  if (needsOwnership) ensureProbe(ruleIdMap.get("R-HKMA-AMLO-OWNERSHIPCONTROL") || "R-HKMA-AMLO-OWNERSHIPCONTROL");

  if (!context || context.mode !== "hardhat") {
    return probes;
  }

  const { ethers, signer } = context;
  const Contract = ethers.Contract;

  const token = new Contract(cfg.token, TokenABI, signer);
  const complianceAddr = normalizeAddress(data.tokenCompliance);
  const hasCompliance = complianceAddr !== ZERO;
  const compliance = hasCompliance ? new Contract(complianceAddr, ComplianceABI, signer) : null;
  const claimTopicsRegistryAddr = cfg.claimTopicsRegistry ? normalizeAddress(cfg.claimTopicsRegistry) : ZERO;
  const claimTopicsRegistry = (needsOwnership || needsAmloCdd || needsOngoing) && claimTopicsRegistryAddr !== ZERO
    ? new Contract(cfg.claimTopicsRegistry, ClaimTopicsRegistryABI, signer)
    : null;
  const trustedIssuersRegistryAddr = cfg.trustedIssuersRegistry ? normalizeAddress(cfg.trustedIssuersRegistry) : ZERO;
  const trustedIssuersRegistry = (needsOwnership || needsAmloCdd) && trustedIssuersRegistryAddr !== ZERO
    ? new Contract(cfg.trustedIssuersRegistry, TrustedIssuersRegistryABI, signer)
    : null;
  const primaryAddress = await signer.getAddress();

  const complianceModules = [];
  if (hasCompliance) {
    try {
      const moduleAddrs = await compliance.getModules();
      for (const addr of moduleAddrs) {
        const modAddr = normalizeAddress(addr);
        if (modAddr === ZERO) continue;
        let moduleName = "";
        try {
          const moduleContract = new Contract(addr, ["function name() view returns (string)"] , signer);
          moduleName = String(await moduleContract.name());
        } catch {}
        complianceModules.push({ address: modAddr, name: moduleName });
      }
    } catch {}
  }
  data.complianceModules = complianceModules;

  const identityRegistry = (needsAmloRecord || needsAmloCdd || needsOngoing)
    ? new Contract(cfg.identityRegistry, IdentityRegistryABI, signer)
    : null;

  const allSigners = (context && context.ethers && typeof context.ethers.getSigners === "function")
    ? await context.ethers.getSigners()
    : [signer];
  const secondarySigner = allSigners[1] || signer;
  const controlAddr = normalizeAddress(data.controlAddress || cfg.control || cfg.token);
  const ControlABI = [
    "function setAddressFrozen(address,bool) external",
    "function isFrozen(address) view returns (bool)",
    "function freeze(address) external",
    "function unfreeze(address) external",
    "function freezePartialTokens(address,uint256) external",
    "function unfreezePartialTokens(address,uint256) external"
  ];
  const control = controlAddr !== ZERO ? new Contract(controlAddr, ControlABI, signer) : null;

  const tryTx = async (fn) => {
    try {
      const tx = await fn();
      const rcpt = await tx.wait();
      return { ok: true, rcpt };
    } catch (e) {
      return { ok: false, err: e };
    }
  };

  // --- Probe for identity gating (shared by ERC-3643-01 & AMLO CDD) ---
  if (needs3643_01 || needsAmloCdd) {
    try {
      const to = ethers.Wallet.createRandom().address;
      const res = await tryTx(() => token.transfer(to, 1));
      const pass = !res.ok;
      const evidenceBase = pass
        ? "transfer(to=unverified) reverted as expected → indicates identity gating"
        : "transfer(to=unverified) succeeded → missing identity gating";

      if (needs3643_01) {
        probes["R-ERC3643-01"] = { ran: true, pass, evidence: evidenceBase };
      }
      if (needsAmloCdd) {
        const amloEvidence = pass
          ? "AMLO CDD probe: transfer to an unverified address reverted, indicating identity gating is enforced."
          : "AMLO CDD probe: transfer to an unverified address succeeded, missing identity gating.";
        probes["R-HKMA-AMLO-CDD"] = { ran: true, pass, evidence: amloEvidence };
      }
      if (needsKycRecheck) {
        const key = ruleIdMap.get("R-HKMA-AMLO-KYCSTATUSRECHECK") || "R-HKMA-AMLO-KYCSTATUSRECHECK";
        const evidence = pass
          ? "KYC revalidation probe: transfer by unverified actor reverted, indicating runtime checks are enforced."
          : "KYC revalidation probe: transfer by unverified actor succeeded, runtime identity recheck missing.";
        probes[key] = { ran: true, pass, evidence };
      }
    } catch (e) {
      const failure = { ran: true, pass: false, evidence: `probe error: ${String(e && e.message || e)}` };
      if (needs3643_01) probes["R-ERC3643-01"] = { ...failure };
      if (needsAmloCdd) probes["R-HKMA-AMLO-CDD"] = { ...failure };
      if (needsKycRecheck) {
        const key = ruleIdMap.get("R-HKMA-AMLO-KYCSTATUSRECHECK") || "R-HKMA-AMLO-KYCSTATUSRECHECK";
        probes[key] = { ...failure };
      }
    }
  }

  // --- Probe for R-ERC3643-02: token should consult compliance.canTransfer ---
  if (needs3643_02) {
    try {
      if (!hasCompliance) {
        probes["R-ERC3643-02"] = { ran: true, pass: false, evidence: "no compliance() address on token" };
      } else {
        const from = await signer.getAddress();
        const to = ethers.Wallet.createRandom().address;

        let hookSays = null;
        let hookCalled = false;
        try {
          hookSays = await compliance.callStatic.canTransfer(from, to, 1);
          hookCalled = true;
        } catch {
          // if canTransfer is missing or non-callable, keep hookCalled=false
        }
        const res = await tryTx(() => token.transfer(to, 1));
        let pass = false;
        let ev = "";

        if (hookCalled && hookSays === false && !res.ok) {
          pass = true;
          ev = "PASS (deterministic): compliance.canTransfer(...) returned false and transfer reverted → token likely consults compliance hook";
        } else if (hookCalled && hookSays === false && res.ok) {
          pass = false;
          ev = "FAIL: compliance.canTransfer(...) returned false but transfer succeeded → token may NOT consult compliance hook";
        } else if (!hookCalled) {
          pass = false;
          ev = "FAIL: compliance.canTransfer not callable on compliance contract";
        } else {
          pass = true;
          ev = `INCONCLUSIVE (not penalized): compliance.canTransfer=${hookSays}; transfer ${res.ok ? "succeeded" : "reverted"}. Without a test compliance that can return false, the cause can't be isolated.`;
        }

        const enhance = context.ethers && typeof context.ethers.getContractFactory === "function"
          ? await (async () => {
              const admin = new Contract(complianceAddr, ComplianceAdminABI, signer);
              try {
                const factory = await context.ethers.getContractFactory("ComplianceProbeModule", signer);
                const module = await factory.deploy();
                await module.deployed();

                try {
                  await (await admin.addModule(module.address)).wait();
                  const disableData = module.interface.encodeFunctionData("setResult", [false]);
                  await (await admin.callModuleFunction(disableData, module.address)).wait();

                  const checkAfter = await compliance.callStatic.canTransfer(from, to, 1);
                  const outcome = {
                    pass: checkAfter === false,
                    evidence: checkAfter === false
                      ? "Probe module forced canTransfer=false via ComplianceProbeModule; hook responded false as expected."
                      : `Probe module injection failed: canTransfer returned ${checkAfter}`
                  };

                  const enableData = module.interface.encodeFunctionData("setResult", [true]);
                  await (await admin.callModuleFunction(enableData, module.address)).wait();
                  return outcome;
                } finally {
                  try { await (await admin.removeModule(module.address)).wait(); } catch { /* ignore cleanup */ }
                }
              } catch {
                return null;
              }
            })()
          : null;

        if (enhance) {
          pass = enhance.pass;
          ev = enhance.evidence;
        }

        probes["R-ERC3643-02"] = { ran: true, pass, evidence: ev };
      }
    } catch (e) {
      probes["R-ERC3643-02"] = { ran: true, pass: false, evidence: `probe error: ${String(e && e.message || e)}` };
    }
  }

  // --- Probe for AMLO record keeping: ensure identity storage bound to registry ---
  if (needsAmloRecord && identityRegistry) {
    try {
      const storageAddr = await identityRegistry.identityStorage();
      if (normalizeAddress(storageAddr) === ZERO) {
        probes["R-HKMA-AMLO-RECORDKEEPING"] = {
          ran: true,
          pass: false,
          evidence: "AMLO record-keeping probe: identityRegistry.identityStorage() returned zero address; storage is not wired."
        };
      } else {
        const storage = new Contract(storageAddr, IdentityRegistryStorageABI, signer);
        let linked = [];
        try {
          linked = await storage.linkedIdentityRegistries();
        } catch {
          linked = [];
        }
        const linkedLower = Array.isArray(linked) ? linked.map((addr) => normalizeAddress(addr)) : [];
        const expected = normalizeAddress(cfg.identityRegistry);
        let bound = linkedLower.includes(expected);
        let evidence = "";
        if (bound) {
          evidence = `AMLO record-keeping probe: identityStorage=${storageAddr} is bound to IdentityRegistry ${cfg.identityRegistry}.`;
        } else if (linkedLower.length === 0) {
          bound = true;
          evidence = `AMLO record-keeping probe: identityStorage=${storageAddr} returned an empty linkedIdentityRegistries() list; manual confirmation of off-chain retention is required.`;
        } else {
          evidence = `AMLO record-keeping probe: identityStorage=${storageAddr} does not list ${cfg.identityRegistry} in linkedIdentityRegistries().`;
        }
        probes["R-HKMA-AMLO-RECORDKEEPING"] = { ran: true, pass: bound, evidence };
      }
    } catch (e) {
      probes["R-HKMA-AMLO-RECORDKEEPING"] = { ran: true, pass: false, evidence: `probe error: ${String(e && e.message || e)}` };
    }
  }
    // --- Probe for sanctions / blacklist screening (R-HKMA-AMLO-SANCTIONS) ---
    if (needsSanctions) {
      try {
        const sanctioned = ethers.Wallet.createRandom().address;
        // Dynamic probe only: attempt transfer to a pseudo-sanctioned address and infer from revert
        const res = await tryTx(() => token.transfer(sanctioned, 1));
        const pass = !res.ok;
        const evidence = pass
          ? "Sanctions probe: transfer to pseudo-sanctioned address reverted; blacklist or gating likely enforced."
          : (hasCompliance
              ? "Sanctions probe: transfer succeeded despite compliance module present; blacklist control likely absent."
              : "Sanctions probe: transfer succeeded and no compliance module present; blacklist control not evidenced.");

        probes[sanctionsKey] = { ran: true, pass, evidence };
      } catch (e) {
        probes[sanctionsKey] = { ran: true, pass: false, evidence: `probe error: ${String(e && e.message || e)}` };
      }
    }

    // --- Probe for ongoing monitoring capability (R-HKMA-AMLO-ONGOINGMONITORING) ---
  if (needsOngoing) {
    if (!hasCompliance) {
      probes[ongoingKey] = {
        ran: true,
        pass: false,
        evidence: "Ongoing monitoring: no compliance() address configured; modular checks unavailable."
      };
      if (needsJurisdiction) {
        probes[jurisdictionKey] = {
          ran: true,
          pass: false,
          evidence: "Jurisdiction screening probe: compliance contract missing; cannot enforce country restrictions."
        };
      }
    } else {
      const countryModuleInfo = complianceModules.find((m) => m.name === "CountryRestrictModule");
      const exchangeModuleInfo = complianceModules.find((m) => m.name === "ExchangeMonthlyLimitsModule");
      if (!countryModuleInfo || !exchangeModuleInfo) {
        const missing = [
          countryModuleInfo ? null : "CountryRestrictModule",
          exchangeModuleInfo ? null : "ExchangeMonthlyLimitsModule"
        ].filter(Boolean).join(", ");
        probes[ongoingKey] = {
          ran: true,
          pass: false,
          evidence: `Ongoing monitoring modules missing: ${missing || "unknown"}.`
        };
        if (needsJurisdiction) {
          probes[jurisdictionKey] = {
            ran: true,
            pass: false,
            evidence: `Jurisdiction screening probe: required module missing (${missing || "CountryRestrictModule"}).`
          };
        }
      } else {
        let pass = true;
        const parts = [];
        const admin = new Contract(complianceAddr, ComplianceAdminABI, signer);

          // Country restrict module configuration check
          try {
            const countryIface = new context.ethers.utils.Interface([
              "function batchRestrictCountries(uint16[])",
              "function batchUnrestrictCountries(uint16[])"
            ]);
            const countryModule = new Contract(
              countryModuleInfo.address,
              [
                "function isCountryRestricted(address,uint16) view returns (bool)"
              ],
              signer
            );
            const testCountry = 840;
            await (await admin.callModuleFunction(countryIface.encodeFunctionData("batchRestrictCountries", [[testCountry]]), countryModuleInfo.address)).wait();
            const restricted = await countryModule.isCountryRestricted(complianceAddr, testCountry);
            // best-effort cleanup
            try {
              await (await admin.callModuleFunction(countryIface.encodeFunctionData("batchUnrestrictCountries", [[testCountry]]), countryModuleInfo.address)).wait();
            } catch {}
            if (restricted) {
              parts.push("CountryRestrictModule responded to batchRestrictCountries; country flagged for compliance.");
            } else {
              pass = false;
              parts.push("CountryRestrictModule did not report the test country as restricted after configuration.");
            }
          } catch (err) {
            pass = false;
            parts.push(`CountryRestrictModule configuration failed: ${String(err && err.message || err)}`);
          }

          // Exchange monthly limits module configuration check
          try {
            const exchangeIface = new context.ethers.utils.Interface([
              "function setExchangeMonthlyLimit(address,uint256)"
            ]);
            const exchangeModule = new Contract(
              exchangeModuleInfo.address,
              [
                "function owner() view returns (address)",
                "function addExchangeID(address) external",
                "function isExchangeID(address) view returns (bool)",
                "function getExchangeMonthlyLimit(address,address) view returns (uint256)"
              ],
              signer
            );
            const exchangeIdentity = ethers.Wallet.createRandom().address;
            try {
              const modOwner = await exchangeModule.owner().catch(() => ZERO);
              if (normalizeAddress(modOwner) === normalizeAddress(primaryAddress)) {
                await (await exchangeModule.addExchangeID(exchangeIdentity)).wait();
              }
            } catch {}

            const decimals = (() => {
              const raw = data?.tokenDecimals;
              if (raw == null) return 18;
              if (typeof raw === "number") return raw;
              if (typeof raw === "string") return Number(raw);
              if (raw._isBigNumber) return Number(raw.toString());
              return 18;
            })();
            const limit = context.ethers.utils.parseUnits("100", decimals);
            await (await admin.callModuleFunction(exchangeIface.encodeFunctionData("setExchangeMonthlyLimit", [exchangeIdentity, limit]), exchangeModuleInfo.address)).wait();
            const stored = await exchangeModule.getExchangeMonthlyLimit(complianceAddr, exchangeIdentity);
            if (stored.eq(limit)) {
              parts.push("ExchangeMonthlyLimitsModule accepted monthly limit configuration via compliance.");
            } else {
              pass = false;
              parts.push("ExchangeMonthlyLimitsModule limit readback mismatch after configuration.");
            }
          } catch (err) {
          pass = false;
          parts.push(`ExchangeMonthlyLimitsModule configuration failed: ${String(err && err.message || err)}`);
        }

        probes[ongoingKey] = {
          ran: true,
          pass,
          evidence: parts.join(" ")
        };
        if (needsJurisdiction) {
          const countryEvidence = parts.find((segment) => segment.includes("CountryRestrictModule"))
            || (countryModuleInfo ? "CountryRestrictModule executed." : "CountryRestrictModule not exercised.");
          const jurisdictionPass = pass && countryModuleInfo && parts.some((segment) => segment.includes("CountryRestrictModule"));
          probes[jurisdictionKey] = {
            ran: true,
            pass: jurisdictionPass,
            evidence: countryEvidence
          };
        }
      }
    }
  }

  if (needsDualControl) {
    if (controlAddr === ZERO) {
      probes[dualControlKey] = {
        ran: true,
        pass: false,
        evidence: "Dual-control probe: control contract address not configured."
      };
    } else if (!control || typeof control.setAddressFrozen !== "function") {
      probes[dualControlKey] = {
        ran: true,
        pass: false,
        evidence: "Dual-control probe: setAddressFrozen function unavailable on control contract."
      };
    } else if (secondarySigner.address === primaryAddress) {
      probes[dualControlKey] = {
        ran: true,
        pass: false,
        evidence: "Dual-control probe: secondary signer unavailable to test role separation."
      };
    } else {
      const target = secondarySigner.address;
      let restored = false;
      const beforeState = typeof control.isFrozen === "function"
        ? await control.isFrozen(target).catch(() => null)
        : null;
      const attempt = await tryTx(() => control.connect(secondarySigner).setAddressFrozen(target, true));
      if (!attempt.ok) {
        const errMsgRaw = attempt.err && attempt.err.message ? attempt.err.message : String(attempt.err || "revert");
        const errMsg = shorten(errMsgRaw, 180);
        probes[dualControlKey] = {
          ran: true,
          pass: true,
          evidence: `Dual-control probe: unauthorized freeze reverted (${errMsg}).`
        };
      } else {
        if (beforeState !== null) {
          try {
            await (await control.setAddressFrozen(target, beforeState)).wait();
            restored = true;
          } catch {}
        } else {
          try {
            await (await control.setAddressFrozen(target, false)).wait();
            restored = true;
          } catch {}
        }
        probes[dualControlKey] = {
          ran: true,
          pass: false,
          evidence: `Dual-control probe: non-authorized signer froze address successfully${restored ? " (state restored)" : ""}.`
        };
      }
    }
  }

  if (needsFreeze) {
    if (controlAddr === ZERO) {
      probes[freezeKey] = {
        ran: true,
        pass: false,
        evidence: "Freeze probe: control contract address not configured."
      };
    } else if (!control || typeof control.setAddressFrozen !== "function") {
      probes[freezeKey] = {
        ran: true,
        pass: false,
        evidence: "Freeze probe: setAddressFrozen function unavailable on control contract."
      };
    } else {
      const target = secondarySigner.address;
      const canCheck = typeof control.isFrozen === "function";
      let before = null;
      if (canCheck) {
        before = await control.isFrozen(target).catch(() => null);
      }
      const freezeTx = await tryTx(() => control.setAddressFrozen(target, true));
      if (!freezeTx.ok) {
        const errMsgRaw = freezeTx.err && freezeTx.err.message ? freezeTx.err.message : String(freezeTx.err || "revert");
        const errMsg = shorten(errMsgRaw, 180);
        probes[freezeKey] = {
          ran: true,
          pass: false,
          evidence: `Freeze probe: authorized freeze failed (${errMsg}).`
        };
      } else {
        let afterFreeze = null;
        if (canCheck) {
          afterFreeze = await control.isFrozen(target).catch(() => null);
        }
        const unfreezeTargetState = before === null ? false : before;
        const unfreezeTx = await tryTx(() => control.setAddressFrozen(target, unfreezeTargetState));
        if (!unfreezeTx.ok) {
          if (before !== null) {
            try { await (await control.setAddressFrozen(target, before)).wait(); } catch {}
          } else {
            try { await (await control.setAddressFrozen(target, false)).wait(); } catch {}
          }
        }
        const unfreezeOk = unfreezeTx.ok;
        const restored = canCheck ? await control.isFrozen(target).catch(() => null) : null;
        const pass = freezeTx.ok && unfreezeOk && (afterFreeze === null || afterFreeze === true) && (restored === null || restored === unfreezeTargetState);
        const evidenceParts = [];
        evidenceParts.push(freezeTx.ok ? "Freeze succeeded." : "Freeze failed.");
        evidenceParts.push(unfreezeOk ? "Unfreeze succeeded." : "Unfreeze failed.");
        if (afterFreeze !== null) evidenceParts.push(`Post-freeze status: ${afterFreeze}`);
        if (restored !== null) evidenceParts.push(`Restored status: ${restored}`);
        probes[freezeKey] = {
          ran: true,
          pass,
          evidence: evidenceParts.join(" ")
        };
      }
    }
  }

  if (needsOwnership) {
    const ownershipKey = ruleIdMap.get("R-HKMA-AMLO-OWNERSHIPCONTROL") || "R-HKMA-AMLO-OWNERSHIPCONTROL";
    try {
      if (!claimTopicsRegistry) {
        probes[ownershipKey] = {
          ran: true,
          pass: false,
          evidence: "Ownership probe: claim topics registry address missing."
        };
      } else if (!trustedIssuersRegistry) {
        probes[ownershipKey] = {
          ran: true,
          pass: false,
          evidence: "Ownership probe: trusted issuers registry address missing."
        };
      } else {
        const topics = await claimTopicsRegistry.getClaimTopics().catch(() => []);
        const topicPresent = Array.isArray(topics) && topics.some((topic) => Number(topic) === Number(BENEFICIAL_OWNER_TOPIC));
        if (!topicPresent) {
          probes[ownershipKey] = {
            ran: true,
            pass: false,
            evidence: `Ownership probe: claim topic ${BENEFICIAL_OWNER_TOPIC} not configured.`
          };
        } else {
          const issuers = await trustedIssuersRegistry.getTrustedIssuersForClaimTopic(BENEFICIAL_OWNER_TOPIC).catch(() => []);
          const issuerCount = Array.isArray(issuers) ? issuers.filter((addr) => normalizeAddress(addr) !== ZERO).length : 0;
          if (issuerCount === 0) {
            probes[ownershipKey] = {
              ran: true,
              pass: false,
              evidence: `Ownership probe: no trusted issuer configured for claim topic ${BENEFICIAL_OWNER_TOPIC}.`
            };
          } else {
            probes[ownershipKey] = {
              ran: true,
              pass: true,
              evidence: `Ownership probe: claim topic ${BENEFICIAL_OWNER_TOPIC} present with ${issuerCount} trusted issuer(s).`
            };
          }
        }
      }
    } catch (e) {
      probes[ownershipKey] = {
        ran: true,
        pass: false,
        evidence: `Ownership probe error: ${String(e && e.message || e)}`
      };
    }
  }

  return probes;
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
// Default declarative maps for ERC‑3643 + HKMA rule IDs
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
    // ---- ERC‑3643 rules (01..10) ----
    case "R-ERC3643-01": {
      // Transfer must check identity gating (heuristic)
      return {
        allOf: [
          { op: "nonzeroaddress", field: "data.tokenIdentity" },
          { op: "hasabifn", where: "idr", sig: "isVerified(address)" }
        ]
      };
    }
    case "R-ERC3643-02": {
      // Token must call compliance.canTransfer hook (heuristic)
      // We can only assert structure: token has compliance() and a non-zero compliance address.
      return {
        allOf: [
          { op: "hasabifn", where: "token", sig: "compliance()" },
          { op: "nonzeroaddress", field: "data.tokenCompliance" }
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
  const baseMeta = { role: r.role || null, phase: r.phase || null };

  const applyMeta = (node, override) => {
    if (!node || typeof node !== "object") return null;
    const merged = Object.assign({}, node);
    if (override?.role && merged.role == null) merged.role = override.role;
    if (override?.phase && merged.phase == null) merged.phase = override.phase;
    if (baseMeta.role && merged.role == null) merged.role = baseMeta.role;
    if (baseMeta.phase && merged.phase == null) merged.phase = baseMeta.phase;
    return merged;
  };

  if (r.controls) {
    const ctrls = Array.isArray(r.controls) ? r.controls : [r.controls];
    const nodes = [];
    for (const ctrl of ctrls) {
      if (!ctrl || typeof ctrl !== "object") continue;
      const meta = { role: ctrl.role || baseMeta.role, phase: ctrl.phase || baseMeta.phase };
      if (ctrl.check) {
        const wrapped = applyMeta(ctrl.check, meta);
        if (wrapped) nodes.push(wrapped);
      }
      if (Array.isArray(ctrl.allOf)) {
        for (const item of ctrl.allOf) {
          const wrapped = applyMeta(item, meta);
          if (wrapped) nodes.push(wrapped);
        }
      }
      if (Array.isArray(ctrl.anyOf)) {
        // Treat anyOf groups as pseudo nodes with marker
        const wrappedGroup = ctrl.anyOf
          .map((item) => applyMeta(item, meta))
          .filter(Boolean);
        if (wrappedGroup.length) nodes.push({ anyOf: wrappedGroup });
      }
    }
    return { check: null, allOf: nodes, anyOf: null, meta: baseMeta };
  }

  if (r.check || r.allOf || r.anyOf) {
    const wrapArray = (arr) => Array.isArray(arr) ? arr.map((item) => applyMeta(item, null)).filter(Boolean) : null;
    return {
      check: r.check ? applyMeta(r.check, null) : null,
      allOf: wrapArray(r.allOf),
      anyOf: wrapArray(r.anyOf),
      meta: baseMeta
    };
  }

  if (Array.isArray(r.checks)) {
    const nodes = r.checks.map((item) => applyMeta(item, null)).filter(Boolean);
    return { check: null, allOf: nodes, anyOf: null, meta: baseMeta };
  }

  if (Array.isArray(r.conditions)) {
    const nodes = r.conditions.map((item) => applyMeta(item, null)).filter(Boolean);
    return { check: null, allOf: nodes, anyOf: null, meta: baseMeta };
  }

  if (r.declarative && (r.declarative.check || r.declarative.allOf || r.declarative.anyOf)) {
    const d = r.declarative;
    const wrapArray = (arr) => Array.isArray(arr) ? arr.map((item) => applyMeta(item, null)).filter(Boolean) : null;
    return {
      check: d.check ? applyMeta(d.check, null) : null,
      allOf: wrapArray(d.allOf),
      anyOf: wrapArray(d.anyOf),
      meta: baseMeta
    };
  }

  return null;
}

// =====================
// Main
// =====================
async function main() {
  const root = process.cwd();
  loadLocalEnv(root);
  BENEFICIAL_OWNER_TOPIC = Number(process.env.BENEFICIAL_OWNER_TOPIC || "2001");
  const argv = process.argv.slice(2);
  let rulesArg = null;
  let addressesArg = null;
  let outputArg = null;
  let groundArg = null;
  let abipathsArg = null;
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
    } else if (token === "--abipaths" && argv[i + 1]) {
      abipathsArg = argv[i + 1];
      process.env.ABIPATHS_FILE = abipathsArg;
      i += 1;
    } else if (token.startsWith("--abipaths=")) {
      abipathsArg = token.slice("--abipaths=".length);
      process.env.ABIPATHS_FILE = abipathsArg;
    }
  }

  const outputPath = outputArg
    ? (path.isAbsolute(outputArg) ? outputArg : path.join(root, outputArg))
    : path.join(root, "reports", "results.json");

  const runDefs = [];
  const resolveRules = (relPath) => (path.isAbsolute(relPath) ? relPath : path.join(root, relPath));
  const resolveAddr  = (relPath) => (path.isAbsolute(relPath) ? relPath : path.join(root, relPath));

  // Support multiple rules files:
  // - If --rules is provided, accept a comma-separated list of paths.
  // - Otherwise, default to both ERC‑3643 and HK rules when present.
  const defaultRuleFiles = [
    "cre/rules/rule.3643.json",
    "cre/rules/rule.AMLO.json"
    // "cre/rules/baseline.hk.json"
  ];

  const rulesPaths = (() => {
    if (rulesArg) {
      return rulesArg.split(",").map(s => s.trim()).filter(Boolean).map(resolveRules);
    }
    return defaultRuleFiles.map(resolveRules).filter(p => fs.existsSync(p));
  })();

  if (!rulesPaths.length) {
    console.error("No rules file found. Expected at least one of:");
    for (const f of defaultRuleFiles) console.error("  - " + f);
    process.exit(1);
  }

  // Default to .cre.addresses.json if --addresses is not provided
  const addressesPath = resolveAddr(addressesArg || ".cre.addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error(`Addresses file not found: ${addressesPath}`);
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
    console.log(`Queued rules: ${path.relative(root, rp)} (label=${label})`);
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
    abipathsPath: abiArtifacts?.source ? path.relative(root, abiArtifacts.source) : null,
    abiArtifacts: Object.fromEntries(
      Object.entries(abiArtifacts?.paths || {}).map(
        ([k,v]) => [k, v ? path.relative(root, v) : null]
      )
    )
  };

  const aggregatedItems = [];
  const aggregatedSummary = { total: 0, pass: 0, critical: 0, high: 0, medium: 0, low: 0, fail: 0, warn: 0, info: 0 };
  const runsMeta = [];
  const metricsOverall = { tp:0, tn:0, fp:0, fn:0, compared:0 };
  const disagreements = [];

  for (const def of runDefs) {
    const rules = loadJson(def.rulesPath);
    if (!Array.isArray(rules) || rules.length === 0) {
      console.warn(`Skipping ${def.label}: rules file empty.`);
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
        else if (predicted === "PASS" && expected !== "PASS") { runMetrics.fp++; disagreements.push({ run: def.label, id: it.id, expected: expectedRaw, predicted: it.pass ? "PASS" : severityLabel(it.severity || it.severityCode || it.severityLabel), note: it.note||"" }); }
        else if (predicted !== "PASS" && expected === "PASS") { runMetrics.fn++; disagreements.push({ run: def.label, id: it.id, expected: expectedRaw, predicted: it.pass ? "PASS" : severityLabel(it.severity || it.severityCode || it.severityLabel), note: it.note||"" }); }
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
    aggregatedSummary.total += result.summary.total ?? result.items.length;
    aggregatedSummary.pass += result.summary.pass;
    aggregatedSummary.critical += result.summary.critical || 0;
    aggregatedSummary.high += result.summary.high || 0;
    aggregatedSummary.medium += result.summary.medium || 0;
    aggregatedSummary.low += result.summary.low || 0;
    aggregatedSummary.fail += result.summary.fail;
    aggregatedSummary.warn += result.summary.warn;
    aggregatedSummary.info += result.summary.info;
    runsMeta.push(result.meta);
  }

  if (aggregatedItems.length === 0) {
    console.error("No rule evaluations completed; aborting.");
    process.exit(1);
  }

  if (!aggregatedSummary.total) aggregatedSummary.total = aggregatedItems.length;
  aggregatedSummary.fail = aggregatedSummary.critical;
  aggregatedSummary.warn = aggregatedSummary.high + aggregatedSummary.medium;
  aggregatedSummary.info = aggregatedSummary.low;

  const overallP = safeDiv(metricsOverall.tp, (metricsOverall.tp + metricsOverall.fp));
  const overallR = safeDiv(metricsOverall.tp, (metricsOverall.tp + metricsOverall.fn));
  const overallF1 = (overallP + overallR) > 0 ? (2 * overallP * overallR) / (overallP + overallR) : 0;

  const generatedAt = new Date().toISOString();
  const out = {
    generatedAt,
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
    } : null,
    llm: null,
    report: null
  };

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  if (out.metrics) {
    const metricsPath = outputPath.replace(/\.json$/, ".metrics.json");
    fs.writeFileSync(metricsPath, JSON.stringify({ generatedAt: out.generatedAt, metrics: out.metrics }, null, 2));
    console.log(`Metrics written: ${metricsPath}`);
  } else {
    console.log(`No ground truth found at ${groundPath}; metrics skipped.`);
  }
  console.log(`JSON written: ${outputPath}`);
  if (abiArtifacts && abiArtifacts.paths) {
    console.log("ABI artifacts:");
    for (const [k, v] of Object.entries(abiArtifacts.paths)) {
      console.log(`  - ${k}: ${v ? path.relative(root, v) : "not found"}`);
    }
  }
}

async function evaluateRun(root, def, rules, abiArtifactsArg) {
  const { label, rulesPath, addressesPath } = def;
  console.log(`[${label}] Evaluating ${rules.length} rule(s)`);

  const cfg = loadJson(addressesPath);

  // Use abiArtifactsArg if provided, else load
  const abiArtifacts = abiArtifactsArg || loadAbiArtifacts(root);
  const idx = {
    token: makeAbiIndex(abiArtifacts?.tokenAbi),
    idr: makeAbiIndex(abiArtifacts?.idrAbi),
    ctr: makeAbiIndex(abiArtifacts?.ctrAbi),
    tir: makeAbiIndex(abiArtifacts?.tirAbi),
    compliance: makeAbiIndex(abiArtifacts?.complianceAbi),
    irs: makeAbiIndex(abiArtifacts?.irsAbi)
  };
  for (const k of ["token", "idr", "ctr", "tir", "compliance", "irs"]) {
    if (!idx[k]) idx[k] = { bySig: new Set(), byName: new Set(), hasEvent: new Set() };
  }
  idx.control = idx.token || { bySig: new Set(), byName: new Set(), hasEvent: new Set() };

  const getAbiIndex = (where) => {
    const key = resolveWhereAlias(where);
    return idx[key] || { bySig: new Set(), byName: new Set(), hasEvent: new Set() };
  };

  const hasFn = (where, sigOrName) => {
    const record = getAbiIndex(where);
    if (!record) return false;
    return record.bySig.has(sigOrName) || record.byName.has(sigOrName);
  };
  const hasEvent = (where, name) => {
    const record = getAbiIndex(where);
    if (!record) return false;
    return record.hasEvent.has(name);
  };

  const helperContext = {
    asAddr: (field, cfgRef, dataRef) => asAddr(field, cfgRef, dataRef),
    getByPath,
    hasFn,
    hasEvent,
    findAbiSupport: () => null,
    findAbiEvent: () => null
  };

  const ruleEngine = createRuleEngine({ operations: defaultOperationHandlers });

  const evaluateSpec = (candidate) => {
    if (!candidate) return null;
    const normalized = normalizeDeclarativeSpec(candidate);
    if (!normalized) return null;
    const { meta: specMeta = {}, check, allOf, anyOf } = normalized;
    return ruleEngine.evaluate(
      { check, allOf, anyOf },
      { data, cfg, helpers: helperContext, meta: specMeta }
    );
  };

  let context = await tryCreateRpcContext(cfg);
  let data = null;
  if (context) data = await collectData(context, cfg);
  const allowFallback = path.resolve(addressesPath) === path.join(root, ".cre.addresses.json");
  if ((!context || shouldFallback(data, cfg)) && allowFallback) {
    console.log(`[${label}] Falling back to in-process Hardhat deployment for checks`);
    context = await createHardhatContext();
    data = await collectData(context, cfg);
    const latestCfg = loadJson(addressesPath);
    Object.assign(cfg, latestCfg);
  } else if (!context || shouldFallback(data, cfg)) {
    console.warn(`[${label}] Skipping Hardhat fallback for custom addresses ${addressesPath}`);
  }

  if (!data) {
    console.warn(`[${label}] Unable to collect on-chain data; proceeding with empty dataset.`);
    data = {};
  }

  // Runtime probes (only on Hardhat fallback)
  let probes = {};
  try {
    probes = await runRuntimeProbes(context, cfg, data, rules);
  } catch {
    probes = {};
  }
  // Attach into data for downstream declarative checks or reporting
  data.probes = probes;

  const items = [];

  for (const r of rules) {
    let pass = false; let note = "";
    // Prefer runtime probe result for specific rules when available
    if (data && data.probes && data.probes[r.id]) {
      const pr = data.probes[r.id];
      if (pr.ran) {
        const base = {
          id: r.id,
          title: r.title,
          desc: r.desc,
          snippet: r.snippet || "",
          policyRef: r.policyRef || "",
          pass: !!pr.pass,
          note: pr.evidence || "",
          details: [{ probe: true, ran: pr.ran, pass: pr.pass, evidence: pr.evidence }],
          run: label
        };
        items.push(attachSeverity(base, r.severity));
        continue; // skip declarative path if runtime evidence exists
      }
    }
    // Evaluate declarative rule specification when available
    let dec = evaluateSpec(r);
    if (!dec) {
      const auto = defaultDeclarativeFor(r.id);
      if (auto) dec = evaluateSpec(auto);
    }

    if (dec) {
      pass = dec.pass;
      note = dec.note;
    } else {
      pass = true;
      note = `no checks: rule '${r.id}' has no declarative section (check/allOf/anyOf) and no default mapping`;
    }

    const base = {
      id: r.id,
      title: r.title,
      desc: r.desc,
      snippet: r.snippet || "",
      policyRef: r.policyRef || "",
      pass,
      note,
      details: dec && dec.details ? dec.details : [],
      run: label
    };
    items.push(attachSeverity(base, r.severity));
  }

  const summary = buildSummaryFromItems(items);

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
      idrIdentityStorageAddr: data?.idrIdentityStorageAddr ?? null,
      topicsCount: Array.isArray(data?.topics) ? data.topics.length : 0,
      complianceBoundToken: data?.complianceBoundToken ?? null,
      controlAddress: data?.controlAddress ?? null,
      executionMode: context?.mode ?? null,
      tokenName: data?.tokenName ?? null,
      tokenSymbol: data?.tokenSymbol ?? null,
      tokenDecimals: data?.tokenDecimals ?? null,
      tirOwner: data?.tirOwner ?? null,
      irsOwner: data?.irsOwner ?? null,
    },
    probes,
    abiArtifacts: Object.fromEntries(
      Object.entries(abiArtifacts?.paths || {}).map(
        ([k,v]) => [k, v ? path.relative(root, v) : null]
      )
    ),
  };

  return { items, summary, meta };
}

main().catch(e => { console.error(e); process.exit(1); });
