"""
Alerts whose SQL joins a table of ANOTHER stream type — regression for #15636.

A logs alert that joins an enrichment table, e.g.
`FROM "app" a JOIN "enrichment_tables"."geo" b ON ...`, used to be unusable:

- the query editor's field validation (`_search?...&validate=true`) rejected the
  query with `unknown field '<col>'`, so the alert could not be saved from the UI;
- once saved, every scheduled run was skipped with
  `Stream "<tbl>" not found in schema, skipping alert evaluation`, so the alert
  never fired.

Both paths dropped the joined table's own stream type and looked every referenced
table up under the ALERT's stream type, which finds nothing for a table of a
different type. Joins between streams of the same type were never affected.

Measured on two live builds before writing these tests:

    pre-fix  (d16d693ba9)  validate -> 400 "unknown field 'ip'",
                           alert `last_satisfied_at` stays null forever
    post-fix (2040b8419a)  validate -> 200 with rows,
                           alert `last_satisfied_at` is set on the first run

`test_07` is the only guard on the evaluation half: that path has no synchronous
HTTP entry point (a manual `/trigger` evaluates nothing), so it has to wait for
the real scheduler. `last_satisfied_at` is the discriminator — `last_triggered_at`
is written even when evaluation is skipped, so it proves nothing.

Related PRs: #15636 (main), #15643 (branch-v0.80.0), #15642 (branch-v0.40.0)
"""

import logging
import random
import time

import pytest

logger = logging.getLogger(__name__)

# How long the scheduler is given to evaluate the alert once. Alert frequency is
# 1 minute and ZO_ALERT_SCHEDULE_INTERVAL defaults to 10s; the first evaluation
# landed ~70s after create on a live env, so this is ~3x headroom.
EVAL_TIMEOUT_SECS = 240
EVAL_POLL_SECS = 5


