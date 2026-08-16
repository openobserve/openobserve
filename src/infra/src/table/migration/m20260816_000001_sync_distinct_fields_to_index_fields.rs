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

//! The `_values` API is served by the tantivy secondary index (TopN/Distinct
//! collectors) instead of the `distinct_values_*` metadata streams, so every
//! configured distinct value field must also be a secondary index field. New
//! settings writes enforce this invariant on save; this migration backfills it
//! for existing streams so their distinct fields start being indexed without
//! waiting for the next settings update.

use config::{
    ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME, get_config,
    meta::stream::StreamType,
    utils::{json, time::now_micros},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use sea_orm_migration::prelude::*;

use crate::{db, schema};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, _: &SchemaManager) -> Result<(), DbErr> {
        let db = db::get_db().await;
        let res = db.list_keys("/schema/").await.map_err(|e| {
            log::error!("failed to fetch schema list from db : {e}");
            DbErr::Custom(format!("error listing schemas : {e}"))
        })?;
        for s in res {
            let parts = s
                .strip_prefix("/")
                .unwrap_or(&s)
                .split('/')
                .collect::<Vec<_>>();
            if parts.len() != 4 {
                log::warn!("invalid schema key {s}, skipping");
                continue;
            }
            let org_id = parts[1];
            let stream_type = parts[2];
            let stream_name = parts[3];

            let stype = StreamType::from(stream_type);

            // distinct value fields are only supported on logs and traces
            if !matches!(stype, StreamType::Logs | StreamType::Traces) {
                continue;
            }

            let stream_schema = match schema::get(org_id, stream_name, stype).await {
                Ok(schema) => schema,
                Err(e) => {
                    log::warn!("error getting schema for {org_id}/{stype}/{stream_name} : {e}");
                    continue;
                }
            };
            let Some(mut settings) = schema::unwrap_stream_settings(&stream_schema) else {
                continue;
            };
            if !settings.enable_distinct_fields || settings.distinct_value_fields.is_empty() {
                continue;
            }

            // fields that cannot be secondary-indexed (full text search keys, partition
            // keys, reserved columns) are skipped; the values API falls back to a normal
            // scan for them
            let cfg = get_config();
            let reserved = [
                TIMESTAMP_COL_NAME,
                cfg.common.column_all.as_str(),
                ALL_VALUES_COL_NAME,
                ORIGINAL_DATA_COL_NAME,
            ];
            let missing_index = settings
                .distinct_value_fields
                .iter()
                .map(|field| field.name.clone())
                .filter(|field| {
                    !settings.index_fields.contains(field)
                        && !settings.full_text_search_keys.contains(field)
                        && !settings
                            .partition_keys
                            .iter()
                            .any(|partition| partition.field == *field)
                        && !reserved.contains(&field.as_str())
                })
                .collect::<Vec<_>>();
            if missing_index.is_empty() {
                continue;
            }

            let now = now_micros();
            for field in &missing_index {
                settings.index_fields_updated_at.insert(field.clone(), now);
            }
            settings.index_fields.extend(missing_index);

            let mut metadata = stream_schema.metadata.clone();
            metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());
            if !metadata.contains_key("created_at") {
                metadata.insert("created_at".to_string(), now_micros().to_string());
            }

            if let Err(e) = schema::update_setting(org_id, stream_name, stype, metadata.clone())
                .await
            {
                log::error!("error in updating settings for {org_id}/{stype}/{stream_name} : {e}");
                return Err(DbErr::Custom(format!(
                    "error updating settings for {org_id}/{stype}/{stream_name} : {e}"
                )));
            }

            #[cfg(feature = "enterprise")]
            if get_o2_config().super_cluster.enabled {
                let key = schema::mk_key(org_id, stype, stream_name);
                if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::schema_setting(
                    &key,
                    json::to_vec(&metadata).unwrap().into(),
                    db::NEED_WATCH,
                    None,
                )
                .await
                {
                    log::error!(
                        "error syncing distinct fields to index fields across super cluster {org_id}/{stype}/{stream_name} : {e}"
                    )
                }
            }
        }
        Ok(())
    }

    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        // does not support down
        Ok(())
    }
}
