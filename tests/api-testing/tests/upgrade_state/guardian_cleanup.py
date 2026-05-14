#!/usr/bin/env python3
"""Guardian Cleanup Phase: Delete all created entities in reverse dependency order."""

import os
import sys
import json
import time
from pathlib import Path
import requests
from requests.auth import HTTPBasicAuth
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL", "root@example.com")
PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD", "changeme")

# Determine which state file to use
phase = sys.argv[1] if len(sys.argv) > 1 else "pre"
state_file = Path(__file__).parent / f"devcluster2_default_{phase}_state.json"

if not state_file.exists():
    print(f"[GUARDIAN] State file not found: {state_file}")
    print(f"[GUARDIAN] Nothing to clean up.")
    sys.exit(0)

with open(state_file) as f:
    state = json.load(f)

BASE_URL = state["base_url"]
ORG_ID = state["org_id"]
SUFFIX = state["suffix"]
ENRICH_SUFFIX = state.get("enrichment_suffix", "")
ENTITIES = state["entities"]

session = requests.Session()
session.auth = HTTPBasicAuth(EMAIL, PASSWORD)
session.verify = False

print(f"[GUARDIAN] Cleanup Phase - The Rest")
print(f"[GUARDIAN] Env: {state['env']} | Org: {ORG_ID}")
print(f"[GUARDIAN] Suffix: {SUFFIX}" + (f" | Enrich: {ENRICH_SUFFIX}" if ENRICH_SUFFIX else ""))
print()

deleted = 0
failed = 0

def delete(label, method, url, **kwargs):
    global deleted, failed
    try:
        resp = method(url, **kwargs)
        if resp.status_code in (200, 204):
            deleted += 1
            print(f"  [OK] {label}")
        elif resp.status_code == 404:
            deleted += 1  # already gone, that's fine
            print(f"  [OK] {label} (already deleted)")
        else:
            failed += 1
            print(f"  [FAIL] {label} (HTTP {resp.status_code}): {resp.text[:100]}")
    except Exception as e:
        failed += 1
        print(f"  [FAIL] {label}: {e}")

# Deletion order: reverse of creation
# Reports → Timezone Alerts → Cron → RT → SQL → Standard → Extra Folder → Email Dest → Slack Dest → Email Tpl → Slack Tpl
# → Saved Views → Time Shift Dash → Dashboards → MTR Alerts → VRL Trigger → VRL No-trigger
# → Dash Folders → Alert Folders → Enrichments → Pipelines → Functions → Destinations → Templates

# 1. Reports (scheduled + cached)
print("[1] Deleting Reports...")
report_names = []
report_names += [r["name"] for r in ENTITIES.get("reports_scheduled", [])]
report_names += [r["name"] for r in ENTITIES.get("reports_cached", [])]
for name in report_names:
    delete(f"report {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/reports/{name}")
print()