class TestAlertCrossStreamTypeJoin:
    """Alerts and query validation over a JOIN that crosses stream types."""

    ORG_ID = "default"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, ingest_data):
        """Own stream + enrichment table + alert destination, all unique.

        The alert has to be satisfiable on the first run, so this ingests its own
        rows with current timestamps rather than reusing a shared stream whose
        data may sit outside the alert's 10-minute window.
        """
        self.session = create_session
        self.base_url = base_url
        self.boundary = "----WebKitFormBoundary" + str(random.randint(100000, 999999))

        uid = random.randint(100000, 999999)
        self.stream_name = f"join_alert_logs_{uid}"
        self.enrichment_name = f"join_alert_geo_{uid}"
        # One name shared by a logs stream and an enrichment table: the fix also
        # had to validate EVERY table reference that matches the name, not the
        # first one found.
        self.same_name = f"join_alert_same_{uid}"
        self.template_name = f"join_alert_tmpl_{uid}"
        self.destination_name = f"join_alert_dest_{uid}"
        self.alert_name = f"join_alert_{uid}"
        self.alert_id = None

        self._ingest_logs(self.stream_name)
        self._create_enrichment_table(self.enrichment_name)
        self._ingest_logs(self.same_name)
        self._create_enrichment_table(self.same_name)
        self._create_template()
        self._create_destination()

        # Query window: wide enough that the ingested rows are always inside it.
        self.end_time = int(time.time() * 1_000_000)
        self.start_time = self.end_time - 3600 * 1_000_000

        # An enrichment table is queryable a moment after its CSV is written, not
        # instantly. Validating before it loads returns 400 "unknown field" — the
        # bug's own symptom — so a validating test could flake into a false
        # regression. The NON-validating join returns rows regardless of the fix,
        # so it is a fix-independent readiness signal for both joined tables.
        self._wait_join_ready(self.stream_name, self.enrichment_name)
        self._wait_join_ready(self.same_name, self.same_name)

        yield

        # Delete exactly what was created, children first. Never sweep by prefix —
        # a sweep cannot tell these fixtures from a parallel test's.
        if self.alert_id:
            self._delete(f"api/v2/{self.ORG_ID}/alerts/{self.alert_id}")
        self._delete(f"api/{self.ORG_ID}/alerts/destinations/{self.destination_name}")
        self._delete(f"api/{self.ORG_ID}/alerts/templates/{self.template_name}")
        for table in (self.enrichment_name, self.same_name):
            self._delete(f"api/{self.ORG_ID}/streams/{table}?type=enrichment_tables")
        for stream in (self.stream_name, self.same_name):
            self._delete(f"api/{self.ORG_ID}/streams/{stream}?type=logs")

    # ==================== fixtures helpers ====================

    def _delete(self, path: str):
        """Best-effort teardown — a failed delete must not mask a test result."""
        try:
            resp = self.session.delete(f"{self.base_url}{path}")
            logger.debug(f"cleanup {path} -> {resp.status_code}")
        except Exception as e:  # noqa: BLE001 - teardown only
            logger.debug(f"cleanup {path} failed: {e}")

    def _ingest_logs(self, stream_name: str):
        """Ingest rows carrying the join key, timestamped now."""
        now = int(time.time() * 1_000_000)
        rows = [
            {
                "_timestamp": now - (i * 1_000_000),
                "ip": f"10.0.0.{(i % 3) + 1}",
                "msg": f"line {i}",
            }
            for i in range(30)
        ]
        resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/{stream_name}/_json", json=rows
        )
        assert resp.status_code == 200, (
            f"ingest into {stream_name} failed: {resp.status_code} - {resp.text}"
        )

    def _create_enrichment_table(self, table_name: str):
        """Upload a 3-row lookup table keyed by the same `ip` values."""
        csv_content = (
            "ip,country,city\n"
            "10.0.0.1,India,Bengaluru\n"
            "10.0.0.2,USA,Austin\n"
            "10.0.0.3,Germany,Berlin"
        )
        body = "\r\n".join(
            [
                f"--{self.boundary}",
                'Content-Disposition: form-data; name="file"; filename="lookup.csv"',
                "Content-Type: text/csv",
                "",
                csv_content,
                f"--{self.boundary}--",
                "",
            ]
        ).encode("utf-8")

        resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/enrichment_tables/{table_name}?append=false",
            headers={"Content-Type": f"multipart/form-data; boundary={self.boundary}"},
            data=body,
        )
        assert resp.status_code == 200, (
            f"enrichment table {table_name} create failed: {resp.status_code} - {resp.text}"
        )

    def _create_template(self):
        resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/alerts/templates",
            json={
                "name": self.template_name,
                "body": '{\n  "text": "alert {alert_name} is active"\n}',
                "type": "http",
                "title": "",
            },
        )
        assert resp.status_code == 200, (
            f"template create failed: {resp.status_code} - {resp.text}"
        )

    def _create_destination(self):
        # A public URL, as in test_v1.py. A base_url-derived sink is tempting but
        # not portable: on a deployed env the host resolves to a private address
        # and destination create is refused by the SSRF guard (CI allows loopback
        # via ZO_SSRF_ALLOW_LOOPBACK, a deployed env does not). Delivery itself is
        # not what these tests assert — only that the alert evaluates.
        resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/alerts/destinations",
            json={
                "name": self.destination_name,
                "url": "https://example.com/webhook",
                "method": "get",
                "skip_tls_verify": False,
                "template": self.template_name,
                "headers": {},
            },
        )
        assert resp.status_code == 200, (
            f"destination create failed: {resp.status_code} - {resp.text}"
        )

    # ==================== query helpers ====================

    def _validate_query(self, sql: str):
        """Run the editor's validating search — `validate=true` is what the
        alert query editor sends, and what rejected these joins before the fix."""
        return self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_search?type=logs&validate=true",
            json={
                "query": {
                    "sql": sql,
                    "start_time": self.start_time,
                    "end_time": self.end_time,
                    "from": 0,
                    "size": 10,
                }
            },
        )

    def _join_sql(self, joined_ref: str, select: str = "a.ip, b.country") -> str:
        return (
            f'SELECT {select} FROM "{self.stream_name}" a '
            f"JOIN {joined_ref} b ON a.ip = b.ip"
        )

    def _wait_join_ready(self, logs_stream: str, enrichment_table: str, timeout_secs: int = 90):
        """Poll the non-validating join until it returns rows, so a later
        validating test cannot race the enrichment table's load."""
        sql = (
            f'SELECT a.ip, b.country FROM "{logs_stream}" a '
            f'JOIN "enrichment_tables"."{enrichment_table}" b ON a.ip = b.ip'
        )
        deadline = time.time() + timeout_secs
        last = None
        while time.time() < deadline:
            resp = self.session.post(
                f"{self.base_url}api/{self.ORG_ID}/_search?type=logs",
                json={
                    "query": {
                        "sql": sql,
                        "start_time": self.start_time,
                        "end_time": self.end_time,
                        "from": 0,
                        "size": 1,
                    }
                },
            )
            last = f"{resp.status_code} {resp.text[:200]}"
            if resp.status_code == 200 and resp.json().get("hits"):
                return
            time.sleep(3)
        pytest.fail(
            f"join {logs_stream} ⋈ {enrichment_table} not queryable within "
            f"{timeout_secs}s (setup problem, not the fix); last: {last}"
        )

    def _alert_payload(self, sql: str) -> dict:
        return {
            "name": self.alert_name,
            "row_template": self.template_name,
            "stream_type": "logs",
            "stream_name": self.stream_name,
            "is_real_time": False,
            "context_attributes": {},
            "query_condition": {
                "conditions": [],
                "search_event_type": "ui",
                "sql": sql,
                "promql": "",
                "type": "sql",
                "promql_condition": None,
                "vrl_function": None,
                "multi_time_range": [],
            },
            "trigger_condition": {
                "period": 10,
                "operator": ">=",
                "frequency": 1,
                "cron": "",
                "threshold": 1,
                "silence": 10,
                "frequency_type": "minutes",
                "timezone": "UTC",
                "tolerance_in_secs": 0,
            },
            "org_id": self.ORG_ID,
            "destinations": [self.destination_name],
            "enabled": True,
            "description": "regression #15636: join across stream types",
            "folderId": "default",
        }

    # ==================== validation: the query-editor half ====================

    def test_01_validate_accepts_logs_join_enrichment_table(self):
        """The exact query the bug report rejected now validates."""
        sql = self._join_sql(f'"enrichment_tables"."{self.enrichment_name}"')

        resp = self._validate_query(sql)

        assert resp.status_code == 200, (
            "a logs query joining an enrichment table must pass field validation "
            f"(#15636); got {resp.status_code} - {resp.text[:400]}"
        )
        body = resp.json()
        assert "hits" in body, f"validated search should return hits: {body}"

    @pytest.mark.parametrize(
        "prefix_form",
        ["quoted", "unquoted", "enrich_alias"],
        ids=["enrichment_tables_quoted", "enrichment_tables_unquoted", "enrich_alias"],
    )
    def test_02_validate_accepts_every_enrichment_prefix_form(self, prefix_form):
        """All three ways of naming an enrichment table resolve to its own type."""
        joined = {
            "quoted": f'"enrichment_tables"."{self.enrichment_name}"',
            "unquoted": f"enrichment_tables.{self.enrichment_name}",
            "enrich_alias": f"enrich.{self.enrichment_name}",
        }[prefix_form]

        resp = self._validate_query(self._join_sql(joined))

        assert resp.status_code == 200, (
            f"join written as `{joined}` must pass field validation; "
            f"got {resp.status_code} - {resp.text[:400]}"
        )

    def test_03_validate_still_rejects_unknown_joined_column(self):
        """The fix must not have simply switched validation off for joins.

        A column that exists in NEITHER table still has to be rejected, on the
        enrichment side as well as the logs side.
        """
        joined = f'"enrichment_tables"."{self.enrichment_name}"'

        on_enrichment = self._validate_query(
            self._join_sql(joined, select="a.ip, b.no_such_column")
        )
        on_logs = self._validate_query(
            self._join_sql(joined, select="a.no_such_column, b.country")
        )

        assert on_enrichment.status_code == 400, (
            "an unknown column on the enrichment side must still be rejected; "
            f"got {on_enrichment.status_code} - {on_enrichment.text[:300]}"
        )
        assert on_logs.status_code == 400, (
            "an unknown column on the logs side must still be rejected; "
            f"got {on_logs.status_code} - {on_logs.text[:300]}"
        )

    def test_04_validate_rejects_missing_joined_table(self):
        """A joined enrichment table that does not exist is still an error."""
        resp = self._validate_query(
            self._join_sql('"enrichment_tables"."no_such_table_15636"')
        )

        assert resp.status_code == 400, (
            "joining a non-existent enrichment table must fail; "
            f"got {resp.status_code} - {resp.text[:300]}"
        )

    def test_05_validate_accepts_join_between_same_named_streams(self):
        """A logs stream and an enrichment table sharing one name still validate.

        This one guards the fix rather than the original bug: it passes on the
        pre-fix build too, because that resolver checked only the FIRST matching
        reference and never looked at the enrichment column at all. Validating
        every matching reference — what the fix does — is what can over-reject
        here, and an earlier revision of #15636 did exactly that.
        """
        sql = (
            f'SELECT a.msg, b.country FROM "{self.same_name}" a '
            f'JOIN "enrichment_tables"."{self.same_name}" b ON a.ip = b.ip'
        )

        resp = self._validate_query(sql)

        assert resp.status_code == 200, (
            "a join between a logs stream and an enrichment table of the SAME "
            f"name must validate; got {resp.status_code} - {resp.text[:400]}"
        )

    # ==================== save + evaluation: the alert half ====================

    def test_06_alert_with_cross_type_join_saves(self):
        """The alert the editor now accepts also saves and reads back intact.

        The save endpoint itself never rejected these joins — the editor did —
        so this passes on the pre-fix build as well. It is here to pin the shape
        of the stored alert that test_07 then waits on, not to discriminate.
        """
        sql = self._join_sql(f'"enrichment_tables"."{self.enrichment_name}"')

        resp = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts",
            json=self._alert_payload(sql),
        )

        assert resp.status_code == 200, (
            f"alert save with a cross-stream-type join failed: "
            f"{resp.status_code} - {resp.text[:400]}"
        )
        self.alert_id = resp.json()["id"]

        detail = self.session.get(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/{self.alert_id}"
        )
        assert detail.status_code == 200, (
            f"saved alert not readable: {detail.status_code} - {detail.text[:300]}"
        )
        assert detail.json()["query_condition"]["sql"] == sql, (
            "the stored SQL must be the join that was submitted"
        )

    def test_07_saved_alert_is_evaluated_not_skipped(self):
        """The scheduler evaluates the alert instead of skipping every run.

        Before the fix the run ended at
        `Stream "<tbl>" not found in schema, skipping alert evaluation`, so the
        condition was never compared and `last_satisfied_at` stayed null. The
        ingested rows all match the lookup table, and the threshold is `>= 1`,
        so a run that actually evaluates must satisfy the condition.
        """
        sql = self._join_sql(f'"enrichment_tables"."{self.enrichment_name}"')
        created = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts",
            json=self._alert_payload(sql),
        )
        assert created.status_code == 200, (
            f"alert save failed: {created.status_code} - {created.text[:400]}"
        )
        self.alert_id = created.json()["id"]

        deadline = time.time() + EVAL_TIMEOUT_SECS
        last_body = None
        while time.time() < deadline:
            resp = self.session.get(
                f"{self.base_url}api/v2/{self.ORG_ID}/alerts/{self.alert_id}"
            )
            assert resp.status_code == 200, (
                f"alert read failed: {resp.status_code} - {resp.text[:300]}"
            )
            last_body = resp.json()
            if last_body.get("last_satisfied_at"):
                logger.debug(
                    f"alert evaluated and satisfied at {last_body['last_satisfied_at']}"
                )
                return
            time.sleep(EVAL_POLL_SECS)

        pytest.fail(
            "the alert was never evaluated: `last_satisfied_at` is still unset "
            f"after {EVAL_TIMEOUT_SECS}s, which is how #15636 presented — the "
            "joined enrichment table was looked up under the alert's own stream "
            "type and the run was skipped. "
            f"last_triggered_at={last_body.get('last_triggered_at') if last_body else None}"
        )
