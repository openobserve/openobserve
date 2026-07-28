#!/usr/bin/env python3
"""Enforce the module layering inside src/core.

`openobserve-core` is being broken up into per-domain crates so that api/ and jobs/ can depend on
the services they actually use instead of one 70k-line crate. Rust crates cannot be mutually
recursive, so before any module can move out, the reference graph inside core has to be a DAG that
respects the intended crate boundaries.

This script assigns every top-level module in src/core/src to a target layer and fails if a module
references something in a layer at or above its own. Run it from the repo root:

    python3 scripts/check_core_layering.py

Exit status is 1 when a violation is found, and the offending file, symbol and layer are printed.
When a new module is added to src/core/src it must be given a layer here, otherwise the script
fails as well -- that is deliberate, the layer is a design decision and should not default.
"""

import os
import re
import sys
from collections import defaultdict

BASE = os.path.join("src", "core", "src")

# Lowest first. A module may only reference modules in a strictly lower layer.
LAYERS = ["sink", "identity", "alerting", "ingest", "dashboards", "admin", "top"]
RANK = {name: i for i, name in enumerate(LAYERS)}

# Modules that carry no internal dependencies and everything else may use.
SINK = {
    "backfill_cleanup",
    "cloud_events",
    "error_suggest",
    "functions_cache",
    "http_error",
    "ingestion_tokens",
    "kv",
    "ofga",
    "service",
    "service_graph_query",
    "session",
    "short_url",
    "stream_utils",
    "system_settings",
    "trial_quota",
    "usage_search",
}
IDENTITY = {"auth", "authz", "organization", "providers", "users"}
ALERTING = {"alerts", "workflows"}
INGEST = {
    "ingestion",
    "llm_evaluations",
    "logs",
    "metadata",
    "metrics",
    "pipeline",
    "traces",
    "workflow_execution",
}
DASHBOARDS = {"dashboards"}
# Everything that composes the domains above: schedulers, cleanup jobs, reporting.
ADMIN = {
    "anomaly_detection",
    "bootstrap",
    "functions",
    "org_cleanup",
    "org_summary",
    "org_usage",
    "ratelimit",
    "self_reporting",
    "stream",
    "synthetics",
}
# Reaches into every domain; nothing inside the crate may depend on it.
TOP = {"http"}

# `alerts` is split across two layers: the scheduler half drives pipelines and dashboards, so it
# sits in admin, while alert evaluation, incidents and notification stay down in alerting.
ALERTS_ADMIN_SUBMODULES = {"scheduler", "backfill"}


def layer_of(top: str, sub: str) -> str:
    if top in SINK:
        return "sink"
    if top in IDENTITY:
        return "identity"
    if top == "alerts":
        return "admin" if sub in ALERTS_ADMIN_SUBMODULES else "alerting"
    if top in ALERTING:
        return "alerting"
    if top in INGEST:
        return "ingest"
    if top in DASHBOARDS:
        return "dashboards"
    if top in ADMIN:
        return "admin"
    if top in TOP:
        return "top"
    raise KeyError(top)


def strip_comments_and_strings(src: str) -> str:
    """Blank out // and /* */ comments so doc references are not treated as dependencies."""
    out = []
    i, n = 0, len(src)
    in_str = in_block = in_line = False
    while i < n:
        c = src[i]
        if in_line:
            if c == "\n":
                in_line = False
                out.append(c)
            i += 1
        elif in_block:
            if c == "*" and i + 1 < n and src[i + 1] == "/":
                in_block = False
                i += 2
                continue
            if c == "\n":
                out.append(c)
            i += 1
        elif in_str:
            out.append(c)
            if c == "\\":
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
        elif c == "/" and i + 1 < n and src[i + 1] == "/":
            in_line = True
            i += 2
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            in_block = True
            i += 2
        else:
            if c == '"':
                in_str = True
            out.append(c)
            i += 1
    return "".join(out)


def module_path(path: str):
    rel = os.path.relpath(path, BASE)
    parts = rel[:-3].split(os.sep)
    if parts[-1] == "mod":
        parts = parts[:-1]
    return parts


def group_items(text: str, i: int):
    """text[i] == '{' -> the comma-separated items at brace depth 1."""
    depth, j, cur, items = 1, i + 1, "", []
    while j < len(text) and depth > 0:
        ch = text[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                items.append(cur)
                break
        if depth == 1 and ch == ",":
            items.append(cur)
            cur = ""
        elif not (depth == 1 and ch == ","):
            cur += ch
        j += 1
    return items


def first_two_idents(s: str):
    m = re.match(r"([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)", s.strip())
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"([A-Za-z_]\w*)", s.strip())
    return (m.group(1), "") if m else None


def references(path: str, modules):
    """Top-level modules referenced from `path`, via `crate::` or a root-reaching `super::`."""
    src = strip_comments_and_strings(open(path, encoding="utf8", errors="ignore").read())
    depth = len(module_path(path))
    found = []

    def scan(i):
        if i < len(src) and src[i] == "{":
            for item in group_items(src, i):
                pair = first_two_idents(item)
                if pair:
                    found.append(pair)
        else:
            pair = first_two_idents(src[i:])
            if pair:
                found.append(pair)

    for m in re.finditer(r"\bcrate::", src):
        scan(m.end())
    # `super::` only reaches the crate root when it climbs out of every enclosing module.
    for m in re.finditer(r"\b((?:super::)+)", src):
        if depth - m.group(1).count("super::") == 0:
            scan(m.end())

    return [(t, s) for (t, s) in found if t in modules]


def main() -> int:
    if not os.path.isdir(BASE):
        print(f"error: {BASE} not found; run from the repository root", file=sys.stderr)
        return 2

    modules = set()
    for entry in os.listdir(BASE):
        full = os.path.join(BASE, entry)
        if os.path.isdir(full):
            modules.add(entry)
        elif entry.endswith(".rs") and entry != "lib.rs":
            modules.add(entry[:-3])

    known = SINK | IDENTITY | ALERTING | INGEST | DASHBOARDS | ADMIN | TOP
    unassigned = modules - known
    if unassigned:
        print("error: these src/core/src modules have no layer assigned in this script:")
        for name in sorted(unassigned):
            print(f"    {name}")
        print("\nAdd each one to the appropriate set at the top of the file.")
        return 1

    violations = defaultdict(list)
    for root, _, files in os.walk(BASE):
        for fname in sorted(files):
            if not fname.endswith(".rs"):
                continue
            path = os.path.join(root, fname)
            parts = module_path(path)
            # lib.rs only declares the modules; it is above all of them by construction.
            if not parts or parts == ["lib"]:
                continue
            src_layer = layer_of(parts[0], parts[1] if len(parts) > 1 else "")
            for target, sub in references(path, modules):
                dst_layer = layer_of(target, sub)
                if src_layer == dst_layer or RANK[dst_layer] < RANK[src_layer]:
                    continue
                rel = os.path.relpath(path, BASE)
                violations[(src_layer, dst_layer)].append((rel, f"{target}::{sub}"))

    if not violations:
        print(f"core layering OK ({' < '.join(LAYERS)})")
        return 0

    total = sum(len(v) for v in violations.values())
    print(f"core layering violated: {total} reference(s)\n")
    print(f"layer order is {' < '.join(LAYERS)}; a module may only use lower layers\n")
    for (src_layer, dst_layer), items in sorted(violations.items(), key=lambda kv: -len(kv[1])):
        print(f"  {src_layer} -> {dst_layer}")
        for rel, symbol in sorted(set(items)):
            print(f"      {rel}: {symbol}")
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
