"""Shared deterministic data generator for query agent tests.

Used by both conftest.py (test fixture) and compute_counts.py (DuckDB oracle).
"""

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

random.seed(42)

# Number of queries this generator produces data for.
# build_dataset() default must match this value.
NUM_QUERIES = 675

# Check for a BASE_TS override saved by compute_counts.py so that the
# compute oracle and the test harness share the same BASE_TS. Without
# this, a minute boundary crossing between compute and test shifts
# all histogram bucket timestamps.
_OVERRIDE_FILE = Path(__file__).parent / "base_ts_override.json"
if _OVERRIDE_FILE.exists():
    BASE_TS = json.loads(_OVERRIDE_FILE.read_text())["BASE_TS"]
else:
    _now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    # Anchor BASE_TS 2 hours in the past.  Records span forward from there
    # (BASE_TS to BASE_TS + NUM_QUERIES*60s), so most land in the future.
    # 2h keeps BASE_TS within any server's ZO_INGEST_ALLOWED_UPTO limit
    # (default 5h) while the fixture's wait_until uses end_us=max(now,
    # max_ts)+1h to cover future-dated records on vortex and parquet.
    _span_hours = 2
    BASE_TS = int((_now - timedelta(hours=_span_hours)).timestamp() * 1_000_000)

FIELD_POOL = {
    # --- Original 17 fields (warehouse/sorter themed) ---
        "pallet_id": ['PL-001', 'PL-002', 'PL-003', 'PL-004', 'PL-005', 'PL-006', 'PL-007', 'PL-008'],
        "load_factor": [12.5, 33.0, 55.2, 72.8, 88.1, 94.6, 45.3, 67.9, 21.4, 99.0],
        "charge_remaining": [10.0, 25.0, 42.5, 58.0, 75.3, 88.7, 95.0, 5.0, 33.3, 66.6],
        "throughput_rate": [150.0, 320.0, 480.0, 610.0, 725.0, 840.0, 290.0, 555.0, 190.0, 900.0],
        "sorter_model": ['SORT-X1', 'SORT-A7', 'SORT-M3', 'SORT-Z9', 'SORT-X1', 'SORT-A7', 'SORT-M3', 'SORT-Q5'],
        "conveyor_lane": ['LANE-A', 'LANE-B', 'LANE-C', 'LANE-D', 'LANE-A', 'LANE-B', 'LANE-C', 'LANE-D'],
        "facility_zone": ['ZONE-1', 'ZONE-2', 'ZONE-3', 'ZONE-4', 'ZONE-1', 'ZONE-2', 'ZONE-3', 'ZONE-4'],
        "control_center": ['CC-ALPHA', 'CC-BETA', 'CC-GAMMA', 'CC-DELTA', 'CC-ALPHA', 'CC-BETA', 'CC-GAMMA', 'CC-DELTA'],
        "item_count": [50, 120, 200, 340, 88, 155, 410, 275, 60, 500],
        "defect_limit": [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 0.8, 1.2, 2.8, 3.5],
        "runtime_hours": [24, 72, 168, 360, 720, 48, 120, 500, 90, 1000],
        "operation_mode": ['auto', 'manual', 'hybrid', 'auto', 'manual', 'hybrid', 'auto', 'manual'],
        "package_size": [100, 250, 500, 750, 1000, 200, 350, 600, 850, 1200],
        "scan_attempts": [1, 2, 3, 1, 2, 4, 1, 3, 2, 5],
        "conveyor_segment": [1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
        "cell_temp": [18.5, 22.0, 26.3, 30.1, 35.7, 19.2, 24.8, 28.9, 32.5, 40.0],
    "build_signature": ["BS-2026-A1", "BS-2026-B2", "BS-2026-C3", "BS-2025-D4", "BS-2026-A1",
                        "BS-2026-B2", "BS-2026-C3", "BS-2025-D4", "BS-2026-A1", "BS-2026-B2"],

    # --- New fields for 392-query regression suite ---

    # Text patterns for regexp extraction testing
    "event_detail": [
        "batch ABC123 processed successfully",
        "segment 42 scan completed with no defects",
        "track TRK-abc-def diverted to LANE-B",
        "batch XYZ789 timed out at checkpoint 3",
        "segment 17 weight threshold exceeded",
        "track TRK-ghi-jkl rerouted to ZONE-3",
        "batch MNO456 merged into pallet PL-005",
        "segment 88 speed anomaly detected",
        "track TRK-mno-pqr alignment corrected",
        "batch DEF234 registered at loading dock",
    ],

    # ACK batch reference patterns
    "ack_detail": [
        "ACK batch batchIdList:BT-001-2026 received",
        "ACK batch batchIdList:BT-002-2026 acknowledged",
        "ACK batch batchIdList:BT-003-2026 confirmed",
        "ACK batch batchIdList:BT-004-2026 validated",
        "ACK batch batchIdList:BT-005-2026 processed",
        "ACK batch batchIdList:BT-006-2026 queued",
        "ACK batch batchIdList:BT-007-2026 dispatched",
        "ACK batch batchIdList:BT-008-2026 archived",
        "ACK batch batchIdList:BT-009-2026 retried",
        "ACK batch batchIdList:BT-010-2026 completed",
    ],

    # Log entries with URLs and patterns for LIKE/regexp
    "log_message": [
        "GET /api/v1/warehouse/status 200 OK",
        "POST /api/v2/sorter/scan 201 Created",
        "INFO: batch sync completed, url=http://warehouse.local/sync",
        "WARN: lane jam detected at conveyor_segment=3",
        "ERROR: pallet PL-003 mismatch, retry url=https://warehouse.local/retry",
        "DEBUG: charge_remaining below threshold 15.0",
        "INFO: throughput_rate=840.0 spike at facility_zone=ZONE-4",
        "WARN: cell_temp=38.2 exceeding limit at sorter_model=SORT-Z9",
        "ERROR: scan_attempts exhausted for pallet_id=PL-007",
        "INFO: runtime_hours=1000 maintenance due http://warehouse.local/maint",
    ],

    # Error codes for string matching
    "error_code": [
        "E001", "E002", "E003", "E004", "E005",
        "E006", "E007", "E008", "E009", "E010",
    ],

    # Service owner identifiers (warehouse/sorter themed)
    "service_owner": [
        "@warehouse-Android-sort-v1",
        "@warehouse-iOS-sort-v2",
        "@warehouse-Linux-sort-v3",
        "@warehouse-Windows-sort-v1",
        "@warehouse-Android-scan-v2",
        "@warehouse-iOS-scan-v1",
        "@warehouse-Linux-scan-v3",
        "@warehouse-Windows-scan-v2",
        "@warehouse-Android-track-v1",
        "@warehouse-iOS-track-v3",
    ],

    # Upstream error codes
    "upstream_error_code": [
        "UP-E001", "UP-E002", "UP-E003", "UP-E004", "UP-E005",
        "UP-E006", "UP-E007", "UP-E008", "UP-E009", "UP-E010",
    ],

    # Exception text snippets for regexp extraction
    "exception_message": [
        "NullPointerException at ConveyorController.handle()",
        "TimeoutException: lane LANE-A did not respond within 5000ms",
        "DataIntegrityException: pallet_id PL-002 checksum mismatch",
        "ResourceExhaustedException: sorter_model SORT-M3 queue full",
        "SecurityException: unauthorized access to control_center CC-ALPHA",
        "ConfigurationException: missing facility_zone ZONE-3 override",
        "NetworkException: connection to batch sync failed",
        "ValidationException: item_count exceeds defect_limit bounds",
        "StateTransitionException: operation_mode hybrid invalid state",
        "OverflowException: throughput_rate 999.0 exceeds max capacity",
    ],

    # JSON strings with nested message objects for json_get_str / json_get_json
    "request_payload": [
        '{"message":{"endpoint":"searchItems","status":"ok"}}',
        '{"message":{"endpoint":"updateBatch","status":"pending"}}',
        '{"message":{"endpoint":"deleteRecord","status":"failed"}}',
        '{"message":{"endpoint":"scanPallet","status":"ok"}}',
        '{"message":{"endpoint":"rerouteTrack","status":"queued"}}',
        '{"message":{"endpoint":"mergeBatch","status":"ok"}}',
        '{"message":{"endpoint":"checkThreshold","status":"warning"}}',
        '{"message":{"endpoint":"archiveLog","status":"ok"}}',
        '{"message":{"endpoint":"retryScan","status":"retrying"}}',
        '{"message":{"endpoint":"syncZone","status":"syncing"}}',
    ],

    # JSON array of JSON-encoded strings for spath/unnest/flatten/cast_to_arr testing
    "phase_data": [
        '["{\\"name\\":\\"init\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"process\\",\\"startTime\\":\\"150\\"}"]',
        '["{\\"name\\":\\"init\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"validate\\",\\"startTime\\":\\"200\\"}", "{\\"name\\":\\"complete\\",\\"startTime\\":\\"400\\"}"]',
        '["{\\"name\\":\\"boot\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"calibrate\\",\\"startTime\\":\\"100\\"}"]',
        '["{\\"name\\":\\"scan\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"sort\\",\\"startTime\\":\\"180\\"}", "{\\"name\\":\\"pack\\",\\"startTime\\":\\"360\\"}"]',
        '["{\\"name\\":\\"precheck\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"execute\\",\\"startTime\\":\\"50\\"}", "{\\"name\\":\\"finalize\\",\\"startTime\\":\\"300\\"}"]',
        '["{\\"name\\":\\"queue\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"dequeue\\",\\"startTime\\":\\"70\\"}", "{\\"name\\":\\"dispatch\\",\\"startTime\\":\\"140\\"}"]',
        '["{\\"name\\":\\"load\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"unload\\",\\"startTime\\":\\"250\\"}"]',
        '["{\\"name\\":\\"acquire\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"process\\",\\"startTime\\":\\"90\\"}", "{\\"name\\":\\"release\\",\\"startTime\\":\\"270\\"}"]',
        '["{\\"name\\":\\"merge\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"split\\",\\"startTime\\":\\"120\\"}", "{\\"name\\":\\"route\\",\\"startTime\\":\\"240\\"}"]',
        '["{\\"name\\":\\"start\\",\\"startTime\\":\\"0\\"}", "{\\"name\\":\\"pause\\",\\"startTime\\":\\"160\\"}", "{\\"name\\":\\"resume\\",\\"startTime\\":\\"320\\"}", "{\\"name\\":\\"stop\\",\\"startTime\\":\\"480\\"}"]',
    ],

    # JSON array strings for array_element testing
    "db_info": [
        '["cid-abc123","status-ok"]',
        '["cid-def456","status-pending"]',
        '["cid-ghi789","status-failed"]',
        '["cid-jkl012","status-ok"]',
        '["cid-mno345","status-retrying"]',
        '["cid-pqr678","status-ok"]',
        '["cid-stu901","status-warning"]',
        '["cid-vwx234","status-ok"]',
        '["cid-yza567","status-error"]',
        '["cid-bcd890","status-ok"]',
    ],

    # API names for str_match_ignore_case testing
    "api_name": [
        "SearchItems", "UpdateBatch", "DeleteRecord", "ScanPallet",
        "RerouteTrack", "MergeBatch", "CheckThreshold", "ArchiveLog",
        "RetryScan", "SyncZone",
    ],

    # IP addresses
    "node_ip": [
        "10.12.0.101", "10.12.0.102", "10.12.0.103", "10.12.0.104", "10.12.0.105",
        "10.12.1.201", "10.12.1.202", "10.12.1.203", "10.12.1.204", "10.12.1.205",
    ],

    # Source IPs
    "source_ip": [
        "192.168.1.10", "192.168.1.11", "192.168.1.12", "192.168.1.13", "192.168.1.14",
        "192.168.2.20", "192.168.2.21", "192.168.2.22", "192.168.2.23", "192.168.2.24",
    ],

    # String tags
    "tag_a": [
        "prod", "staging", "dev", "prod", "staging",
        "dev", "prod", "staging", "dev", "prod",
    ],
    "tag_b": [
        "critical", "high", "medium", "low", "critical",
        "high", "medium", "low", "critical", "high",
    ],

    # Source identifiers
    "query_source": [
        "dashboard", "cli", "api", "scheduler", "dashboard",
        "cli", "api", "scheduler", "dashboard", "cli",
    ],

    # Region codes
    "region_code": [
        "US-EAST", "US-WEST", "EU-WEST", "EU-NORTH", "AP-SOUTH",
        "AP-EAST", "SA-EAST", "US-CENTRAL", "EU-CENTRAL", "AP-CENTRAL",
    ],

    # User agent strings
    "client_agent": [
        "Mozilla/5.0 WarehouseScanner/1.0",
        "curl/7.88.1 (x86_64-pc-linux-gnu)",
        "Python-urllib/3.11 warehouse-client",
        "Java/17.0.8 (OpenJDK; sorter-agent)",
        "Go-http-client/2.0 conveyor-monitor",
        "PostmanRuntime/7.35.0",
        "axios/1.6.0 (Node.js; warehouse-ui)",
        "okhttp/4.12.0 (Android; sort-app)",
        "Alamofire/5.8.0 (iOS; scan-app)",
        "node-fetch/3.3.2 (tracking-service)",
    ],

    # Operation names
    "operation_name": [
        "SearchItems", "UpdateBatch", "DeleteRecord", "ScanPallet",
        "RerouteTrack", "MergeBatch", "CheckThreshold", "ArchiveLog",
        "RetryScan", "SyncZone",
    ],

    # Site identifiers
    "site_name": [
        "site-nyc-01", "site-lon-02", "site-tok-03", "site-syd-04", "site-sfo-05",
        "site-ber-06", "site-dub-07", "site-sin-08", "site-mum-09", "site-tor-10",
    ],

    # URL paths
    "endpoint_path": [
        "/api/v1/warehouse/search",
        "/api/v1/warehouse/update",
        "/api/v1/warehouse/delete",
        "/api/v2/sorter/scan",
        "/api/v2/sorter/reroute",
        "/api/v2/sorter/merge",
        "/api/v1/health/check",
        "/api/v1/archive/log",
        "/api/v2/sorter/retry",
        "/api/v1/zone/sync",
    ],

    # HTTP methods
    "http_method": [
        "GET", "POST", "PUT", "DELETE", "GET",
        "POST", "PUT", "DELETE", "GET", "POST",
    ],

    # HTTP status codes
    "response_code": [
        200, 201, 204, 400, 404,
        500, 503, 401, 403, 200,
    ],

    # Scan type categories
    "scan_category": [
        "inbound", "outbound", "internal", "inbound", "outbound",
        "internal", "inbound", "outbound", "internal", "inbound",
    ],

    # Auth results
    "auth_result": [
        "pass", "fail", "denied", "pass", "pass",
        "fail", "denied", "pass", "fail", "pass",
    ],

    # Task identifiers
    "task_id": [
        "task-a1b2c3", "task-d4e5f6", "task-g7h8i9", "task-j0k1l2", "task-m3n4o5",
        "task-p6q7r8", "task-s9t0u1", "task-v2w3x4", "task-y5z6a7", "task-b8c9d0",
    ],

    # Entity identifiers
    "entity_id": [
        "ent-001-wh", "ent-002-wh", "ent-003-wh", "ent-004-wh", "ent-005-wh",
        "ent-006-wh", "ent-007-wh", "ent-008-wh", "ent-009-wh", "ent-010-wh",
    ],

    # Alert tag strings
    "alert_tags": [
        "latency", "error", "capacity", "latency", "security",
        "error", "capacity", "latency", "error", "capacity",
    ],

    # Issue type strings
    "issue_type": [
        "timeout", "overflow", "mismatch", "jam", "timeout",
        "overflow", "mismatch", "jam", "timeout", "overflow",
    ],

    # Filter result strings
    "filter_result": [
        "allow", "block", "allow", "allow", "block",
        "allow", "block", "allow", "allow", "block",
    ],

    # Guard mode values
    "guard_mode": [
        "active", "passive", "disabled", "active", "passive",
        "active", "passive", "disabled", "active", "passive",
    ],

    # Record type identifiers
    "record_type": [
        "scan", "sort", "merge", "track", "scan",
        "sort", "merge", "track", "scan", "sort",
    ],

    # File paths
    "resource_path": [
        "/logs/warehouse/app.log",
        "/data/sorter/output.dat",
        "/config/zone/ZONE-1.yaml",
        "/logs/warehouse/error.log",
        "/data/sorter/input.dat",
        "/config/zone/ZONE-2.yaml",
        "/logs/warehouse/access.log",
        "/data/sorter/temp.dat",
        "/config/zone/ZONE-3.yaml",
        "/logs/warehouse/audit.log",
    ],

    # Integer latency values
    "latency_ms": [
        12, 45, 230, 1450, 89,
        567, 3200, 78, 1900, 15,
    ],

    # Organization names
    "org_name": [
        "warehouse-east", "warehouse-west", "warehouse-north", "warehouse-south",
        "warehouse-central", "warehouse-east", "warehouse-west", "warehouse-north",
        "warehouse-south", "warehouse-central",
    ],

    # Boolean-like values
    "threat_flag": [
        "false", "true", "false", "false", "true",
        "false", "true", "false", "false", "true",
    ],

    # Version strings
    "build_version": [
        "v1.0.0", "v1.1.2", "v2.0.0", "v2.1.3", "v2.2.0",
        "v3.0.1", "v3.1.0", "v1.0.5", "v2.0.8", "v3.2.0",
    ],

    # Bin codes
    "bin_code": [
        "BIN-A1", "BIN-B2", "BIN-C3", "BIN-D4", "BIN-E5",
        "BIN-F6", "BIN-G7", "BIN-H8", "BIN-I9", "BIN-J0",
    ],

    # Integer sizes
    "payload_size": [
        512, 1024, 2048, 4096, 8192,
        16384, 256, 32768, 65536, 128,
    ],

    # Component identifiers
    "component_name": [
        "sorter-engine", "conveyor-driver", "zone-controller", "scan-hub",
        "track-router", "batch-sync", "pallet-mapper", "lane-monitor",
        "temp-regulator", "charge-checker",
    ],

    # Routing keys
    "route_key": [
        "rk-warehouse-001", "rk-warehouse-002", "rk-warehouse-003",
        "rk-warehouse-004", "rk-warehouse-005", "rk-warehouse-006",
        "rk-warehouse-007", "rk-warehouse-008", "rk-warehouse-009",
        "rk-warehouse-010",
    ],

    # Token strings
    "auth_token": [
        "tok-wh-abc123def456", "tok-wh-ghi789jkl012", "tok-wh-mno345pqr678",
        "tok-wh-stu901vwx234", "tok-wh-yza567bcd890", "tok-wh-efg123hij456",
        "tok-wh-klm789nop012", "tok-wh-qrs345tuv678", "tok-wh-wxy901zab234",
        "tok-wh-cde567fgh890",
    ],

    # Application labels
    "app_label": [
        "warehouse-sort", "warehouse-scan", "warehouse-track", "warehouse-merge",
        "warehouse-sync", "warehouse-sort", "warehouse-scan", "warehouse-track",
        "warehouse-merge", "warehouse-sync",
    ],

    # --- Synthetic fields for Q393-Q417 (A/B testing + security/bot-detection) ---

    "variant_tag": [
        "control", "variant_a", "variant_b", "variant_c", "control",
        "variant_a", "variant_b", "variant_c", "control", "variant_a",
    ],

    "cookie_id": [
        "sess_abc123", "sess_def456", "ctl_xyz789", "var1_pqr012", "var2_mno345",
        "sess_abc123", "var3_stu678", "ctl_vwx901", "sess_def456", "var1_yza234",
    ],

    "status_code": [
        "200", "200", "200", "500", "404",
        "200", "502", "200", "403", "200",
    ],

    "lcp_micros": [
        1200000, 2500000, 1800000, 3200000, 900000,
        1500000, 2800000, 2100000, 3400000, 1100000,
    ],

    "inp_micros": [
        80000, 150000, 200000, 95000, 300000,
        120000, 180000, 250000, 70000, 160000,
    ],

    "cls_score": [
        0.05, 0.12, 0.08, 0.25, 0.03,
        0.15, 0.10, 0.20, 0.30, 0.06,
    ],

    "device_type": [
        "Mobile", "Computer", "Tablet", "Mobile", "Computer",
        "Mobile", "Tablet", "Computer", "Mobile", "Computer",
    ],

    "page_slug": [
        "itemPage", "searchPage", "cartPage", "itemPage", "checkoutPage",
        "itemPage", "homePage", "itemPage", "searchPage", "itemPage",
    ],

    "action_category": [
        "performanceMetric", "performanceMetric", "interaction", "navigation", "performanceMetric",
        "interaction", "performanceMetric", "navigation", "performanceMetric", "performanceMetric",
    ],

    "action_subcategory": [
        "vitalsLcp", "vitalsInp", "vitalsCls", "clickEvent", "vitalsLcp",
        "vitalsInp", "vitalsCls", "pageView", "vitalsLcp", "vitalsInp",
    ],

    "page_url": [
        "https://shop.example.com/item/1001",
        "https://shop.example.com/item/1002",
        "https://shop.example.com/search?q=test",
        "https://shop.example.com/item/1003",
        "https://shop.example.com/cart",
        "https://shop.example.com/item/1004",
        "https://shop.example.com/",
        "https://shop.example.com/item/1005",
        "https://shop.example.com/item/1006",
        "https://shop.example.com/item/1007",
    ],

    "render_scope": [
        "SSR", "CSR", "SSR", "SSR", "CSR",
        "SSR", "CSR", "SSR", "SSR", "CSR",
    ],

    "os_platform": [
        "Android 14", "iOS 17.4", "Android 13", "Mac OS X (iPhone)", "Windows 11",
        "Android 14", "iOS 18.1", "Android 12", "Mac OS X (iPhone)", "Android 14",
    ],

    "attack_name": [
        "SQL Injection (Param)", "XSS Reflected (Header)", "Path Traversal", "CSRF Attempt", "SSRF Probe",
        "Command Injection", "XSS Stored (Body)", "File Inclusion", "Desync Attack", "Evasion Technique",
    ],

    # Named http_request instead of request_payload to avoid collision with the
    # existing request_payload field (JSON message objects, lines 130-141 above).
    "http_request": [
        "GET /api/users?id=1",
        "POST /api/order {\"item\":123}",
        "GET /search?q=test",
        "GET /favicon.ico",
        "POST /admin/config",
        "GET /api/products",
        "PUT /api/cart/update",
        "DELETE /api/session",
        "GET /.env",
        "POST /api/login {\"user\":\"admin\"}",
    ],

    "user_agent_str": [
        "Mozilla/5.0 Chrome/120",
        "curl/7.88.1",
        "python-requests/2.31",
        "Mozilla/5.0 Firefox/121",
        "PostmanRuntime/7.35",
        "Mozilla/5.0 Safari/17.2",
        "axios/1.6.0",
        "Go-http-client/2.0",
        "Java/11.0.20",
        "Mozilla/5.0 Edge/120",
    ],

    "uri_path": [
        "/api/v1/data", "/swag/graphql", "/ip/192.168.1.1", "/admin/login", "/api/v2/search",
        "/assets/js/app.js", "/swag/graphql", "/api/v1/users", "/health", "/ip/10.0.0.1",
    ],

    "geo_org": [
        "Acme Corp", "GlobalTech Inc", "DigitalOcean LLC", "FastHost Ltd", "CloudServe GmbH",
        "Acme Corp", "NetGuard AS", "HostPro Inc", "CloudServe GmbH", "DataCenter EU",
    ],

    "geo_country": [
        "US", "DE", "UK", "US", "BR",
        "US", "JP", "US", "IN", "US",
    ],

    "geo_user_type": [
        "business", "hosting", "business", "business", "hosting",
        "business", "education", "business", "hosting", "business",
    ],

    "risk_rules_list": [
        '["rate_limit_exceeded","geo_anomaly"]',
        '["torbot_ua_mismatch","cookie_reuse"]',
        '["credential_stuffing","rapid_login"]',
        '["session_hijack","ip_hop"]',
        '["scraping_pattern","high_freq"]',
        '["rate_limit_exceeded"]',
        '["torbot_ua_mismatch"]',
        '["cookie_reuse","session_hijack"]',
        '["credential_stuffing"]',
        '["scraping_pattern","ip_hop","rapid_login"]',
    ],

    "visitor_session_id": [
        "sess_001", "sess_001", "sess_002", "sess_003", "sess_002",
        "sess_001", "sess_004", "sess_003", "sess_005", "sess_001",
    ],

    "bot_flag": [
        None, None, None, "suspicious", None,
        None, "verified_bot", None, None, None,
    ],

    "passthrough_flag": [
        "false", "false", "false", "true", "false",
        "false", "false", "true", "false", "false",
    ],

    "order_ref": [
        "ORD-001", "ORD-002", "ORD-001", "ORD-003", "ORD-004",
        "ORD-005", "ORD-003", "ORD-006", "ORD-007", "ORD-008",
    ],

    "info_tag": [
        None, None, "Allowlisted", None, None,
        None, "Blocklisted", None, None, None,
    ],

    "graphql_operation": [
        "updateItems", "placeOrder", "verifyPayment", "updateCart", "createAccount",
        "updateItems", "getInventory", "placeOrder", "updateItems", "verifyPayment",
    ],

    "datacenter": [
        "dc-east", "dc-west", "dc-east", "dc-central", "dc-west",
        "dc-east", "dc-central", "dc-west", "dc-east", "dc-west",
    ],
}

STREAM_VALUES = ["stdout", "stdout", "stdout", "stderr"]

# Fields that are NULL for some records to exercise COALESCE / IS NULL /
# IS NOT NULL paths.  Two out of every five records per query get None
# for these fields.
_NULLABLE_FIELDS = {
    "bot_flag", "info_tag", "upstream_error_code", "page_url",
    "endpoint_path", "resource_path", "variant_tag", "threat_flag",
}


def make_record(ts, idx, qid, stream_offset=0):
    """Build a single deterministic data record.

    Each field uses a different rotation offset so field-value
    combinations vary independently — no two fields pick from the same
    pool position for the same (idx, qi) pair.

    stream_offset shifts the per-field rotation so the same (qi, idx)
    produces different values for a secondary stream while keeping
    partial overlap on join keys (pallet_id, org_name, etc.).

    IMPORTANT: stream_offset only affects field VALUES, NOT timestamps.
    Both streams generate records at the same _timestamp values (same
    BASE_TS, same per-query time windows).  This means cross-stream
    JOIN queries can use a single time_offset — both streams' records
    for a given query fall within the same 74-second window.

    The log field always uses the original qid (unshifted) so that log
    entries are tagged with the query that owns them, regardless of
    stream_offset.  Only qi (used for per-field rotation) is shifted.
    """
    qi = int(qid[1:]) + stream_offset
    # Vary the log field: some records get an ACK batch suffix for
    # str_match_ignore_case testing on ack_detail-like patterns.
    if idx % 3 == 0:
        log = f"{qid} warehouse event record {idx} ACK batch batchIdList:{qid}-{idx}"
    elif idx % 5 == 0:
        log = f"{qid} warehouse event record {idx} error E{idx:03d} traceback"
    else:
        log = f"{qid} warehouse event record {idx}"

    r = {
        "_timestamp": ts,
        "log": log,
        "stream": STREAM_VALUES[(idx + qi) % len(STREAM_VALUES)],
    }
    # Per-field rotation: multipliers 13 and 7 are coprime with all pool
    # sizes (8, 10) and with each other, so every (qi, idx) pair produces
    # a unique value fingerprint.  Two records with the same idx but
    # different qi get different values for every field.
    # NULL injection: (idx + qi) % 5 ∈ {1, 3} gives a deterministic 40 %
    # rate across the 5-record window, varying which records are nulled
    # per query so both nullable and non-nullable combinations appear.
    inject_null = (idx + qi) % 5 in (1, 3)
    for i, (field, pool) in enumerate(FIELD_POOL.items()):
        if inject_null and field in _NULLABLE_FIELDS:
            r[field] = None
            continue
        offset = (qi * 13 + i * 7) % len(pool)
        r[field] = pool[(idx + offset) % len(pool)]

    return r


def build_dataset(num_queries=NUM_QUERIES, stream_offset=0):
    """Generate deterministic records for queries Q001-Q{num_queries}.

    Each query gets 5 records spaced 18 seconds apart within its own
    non-overlapping 60-second time window.

    stream_offset shifts field rotation for secondary streams while
    preserving shared time windows and partial join-key overlap.
    """
    records = []
    for qi in range(1, num_queries + 1):
        qid = f"Q{qi:03d}"
        base = BASE_TS + (qi - 1) * 60_000_000
        for i in range(5):
            ts = base + i * 18_000_000
            records.append(make_record(ts, i, qid, stream_offset))
    return records
