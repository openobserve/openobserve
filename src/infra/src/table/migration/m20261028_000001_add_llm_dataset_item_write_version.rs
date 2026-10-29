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

//! Adds the nullable `write_version` to `llm_dataset_items`: the Dataset version a row's write
//! request was shown as. NULL marks a row written before this column or by an older node.
//! The existing row-version indexes are untouched; one new index lets a write find the Dataset's
//! highest label (and the highest legacy row version) without scanning its history.

use sea_orm_migration::prelude::*;

const LLM_DATASET_ITEMS: &str = "llm_dataset_items";
const WRITE_VERSION: &str = "write_version";
const WRITE_VERSION_IDX: &str = "idx_llm_dataset_items_write_version";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(LLM_DATASET_ITEMS, WRITE_VERSION).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(LlmDatasetItems::Table)
                        .add_column(
                            ColumnDef::new(LlmDatasetItems::WriteVersion)
                                .big_integer()
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if !manager
            .has_index(LLM_DATASET_ITEMS, WRITE_VERSION_IDX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(WRITE_VERSION_IDX)
                        .table(LlmDatasetItems::Table)
                        .col(LlmDatasetItems::DatasetId)
                        .col(LlmDatasetItems::WriteVersion)
                        .col(LlmDatasetItems::GlobalVersion)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_index(LLM_DATASET_ITEMS, WRITE_VERSION_IDX)
            .await?
        {
            manager
                .drop_index(
                    Index::drop()
                        .name(WRITE_VERSION_IDX)
                        .table(LlmDatasetItems::Table)
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column(LLM_DATASET_ITEMS, WRITE_VERSION).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(LlmDatasetItems::Table)
                    .drop_column(LlmDatasetItems::WriteVersion)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum LlmDatasetItems {
    Table,
    DatasetId,
    WriteVersion,
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
            "m20261028_000001_add_llm_dataset_item_write_version"
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
            "INSERT INTO llm_dataset_items VALUES ('row-1', 'dataset-1', 'item-1', 1)",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        db
    }

    async fn index_names(db: &DatabaseConnection) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = \
                 'llm_dataset_items' AND sql IS NOT NULL ORDER BY name",
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|row| row.try_get::<String>("", "name").unwrap())
            .collect()
    }

    async fn insert(db: &DatabaseConnection, row_id: &str, version: i64) -> bool {
        db.execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            "INSERT INTO llm_dataset_items (row_id, dataset_id, logical_id, global_version, \
             write_version) VALUES (?, 'dataset-1', ?, ?, 2)",
            [row_id.into(), row_id.into(), version.into()],
        ))
        .await
        .is_ok()
    }

    #[tokio::test]
    async fn up_adds_a_nullable_column_and_one_head_index_keeping_the_version_indexes() {
        let db = items_db().await;
        let manager = SchemaManager::new(&db);
        let mut indexes = index_names(&db).await;

        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        assert!(
            manager
                .has_column(LLM_DATASET_ITEMS, WRITE_VERSION)
                .await
                .unwrap()
        );
        indexes.push(WRITE_VERSION_IDX.to_string());
        indexes.sort();
        assert_eq!(index_names(&db).await, indexes);
        // The pre-existing row reads as NULL: a legacy write.
        let legacy = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT write_version FROM llm_dataset_items WHERE row_id = 'row-1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            legacy.try_get::<Option<i64>>("", WRITE_VERSION).unwrap(),
            None
        );
        // Rows of one write share a write version but never a row version.
        assert!(insert(&db, "row-2", 2).await);
        assert!(insert(&db, "row-3", 3).await);
        assert!(!insert(&db, "row-4", 3).await);
    }

    #[tokio::test]
    async fn down_drops_the_column_and_its_index() {
        let db = items_db().await;
        let manager = SchemaManager::new(&db);
        let indexes = index_names(&db).await;
        Migration.up(&manager).await.unwrap();
        assert!(insert(&db, "row-2", 2).await);

        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();

        assert!(
            !manager
                .has_column(LLM_DATASET_ITEMS, WRITE_VERSION)
                .await
                .unwrap()
        );
        assert_eq!(index_names(&db).await, indexes);
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                "SELECT row_id FROM llm_dataset_items",
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
    }
}
