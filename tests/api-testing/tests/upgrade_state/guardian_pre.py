#!/usr/bin/env python3
"""Guardian Pre-Upgrade Phase: Create ~100 entities across 18 types and save state."""

import os
import sys
import io
import json
import time
import uuid
import random
from datetime import datetime
from pathlib import Path
import requests
from requests.auth import HTTPBasicAuth
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- Add pages directory to path ---
PAGES_DIR = Path(__file__).parent.parent / "pages"
sys.path.insert(0, str(PAGES_DIR))

from template_page import TemplatePage
from destination_page import DestinationPage
from function_page import FunctionPage
from pipeline_page import PipelinePage
from enrichment_page import EnrichmentPage
from folder_page import FolderPage
from alertV2_page import AlertV2Page
from alert_page import AlertPage
from dashboard_page import DashboardPage
from savedview_page import SavedViewPage

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

SUFFIX = f"guardian_{datetime.now().strftime('%m%d')}_{random.randint(1000, 9999)}"
STREAM_NAME = f"guardian_stream_{SUFFIX}"

print(f"[GUARDIAN] Pre-Upgrade Phase - The Watch Begins")
print(f"[GUARDIAN] Base URL: {BASE_URL}")
print(f"[GUARDIAN] Org: {ORG_ID} | Suffix: {SUFFIX}")
print(f"[GUARDIAN] Stream: {STREAM_NAME}")
print()

# ============================================================
# STEP 1: Ingest 500 records spread over 6 months
# ============================================================
SIX_MONTHS_US = 180 * 24 * 60 * 60 * 1_000_000  # microseconds
RECORD_COUNT = 500

print(f"[1] Ingesting {RECORD_COUNT} records spread over 6 months...")
namespaces = ["default", "kube-system", "monitoring", "logging", "app"]
labels = ["nginx", "redis", "postgres", "app", "api"]
levels = ["info", "warn", "error", "debug"]
codes = [200, 201, 400, 404, 500, 502, 503]
log_messages = [
    "Request processed successfully", "Connection established", "Cache hit for key",
    "Database query executed", "API response sent", "Authentication successful",
    "Session created", "File uploaded", "Task completed", "Health check passed"
]

current_ts = int(time.time() * 1000000)
logs = []
for i in range(RECORD_COUNT):
    offset = random.randint(0, SIX_MONTHS_US)
    ts = current_ts - offset
    logs.append({
        "_timestamp": ts, "log": random.choice(log_messages),
        "level": random.choice(levels),
        "kubernetes_namespace_name": random.choice(namespaces),
        "kubernetes_labels_name": random.choice(labels),
        "code": random.choice(codes)
    })

# Sort by timestamp so data spans oldest to newest
logs.sort(key=lambda x: x["_timestamp"])
oldest_ts = logs[0]["_timestamp"]
newest_ts = logs[-1]["_timestamp"]
print(f"  Date range: {datetime.fromtimestamp(oldest_ts / 1_000_000)} → {datetime.fromtimestamp(newest_ts / 1_000_000)}")

for batch_start in range(0, RECORD_COUNT, 100):
    batch = logs[batch_start:batch_start + 100]
    resp = session.post(f"{BASE_URL}api/{ORG_ID}/{STREAM_NAME}/_json", json=batch)
    assert resp.status_code == 200, f"Ingest failed: {resp.text}"
    print(f"  [OK] Batch {batch_start // 100 + 1}/{(RECORD_COUNT + 99) // 100}")
print(f"[OK] {RECORD_COUNT} records ingested. Waiting 5s...")
time.sleep(5)
print()

# ============================================================
# STEP 2: Init page objects
# ============================================================
print("[2] Initializing page objects...")
template_page = TemplatePage(session, BASE_URL, ORG_ID)
dest_page = DestinationPage(session, BASE_URL, ORG_ID)
func_page = FunctionPage(session, BASE_URL, ORG_ID)
pipeline_page = PipelinePage(session, BASE_URL, ORG_ID)
enrichment_page = EnrichmentPage(session, BASE_URL, ORG_ID)
folder_page = FolderPage(session, BASE_URL, ORG_ID)
alertv2_page = AlertV2Page(session, BASE_URL, ORG_ID)
alert_page = AlertPage(session, BASE_URL, ORG_ID)
dashboard_page = DashboardPage(session, BASE_URL, ORG_ID)
savedview_page = SavedViewPage(session, BASE_URL, ORG_ID)
print("[OK] Page objects initialized")
print()

