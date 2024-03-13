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

use config::utils::json;
use datafusion::arrow::datatypes::Schema;
use infra::db::{self as infra_db, NO_NEED_WATCH};

pub async fn run() -> Result<(), anyhow::Error> {
    // load dashboards list
    let db = infra_db::get_db().await;

    db.add_updated_at_column().await?;
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
                start_dt,
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
    Ok(())
}
