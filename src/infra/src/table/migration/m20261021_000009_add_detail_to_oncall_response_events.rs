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

//! Adds the nullable `detail` to `oncall_response_events` for an `AiVerdict`'s evidence.

use sea_orm_migration::prelude::*;

const EVENTS: &str = "oncall_response_events";
const COLUMN: &str = "detail";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite: `add_column_if_not_exists` is not idempotent.
        if manager.has_column(EVENTS, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(EVENTS, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(OncallResponseEvents::Table)
                    .drop_column(OncallResponseEvents::Detail)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OncallResponseEvents {
    Table,
    Detail,
}

fn add_statement() -> TableAlterStatement {
    Table::alter()
        .table(OncallResponseEvents::Table)
        .add_column(ColumnDef::new(OncallResponseEvents::Detail).text().null())
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn existing_events_have_no_detail() {
        let sql = add_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"detail\" text NULL"), "{sql}");
    }

    #[tokio::test]
    async fn up_is_idempotent_and_down_reverts() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE oncall_response_events (id text, body text)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column(EVENTS, COLUMN).await.unwrap());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(EVENTS, COLUMN).await.unwrap());
    }
}
