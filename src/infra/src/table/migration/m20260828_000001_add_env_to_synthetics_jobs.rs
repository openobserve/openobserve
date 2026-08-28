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
        // Order matters: the new key has to exist before the old one is dropped,
        // or a scheduler tick landing in the gap could double-schedule.
        db.execute(Statement::from_string(backend, new_dedup_sql(backend)))
            .await?;
        db.execute(Statement::from_string(
            backend,
            format!("DROP INDEX IF EXISTS {OLD_DEDUP_UQ}"),
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        db.execute(Statement::from_string(
            backend,
            format!(
                "CREATE UNIQUE INDEX IF NOT EXISTS {OLD_DEDUP_UQ} ON synthetics_jobs \
                 (synthetics_id, location, scheduled_ts)"
            ),
        ))
        .await?;
        db.execute(Statement::from_string(
            backend,
            format!("DROP INDEX IF EXISTS {NEW_DEDUP_UQ}"),
        ))
        .await?;
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

/// The dedup key, with `env` COALESCEd.
///
/// Same reason as `synthetics_variables`: PostgreSQL and SQLite both treat
/// NULLs as distinct inside a unique index, and an unscoped job has `env` NULL.
/// Without the COALESCE the key would stop deduplicating exactly the jobs it
/// exists to deduplicate — every check that targets no environment, which is
/// every check that exists today.
fn new_dedup_sql(backend: DatabaseBackend) -> String {
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
