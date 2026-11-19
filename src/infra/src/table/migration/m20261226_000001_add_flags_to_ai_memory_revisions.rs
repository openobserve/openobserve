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

//! Why a pending memory edit may need a closer look: a JSON list of flags, or NULL for none.

use sea_orm_migration::prelude::*;

const TABLE: &str = "ai_memory_revisions";
const COLUMN: &str = "flags";

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
                    .table(AiMemoryRevisions::Table)
                    .drop_column(AiMemoryRevisions::Flags)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AiMemoryRevisions {
    Table,
    Flags,
}

fn add_column_statement() -> TableAlterStatement {
    Table::alter()
        .table(AiMemoryRevisions::Table)
        .add_column(ColumnDef::new(AiMemoryRevisions::Flags).text().null())
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
            r#"ALTER TABLE "ai_memory_revisions" ADD COLUMN "flags" text NULL"#
        );
    }

    #[tokio::test]
    async fn existing_revisions_have_no_flags_and_a_rerun_is_a_no_op() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE ai_memory_revisions (id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO ai_memory_revisions VALUES ('old')")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT flags FROM ai_memory_revisions WHERE id = 'old'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<Option<String>>("", "flags").unwrap(), None);
    }
}
