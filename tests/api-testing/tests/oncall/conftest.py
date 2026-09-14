"""Fixtures for the On-Call API tests.

`oncall` yields an `OnCallClient` bound to the org under test, with the paging
template and the two Alert Destinations already provisioned, and a teardown
sweep of every team, alert, ownership rule and user the module registered on it.

Everything here is **enterprise-gated**: `_require_oncall` skips the whole
directory when the server's `/config` says `oncall_enabled` is not true, so an
OSS build reports skips rather than a wall of 404s.

Scope is `module`, not `function`: a page only exists once the alert scheduler
has evaluated a rule, which costs the better part of a minute, and a per-test
team would pay that again for state no test mutates.
"""
from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient

from .oncall_helpers import OnCallClient, make_user, oncall_enabled, org_env, resolve_org


@pytest.fixture(scope="session")
def oncall_org(client: OpenObserveClient) -> str:
    """The org identifier the on-call routes are addressed by.

    An org is addressed by identifier (a ksuid on a multi-tenant deployment),
    never by display name; on a single-node build the two coincide.
    """
    return resolve_org(client, org_env())


@pytest.fixture(scope="session")
def oncall_available(client: OpenObserveClient, oncall_org: str) -> bool:
    return oncall_enabled(client, oncall_org)


@pytest.fixture(scope="session", autouse=True)
def _require_oncall(oncall_available: bool) -> None:
    """Skip cleanly rather than fail when the feature is not built or not on.

    Session-scoped on purpose: a function-scoped gate is set up AFTER the
    module-scoped fixtures it is meant to protect, so an OSS build would seed
    teams and wait on pages that can never arrive before ever reaching the skip.
    """
    if not oncall_available:
        pytest.skip("this build does not serve the on-call routes")


@pytest.fixture(scope="module")
def oncall(client: OpenObserveClient, oncall_org: str) -> Generator[OnCallClient, None, None]:
    oc = OnCallClient(client, oncall_org)
    if oncall_enabled(client, oncall_org):
        oc.seed_destinations()
    try:
        yield oc
    finally:
        oc.sweep()


@pytest.fixture(scope="module")
def responder(client: OpenObserveClient, oncall_org: str,
              oncall: OnCallClient) -> tuple[str, OpenObserveClient]:
    """An org member with the plain `user` role, and a client acting as them.

    `user`, not `admin`: plan §10.3 says page actions are governed by team
    membership rather than by role, and a role that is separately exempt
    (§1.3, §1.4) would prove nothing about the membership check.
    """
    # No teardown of its own: the user is registered on `oncall`, whose sweep
    # deletes it alongside everything else the module created.
    email, as_user = make_user(client, oncall_org, "user")
    oncall.users.append(email)
    return email, as_user


@pytest.fixture(scope="module")
def outsider(client: OpenObserveClient, oncall_org: str,
             oncall: OnCallClient) -> tuple[str, OpenObserveClient]:
    """An org member on NO on-call team — the account plan §1.1 is written about."""
    email, as_user = make_user(client, oncall_org, "viewer")
    oncall.users.append(email)
    return email, as_user
