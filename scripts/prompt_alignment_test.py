#!/usr/bin/env python3
"""
prompt_alignment_test.py

Evaluates LLM recommendation outputs against the prompt instructions
using Deepeval's PromptAlignmentMetric.
"""

import hashlib
import json
import os
import time
import random
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional dependency
    def load_dotenv():
        return False

load_dotenv()

from importlib import import_module


def import_metric_class(name, module_candidates, fallback_message):
    for module_path in module_candidates:
        try:
            module = import_module(module_path)
            metric = getattr(module, name)
            return metric
        except (ImportError, AttributeError):
            continue
    if fallback_message:
        print(fallback_message)
    return None


try:
    from deepeval.metrics import PromptAlignmentMetric
    from deepeval.test_case import LLMTestCase
except ImportError as exc:
    print("[prompt-alignment] deepeval is not installed. Install via `pip install deepeval`.\n"
          f"Original error: {exc}")
    raise

FaithfulnessMetric = import_metric_class(
    "FaithfulnessMetric",
    ["deepeval.metrics", "deepeval.metrics.faithfulness"],
    "[prompt-alignment] FaithfulnessMetric not available; skipping faithfulness metric.",
)

# CorrectnessMetric = import_metric_class(
#     "CorrectnessMetric",
#     [
#         "deepeval.metrics",
#         "deepeval.metrics.correctness",
#         "deepeval.metrics.openai.correctness_metric",
#     ],
#     "[prompt-alignment] CorrectnessMetric not available; skipping correctness metric.",
# )

ContextualRelevancyMetric = import_metric_class(
    "ContextualRelevancyMetric",
    [
        "deepeval.metrics",
        "deepeval.metrics.contextual_relevancy",
        "deepeval.metrics.openai.contextual_relevancy_metric",
    ],
    "[prompt-alignment] ContextualRelevancyMetric not available; skipping contextual relevancy metric.",
)

# ConcisenessMetric = import_metric_class(
#     "ConcisenessMetric",
#     [
#         "deepeval.metrics",
#         "deepeval.metrics.conciseness",
#         "deepeval.metrics.openai.conciseness_metric",
#     ],
#     "[prompt-alignment] ConcisenessMetric not available; skipping conciseness metric.",
# )

try:  # pragma: no cover - optional dependency
    from openai import OpenAIError as _OpenAIErrorBase, RateLimitError as _RateLimitErrorBase
except ImportError:
    class _OpenAIErrorBase(Exception):
        pass
    class _RateLimitErrorBase(_OpenAIErrorBase):
        pass

try:  # pragma: no cover - optional dependency
    from tenacity import RetryError as _RetryError
except ImportError:
    class _RetryError(Exception):
        pass
ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
OUTPUT_PATH = REPORTS_DIR / "prompt_alignment_metrics.json"
CACHE_PATH = REPORTS_DIR / "prompt_alignment_cache.json"
CACHE_VERSION = 2
DISABLED_METRICS = set()

def _sleep_interval():
    raw = os.getenv("PROMPT_ALIGNMENT_SLEEP", "5.0")
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 0.5

