#!/usr/bin/env python3
"""Guardian Verify Phase: Check all pre-upgrade and post-upgrade entities still exist."""

import os
import sys
import json
from pathlib import Path
import requests
from requests.auth import HTTPBasicAuth
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL", "root@example.com")
PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD", "changeme")

# Determine which state file to use (pre or post)
phase = sys.argv[1] if len(sys.argv) > 1 else "pre"
state_file = Path(__file__).parent / f"devcluster2_default_{phase}_state.json"
with open(state_file) as f:
    state = json.load(f)

BASE_URL = state["base_url"]
ORG_ID = state["org_id"]
s = requests.Session()
s.auth = HTTPBasicAuth(EMAIL, PASSWORD)
s.verify = False

print(f"[GUARDIAN] Verify Phase - The Vigil")
print(f"[GUARDIAN] Env: {state['env']} | Org: {ORG_ID}")
print(f"[GUARDIAN] Suffix: {state['suffix']} | Created: {state['created_at']}")
if state.get("enriched_at"):
    print(f"[GUARDIAN] Enriched: {state['enriched_at']} (suffix: {state.get('enrichment_suffix')})")
print()

results = {}
total_ok, total_fail = 0, 0

def check(label, url, expected_status=200):
    resp = s.get(url)
    ok = resp.status_code == expected_status
    return ok, resp.status_code, resp.text[:200]

# 1. Templates
print("[1] Templates...")
ok, fail = 0, 0
for name in state["entities"].get("templates", []):
    r_ok, code, _ = check(name, f"{BASE_URL}api/{ORG_ID}/alerts/templates/{name}")
    if r_ok: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name} (HTTP {code})")
results["templates"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 2. Destinations
print("[2] Destinations...")
ok, fail = 0, 0
for name in state["entities"].get("destinations", []):
    r_ok, code, _ = check(name, f"{BASE_URL}api/{ORG_ID}/alerts/destinations/{name}")
    if r_ok: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name} (HTTP {code})")
results["destinations"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 3. Functions
print("[3] Functions...")
ok, fail = 0, 0
for name in state["entities"].get("functions", []):
    r_ok, code, _ = check(name, f"{BASE_URL}api/{ORG_ID}/functions/{name}")
    if r_ok: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name} (HTTP {code})")
results["functions"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 4. Pipelines (check via list API)
print("[4] Pipelines...")
ok, fail = 0, 0
resp = s.get(f"{BASE_URL}api/{ORG_ID}/pipelines")
pl_list = resp.json().get("list", []) if resp.status_code == 200 else []
pl_names = {p["name"] for p in pl_list}
for entry in state["entities"].get("pipelines", []):
    name = entry["name"]
    if name in pl_names: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name}")
results["pipelines"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 5. Enrichments (check via list API)
print("[5] Enrichments...")
ok, fail = 0, 0
resp = s.get(f"{BASE_URL}api/{ORG_ID}/streams?type=enrichment_tables")
et_list = resp.json().get("list", []) if resp.status_code == 200 else []
et_names = {e.get("name", "") for e in et_list}
for name in state["entities"].get("enrichments", []):
    if name in et_names: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name}")
