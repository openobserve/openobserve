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
use sea_orm_migration::prelude::*;

/// Backfill for rows enqueued before this column existed. At the ack this count
/// becomes the clamp ceiling `steps_configured × (retries + 1)`, so a small
/// default (0 or 1) would clamp real work down and WRONG-BILL an in-flight
/// 14-step journey as 2. 50 is `MAX_STEPS`, the most a browser journey may
/// legally define, so the clamp is a no-op for every legacy row; finite rather
/// than `i32::MAX` so the multiply cannot overflow. Later inserts set it.
const LEGACY_STEPS_CONFIGURED: i32 = 50;

#[derive(DeriveMigrationName)]
pub struct Migration;

fn add_steps_configured_statement() -> TableAlterStatement {
    Table::alter()
        .table(SyntheticsJobs::Table)
        .add_column_if_not_exists(
            ColumnDef::new(SyntheticsJobs::StepsConfigured)
                .integer()
                .not_null()
                .default(LEGACY_STEPS_CONFIGURED),
        )
        .to_owned()
}

fn drop_steps_configured_statement() -> TableAlterStatement {
    Table::alter()
        .table(SyntheticsJobs::Table)
        .drop_column(SyntheticsJobs::StepsConfigured)
        .to_owned()
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(add_steps_configured_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(drop_steps_configured_statement()).await
    }
}

#[derive(DeriveIden)]
enum SyntheticsJobs {
    Table,
    StepsConfigured,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_steps_configured_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics_jobs" ADD COLUMN IF NOT EXISTS "steps_configured" integer NOT NULL DEFAULT 50"#
        );
    }

    #[test]
    fn sqlite() {
        // SQLite has no IF NOT EXISTS on ALTER TABLE ADD COLUMN, so
        // add_column_if_not_exists emits the same SQL as add_column.
        collapsed_eq!(
            &add_steps_configured_statement().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "synthetics_jobs" ADD COLUMN "steps_configured" integer NOT NULL DEFAULT 50"#
        );
    }

    /// SQLite can refuse: `ALTER TABLE ... ADD COLUMN` rejects a NOT NULL column
    /// without a default, and validating the rows already there is its whole job.
    #[tokio::test]
    async fn the_alter_applies_on_sqlite_and_backfills_the_rows_already_there() {
        use sea_orm::{ConnectionTrait, Database, Statement};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE synthetics_jobs (id varchar(27) NOT NULL PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared(
            "INSERT INTO synthetics_jobs (id) VALUES ('in-flight-when-we-deployed')",
        )
        .await
        .unwrap();

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT steps_configured FROM synthetics_jobs",
            ))
            .await
            .unwrap()
            .expect("the pre-existing row must survive the ALTER");
        assert_eq!(
            row.try_get::<i32>("", "steps_configured").unwrap(),
            LEGACY_STEPS_CONFIGURED,
            "a row enqueued before this column existed must come back with the backfill"
        );
    }

    /// Only the `Box::new(..)` line in `Migrator::migrations()` makes the
    /// migration run; miss it and every other test still passes regardless.
    #[test]
    fn the_migration_runs_and_runs_after_the_table_it_alters() {
        use sea_orm_migration::MigratorTrait as _;

        const ME: &str = "m20260825_000001_add_steps_configured_to_synthetics_jobs";
        const CREATE_TABLE: &str = "m20260707_000003_create_synthetics_jobs";

        let names: Vec<String> = crate::table::migration::Migrator::migrations()
            .into_iter()
            .map(|m| m.name().to_string())
            .collect();

        assert_eq!(
            names.iter().filter(|n| n.as_str() == ME).count(),
            1,
            "the Box::new(..) line in Migrator::migrations() is missing or duplicated"
        );
        let create = names
            .iter()
            .position(|n| n == CREATE_TABLE)
            .expect("the table this alters must be created by an earlier migration");
        let alter = names.iter().position(|n| n == ME).unwrap();
        assert!(
            alter > create,
            "ALTER TABLE must be ordered after the CREATE TABLE it depends on"
        );
    }
}
