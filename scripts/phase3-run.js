/* eslint-disable */
/**
 * Phase 3 cognitive compliance layer.
 * Combines deterministic Phase 2 outputs, ABI heuristics and HKMA/SFC policy data,
 * prompts an LLM for narrative reasoning, then normalises and stores the response
 * together with lightweight comparison metrics.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_ITEMS = 100;
const MAX_SURFACE = 80;
const HK_RULE_LIMIT = 80;
const GT_PATH = path.join(process.cwd(), "reports", "ground-truth.json"); // optional
const METRICS_OUT = path.join(process.cwd(), "reports", "phase3-metrics.json");
const CACHE_FILE = path.join(process.cwd(), ".cache", "phase3-cache.json");
const CACHE_SCHEMA_VERSION = "1.3";
const PER_CALL_DELAY_MS = Number(process.env.PHASE3_PER_CALL_DELAY_MS ?? 400);
const MAX_RETRIES = Number(process.env.PHASE3_MAX_RETRIES ?? 3);
const BASE_DELAY_MS = Number(process.env.PHASE3_BASE_DELAY_MS ?? 500);
const JITTER_MS = Number(process.env.PHASE3_JITTER_MS ?? 250);
// If you want the LLM to be allowed to downgrade PASS->FAIL, set PHASE3_ALLOW_DOWNGRADE=1 in .env.
// Otherwise, PASS verdicts from Phase 2 are preserved unless the LLM provides structured evidence.

function loadLocalEnv(root) {
  // Allow environment overrides via a local .env without leaking into the repo.
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key) continue;
      const value = line.slice(eq + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn("[phase3] Failed to parse .env:", err.message);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms) {
  if (JITTER_MS <= 0) return ms;
  return ms + Math.floor(Math.random() * JITTER_MS);
}

function loadCache() {
  // Cached responses keep reruns fast while tuning presentation.
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(obj) {
  // Persist cache atomically to avoid partial writes when interrupted.
  ensureDir(path.dirname(CACHE_FILE));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
}

function safeReadJson(p, label, optional = false) {
  if (!fs.existsSync(p)) {
    if (!optional) console.warn(`[phase3] ${label} not found at ${p}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    console.warn(`[phase3] Failed to parse ${label}:`, err.message);
    return null;
  }
}

function extractSurface(abi) {
  // Collapse full ABIs to a concise prompt-friendly signature list.
  const result = { functions: [], events: [] };
  if (!Array.isArray(abi)) return result;
  for (const entry of abi) {
    if (entry && entry.type === "function") {
      const inputs = Array.isArray(entry.inputs) ? entry.inputs.map(i => i.type || "*").join(",") : "";
      const signature = `${entry.name || "unknown"}(${inputs})`;
      if (result.functions.length < MAX_SURFACE) result.functions.push(signature);
    } else if (entry && entry.type === "event") {
      if (result.events.length < MAX_SURFACE) result.events.push(entry.name || "unknown");
    }
    if (result.functions.length >= MAX_SURFACE && result.events.length >= MAX_SURFACE) break;
  }
  return result;
}

function excerpt(source, needles, ctx = 80) {
  // Grab a small snippet around the first matching needle to show in reports.
  if (!source) return "";
  const lower = source.toLowerCase();
  for (const n of needles) {
    if (!n) continue;
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) {
      const start = Math.max(0, i - ctx);
      const end = Math.min(source.length, i + n.length + ctx);
      return source.slice(start, end).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function tryLoadSource(artifactPath, artifact) {
  // Hardhat artifacts reference relative Solidity paths – resolve a handful of likely locations.
  if (!artifact) return null;
  try {
    const rel = artifact.sourceName;
    if (!rel || typeof rel !== "string") return null;
    const candidates = [
      path.join(process.cwd(), rel),
      path.join(path.dirname(artifactPath), "..", "..", rel),
      path.join(path.dirname(artifactPath), "..", rel),
    ];
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return { filename: rel, content: fs.readFileSync(resolved, "utf8") };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function computeFacts(contract, artifactPath) {
  // Lightweight static heuristics to provide richer context to the LLM.
  const fallback = {
    abiFunctions: [],
    hasTransferGate: false,
    bypassCandidates: [],
    sourceHints: [],
  };
  try {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abi = Array.isArray(artifact?.abi) ? artifact.abi : [];
    const abiFunctions = abi
      .filter((e) => e && e.type === "function" && e.name)
      .map((e) => e.name);

    const src = tryLoadSource(artifactPath, artifact);
    const srcText = src?.content ?? "";

    const transferNeedles = ["function transfer(", "function transferFrom("];
    const guardNeedles = ["identityregistry", "trustedissuers", "claimtopics", "compliance", "kyc", "aml"];
    const transferExcerpt = excerpt(srcText, transferNeedles, 160);
    const guardExcerpt = excerpt(srcText, guardNeedles, 160);
    const hasTransferGate = Boolean(transferExcerpt && guardExcerpt);

    const bypassNames = abiFunctions.filter((name) =>
      /white|allow|kyc|whitelist|allowlist|approveinvestor|authorize/i.test(name)
    );
    const transferBlock = excerpt(srcText, ["function transfer(", "function transferFrom("], 320);
    const bypassCandidates = bypassNames.filter((name) => !transferBlock.toLowerCase().includes(name.toLowerCase()));

    const sourceHints = [];
    if (transferExcerpt) sourceHints.push({ filename: src?.filename ?? contract, excerpt: transferExcerpt });
    if (guardExcerpt) sourceHints.push({ filename: src?.filename ?? contract, excerpt: guardExcerpt });

    return { abiFunctions, hasTransferGate, bypassCandidates, sourceHints };
  } catch {
    return fallback;
  }
}

function loadAbiDetails(root) {
  // Surfaces + facts feed the prompt even when the caller tweaks abipaths.json.
  const abipathsPath = path.join(root, "abipaths.json");
  const surfaces = {
    Token: { functions: [], events: [] },
    IdentityRegistry: { functions: [], events: [] },
    ClaimTopicsRegistry: { functions: [], events: [] },
    TrustedIssuersRegistry: { functions: [], events: [] },
  };
  const facts = {};

  const map = safeReadJson(abipathsPath, "abipaths.json", true);
  if (!map || typeof map !== "object") {
    console.warn("[phase3] abipaths.json missing or empty; ABI surfaces will be blank.");
    return { surfaces, facts };
  }
  for (const key of Object.keys(surfaces)) {
    const rel = map[key] || map[key.toLowerCase()] || map[key.toUpperCase()];
    if (!rel) continue;
    const filePath = path.isAbsolute(rel) ? rel : path.join(root, rel);
    const artifact = safeReadJson(filePath, `${key} ABI`, true);
    if (artifact && Array.isArray(artifact.abi)) {
      surfaces[key] = extractSurface(artifact.abi);
      facts[key] = computeFacts(key, filePath);
    } else {
      console.warn(`[phase3] No ABI array found for ${key} at ${filePath}`);
    }
  }
  return { surfaces, facts };
}

function buildPhase2Context(phase2) {
  // Trim Phase 2 payload to stay within the LLM context window.
  if (!phase2 || typeof phase2 !== "object") {
    return {
      summary: { pass: 0, fail: 0, warn: 0, info: 0 },
      items: [],
    };
  }
  const summary = phase2.summary && typeof phase2.summary === "object"
    ? {
        pass: Number(phase2.summary.pass) || 0,
        fail: Number(phase2.summary.fail) || 0,
        warn: Number(phase2.summary.warn) || 0,
        info: Number(phase2.summary.info) || 0,
      }
    : { pass: 0, fail: 0, warn: 0, info: 0 };

  const items = Array.isArray(phase2.items) ? phase2.items.slice(0, MAX_ITEMS).map((it) => ({
    id: it.id || "",
    title: it.title || "",
    severity: it.severity || "",
    pass: Boolean(it.pass),
    note: it.note || "",
  })) : [];

  return { summary, items };
}

function buildRulesContext(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.slice(0, HK_RULE_LIMIT).map((r) => ({
    id: r.id || "",
    title: r.title || "",
    desc: r.desc || r.description || "",
  }));
}

function loadPolicyDocs(root) {
  const policyPath = path.join(root, "policies", "hk_sfc.json");
  const data = safeReadJson(policyPath, "HK policy snippets", true);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray(data.docs)) return data.docs;
  return [];
}

function derivePolicyRefs(ruleId, currentRefs) {
  // Normalise whatever the LLM supplied without adding additional links.
  const refs = new Map();
  const add = (ref) => {
    if (!ref) return;
    let obj = null;
    if (typeof ref === "object" && (ref.url || ref.label)) {
      const label = String(ref.label || ref.url || "").trim();
      const url = ref.url ? String(ref.url).trim() : null;
      if (!label && !url) return;
      if (!url && label === ruleId) return;
      obj = { label: label || url, url };
    } else {
      const str = String(ref).trim();
      if (!str || str === ruleId) return;
      if (str.includes("http")) {
        const [labelPart, urlPart] = str.split(/\s*\|\s*/);
        if (urlPart) obj = { label: labelPart || urlPart, url: urlPart };
        else obj = { label: str, url: str };
      } else {
        if (str === ruleId) return;
        obj = { label: str, url: null };
      }
    }
    if (!obj) return;
    const key = `${obj.label}||${obj.url || ""}`;
    refs.set(key, obj);
  };

  if (Array.isArray(currentRefs)) currentRefs.forEach(add);

  return Array.from(refs.values());
}

