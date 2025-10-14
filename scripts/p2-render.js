/* eslint-disable */
//
// Phase 2 (STATIC) — HTML renderer (robust to different p2-check.js shapes)
// Usage:
//   node scripts/p2-render.js
//   node scripts/p2-render.js --input reports/p2-static-results.json --output reports/p2-static-report.html
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
    META:"background:#374151;color:#fff"
  };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-weight:600;${colors[kind]||colors.INFO}">${esc(text)}</span>`;
}

function normalizeItem(it) {
  // Accept various shapes coming from p2-check.js
  const outcome = (it.outcome || (it.pass === true ? "PASS" : (String(it.severity||"").toUpperCase() || "INFO")));
  const severity = String(it.severity || it.level || "INFO").toUpperCase();
  const note = it.note || it.message || it.details || "";
  const id = it.id || it.ruleId || it.code || "";
  const title = it.title || it.name || it.rule || "";
  const source = it.source || it.rulesFile || it.file || "";
  const pass = it.pass === true || (String(outcome).toUpperCase() === "PASS");
  return { id, title, severity, pass, note, source, outcome: String(outcome).toUpperCase() };
}

function computeSummary(items) {
  const total = items.length;
  let pass=0, fail=0, warn=0, info=0;
  for (const it of items) {
    if (it.pass) { pass++; continue; }
    const sev = String(it.severity||"").toUpperCase();
    if (sev === "FAIL") fail++;
    else if (sev === "WARN") warn++;
    else info++;
  }
  return { total, pass, fail, warn, info };
}

