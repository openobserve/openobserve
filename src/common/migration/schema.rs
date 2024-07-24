// Copyright 2024 Zinc Labs Inc.
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

use chrono::Utc;
use config::utils::json;
use datafusion::arrow::datatypes::Schema;
use infra::{
    db::{self as infra_db, NO_NEED_WATCH},
    dist_lock, scheduler,
};

const SCHEMA_MIGRATION_KEY: &str = "/migration/schema_versions/status";

pub async fn run() -> Result<(), anyhow::Error> {
    match upgrade_schema_row_per_version().await {
        std::result::Result::Ok(true) => {
            log::info!("[Schema:Migration]: Starting schema migration");
        }
        std::result::Result::Ok(false) => {
            log::info!("[Schema:Migration]: Schema migration already done");
            return Ok(());
        }
        Err(err) => {
            log::error!(
                "[Schema:Migration]: Error checking schema migration status: {}",
                err
            );
            return Err(err);
        }
    };

    // get lock
    let locker = infra::dist_lock::lock(SCHEMA_MIGRATION_KEY, 0, None).await?;

    // after get lock, need check again
    match upgrade_schema_row_per_version().await {
        std::result::Result::Ok(true) => {
            log::info!("[Schema:Migration]: Starting schema migration");
        }
        std::result::Result::Ok(false) => {
            log::info!("[Schema:Migration]: Schema migration already done");
            dist_lock::unlock(&locker).await?;
            return Ok(());
        }
        Err(err) => {
            log::error!(
                "[Schema:Migration]: Error checking schema migration status: {}",
                err
            );
            dist_lock::unlock(&locker).await?;
            return Err(err);
        }
    };

    // upgrade meta
    if let Err(e) = upgrade_meta().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }

    // upgrade triggers
    if let Err(e) = upgrade_trigger().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }

    // set migration status
    let db = infra_db::get_db().await;
    if let Err(e) = db
        .put(
            SCHEMA_MIGRATION_KEY,
            Utc::now().timestamp_micros().to_string().into(),
            NO_NEED_WATCH,
            None,
        )
        .await
    {
        // unlock the lock
        dist_lock::unlock(&locker).await?;
        return Err(e.into());
    }

    // unlock the lock
    dist_lock::unlock(&locker).await?;

    Ok(())
}

async fn upgrade_meta() -> Result<(), anyhow::Error> {
    let default_end_dt = "0".to_string();
    let cc = infra_db::get_coordinator().await;
    if let Err(e) = cc.add_start_dt_column().await {
        return Err(e.into());
    }

    let db = infra_db::get_db().await;
    if let Err(e) = db.add_start_dt_column().await {
        return Err(e.into());
    }

    log::info!("[Schema:Migration]: Migrating schemas");
    let db_key = "/schema/".to_string();
    log::info!("[Schema:Migration]: Listing all schemas");
    let data = db.list(&db_key).await?;
    for (key, val) in data {
        log::info!("[Schema:Migration]: Start migrating schema: {}", key);
        let schemas: Vec<Schema> = json::from_slice(&val).unwrap();
        let versions_count = schemas.len();
        let mut prev_end_dt: i64 = 0;

        for schema in schemas {
            if schema.fields().is_empty() && versions_count > 1 {
                continue; // Skip empty schema when there are multiple versions
            }
            let meta = schema.metadata();
            let start_dt: i64 = match meta.get("start_dt") {
                Some(val) => val.clone().parse().unwrap(),
                None => {
                    if prev_end_dt == 0 {
                        meta.get("created_at").unwrap().clone().parse().unwrap()
                    } else {
                        prev_end_dt
                    }
                }
            };
            prev_end_dt = meta
                .get("end_dt")
                .unwrap_or(&default_end_dt)
                .clone()
                .parse()
                .unwrap();
            if let Err(e) = db
                .put(
                    &key,
                    json::to_vec(&vec![schema]).unwrap().into(),
                    NO_NEED_WATCH,
                    Some(start_dt),
                )
                .await
            {
                return Err(e.into());
            }
        }
        log::info!(
            "[Schema:Migration]: Done creating row per version of schema: {}",
            key
        );
        if let Err(e) = db.delete(&key, false, infra_db::NEED_WATCH, Some(0)).await {
            return Err(e.into());
        }
        log::info!("[Schema:Migration]: Done migrating schema: {}", key);
    }

    Ok(())
}

async fn upgrade_trigger() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    log::info!("[Trigger:Migration]: Migrating triggers");
    let db_key_prefix = "/trigger/".to_string();
    log::info!("[Trigger:Migration]: Listing all triggers");
    let data = db.list(&db_key_prefix).await?;
    for (key, val) in data {
        let db_key = key;
        let key = db_key.strip_prefix(&db_key_prefix).unwrap();
        log::info!("[Trigger:Migration]: Start migrating trigger: {}", key);
        let (org_id, module_key) = match key.split_once('/') {
            Some(columns) => columns,
            None => {
                // Corrupted data, delete the trigger
                _ = db.delete(&db_key, false, infra_db::NEED_WATCH, None).await;
                continue;
            }
        };
        let data: json::Value = json::from_slice(&val).unwrap();
        let data = data.as_object().unwrap();
        scheduler::push(scheduler::Trigger {
            org: org_id.to_string(),
            module: scheduler::TriggerModule::Alert,
            module_key: module_key.to_string(),
            next_run_at: data.get("next_run_at").unwrap().as_i64().unwrap(),
            is_realtime: data.get("is_realtime").unwrap().as_bool().unwrap(),
            is_silenced: data.get("is_silenced").unwrap().as_bool().unwrap(),
            status: scheduler::TriggerStatus::Waiting,
            ..Default::default()
        })
        .await?;
        log::info!("[Schema:Migration]: Done migrating trigger: {}", key);
    }

    Ok(())
}

async fn upgrade_schema_row_per_version() -> Result<bool, anyhow::Error> {
    let db = infra_db::get_db().await;
    match db.get(SCHEMA_MIGRATION_KEY).await {
        std::result::Result::Ok(val) => {
            let val_str = std::str::from_utf8(&val).unwrap();
            let val = val_str.parse::<i64>().unwrap_or(0);
            if val > 0 { Ok(false) } else { Ok(true) }
        }
        Err(_) => Ok(true),
    }
}
