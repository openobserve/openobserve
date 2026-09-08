#!/usr/bin/env python3
"""Read an o2-loop ledger and print the loop's state plus the single next action the orchestrator must take."""
import argparse
import json
import os
import subprocess
import sys

BLOCKING = {"critical", "high", "medium"}


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True, check=False).stdout.strip()


def default_ledger():
    common = sh("git", "rev-parse", "--path-format=absolute", "--git-common-dir")
    repo_name = os.path.basename(os.path.dirname(common))
    branch = sh("git", "rev-parse", "--abbrev-ref", "HEAD").replace("/", "-")
    return os.path.join(os.path.expanduser("~"), ".claude", "o2-loop", repo_name, branch)


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def nonempty(path):
    return os.path.exists(path) and os.path.getsize(path) > 0


def merged_response(d):
    """The primary coder's response plus every paired repository's, as one response document."""
    primary = load(os.path.join(d, "coder-response.json"))
    parts = [primary] if primary else []
    also_dir = os.path.join(d, "also")
    if os.path.isdir(also_dir):
        for name in sorted(os.listdir(also_dir)):
            r = load(os.path.join(also_dir, name, "coder-response.json"))
            if r:
                parts.append(r)
    if not parts:
        return None
    return {
        "responses": [a for p in parts for a in p.get("responses", [])],
        "open_items": [i for p in parts for i in (p.get("open_items") or [])],
    }


def paired(d):
    """(name, checkout path, reviewed commit) for each paired repository frozen in this round."""
    out = []
    also_dir = os.path.join(d, "also")
    if os.path.isdir(also_dir):
        for name in sorted(os.listdir(also_dir)):
            out.append((name, read(os.path.join(also_dir, name, "path")), read(os.path.join(also_dir, name, "commit"))))
    return out


def collect(ledger):
    rounds = []
    n = 1
    while os.path.isdir(os.path.join(ledger, f"round-{n}")):
        d = os.path.join(ledger, f"round-{n}")
        rounds.append({
            "n": n,
            "dir": d,
            "evidence": nonempty(os.path.join(d, "evidence.md")),
            "commit": read(os.path.join(d, "commit")),
            "backend": read(os.path.join(d, "backend")),
            "verdict": load(os.path.join(d, "verdict.json")),
            "response": merged_response(d),
            "paired": paired(d),
        })
        n += 1
    return rounds


def finding_registry(rounds):
    """Latest known state of every finding id: severity from the round that reported it, status from the latest mention."""
    reg = {}
    for r in rounds:
        v = r["verdict"]
        if not v:
            continue
        for f in v.get("findings", []):
            reg[f["id"]] = {"severity": f["severity"], "status": "open", "round": r["n"], "title": f.get("title", ""), "repo": f.get("repo", "")}
        for p in v.get("prior_findings", []):
            if p["id"] in reg:
                reg[p["id"]]["status"] = p["status"]
        resp = r["response"]
        if resp:
            for a in resp.get("responses", []):
                if a["id"] in reg:
                    reg[a["id"]]["action"] = a["action"]
    return reg


def decide(rounds, reg, cap, head, clean):
    if not rounds:
        return "start", "no round yet: write spec.md and round-1/evidence.md, then run review.sh --round 1"
    last = rounds[-1]
    n = last["n"]
    if not last["evidence"]:
        return "evidence", f"round {n}: evidence.md missing or empty; the coder must write it before review.sh runs"
    if not last["verdict"]:
        return "review", f"round {n}: no verdict yet; run review.sh --round {n}"
    if not last["response"]:
        return "respond", f"round {n}: verdict present, coder-response.json missing; hand the findings to the coder"
    answered = {a["id"] for a in last["response"].get("responses", [])}
    open_ids = [i for i, f in reg.items() if f["status"] in ("open", "still_open")]
    unanswered = [i for i in open_ids if i not in answered]
    if unanswered:
        return "respond", f"round {n}: findings without a response: {unanswered}"
    blocking = [i for i in open_ids if reg[i]["severity"] in BLOCKING]
    low_not_deferred = [i for i in open_ids if reg[i]["severity"] == "low" and reg[i].get("action") != "defer"]
    open_items = last["response"].get("open_items") or []
    verdict = last["verdict"]["verdict"]
    drift = head != last["commit"] or not clean
    for name, path, commit in last["paired"]:
        if not path or sh("git", "-C", path, "rev-parse", "HEAD") != commit or sh("git", "-C", path, "status", "--porcelain") != "":
            drift = True
    if verdict == "approve" and not blocking and not low_not_deferred and not open_items and not drift:
        return "agreed", f"agreed after {n} rounds; deferred lows: {[i for i in open_ids if reg[i].get('action') == 'defer']}"
    reasons = []
    if verdict != "approve":
        reasons.append(f"verdict {verdict}")
    if blocking:
        reasons.append(f"blocking open: {blocking}")
    if low_not_deferred:
        reasons.append(f"low open and not deferred: {low_not_deferred}")
    if open_items:
        reasons.append(f"coder open_items: {open_items}")
    if drift:
        reasons.append("HEAD or working tree differs from the reviewed commit")
    if n >= cap:
        return "cap", f"round cap {cap} reached with items open ({'; '.join(reasons)}); write the interim report and ask the user"
    return "next", f"start round {n + 1} ({'; '.join(reasons)}): coder fixes, writes evidence.md, then review.sh --round {n + 1}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", default=None)
    ap.add_argument("--cap", type=int, default=5)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    ledger = os.path.realpath(args.ledger or default_ledger())
    rounds = collect(ledger)
    reg = finding_registry(rounds)
    head = sh("git", "rev-parse", "HEAD")
    clean = sh("git", "status", "--porcelain") == ""
    action, why = decide(rounds, reg, args.cap, head, clean)
    state = {
        "ledger": ledger,
        "rounds": [{k: v for k, v in r.items() if k in ("n", "commit", "backend")} | {"verdict": (r["verdict"] or {}).get("verdict"), "responded": bool(r["response"])} for r in rounds],
        "findings": reg,
        "head": head,
        "clean": clean,
        "cap": args.cap,
        "action": action,
        "why": why,
    }
    if args.json:
        print(json.dumps(state, indent=2))
        return
    print(f"ledger: {ledger}")
    for r in state["rounds"]:
        print(f"  round {r['n']}: {r['backend'] or '-'} {r['verdict'] or 'no verdict'} commit {(r['commit'] or '-')[:10]} responded={r['responded']}")
    open_ids = [i for i, f in reg.items() if f["status"] in ("open", "still_open")]
    print(f"open findings: {open_ids or 'none'}")
    for i in open_ids:
        f = reg[i]
        print(f"  {i} [{f['severity']}] {f.get('repo') or '-'} round {f['round']} {f['status']} action={f.get('action', '-')}: {f['title']}")
    print(f"HEAD {head[:10]} clean={clean}")
    for name, path, commit in (rounds[-1]["paired"] if rounds else []):
        print(f"paired {name}: {path} reviewed {(commit or '-')[:10]} HEAD {sh('git', '-C', path, 'rev-parse', 'HEAD')[:10] if path else '-'}")
    print(f"ACTION: {action}")
    print(f"WHY: {why}")


if __name__ == "__main__":
    main()
