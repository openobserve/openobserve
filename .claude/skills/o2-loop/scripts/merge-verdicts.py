#!/usr/bin/env python3
"""Merge a codex and a claude verdict for one round into one verdict on stdout: argv = <round> <codex.json> <claude.json> [<ledger>]."""
import json
import os
import sys

SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
PREFIX = {"codex": "CX", "claude": "CL"}
NEAR_LINES = 3


def load(path):
    with open(path) as f:
        return json.load(f)


def renumber(findings, backend, rnd):
    out = []
    for i, f in enumerate(findings, 1):
        g = dict(f)
        g["id"] = f"{PREFIX[backend]}{rnd}-{i}"
        g["sources"] = [backend]
        out.append(g)
    return out


def same_issue(a, b):
    if a.get("repo") != b.get("repo") or a.get("file") != b.get("file") or a.get("category") != b.get("category"):
        return False
    la, lb = a.get("line"), b.get("line")
    if la is None or lb is None:
        return la is None and lb is None
    return abs(la - lb) <= NEAR_LINES


def merge_pair(primary, other):
    """Keep the more severe finding's id and location; carry both descriptions and both ids."""
    if SEVERITY_RANK[other["severity"]] < SEVERITY_RANK[primary["severity"]]:
        primary, other = other, primary
    m = dict(primary)
    m["sources"] = sorted(set(primary["sources"]) | set(other["sources"]))
    m["also_reported_as"] = other["id"]
    m["title"] = f"{primary['title']} / {other['title']}"
    m["detail"] = f"{primary['sources'][0]}: {primary['detail']}\n\n{other['sources'][0]}: {other['detail']}"
    m["suggestion"] = f"{primary['sources'][0]}: {primary['suggestion']}\n\n{other['sources'][0]}: {other['suggestion']}"
    return m


def merge_findings(codex, claude):
    merged = list(codex)
    for c in claude:
        for i, m in enumerate(merged):
            if "claude" not in m["sources"] and same_issue(m, c):
                merged[i] = merge_pair(m, c)
                break
        else:
            merged.append(c)
    return merged


def alias_map(ledger, rnd):
    """also_reported_as -> canonical id, from every earlier round's merged verdict in the ledger."""
    aliases = {}
    if not ledger:
        return aliases
    for r in range(1, rnd):
        path = os.path.join(ledger, f"round-{r}", "verdict.json")
        if not os.path.exists(path):
            continue
        for f in load(path).get("findings", []):
            if f.get("also_reported_as"):
                aliases[f["also_reported_as"]] = f["id"]
    return aliases


def merge_prior(codex, claude, aliases):
    """A prior finding closes only when both reviewers examined it and neither still sees it; one vote keeps it open."""
    by_id = {}
    for backend, items in (("codex", codex), ("claude", claude)):
        for p in items:
            by_id.setdefault(aliases.get(p["id"], p["id"]), {})[backend] = p
    out = []
    for fid, votes in by_id.items():
        statuses = {v["status"] for v in votes.values()}
        missing = [b for b in ("codex", "claude") if b not in votes]
        if "still_open" in statuses or missing:
            status = "still_open"
        elif "resolved" in statuses:
            status = "resolved"
        else:
            status = "withdrawn"
        note = " | ".join(f"{b}: {v['note']}" for b, v in votes.items())
        if missing:
            note += f" | not verified by {', '.join(missing)}; stays open"
        out.append({"id": fid, "status": status, "note": note, "sources": sorted(votes)})
    return out


def main():
    rnd = int(sys.argv[1])
    codex, claude = load(sys.argv[2]), load(sys.argv[3])
    findings = merge_findings(renumber(codex["findings"], "codex", rnd), renumber(claude["findings"], "claude", rnd))
    ledger = sys.argv[4] if len(sys.argv) > 4 else None
    prior = merge_prior(codex["prior_findings"], claude["prior_findings"], alias_map(ledger, rnd))
    verdict = "approve" if codex["verdict"] == "approve" and claude["verdict"] == "approve" else "request_changes"
    out = {
        "verdict": verdict,
        "summary": f"codex ({codex['verdict']}): {codex['summary']} | claude ({claude['verdict']}): {claude['summary']}",
        "findings": findings,
        "prior_findings": prior,
        "backends": {"codex": codex["verdict"], "claude": claude["verdict"]},
    }
    json.dump(out, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
