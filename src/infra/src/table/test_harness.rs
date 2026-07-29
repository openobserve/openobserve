// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! A real SQLite database for table tests.
//!
//! Most of this crate's logic is pure and tested without a database, but three
//! classes of defect are invisible to a pure test and have all appeared here:
//!
//! 1. **Migration/entity drift** — a column added to the entity but not to a
//!    migration compiles, passes every unit test, and fails on the first real
//!    write. Running the actual migrations gives the tests the same schema
//!    production gets.
//! 2. **Conflict-clause mistakes** — which columns an upsert does and does not
//!    overwrite is invisible until two writers touch one row. The multi-alert
//!    one-writer rule (`alerts_2.md` §5.5 MN-2) is exactly this shape.
//! 3. **Conditional-update semantics** — `UPDATE … WHERE <guard>` either
//!    matched or it did not, and only the database can say.
//!
//! The database is a temp file (not `sqlite::memory:`, where every pooled
//! connection would get its own empty database) built once per test process,
//! with the full migration set applied. Tests share it, so **each test must
//! use a unique `alert_id`** — [`unique_alert_id`] does that.

use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use tokio::sync::OnceCell;

use super::migration::Migrator;
use sea_orm_migration::MigratorTrait;

static TEST_DB: OnceCell<DatabaseConnection> = OnceCell::const_new();

/// A migrated SQLite connection, shared by every test in the process.
///
/// Built once: the migration set is large, and re-running it per test would
/// dominate the suite's runtime for no extra coverage.
pub async fn test_db() -> &'static DatabaseConnection {
    TEST_DB
        .get_or_init(|| async {
            // `into_path` keeps the directory alive for the process; a dropped
            // `TempDir` would delete the file out from under open connections.
            let dir = tempfile::tempdir()
                .expect("create temp dir for the test database")
                .keep();
            let url = format!("sqlite://{}/test.sqlite?mode=rwc", dir.display());

            let conn = Database::connect(&url)
                .await
                .expect("connect to the test sqlite database");

            // WAL + a busy timeout, matching `db::sqlite::connect_rw`. Without
            // them concurrent writers fail with SQLITE_BUSY instead of
            // serialising, which would make the concurrency tests flaky rather
            // than meaningful — and those are the only tests that can catch a
            // guard missing from an UPDATE's WHERE clause.
            conn.execute_unprepared("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;")
                .await
                .expect("configure sqlite for concurrent writers");

            // The migration set predates the ORM: the earliest migrations read
            // the legacy key/value `meta` table to populate the typed tables,
            // and `meta` is created by `db::create_table()` — the non-ORM path,
            // which talks to a global pool rather than this connection. Create
            // it here with the same DDL so the migrations have their source.
            // Empty is fine: nothing to migrate is a valid starting state.
            conn.execute_unprepared(
                r#"
CREATE TABLE IF NOT EXISTS meta
(
    id       INTEGER not null primary key autoincrement,
    module   VARCHAR not null,
    key1     VARCHAR not null,
    key2     VARCHAR not null,
    start_dt INTEGER not null,
    value    TEXT not null
);
CREATE TABLE IF NOT EXISTS scheduled_jobs
(
    id           INTEGER not null primary key autoincrement,
    org          VARCHAR(100) not null,
    module       INT not null,
    module_key   VARCHAR(256) not null,
    is_realtime  BOOLEAN default false not null,
    is_silenced  BOOLEAN default false not null,
    status       INT not null,
    start_time   BIGINT,
    end_time     BIGINT,
    retries      INT not null,
    next_run_at  BIGINT not null,
    data         TEXT not null
);
CREATE TABLE IF NOT EXISTS file_list
(
    id        INTEGER not null primary key autoincrement,
    account   VARCHAR not null,
    org       VARCHAR not null,
    stream    VARCHAR not null,
    date      VARCHAR not null,
    file      VARCHAR not null,
    deleted   BOOLEAN default false not null,
    flattened BOOLEAN default false not null,
    min_ts    BIGINT not null,
    max_ts    BIGINT not null,
    records   BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null,
    index_size      BIGINT not null,
    bloom_ver       BIGINT default 0 not null,
    updated_at      BIGINT not null
);
CREATE TABLE IF NOT EXISTS file_list_history
(
    id        INTEGER not null primary key autoincrement,
    account   VARCHAR not null,
    org       VARCHAR not null,
    stream    VARCHAR not null,
    date      VARCHAR not null,
    file      VARCHAR not null,
    deleted   BOOLEAN default false not null,
    flattened BOOLEAN default false not null,
    min_ts    BIGINT not null,
    max_ts    BIGINT not null,
    records   BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null,
    index_size      BIGINT not null,
    bloom_ver       BIGINT default 0 not null,
    updated_at      BIGINT not null
);
CREATE TABLE IF NOT EXISTS file_list_deleted
(
    id         INTEGER not null primary key autoincrement,
    account    VARCHAR not null,
    org        VARCHAR not null,
    stream     VARCHAR not null,
    date       VARCHAR not null,
    file       VARCHAR not null,
    index_file BOOLEAN default false not null,
    flattened  BOOLEAN default false not null,
    created_at BIGINT not null
);
CREATE TABLE IF NOT EXISTS file_list_jobs
(
    id         INTEGER not null primary key autoincrement,
    org        VARCHAR not null,
    stream     VARCHAR not null,
    offsets    BIGINT not null,
    status     INT not null,
    node       VARCHAR not null,
    started_at BIGINT not null,
    updated_at BIGINT not null,
    dumped     BOOLEAN default false not null
);
CREATE TABLE IF NOT EXISTS stream_stats
(
    id      INTEGER not null primary key autoincrement,
    org     VARCHAR not null,
    stream  VARCHAR not null,
    file_num BIGINT not null,
    min_ts   BIGINT not null,
    max_ts   BIGINT not null,
    records  BIGINT not null,
    original_size   BIGINT not null,
    compressed_size BIGINT not null,
    index_size      BIGINT not null,
    is_recent       BOOLEAN default false not null
);
CREATE TABLE IF NOT EXISTS file_list_dump_stats
(
    id              INTEGER not null primary key autoincrement,
    org             VARCHAR not null,
    stream          VARCHAR not null,
    date            VARCHAR not null,
    file            VARCHAR not null,
    file_num        BIGINT default 0 not null,
    min_ts          BIGINT default 0 not null,
    max_ts          BIGINT default 0 not null,
    records         BIGINT default 0 not null,
    original_size   BIGINT default 0 not null,
    compressed_size BIGINT default 0 not null,
    index_size      BIGINT default 0 not null
);
CREATE TABLE IF NOT EXISTS pipeline
(
    id              VARCHAR(256) not null primary key,
    version         INT not null,
    enabled         BOOLEAN default true not null,
    name            VARCHAR(256) not null,
    description     TEXT,
    org             VARCHAR(100) not null,
    source_type     VARCHAR(50) not null,
    stream_org      VARCHAR(100),
    stream_name     VARCHAR(256),
    stream_type     VARCHAR(50),
    derived_stream  TEXT,
    nodes           TEXT,
    edges           TEXT
);
                "#,
            )
            .await
            .expect("create the legacy pre-ORM tables");

            // Stage 2, mirroring production's `table::init()`: a few tables are
            // created from their entities BEFORE the migrations run, and later
            // migrations alter them. Skipping this stage fails deep into the
            // migration set with "no such table".
            create_from_entity(&conn, super::short_urls::Entity).await;
            create_from_entity(&conn, super::distinct_values::Entity).await;

            // Stage 3: the real migration set — the whole point of the
            // harness. Anything the entities declare must have been added by a
            // migration, or the round-trip tests fail here.
            Migrator::up(&conn, None)
                .await
                .expect("apply migrations to the test database");
            conn
        })
        .await
}

