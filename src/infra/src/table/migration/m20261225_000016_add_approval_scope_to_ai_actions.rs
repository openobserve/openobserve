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

//! Adds `approval_scope` to `ai_actions`: how long the grant a standing write ran under was given
//! for.

use sea_orm_migration::prelude::*;

const ACTIONS: &str = "ai_actions";
const APPROVAL_SCOPE: &str = "approval_scope";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // `add_column_if_not_exists` is not idempotent on SQLite.
        if !manager.has_column(ACTIONS, APPROVAL_SCOPE).await? {
            manager.alter_table(add_statement()).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(ACTIONS, APPROVAL_SCOPE).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(AiActions::Table)
                        .drop_column(AiActions::ApprovalScope)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AiActions {
    Table,
    ApprovalScope,
}

fn add_statement() -> TableAlterStatement {
    Table::alter()
        .table(AiActions::Table)
        .add_column(
            ColumnDef::new(AiActions::ApprovalScope)
                .string_len(16)
                .null()
                .to_owned(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn earlier_rows_have_no_scope() {
        let sql = add_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"approval_scope\" varchar(16) NULL"), "{sql}");
    }

    #[tokio::test]
    async fn up_is_idempotent_and_down_reverts() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE ai_actions (id text, org_id text)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column(ACTIONS, APPROVAL_SCOPE).await.unwrap());
        db.execute_unprepared("INSERT INTO ai_actions (id, org_id) VALUES ('a', 'o')")
            .await
            .unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(ACTIONS, APPROVAL_SCOPE).await.unwrap());
    }
}
