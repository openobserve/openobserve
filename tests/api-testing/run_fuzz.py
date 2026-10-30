"""Run Schemathesis with CLI-controlled health checks, including on CI."""

from hypothesis import settings


def configure_hypothesis() -> None:
    # Hypothesis automatically loads its `ci` profile on GitHub Actions. In
    # Schemathesis 4.20.3, non-default profile values override CLI settings,
    # replacing --suppress-health-check with the profile's [too_slow]. Clear
    # only that inherited value so the CLI owns the suppression list; retain
    # the rest of the active profile (including CI's deterministic generation).
    settings.register_profile(
        "openobserve-fuzz",
        parent=settings.default,
        suppress_health_check=(),
    )
    settings.load_profile("openobserve-fuzz")


if __name__ == "__main__":
    configure_hypothesis()

    from schemathesis.cli import schemathesis

    schemathesis()
