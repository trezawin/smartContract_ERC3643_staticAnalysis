#!/usr/bin/env python3
"""
prompt_alignment_test_gemini.py

Evaluates LLM recommendation outputs using Deepeval metrics (PromptAlignment, Faithfulness, Coherence)
with a custom Gemini LLM integration.
"""

import hashlib
import json
import os
import time
import random
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ------------------------------
# Gemini setup for Deepeval
# ------------------------------
try:
    import google.generativeai as genai
    from deepeval.models import DeepEvalBaseLLM
except ImportError as exc:
    raise ImportError(
        "Please install Gemini SDK and Deepeval first:\n"
        "pip install google-generativeai deepeval"
    ) from exc

class CustomGeminiLLM(DeepEvalBaseLLM):
    def __init__(self, model_name="gemini-2.5-flash"):
        self.model_name = model_name
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise EnvironmentError("GEMINI_API_KEY is not set in environment.")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name)
        super().__init__(name=model_name)

    def generate(self, prompt: str, **kwargs) -> str:
        try:
            response = self.model.generate_content(prompt)
            if hasattr(response, "text"):
                return response.text.strip()
            elif hasattr(response, "candidates") and response.candidates:
                parts = response.candidates[0].content.parts
                if parts and hasattr(parts[0], "text"):
                    return parts[0].text.strip()
            return str(response)
        except Exception as e:
            print(f"[gemini] Error generating content: {e}")
            return ""

    async def a_generate(self, prompt: str, **kwargs) -> str:
        return self.generate(prompt, **kwargs)

    def get_model_name(self) -> str:
        return self.model.model_name

    def load_model(self, *args, **kwargs):
        return self.model

# ------------------------------
# Deepeval metrics
# ------------------------------
try:
    from deepeval.metrics import PromptAlignmentMetric, FaithfulnessMetric, ContextualRelevancyMetric
    print("[prompt-alignment] Using ContextualRelevancyMetric (replaces CoherenceMetric).")
    from deepeval.test_case import LLMTestCase
except ImportError as exc:
    print("[prompt-alignment] deepeval not installed. Run `pip install deepeval`.")
    raise

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
OUTPUT_PATH = REPORTS_DIR / "prompt_alignment_metrics_gemini.json"
CACHE_PATH = REPORTS_DIR / "prompt_alignment_cache_gemini.json"
CACHE_VERSION = 1

PROMPT_INSTRUCTIONS = [
    "Recommendations should be specific and testable (e.g. update logic, add events, monitoring, tests).",
    "When relevant, include a brief validation plan describing what tests to add.",
]

DATASETS = ["amlo-buggy"]

# ------------------------------
# Metric setup with Gemini
# ------------------------------
GEMINI_MODEL = CustomGeminiLLM()

from deepeval.models.gpt_model import GPTModel
EVALUATOR_MODEL = GPTModel(model="gpt-4o-mini")

METRIC_SPECS = [
    ("prompt_alignment", lambda: PromptAlignmentMetric(
        prompt_instructions=PROMPT_INSTRUCTIONS,
        model=EVALUATOR_MODEL,
        include_reason=True,
    )),
    ("faithfulness", lambda: FaithfulnessMetric(
        model=EVALUATOR_MODEL,
        include_reason=True,
    )),
]

try:
    METRIC_SPECS.append((
        "contextual_relevancy",
        lambda: ContextualRelevancyMetric(
            model=EVALUATOR_MODEL,
            include_reason=True,
        ),
    ))
except Exception:
    pass

# ------------------------------
# Utility helpers
# ------------------------------
def _sleep_interval():
    return float(os.getenv("PROMPT_ALIGNMENT_SLEEP", "5.0"))

REQUEST_SLEEP = _sleep_interval()

def safe_measure(metric, test_case, max_retries=3):
    backoff = 1.0
    for attempt in range(max_retries):
        try:
            metric.measure(test_case)
            return
        except Exception as exc:
            if attempt == max_retries - 1:
                raise
            delay = backoff * (2 ** attempt) + random.uniform(0, 1)
            print(f"[prompt-alignment] Retry {attempt+1} after {delay:.1f}s due to {exc}")
            time.sleep(delay)

