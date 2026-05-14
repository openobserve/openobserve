#!/usr/bin/env python3
"""Guardian Post-Upgrade Enrichment: Add missing alert types, reports, Slack/Email destinations."""

import os
import sys
import json
import time
import random
from datetime import datetime
from pathlib import Path
import requests
from requests.auth import HTTPBasicAuth
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- Add pages ---
PAGES_DIR = Path(__file__).parent.parent / "pages"
sys.path.insert(0, str(PAGES_DIR))

from template_page import TemplatePage
from destination_page import DestinationPage
from alert_page import AlertPage
from report_page import ReportPage

# ============================================================
# CONFIGURATION
# ============================================================
BASE_URL = os.environ.get("ZO_BASE_URL", "https://localhost:5080/")
EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL", "root@example.com")
PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD", "changeme")
ORG_ID = os.environ.get("ORGNAME", "default")
SLACK_WEBHOOK = os.environ.get("SLACK_WEBHOOK", "")
REPORT_EMAIL = os.environ.get("REPORT_EMAIL", "user@example.com")
REPORT_TITLE = os.environ.get("REPORT_TITLE", "upgrade-testing")

session = requests.Session()
session.auth = HTTPBasicAuth(EMAIL, PASSWORD)
session.verify = False

SUFFIX = f"guardian_extra_{datetime.now().strftime('%m%d')}_{random.randint(1000, 9999)}"

# Load pre-upgrade state to get the stream and dashboards
state_file = Path(__file__).parent / "devcluster2_default_pre_state.json"
with open(state_file) as f:
    state = json.load(f)

STREAM_NAME = state["stream_name"]
print(f"[GUARDIAN] Post-Upgrade Enrichment")
print(f"[GUARDIAN] Base URL: {BASE_URL}")
print(f"[GUARDIAN] Suffix: {SUFFIX}")
print(f"[GUARDIAN] Stream: {STREAM_NAME}")
print()

# ============================================================
# STEP 1: Create Slack + Email Templates
# ============================================================
print("[STEP 1] Creating Slack and Email templates...")
template_page = TemplatePage(session, BASE_URL, ORG_ID)

slack_template_name = f"template_slack_{SUFFIX}"
try:
    resp = template_page.create_template_webhook(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, slack_template_name)
    print(f"  [OK] Slack template: {slack_template_name}")
except Exception as e:
    print(f"  [FAIL] Slack template: {e}")

email_template_name = f"template_email_{SUFFIX}"
try:
    resp = template_page.create_template_email(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, email_template_name)
    print(f"  [OK] Email template: {email_template_name}")
except Exception as e:
    print(f"  [FAIL] Email template: {e}")
print()

# ============================================================
# STEP 2: Create Slack + Email Destinations
# ============================================================
print("[STEP 2] Creating Slack and Email destinations...")
dest_page = DestinationPage(session, BASE_URL, ORG_ID)

slack_dest_name = f"dest_slack_{SUFFIX}"
try:
    dest_page.create_destination_webhook(
        session, BASE_URL, ORG_ID, EMAIL, PASSWORD,
        slack_template_name, slack_dest_name,
        webhook_url=SLACK_WEBHOOK, method="post"
    )
    print(f"  [OK] Slack destination: {slack_dest_name}")
except Exception as e:
    print(f"  [FAIL] Slack destination: {e}")

email_dest_name = f"dest_email_{SUFFIX}"
try:
    dest_page.create_destination_email(
        session, BASE_URL, ORG_ID, EMAIL, PASSWORD,
        REPORT_EMAIL, email_template_name, email_dest_name
    )
    print(f"  [OK] Email destination: {email_dest_name}")
except Exception as e:
    print(f"  [FAIL] Email destination: {e}")
print()

# ============================================================
# STEP 3: Create alert folder for new alerts
# ============================================================
print("[STEP 3] Creating alert folder for new alerts...")
resp = session.post(
    f"{BASE_URL}api/v2/{ORG_ID}/folders/alerts",
    json={"description": f"extra_folder_{SUFFIX}", "folderId": "", "name": f"extra_folder_{SUFFIX}"},
    headers={"Content-Type": "application/json"}
)
assert resp.status_code == 200, f"Failed to create folder: {resp.text}"
ALERT_FOLDER_ID = resp.json()["folderId"]
print(f"  [OK] Alert folder: extra_folder_{SUFFIX} (id: {ALERT_FOLDER_ID})")
print()

# ============================================================
# STEP 4: Create additional alert types (5 each, 20 total)
# ============================================================
alert_page = AlertPage(session, BASE_URL, ORG_ID)

