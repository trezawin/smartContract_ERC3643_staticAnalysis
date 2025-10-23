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

const STATUS_COLORS = {
  TOTAL: "#374151",
  PASS: "#10B981",
  CRITICAL: "#B91C1C",
  HIGH: "#F97316",
  MEDIUM: "#FACC15",
  LOW: "#6B7280",
  META: "#374151"
};

const POSITION_COLORS = {
  SUPPORT: "#10B981",
  CHALLENGE: "#B91C1C",
  EXTEND: "#6366F1"
};

const PROBE_STATUS_COLORS = {
  PASS: "#10B981",
  FAIL: "#B91C1C",
  INFO: "#6B7280"
};

function statText(label, value, kind) {
  const color = STATUS_COLORS[kind] || "#374151";
  return `<span style="font-weight:600;color:${color}">${esc(label)} ${esc(String(value))}</span>`;
}

function positionText(kind) {
  const key = String(kind || "").toUpperCase();
  const map = { SUPPORT: "Support", CHALLENGE: "Challenge", EXTEND: "Extend", PASS: "Support" };
  const label = map[key] || (key ? key.charAt(0) + key.slice(1).toLowerCase() : "");
  const color = POSITION_COLORS[key] || (key === "PASS" ? POSITION_COLORS.SUPPORT : STATUS_COLORS.META);
  return label ? `<span style="font-weight:600;color:${color}">${esc(label)}</span>` : "";
}

function ruleStatusTag(status) {
  if (status == null) return "";
  const key = String(status).trim().toUpperCase();
  if (!key) return "";
  const label = key === "PASS" ? "Pass" : key === "FAIL" ? "Fail" : key.charAt(0) + key.slice(1).toLowerCase();
  const color = key === "PASS" ? STATUS_COLORS.PASS : key === "FAIL" ? STATUS_COLORS.CRITICAL : STATUS_COLORS.META;
  return `<span style="font-weight:600;color:${color}">${esc(label)}</span>`;
}

function probeBadge(id, status) {
  const key = String(status || "").toUpperCase();
  const color = PROBE_STATUS_COLORS[key] || STATUS_COLORS.META;
  const labelMap = { PASS: "Pass", FAIL: "Fail", INFO: "Info" };
  const label = labelMap[key] || (key ? key.charAt(0) + key.slice(1).toLowerCase() : "");
  return `<span style="font-weight:600;color:${color}">${esc(id)}${label ? ` (${esc(label)})` : ""}</span>`;
}

function severityTag(kind) {
  const key = String(kind || "").toUpperCase();
  const label = severityDisplay(key);
  const color = STATUS_COLORS[key] || STATUS_COLORS.META;
  return `<span style="font-weight:600;color:${color}">${esc(label)}</span>`;
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
  const codeRefs = it.codeReferences || it.code_refs || [];
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
    codeReferences: codeRefs,
    outcome: String(outcome).toUpperCase()
  };
}

function computeCoverageDistribution(findings) {
  const counts = { SUPPORT: 0, CHALLENGE: 0, EXTEND: 0 };
  if (Array.isArray(findings)) {
    for (const f of findings) {
      const key = String(f?.position || f?.verdict || '').toUpperCase();
      if (key === 'SUPPORT' || key === 'PASS') counts.SUPPORT += 1;
      else if (key === 'CHALLENGE' || key === 'FAIL') counts.CHALLENGE += 1;
      else if (key === 'EXTEND' || key === 'NEW') counts.EXTEND += 1;
    }
  }
  return counts;
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

function renderSummary(summary, metrics, coverageCounts) {
  const statLine = [
    statText("Total", summary.total || 0, "TOTAL"),
    statText("Pass", summary.pass || 0, "PASS"),
    statText("Critical", summary.critical || 0, "CRITICAL"),
    statText("High", summary.high || 0, "HIGH"),
    statText("Medium", summary.medium || 0, "MEDIUM"),
    statText("Low", summary.low || 0, "LOW")
  ].join('<span style="width:8px;display:inline-block"></span>');

const metricsLine = (() => {
  const sections = [];
  if (metrics) {
    sections.push(`
    <div style="min-width:220px;flex:1 1 220px">
      <div style="font-weight:700;margin-bottom:6px">Metrics vs Ground Truth</div>
      <table style="border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#F9FAFB;text-align:left">
            <th style="padding:6px 10px;border:1px solid #E5E7EB">Metric</th>
            <th style="padding:6px 10px;border:1px solid #E5E7EB">Value</th>
          </tr>
        </thead>
        <tbody>
                    <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Status</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(summary.pass === summary.total ? "PASS" : "FAIL")}</td></tr>
<tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Compared</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(metrics.compared || 0)}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Precision</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(((metrics.precision||0)*100).toFixed(1))}%</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Recall</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(((metrics.recall||0)*100).toFixed(1))}%</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">F1</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(((metrics.f1||0)*100).toFixed(1))}%</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Accuracy</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(((metrics.accuracy||0)*100).toFixed(1))}%</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">TP</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(metrics.tp || 0)}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">FP</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(metrics.fp || 0)}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">TN</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(metrics.tn || 0)}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">FN</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(metrics.fn || 0)}</td></tr>
        </tbody>
      </table>
    </div>
    `);
  }
  if (coverageCounts) {
    sections.push(`
    <div style="min-width:220px;flex:1 1 220px">
      <div style="font-weight:700;margin-bottom:6px">Coverage Expansion</div>
      <table style="border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#F9FAFB;text-align:left">
            <th style="padding:6px 10px;border:1px solid #E5E7EB">Verdict</th>
            <th style="padding:6px 10px;border:1px solid #E5E7EB">Count</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Support</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(coverageCounts.SUPPORT || 0)}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Challenge</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(coverageCounts.CHALLENGE || 0)}</td></tr>
          <tr><td style="padding:6px 10px;border:1px solid #E5E7EB">Extend</td><td style="padding:6px 10px;border:1px solid #E5E7EB">${esc(coverageCounts.EXTEND || 0)}</td></tr>
        </tbody>
      </table>
    </div>
    `);
  }
  if (!sections.length) return "";
  const disagreementsBlock = (metrics && metrics.disagreements && metrics.disagreements.length) ? `
  <details style="margin:10px 0"><summary style="cursor:pointer">Disagreements (${metrics.disagreements.length})</summary>
    <ul style="margin-top:8px">
      ${metrics.disagreements.map(d => `<li><code>${esc(d.id||"")}</code> → expected <b>${esc(d.expected||"")}</b>, got <b>${esc(d.predicted||"")}</b> ${d.note?`— ${esc(d.note)}`:""}</li>`).join("")}
    </ul>
  </details>` : "";
  return `
<div style="margin:8px 0 20px 0">
  <div style="display:flex;gap:20px;flex-wrap:wrap">${sections.join('')}</div>${disagreementsBlock}
</div>
`;
})();

  return `
<div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0">
  ${statLine}
</div>
${metricsLine}`;
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
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          ${statText("Pass", summary.pass || 0, "PASS")}
          ${statText("Critical", summary.critical || 0, "CRITICAL")}
          ${statText("High", summary.high || 0, "HIGH")}
          ${statText("Medium", summary.medium || 0, "MEDIUM")}
          ${statText("Low", summary.low || 0, "LOW")}
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
            return `<li style="margin-bottom:4px">${probeBadge(id, status)} <span style="margin-left:6px">${esc(pr.evidence||"")}</span></li>`;
          }).join("")}
        </ul>
      </details>` : ""}
    </div>`;
  }).join("")}
