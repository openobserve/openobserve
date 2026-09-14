"""
On-Call — acknowledging from the emailed link (§12 of the on-call test plan).

Covers the only UNAUTHENTICATED route in the on-call feature:

    GET  /api/v2/{org}/oncall/ack?token=…   renders a confirmation page
    POST /api/v2/{org}/oncall/ack           form-encoded `token`, this one acts

Both are registered on the router's *basic* plane, outside `auth_middleware`
(src/api/http/src/handler/http/router/mod.rs, the `oncall.enabled` block), so a
responder can answer a page from a phone at 3am without signing in. That is also
why this surface carries the sharpest invariants in the feature — from
`acknowledge()` in src/api/management/src/request/oncall/mod.rs:

  * claims resolve through `service::ack_claims`, not `token::verify`, so §1's
    team scoping governs this route too
  * the token is SPENT BEFORE the acknowledgement — "expiry does not stop a
    replay, and a losing token must not act"
  * a replay is deliberately not an error: acking is idempotent, so a second
    click redirects where the first one landed
  * the redirect carries `org_identifier`, or the app resolves whichever org was
    last selected
  * a GET must only look — a link-prefetching mail gateway would otherwise
    acknowledge a page nobody read

## The token could not be obtained, and nothing here pretends otherwise

An acknowledgement token is minted inside the enterprise crate
(`o2_enterprise::enterprise::oncall::token`) and embedded in the outgoing
notification. Everything reachable from this repo was checked:

  * `GET /api/{org}/oncall/responses/{id}/deliveries` returns `ResponseEvent`
    rows — kind/at/actor/body/rung_micros/ladder_run/recipient/channel/delivered
    (src/config/src/meta/oncall/response.rs). No token, no ack URL.
  * `GET /api/{org}/oncall/my/deliveries` reads `infra::table::oncall_deliveries`,
    whose rows carry no token column either.
  * `POST /api/{org}/oncall/teams/{id}/test-page` puts a real page out but
    returns only reached_anyone/not_sent_because/channels/attempts.
  * The OSS side calls `token::spend` and `token::mark_spent` only; it never
    mints, and `ack_url` is built inside the enterprise `notify` module
    (the one OSS reference, src/jobs/src/job/oncall_maintenance.rs, passes None).
  * No notification- or template-preview route exists.

So 12.3, 12.4 and 12.6 are BLOCKED on a mailbox (or an enterprise mint helper)
and are marked skip with that reason. They are written out in full rather than
stubbed, so they run the moment `minted_ack_token` can return a real one. No
token is fabricated and no verifier is stubbed to turn them green — a test that
passes without exercising `ack_claims` would prove nothing about this route.

12.1, 12.2, 12.5 and 12.7 need only a malformed, expired or foreign token and
run for real. Read the honest note on each: with no signing key on this side, a
401 cannot be attributed to the *specific* check that produced it, so the
expired and foreign-org cases pin "no such token acts", not "the expiry check
fired". 12.7 is live for everything observable without a valid token (a GET
never redirects, never carries a Location) and its full form is skipped.

Never asserted here: the confirmation page's HTML. It is plain markup a person
reads; status codes, headers and the record's resulting state are the contract.
"""

import base64
import json
import os
import uuid

import pytest
import requests

TOKEN_MINT_UNAVAILABLE = (
    "no acknowledgement token is obtainable: it is minted inside "
    "o2_enterprise::enterprise::oncall::token and only ever leaves the server "
    "inside the notification body. The delivery ledger "
    "(GET /oncall/responses/{id}/deliveries), the personal inbox "
    "(GET /oncall/my/deliveries) and test-page all omit it, and no "
    "notification-preview or mint endpoint exists. Needs a captured mailbox or "
    "an enterprise-side mint helper exposed to tests."
)

# JWT-shaped so the route gets something structurally plausible to reject, but
# signed with nothing — this must never be mistaken for a real token.
UNSIGNED_SIGNATURE = "not-a-real-signature"

