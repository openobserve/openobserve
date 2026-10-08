"""gRPC Ingest is a cluster-internal RPC, closed to user credentials  [P0]

Regression cover for o2-enterprise#2821, where any credential valid in one org
could write logs, traces, metrics, enrichment-table rows and service-graph
edges into any *other* org through `cluster.Ingest` — on the main gRPC
listener, the same port collectors point at.

`check_auth` authenticated a user credential against the `organization`
*metadata header*, then `attach_user_id` appended `user_id` and dropped the
org, so the handler never saw which org had been authorized. `Ingest::ingest`
read `org_id` from the request *body* and passed it to all five arms, and
`logs::ingest::ingest` performs no org authorization of its own.

Two fixes landed, and this suite pins the outer one:

- openobserve#15157 added `destination_org(user_id, header_org, body_org)` in
  the handler, mirroring the rule `stream.rs` already had.
- openobserve#15054 then moved the whole service behind
  `internal_authenticated`, so `check_internal_auth` admits only the internal
  or super-cluster token and *no* user credential reaches the handler at all.

With #15054 in place `destination_org`'s branches are unreachable over the
wire, so they are covered by the Rust unit tests beside it in
`src/api/grpc/src/handler/grpc/request/ingest.rs` rather than from here. What
is left to assert end-to-end is the rule that now stands in front of them: a
user credential cannot call `cluster.Ingest`, whatever pair of orgs it names.

The accepted path is not covered here — it needs the deployment's
`ZO_INTERNAL_GRPC_TOKEN`, and with that token keeping the body org is the
correct cluster-forwarding behaviour rather than a cross-tenant write.
"""
from __future__ import annotations

import json
import os
import uuid
from collections.abc import Generator

import grpc
import pytest

from support.client import OpenObserveClient
from support.cluster_ingest import basic_auth, grpc_target, ingest

ROWS = json.dumps([{"injected_by": "grpc_org_binding_test", "n": 1}]).encode()

# `_meta` as the second tenant: orgs have no DELETE route, so creating one leaks a tenant per run.
OTHER_ORG = "_meta"

# Which guard refused, by its marker: [6] is check_internal_auth, [1] is a missing token header.
INTERNAL_AUTH_MARKER = "token[6]"
MISSING_TOKEN_MARKER = "token[1]"

# Every pair of orgs a caller can name, including the cross-org shape that was #2821.
ORG_SHAPES = [
    pytest.param("default", "default", id="header_and_body_agree"),
    pytest.param("default", "", id="body_org_omitted"),
    pytest.param("default", OTHER_ORG, id="body_names_another_org"),
    pytest.param(OTHER_ORG, OTHER_ORG, id="header_and_body_name_another_org"),
    pytest.param(None, "default", id="no_organization_header"),
]


@pytest.fixture(scope="module")
def channel():
    # No skip-on-unreachable: a lost listener must fail this P0 suite, not pass it silently.
    ch = grpc.insecure_channel(grpc_target())
    grpc.channel_ready_future(ch).result(timeout=30)
    yield ch
    ch.close()


@pytest.fixture(scope="module")
def root_auth() -> str:
    return basic_auth(os.environ["ZO_ROOT_USER_EMAIL"], os.environ["ZO_ROOT_USER_PASSWORD"])


@pytest.fixture(scope="module")
def member_auth(client: OpenObserveClient) -> Generator[str, None, None]:
    """Basic auth for an ordinary admin of `default`, the attacker shape in #2821.

    Root is admitted to every org by `is_root_user`, so a root-only suite would
    never exercise a credential that is genuinely scoped to one tenant. Creates
    and removes its own user because `temp_user_email` is function-scoped.
    """
    email = f"grpc_org_binding_{uuid.uuid4().hex[:8]}@example.com"
    password = "Complexpass#123"
    resp = client.users.create({
        "email": email, "password": password,
        "first_name": "Grpc", "last_name": "Member", "role": "admin",
    })
    assert resp.status_code == 200, f"could not create the member user: {resp.status_code} {resp.text}"
    yield basic_auth(email, password)
    client.users.delete(email)


@pytest.fixture
def stream_name(client: OpenObserveClient) -> Generator[str, None, None]:
    """A unique stream name, swept from both orgs afterwards.

    A refused call creates nothing, but ingest auto-creates streams, so a
    regression that let one through would otherwise leave it behind. Both orgs
    are swept because which one a write lands in is what is in question here.
    """
    name = f"grpc_org_binding_{uuid.uuid4().hex[:8]}"
    yield name
    for org in ("default", OTHER_ORG):
        client.delete(f"streams/{name}?type=logs", org=org, raise_for_status=False)


