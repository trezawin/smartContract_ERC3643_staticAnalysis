/* eslint-disable no-console */
/**
 * External smart-contract compliance scan.
 *
 * Walks every flattened contract under `contracts/SmartContract-External/**`,
 * performs a lightweight static pattern check for the two ERC-3643 rules,
 * and consolidates the outcomes into a single report that can be rendered
 * with the existing HTML renderer.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT_ROOT = process.cwd();
const EXTERNAL_ROOT = path.join(PROJECT_ROOT, "contracts", "SmartContract-External");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "reports", "external");
const RULE_FILE = path.join("cre", "rules", "rule.3643.json");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const { helpers } = require("./deterministic-run.js");
const {
  normalizeSeverityValue,
  severityLabel,
  severityWeight
} = helpers;

const RULE_CODE_REFERENCES = {
  "R-ERC3643-01": [
    "./ERC-3643-Implementation/contracts/token/Token.sol:transfer(address,address,uint256)",
    "./ERC-3643-Implementation/contracts/registry/implementation/IdentityRegistry.sol:isVerified(address)"
  ],
  "R-ERC3643-02": [
    "./ERC-3643-Implementation/contracts/token/Token.sol:transfer(address,address,uint256)",
    "./ERC-3643-Implementation/contracts/compliance/modular/ModularCompliance.sol:canTransfer(address,address,uint256)"
  ]
};

function listExternalContracts() {
  if (!fs.existsSync(EXTERNAL_ROOT)) {
    throw new Error(`External contract directory not found: ${EXTERNAL_ROOT}`);
  }
  const entries = [];
  const dirs = fs.readdirSync(EXTERNAL_ROOT, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(EXTERNAL_ROOT, dir.name);
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".sol"));
    if (!files.length) continue;
    for (const file of files) {
      entries.push({
        folder: dir.name,
        file,
        fullPath: path.join(dirPath, file),
        relativePath: path.join("contracts", "SmartContract-External", dir.name, file)
      });
    }
  }
  return entries;
}

function loadRules() {
  const rulesPath = path.join(PROJECT_ROOT, RULE_FILE);
  const data = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const map = new Map();
  for (const rule of data) {
    map.set(rule.id, rule);
  }
  return { map, rulesPath };
}

function attachSeverity(item, ruleMeta) {
  const severityInfo = normalizeSeverityValue(ruleMeta?.severity || "MEDIUM");
  item.severity = severityInfo.code;
  item.severityCode = severityInfo.code;
  item.severityLabel = severityInfo.label;
  item.severityOriginal = severityInfo.original;
  item.severityWeight = severityInfo.weight;
  return item;
}

function evaluateRulePatterns(contractContent) {
  const normalized = contractContent.replace(/\s+/g, " ").toLowerCase();
  const hasIdentityCheck = normalized.includes("identityregistry.isverified(");
  const hasComplianceCheck = normalized.includes("compliance.cantransfer(");
  return { hasIdentityCheck, hasComplianceCheck };
}

function makeRuleItem(ruleMeta, contractLabel, contractPath, pass, note) {
  const id = ruleMeta.id;
  const item = attachSeverity({
    id,
    title: ruleMeta.title,
    desc: ruleMeta.desc || "",
    snippet: ruleMeta.snippet || "",
    policyRef: ruleMeta.policyRef || "",
    pass,
    note,
    run: contractLabel,
    details: [
      {
        static: true,
        file: contractPath,
        evidence: note
      }
    ]
  }, ruleMeta);
  if (RULE_CODE_REFERENCES[id]) {
    item.codeReferences = [...RULE_CODE_REFERENCES[id]];
  }
  return item;
}

function summarize(items) {
  const summary = {
    total: items.length,
    pass: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    fail: 0,
    warn: 0,
    info: 0
  };
  for (const item of items) {
    if (item.pass) {
      summary.pass += 1;
      continue;
    }
    const sev = String(item.severity || item.severityCode || "").toUpperCase();
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

function aggregateSummary(collections) {
  const summary = {
    total: 0,
    pass: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    fail: 0,
    warn: 0,
    info: 0
  };
  for (const part of collections) {
    summary.total += part.total;
    summary.pass += part.pass;
    summary.critical += part.critical;
    summary.high += part.high;
    summary.medium += part.medium;
    summary.low += part.low;
  }
  summary.fail = summary.critical;
  summary.warn = summary.high + summary.medium;
  summary.info = summary.low;
  return summary;
}

function buildRunEntry(contractLabel, contractPath, items) {
  const summary = summarize(items);
  return {
    label: contractLabel,
    rulesPath: RULE_FILE,
    addressesPath: contractPath,
    summary,
    addresses: {
      token: contractPath,
      identityRegistry: ZERO_ADDRESS,
      claimTopicsRegistry: ZERO_ADDRESS,
      trustedIssuersRegistry: ZERO_ADDRESS,
      compliance: ZERO_ADDRESS
    },
    probes: {}
  };
}

function buildReportText(perContract) {
  const lines = [];
  lines.push("External Smart Contracts Compliance Scan");
  lines.push(`Generated: ${new Date().toISOString()}`);
  for (const entry of perContract) {
    lines.push("");
    lines.push(`Contract: ${entry.contractLabel}`);
    lines.push(`Source: ${entry.contractPath}`);
    for (const item of entry.items) {
      lines.push(`- ${severityLabel(item.severity)} ${item.id}: ${item.pass ? "PASS" : "FAIL"}`);
      lines.push(`  ${item.note}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const { map: ruleMap } = loadRules();
  const externalContracts = listExternalContracts();
  if (!externalContracts.length) {
    console.log("No external contracts found. Nothing to do.");
    return;
  }

  // Ensure artifacts exist (best effort).
  try {
    execFileSync("npx", ["hardhat", "compile"], { stdio: "ignore", cwd: PROJECT_ROOT });
  } catch {
    // ignore – compilation is only to keep artifacts in sync.
  }

  const aggregateItems = [];
  const perContractSummaries = [];

  for (const contract of externalContracts) {
    const content = fs.readFileSync(contract.fullPath, "utf8");
    const { hasIdentityCheck, hasComplianceCheck } = evaluateRulePatterns(content);
    const label = `${contract.folder}/${contract.file}`;

    const items = [];

    const rule1 = ruleMap.get("R-ERC3643-01");
    if (rule1) {
      const note = hasIdentityCheck
        ? "Static scan identified identityRegistry.isVerified() within the contract; treated as identity gating."
        : "Static scan did not find a call to identityRegistry.isVerified(); treated as missing identity gating.";
      items.push(makeRuleItem(rule1, label, contract.relativePath, hasIdentityCheck, note));
    }

    const rule2 = ruleMap.get("R-ERC3643-02");
    if (rule2) {
      const note = hasComplianceCheck
        ? "Static scan found compliance.canTransfer() usage; treated as compliance hook present."
        : "Static scan did not find compliance.canTransfer() usage; treated as compliance hook missing.";
      items.push(makeRuleItem(rule2, label, contract.relativePath, hasComplianceCheck, note));
    }

    aggregateItems.push(...items);
    perContractSummaries.push({
      contractLabel: label,
      contractPath: contract.relativePath,
      items,
      run: buildRunEntry(label, contract.relativePath, items)
    });
  }

  const overallSummary = aggregateSummary(perContractSummaries.map((p) => p.run.summary));

  const outputJson = {
    generatedAt: new Date().toISOString(),
    inputs: {
      sourceDirectory: "contracts/SmartContract-External",
      contracts: perContractSummaries.map((p) => p.contractPath),
      ruleFiles: [RULE_FILE]
    },
    items: aggregateItems,
    summary: overallSummary,
    runs: perContractSummaries.map((p) => p.run),
    metrics: null,
    deterministicMetrics: null,
    llm: {
      model: null,
      disabled: true,
      reason: "LLM disabled for external static scan.",
      overallAssessment: "LLM disabled for external static scan.",
      findings: []
    },
    coverageDistribution: null,
    report: {
      textPath: "reports/external/external-results.txt"
    }
  };

  const jsonPath = path.join(OUTPUT_DIR, "external-results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(outputJson, null, 2));
  console.log(`JSON written: ${jsonPath}`);

  const textReport = buildReportText(perContractSummaries);
  const textPath = path.join(OUTPUT_DIR, "external-results.txt");
  fs.writeFileSync(textPath, `${textReport}\n`);
  console.log(`Text report written: ${textPath}`);

  const htmlPath = path.join(OUTPUT_DIR, "external-report.html");
  execFileSync("node", [
    "scripts/render.js",
    "--input",
    path.relative(PROJECT_ROOT, jsonPath),
    "--output",
    path.relative(PROJECT_ROOT, htmlPath)
  ], { stdio: "inherit", cwd: PROJECT_ROOT });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