function normalizePosition(rawPosition, fallback) {
  const val = String(rawPosition || fallback || "").trim().toUpperCase();
  if (val === "SUPPORT" || val === "CHALLENGE" || val === "EXTEND") return val;
  if (val === "PASS") return "SUPPORT";
  if (val === "FAIL") return "CHALLENGE";
  if (val === "WARN" || val === "INFO") return "EXTEND";
  return fallback || "EXTEND";
}

function normalizePolicyRefs(raw) {
  // Accept either strings, URL pipes, or {label,url} objects from the LLM / policy map.
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const result = [];
  for (const entry of arr) {
    if (!entry) continue;
    if (typeof entry === "object" && (entry.url || entry.label)) {
      const label = String(entry.label || entry.url || "").trim();
      const url = entry.url ? String(entry.url).trim() : null;
      if (label || url) result.push({ label: label || url, url });
      continue;
    }
    const str = String(entry).trim();
    if (!str) continue;
    if (str.includes("http")) {
      const [labelPart, urlPart] = str.split(/\s*\|\s*/);
      if (urlPart) {
        result.push({ label: labelPart || urlPart, url: urlPart });
      } else {
        result.push({ label: str, url: str });
      }
    } else {
      result.push({ label: str, url: null });
    }
  }
  return result;
}

