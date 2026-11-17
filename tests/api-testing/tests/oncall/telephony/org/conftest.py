"""The org shard's server: master key and callback, no deployment account; every test gets its own org because the breaker is per org."""
from __future__ import annotations

from collections.abc import Generator

import pytest

from helpers.twilio_mock import TwilioMock
from support.client import OpenObserveClient

from ..telephony_helpers import TelephonyEnv, new_org


@pytest.fixture(scope="session")
def telephony_shard() -> str:
    return "org"


@pytest.fixture
def bare_env(client: OpenObserveClient, twilio: TwilioMock) -> Generator[TelephonyEnv, None, None]:
    env = TelephonyEnv(client=client, org=new_org(client), mock=twilio)
    yield env
    env.teardown()


@pytest.fixture
def env(bare_env: TelephonyEnv) -> TelephonyEnv:
    bare_env.connect()
    return bare_env


@pytest.fixture
def other_env(client: OpenObserveClient, twilio: TwilioMock) -> Generator[TelephonyEnv, None, None]:
    env = TelephonyEnv(client=client, org=new_org(client), mock=twilio)
    env.connect()
    yield env
    env.teardown()


@pytest.fixture
def unconnected_env(client: OpenObserveClient, twilio: TwilioMock) -> Generator[TelephonyEnv, None, None]:
    env = TelephonyEnv(client=client, org=new_org(client), mock=twilio)
    yield env
    env.teardown()
