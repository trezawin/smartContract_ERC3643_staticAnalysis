# ERC-3643 Static + Compliance Analyzer

A research toolkit to evaluate **ERC-3643 (T-REX)** smart contracts in two phases:

- **Phase 1 – Static Security Analysis (Slither):** Catch reentrancy, unchecked calls, loop issues, pragma mismatches, etc.
- **Phase 2 – Compliance Rule Engine (Hardhat + ABI checks):** Verify ERC-3643 wiring and HKMA/SFC-inspired compliance surfaces via ABI-level rules.

 !! Research prototype; not production-grade auditing. !!

---

## Tested Environment (pin these to avoid dependency hell)

- **Node.js**: 22.x (tested with 22.19.0)
- **npm**: 9.x
- **Python**: 3.11+ (for Slither)
- **Hardhat**: 2.26.3 (CJS toolchain)
- **ethers**: 5.7.2
- **@nomiclabs/hardhat-ethers**: 2.2.3 (works with ethers v5 + Hardhat v2)
- **Solidity**: 0.8.17 (matches T-REX)
- **OpenZeppelin (Upgradeable)**: 4.9.6

---

## 1) One-time Project Setup

From the repo root:

```bash
# Clone and enter the project
git clone <YOUR-REPO-URL>
cd <YOUR-REPO-DIR>

# Ensure package.json uses CommonJS to keep things simple with Hardhat v2
npm pkg set type="commonjs"

# Install Node dev deps (toolchain)
npm install --save-dev \
  hardhat@2.26.3 \
  @nomiclabs/hardhat-ethers@2.2.3 \
  ethers@5.7.2 \
  typescript ts-node @types/node

# --- Install contract packages (pin to solc 0.8.17 family) ---
npm install --save \
  @tokenysolutions/t-rex \
  @onchain-id/solidity \
  @openzeppelin/contracts-upgradeable@4.9.6

# --- Python venv + Slither ---
python3 -m venv erc_venv
source erc_venv/bin/activate
pip install --upgrade pip
pip install slither-analyzer crytic-compile
```

## Run Phase 1
```bash
# Clean & compile
npm run clean && npm run compile
# Run Slither; writes JSON + SARIF to reports/
npm run phase1:slither
# Summarize into Markdown + CSV (top findings, severities, by contract)
npm run phase1:summary
```
Outputs
	•	reports/slither.json – raw Slither findings
	•	reports/slither.sarif – CI-friendly SARIF
	•	reports/phase1-summary.md – human summary
	•	reports/phase1-findings.csv – spreadsheet of issues

## Rule Phase 2
```bash
# Deploys minimal T-REX components to the local Hardhat network and writes addresses to .cre.addresses.json.
npm run phase2:bootstrap

# (uses rules/baseline.json + rules/hkma_sfc.json) ==> reports/phase2-results.json
npm run phase2:run

# Render human report ==> reports/phase2-report.html
npm run phase2:render && npm run phase2:open
```

### Typical workflow
```bash
# 1) Build
npm run clean && npm run compile

# 2) Phase 1 (security)
npm run phase1:slither
npm run phase1:summary

# 3) Phase 2 (compliance)
npm run phase2:bootstrap      # or edit .cre.addresses.json with your real addresses
npm run phase2:diag           # quick sanity printout (owners/getters)
npm run phase2:run
npm run phase2:render && npm run phase2:open
```
