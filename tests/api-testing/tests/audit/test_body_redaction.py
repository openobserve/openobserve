"""The audit trail must not store credentials  [P0]

Regression cover for o2-enterprise#2818 and #1107, fixed by openobserve#15157.

`audit_middleware` records the request body of every successful non-ingest API
call into the `_meta` org's `audit` logs stream, and the only redaction it
applied was `is_secret_write` — a two-feature route allowlist (Remote Task
secret writes and the prompt webhook secret). Everything else was stored
verbatim. While `O2_AUDIT_ENABLED` defaulted to `false` that was a trade an
operator opted into; #2789 turned it on by default, so every deployment started
writing **plaintext user passwords, old and new passwords on every accepted
password change, webhook URLs and bearer tokens** into a queryable, retained,
backed-up log stream — CWE-532, and a direct PCI-DSS 8.3.1 finding.

The fix made redaction field-level and route-independent (`audit_body` →
`redact_secret_fields` / `redact_form_fields` / `is_secret_field`), because the
route list keeps growing: destinations, service accounts and org settings were
all unredacted and none of them were in the allowlist.

These tests assert the *stored* row, not the fix's internals, so they stay
honest if the implementation is reworked. The paired negative tests matter as
much as the positive ones: a redactor that blanked everything would hide the
bug and make the trail useless, so each credential test is backed by an
assertion that the identifying, non-secret fields survived.

Requires `O2_AUDIT_BATCH_SIZE=1` — see conftest.
"""
from __future__ import annotations

import uuid

from support.client import OpenObserveClient

from .helpers import PROBE_PASSWORD, ROTATED_PASSWORD

REDACTED = "[REDACTED]"


# ─── Credentials must not be stored ───────────────────────────────────────────


def test_a_user_create_does_not_store_the_password(
    client: OpenObserveClient, trail, probe_user: str
):
    """`POST /{org}/users` carries `password` in plaintext. It must not land anywhere
    in the row — not the body, not the path, not the query params."""
    row = trail.row_for(method="POST", path_contains="/users")
    whole = trail.whole_row(row)

    assert PROBE_PASSWORD not in whole, (
        "the user's plaintext password is in the audit row. This is "
        f"o2-enterprise#2818 — every password set in the product logged in clear:\n{whole[:600]}"
    )
    assert REDACTED in (row.get("http_body") or ""), \
        f"the password field must be replaced, not merely dropped: {row.get('http_body')!r}"


def test_a_user_create_still_records_who_was_created(
    client: OpenObserveClient, trail, probe_user: str
):
    """The control. An audit trail that redacts the identity too is not an audit trail."""
    body = trail.body_for(method="POST", path_contains="/users")

    assert probe_user in body, f"the email must be kept so the trail says who was created: {body!r}"
    assert "admin" in body, f"the role must be kept: {body!r}"
    assert "Audit" in body, f"non-secret profile fields must be kept: {body!r}"


def test_a_password_change_stores_neither_the_old_nor_the_new_password(
    client: OpenObserveClient, trail, probe_user: str
):
    """`PUT /{org}/users/{email}` carries `old_password` **and** `new_password`.

    This was the worst case in #2818: every accepted password change logged the
    password being replaced next to the one replacing it, so the trail held a
    history of a user's credentials even after rotation.
    """
    resp = client.put(
        f"users/{probe_user}",
        json={
            "change_password": True,
            "old_password": PROBE_PASSWORD,
            "new_password": ROTATED_PASSWORD,
        },
        raise_for_status=False,
    )
    assert resp.status_code == 200, f"the password change must succeed to be audited: {resp.text}"

    row = trail.row_for(method="PUT", path_contains=f"/users/{probe_user}")
    whole = trail.whole_row(row)

    assert PROBE_PASSWORD not in whole, f"the old password is in the audit row:\n{whole[:600]}"
    assert ROTATED_PASSWORD not in whole, f"the new password is in the audit row:\n{whole[:600]}"
    # Anti-vacuity: the two assertions above would also pass if the body were
    # stored empty, which would be a different bug reading as a pass.
    assert REDACTED in (row.get("http_body") or ""), \
        f"both passwords must be replaced in a body that was actually stored: {row.get('http_body')!r}"


def test_a_password_change_still_records_that_it_was_a_password_change(
    client: OpenObserveClient, trail, probe_user: str
):
    """`change_password: true` is a boolean, so it is deliberately left readable.

    Without it the row would say only that a user was updated, which is the
    detail an auditor most needs from this route. Pinned because "redact
    anything whose name contains 'password'" would take it out.
    """
    resp = client.put(
        f"users/{probe_user}",
        json={
            "change_password": True,
            "old_password": PROBE_PASSWORD,
            "new_password": ROTATED_PASSWORD,
        },
        raise_for_status=False,
    )
    assert resp.status_code == 200, resp.text

    body = trail.body_for(method="PUT", path_contains=f"/users/{probe_user}")
    assert "change_password" in body, (
        "change_password must stay readable, or the row cannot distinguish a "
        f"password change from any other user edit: {body!r}"
    )
    assert "true" in body, \
        f"the boolean's value must survive, not just its key: {body!r}"


