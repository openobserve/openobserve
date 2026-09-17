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

//! Give a job the environment it was fanned out for, and widen the dedup key
//! to match.
//!
//! The column alone would not be enough. `enqueue` relies on
//! `ON CONFLICT (synthetics_id, location, scheduled_ts) DO NOTHING` to stop
//! double-scheduling, and a check running against two environments produces
//! jobs that differ in nothing else at the same tick — so every environment
//! after the first was silently discarded by the conflict clause. Fan-out is
//! only real once this key includes `env`.
//!
//! **Rolling upgrades take a bounded enqueue gap, deliberately.** A node on the
//! old release targets the three-column key, and once this migration drops it
//! that node's inserts fail until it is replaced — no jobs are queued by it for
//! the length of the rollout. The alternative is splitting the swap across two
//! releases, and the price of that is a release where fan-out is merged but
//! still silently drops every environment after the first, which is the bug
//! this migration exists to fix. `m20241217_154900_alter_folders_table_idx` is
//! the precedent: it swaps a unique index in one release too. Nodes on the new
//! release enqueue normally throughout, and the scheduler re-queues on its next
//! tick, so the gap costs monitoring coverage rather than data.
//!
//! MySQL is not a supported meta store — `MetaStore` is `Sqlite | Nats |
//! PostgreSQL`, and sea-orm is compiled with `sqlx-postgres` and `sqlx-sqlite`
//! only — so no MySQL arm here is reachable. The index statements are still
//! written to emit valid MySQL, but the arm in `new_dedup_sql` indexes bare
//! `env` and so would not dedup unscoped jobs, and `enqueue`'s `ON CONFLICT` is
//! Postgres syntax MySQL cannot parse at all. Supporting MySQL is separate work.

use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// The pre-existing three-column key, created by the jobs migration.
const OLD_DEDUP_UQ: &str = "synthetics_jobs_dedup_uq";
/// Its replacement, which also distinguishes environments.
const NEW_DEDUP_UQ: &str = "synthetics_jobs_dedup_env_uq";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsJobs::Table)
                    .add_column_if_not_exists(ColumnDef::new(SyntheticsJobs::Env).string_len(256))
                    .to_owned(),
            )
            .await?;

        let db = manager.get_connection();
        let backend = db.get_database_backend();
        // The new key must exist before the old one goes, or a tick in the gap double-schedules.
        db.execute(Statement::from_string(backend, new_dedup_sql(backend)))
            .await?;
        manager.drop_index(drop_dedup_idx(OLD_DEDUP_UQ)).await?;
        Ok(())
    }

    /// One-way in practice: the recreated three-column key is unique, and the
    /// jobs table keeps completed rows, so the first `CREATE UNIQUE INDEX`
    /// fails as soon as any check has run against two environments. It fails on
    /// the first statement and leaves nothing half-applied, and nothing calls
    /// this path — `table::down` has no callers and there is no CLI command —
    /// so it is written to be correct rather than made to succeed.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_index(create_old_dedup_uq()).await?;
        manager.drop_index(drop_dedup_idx(NEW_DEDUP_UQ)).await?;
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsJobs::Table)
                    .drop_column(SyntheticsJobs::Env)
                    .to_owned(),
            )
            .await
    }
}

/// Drops a plain index by name, the way every other migration here does.
///
/// `if_exists` is deliberately absent: sea-query panics on it for MySQL, and
/// both keys are created unconditionally — the old one by
/// `m20260707_000003_create_synthetics_jobs`, the new one just above.
fn drop_dedup_idx(name: &str) -> IndexDropStatement {
    sea_query::Index::drop()
        .name(name)
        .table(SyntheticsJobs::Table)
        .to_owned()
}

/// The three-column key exactly as `m20260707_000003_create_synthetics_jobs`
/// created it, for `down()` to put back.
fn create_old_dedup_uq() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(OLD_DEDUP_UQ)
        .table(SyntheticsJobs::Table)
        .col(SyntheticsJobs::SyntheticsId)
        .col(SyntheticsJobs::Location)
        .col(SyntheticsJobs::ScheduledTs)
        .unique()
        .to_owned()
}

/// The dedup key, with `env` COALESCEd.
///
/// The only raw statement here, because it indexes an expression and the
/// sea-orm builder has no way to express one — the drops and `down()`'s
/// recreate are plain indexes and go through the builder instead.
///
/// Same reason as `synthetics_variables`: PostgreSQL and SQLite both treat
/// NULLs as distinct inside a unique index, and an unscoped job has `env` NULL.
/// Without the COALESCE the key would stop deduplicating exactly the jobs it
/// exists to deduplicate — every check that targets no environment, which is
/// every check that exists today.
pub(crate) fn new_dedup_sql(backend: DatabaseBackend) -> String {
    match backend {
        DatabaseBackend::Postgres | DatabaseBackend::Sqlite => format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {NEW_DEDUP_UQ} ON synthetics_jobs \
             (synthetics_id, location, scheduled_ts, (COALESCE(env, '')))"
        ),
        DatabaseBackend::MySql => format!(
            "CREATE UNIQUE INDEX {NEW_DEDUP_UQ} ON synthetics_jobs (synthetics_id, location, \
             scheduled_ts, env)"
        ),
    }
}

