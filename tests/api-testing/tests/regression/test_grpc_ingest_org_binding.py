"""gRPC Ingest must write only to the org it authenticated  [P0]

Regression cover for o2-enterprise#2821, fixed by openobserve#15157.

`check_auth` authenticates a user credential against the `organization`
*metadata header*, then `attach_user_id` appends `user_id` and drops the org —
so the handler never saw which org had been authorized. `Ingest::ingest` then
read `org_id` from the request *body* and passed it to all five arms (logs,
traces, metrics, enrichment tables, service graph), and
`logs::ingest::ingest` performs no org authorization of its own (the HTTP path
is safe only because `auth_middleware` authorizes the org in the URL). Any
credential valid in one org could therefore write logs, traces, metrics,
enrichment-table rows and service-graph edges into any other org — on the main
gRPC listener, the same port collectors point at.

The fix adds `destination_org(user_id, header_org, body_org)`, mirroring the
rule `stream.rs` already had:

  internal cluster token (no `user_id`)  -> body org kept (cluster forwarding)
  user credential, no header             -> Unauthenticated
  user credential, body org != header    -> PermissionDenied
  user credential, body org empty/equal  -> writes to the header org

Two notes on what is asserted below:

- The org is resolved once, *before* the `match stream_type`, so the deny case
  is parametrized across all five stream types to show every arm is covered by
  that single check rather than only the logs arm the report reproduced on. It
  does not follow that each arm's payload is independently valid — on a pre-fix
  binary the metrics arm answers `500 missing value` for this payload, which is
  the same conclusion from the other direction.
- `destination_org`'s missing-header branch is not reachable through the real
  interceptor: `check_auth` already requires the `organization` header and
  answers `InvalidArgument` first. The handler guard is belt-and-braces for
  callers that bypass the interceptor, so the test pins what the service
  actually returns, and the Rust unit tests cover the branch directly.
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
from support.wait import wait_until

ROWS = json.dumps([{"injected_by": "grpc_org_binding_test", "n": 1}]).encode()

# All five arms of the handler's match; the deny resolves before it, so one check covers each.
STREAM_TYPES = ["logs", "traces", "metrics", "enrichment_tables", "service_graph"]


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


# `_meta` as the second tenant: orgs have no DELETE route, so creating one leaks a tenant per run.
OTHER_ORG = "_meta"


@pytest.fixture
def stream_name(client: OpenObserveClient) -> Generator[str, None, None]:
    """A unique stream name, removed from both orgs afterwards.

    The accepted-write tests really do create a stream, and ingest
    auto-creates, so without this the suite leaves one behind on every run.
    Both orgs are swept because which one a stream lands in is precisely what
    is in question here.
    """
    name = f"grpc_org_binding_{uuid.uuid4().hex[:8]}"
    yield name
    for org in ("default", OTHER_ORG):
        client.delete(f"streams/{name}?type=logs", org=org, raise_for_status=False)


def _stream_exists(client: OpenObserveClient, org: str, name: str) -> bool:
    """Whether `name` exists in `org`.

    Asserts the listing succeeded rather than returning False on an error: a
    failed list would otherwise read as "the stream is absent" and turn the
    did-not-reach-the-other-org test into a vacuous pass.
    """
    resp = client.get("streams", org=org, raise_for_status=False)
    assert resp.status_code == 200, \
        f"could not list streams in {org!r} ({resp.status_code}), so absence cannot be asserted: {resp.text[:200]}"
    return any(s.get("name") == name for s in resp.json().get("list", []))


# ─── The cross-org write ──────────────────────────────────────────────────────


@pytest.mark.parametrize("stream_type", STREAM_TYPES)
def test_naming_another_org_in_the_body_is_refused(
    channel, root_auth: str, stream_name: str, stream_type: str
):
    """A credential authenticated against org A cannot name org B in the body.

    Before openobserve#15157 this returned `status_code: 200` and the write
    landed in org B. The deny is resolved before the stream_type match, so each
    arm is refused identically.
    """
    result = ingest(
        channel,
        body_org=OTHER_ORG,
        stream_name=stream_name,
        stream_type=stream_type,
        rows=ROWS,
        authorization=root_auth,
        header_org="default",
    )
    assert result.code == grpc.StatusCode.PERMISSION_DENIED, (
        f"[{stream_type}] a body org of {OTHER_ORG!r} beside an authenticated header org of "
        f"'default' must be refused, got {result.code} "
        f"(status_code={result.status_code}, {result.message or result.details!r}). "
        "This is o2-enterprise#2821: a cross-tenant write."
    )


def test_the_refused_write_does_not_reach_the_other_org(
    client: OpenObserveClient, channel, root_auth: str, stream_name: str
):
    """The status code is not the whole claim — nothing may be written either.

    A deny that still created the stream would leave the attacker in control of
    stream names and schema in the victim org, which is half the original
    impact.
    """
    result = ingest(
        channel,
        body_org=OTHER_ORG,
        stream_name=stream_name,
        rows=ROWS,
        authorization=root_auth,
        header_org="default",
    )
    assert result.code == grpc.StatusCode.PERMISSION_DENIED, result

    assert not _stream_exists(client, OTHER_ORG, stream_name), (
        f"the refused write must not create {stream_name!r} in {OTHER_ORG!r}; "
        "ingest auto-creates streams, so a deny that still wrote would hand the "
        "caller stream names and schema in another tenant's org"
    )


# ─── What must still work ─────────────────────────────────────────────────────


def test_an_empty_body_org_writes_to_the_authenticated_org(
    client: OpenObserveClient, channel, root_auth: str, stream_name: str
):
    """An omitted body org is not an error — it resolves to the header org.

    Proto3 does not put an empty string on the wire, so this is also the shape
    any client that simply never sets `org_id` sends.
    """
    result = ingest(
        channel,
        body_org="",
        stream_name=stream_name,
        rows=ROWS,
        authorization=root_auth,
        header_org="default",
    )
    assert result.code == grpc.StatusCode.OK, f"expected OK, got {result.code}: {result.details}"
    assert result.status_code == 200, f"ingest reported {result.status_code}: {result.message}"

    assert wait_until(
        lambda: _stream_exists(client, "default", stream_name),
        timeout=30,
        msg=f"{stream_name} did not appear in the authenticated org",
    ), "an empty body org must write to the header org, not be dropped"


def test_a_body_org_matching_the_header_is_accepted(
    channel, root_auth: str, stream_name: str
):
    """The fix must not break the ordinary case of naming your own org."""
    result = ingest(
        channel,
        body_org="default",
        stream_name=stream_name,
        rows=ROWS,
        authorization=root_auth,
        header_org="default",
    )
    assert result.code == grpc.StatusCode.OK, f"expected OK, got {result.code}: {result.details}"
    assert result.status_code == 200, f"ingest reported {result.status_code}: {result.message}"


# ─── The auth preconditions the binding rests on ──────────────────────────────


def test_an_unauthenticated_call_is_refused(channel, stream_name: str):
    resp = ingest(channel, body_org="default", stream_name=stream_name, rows=ROWS)
    assert resp.code == grpc.StatusCode.UNAUTHENTICATED, \
        f"a call with no authorization metadata must be refused, got {resp.code}"


def test_a_call_without_the_organization_header_is_refused(channel, root_auth: str, stream_name: str):
    """`check_auth` needs the header to know which org to authenticate against,
    and rejects before the handler — so the binding can never be asked to
    resolve an org that was never authorized."""
    resp = ingest(channel, body_org="default", stream_name=stream_name, rows=ROWS, authorization=root_auth)
    assert resp.code == grpc.StatusCode.INVALID_ARGUMENT, (
        "a credential with no `organization` header must be refused by check_auth with "
        f"InvalidArgument, got {resp.code}: {resp.details}"
    )


# ─── The non-root credential, which is the attacker shape ─────────────────────


@pytest.fixture
def member_auth(client: OpenObserveClient, temp_user_email: str) -> str:
    """Basic auth for a user who is a member of `default` only.

    Every test above uses root, which `is_root_user` admits to any org via
    `ROOT_USER` — so they exercise `destination_org` but never `check_auth`'s
    membership lookup. These two cover the realistic shape.
    """
    password = "Complexpass#123"
    resp = client.users.create({
        "email": temp_user_email, "password": password,
        "first_name": "Grpc", "last_name": "Member", "role": "admin",
    })
    assert resp.status_code == 200, f"could not create the member user: {resp.status_code} {resp.text}"
    return basic_auth(temp_user_email, password)


def test_a_member_of_one_org_cannot_name_another_in_the_body(
    channel, member_auth: str, stream_name: str
):
    """The attacker shape: a real member of org A naming org B in the body."""
    result = ingest(
        channel, body_org=OTHER_ORG, stream_name=stream_name, rows=ROWS,
        authorization=member_auth, header_org="default",
    )
    assert result.code == grpc.StatusCode.PERMISSION_DENIED, (
        f"a member of 'default' naming {OTHER_ORG!r} in the body must be refused, got "
        f"{result.code} (status_code={result.status_code}, {result.message or result.details!r})"
    )


def test_a_member_cannot_authenticate_against_an_org_it_does_not_belong_to(
    channel, member_auth: str, stream_name: str
):
    """Header = body = victim org must fail at `check_auth`, not reach the binding.

    Without this, `destination_org` could be satisfied by setting both to the
    victim org and every other test here would stay green.
    """
    result = ingest(
        channel, body_org=OTHER_ORG, stream_name=stream_name, rows=ROWS,
        authorization=member_auth, header_org=OTHER_ORG,
    )
    assert result.code == grpc.StatusCode.UNAUTHENTICATED, (
        f"a non-member authenticating against {OTHER_ORG!r} must be refused by check_auth, got "
        f"{result.code} (status_code={result.status_code}, {result.message or result.details!r})"
    )
