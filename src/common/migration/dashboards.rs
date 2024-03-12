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

use infra::db as infra_db;

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
        match db
            .put(
                &new_key,
                val,
                infra_db::NO_NEED_WATCH,
                chrono::Utc::now().timestamp_micros(),
            )
            .await
        {
            Ok(_) => {
                let _ = db.delete(&key, false, infra_db::NO_NEED_WATCH).await;
                println!("Migrated dashboard: {} successfully", key);
            }
            Err(_) => {
                println!("Failed to migrate dashboard: {}", new_key);
            }
        }
    }

    Ok(())
}
