/* eslint-disable */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { executeDeterministic, helpers } = require("./deterministic-run");

const {
  normalizeSeverityValue,
  severityLabel,
  severityWeight,
  flattenDetails,
  shorten,
  normalizeArray,
  buildRulePayload,
  buildRuntimePayload,
  detectHintFromTexts,
  safeDiv
} = helpers;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function buildLlmInput(summary, items, runsMeta) {
  return {
    summary: {
      total: Number(summary.total || items.length || 0),
      pass: Number(summary.pass || 0),
      critical: Number(summary.critical || 0),
      high: Number(summary.high || 0),
      medium: Number(summary.medium || 0),
      low: Number(summary.low || 0),
      fail: Number(summary.fail || 0),
      warn: Number(summary.warn || 0),
      info: Number(summary.info || 0)
    },
    rules: buildRulePayload(items),
    runtime: buildRuntimePayload(runsMeta)
  };
}

async function ensureFetch() {
  if (typeof fetch === "function") return fetch;
  try {
    const mod = await import("node-fetch");
    return mod.default;
  } catch (e) {
    throw new Error(`fetch is not available and node-fetch could not be loaded (${e.message})`);
  }
}

function cachePath() {
  return path.join(process.cwd(), ".cache", "p2-llm-cache.json");
}
function loadCache() {
  try { return JSON.parse(fs.readFileSync(cachePath(), "utf8")); } catch { return {}; }
}
function saveCache(obj) {
  ensureDir(path.dirname(cachePath()));
  fs.writeFileSync(cachePath(), JSON.stringify(obj, null, 2));
}
function makeKey(model, payload) {
  return crypto.createHash("sha256").update(JSON.stringify({ model, payload })).digest("hex");
}
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callPhase2Llm(payload) {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  if (!apiKey) {
    return {
      disabled: true,
      model,
      message: "LLM disabled (missing API key)"
    };
  }

  const cache = loadCache();
  const key = makeKey(model, payload);
  if (cache[key]) return { model, disabled: false, cacheHit: true, raw: cache[key] };

  const fetchImpl = await ensureFetch();
const systemPrompt = [
    "You are the lead auditor for ERC-3643 and HKMA virtual-asset controls.",
    "Write plain-language findings that non-technical executives can follow.",
    "Provide thorough context that both smart-contract engineers and compliance auditors can act on, summarizing behaviours, control gaps, and implications without quoting probe evidence verbatim.",
    "For each finding: (1) describe the observed behaviour, referencing the supplied evidence path without copying it verbatim, (2) cite the exact ERC-3643 or HKMA clause that governs the behaviour, (3) explain the business and regulatory risk if the behaviour persists, and (4) recommend a concrete, technically feasible remediation aligned with that clause.",
    "Each explanation must contain at least three sentences and may use up to 250 words to cover behaviour, clause, and risk." ,
    "Respond strictly with JSON:{\"overall_assessment\":string,\"findings\":[{\"id\":string,\"title\":string,\"severity\":\"CRITICAL\"|\"HIGH\"|\"MEDIUM\"|\"LOW\",\"phase2_verdict\":string,\"verdict\":\"PASS\"|\"CRITICAL\"|\"HIGH\"|\"MEDIUM\"|\"LOW\",\"position\":\"SUPPORT\"|\"CHALLENGE\"|\"EXTEND\",\"explanation\":string,\"compliance_refs\":string[],\"evidence_paths\":string[],\"recommendation\":string}]}",
    "Format recommendations as clear action statements (e.g., update contract logic, extend monitoring, add regression tests) so engineers can implement them." 
  ].join(" ");

  const body = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) }
    ]
  };

  const maxRetries = Number(process.env.LLM_MAX_RETRIES || 3);
  const baseDelay = Number(process.env.LLM_BASE_DELAY_MS || 400);
  let lastErr = null;
  for (let i = 0; i <= maxRetries; i += 1) {
    if (i > 0) await sleep(baseDelay * Math.pow(2, i - 1));
    try {
      const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      let outer; try { outer = JSON.parse(text); } catch { throw new Error("Non-JSON response"); }
      const content = outer?.choices?.[0]?.message?.content;
      if (!content) throw new Error("missing content");
      let parsed; try { parsed = JSON.parse(content); } catch (e) { throw new Error(`content parse failed: ${e.message}`); }
      cache[key] = parsed; saveCache(cache);
      return { disabled: false, model: outer?.model || model, raw: parsed };
    } catch (e) {
      lastErr = e;
    }
  }
  return { disabled: false, model, error: (lastErr && lastErr.message) || String(lastErr) };
}