def _assert_refused(result, what: str, marker: str = INTERNAL_AUTH_MARKER) -> None:
    """Assert the call was refused, and by the guard `marker` names.

    The status code alone is not enough: `check_auth` also answers
    UNAUTHENTICATED when a credential fails its own membership or password
    comparison, so several shapes below would stay green on a build that had
    reverted #15054 and put the service back within reach of user credentials.
    Verified against a pre-fix build, where the no-credential call answers `[1]`
    and every credentialled shape answers OK or InvalidArgument — so each
    assertion here distinguishes the two builds.
    """
    assert result.code == grpc.StatusCode.UNAUTHENTICATED, (
        f"{what} must be refused, got {result.code} (status_code={result.status_code}, "
        f"{result.message or result.details!r}). cluster.Ingest is an internal RPC; a user "
        "credential reaching it is o2-enterprise#2821's precondition."
    )
    assert marker in result.details, (
        f"{what} was refused, but not by the expected guard: {result.details!r} does not carry "
        f"{marker!r}. For {INTERNAL_AUTH_MARKER!r}, a refusal from check_auth instead means the "
        "service is no longer behind internal_authenticated (openobserve#15054)."
    )


# ─── No user credential may call cluster.Ingest ───────────────────────────────


@pytest.mark.parametrize(("header_org", "body_org"), ORG_SHAPES)
def test_the_root_credential_cannot_call_ingest(
    channel, root_auth: str, stream_name: str, header_org: str | None, body_org: str
):
    """Not even root, the strongest user credential, is admitted."""
    result = ingest(
        channel, body_org=body_org, stream_name=stream_name, rows=ROWS,
        authorization=root_auth, header_org=header_org,
    )
    _assert_refused(result, f"root with header={header_org!r} body={body_org!r}")


@pytest.mark.parametrize(("header_org", "body_org"), ORG_SHAPES)
def test_a_member_credential_cannot_call_ingest(
    channel, member_auth: str, stream_name: str, header_org: str | None, body_org: str
):
    """The attacker shape: a real member of `default`, naming each org pair."""
    result = ingest(
        channel, body_org=body_org, stream_name=stream_name, rows=ROWS,
        authorization=member_auth, header_org=header_org,
    )
    _assert_refused(result, f"a member of 'default' with header={header_org!r} body={body_org!r}")


def test_a_call_with_no_credential_is_refused(channel, stream_name: str):
    """Refused by `auth_token`, which runs before the internal-token comparison."""
    result = ingest(channel, body_org="default", stream_name=stream_name, rows=ROWS)
    _assert_refused(result, "a call with no authorization metadata", marker=MISSING_TOKEN_MARKER)


# ─── The refusal writes nothing ───────────────────────────────────────────────


def _stream_exists(client: OpenObserveClient, org: str, name: str) -> bool:
    """Whether `name` exists in `org`.

    Asserts the listing succeeded rather than returning False on an error: a
    failed list would otherwise read as "the stream is absent" and turn the
    caller into a vacuous pass.
    """
    resp = client.get("streams", org=org, raise_for_status=False)
    assert resp.status_code == 200, \
        f"could not list streams in {org!r} ({resp.status_code}), so absence cannot be asserted: {resp.text[:200]}"
    return any(s.get("name") == name for s in resp.json().get("list", []))


def test_the_refused_write_reaches_neither_org(
    client: OpenObserveClient, channel, member_auth: str, stream_name: str
):
    """The status code is not the whole claim — nothing may be written either.

    A refusal that still created the stream would leave the caller in control
    of stream names and schema in another tenant's org, which is half of
    #2821's impact.
    """
    result = ingest(
        channel, body_org=OTHER_ORG, stream_name=stream_name, rows=ROWS,
        authorization=member_auth, header_org="default",
    )
    _assert_refused(result, f"a member of 'default' naming {OTHER_ORG!r} in the body")

    for org in (OTHER_ORG, "default"):
        assert not _stream_exists(client, org, stream_name), (
            f"the refused write must not create {stream_name!r} in {org!r}; ingest "
            "auto-creates streams, so a refusal that still wrote would hand the caller "
            "stream names and schema in an org it never authenticated against"
        )