# Shapes a hostile or broken link can arrive in. Each must be refused, and
# refused the same way: 401 from the claims check.
MALFORMED_TOKENS = [
    pytest.param("", id="empty"),
    pytest.param("not-a-token", id="opaque-garbage"),
    pytest.param("a.b", id="two-segments"),
    pytest.param("....", id="separators-only"),
    pytest.param("../../etc/passwd", id="path-traversal"),
    pytest.param("<script>alert(1)</script>", id="markup"),
    pytest.param("x" * 4096, id="oversized"),
]


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture(scope="module", autouse=True)
def require_oncall(create_session, base_url, org_id):
    """Skip the module unless the build actually serves the ack route.

    `/config` reports `oncall_enabled` from the enterprise config. On an OSS
    build, or with O2_ONCALL_ENABLED off, the route is never registered and
    `/api/v2/…/oncall/ack` falls through to the authenticated catch-all — every
    assertion below would then be measuring the auth middleware instead.
    """
    resp = create_session.get(f"{base_url}api/{org_id}/config")
    if resp.status_code != 200:
        pytest.skip(f"/config unavailable ({resp.status_code}), cannot confirm on-call is enabled")
    if not resp.json().get("oncall_enabled"):
        pytest.skip("on-call is disabled on this build (config.oncall_enabled is false)")


@pytest.fixture
def foreign_org():
    """An org identifier this deployment does not have.

    Unique per test so a parallel worker cannot collide with it, and so nothing
    left behind by another suite can accidentally make it real.
    """
    return f"oncall_ack_absent_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def minted_ack_token():
    """A real token, the response it acks, and its subject — not obtainable.

    Would have to yield (token, response_id, subject_email) for a page that is
    open and whose subject IS on the paged team. See TOKEN_MINT_UNAVAILABLE for
    everything that was checked.
    """
    pytest.skip(TOKEN_MINT_UNAVAILABLE)


# =============================================================================
# Helpers
# =============================================================================

def ack_url(base_url, org):
    return f"{base_url}api/v2/{org}/oncall/ack"


def b64url(payload):
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def forged_token(**claims):
    """A JWT-shaped, unsigned token carrying whatever claims a case needs.

    The real token's internal shape is not visible from this repo, so the claim
    names here are plausible rather than authoritative. That is fine for the
    negative cases: an unsigned token is refused whichever field it got wrong.
    """
    header = b64url({"alg": "HS256", "typ": "JWT"})
    body = b64url(claims)
    return f"{header}.{body}.{UNSIGNED_SIGNATURE}"


def get_ack(base_url, org, token, **kwargs):
    """GET the confirmation page. Never follows the redirect — a followed 303
    would hide both the status and the Location these tests exist to check."""
    return requests.get(ack_url(base_url, org), params={"token": token},
                        allow_redirects=False, timeout=30, **kwargs)


def post_ack(base_url, org, token, **kwargs):
    """POST the form that acts. Redirects deliberately not followed."""
    return requests.post(ack_url(base_url, org), data={"token": token},
                         allow_redirects=False, timeout=30, **kwargs)


def root_basic_auth():
    creds = f"{os.environ['ZO_ROOT_USER_EMAIL']}:{os.environ['ZO_ROOT_USER_PASSWORD']}"
    return {"Authorization": f"Basic {base64.b64encode(creds.encode()).decode()}"}


def assert_did_not_act(resp):
    """Nothing was acknowledged: 303 + Location is the ONLY success signal this
    route emits, so its absence is what "refused" looks like from outside."""
    assert resp.status_code != 303, f"a refused token must not redirect: {resp.text[:300]}"
    assert "Location" not in resp.headers, (
        f"a refused token must carry no Location, got {resp.headers.get('Location')}"
    )


def assert_handler_refused(resp):
    """401 from `ack_claims`, not from the auth middleware.

    The two are distinguishable and the difference is the whole point of the
    route: `AuthError::Unauthorized` attaches `WWW-Authenticate` and a bare-text
    body, while `MetaHttpResponse::error(401, …)` returns JSON with no
    challenge. If this route ever drifts behind `auth_middleware`, the
    challenge header appears and this fails — which is the regression to catch.
    """
    assert resp.status_code == 401, f"expected 401, got {resp.status_code}: {resp.text[:300]}"
    assert "WWW-Authenticate" not in resp.headers, (
        "a WWW-Authenticate challenge means the auth middleware answered, so the "
        "ack route is no longer unauthenticated"
    )
    try:
        body = resp.json()
    except ValueError:
        pytest.fail(
            "the handler answers with a JSON error body; a non-JSON 401 means "
            f"something else refused this: {resp.text[:300]}"
        )
    assert body.get("code") == 401, f"expected the handler's JSON error body, got {body}"
    assert_did_not_act(resp)


# =============================================================================
# The route itself
# =============================================================================

def test_the_ack_route_is_registered_on_both_verbs(base_url, org_id):
    """GET and POST are both served here, and neither is the auth middleware.

    A 401 carrying no challenge proves the request reached `ack_page` /
    `acknowledge`; if the `oncall.enabled` registration were missing, the URL
    would fall through to the authenticated catch-all and answer differently.
    """
    token = forged_token(org_id=org_id)
    assert_handler_refused(get_ack(base_url, org_id, token))
    assert_handler_refused(post_ack(base_url, org_id, token))


@pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE"])
def test_no_other_verb_is_served(base_url, org_id, method):
    """Only GET and POST exist. A third verb must be a method error, never an
    acknowledgement by another name."""
    resp = requests.request(method, ack_url(base_url, org_id),
                            data={"token": forged_token(org_id=org_id)},
                            allow_redirects=False, timeout=30)
    assert resp.status_code == 405, f"{method} should be 405, got {resp.status_code}"
    assert_did_not_act(resp)


# =============================================================================
# 12.1 — malformed or unsigned tokens
# =============================================================================

@pytest.mark.parametrize("token", MALFORMED_TOKENS)
def test_malformed_token_is_refused_by_the_post(base_url, org_id, token):
    """The acting verb refuses anything that is not a signed token: 401."""
    assert_handler_refused(post_ack(base_url, org_id, token))


@pytest.mark.parametrize("token", MALFORMED_TOKENS)
def test_malformed_token_is_refused_by_the_get(base_url, org_id, token):
    """The confirmation page runs the same check, so a leaver never sees the
    button — nor the record's title, which the page would otherwise render."""
    assert_handler_refused(get_ack(base_url, org_id, token))


def test_a_well_formed_token_body_with_no_signature_is_still_refused(base_url, org_id):
    """Claims that look right buy nothing without a signature.

    The nearest thing to a forgery this suite can build: every field a real
    token plausibly carries, base64url-encoded exactly as a JWT would be, and
    the signature segment replaced with text.
    """
    token = forged_token(
        org_id=org_id,
        response_id=str(uuid.uuid4()),
        user_email="forger@example.com",
        expires_at=(1 << 62),
    )
    assert_handler_refused(post_ack(base_url, org_id, token))
    assert_handler_refused(get_ack(base_url, org_id, token))


def test_a_missing_token_is_a_client_error_not_a_bypass(base_url, org_id):
    """No `token` at all must fail extraction, never fall through to a default.

    Asserted as a 4xx rather than an exact code: the GET's rejection comes from
    `Query` and the POST's from `Form`, and those map to different statuses
    across axum versions. What matters is that neither acts.
    """
    for resp in (requests.get(ack_url(base_url, org_id), allow_redirects=False, timeout=30),
                 requests.post(ack_url(base_url, org_id), allow_redirects=False, timeout=30)):
        assert 400 <= resp.status_code < 500, (
            f"a token-less request must be a client error, got {resp.status_code}"
        )
        assert_did_not_act(resp)


# =============================================================================
# Unauthenticated by design — and authentication buys nothing
# =============================================================================

def test_the_route_answers_without_any_credentials(base_url, org_id):
    """No Authorization header, and the handler still answers.

    This is the property the feature depends on: the responder is on a phone,
    not signed in. `assert_handler_refused` is what makes it an assertion
    rather than a coincidence — the middleware's 401 would look different.
    """
    resp = post_ack(base_url, org_id, forged_token(org_id=org_id))
    assert_handler_refused(resp)


def test_root_credentials_do_not_substitute_for_a_token(base_url, org_id):
    """Being signed in as root grants nothing here: the token is the only
    authority this route recognises. The authenticated ack lives at
    POST /api/{org}/oncall/responses/{id}/acknowledge and is a separate surface.
    """
    resp = post_ack(base_url, org_id, forged_token(org_id=org_id), headers=root_basic_auth())
    assert_handler_refused(resp)


def test_a_bogus_authorization_header_changes_nothing(base_url, org_id):
    """Garbage credentials must not turn a token refusal into an auth refusal —
    if they do, the route has moved behind the middleware."""
    bad = base64.b64encode(b"nobody@example.com:wrong-password").decode()
    resp = post_ack(base_url, org_id, forged_token(org_id=org_id),
                    headers={"Authorization": f"Basic {bad}"})
    assert_handler_refused(resp)


# =============================================================================
# 12.2 — expired tokens
# =============================================================================

@pytest.mark.parametrize("expires_at", [0, 1, 1_600_000_000_000_000], ids=["epoch", "1us", "2020"])
def test_an_expired_token_does_not_act(base_url, org_id, expires_at):
    """A token whose expiry has passed is refused on both verbs.

    Honest limit: with no signing key on this side the token is unsigned, so
    the 401 may come from the signature check rather than the TTL check. What
    this pins is the outcome that matters — nothing expired-looking acts, and
    the refusal is the same 401 as every other bad token, leaking no hint about
    which claim was wrong. A build with a real mint should tighten this to a
    genuinely signed, genuinely lapsed token.
    """
    token = forged_token(org_id=org_id, response_id=str(uuid.uuid4()),
                         user_email="lapsed@example.com", expires_at=expires_at)
    assert_handler_refused(post_ack(base_url, org_id, token))
    assert_handler_refused(get_ack(base_url, org_id, token))


