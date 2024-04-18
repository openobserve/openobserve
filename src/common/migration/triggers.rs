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
use infra::{db as infra_db, dist_lock, scheduler};

const TRIGGER_MIGRATION_KEY: &str = "/migration/triggers/status";

pub async fn run() -> Result<(), anyhow::Error> {
    match upgrade_required().await {
        std::result::Result::Ok(true) => {
            log::info!("[Trigger:Migration]: Starting trigger migration");
        }
        std::result::Result::Ok(false) => {
            log::info!("[Trigger:Migration]: Trigger migration already done");
            return Ok(());
        }
        Err(err) => {
            log::error!(
                "[Trigger:Migration]: Error checking trigger migration status: {}",
                err
            );
            return Err(err);
        }
    };

    // get lock
    let locker = dist_lock::lock(TRIGGER_MIGRATION_KEY, 0).await?;

    // after get lock, need check again
    match upgrade_required().await {
        std::result::Result::Ok(true) => {
            log::info!("[Trigger:Migration]: Starting trigger migration");
        }
        std::result::Result::Ok(false) => {
            log::info!("[Trigger:Migration]: Trigger migration already done");
            dist_lock::unlock(&locker).await?;
            return Ok(());
        }
        Err(err) => {
            log::error!(
                "[Trigger:Migration]: Error checking trigger migration status: {}",
                err
            );
            dist_lock::unlock(&locker).await?;
            return Err(err);
        }
    };

    let db = infra_db::get_db().await;

    log::info!("[Trigger:Migration]: Inside migrating triggers");
    let db_key_prefix = "/trigger/".to_string();
    log::info!("[Trigger:Migration]: Listing all triggers");
    let data = match db.list(&db_key_prefix).await {
        Ok(v) => v,
        Err(e) => {
            dist_lock::unlock(&locker).await?;
            return Err(e.into());
        }
    };
    for (key, val) in data {
        let db_key = key;
        let key = db_key.strip_prefix(&db_key_prefix).unwrap();
        println!("[Trigger:Migration]: Start migrating trigger: {}", key);
        let columns = match key.split_once('/') {
            Some(columns) => columns,
            None => {
                // Corrupted data, delete the trigger
                _ = db.delete(&db_key, false, infra_db::NEED_WATCH, None).await;
                continue;
            }
        };
        let data: json::Value = json::from_slice(&val).unwrap();
        let data = data.as_object().unwrap();
        if let Err(e) = scheduler::push(scheduler::Trigger {
            org: columns.0.to_string(),
            module: scheduler::TriggerModule::Alert,
            module_key: columns.1.to_string(),
            next_run_at: data.get("next_run_at").unwrap().as_i64().unwrap(),
            is_realtime: data.get("is_realtime").unwrap().as_bool().unwrap(),
            is_silenced: data.get("is_silenced").unwrap().as_bool().unwrap(),
            status: scheduler::TriggerStatus::Waiting,
            ..Default::default()
        })
        .await
        {
            dist_lock::unlock(&locker).await?;
            return Err(e.into());
        }
        println!("[Schema:Migration]: Done migrating trigger: {}", key);
    }

    // unlock the lock
    dist_lock::unlock(&locker).await?;

    db.put(
        TRIGGER_MIGRATION_KEY,
        Utc::now().timestamp_micros().to_string().into(),
        infra_db::NO_NEED_WATCH,
        None,
    )
    .await?;
    Ok(())
}

async fn upgrade_required() -> Result<bool, anyhow::Error> {
    let db = infra_db::get_db().await;
    match db.get(TRIGGER_MIGRATION_KEY).await {
        std::result::Result::Ok(val) => {
            let val_str = std::str::from_utf8(&val).unwrap();
            let val = val_str.parse::<i64>().unwrap_or(0);
            if val > 0 { Ok(false) } else { Ok(true) }
        }
        Err(_) => Ok(true),
    }
}
