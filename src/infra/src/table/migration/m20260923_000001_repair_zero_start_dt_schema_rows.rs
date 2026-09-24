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

//! Repairs `/schema/` rows stored with `start_dt = 0`, whose keys lose a segment.

use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, QuerySelect, TransactionTrait, sea_query::Expr,
};
use sea_orm_migration::prelude::*;

const SCHEMA_MODULE: &str = "schema";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;
        let zero_rows = meta::Entity::find()
            .filter(meta::Column::Module.eq(SCHEMA_MODULE))
            .filter(meta::Column::StartDt.eq(0))
            .all(&txn)
            .await?;
        for row in zero_rows {
            let siblings: Vec<i64> = meta::Entity::find()
                .select_only()
                .column(meta::Column::StartDt)
                .filter(meta::Column::Module.eq(SCHEMA_MODULE))
                .filter(meta::Column::Key1.eq(&row.key1))
                .filter(meta::Column::Key2.eq(&row.key2))
                .filter(meta::Column::StartDt.ne(0))
                .into_tuple()
                .all(&txn)
                .await?;
            let Some(start_dt) = repaired_start_dt(&row.value, &siblings) else {
                log::warn!(
                    "[SCHEMA:MIGRATION] leaving /schema/{}/{} at start_dt=0: no safe version \
                     timestamp in its value",
                    row.key1,
                    row.key2
                );
                continue;
            };
            meta::Entity::update_many()
                .col_expr(meta::Column::StartDt, Expr::value(start_dt))
                .filter(meta::Column::Id.eq(row.id))
                .exec(&txn)
                .await?;
            log::info!(
                "[SCHEMA:MIGRATION] repaired /schema/{}/{} start_dt=0 to {start_dt}",
                row.key1,
                row.key2
            );
        }
        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        // A repaired row is indistinguishable from one written correctly.
        Ok(())
    }
}

/// Representation of the meta table at the time this migration executes.
mod meta {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "meta")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub module: String,
        pub key1: String,
        pub key2: String,
        pub start_dt: i64,
        pub value: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// The row's own version timestamp, or `None` when using it would reorder versions.
fn repaired_start_dt(value: &str, siblings: &[i64]) -> Option<i64> {
    let versions: serde_json::Value = serde_json::from_str(value).ok()?;
    let metadata = versions.as_array()?.last()?.get("metadata")?;
    let start_dt = ["start_dt", "created_at"]
        .iter()
        .find_map(|key| metadata.get(key)?.as_str()?.parse::<i64>().ok())
        .filter(|start_dt| *start_dt > 0)?;
    siblings
        .iter()
        .all(|sibling| *sibling > start_dt)
        .then_some(start_dt)
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    const T0: i64 = 1_790_056_698_540_533;

    fn value_with(metadata: &str) -> String {
        format!(r#"[{{"fields":[],"metadata":{metadata}}}]"#)
    }

    async fn meta_table() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "CREATE TABLE meta (id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, key1 \
             TEXT NOT NULL, key2 TEXT NOT NULL, start_dt BIGINT NOT NULL, value TEXT NOT NULL)"
                .to_owned(),
        ))
        .await
        .unwrap();
        db
    }

    async fn insert(db: &DatabaseConnection, module: &str, key2: &str, start_dt: i64, value: &str) {
        db.execute(Statement::from_sql_and_values(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO meta (module, key1, key2, start_dt, value) VALUES ($1, 'default', $2, \
             $3, $4)",
            [module.into(), key2.into(), start_dt.into(), value.into()],
        ))
        .await
        .unwrap();
    }

    async fn start_dts(db: &DatabaseConnection, key2: &str) -> Vec<i64> {
        meta::Entity::find()
            .select_only()
            .column(meta::Column::StartDt)
            .filter(meta::Column::Key2.eq(key2))
            .into_tuple()
            .all(db)
            .await
            .unwrap()
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260923_000001_repair_zero_start_dt_schema_rows"
        );
    }

    #[test]
    fn test_repaired_start_dt_prefers_start_dt_then_created_at() {
        let both = value_with(&format!(r#"{{"start_dt":"{T0}","created_at":"12"}}"#));
        assert_eq!(repaired_start_dt(&both, &[]), Some(T0));
        let created_only = value_with(&format!(r#"{{"created_at":"{T0}"}}"#));
        assert_eq!(repaired_start_dt(&created_only, &[]), Some(T0));
    }

    #[test]
    fn test_repaired_start_dt_rejects_unusable_values() {
        for metadata in [r#"{}"#, r#"{"start_dt":"0"}"#, r#"{"start_dt":"soon"}"#] {
            assert_eq!(repaired_start_dt(&value_with(metadata), &[]), None);
        }
        assert_eq!(repaired_start_dt("[]", &[]), None);
        assert_eq!(repaired_start_dt("not json", &[]), None);
    }

    #[test]
    fn test_repaired_start_dt_keeps_the_row_oldest() {
        let value = value_with(&format!(r#"{{"start_dt":"{T0}"}}"#));
        assert_eq!(repaired_start_dt(&value, &[T0 + 1]), Some(T0));
        // a later version stamped with back-dated data would become the latest
        assert_eq!(repaired_start_dt(&value, &[T0 - 1]), None);
        assert_eq!(repaired_start_dt(&value, &[T0]), None);
        assert_eq!(repaired_start_dt(&value, &[T0 + 1, T0 - 1]), None);
    }

    #[tokio::test]
    async fn test_up_repairs_a_zero_row_and_is_idempotent() {
        let db = meta_table().await;
        let value = value_with(&format!(r#"{{"start_dt":"{T0}","created_at":"{T0}"}}"#));
        insert(&db, "schema", "logs/slo_slices", 0, &value).await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        assert_eq!(start_dts(&db, "logs/slo_slices").await, vec![T0]);
        Migration.up(&manager).await.expect("second run");
        assert_eq!(start_dts(&db, "logs/slo_slices").await, vec![T0]);
    }

    #[tokio::test]
    async fn test_up_leaves_other_rows_alone() {
        let db = meta_table().await;
        let value = value_with(&format!(r#"{{"start_dt":"{T0}"}}"#));
        // a healthy schema row, and another module that legitimately keys on 0
        insert(&db, "schema", "traces/default", T0, &value).await;
        insert(&db, "alerts", "logs/other", 0, "{}").await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        assert_eq!(start_dts(&db, "traces/default").await, vec![T0]);
        assert_eq!(start_dts(&db, "logs/other").await, vec![0]);
    }

    #[tokio::test]
    async fn test_up_skips_a_row_whose_repair_would_reorder_versions() {
        let db = meta_table().await;
        let value = value_with(&format!(r#"{{"start_dt":"{T0}"}}"#));
        insert(&db, "schema", "logs/backdated", 0, &value).await;
        insert(&db, "schema", "logs/backdated", T0 - 1, &value).await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let mut got = start_dts(&db, "logs/backdated").await;
        got.sort();
        assert_eq!(got, vec![0, T0 - 1]);
    }

    #[tokio::test]
    async fn test_up_on_a_store_with_nothing_to_repair() {
        let db = meta_table().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        assert!(start_dts(&db, "logs/none").await.is_empty());
    }
}
