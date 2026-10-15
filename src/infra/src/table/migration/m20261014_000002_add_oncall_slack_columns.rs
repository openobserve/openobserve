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

//! A page's home region and a team's Slack room; nullable, so NULL reads as "not set".

use sea_orm_migration::prelude::*;

/// Table that gains `home_region`.
const ONCALL_RESPONSES: &str = "oncall_responses";
/// Table that gains the Slack room columns.
const ONCALL_TEAMS: &str = "oncall_teams";
/// The team's Slack room columns, in the order they are added.
const TEAM_COLUMNS: [&str; 4] = [
    "slack_workspace_id",
    "slack_channel_id",
    "slack_channel_name",
    "slack_same_room_destination",
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One alter option per statement, plus a `has_column` guard — see `m20260824_000001`.
        add_column(manager, ONCALL_RESPONSES, OncallResponses::HomeRegion).await?;
        for column in TEAM_COLUMNS {
            add_column(manager, ONCALL_TEAMS, Alias::new(column)).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in TEAM_COLUMNS.into_iter().rev() {
            drop_column(manager, ONCALL_TEAMS, Alias::new(column)).await?;
        }
        drop_column(manager, ONCALL_RESPONSES, OncallResponses::HomeRegion).await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum OncallResponses {
    HomeRegion,
}

/// Adds a nullable string column; idempotent unlike `add_column_if_not_exists` on SQLite.
async fn add_column<C>(manager: &SchemaManager<'_>, table: &str, column: C) -> Result<(), DbErr>
where
    C: IntoIden + Clone,
{
    let name = column.clone().into_iden().to_string();
    if manager.has_column(table, &name).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .add_column(ColumnDef::new(column).string().null())
                .to_owned(),
        )
        .await
}

/// Drops a column if it is there, so `down` can be retried.
async fn drop_column<C>(manager: &SchemaManager<'_>, table: &str, column: C) -> Result<(), DbErr>
where
    C: IntoIden + Clone,
{
    let name = column.clone().into_iden().to_string();
    if !manager.has_column(table, &name).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .drop_column(column)
                .to_owned(),
        )
        .await
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for table in [ONCALL_RESPONSES, ONCALL_TEAMS] {
            db.execute(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!("CREATE TABLE {table} (id TEXT PRIMARY KEY)"),
            ))
            .await
            .unwrap();
        }
        db
    }

    async fn has(manager: &SchemaManager<'_>, table: &str, column: &str) -> bool {
        manager.has_column(table, column).await.unwrap()
    }

    #[tokio::test]
    async fn test_up_adds_the_columns_and_is_idempotent_and_down_removes_them() {
        let db = db().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(has(&manager, ONCALL_RESPONSES, "home_region").await);
        for column in TEAM_COLUMNS {
            assert!(has(&manager, ONCALL_TEAMS, column).await, "{column}");
        }

        Migration.down(&manager).await.expect("first down");
        Migration.down(&manager).await.expect("second down");
        assert!(!has(&manager, ONCALL_RESPONSES, "home_region").await);
        for column in TEAM_COLUMNS {
            assert!(!has(&manager, ONCALL_TEAMS, column).await, "{column}");
        }
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261014_000002_add_oncall_slack_columns"
        );
    }
}
