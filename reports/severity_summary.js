#!/usr/bin/env node
/**
 * severity_summary.js
 * Node-executable version — generates an HTML table comparing T-REX vs Mutated datasets
 */

const fs = require("fs");
const path = require("path");

// Input JSON paths (relative to script)
const T_REX_FILE = path.resolve(__dirname, "amlo-trex.json");
const BOULDER_FILE = path.resolve(__dirname, "amlo-boulder.json");
const MUTATED_FILE = path.resolve(__dirname, "amlo-buggy.json");
const T_REX_GROUND_TRUTH_FILE = path.resolve(__dirname, "../eval/amlo-groundtruth.json");
const BOULDER_GROUND_TRUTH_FILE = path.resolve(__dirname, "../eval/amlo-groundtruth-boulder.json");
const MUTATED_GROUND_TRUTH_FILE = path.resolve(__dirname, "../eval/amlo-groundtruth-buggy.json");
const OUTPUT_FILE = path.resolve(__dirname, "severity_summary_report.html");

// Header and colour definitions
const HEADER_DEFS = [
  { key: "veryHigh", label: "Very High", color: "#c0392b" },
  { key: "high", label: "High", color: "#f39c12" },
  { key: "medium", label: "Medium", color: "#f1c40f" },
  { key: "total", label: "Total", color: "#2980b9" }
];

const SEVERITY_ALIASES = new Map([
  ["VERY_HIGH", "VERY_HIGH"],
  ["VERY HIGH", "VERY_HIGH"],
  ["VERYHIGH", "VERY_HIGH"],
  ["CRITICAL", "VERY_HIGH"],
  ["HIGH", "HIGH"],
  ["MEDIUM", "MEDIUM"],
  ["LOW", "MEDIUM"]
]);

function normalizeSeverity(value) {
  const key = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SEVERITY_ALIASES.get(key) || "MEDIUM";
}

function normalizeItems(json) {
  if (Array.isArray(json)) return json;
  if (json.items) return json.items;
  if (json.rules) return json.rules;
  throw new Error("Invalid JSON structure — expected .items or .rules array");
}

