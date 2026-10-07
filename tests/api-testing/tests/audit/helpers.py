"""Reading back what the audit trail actually stored.

The audit middleware records every successful non-ingest API call into the
`_meta` org's `audit` logs stream (`src/audit/src/lib.rs`). The row is a
serialized `AuditMessage` with `response_meta` flattened into it, so the request
body lands in a top-level **`http_body`** field alongside `http_method`,
`http_path`, `http_response_code`, `user_email` and `org_id`.

Two things make this trail awkward to assert on, and both are handled here:

- **It is batched.** `auditor::audit` buffers into `AUDIT_DATA` and only
  publishes once `O2_AUDIT_BATCH_SIZE` rows have accumulated (default **500**)
  or `O2_AUDIT_PUBLISH_INTERVAL` elapses (default **600s**). At the defaults a
  test would wait ten minutes for its own row, so this suite requires
  `O2_AUDIT_BATCH_SIZE=1`; `conftest.py` skips the module with that instruction
  rather than hanging.
- **It is asynchronous even then.** The publish is an ingest, so the row has to
  become searchable. Every read below polls.
"""
from __future__ import annotations

import json

from support.client import OpenObserveClient
from support.wait import WaitTimeout, wait_until

META_ORG = "_meta"
AUDIT_STREAM = "audit"

# Distinctive enough that finding either in a stored body is unambiguous,
# and compliant with the enterprise password policy.
PROBE_PASSWORD = "Sekr3t!Audit#Probe1"
ROTATED_PASSWORD = "R0tated!Audit#Probe2"


def _escape(value: str) -> str:
    return value.replace("'", "''")


class AuditTrail:
    """Reads rows out of `_meta`'s audit stream."""

    def __init__(self, client: OpenObserveClient):
        self._c = client

    def available(self, *, timeout: float = 60.0) -> bool:
        """Whether the audit stream exists and is searchable."""
        try:
            wait_until(self._any_row, timeout=timeout, interval=2.0, msg="audit stream")
            return True
        except (AssertionError, WaitTimeout):
            return False

    def _any_row(self) -> bool:
        resp = self._c.search.sql(
            f'SELECT http_path FROM "{AUDIT_STREAM}" LIMIT 1',
            org=META_ORG,
            minutes=60,
            raise_for_status=False,
        )
        return resp.status_code == 200 and bool(resp.json().get("hits"))

    def row_for(
        self,
        *,
        method: str,
        path_contains: str,
        timeout: float = 90.0,
    ) -> dict:
        """The newest audit row for `method` on a path containing `path_contains`.

        Fails with the search result in the message rather than returning None —
        a missing row means the request was never audited, which is a different
        bug from a badly redacted one and should not read as a redaction pass.
        """
        sql = (
            f'SELECT * FROM "{AUDIT_STREAM}" '
            f"WHERE http_method = '{_escape(method.upper())}' "
            f"AND http_path LIKE '%{_escape(path_contains)}%' "
            "ORDER BY _timestamp DESC LIMIT 1"
        )

        def _fetch():
            resp = self._c.search.sql(sql, org=META_ORG, minutes=60, size=1, raise_for_status=False)
            if resp.status_code != 200:
                return None
            hits = resp.json().get("hits") or []
            return hits[0] if hits else None

        row = wait_until(
            _fetch,
            timeout=timeout,
            interval=2.0,
            msg=f"audit row for {method.upper()} ~{path_contains}",
        )
        assert row, f"no audit row for {method.upper()} ~{path_contains}"
        return row

    def body_for(self, **kw) -> str:
        """Just the stored request body, as the trail holds it."""
        return self.row_for(**kw).get("http_body") or ""

    @staticmethod
    def whole_row(row: dict) -> str:
        """The row serialized, for 'this secret appears nowhere' assertions.

        Checking only `http_body` would miss a credential that leaked through
        the path or the query-param field instead.
        """
        return json.dumps(row, default=str)
