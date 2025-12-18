/* eslint-disable */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { helpers } = require("./deterministic-engine");

const CACHE_VERSION = 2;

const {
  normalizeSeverityValue,
  severityLabel,
  severityWeight,
  flattenDetails,
  shorten,
  normalizeArray,
  buildRulePayload,
  buildRuntimePayload,
  safeDiv
} = helpers;

function loadLocalEnv(root) {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      if (!key || process.env[key]) continue;
      const value = line.slice(idx + 1).trim();
      process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[augment-llm] Failed to load .env: ${err.message}`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const root = process.cwd();
  let input = path.join(root, "reports", "results.json");
  let output = null;
  let textOut = null;
  for (let i = 0; i < args.length; i += 1) {
    const t = args[i];
    if (t === "--input" && args[i + 1]) { input = path.isAbsolute(args[++i]) ? args[i] : path.join(root, args[i]); continue; }
    if (t.startsWith("--input=")) { const v = t.slice(8); input = path.isAbsolute(v) ? v : path.join(root, v); continue; }
    if (t === "--output" && args[i + 1]) { output = path.isAbsolute(args[++i]) ? args[i] : path.join(root, args[i]); continue; }
    if (t.startsWith("--output=")) { const v = t.slice(9); output = path.isAbsolute(v) ? v : path.join(root, v); continue; }
    if (t === "--text" && args[i + 1]) { textOut = path.isAbsolute(args[++i]) ? args[i] : path.join(root, args[i]); continue; }
    if (t.startsWith("--text=")) { const v = t.slice(7); textOut = path.isAbsolute(v) ? v : path.join(root, v); continue; }
  }
  if (!output) output = input;
  if (!textOut) textOut = output.replace(/\.json$/i, ".txt");
  return { input, output, textOut, root };
}

function buildLlmInput(summary, items, runsMeta) {
  return {
    summary: {
      total: Number(summary.total || items.length || 0),
      pass: Number(summary.pass || 0),
      very_high: Number(summary.veryHigh ?? summary.critical ?? 0),
      high: Number(summary.high || 0),
      medium: Number(summary.medium || 0),
      fail: Number(summary.fail || 0),
      warn: Number(summary.warn || 0),
      info: Number(summary.info || 0)
    },
    rules: buildRulePayload(items),
    runtime: buildRuntimePayload(runsMeta)
  };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
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

function describeClause(ref) {
  if (!ref) return "the relevant policy clause";
  const value = String(ref);
  if (value.startsWith("http")) return value;
  const lowered = value.toLowerCase();
  if (lowered.includes("hkma")) return value;
  if (lowered.includes("erc") || lowered.includes("3643")) {
    return value.startsWith("ERC") ? value : `ERC-3643 ${value}`;
  }
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
    const verdict = it.pass ? "PASS" : severityInfo.label;
    const position = "";
    const clauseRefs = normalizeArray(it.policyRef || it.policy_refs);
    const clauseRaw = clauseRefs.length ? clauseRefs[0] : "ERC-3643";
    const clauseDescriptor = describeClause(clauseRaw);
    const evidenceSummary = noteText ? shorten(noteText, 280) : (evidencePaths[0] ? evidencePaths[0] : "Control executed as designed.");
    const cleanEvidence = evidenceSummary.replace(/\[LLM_HINT:[^\]]+\]\s*/g, "").trim();
    const evidenceNarrative = cleanEvidence ? `Runtime hint: ${cleanEvidence}. ` : "";

    let explanation;
    let recommendation;
    if (noteText) {
      if (it.pass) {
        explanation = `${evidenceNarrative}Deterministic testing shows the control behaves exactly as ${clauseDescriptor} prescribes, giving non-technical sponsors assurance that the required safeguard is active.`;
        recommendation = `Maintain the implementation, keep the supporting runtime notes on file, and rerun this regression whenever transfer logic or onboarding rules change.`;
      } else {
        explanation = `${evidenceNarrative}Deterministic testing highlighted behaviour that is inconsistent with ${clauseDescriptor} and could undermine investor protections if left unresolved.`;
        recommendation = `Align the implementation with ${clauseDescriptor}, add an automated regression test that fails if the gap reappears, and record the fix for compliance evidence.`;
      }
    } else {
      if (it.pass) {
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

function alignFindingsWithDeterministic(items, findings) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  const map = new Map();
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || !it.id) continue;
    const key = String(it.id).toUpperCase();
    const sev = String(it.severityCode || it.severity || it.severityLabel || "MEDIUM").toUpperCase();
    map.set(key, {
      pass: !!it.pass,
      severity: sev
    });
  }
  return findings.map((f) => {
    if (!f || !f.id) return f;
    const key = String(f.id).toUpperCase();
    const base = map.get(key);
    if (!base) return f;
    const result = Object.assign({}, f);
    result.pass = base.pass;
    if (base.pass) {
      result.severity = "PASS";
      result.severity_label = "Pass";
      result.phase2_verdict = "Pass";
      result.verdict = "PASS";
    } else {
      if (!result.severity || String(result.severity).toUpperCase() === "PASS") {
        const severityInfo = normalizeSeverityValue(base.severity);
        result.severity = severityInfo.code;
        result.severity_label = severityInfo.label;
        result.phase2_verdict = result.phase2_verdict || severityInfo.label;
        result.verdict = result.verdict && result.verdict !== "PASS" ? result.verdict : severityInfo.code;
      }
    }
    return result;
  });
}

function sanitizeTitle(value) {
  if (!value) return "";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function canonicalizeFindingIds(findings, items) {
  if (!Array.isArray(findings) || findings.length === 0) return findings || [];
  const titleMap = new Map();
  const idSet = new Set();
  for (const it of items || []) {
    if (!it || !it.id) continue;
    const id = String(it.id);
    idSet.add(id.toUpperCase());
    const key = sanitizeTitle(it.title || it.id);
    if (key && !titleMap.has(key)) titleMap.set(key, id);
  }
  return findings.map((f) => {
    if (!f) return f;
    const id = f.id ? String(f.id) : "";
    if (idSet.has(id.toUpperCase())) return f;
    const key = sanitizeTitle(f.title || "");
    const mappedId = key ? titleMap.get(key) : null;
    if (mappedId) {
      return Object.assign({}, f, { id: mappedId });
    }
    return f;
  });
}

async function callPhase2Llm(payload) {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = null;//process.env.LLM_MODEL || "gpt-4.1-mini";//"gpt-5-nano"; //"gpt-5-mini";
  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  if (!apiKey) {
    return {
      disabled: true,
      model,
      message: "LLM disabled (missing API key)"
    };
  }

  const fetchImpl = await ensureFetch();
  const cacheFile = path.join(process.cwd(), ".cache", "p2-llm-cache.json");
  const loadCache = () => { try { return JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { return {}; } };
  const saveCache = (obj) => { ensureDir(path.dirname(cacheFile)); fs.writeFileSync(cacheFile, JSON.stringify(obj, null, 2)); };
  const makeKey = (m, p) => crypto.createHash("sha256").update(JSON.stringify({ m, p, v: CACHE_VERSION })).digest("hex");
  const cache = loadCache();
  const key = makeKey(model, payload);
  if (cache[key]) return { disabled: false, model, cacheHit: true, raw: cache[key] };

  const systemPrompt = [
    "You are the lead auditor acting as an HKMA/SFC virtual-asset controller with deep knowledge of ERC-3643.",
    "Write executive-readable but engineer-actionable findings. Anchor your reasoning in the supplied deterministic signals and rule payload; do not invent facts or clauses.",
    "For every finding, cover these four points explicitly: (1) What happened (plain, concise description), (2) Which exact clause applies (ERC-3643, HKMA AMLO, or SFC reference from the payload), (3) Why it matters (business, regulatory, licensing or supervisory risk), (4) What to do next (a concrete, feasible remediation).",
    "When relevant, reflect a regulator's control objective (prevent misuse, preserve market integrity, client asset protection) and indicate audit readiness (e.g., evidence artefacts, event logs, role separation).",
    "Use any provided code_refs to cite contract paths and functions; do not fabricate filenames or functions.",
    "Reference only the clause URLs/identifiers supplied. If none exist, leave compliance_refs empty rather than guessing.",
    "Paraphrase runtime hints; avoid pasting raw probe strings or internal artefacts.",
    "For each finding, set the id field to exactly match a rule id from the payload; never invent new identifiers.",
    "Self-check before finalizing: clarity, correctness (matches payload), policy alignment, and actionability must all be satisfied.",
    "When writing the 'explanation' field, assume the audience is an HKMA/SFC auditor reviewing compliance with AMLO and virtual-asset licensing standards. Avoid deep engineering or code-level details unless directly linked to a regulatory breach. Instead, explain the issue in supervisory terms:",
    "- Identify the control intent (e.g., KYC verification, transaction screening, record retention, client asset segregation).",
    "- Describe the regulatory or operational risk if unmitigated (e.g., potential breach of AMLO s.5(1) on ongoing monitoring, insufficient audit trail, weak client protection).",
    "- Explain how the control gap would be viewed by a regulator — for example, as a failure in due diligence, monitoring, or governance.",
    "- Maintain clear traceability between the rule payload and regulatory clause without quoting legal text verbatim.",
    "When the verdict is 'PASS', still provide a concise compliance rationale in the 'explanation' field — describe why the observed result meets AMLO or ERC-3643 expectations (e.g., control operates as designed, clause requirement satisfied, risk mitigated). Avoid simply restating data outputs.",
    "Use plain, professional language that a non-technical HKMA/SFC VA Controller auditor can easily understand. Avoid jargon such as on-chain transaction traces, contract modifiers, or ABI structures unless critical to compliance interpretation.",
    // "When writing the 'explanation' field, use clear, regulatory-oriented language suitable for non-technical HKMA/SFC auditors. Avoid technical implementation details unless essential to understanding risk. Focus on explaining the control weakness, regulatory intent, and supervisory implication in business terms (e.g., 'client asset segregation risk', 'licensing breach exposure', 'transaction traceability gap').",
    "When the verdict is 'PASS', do not copy the evidence or runtime signal directly into the 'explanation'. Instead, interpret what that evidence means — explain why the observed control behavior satisfies the AMLO or ERC-3643 requirement (e.g., 'module correctly registered', 'verification mechanism triggered as expected', 'monitoring control executed successfully'). The explanation should describe compliance intent and assurance, not raw evidence.",
    "Respond strictly with JSON:{\"overall_assessment\":string,\"findings\":[{\"id\":string,\"title\":string,\"severity\":\"VERY_HIGH\"|\"HIGH\"|\"MEDIUM\",\"phase2_verdict\":string,\"verdict\":\"PASS\"|\"VERY_HIGH\"|\"HIGH\"|\"MEDIUM\",\"position\":\"SUPPORT\"|\"CHALLENGE\"|\"EXTEND\",\"explanation\":string,\"compliance_refs\":string[],\"evidence_paths\":string[],\"recommendation\":string}]}",
    "Keep tone professional and supervisory (HKMA/SFC)."
  ].join(" ");

  const body = {
    model,
    // temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(payload) }
    ]
  };

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
    const outer = JSON.parse(text);
    const content = outer?.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM response missing content");
    const parsed = JSON.parse(content);
    cache[key] = parsed; saveCache(cache);
    return { disabled: false, model: outer?.model || model, raw: parsed };
  } catch (error) {
    return { disabled: false, model, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeLlmFinding(finding) {
  if (!finding || typeof finding !== "object") return null;
  const id = String(finding.id || finding.rule || "").trim();
  if (!id) return null;
  const title = finding.title ? String(finding.title) : id;
  const severityInfo = normalizeSeverityValue(finding.severity || finding.severity_code || finding.severity_label);
  const severity = severityInfo.code;
  const severityLabelText = severityInfo.label;
  const phase2Verdict = severityLabelText;
  const position = "";
  const explanation = String(finding.explanation || "").trim();
  const complianceRefs = normalizeArray(finding.compliance_refs || finding.policy_refs);
  const evidencePaths = normalizeArray(finding.evidence_paths || finding.evidence);
  const recommendation = String(finding.recommendation || finding.fix || "").trim();
  return {
    id,
    title,
    severity,
    severity_label: severityLabelText,
    phase2_verdict: phase2Verdict,
    verdict: severity,
    pass: false,
    position,
    explanation,
    compliance_refs: complianceRefs,
    evidence_paths: evidencePaths,
    recommendation
  };
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
    `Deterministic Summary: PASS=${summary.pass} | VERY_HIGH=${summary.veryHigh ?? summary.critical ?? 0} | HIGH=${summary.high || 0} | MEDIUM=${summary.medium || 0}`
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

function computeCoverageDistribution(findings) {
  const counts = { SUPPORT: 0, CHALLENGE: 0, EXTEND: 0 };
  if (Array.isArray(findings)) {
    for (const f of findings) {
      const key = String(f?.position || f?.verdict || "").toUpperCase();
      if (key === "SUPPORT" || key === "PASS") counts.SUPPORT += 1;
      else if (key === "CHALLENGE" || key === "FAIL") counts.CHALLENGE += 1;
      else if (key === "EXTEND" || key === "NEW") counts.EXTEND += 1;
    }
  }
  return counts;
}

function hasOnChainData(runsMeta) {
  return runsMeta.some(meta => {
    const d = meta?.data;
    if (!d) return false;
    const numeric = typeof d.topicsCount === "number" && d.topicsCount > 0;
    const addresses = [d.tokenIdentity, d.tokenCompliance, d.tokenOwner, d.ctrOwner, d.idrClaimTopicsAddr, d.complianceBoundToken]
      .filter(Boolean)
      .some(addr => typeof addr === "string" && addr.toLowerCase() !== "0x0000000000000000000000000000000000000000");
    return numeric || addresses;
  });
}

async function augment(inputPath, outputPath, textPath, root) {
  loadLocalEnv(root);
  if (!fs.existsSync(inputPath)) {
    console.error(`[augment-llm] Input not found: ${inputPath}`);
    process.exit(1);
  }
  const obj = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const items = Array.isArray(obj.items) ? obj.items : [];
  const summary = obj.summary || { total: items.length, pass: 0, critical: 0, high: 0, medium: 0, low: 0, fail: 0, warn: 0, info: 0 };
  const runsMeta = Array.isArray(obj.runs) ? obj.runs : [];

  const payload = buildLlmInput(summary, items, runsMeta);
  let llmResult;
  if (!hasOnChainData(runsMeta)) {
    console.warn("[augment-llm] Skipping LLM: no on-chain data available.");
    llmResult = {
      model: null,
      disabled: false,
      reason: "LLM skipped: deterministic data only (no on-chain evidence).",
      overallAssessment: "LLM skipped: deterministic data only (no on-chain evidence).",
      findings: fallbackFindings(items),
      payload
    };
  } else {
    const llm = await callPhase2Llm(payload);
    if (llm.disabled) {
      console.warn(`[augment-llm] ${llm.message || "LLM disabled"}`);
      llmResult = {
        model: llm.model,
        disabled: true,
        reason: llm.message || "LLM disabled",
        overallAssessment: llm.message || "LLM disabled (missing API key)",
        findings: fallbackFindings(items),
        payload
      };
    } else if (llm.error) {
      console.warn(`[augment-llm] LLM call failed: ${llm.error}`);
      llmResult = {
        model: llm.model,
        disabled: false,
        error: llm.error,
        overallAssessment: `LLM call failed: ${llm.error}`,
        findings: fallbackFindings(items),
        payload
      };
    } else {
      const normalized = normalizeLlmOutput(llm.raw);
      llmResult = {
        model: llm.model,
        disabled: false,
        overallAssessment: normalized.overallAssessment || "",
        findings: normalized.findings,
        payload
      };
    }
  }

  const llmAvailable = !llmResult.disabled && !llmResult.error;
  const harmonizedFindings = canonicalizeFindingIds(llmResult.findings, items);
  const alignedFindings = alignFindingsWithDeterministic(items, harmonizedFindings);

  if (llmAvailable) {
    llmResult.findings = alignedFindings;
  } else {
    llmResult.findings = alignFindingsWithDeterministic(items, fallbackFindings(items));
  }

  const generatedAt = new Date().toISOString();
  obj.llm = {
    generatedAt,
    model: llmResult.model || null,
    disabled: !!llmResult.disabled,
    reason: llmResult.reason || null,
    error: llmResult.error || null,
    overallAssessment: llmResult.overallAssessment || "",
    findings: llmResult.findings || [],
    payload: llmResult.payload || null
  };
  obj.coverageDistribution = computeCoverageDistribution(obj.llm.findings);

  if (textPath) {
    const reportText = renderPhase2Report(summary, obj.llm);
    ensureDir(path.dirname(textPath));
    fs.writeFileSync(textPath, `${reportText}\n`);
    obj.report = { textPath: path.relative(root, textPath) };
  } else {
    obj.report = obj.report || null;
  }

  fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2));
  console.log(`[augment-llm] Updated ${path.relative(root, outputPath)}`);
  if (textPath) console.log(`[augment-llm] Wrote ${path.relative(root, textPath)}`);
}

(async () => {
  try {
    const { input, output, textOut, root } = parseArgs();
    await augment(input, output, textOut, root);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