# ============================================================
# STATE
# ============================================================
state = {
    "env": "devcluster2",
    "org_id": ORG_ID,
    "base_url": BASE_URL,
    "created_at": datetime.now().isoformat(),
    "suffix": SUFFIX,
    "stream_name": STREAM_NAME,
    "slack_webhook": SLACK_WEBHOOK,
    "report_email": REPORT_EMAIL,
    "report_title": REPORT_TITLE,
    "entities": {
        "templates": [], "destinations": [], "functions": [], "pipelines": [],
        "enrichments": [], "alert_folders": [], "dashboard_folders": [],
        "alerts_vrl_no_trigger": [], "alerts_vrl_trigger": [], "alerts_multi_time_range": [],
        "dashboards": [], "dashboards_time_shift": [], "saved_views": [],
        # NEW types
        "slack_template": [], "email_template": [],
        "slack_destination": [], "email_destination": [],
        "alert_folder_extra": [],
        "alerts_standard": [], "alerts_sql": [], "alerts_realtime": [], "alerts_cron": [],
        "alerts_timezone": [],
        "reports_scheduled": [], "reports_cached": [],
    }
}

# Helper: fetch alert_id after creation
def fetch_alert_id(folder_id, alert_name):
    resp = session.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts?folder={folder_id}")
    items = resp.json().get("list", []) if resp.status_code == 200 else []
    for a in items:
        if a.get("name") == alert_name:
            return a.get("alert_id", alert_name)
    # fallback: search all alerts
    resp2 = session.get(f"{BASE_URL}api/v2/{ORG_ID}/alerts")
    items2 = resp2.json().get("list", []) if resp2.status_code == 200 else []
    for a in items2:
        if a.get("name") == alert_name:
            return a.get("alert_id", alert_name)
    return alert_name

# ============================================================
# STEP 3: Create 65 core entities (original 13 types)
# ============================================================

# 3.1 Templates (5)
print("[3.1] Templates...")
for i in range(5):
    name = f"template_{SUFFIX}_{i}"
    try:
        template_page.create_template_webhook(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, name)
        state["entities"]["templates"].append(name)
        print(f"  [OK] {name}")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['templates'])}/5")
print()

# 3.2 Destinations (5)
print("[3.2] Destinations...")
for i in range(5):
    name = f"dest_{SUFFIX}_{i}"
    try:
        dest_page.create_destination_webhook(session, BASE_URL, ORG_ID, EMAIL, PASSWORD, state["entities"]["templates"][i], name)
        state["entities"]["destinations"].append(name)
        print(f"  [OK] {name}")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['destinations'])}/5")
print()

# 3.3 Functions (5)
print("[3.3] Functions...")
for i in range(5):
    name = f"func_{SUFFIX}_{i}"
    try:
        func_page.create_function(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, name)
        state["entities"]["functions"].append(name)
        print(f"  [OK] {name}")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['functions'])}/5")
print()

# 3.4 Pipelines (5)
print("[3.4] Pipelines...")
for i in range(5):
    name = f"pipeline_{SUFFIX}_{i}"
    try:
        pipeline_page.create_realTime_pipeline(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME, name)
        time.sleep(0.5)
        resp = session.get(f"{BASE_URL}api/{ORG_ID}/pipelines")
        plist = resp.json().get("list", []) if resp.status_code == 200 else []
        pid = name
        for p in plist:
            if p.get("name") == name: pid = p.get("pipeline_id", name); break
        state["entities"]["pipelines"].append({"name": name, "pipeline_id": pid})
        print(f"  [OK] {name} (id={pid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['pipelines'])}/5")
print()

# 3.5 Enrichments (5) — bypass cookie-based auth
print("[3.5] Enrichments...")
ENRICH_BOUNDARY = "----WebKitFormBoundaryaQgmYHuE6dQrlLss"

