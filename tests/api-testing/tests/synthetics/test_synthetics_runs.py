"""Run history of a check: newest-first order, pagination, time filters and the single-run read."""

from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import synthetics_check_payload
from support.wait import wait_until

RUNS = 3


@pytest.fixture(scope="module")
def check_with_runs(client: OpenObserveClient, synthetics_location: str) -> Generator[tuple[str, list[dict]], None, None]:
    """A check with RUNS stored runs, made by the scheduler; no probe is needed, so the runs stay pending."""
    payload = synthetics_check_payload("tcp", synthetics_location, frequency={"type": "hours", "interval": 1, "cron": ""})
    created = client.synthetics.create(payload)
    assert created.status_code == 200, created.text
    check_id = created.json()["id"]
    try:
        resp = client.synthetics.set_enabled(check_id, {"enabled": True})
        assert resp.status_code == 200, resp.text
        try:
            for want in range(1, RUNS + 1):
                if want > 1:
                    assert client.synthetics.run_now(check_id).status_code == 202
                wait_until(
                    lambda want=want: client.synthetics.runs(check_id).json()["total"] >= want,
                    timeout=60,
                    msg=f"run {want} of {check_id} was not stored",
                )
        finally:
            client.synthetics.set_enabled(check_id, {"enabled": False})
        yield check_id, client.synthetics.runs(check_id).json()["runs"]
    finally:
        client.synthetics.delete(check_id)


def test_runs_list_newest_first_with_disjoint_pages(client: OpenObserveClient, check_with_runs):
    check_id, runs = check_with_runs

    assert len(runs) == RUNS
    assert all(r["synthetics_id"] == check_id for r in runs)
    stamps = [r["scheduled_ts"] for r in runs]
    assert stamps == sorted(stamps, reverse=True)

    pages = []
    for page in range(RUNS + 1):
        resp = client.synthetics.runs(check_id, page=page, page_size=1)
        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == RUNS
        pages.append([r["id"] for r in resp.json()["runs"]])
    assert pages == [[r["id"]] for r in runs] + [[]]


def test_runs_time_filters_are_inclusive_bounds_on_scheduled_ts(client: OpenObserveClient, check_with_runs):
    check_id, runs = check_with_runs
    oldest, newest = runs[-1], runs[0]

    after_oldest = client.synthetics.runs(check_id, start_time=oldest["scheduled_ts"] + 1).json()
    assert after_oldest["total"] == RUNS - 1
    assert oldest["id"] not in {r["id"] for r in after_oldest["runs"]}

    up_to_oldest = client.synthetics.runs(check_id, end_time=oldest["scheduled_ts"]).json()
    assert [r["id"] for r in up_to_oldest["runs"]] == [oldest["id"]]

    only_newest = client.synthetics.runs(check_id, start_time=newest["scheduled_ts"], end_time=newest["scheduled_ts"])
    assert [r["id"] for r in only_newest.json()["runs"]] == [newest["id"]]


def test_single_run_read_matches_the_list_row(client: OpenObserveClient, check_with_runs):
    check_id, runs = check_with_runs

    resp = client.synthetics.run(check_id, runs[0]["id"])

    assert resp.status_code == 200, resp.text
    assert resp.json() == runs[0]
    assert client.synthetics.run(check_id, "0000000000000000000000000000").status_code == 404