def test_expiry_alone_is_not_what_stops_a_replay(base_url, org_id):
    """Guards the ordering comment in `acknowledge`: spend, then acknowledge.

    "Expiry does not stop a replay, and a losing token must not act" — so an
    expired token must be refused BEFORE anything is recorded, exactly like an
    unexpired forgery. Both shapes answering identically is the observable part
    of that invariant; the spend-before-ack ordering itself needs 12.4.
    """
    expired = forged_token(org_id=org_id, expires_at=1)
    live = forged_token(org_id=org_id, expires_at=(1 << 62))
    a, b = post_ack(base_url, org_id, expired), post_ack(base_url, org_id, live)
    assert a.status_code == b.status_code == 401
    assert_did_not_act(a)
    assert_did_not_act(b)


# =============================================================================
# 12.5 — a token presented at the wrong org
# =============================================================================

def test_a_token_for_one_org_is_refused_at_another(base_url, org_id, foreign_org):
    """`ack_claims(token, org_id, now)` takes the org from the URL, so the path
    is part of the check — a link cannot be replayed against a neighbouring
    tenant by editing it.

    Honest limit: the token is unsigned, so this pins the refusal rather than
    proving the org comparison is what refused it. 12.3 would let this be
    tightened to a genuinely valid token moved between orgs.
    """
    token = forged_token(org_id=org_id, response_id=str(uuid.uuid4()),
                         user_email="elsewhere@example.com")
    assert_handler_refused(post_ack(base_url, foreign_org, token))
    assert_handler_refused(get_ack(base_url, foreign_org, token))


def test_the_ack_route_does_not_enumerate_orgs(base_url, org_id, foreign_org):
    """A real org and an absent one answer identically.

    This route is unauthenticated, so a 404 for "no such org" against a 401 for
    "bad token" would turn it into a tenant-name oracle for anyone on the
    internet. Same status, and no 404 either way.
    """
    token = forged_token(org_id=org_id)
    known = post_ack(base_url, org_id, token)
    unknown = post_ack(base_url, foreign_org, token)
    assert known.status_code == unknown.status_code == 401, (
        f"known org answered {known.status_code}, absent org {unknown.status_code} — "
        "a difference here leaks which orgs exist"
    )


# =============================================================================
# 12.7 — a GET must never act
# =============================================================================

@pytest.mark.parametrize("token", MALFORMED_TOKENS)
def test_a_get_never_redirects(base_url, org_id, token):
    """303 + Location is the only thing an acknowledgement emits, and a GET must
    emit neither. A mail gateway prefetching the link would otherwise answer the
    page on the responder's behalf.

    Partial by necessity: without a valid token this covers every shape a
    prefetcher could be handed from a *broken* link, not the real one. The full
    case is the skipped test below.
    """
    assert_did_not_act(get_ack(base_url, org_id, token))


def test_a_get_is_never_answered_with_a_redirect_for_any_token_shape(base_url, org_id):
    """The same guard across the plausible-forgery shapes, including a token
    carrying a far-future expiry — the one most likely to slip past a check that
    was written in the wrong order."""
    for token in (forged_token(org_id=org_id, expires_at=(1 << 62)),
                  forged_token(org_id=org_id, response_id=str(uuid.uuid4())),
                  forged_token()):
        assert_did_not_act(get_ack(base_url, org_id, token))


def test_the_acting_verb_needs_a_form_body(base_url, org_id):
    """A token in the POST's query string is not a submitted form.

    `acknowledge` takes `axum::Form`, which reads the body on a POST; the same
    URL a GET is given must not become an acknowledgement just by flipping the
    method. Status left loose (415 vs 400/422 is an axum detail) — not acting is
    the assertion.
    """
    resp = requests.post(ack_url(base_url, org_id),
                         params={"token": forged_token(org_id=org_id)},
                         allow_redirects=False, timeout=30)
    assert 400 <= resp.status_code < 500, (
        f"an empty-bodied POST must be a client error, got {resp.status_code}"
    )
    assert_did_not_act(resp)


