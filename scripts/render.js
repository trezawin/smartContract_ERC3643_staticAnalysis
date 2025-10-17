/* eslint-disable */
//
// ERC-3643 compliance report renderer (deterministic checks + LLM reasoning)
// Usage:
//   node scripts/render.js
//   node scripts/render.js --input reports/static-results.json --output reports/static-report.html
//
const fs = require("fs");
const path = require("path");

// ---------- utils ----------
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function pill(text, kind) {
  const colors = {
    PASS:"background:#10B981;color:#fff",
    FAIL:"background:#EF4444;color:#fff",
    WARN:"background:#F59E0B;color:#111",
    INFO:"background:#6B7280;color:#fff",
    CRITICAL:"background:#B91C1C;color:#fff",
    HIGH:"background:#F97316;color:#111",
    MEDIUM:"background:#FACC15;color:#111",
    LOW:"background:#6B7280;color:#fff",
    META:"background:#374151;color:#fff"
  };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-weight:600;${colors[kind]||colors.INFO}">${esc(text)}</span>`;
}

function sectionTitle(text) {
  return `<h2 style="margin:28px 0 12px 0;font-size:20px;border-bottom:1px solid #E5E7EB;padding-bottom:6px">${esc(text)}</h2>`;
}

function joinList(values, separator = ", ") {
  if (!Array.isArray(values) || values.length === 0) return "";
  return values.map((v) => esc(v)).join(separator);
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

function severityLabel(value) {
  const key = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (key === "PASS") return "Pass";
  return normalizeSeverityValue(value).label;
}

function severityWeight(value) {
  const key = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (key === "PASS") return 0;
  return normalizeSeverityValue(value).weight;
}

function severityDisplay(severity) {
  if (!severity) return "Informational";
  const info = normalizeSeverityValue(severity);
  return info.label;
}

function normalizeItem(it) {
  // Accept various shapes coming from check.js
  const outcome = (it.outcome || (it.pass === true ? "PASS" : (String(it.severity||"").toUpperCase() || "INFO")));
  const severitySource = it.severityCode || it.severity || it.level || "MEDIUM";
  const severityInfo = normalizeSeverityValue(severitySource);
  const note = it.note || it.message || it.details || "";
  const id = it.id || it.ruleId || it.code || "";
  const title = it.title || it.name || it.rule || "";
  const source = it.source || it.rulesFile || it.file || "";
  const run = it.run || it.label || "";
  const policyRef = it.policyRef || it.policy_refs || "";
  const pass = it.pass === true || (String(outcome).toUpperCase() === "PASS");
  return {
    id,
    title,
    severity: severityInfo.code,
    severityCode: severityInfo.code,
    severityLabel: severityInfo.label,
    severityOriginal: severityInfo.original,
    pass,
    note,
    source,
    run,
    policyRef,
    outcome: String(outcome).toUpperCase()
  };
}

function computeSummary(items) {
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
  for (const it of items) {
    if (it && it.pass) {
      summary.pass += 1;
      continue;
    }
    const sev = String(it?.severityCode || it?.severity || "").toUpperCase();
    if (sev === "CRITICAL") summary.critical += 1;
    else if (sev === "HIGH") summary.high += 1;
    else if (sev === "MEDIUM") summary.medium += 1;
    else summary.low += 1;
  }
  summary.fail = summary.critical;
  summary.warn = summary.high + summary.medium;
  summary.info = summary.low;
  return summary;
}

function renderSummary(summary, metrics) {
  return `
<div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0">
  <div>${pill("Total", "META")} <strong style="margin-left:6px">${summary.total}</strong></div>
  <div>${pill("Pass", "PASS")} <strong style="margin-left:6px">${summary.pass}</strong></div>
  <div>${pill("Critical", "CRITICAL")} <strong style="margin-left:6px">${summary.critical || 0}</strong></div>
  <div>${pill("High", "HIGH")} <strong style="margin-left:6px">${summary.high || 0}</strong></div>
  <div>${pill("Medium", "MEDIUM")} <strong style="margin-left:6px">${summary.medium || 0}</strong></div>
  <div>${pill("Low", "LOW")} <strong style="margin-left:6px">${summary.low || 0}</strong></div>
</div>
${metrics ? `
<div style="margin:8px 0 20px 0">
  <div style="font-weight:700;margin-bottom:6px">Metrics vs Ground Truth</div>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <div>${pill("Compared", "META")} <strong style="margin-left:6px">${metrics.compared}</strong></div>
    <div>${pill("Precision", "META")} <strong style="margin-left:6px">${((metrics.precision||0)*100).toFixed(1)}%</strong></div>
    <div>${pill("Recall", "META")} <strong style="margin-left:6px">${((metrics.recall||0)*100).toFixed(1)}%</strong></div>
    <div>${pill("F1", "META")} <strong style="margin-left:6px">${((metrics.f1||0)*100).toFixed(1)}%</strong></div>
    <div>${pill("Accuracy", "META")} <strong style="margin-left:6px">${((metrics.accuracy||0)*100).toFixed(1)}%</strong></div>
    <div>${pill("TP", "META")} <strong style="margin-left:6px">${metrics.tp||0}</strong></div>
    <div>${pill("FP", "META")} <strong style="margin-left:6px">${metrics.fp||0}</strong></div>
    <div>${pill("TN", "META")} <strong style="margin-left:6px">${metrics.tn||0}</strong></div>
    <div>${pill("FN", "META")} <strong style="margin-left:6px">${metrics.fn||0}</strong></div>
  </div>
</div>
${metrics.disagreements && metrics.disagreements.length ? `
  <details style="margin:10px 0"><summary style="cursor:pointer">Disagreements (${metrics.disagreements.length})</summary>
    <ul style="margin-top:8px">
      ${metrics.disagreements.map(d => `<li><code>${esc(d.id||"")}</code> → expected <b>${esc(d.expected||"")}</b>, got <b>${esc(d.predicted||"")}</b> ${d.note?`— ${esc(d.note)}`:""}</li>`).join("")}
    </ul>
  </details>` : ""}` : ""}`;
}

function renderSources(inputs, sources, fallbackRulesPath) {
  const addressesPath = inputs?.addressesPath || inputs?.addressesFile || "";
  const addressesObj = (inputs && typeof inputs.addresses === "object") ? inputs.addresses : null;
  const ruleFiles = Array.isArray(inputs?.ruleFiles) && inputs.ruleFiles.length
    ? inputs.ruleFiles
    : (fallbackRulesPath ? [fallbackRulesPath] : []);
  const abiArtifacts = (inputs && typeof inputs.abiArtifacts === "object") ? inputs.abiArtifacts : null;
  const abiList = abiArtifacts ? Object.entries(abiArtifacts).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`) : [];
  const list = sources && sources.length ? sources : (ruleFiles.length ? ruleFiles.map(r => ({ source: r, pass: null, count: null })) : []);
  return `
<div style="margin:16px 0">
  <div style="font-weight:700;margin-bottom:6px">Inputs</div>
  <div style="font-size:13px;color:#374151">
    ${addressesPath?`<div>Addresses file: <code>${esc(addressesPath)}</code></div>`:""}
    ${ruleFiles.length?`<div>Rules: ${ruleFiles.map(r => `<code>${esc(r)}</code>`).join(", ")}</div>`:""}
    ${abiList.length?`<div>ABI artifacts: ${abiList.map(entry => `<code>${esc(entry)}</code>`).join(", ")}</div>`:""}
  </div>
  ${list.length ? `<ul style="margin-top:8px">
    ${list.map(s => `<li>${esc(s.source)}${(s.pass!=null&&s.count!=null)?` — <i>${s.pass}/${s.count} passed</i>`:""}</li>`).join("")}
  </ul>` : ""}
  ${addressesObj ? `<details style="margin-top:10px;font-size:13px"><summary style="cursor:pointer">Resolved addresses</summary>
    <ul style="margin-top:8px">${Object.entries(addressesObj).map(([k,v]) => `<li><code>${esc(k)}</code> → <code>${esc(v)}</code></li>`).join("")}</ul>
  </details>` : ""}
</div>`;
}

function renderRunDetails(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return "";
  return `
${sectionTitle("Per-Rulebook Execution")}
<div style="display:flex;flex-direction:column;gap:16px">
  ${runs.map(run => {
    const summary = run.summary || {};
    const metrics = run.metrics || {};
    const probes = run.probes || {};
    const probeKeys = Object.keys(probes);
    return `
    <div style="border:1px solid #E5E7EB;border-radius:10px;padding:16px;background:#FFFFFF">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:16px;font-weight:600">${esc(run.label||run.rulesPath||"Unnamed Ruleset")}</div>
          <div style="font-size:13px;color:#6B7280">${run.rulesPath?`Rules: <code>${esc(run.rulesPath)}</code>`:""}${run.addressesPath?` · Addresses: <code>${esc(run.addressesPath)}</code>`:""}</div>
          ${run.data && run.data.executionMode ? `<div style="font-size:12px;color:#6B7280">Execution: ${esc(run.data.executionMode)}</div>` : ""}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${pill(`Pass ${summary.pass||0}`, "PASS")}
          ${pill(`Critical ${summary.critical||0}`, "CRITICAL")}
          ${pill(`High ${summary.high||0}`, "HIGH")}
          ${pill(`Medium ${summary.medium||0}`, "MEDIUM")}
          ${pill(`Low ${summary.low||0}`, "LOW")}
        </div>
      </div>
      ${(metrics && metrics.compared) ? `
      <div style="margin-top:10px;font-size:12px;color:#4B5563">
        GT precision ${(metrics.precision*100||0).toFixed(1)}% · recall ${(metrics.recall*100||0).toFixed(1)}% · accuracy ${(metrics.accuracy*100||0).toFixed(1)}%
      </div>` : ""}
      ${probeKeys.length ? `
      <details style="margin-top:12px;font-size:13px">
        <summary style="cursor:pointer">Runtime probes (${probeKeys.length})</summary>
        <ul style="margin-top:8px">
          ${probeKeys.map(id => {
            const pr = probes[id] || {};
            const status = pr.pass === true ? "PASS" : pr.pass === false ? "FAIL" : "INFO";
            return `<li style="margin-bottom:4px">${pill(id, status)} <span style="margin-left:6px">${esc(pr.evidence||"")}</span></li>`;
          }).join("")}
        </ul>
      </details>` : ""}
    </div>`;
  }).join("")}
</div>`;
}

function renderLlmSection(llm) {
  if (!llm || !llm.findings) return "";
  const failed = llm.error ? `<div style="color:#B91C1C;margin-bottom:8px">${esc(llm.error)}</div>` : "";
  const disabled = llm.disabled ? `<div style="color:#2563EB;margin-bottom:8px">${esc(llm.reason || "LLM disabled.")}</div>` : "";
  const modelLine = llm.model ? `<div style="font-size:12px;color:#6B7280">Model: ${esc(llm.model)}</div>` : "";
  const cards = (Array.isArray(llm.findings) ? llm.findings : []).map((f, idx) => {
    const severityCode = String(f.severity || f.severity_code || "").toUpperCase();
    const severityText = f.severity_label || severityDisplay(severityCode);
    const verdict = String(f.verdict || f.phase2_verdict || "").toUpperCase();
    const position = String(f.position || "").toUpperCase();
    const refs = Array.isArray(f.compliance_refs) ? f.compliance_refs.filter(Boolean) : [];
    const evidence = Array.isArray(f.evidence_paths) ? f.evidence_paths.filter(Boolean) : [];
    const heading = (() => {
      if (f.id) {
        const titlePart = f.title ? ` — ${esc(f.title)}` : "";
        return `<code>${esc(f.id)}</code>${titlePart}`;
      }
      return esc(f.title || "Rule");
    })();
    return `
    <div style="border:1px solid #E5E7EB;border-radius:10px;padding:16px;background:#F9FAFB">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
        <div style="font-size:16px;font-weight:600">${esc(idx+1)}. ${heading}</div>
        ${pill(severityText, severityCode || "MEDIUM")}
        ${verdict ? pill(`Verdict ${verdict}`, verdict) : ""}
        ${position ? pill(position, "META") : ""}
      </div>
      ${f.explanation ? `<div style="font-size:14px;line-height:1.6;margin-bottom:10px">${esc(f.explanation)}</div>` : ""}
      ${refs.length ? `<div style="font-size:13px;margin-bottom:6px"><strong>Compliance Ref:</strong> ${joinList(refs, "; ")}</div>` : ""}
      ${evidence.length ? `<div style="font-size:13px;margin-bottom:6px"><strong>Evidence Paths:</strong>
        <ul style="margin:6px 0 0 16px">${evidence.map(e => `<li><code>${esc(e)}</code></li>`).join("")}</ul>
      </div>` : ""}
      ${f.recommendation ? `<div style="font-size:13px"><strong>Recommendation:</strong> ${esc(f.recommendation)}</div>` : ""}
    </div>`;
  }).join("");
  const summaryLine = llm.overallAssessment
    ? `<div style="margin:12px 0;font-size:14px;line-height:1.6"><strong>Summary:</strong> ${esc(llm.overallAssessment)}</div>`
    : "";
  return `
${sectionTitle("LLM Compliance Assessment")}
${modelLine}
${failed || disabled || ""}
${summaryLine}
<div style="display:flex;flex-direction:column;gap:16px">
  ${cards || `<div style="color:#6B7280">No LLM findings available.</div>`}
</div>`;
}

function renderArtifacts(reportInfo) {
  if (!reportInfo) return "";
  const textPath = typeof reportInfo === "string" ? reportInfo : (reportInfo && reportInfo.textPath);
  if (!textPath) return "";
  return `
<div style="margin:16px 0;font-size:13px;color:#4B5563">
  Additional artifacts: <code>${esc(textPath)}</code>
</div>`;
}

// ---------- main ----------
function main(){
  const root = process.cwd();
  const args = process.argv.slice(2);
  let input = path.join(root, "reports", "results.json");
  let output = path.join(root, "reports", "report.html");

  for (let i=0;i<args.length;i++){
    const t = args[i];
    if (t === "--input" && args[i+1]) { input = path.isAbsolute(args[++i]) ? args[i] : path.join(root, args[i]); continue; }
    if (t.startsWith("--input=")) { const v = t.slice(8); input = path.isAbsolute(v)?v:path.join(root,v); continue; }
    if (t === "--output" && args[i+1]) { output = path.isAbsolute(args[++i]) ? args[i] : path.join(root, args[i]); continue; }
    if (t.startsWith("--output=")) { const v = t.slice(9); output = path.isAbsolute(v)?v:path.join(root,v); continue; }
  }

  if (!fs.existsSync(input)) {
    console.error(`[render] Input not found: ${input}`);
    process.exit(1);
  }

  // Read and normalize possible shapes
  const raw = readJson(input);
  const inputsBlock = raw.inputs || {};
  const fallbackRulesPath = raw.rulesPath || raw.rulesFile || inputsBlock.rules || "";

  const rawItems = raw.items || (raw.results && raw.results.items) || raw.findings || [];
  const items = rawItems.map(normalizeItem);

  const summaryRaw = raw.summary
    ? Object.assign({ total: items.length }, raw.summary)
    : computeSummary(items);
  const summary = Object.assign({
    total: items.length,
    pass: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    fail: 0,
    warn: 0,
    info: 0
  }, summaryRaw);
  const metrics = raw.metrics || null;
  const sources = raw.sources || null;
  const runs = raw.runs || null;
  const llm = raw.llm || null;
  const reportInfo = raw.report || null;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Report</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue", sans-serif; color:#111827; margin:24px; }
  h1 { font-size:24px; margin:0 0 4px 0; }
  .sub { color:#6B7280; font-size:13px; }
</style>
</head>
<body>
  <h1>ERC-3643 Compliance Report</h1>
  <div class="sub">
    Generated: ${esc(raw.generatedAt||"")} — Deterministic checks + LLM reasoning
  </div>

  ${renderSummary(summary, metrics)}
  ${renderArtifacts(reportInfo)}
  ${renderSources(inputsBlock, sources, fallbackRulesPath)}
  ${renderRunDetails(runs)}
  ${renderLlmSection(llm)}

  <div style="margin-top:28px;color:#6B7280;font-size:12px">
    Evidence combines deterministic probes (Hardhat fallback when available) and policy-grounded LLM analysis.
  </div>
</body>
</html>`;

  ensureDir(path.dirname(output));
  fs.writeFileSync(output, html);
  console.log(`[render] HTML written: ${output}`);
}

main();
