"""
Slack app tables on the Postgres meta store (spec AC-2.2): the unique keys hold
in the database itself, not only in the ORM.
"""
import uuid

import psycopg2
import pytest

INSERT_INSTALLATION = """
    INSERT INTO slack_installations (
        id, app_id, enterprise_id, team_id, team_name, is_enterprise_install,
        auto_link_enabled, mode, home_region, installed_by, installed_org_id,
        created_at, updated_at, origin_region
    ) VALUES (%s, %s, %s, %s, 'Acme', false, true, 'http', 'default',
              'root@example.com', 'default', 1, 1, 'default')
"""

INSERT_LINK = """
    INSERT INTO external_identity_links (
        id, provider, installation_id, external_team_id, external_user_id,
        user_email, default_org_id, link_method, created_at, last_used_at,
        updated_at, origin_region
    ) VALUES (%s, 'slack', %s, 'T1', %s, 'u@acme.com', 'default', 'oidc', 1, 1, 1, 'default')
"""


def _id() -> str:
    return uuid.uuid4().hex[:27]


@pytest.fixture
def slack_app_id(db_cursor):
    app_id = f"A{uuid.uuid4().hex[:12]}"
    yield app_id
    db_cursor.execute("DELETE FROM slack_installations WHERE app_id = %s", (app_id,))


@pytest.fixture
def slack_installation_id(db_cursor):
    installation_id = _id()
    yield installation_id
    db_cursor.execute(
        "DELETE FROM external_identity_links WHERE installation_id = %s",
        (installation_id,),
    )


class TestSlackTables:
    def test_second_installation_for_the_same_team_is_refused(self, db_cursor, slack_app_id):
        db_cursor.execute(INSERT_INSTALLATION, (_id(), slack_app_id, "", "T1"))
        with pytest.raises(psycopg2.errors.UniqueViolation):
            db_cursor.execute(INSERT_INSTALLATION, (_id(), slack_app_id, "", "T1"))

    def test_the_same_team_under_a_grid_enterprise_is_another_installation(
        self, db_cursor, slack_app_id
    ):
        db_cursor.execute(INSERT_INSTALLATION, (_id(), slack_app_id, "", "T1"))
        db_cursor.execute(INSERT_INSTALLATION, (_id(), slack_app_id, "E1", "T1"))
        db_cursor.execute(
            "SELECT count(*), min(enterprise_id), min(manifest_options), min(auto_link_domains) "
            "FROM slack_installations WHERE app_id = %s",
            (slack_app_id,),
        )
        assert db_cursor.fetchone() == (2, "", "{}", "[]")

    def test_one_link_per_slack_user_per_installation(self, db_cursor, slack_installation_id):
        db_cursor.execute(INSERT_LINK, (_id(), slack_installation_id, "U1"))
        with pytest.raises(psycopg2.errors.UniqueViolation):
            db_cursor.execute(INSERT_LINK, (_id(), slack_installation_id, "U1"))

    def test_every_table_keeps_the_replication_columns(self, db_cursor):
        tables = (
            "external_identity_links",
            "slack_link_requests",
            "slack_installations",
            "slack_org_connections",
            "slack_channel_defaults",
            "slack_threads",
        )
        db_cursor.execute(
            """
            SELECT table_name, column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = ANY(%s)
              AND column_name IN ('updated_at', 'origin_region', 'deleted_at')
            """,
            (list(tables),),
        )
        found = {(t, c): (d, n) for t, c, d, n in db_cursor.fetchall()}
        for table in tables:
            assert found[(table, "updated_at")] == ("bigint", "NO"), table
            assert found[(table, "origin_region")] == ("character varying", "NO"), table
            assert found[(table, "deleted_at")] == ("bigint", "YES"), table