#[derive(DeriveIden)]
enum SyntheticsJobs {
    Table,
    Env,
    SyntheticsId,
    Location,
    ScheduledTs,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// MySQL has no `DROP INDEX IF EXISTS` and requires the table, so the raw
    /// statement this replaced could not run there at all.
    #[test]
    fn the_mysql_index_drop_names_its_table_and_omits_if_exists() {
        let sql = drop_dedup_idx(OLD_DEDUP_UQ).to_string(MysqlQueryBuilder);
        assert_eq!(
            sql,
            "DROP INDEX `synthetics_jobs_dedup_uq` ON `synthetics_jobs`"
        );
        assert!(!sql.contains("IF EXISTS"), "{sql}");
    }

    #[test]
    fn the_index_drops_name_the_right_index_on_every_backend() {
        assert_eq!(
            drop_dedup_idx(OLD_DEDUP_UQ).to_string(PostgresQueryBuilder),
            r#"DROP INDEX "synthetics_jobs_dedup_uq""#
        );
        assert_eq!(
            drop_dedup_idx(NEW_DEDUP_UQ).to_string(SqliteQueryBuilder),
            r#"DROP INDEX "synthetics_jobs_dedup_env_uq""#
        );
    }

    /// `down()` has to put back exactly what `m20260707_000003` created, or a
    /// rolled-back database keeps a key that dedupes something else.
    #[test]
    fn down_recreates_the_key_the_jobs_migration_created() {
        assert_eq!(
            create_old_dedup_uq().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_jobs_dedup_uq" ON "synthetics_jobs" ("synthetics_id", "location", "scheduled_ts")"#
        );
    }

    /// The statements are only half the migration; this runs it.
    ///
    /// Without it, swapping the two index constants at the call sites in `up()`
    /// leaves every string assertion above green while production keeps the
    /// three-column key — and every fan-out insert then fails.
    #[tokio::test]
    async fn up_swaps_the_key_so_two_environments_are_two_jobs() {
        use sea_orm::Database;

        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE synthetics_jobs (id varchar(27) NOT NULL PRIMARY KEY, synthetics_id \
             varchar(27) NOT NULL, location varchar(64) NOT NULL, scheduled_ts bigint NOT NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "CREATE UNIQUE INDEX synthetics_jobs_dedup_uq ON synthetics_jobs (synthetics_id, \
             location, scheduled_ts)",
        )
        .await
        .unwrap();

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let insert = |id: &str, env: &str| {
            format!(
                "INSERT INTO synthetics_jobs (id, synthetics_id, location, scheduled_ts, env) \
                 VALUES ('{id}', 'mon-1', 'aws-us-east-1', 1, {env})"
            )
        };
        // The old three-column key is gone: one tick, two environments, two jobs.
        db.execute_unprepared(&insert("j1", "'prod'"))
            .await
            .unwrap();
        db.execute_unprepared(&insert("j2", "'staging'"))
            .await
            .unwrap();
        assert!(
            db.execute_unprepared(&insert("j3", "'prod'"))
                .await
                .is_err(),
            "a second job for one environment at one tick must still collide"
        );

        // The COALESCE keeps deduplicating the unscoped job, which is every job today.
        db.execute_unprepared(&insert("j4", "NULL")).await.unwrap();
        assert!(
            db.execute_unprepared(&insert("j5", "NULL")).await.is_err(),
            "two unscoped jobs at one tick must collide"
        );
    }

    /// The COALESCE must survive review. Without it an unscoped job — which is
    /// every job today — stops being deduplicated at all.
    #[test]
    fn the_dedup_key_coalesces_a_null_environment() {
        for backend in [DatabaseBackend::Postgres, DatabaseBackend::Sqlite] {
            let sql = new_dedup_sql(backend);
            assert!(sql.contains("COALESCE(env, '')"), "{backend:?}: {sql}");
            assert!(sql.contains("UNIQUE INDEX"), "{backend:?}: {sql}");
            // The three original columns still have to be part of the key.
            for col in ["synthetics_id", "location", "scheduled_ts"] {
                assert!(sql.contains(col), "{backend:?} lost {col}: {sql}");
            }
        }
    }
}