REQUEST_SLEEP = _sleep_interval()
PROMPT_INSTRUCTIONS = [
    "When writing the 'explanation' field, assume the audience is an HKMA/SFC auditor reviewing compliance with AMLO and virtual-asset licensing standards. Avoid deep engineering or code-level details unless directly linked to a regulatory breach. Instead, explain the issue in supervisory terms:",
    "- Identify the control intent (e.g., KYC verification, transaction screening, record retention, client asset segregation).",
    "- Describe the regulatory or operational risk if unmitigated (e.g., potential breach of AMLO s.5(1) on ongoing monitoring, insufficient audit trail, weak client protection).",
    "- Explain how the control gap would be viewed by a regulator — for example, as a failure in due diligence, monitoring, or governance.",
    "- Maintain clear traceability between the rule payload and regulatory clause without quoting legal text verbatim.",
    "When the verdict is 'PASS', still provide a concise compliance rationale in the 'explanation' field — describe why the observed result meets AMLO or ERC-3643 expectations (e.g., control operates as designed, clause requirement satisfied, risk mitigated). Avoid simply restating data outputs.",
    "Use plain, professional language that a non-technical HKMA/SFC VA Controller auditor can easily understand. Avoid jargon such as on-chain transaction traces, contract modifiers, or ABI structures unless critical to compliance interpretation.",
    "When the verdict is 'PASS', do not copy the evidence or runtime signal directly into the 'explanation'. Instead, interpret what that evidence means — explain why the observed control behavior satisfies the AMLO or ERC-3643 requirement (e.g., 'module correctly registered', 'verification mechanism triggered as expected', 'monitoring control executed successfully'). The explanation should describe compliance intent and assurance, not raw evidence."
    
    # "When writing the 'explanation' field, assume the audience is an HKMA/SFC auditor reviewing compliance with AMLO and virtual-asset licensing standards. Avoid deep engineering or code-level details unless directly linked to a regulatory breach. Instead, explain the issue in supervisory terms:",
    # "- Identify the control intent (e.g., KYC verification, transaction screening, record retention, client asset segregation).",
    # "- Describe the regulatory or operational risk if unmitigated (e.g., potential breach of AMLO s.5(1) on ongoing monitoring, insufficient audit trail, weak client protection).",
    # "- Explain how the control gap would be viewed by a regulator — for example, as a failure in due diligence, monitoring, or governance.",
    # "- Maintain clear traceability between the rule payload and regulatory clause without quoting legal text verbatim.",
    # "Use plain, professional language that a non-technical HKMA/SFC VA Controller auditor can easily understand. Avoid jargon such as on-chain transaction traces, contract modifiers, or ABI structures unless critical to compliance interpretation.",
    # "When the verdict is 'PASS', do not copy the evidence or runtime signal directly into the 'explanation'. Instead, interpret what that evidence means — explain why the observed control behavior satisfies the AMLO or ERC-3643 requirement (e.g., 'module correctly registered', 'verification mechanism triggered as expected', 'monitoring control executed successfully'). The explanation should describe compliance intent and assurance, not raw evidence."
]
# PROMPT_INSTRUCTIONS = [
#     # --- Audience and style ---
#     "When writing the 'explanation' field for findings that will be reviewed by HKMA/SFC auditors under AMLO and ERC-3643 standards.",
#     "Use a supervisory and compliance-oriented tone. Avoid engineering jargon unless necessary to describe the control failure or logic path. Always link your explanation to AMLO control intent and regulatory expectations.",

#     # --- Core structure ---
#     "Each explanation must follow this 4-step structure clearly, even if concise:",
#     "1. **Control intent:** What the control is supposed to achieve (e.g., verify identity before transfer, maintain an auditable trail, enforce client asset segregation).",
#     "2. **Observation:** What was actually observed (summarize the evidence or outcome, but do not copy raw runtime or logs).",
#     "3. **Regulatory implication:** Why the observation matters — describe the AMLO clause or licensing obligation it affects (e.g., AMLO Schedule 2 s.5(1) ongoing monitoring, s.13A role-based gating).",
#     "4. **Supervisory interpretation:** How a regulator would view the control status — e.g., as satisfactory, partially effective, or a failure of due diligence / ongoing monitoring.",
#     "Use one or two sentences per point. Maintain clear traceability to rule_id or clause number but do not quote legal text verbatim.",

#     # --- Compliance rationale for PASS verdicts ---
#     "When the verdict is 'PASS', never repeat evidence directly (e.g., 'modules loaded: 2'). Instead, interpret why the result demonstrates compliance.",
#     "Example: Instead of 'Compliance modules registered: 2', write 'Two compliance modules were successfully registered, showing that required safeguards are active and meet AMLO Schedule 2 s.5(1) expectations for ongoing monitoring.'",

#     # --- Contextual reasoning for FAIL or non-compliant cases ---
#     "When the verdict is not 'PASS', clearly state the missing or ineffective control, its AMLO clause, and why it poses a regulatory or licensing risk. Link the explanation to the supervisory purpose (market integrity, client protection, prevention of misuse).",

#     # --- Example one-shot demonstration ---
#     "Example of a well-aligned explanation:",
#     "\"Control intent: Ensure that all transfers occur only between verified counterparties under AMLO Schedule 2 s.2. "
#     "Observation: The contract allows transfers from unverified addresses, bypassing customer due diligence checks. "
#     "Regulatory implication: This weakens AML/KYC enforcement and exposes the operator to non-compliance with s.2(a) CDD requirements. "
#     "Supervisory interpretation: An HKMA auditor would consider this a material control gap requiring remediation before licensing approval.\"",

#     # --- Final instruction ---
#     "Do not output lists or bullet points in the JSON. Write the 'explanation' as a cohesive, paragraph-style summary that still follows the four points logically. Prioritize clarity, compliance reasoning, and regulatory traceability."
# ]

DATASETS = [
    "amlo-trex",
    "amlo-boulder",
    "amlo-buggy",
]