# --- 4.1 Standard Alerts (custom type, template-based) ---
print("[STEP 4.1] Creating 5 Standard Alerts (custom type)...")
standard_alerts = []
for i in range(5):
    name = f"standard_{SUFFIX}_{i}"
    try:
        alert_page.create_standard_alert(
            session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME,
            slack_template_name, slack_dest_name, name
        )
        # Set folder_id via PUT since create_standard_alert doesn't accept folder_id
        # Let's fetch the created alert and patch if needed
        time.sleep(0.3)
        alert_id = name  # fallback
        resp = session.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts")
        alist = resp.json().get("list", []) if resp.status_code == 200 else []
        for a in alist:
            if a.get("name") == name:
                alert_id = a.get("alert_id", name)
                break
        standard_alerts.append({"name": name, "alert_id": alert_id})
        print(f"  [OK] Standard Alert: {name} (id: {alert_id})")
    except Exception as e:
        print(f"  [FAIL] Standard Alert: {name} - {e}")
print(f"[OK] Standard Alerts: {len(standard_alerts)}/5")
print()

# --- 4.2 Standard SQL Alerts ---
print("[STEP 4.2] Creating 5 Standard SQL Alerts...")
sql_alerts = []
for i in range(5):
    name = f"alert_sql_{SUFFIX}_{i}"
    try:
        alert_page.create_standard_alert_sql(
            session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME,
            slack_template_name, slack_dest_name, name
        )
        time.sleep(0.3)
        resp = session.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts")
        alist = resp.json().get("list", []) if resp.status_code == 200 else []
        alert_id = name
        for a in alist:
            if a.get("name") == name:
                alert_id = a.get("alert_id", name)
                break
        sql_alerts.append({"name": name, "alert_id": alert_id})
        print(f"  [OK] SQL Alert: {name} (id: {alert_id})")
    except Exception as e:
        print(f"  [FAIL] SQL Alert: {name} - {e}")
print(f"[OK] SQL Alerts: {len(sql_alerts)}/5")
print()

# --- 4.3 Real-Time Alerts ---
print("[STEP 4.3] Creating 5 Real-Time Alerts...")
rt_alerts = []
for i in range(5):
    name = f"alert_rt_{SUFFIX}_{i}"
    try:
        alert_page.create_real_time_alert(
            session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME,
            slack_template_name, slack_dest_name, name
        )
        time.sleep(0.3)
        resp = session.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts")
        alist = resp.json().get("list", []) if resp.status_code == 200 else []
        alert_id = name
        for a in alist:
            if a.get("name") == name:
                alert_id = a.get("alert_id", name)
                break
        rt_alerts.append({"name": name, "alert_id": alert_id})
        print(f"  [OK] Real-Time Alert: {name} (id: {alert_id})")
    except Exception as e:
        print(f"  [FAIL] Real-Time Alert: {name} - {e}")
print(f"[OK] Real-Time Alerts: {len(rt_alerts)}/5")
print()

# --- 4.4 Cron Alerts ---
print("[STEP 4.4] Creating 5 Cron Alerts...")
cron_alerts = []
for i in range(5):
    name = f"alert_cron_{SUFFIX}_{i}"
    try:
        alert_page.create_standard_alert_cron(
            session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME,
            slack_template_name, slack_dest_name, name
        )
        time.sleep(0.3)
        resp = session.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts")
        alist = resp.json().get("list", []) if resp.status_code == 200 else []
        alert_id = name
        for a in alist:
            if a.get("name") == name:
                alert_id = a.get("alert_id", name)
                break
        cron_alerts.append({"name": name, "alert_id": alert_id})
        print(f"  [OK] Cron Alert: {name} (id: {alert_id})")
    except Exception as e:
        print(f"  [FAIL] Cron Alert: {name} - {e}")
print(f"[OK] Cron Alerts: {len(cron_alerts)}/5")
print()

# ============================================================
# STEP 5: Create Reports (5 scheduled + 5 cached)
# ============================================================
report_page = ReportPage(session, BASE_URL, ORG_ID)

# Get dashboard IDs from pre-upgrade state
dashboards = state["entities"]["dashboards"]
dash_folder_ids = [d["folder_id"] for d in state["entities"]["dashboard_folders"]]

# --- 5.1 Scheduled Reports (email to neha@openobserve) ---
print("[STEP 5.1] Creating 5 Scheduled Reports (email to neha@openobserve)...")
scheduled_reports = []
for i in range(5):
    name = f"report_scheduled_{SUFFIX}_{i}"
    did = dashboards[i]["dashboard_id"]
    fid = dash_folder_ids[i] if i < len(dash_folder_ids) else dash_folder_ids[0]
    try:
        # Use custom API call since the page object hardcodes the email
        headers = {"Content-Type": "application/json"}
        payload = {
            "dashboards": [{
                "folder": fid,
                "dashboard": did,
                "tabs": ["default"],
                "variables": [],
                "timerange": {"type": "relative", "period": "30m", "from": 0, "to": 0}
            }],
            "description": "",
            "destinations": [{"email": REPORT_EMAIL}],
            "enabled": True,
            "media_type": "Pdf",
            "name": name,
            "title": REPORT_TITLE,
            "message": "Guardian upgrade testing report",
            "orgId": ORG_ID,
            "start": int(datetime.now().timestamp() * 1000000),
            "frequency": {"interval": 1, "type": "once", "cron": ""},
            "user": "",
            "password": "",
            "timezone": "UTC",
            "timezoneOffset": 0,
            "owner": EMAIL,
            "lastEditedBy": EMAIL,
            "report_type": "PDF"
        }
        resp = session.post(f"{BASE_URL}api/{ORG_ID}/reports", json=payload, headers=headers)
        assert resp.status_code == 200, f"Failed: {resp.text}"
        scheduled_reports.append({"name": name})
        print(f"  [OK] Scheduled Report: {name}")
    except Exception as e:
        print(f"  [FAIL] Scheduled Report: {name} - {e}")
