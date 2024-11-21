// Copyright 2024 OpenObserve Inc.
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

use anyhow::bail;
use config::meta::stream::{DistinctField, StreamSettings, StreamType};
use hashbrown::HashMap;
use infra::{
    db as infra_db,
    schema::get_settings,
    table::distinct_values::{self, DistinctFieldRecord, OriginType},
};

use crate::service::{db::dashboards::get_query_variables, stream::save_stream_settings};

type SettingsCache = HashMap<(String, String, StreamType), StreamSettings>;

/// This takes query variables from the dashboard and inserts them
/// in the distinct_values table as well as the stream settings
async fn add_distinct_from_dashboard(
    key: &str,
    value: bytes::Bytes,
    settings_cache: &mut SettingsCache,
) -> Result<(), anyhow::Error> {
    let local_key = key.strip_prefix('/').unwrap_or(key);

    // key format is dashboard/org_id/folder/id
    let parts = local_key.split('/').collect::<Vec<_>>();
    if parts.len() < 4 {
        bail!("invalid key {local_key}, skipping");
    }
    let org_id = parts.get(1).unwrap();
    let dashboard_id = parts.get(3).unwrap();

    let variables = get_query_variables(Some(value));

    for ((stream, stype), fields) in variables {
        let cache_key = (org_id.to_string(), stream.clone(), stype);

        let stream_settings = match settings_cache.get_mut(&cache_key) {
            Some(s) => s,
            None => {
                let settings = get_settings(org_id, &stream, stype)
                    .await
                    .unwrap_or_default();
                settings_cache.insert(cache_key.clone(), settings);
                settings_cache.get_mut(&cache_key).unwrap()
            }
        };

        for f in fields {
            let record = DistinctFieldRecord::new(
                OriginType::Dashboard,
                dashboard_id,
                org_id,
                &stream,
                stype.to_string(),
                &f,
            );

            let temp = DistinctField {
                name: f,
                added_ts: chrono::Utc::now().timestamp_micros(),
            };

            if !stream_settings.distinct_value_fields.contains(&temp) {
                stream_settings.distinct_value_fields.push(temp);
            }

            distinct_values::add(record).await?;
        }
    }
    Ok(())
}

pub async fn run() -> Result<(), anyhow::Error> {
    // load dashboards list
    let db = infra_db::get_db().await;
    let db_key = "/dashboard/".to_string();
    let data = db.list(&db_key).await?;
    for (key, val) in data {
        let local_key = key.strip_prefix('/').unwrap_or(&key);
        let len = local_key.split('/').collect::<Vec<&str>>().len();
        if len > 3 {
            // println!(
            // "Skip dashboard migration as it is already part of folder: {}",
            // key
            // );
            continue;
        }
        let new_key = key.replace("/dashboard/", "/dashboard/default/");
        match db.put(&new_key, val, infra_db::NO_NEED_WATCH, None).await {
            Ok(_) => {
                let _ = db.delete(&key, false, infra_db::NO_NEED_WATCH, None).await;
                println!("Migrated dashboard: {} successfully", key);
            }
            Err(_) => {
                println!("Failed to migrate dashboard: {}", new_key);
            }
        }
    }

    if distinct_values::len().await? > 0 {
        log::info!("dashboard distinct values migration already done.");
    } else {
        let data = db.list(&db_key).await?;

        let mut settings_cache: SettingsCache = HashMap::new();

        for (key, value) in data {
            match add_distinct_from_dashboard(&key, value, &mut settings_cache).await {
                Ok(_) => log::info!("dashboard {key} migrated for distinct values"),
                Err(e) => log::error!(
                    "failed to process variables from dashboard {key} for distinct values : {e}"
                ),
            }
        }

        for ((org_id, stream, stype), settings) in settings_cache {
            match save_stream_settings(&org_id, &stream, stype, settings).await {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "failed to save updated stream settings when migrating for distinct values {org_id}/{stream} {stype} :{e} "
                    );
                }
            }
        }

        log::info!("dashboard distinct value migration completed");
    }

    Ok(())
}
