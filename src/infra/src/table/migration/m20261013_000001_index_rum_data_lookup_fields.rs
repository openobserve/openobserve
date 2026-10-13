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

use config::{
    meta::stream::{RUM_DATA_INDEX_FIELDS, RUM_DATA_STREAM, StreamType},
    utils::{json, time::now_micros},
};
use datafusion::arrow::datatypes::Schema;
use hashbrown::HashSet;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use sea_orm_migration::prelude::*;

use crate::schema::unwrap_stream_settings;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;
        let rows = meta::Entity::find()
            .filter(meta::Column::Module.eq("schema"))
            .filter(meta::Column::Key2.eq(format!("{}/{RUM_DATA_STREAM}", StreamType::Logs)))
            .order_by_asc(meta::Column::Key1)
            .order_by_desc(meta::Column::StartDt)
            .order_by_desc(meta::Column::Id)
            .all(&txn)
            .await?;
        let now = now_micros();
        let mut orgs = HashSet::new();
        for row in rows {
            // Settings are read from the latest schema version, which sorts first per org.
            if !orgs.insert(row.key1.clone()) {
                continue;
            }
            let value = match add_index_fields(&row.value, now) {
                Ok(Some(value)) => value,
                Ok(None) => continue,
                Err(e) => {
                    log::warn!(
                        "[MIGRATION] skip indexing {}/{RUM_DATA_STREAM}: {e}",
                        row.key1
                    );
                    continue;
                }
            };
            let mut row: meta::ActiveModel = row.into();
            row.value = Set(value);
            row.update(&txn).await?;
        }
        txn.commit().await
    }

    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

/// Adds the missing lookup fields to the latest schema's settings, or `None` when none can be
/// added.
fn add_index_fields(value: &str, now: i64) -> Result<Option<String>, json::Error> {
    let mut schemas: Vec<Schema> = json::from_str(value)?;
    let Some(latest) = schemas.pop() else {
        return Ok(None);
    };
    let mut settings = unwrap_stream_settings(&latest).unwrap_or_default();
    // The store rejects a secondary index that is also an FTS key or a partition key.
    let missing: Vec<&str> = RUM_DATA_INDEX_FIELDS
        .into_iter()
        .filter(|&field| {
            !settings.index_fields.iter().any(|f| f == field)
                && !settings.full_text_search_keys.iter().any(|f| f == field)
                && !settings.partition_keys.iter().any(|p| p.field == field)
        })
        .collect();
    if missing.is_empty() {
        return Ok(None);
    }
    for field in missing {
        settings.index_fields.push(field.to_string());
        // Its own cutoff keeps files written before the migration off the index path.
        settings
            .index_fields_updated_at
            .insert(field.to_string(), now);
    }
    let mut metadata = latest.metadata().clone();
    metadata.insert("settings".to_string(), json::to_string(&settings)?);
    schemas.push(latest.with_metadata(metadata));
    Ok(Some(json::to_string(&schemas)?))
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
        #[sea_orm(column_type = "Text")]
        pub value: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{StreamPartition, StreamSettings};
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    fn schema_value(settings: Option<&StreamSettings>) -> String {
        let mut metadata = std::collections::HashMap::new();
        metadata.insert("created_at".to_string(), "1".to_string());
        if let Some(settings) = settings {
            metadata.insert("settings".to_string(), json::to_string(settings).unwrap());
        }
        json::to_string(&vec![Schema::empty().with_metadata(metadata)]).unwrap()
    }

    fn stored_settings(value: &str) -> StreamSettings {
        let schemas: Vec<Schema> = json::from_str(value).unwrap();
        unwrap_stream_settings(schemas.last().unwrap()).unwrap()
    }

    #[test]
    fn test_add_index_fields_keeps_user_settings() {
        let mut settings = StreamSettings {
            data_retention: 365,
            index_fields: vec!["user".to_string(), "view_id".to_string()],
            full_text_search_keys: vec!["_oo_trace_id".to_string()],
            partition_keys: vec![StreamPartition::new("action_id")],
            ..Default::default()
        };
        settings
            .index_fields_updated_at
            .insert("view_id".to_string(), 1);

        let value = add_index_fields(&schema_value(Some(&settings)), 100)
            .unwrap()
            .unwrap();
        let settings = stored_settings(&value);
        assert_eq!(settings.data_retention, 365);
        assert_eq!(settings.index_fields, ["user", "view_id", "_o2_trace_id"]);
        assert_eq!(settings.index_fields_updated_at.get("view_id"), Some(&1));
        assert_eq!(
            settings.index_fields_updated_at.get("_o2_trace_id"),
            Some(&100)
        );
        assert!(add_index_fields(&value, 200).unwrap().is_none());
    }

    #[test]
    fn test_add_index_fields_without_settings() {
        let value = add_index_fields(&schema_value(None), 100).unwrap().unwrap();
        assert_eq!(stored_settings(&value).index_fields, RUM_DATA_INDEX_FIELDS);
    }

    #[tokio::test]
    async fn test_up_updates_latest_rum_data_schema_per_org() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE meta (id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, \
             key1 TEXT NOT NULL, key2 TEXT NOT NULL, start_dt BIGINT NOT NULL, \
             value TEXT NOT NULL)",
        )
        .await
        .unwrap();
        let empty = schema_value(Some(&StreamSettings::default()));
        for (key1, key2, start_dt, value) in [
            ("org1", "logs/_rumdata", 1, empty.as_str()),
            ("org1", "logs/_rumdata", 2, empty.as_str()),
            ("org1", "logs/other", 1, empty.as_str()),
            ("org2", "logs/_rumdata", 1, "not json"),
        ] {
            meta::ActiveModel {
                module: Set("schema".to_string()),
                key1: Set(key1.to_string()),
                key2: Set(key2.to_string()),
                start_dt: Set(start_dt),
                value: Set(value.to_string()),
                ..Default::default()
            }
            .insert(&db)
            .await
            .unwrap();
        }

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let rows = meta::Entity::find()
            .order_by_asc(meta::Column::Id)
            .all(&db)
            .await
            .unwrap();
        let values: Vec<&str> = rows.iter().map(|row| row.value.as_str()).collect();
        assert_eq!(values[0], empty);
        assert_eq!(
            stored_settings(values[1]).index_fields,
            RUM_DATA_INDEX_FIELDS
        );
        assert_eq!(values[2], empty);
        assert_eq!(values[3], "not json");
    }
}
