"""Fixtures for the Slack app API tests; see ``slack_helpers`` for how the server must be started."""
from __future__ import annotations

import os

import pytest

from support.client import OpenObserveClient

from .slack_helpers import SlackMock, harness_skip, slack_config


@pytest.fixture(scope="session")
def slack_org() -> str:
    return os.environ.get("TEST_ORG_ID", "default")


@pytest.fixture(scope="session")
def slack_state(client: OpenObserveClient, slack_org: str) -> dict:
    return slack_config(client, slack_org)


@pytest.fixture(scope="session")
def enterprise_build(slack_state: dict) -> str:
    if slack_state["build_type"] == "opensource":
        harness_skip("the Slack app needs an enterprise build")
    return slack_state["build_type"]


@pytest.fixture(scope="session")
def slack_on(enterprise_build: str, slack_state: dict) -> None:
    if not slack_state["slack_enabled"]:
        pytest.skip(
            f"Slack is off for this org ({slack_state['slack_disabled_reason']}); start the server with "
            "O2_SLACK_ENABLED=true, O2_MASTER_ENCRYPTION_KEY and O2_SLACK_API_BASE_URL at the mock"
        )


@pytest.fixture(scope="session")
def self_hosted(enterprise_build: str) -> None:
    if enterprise_build == "cloud":
        pytest.skip("self-hosted only")


@pytest.fixture(scope="session")
def cloud_build(enterprise_build: str) -> None:
    if enterprise_build != "cloud":
        pytest.skip("needs a --features cloud build with O2_SLACK_CLIENT_ID/_SECRET/_REDIRECT_URL set")


@pytest.fixture
def mock() -> SlackMock:
    m = SlackMock()
    if not m.reachable():
        harness_skip(f"Slack mock not reachable at {m.base_url}; run helpers/slack_mock.py")
    m.reset()
    return m