/// Create one table from its entity definition, ignoring "already exists".
async fn create_from_entity<E>(conn: &DatabaseConnection, entity: E)
where
    E: sea_orm::EntityTrait,
{
    let builder = conn.get_database_backend();
    let stmt = sea_orm::Schema::new(builder)
        .create_table_from_entity(entity)
        .if_not_exists()
        .to_owned();
    conn.execute(builder.build(&stmt))
        .await
        .expect("create table from entity");
}

/// A process-unique alert id, so tests sharing the database cannot collide.
///
/// Takes a caller-supplied prefix so a failing row is traceable back to the
/// test that wrote it.
pub fn unique_alert_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!("{prefix}-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Insert the `alerts` row that a per-group state test implies exists.
///
/// `persist_group_plan` re-reads `multi_alert` from this row inside its own
/// transaction (§5.3 opt-out race), so a test that writes group rows for an
/// alert with no row at all is asserting against a shape production never
/// produces — and, since a missing alert reads as opted-out, would silently
/// assert nothing. Pass `multi_alert: false` to exercise the opted-out path.
pub async fn seed_alert(conn: &DatabaseConnection, alert_id: &str, multi_alert: bool) {
    use sea_orm::{EntityTrait, Set, sea_query::OnConflict};

    use crate::table::entity::{alerts, folders};

    // `alerts.folder_id` is a real foreign key, so the folder has to exist
    // first. One shared folder for every seeded alert is enough.
    let folder = folders::ActiveModel {
        id: Set("default".to_string()),
        org: Set("default".to_string()),
        folder_id: Set("default".to_string()),
        name: Set("default".to_string()),
        description: Set(None),
        r#type: Set(0),
    };
    folders::Entity::insert(folder)
        .on_conflict(OnConflict::column(folders::Column::Id).do_nothing().to_owned())
        .do_nothing()
        .exec(conn)
        .await
        .expect("seed folder row");

    let model = alerts::ActiveModel {
        id: Set(alert_id.to_string()),
        org: Set("default".to_string()),
        folder_id: Set("default".to_string()),
        name: Set(alert_id.to_string()),
        stream_type: Set("logs".to_string()),
        stream_name: Set("s".to_string()),
        is_real_time: Set(false),
        destinations: Set(serde_json::json!([])),
        workflows: Set(serde_json::json!([])),
        trigger_threshold_operator: Set(">=".to_string()),
        // Every remaining NOT NULL column: `..Default::default()` leaves an
        // ActiveModel field `NotSet`, which SQLite rejects rather than
        // defaulting.
        row_template_type: Set(0),
        enabled: Set(true),
        tz_offset: Set(0),
        query_type: Set(0),
        trigger_period_seconds: Set(60),
        trigger_threshold_count: Set(1),
        trigger_frequency_type: Set(0),
        trigger_frequency_seconds: Set(60),
        trigger_silence_seconds: Set(0),
        align_time: Set(false),
        dedup_enabled: Set(false),
        creates_incident: Set(false),
        query_aggregation: Set(Some(serde_json::json!({
            "group_by": ["host"],
            "function": "avg",
            "having": {"column": "v", "operator": ">=", "value": 1},
            "multi_alert": multi_alert,
        }))),
        ..Default::default()
    };
    alerts::Entity::insert(model)
        .on_conflict(
            OnConflict::column(alerts::Column::Id)
                .update_column(alerts::Column::QueryAggregation)
                .to_owned(),
        )
        .exec(conn)
        .await
        .expect("seed alert row");
}
