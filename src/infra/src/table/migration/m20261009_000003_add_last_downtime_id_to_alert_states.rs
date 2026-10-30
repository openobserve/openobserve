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

const TABLE: &str = "alert_states";
const COLUMN: &str = "last_downtime_id";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite emits a plain ADD COLUMN for add_column_if_not_exists, so guard explicitly.
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_column_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(AlertStates::Table)
                    .drop_column(AlertStates::LastDowntimeId)
                    .to_owned(),
            )
            .await
    }
}

fn add_column_statement() -> TableAlterStatement {
    Table::alter()
        .table(AlertStates::Table)
        .add_column(
            ColumnDef::new(AlertStates::LastDowntimeId)
                .string_len(27)
                .null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertStates {
    Table,
    LastDowntimeId,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            &add_column_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_states" ADD COLUMN "last_downtime_id" varchar(27) NULL"#
        );
    }

    #[tokio::test]
    async fn test_up_reruns_without_adding_the_column_twice() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE alert_states (id varchar(27) PRIMARY KEY)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(manager.has_column(TABLE, COLUMN).await.unwrap());

        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TABLE, COLUMN).await.unwrap());
    }
}
