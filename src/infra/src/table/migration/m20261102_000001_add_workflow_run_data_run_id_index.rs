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

//! Indexes `workflow_run_data.run_id`, which each HTTP trigger run reads and deletes by.

use sea_orm_migration::prelude::*;

const RUN_ID_IDX: &str = "workflow_run_data_run_id_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_index(create_run_id_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(RUN_ID_IDX)
                    .table(WorkflowRunData::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum WorkflowRunData {
    Table,
    RunId,
}

fn create_run_id_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(RUN_ID_IDX)
        .table(WorkflowRunData::Table)
        .col(WorkflowRunData::RunId)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_index_builds_on_both_backends() {
        let expected = r#"CREATE INDEX IF NOT EXISTS "workflow_run_data_run_id_idx" ON "workflow_run_data" ("run_id")"#;
        assert_eq!(
            create_run_id_index().to_string(PostgresQueryBuilder),
            expected
        );
        assert_eq!(
            create_run_id_index().to_string(SqliteQueryBuilder),
            expected
        );
    }

    #[tokio::test]
    async fn down_then_up_is_idempotent() {
        let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = sea_orm::Database::connect(opts).await.unwrap();
        let manager = SchemaManager::new(&db);
        super::super::m20260720_000001_create_workflow_run_data_table::Migration
            .up(&manager)
            .await
            .unwrap();
        Migration.up(&manager).await.expect("first up");
        Migration.up(&manager).await.expect("second up");
        assert!(
            manager
                .has_index("workflow_run_data", RUN_ID_IDX)
                .await
                .unwrap()
        );
        Migration.down(&manager).await.expect("first down");
        Migration.down(&manager).await.expect("second down");
        assert!(
            !manager
                .has_index("workflow_run_data", RUN_ID_IDX)
                .await
                .unwrap()
        );
    }
}