function computeCounts(items) {
  const bySev = {
    VERY_HIGH: { pass: 0, fail: 0 },
    HIGH: { pass: 0, fail: 0 },
    MEDIUM: { pass: 0, fail: 0 }
  };
  for (const it of items) {
    const passed = !!it.pass;
    const sev = normalizeSeverity(it.severity || it.severityCode || it.level);
    if (bySev[sev]) passed ? bySev[sev].pass++ : bySev[sev].fail++;
  }
  return {
    veryHigh: [bySev.VERY_HIGH.pass, bySev.VERY_HIGH.fail],
    high: [bySev.HIGH.pass, bySev.HIGH.fail],
    medium: [bySev.MEDIUM.pass, bySev.MEDIUM.fail],
    total: [
      bySev.VERY_HIGH.pass + bySev.HIGH.pass + bySev.MEDIUM.pass,
      bySev.VERY_HIGH.fail + bySev.HIGH.fail + bySev.MEDIUM.fail
    ]
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

function resolveGroundTruthEntry(id, groundTruth) {
  if (typeof id !== "string" || !id) return null;
  if (groundTruth.map.has(id)) {
    return { status: groundTruth.map.get(id), resolvedId: id };
  }
  const suffixMatch = id.match(/^(.*?)-\d+$/);
  if (suffixMatch) {
    const baseId = suffixMatch[1];
    if (groundTruth.map.has(baseId)) {
      return { status: groundTruth.map.get(baseId), resolvedId: baseId };
    }
  }
  return null;
}

function computeMetrics(items, groundTruth) {
  const stats = { tp: 0, fp: 0, fn: 0, tn: 0, covered: 0 };
  const uniqueCoveredIds = new Set();
  for (const item of items) {
    if (!item || !item.id) continue;
    const resolved = resolveGroundTruthEntry(item.id, groundTruth);
    if (!resolved) continue;
    const { status: expectedStatus, resolvedId } = resolved;
    stats.covered++;
    uniqueCoveredIds.add(resolvedId);
    const predictedPass = !!item.pass;
    const actualPass = expectedStatus === "pass";
    if (predictedPass && actualPass) stats.tp++;
    else if (!predictedPass && !actualPass) stats.tn++;
    else if (predictedPass && !actualPass) stats.fp++;
    else stats.fn++;
  }
  const precision = safeDivide(stats.tp, stats.tp + stats.fp);
  const recall = safeDivide(stats.tp, stats.tp + stats.fn);
  const f1 = precision == null || recall == null || (precision + recall === 0) ? null : 2 * precision * recall / (precision + recall);
  const uniqueCoveredCount = uniqueCoveredIds.size;
  const coverageRatio = groundTruth.total ? uniqueCoveredCount / groundTruth.total : null;
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
    totalRules: groundTruth.total,
    coveredUnique: uniqueCoveredCount
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
    : `${(metrics.coveredUnique ?? metrics.covered)}/${metrics.totalRules} (${formatPercent(metrics.coverageRatio)})`;
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

function buildCriteriaTable(metricSets) {
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

  const headerCells = metricSets.map(({ name }) => `<th>${name}</th>`).join("");
  const body = rows.map(row => `<tr>
    <td class="dataset">${row.label}</td>
    ${metricSets.map(({ metrics }) => `<td>${row.value(metrics)}</td>`).join("")}
  </tr>`).join("");

  return `<table class="criteria-table">
    <thead>
      <tr>
        <th class="dataset">Criteria</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function generateHTML(datasets) {
  const headRow = HEADER_DEFS.map(h => 
    `<th style="background:${h.color};color:#fff">${h.label}</th>`
  ).join("");
  const criteriaTable = buildCriteriaTable(datasets.map(({ name, metrics }) => ({ name, metrics })));
  const confusionRows = datasets.map(({ name, metrics }) => (
    `<tr><td class="dataset">${name}</td><td>${metrics.tp}</td><td>${metrics.fp}</td><td>${metrics.fn}</td><td>${metrics.tn}</td></tr>`
  )).join("");
  const totals = datasets.reduce((acc, { metrics }) => {
    acc.tp += metrics.tp || 0;
    acc.fp += metrics.fp || 0;
    acc.fn += metrics.fn || 0;
    acc.tn += metrics.tn || 0;
    return acc;
  }, { tp: 0, fp: 0, fn: 0, tn: 0 });

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
    body { font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; background: var(--bg); padding: 32px; color:#1f2d3d; font-size: 0.85rem; }
    h1 { margin: 0; font-size: 2.4rem; letter-spacing:-0.5px; }
    .subtitle { color: var(--text-muted); margin-top: 8px; font-size: 0.8rem; }
    .grid { display: grid; gap: 28px; margin-top: 30px; }
    .panel { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 18px; padding: 24px 28px; box-shadow: var(--shadow); }
    .panel h2 { margin: 0 0 12px; font-size: 1.1rem; color: var(--accent); letter-spacing: -0.2px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 12px 14px; text-align: center; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
    thead th { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    th.dataset, td.dataset { text-align: left; font-weight: 600; color:#132a45; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) { background: #fdfefe; }
    .metrics-table td { font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-muted); }
    /* Compact metrics table styling */
    .compact-metrics {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.85rem;
      margin-top: 8px;
      border: 1px solid #bbb;
    }
    .compact-metrics th, .compact-metrics td {
      border: 1px solid #bbb;
      border-top: 1px solid #bbb;
      border-right: 1px solid #bbb;
      padding: 8px 12px;
      text-align: center;
    }
    .compact-metrics th {
      background-color: #f0f2f5;
      color: #333;
      font-weight: 600;
      text-transform: none;
    }
    .compact-metrics tr:nth-child(even) td {
      background-color: #fafafa;
    }
    .compact-metrics td:first-child {
      text-align: left;
      font-weight: 600;
    }
    .compact-metrics tr:hover td {
      background-color: #f9fafc;
    }
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
          ${datasets.map(({ name, counts }) => buildTableRow(name, counts)).join("\n          ")}
        </tbody>
      </table>
    </section>

    <section class="panel">
  <h2>Detection Performance Matrix</h2>
  <table class="compact-metrics">
    <thead>
      <tr>
        <th>Metric</th>
        <th>T-REX</th>
        <th>Boulder</th>
        <th>Mutated</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Accuracy</td>
        <td>${formatPercent(datasets[0].metrics.accuracy)}</td>
        <td>${formatPercent(datasets[1].metrics.accuracy)}</td>
        <td>${formatPercent(datasets[2].metrics.accuracy)}</td>
      </tr>
      <tr>
        <td>Recall</td>
        <td>${formatPercent(datasets[0].metrics.recall)}</td>
        <td>${formatPercent(datasets[1].metrics.recall)}</td>
        <td>${formatPercent(datasets[2].metrics.recall)}</td>
      </tr>
      <tr>
        <td>Precision</td>
        <td>${formatPercent(datasets[0].metrics.precision)}</td>
        <td>${formatPercent(datasets[1].metrics.precision)}</td>
        <td>${formatPercent(datasets[2].metrics.precision)}</td>
      </tr>
      <tr>
        <td>F1 Score</td>
        <td>${formatPercent(datasets[0].metrics.f1)}</td>
        <td>${formatPercent(datasets[1].metrics.f1)}</td>
        <td>${formatPercent(datasets[2].metrics.f1)}</td>
      </tr>
    </tbody>
  </table>
</section>
    <section class="panel">
      <h2>Rule-Level Compliance Detection Matrix</h2>
      <table>
        <thead>
          <tr>
            <th class="dataset">Dataset</th>
            <th>TP</th>
            <th>FP</th>
            <th>FN</th>
            <th>TN</th>
          </tr>
        </thead>
        <tbody>
          ${confusionRows}
          <tr>
            <td class="dataset">Combined</td>
            <td>${totals.tp}</td>
            <td>${totals.fp}</td>
            <td>${totals.fn}</td>
            <td>${totals.tn}</td>
          </tr>
        </tbody>
      </table>
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
  const boulderData = normalizeItems(JSON.parse(fs.readFileSync(BOULDER_FILE, "utf8")));
  const mutatedData = normalizeItems(JSON.parse(fs.readFileSync(MUTATED_FILE, "utf8")));
  const trexGroundTruth = loadGroundTruthMap(T_REX_GROUND_TRUTH_FILE);
  const boulderGroundTruth = loadGroundTruthMap(BOULDER_GROUND_TRUTH_FILE);
  const mutatedGroundTruth = loadGroundTruthMap(MUTATED_GROUND_TRUTH_FILE);

  console.log("✅ Computing severity counts...");
  const trexCounts = computeCounts(trexData);
  const boulderCounts = computeCounts(boulderData);
  const mutatedCounts = computeCounts(mutatedData);
  const trexMetrics = computeMetrics(trexData, trexGroundTruth);
  const boulderMetrics = computeMetrics(boulderData, boulderGroundTruth);
  const mutatedMetrics = computeMetrics(mutatedData, mutatedGroundTruth);

  const datasets = [
    { name: "T-REX", counts: trexCounts, metrics: trexMetrics },
    { name: "Boulder", counts: boulderCounts, metrics: boulderMetrics },
    { name: "Mutated", counts: mutatedCounts, metrics: mutatedMetrics }
  ];
  // Compute confusion totals for export
  const totals = datasets.reduce((acc, { metrics }) => {
    acc.tp += metrics.tp || 0;
    acc.fp += metrics.fp || 0;
    acc.fn += metrics.fn || 0;
    acc.tn += metrics.tn || 0;
    return acc;
  }, { tp: 0, fp: 0, fn: 0, tn: 0 });
  // Also export confusion totals for Python visualization
  fs.writeFileSync(
    path.resolve(__dirname, "confusion_totals.json"),
    JSON.stringify(totals, null, 2),
    "utf8"
  );
  console.log("✅ confusion_totals.json exported for Python visualization");

  console.log("📝 Generating HTML report...");
  
  const html = generateHTML(datasets);
  fs.writeFileSync(OUTPUT_FILE, html, "utf8");

  console.log(`✅ Report written to:\n${OUTPUT_FILE}`);
  console.log("📂 Open it in your browser to view the severity summary table.");
}

if (require.main === module) main();
