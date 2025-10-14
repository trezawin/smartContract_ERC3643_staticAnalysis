/* eslint-disable */
const fs = require("fs");
const path = require("path");

// Helper to robustly collect items from various shapes of p3-results JSON (deep traversal)
function collectItems(root) {
  const out = [];
  const seen = new Set();

  function isRuleLike(x) {
    if (!x || typeof x !== 'object') return false;
    // A rule-like object should have an id (string) and at least one of these fields
    // used later by the renderer.
    if (typeof x.id !== 'string') return false;
    if (
      'position' in x || 'llm_position' in x || 'stance' in x ||
      'suggested_verdict' in x || 'llm_verdict' in x || 'verdict' in x ||
      'explanation' in x || 'reason' in x || 'note' in x || 'details' in x
    ) {
      return true;
    }
    return false;
  }

  function visit(node) {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const el of node) visit(el);
      return;
    }

    if (typeof node === 'object') {
      if (isRuleLike(node)) {
        const key = node.id;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(node);
        }
      }
      // Visit common containers first to maximize coverage
      const keys = [
        'items','findings','rules','groups','sets',
        'result','llm','input','phase3','phase2'
      ];
      for (const k of keys) if (k in node) visit(node[k]);
      // Fallback: traverse any other enumerable properties (to catch unknown shapes)
      for (const k of Object.keys(node)) {
        if (!keys.includes(k)) visit(node[k]);
      }
    }
  }

  visit(root);
  return out;
}

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
  const toUrl = (s) => {
    try {
      const u = new URL(s);
      return u.href;
    } catch {
      return null;
    }
  };
  return refs.map((ref) => {
    if (!ref) return "";
    if (typeof ref === "string") {
      const maybe = toUrl(ref);
      if (maybe) return `<a href="${escAttr(maybe)}" target="_blank" rel="noopener noreferrer">${esc(maybe)}</a>`;
      return esc(ref);
    }
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
  if (typeof item === "string") return item.toUpperCase();
  if (item.pass === true) return "PASS";
  if (typeof item.verdict === "string" && item.verdict) return String(item.verdict).toUpperCase();
  const sev = String(item.severity || "").trim().toUpperCase();
  if (sev) return sev;
  return "FAIL";
}

function main() {
  const root = process.cwd();
  let src = path.join(root, 'reports', 'p3-results.json');
  if (!fs.existsSync(src)) {
    const alt = path.join(root, 'reports', 'p3-result.json');
    if (fs.existsSync(alt)) src = alt;
  }
  if (!fs.existsSync(src)) {
    console.error('[phase3] Missing reports/p3-results.json (or p3-result.json). Run phase3:run first.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(src, "utf8"));
  const metricsPath = path.join(root, "reports", "p3-metrics.json");
  const metrics = fs.existsSync(metricsPath)
    ? JSON.parse(fs.readFileSync(metricsPath, "utf8"))
    : null;

  const summary =
    metrics?.phase2?.summary ||
    data?.input?.phase2?.summary ||
    { pass: 0, fail: 0, warn: 0, info: 0 };
  let items = collectItems(data);
  if (!items || items.length === 0) {
    const candidates = [data?.items, data?.result?.items, data?.llm?.items, data?.findings];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length) { items = c; break; }
    }
  }

  const phase2Path = path.join(root, "reports", "p2-results.json");
  const phase2 = fs.existsSync(phase2Path) ? JSON.parse(fs.readFileSync(phase2Path, "utf8")) : null;
  const phase2Verdicts = new Map();
  if (phase2 && Array.isArray(phase2.items)) {
    for (const item of phase2.items) {
      if (item?.id) phase2Verdicts.set(item.id, item);
    }
  }
  // Allow metrics to override/add per-rule phase2 verdicts if provided
  if (metrics && Array.isArray(metrics?.perRule)) {
    for (const pr of metrics.perRule) {
      if (pr?.id) {
        const existing = phase2Verdicts.get(pr.id) || {};
        phase2Verdicts.set(pr.id, {
          ...existing,
          id: pr.id,
          verdict: pr.phase2Verdict,
          pass: pr.phase2Verdict === "PASS",
          severity: pr.severity,
          title: existing.title || pr.title || ""
        });
      }
    }
  }

  // ---- Merge Phase 2 base items with LLM items so ALL rules are rendered ----
  // Build a map of LLM findings by id (take the first occurrence if duplicates)
  const llmById = new Map();
  for (const it of items || []) {
    if (it && typeof it.id === "string" && !llmById.has(it.id)) llmById.set(it.id, it);
  }

  // Build base order from Phase 2 results if available, otherwise from LLM ids
  const baseOrder = [];
  if (phase2 && Array.isArray(phase2.items) && phase2.items.length) {
    for (const it of phase2.items) if (it?.id && !baseOrder.includes(it.id)) baseOrder.push(it.id);
  } else {
    for (const id of llmById.keys()) baseOrder.push(id);
  }

  // Helper to normalize text fields
  const norm = (v) => (v == null ? "" : String(v));
  const normUpper = (v) => norm(v).trim().toUpperCase();

  // Compose a merged list where each Phase 2 rule row is augmented with LLM status if present.
  const merged = [];
  for (const id of baseOrder) {
    const p2 = phase2Verdicts.get(id) || (phase2?.items || []).find((x) => x?.id === id) || null;
    const llm = llmById.get(id) || null;

    const phase2Verdict = derivePhase2Fallback(p2);
    const positionVal = llm?.position || llm?.llm_position || llm?.stance || "";
    const suggested = llm?.suggested_verdict || llm?.llm_verdict || llm?.verdict || "";

    merged.push({
      id,
      title: llm?.title || p2?.title || "",
      phase2_verdict: phase2Verdict,
      position: positionVal,
      suggested_verdict: suggested,
      explanation: llm?.explanation || llm?.reason || llm?.note || llm?.details || "",
      policy_refs: llm?.policy_refs || llm?.refs || llm?.references || [],
      severity: p2?.severity || llm?.severity || undefined,
    });
  }

  // Include any extra LLM-only ids not present in Phase 2
  for (const [id, llm] of llmById.entries()) {
    if (!baseOrder.includes(id)) {
      const p2 = phase2Verdicts.get(id) || null;
      const phase2Verdict = derivePhase2Fallback(p2);
      merged.push({
        id,
        title: llm?.title || p2?.title || "",
        phase2_verdict: phase2Verdict,
        position: llm?.position || llm?.llm_position || llm?.stance || "",
        suggested_verdict: llm?.suggested_verdict || llm?.llm_verdict || llm?.verdict || "",
        explanation: llm?.explanation || llm?.reason || llm?.note || llm?.details || "",
        policy_refs: llm?.policy_refs || llm?.refs || llm?.references || [],
        severity: p2?.severity || llm?.severity || undefined,
      });
    }
  }

  // From now on, render the merged list
  const renderItems = merged;

  const summaryCounts = renderItems.reduce(
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
  const originalSummary = String(metrics?.llm?.overallSummary || data?.result?.overall_summary || "").trim();
  const summaryHtml = originalSummary
    ? `${summaryCountsText}<br/><span class="overall-summary-note">${esc(originalSummary)}</span>`
    : summaryCountsText;

  const rows = renderItems.length === 0
    ? `<tr><td colspan="6" class="empty">No LLM findings available.</td></tr>`
    : renderItems.map((it) => {
        const phase2Base = phase2Verdicts.get(it.id);
        const ruleTitle = it.title || phase2Base?.title || "";
        const phase2Verdict = it.phase2_verdict || derivePhase2Fallback(phase2Base);
        const suggested = it.suggested_verdict;
        const positionVal = it.position;
        const suggestedClass = `verdict-chip verdict-${String(suggested || "").trim().toLowerCase()}`;
        const positionCell = positionBadge(positionVal, suggested);
        const policyRefs =
          Array.isArray(it.policy_refs) && it.policy_refs.length
            ? it.policy_refs
            : Array.isArray(phase2Base?.policy_refs)
              ? phase2Base.policy_refs
              : phase2Base?.policyRef
                ? [phase2Base.policyRef]
                : [];
        return `
        <tr>
          <td class="rule-cell">
            <div class="rule-id">${esc(it.id)}</div>
            ${ruleTitle ? `<div class="rule-title">${esc(ruleTitle)}</div>` : ""}
          </td>
          <td class="verdict-text">${esc(phase2Verdict)}</td>
          <td>${positionCell}</td>
          <td class="note">${esc(it.explanation || "")}</td>
          <td>${renderPolicyRefs(policyRefs)}</td>
          <td><span class="${suggestedClass}">${esc(suggested || "")}</span></td>
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
      max-width: 1280px;
      margin: 0 auto;
      padding: 36px;
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
    col.table-col-rule { width: 260px; }
    col.table-col-phase2 { width: 150px; }
    col.table-col-position { width: 160px; }
    col.table-col-explanation { width: 420px; }
    col.table-col-policy { width: 220px; }
    col.table-col-verdict { width: 140px; }
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
      letter-spacing: 0.02em;
      font-size: 13px;
    }
    .rule-id {
      white-space: nowrap;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .rule-title {
      font-family: "Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      font-weight: 500;
      white-space: normal;
      color: #1f2937;
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

  const outPath = path.join(root, "reports", "p3-report.html");
  fs.writeFileSync(outPath, html);
  console.log("[phase3] HTML written:", outPath);
}

main();
