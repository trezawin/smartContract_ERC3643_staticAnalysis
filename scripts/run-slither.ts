// scripts/run-slither.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const REPORT_DIR = resolve(process.cwd(), "reports");
const SLITHER_TARGET = "."; // Hardhat project root
const SLITHER = process.env.SLITHER_CMD || "slither"; // allow venv override
const FILTER_PATHS = process.env.SLITHER_FILTER_PATHS ?? ""; // e.g., "node_modules|vendor" to exclude deps

function safeUnlink(p: string) {
  try { unlinkSync(p); } catch {}
}

function run() {
  mkdirSync(REPORT_DIR, { recursive: true });

  const jsonOut = join(REPORT_DIR, "slither.json");
  const sarifOut = join(REPORT_DIR, "slither.sarif");

  // Ensure fresh outputs (Slither may refuse to overwrite)
  safeUnlink(jsonOut);
  safeUnlink(sarifOut);

  // Ensure Hardhat build-info exists (crytic-compile relies on it)
  try {
    // Force a rebuild so build-info is always fresh
    execFileSync("npx", ["hardhat", "compile", "--force"], { stdio: "inherit" });
  } catch (e) {
    console.error("[phase1] Hardhat compile failed; aborting.");
    process.exit(1);
  }

  // Build Slither args
  const args = [
    SLITHER_TARGET,
    "--compile-force-framework", "hardhat",
    "--json", jsonOut,
    "--sarif", sarifOut,
  ] as string[];

  if (FILTER_PATHS.trim().length > 0) {
    args.push("--filter-paths", FILTER_PATHS.trim());
  }

  console.log(`\n[phase1] Running: ${SLITHER} ${args.join(" ")}`);
  try {
    execFileSync(SLITHER, args, { stdio: "inherit" });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      console.error("[phase1] 'slither' not found. If you installed via a Python venv, set SLITHER_CMD, e.g.:");
      console.error('  export SLITHER_CMD="$(python -c \'import shutil; print(shutil.which(\\"slither\\"))\')"');
      process.exit(1);
    }
    // Slither exits non-zero if it *finds* issues; we still want artifacts
    console.warn("[phase1] Slither returned non-zero (findings are likely). Continuing.");
  }

  console.log(`[phase1] Wrote:\n - ${jsonOut}\n - ${sarifOut}`);
}

run();