print(f"[OK] Scheduled Reports: {len(scheduled_reports)}/5")
print()

# --- 5.2 Cached Reports ---
print("[STEP 5.2] Creating 5 Cached Reports...")
cached_reports = []
for i in range(5):
    name = f"report_cached_{SUFFIX}_{i}"
    did = dashboards[i]["dashboard_id"]
    fid = dash_folder_ids[i] if i < len(dash_folder_ids) else dash_folder_ids[0]
    try:
        headers = {"Content-Type": "application/json"}
        payload = {
            "dashboards": [{
                "folder": fid,
                "dashboard": did,
                "tabs": ["default"],
                "variables": [],
                "timerange": {"type": "relative", "period": "30m", "from": 0, "to": 0}
            }],
            "description": "",
            "destinations": [],
            "enabled": True,
            "media_type": "Pdf",
            "name": name,
            "title": REPORT_TITLE,
            "message": "Guardian upgrade testing cached report",
            "orgId": ORG_ID,
            "start": int(datetime.now().timestamp() * 1000000),
            "frequency": {"interval": 1, "type": "once", "cron": ""},
            "user": "",
            "password": "",
            "timezone": "UTC",
            "timezoneOffset": 0,
            "owner": EMAIL,
            "lastEditedBy": EMAIL,
            "report_type": "PDF"
        }
        resp = session.post(f"{BASE_URL}api/{ORG_ID}/reports", json=payload, headers=headers)
        assert resp.status_code == 200, f"Failed: {resp.text}"
        cached_reports.append({"name": name})
        print(f"  [OK] Cached Report: {name}")
    except Exception as e:
        print(f"  [FAIL] Cached Report: {name} - {e}")
print(f"[OK] Cached Reports: {len(cached_reports)}/5")
print()

# ============================================================
# STEP 6: Save enriched state
# ============================================================
print("[STEP 6] Saving enriched state...")

state["entities"]["templates_slack"] = [slack_template_name]
state["entities"]["templates_email"] = [email_template_name]
state["entities"]["destinations_slack"] = [slack_dest_name]
state["entities"]["destinations_email"] = [email_dest_name]
state["entities"]["alert_folder_extra"] = [{"name": f"extra_folder_{SUFFIX}", "folder_id": ALERT_FOLDER_ID}]
state["entities"]["alerts_standard"] = standard_alerts
state["entities"]["alerts_sql"] = sql_alerts
state["entities"]["alerts_realtime"] = rt_alerts
state["entities"]["alerts_cron"] = cron_alerts
state["entities"]["reports_scheduled"] = scheduled_reports
state["entities"]["reports_cached"] = cached_reports
state["enrichment_suffix"] = SUFFIX
state["enriched_at"] = datetime.now().isoformat()
state["slack_webhook"] = SLACK_WEBHOOK
state["report_email"] = REPORT_EMAIL

enriched_file = Path(__file__).parent / "devcluster2_default_pre_state.json"
with open(enriched_file, "w") as f:
    json.dump(state, f, indent=2, default=str)
print(f"[OK] State saved to: {enriched_file}")
print()

# ============================================================
# SUMMARY
# ============================================================
print("=" * 60)
print("POST-UPGRADE ENRICHMENT SUMMARY")
print("=" * 60)
print(f"  Slack template: 1")
print(f"  Email template: 1")
print(f"  Slack destination: 1 → Slack #alerts")
print(f"  Email destination: 1 → {REPORT_EMAIL}")
print(f"  Standard Alerts: {len(standard_alerts)}/5")
print(f"  SQL Alerts: {len(sql_alerts)}/5")
print(f"  Real-Time Alerts: {len(rt_alerts)}/5")
print(f"  Cron Alerts: {len(cron_alerts)}/5")
print(f"  Scheduled Reports: {len(scheduled_reports)}/5")
print(f"  Cached Reports: {len(cached_reports)}/5")
print(f"  ---")
total = (len(standard_alerts) + len(sql_alerts) + len(rt_alerts) + len(cron_alerts) +
         len(scheduled_reports) + len(cached_reports) + 4)  # +4 for templates/destinations
print(f"  TOTAL NEW ENTITIES: {total}")
print(f"  Suffix: {SUFFIX}")
print("=" * 60)