def create_multipart(fields, boundary):
    bs = f"--{boundary}"
    lines = []
    for k, v in fields.items():
        if isinstance(v, tuple):
            fname, fobj, ctype = v
            lines.append(f"{bs}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n")
            lines.append(fobj.read())
        else:
            lines.append(f"{bs}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}")
    lines.append(f"{bs}--")
    return b"\r\n".join(line if isinstance(line, bytes) else line.encode("utf-8") for line in lines)

for i in range(5):
    name = f"enrich_{SUFFIX}_{i}"
    try:
        csv_data = "protocol_number,keyword,protocol_description\n0,HOPOPT,IPv6 Hop-by-Hop Option\n1,ICMP,Internet Control Message\n2,IGMP,Internet Group Management"
        fobj = io.BytesIO(csv_data.encode())
        data = create_multipart({"file": ("protocols.csv", fobj, "text/csv")}, ENRICH_BOUNDARY)
        headers = {"Content-Type": f"multipart/form-data; boundary={ENRICH_BOUNDARY}"}
        resp = session.post(f"{BASE_URL}api/{ORG_ID}/enrichment_tables/{name}?append=false", headers=headers, data=data)
        assert resp.status_code == 200, f"Failed: {resp.text}"
        state["entities"]["enrichments"].append(name)
        print(f"  [OK] {name}")
        time.sleep(1)
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['enrichments'])}/5")
print()

# 3.6 Alert Folders (5)
print("[3.6] Alert Folders...")
for i in range(5):
    name = f"alert_folder_{SUFFIX}_{i}"
    try:
        fid = folder_page.create_folder_alert_v2(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, name)
        state["entities"]["alert_folders"].append({"name": name, "folder_id": fid})
        print(f"  [OK] {name} (id={fid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alert_folders'])}/5")
print()

# 3.7 Dashboard Folders (5)
print("[3.7] Dashboard Folders...")
for i in range(5):
    name = f"dash_folder_{SUFFIX}_{i}"
    try:
        fid = folder_page.create_folder_dashboard_v2(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, name)
        state["entities"]["dashboard_folders"].append({"name": name, "folder_id": fid})
        print(f"  [OK] {name} (id={fid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['dashboard_folders'])}/5")
print()

dest_names = state["entities"]["destinations"]
alert_folder_ids = [f["folder_id"] for f in state["entities"]["alert_folders"]]
dash_folder_ids = [f["folder_id"] for f in state["entities"]["dashboard_folders"]]

# 3.8 VRL Alerts no-trigger (5)
print("[3.8] VRL Alerts (no-trigger)...")
for i in range(5):
    name = f"alert_vrl_no_{SUFFIX}_{i}"
    try:
        alertv2_page.create_scheduled_sql_alert_vrl_no_trigger(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME, dest_names[i], alert_folder_ids[i], name)
        time.sleep(0.5)
        aid = fetch_alert_id(alert_folder_ids[i], name)
        state["entities"]["alerts_vrl_no_trigger"].append({"name": name, "alert_id": aid, "folder_id": alert_folder_ids[i]})
        print(f"  [OK] {name} (id={aid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alerts_vrl_no_trigger'])}/5")
print()

# 3.9 VRL Alerts trigger (5)
print("[3.9] VRL Alerts (trigger)...")
for i in range(5):
    name = f"alert_vrl_trig_{SUFFIX}_{i}"
    try:
        alertv2_page.create_scheduled_sql_alert_vrl_trigger(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME, dest_names[i], alert_folder_ids[i], name)
        time.sleep(0.5)
        aid = fetch_alert_id(alert_folder_ids[i], name)
        state["entities"]["alerts_vrl_trigger"].append({"name": name, "alert_id": aid, "folder_id": alert_folder_ids[i]})
        print(f"  [OK] {name} (id={aid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alerts_vrl_trigger'])}/5")
print()

