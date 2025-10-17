/* eslint-disable */
const fs = require("fs");
const path = require("path");

function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function main(){
  const args = process.argv.slice(2);
  let rulesPath=null, outPath=null;
  for (let i=0;i<args.length;i++){
    const t=args[i];
    if (t === '--rules' && args[i+1]) { rulesPath = args[++i]; continue; }
    if (t.startsWith('--rules=')) { rulesPath = t.slice(8); continue; }
    if (t === '--out' && args[i+1]) { outPath = args[++i]; continue; }
    if (t.startsWith('--out=')) { outPath = t.slice(6); continue; }
  }
  if (!rulesPath){
    console.error('Usage: node scripts/make-ground-truth.js --rules cre/rules/rule.3643.json [--out reports/ground-truth.json]');
    process.exit(1);
  }
  const abs = path.resolve(rulesPath);
  const rules = readJson(abs);
  const items = (Array.isArray(rules) ? rules : []).map(r => ({ id: r.id, verdict: 'PASS' }));
  const out = { generatedAt: new Date().toISOString(), source: path.relative(process.cwd(), abs), items };
  const outFile = outPath ? path.resolve(outPath) : path.join(process.cwd(), 'reports', 'ground-truth.json');
  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[make-gt] Wrote ${outFile} with ${items.length} items (all PASS)`);
}

main();

