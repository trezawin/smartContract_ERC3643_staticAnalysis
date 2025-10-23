/* eslint-disable no-console */
/**
 * Build minimal ABI artifacts and addresses mapping from an external dataset.
 *
 * - Scans a dataset directory for metadata.json files (Etherscan-style),
 *   extracts ABI and deployed Address.
 * - Tries to identify ERC-3643 components by contract name heuristics.
 * - Writes minimal artifact JSONs under artifacts/dataset/*.json (abi only).
 * - Writes configs/dataset.addresses.json and abipaths.dataset.json.
 *
 * Usage:
 *   node scripts/build-dataset-abstractions.js --dir /path/to/dataset
 */
const fs = require('fs');
const path = require('path');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

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

function walkMetadataFiles(root) {
  const out = [];
  function walk(d) {
    const ents = fs.readdirSync(d, { withFileTypes: true });
    for (const e of ents) {
      if (e.isDirectory()) { walk(path.join(d, e.name)); continue; }
      if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
        out.push(path.join(d, e.name));
      }
    }
  }
  walk(root);
  return out;
}

function classifyName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('token') && !n.includes('factory') && !n.includes('gateway')) return 'Token';
  if (n.includes('identityregistry')) return 'IdentityRegistry';
  if (n.includes('claimtopicsregistry') || n.includes('claimtopic')) return 'ClaimTopicsRegistry';
  if (n.includes('trustedissuersregistry') || n.includes('issuersregistry')) return 'TrustedIssuersRegistry';
  if (n.includes('compliance')) return 'ModularCompliance';
  return null;
}

function pickFirst(map, key) {
  const arr = map[key] || [];
  return arr.length ? arr[0] : null;
}

function main() {
  const { datasetDir } = parseArgs();
  const metaFiles = walkMetadataFiles(datasetDir);
  if (!metaFiles.length) throw new Error('No JSON files found in dataset');

  // Group candidates by component type
  const buckets = { Token: [], IdentityRegistry: [], ClaimTopicsRegistry: [], TrustedIssuersRegistry: [], ModularCompliance: [] };

  for (const mf of metaFiles) {
    const j = readJsonSafe(mf);
    if (!j) continue;
    // Support Etherscan metadata and raw artifact JSON formats
    const name = j.ContractName || j.contractName || j.contract || j.name || '';
    let abi = Array.isArray(j.abi) ? j.abi : [];
    if (!abi.length && typeof j.ABI === 'string') {
      try { abi = JSON.parse(j.ABI); } catch { abi = []; }
    }
    const address = j.Address || j.address || '';
    const type = classifyName(name);
    if (type) {
      buckets[type].push({ name, address, abi, source: mf });
    }
  }

  // Select first candidates
  const token = pickFirst(buckets, 'Token');
  const idr = pickFirst(buckets, 'IdentityRegistry');
  const ctr = pickFirst(buckets, 'ClaimTopicsRegistry');
  const tir = pickFirst(buckets, 'TrustedIssuersRegistry');
  const cmp = pickFirst(buckets, 'ModularCompliance');

  // Write minimal artifacts
  const artifactsDir = path.join(process.cwd(), 'artifacts', 'dataset');
  ensureDir(artifactsDir);
  const writeArtifact = (label, obj) => {
    if (!obj) return null;
    const file = path.join(artifactsDir, `${label}.json`);
    fs.writeFileSync(file, JSON.stringify({ abi: obj.abi || [] }, null, 2));
    return path.relative(process.cwd(), file);
  };

  const tokenPath = writeArtifact('Token', token);
  const idrPath = writeArtifact('IdentityRegistry', idr);
  const ctrPath = writeArtifact('ClaimTopicsRegistry', ctr);
  const tirPath = writeArtifact('TrustedIssuersRegistry', tir);

  // Fallback to local Tokeny artifacts when dataset lacks ABIs
  const trexArtifactsRoot = path.join(process.cwd(), 'ERC-3643-Implementation', 'artifacts', 'contracts');
  const trexPaths = {
    Token: path.join('ERC-3643-Implementation', 'artifacts', 'contracts', 'token', 'Token.sol', 'Token.json'),
    IdentityRegistry: path.join('ERC-3643-Implementation', 'artifacts', 'contracts', 'registry', 'implementation', 'IdentityRegistry.sol', 'IdentityRegistry.json'),
    ClaimTopicsRegistry: path.join('ERC-3643-Implementation', 'artifacts', 'contracts', 'registry', 'implementation', 'ClaimTopicsRegistry.sol', 'ClaimTopicsRegistry.json'),
    TrustedIssuersRegistry: path.join('ERC-3643-Implementation', 'artifacts', 'contracts', 'registry', 'implementation', 'TrustedIssuersRegistry.sol', 'TrustedIssuersRegistry.json')
  };
  const exists = (rel) => rel ? fs.existsSync(path.join(process.cwd(), rel)) : false;

  const abipaths = {
    Token: tokenPath || (exists(trexPaths.Token) ? trexPaths.Token : null),
    IdentityRegistry: idrPath || (exists(trexPaths.IdentityRegistry) ? trexPaths.IdentityRegistry : null),
    ClaimTopicsRegistry: ctrPath || (exists(trexPaths.ClaimTopicsRegistry) ? trexPaths.ClaimTopicsRegistry : null),
    TrustedIssuersRegistry: tirPath || (exists(trexPaths.TrustedIssuersRegistry) ? trexPaths.TrustedIssuersRegistry : null),
    Compliance: exists(trexPaths.Compliance) ? trexPaths.Compliance : "node_modules/@tokenysolutions/t-rex/artifacts/contracts/compliance/modular/ModularCompliance.sol/ModularCompliance.json",
    CountryRestrictModule: exists(trexPaths.CountryRestrictModule) ? trexPaths.CountryRestrictModule : "node_modules/@tokenysolutions/t-rex/artifacts/contracts/compliance/modular/modules/CountryRestrictModule.sol/CountryRestrictModule.json",
    ExchangeMonthlyLimitsModule: exists(trexPaths.ExchangeMonthlyLimitsModule) ? trexPaths.ExchangeMonthlyLimitsModule : "node_modules/@tokenysolutions/t-rex/artifacts/contracts/compliance/modular/modules/ExchangeMonthlyLimitsModule.sol/ExchangeMonthlyLimitsModule.json"
  };
  fs.writeFileSync(path.join(process.cwd(), 'abipaths.dataset.json'), JSON.stringify(abipaths, null, 2));
  console.log('Wrote abipaths.dataset.json');

  // Addresses map (best-effort)
  const addresses = {
    networkRpc: 'http://127.0.0.1:8545',
    token: token?.address || '0x0000000000000000000000000000000000000000',
    identityRegistry: idr?.address || '0x0000000000000000000000000000000000000000',
    claimTopicsRegistry: ctr?.address || '0x0000000000000000000000000000000000000000',
    trustedIssuersRegistry: tir?.address || '0x0000000000000000000000000000000000000000',
    compliance: cmp?.address || '0x0000000000000000000000000000000000000000'
  };
  ensureDir(path.join(process.cwd(), 'configs'));
  const addrPath = path.join(process.cwd(), 'configs', 'dataset.addresses.json');
  fs.writeFileSync(addrPath, JSON.stringify(addresses, null, 2));
  console.log('Wrote', addrPath);
}

main();
