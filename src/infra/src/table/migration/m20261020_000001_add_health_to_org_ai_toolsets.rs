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

//! Adds `enabled` (default true) and the nullable health columns to `org_ai_toolsets`.

use sea_orm_migration::prelude::*;

const TOOLSETS: &str = "org_ai_toolsets";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in OrgAiToolsets::COLUMNS {
            add_column(manager, column).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in OrgAiToolsets::COLUMNS.into_iter().rev() {
            if manager
                .has_column(TOOLSETS, &column.into_iden().to_string())
                .await?
            {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(TOOLSETS))
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum OrgAiToolsets {
    Enabled,
    StatusState,
    StatusSince,
    LastError,
    LastUsedAt,
}

impl OrgAiToolsets {
    const COLUMNS: [Self; 5] = [
        Self::Enabled,
        Self::StatusState,
        Self::StatusSince,
        Self::LastError,
        Self::LastUsedAt,
    ];
}

fn column_def(column: OrgAiToolsets) -> ColumnDef {
    let mut def = ColumnDef::new(column);
    match column {
        OrgAiToolsets::Enabled => def.boolean().not_null().default(true),
        OrgAiToolsets::StatusState => def.string_len(16).null(),
        OrgAiToolsets::LastError => def.string_len(256).null(),
        OrgAiToolsets::StatusSince | OrgAiToolsets::LastUsedAt => def.big_integer().null(),
    }
    .to_owned()
}

// SQLite: one alter option per statement, and `add_column_if_not_exists` is not idempotent.
async fn add_column(manager: &SchemaManager<'_>, column: OrgAiToolsets) -> Result<(), DbErr> {
    if manager
        .has_column(TOOLSETS, &column.into_iden().to_string())
        .await?
    {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(TOOLSETS))
                .add_column(column_def(column))
                .to_owned(),
        )
        .await
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn existing_toolsets_stay_enabled() {
        let sql = Table::alter()
            .table(Alias::new(TOOLSETS))
            .add_column(column_def(OrgAiToolsets::Enabled))
            .to_owned()
            .to_string(PostgresQueryBuilder);
        assert!(
            sql.contains("\"enabled\" bool NOT NULL DEFAULT TRUE"),
            "{sql}"
        );
    }

    #[tokio::test]
    async fn up_is_idempotent_keeps_rows_enabled_and_down_reverts() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE org_ai_toolsets (id text, org text)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO org_ai_toolsets (id, org) VALUES ('t', 'o')")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT enabled, status_state FROM org_ai_toolsets",
            ))
            .await
            .unwrap()
            .unwrap();
        assert!(row.try_get::<bool>("", "enabled").unwrap());
        assert!(
            row.try_get::<Option<String>>("", "status_state")
                .unwrap()
                .is_none()
        );
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TOOLSETS, "enabled").await.unwrap());
        assert!(!manager.has_column(TOOLSETS, "last_used_at").await.unwrap());
    }
}
