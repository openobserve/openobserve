#!/usr/bin/env python3
"""Fallback re-sync for OpenObserve CI metrics. Runs on a schedule and re-posts the last
LOOKBACK_DAYS of runs for THIS repo's test workflows, tagged ingest_source="backfill".

The live report jobs are the happy path (ingest_source="live"); this catches any run whose
live emit was missed (skipped job, ingest blip, etc.). Dashboards dedup by run_id keeping the
latest attempt and PREFER the live doc, so a backfill row only "wins" when live truly missed —
which makes the live-vs-fallback split visible.

Env: GITHUB_REPOSITORY, GH_TOKEN, O2_REPORTING_INGEST_BASE, O2_REPORTING_AUTH,
     O2_REPORTING_INSECURE (opt), LOOKBACK_DAYS (default 2), GITHUB_API_URL (opt).
Never raises fatally — best-effort.
"""
import os, json, ssl, base64, urllib.request, urllib.error, time
from datetime import datetime, timezone, timedelta

REPO = os.environ.get("GITHUB_REPOSITORY", "")
GH_TOKEN = os.environ.get("GH_TOKEN", "")
BASE = os.environ.get("O2_REPORTING_INGEST_BASE", "")
AUTH = os.environ.get("O2_REPORTING_AUTH", "")
API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
DAYS = int(os.environ.get("LOOKBACK_DAYS", "2"))
CTX = ssl.create_default_context()
if os.environ.get("O2_REPORTING_INSECURE", "") == "true":
    CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE

# (workflow file, stream, suite, is_regression)
TARGETS = [
    ("playwright.yml", "ci_test_runs", "ui", False),
    ("api-testing.yml", "ci_test_runs", "api", False),
    ("playwright_regression.yml", "ci_regression", "regression", True),
]

def gh(path):
    req = urllib.request.Request(f"{API}/{path}", headers={
        "Authorization": f"token {GH_TOKEN}", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"  gh error {path}: {str(e)[:80]}"); return {}

def ep(ts):
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() if ts else None

def wall(jobs):
    pts = [(ep(j.get("started_at")), ep(j.get("completed_at"))) for j in jobs
           if j.get("started_at") and j.get("completed_at")]
    if not pts: return 0
    d = round(max(b for _, b in pts) - min(a for a, _ in pts))
    return d if d >= 0 else 0

def jdur(j):
    if j.get("conclusion") in ("skipped", "cancelled", None): return None
    a, b = ep(j.get("started_at")), ep(j.get("completed_at"))
    if a is None or b is None: return None
    d = round(b - a); return d if d >= 0 else None

def reconstruct(run, suite, is_reg):
    rid, att = run["id"], run.get("run_attempt", 1)
    jobs = gh(f"repos/{REPO}/actions/runs/{rid}/attempts/{att}/jobs?per_page=100").get("jobs", [])
    final = wall(jobs)
    total = final
    for n in range(1, att):
        total += wall(gh(f"repos/{REPO}/actions/runs/{rid}/attempts/{n}/jobs?per_page=100").get("jobs", []))
    started = ep(run.get("run_started_at") or run.get("created_at"))
    prs = run.get("pull_requests") or []
    doc = {
        "_timestamp": int((started or time.time()) * 1_000_000),
        "ingest_source": "backfill",
        "workflow": "regression" if is_reg else "test",
        "suite": suite, "repo": REPO,
        "run_id": str(rid), "run_attempt": att,
        "retries": att - 1, "was_retried": att > 1,
        "conclusion": run.get("conclusion"),
        "trigger": run.get("event"),
        "author": (run.get("actor") or {}).get("login"),
        "branch": run.get("head_branch"),
        "commit_sha": (run.get("head_sha") or "")[:12],
        "pr_number": (prs[0]["number"] if prs else None),
        "run_url": run.get("html_url"),
        "final_duration_sec": final, "total_duration_sec": total,
        "retry_wasted_sec": total - final,
    }
    if is_reg:
        sh = [j for j in jobs if j.get("name", "").startswith("e2e /")]
        bj = [j for j in jobs if j.get("name") == "build_binary"]
        doc.update({
            "build_duration_sec": (jdur(bj[0]) if bj else None),
            "shards_total": len(sh),
            "shards_passed": sum(1 for j in sh if j.get("conclusion") == "success"),
            "shards_failed": sum(1 for j in sh if j.get("conclusion") == "failure"),
            "shards_skipped": sum(1 for j in sh if j.get("conclusion") in ("skipped", "cancelled")),
            "shards": [{"name": j["name"], "conclusion": j.get("conclusion"), "duration_sec": jdur(j)} for j in sh],
            "tests_total": None, "tests_passed": None, "tests_failed": None, "tests_flaky": None, "tests_skipped": None,
        })
    return doc

def post(stream, docs):
    if not docs: return 0
    url = f"{BASE.rstrip('/')}/{stream}/_json"
    hdr = {"Authorization": "Basic " + base64.b64encode(AUTH.encode()).decode(), "Content-Type": "application/json"}
    ok = 0
    for k in range(0, len(docs), 200):
        chunk = docs[k:k+200]
        for a in range(4):
            try:
                req = urllib.request.Request(url, data=json.dumps(chunk).encode(), headers=hdr, method="POST")
                with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
                    ok += json.loads(r.read().decode()).get("status", [{}])[0].get("successful", 0)
                break
            except Exception as e:
                if a == 3: print(f"  ingest error: {str(e)[:80]}")
                else: time.sleep(2 * (a + 1))
    return ok

def main():
    if not (REPO and GH_TOKEN and BASE and AUTH):
        print("::notice::missing env (repo/token/O2_REPORTING_*) — skipping re-sync"); return
    since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).strftime("%Y-%m-%d")
    grand = 0
    for wf, stream, suite, is_reg in TARGETS:
        runs = gh(f"repos/{REPO}/actions/workflows/{wf}/runs?created=%3E%3D{since}&per_page=100").get("workflow_runs", [])
        runs = [r for r in runs if r.get("status") == "completed"]
        docs = [reconstruct(r, suite, is_reg) for r in runs]
        n = post(stream, docs); grand += n
        print(f"{wf:<26} -> {stream} ({suite}): {len(docs)} runs, ingested {n}")
    print(f"TOTAL re-synced: {grand}")

if __name__ == "__main__":
    main()
