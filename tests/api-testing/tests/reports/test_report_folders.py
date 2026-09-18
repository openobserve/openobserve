"""Report Folders API — CRUD lifecycle, bulk move, and non-empty-delete guard.

Endpoints (verified src/api/management/src/request/folders.rs, folder_type=reports):
  GET/POST   /api/v2/{org}/folders/reports
  GET/PUT/DELETE /api/v2/{org}/folders/reports/{id}
  POST       /api/v2/{org}/reports/move   {report_ids, dst_folder_id}

A folder holding reports cannot be deleted (FolderError::DeleteWithReports -> 400).
Report creation is environment-gated (report save needs Chrome/report-server); the
report-dependent assertions skip cleanly when the server cannot create a report.

Reference: openobserve#11219.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

ORG_ID = "default"
V2 = "api/v2/"
NON_EMPTY_DELETE_ERROR = "Folder contains reports, please move/delete reports from folder"


def _create_folder(client: OpenObserveClient, name: str, description: str = "") -> str:
    resp = client.post("folders/reports", prefix=V2, json={"name": name, "description": description})
    assert resp.status_code == 200, f"folder create failed: {resp.status_code} {resp.text}"
    folder_id = resp.json()["folderId"]
    assert folder_id, f"create response missing folderId: {resp.text}"
    return folder_id


def _delete_folder(client: OpenObserveClient, folder_id: str):
    return client.delete(f"folders/reports/{folder_id}", prefix=V2)


def _try_create_report(client: OpenObserveClient, name: str, folder_id: str) -> str | None:
    """Best-effort create a report in folder_id. Return report_id or None if the
    environment cannot create reports (Chrome/report-server not configured)."""
    payload = {
        "name": name,
        "title": name,
        "org_id": ORG_ID,
        "dashboards": [],
        "destinations": [],
        "description": "o-11219 fixture",
    }
    resp = client.post(f"reports?folder={folder_id}", prefix=V2, json=payload)
    if resp.status_code != 200:
        logger.warning("report create unavailable (%s): %s", resp.status_code, resp.text[:200])
        return None
    for item in client.get("reports", prefix=V2).json():
        if item.get("name") == name:
            return item["report_id"]
    return None


@pytest.fixture
def report_folder(client: OpenObserveClient) -> Generator[str, None, None]:
    """A report folder that is guaranteed to be deleted after the test."""
    folder_id = _create_folder(client, unique_name("pyt_repfolder"), "created by o-11219 test")
    yield folder_id
    try:
        _delete_folder(client, folder_id)
    except Exception as e:
        logger.warning("report_folder cleanup failed for %s: %s", folder_id, e)


class TestReportFolderCRUD:
    """Full create -> list -> get -> update -> delete lifecycle."""

    def test_create_lists_and_reads_back(self, client: OpenObserveClient, report_folder: str):
        """A created report folder appears in the list and reads back by id."""
        listed = client.get("folders/reports", prefix=V2)
        assert listed.status_code == 200, f"list failed: {listed.status_code} {listed.text}"
        ids = [f["folderId"] for f in listed.json().get("list", [])]
        assert report_folder in ids, f"created folder {report_folder} not in list: {ids}"

        got = client.get(f"folders/reports/{report_folder}", prefix=V2)
        assert got.status_code == 200, f"get failed: {got.status_code} {got.text}"
        assert got.json()["folderId"] == report_folder, f"folderId mismatch: {got.text}"

    def test_update_renames_folder(self, client: OpenObserveClient, report_folder: str):
        """PUT updates the folder name and description."""
        new_name = unique_name("pyt_repfolder_upd")
        resp = client.put(
            f"folders/reports/{report_folder}",
            prefix=V2,
            json={"folderId": report_folder, "name": new_name, "description": "updated"},
        )
        assert resp.status_code == 200, f"update failed: {resp.status_code} {resp.text}"

        got = client.get(f"folders/reports/{report_folder}", prefix=V2).json()
        assert got["name"] == new_name, f"name not updated: {got}"
        assert got["description"] == "updated", f"description not updated: {got}"

    def test_delete_empty_folder_succeeds(self, client: OpenObserveClient):
        """An empty report folder deletes with 200 and is gone from the list."""
        folder_id = _create_folder(client, unique_name("pyt_repfolder_del"))

        resp = _delete_folder(client, folder_id)
        assert resp.status_code == 200, f"empty delete failed: {resp.status_code} {resp.text}"

        ids = [f["folderId"] for f in client.get("folders/reports", prefix=V2).json().get("list", [])]
        assert folder_id not in ids, f"deleted folder {folder_id} still listed"


class TestReportFolderMoveAndGuard:
    """Bulk move and the non-empty-delete guard (needs a real report)."""

    def test_move_in_blocks_delete_then_move_out_allows_delete(
        self, client: OpenObserveClient, report_folder: str
    ):
        """Move a report in -> delete blocked (400); move it out -> delete allowed."""
        report_name = f"pyt_o11219_report_{uuid.uuid4().hex[:8]}"
        report_id = _try_create_report(client, report_name, report_folder)
        if report_id is None:
            pytest.skip("report creation unavailable on this server (Chrome/report-server not configured)")

        try:
            in_folder = client.get(f"reports?folder={report_folder}", prefix=V2).json()
            assert any(r["report_id"] == report_id for r in in_folder), (
                f"report {report_id} not in target folder: {in_folder}"
            )

            blocked = _delete_folder(client, report_folder)
            assert blocked.status_code == 400, (
                f"non-empty folder delete should be 400, got {blocked.status_code}: {blocked.text}"
            )
            assert NON_EMPTY_DELETE_ERROR in blocked.text, f"missing guard message: {blocked.text}"

            move_out = client.post(
                "reports/move",
                prefix=V2,
                json={"report_ids": [report_id], "dst_folder_id": "default"},
            )
            assert move_out.status_code == 200, f"move-out failed: {move_out.status_code} {move_out.text}"

            allowed = _delete_folder(client, report_folder)
            assert allowed.status_code == 200, (
                f"emptied folder delete should be 200, got {allowed.status_code}: {allowed.text}"
            )
        finally:
            client.delete(f"reports/{report_id}", prefix=V2)
