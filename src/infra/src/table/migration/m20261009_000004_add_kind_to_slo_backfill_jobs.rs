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

#[derive(DeriveMigrationName)]
pub struct Migration;

const TABLE: &str = "slo_backfill_jobs";
const KIND: &str = "kind";
const ATTEMPTS: &str = "attempts";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite emits a plain ADD COLUMN for add_column_if_not_exists, so guard explicitly.
        if !manager.has_column(TABLE, KIND).await? {
            manager.alter_table(add_kind_statement()).await?;
        }
        if !manager.has_column(TABLE, ATTEMPTS).await? {
            manager.alter_table(add_attempts_statement()).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(TABLE, ATTEMPTS).await? {
            manager
                .alter_table(drop_column_statement(SloBackfillJobs::Attempts))
                .await?;
        }
        if manager.has_column(TABLE, KIND).await? {
            manager
                .alter_table(drop_column_statement(SloBackfillJobs::Kind))
                .await?;
        }
        Ok(())
    }
}

fn add_kind_statement() -> TableAlterStatement {
    Table::alter()
        .table(SloBackfillJobs::Table)
        .add_column(
            ColumnDef::new(SloBackfillJobs::Kind)
                .string_len(16)
                .not_null()
                .default("backfill"),
        )
        .to_owned()
}

fn add_attempts_statement() -> TableAlterStatement {
    Table::alter()
        .table(SloBackfillJobs::Table)
        .add_column(
            ColumnDef::new(SloBackfillJobs::Attempts)
                .integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

fn drop_column_statement(column: SloBackfillJobs) -> TableAlterStatement {
    Table::alter()
        .table(SloBackfillJobs::Table)
        .drop_column(column)
        .to_owned()
}

#[derive(DeriveIden)]
enum SloBackfillJobs {
    Table,
    Kind,
    Attempts,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            &add_kind_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "slo_backfill_jobs" ADD COLUMN "kind" varchar(16) NOT NULL DEFAULT 'backfill'"#
        );
        assert_eq!(
            &add_attempts_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "slo_backfill_jobs" ADD COLUMN "attempts" integer NOT NULL DEFAULT 0"#
        );
    }

    #[tokio::test]
    async fn test_up_reruns_without_adding_either_column_twice() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE slo_backfill_jobs (slo_id varchar(27) PRIMARY KEY)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(manager.has_column(TABLE, KIND).await.unwrap());
        assert!(manager.has_column(TABLE, ATTEMPTS).await.unwrap());

        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TABLE, KIND).await.unwrap());
        assert!(!manager.has_column(TABLE, ATTEMPTS).await.unwrap());
    }

    #[tokio::test]
    async fn test_up_reruns_adds_attempts_to_a_table_that_already_has_kind() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE slo_backfill_jobs (slo_id varchar(27) PRIMARY KEY, \
             kind varchar(16) NOT NULL DEFAULT 'backfill')",
        )
        .await
        .unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column(TABLE, ATTEMPTS).await.unwrap());
    }
}
