"""The deployment shard's server: deployment account and no callback; the mock refuses any rule that would poison its shared breaker."""
from __future__ import annotations

from collections.abc import Generator

import pytest

from helpers.twilio_mock import TwilioMock
from support.client import OpenObserveClient

from ..telephony_helpers import DEPLOYMENT_SID, TelephonyEnv, new_org


@pytest.fixture(scope="session")
def telephony_shard() -> str:
    return "deployment"


@pytest.fixture(scope="session", autouse=True)
def _require_protected_deployment_sid(twilio: TwilioMock) -> None:
    """Without this the mock would accept a failure rule on the account every test here shares."""
    if not twilio.reachable():
        pytest.fail(f"Twilio mock not reachable at {twilio.base_url}: start helpers/twilio_mock.py and set TWILIO_MOCK_URL")
    protected = twilio.call("GET", "/_mock/health")["protected_sids"]
    if protected != [DEPLOYMENT_SID]:
        pytest.fail(f"mock protects {protected}, wanted the shard's account: pass --deployment-account to the mock")


@pytest.fixture
def env(client: OpenObserveClient, twilio: TwilioMock) -> Generator[TelephonyEnv, None, None]:
    """A new org with no account of its own, so it falls to the deployment account."""
    env = TelephonyEnv(client=client, org=new_org(client), mock=twilio)
    yield env
    env.teardown()
