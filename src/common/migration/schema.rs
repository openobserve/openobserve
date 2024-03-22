// Copyright 2023 Zinc Labs Inc.
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

use anyhow::Ok;
use chrono::Utc;
use config::utils::json;
use datafusion::arrow::datatypes::Schema;
use infra::db::{self as infra_db, NO_NEED_WATCH};

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

    let locker = infra::dist_lock::lock(SCHEMA_MIGRATION_KEY, 0).await?;

    let cc = infra_db::get_coordinator().await;
    cc.add_start_dt_column().await?;

    let db = infra_db::get_db().await;
    db.add_start_dt_column().await?;

    log::info!("[Schema:Migration]: Inside migrating schemas");
    let db_key = "/schema/".to_string();
    log::info!("[Schema:Migration]: Listing all schemas");
    let data = db.list(&db_key).await?;
    for (key, val) in data {
        println!("[Schema:Migration]: Start migrating schema: {}", key);
        let schemas: Vec<Schema> = json::from_slice(&val).unwrap();

        for schema in schemas {
            let meta = schema.metadata();
            let start_dt: i64 = meta.get("start_dt").unwrap().clone().parse().unwrap();
            db.put(
                &key,
                json::to_vec(&vec![schema]).unwrap().into(),
                NO_NEED_WATCH,
                Some(start_dt),
            )
            .await?;
        }
        println!(
            "[Schema:Migration]: Done creating row per version of schema: {}",
            key
        );
        db.delete(&key, false, infra_db::NEED_WATCH, Some(0))
            .await?;
        println!("[Schema:Migration]: Done migrating schema: {}", key);
    }
    infra::dist_lock::unlock(&locker).await?;

    db.put(
        SCHEMA_MIGRATION_KEY,
        Utc::now().timestamp_micros().to_string().into(),
        NO_NEED_WATCH,
        None,
    )
    .await?;
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
