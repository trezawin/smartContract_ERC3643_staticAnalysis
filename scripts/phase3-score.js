/* eslint-disable */
const fs = require("fs");
const path = require("path");

function parseArgs() {
  const argv = process.argv.slice(2);
  let stage = "phase3";
  let report = null;
  let truth = null;
  let setId = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--stage" && argv[i + 1]) {
      stage = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--stage=")) {
      stage = token.slice(8);
    } else if (token === "--report" && argv[i + 1]) {
      report = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--report=")) {
      report = token.slice(9);
    } else if (token === "--truth" && argv[i + 1]) {
      truth = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--truth=")) {
      truth = token.slice(8);
    } else if (token === "--set" && argv[i + 1]) {
      setId = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--set=")) {
      setId = token.slice(6);
    }
  }

  stage = (stage || "phase3").toLowerCase();
  if (!["phase2", "phase3"].includes(stage)) {
    console.error(`[score] Unsupported stage '${stage}'. Expected phase2 or phase3.`);
    process.exit(1);
  }

  return { stage, report, truth, setId };
}

function resolvePath(root, maybePath, fallback) {
  if (maybePath) {
    return path.isAbsolute(maybePath) ? maybePath : path.join(root, maybePath);
  }
  return fallback;
}

function readJson(p, label, optional = false) {
  if (!fs.existsSync(p)) {
    if (!optional) {
      console.error(`[score] ${label} not found: ${p}`);
      process.exit(1);
    }
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    console.error(`[score] Failed to parse ${label}: ${err.message}`);
    process.exit(1);
  }
}

function toGoldArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (!entry || !entry.id) return null;
        const verdict = String(entry.gold_verdict || "").trim().toUpperCase();
        if (verdict === "AMBIGUOUS" || verdict === "") return null;
        return { id: entry.id, verdict };
      })
      .filter(Boolean);
  }
  if (typeof raw === "object") {
    return Object.entries(raw)
      .map(([id, verdict]) => {
        const norm = String(verdict || "").trim().toUpperCase();
        if (norm === "AMBIGUOUS" || norm === "") return null;
        return { id, verdict: norm };
      })
      .filter(Boolean);
  }
  return [];
}

function normVerdict(v) {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

function derivePhase2Verdict(item) {
  if (!item) return "";
  if (item.pass === true) return "PASS";
  const sev = normVerdict(item.severity);
  if (sev) return sev;
  return "FAIL";
}

function derivePhase3Verdict(item) {
  if (!item) return "";
  const v = normVerdict(item.suggested_verdict || item.verdict);
  if (v) return v;
  return "";
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
  let tp = 0;
  let totalPred = 0;
  const goldIds = new Set();

  for (const entry of goldList) {
    goldIds.add(entry.id);
  }

  for (const entry of goldList) {
    const gold = entry.verdict;
    const pred = predMap.get(entry.id);
    if (pred) totalPred += 1;
    if (pred && pred === gold) tp += 1;
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

function collectPhase2(root) {
  const phase2Path = path.join(root, "reports", "phase2-results.json");
  const phase2 = readJson(phase2Path, "phase2-results.json", true) || {};
  const map = new Map();
  const items = Array.isArray(phase2.items) ? phase2.items : [];
  for (const item of items) {
    if (item?.id) map.set(item.id, item);
  }
  return { map, items };
}

function main() {
  const root = process.cwd();
  const args = parseArgs();

  const defaultReport = args.stage === "phase2"
    ? path.join(root, "reports", "phase2-results.json")
    : path.join(root, "reports", "phase3-results.json");
  const reportPath = resolvePath(root, args.report, defaultReport);
  const truthPath = args.truth
    ? resolvePath(root, args.truth, null)
    : (args.setId ? path.join(root, "eval", `ground_truth.${args.setId}.json`) : null);

  const report = readJson(reportPath, `${args.stage} report`);
  const goldList = truthPath ? toGoldArray(readJson(truthPath, "ground truth")) : [];

  let items = [];
  const predMap = new Map();
  let explanationScores = [];
  let coverage = { count: 0, rules: [] };

  if (args.stage === "phase2") {
    items = Array.isArray(report?.items) ? report.items : [];
    for (const item of items) {
      if (!item?.id) continue;
      predMap.set(item.id, derivePhase2Verdict(item));
    }
  } else {
    items = Array.isArray(report?.result?.items) ? report.result.items : [];
    for (const item of items) {
      if (!item?.id) continue;
      predMap.set(item.id, derivePhase3Verdict(item));
      explanationScores.push(scoreExplanation(item));
    }

    const { map: phase2Map } = collectPhase2(root);
    const coverageRules = [];
    for (const item of items) {
      if (!item?.id) continue;
      const pos = normVerdict(item.position);
      if (pos !== "EXTEND" && pos !== "CHALLENGE") continue;
      const phase2Item = phase2Map.get(item.id);
      const v2 = derivePhase2Verdict(phase2Item);
      const v3 = derivePhase3Verdict(item);
      if (v2 && v3 && v2 !== v3) coverageRules.push(item.id);
    }
    coverage = { count: coverageRules.length, rules: coverageRules };
  }

  const score = goldList.length > 0 ? precisionRecallF1(predMap, goldList) : null;

  let explanationSummary = null;
  if (args.stage === "phase3" && explanationScores.length > 0) {
    const total = explanationScores.length;
    const sum = explanationScores.reduce((acc, v) => acc + v, 0);
    const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const v of explanationScores) {
      const key = String(v);
      distribution[key] = (distribution[key] || 0) + 1;
    }
    explanationSummary = {
      average: Number((sum / total).toFixed(3)),
      total,
      distribution,
    };
  }

  const output = {
    stage: args.stage,
    report: path.relative(root, reportPath),
    truth: truthPath ? path.relative(root, truthPath) : null,
    totals: {
      analysed: items.length,
      withPredictions: predMap.size,
    },
    metrics: score,
    explanationQuality: explanationSummary,
    coverageExpansion: args.stage === "phase3" ? coverage : null,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();

