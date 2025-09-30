// scripts/summarize-slither.ts
/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";

type SlitherJson = {
  success?: boolean;
  results?: {
    detectors?: SlitherDetector[];
  };
  // Some Slither builds also include a top-level "contracts" array; we’ll try both.
  contracts?: { name: string; source_path?: string; source?: string }[];
};

type SlitherDetector = {
  check: string;               // e.g., "reentrancy-no-eth"
  impact: "High" | "Medium" | "Low" | "Informational" | string;
  confidence?: string;
  description?: string;
  elements?: SlitherElement[];
};

type SlitherElement = {
  type?: string;               // "function", "contract", "variable", etc.
  name?: string;               // e.g., "Token.setCompliance(address)"
  source_mapping?: {
    filename_relative?: string;
    filename_absolute?: string;
    lines?: number[];
    start?: number;
  };
  // Some Slither versions use "source_mapping_str" or nested "source_map"; be defensive.
  source_mapping_str?: string;
  // Slither sometimes includes "contract_name" in elements
  contract?: string;
  contract_name?: string;
  // Some printers use "type_specific_fields" to carry extra context
  type_specific_fields?: Record<string, unknown>;
};

// ---------- Config ----------
const REPORT_DIR = path.resolve("reports");
const IN_JSON = path.join(REPORT_DIR, "slither.json");
const OUT_MD = path.join(REPORT_DIR, "phase1-summary.md");
const OUT_CSV = path.join(REPORT_DIR, "phase1-findings.csv");

// ---------- Helpers ----------
function readJson<T = any>(p: string): T {
  if (!fs.existsSync(p)) {
    throw new Error(`[phase1] Could not read ${p}. Did phase1:slither run successfully?`);
  }
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as T;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function safeJoinLines(lines?: number[]): string {
  if (!lines || lines.length === 0) return "";
  // compress consecutive runs: [10,11,12,15] => "10-12,15"
  const sorted = [...lines].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    if (v === prev + 1) {
      prev = v;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = v;
  }
  runs.push(start === prev ? `${start}` : `${start}-${prev}`);
  return runs.join(",");
}

function parseContractAndFunc(elementName?: string): { contract?: string; func?: string } {
  if (!elementName) return {};
  // Common shapes:
  // "Token.setCompliance(address)"
  // "IdentityRegistry.isVerified(address)"
  // "Token" (contract)
  const dot = elementName.indexOf(".");
  if (dot > 0 && dot < elementName.length - 1) {
    return {
      contract: elementName.substring(0, dot),
      func: elementName.substring(dot + 1),
    };
  }
  // If no dot, it might just be a contract or a free function name
  // We’ll treat it as contract when type is "contract"; caller will handle.
  return { contract: elementName };
}

function preferPath(sm?: SlitherElement["source_mapping"]): string {
  if (!sm) return "";
  return (
    sm.filename_relative ||
    sm.filename_absolute ||
    ""
  );
}

function extractContracts(slither: SlitherJson) {
  // Strategy:
  // 1) If slither.contracts exists, use it.
  // 2) Else, scan detectors.elements and infer (contractName, file) pairs from function names + source_mapping.
  const pairs = new Map<string, Set<string>>(); // contract -> set(files)

  if (Array.isArray(slither.contracts)) {
    for (const c of slither.contracts) {
      const name = c.name?.trim();
      const file = (c.source_path || c.source || "").trim();
      if (name) {
        if (!pairs.has(name)) pairs.set(name, new Set());
        if (file) pairs.get(name)!.add(file);
      }
    }
  }

  const dets = slither.results?.detectors || [];
  for (const d of dets) {
    for (const el of d.elements || []) {
      const nm = (el.contract_name || el.contract || el.name || "").trim();
      const smFile = preferPath(el.source_mapping);
      let contractFromName: string | undefined;
      if (nm) {
        // If name includes "Contract.func", split; else assume whole is contract or will be overwritten below
        const parsed = parseContractAndFunc(nm);
        contractFromName = parsed.contract;
      }
      // fallback: try parsing the element.name for contract part
      if (!contractFromName && el.name) {
        contractFromName = parseContractAndFunc(el.name).contract;
      }
      if (contractFromName) {
        if (!pairs.has(contractFromName)) pairs.set(contractFromName, new Set());
        if (smFile) pairs.get(contractFromName)!.add(smFile);
      }
    }
  }

  // Flatten
  const rows: { contract: string; files: string[] }[] = [];
  for (const [k, v] of pairs) {
    rows.push({ contract: k, files: Array.from(v).sort() });
  }
  // Sort contracts alphabetically
  rows.sort((a, b) => a.contract.localeCompare(b.contract));
  return rows;
}

function countBySeverity(detectors: SlitherDetector[]) {
  const counts = { High: 0, Medium: 0, Low: 0, Informational: 0, Other: 0 };
  for (const d of detectors) {
    const sev = (d.impact || "").toString();
    if (sev in counts) (counts as any)[sev] += 1;
    else counts.Other += 1;
  }
  return counts;
}

function tallyDetectors(detectors: SlitherDetector[]) {
  const map = new Map<string, number>();
  for (const d of detectors) {
    const k = `${d.impact || "?"} | ${d.check}`;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ key: k, count: n }));
}

