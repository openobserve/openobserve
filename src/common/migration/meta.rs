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

use chrono::Utc;
use infra::db as infra_db;

const ITEM_PREFIXES: [&str; 13] = [
    "/user",
    "/schema",
    "/syslog",
    "/function",
    "/dashboard",    // dashboard
    "/folders",      // dashboard
    "/templates",    // alert
    "/destinations", // alert
    "/alerts",       // alert
    "/trigger",      // alert
    "/compact",
    "/organization",
    "/kv",
];

pub async fn run(from: &str, to: &str) -> Result<(), anyhow::Error> {
    println!("load meta from {}", from);
    let src: Box<dyn infra_db::Db> = match from.to_lowercase().as_str().trim() {
        "sled" => Box::<infra_db::sled::SledDb>::default(),
        "sqlite" => Box::<infra_db::sqlite::SqliteDb>::default(),
        "etcd" => Box::<infra_db::etcd::Etcd>::default(),
        "mysql" => Box::<infra_db::mysql::MysqlDb>::default(),
        "postgres" | "postgresql" => Box::<infra_db::postgres::PostgresDb>::default(),
        _ => panic!("invalid source"),
    };
    let dest: Box<dyn infra_db::Db> = match to.to_lowercase().as_str().trim() {
        "sqlite" => Box::<infra_db::sqlite::SqliteDb>::default(),
        "etcd" => Box::<infra_db::etcd::Etcd>::default(),
        "mysql" => Box::<infra_db::mysql::MysqlDb>::default(),
        "postgres" | "postgresql" => Box::<infra_db::postgres::PostgresDb>::default(),
        _ => panic!("invalid destination"),
    };
    dest.create_table().await?;

    for item in ITEM_PREFIXES {
        let time = std::time::Instant::now();
        let res = src.list(item).await?;
        println!(
            "resources length for prefix {} from source is {}",
            item,
            res.len()
        );
        let mut count = 0;
        for (key, value) in res.iter() {
            match dest
                .put(
                    key,
                    value.clone(),
                    false,
                    chrono::Utc::now().timestamp_micros(),
                )
                .await
            {
                Ok(_) => {
                    count += 1;
                }
                Err(e) => {
                    println!("error while migrating key {} from source {}", key, e);
                }
            }
            if count % 100 == 0 {
                println!(
                    "migrated {} keys for prefix {} at {:?} ",
                    count,
                    item,
                    Utc::now()
                );
            }
        }
        println!(
            "migrated prefix {} from source, took {} secs",
            item,
            time.elapsed().as_secs()
        );
    }

    Ok(())
}
