#!/usr/bin/env node
/**
 * severity_summary.js
 * Node-executable version — generates an HTML table comparing T-REX vs Mutated datasets
 */

const fs = require("fs");
const path = require("path");

// Input JSON paths (relative to script)
const T_REX_FILE = path.resolve(__dirname, "amlo-trex.json");
const MUTATED_FILE = path.resolve(__dirname, "amlo-buggy.json");
const T_REX_GROUND_TRUTH_FILE = path.resolve(__dirname, "../eval/amlo-groundtruth.json");
const MUTATED_GROUND_TRUTH_FILE = path.resolve(__dirname, "../eval/amlo-groundtruth-buggy.json");
const OUTPUT_FILE = path.resolve(__dirname, "severity_summary_report.html");

// Header and colour definitions
const HEADER_DEFS = [
  { key: "critical", label: "Critical", color: "#c0392b" },
  { key: "high", label: "High", color: "#f39c12" },
  { key: "medium", label: "Medium", color: "#f1c40f" },
  { key: "low", label: "Low", color: "#7f8c8d" },
  { key: "total", label: "Total", color: "#2980b9" }
];

function normalizeItems(json) {
  if (Array.isArray(json)) return json;
  if (json.items) return json.items;
  if (json.rules) return json.rules;
  throw new Error("Invalid JSON structure — expected .items or .rules array");
}

function computeCounts(items) {
  const bySev = { CRITICAL: { pass: 0, fail: 0 }, HIGH: { pass: 0, fail: 0 }, MEDIUM: { pass: 0, fail: 0 }, LOW: { pass: 0, fail: 0 } };
  let overallPass = 0, overallFail = 0;
  for (const it of items) {
    const passed = !!it.pass;
    const sev = (it.severity || "").toUpperCase();
    if (passed) overallPass++; else overallFail++;
    if (bySev[sev]) passed ? bySev[sev].pass++ : bySev[sev].fail++;
  }
  const criticalPass = bySev.CRITICAL.pass;
  const criticalFail = bySev.CRITICAL.fail;
  return {
    critical: [criticalPass, criticalFail],
    high: [bySev.HIGH.pass, bySev.HIGH.fail],
    medium: [bySev.MEDIUM.pass, bySev.MEDIUM.fail],
    low: [bySev.LOW.pass, bySev.LOW.fail],
    total: [criticalPass + bySev.HIGH.pass + bySev.MEDIUM.pass + bySev.LOW.pass, criticalFail + bySev.HIGH.fail + bySev.MEDIUM.fail + bySev.LOW.fail]
  };
}

function loadGroundTruthMap(filePath) {
  const entries = normalizeItems(JSON.parse(fs.readFileSync(filePath, "utf8")));
  const map = new Map();
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    const status = String(entry.status || "").toLowerCase();
    map.set(entry.id, status);
  }
  return { map, total: entries.length };
}

function safeDivide(num, den) {
  if (!den) return null;
  return num / den;
}

function formatPercent(value) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatio(numerator, denominator, percentValue) {
  if (!denominator) return "—";
  const pct = percentValue != null ? formatPercent(percentValue) : formatPercent(safeDivide(numerator, denominator));
  return `${numerator}/${denominator} (${pct})`;
}

function computeMetrics(items, groundTruth) {
  const stats = { tp: 0, fp: 0, fn: 0, tn: 0, covered: 0 };
  for (const item of items) {
    if (!item || !item.id) continue;
    const expected = groundTruth.map.get(item.id);
    if (!expected) continue;
    stats.covered++;
    const predictedFail = !item.pass;
    const actualFail = expected === "fail";
    if (predictedFail && actualFail) stats.tp++;
    else if (predictedFail && !actualFail) stats.fp++;
    else if (!predictedFail && actualFail) stats.fn++;
    else stats.tn++;
  }
  const precision = safeDivide(stats.tp, stats.tp + stats.fp);
  const recall = safeDivide(stats.tp, stats.tp + stats.fn);
  const f1 = precision == null || recall == null || (precision + recall === 0) ? null : 2 * precision * recall / (precision + recall);
  const coverageRatio = groundTruth.total ? stats.covered / groundTruth.total : null;
  const accuracy = stats.covered ? (stats.tp + stats.tn) / stats.covered : null;
  const expectedFails = stats.tp + stats.fn;
  const detectionAccuracy = safeDivide(stats.tp, expectedFails);
  return {
    ...stats,
    precision,
    recall,
    f1,
    coverageRatio,
    accuracy,
    detectionAccuracy,
    expectedFails,
    totalRules: groundTruth.total
  };
}

function buildTableRow(name, counts) {
  const cells = HEADER_DEFS.map(h => {
    const [p, f] = counts[h.key] || [0, 0];
    return `<td>(${p}, ${f})</td>`;
  }).join("");
  return `<tr><td class="dataset">${name}</td>${cells}</tr>`;
}

function buildMetricsRow(name, metrics) {
  const coverage = metrics.coverageRatio == null
    ? "—"
    : `${metrics.covered}/${metrics.totalRules} (${formatPercent(metrics.coverageRatio)})`;
  const precision = formatPercent(metrics.precision);
  const recall = formatPercent(metrics.recall);
  const f1 = formatPercent(metrics.f1);
  const accuracy = formatPercent(metrics.accuracy);
  return `<tr>
    <td class="dataset">${name}</td>
    <td>${coverage}</td>
    <td>${accuracy}</td>
    <td>${precision}</td>
    <td>${recall}</td>
    <td>${f1}</td>
  </tr>`;
}