</div>`;
}

function renderLlmSection(llm, ruleStatuses) {
  if (!llm || !llm.findings) return "";
  const failed = llm.error ? `<div style="color:#B91C1C;margin-bottom:8px">${esc(llm.error)}</div>` : "";
  const disabled = llm.disabled ? `<div style="color:#2563EB;margin-bottom:8px">${esc(llm.reason || "LLM disabled.")}</div>` : "";
  const modelLine = llm.model ? `<div style="font-size:12px;color:#6B7280">Model: ${esc(llm.model)}</div>` : "";
  const cards = (Array.isArray(llm.findings) ? llm.findings : []).map((f, idx) => {
    const severityCode = String(f.severity || f.severity_code || "").toUpperCase();
    const verdict = String(f.verdict || f.phase2_verdict || "").toUpperCase();
    const position = String(f.position || "").toUpperCase();
    const verdictKind = position || verdict || "PASS";
    const deterministicStatus = (() => {
      if (!ruleStatuses) return "";
      if (typeof ruleStatuses.get === "function") return ruleStatuses.get(f.id);
      if (f.id && Object.prototype.hasOwnProperty.call(ruleStatuses, f.id)) return ruleStatuses[f.id];
      return "";
    })();
    const refs = Array.isArray(f.compliance_refs) ? f.compliance_refs.filter(Boolean) : [];
    const codeRefs = Array.isArray(f.code_refs) ? f.code_refs.filter(Boolean) : [];
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
        ${severityTag(severityCode || "MEDIUM")}
        ${positionText(verdictKind)}
        ${deterministicStatus ? ruleStatusTag(deterministicStatus) : ""}
      </div>
      ${f.explanation ? `<div style="font-size:14px;line-height:1.6;margin-bottom:10px">${esc(f.explanation)}</div>` : ""}
      ${refs.length ? `<div style="font-size:13px;margin-bottom:6px"><strong>Compliance Ref:</strong> ${joinList(refs, "; ")}</div>` : ""}
      ${codeRefs.length ? `<div style="font-size:13px;margin-bottom:6px"><strong>Code Reference:</strong>
        <ul style="margin:6px 0 0 16px">${codeRefs.map(ref => `<li><code>${esc(ref)}</code></li>`).join("")}</ul>
      </div>` : ""}
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
  const ruleStatuses = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    const outcome = String(item.outcome || "").toUpperCase();
    if (item.pass === true || outcome === "PASS") {
      ruleStatuses.set(item.id, "PASS");
    } else if (item.pass === false || outcome === "FAIL" || outcome === "CRITICAL" || outcome === "HIGH" || outcome === "MEDIUM" || outcome === "LOW") {
      // Treat non-pass outcomes as fail for status tagging
      ruleStatuses.set(item.id, "FAIL");
    }
  }

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
const coverageCounts = raw.coverageDistribution || (llm ? computeCoverageDistribution(llm.findings) : null);
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

${renderSummary(summary, metrics, coverageCounts)}
  ${renderArtifacts(reportInfo)}
  ${renderSources(inputsBlock, sources, fallbackRulesPath)}
  ${renderRunDetails(runs)}
  ${renderLlmSection(llm, ruleStatuses)}

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