# 3.10 Multi Time Range Alerts (5) — offSet camelCase fix
print("[3.10] Multi Time Range Alerts...")
for i in range(5):
    name = f"alert_mtr_{SUFFIX}_{i}"
    try:
        payload = {
            "name": name, "stream_type": "logs", "stream_name": STREAM_NAME, "is_real_time": False,
            "query_condition": {"conditions": [], "sql": f"SELECT count(*) as count FROM {STREAM_NAME}",
                "promql": "", "type": "sql", "aggregation": None, "promql_condition": None, "vrl_function": None,
                "multi_time_range": [{"alias": "1h_ago", "offSet": "1h"}, {"alias": "1d_ago", "offSet": "1d"}, {"alias": "1w_ago", "offSet": "1w"}]},
            "trigger_condition": {"period": 60, "operator": ">=", "frequency": 5, "cron": "", "threshold": 1,
                "silence": 10, "frequency_type": "minutes", "timezone": "UTC"},
            "destinations": [dest_names[i]], "context_attributes": {}, "enabled": True,
            "owner": EMAIL, "lastEditedBy": EMAIL, "folder_id": alert_folder_ids[i]
        }
        resp = session.post(f"{BASE_URL}api/v2/{ORG_ID}/alerts?folder={alert_folder_ids[i]}", json=payload, headers={"Content-Type": "application/json"})
        assert resp.status_code in (200, 409), f"Failed: {resp.text}"
        time.sleep(0.5)
        aid = fetch_alert_id(alert_folder_ids[i], name)
        state["entities"]["alerts_multi_time_range"].append({"name": name, "alert_id": aid, "folder_id": alert_folder_ids[i]})
        print(f"  [OK] {name} (id={aid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alerts_multi_time_range'])}/5")
print()

# 3.11 Dashboards (5)
print("[3.11] Dashboards...")
for i in range(5):
    name = f"dashboard_{SUFFIX}_{i}"
    try:
        did = dashboard_page.create_dashboard(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME, dash_folder_ids[i], name)
        state["entities"]["dashboards"].append({"name": name, "dashboard_id": did, "folder_id": dash_folder_ids[i]})
        print(f"  [OK] {name} (id={did})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['dashboards'])}/5")
print()

# 3.12 Time Shift Dashboards (5)
print("[3.12] Time Shift Dashboards...")
for i in range(5):
    name = f"dash_timeshift_{SUFFIX}_{i}"
    try:
        did = dashboard_page.create_dashboard_with_time_shift(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME, dash_folder_ids[i], name)
        state["entities"]["dashboards_time_shift"].append({"name": name, "dashboard_id": did, "folder_id": dash_folder_ids[i]})
        print(f"  [OK] {name} (id={did})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['dashboards_time_shift'])}/5")
print()

# 3.13 Saved Views (5)
print("[3.13] Saved Views...")
for i in range(5):
    name = f"savedview_{SUFFIX}_{i}"
    try:
        savedview_page.create_savedView(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, STREAM_NAME, name)
        time.sleep(0.5)
        resp = session.get(f"{BASE_URL}api/{ORG_ID}/savedviews")
        sv_items = resp.json().get("views", []) if resp.status_code == 200 else []
        vid = name
        for sv in sv_items:
            if sv.get("view_name") == name: vid = sv.get("view_id", name); break
        state["entities"]["saved_views"].append({"name": name, "view_id": vid})
        print(f"  [OK] {name} (id={vid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['saved_views'])}/5")
print()

# ============================================================
# STEP 4: NEW ENTITY TYPES — Slack/Email infra + more alerts + reports
# ============================================================

# 4.1 Slack template + destination
print("[4.1] Slack template & destination...")
slack_tpl = f"template_slack_{SUFFIX}"
try:
    template_page.create_template_webhook(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, slack_tpl)
    state["entities"]["slack_template"].append(slack_tpl)
    print(f"  [OK] Slack template: {slack_tpl}")
    slack_dest = f"dest_slack_{SUFFIX}"
    dest_page.create_destination_webhook(session, BASE_URL, ORG_ID, EMAIL, PASSWORD, slack_tpl, slack_dest, webhook_url=SLACK_WEBHOOK, method="post") if SLACK_WEBHOOK else \
        dest_page.create_destination_webhook(session, BASE_URL, ORG_ID, EMAIL, PASSWORD, slack_tpl, slack_dest)
    state["entities"]["slack_destination"].append(slack_dest)
    print(f"  [OK] Slack destination: {slack_dest}")
except Exception as e: print(f"  [FAIL] Slack infra: {e}")
print()