function buildCriteriaTable(trexMetrics, mutatedMetrics) {
  const rows = [
    {
      label: "Failure Detection",
      value: (m) => `${m.tp}`
    },
    {
      label: "Consistency",
      value: (m) => formatPercent(m.accuracy)
    },
    {
      label: "Detection Accuracy",
      value: (m) => formatRatio(m.tp, m.expectedFails, m.detectionAccuracy)
    },
    {
      label: "False Negatives Count",
      value: (m) => `${m.fn}`
    },
    {
      label: "Rule Robustness",
      value: (m) => formatRatio(m.tp, m.expectedFails, m.detectionAccuracy)
    }
  ];

  const body = rows.map(row => `<tr>
    <td class="dataset">${row.label}</td>
    <td>${row.value(trexMetrics)}</td>
    <td>${row.value(mutatedMetrics)}</td>
  </tr>`).join("");

  return `<table class="criteria-table">
    <thead>
      <tr>
        <th class="dataset">Criteria</th>
        <th>T-REX (reference)</th>
        <th>Mutated (buggy)</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function generateHTML(trexCounts, mutatedCounts, trexMetrics, mutatedMetrics) {
  const headRow = HEADER_DEFS.map(h => 
    `<th style="background:${h.color};color:#fff">${h.label}</th>`
  ).join("");
  const criteriaTable = buildCriteriaTable(trexMetrics, mutatedMetrics);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ERC-3643 Severity Summary</title>
  <style>
    :root {
      --bg: #f6f8fb;
      --panel-bg: #fff;
      --border: #e2e9f3;
      --text-muted: #7b8a9a;
      --accent: #2980b9;
      --shadow: 0 15px 35px rgba(15, 34, 58, 0.08);
    }
    * { box-sizing: border-box; }
    body { font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; background: var(--bg); padding: 32px; color:#1f2d3d; }
    h1 { margin: 0; font-size: 2.4rem; letter-spacing:-0.5px; }
    .subtitle { color: var(--text-muted); margin-top: 8px; }
    .grid { display: grid; gap: 28px; margin-top: 30px; }
    .panel { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 18px; padding: 24px 28px; box-shadow: var(--shadow); }
    .panel h2 { margin: 0 0 12px; font-size: 1.4rem; color: var(--accent); letter-spacing: -0.2px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 12px 14px; text-align: center; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
    thead th { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    th.dataset, td.dataset { text-align: left; font-weight: 600; color:#132a45; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) { background: #fdfefe; }
    .metrics-table td { font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-muted); }
  </style>
</head>
<body>
  <h1>ERC-3643 Severity & Accuracy Overview</h1>
  <p class="subtitle">Severity distribution plus precision/recall metrics against curated AMLO ground truths.</p>

  <div class="grid">
    <section class="panel">
      <h2>Severity Distribution</h2>
      <table>
        <thead><tr><th class="dataset">Dataset</th>${headRow}</tr></thead>
        <tbody>
          ${buildTableRow("T-REX (reference)", trexCounts)}
          ${buildTableRow("Mutated (buggy)", mutatedCounts)}
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Detection Metrics vs Ground Truth</h2>
      <table class="metrics-table">
        <thead>
          <tr>
            <th class="dataset">Dataset</th>
            <th>Rule Coverage</th>
            <th>Accuracy</th>
            <th>Precision</th>
            <th>Recall</th>
            <th>F1-Score</th>
          </tr>
        </thead>
        <tbody>
          ${buildMetricsRow("T-REX (reference)", trexMetrics)}
          ${buildMetricsRow("Mutated (buggy)", mutatedMetrics)}
        </tbody>
      </table>
      <p class="muted" style="margin-top:12px;font-size:0.85rem;">
        Precision/Recall/F1 treat detected failures as the positive class. Coverage indicates how many ground-truth rules were evaluated in each run.
      </p>
    </section>

    <section class="panel">
      <h2>Evaluation Criteria Deep-Dive</h2>
      ${criteriaTable}
      <p class="muted" style="margin-top:12px;font-size:0.85rem;">
        Failure-centric criteria highlight how well each dataset surfaces intentional compliance breaks within the mutation suite.
      </p>
    </section>
  </div>

  <p style="color:#94a3b8;font-size:12px;margin-top:22px;">Generated automatically on ${new Date().toLocaleString()}</p>
</body>
</html>`;
}

function main() {
  console.log("📊 Loading datasets...");
  const trexData = normalizeItems(JSON.parse(fs.readFileSync(T_REX_FILE, "utf8")));
  const mutatedData = normalizeItems(JSON.parse(fs.readFileSync(MUTATED_FILE, "utf8")));
  const trexGroundTruth = loadGroundTruthMap(T_REX_GROUND_TRUTH_FILE);
  const mutatedGroundTruth = loadGroundTruthMap(MUTATED_GROUND_TRUTH_FILE);

  console.log("✅ Computing severity counts...");
  const trexCounts = computeCounts(trexData);
  const mutatedCounts = computeCounts(mutatedData);
  const trexMetrics = computeMetrics(trexData, trexGroundTruth);
  const mutatedMetrics = computeMetrics(mutatedData, mutatedGroundTruth);

  console.log("📝 Generating HTML report...");
  const html = generateHTML(trexCounts, mutatedCounts, trexMetrics, mutatedMetrics);
  fs.writeFileSync(OUTPUT_FILE, html, "utf8");

  console.log(`✅ Report written to:\n${OUTPUT_FILE}`);
  console.log("📂 Open it in your browser to view the severity summary table.");
}

if (require.main === module) main();