MODEL_NAME = os.getenv("PROMPT_ALIGNMENT_MODEL", "gpt-4.1")

METRIC_SPECS = [
    (
        "prompt_alignment",
        lambda: PromptAlignmentMetric(
            prompt_instructions=PROMPT_INSTRUCTIONS,
            model=MODEL_NAME,
            include_reason=True,
            strict_mode=False
        ),
    )
]

if FaithfulnessMetric:
    METRIC_SPECS.append(
        (
            "faithfulness",
            lambda: FaithfulnessMetric(
                model=MODEL_NAME,
                include_reason=True,
            ),
        )
    )

# if CorrectnessMetric:
#     METRIC_SPECS.append(
#         (
#             "correctness",
#             lambda: CorrectnessMetric(
#                 model=MODEL_NAME,
#                 include_reason=True,
#             ),
#         )
#     )

if ContextualRelevancyMetric:
    METRIC_SPECS.append(
        (
            "contextual_relevancy",
            lambda: ContextualRelevancyMetric(
                model=MODEL_NAME,
                include_reason=True,
            ),
        )
    )

# if ConcisenessMetric:
#     METRIC_SPECS.append(
#         (
#             "conciseness",
#             lambda: ConcisenessMetric(
#                 model=MODEL_NAME,
#                 include_reason=True,
#             ),
#         )
#     )

def safe_measure(metric, test_case, max_retries=3):
    backoff_base = 1.0
    for attempt in range(max_retries):
        try:
            metric.measure(test_case)
            return
        except (_RateLimitErrorBase, _OpenAIErrorBase, _RetryError) as exc:
            if attempt == max_retries - 1:
                raise
            sleep_time = backoff_base * (2 ** attempt) + random.uniform(0, 0.5)
            time.sleep(sleep_time)
        except Exception:
            raise


def load_cache():
    if not CACHE_PATH.exists():
        return {"_meta": {"version": CACHE_VERSION}}
    try:
        with CACHE_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        data = {}
    if data.get("_meta", {}).get("version") != CACHE_VERSION:
        return {"_meta": {"version": CACHE_VERSION}}
    return data


def save_cache(cache):
    cache.setdefault("_meta", {})["version"] = CACHE_VERSION
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with CACHE_PATH.open("w", encoding="utf-8") as handle:
            json.dump(cache, handle, indent=2)
    except Exception as exc:
        print(f"[prompt-alignment] Warning: Failed to save cache file: {exc}")


def build_cache_key(entry):
    payload = f"{entry.get('dataset','')}|{entry.get('rule_id','')}|{entry.get('explanation','')}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_contexts(entry):
    contexts = []
    for item in [entry.get("recommendation"), entry.get("note"), entry.get("explanation")]:
        if item:
            contexts.append(item)
    for ev in entry.get("evidence_paths") or []:
        if ev:
            contexts.append(str(ev))
    return contexts or ["No additional context provided."]

def gather_findings():
    entries = []
    for dataset in DATASETS:
        report_path = REPORTS_DIR / f"{dataset}.json"
        if not report_path.exists():
            print(f"[prompt-alignment] Skipping missing report: {report_path}")
            continue
        with report_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        findings = payload.get("llm", {}).get("findings", [])
        for finding in findings:
            recommendation = (finding or {}).get("recommendation")
            if not recommendation:
                continue
            entries.append(
                {
                    "dataset": dataset,
                    "rule_id": finding.get("id") or "",
                    "recommendation": recommendation,
                    "explanation": finding.get("explanation") or "",
                    "evidence_paths": finding.get("evidence_paths") or [],
                    "note": finding.get("note") or "",
                }
            )
    return entries


