"""Fixtures for the alert bug-fix regressions, borrowed from the per-PR alerts suite so the two never drift."""

from tests.alerts.conftest import alerts, webhook_sink  # noqa: F401
from tests.alerts.test_composite_alerts import composite_prereqs  # noqa: F401
from tests.alerts.test_destinations_api import make_destination, template_name  # noqa: F401
from tests.alerts.test_v2 import temp_alert_prereqs  # noqa: F401