function normalizeSuggested(rawSuggested, phase2Item) {
  if (rawSuggested) {
    const upper = String(rawSuggested).trim().toUpperCase();
    if (["PASS", "FAIL", "WARN", "INFO"].includes(upper)) return upper;
  }
  if (phase2Item) {
    if (phase2Item.pass === true) return "PASS";
    const sev = String(phase2Item.severity || "").toUpperCase();
    if (["FAIL", "WARN", "INFO", "PASS"].includes(sev)) return sev;
  }
  return "WARN";
}

function normalizeLlmContent(raw, input, policyDocs = []) {
  const normalized = {
    model: raw?.model,
    result: {
      overall_summary: raw?.result?.overall_summary || raw?.overall_summary || raw?.summary || "",
      items: [],
    },
  };

  const phase2Map = new Map();
  if (input?.phase2?.items) {
    for (const item of input.phase2.items) {
      if (item?.id) phase2Map.set(item.id, item);
    }
  }

  const collected = [];
  const pushCandidate = (item, fallbackPosition) => {
    // Normalise a single rule item, whether it came from result.items or a legacy array.
    if (!item) return;
    const id = item.id || item.ruleId || item.rule || item.rule_id;
    if (!id) return;
    const phase2Item = phase2Map.get(id);
    const position = normalizePosition(item.position || item.verdict || item.outcome, fallbackPosition || item.position || "EXTEND");
    const explanation = String(item.explanation || item.reasoning || item.note || item.detail || "").trim();
    const policyRefs = derivePolicyRefs(id, normalizePolicyRefs(item.policy_refs || item.policyRefs || item.reference));
    const suggested = normalizeSuggested(item.suggested_verdict || item.suggestedVerdict || item.recommended || item.verdict, phase2Item);
    const severity = item.severity ?? (phase2Item ? phase2Item.severity : "");
    const base = {
      id,
      position,
      explanation,
      policy_refs: policyRefs,
      suggested_verdict: suggested,
      severity,
    };
    if (item.note) base.note = String(item.note);
    if (item.comment) base.comment = String(item.comment);
    // carry optional structured fields used for stricter PASS->FAIL gating
    if (item.evidence && typeof item.evidence === "object") base.evidence = item.evidence;
    if (item.confidence !== undefined) {
      const c = Number(item.confidence);
      if (!Number.isNaN(c)) base.confidence = c;
    }
    collected.push(base);
  };

  if (Array.isArray(raw?.result?.items)) {
    for (const item of raw.result.items) pushCandidate(item, item?.position);
  }

  const maybeArrays = [
    { arr: raw?.items, fallbackPosition: null },
    { arr: raw?.support, fallbackPosition: "SUPPORT" },
    { arr: raw?.challenge, fallbackPosition: "CHALLENGE" },
    { arr: raw?.extend, fallbackPosition: "EXTEND" },
    { arr: raw?.verdicts, fallbackPosition: null },
  ];

  for (const entry of maybeArrays) {
    if (!Array.isArray(entry.arr)) continue;
    for (const item of entry.arr) pushCandidate(item, entry.fallbackPosition);
  }

  if (collected.length === 0 && raw && typeof raw === "object") {
    const id = raw.id || raw.ruleId;
    if (id) {
      const phase2Item = phase2Map.get(id);
      collected.push({
        id,
        position: normalizePosition(raw.position || raw.verdict, "EXTEND"),
        explanation: String(raw.explanation || raw.reasoning || ""),
        policy_refs: derivePolicyRefs(id, normalizePolicyRefs(raw.policy_refs || raw.reference)),
        suggested_verdict: normalizeSuggested(raw.suggested_verdict || raw.verdict, phase2Item),
        severity: phase2Item ? phase2Item.severity : "",
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of collected) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  normalized.result.items = unique;
  return normalized;
}
function labelToBinary(verdict) {
  const treatWarnPos = String(process.env.METRICS_TREAT_WARN_AS_POS || "").trim() === "1";
  const v = normVerdict(verdict);
  if (v === "FAIL") return 1;
  if (v === "WARN") return treatWarnPos ? 1 : 0;
  return 0;
}
function computeConfusion(pred, truth) {
  const tp = pred === 1 && truth === 1 ? 1 : 0;
  const fp = pred === 1 && truth === 0 ? 1 : 0;
  const tn = pred === 0 && truth === 0 ? 1 : 0;
  const fn = pred === 0 && truth === 1 ? 1 : 0;
  return { tp, fp, tn, fn };
}
function safeRate(n, d) { return d > 0 ? +(n / d).toFixed(3) : 0; }
function explanationScore(item) {
  const text = String(item.explanation || "").trim();
  const hasLen = text.length >= 40 ? 1 : 0;
  const hasRef = Array.isArray(item.policy_refs) && item.policy_refs.length > 0 ? 1 : 0;
  const hasEvidence = item.evidence && typeof item.evidence === "object" ? 1 : 0;
  return +((0.5 * hasRef) + (0.3 * hasLen) + (0.2 * hasEvidence)).toFixed(3);
}
function loadGroundTruth() {
  if (!fs.existsSync(GT_PATH)) return null;
  try {
    const gt = JSON.parse(fs.readFileSync(GT_PATH, "utf8"));
    if (gt && Array.isArray(gt.items)) {
      const map = new Map();
      for (const it of gt.items) {
        if (it && it.id) map.set(String(it.id), String(it.verdict || it.label || "").toUpperCase());
      }
      return map;
    }
  } catch (e) {
    console.warn("[phase3] Failed to parse ground-truth.json:", e.message);
  }
  return null;
}
function normVerdict(v) {
  const t = String(v || "").trim().toUpperCase();
  if (t === "PASS" || t === "FAIL" || t === "WARN" || t === "INFO") return t;
  return "WARN";
}
function p2Verdict(phase2Item) {
  if (!phase2Item) return "WARN";
  if (phase2Item.pass === true) return "PASS";
  const sev = String(phase2Item.severity || "").trim().toUpperCase();
  if (["FAIL", "WARN", "INFO", "PASS"].includes(sev)) return sev;
  return "FAIL";
}
function verdictRank(verdict) {
  const rank = { FAIL: 3, WARN: 2, PASS: 1, INFO: 0 };
  return rank[normVerdict(verdict)] ?? 0;
}

function decidePositionFrom(phase2Verdict, llmVerdict) {
  // Normalise both sides
  const v2 = normVerdict(phase2Verdict);
  const v3 = normVerdict(llmVerdict);

  // If both engines agree on the same verdict, it's SUPPORT.
  if (v2 === v3) return "SUPPORT";

  // If the LLM makes the verdict *stricter* (e.g., WARN -> FAIL, INFO -> WARN/FAIL),
  // categorise as CHALLENGE (LLM is challenging the deterministic engine).
  if (verdictRank(v3) > verdictRank(v2)) return "CHALLENGE";

  // Otherwise, the LLM is making the verdict *softer* or different in a way that
  // doesn't increase severity. Treat as EXTEND (adds nuance, mitigation, or context).
  return "EXTEND";
}

function makeCacheKey(providerCfg, payload) {
  const keyData = {
    cacheVersion: CACHE_SCHEMA_VERSION,
    provider: providerCfg.provider,
    baseUrl: providerCfg.baseUrl,
    model: providerCfg.model,
    payload,
  };
  return crypto.createHash("sha256").update(JSON.stringify(keyData)).digest("hex");
}

async function callLlm(providerCfg, payload, cacheKey) {
  // Handles sandboxed mode, caching, retries, and response normalisation in one place.
  const { apiKey, baseUrl, model, provider } = providerCfg;
  if (!apiKey) {
    return {
      llmDisabled: true,
      provider,
      model,
      content: {
        overall_summary: "LLM disabled (missing API key)",
        items: [],
      },
    };
  }

  const cache = loadCache();
  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    const normalized = normalizeLlmContent(cached.content, payload.input, payload.policy_docs);
    cache[cacheKey] = { model: normalized.model || cached.model || model, content: normalized };
    saveCache(cache);
    return {
      llmDisabled: false,
      provider,
      model: normalized.model || cached.model || model,
      content: normalized,
      cacheHit: true,
    };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a senior ERC-3643 compliance auditor specialised in HKMA and SFC policies. Always return STRICT JSON matching: { \"result\": { \"overall_summary\": string, \"items\": [ { \"id\": string, \"position\": \"SUPPORT\"|\"CHALLENGE\"|\"EXTEND\", \"explanation\": string, \"policy_refs\": (string[]|{label:string,url?:string}[]), \"suggested_verdict\": \"PASS\"|\"FAIL\"|\"WARN\"|\"INFO\", \"evidence\"?: { \"phase2_id\"?: string, \"abi_fact\"?: string, \"topics_count\"?: number, \"missing_fn\"?: string } ] } }.\nRules: (1) Base every non-obvious claim on the provided policy snippets using policy_refs (official HKMA/SFC URLs only; if none apply, say so). (2) Keep each explanation ≤120 words. (3) If you CHALLENGE a PASS, include numeric evidence in `evidence` (e.g., topics_count). (4) Do not invent rules, IDs or clauses.",
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
  };

  if (PER_CALL_DELAY_MS > 0) {
    await sleep(withJitter(PER_CALL_DELAY_MS));
  }

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const backoff = withJitter(BASE_DELAY_MS * Math.pow(2, attempt - 1));
      await sleep(backoff);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      const textBody = await res.text();
      if (!res.ok) {
        try {
          ensureDir(path.join(process.cwd(), "reports"));
          fs.writeFileSync(path.join(process.cwd(), "reports", "phase3-raw-error.json"), textBody);
        } catch {}
        throw new Error(`HTTP ${res.status}: ${textBody}`);
      }
      let json;
      try {
        json = JSON.parse(textBody);
      } catch (e) {
        throw new Error(`Failed to parse LLM JSON response: ${e.message}`);
      }
      try {
        ensureDir(path.join(process.cwd(), "reports"));
        fs.writeFileSync(path.join(process.cwd(), "reports", "phase3-raw-response.json"), JSON.stringify(json, null, 2));
      } catch {}
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("LLM response missing content");
      }
      try {
        const parsed = JSON.parse(content);
        const normalized = normalizeLlmContent(parsed, payload.input, payload.policy_docs);
        cache[cacheKey] = { model: normalized.model || model, content: normalized };
        saveCache(cache);
        return {
          llmDisabled: false,
          provider,
          model: normalized.model || model,
          content: normalized,
          cacheHit: false,
        };
      } catch (err) {
        console.warn("[phase3] LLM returned non-JSON content; falling back to raw text.");
        const fallback = {
          result: {
            overall_summary: content,
            items: [],
          },
        };
        cache[cacheKey] = { model, content: fallback };
        saveCache(cache);
        return {
          llmDisabled: false,
          provider,
          model,
          content: fallback,
          cacheHit: false,
        };
      }
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  console.warn("[phase3] LLM call failed:", lastError?.message || lastError);
  return {
    llmDisabled: false,
    provider,
    model,
    content: {
      result: {
        overall_summary: `LLM call failed: ${lastError?.message || lastError}`,
        items: [],
      },
    },
  };
}

async function main() {
  const root = process.cwd();
  loadLocalEnv(root);

  const phase2Path = path.join(root, "reports", "phase2-results.json");
  const argv = process.argv.slice(2);
  let rulesArg = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--rules" && argv[i + 1]) {
      rulesArg = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--rules=")) {
      rulesArg = token.slice("--rules=".length);
    }
  }

  let hkRules = [];
  if (rulesArg) {
    const resolved = path.isAbsolute(rulesArg) ? rulesArg : path.join(root, rulesArg);
    if (!fs.existsSync(resolved)) {
      console.error(`[phase3] Rules file not found: ${resolved}`);
      process.exit(1);
    }
    hkRules = safeReadJson(resolved, "phase3 rules", true) || [];
    console.log(`[phase3] Loaded ${Array.isArray(hkRules) ? hkRules.length : 0} rule(s) from ${resolved}`);
  } else {
    const candidates = [
      path.join(root, "cre/rules/baseline.setA.json"),
      path.join(root, "cre/rules/baseline.setB.json"),
      path.join(root, "cre/rules/baseline.setC.json"),
    ];
    const existing = candidates.filter((p) => fs.existsSync(p));
    if (existing.length === 0) {
      const fallback = path.join(root, "cre", "rules", "baseline.json");
      if (!fs.existsSync(fallback)) {
        console.error("[phase3] No baseline rule files found.");
        process.exit(1);
      }
      hkRules = safeReadJson(fallback, "phase3 rules", true) || [];
      console.log(`[phase3] Loaded ${Array.isArray(hkRules) ? hkRules.length : 0} rule(s) from ${fallback}`);
    } else {
      for (const file of existing) {
        try {
          const part = safeReadJson(file, "phase3 rules", true);
          if (Array.isArray(part)) {
            hkRules.push(...part);
            console.log(`[phase3] Loaded ${part.length} rule(s) from ${file}`);
          }
        } catch (err) {
          console.warn(`[phase3] Failed to load ${file}: ${err.message}`);
        }
      }
    }
  }

  if (!Array.isArray(hkRules) || hkRules.length === 0) {
    console.error("[phase3] No rules loaded; aborting.");
    process.exit(1);
  }

  // Optional policy manifest lets users point at bespoke HKMA/SFC references.
  const policiesDocs = loadPolicyDocs(root);
  const phase2 = safeReadJson(phase2Path, "phase2-results.json", true);

  const { surfaces, facts: contractFacts } = loadAbiDetails(root);
  const groundTruth = loadGroundTruth();
  // Everything under "input" is echoed into the LLM prompt.
  const input = {
    surface: surfaces,
    phase2: buildPhase2Context(phase2),
    hk_rules: buildRulesContext(hkRules),
  };

  const providerCfg = {
    provider: process.env.LLM_PROVIDER || "openai",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
  };

  const payload = {
    instructions: "Analyse Phase 2 deterministic results and HK policy rules. Produce policy-grounded support/challenge/extend findings with suggested verdicts.",
    input,
    contract_facts: contractFacts,
    policy_docs: policiesDocs,
  };

  const cacheKey = makeCacheKey(providerCfg, payload);

  // Call (or reuse) the LLM – handles throttling, retries, caching and normalisation.
  const llmResult = await callLlm(providerCfg, payload, cacheKey);
  const nowIso = new Date().toISOString();

  const baseOutput = {
    generatedAt: nowIso,
    model: llmResult.content?.model || providerCfg.model,
    provider: providerCfg.provider,
    input,
    result: {
      overall_summary: "",
      items: [],
    },
  };

  if (llmResult.llmDisabled) {
    baseOutput.result.overall_summary = "LLM disabled (missing API key)";
    baseOutput.result.items = [];
    baseOutput.llm_disabled = true;
  } else if (llmResult.content && llmResult.content.result) {
    baseOutput.result.overall_summary = llmResult.content.result.overall_summary || "";
    baseOutput.result.items = Array.isArray(llmResult.content.result.items) ? llmResult.content.result.items : [];
  } else {
    baseOutput.result.overall_summary = llmResult.content?.overall_summary || "";
    baseOutput.result.items = Array.isArray(llmResult.content?.items) ? llmResult.content.items : [];
  }

  // === Post-process: attach positions vs Phase 2 and compute metrics ===
  const phase2Map = new Map();
  if (input?.phase2?.items) {
    for (const it of input.phase2.items) {
      if (it?.id) phase2Map.set(it.id, it);
    }
  }
  const items = Array.isArray(baseOutput.result.items) ? baseOutput.result.items : [];
  let support = 0; let challenge = 0; let extend = 0; let withCites = 0;
  const augmented = items.map((it) => {
    // Compare deterministic verdict with LLM verdict to assign SUPPORT/EXTEND/CHALLENGE.
    const id = it.id || it.ruleId || "";
    const p2 = phase2Map.get(id);
    const v2 = p2Verdict(p2);
    let v3 = normVerdict(it.suggested_verdict || it.verdict);

    // STRONG PASS protection: only permit PASS->FAIL if (a) caller explicitly allows it AND
    // (b) there is *structured* evidence tying to this rule (phase2 id or abi fact) AND
    // (c) at least one valid HK policy citation is provided. Otherwise keep PASS.
    if (v2 === "PASS" && v3 === "FAIL") {
      const allowDowngrade = String(process.env.PHASE3_ALLOW_DOWNGRADE || "").trim() === "1";
      const hasPolicy = Array.isArray(it.policy_refs) && it.policy_refs.some((ref) => ref && (ref.url || ref.label));
      const ev = it.evidence && typeof it.evidence === "object" ? it.evidence : null;
      const tiesToRule = !!(ev && ((ev.phase2_id && String(ev.phase2_id).trim() === id) || ev.abi_fact || ev.fact));
      // Optional: require the LLM to point at a specific numeric fact (e.g., "topics_count": 1)
      const numericContradiction = !!(ev && Object.values(ev).some((v) => typeof v === "number"));
      if (!(allowDowngrade && tiesToRule && hasPolicy && numericContradiction)) {
        v3 = "PASS";
      }
    }

    const position = decidePositionFrom(v2, v3);
    const expScore = explanationScore(it);
    const position_reason = (v2 === v3)
      ? "Same verdict as Phase 2"
      : (verdictRank(v3) > verdictRank(v2)
          ? "LLM increased severity"
          : "LLM decreased or changed severity");
    if (position === "SUPPORT") support += 1;
    else if (position === "CHALLENGE") challenge += 1;
    else extend += 1;
    const cites = Array.isArray(it.policy_refs) ? it.policy_refs.length : 0;
    if (cites > 0) withCites += 1;
    return {
      ...it,
      position,
      position_reason,
      phase2_verdict: v2,
      suggested_verdict: v3,
      explanation_score: expScore,
      evidence: it.evidence
    };
  });

  baseOutput.result.items = augmented;
  baseOutput.summaryPosition = { support, challenge, extend };

  const tally = { pass: 0, warn: 0, fail: 0 };
  for (const it of augmented) {
    const v = normVerdict(it.suggested_verdict || it.verdict);
    if (v === "PASS") tally.pass += 1;
    else if (v === "FAIL") tally.fail += 1;
    else tally.warn += 1;
  }
  baseOutput.summaryLlm = tally;
  const totals = { items: augmented.length || 0 };
  const avgExplanation = totals.items ? +(augmented.reduce((s, x) => s + (x.explanation_score || 0), 0) / totals.items).toFixed(3) : 0;
  const policyMappingRate = totals.items ? +(augmented.filter(x => Array.isArray(x.policy_refs) && x.policy_refs.length > 0).length / totals.items).toFixed(3) : 0;
  
  // If ground truth exists, compute Phase2 vs Phase3 precision/recall on FAIL (non-compliance)
  let p2 = { tp:0, fp:0, tn:0, fn:0 }, p3 = { tp:0, fp:0, tn:0, fn:0 };
  if (groundTruth) {
    for (const rule of augmented) {
      const id = rule.id;
      const gtVerd = groundTruth.get(id);
      if (!gtVerd) continue;
      const gtBin = labelToBinary(gtVerd);
      const p2Item = phase2Map.get(id);
      const p2Bin = labelToBinary(p2Verdict(p2Item));
      const p3Bin = labelToBinary(rule.suggested_verdict || rule.verdict);
      const a = computeConfusion(p2Bin, gtBin);
      const b = computeConfusion(p3Bin, gtBin);
      p2.tp += a.tp; p2.fp += a.fp; p2.tn += a.tn; p2.fn += a.fn;
      p3.tp += b.tp; p3.fp += b.fp; p3.tn += b.tn; p3.fn += b.fn;
    }
  }
  const precision2 = safeRate(p2.tp, (p2.tp + p2.fp));
  const recall2 = safeRate(p2.tp, (p2.tp + p2.fn));
  const precision3 = safeRate(p3.tp, (p3.tp + p3.fp));
  const recall3 = safeRate(p3.tp, (p3.tp + p3.fn));
  const precisionGain = +(precision3 - precision2).toFixed(3);
  const coverageExpansion = +(extend / (totals.items || 1)).toFixed(3);
  
  const metricsFull = {
    generatedAt: nowIso,
    model: baseOutput.model,
    totals,
    position: baseOutput.summaryPosition,
    verdicts: baseOutput.summaryLlm,
    agreementRate: +(support / (totals.items || 1)).toFixed(3),
    extensionRate: +(extend / (totals.items || 1)).toFixed(3),
    challengeRate: +(challenge / (totals.items || 1)).toFixed(3),
    policyMappingRate,
    avgExplanationScore: avgExplanation,
    groundTruthUsed: !!groundTruth,
    phase2: { precision: precision2, recall: recall2, confusion: p2 },
    phase3: { precision: precision3, recall: recall3, confusion: p3 },
    deltas: { precisionGain, coverageExpansion }
  };

  const reportsDir = path.join(root, "reports");
  ensureDir(reportsDir);
  fs.writeFileSync(METRICS_OUT, JSON.stringify(metricsFull, null, 2));
  console.log("[phase3] Metrics written:", METRICS_OUT);
  // ensureDir(reportsDir);
  // const total = augmented.length || 1;
  // const metrics = {
  //   generatedAt: nowIso,
  //   model: baseOutput.model,
  //   totals: { items: augmented.length },
  //   position: baseOutput.summaryPosition,
  //   agreementRate: +(support / total).toFixed(3),
  //   extensionRate: +(extend / total).toFixed(3),
  //   challengeRate: +(challenge / total).toFixed(3),
  //   citationCoverage: +(withCites / total).toFixed(3),
  // };
  // const metricsPath = path.join(reportsDir, "phase3-metrics.json");
  // fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  // console.log("[phase3] Metrics written:", metricsPath);
  // generate report json
  const outPath = path.join(reportsDir, "phase3-results.json");
  fs.writeFileSync(outPath, JSON.stringify(baseOutput, null, 2));
  console.log("[phase3] JSON written:", outPath);
  if (llmResult.cacheHit) {
    console.log("[phase3] Used cached LLM response.");
  }
  console.log("[phase3] Cache file:", CACHE_FILE);
}

main().catch((err) => {
  console.error("[phase3] Unexpected error:", err);
  process.exit(1);
});
