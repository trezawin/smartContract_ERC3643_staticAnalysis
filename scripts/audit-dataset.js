/* eslint-disable no-console */
/**
 * Orchestrate a dataset audit using existing run.js without modifying core.
 *
 * Steps:
 *  - Build minimal ABI artifacts and addresses from dataset (if not already).
 *  - Backup current abipaths.json, swap in abipaths.dataset.json.
 *  - Copy configs/dataset.addresses.json to .cre.addresses.json to enable fallback semantics.
 *  - Run scripts/run.js to produce JSON + HTML under reports/dataset/.
 *  - Restore original abipaths.json.
 *
 * Usage:
 *   node scripts/audit-dataset.js --dir /path/to/dataset
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function parseArgs() {
  const args = process.argv.slice(2);
  let dir = process.env.DATASET_DIR || '';
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (t === '--dir' && args[i+1]) { dir = args[++i]; continue; }
    if (t.startsWith('--dir=')) { dir = t.slice(6); continue; }
  }
  if (!dir) throw new Error('Missing --dir <dataset_root>');
  const abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  if (!fs.existsSync(abs)) throw new Error(`Dataset not found: ${abs}`);
  return { datasetDir: abs };
}

function runNode(script, args, opts) {
  execFileSync('node', [script, ...args], { stdio: 'inherit', ...(opts||{}) });
}

function main() {
  const { datasetDir } = parseArgs();
  // 1) Build abstractions
  runNode('scripts/build-dataset-abstractions.js', ['--dir', datasetDir], { cwd: process.cwd() });

  const root = process.cwd();
  const reportsDir = path.join(root, 'reports', 'dataset');
  ensureDir(reportsDir);

  // 2) Swap abipaths.json
  const abipaths = path.join(root, 'abipaths.json');
  const abipathsBackup = path.join(root, 'abipaths.backup.json');
  const abipathsDataset = path.join(root, 'abipaths.dataset.json');
  let restored = false;
  try {
    if (fs.existsSync(abipaths)) {
      fs.copyFileSync(abipaths, abipathsBackup);
    }
    fs.copyFileSync(abipathsDataset, abipaths);

    // 3) Prepare addresses
    const datasetAddresses = path.join(root, 'configs', 'dataset.addresses.json');
    fs.copyFileSync(datasetAddresses, path.join(root, '.cre.addresses.json'));

    // 4) Run the audit
    const jsonOut = path.join('reports', 'dataset', 'dataset-results.json');
    const htmlOut = path.join('reports', 'dataset', 'dataset-report.html');
    runNode('scripts/run.js', ['--addresses', '.cre.addresses.json', '--rules', 'cre/rules/rule.3643.json', '--output', jsonOut]);
    runNode('scripts/render.js', ['--input', jsonOut, '--output', htmlOut]);
  } finally {
    // 5) Restore abipaths.json
    try {
      if (fs.existsSync(abipathsBackup)) {
        fs.copyFileSync(abipathsBackup, abipaths);
        fs.unlinkSync(abipathsBackup);
        restored = true;
      }
    } catch (e) {
      console.warn('Restore abipaths.json failed:', e.message);
    }
  }

  console.log('Dataset audit complete.');
}

main();