def test_a_destination_stores_neither_its_webhook_url_nor_its_auth_header(
    client: OpenObserveClient, trail, probe_destination: dict
):
    """A destination's `url` *is* the credential for Slack-style webhooks, and its
    `headers` carry bearer tokens and PagerDuty routing keys.

    Neither route was in `is_secret_write`'s allowlist, which is why
    #2818 argued for field-level redaction instead of extending the list.
    """
    row = trail.row_for(method="POST", path_contains="/alerts/destinations")
    whole = trail.whole_row(row)

    assert probe_destination["url"] not in whole, \
        f"the webhook URL is in the audit row:\n{whole[:600]}"
    assert "zAuditProbeWebhookToken" not in whole, \
        f"the webhook token is in the audit row:\n{whole[:600]}"
    assert "audit-probe-bearer-token-9f3c" not in whole, \
        f"the Authorization header value is in the audit row:\n{whole[:600]}"
    # Anti-vacuity: an empty stored body would satisfy all three above.
    assert REDACTED in (row.get("http_body") or ""), \
        f"url and headers must be replaced in a body that was actually stored: {row.get('http_body')!r}"


def test_a_destination_still_records_which_destination_it_was(
    client: OpenObserveClient, trail, probe_destination: dict
):
    """The control for the destination case."""
    body = trail.body_for(method="POST", path_contains="/alerts/destinations")

    assert probe_destination["name"] in body, \
        f"the destination name must be kept so the row identifies it: {body!r}"
    assert probe_destination["template"] in body, f"the template must be kept: {body!r}"


# ─── Shape handling ───────────────────────────────────────────────────────────


def test_a_secret_nested_at_depth_is_redacted_and_its_sibling_identifier_kept(
    client: OpenObserveClient, trail, nested_alert: dict
):
    """Redaction recurses, and tells a credential `*key` from an identifier `*key`.

    Both halves in one request, because they are the same judgement call made
    twice: `is_secret_field` matches a *list* of credential key names
    (`api_key`, `signing_key`, …) rather than everything ending in `key`, so
    `api_key` goes and `group_key` stays.

    Driven through an alert create: its `context_attributes` is a free-form map
    nested inside the body, so the secret sits a level down from the top. This
    needs a route that answers 2xx — audit records only successful calls, so a
    rejected request leaves no row and any assertion about it is vacuous.
    """
    row = trail.row_for(method="POST", path_contains="/alerts")
    whole = trail.whole_row(row)
    body = row.get("http_body") or ""

    assert nested_alert["secret"] not in whole, (
        "a secret nested inside context_attributes was stored verbatim — redaction "
        f"must recurse, not just scan the top level:\n{whole[:600]}"
    )
    assert nested_alert["identifier"] in body, (
        "`group_key` is an identifier, not a credential, and must stay readable. "
        "This is also the anti-vacuity check for the assertion above: it proves the "
        f"body was stored and inspected rather than dropped:\n{body[:600]}"
    )


def test_a_form_body_keeps_its_fields_and_drops_only_the_secret_values(
    client: OpenObserveClient, trail
):
    """PromQL is posted form-urlencoded, so it has its own redaction branch.

    `redact_form_fields` keeps every field name and replaces only the values
    whose names look like credentials — the query itself has to stay legible or
    the trail cannot say what was asked.

    This replaces an earlier attempt at the non-JSON branch
    (`[REDACTED: non-JSON body, N bytes]`). That branch is not reachable through
    a 2xx response on any route found — every route tested rejects an unparsable
    body with 400, and audit records only successful calls — so a test for it
    could only ever assert nothing. It stays covered by the Rust unit test
    `audit_body_never_stores_a_body_it_cannot_parse`.
    """
    secret = f"formsecret{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "prometheus/api/v1/query",
        data={"query": "up", "secret_token": secret},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        raise_for_status=False,
    )
    assert resp.status_code == 200, f"the PromQL query must succeed to be audited: {resp.text}"

    row = trail.row_for(method="POST", path_contains="/prometheus/api/v1/query")
    whole = trail.whole_row(row)
    body = row.get("http_body") or ""

    assert secret not in whole, \
        f"a secret-named form value was stored verbatim:\n{whole[:600]}"
    assert "query" in body, (
        "the form's field names must survive — and this is the anti-vacuity check "
        f"for the assertion above: {body!r}"
    )
    assert "up" in body, f"the PromQL query itself must stay legible in the trail: {body!r}"


def test_the_audit_row_records_the_request_it_describes(client: OpenObserveClient, trail):
    """A redaction change must not quietly break the rest of the row.

    If `audit_body` ever threw or returned early, the row could lose the method,
    path or response code and every assertion above would still pass against an
    empty body.
    """
    client.get("settings", raise_for_status=False)
    row = trail.row_for(method="GET", path_contains="/settings")

    assert row.get("http_method") == "GET", f"method must be recorded: {row!r}"
    assert "settings" in (row.get("http_path") or ""), f"path must be recorded: {row!r}"
    assert int(row.get("http_response_code") or 0) == 200, f"response code must be recorded: {row!r}"
    assert row.get("user_email"), f"the caller must be recorded: {row!r}"
