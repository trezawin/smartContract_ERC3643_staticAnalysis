/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj){ ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function sh(cmd, args, env = {}){
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function cp(from, to){ fs.copyFileSync(from, to); }

async function main(){
  const ROOT = process.cwd();
  const REPORTS = path.join(ROOT, 'reports', 'matrix');
  ensureDir(REPORTS);

  // Mutants simulation: we don't need these, if we had a real buggy implementation.
  const compact = String(process.env.MATRIX_COMPACT || '').trim() === '1';
  let scenarios;
  if (compact) {
    // Compact mode: clean TREX, clean Boulder, and a single audit bug mutant
    scenarios = [
      { id: 'trex-clean', label: 'T-REX Clean', impl: 'trex', mutation: '' },
      { id: 'boulder-clean', label: 'Boulder Clean', impl: 'boulder', mutation: '' },
      { id: 'boulder-audit-bug', label: 'Boulder Audit Bug', impl: 'boulder', mutation: 'token-audit-bug' }
    ];
  } else {
    // Full matrix mode: individual mutant runs
    scenarios = [
      { id: 'trex-clean', label: 'T-REX Clean', impl: 'trex', mutation: '' },
      { id: 'boulder-clean', label: 'Boulder Clean', impl: 'boulder', mutation: '' },
      { id: 'mut-token-audit-bug', label: 'Boulder Audit Bug', impl: 'boulder', mutation: 'token-audit-bug' }
    ];
  }

  const outFiles = [];

  for (const sc of scenarios){
    console.log(`\n[matrix] Scenario: ${sc.label}`);
    // Switch ABIs
    if (sc.impl === 'boulder') {
      if (fs.existsSync('abipaths.boulder.json')) cp('abipaths.boulder.json', 'abipaths.json');
    } else {
      if (fs.existsSync('abipaths.trex.json')) cp('abipaths.trex.json', 'abipaths.json');
    }
    // Bootstrap
    if (sc.impl === 'boulder') {
      sh('node', ['--require','ts-node/register/transpile-only','scripts/bootstrap-boulder.ts'], { BOULDER_MUTATION: sc.mutation, BOULDER_OUTPUT: 'configs/boulder.addresses.json' });
    } else {
      sh('node', ['--require','ts-node/register','scripts/bootstrap-clean.ts']);
    }
    // Run audit
    const outPath = path.join(REPORTS, sc.id + '.json');
    const env = { BOOTSTRAP_IMPL: sc.impl, LLM_MODEL: process.env.LLM_MODEL || 'gpt-4o-mini' };
    if (sc.impl === 'boulder') env.BOULDER_MUTATION = sc.mutation || '';
    sh('node', ['scripts/run.js','--addresses','.cre.addresses.json','--rules','cre/rules/rule.3643.json','--output', outPath], env);
    outFiles.push({ id: sc.id, label: sc.label, path: outPath });
  }

  // Aggregate
  const combined = { generatedAt: new Date().toISOString(), scenarios: [], overall: { total:0, pass:0, critical:0, high:0, medium:0, low:0 } };
  for (const f of outFiles){
    const j = readJson(f.path);
    combined.scenarios.push({ id: f.id, label: f.label, file: path.relative(ROOT, f.path), summary: j.summary, inputs: j.inputs, llm: j.llm, items: j.items });
    combined.overall.total += j.summary.total || j.items.length;
    combined.overall.pass += j.summary.pass || 0;
    combined.overall.critical += j.summary.critical || 0;
    combined.overall.high += j.summary.high || 0;
    combined.overall.medium += j.summary.medium || 0;
    combined.overall.low += j.summary.low || 0;
  }

  writeJson(path.join(ROOT,'reports','matrix-results.json'), combined);
  console.log('[matrix] JSON written: reports/matrix-results.json');
}

main().catch(e=>{ console.error(e); process.exit(1); });
