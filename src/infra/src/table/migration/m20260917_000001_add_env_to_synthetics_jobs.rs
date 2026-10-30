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

use sea_orm::{ConnectionTrait, Statement};
use sea_orm_migration::prelude::*;

use crate::table::synthetics_jobs::{DEDUP_UQ, dedup_index_sql};

#[derive(DeriveMigrationName)]
pub struct Migration;

/// The pre-existing three-column key, created by the jobs migration.
const OLD_DEDUP_UQ: &str = "synthetics_jobs_dedup_uq";

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
        db.execute(Statement::from_string(backend, dedup_index_sql(backend)))
            .await?;
        manager.drop_index(drop_dedup_idx(OLD_DEDUP_UQ)).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_index(create_old_dedup_uq()).await?;
        manager.drop_index(drop_dedup_idx(DEDUP_UQ)).await?;
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
fn drop_dedup_idx(name: &str) -> IndexDropStatement {
    sea_query::Index::drop()
        .name(name)
        .table(SyntheticsJobs::Table)
        .to_owned()
}

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
            drop_dedup_idx(DEDUP_UQ).to_string(SqliteQueryBuilder),
            r#"DROP INDEX "synthetics_jobs_dedup_env_uq""#
        );
    }

    #[test]
    fn down_recreates_the_key_the_jobs_migration_created() {
        assert_eq!(
            create_old_dedup_uq().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_jobs_dedup_uq" ON "synthetics_jobs" ("synthetics_id", "location", "scheduled_ts")"#
        );
    }

    /// The statements are only half the migration; this runs it.
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
}
