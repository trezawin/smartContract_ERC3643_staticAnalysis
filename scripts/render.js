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

const PROBE_STATUS_COLORS = {
  PASS: "#10B981",
  FAIL: "#B91C1C",
  INFO: "#6B7280"
};

function statText(label, value, kind) {
  const color = STATUS_COLORS[kind] || "#374151";
  return `<span style="font-weight:600;color:${color}">${esc(label)} ${esc(String(value))}</span>`;
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

function badge(label, color) {
  if (!label) return "";
  const borderColor = color || STATUS_COLORS.META;
  return `<span style="font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;border:1px solid ${borderColor};color:${borderColor};background:#FFFFFF">${esc(label)}</span>`;
}

function deterministicBadge(status) {
  const key = String(status || "").toUpperCase();
  if (!key) return "";
  const isPass = key === "PASS";
  const color = isPass ? STATUS_COLORS.PASS : STATUS_COLORS.CRITICAL;
  const label = isPass ? "Pass" : "Fail";
  return badge(label, color);
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
  const desc = it.desc || it.description || "";
  const source = it.source || it.rulesFile || it.file || "";
  const run = it.run || it.label || "";
  const policyRef = it.policyRef || it.policy_refs || "";
  const codeRefs = it.codeReferences || it.code_refs || [];
  const pass = it.pass === true || (String(outcome).toUpperCase() === "PASS");
  return {
    id,
    title,
    desc,
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

function renderSummary(summary, metrics, coverageCounts, generatedAt) {
  const reviewDate = generatedAt
    ? (() => {
        const date = new Date(generatedAt);
        return Number.isNaN(date.getTime()) ? generatedAt : date.toISOString().slice(0, 10);
      })()
    : "—";

  const violationTable = `
  <div style="font-weight:700;margin:16px 0 4px 0">Summary of distribution</div>
  <table style="border-collapse:collapse;font-size:13px;margin:12px 0;width:100%;max-width:640px">
    <thead>
      <tr style="text-align:left">
        <th style="padding:8px 12px;border:1px solid #E5E7EB;background:#F3F4F6">Review date</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB;background:${STATUS_COLORS.PASS ? STATUS_COLORS.PASS : "#10B981"};color:#FFFFFF">Pass</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB;background:${STATUS_COLORS.LOW || "#6B7280"};color:#FFFFFF">Low</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB;background:${STATUS_COLORS.MEDIUM};color:#111827">Medium</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB;background:${STATUS_COLORS.HIGH};color:#111827">High</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB;background:${STATUS_COLORS.CRITICAL};color:#FFFFFF">Critical</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${esc(reviewDate)}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${esc(summary.pass || 0)}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${esc(summary.low || 0)}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${esc(summary.medium || 0)}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${esc(summary.high || 0)}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${esc(summary.critical || 0)}</td>
      </tr>
    </tbody>
  </table>`;

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
${violationTable}
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
  return "<!-- Per-Rulebook Execution intentionally hidden -->";
}

function renderValidatedTable(items, llm, ruleStatuses) {
  const itemList = Array.isArray(items) ? items : [];
  const findings = Array.isArray(llm?.findings) ? llm.findings : [];
  const findingMap = new Map();
  for (const f of findings) {
    if (!f || !f.id) continue;
    findingMap.set(String(f.id).toUpperCase(), f);
  }

  const rows = itemList.filter((it) => it && it.id && it.pass).map((it) => {
    const key = String(it.id).toUpperCase();
    const lf = findingMap.get(key);
    const severityOverride = lf && typeof lf.severity === "string" ? lf.severity : null;
    const severity = String(severityOverride || it.severityCode || it.severity || "").toUpperCase() || "MEDIUM";
    const severityLabelText = severityDisplay(severity);
    const severityColor = STATUS_COLORS[severity] || STATUS_COLORS.META;
    const explanation = lf?.explanation || it.note || "";
    const ruleStatus = ruleStatuses && typeof ruleStatuses.get === "function" ? ruleStatuses.get(it.id) : (it.pass ? "PASS" : "FAIL");
    const statusLabel = String(ruleStatus || "PASS").toUpperCase() === "PASS" ? "Passed" : "Off-chain";
    const title = esc(it.title || it.id || "Rule");
    const desc = esc(it.desc || "");
    return `
      <tr>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${title}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${desc}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;color:${severityColor}">${esc(severityLabelText)}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB">${esc(explanation)}</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;color:${statusLabel === "Passed" ? STATUS_COLORS.PASS : STATUS_COLORS.META}">${statusLabel}</td>
      </tr>`;
  });

  if (!rows.length) {
    return `
<div style="margin:24px 0">
  <div style="font-weight:700;margin-bottom:8px">Assessed rules</div>
  <div style="font-size:13px;color:#6B7280">No assessed rules recorded.</div>
</div>`;
  }

  return `
<div style="margin:24px 0">
  <div style="font-weight:700;margin-bottom:8px">Assessed rules</div>
  <table style="border-collapse:collapse;font-size:13px;width:100%">
    <thead>
      <tr style="background:#F3F4F6;text-align:left">
        <th style="padding:8px 12px;border:1px solid #E5E7EB">Rule title</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB">Rule description</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB">Severity</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB">Explanation</th>
        <th style="padding:8px 12px;border:1px solid #E5E7EB">Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join("\n")}
    </tbody>
  </table>
</div>`;
}

function renderLlmSection(llm, ruleStatuses) {
  if (!llm || !llm.findings) return "";
  const failed = llm.error ? `<div style="color:#B91C1C;margin-bottom:8px">${esc(llm.error)}</div>` : "";
  const disabled = llm.disabled ? `<div style="color:#2563EB;margin-bottom:8px">${esc(llm.reason || "LLM disabled.")}</div>` : "";
  const modelLine = llm.model ? `<div style="font-size:12px;color:#6B7280">Model: ${esc(llm.model)}</div>` : "";
  const findings = Array.isArray(llm.findings) ? llm.findings.map((f, idx) => ({ ...f, __idx: idx })) : [];
  const severityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const grouped = new Map();
  for (const entry of findings) {
    const rawSeverity = String(entry.severity || entry.severity_code || "").toUpperCase();
    const bucket = severityOrder.includes(rawSeverity) ? rawSeverity : (rawSeverity || "LOW");
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(entry);
  }
  let counter = 0;
  const renderCard = (f) => {
    const deterministicStatus = (() => {
      if (!ruleStatuses) return "";
      if (typeof ruleStatuses.get === "function") return ruleStatuses.get(f.id);
      if (f.id && Object.prototype.hasOwnProperty.call(ruleStatuses, f.id)) return ruleStatuses[f.id];
      return "";
    })();
    const severityCode = String(f.severity || f.severity_code || "").toUpperCase() || "MEDIUM";
    const headingColor = STATUS_COLORS[severityCode] || STATUS_COLORS.META;
    const refs = Array.isArray(f.compliance_refs) ? f.compliance_refs.filter(Boolean) : [];
    const codeRefs = Array.isArray(f.code_refs) ? f.code_refs.filter(Boolean) : [];
    const evidence = Array.isArray(f.evidence_paths) ? f.evidence_paths.filter(Boolean) : [];
    const heading = esc(f.title || "Rule");
    counter += 1;
    const badges = [
      deterministicBadge(deterministicStatus)
    ].filter(Boolean).join(" ");
    return `
    <div style="border:1px solid #E5E7EB;border-radius:10px;padding:16px;background:#F9FAFB">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px">
        <div style="font-size:16px;font-weight:600;color:${headingColor}">${esc(counter)}. ${heading}</div>
        ${badges}
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
  };
  const sectionBlocks = [];
  for (const sev of severityOrder) {
    if (!grouped.has(sev)) continue;
    const cards = grouped.get(sev).map(renderCard).join("\n");
    if (!cards) continue;
    sectionBlocks.push(`
      <div style="margin-top:16px">
        <h3 style="margin:12px 0 8px 0;font-size:18px;color:${STATUS_COLORS[sev] || STATUS_COLORS.META}">${esc(severityDisplay(sev))}</h3>
        <div style="display:flex;flex-direction:column;gap:16px">${cards}</div>
      </div>`);
  }
  const remainingKeys = Array.from(grouped.keys()).filter((key) => !severityOrder.includes(key));
  for (const sev of remainingKeys) {
    const cards = grouped.get(sev).map(renderCard).join("\n");
    if (!cards) continue;
    sectionBlocks.push(`
      <div style="margin-top:16px">
        <h3 style="margin:12px 0 8px 0;font-size:18px;color:${STATUS_COLORS[sev] || STATUS_COLORS.META}">${esc(severityDisplay(sev))} Findings</h3>
        <div style="display:flex;flex-direction:column;gap:16px">${cards}</div>
      </div>`);
  }
  const cardsHtml = sectionBlocks.length ? sectionBlocks.join("\n") : `<div style="color:#6B7280">No LLM findings available.</div>`;
  const summaryLine = llm.overallAssessment
    ? `<div style="margin:12px 0;font-size:14px;line-height:1.6"><strong>Summary:</strong> ${esc(llm.overallAssessment)}</div>`
    : "";
  return `
${sectionTitle("LLM Compliance Assessment")}
${modelLine}
${failed || disabled || ""}
${summaryLine}
${cardsHtml}`;
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

  ${renderSources(inputsBlock, sources, fallbackRulesPath)}
${renderSummary(summary, metrics, coverageCounts, raw.generatedAt || "")}
${renderValidatedTable(items, llm, ruleStatuses)}
  ${renderArtifacts(reportInfo)}
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
