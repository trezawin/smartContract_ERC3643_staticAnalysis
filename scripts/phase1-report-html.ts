/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";

const REPORT_DIR = path.resolve("reports");
const IN_JSON = path.join(REPORT_DIR, "slither.json");
const IN_CSV  = path.join(REPORT_DIR, "phase1-findings.csv");
const OUT_HTML = path.join(REPORT_DIR, "phase1-report.html");

type SlitherJson = {
  results?: { detectors?: { elements?: SlitherElement[] }[] };
  contracts?: { name: string; source_path?: string; source?: string }[];
};
type SlitherElement = {
  name?: string;
  contract?: string;
  contract_name?: string;
  source_mapping?: { filename_relative?: string; filename_absolute?: string };
};

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}
function normPath(p?: string) {
  if (!p) return "";
  return p.replace(process.cwd() + path.sep, "").replace(/^\.?\//, "");
}
function preferPath(sm?: SlitherElement["source_mapping"]) {
  if (!sm) return "";
  return sm.filename_relative || sm.filename_absolute || "";
}
function parseContract(n?: string) {
  if (!n) return "";
  const dot = n.indexOf(".");
  return dot > 0 ? n.slice(0, dot) : n;
}

function buildContractInventory(sj: SlitherJson) {
  const map = new Map<string, Set<string>>();
  // 1) use top-level contracts if present
  for (const c of sj.contracts ?? []) {
    const name = c.name?.trim();
    const file = (c.source_path || c.source || "").trim();
    if (!name) continue;
    if (!map.has(name)) map.set(name, new Set());
    if (file) map.get(name)!.add(file);
  }
  // 2) also infer from detector elements (backfill)
  for (const det of sj.results?.detectors ?? []) {
    for (const el of det.elements ?? []) {
      const cname = parseContract(el.contract_name || el.contract || el.name);
      if (!cname) continue;
      if (!map.has(cname)) map.set(cname, new Set());
      const file = preferPath(el.source_mapping);
      if (file) map.get(cname)!.add(file);
    }
  }
  return Array.from(map.entries())
    .map(([contract, files]) => ({ contract, files: Array.from(files).map(normPath).sort() }))
    .sort((a, b) => a.contract.localeCompare(b.contract));
}

function esc(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function htmlTable(headers: string[], rows: string[][]) {
  const thead = `<thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

(function main(){
  if (!fs.existsSync(IN_JSON) || !fs.existsSync(IN_CSV)) {
    console.error("Missing inputs. Run: npm run phase1:slither && npm run phase1:summary");
    process.exit(1);
  }
  const sj = readJson<SlitherJson>(IN_JSON);
  const contracts = buildContractInventory(sj);

  const contractRows = contracts.map(c => [
    esc(c.contract),
    c.files.length ? c.files.map(f=>`<div class="mono">${esc(f)}</div>`).join("") : "—",
  ]);

  const csv = fs.readFileSync(IN_CSV, "utf8").trim().split(/\r?\n/);
  const csvHeader = csv.shift()!.split(",");
  const csvRows = csv.map(line => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c=>esc(c.replace(/^"|"$/g,""))));

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Phase-1 Static Analysis Report</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px;color:#222;}
  h1,h2{margin:0 0 8px}
  .meta{color:#666;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;margin:12px 0}
  th,td{border:1px solid #ddd;padding:8px;vertical-align:top}
  th{background:#f7f7f7;text-align:left}
  .mono{font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
  .small{font-size:12px;color:#555}
  .grid{display:grid;grid-template-columns:1fr}
</style>
</head>
<body>
  <h1>Phase-1 Static Analysis (Slither)</h1>
  <div class="meta">Generated: ${new Date().toLocaleString()}</div>

  <h2>Contract Inventory</h2>
  ${htmlTable(["Contract","File(s)"], contractRows)}

  <h2>Findings</h2>
  <div class="small">Columns: ${esc(csvHeader.join(" | "))}</div>
  ${htmlTable(csvHeader, csvRows)}
</body>
</html>`;

  fs.writeFileSync(OUT_HTML, html, "utf8");
  console.log(`[phase1] HTML report written:\n - ${OUT_HTML}`);
})();