/* eslint-disable */
const fs = require("fs");
const path = require("path");

function readJson(p){ return JSON.parse(fs.readFileSync(p,"utf8")); }
function exists(p){ try{ fs.accessSync(p); return true; } catch{ return false; } }

function loadAbiFromArtifact(p){
  const abs = path.resolve(p);
  if (!exists(abs)) throw new Error(`Artifact not found: ${abs}`);
  const art = readJson(abs);
  return Array.isArray(art.abi) ? art.abi : [];
}

function extractSurface(abi){
  const fns = new Set();
  const names = new Set();
  const evts = new Set();
  for (const e of abi){
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'function'){
      const sig = `${e.name}(${(e.inputs||[]).map(i=>i.type||'*').join(',')})`;
      fns.add(sig);
      names.add(e.name);
    } else if (e.type === 'event'){
      evts.add(e.name);
    }
  }
  return { functions: fns, events: evts, names };
}

function loadMap(p){
  const j = readJson(path.resolve(p));
  const m = {};
  for (const key of ["Token","IdentityRegistry","ClaimTopicsRegistry","TrustedIssuersRegistry"]) {
    const fp = j[key] || j[key.toLowerCase()];
    if (fp) m[key] = extractSurface(loadAbiFromArtifact(fp));
  }
  return m;
}

function diffSet(a, b){
  const onlyA=[]; const onlyB=[];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  for (const x of b) if (!a.has(x)) onlyB.push(x);
  return { onlyA, onlyB };
}

function main(){
  const args = process.argv.slice(2);
  let aPath=null, bPath=null, out=null;
  for (let i=0;i<args.length;i++){
    const t=args[i];
    if (t === '--a' && args[i+1]) { aPath = args[++i]; continue; }
    if (t.startsWith('--a=')) { aPath = t.slice(4); continue; }
    if (t === '--b' && args[i+1]) { bPath = args[++i]; continue; }
    if (t.startsWith('--b=')) { bPath = t.slice(4); continue; }
    if (t === '--out' && args[i+1]) { out = args[++i]; continue; }
    if (t.startsWith('--out=')) { out = t.slice(6); continue; }
  }
  if (!aPath || !bPath){
    console.error('Usage: node scripts/abi-diff.js --a abipaths.trex.json --b abipaths.boulder.json [--out reports/abi-diff.json]');
    process.exit(1);
  }

  const A = loadMap(aPath);
  const B = loadMap(bPath);

  const required = {
    Token: ["identityRegistry()","compliance()","balanceOf(address)","transfer(address,uint256)"],
    IdentityRegistry: ["isVerified(address)"],
    ClaimTopicsRegistry: ["getClaimTopics()"],
    TrustedIssuersRegistry: []
  };
  const optional = {
    // Admin surface used by probe injection, not mandatory
    ComplianceAdmin: ["addModule(address)","removeModule(address)","callModuleFunction(bytes,address)"]
  };

  const report = { ok:true, modules:{} };
  for (const key of Object.keys(required)){
    const a = A[key]; const b = B[key];
    if (!a || !b){ report.ok=false; report.modules[key] = { present:false, reason:`Missing ${key} in one map` }; continue; }
    const fd = diffSet(a.functions, b.functions);
    const ed = diffSet(a.events, b.events);
    const missingRequired = required[key].filter(sig => !b.functions.has(sig));
    report.modules[key] = {
      present: true,
      missingRequired,
      onlyInA: fd.onlyA,
      onlyInB: fd.onlyB,
      eventsOnlyInA: ed.onlyA,
      eventsOnlyInB: ed.onlyB
    };
    if (missingRequired.length) report.ok=false;
  }

  // Check optional compliance admin functions across both maps (Token/Compliance not directly provided in abipaths.json)
  report.optional = { complianceAdminMissing: optional.ComplianceAdmin.filter(sig => !(B.Token?.functions.has(sig) || B.IdentityRegistry?.functions.has(sig))) };

  const text = [];
  text.push(`# ABI Diff Summary`);
  for (const k of Object.keys(report.modules)){
    const m = report.modules[k];
    if (!m.present){ text.push(`- ${k}: MISSING in one set`); continue; }
    if (m.missingRequired && m.missingRequired.length){
      text.push(`- ${k}: missing required signatures in B → ${m.missingRequired.join(', ')}`);
    } else {
      text.push(`- ${k}: required signatures OK`);
    }
    if (m.onlyInA.length) text.push(`  • only in A: ${m.onlyInA.join(', ')}`);
    if (m.onlyInB.length) text.push(`  • only in B: ${m.onlyInB.join(', ')}`);
  }
  if (report.optional.complianceAdminMissing.length){
    text.push(`- Optional admin (for probe injection) not found: ${report.optional.complianceAdminMissing.join(', ')}`);
  }

  const outObj = { summary: report, note: text.join('\n') };
  if (out){ fs.writeFileSync(out, JSON.stringify(outObj,null,2)); console.log(`[abi-diff] JSON written: ${out}`); }
  console.log(text.join('\n'));
  process.exit(report.ok ? 0 : 2);
}

main();

