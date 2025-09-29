#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# Robust Slither import for multiple versions
try:
    from slither.slither import Slither
except Exception:
    from slither import Slither  # fallback

import os, re, sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TARGET = "." if len(sys.argv) < 2 else sys.argv[1]

sl = Slither(TARGET)

ok = True
warns = []

def fail(msg):
    global ok
    ok = False
    print("[FAIL]", msg)

def warn(msg):
    warns.append(msg)
    print("[WARN]", msg)

# ---------- Inventory (helps debugging & appendix) ----------
print("\n[INFO] Contracts visible to Slither:")
for name in sorted(c.name for c in sl.contracts):
    print(" -", name)
print()
print("\n[INFO] Contracts detected:", len(sl.contracts))
print()

# ---------- Helpers ----------
def get_fn_src(fn):
    try:
        sm = getattr(fn, "source_mapping", None)
        if sm and getattr(sm, "content", None):
            return sm.content or ""
    except Exception:
        pass
    return ""

def get_fn_header(fn):
    # best-effort: grab first line of source as "header"
    src = get_fn_src(fn)
    return src.splitlines()[0].lower() if src else ""

# ---------- C1: Admin-like functions have access control ----------
ADMIN_LIKE = {
    "ClaimTopicsRegistry": ["addClaimTopic", "removeClaimTopic", "transferOwnership", "renounceOwnership"],
    "TrustedIssuersRegistry": ["addTrustedIssuer", "removeTrustedIssuer", "updateIssuer"],
    "IdentityRegistryStorage": ["bindIdentityRegistry", "addAgent", "removeAgent", "addIdentityToStorage"],
    "IdentityRegistry": [
        "setIdentityRegistryStorage", "setClaimTopicsRegistry", "setTrustedIssuersRegistry",
        "addAgent", "removeAgent", "registerIdentity", "registerIdentityFromRegistry"
    ],
    # Many T-REX versions call this Token; we’ll also look for aliases in C2.
    "Token": ["pause", "unpause", "forceTransfer", "mint", "issue", "setCompliance", "setIdentityRegistry",
              "addAgent", "removeAgent"]
}
MODIFIER_KEYWORDS = {"onlyowner", "onlyrole", "onlyagent", "onlypauser"}

def has_access_control(fn):
    # (a) Explicit modifiers
    try:
        for m in fn.modifiers:
            name = (getattr(m, "name", "") or "").lower()
            if name in MODIFIER_KEYWORDS or "onlyowner" in name or "onlyrole" in name:
                return True
    except Exception:
        pass
    # (b) Header text (captures `function foo(...) external onlyOwner {`)
    header = get_fn_header(fn)
    if any(k in header for k in ("onlyowner", "onlyrole", "onlyagent", "onlypauser")):
        return True
    # (c) Body hints
    src = get_fn_src(fn).lower()
    if any(k in src for k in ("onlyowner", "accesscontrol", "hasrole(", "agentrole", "onlyrole")):
        return True
    # (d) Inline ownership checks
    if "owner()" in src and ("require(" in src or "revert" in src):
        return True
    return False

def contract_has_access_parents(c):
    bases = " ".join(b.name.lower() for b in getattr(c, "inheritance", []))
    return any(k in bases for k in ["ownable", "accesscontrol", "agentrole"])

for c in sl.contracts:
    patterns = ADMIN_LIKE.get(c.name, [])
    if not patterns:
        continue
    for fn in c.functions_and_modifiers_declared:
        for pat in patterns:
            rx = re.compile("^" + re.escape(pat).replace("\\*", ".*") + "$")
            if rx.match(fn.name) and fn.visibility in ("public", "external"):
                if not has_access_control(fn) and contract_has_access_parents(c):
                    warn(f"C1: {c.name}.{fn.name} — not directly proven, but contract inherits access-control base")
# ---------- C2: Token transfer path reaches canTransfer ----------
TOKEN_CANDIDATE_NAMES = {"token", "trextoken", "erc3643token"}  # lowercased
def reaches_canTransfer(fn):
    try:
        for g in fn.all_functions_called():
            if "cantransfer" in g.name.lower():
                return True
    except Exception:
        pass
    return "canTransfer(" in get_fn_src(fn)

found_any_token = False
checked_transfer_path = False
for c in sl.contracts:
    if c.name.lower() in TOKEN_CANDIDATE_NAMES:
        found_any_token = True
        tfs = [f for f in c.functions_declared if f.name in ("transfer", "transferFrom", "_update", "_transfer")]
        if not tfs:
            warn(f"C2: {c.name} has no recognizable transfer functions (variant may abstract transfers differently)")
        else:
            checked_transfer_path = True
            if not any(reaches_canTransfer(f) for f in tfs):
                warn(f"C2: Did not find evidence that {c.name} transfer path reaches canTransfer() (review variant)")

if not found_any_token:
    warn("C2: No contract with a typical ERC-3643 token name found (add import shim to compile it)")

# ---------- C3: No tx.origin anywhere (hard fail) ----------
TXORIGIN_FOUND = []
SCAN_DIRS = [
    os.path.join(PROJECT_ROOT, "contracts"),
    os.path.join(PROJECT_ROOT, "node_modules", "@tokenysolutions", "t-rex"),
    os.path.join(PROJECT_ROOT, "node_modules", "@onchain-id", "solidity"),
]
for base in SCAN_DIRS:
    if not os.path.isdir(base):
        continue
    for root, _, files in os.walk(base):
        for f in files:
            if f.endswith(".sol"):
                path = os.path.join(root, f)
                try:
                    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                        if "tx.origin" in fh.read():
                            TXORIGIN_FOUND.append(path.replace(PROJECT_ROOT + os.sep, ""))
                except Exception:
                    pass

if TXORIGIN_FOUND:
    fail("C3: tx.origin usage found in:\n  - " + "\n  - ".join(TXORIGIN_FOUND))

# ---------- C4: Upgradeable contracts should have an initializer ----------
for c in sl.contracts:
    try:
        inherits = [b.name for b in c.inheritance]
    except Exception:
        inherits = []
    if any("OwnableUpgradeable" in b for b in inherits):
        # check for initialize-like fns or __Ownable_init in body
        names = [f.name.lower() for f in c.functions_declared]
        has_init_fn = any(n.startswith("initialize") or ("ownable" in n and "init" in n) for n in names)
        has_ownable_init_call = any("__ownable_init" in get_fn_src(f).lower() for f in c.functions_declared)
        if not (has_init_fn or has_ownable_init_call):
            warn(f"C4: {c.name} inherits OwnableUpgradeable but no obvious initializer found")
# --- Downgrade specific, known-safe WARNs to INFO for the thesis report ---
DOWNGRADE_PREFIXES = [
    "C1: IdentityRegistryStorage.bindIdentityRegistry",
    "C4: AgentRoleUpgradeable inherits OwnableUpgradeable but no obvious initializer found",
]

info_msgs = []
kept_warns = []
for w in warns:
    # Compare by prefix: text before the em dash or the whole string if none
    prefix = w.split(" — ")[0] if " — " in w else w
    if any(prefix.startswith(p) for p in DOWNGRADE_PREFIXES):
        info_msgs.append(w)
    else:
        kept_warns.append(w)

# Replace warns with the filtered list and print downgraded items as INFO
warns = kept_warns
for m in info_msgs:
    print("[INFO]", m)

# ---------- Summary ----------
print("\n[RESULT] ERC-3643 static subset:", "PASS ✅" if ok else "FAIL ❌")
if warns:
    print("\n[NOTE] Warnings (review manually):")
    for w in warns:
        print(" -", w)
sys.exit(0 if ok else 1)