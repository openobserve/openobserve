#!/usr/bin/env python3
"""Regression cases for loop-state.py's decide() and merge-verdicts.py's merge rules; exits non-zero on the first failure."""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


LS = load_module("loop-state")
MV = load_module("merge-verdicts")


def finding(fid, sev="medium", cat="correctness", repo="r", file="f", line=1, **extra):
    f = {"id": fid, "severity": sev, "category": cat, "repo": repo, "file": file, "line": line, "title": fid, "detail": "d", "suggestion": "s"}
    f.update(extra)
    return f


def rnd(n, verdict=None, response=None, evidence=True, commit="c1", paired=()):
    return {"n": n, "dir": "", "evidence": evidence, "commit": commit, "backend": "codex", "verdict": verdict, "response": response, "paired": list(paired)}


def check(name, got, want):
    if got != want:
        print(f"FAIL {name}: got {got!r}, want {want!r}")
        sys.exit(1)
    print(f"ok   {name}")


def action(rounds, cap=5, head="c1", clean=True):
    reg = LS.finding_registry(rounds)
    return LS.decide(rounds, reg, cap, head, clean)[0]


def test_state_machine():
    rc = {"verdict": "request_changes", "summary": "", "findings": [finding("CX1-1", "high", also_reported_as="CL1-1")], "prior_findings": []}
    check("no rounds", action([]), "start")
    check("round 1 without evidence", action([rnd(1, evidence=False)]), "evidence")
    check("round 1 without verdict", action([rnd(1)]), "review")
    check("verdict without response", action([rnd(1, rc)]), "respond")
    check("prepared round 2 does not hide respond", action([rnd(1, rc), rnd(2)]), "respond")
    check("cap before respond when not approved", action([rnd(1, rc), rnd(2)], cap=1), "cap")
    resp_alias = {"responses": [{"id": "CL1-1", "action": "fix"}], "open_items": []}
    check("alias response counts as answered", action([rnd(1, rc, resp_alias), rnd(2)]), "review")
    check("responded but at cap", action([rnd(1, rc, resp_alias)], cap=1), "cap")
    check("responded, next round not prepared", action([rnd(1, rc, resp_alias)]), "next")
    check("responded, next round dir without evidence", action([rnd(1, rc, resp_alias), rnd(2, evidence=False)]), "evidence")
    ap = {"verdict": "approve", "summary": "", "findings": [finding("CL1-9", "low", "other")], "prior_findings": []}
    deferred = {"responses": [{"id": "CL1-9", "action": "defer"}], "open_items": []}
    check("approve with deferred low is agreed", action([rnd(1, ap, deferred), rnd(2)]), "agreed")
    check("approve with deferred low but dirty tree is not agreed", action([rnd(1, ap, deferred)], clean=False), "next")
    check("approve with deferred low but moved HEAD is not agreed", action([rnd(1, ap, deferred)], head="c2"), "next")
    fixed_low = {"responses": [{"id": "CL1-9", "action": "fix"}], "open_items": []}
    check("approve with a fixed low needs another round", action([rnd(1, ap, fixed_low)]), "next")
    open_items = {"responses": [{"id": "CL1-9", "action": "defer"}], "open_items": ["unsure"]}
    check("coder open_items block agreement", action([rnd(1, ap, open_items)]), "next")
    r2 = {"verdict": "approve", "summary": "", "findings": [], "prior_findings": [{"id": "CL1-1", "status": "resolved", "note": ""}]}
    check("prior status via alias closes the canonical finding", action([rnd(1, rc, resp_alias), rnd(2, r2, {"responses": [], "open_items": []}, commit="c2")], head="c2"), "agreed")


def test_merge():
    a = {"verdict": "approve", "summary": "c", "findings": [finding("F1", "low", "test-coverage", line=100)], "prior_findings": [{"id": "CX1-1", "status": "resolved", "note": "fixed"}]}
    b = {"verdict": "approve", "summary": "l", "findings": [finding("F1", "high", "correctness", line=102)], "prior_findings": []}
    f = MV.merge_findings(MV.renumber(a["findings"], "codex", 2), MV.renumber(b["findings"], "claude", 2))
    check("different categories are not merged", [x["id"] for x in f], ["CX2-1", "CL2-1"])
    b2 = {"findings": [finding("F1", "high", "test-coverage", line=102)]}
    f = MV.merge_findings(MV.renumber(a["findings"], "codex", 2), MV.renumber(b2["findings"], "claude", 2))
    check("same category near lines merge to one", len(f), 1)
    check("merged keeps the higher severity and both sources", (f[0]["severity"], f[0]["sources"], f[0]["also_reported_as"]), ("high", ["claude", "codex"], "CX2-1"))
    p = MV.merge_prior(a["prior_findings"], b["prior_findings"], {})
    check("one vote keeps a prior finding open", p[0]["status"], "still_open")
    both = MV.merge_prior([{"id": "CX1-1", "status": "resolved", "note": ""}], [{"id": "CL1-1", "status": "resolved", "note": ""}], {"CL1-1": "CX1-1"})
    check("alias votes group under the canonical id", [(x["id"], x["status"]) for x in both], [("CX1-1", "resolved")])
    disagree = MV.merge_prior([{"id": "CX1-1", "status": "resolved", "note": ""}], [{"id": "CX1-1", "status": "still_open", "note": ""}], {})
    check("still_open wins over resolved", disagree[0]["status"], "still_open")
    closed = MV.merge_prior([{"id": "CX1-1", "status": "withdrawn", "note": ""}], [{"id": "CX1-1", "status": "withdrawn", "note": ""}], {})
    check("both withdrawn stays withdrawn", closed[0]["status"], "withdrawn")


if __name__ == "__main__":
    test_state_machine()
    test_merge()
    print("all selftests passed")
