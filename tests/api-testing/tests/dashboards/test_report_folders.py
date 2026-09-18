"""
Report folders API — openobserve#11219.

Folders existed in the DB but the API hardcoded "default". The v2 surface now
offers folder CRUD plus a bulk move, mirroring alerts and dashboards.

Every contract below was probed against a live deployment before the assertions
were written. Three things are not guessable from the issue:

- `report_ids` on the move takes report IDs, not names — a name 404s.
- Report create takes camelCase `orgId`, and the dashboard create response is
  versioned (`{v1..v8}`), with the id on the highest version key.
- A report is deleted by ID through v2; the v1 by-name route 404s for a report
  created this way.
"""

import logging
import os
import time

import pytest

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
DUPLICATE_MSG = "Folder with this name already exists in this organization"


def _folders(base_url):
    return f"{base_url}api/v2/{ORG_ID}/folders/reports"


def _create_folder(session, base_url, name):
    return session.post(_folders(base_url), json={"name": name, "description": "pytest 11219"})


def _delete_folder(session, base_url, folder_id):
    return session.delete(f"{_folders(base_url)}/{folder_id}")


def _list_folder_names(session, base_url):
    resp = session.get(_folders(base_url))
    assert resp.status_code == 200, f"folder list failed: {resp.status_code} {resp.text}"
    return [f["name"] for f in resp.json().get("list", [])]


def _create_dashboard(session, base_url, title):
    resp = session.post(
        f"{base_url}api/{ORG_ID}/dashboards",
        json={"title": title, "description": "pytest 11219", "panels": [], "variables": {"list": []}},
    )
    assert resp.status_code == 200, f"dashboard create failed: {resp.status_code} {resp.text}"
    body = resp.json()
    # Versioned envelope: the id sits under the highest vN key present.
    for key in sorted(body, reverse=True):
        inner = body[key]
        if isinstance(inner, dict) and inner.get("dashboardId"):
            return inner["dashboardId"]
    raise AssertionError(f"no dashboardId in dashboard create response: {body}")


def _create_report(session, base_url, name, dashboard_id, folder_id=None):
    suffix = f"?folder={folder_id}" if folder_id else ""
    return session.post(
        f"{base_url}api/{ORG_ID}/reports{suffix}",
        json={
            "name": name,
            "title": "pytest 11219",
            "orgId": ORG_ID,
            "description": "",
            "message": "",
            "enabled": False,
            "start": int(time.time() * 1_000_000),
            "frequency": {"type": "once", "interval": 1, "cron": ""},
            "dashboards": [{
                "dashboard": dashboard_id,
                "folder": "default",
                "tabs": ["default"],
                "variables": [],
            }],
            "destinations": [{"email": "pytest@example.com"}],
            "mediaType": "Pdf",
        },
    )


def _report_row(session, base_url, name):
    resp = session.get(f"{base_url}api/v2/{ORG_ID}/reports")
    assert resp.status_code == 200, f"report list failed: {resp.status_code} {resp.text}"
    body = resp.json()
    rows = body if isinstance(body, list) else body.get("list", [])
    return next((r for r in rows if r.get("name") == name), None)


def _delete_report(session, base_url, report_id):
    return session.delete(f"{base_url}api/v2/{ORG_ID}/reports/{report_id}")


