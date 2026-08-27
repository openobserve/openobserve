#!/usr/bin/env bash
#
# T38 / T40 (spec §9C) — build-shape tests for openobserve-synthetics.
#
#   T38  OSS build (`--no-default-features`) compiles and links no metering.
#   T40  self-hosted Enterprise build (`enterprise`, NOT `cloud`) emits nothing.
#   +    the `cloud` shape itself: T38 and T40 both leave `cloud` OFF, so on
#        their own they type-check ZERO lines of the trial gate — every line of
#        it is inside `#[cfg(feature = "cloud")]`.
#
# Run:   bash src/synthetics/tests/build_shapes.sh
# Opt-in extra (T39, multi-minute — builds two big leaf crates):
#        BUILD_SHAPES_T39=1 bash src/synthetics/tests/build_shapes.sh
#
# Not a `#[test]` on purpose: a Rust test that shells out to cargo re-enters the
# same target directory the outer `cargo test` already holds a lock on, so it
# blocks until the parent finishes — i.e. forever.

set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 1

PKG=openobserve-synthetics
SRC=src/synthetics/src
fails=0

ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
section() { printf '\n== %s\n' "$1"; }

# Enterprise crates. Every billing/metering symbol the emit could reach lives
# behind one of these two; if neither is in the dependency closure there is
# nothing to link.
ENT_CRATES='o2_enterprise|o2_openfga'

# Identifiers that only ever appear in metering/emit code.
#
# PLACEHOLDER: none of these exists in the crate yet — the Phase 1 emit (item
# 1.10) is what introduces them. So the assertion below is INERT today and its
# "ok" line says so; it is here so that the guard exists before the code it
# guards, not because it is currently proving anything. Do not read a green run
# of it as evidence about the emit.
EMIT_IDENTS='SyntheticsSteps|UsageEvent|report_request_usage_stats|TrialQuotaFeature|MeteringEventName'

# ---------------------------------------------------------------- T38 (OSS) --
section "T38 — OSS build: --no-default-features"

# NOTE: `--no-default-features` is a NO-OP for this package — `default = []`, so it is
# byte-identical to a plain check. Pinned below: if `default` ever gains a feature the flag
# starts meaning something and this section has to be re-read.
if grep -q '^default = \[\]$' src/synthetics/Cargo.toml; then
  ok "\`default = []\` — --no-default-features is equivalent to a plain check here"
else
  bad "src/synthetics/Cargo.toml no longer has \`default = []\`; T38's --no-default-features now changes the build — re-read this section"
fi

if cargo check -p "$PKG" --no-default-features --message-format=short >/dev/null 2>&1; then
  ok "compiles"
else
  bad "compiles"
  cargo check -p "$PKG" --no-default-features --message-format=short 2>&1 | tail -30
fi

# "Links no metering symbols", asserted where it is actually decidable: the
# dependency closure. `enterprise` is what pulls o2_enterprise in as an optional
# dep, so an OSS build must not contain it at all.
tree_oss=$(cargo tree -p "$PKG" --no-default-features -e normal --prefix none 2>/dev/null)
if [ -z "$tree_oss" ]; then
  bad "cargo tree (no-default-features) produced no output"
elif printf '%s\n' "$tree_oss" | grep -Eq "^($ENT_CRATES) "; then
  bad "OSS closure pulls an enterprise crate: $(printf '%s\n' "$tree_oss" | grep -E "^($ENT_CRATES) " | tr '\n' ' ')"
else
  ok "no enterprise crate in the OSS dependency closure — nothing to meter with"
fi

# --------------------------------------------- T40 (self-hosted Enterprise) --
section "T40 — self-hosted Enterprise: --features enterprise, NOT cloud"

if cargo check -p "$PKG" --features enterprise --message-format=short >/dev/null 2>&1; then
  ok "compiles"
else
  bad "compiles"
  cargo check -p "$PKG" --features enterprise --message-format=short 2>&1 | tail -30
fi

# §8.1: `cloud` ⇒ `enterprise`, never the reverse. A self-hosted Enterprise
# build must not switch o2_enterprise's own `cloud` feature on — if it did, the
# emit would fire on every customer's own cluster and write synthetics usage
# rows onto someone else's disk.
tree_ent=$(cargo tree -p "$PKG" --features enterprise -e normal --prefix none -f '{p} {f}' 2>/dev/null)
if [ -z "$tree_ent" ]; then
  bad "cargo tree (enterprise) produced no output"