function normalizeLlmFinding(finding) {
  if (!finding || typeof finding !== "object") return null;
  const id = String(finding.id || finding.rule || "").trim();
  if (!id) return null;
  const title = finding.title ? String(finding.title) : id;
  const severityInfo = normalizeSeverityValue(finding.severity || finding.severity_code || finding.severity_label);
  const severity = severityInfo.code;
  const severityLabelText = severityInfo.label;
  const phase2VerdictRaw = finding.phase2_verdict || finding.phase2_verdict_label || finding.phase2Severity;
  const phase2Verdict = phase2VerdictRaw ? severityLabel(phase2VerdictRaw) : severityLabelText;
  const verdictRaw = finding.verdict || finding.suggested_verdict || severityLabelText;
  const verdict = String(verdictRaw || "").toUpperCase();
  const position = String(finding.position || "EXTEND").toUpperCase();
  const explanation = String(finding.explanation || "").trim();
  const complianceRefs = normalizeArray(finding.compliance_refs || finding.policy_refs);
  const evidencePaths = normalizeArray(finding.evidence_paths || finding.evidence);
  const recommendation = String(finding.recommendation || finding.fix || "").trim();
  const result = {
    id,
    title,
    severity,
    severity_label: severityLabelText,
    phase2_verdict: phase2Verdict,
    verdict,
    position,
    explanation,
    compliance_refs: complianceRefs,
    evidence_paths: evidencePaths,
    recommendation
  };
  const hint = detectHintFromTexts([result.explanation, recommendation, ...evidencePaths]);
  if (hint === "CHALLENGE" || hint === "EXTEND") {
    result.verdict = hint;
    result.phase2_verdict = hint;
    result.position = hint;
  }
  return result;
}

function normalizeLlmOutput(raw) {
  if (!raw || typeof raw !== "object") {
    return { overallAssessment: "", findings: [] };
  }
  const overallAssessment = String(raw.overall_assessment || raw.summary || "").trim();
  const rawFindings = Array.isArray(raw.findings)
    ? raw.findings
    : Array.isArray(raw.items)
      ? raw.items
      : [];
  const findings = rawFindings
    .map((f) => normalizeLlmFinding(f))
    .filter(Boolean);
  return { overallAssessment, findings };
}

function describeClause(ref) {
  if (!ref) return 'ERC-3643';
  const value = String(ref);
  const lowered = value.toLowerCase();
  if (value.startsWith('http')) {
    const tail = value.split('/').filter(Boolean).pop() || value;
    if (tail.toLowerCase().includes('hkma')) return 'the HKMA guideline (' + tail + ')';
    if (tail.toLowerCase().includes('eip-3643') || tail.toLowerCase().includes('erc-3643')) return 'ERC-3643';
    return value;
  }
  if (lowered.includes('hkma')) return value;
  if (lowered.includes('3643') || lowered.includes('erc')) return value.startswith('ERC') ? value : 'ERC-3643 ' + value;
  return value;
}