class TestReportFolders:
    def test_folder_crud_lifecycle(self, create_session, base_url, random_string):
        session = create_session
        name = f"pytest_11219_{random_string(6).lower()}"
        renamed = f"{name}_renamed"
        folder_id = None
        try:
            resp = _create_folder(session, base_url, name)
            assert resp.status_code == 200, \
                f"#11219: report folders must be creatable, got {resp.status_code} {resp.text}"
            folder_id = resp.json()["folderId"]
            assert folder_id, f"#11219: create must return a folderId, got {resp.text}"

            assert session.get(f"{_folders(base_url)}/{folder_id}").status_code == 200, \
                "#11219: a report folder must be fetchable by id"
            assert session.get(f"{_folders(base_url)}/name/{name}").status_code == 200, \
                "#11219: a report folder must be fetchable by name"
            assert name in _list_folder_names(session, base_url), \
                "#11219: a new folder must appear in the folder listing"

            resp = session.put(f"{_folders(base_url)}/{folder_id}",
                               json={"name": renamed, "description": "renamed"})
            assert resp.status_code == 200, \
                f"#11219: a report folder must be renameable, got {resp.status_code} {resp.text}"
            assert renamed in _list_folder_names(session, base_url), \
                "#11219: the rename must be reflected in the listing"

            assert _delete_folder(session, base_url, folder_id).status_code == 200, \
                "#11219: an empty report folder must be deletable"
            folder_id = None

            assert session.get(f"{_folders(base_url)}/name/{renamed}").status_code != 200, \
                "#11219: a deleted folder must no longer resolve by name"
        finally:
            if folder_id:
                _delete_folder(session, base_url, folder_id)

    def test_duplicate_folder_name_is_rejected(self, create_session, base_url, random_string):
        session = create_session
        name = f"pytest_11219_dup_{random_string(6).lower()}"
        folder_id = None
        try:
            resp = _create_folder(session, base_url, name)
            assert resp.status_code == 200, f"first create failed: {resp.status_code} {resp.text}"
            folder_id = resp.json()["folderId"]

            resp = _create_folder(session, base_url, name)
            logger.info("duplicate folder -> %s %s", resp.status_code, resp.text[:160])
            assert resp.status_code == 400, (
                f"#11219: a duplicate report folder name must be rejected with 400, "
                f"got {resp.status_code} {resp.text}"
            )
            assert DUPLICATE_MSG in resp.text, \
                f"#11219: the rejection must name the conflict, got {resp.text}"
        finally:
            if folder_id:
                _delete_folder(session, base_url, folder_id)

    def test_report_moves_between_folders(self, create_session, base_url, random_string):
        """The bulk-move API the issue asked for, plus the non-empty-delete guard."""
        session = create_session
        suffix = random_string(6).lower()
        report_name = f"pytest_11219_rep_{suffix}"
        dst_id = None
        report_id = None
        try:
            dashboard_id = _create_dashboard(session, base_url, f"pytest_11219_dash_{suffix}")
            resp = _create_folder(session, base_url, f"pytest_11219_dst_{suffix}")
            assert resp.status_code == 200, f"folder create failed: {resp.status_code} {resp.text}"
            dst_id = resp.json()["folderId"]

            resp = _create_report(session, base_url, report_name, dashboard_id)
            assert resp.status_code == 200, f"report create failed: {resp.status_code} {resp.text}"

            row = _report_row(session, base_url, report_name)
            assert row, f"#11219: the created report must appear in the v2 listing"
            report_id = row["report_id"]
            logger.info("report %s starts in folder_id=%r", report_id, row.get("folder_id"))

            # report_ids takes IDs; a name 404s here.
            resp = session.patch(
                f"{base_url}api/v2/{ORG_ID}/reports/move",
                json={"report_ids": [report_id], "dst_folder_id": dst_id},
            )
            logger.info("move -> %s %s", resp.status_code, resp.text[:160])
            assert resp.status_code == 200, (
                f"#11219: a report must be movable between folders, "
                f"got {resp.status_code} {resp.text}"
            )

            row = _report_row(session, base_url, report_name)
            assert row.get("folder_id") == dst_id, (
                f"#11219: the move must update folder_id to {dst_id}, got {row.get('folder_id')}"
            )

            # A folder holding a report must not be deletable out from under it.
            resp = _delete_folder(session, base_url, dst_id)
            assert resp.status_code == 400, (
                f"#11219: a folder still holding a report must not be deletable, "
                f"got {resp.status_code} {resp.text}"
            )
        finally:
            if report_id:
                _delete_report(session, base_url, report_id)
            if dst_id:
                _delete_folder(session, base_url, dst_id)

    @pytest.mark.xfail(
        strict=False,
        reason="#11219: POST /reports?folder=<id> ignores the folder and files the report "
               "under 'default' — the hardcoding the issue was raised about. XPASSes once "
               "create honours the folder.",
    )
    def test_report_create_honours_the_folder_parameter(
        self, create_session, base_url, random_string
    ):
        """Asserts the DESIRED behaviour, marked xfail so the suite flips green on the fix."""
        session = create_session
        suffix = random_string(6).lower()
        report_name = f"pytest_11219_cf_{suffix}"
        folder_id = None
        report_id = None
        try:
            dashboard_id = _create_dashboard(session, base_url, f"pytest_11219_cfd_{suffix}")
            resp = _create_folder(session, base_url, f"pytest_11219_cf_{suffix}")
            assert resp.status_code == 200, f"folder create failed: {resp.status_code} {resp.text}"
            folder_id = resp.json()["folderId"]

            resp = _create_report(session, base_url, report_name, dashboard_id, folder_id=folder_id)
            assert resp.status_code == 200, f"report create failed: {resp.status_code} {resp.text}"

            row = _report_row(session, base_url, report_name)
            assert row, "the created report must be listed"
            report_id = row["report_id"]
            assert row.get("folder_id") == folder_id, (
                f"#11219: create with ?folder={folder_id} must file the report there, "
                f"got folder_id={row.get('folder_id')!r}"
            )
        finally:
            if report_id:
                _delete_report(session, base_url, report_id)
            if folder_id:
                _delete_folder(session, base_url, folder_id)