# 2. Timezone Alerts
print("[2] Deleting Timezone Alerts...")
for entry in ENTITIES.get("alerts_timezone", []):
    aid = entry.get("alert_id", entry.get("name"))
    extra_folder = ENTITIES.get("alert_folder_extra", [])
    fid = extra_folder[0]["folder_id"] if extra_folder else ""
    delete(f"tz alert {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 3. Cron Alerts
print("[3] Deleting Cron Alerts...")
for entry in ENTITIES.get("alerts_cron", []):
    aid = entry.get("alert_id", entry.get("name"))
    extra_folder = ENTITIES.get("alert_folder_extra", [])
    fid = extra_folder[0]["folder_id"] if extra_folder else ""
    delete(f"cron alert {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 4. Real-Time Alerts
print("[4] Deleting Real-Time Alerts...")
for entry in ENTITIES.get("alerts_realtime", []):
    aid = entry.get("alert_id", entry.get("name"))
    extra_folder = ENTITIES.get("alert_folder_extra", [])
    fid = extra_folder[0]["folder_id"] if extra_folder else ""
    delete(f"rt alert {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 5. SQL Alerts
print("[5] Deleting SQL Alerts...")
for entry in ENTITIES.get("alerts_sql", []):
    aid = entry.get("alert_id", entry.get("name"))
    extra_folder = ENTITIES.get("alert_folder_extra", [])
    fid = extra_folder[0]["folder_id"] if extra_folder else ""
    delete(f"sql alert {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 6. Standard Alerts
print("[6] Deleting Standard Alerts...")
for entry in ENTITIES.get("alerts_standard", []):
    aid = entry.get("alert_id", entry.get("name"))
    extra_folder = ENTITIES.get("alert_folder_extra", [])
    fid = extra_folder[0]["folder_id"] if extra_folder else ""
    delete(f"standard alert {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 7. Email Destination
print("[7] Deleting Email Destination...")
for name in ENTITIES.get("email_destination", []) + ENTITIES.get("destinations_email", []):
    if name: delete(f"email dest {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/alerts/destinations/{name}")
print()

# 8. Slack Destination
print("[8] Deleting Slack Destination...")
for name in ENTITIES.get("slack_destination", []) + ENTITIES.get("destinations_slack", []):
    if name: delete(f"slack dest {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/alerts/destinations/{name}")
print()

# 9. Email Template
print("[9] Deleting Email Template...")
for name in ENTITIES.get("email_template", []) + ENTITIES.get("templates_email", []):
    if name: delete(f"email tpl {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/alerts/templates/{name}")
print()

# 10. Slack Template
print("[10] Deleting Slack Template...")
for name in ENTITIES.get("slack_template", []) + ENTITIES.get("templates_slack", []):
    if name: delete(f"slack tpl {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/alerts/templates/{name}")
print()

# 11. Extra Alert Folder
print("[11] Deleting Extra Alert Folder...")
for entry in ENTITIES.get("alert_folder_extra", []):
    delete(f"extra folder {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/folders/alerts/{entry['folder_id']}")
print()

# 12. Saved Views
print("[12] Deleting Saved Views...")
for entry in ENTITIES.get("saved_views", []):
    vid = entry.get("view_id", entry.get("name"))
    delete(f"saved view {entry['name']}", session.delete, f"{BASE_URL}api/{ORG_ID}/savedviews/{vid}")
print()

# 13. Time Shift Dashboards
print("[13] Deleting Time Shift Dashboards...")
for entry in ENTITIES.get("dashboards_time_shift", []):
    did = entry["dashboard_id"]
    fid = entry["folder_id"]
    delete(f"timeshift dash {entry['name']}", session.delete, f"{BASE_URL}api/{ORG_ID}/dashboards/{did}?folder={fid}")
print()

# 14. Dashboards
print("[14] Deleting Dashboards...")
for entry in ENTITIES.get("dashboards", []):
    did = entry["dashboard_id"]
    fid = entry["folder_id"]
    delete(f"dashboard {entry['name']}", session.delete, f"{BASE_URL}api/{ORG_ID}/dashboards/{did}?folder={fid}")
print()

# 15. Multi Time Range Alerts
print("[15] Deleting Multi Time Range Alerts...")
for entry in ENTITIES.get("alerts_multi_time_range", []):
    aid = entry["alert_id"]
    fid = entry["folder_id"]
    delete(f"mtr alert {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 16. VRL Alerts (trigger)
print("[16] Deleting VRL Alerts (trigger)...")
for entry in ENTITIES.get("alerts_vrl_trigger", []):
    aid = entry["alert_id"]
    fid = entry["folder_id"]
    delete(f"vrl trigger {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 17. VRL Alerts (no-trigger)
print("[17] Deleting VRL Alerts (no-trigger)...")
for entry in ENTITIES.get("alerts_vrl_no_trigger", []):
    aid = entry["alert_id"]
    fid = entry["folder_id"]
    delete(f"vrl no-trigger {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/alerts/{aid}?folder={fid}")
print()

# 18. Dashboard Folders
print("[18] Deleting Dashboard Folders...")
for entry in ENTITIES.get("dashboard_folders", []):
    fid = entry["folder_id"]
    delete(f"dash folder {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/folders/dashboards/{fid}")
print()

# 19. Alert Folders
print("[19] Deleting Alert Folders...")
for entry in ENTITIES.get("alert_folders", []):
    fid = entry["folder_id"]
    delete(f"alert folder {entry['name']}", session.delete, f"{BASE_URL}api/v2/{ORG_ID}/folders/alerts/{fid}")
print()

# 20. Enrichment Tables
print("[20] Deleting Enrichment Tables...")
for name in ENTITIES.get("enrichments", []):
    delete(f"enrichment {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/streams/{name}?type=enrichment_tables")
print()

# 21. Pipelines
print("[21] Deleting Pipelines...")
for entry in ENTITIES.get("pipelines", []):
    pid = entry.get("pipeline_id", entry.get("name"))
    delete(f"pipeline {entry['name']}", session.delete, f"{BASE_URL}api/{ORG_ID}/pipelines/{pid}")
print()

# 22. Functions
print("[22] Deleting Functions...")
for name in ENTITIES.get("functions", []):
    delete(f"function {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/functions/{name}")
print()

# 23. Destinations (original 5)
print("[23] Deleting Destinations...")
for name in ENTITIES.get("destinations", []):
    delete(f"destination {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/alerts/destinations/{name}")
print()

# 24. Templates (original 5)
print("[24] Deleting Templates...")
for name in ENTITIES.get("templates", []):
    delete(f"template {name}", session.delete, f"{BASE_URL}api/{ORG_ID}/alerts/templates/{name}")
print()

# SUMMARY
print("=" * 60)
print("CLEANUP SUMMARY")
print("=" * 60)
print(f"  Deleted: {deleted}")
print(f"  Failed: {failed}")
print(f"  State file: {state_file}")
print("=" * 60)

# Optionally remove state file if all deleted
if failed == 0:
    print(f"\n[GUARDIAN] All entities cleaned up successfully.")
    print(f"[GUARDIAN] State file preserved at: {state_file}")
else:
    print(f"\n[GUARDIAN] {failed} entities failed to delete. Check logs above.")
