"""Payload factory functions for API requests.

Each factory returns a dict that can be passed to `client.<resource>.create(...)`.
Sensible defaults are merged with caller-supplied overrides via `**kwargs`.

Pattern: small functions, named per the API resource. No classes — these are
just typed dict builders.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, UTC
from typing import Any


def _ms_epoch(dt: datetime) -> int:
    """OpenObserve time fields are microseconds-since-epoch as int."""
    return int(dt.timestamp() * 1_000_000)


def time_window(*, minutes: int = 15) -> tuple[int, int]:
    """Return (start, end) microsecond-epoch ints for the last `minutes` minutes."""
    now = datetime.now(UTC)
    end = _ms_epoch(now)
    start = _ms_epoch(now - timedelta(minutes=minutes))
    return start, end


def unique_name(prefix: str = "pytest") -> str:
    """Generate a unique, lowercase, alphanumeric resource name.

    Used to prevent cross-test resource collisions. The original suite had
    fixed names like `pytests@gmail.com` that caused cascading failures and
    blocked parallel runs.
    """
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def unique_email(prefix: str = "pytest") -> str:
    """Generate a unique test email (using .invalid TLD per RFC 2606)."""
    return f"{prefix}_{uuid.uuid4().hex[:8]}@test.invalid"


# ----- payload factories -----


def search_payload(
    sql: str,
    *,
    start_time: int | None = None,
    end_time: int | None = None,
    size: int = 100,
    from_: int = 0,
    quick_mode: bool = False,
    track_total_hits: bool = False,
) -> dict[str, Any]:
    """SQL search request body for POST /api/{org}/_search.

    Note: `track_total_hits` defaults to **False**. When True, OO switches
    to histogram-aggregate mode and returns `{"zo_sql_num": <count>}` instead
    of raw hits, which surprises callers expecting individual records.
    Callers that genuinely want the aggregate count can pass True explicitly.
    """
    if start_time is None or end_time is None:
        s, e = time_window(minutes=15)
        start_time = start_time if start_time is not None else s
        end_time = end_time if end_time is not None else e
    return {
        "query": {
            "sql": sql,
            "start_time": start_time,
            "end_time": end_time,
            "from": from_,
            "size": size,
            "quick_mode": quick_mode,
            "track_total_hits": track_total_hits,
        }
    }


def user_payload(
    *,
    email: str | None = None,
    password: str = "Complexpass#123",
    first_name: str = "Pytest",
    last_name: str = "User",
    role: str = "admin",
    organization: str = "default",
) -> dict[str, Any]:
    """User create/update body."""
    return {
        "email": email or unique_email(),
        "password": password,
        "first_name": first_name,
        "last_name": last_name,
        "role": role,
        "organization": organization,
    }


def dashboard_payload(
    *,
    title: str | None = None,
    description: str = "",
    folder_id: str = "default",
    version: int = 8,
    tabs: list | None = None,
) -> dict[str, Any]:
    """Dashboard create body."""
    return {
        "version": version,
        "title": title or unique_name("dashboard"),
        "description": description,
        "folder_id": folder_id,
        "tabs": tabs if tabs is not None else [],
    }


def alert_template_payload(
    *,
    name: str | None = None,
    body: str | None = None,
    type_: str = "http",
    title: str = "",
) -> dict[str, Any]:
    """Alert template create body."""
    return {
        "name": name or unique_name("template"),
        "body": body or '{"text": "alert {alert_name} on {stream_name} active"}',
        "type": type_,
        "title": title,
    }


def webhook_destination_payload(
    *,
    name: str | None = None,
    url: str = "http://localhost:0/sink",  # test default — override per test
    method: str = "post",
    template: str,
    headers: dict | None = None,
    skip_tls_verify: bool = False,
) -> dict[str, Any]:
    """Webhook destination create body."""
    return {
        "name": name or unique_name("dest"),
        "url": url,
        "method": method,
        "template": template,
        "headers": headers or {},
        "skip_tls_verify": skip_tls_verify,
    }


def folder_payload(*, name: str | None = None, description: str = "") -> dict[str, Any]:
    """Folder create body (alerts or dashboards)."""
    return {
        "name": name or unique_name("folder"),
        "description": description,
    }