# 4.2 Email template + destination
print("[4.2] Email template & destination...")
email_tpl = f"template_email_{SUFFIX}"
try:
    template_page.create_template_email(session, BASE_URL, EMAIL, PASSWORD, ORG_ID, email_tpl)
    state["entities"]["email_template"].append(email_tpl)
    print(f"  [OK] Email template: {email_tpl}")
    email_dest = f"dest_email_{SUFFIX}"
    dest_page.create_destination_email(session, BASE_URL, ORG_ID, EMAIL, PASSWORD, REPORT_EMAIL, email_tpl, email_dest)
    state["entities"]["email_destination"].append(email_dest)
    print(f"  [OK] Email destination: {email_dest}")
except Exception as e: print(f"  [FAIL] Email infra: {e}")
print()

# 4.3 Extra alert folder
print("[4.3] Extra alert folder...")
extra_folder = f"extra_folder_{SUFFIX}"
try:
    resp = session.post(f"{BASE_URL}api/v2/{ORG_ID}/folders/alerts", json={"description": extra_folder, "folderId": "", "name": extra_folder}, headers={"Content-Type": "application/json"})
    assert resp.status_code == 200, f"Failed: {resp.text}"
    EXTRA_FID = resp.json()["folderId"]
    state["entities"]["alert_folder_extra"].append({"name": extra_folder, "folder_id": EXTRA_FID})
    print(f"  [OK] {extra_folder} (id={EXTRA_FID})")
except Exception as e: print(f"  [FAIL] Extra folder: {e}")
print()

slack_dest_name = state["entities"]["slack_destination"][0] if state["entities"]["slack_destination"] else ""

# 4.4 Standard Alerts (5) — custom condition on code >= 500
print("[4.4] Standard Alerts (custom condition)...")
for i in range(5):
    name = f"standard_{SUFFIX}_{i}"
    try:
        payload = {
            "name": name, "row_template": slack_tpl, "stream_type": "logs", "stream_name": STREAM_NAME, "is_real_time": False,
            "query_condition": {
                "conditions": [{"column": "code", "operator": ">=", "value": 500, "type": None, "id": str(uuid.uuid4())}],
                "search_event_type": "ui", "sql": "", "promql": "", "type": "custom",
                "promql_condition": None, "vrl_function": None, "multi_time_range": []
            },
            "trigger_condition": {"period": 10, "operator": ">=", "frequency": 1, "cron": "", "threshold": 1, "silence": 5, "frequency_type": "minutes", "timezone": "UTC", "tolerance_in_secs": 0},
            "org_id": ORG_ID, "destinations": [slack_dest_name], "enabled": True, "description": "Standard alert on error status codes"
        }
        resp = session.post(f"{BASE_URL}api/v2/{ORG_ID}/alerts?type=logs", json=payload, headers={"Content-Type": "application/json"})
        assert resp.status_code in (200, 409), f"Failed: {resp.text}"
        time.sleep(0.3)
        aid = fetch_alert_id(EXTRA_FID, name)
        state["entities"]["alerts_standard"].append({"name": name, "alert_id": aid})
        print(f"  [OK] {name} (id={aid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alerts_standard'])}/5")
print()

# 4.5 SQL Alerts (5)
print("[4.5] SQL Alerts...")
for i in range(5):
    name = f"alert_sql_{SUFFIX}_{i}"
    try:
        payload = {
            "name": name, "row_template": slack_tpl, "stream_type": "logs", "stream_name": STREAM_NAME, "is_real_time": False,
            "query_condition": {
                "conditions": [{"column": "code", "operator": ">=", "value": 500, "type": None, "id": str(uuid.uuid4())}],
                "search_event_type": "ui",
                "sql": f"SELECT count(*) as count FROM \"{STREAM_NAME}\" WHERE code >= 500",
                "promql": "", "type": "sql", "promql_condition": None, "vrl_function": None, "multi_time_range": []
            },
            "trigger_condition": {"period": 10, "operator": ">=", "frequency": 1, "cron": "", "threshold": 1, "silence": 5, "frequency_type": "minutes", "timezone": "UTC", "tolerance_in_secs": 0},
            "org_id": ORG_ID, "destinations": [slack_dest_name], "enabled": True, "description": "SQL alert on error status codes"
        }
        resp = session.post(f"{BASE_URL}api/v2/{ORG_ID}/alerts?type=logs", json=payload, headers={"Content-Type": "application/json"})
        assert resp.status_code in (200, 409), f"Failed: {resp.text}"
        time.sleep(0.3)
        aid = fetch_alert_id(EXTRA_FID, name)
        state["entities"]["alerts_sql"].append({"name": name, "alert_id": aid})
        print(f"  [OK] {name} (id={aid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alerts_sql'])}/5")
