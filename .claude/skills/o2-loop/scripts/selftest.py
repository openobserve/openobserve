#!/usr/bin/env python3
"""Regression cases for loop-state.py's decide(); exits non-zero on the first failure."""
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


def finding(fid, sev="medium", cat="correctness", repo="r", file="f", line=1, **extra):
    f = {"id": fid, "severity": sev, "category": cat, "repo": repo, "file": file, "line": line, "title": fid, "detail": "d", "suggestion": "s"}
    f.update(extra)
    return f


def rnd(n, verdict=None, response=None, evidence=True, commit="c1", paired=()):
    return {"n": n, "dir": "", "evidence": evidence, "commit": commit, "verdict": verdict, "response": response, "paired": list(paired)}


def check(name, got, want):
    if got != want:
        print(f"FAIL {name}: got {got!r}, want {want!r}")
        sys.exit(1)
    print(f"ok   {name}")


def action(rounds, cap=5, head="c1", clean=True):
    reg = LS.finding_registry(rounds)
    return LS.decide(rounds, reg, cap, head, clean)[0]


def test_state_machine():
    rc = {"verdict": "request_changes", "summary": "", "findings": [finding("F1", "high")], "prior_findings": []}
    check("no rounds", action([]), "start")
    check("round 1 without evidence", action([rnd(1, evidence=False)]), "evidence")
    check("round 1 without verdict", action([rnd(1)]), "review")
    check("verdict without response", action([rnd(1, rc)]), "respond")
    check("prepared round 2 does not hide respond", action([rnd(1, rc), rnd(2)]), "respond")
    check("cap before respond when not approved", action([rnd(1, rc), rnd(2)], cap=1), "cap")
    resp = {"responses": [{"id": "F1", "action": "fix"}], "open_items": []}
    check("response counts as answered", action([rnd(1, rc, resp), rnd(2)]), "review")
    check("responded but at cap", action([rnd(1, rc, resp)], cap=1), "cap")
    check("responded, next round not prepared", action([rnd(1, rc, resp)]), "next")
    check("responded, next round dir without evidence", action([rnd(1, rc, resp), rnd(2, evidence=False)]), "evidence")
    ap = {"verdict": "approve", "summary": "", "findings": [finding("F2", "low", "other")], "prior_findings": []}
    deferred = {"responses": [{"id": "F2", "action": "defer"}], "open_items": []}
    check("approve with deferred low is agreed", action([rnd(1, ap, deferred), rnd(2)]), "agreed")
    check("approve with deferred low but dirty tree is not agreed", action([rnd(1, ap, deferred)], clean=False), "next")
    check("approve with deferred low but moved HEAD is not agreed", action([rnd(1, ap, deferred)], head="c2"), "next")
    fixed_low = {"responses": [{"id": "F2", "action": "fix"}], "open_items": []}
    check("approve with a fixed low needs another round", action([rnd(1, ap, fixed_low)]), "next")
    open_items = {"responses": [{"id": "F2", "action": "defer"}], "open_items": ["unsure"]}
    check("coder open_items block agreement", action([rnd(1, ap, open_items)]), "next")
    r2 = {"verdict": "approve", "summary": "", "findings": [], "prior_findings": [{"id": "F1", "status": "resolved", "note": ""}]}
    check("resolved prior status closes the finding", action([rnd(1, rc, resp), rnd(2, r2, {"responses": [], "open_items": []}, commit="c2")], head="c2"), "agreed")
    check("approve with no findings needs no coder response", action([rnd(1, rc, resp), rnd(2, r2, commit="c2")], head="c2"), "agreed")
    r2_open = {"verdict": "request_changes", "summary": "", "findings": [], "prior_findings": [{"id": "F1", "status": "still_open", "note": ""}]}
    check("no new findings but a still_open prior needs a response", action([rnd(1, rc, resp), rnd(2, r2_open, commit="c2")], head="c2"), "respond")
    r2_rc = {"verdict": "request_changes", "summary": "", "findings": [], "prior_findings": [{"id": "F1", "status": "resolved", "note": ""}]}
    check("request_changes with nothing open is not agreed", action([rnd(1, rc, resp), rnd(2, r2_rc, commit="c2")], head="c2"), "next")


if __name__ == "__main__":
    test_state_machine()
    print("all selftests passed")
