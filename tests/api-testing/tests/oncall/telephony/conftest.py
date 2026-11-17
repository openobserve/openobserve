"""Telephony gate; never skips on an enterprise build, and the fake's folders run only from their own server's shard."""
from __future__ import annotations

import time
from collections.abc import Generator

import pytest

from helpers.twilio_mock import TwilioMock
from support.client import OpenObserveClient

from .telephony_helpers import TelephonyEnv, new_org

# Naming these on the command line bypasses this, which is how the two shards reach them; `pytest tests/oncall` must not.
collect_ignore = ["org", "deployment"]

TEST_DEADLINE_SECS = 360.0
# (deployment_account_present, press4_available) a shard's server must report.
SHARD_CONFIG = {"org": (False, True), "deployment": (True, False)}


@pytest.fixture(scope="session")
def twilio() -> TwilioMock:
    return TwilioMock()


@pytest.fixture(scope="session", autouse=True)
def _require_telephony(_require_oncall: None, client: OpenObserveClient, oncall_org: str, twilio: TwilioMock,
                       telephony_shard: str) -> None:
    """Fails, naming the env var, when the mock or the server's config cannot carry this shard (`_require_oncall` skips OSS first)."""
    if not twilio.reachable():
        pytest.fail(f"Twilio mock not reachable at {twilio.base_url}: start helpers/twilio_mock.py and set TWILIO_MOCK_URL")
    got = client.get("telephony", org=oncall_org)
    if got.status_code != 200:
        pytest.fail(f"GET telephony answered {got.status_code}, wanted 200: check O2_ONCALL_ENABLED; {got.text[:200]}")
    body = got.json()
    actual = (body.get("deployment_account_present"), body.get("press4_available"))
    if actual != SHARD_CONFIG[telephony_shard]:
        pytest.fail(f"{telephony_shard} shard needs (deployment_account_present, press4_available) = "
                    f"{SHARD_CONFIG[telephony_shard]}, server says {actual}: check O2_TELEPHONY_ACCOUNT_SID and "
                    "O2_TELEPHONY_CALLBACK_URL")

    canary = TelephonyEnv(client=client, org=new_org(client), mock=twilio)
    canary.register_account()
    saved = canary.put_telephony(token=canary.token)
    if saved.status_code != 200:
        pytest.fail(f"canary account refused with {saved.status_code} ({saved.json().get('reason')}): "
                    "check O2_MASTER_ENCRYPTION_KEY and O2_TELEPHONY_API_BASE_URL")
    checks = twilio.requests(sid=canary.sid, kind="account")
    if not any(r["auth_ok"] for r in checks):
        pytest.fail(f"server saved the canary without the mock seeing its check: point O2_TELEPHONY_API_BASE_URL at {twilio.base_url}")
    canary.teardown()


@pytest.fixture(autouse=True)
def _telephony_deadline() -> Generator[None, None, None]:
    """Keeps every test inside the plan's 6-minute budget, since no pytest-timeout is pinned."""
    started = time.monotonic()
    yield
    elapsed = time.monotonic() - started
    assert elapsed < TEST_DEADLINE_SECS, f"took {elapsed:.0f}s, over the {TEST_DEADLINE_SECS:.0f}s test budget"
