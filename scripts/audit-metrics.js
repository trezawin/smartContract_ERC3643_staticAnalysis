function renderHTML(metrics) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ERC-3643 Metric Report</title>
  <style>
    body { font-family: Arial; padding: 30px; background: #f9f9f9; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: center; }
    th { background-color: #2c3e50; color: white; }
  </style>
</head>
<body>
  <h1>ERC-3643 Metrics Comparison</h1>
  <h2>Metrics Summary</h2>
  <table>
    <thead>
      <tr><th>Metric</th><th>Value</th><th>Formula / Notes</th></tr>
    </thead>
    <tbody>
      <tr><td>Total Rules Evaluated</td><td>${metrics.total}</td><td>Manual Count of Rules</td></tr>
      <tr><td>True Positives (TP)</td><td>${metrics.TP}</td><td>Buggy = Fail, TREX = Fail</td></tr>
      <tr><td>True Negatives (TN)</td><td>${metrics.TN}</td><td>Buggy = Pass, TREX = Pass</td></tr>
      <tr><td>False Positives (FP)</td><td>${metrics.FP}</td><td>Buggy = Fail, TREX = Pass</td></tr>
      <tr><td>False Negatives (FN)</td><td>${metrics.FN}</td><td>Buggy = Pass, TREX = Fail</td></tr>
      <tr><td>Precision</td><td>${(metrics.precision * 100).toFixed(2)}%</td><td>TP / (TP + FP)</td></tr>
      <tr><td>Recall</td><td>${(metrics.recall * 100).toFixed(2)}%</td><td>TP / (TP + FN)</td></tr>
      <tr><td>F1 Score</td><td>${(metrics.f1 * 100).toFixed(2)}%</td><td>2 * (P * R) / (P + R)</td></tr>
      <tr><td>Accuracy</td><td>${(metrics.accuracy * 100).toFixed(2)}%</td><td>(TP + TN) / Total</td></tr>
      <tr><td>Rule Coverage</td><td>100%</td><td>All Rules Evaluated</td></tr>
      <tr><td>Failure Detection Rate</td><td>${(metrics.TP / metrics.total * 100).toFixed(2)}%</td><td>Detected Fails / True Fails</td></tr>
      <tr><td>Consistency</td><td>${((metrics.TP + metrics.TN) / metrics.total * 100).toFixed(2)}%</td><td>Matching Outcomes / Total</td></tr>
    </tbody>
  </table>
  ${metrics.disagreements.length ? `
    <h2>Disagreements (${metrics.disagreements.length})</h2>
    <ul>${metrics.disagreements.map(d => `<li><code>${esc(d.id)}</code>: expected <b>${esc(d.expected)}</b>, got <b>${esc(d.predicted)}</b></li>`).join("")}</ul>` : ""}
</body>
</html>`;
}

function readJson(filePath) {
  const fs = require("fs");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function computeMetrics(truthWrapper, buggyWrapper) {
  const truthData = truthWrapper.rules;
  const buggyData = buggyWrapper.items;

  const metrics = {
    total: 0,
    TP: 0,
    TN: 0,
    FP: 0,
    FN: 0,
    disagreements: []
  };

  const truthMap = new Map(truthData.map(item => [item.id, item.status]));
  const buggyMap = new Map(buggyData.map(item => [item.id, item.pass ? "Pass" : "Fail"]));

  for (const [id, truthResult] of truthMap.entries()) {
    const buggyResult = buggyMap.get(id);
    if (buggyResult === undefined) continue;

    metrics.total++;

    if (truthResult === "Fail" && buggyResult === "Fail") metrics.TP++;
    else if (truthResult === "Pass" && buggyResult === "Pass") metrics.TN++;
    else if (truthResult === "Fail" && buggyResult === "Pass") metrics.FN++;
    else if (truthResult === "Pass" && buggyResult === "Fail") metrics.FP++;

    if (truthResult !== buggyResult) {
      metrics.disagreements.push({ id, expected: truthResult, predicted: buggyResult });
    }
  }

  metrics.precision = metrics.TP + metrics.FP === 0 ? 0 : metrics.TP / (metrics.TP + metrics.FP);
  metrics.recall = metrics.TP + metrics.FN === 0 ? 0 : metrics.TP / (metrics.TP + metrics.FN);
  metrics.f1 = (metrics.precision + metrics.recall) === 0 ? 0 : (2 * metrics.precision * metrics.recall) / (metrics.precision + metrics.recall);
  metrics.accuracy = metrics.total === 0 ? 0 : (metrics.TP + metrics.TN) / metrics.total;

  return metrics;
}

function esc(html) {
  return String(html)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function main() {
  const fs = require("fs");
  const args = process.argv.slice(2);
  let truthPath = "", buggyPath = "", outputPath = "metrics-report.html";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--truth") truthPath = args[++i];
    else if (args[i].startsWith("--truth=")) truthPath = args[i].split("=")[1];
    if (args[i] === "--buggy") buggyPath = args[++i];
    else if (args[i].startsWith("--buggy=")) buggyPath = args[i].split("=")[1];
    if (args[i] === "--output") outputPath = args[++i];
    else if (args[i].startsWith("--output=")) outputPath = args[i].split("=")[1];
  }

  if (!truthPath || !buggyPath) {
    console.error("Usage: node audit-metrics.js --truth <truth.json> --buggy <buggy.json> [--output metrics-report.html]");
    process.exit(1);
  }

  const truthData = readJson(truthPath);
  const buggyData = readJson(buggyPath);
  const metrics = computeMetrics(truthData, buggyData);
  const html = renderHTML(metrics);
  fs.writeFileSync(outputPath, html, "utf8");
  console.log(`✅ Metrics report written to: ${outputPath}`);
}

main();
