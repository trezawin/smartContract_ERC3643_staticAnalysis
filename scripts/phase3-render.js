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

function escAttr(x) {
  return String(x ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function positionBadge(position, verdict) {
  const pos = String(position || "").toUpperCase();
  const verdictNorm = String(verdict || "").trim().toLowerCase();
  if (pos === "SUPPORT") {
    let cls = "badge badge--support";
    if (verdictNorm === "fail") cls += " badge--support-fail";
    else if (verdictNorm === "warn") cls += " badge--support-warn";
    else if (verdictNorm === "info") cls += " badge--support-info";
    else cls += " badge--support-pass";
    return `<span class="${cls}">SUPPORT</span>`;
  }
  if (pos === "CHALLENGE") return `<span class="badge badge--challenge">CHALLENGE</span>`;
  if (pos === "EXTEND") return `<span class="badge badge--extend">EXTEND</span>`;
  return `<span class="badge">${esc(pos || "N/A")}</span>`;
}

function renderSummary(summary) {
  const safe = summary && typeof summary === "object"
    ? {
        pass: Number(summary.pass) || 0,
        fail: Number(summary.fail) || 0,
        warn: Number(summary.warn) || 0,
        info: Number(summary.info) || 0,
      }
    : { pass: 0, fail: 0, warn: 0, info: 0 };

  return `
    <div class="summary-grid">
      <div class="summary-card">
        <span class="summary-label">✅ Pass</span>
        <strong>${safe.pass}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">❌ Fail</span>
        <strong>${safe.fail}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">⚠️ Warn</span>
        <strong>${safe.warn}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">ℹ️ Info</span>
        <strong>${safe.info}</strong>
      </div>
    </div>
  `;
}

function renderPolicyRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return "";
  return refs.map((ref) => {
    if (!ref) return "";
    const label = esc(ref.label || ref.url || "");
    if (ref.url) {
      const href = escAttr(ref.url);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return label;
  }).filter(Boolean).join("<br/>");
}

function derivePhase2Fallback(item) {
  if (!item) return "N/A";
  if (item.pass === true) return "PASS";
  const sev = String(item.severity || "").trim().toUpperCase();
  if (sev) return sev;
  return "FAIL";
}

function main() {
  const root = process.cwd();
  const src = path.join(root, "reports", "phase3-results.json");
  if (!fs.existsSync(src)) {
    console.error("[phase3] Missing reports/phase3-results.json. Run phase3:run first.");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(src, "utf8"));

  const summary = data?.input?.phase2?.summary || { pass: 0, fail: 0, warn: 0, info: 0 };
  const items = Array.isArray(data?.result?.items) ? data.result.items : [];

  const phase2Path = path.join(root, "reports", "phase2-results.json");
  const phase2 = fs.existsSync(phase2Path) ? JSON.parse(fs.readFileSync(phase2Path, "utf8")) : null;
  const phase2Verdicts = new Map();
  if (phase2 && Array.isArray(phase2.items)) {
    for (const item of phase2.items) {
      if (item?.id) phase2Verdicts.set(item.id, item);
    }
  }

  const summaryCounts = items.reduce(
    (acc, it) => {
      const pos = String(it?.position || "").toUpperCase();
      if (pos === "SUPPORT") acc.support += 1;
      else if (pos === "CHALLENGE") acc.challenge += 1;
      else if (pos === "EXTEND") acc.extend += 1;
      return acc;
    },
    { support: 0, extend: 0, challenge: 0 }
  );
  const summaryCountsText = `Support: ${summaryCounts.support} · Extend: ${summaryCounts.extend} · Challenge: ${summaryCounts.challenge}`;
  const originalSummary = String(data?.result?.overall_summary || "").trim();
  const summaryHtml = originalSummary
    ? `${summaryCountsText}<br/><span class="overall-summary-note">${esc(originalSummary)}</span>`
    : summaryCountsText;

  const rows = items.length === 0
    ? `<tr><td colspan="6" class="empty">No LLM findings available.</td></tr>`
    : items.map((it) => {
        const phase2Verdict = it.phase2_verdict || derivePhase2Fallback(phase2Verdicts.get(it.id));
        const suggestedClass = `verdict-chip verdict-${String(it.suggested_verdict || "").trim().toLowerCase()}`;
        const positionCell = positionBadge(it.position, it.suggested_verdict || it.verdict);
        return `
        <tr>
          <td class="rule-cell">${esc(it.id)}</td>
          <td class="verdict-text">${esc(phase2Verdict)}</td>
          <td>${positionCell}</td>
          <td class="note">${esc(it.explanation || "")}</td>
          <td>${renderPolicyRefs(it.policy_refs)}</td>
          <td><span class="${suggestedClass}">${esc(it.suggested_verdict || "")}</span></td>
        </tr>
      `;
      }).join("");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Phase-3 LLM Compliance Report</title>
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
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
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
    .overall-summary {
      background: #0f172a;
      color: #e2e8f0;
      padding: 16px 20px;
      border-radius: 12px;
      white-space: pre-wrap;
      font-size: 13px;
      margin-bottom: 12px;
    }
    .overall-summary-note {
      font-weight: 500;
      color: rgba(226,232,240,0.9);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    col.table-col-rule { width: 220px; }
    col.table-col-phase2 { width: 160px; }
    col.table-col-position { width: 160px; }
    col.table-col-explanation { width: 360px; }
    col.table-col-policy { width: 180px; }
    col.table-col-verdict { width: 150px; }
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
    .badge--support { background: rgba(34,197,94,0.18); }
    .badge--support-pass { color: #047857; }
    .badge--support-fail { background: rgba(248,113,113,0.25); color: #b91c1c; }
    .badge--support-warn { background: rgba(251,191,36,0.25); color: #b45309; }
    .badge--support-info { background: rgba(96,165,250,0.24); color: #1d4ed8; }
    .badge--challenge { background: rgba(248,113,113,0.25); color: #b91c1c; }
    .badge--extend { background: rgba(96,165,250,0.24); color: #1d4ed8; }
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
    .verdict-text {
      font-weight: 600;
      color: #0f172a;
      letter-spacing: 0.02em;
    }
    .verdict-chip {
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .verdict-pass { color: #047857; }
    .verdict-fail { color: #b91c1c; }
    .verdict-warn { color: #b45309; }
    .verdict-info { color: #2563eb; }
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
    <h1>Phase-3 LLM Compliance Report</h1>
    <p class="meta">
      <strong>Generated:</strong> ${esc(data.generatedAt || "")}<br/>
      <strong>Model:</strong> ${esc(data.model || "n/a")} · <strong>Provider:</strong> ${esc(data.provider || "n/a")}
    </p>

    <h2 class="section-title">Phase 2 Snapshot</h2>
    ${renderSummary(summary)}

    <h2 class="section-title">Overall LLM Summary</h2>
    <div class="overall-summary">${summaryHtml}</div>

    <h2 class="section-title">Rule-Level Analysis</h2>
    <table>
      <colgroup>
        <col class="table-col-rule"/>
        <col class="table-col-phase2"/>
        <col class="table-col-position"/>
        <col class="table-col-explanation"/>
        <col class="table-col-policy"/>
        <col class="table-col-verdict"/>
      </colgroup>
      <thead>
        <tr>
          <th>Rule</th>
          <th>Phase 2 Verdict</th>
          <th>LLM Position</th>
          <th>Explanation</th>
          <th>Policy Refs</th>
          <th>Suggested Verdict</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`;

  const outPath = path.join(root, "reports", "phase3-report.html");
  fs.writeFileSync(outPath, html);
  console.log("[phase3] HTML written:", outPath);
}

main();