else
  ent_line=$(printf '%s\n' "$tree_ent" | grep -E '^o2_enterprise ' | head -1)
  # EXACT feature-name match, not a substring of the line. `-f '{p} {f}'` renders
  # `name vX.Y.Z (/path) feat1,feat2`, so a plain `grep cloud` over the line fires
  # on any checkout path or version string that merely contains "cloud" — and the
  # o2_enterprise dep is a path dependency, so the path is always on the line.
  # The feature list is the last field and never contains a space.
  ent_feats=$(printf '%s\n' "$ent_line" | awk '{print $NF}')
  if [ -z "$ent_line" ]; then
    bad "the enterprise build does not pull o2_enterprise at all — the feature is miswired"
  elif printf '%s' "$ent_feats" | tr ',' '\n' | grep -qx 'cloud'; then
    bad "enterprise build enables o2_enterprise/cloud: $ent_line"
  else
    ok "o2_enterprise present without its \`cloud\` feature"
  fi
fi

# Source-level guard on the emit itself. Coarse by design — per FILE, not per call site, since
# a per-site cfg check needs a parser. Catches F6 with the cfg simply forgotten.
missing=""
for f in $(grep -rlE "$EMIT_IDENTS" --include='*.rs' "$SRC" 2>/dev/null); do
  grep -q 'feature = "cloud"' "$f" || missing="$missing $f"
done
found=$(grep -rlE "$EMIT_IDENTS" --include='*.rs' "$SRC" 2>/dev/null | wc -l | tr -d ' ')
if [ -n "$missing" ]; then
  bad "metering identifiers in file(s) with no cloud cfg:$missing"
elif [ "$found" = "0" ]; then
  ok "no file names a metering identifier yet — this assertion is INERT until item 1.10"
else
  ok "all $found file(s) naming a metering identifier also carry a \`cloud\` cfg"
fi

# ------------------------------------------------- cloud shape (the diff) ----
# The shape that actually type-checks the trial gate: without it the script passes while the
# gate contains type errors. --all-targets so the gate's tests are checked too.
section "cloud — the shape the trial gate compiles in"

if cargo check -p "$PKG" --all-targets --features cloud --message-format=short >/dev/null 2>&1; then
  ok "compiles (--features cloud, --all-targets)"
else
  bad "compiles (--features cloud, --all-targets)"
  cargo check -p "$PKG" --all-targets --features cloud --message-format=short 2>&1 | tail -30
fi

# `cloud` ⇒ `enterprise` (§8.1). The mirror of the T40 assertion: there the
# feature must be absent, here it must be present, and both use the same exact
# field match rather than a substring.
tree_cloud=$(cargo tree -p "$PKG" --features cloud -e normal --prefix none -f '{p} {f}' 2>/dev/null)
cloud_line=$(printf '%s\n' "$tree_cloud" | grep -E '^o2_enterprise ' | head -1)
cloud_feats=$(printf '%s\n' "$cloud_line" | awk '{print $NF}')
if [ -z "$cloud_line" ]; then
  bad "the cloud build does not pull o2_enterprise at all"
elif printf '%s' "$cloud_feats" | tr ',' '\n' | grep -qx 'cloud'; then
  ok "o2_enterprise carries its \`cloud\` feature"
else
  bad "cloud build does NOT enable o2_enterprise/cloud — the gate would compile to nothing: $cloud_line"
fi

# --------------------------------------------------------- T39 (opt-in) ------
# The assertion itself is `const _: () = assert!(...)` in src/jobs/src/lib.rs
# and src/api/management/src/lib.rs — it fires during THEIR compile, so the only
# way to exercise it is to compile them. Both are large leaf crates, hence
# opt-in rather than part of the default run.
if [ "${BUILD_SHAPES_T39:-0}" = "1" ]; then
  section "T39 — cloud reaches openobserve-synthetics (compile-time)"
  for p in openobserve-jobs openobserve-api-management; do
    if cargo check -p "$p" --features cloud --message-format=short >/dev/null 2>&1; then
      ok "$p --features cloud"
    else
      bad "$p --features cloud (F6 guard, or an unrelated build error)"
      cargo check -p "$p" --features cloud --message-format=short 2>&1 | grep -A5 BUILT_WITH_CLOUD | head -20
    fi
  done
else
  section "T39 — skipped (set BUILD_SHAPES_T39=1 to run; multi-minute)"
fi

printf '\n'
if [ "$fails" -eq 0 ]; then
  echo "build shapes: all checks passed"
  exit 0
fi
echo "build shapes: $fails check(s) failed"
exit 1