function fallbackFindings(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => (
    severityWeight(b.severityCode || b.severity || b.severityLabel) -
    severityWeight(a.severityCode || a.severity || a.severityLabel)
  ));
  const source = sorted.slice(0, 20);
  return source.map((it) => {
    const severityInfo = normalizeSeverityValue(it.severityCode || it.severity || it.severityLabel);
    const evidence = flattenDetails(it.details || []);
    const evidencePaths = evidence.slice(0, 3);
    const noteText = it.note ? String(it.note) : "";
    const hint = detectHintFromTexts([noteText, ...evidence]);
    const verdict = hint || (it.pass ? "PASS" : severityInfo.label);
    const position = hint || (it.pass ? "SUPPORT" : "CHALLENGE");
    const clauseRefs = normalizeArray(it.policyRef || it.policy_refs);
    const clauseRaw = clauseRefs.length ? clauseRefs[0] : "ERC-3643";
    const clauseDescriptor = describeClause(clauseRaw);
    const evidenceSummary = noteText ? shorten(noteText, 280) : (evidencePaths[0] ? evidencePaths[0] : "Control executed as designed.");
    const cleanEvidence = evidenceSummary.replace(/\[LLM_HINT:[^\]]+\]\s*/g, '').trim();
    const evidenceNarrative = cleanEvidence ? `Runtime hint: ${cleanEvidence}. ` : "";


    let explanation;
    let recommendation;
    if (hint === "CHALLENGE") {
      explanation = `${evidenceNarrative}Deterministic testing reported a pass, yet the observed behaviour conflicts with ${clauseDescriptor}. Leaving that branch open could let investors who have not completed the mandated onboarding receive tokens, exposing the issuer to a breach of the identity-gating requirement.`;
      recommendation = `Rework the transfer logic so every execution path consults identityRegistry.isVerified before tokens move, add a regression test that reproduces the failing probe, and retain documentation tying the control back to ${clauseDescriptor}.`;
    } else if (hint === "EXTEND") {
      explanation = `${evidenceNarrative}The control succeeds in the primary path, but that branch is not logged or enforced consistently. ${clauseDescriptor} expects every denial branch to be traceable so compliance officers can demonstrate the rule was applied.`;
      recommendation = `Instrument the contract to record and honour compliance.canTransfer for the uncovered branch, extend automated tests and monitoring to cover that scenario, and update run-books so the control remains aligned with ${clauseDescriptor}.`;
    } else if (noteText) {
      if (position === "SUPPORT") {
        explanation = `${evidenceNarrative}Deterministic testing shows the control behaves exactly as ${clauseDescriptor} prescribes, giving non-technical sponsors assurance that the required safeguard is active.`;
        recommendation = `Maintain the implementation, keep the supporting runtime notes on file, and rerun this regression whenever transfer logic or onboarding rules change.`;
      } else {
        explanation = `${evidenceNarrative}Deterministic testing highlighted behaviour that is inconsistent with ${clauseDescriptor} and could undermine investor protections if left unresolved.`;
        recommendation = `Align the implementation with ${clauseDescriptor}, add an automated regression test that fails if the gap reappears, and record the fix for compliance evidence.`;
      }
    } else {
      if (position === "SUPPORT") {
        explanation = `Deterministic testing confirmed the control currently meets the obligations in ${clauseDescriptor}.`;
        recommendation = `Preserve the implementation and maintain regression tests that demonstrate compliance after each upgrade.`;
      } else {
        explanation = `Deterministic testing flagged a possible deviation from ${clauseDescriptor}, although the probe evidence did not provide additional context.`;
        recommendation = `Investigate the branch in question, realign it with ${clauseDescriptor}, and add instrumentation plus tests to prevent future regressions.`;
      }
    }
    return {
      id: it.id || "",
      title: it.title || it.id || "",
      severity: severityInfo.code,
      severity_label: severityInfo.label,
      phase2_verdict: verdict,
      verdict,
      position,
      explanation,
      compliance_refs: normalizeArray(it.policyRef || it.policy_refs),
      evidence_paths: evidencePaths,
      recommendation
    };
  });
}

async function produceLlmAugmentation(summary, items, runsMeta) {
  const payload = buildLlmInput(summary, items, runsMeta);
  const llm = await callPhase2Llm(payload);
  if (llm.disabled) {
    return {
      model: llm.model,
      disabled: true,
      reason: llm.message || "LLM disabled",
      payload,
      overallAssessment: llm.message || "LLM disabled (missing API key)",
      findings: fallbackFindings(items)
    };
  }
  if (llm.error) {
    return {
      model: llm.model,
      disabled: false,
      error: llm.error,
      payload,
      overallAssessment: `LLM call failed: ${llm.error}`,
      findings: fallbackFindings(items)
    };
  }
  const normalized = normalizeLlmOutput(llm.raw);
  if (!normalized.findings.length) {
    return {
      model: llm.model,
      disabled: false,
      payload,
      overallAssessment: normalized.overallAssessment || "LLM returned no findings.",
      findings: fallbackFindings(items)
    };
  }
  return {
    model: llm.model,
    disabled: false,
    payload,
    overallAssessment: normalized.overallAssessment,
    findings: normalized.findings
  };
}

