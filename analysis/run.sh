#!/usr/bin/env bash
set -euo pipefail

# -------- settings --------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_DIR="${PROJECT_ROOT}/reports"
SLITHER_OUT_TXT="${REPORT_DIR}/slither_report.txt"
SLITHER_OUT_JSON="${REPORT_DIR}/slither_report.json"
SLITHER_OUT_SARIF="${REPORT_DIR}/slither_report.sarif"
ERC3643_OUT_TXT="${REPORT_DIR}/erc3643_checks.txt"

# Create reports dir
mkdir -p "${REPORT_DIR}"

echo "==> 1) Hardhat compile"
# Clean + compile so Slither can reuse artifacts
npx hardhat clean
npx hardhat compile

echo "==> 2) Slither built-in detectors (text, json, sarif)"
# Use the existing Hardhat artifacts; avoid Slither re-compiling
# Text summary
slither . --hardhat-ignore-compile > "${SLITHER_OUT_TXT}" 2>&1 || true
# JSON (machine-readable)
slither . --hardhat-ignore-compile --json "${SLITHER_OUT_JSON}" > /dev/null 2>&1 || true
# SARIF (for GitHub/code scanning)
slither . --hardhat-ignore-compile --sarif "${SLITHER_OUT_SARIF}" > /dev/null 2>&1 || true

echo "==> 3) Custom ERC-3643 static checks (C1–C4)"
# If your checks.py expects to skip compile, you can toggle it there,
# but we compiled already, so plain invocation is fine:
python analysis/checks.py > "${ERC3643_OUT_TXT}"

echo
echo "=== DONE ==="
echo "Reports:"
echo " - ${SLITHER_OUT_TXT}"
echo " - ${SLITHER_OUT_JSON}"
echo " - ${SLITHER_OUT_SARIF}"
echo " - ${ERC3643_OUT_TXT}"