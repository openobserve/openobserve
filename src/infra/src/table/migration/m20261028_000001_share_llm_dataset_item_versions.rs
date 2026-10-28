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

//! Lets every row of one Dataset write request share that request's version.
//!
//! A version was unique per Dataset, so a batch had to take one version per
//! row. It is now unique per logical Item chain within a Dataset. Existing
//! rows are untouched, so every existing pin resolves to the same rows.

use sea_orm_migration::prelude::*;

const OLD_VERSION_INDEX: &str = "uq_llm_dataset_items_version";
const OLD_LATEST_INDEX: &str = "idx_llm_dataset_items_latest";
const NEW_LATEST_INDEX: &str = "uq_llm_dataset_items_logical_version";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // The new index also serves the latest-row lookups the old one did.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .unique()
                    .name(NEW_LATEST_INDEX)
                    .table(LlmDatasetItems::Table)
                    .col(LlmDatasetItems::DatasetId)
                    .col(LlmDatasetItems::LogicalId)
                    .col(LlmDatasetItems::GlobalVersion)
                    .to_owned(),
            )
            .await?;
        for name in [OLD_LATEST_INDEX, OLD_VERSION_INDEX] {
            manager
                .drop_index(
                    Index::drop()
                        .if_exists()
                        .name(name)
                        .table(LlmDatasetItems::Table)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    /// Fails if a write request has already shared a version across rows:
    /// the old per-Dataset uniqueness cannot hold for that data.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .unique()
                    .name(OLD_VERSION_INDEX)
                    .table(LlmDatasetItems::Table)
                    .col(LlmDatasetItems::DatasetId)
                    .col(LlmDatasetItems::GlobalVersion)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(OLD_LATEST_INDEX)
                    .table(LlmDatasetItems::Table)
                    .col(LlmDatasetItems::DatasetId)
                    .col(LlmDatasetItems::LogicalId)
                    .col(LlmDatasetItems::GlobalVersion)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(NEW_LATEST_INDEX)
                    .table(LlmDatasetItems::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum LlmDatasetItems {
    Table,
    DatasetId,
    LogicalId,
    GlobalVersion,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261028_000001_share_llm_dataset_item_versions"
        );
    }

    async fn items_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE llm_dataset_items (row_id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, \
             logical_id TEXT NOT NULL, global_version BIGINT NOT NULL)",
            "CREATE UNIQUE INDEX uq_llm_dataset_items_version ON llm_dataset_items (dataset_id, \
             global_version)",
            "CREATE INDEX idx_llm_dataset_items_latest ON llm_dataset_items (dataset_id, \
             logical_id, global_version)",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        db
    }

    async fn insert(db: &DatabaseConnection, row_id: &str, logical_id: &str, version: i64) -> bool {
        db.execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            "INSERT INTO llm_dataset_items (row_id, dataset_id, logical_id, global_version) \
             VALUES (?, 'dataset-1', ?, ?)",
            [row_id.into(), logical_id.into(), version.into()],
        ))
        .await
        .is_ok()
    }

    #[tokio::test]
    async fn rows_of_one_write_may_share_a_version_but_one_chain_may_not() {
        let db = items_db().await;
        assert!(insert(&db, "row-1", "item-1", 1).await);
        assert!(!insert(&db, "row-2", "item-2", 1).await);

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        assert!(insert(&db, "row-2", "item-2", 1).await);
        assert!(!insert(&db, "row-3", "item-1", 1).await);
        // Re-running is harmless.
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
    }
}