function computeLlmMetrics(items, findings) {
  const detMap = new Map();
  for (const it of (Array.isArray(items) ? items : [])) {
    const id = String(it?.id || "").toUpperCase();
    if (!id || detMap.has(id)) continue;
    detMap.set(id, {
      pass: !!it.pass,
      severity: String(it.severity || it.severityCode || "").toUpperCase(),
      note: it.note || ""
    });
  }

  const llmMap = new Map();
  for (const finding of (Array.isArray(findings) ? findings : [])) {
    const id = String(finding?.id || "").toUpperCase();
    if (!id || llmMap.has(id)) continue;
    llmMap.set(id, finding);
  }

  let compared = 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let novel = 0;
  const disagreements = [];

  for (const [id, det] of detMap.entries()) {
    const finding = llmMap.get(id) || null;
    const predicted = det.pass ? "PASS" : "FAIL";
    let expected = "PASS";
    let note = "";

    if (finding) {
      const position = String(finding.position || "").toUpperCase();
      const verdict = String(finding.verdict || finding.phase2_verdict || "").toUpperCase();
      const key = position || verdict;
      note = finding.explanation || finding.note || "";
      if (key === "CHALLENGE") {
        expected = "FAIL";
      } else if (key === "EXTEND") {
        expected = "NEW";
      } else if (key === "SUPPORT" || key === "PASS") {
        expected = "PASS";
      } else if (key === "FAIL" || key === "CRITICAL" || key === "HIGH" || key === "MEDIUM") {
        expected = "FAIL";
      }
    }

    if (expected === "NEW") {
      novel += 1;
      continue;
    }

    compared += 1;
    if (predicted === "PASS" && expected === "PASS") {
      tp += 1;
    } else if (predicted === "FAIL" && expected === "FAIL") {
      tn += 1;
    } else if (predicted === "PASS" && expected === "FAIL") {
      fp += 1;
      disagreements.push({ id, predicted, expected, note });
    } else if (predicted === "FAIL" && expected === "PASS") {
      fn += 1;
      disagreements.push({ id, predicted, expected, note });
    }
  }

  const precision = safeDiv(tp, tp + fp);
  const recall = safeDiv(tp, tp + fn);
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = safeDiv(tp + tn, compared);

  return {
    compared,
    tp,
    fp,
    tn,
    fn,
    new: novel,
    precision,
    recall,
    f1,
    accuracy,
    disagreements
  };
}


function computeCoverageDistribution(findings) {
  const counts = { SUPPORT: 0, CHALLENGE: 0, EXTEND: 0 };
  if (Array.isArray(findings)) {
    for (const f of findings) {
      const key = String(f?.position || f?.verdict || '').toUpperCase();
      if (key === 'SUPPORT' || key === 'PASS') counts.SUPPORT += 1;
      else if (key === 'CHALLENGE' || key === 'FAIL') counts.CHALLENGE += 1;
      else if (key === 'EXTEND' || key === 'NEW') counts.EXTEND += 1;
    }
  }
  return counts;
}
function formatEvidenceBlock(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  const lines = paths.slice(0, 6).map((p) => `- ${p}`);
  return ["Paths:", ...lines].join("\n");
}

function formatComplianceRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return "";
  return `Compliance Ref: ${refs.join("; ")}`;
}

function renderPhase2Report(summary, llmResult) {
  const lines = [];
  const now = new Date().toISOString();
  lines.push("Compliance Report");
  lines.push(`Generated: ${now}`);
  lines.push(
    `Deterministic Summary: PASS=${summary.pass} | CRITICAL=${summary.critical || 0} | HIGH=${summary.high || 0} | MEDIUM=${summary.medium || 0} | LOW=${summary.low || 0}`
  );
  if (llmResult.model) {
    lines.push(`LLM Model: ${llmResult.model}`);
  }
  if (llmResult.overallAssessment) {
    lines.push("");
    lines.push(llmResult.overallAssessment);
  }

  const findings = Array.isArray(llmResult.findings) ? llmResult.findings.slice() : [];
  findings.sort((a, b) => severityWeight(b.severity || b.phase2_verdict) - severityWeight(a.severity || a.phase2_verdict));
  if (findings.length) {
    lines.push("");
    lines.push("Findings:");
  }
  let idx = 1;
  for (const finding of findings) {
    lines.push("");
    lines.push(severityLabel(finding.severity || finding.severity_code || finding.verdict));
    lines.push(`${idx}. ${finding.title || finding.id}`);
    if (finding.explanation) lines.push(finding.explanation);
    const evidenceBlock = formatEvidenceBlock(finding.evidence_paths);
    if (evidenceBlock) lines.push(evidenceBlock);
    const refs = formatComplianceRefs(finding.compliance_refs);
    if (refs) lines.push(refs);
    if (finding.recommendation) lines.push(`Recommendation: ${finding.recommendation}`);
    idx += 1;
  }

  return lines.join("\n").trim();
}