def load_cache():
    if not CACHE_PATH.exists():
        return {"_meta": {"version": CACHE_VERSION}}
    try:
        with CACHE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    if data.get("_meta", {}).get("version") != CACHE_VERSION:
        return {"_meta": {"version": CACHE_VERSION}}
    return data

def save_cache(cache):
    cache["_meta"] = {"version": CACHE_VERSION}
    try:
        with CACHE_PATH.open("w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        print(f"[prompt-alignment] Warning: could not save cache: {e}")

def build_cache_key(entry):
    payload = f"{entry.get('dataset')}|{entry.get('rule_id')}|{entry.get('recommendation')}"
    return hashlib.sha256(payload.encode()).hexdigest()

# ------------------------------
# Evaluation
# ------------------------------
def gather_findings():
    entries = []
    for dataset in DATASETS:
        path = REPORTS_DIR / f"{dataset}.json"
        if not path.exists():
            print(f"[prompt-alignment] Missing dataset report: {path}")
            continue
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        for finding in payload.get("llm", {}).get("findings", []):
            rec = (finding or {}).get("recommendation", "").strip()
            if rec:
                entries.append({
                    "dataset": dataset,
                    "rule_id": finding.get("id") or "",
                    "recommendation": rec,
                    "explanation": finding.get("explanation") or "",
                    "note": finding.get("note") or "",
                    "evidence_paths": finding.get("evidence_paths") or [],
                })
    return entries

def evaluate(entries):
    cache = load_cache()
    results, errors = [], []
    for idx, entry in enumerate(entries):
        rec = entry["recommendation"]
        cache_key = build_cache_key(entry)
        if cache_key in cache:
            results.append(cache[cache_key])
            continue

        metrics_result = {}
        for name, factory in METRIC_SPECS:
            metric = factory()
            test_case = LLMTestCase(
                input="Recommendation guidance",
                actual_output=rec,
                contexts=[entry["explanation"] or "No context"]
            )
            try:
                print(f"[metric] Measuring {name} for recommendation id={entry['rule_id']}")
                safe_measure(metric, test_case)
                print(f"[metric] {name} score={getattr(metric, 'score', None)} reason={getattr(metric, 'reason', '')[:120]}")
                metrics_result[name] = {
                    "score": float(metric.score),
                    "reason": getattr(metric, "reason", "")
                }
            except Exception as e:
                errors.append({
                    "dataset": entry["dataset"],
                    "rule_id": entry["rule_id"],
                    "metric": name,
                    "error": str(e)
                })
                continue

        record = {
            "dataset": entry["dataset"],
            "rule_id": entry["rule_id"],
            "recommendation": rec,
            "metrics": metrics_result
        }
        cache[cache_key] = record
        results.append(record)

        if idx > 0:
            time.sleep(REQUEST_SLEEP)

    save_cache(cache)
    return results, errors

# ------------------------------
# Output writing
# ------------------------------
def write_results(scores, errors=None):
    averages = {}
    counts = {}
    for entry in scores:
        for name, data in entry.get("metrics", {}).items():
            averages[name] = averages.get(name, 0) + data["score"]
            counts[name] = counts.get(name, 0) + 1

    per_metric_average = {k: averages[k] / counts[k] for k in averages if counts[k]}

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump({
            "results": scores,
            "per_metric_average": per_metric_average,
            "errors": errors or [],
            "prompt_instructions": PROMPT_INSTRUCTIONS,
        }, f, indent=2)
    print(f"[prompt-alignment] Gemini metrics saved to {OUTPUT_PATH}")

# ------------------------------
# Main
# ------------------------------
def main():
    if not os.getenv("GEMINI_API_KEY"):
        print("[prompt-alignment] GEMINI_API_KEY not set, skipping.")
        return
    entries = gather_findings()
    if not entries:
        print("[prompt-alignment] No findings found.")
        return
    results, errors = evaluate(entries)
    if errors:
        print(f"[prompt-alignment] {len(errors)} errors encountered.")
    write_results(results, errors)

if __name__ == "__main__":
    main()