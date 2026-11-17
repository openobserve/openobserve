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

//! Marks a security case whose firings all came from a backfill over past data.

use sea_orm_migration::prelude::*;

const TABLE: &str = "alert_incidents";
const COLUMN: &str = "historical";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS, so a retry must skip the column already added.
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
                    .table(AlertIncidents::Table)
                    .drop_column(AlertIncidents::Historical)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    Historical,
}

fn add_column_statement() -> TableAlterStatement {
    Table::alter()
        .table(AlertIncidents::Table)
        .add_column(
            ColumnDef::new(AlertIncidents::Historical)
                .boolean()
                .not_null()
                .default(false),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            &add_column_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_incidents" ADD COLUMN "historical" bool NOT NULL DEFAULT FALSE"#
        );
    }

    #[tokio::test]
    async fn existing_incidents_are_current_and_a_rerun_is_a_no_op() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE alert_incidents (id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO alert_incidents VALUES ('old')")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT historical FROM alert_incidents WHERE id = 'old'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert!(!row.try_get::<bool>("", "historical").unwrap());
    }
}