async function main() {
  const deterministic = await executeDeterministic({ argv: process.argv.slice(2), root: process.cwd(), write: false });
  const { baseOutput, outputPath, metricsPath, hasOnChainData, groundTruthPath } = deterministic;
  const aggregatedSummary = baseOutput.summary;
  const aggregatedItems = baseOutput.items;
  const runsMeta = baseOutput.runs;

  let llmResult = null;
  if (!hasOnChainData) {
    console.warn("LLM skipped: no on-chain data available.");
    llmResult = {
      model: null,
      disabled: true,
      reason: "LLM skipped: no on-chain data available.",
      overallAssessment: "LLM skipped: deterministic data only (no on-chain evidence).",
      findings: fallbackFindings(aggregatedItems),
      payload: null
    };
  } else {
    llmResult = await produceLlmAugmentation(aggregatedSummary, aggregatedItems, runsMeta);
    const fallbackCandidates = fallbackFindings(aggregatedItems);
    const fallbackMap = new Map(fallbackCandidates.map(f => [String(f.id || '').toUpperCase(), f]));
    if (Array.isArray(llmResult.findings)) {
      llmResult.findings = llmResult.findings.map((finding) => {
        const key = String(finding.id || '').toUpperCase();
        const fallback = fallbackMap.get(key);
        if (!fallback) return finding;
        const explanation = String(finding.explanation || '');
        const sentenceCount = explanation.split(/[.!?]\s+/).filter(Boolean).length;
        const clauseMentioned = fallback.compliance_refs && fallback.compliance_refs.some((ref) => {
          if (!ref) return false;
          const tail = String(ref).split('/').filter(Boolean).pop() || String(ref);
          return explanation.toLowerCase().includes(String(ref).toLowerCase()) || explanation.toLowerCase().includes(tail.toLowerCase());
        });
        if (!explanation || explanation.length < 320 || sentenceCount < 3 || !clauseMentioned) {
          return {
            ...finding,
            explanation: fallback.explanation,
            recommendation: fallback.recommendation,
            compliance_refs: (finding.compliance_refs && finding.compliance_refs.length) ? finding.compliance_refs : fallback.compliance_refs,
            evidence_paths: (finding.evidence_paths && finding.evidence_paths.length) ? finding.evidence_paths : fallback.evidence_paths
          };
        }
        return finding;
      });
    }

    if (llmResult.disabled && llmResult.reason) {
      console.warn(`LLM disabled: ${llmResult.reason}`);
    } else if (llmResult.error) {
      console.warn(`LLM call failed: ${llmResult.error}`);
    }
  }

  const reportText = renderPhase2Report(aggregatedSummary, llmResult || { findings: [], overallAssessment: "" });
  const reportPathAbs = reportText ? outputPath.replace(/\.json$/, ".txt") : null;
  const deterministicMetrics = baseOutput.metrics || null;
  const llmMetrics = computeLlmMetrics(aggregatedItems, llmResult ? llmResult.findings : null);
const coverageDistribution = computeCoverageDistribution(llmResult ? llmResult.findings : null);
const finalOutput = {
    ...baseOutput,
    metrics: llmMetrics || deterministicMetrics || null,
    deterministicMetrics,
    llmMetrics,
    llm: llmResult ? {
      generatedAt: baseOutput.generatedAt,
      model: llmResult.model || null,
      disabled: !!llmResult.disabled,
      reason: llmResult.reason || null,
      error: llmResult.error || null,
      overallAssessment: llmResult.overallAssessment || "",
      findings: llmResult.findings || [],
      payload: llmResult.payload || null
    } : null,
    coverageDistribution,
    report: {
      textPath: reportPathAbs ? path.relative(process.cwd(), reportPathAbs) : null
    }
  };

  fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2));
  const metricsPayloadPath = metricsPath || outputPath.replace(/\.json$/, ".metrics.json");
  if (deterministicMetrics || llmMetrics) {
    const payload = {
      generatedAt: finalOutput.generatedAt,
      deterministic: deterministicMetrics,
      llm: llmMetrics,
      coverageDistribution
    };
    if (metricsPayloadPath) {
      fs.writeFileSync(metricsPayloadPath, JSON.stringify(payload, null, 2));
      console.log(`Metrics written: ${metricsPayloadPath}`);
    }
  } else {
    console.log(`No ground truth found at ${groundTruthPath}; metrics skipped.`);
  }
  console.log(`JSON written: ${outputPath}`);
  if (reportPathAbs) {
    fs.writeFileSync(reportPathAbs, `${reportText}\n`);
    console.log(`Report written: ${reportPathAbs}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
