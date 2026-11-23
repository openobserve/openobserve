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

//! Deletes every saved `cli` AI toolset, a kind that no longer exists.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    /// Its env vars and credential files would otherwise stay stored with no kind to use them.
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let delete = Query::delete()
            .from_table(OrgAiToolsets::Table)
            .and_where(Expr::col(OrgAiToolsets::Kind).eq("cli"))
            .to_owned();
        manager.exec_stmt(delete).await
    }

    /// The deleted credentials cannot be restored.
    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

#[derive(DeriveIden)]
enum OrgAiToolsets {
    Table,
    Kind,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};

    use super::*;

    #[tokio::test]
    async fn only_cli_toolsets_are_deleted() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE org_ai_toolsets (id TEXT PRIMARY KEY, kind TEXT)")
            .await
            .unwrap();
        db.execute_unprepared(
            "INSERT INTO org_ai_toolsets VALUES ('a', 'mcp'), ('b', 'cli'), ('c', 'skill'), \
             ('d', 'generic')",
        )
        .await
        .unwrap();
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        let sql = "SELECT id FROM org_ai_toolsets ORDER BY id";
        let rows = db
            .query_all(Statement::from_string(db.get_database_backend(), sql))
            .await
            .unwrap();
        let ids: Vec<String> = rows
            .iter()
            .map(|r| r.try_get::<String>("", "id").unwrap())
            .collect();
        assert_eq!(ids, ["a", "c", "d"]);
    }
}
