"""A path ending in `organizations` resolves the caller in the path's org  [#16636, GHSA-29xv-5rx7-5q7v].

Any path whose last segment was `organizations` resolved the caller from any org membership, so a member of
org A could read `/api/{B}/kv/organizations`. The top-level `/api/organizations` list must keep working.

OSS has no org delete, so the fresh org stays behind; its user and the KV key are deleted.
"""

import uuid

import pytest

from support.client import OpenObserveClient


@pytest.fixture(scope="module")
def other_org_member(client: OpenObserveClient):
    """An admin whose only membership is a fresh org, so `default` is an org they do not belong to."""
    suffix = uuid.uuid4().hex[:8]
    resp = client.post("api/organizations", prefix="", json={"name": f"ghsa_auto_{suffix}"})
    assert resp.status_code == 200, f"org create: {resp.status_code} {resp.text}"
    org = resp.json()["identifier"]
    email = f"ghsa_auto_{suffix}@example.com"
    password = "Complexpass#123"
    created = client.post(
        "users",
        org=org,
        json={"email": email, "password": password, "role": "admin", "first_name": "o", "last_name": "b"},
    )
    assert created.status_code == 200, f"user create: {created.status_code} {created.text}"
    try:
        yield {"org": org, "member": OpenObserveClient(email=email, password=password, org=org)}
    finally:
        client.delete(f"users/{email}", org=org)


@pytest.fixture
def kv_named_organizations(client: OpenObserveClient):
    value = f"ghsa-secret-{uuid.uuid4().hex}"
    resp = client.post("kv/organizations", data=value, headers={"Content-Type": "text/plain"})
    assert resp.status_code == 200, f"kv set: {resp.status_code} {resp.text}"
    try:
        yield value
    finally:
        client.delete("kv/organizations")


def test_object_named_organizations_in_another_org_is_refused(
    client: OpenObserveClient, other_org_member: dict, kv_named_organizations: str
):
    member = other_org_member["member"]
    own = member.get("kv/organizations", org=other_org_member["org"])
    assert own.status_code in (200, 404), f"the member cannot reach its own org: {own.status_code} {own.text[:200]}"
    resp = member.get("kv/organizations", org=client.org)
    assert resp.status_code == 401, f"{resp.status_code} {resp.text[:200]}"
    assert kv_named_organizations not in resp.text, "another org's KV value leaked through the org-list bypass"


def test_top_level_org_list_still_resolves_a_member_of_any_org(other_org_member: dict):
    resp = other_org_member["member"].get("api/organizations", prefix="")
    assert resp.status_code == 200, f"{resp.status_code} {resp.text[:200]}"
    identifiers = {o.get("identifier") for o in resp.json().get("data", [])}
    assert identifiers == {other_org_member["org"]}, identifiers