@pytest.mark.skip(reason=TOKEN_MINT_UNAVAILABLE)
def test_a_get_with_a_valid_token_does_not_acknowledge(create_session, base_url, org_id,
                                                       minted_ack_token):
    """12.7 in full: the confirm page renders and the record is untouched."""
    token, response_id, _subject = minted_ack_token

    resp = get_ack(base_url, org_id, token)
    assert resp.status_code == 200
    assert resp.headers.get("Content-Type", "").startswith("text/html")
    assert_did_not_act(resp)

    record = create_session.get(f"{base_url}api/{org_id}/oncall/responses/{response_id}")
    assert record.status_code == 200, record.text
    assert record.json().get("status") != "acknowledged", (
        "a GET acknowledged the page — any mail client that prefetches links now "
        "answers pages on the responder's behalf"
    )

    # The token must survive the look, or the responder's click finds it spent.
    assert post_ack(base_url, org_id, token).status_code == 303


# =============================================================================
# 12.3, 12.4, 12.6 — blocked on a token that cannot be obtained
# =============================================================================

@pytest.mark.skip(reason=TOKEN_MINT_UNAVAILABLE)
def test_a_valid_token_acknowledges_and_redirects_with_the_org(create_session, base_url,
                                                               org_id, minted_ack_token):
    """12.3, and the `org_identifier` invariant with it.

    The query parameter is not decoration: without it the app resolves whichever
    org the browser had selected last, which for a responder in several orgs is
    the wrong one.
    """
    token, response_id, subject = minted_ack_token

    resp = post_ack(base_url, org_id, token)
    assert resp.status_code == 303, resp.text[:300]
    location = resp.headers["Location"]
    assert location.endswith(
        f"/web/oncall/responses/{response_id}?org_identifier={org_id}"
    ), f"redirect must name the record AND the org, got {location}"

    record = create_session.get(f"{base_url}api/{org_id}/oncall/responses/{response_id}")
    assert record.status_code == 200, record.text
    body = record.json()
    assert body.get("status") == "acknowledged"
    assert (body.get("acked_by") or "").lower() == subject.lower(), (
        "the acknowledgement must be attributed to the token's subject, not to "
        "whoever happened to open the link"
    )


@pytest.mark.skip(reason=TOKEN_MINT_UNAVAILABLE)
def test_a_replayed_token_redirects_again_and_records_nothing(create_session, base_url,
                                                              org_id, minted_ack_token):
    """12.4, and invariants 1 and 2 together.

    A second click is not an error — the responder double-taps, or the mail
    client retries — so the replay must land where the first one did. But the
    token was spent before the first acknowledgement, so the second must add
    nothing: same destination, no second Acknowledged event in the timeline.
    """
    token, response_id, _subject = minted_ack_token

    first = post_ack(base_url, org_id, token)
    assert first.status_code == 303, first.text[:300]

    history = create_session.get(f"{base_url}api/{org_id}/oncall/responses/{response_id}/history")
    assert history.status_code == 200, history.text
    before = json.dumps(history.json())

    second = post_ack(base_url, org_id, token)
    assert second.status_code == 303, f"a replay must not be an error: {second.text[:300]}"
    assert second.headers["Location"] == first.headers["Location"], (
        "a replay must land where the first click did"
    )

    after = create_session.get(f"{base_url}api/{org_id}/oncall/responses/{response_id}/history")
    assert after.status_code == 200, after.text
    assert json.dumps(after.json()) == before, (
        "the replay recorded a second acknowledgement — the token was not spent "
        "before the ack, or the spend did not hold"
    )


@pytest.mark.skip(reason=TOKEN_MINT_UNAVAILABLE)
def test_a_token_whose_subject_left_the_team_is_refused(create_session, base_url, org_id,
                                                        minted_ack_token):
    """12.6, and invariant 3: claims resolve through `service::ack_claims`, so
    the same membership check as the authenticated route applies here.

    The token is minted while the subject is on the team and presented after
    they are removed — a leaver's old page email must stop working, or §1's
    team scoping has a hole in it that needs no credentials at all.
    """
    token, response_id, subject = minted_ack_token

    record = create_session.get(f"{base_url}api/{org_id}/oncall/responses/{response_id}")
    assert record.status_code == 200, record.text
    team_id = record.json()["team_id"]

    removed = create_session.delete(
        f"{base_url}api/{org_id}/oncall/teams/{team_id}/members",
        params={"user_email": subject},
    )
    assert removed.status_code == 200, removed.text

    assert_handler_refused(post_ack(base_url, org_id, token))
    assert_handler_refused(get_ack(base_url, org_id, token))

    after = create_session.get(f"{base_url}api/{org_id}/oncall/responses/{response_id}")
    assert after.status_code == 200, after.text
    assert after.json().get("status") != "acknowledged"