print()

# 4.6 Real-Time Alerts (5) — condition on level=error (will trigger on ingest)
print("[4.6] Real-Time Alerts...")
for i in range(5):
    name = f"alert_rt_{SUFFIX}_{i}"
    try:
        payload = {
            "name": name, "row_template": slack_tpl, "stream_type": "logs", "stream_name": STREAM_NAME, "is_real_time": True,
            "query_condition": {
                "conditions": [{"column": "level", "operator": "=", "value": "error", "type": None, "id": str(uuid.uuid4())}],
                "search_event_type": "ui", "sql": "", "promql": "", "type": "custom",
                "promql_condition": None, "vrl_function": None, "multi_time_range": []
            },
            "trigger_condition": {"period": 10, "operator": ">=", "frequency": 1, "cron": "", "threshold": 1, "silence": 5, "frequency_type": "minutes", "timezone": "UTC", "tolerance_in_secs": 0},
            "org_id": ORG_ID, "destinations": [slack_dest_name], "enabled": True, "description": "Real-time alert on error logs"
        }
        resp = session.post(f"{BASE_URL}api/v2/{ORG_ID}/alerts?type=logs", json=payload, headers={"Content-Type": "application/json"})
        assert resp.status_code in (200, 409), f"Failed: {resp.text}"
        time.sleep(0.3)
        aid = fetch_alert_id(EXTRA_FID, name)
        state["entities"]["alerts_realtime"].append({"name": name, "alert_id": aid})
        print(f"  [OK] {name} (id={aid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alerts_realtime'])}/5")
print()

# 4.7 Cron Alerts (5)
print("[4.7] Cron Alerts...")
for i in range(5):
    name = f"alert_cron_{SUFFIX}_{i}"
    try:
        payload = {
            "name": name, "row_template": slack_tpl, "stream_type": "logs", "stream_name": STREAM_NAME, "is_real_time": False,
            "query_condition": {
                "conditions": [{"column": "code", "operator": ">=", "value": 500, "type": None, "id": str(uuid.uuid4())}],
                "search_event_type": "ui", "sql": "", "promql": "", "type": "custom",
                "promql_condition": None, "vrl_function": None, "multi_time_range": []
            },
            "trigger_condition": {"period": 10, "operator": ">=", "frequency": 1, "cron": f"0 */{2+i} * * * *", "threshold": 1, "silence": 5, "frequency_type": "cron", "timezone": "UTC", "tz_offset": 0},
            "org_id": ORG_ID, "destinations": [slack_dest_name], "enabled": True, "description": f"Cron alert every {2+i} minutes"
        }
        resp = session.post(f"{BASE_URL}api/v2/{ORG_ID}/alerts?type=logs", json=payload, headers={"Content-Type": "application/json"})
        assert resp.status_code in (200, 409), f"Failed: {resp.text}"
        time.sleep(0.3)
        aid = fetch_alert_id(EXTRA_FID, name)
        state["entities"]["alerts_cron"].append({"name": name, "alert_id": aid})
        print(f"  [OK] {name} (id={aid})")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['alerts_cron'])}/5")
print()

# 4.8 Timezone Alert (1) — Asia/Calcutta
print("[4.8] Timezone Alert (Asia/Calcutta)...")
tz_name = f"alert_tz_calcutta_{SUFFIX}"
try:
    payload = {
        "name": tz_name, "stream_type": "logs", "stream_name": STREAM_NAME, "is_real_time": False,
        "query_condition": {"conditions": [], "sql": f"SELECT count(*) as count FROM {STREAM_NAME}",
            "promql": "", "type": "sql", "aggregation": None, "promql_condition": None, "vrl_function": None, "multi_time_range": []},
        "trigger_condition": {"period": 10, "operator": ">=", "frequency": 1, "cron": "", "threshold": 1, "silence": 5, "frequency_type": "minutes", "timezone": "Asia/Calcutta", "tz_offset": 330},
        "destinations": [slack_dest_name], "context_attributes": {}, "enabled": True,
        "owner": EMAIL, "lastEditedBy": EMAIL, "folder_id": EXTRA_FID
    }
    resp = session.post(f"{BASE_URL}api/v2/{ORG_ID}/alerts?folder={EXTRA_FID}", json=payload, headers={"Content-Type": "application/json"})
    assert resp.status_code in (200, 409), f"Failed: {resp.text}"
    time.sleep(0.5)
    aid = fetch_alert_id(EXTRA_FID, tz_name)
    state["entities"]["alerts_timezone"].append({"name": tz_name, "alert_id": aid})
    print(f"  [OK] {tz_name} (id={aid})")