function renderSummary(summary, metrics) {
  return `
<div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0">
  <div>${pill("Total", "META")} <strong style="margin-left:6px">${summary.total}</strong></div>
  <div>${pill("Pass", "PASS")} <strong style="margin-left:6px">${summary.pass}</strong></div>
  <div>${pill("Warn", "WARN")} <strong style="margin-left:6px">${summary.warn}</strong></div>
  <div>${pill("Fail", "FAIL")} <strong style="margin-left:6px">${summary.fail}</strong></div>
  <div>${pill("Info", "INFO")} <strong style="margin-left:6px">${summary.info}</strong></div>
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

function renderSources(sources, addressesPath, abipaths, rulesPath) {
  const list = sources && sources.length ? sources : (
    rulesPath ? [{ source: rulesPath, pass: null, count: null }] : []
  );
  return `
<div style="margin:16px 0">
  <div style="font-weight:700;margin-bottom:6px">Inputs</div>
  <div style="font-size:13px;color:#374151">
    ${addressesPath?`<div>Addresses: <code>${esc(addressesPath)}</code></div>`:""}
    ${abipaths?`<div>ABIs map : <code>${esc(abipaths)}</code></div>`:""}
    ${rulesPath?`<div>Rules   : <code>${esc(rulesPath)}</code></div>`:""}
  </div>
  ${list.length ? `<ul style="margin-top:8px">
    ${list.map(s => `<li>${esc(s.source)}${(s.pass!=null&&s.count!=null)?` — <i>${s.pass}/${s.count} passed</i>`:""}</li>`).join("")}
  </ul>` : ""}
</div>`;
}

function outcomeLabel(item){
  // prefer explicit outcome if provided; otherwise derive from pass/severity
  if (item.outcome && ["PASS","FAIL","WARN","INFO"].includes(item.outcome)) {
    return pill(item.outcome, item.outcome);
  }
  if (item.pass) return pill("PASS","PASS");
  const sev = String(item.severity||"").toUpperCase();
  if (sev === "FAIL") return pill("FAIL","FAIL");
  if (sev === "WARN") return pill("WARN","WARN");
  return pill("INFO","INFO");
}

function renderTable(items) {
  return `
<table style="width:100%;border-collapse:collapse;border-spacing:0;font-size:14px">
  <thead>
    <tr style="text-align:left;background:#F9FAFB">
      <th style="padding:10px;border-bottom:1px solid #E5E7EB">ID</th>
      <th style="padding:10px;border-bottom:1px solid #E5E7EB">Title</th>
      <th style="padding:10px;border-bottom:1px solid #E5E7EB">Severity</th>
      <th style="padding:10px;border-bottom:1px solid #E5E7EB">Outcome</th>
      <th style="padding:10px;border-bottom:1px solid #E5E7EB">Notes</th>
      <th style="padding:10px;border-bottom:1px solid #E5E7EB">Rules File</th>
    </tr>
  </thead>
  <tbody>
    ${items.map(it => `
      <tr>
        <td style="padding:10px;border-top:1px solid #F3F4F6;white-space:nowrap"><code>${esc(it.id||"")}</code></td>
        <td style="padding:10px;border-top:1px solid #F3F4F6">${esc(it.title||"")}</td>
        <td style="padding:10px;border-top:1px solid #F3F4F6">${pill(String(it.severity||"INFO").toUpperCase(), String(it.severity||"INFO").toUpperCase())}</td>
        <td style="padding:10px;border-top:1px solid #F3F4F6">${outcomeLabel(it)}</td>
        <td style="padding:10px;border-top:1px solid #F3F4F6">${esc(it.note||"")}</td>
        <td style="padding:10px;border-top:1px solid #F3F4F6"><code>${esc(it.source||"")}</code></td>
      </tr>
    `).join("")}
  </tbody>
</table>`;
}

// ---------- main ----------
function main(){
  const root = process.cwd();
  const args = process.argv.slice(2);
  let input = path.join(root, "reports", "p2-results.json");
  let output = path.join(root, "reports", "p2-report.html");

  for (let i=0;i<args.length;i++){
    const t = args[i];
    if (t === "--input" && args[i+1]) { input = path.isAbsolute(args[++i]) ? args[i] : path.join(root, args[i]); continue; }
    if (t.startsWith("--input=")) { const v = t.slice(8); input = path.isAbsolute(v)?v:path.join(root,v); continue; }
    if (t === "--output" && args[i+1]) { output = path.isAbsolute(args[++i]) ? args[i] : path.join(root, args[i]); continue; }
    if (t.startsWith("--output=")) { const v = t.slice(9); output = path.isAbsolute(v)?v:path.join(root,v); continue; }
  }

  if (!fs.existsSync(input)) {
    console.error(`[p2-render] Input not found: ${input}`);
    process.exit(1);
  }

  // Read and normalize possible shapes
  const raw = readJson(input);
  const rulesPath = raw.rulesPath || raw.rulesFile || (raw.inputs && raw.inputs.rules) || "";
  const addressesPath = raw.addressesPath || raw.addresses || (raw.inputs && raw.inputs.addresses) || "";
  const abipaths = raw.abipaths || (raw.inputs && raw.inputs.abipaths) || "";

  const rawItems = raw.items || (raw.results && raw.results.items) || raw.findings || [];
  const items = rawItems.map(normalizeItem);

  const summary = raw.summary || computeSummary(items);
  const metrics = raw.metrics || null;
  const sources = raw.sources || null;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Phase 2 (Static) Report</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Noto Sans", "Helvetica Neue", sans-serif; color:#111827; margin:24px; }
  h1 { font-size:24px; margin:0 0 4px 0; }
  .sub { color:#6B7280; font-size:13px; }
</style>
</head>
<body>
  <h1>Phase 2 — Static Compliance Report</h1>
  <div class="sub">
    Generated: ${esc(raw.generatedAt||"")} — Mode: ${esc(raw.mode||"static")}
  </div>

  ${renderSummary(summary, metrics)}
  ${renderSources(sources, addressesPath, abipaths, rulesPath)}
  ${renderTable(items)}

  <div style="margin-top:28px;color:#6B7280;font-size:12px">
    Inputs are derived from ABIs (no on-chain calls) unless otherwise noted. Outcomes reflect rules logic only.
  </div>
</body>
</html>`;

  ensureDir(path.dirname(output));
  fs.writeFileSync(output, html);
  console.log(`[p2-render] HTML written: ${output}`);
}

main();