/* eslint-disable */
const fs = require("fs");
const path = require("path");

function readJson(p, label) {
  if (!fs.existsSync(p)) {
    console.warn(`[dashboard] ${label} missing at ${p}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    console.warn(`[dashboard] Failed to parse ${label}: ${err.message}`);
    return null;
  }
}

function norm(v) {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

function derivePhase2Verdict(item) {
  if (!item) return "";
  if (item.pass === true) return "PASS";
  const sev = norm(item.severity);
  return sev || "FAIL";
}

function derivePhase3Verdict(item) {
  if (!item) return "";
  const v = norm(item.suggested_verdict || item.verdict);
  return v || "";
}

function toGoldArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (!entry || !entry.id) return null;
        const verdict = norm(entry.gold_verdict);
        if (!verdict || verdict === "AMBIGUOUS") return null;
        return { id: entry.id, verdict };
      })
      .filter(Boolean);
  }
  if (typeof raw === "object") {
    return Object.entries(raw)
      .map(([id, verdict]) => {
        const val = norm(verdict);
        if (!val || val === "AMBIGUOUS") return null;
        return { id, verdict: val };
      })
      .filter(Boolean);
  }
  return [];
}

function scoreExplanation(item) {
  const text = (item?.explanation || "").trim();
  if (!text) return 1;
  const words = text.split(/\s+/).filter(Boolean).length;
  const hasPolicy = Array.isArray(item?.policy_refs) && item.policy_refs.some((ref) => ref && (ref.url || ref.label));

  if (words >= 75 && hasPolicy) return 5;
  if (words >= 40 && hasPolicy) return 4;
  if (words >= 20) return 3;
  if (words >= 10) return 2;
  return 1;
}

function precisionRecallF1(predMap, goldList) {
  if (goldList.length === 0) return null;
  let tp = 0;
  let totalPred = 0;
  const goldSet = new Set();
  for (const entry of goldList) goldSet.add(entry.id);

  for (const entry of goldList) {
    const pred = predMap.get(entry.id);
    if (pred) totalPred += 1;
    if (pred && pred === entry.verdict) tp += 1;
  }

  const totalGold = goldList.length;
  const fp = totalPred - tp;
  const fn = totalGold - tp;
  const precision = totalPred > 0 ? tp / totalPred : 0;
  const recall = totalGold > 0 ? tp / totalGold : 0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    tp,
    fp,
    fn,
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    f1: Number(f1.toFixed(3)),
    totalGold,
    totalPred,
  };
}

function computeCoverage(items, phase2Map) {
  const rules = [];
  for (const item of items) {
    if (!item?.id) continue;
    const pos = norm(item.position);
    if (pos !== "EXTEND" && pos !== "CHALLENGE") continue;
    const phase2Verdict = derivePhase2Verdict(phase2Map.get(item.id));
    const phase3Verdict = derivePhase3Verdict(item);
    if (phase2Verdict && phase3Verdict && phase2Verdict !== phase3Verdict) rules.push(item.id);
  }
  return { count: rules.length, rules };
}

function explanationSummary(scores) {
  if (!scores.length) return null;
  const total = scores.length;
  const sum = scores.reduce((acc, v) => acc + v, 0);
  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const v of scores) {
    const key = String(v);
    distribution[key] = (distribution[key] || 0) + 1;
  }
  return {
    average: Number((sum / total).toFixed(3)),
    total,
    distribution,
  };
}

function summaryCounts(items) {
  return items.reduce(
    (acc, it) => {
      const pos = norm(it?.position);
      if (pos === "SUPPORT") acc.support += 1;
      else if (pos === "CHALLENGE") acc.challenge += 1;
      else if (pos === "EXTEND") acc.extend += 1;
      return acc;
    },
    { support: 0, extend: 0, challenge: 0 }
  );
}

function buildDashboard(root) {
  const evalDir = path.join(root, "eval");
  const truthFiles = fs.existsSync(evalDir)
    ? fs.readdirSync(evalDir).filter((f) => f.startsWith("ground_truth.") && f.endsWith(".json"))
    : [];
  const sets = truthFiles.map((file) => ({
    id: file.replace("ground_truth.", "").replace(".json", ""),
    path: path.join(evalDir, file),
  }));

  const phase2 = readJson(path.join(root, "reports", "phase2-results.json"), "phase2 report") || {};
  const phase3 = readJson(path.join(root, "reports", "phase3-results.json"), "phase3 report") || {};

  const phase2Items = Array.isArray(phase2.items) ? phase2.items : [];
  const phase3Items = Array.isArray(phase3?.result?.items) ? phase3.result.items : [];
  const phase2Map = new Map();
  for (const item of phase2Items) {
    if (item?.id) phase2Map.set(item.id, item);
  }

  const rows = [];

  for (const stage of ["phase2", "phase3"]) {
    for (const set of sets) {
      const gold = toGoldArray(readJson(set.path, `ground truth ${set.id}`));
      const predMap = new Map();
      let explanationScores = [];
      let coverage = null;
      let counts = null;

      if (stage === "phase2") {
        for (const item of phase2Items) {
          if (!item?.id) continue;
          predMap.set(item.id, derivePhase2Verdict(item));
        }
        counts = summaryCounts(
          phase2Items.map((it) => ({
            position: derivePhase2Verdict(it),
          }))
        );
      } else {
        for (const item of phase3Items) {
          if (!item?.id) continue;
          predMap.set(item.id, derivePhase3Verdict(item));
          explanationScores.push(scoreExplanation(item));
        }
        coverage = computeCoverage(phase3Items, phase2Map);
        counts = summaryCounts(phase3Items);
      }

      rows.push({
        stage,
        set: set.id,
        metrics: precisionRecallF1(predMap, gold),
        explanation: stage === "phase3" ? explanationSummary(explanationScores) : null,
        coverage: stage === "phase3" ? coverage : null,
        counts,
        analysed: stage === "phase2" ? phase2Items.length : phase3Items.length,
        predicted: predMap.size,
        truthTotal: gold.length,
      });
    }
  }

  return rows;
}

function toHtml(rows) {
  const head = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Phase Score Dashboard</title>
  <style>
    :root {
      font-family: "Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #0f172a;
    }
    body {
      margin: 0;
      background: #f8fafc;
      padding: 24px 0;
    }
    .wrapper {
      background: #fff;
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px;
      border-radius: 16px;
      box-shadow: 0 18px 38px -24px rgba(30, 41, 59, 0.35);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 28px;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 24px;
    }
    thead th {
      background: #f1f5f9;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.05em;
      padding: 10px;
      border-bottom: 1px solid #e2e8f0;
    }
    tbody td {
      padding: 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #e2e8f0;
      color: #0f172a;
    }
    .tag-phase2 { background: rgba(14,116,144,0.15); color: #0f172a; }
    .tag-phase3 { background: rgba(109,40,217,0.12); color: #4c1d95; }
    .metric {
      font-weight: 600;
    }
    .muted {
      color: #64748b;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <h1>Phase Score Dashboard</h1>
    <p class="muted">Generated at ${new Date().toISOString()}</p>
    <table>
      <thead>
        <tr>
          <th>Stage</th>
          <th>Ground Truth</th>
          <th>Precision / Recall / F1</th>
          <th>Total Truth</th>
          <th>Predictions</th>
          <th>Support / Extend / Challenge</th>
          <th>Explanation Quality</th>
          <th>Coverage Expansion</th>
        </tr>
      </thead>
      <tbody>`;

  const rowsHtml = rows.map((row) => {
    const stageTag = `<span class="tag tag-${esc(row.stage)}">${esc(row.stage)}</span>`;
    const metrics = row.metrics
      ? `<span class="metric">${row.metrics.precision}</span> / ${row.metrics.recall} / ${row.metrics.f1}`
      : "—";
    const counts = row.counts
      ? `${row.counts.support} / ${row.counts.extend} / ${row.counts.challenge}`
      : "—";
    const explanation = row.explanation
      ? `${row.explanation.average} (n=${row.explanation.total})`
      : "—";
    const coverage = row.coverage
      ? `${row.coverage.count}${row.coverage.rules.length ? ` (${row.coverage.rules.join(", ")})` : ""}`
      : "—";

    return `<tr>
      <td>${stageTag}</td>
      <td>${esc(row.set)}</td>
      <td>${metrics}</td>
      <td>${row.truthTotal}</td>
      <td>${row.predicted}/${row.analysed}</td>
      <td>${counts}</td>
      <td>${explanation}</td>
      <td>${coverage}</td>
    </tr>`;
  }).join("\n");

  const tail = `      </tbody>
    </table>
  </div>
</body>
</html>`;

  return head + rowsHtml + "\n" + tail;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function main() {
  const root = process.cwd();
  const rows = buildDashboard(root);
  const html = toHtml(rows);
  const outPath = path.join(root, "reports", "score-dashboard.html");
  fs.writeFileSync(outPath, html);
  console.log("[dashboard] HTML written:", outPath);
}

main();