except Exception as e: print(f"  [FAIL] {tz_name}: {e}")
print()

# 4.9 Scheduled Reports (5) — email to REPORT_EMAIL
print("[4.9] Scheduled Reports...")
dash_ids = [d["dashboard_id"] for d in state["entities"]["dashboards"]]
for i in range(5):
    name = f"report_scheduled_{SUFFIX}_{i}"
    try:
        payload = {
            "dashboards": [{"folder": dash_folder_ids[i], "dashboard": dash_ids[i], "tabs": ["default"], "variables": [],
                "timerange": {"type": "relative", "period": "30m", "from": 0, "to": 0}}],
            "destinations": [{"email": REPORT_EMAIL}], "enabled": True, "media_type": "Pdf",
            "name": name, "title": REPORT_TITLE, "message": "Guardian upgrade testing report", "orgId": ORG_ID,
            "start": int(datetime.now().timestamp() * 1000000),
            "frequency": {"interval": 1, "type": "once", "cron": ""},
            "user": "", "password": "", "timezone": "UTC", "timezoneOffset": 0,
            "owner": EMAIL, "lastEditedBy": EMAIL, "report_type": "PDF"
        }
        resp = session.post(f"{BASE_URL}api/{ORG_ID}/reports", json=payload, headers={"Content-Type": "application/json"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        state["entities"]["reports_scheduled"].append({"name": name})
        print(f"  [OK] {name}")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['reports_scheduled'])}/5")
print()

# 4.10 Cached Reports (5)
print("[4.10] Cached Reports...")
for i in range(5):
    name = f"report_cached_{SUFFIX}_{i}"
    try:
        payload = {
            "dashboards": [{"folder": dash_folder_ids[i], "dashboard": dash_ids[i], "tabs": ["default"], "variables": [],
                "timerange": {"type": "relative", "period": "30m", "from": 0, "to": 0}}],
            "destinations": [], "enabled": True, "media_type": "Pdf",
            "name": name, "title": REPORT_TITLE, "message": "Guardian upgrade testing cached report", "orgId": ORG_ID,
            "start": int(datetime.now().timestamp() * 1000000),
            "frequency": {"interval": 1, "type": "once", "cron": ""},
            "user": "", "password": "", "timezone": "UTC", "timezoneOffset": 0,
            "owner": EMAIL, "lastEditedBy": EMAIL, "report_type": "PDF"
        }
        resp = session.post(f"{BASE_URL}api/{ORG_ID}/reports", json=payload, headers={"Content-Type": "application/json"})
        assert resp.status_code == 200, f"Failed: {resp.text}"
        state["entities"]["reports_cached"].append({"name": name})
        print(f"  [OK] {name}")
    except Exception as e: print(f"  [FAIL] {name}: {e}")
print(f"  => {len(state['entities']['reports_cached'])}/5")
print()

# ============================================================
# STEP 5: Save state
# ============================================================
print("[5] Saving state file...")
state_file = Path(__file__).parent / "devcluster2_default_pre_state.json"
with open(state_file, "w") as f:
    json.dump(state, f, indent=2, default=str)
print(f"[OK] State saved to: {state_file}")
print()

# ============================================================
# SUMMARY
# ============================================================
print("=" * 60)
print("PRE-UPGRADE CREATION SUMMARY")
print("=" * 60)
total = 0
for entity_type, items in state["entities"].items():
    count = len(items)
    total += count
    if count > 0: print(f"  {entity_type}: {count}")
print(f"  TOTAL: {total} entities created")
print(f"  Suffix: {SUFFIX}")
print(f"  Stream: {STREAM_NAME}")
print("=" * 60)
