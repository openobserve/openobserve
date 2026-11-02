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

//! `episode_opened_at`: start of an incident's notification episode, filled from created_at.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Explicit guard because `add_column_if_not_exists` is not idempotent on SQLite.
        if !manager.has_column(INCIDENTS, COLUMN).await? {
            manager.alter_table(add_column_stmt()).await?;
        }
        manager
            .get_connection()
            .execute_unprepared(BACKFILL)
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(INCIDENTS, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new(INCIDENTS))
                    .drop_column(Alias::new(COLUMN))
                    .to_owned(),
            )
            .await
    }
}

const INCIDENTS: &str = "alert_incidents";
const COLUMN: &str = "episode_opened_at";
const BACKFILL: &str =
    "UPDATE alert_incidents SET episode_opened_at = created_at WHERE episode_opened_at = 0";

fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(Alias::new(INCIDENTS))
        .add_column(
            ColumnDef::new(Alias::new(COLUMN))
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[tokio::test]
    async fn up_backfills_from_created_at_and_reruns() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE alert_incidents (id TEXT PRIMARY KEY, created_at BIGINT NOT NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared("INSERT INTO alert_incidents VALUES ('i1', 42)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT episode_opened_at FROM alert_incidents WHERE id = 'i1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "episode_opened_at").unwrap(), 42);
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(INCIDENTS, COLUMN).await.unwrap());
    }

    #[test]
    fn migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261110_000003_add_incident_episode_opened_at"
        );
    }
}
