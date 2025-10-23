/* eslint-disable */
const fs = require('fs');
const path = require('path');

function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function ensureDir(p){ fs.mkdirSync(p,{recursive:true}); }

const SEVERITY_COLORS = { CRITICAL:'#B91C1C', HIGH:'#F97316', MEDIUM:'#FACC15', LOW:'#6B7280', INFO:'#2563EB' };
const STATUS_COLORS = { TOTAL:'#374151', PASS:'#10B981', CRITICAL:'#B91C1C', HIGH:'#F97316', MEDIUM:'#FACC15', LOW:'#6B7280', META:'#374151' };
const POSITION_COLORS = { SUPPORT:'#10B981', CHALLENGE:'#B91C1C', EXTEND:'#6366F1' };

function statText(label, value, kind){
  const color = STATUS_COLORS[kind] || '#374151';
  return `<span style="font-weight:600;color:${color}">${esc(label)} ${esc(String(value))}</span>`;
}

function positionText(kind){
  const key = String(kind||'').toUpperCase();
  const labelMap = { SUPPORT:'Support', CHALLENGE:'Challenge', EXTEND:'Extend', PASS:'Support' };
  const label = labelMap[key] || (key ? key.charAt(0)+key.slice(1).toLowerCase() : '');
  const color = POSITION_COLORS[key] || (key === 'PASS' ? POSITION_COLORS.SUPPORT : STATUS_COLORS.META);
  return label ? `<span style="font-weight:600;color:${color}">${esc(label)}</span>` : '';
}

function section(title){ return `<h2 style="margin:24px 0 8px 0;border-bottom:1px solid #E5E7EB;padding-bottom:6px">${esc(title)}</h2>`; }

function severityText(label, kind){
  const color = SEVERITY_COLORS[kind] || '#374151';
  return `<span style="font-weight:600;color:${color}">${esc(label)}</span>`;
}

function severityStat(label, value, kind){
  return `<span style="font-weight:600;color:${SEVERITY_COLORS[kind] || '#374151'}">${esc(label)} ${esc(String(value))}</span>`;
}

function normalizeString(str){
  return String(str||'').replace(/\s+/g,' ').trim().toLowerCase();
}