function normPath(p: string): string {
  if (!p) return "";
  return p.replace(process.cwd() + path.sep, "").replace(/^\.?\//, "");
}

function toCsvRow(vals: (string | number)[]) {
  const esc = (s: string | number) => {
    const v = String(s ?? "");
    if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  return vals.map(esc).join(",");
}

// ---------- Main ----------
(function main() {
  try {
    ensureDir(REPORT_DIR);
    const slither = readJson<SlitherJson>(IN_JSON);
    const detectors = (slither.results?.detectors || []).filter(
      (d) => Array.isArray(d.elements) && d.elements.length > 0
    );

    // 1) Contract Inventory
    const contracts = extractContracts(slither);

    // 2) Severity counts (overall)
    const sevCounts = countBySeverity(detectors);

    // 3) Top detectors
    const top = tallyDetectors(detectors).slice(0, 10);

    // 4) Flatten findings to one row per (detector x element) for CSV & sample table
    type Row = {
      impact: string;
      check: string;
      contract: string;
      func: string;
      file: string;
      lines: string;
    };
    const rows: Row[] = [];
    for (const d of detectors) {
      for (const el of d.elements || []) {
        const { contract = "", func = "" } = parseContractAndFunc(el.name || el.contract_name || el.contract);
        const file = normPath(preferPath(el.source_mapping));
        const lines = safeJoinLines(el.source_mapping?.lines);
        rows.push({
          impact: d.impact || "",
          check: d.check,
          contract,
          func,
          file,
          lines,
        });
      }
    }

    // De-duplicate rows (same impact/check/contract/func/file/lines)
    const dedupKey = (r: Row) => `${r.impact}__${r.check}__${r.contract}__${r.func}__${r.file}__${r.lines}`;
    const seen = new Set<string>();
    const deduped: Row[] = [];
    for (const r of rows) {
      const k = dedupKey(r);
      if (!seen.has(k)) {
        seen.add(k);
        deduped.push(r);
      }
    }

    // 5) Write CSV
    const csvHeader = ["impact", "check", "contract", "function", "file", "lines"].join(",");
    const csvBody = deduped.map((r) => toCsvRow([r.impact, r.check, r.contract, r.func, r.file, r.lines])).join("\n");
    fs.writeFileSync(OUT_CSV, `${csvHeader}\n${csvBody}\n`, "utf8");

    // 6) Write Markdown summary
    const nowIso = new Date().toISOString();
    const md: string[] = [];
    md.push(`# Phase-1 Static Analysis Summary (Slither)`);
    md.push("");
    md.push(`**Date:** ${nowIso}`);
    md.push("");
    md.push(`## Scope & Inputs`);
    md.push(`- Tool: Slither (Python CLI)`);
    md.push(`- Raw outputs: \`reports/slither.json\`, \`reports/slither.sarif\``);
    md.push("");

    md.push(`## Contract Inventory`);
    if (contracts.length === 0) {
      md.push(`_No explicit contract list found in JSON; results may be limited by Slither version or filters._`);
    } else {
      md.push(`| Contract | File(s) |`);
      md.push(`|---|---|`);
      for (const c of contracts) {
        const files = c.files.length ? c.files.map(normPath).join("<br>") : "";
        md.push(`| ${c.contract} | ${files} |`);
      }
    }
    md.push("");

    md.push(`## Findings by Severity (all)`);
    md.push(`- High: ${sevCounts.High}`);
    md.push(`- Medium: ${sevCounts.Medium}`);
    md.push(`- Low: ${sevCounts.Low}`);
    md.push(`- Informational: ${sevCounts.Informational}`);
    if (sevCounts.Other) md.push(`- Other: ${sevCounts.Other}`);
    md.push("");

    md.push(`## Top Detector Patterns`);
    if (top.length === 0) {
      md.push(`_No detector entries found._`);
    } else {
      md.push(`| Rank | Detector | Count |`);
      md.push(`|---:|---|---:|`);
      top.forEach((t, i) => md.push(`| ${i + 1} | ${t.key} | ${t.count} |`));
    }
    md.push("");

    md.push(`## Sample Findings (first 25)`);
    const sample = deduped.slice(0, 25);
    if (sample.length === 0) {
      md.push(`_No findings to display._`);
    } else {
      md.push(`| Impact | Check | Contract | Function | File:Lines |`);
      md.push(`|---|---|---|---|---|`);
      for (const r of sample) {
        const fileLines = r.lines ? `${r.file}:${r.lines}` : r.file;
        md.push(`| ${r.impact} | ${r.check} | ${r.contract || "—"} | ${r.func || "—"} | ${fileLines} |`);
      }
    }
    md.push("");

    md.push(`## Notes for Thesis`);
    md.push(`- Phase-1 focuses on **technical** vulnerabilities (tool-based).`);
    md.push(`- Phase-2 (CRE baseline) will address **regulatory** rules (KYC, jurisdiction, investor-type) that static analyzers don’t model.`);
    md.push("");

    fs.writeFileSync(OUT_MD, md.join("\n"), "utf8");

    console.log(`[phase1] Wrote:\n - ${OUT_MD}\n - ${OUT_CSV}`);
  } catch (err: any) {
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  }
})();
// // scripts/summarize-slither.ts
// import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
// import { join, relative } from "node:path";

// const REPORT_DIR = join(process.cwd(), "reports");
// const JSON_IN = join(REPORT_DIR, "slither.json");
// const MD_OUT = join(REPORT_DIR, "phase1-summary.md");
// const CSV_OUT = join(REPORT_DIR, "phase1-findings.csv");

// type SlitherDetector = {
//   check: string;
//   impact: "High" | "Medium" | "Low" | "Informational";
//   confidence?: string;
//   description?: string;
//   elements?: {
//     type?: string;
//     name?: string;
//     source_mapping?: {
//       filename_absolute?: string;
//       filename_relative?: string;
//       lines?: number[];
//       start?: number;
//       end?: number;
//     };
//   }[];
// };

// type SlitherJson = {
//   results?: { detectors?: SlitherDetector[] };
//   slither?: { contracts?: { name: string }[] };
// };

// const T_REX_PATH_HINTS = [
//   "/node_modules/@tokenysolutions/t-rex/",
//   "/vendor/T-REX/",
//   "/node_modules/@onchain-id/solidity/",
// ];

// function isTrexFile(p: string) {
//   const s = (p || "").replace(/\\\\/g, "/");
//   return T_REX_PATH_HINTS.some(h => s.includes(h));
// }

// function uniq<T>(arr: T[]): T[] {
//   return Array.from(new Set(arr));
// }

// function safeRel(p?: string) {
//   if (!p) return "";
//   try { return relative(process.cwd(), p); } catch { return p; }
// }

// function run() {
//   mkdirSync(REPORT_DIR, { recursive: true });

//   let raw: string;
//   try {
//     raw = readFileSync(JSON_IN, "utf8");
//   } catch {
//     console.error(`[phase1] Could not read ${JSON_IN}. Did phase1:slither run successfully?`);
//     process.exit(1);
//   }

//   const data: SlitherJson = JSON.parse(raw);
//   const detectors = data.results?.detectors ?? [];

//   type Row = {
//     impact: string;
//     check: string;
//     contract?: string;
//     fn?: string;
//     file?: string;
//     line?: string;
//     description?: string;
//     isTrex: boolean;
//   };

//   const rows: Row[] = [];

//   for (const d of detectors) {
//     const check = d.check;
//     const impact = d.impact;
//     const desc = (d.description || "").trim();

//     if (!d.elements || d.elements.length === 0) {
//       rows.push({ impact, check, description: desc, isTrex: false });
//       continue;
//     }

//     for (const el of d.elements) {
//       const src = el.source_mapping || {};
//       const fileAbs = src.filename_absolute || src.filename_relative || "";
//       const file = safeRel(fileAbs);
//       const line = (src.lines && src.lines.length) ? String(src.lines[0]) : "";

//       let contract: string | undefined;
//       let fn: string | undefined;
//       if (el.name) {
//         const parts = el.name.split(".");
//         if (parts.length === 2) { contract = parts[0]; fn = parts[1]; }
//         else if (parts.length === 1) { contract = parts[0]; }
//       }

//       rows.push({
//         impact,
//         check,
//         contract,
//         fn,
//         file,
//         line,
//         description: desc,
//         isTrex: isTrexFile(fileAbs),
//       });
//     }
//   }

//   const sevOrder = ["High", "Medium", "Low", "Informational"] as const;
//   const sevCounts: Record<string, number> = { High:0, Medium:0, Low:0, Informational:0 };
//   rows.forEach(r => { if (r.impact in sevCounts) sevCounts[r.impact] += 1; });

//   const trexRows = rows.filter(r => r.isTrex);
//   const trexCounts: Record<string, number> = { High:0, Medium:0, Low:0, Informational:0 };
//   trexRows.forEach(r => { if (r.impact in trexCounts) trexCounts[r.impact] += 1; });

//   const contractsFromRows = uniq(rows.map(r => r.contract).filter(Boolean) as string[]);
//   const contractsFromSlither = (data.slither?.contracts?.map(c => c.name) ?? []) as string[];
//   const contractInventory = uniq([...contractsFromRows, ...contractsFromSlither]).sort();

//   let md = "";
//   md += `# Phase-1 Static Analysis Summary (Slither)\n\n`;
//   md += `**Date:** ${new Date().toISOString()}\n\n`;
//   md += `## Scope & Inputs\n`;
//   md += `- Tool: Slither (Python CLI)\n`;
//   md += `- Raw outputs: \`reports/slither.json\`, \`reports/slither.sarif\`\n\n`;

//   md += `## Contract Inventory (observed)\n`;
//   if (contractInventory.length) {
//     md += contractInventory.map(n => `- ${n}`).join("\n") + "\n\n";
//   } else {
//     md += `- (not present in this JSON format)\n\n`;
//   }

//   md += `## Findings by Severity (all code)\n`;
//   for (const s of sevOrder) md += `- ${s}: ${sevCounts[s]}\n`;
//   md += `\n`;

//   md += `## Findings by Severity (ERC-3643/T-REX slice)\n`;
//   for (const s of sevOrder) md += `- ${s}: ${trexCounts[s]}\n`;
//   md += `\n`;

//   md += `## Sample Findings (up to 25)\n`;
//   const sample = rows.slice(0, 25);
//   if (!sample.length) {
//     md += `No findings emitted (or format unrecognized).\n\n`;
//   } else {
//     md += `| Impact | Check | Contract | Function | File:Line |\n`;
//     md += `|---|---|---|---|---|\n`;
//     for (const r of sample) {
//       md += `| ${r.impact} | ${r.check} | ${r.contract ?? ""} | ${r.fn ?? ""} | ${r.file ?? ""}${r.line ? ":" + r.line : ""} |\n`;
//     }
//     md += `\n`;
//   }

//   md += `## Notes for Thesis\n`;
//   md += `- Phase-1 focuses on **technical** vulnerabilities.\n`;
//   md += `- Phase-2 (CRE baseline) will address **regulatory** rules not covered by Slither (KYC, jurisdiction, investor-type).\n`;

//   writeFileSync(MD_OUT, md, "utf8");

//   const header = ["impact","check","contract","function","file","line","isTrex","description"];
//   let csv = header.join(",") + "\n";
//   for (const r of rows) {
//     const row = [
//       r.impact,
//       r.check.replace(/,/g, " "),
//       r.contract ?? "",
//       r.fn ?? "",
//       (r.file ?? "").replace(/,/g, " "),
//       r.line ?? "",
//       String(r.isTrex),
//       (r.description ?? "").replace(/\s+/g, " ").replace(/,/g, " "),
//     ];
//     csv += row.join(",") + "\n";
//   }
//   writeFileSync(CSV_OUT, csv, "utf8");

//   console.log(`[phase1] Wrote:\n - ${MD_OUT}\n - ${CSV_OUT}`);
// }

// run();