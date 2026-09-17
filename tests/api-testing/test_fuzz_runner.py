"""Regression coverage for the Hypothesis CI profile / Schemathesis merge."""

import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize("profile", ["default", "ci"])
def test_cli_health_checks_survive_active_profile(profile):
    # Isolate global Hypothesis settings from pytest and exercise the same
    # create_test path that Schemathesis uses for its fuzzing phase.
    script = """
import sys
from hypothesis import HealthCheck, settings
settings.load_profile(sys.argv[1])
before = settings.default
from run_fuzz import configure_hypothesis
configure_hypothesis()
assert settings.default.derandomize == before.derandomize
assert settings.default.deadline == before.deadline

import schemathesis
from schemathesis.config import SchemathesisConfig
from schemathesis.config._health_check import HealthCheck as CLIHealthCheck
from schemathesis.generation.hypothesis.builder import (
    create_test, HypothesisTestConfig, HypothesisTestMode,
)

schema = schemathesis.openapi.from_dict({
    "openapi": "3.0.0",
    "info": {"title": "profile regression", "version": "1"},
    "paths": {"/test": {"get": {"responses": {"200": {"description": "OK"}}}}},
}, config=SchemathesisConfig(suppress_health_check=[
    CLIHealthCheck.filter_too_much, CLIHealthCheck.too_slow,
]))
operation = schema["/test"]["GET"]
schema.config.generation.max_examples = 20
test = create_test(
    operation=operation,
    test_func=lambda case: None,
    config=HypothesisTestConfig(
        project=schema.config,
        modes=[HypothesisTestMode.FUZZING],
        settings=schema.config.get_hypothesis_settings(operation=operation, phase="fuzzing"),
    ),
)
effective = test._hypothesis_internal_use_settings
assert set(effective.suppress_health_check) == {HealthCheck.filter_too_much, HealthCheck.too_slow}
assert effective.max_examples == 20
assert effective.derandomize == before.derandomize
test()
"""
    result = subprocess.run(
        [sys.executable, "-c", script, profile],
        cwd=Path(__file__).parent,
        env={**os.environ, "CI": "true"},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
