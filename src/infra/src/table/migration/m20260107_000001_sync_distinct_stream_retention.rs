// Copyright 2025 OpenObserve Inc.
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
    meta::stream::StreamType,
    utils::{json, time::now_micros, util::get_distinct_stream_name},
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

            // we only support distinct values on logs and traces
            if !matches!(stype, StreamType::Logs | StreamType::Traces) {
                continue;
            }
            if let Some(original_settings) = schema::get_settings(org_id, stream_name, stype).await
            {
                let distinct_stream = get_distinct_stream_name(stype, stream_name);
                match schema::get(org_id, &distinct_stream, StreamType::Metadata).await {
                    Ok(distinct_schema) => {
                        let mut distinct_settings =
                            schema::unwrap_stream_settings(&distinct_schema).unwrap_or_default();
                        distinct_settings.data_retention = original_settings.data_retention;

                        let mut metadata = distinct_schema.metadata.clone();
                        metadata.insert(
                            "settings".to_string(),
                            json::to_string(&distinct_settings).unwrap(),
                        );
                        if !metadata.contains_key("created_at") {
                            metadata.insert("created_at".to_string(), now_micros().to_string());
                        }

                        if let Err(e) = schema::update_setting(
                            org_id,
                            &distinct_stream,
                            StreamType::Metadata,
                            metadata.clone(),
                        )
                        .await
                        {
                            log::error!(
                                "error in updating settings for {org_id}/{distinct_stream} : {e}"
                            );
                            return Err(DbErr::Custom(format!(
                                "error updating settings for {org_id}/{distinct_stream} : {e}"
                            )));
                        }

                        #[cfg(feature = "enterprise")]
                        if get_o2_config().super_cluster.enabled {
                            let key =
                                schema::mk_key(org_id, StreamType::Metadata, &distinct_stream);
                            if let Err(e) =
                                o2_enterprise::enterprise::super_cluster::queue::schema_setting(
                                    &key,
                                    json::to_vec(&metadata).unwrap().into(),
                                    db::NEED_WATCH,
                                    None,
                                )
                                .await
                            {
                                log::error!(
                                    "error syncing distinct stream retention across super cluster {org_id}/{distinct_stream} : {e}"
                                )
                            }
                        }
                    }
                    Err(e) => {
                        // We have already updated the main stream settings, and this is just for
                        // retention, so no point in failing the api call if this fails.
                        log::warn!(
                            "error getting schema for distinct stream {org_id}/{distinct_stream} : {e}"
                        );
                    }
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