def evaluate(entries):
    results = []
    errors = []
    cache = load_cache()

    global REQUEST_SLEEP
    rate_limit_error_occurred = False

    for idx, entry in enumerate(entries):
        explanation_text = (entry.get("explanation") or "").strip()
        if not explanation_text:
            print(
                f"[prompt-alignment] Warning: skipping empty explanation for dataset "
                f"{entry.get('dataset')} rule {entry.get('rule_id')}"
            )
            continue

        cache_key = build_cache_key(entry)
        cached_metrics = cache.get(cache_key, {})
        metrics_results = {}
        entry_errors = []

        for metric_name, metric_factory in METRIC_SPECS:
            if metric_name in DISABLED_METRICS:
                continue
            if metric_name in cached_metrics:
                metrics_results[metric_name] = cached_metrics[metric_name]
                continue

            if REQUEST_SLEEP and (idx > 0 or metrics_results):
                time.sleep(REQUEST_SLEEP)

            metric = metric_factory()
            test_case_kwargs = {
                "input": "Explanation guidance",
                "actual_output": entry["explanation"],
            }
            if metric_name in {"faithfulness", "contextual_relevancy"}:
                contexts = build_contexts(entry)
                test_case_kwargs["contexts"] = contexts
                test_case_kwargs["retrieval_context"] = contexts
            test_case = LLMTestCase(**test_case_kwargs)

            try:
                safe_measure(metric, test_case)
            except (_RateLimitErrorBase, _RetryError) as exc:
                rate_limit_error_occurred = True
                entry_errors.append(
                    {
                        "dataset": entry["dataset"],
                        "rule_id": entry["rule_id"],
                        "metric": metric_name,
                        "error": "rate_limit",
                        "detail": str(exc),
                    }
                )
                break
            except _OpenAIErrorBase as exc:
                entry_errors.append(
                    {
                        "dataset": entry["dataset"],
                        "rule_id": entry["rule_id"],
                        "metric": metric_name,
                        "error": "api_error",
                        "detail": str(exc),
                    }
                )
                break
            except Exception as exc:  # pragma: no cover - defensive
                entry_errors.append(
                    {
                        "dataset": entry["dataset"],
                        "rule_id": entry["rule_id"],
                        "metric": metric_name,
                        "error": "unexpected_error",
                        "detail": str(exc),
                    }
                )
                DISABLED_METRICS.add(metric_name)
                print(f"[prompt-alignment] Disabling metric {metric_name} after failure: {exc}")
                break
            else:
                metrics_results[metric_name] = {
                    "score": float(metric.score),
                    "reason": getattr(metric, "reason", ""),
                }
                cached_metrics[metric_name] = metrics_results[metric_name]

        cacheable = not entry_errors and bool(metrics_results)
        if entry_errors:
            errors.extend(entry_errors)

        if metrics_results:
            results.append(
                {
                    "dataset": entry["dataset"],
                    "rule_id": entry["rule_id"],
                    "recommendation": entry.get("recommendation", ""),
                    "explanation": entry.get("explanation", ""),
                    "metrics": metrics_results,
                }
            )
        if cacheable:
            cache[cache_key] = cached_metrics

    if rate_limit_error_occurred:
        new_sleep = min(REQUEST_SLEEP * 1.5, 15.0)
        if new_sleep > REQUEST_SLEEP:
            REQUEST_SLEEP = new_sleep
            print(
                f"[prompt-alignment] Notice: Rate limit errors detected. "
                f"Increasing sleep interval to {REQUEST_SLEEP:.2f} seconds."
            )

    save_cache(cache)
    return results, errors


def write_results(scores, errors=None, note=None):
    per_metric_totals = {}
    per_metric_counts = {}
    for entry in scores:
        for metric_name, data in entry.get("metrics", {}).items():
            per_metric_totals.setdefault(metric_name, 0.0)
            per_metric_counts.setdefault(metric_name, 0)
            score_value = data.get("score")
            if score_value is None:
                continue
            per_metric_totals[metric_name] += float(score_value)
            per_metric_counts[metric_name] += 1

    per_metric_average = {
        metric: (per_metric_totals[metric] / per_metric_counts[metric])
        for metric in per_metric_totals
        if per_metric_counts[metric]
    }

    output = {
        "prompt_instructions": PROMPT_INSTRUCTIONS,
        "results": scores,
        "per_metric_average": per_metric_average,
        "per_metric_counts": per_metric_counts,
        "test_count": len(scores),
        "errors": errors or [],
        "note": note,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
    print(f"[prompt-alignment] Metrics written to {OUTPUT_PATH}")


def main():
    api_key = ""
    for candidate in ("OPENAI_API_KEY", "LLM_API_KEY"):
        value = os.getenv(candidate)
        if value and value.strip():
            api_key = value.strip()
            break
    if not api_key:
        print("[prompt-alignment] OPENAI_API_KEY not set. Skipping evaluation.")
        write_results([], note="Skipped: OPENAI_API_KEY not set.")
        return
    findings = gather_findings()
    if not findings:
        print("[prompt-alignment] No recommendations found in reports.")
        return
    scores, errors = evaluate(findings)
    if errors:
        print(f"[prompt-alignment] {len(errors)} entries encountered errors during evaluation.")
    write_results(scores, errors=errors)


if __name__ == "__main__":
    main()
