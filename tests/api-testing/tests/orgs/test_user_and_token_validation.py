"""User listing, org validation and default ingestion tokens  [#9993, #1679, #12407].

#9993 (PR #10004): the root user was omitted from the users list on an OSS
build, so an operator could not see the account they were signed in as.

#1679 (PR #13806): `POST /api/{org_id}/users` accepted an empty or
whitespace-only org_id path segment, creating user records against a
meaningless organization.

#12407 (PR #12412): organizations created before ingestion tokens existed had
none, and no migration backfilled them. The fix creates the default token
lazily when the list endpoint is first called, so simply asking must yield one.
"""

import logging
import os
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
ROOT_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL", "root@example.com")


def test_root_user_is_listed(create_session, base_url):
    """The signed-in root account must appear in the org's user list."""
    session = create_session
    resp = session.get(f"{base_url}api/{ORG_ID}/users")
    assert resp.status_code == 200, f"user list failed: {resp.status_code} {resp.text[:300]}"

    body = resp.json()
    rows = body if isinstance(body, list) else body.get("data", body.get("list", []))
    emails = {(r.get("email") or "").lower() for r in rows if isinstance(r, dict)}
    logger.info("users listed: %s", sorted(emails))
    assert ROOT_EMAIL.lower() in emails, \
        f"root user {ROOT_EMAIL} must be listed, got {sorted(emails)}"


def test_ingestion_tokens_are_created_on_demand(create_session, base_url):
    """Listing tokens must yield the default one even if the org never had it."""
    session = create_session
    resp = session.get(f"{base_url}api/{ORG_ID}/ingestion-tokens")
    assert resp.status_code == 200, \
        f"ingestion-tokens list failed: {resp.status_code} {resp.text[:300]}"

    body = resp.json()
    rows = body if isinstance(body, list) else body.get("data", body.get("list", []))
    logger.info("ingestion tokens returned: %s", len(rows))
    # The defect returned an empty list for orgs predating the feature.
    assert rows, "listing ingestion tokens must create and return the default token"


def test_blank_org_id_does_not_create_a_user(create_session, base_url):
    """A whitespace-only org_id must not produce a user record.

    The status alone is a weak signal: on this build org resolution answers 404
    before `validate_org_id` can return its 400, and either layer refusing is
    acceptable. What the defect actually produced was a user account against a
    meaningless organization, so the assertion is that no such account exists.
    """
    session = create_session
    email = f"e2e_blankorg_{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "email": email,
        "password": "Complexpass#123",
        "role": "admin",
        "first_name": "blank",
        "last_name": "org",
    }
    resp = session.post(f"{base_url}api/%20/users", json=payload)
    logger.info("blank org_id user create answered %s", resp.status_code)
    assert resp.status_code >= 400, \
        f"a whitespace org_id must be rejected, got {resp.status_code}: {resp.text[:300]}"

    listing = session.get(f"{base_url}api/{ORG_ID}/users")
    assert listing.status_code == 200, f"user list failed: {listing.status_code}"
    body = listing.json()
    rows = body if isinstance(body, list) else body.get("data", body.get("list", []))
    emails = {(r.get("email") or "").lower() for r in rows if isinstance(r, dict)}
    assert email.lower() not in emails, \
        f"{email} was created despite the blank org_id being rejected"