function formatSeverityLabel(sev){
  const s = String(sev||'').toLowerCase();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderScenario(sc){
  const s = sc.summary || { total:0, pass:0, critical:0, high:0, medium:0, low:0 };
  const addr = sc.inputs?.addresses || {};
  const llm = sc.llm || {};
  const rows = collectRuleAssessments(sc);
  let html = '';
  html += `<div style="border:1px solid #E5E7EB;border-radius:10px;padding:16px;margin:12px 0">`;
  html += `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">`+
          `<div><div style="font-weight:700">${esc(sc.label)}</div>`+
          `<div style="font-size:12px;color:#6B7280"><code>${esc(sc.file||'')}</code></div></div>`+
          `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${statText('Total', s.total||0, 'TOTAL')} ${statText('Pass', s.pass||0, 'PASS')} ${severityStat('Critical', s.critical||0, 'CRITICAL')} ${severityStat('High', s.high||0, 'HIGH')} ${severityStat('Medium', s.medium||0, 'MEDIUM')} ${severityStat('Low', s.low||0, 'LOW')}</div>`+
          `</div>`;
  const addrList = Object.entries(addr).map(([k,v])=>`<li><code>${esc(k)}</code> → <code>${esc(v)}</code></li>`).join('');
  if (addrList) html += `<details style="margin-top:8px"><summary style="cursor:pointer">Addresses</summary><ul style="margin-top:6px">${addrList}</ul></details>`;
  if (llm.overallAssessment) html += `<div style="margin-top:8px"><strong>Summary:</strong> ${esc(llm.overallAssessment)}</div>`;
  if (rows.length){
    html += `<div style=\"margin-top:12px;overflow:auto\">`;
    html += `<table style=\"width:100%;border-collapse:collapse;font-size:13px\">`+
            `<thead><tr style=\"background:#F9FAFB;text-align:left\">`+
            `<th style=\"padding:8px;border-bottom:1px solid #E5E7EB\">Rule</th>`+
            `<th style=\"padding:8px;border-bottom:1px solid #E5E7EB\">Title</th>`+
            `<th style=\"padding:8px;border-bottom:1px solid #E5E7EB\">Verdict</th>`+
            `<th style=\"padding:8px;border-bottom:1px solid #E5E7EB\">Severity</th>`+
            `<th style=\"padding:8px;border-bottom:1px solid #E5E7EB\">Explanation</th>`+
            `<th style=\"padding:8px;border-bottom:1px solid #E5E7EB\">Recommendation</th>`+
            `</tr></thead><tbody>`;
    for (const row of rows){
      const verdictLabel = row.verdictLabel || '';
      const verdictKind = row.verdictKind || verdictLabel;
      const sev = row.severity || '';
      const sevLabel = formatSeverityLabel(sev);
      let verdictKey = String(verdictKind || '').toUpperCase();
      let verdictDisplay = positionText(verdictKey);
      if (!verdictDisplay && row.deterministicPass) {
        verdictKey = 'PASS';
        verdictDisplay = positionText(verdictKey);
      }
      html += `<tr>`+
              `<td style=\"padding:8px;border-top:1px solid #F3F4F6\">${row.id?`<code>${esc(row.id)}</code>`:''}</td>`+
              `<td style=\"padding:8px;border-top:1px solid #F3F4F6\">${esc(row.title||'')}</td>`+
              `<td style=\"padding:8px;border-top:1px solid #F3F4F6\">${verdictDisplay}</td>`+
              `<td style=\"padding:8px;border-top:1px solid #F3F4F6\">${sev?severityText(sevLabel, sev):''}</td>`+
              `<td style=\"padding:8px;border-top:1px solid #F3F4F6\">${esc(row.explanation||'')}</td>`+
              `<td style=\"padding:8px;border-top:1px solid #F3F4F6\">${esc(row.recommendation||'')}</td>`+
              `</tr>`;
    }
    html += `</tbody></table></div>`;
  }
  html += `</div>`;
  return html;
}

function normalizePosition(pos){
  const p = String(pos||'').trim().toUpperCase();
  if (!p) return null;
  if (p === 'EXTEND') return 'NEW';
  if (p === 'SUPPORT' || p === 'CHALLENGE' || p === 'NEW') return p;
  return 'SUPPORT';
}

function collectDeterministicItems(sc){
  const items = Array.isArray(sc.items)? sc.items : [];
  const map = new Map();
  for (const it of items){
    const id = String(it?.id||'').trim();
    if (!id) continue;
    map.set(id, {
      id,
      title: it.title || '',
      pass: !!it.pass,
      severity: String(it.severityCode || it.severity || '').toUpperCase(),
      note: it.note || '',
      evidence: Array.isArray(it.details) ? it.details.map(d=>d?.evidence).filter(Boolean) : []
    });
  }
  return map;
}

function indexKeys(store, id, values){
  for (const val of values){
    const norm = normalizeString(val);
    if (!norm) continue;
    if (!store.has(norm)) store.set(norm, new Set());
    store.get(norm).add(id);
  }
}

function collectRuleAssessments(sc){
  const deterministic = collectDeterministicItems(sc);
  const payloadRules = Array.isArray(sc.llm?.payload?.rules) ? sc.llm.payload.rules : [];
  const findings = Array.isArray(sc.llm?.findings) ? sc.llm.findings : [];

  const records = new Map();
  const keyIndex = new Map();

  for (const rule of payloadRules){
    const id = String(rule?.id||'').trim();
    if (!id) continue;
    records.set(id, {
      id,
      title: rule.title || '',
      rule,
      deterministic: deterministic.get(id) || null,
      finding: null
    });
    indexKeys(keyIndex, id, [
      rule.title,
      rule.note,
      ...(Array.isArray(rule.evidence) ? rule.evidence : [])
    ]);
  }

  for (const [id, det] of deterministic.entries()){
    if (!records.has(id)){
      records.set(id, {
        id,
        title: det.title || '',
        rule: null,
        deterministic: det,
        finding: null
      });
    } else {
      indexKeys(keyIndex, id, [det.note, ...(det.evidence || [])]);
    }
  }

  const assigned = new Set();
  findings.forEach((finding, idx)=>{
    const fid = String(finding?.id||'').trim();
    let targetId = null;
    if (fid && records.has(fid)){
      targetId = fid;
    } else {
      const keys = [
        finding.title,
        finding.explanation,
        ...(Array.isArray(finding.evidence_paths) ? finding.evidence_paths : []),
        finding.recommendation
      ];
      for (const key of keys){
        const norm = normalizeString(key);
        if (!norm) continue;
        const ids = keyIndex.get(norm);
        if (!ids) continue;
        for (const candidate of ids){
          if (!assigned.has(candidate)){
            targetId = candidate;
            break;
          }
        }
        if (targetId) break;
      }
    }
    if (!targetId && records.size === 1){
      targetId = Array.from(records.keys())[0];
    }
    if (targetId && records.has(targetId)){
      records.get(targetId).finding = finding;
      assigned.add(targetId);
    } else {
      const fallbackId = fid || `finding-${idx}`;
      if (!records.has(fallbackId)){
        records.set(fallbackId, {
          id: fallbackId,
          title: finding.title || '',
          rule: null,
          deterministic: null,
          finding
        });
      }
    }
  });

  const rows = Array.from(records.values()).map(entry=>{
    const { id, title, rule, deterministic, finding } = entry;
    const verdictRaw = finding?.verdict || finding?.phase2_verdict || rule?.phase2_verdict || (deterministic ? (deterministic.pass ? 'PASS' : 'FAIL') : '');
    const severityRaw = finding?.severity || finding?.severity_code || rule?.severity_code || rule?.severity || deterministic?.severity || '';
    const explanation = finding?.explanation || rule?.note || deterministic?.note || (Array.isArray(rule?.evidence) ? rule.evidence[0] : '') || '';
    const recommendation = finding?.recommendation || '';
    const positionRaw = String(finding?.position || '').trim().toUpperCase();
    const position = normalizePosition(positionRaw);
    const verdictUpper = String(verdictRaw||'').toUpperCase();
    const verdictLabel = positionRaw || verdictUpper;
    const verdictKind = verdictLabel || position || verdictUpper || 'META';
    const detPassValue = deterministic?.pass;
    const deterministicPass = detPassValue === true ? true : (detPassValue === false ? false : undefined);
    return {
      id,
      title: title || finding?.title || rule?.title || '',
      verdictLabel,
      verdictKind,
      severity: String(severityRaw||'').toUpperCase(),
      explanation,
      recommendation,
      position,
      positionRaw,
      deterministicPass,
      deterministicSeverity: deterministic?.severity
    };
  });

  return rows.sort((a,b)=> a.id.localeCompare(b.id));
}

function buildCoverageTable(data){
  const scenarios = Array.isArray(data.scenarios)? data.scenarios : [];
  const byRule = new Map();
  const ensureRow = (id, title)=>{
    const key = String(id||'').trim();
    if (!key) return null;
    if (!byRule.has(key)){
      byRule.set(key, {
        id: key,
        title: title || '',
        detPass: new Set(),
        detFail: new Set(),
        llm: {
          SUPPORT: new Set(),
          CHALLENGE: new Set(),
          NEW: new Set()
        }
      });
    }
    const row = byRule.get(key);
    if (!row.title && title) row.title = title;
    return row;
  };

  for (const sc of scenarios){
    const scenarioId = sc.id || sc.label || '';
    const assessments = collectRuleAssessments(sc);
    for (const entry of assessments){
      const row = ensureRow(entry.id, entry.title);
      if (!row) continue;
      if (entry.deterministicPass === true) row.detPass.add(scenarioId);
      if (entry.deterministicPass === false) row.detFail.add(scenarioId);
      let pos = entry.position;
      if (!pos){
        const verdictKey = String(entry.verdictKind || entry.verdictLabel || '').toUpperCase();
        if (verdictKey === 'PASS') pos = 'SUPPORT';
      }
      if (pos){
        if (!row.llm[pos]) row.llm[pos] = new Set();
        row.llm[pos].add(scenarioId);
      }
    }
  }

  const rows = Array.from(byRule.values()).sort((a,b)=> a.id.localeCompare(b.id));
  if (!rows.length) return '';
  let html = '<div style="margin-top:16px">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<thead><tr style="background:#F9FAFB;text-align:left">'+
          '<th style="padding:8px;border-bottom:1px solid #E5E7EB">Rule</th>'+ 
          '<th style="padding:8px;border-bottom:1px solid #E5E7EB">Title</th>'+ 
          '<th style="padding:8px;border-bottom:1px solid #E5E7EB">Deterministic Pass</th>'+ 
          '<th style="padding:8px;border-bottom:1px solid #E5E7EB">Deterministic Fail</th>'+ 
          '<th style="padding:8px;border-bottom:1px solid #E5E7EB">SUPPORT</th>'+ 
          '<th style="padding:8px;border-bottom:1px solid #E5E7EB">CHALLENGE</th>'+ 
          '<th style="padding:8px;border-bottom:1px solid #E5E7EB">NEW</th>'+ 
          '</tr></thead><tbody>';
  for (const r of rows){
    const support = r.llm.SUPPORT instanceof Set ? r.llm.SUPPORT.size : 0;
    const challenge = r.llm.CHALLENGE instanceof Set ? r.llm.CHALLENGE.size : 0;
    const newly = r.llm.NEW instanceof Set ? r.llm.NEW.size : 0;
    const detPass = r.detPass instanceof Set ? r.detPass.size : 0;
    const detFail = r.detFail instanceof Set ? r.detFail.size : 0;
    html += '<tr>'+
            `<td style="padding:8px;border-top:1px solid #F3F4F6"><code>${esc(r.id)}</code></td>`+
            `<td style="padding:8px;border-top:1px solid #F3F4F6">${esc(r.title)}</td>`+
            `<td style="padding:8px;border-top:1px solid #F3F4F6">${esc(String(detPass))}</td>`+
            `<td style="padding:8px;border-top:1px solid #F3F4F6">${esc(String(detFail))}</td>`+
            `<td style="padding:8px;border-top:1px solid #F3F4F6">${esc(String(support))}</td>`+
            `<td style="padding:8px;border-top:1px solid #F3F4F6">${esc(String(challenge))}</td>`+
            `<td style="padding:8px;border-top:1px solid #F3F4F6">${esc(String(newly))}</td>`+
            '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

function main(){
  const ROOT = process.cwd();
  const input = path.join(ROOT,'reports','matrix-results.json');
  const out = path.join(ROOT,'reports','matrix-report.html');
  const data = JSON.parse(fs.readFileSync(input,'utf8'));
  let html = `<!doctype html><html><head><meta charset="utf-8"/><title>Audit Matrix Report</title><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;margin:24px}</style></head><body>`;
  html += `<h1>ERC-3643 Audit Matrix</h1>`;
  const o = data.overall || {};
  html += `<div style="color:#6B7280;font-size:12px">Generated: ${esc(data.generatedAt||'')}</div>`;
  html += `<div style="margin:12px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap">${statText('Total', o.total||0, 'TOTAL')} ${statText('Pass', o.pass||0, 'PASS')} ${severityStat('Critical', o.critical||0, 'CRITICAL')} ${severityStat('High', o.high||0, 'HIGH')} ${severityStat('Medium', o.medium||0, 'MEDIUM')} ${severityStat('Low', o.low||0, 'LOW')}</div>`;
  html += section('Scenarios');
  for (const sc of (data.scenarios||[])) html += renderScenario(sc);
  const coverage = buildCoverageTable(data);
  if (coverage){
    html += section('LLM Coverage Expansion vs Deterministic Checks');
    html += coverage;
  }
  html += `</body></html>`;
  ensureDir(path.dirname(out));
  fs.writeFileSync(out, html);
  console.log('[matrix] HTML written:', out);
}

main();