results["enrichments"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 6. Alert Folders (check via list API)
print("[6] Alert Folders...")
ok, fail = 0, 0
resp = s.get(f"{BASE_URL}api/v2/{ORG_ID}/folders/alerts")
af_list = resp.json().get("list", []) if resp.status_code == 200 else []
af_ids = {f["folderId"] for f in af_list}
# Regular alert folders
for entry in state["entities"].get("alert_folders", []):
    if entry["folder_id"] in af_ids: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
# Extra alert folder
for entry in state["entities"].get("alert_folder_extra", []):
    if entry["folder_id"] in af_ids: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alert_folders"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 7. Dashboard Folders (check via list API)
print("[7] Dashboard Folders...")
ok, fail = 0, 0
resp = s.get(f"{BASE_URL}api/v2/{ORG_ID}/folders/dashboards")
df_list = resp.json().get("list", []) if resp.status_code == 200 else []
df_ids = {f["folderId"] for f in df_list}
for entry in state["entities"].get("dashboard_folders", []):
    if entry["folder_id"] in df_ids: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["dashboard_folders"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 8. VRL Alerts no-trigger (check via list API by folder)
print("[8] VRL Alerts (no-trigger)...")
ok, fail = 0, 0
for entry in state["entities"].get("alerts_vrl_no_trigger", []):
    fid = entry["folder_id"]
    resp = s.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts?folder={fid}")
    alist = resp.json().get("list", []) if resp.status_code == 200 else []
    a_names = {a["name"] for a in alist}
    if entry["name"] in a_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_vrl_no_trigger"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 9. VRL Alerts trigger
print("[9] VRL Alerts (trigger)...")
ok, fail = 0, 0
for entry in state["entities"].get("alerts_vrl_trigger", []):
    fid = entry["folder_id"]
    resp = s.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts?folder={fid}")
    alist = resp.json().get("list", []) if resp.status_code == 200 else []
    a_names = {a["name"] for a in alist}
    if entry["name"] in a_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_vrl_trigger"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 10. Multi Time Range Alerts
print("[10] Multi Time Range Alerts...")
ok, fail = 0, 0
for entry in state["entities"].get("alerts_multi_time_range", []):
    fid = entry["folder_id"]
    resp = s.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts?folder={fid}")
    alist = resp.json().get("list", []) if resp.status_code == 200 else []
    a_names = {a["name"] for a in alist}
    if entry["name"] in a_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_multi_time_range"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 11. Dashboards (check by ID)
print("[11] Dashboards...")
ok, fail = 0, 0
for entry in state["entities"].get("dashboards", []):
    fid = entry["folder_id"]
    did = entry["dashboard_id"]
    r_ok, code, _ = check(entry["name"], f"{BASE_URL}api/{ORG_ID}/dashboards/{did}?folder={fid}")
    if r_ok: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']} (HTTP {code})")
results["dashboards"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 12. Time Shift Dashboards
print("[12] Time Shift Dashboards...")
ok, fail = 0, 0
for entry in state["entities"].get("dashboards_time_shift", []):
    fid = entry["folder_id"]
    did = entry["dashboard_id"]
    r_ok, code, _ = check(entry["name"], f"{BASE_URL}api/{ORG_ID}/dashboards/{did}?folder={fid}")
    if r_ok: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']} (HTTP {code})")
results["dashboards_time_shift"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 13. Saved Views (check via list API)
print("[13] Saved Views...")
ok, fail = 0, 0
resp = s.get(f"{BASE_URL}api/{ORG_ID}/savedviews")
sv_data = resp.json() if resp.status_code == 200 else {}
sv_items = sv_data.get("views", [])
sv_names = {v.get("view_name", "") for v in sv_items}
for entry in state["entities"].get("saved_views", []):
    if entry["name"] in sv_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["saved_views"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# --- NEW ENTITY TYPES ---

# 14. Slack Templates
print("[14] Slack Templates...")
ok, fail = 0, 0
for name in state["entities"].get("slack_template", []) + state["entities"].get("templates_slack", []):
    if not name: continue
    r_ok, code, _ = check(name, f"{BASE_URL}api/{ORG_ID}/alerts/templates/{name}")
    if r_ok: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name} (HTTP {code})")
results["slack_templates"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 15. Email Templates
print("[15] Email Templates...")
ok, fail = 0, 0
for name in state["entities"].get("email_template", []) + state["entities"].get("templates_email", []):
    if not name: continue
    r_ok, code, _ = check(name, f"{BASE_URL}api/{ORG_ID}/alerts/templates/{name}")
    if r_ok: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name} (HTTP {code})")
results["email_templates"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 16. Slack Destinations
print("[16] Slack Destinations...")
ok, fail = 0, 0
for name in state["entities"].get("slack_destination", []) + state["entities"].get("destinations_slack", []):
    if not name: continue
    r_ok, code, _ = check(name, f"{BASE_URL}api/{ORG_ID}/alerts/destinations/{name}")
    if r_ok: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name} (HTTP {code})")
results["slack_destinations"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 17. Email Destinations
print("[17] Email Destinations...")
ok, fail = 0, 0
for name in state["entities"].get("email_destination", []) + state["entities"].get("destinations_email", []):
    if not name: continue
    r_ok, code, _ = check(name, f"{BASE_URL}api/{ORG_ID}/alerts/destinations/{name}")
    if r_ok: ok += 1; print(f"  [OK] {name}")
    else: fail += 1; print(f"  [FAIL] {name} (HTTP {code})")
results["email_destinations"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 18. Standard Alerts (check via list API by name)
print("[18] Standard Alerts...")
ok, fail = 0, 0
resp = s.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts")
all_alerts = resp.json().get("list", []) if resp.status_code == 200 else []
all_alert_names = {a["name"] for a in all_alerts}
for entry in state["entities"].get("alerts_standard", []):
    if entry["name"] in all_alert_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_standard"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 19. SQL Alerts
print("[19] SQL Alerts...")
ok, fail = 0, 0
for entry in state["entities"].get("alerts_sql", []):
    if entry["name"] in all_alert_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_sql"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 20. Real-Time Alerts
print("[20] Real-Time Alerts...")
ok, fail = 0, 0
for entry in state["entities"].get("alerts_realtime", []):
    if entry["name"] in all_alert_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_realtime"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 21. Cron Alerts
print("[21] Cron Alerts...")
ok, fail = 0, 0
for entry in state["entities"].get("alerts_cron", []):
    if entry["name"] in all_alert_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_cron"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 22. Timezone Alerts
print("[22] Timezone Alerts...")
ok, fail = 0, 0
for entry in state["entities"].get("alerts_timezone", []):
    if entry["name"] in all_alert_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["alerts_timezone"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# 23. Reports — Scheduled & Cached (check via list API)
print("[23] Reports...")
ok, fail = 0, 0
resp = s.get(f"{BASE_URL}api/{ORG_ID}/reports")
report_list = resp.json() if resp.status_code == 200 else []
report_names = {r.get("name", "") for r in report_list}
for entry in state["entities"].get("reports_scheduled", []):
    if entry["name"] in report_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
for entry in state["entities"].get("reports_cached", []):
    if entry["name"] in report_names: ok += 1; print(f"  [OK] {entry['name']}")
    else: fail += 1; print(f"  [FAIL] {entry['name']}")
results["reports"] = f"{ok}/{ok+fail}"; total_ok += ok; total_fail += fail

# Summary
print()
print("=" * 60)
print("VERIFICATION RESULTS")
print("=" * 60)
for label, result in results.items():
    print(f"  {label}: {result}")
print(f"  ---")
print(f"  TOTAL: {total_ok}/{total_ok + total_fail} entities verified")
if total_fail == 0:
    print("  VERDICT: ALL ENTITIES SURVIVED ✅")
else:
    print(f"  VERDICT: {total_fail} ENTITIES LOST ❌")
print("=" * 60)
