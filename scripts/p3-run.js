/* eslint-disable */
/**
 * Phase 3 — LLM semantic compliance evaluator (standalone).
 * - Loads Phase 2 deterministic report + ERC3643/HK rules
 * - Extracts ABI "surface" + light static facts from abipaths.json artifacts
 * - Calls an LLM to produce: semantic reasoning, compliance gaps,
 *   natural-language justification + policy citations
 * - Computes improvement metrics (precision gain, coverage, policy mapping, explanation quality)
 *
 * Usage:
 *   node scripts/p3-llm-eval.js
 *
 * ENV:
 *   LLM_BASE_URL=https://api.openai.com/v1
 *   LLM_MODEL=gpt-4o-mini
 *   OPENAI_API_KEY=sk-...
 *   PHASE3_ALLOW_DOWNGRADE=1       // allow PASS->FAIL if evidence + citations
 *   PHASE3_PER_CALL_DELAY_MS=400
 *   PHASE3_MAX_RETRIES=3
 *   PHASE3_BASE_DELAY_MS=500
 *   PHASE3_JITTER_MS=250
 *   METRICS_TREAT_WARN_AS_POS=1    // WARN counts as positive (non-compliance) in metrics
 * 
 * Reasoning:
 * •	SUPPORT (agrees),
 * •	CHALLENGE (stricter verdict / new gap), or
 * •	EXTEND (adds nuance or explanation)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, "reports");
const OUT_JSON = path.join(REPORTS_DIR, "p3-results.json");
const OUT_METRICS = path.join(REPORTS_DIR, "p3-metrics.json");
const P2_PATH = path.join(REPORTS_DIR, "p2-results.json");
const GT_PATH = path.join(REPORTS_DIR, "ground-truth.json"); // optional
const CACHE_FILE = path.join(ROOT, ".cache", "p3-cache.json");
const CACHE_SCHEMA_VERSION = "2.0";

// Fixed rule files this script consumes
const RULES_ERC = path.join(ROOT, "cre", "rules", "baseline.erc3643.json");
const RULES_HK = path.join(ROOT, "cre", "rules", "baseline.hk.json");
const POLICY_DOCS = path.join(ROOT, "policies", "hk_sfc.json"); // optional, for real URLs/snippets

const MAX_RULES = 120;
const MAX_SURFACE = 100;
const PER_CALL_DELAY_MS = Number(process.env.PHASE3_PER_CALL_DELAY_MS ?? 400);
const MAX_RETRIES = Number(process.env.PHASE3_MAX_RETRIES ?? 3);
const BASE_DELAY_MS = Number(process.env.PHASE3_BASE_DELAY_MS ?? 500);
const JITTER_MS = Number(process.env.PHASE3_JITTER_MS ?? 250);

const MAX_SOURCE_PER_PAYLOAD = Number(process.env.PHASE3_MAX_SOURCE_FILES || 6);

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function withJitter(ms){ return ms + (JITTER_MS>0 ? Math.floor(Math.random()*JITTER_MS) : 0); }

function loadLocalEnv(){
  const env = path.join(ROOT, ".env");
  if (!fs.existsSync(env)) return;
  try {
    const raw = fs.readFileSync(env, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const eq = line.indexOf("="); if (eq === -1) continue;
      const k = line.slice(0, eq).trim(); if (!k) continue;
      const v = line.slice(eq+1).trim();
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (e) { console.warn("[p3] .env parse failed:", e.message); }
}

function safeReadJson(p, label, optional=false){
  if (!fs.existsSync(p)) { if (!optional) console.warn(`[p3] ${label} not found at ${p}`); return null; }
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch(e){ console.warn(`[p3] Failed to parse ${label}:`, e.message); return null; }
}

function extractSurface(abi){
  const result = { functions:[], events:[] };
  if (!Array.isArray(abi)) return result;
  for (const entry of abi){
    if (entry?.type==="function" && entry.name){
      const sig = `${entry.name}(${(entry.inputs||[]).map(i=>i.type||"*").join(",")})`;
      if (result.functions.length < MAX_SURFACE) result.functions.push(sig);
    } else if (entry?.type==="event" && entry.name){
      if (result.events.length < MAX_SURFACE) result.events.push(entry.name);
    }
    if (result.functions.length>=MAX_SURFACE && result.events.length>=MAX_SURFACE) break;
  }
  return result;
}

function excerpt(source, needles, ctx=120){
  if (!source) return "";
  const lower = source.toLowerCase();
  for (const n of needles){
    const idx = lower.indexOf(String(n||"").toLowerCase());
    if (idx>=0){
      const s=Math.max(0, idx-ctx), e=Math.min(source.length, idx+n.length+ctx);
      return source.slice(s,e).replace(/\s+/g," ").trim();
    }
  }
  return "";
}

function tryLoadSource(artifactPath, artifact){
  try {
    const rel = artifact?.sourceName;
    if (!rel) return null;
    const candidates = [
      path.join(ROOT, rel),
      path.join(path.dirname(artifactPath), "..", "..", rel),
      path.join(path.dirname(artifactPath), "..", rel),
    ];
    for (const c of candidates){
      const abs = path.resolve(c);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()){
        return { filename: rel, content: fs.readFileSync(abs, "utf8") };
      }
    }
  } catch {}
  return null;
}

function loadContractSourcesFromAbiPaths() {
  const abipaths = safeReadJson(path.join(ROOT, "abipaths.json"), "abipaths.json", true) || {};
  const out = [];
  const seen = new Set();
  for (const key of Object.keys(abipaths)) {
    const rel = abipaths[key];
    if (!rel) continue;
    const artifactPath = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    let artifact = null;
    try { artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")); } catch {}
    const src = tryLoadSource(artifactPath, artifact);
    if (src && src.content && !seen.has(src.filename)) {
      const maxChars = Number(process.env.PHASE3_MAX_SOURCE_CHARS || 20000);
      const trimmed = src.content.length > maxChars ? src.content.slice(0, maxChars) : src.content;
      out.push({ filename: src.filename, content: trimmed });
      seen.add(src.filename);
    }
  }
  return out;
}

function computeFacts(contractKey, artifactPath){
  const fallback = { abiFunctions:[], hasTransferGate:false, bypassCandidates:[], sourceHints:[] };
  try {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abi = Array.isArray(artifact?.abi) ? artifact.abi : [];
    const abiFunctions = abi.filter(e=>e?.type==="function" && e.name).map(e=>e.name);

    const src = tryLoadSource(artifactPath, artifact);
    const srcText = src?.content ?? "";
    const transferNeedles = ["function transfer(", "function transferFrom("];
    const guardNeedles = ["identityregistry","claimtopics","trustedissuers","compliance","kyc","aml"];

    const transferExcerpt = excerpt(srcText, transferNeedles, 160);
    const guardExcerpt = excerpt(srcText, guardNeedles, 160);
    const hasTransferGate = Boolean(transferExcerpt && guardExcerpt);

    const bypassNames = abiFunctions.filter(n => /white|allow|kyc|whitelist|allowlist|approveinvestor|authorize/i.test(n));
    const transferBlock = excerpt(srcText, transferNeedles, 320);
    const bypassCandidates = bypassNames.filter(n => !transferBlock.toLowerCase().includes(n.toLowerCase()));

    const sourceHints = [];
    if (transferExcerpt) sourceHints.push({ filename: src?.filename ?? contractKey, excerpt: transferExcerpt });
    if (guardExcerpt) sourceHints.push({ filename: src?.filename ?? contractKey, excerpt: guardExcerpt });

    return { abiFunctions, hasTransferGate, bypassCandidates, sourceHints };
  } catch { return fallback; }
}

function loadAbiDetails(){
  const abipaths = safeReadJson(path.join(ROOT, "abipaths.json"), "abipaths.json", true) || {};
  const keys = ["Token","IdentityRegistry","ClaimTopicsRegistry","TrustedIssuersRegistry"];
  const surfaces = {}; const facts = {};
  for (const k of keys){
    const rel = abipaths[k] || abipaths[k.toLowerCase()];
    surfaces[k] = { functions:[], events:[] };
    if (!rel) continue;
    const filePath = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
    const artifact = safeReadJson(filePath, `${k} ABI`, true);
    if (artifact && Array.isArray(artifact.abi)){
      surfaces[k] = extractSurface(artifact.abi);
      facts[k] = computeFacts(k, filePath);
    }
  }
  return { surfaces, facts };
}

function buildPhase2Context(phase2){
  const summary = phase2?.summary ? {
    pass: Number(phase2.summary.pass)||0,
    fail: Number(phase2.summary.fail)||0,
    warn: Number(phase2.summary.warn)||0,
    info: Number(phase2.summary.info)||0,
  } : { pass:0, fail:0, warn:0, info:0 };
  const items = Array.isArray(phase2?.items) ? phase2.items.slice(0, MAX_RULES).map(it=>({
    id: it.id||"", title: it.title||"", severity: it.severity||"", pass: !!it.pass, note: it.note||""
  })) : [];
  return { summary, items };
}

function buildRulesContext(...arrs){
  const merged = [];
  for (const a of arrs) if (Array.isArray(a)) merged.push(...a);
  return merged.slice(0, MAX_RULES).map(r=>({ id:r.id||"", title:r.title||"", desc:r.desc||r.description||"" }));
}

function normalizeLlmItems(raw, input, ruleSetMap = new Map()){
  const out = [];
  const p2 = new Map((input?.phase2?.items||[]).map(it=>[it.id, it]));
  const sources = [];
  if (Array.isArray(raw?.result?.items)) sources.push(raw.result.items);
  if (Array.isArray(raw?.items)) sources.push(raw.items);
  if (Array.isArray(raw?.support)) sources.push(raw.support);
  if (Array.isArray(raw?.challenge)) sources.push(raw.challenge);
  if (Array.isArray(raw?.extend)) sources.push(raw.extend);

  for (const arr of sources){
    for (const it of arr){
      const id = it?.id || it?.rule || it?.rule_id;
      if (!id) continue;
      const p2i = p2.get(id);
      const suggested = (it.suggested_verdict || it.verdict || (p2i?.pass ? "PASS" : (p2i?.severity||"WARN"))).toString().toUpperCase();
      const explanation = String(it.explanation || it.reasoning || it.note || "").trim();
      const position = String(it.position || "EXTEND").toUpperCase();
      const refs = Array.isArray(it.policy_refs) ? it.policy_refs : (it.policyRefs ? it.policyRefs : []);
      const evidence = it.evidence && typeof it.evidence==="object" ? it.evidence : undefined;
      out.push({
        id,
        position,
        explanation,
        policy_refs: refs,
        suggested_verdict: suggested,
        evidence,
        severity: p2i?.severity || it.severity || "",
        rule_set: it.rule_set || it.run || ruleSetMap.get(id) || ""
      });
    }
  }
  const uniq = []; const seen=new Set();
  for (const it of out){ if (!seen.has(it.id)){ seen.add(it.id); uniq.push(it);} }
  return uniq;
}

function labelToBinary(verdict){
  const posWarn = String(process.env.METRICS_TREAT_WARN_AS_POS||"") === "1";
  const v = String(verdict||"").toUpperCase();
  if (v==="FAIL") return 1;
  if (v==="WARN") return posWarn ? 1 : 0;
  return 0;
}
function computeConfusion(pred, truth){ return {
  tp:(pred===1&&truth===1)?1:0, fp:(pred===1&&truth===0)?1:0,
  tn:(pred===0&&truth===0)?1:0, fn:(pred===0&&truth===1)?1:0
};}
function safeRate(n,d){ return d>0 ? +(n/d).toFixed(3) : 0; }
function explanationScore(item){
  const txt = String(item.explanation||"");
  const hasLen = txt.length>=40 ? 1 : 0;
  const hasRef = Array.isArray(item.policy_refs) && item.policy_refs.length>0 ? 1 : 0;
  const hasEvidence = item.evidence && typeof item.evidence==="object" ? 1 : 0;
  return +((0.5*hasRef)+(0.3*hasLen)+(0.2*hasEvidence)).toFixed(3);
}
function normVerdict(v){ const t=String(v||"").toUpperCase(); return ["PASS","FAIL","WARN","INFO"].includes(t)?t:"WARN"; }
function severityRank(v){ const m={FAIL:3,WARN:2,PASS:1,INFO:0}; return m[normVerdict(v)]??0; }
function decidePosition(v2, v3){ if (v2===v3) return "SUPPORT"; return severityRank(v3)>severityRank(v2) ? "CHALLENGE":"EXTEND"; }
function p2Verdict(it){ if (!it) return "WARN"; if (it.pass===true) return "PASS"; const s=String(it.severity||"").toUpperCase(); return ["FAIL","WARN","INFO","PASS"].includes(s)?s:"FAIL"; }
function coercePolicyRef(value){
  if (!value) return [];
  const results=[];
  const pushString = (s)=>{
    const trimmed = String(s||"").trim();
    if (!trimmed) return;
    const parts = trimmed.split(/\s*(?=https?:\/\/)/g).filter(Boolean);
    if (parts.length>1){
      const prefix = parts.shift()?.trim();
      const urls = parts.map(p=>p.trim()).filter(Boolean);
      if (urls.length){
        const label = prefix || urls[0];
        for (const url of urls){
          results.push({ label, url });
        }
        return;
      }
    }
    results.push(trimmed);
  };
  const pushObj = (obj)=>{
    if (!obj) return;
    if (typeof obj==="string") return pushString(obj);
    if (typeof obj!=="object") return;
    const label = String(obj.label || obj.title || obj.name || obj.url || "").trim();
    const url = obj.url ? String(obj.url).trim() : "";
    if (!label && !url) return;
    results.push(url ? { label: label || url, url } : label);
  };
  if (Array.isArray(value)){
    for (const v of value) pushObj(v);
  } else {
    pushObj(value);
  }
  return results;
}

function normalizeRule(rule){
  if (!rule) return null;
  const policyRefs = coercePolicyRef(rule.policy_refs || rule.policyRefs || rule.policyRef || rule.policy);
  return {
    id: rule.id || "",
    title: rule.title || "",
    desc: rule.desc || rule.description || "",
    snippet: rule.snippet || "",
    severity: rule.severity || "",
    policy_refs: policyRefs
  };
}

function makeCacheKey(model, payload){
  return crypto.createHash("sha256").update(JSON.stringify({v:CACHE_SCHEMA_VERSION, model, payload})).digest("hex");
}
function loadCache(){ try{ return JSON.parse(fs.readFileSync(CACHE_FILE,"utf8")); } catch{ return {}; } }
function saveCache(obj){ ensureDir(path.dirname(CACHE_FILE)); fs.writeFileSync(CACHE_FILE, JSON.stringify(obj,null,2)); }

async function callLLM(provider, payload){
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  if (!apiKey) return { disabled:true, model, content:{ result:{ overall_summary:"LLM disabled (missing API key)", items:[] } } };

  const key = makeCacheKey(model, payload);
  const cache = loadCache();
  if (cache[key]) return { disabled:false, cacheHit:true, model: cache[key].model||model, content: cache[key].content };

  const url = `${baseUrl.replace(/\/+$/,"")}/chat/completions`;
  const expectedIds = Array.isArray(payload?.expected_ids)
    ? payload.expected_ids.filter(id => typeof id === "string" && id.trim().length)
    : [];
  const coverageClause = expectedIds.length
    ? `Ensure result.items includes every rule id listed in payload.expected_ids (total ${expectedIds.length}); do not omit or merge ids.`
    : `Ensure result.items covers every rule id provided in payload.input.rules; do not omit or merge ids.`;
  const fallbackClause = `If available evidence is insufficient for an id, still emit that id with the Phase 2 verdict and a concise explanation of the gap instead of skipping it.`;

  const systemContent = `You are a senior ERC-3643 compliance auditor specialised in HKMA/SFC policies.
Read ONLY the provided Solidity source code, ABI surfaces, Phase 2 outputs, and policy docs. Do not assume missing code.
Return STRICT JSON:
{ "result": { "overall_summary": string,
              "items": [ { "id": string,
                           "position": "SUPPORT"|"CHALLENGE"|"EXTEND",
                           "explanation": string,
                           "policy_refs": (string[]|{label:string,url?:string}[]),
                           "suggested_verdict": "PASS"|"FAIL"|"WARN"|"INFO",
                           "evidence"?: { "file"?: string, "line"?: number, "phase2_id"?: string, "abi_fact"?: string, "topics_count"?: number, "missing_fn"?: string } } ] } }
Rules:
1) Base every non-obvious claim on provided policy docs (official HKMA/SFC URLs only) OR quoted code lines with filename and approximate line.
2) ≤120 words per explanation.
3) If you CHALLENGE a PASS, include concrete evidence (filename + line) in "evidence".
4) Do not invent rules/IDs/clauses.
5) ${coverageClause}
6) ${fallbackClause}
7) Write explanations in clear, auditor-friendly plain English.`;

  const body = {
    model, temperature: 0.2, response_format: { type: "json_object" },
    messages: [
      { role:"system", content: systemContent },
      { role:"user", content: JSON.stringify(payload) }
    ]
  };

  if (PER_CALL_DELAY_MS>0) await sleep(withJitter(PER_CALL_DELAY_MS));

  let lastErr=null;
  for (let attempt=0; attempt<=MAX_RETRIES; attempt++){
    if (attempt>0) await sleep(withJitter(BASE_DELAY_MS*Math.pow(2, attempt-1)));
    try{
      const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${apiKey}` }, body: JSON.stringify(body) });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt}`);
      let outer; try{ outer = JSON.parse(txt); } catch(e){ throw new Error("Non-JSON response"); }
      const content = outer?.choices?.[0]?.message?.content;
      if (!content) throw new Error("missing content");
      let parsed; try{ parsed = JSON.parse(content); } catch{ parsed = { result:{ overall_summary: content, items:[] } }; }
      const normalized = { result:{ overall_summary: parsed?.result?.overall_summary || parsed?.overall_summary || "", items: normalizeLlmItems(parsed, payload.input) } };
      cache[key] = { model, content: normalized }; saveCache(cache);
      return { disabled:false, cacheHit:false, model, content: normalized };
    }catch(e){ lastErr=e; }
  }
  return { disabled:false, error:lastErr?.message||String(lastErr), model, content:{ result:{ overall_summary:`LLM call failed: ${lastErr?.message||lastErr}`, items:[] } } };
}

function precomputeRuleMatches(rules, sources) {
  const map = new Map();
  for (const r of rules || []) {
    const id = r.id;
    if (!id) continue;
    const needle = String(r.snippet || "").trim();
    if (!needle) { map.set(id, []); continue; }
    const results = [];
    for (const src of sources || []) {
      const text = src.content || "";
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        const pre = text.slice(0, idx);
        const line = pre.split(/\r?\n/).length;
        results.push({ file: src.filename, line, snippet: needle });
      }
    }
    map.set(id, results);
  }
  return map;
}

(async function main(){
  loadLocalEnv();
  ensureDir(REPORTS_DIR);

  const phase2 = safeReadJson(P2_PATH, "phase2-results.json", true) || { summary:{}, items:[] };
  const rulesErc = safeReadJson(RULES_ERC, "baseline.erc3643.json") || [];
  const rulesHk  = safeReadJson(RULES_HK,  "baseline.hk.json", true) || [];
  const policyDocs = safeReadJson(POLICY_DOCS, "policy docs", true) || [];
  const { surfaces, facts: contractFacts } = loadAbiDetails();

  // Load contract sources and precompute rule matches
  const contractSourcesAll = loadContractSourcesFromAbiPaths();
  const contractSources = contractSourcesAll.slice(0, MAX_SOURCE_PER_PAYLOAD);

  const combinedRules = [...(rulesErc||[]), ...(rulesHk||[])].slice(0, MAX_RULES).map(normalizeRule).filter(r=>r && r.id);

  // Precompute rule matches
  const ruleMatches = precomputeRuleMatches(combinedRules, contractSources);

  const input = {
    surface: surfaces,
    phase2: {
      summary: {
        pass: Number(phase2?.summary?.pass)||0,
        fail: Number(phase2?.summary?.fail)||0,
        warn: Number(phase2?.summary?.warn)||0,
        info: Number(phase2?.summary?.info)||0
      },
      items: Array.isArray(phase2?.items) ? phase2.items.map(it=>({
        id: it.id||"", title: it.title||"", severity: it.severity||"", pass: !!it.pass, note: it.note||""
      })) : []
    },
    rules: combinedRules
  };

  const phase2Items = Array.isArray(input.phase2.items) ? input.phase2.items : [];
  const expectedIds = phase2Items.map(it=>typeof it?.id==="string"?it.id.trim():"").filter(Boolean);
  const p2Map = new Map(phase2Items.map(it=>[it.id, it]));
  const rulesById = new Map((input.rules||[]).map(r=>[r.id, r]));
  const allowDowngrade = String(process.env.PHASE3_ALLOW_DOWNGRADE||"") === "1";

  const instructionText = "Analyse deterministic Phase 2 results plus rule descriptions/policy references; produce policy-grounded support/challenge/extend findings with suggested verdicts for every rule id in expected_ids, using plain auditor-friendly language.";

  function buildPayload(targetIds, extra={}){
    const focus = Array.isArray(targetIds) && targetIds.length ? targetIds.filter(Boolean) : expectedIds;
    const focusSet = new Set(focus);
    const phase2Subset = focus.length === expectedIds.length
      ? phase2Items
      : focus.map(id=>p2Map.get(id)).filter(Boolean);
    const remappedRules = focus.map(id=>{
      if (rulesById.has(id)) return rulesById.get(id);
      const p2 = p2Map.get(id);
      return normalizeRule({
        id,
        title: p2?.title || "",
        desc: p2?.note || p2?.desc || "",
        policyRef: p2?.policyRef || p2?.policy_refs
      });
    }).filter(r=>r && r.id);
    const rulesSubset = remappedRules.length ? remappedRules : (input.rules || []);
    return {
      instructions: instructionText,
      input: {
        surface: input.surface,
        phase2: {
          summary: input.phase2.summary,
          items: phase2Subset
        },
        rules: rulesSubset.length ? rulesSubset : input.rules
      },
      contract_facts: contractFacts,
      policy_docs: policyDocs,
      expected_ids: focus,
      total_rule_count: expectedIds.length,
      rulebook: rulesSubset,
      contract_sources: contractSources,
      rule_matches: focus.reduce((acc, id) => { acc[id] = ruleMatches.get(id) || []; return acc; }, {}),
      ...extra
    };
  }

  const rawFindings = new Map();
  const llmOrder = [];
  function recordItems(list){
    if (!Array.isArray(list)) return;
    for (const item of list){
      if (!item || typeof item.id !== "string" || !item.id.trim()) continue;
      const id = item.id.trim();
      const existing = rawFindings.get(id);
      if (!existing) {
        rawFindings.set(id, { ...item, id });
        llmOrder.push(id);
        continue;
      }
      const existingExplanation = String(existing.explanation||"").trim();
      const incomingExplanation = String(item.explanation||"").trim();
      const existingRefs = Array.isArray(existing.policy_refs) ? existing.policy_refs.length : 0;
      const incomingRefs = Array.isArray(item.policy_refs) ? item.policy_refs.length : 0;
      const shouldReplace =
        (!existingExplanation && incomingExplanation) ||
        (incomingRefs > existingRefs) ||
        (incomingExplanation.length > existingExplanation.length + 32);
      if (shouldReplace) rawFindings.set(id, { ...item, id });
    }
  }

  let llm = { disabled:true, model:"", content:{ result:{ overall_summary:"", items:[] } } };
  let overallSummary = "";
  let modelUsed = "";

  if (expectedIds.length){
    const basePayload = buildPayload(expectedIds, { coverage_round: 0 });
    llm = await callLLM({}, basePayload);
    modelUsed = llm.model || modelUsed;
    recordItems(llm?.content?.result?.items || []);
    overallSummary = llm?.content?.result?.overall_summary || "";

    let missing = expectedIds.filter(id => !rawFindings.has(id));
    if (!llm.disabled && !llm.error && missing.length){
      const chunkSize = Math.max(1, Number(process.env.PHASE3_COVERAGE_CHUNK_SIZE || 4));
      const maxRounds = Math.max(1, Number(process.env.PHASE3_COVERAGE_MAX_ROUNDS || 3));
      let round = 0;
      while (missing.length && round < maxRounds){
        round++;
        const chunkIds = missing.slice(0, chunkSize);
        const chunkPayload = buildPayload(chunkIds, { coverage_round: round });
        const chunkRes = await callLLM({}, chunkPayload);
        if (!modelUsed && chunkRes.model) modelUsed = chunkRes.model;
        recordItems(chunkRes?.content?.result?.items || []);
        missing = expectedIds.filter(id => !rawFindings.has(id));
        if (chunkRes.error || chunkRes.disabled) break;
      }
      if (missing.length){
        console.warn("[p3] Coverage warning for rule IDs:", missing);
      }
    }
  }

  // Augment with positions vs Phase 2 and compute metrics
  function augmentWithPhase2(it){
    if (!it || !it.id) return null;
    const p2 = p2Map.get(it.id);
    const v2 = p2Verdict(p2);
    let v3 = normVerdict(it.suggested_verdict || it.verdict || v2);
    const ruleMeta = rulesById.get(it.id) || null;
    const title = String(it.title || ruleMeta?.title || p2?.title || "").trim();
    const policyRefsFromRule = Array.isArray(ruleMeta?.policy_refs) ? ruleMeta.policy_refs : [];
    const policyRefs = Array.isArray(it.policy_refs) && it.policy_refs.length ? it.policy_refs : policyRefsFromRule;

    // PASS->FAIL gating
    if (v2==="PASS" && v3==="FAIL"){
      const hasPolicy = Array.isArray(it.policy_refs) && it.policy_refs.length>0;
      const ev = it.evidence && typeof it.evidence==="object" ? it.evidence : null;
      const ties = !!(ev && ((ev.phase2_id && String(ev.phase2_id)===it.id) || ev.abi_fact));
      const numeric = !!(ev && Object.values(ev).some(v=>typeof v==="number"));
      if (!(allowDowngrade && hasPolicy && ties && numeric)) v3="PASS";
    }

    const position = decidePosition(v2, v3);
    const expScore = explanationScore(it);

    return {
      ...it,
      id: it.id,
      title,
      policy_refs: policyRefs,
      position,
      phase2_verdict: v2,
      suggested_verdict: v3,
      explanation_score: expScore
    };
  }

  const llmMap = new Map();
  for (const id of llmOrder){
    const rawItem = rawFindings.get(id);
    const augmented = augmentWithPhase2(rawItem);
    if (augmented) llmMap.set(id, augmented);
  }
  for (const [id, rawItem] of rawFindings.entries()){
    if (llmMap.has(id)) continue;
    const augmented = augmentWithPhase2(rawItem);
    if (augmented) llmMap.set(id, augmented);
  }

  const merged = [];
  const addOrMerge = (id, base) => {
    if (!id) return;
    merged.push(base);
  };

  for (const p2Item of phase2Items){
    if (!p2Item?.id) continue;
    const llmItem = llmMap.get(p2Item.id);
    if (llmItem){
      addOrMerge(p2Item.id, llmItem);
      continue;
    }
    const v2 = p2Verdict(p2Item);
    const ruleMeta = rulesById.get(p2Item.id) || null;
    const title = String(ruleMeta?.title || p2Item.title || "").trim();
    const policyRefs = Array.isArray(ruleMeta?.policy_refs) ? ruleMeta.policy_refs : [];
    addOrMerge(p2Item.id, {
      id: p2Item.id,
      title,
      position: "SUPPORT",
      explanation: "",
      policy_refs: policyRefs,
      suggested_verdict: v2,
      severity: p2Item.severity || "",
      phase2_verdict: v2,
      explanation_score: 0,
      llm_missing: true
    });
  }

  for (const [id, llmItem] of llmMap.entries()){
    if (!p2Map.has(id)){
      const ruleMeta = rulesById.get(id) || null;
      const title = llmItem.title || ruleMeta?.title || "";
      const policyRefs = Array.isArray(llmItem.policy_refs) && llmItem.policy_refs.length
        ? llmItem.policy_refs
        : (Array.isArray(ruleMeta?.policy_refs) ? ruleMeta.policy_refs : []);
      addOrMerge(id, { ...llmItem, title, policy_refs: policyRefs });
      continue;
    }
    addOrMerge(id, llmItem);
  }

  // Summary + metrics
  const pos = { support:0, challenge:0, extend:0 };
  const verdicts = { pass:0, warn:0, fail:0 };
  for (const it of merged){
    if (it.position==="SUPPORT") pos.support++; else if (it.position==="CHALLENGE") pos.challenge++; else pos.extend++;
    const v = String(it.suggested_verdict || it.verdict || "WARN").toUpperCase();
    if (v==="PASS") verdicts.pass++; else if (v==="FAIL") verdicts.fail++; else verdicts.warn++;
  }
  const totals = { items: merged.length };
  const avgExplanation = totals.items ? +(merged.reduce((s,x)=>s+(x.explanation_score||0),0)/totals.items).toFixed(3) : 0;
  const policyMappingRate = totals.items ? +(merged.filter(x=>Array.isArray(x.policy_refs)&&x.policy_refs.length>0).length/totals.items).toFixed(3) : 0;

  // Optional ground-truth metrics
  const gt = safeReadJson(GT_PATH, "ground-truth", true);
  let p2m={tp:0,fp:0,tn:0,fn:0}, p3m={tp:0,fp:0,tn:0,fn:0};
  if (gt && Array.isArray(gt.items)){
    const gtMap = new Map(gt.items.map(it=>[it.id, String(it.verdict||it.label||"").toUpperCase()]));
    function bin(v){ const posWarn = String(process.env.METRICS_TREAT_WARN_AS_POS||"") === "1"; const t=String(v||"").toUpperCase(); if (t==="FAIL") return 1; if (t==="WARN") return posWarn?1:0; return 0; }
    function conf(pred, truth){ return { tp:(pred===1&&truth===1)?1:0, fp:(pred===1&&truth===0)?1:0, tn:(pred===0&&truth===0)?1:0, fn:(pred===0&&truth===1)?1:0 }; }
    for (const it of merged){
      const gtVerd = gtMap.get(it.id); if (!gtVerd) continue;
      const p2Item = p2Map.get(it.id);
      const a = conf(bin(p2Item?.pass ? "PASS" : (p2Item?.severity||"WARN")), bin(gtVerd));
      const b = conf(bin(it.suggested_verdict || it.verdict), bin(gtVerd));
      p2m.tp+=a.tp; p2m.fp+=a.fp; p2m.tn+=a.tn; p2m.fn+=a.fn;
      p3m.tp+=b.tp; p3m.fp+=b.fp; p3m.tn+=b.tn; p3m.fn+=b.fn;
    }
  }
  const safeRate = (n,d)=> d>0? +(n/d).toFixed(3):0;
  const precision2 = safeRate(p2m.tp, (p2m.tp+p2m.fp));
  const recall2    = safeRate(p2m.tp, (p2m.tp+p2m.fn));
  const precision3 = safeRate(p3m.tp, (p3m.tp+p3m.fp));
  const recall3    = safeRate(p3m.tp, (p3m.tp+p3m.fn));
  const precisionGain = +(precision3 - precision2).toFixed(3);
  const coverageExpansion = +(pos.extend/(totals.items||1)).toFixed(3);

  // Write outputs
  ensureDir(REPORTS_DIR);
  const modelName = modelUsed || llm.model || "";
  const doc = {
    generatedAt: new Date().toISOString(),
    model: modelName,
    input,
    result: { overall_summary: overallSummary || llm?.content?.result?.overall_summary || "", items: merged },
    summaryPosition: pos,
    summaryLlm: verdicts
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(doc,null,2));
  console.log("[p3] JSON written:", OUT_JSON);

  const metrics = {
    generatedAt: new Date().toISOString(),
    model: modelName,
    totals,
    position: pos,
    verdicts,
    agreementRate: +(pos.support/(totals.items||1)).toFixed(3),
    extensionRate: +(pos.extend/(totals.items||1)).toFixed(3),
    challengeRate: +(pos.challenge/(totals.items||1)).toFixed(3),
    policyMappingRate,
    avgExplanationScore: avgExplanation,
    groundTruthUsed: !!gt,
    phase2: { precision: precision2, recall: recall2, confusion: p2m },
    phase3: { precision: precision3, recall: recall3, confusion: p3m },
    deltas: { precisionGain, coverageExpansion }
  };
  fs.writeFileSync(OUT_METRICS, JSON.stringify(metrics,null,2));
  console.log("[p3] Metrics written:", OUT_METRICS);

  console.log("[p3] Cache file:", CACHE_FILE);
})().catch(err=>{
  console.error("[p3] Unexpected error:", err);
  process.exit(1);
});
