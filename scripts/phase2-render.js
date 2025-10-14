/* eslint-disable */
const fs = require("fs");
const path = require("path");

function esc(x) {
  return String(x ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function outcomeBadge(pass, severity) {
  if (pass) return `<span class="badge badge--pass">PASS</span>`;
  const sev = String(severity || "").toUpperCase();
  if (sev === "FAIL") return `<span class="badge badge--fail">FAIL</span>`;
  if (sev === "WARN") return `<span class="badge badge--warn">WARN</span>`;
  return `<span class="badge badge--info">${esc(sev || "INFO")}</span>`;
}

function severityBadge(severity) {
  const sev = String(severity || "").toUpperCase();
  if (sev === "FAIL") return `<span class="badge badge--fail">FAIL</span>`;
  if (sev === "WARN") return `<span class="badge badge--warn">WARN</span>`;
  if (sev === "INFO") return `<span class="badge badge--info">INFO</span>`;
  return `<span class="badge">${esc(sev || "N/A")}</span>`;
}

function renderSummary(summary) {
  const safe = summary && typeof summary === "object"
    ? {
        pass: Number(summary.pass) || 0,
        warn: Number(summary.warn) || 0,
        fail: Number(summary.fail) || 0,
        info: Number(summary.info) || 0,
      }
    : { pass: 0, warn: 0, fail: 0, info: 0 };

  return `
    <div class="summary-grid">
      <div class="summary-card">
        <span class="summary-label">✅ Pass</span>
        <strong>${safe.pass}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">⚠️ Warn</span>
        <strong>${safe.warn}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">ℹ️ Info</span>
        <strong>${safe.info}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">❌ Fail</span>
        <strong>${safe.fail}</strong>
      </div>
    </div>
  `;
}

function main() {
  const root = process.cwd();
  const src = path.join(root, "reports", "phase2-results.json");
  const dst = path.join(root, "reports", "phase2-report.html");

  const data = JSON.parse(fs.readFileSync(src, "utf8"));
  const runs = Array.isArray(data.runs) ? data.runs : [];
  const multiRun = runs.length > 0;
  const items = Array.isArray(data.items) ? data.items : [];

  const rows = items.length === 0
    ? `<tr><td colspan="6" class="empty">No findings recorded for this run.</td></tr>`
    : items.map((it) => `
        <tr>
          <td class="set-text">${esc(it.run || (multiRun ? "" : "default"))}</td>
          <td class="rule-cell">${esc(it.id)}</td>
          <td>${esc(it.title)}</td>
          <td class="severity-text">${esc(it.severity || "N/A")}</td>
          <td>${outcomeBadge(Boolean(it.pass), it.severity)}</td>
          <td class="note">${esc(it.note || "")}</td>
        </tr>
      `).join("");

  const addressesSection = multiRun
    ? `<table class="run-table">
        <thead>
          <tr>
            <th>Set</th>
            <th>Rules</th>
            <th>Addresses</th>
            <th>Pass/Fail/Warn/Info</th>
          </tr>
        </thead>
        <tbody>
          ${runs.map((run) => {
            const summary = run.summary || {};
            return `<tr>
              <td>${esc(run.label || "")}</td>
              <td>${esc(run.rulesPath || "")}</td>
              <td>${esc(run.addressesPath || "")}</td>
              <td>${(summary.pass || 0)}/${(summary.fail || 0)}/${(summary.warn || 0)}/${(summary.info || 0)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`
    : `<pre>${esc(JSON.stringify(data.addresses, null, 2))}</pre>`;

  const rawSection = multiRun
    ? runs.map((run) => `<h3 class="section-subtitle">${esc(run.label || "")}</h3>
        <pre>${esc(JSON.stringify(run.data || {}, null, 2))}</pre>`).join("\n")
    : `<pre>${esc(JSON.stringify(data.data || {}, null, 2))}</pre>`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Phase-2 Compliance Report</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    body {
      margin: 0;
      padding: 24px 0;
      background: #f8fafc;
      color: #0f172a;
    }
    .wrapper {
      background: #fff;
      max-width: 960px;
      margin: 0 auto;
      padding: 32px;
      border-radius: 16px;
      box-shadow: 0 18px 38px -24px rgba(30, 41, 59, 0.35);
    }
    h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .meta {
      margin: 8px 0 24px;
      color: #475569;
    }
    .section-title {
      margin: 28px 0 12px;
      font-size: 18px;
      font-weight: 600;
    }
    pre {
      background: #0f172a;
      color: #e2e8f0;
      padding: 16px 20px;
      border-radius: 12px;
      overflow-x: auto;
      font-size: 12px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .summary-card {
      background: #f1f5f9;
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .summary-label {
      color: #475569;
      font-size: 13px;
    }
    .summary-card strong {
      font-size: 22px;
      color: #0f172a;
    }
    .section-subtitle {
      margin: 18px 0 8px;
      font-size: 15px;
    }
    .run-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 13px;
    }
    .run-table th, .run-table td {
      border-bottom: 1px solid #e2e8f0;
      padding: 8px;
      text-align: left;
    }
    .run-table thead th {
      background: #f1f5f9;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.04em;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    col.table-col-run { width: 120px; }
    col.table-col-rule { width: 200px; }
    col.table-col-title { width: 240px; }
    col.table-col-severity { width: 120px; }
    col.table-col-outcome { width: 120px; }
    col.table-col-notes { width: auto; }
    thead th {
      text-align: left;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 10px;
      color: #475569;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    tbody td {
      padding: 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      color: #1e293b;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #e2e8f0;
      color: #0f172a;
    }
    .badge--pass { background: rgba(34,197,94,0.18); color: #047857; }
    .badge--fail { background: rgba(248,113,113,0.25); color: #b91c1c; }
    .badge--warn { background: rgba(251,191,36,0.25); color: #b45309; }
    .badge--info { background: rgba(96,165,250,0.24); color: #1d4ed8; }
    .note {
      font-size: 13px;
      color: #475569;
      white-space: pre-wrap;
    }
    .rule-cell {
      font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      white-space: nowrap;
      letter-spacing: 0.02em;
      font-size: 13px;
    }
    .severity-text {
      font-weight: 600;
      color: #0f172a;
      letter-spacing: 0.02em;
    }
    .set-text {
      font-weight: 600;
      color: #2563eb;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .empty {
      padding: 18px;
      text-align: center;
      color: #64748b;
      background: #f8fafc;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <h1>Phase-2 Compliance Report</h1>
    <p class="meta"><strong>Generated:</strong> ${esc(data.generatedAt)}</p>

    <h2 class="section-title">Target Addresses</h2>
    ${addressesSection}

    <h2 class="section-title">Summary</h2>
    ${renderSummary(data.summary)}

    <h2 class="section-title">Rule Outcomes</h2>
    <table>
      <colgroup>
        <col class="table-col-run"/>
        <col class="table-col-rule"/>
        <col class="table-col-title"/>
        <col class="table-col-severity"/>
        <col class="table-col-outcome"/>
        <col class="table-col-notes"/>
      </colgroup>
      <thead>
        <tr>
          <th>Set</th>
          <th>Rule</th>
          <th>Title</th>
          <th>Severity</th>
          <th>Outcome</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <h2 class="section-title">Raw Data</h2>
    ${rawSection}
  </div>
</body>
</html>`;

  fs.writeFileSync(dst, html);
  console.log("[phase2] HTML written:", dst);
}

main();
