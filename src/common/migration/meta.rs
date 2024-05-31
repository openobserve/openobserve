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
use infra::{db as infra_db, scheduler as infra_scheduler};

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
    migrate_meta(from, to).await?;
    migrate_scheduler(from, to).await?;
    Ok(())
}

async fn migrate_meta(from: &str, to: &str) -> Result<(), anyhow::Error> {
    println!("load meta from {}", from);
    let src: Box<dyn infra_db::Db> = match from.to_lowercase().as_str().trim() {
        "sqlite" => Box::<infra_db::sqlite::SqliteDb>::default(),
        "etcd" => Box::<infra_db::etcd::Etcd>::default(),
        "mysql" => Box::<infra_db::mysql::MysqlDb>::default(),
        "postgres" | "postgresql" => Box::<infra_db::postgres::PostgresDb>::default(),
        _ => panic!("invalid meta source"),
    };
    let dest: Box<dyn infra_db::Db> = match to.to_lowercase().as_str().trim() {
        "sqlite" => Box::<infra_db::sqlite::SqliteDb>::default(),
        "etcd" => Box::<infra_db::etcd::Etcd>::default(),
        "mysql" => Box::<infra_db::mysql::MysqlDb>::default(),
        "postgres" | "postgresql" => Box::<infra_db::postgres::PostgresDb>::default(),
        _ => panic!("invalid meta destination"),
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
            match dest.put(key, value.clone(), false, None).await {
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
            "migrated prefix {} from source, took {} ms",
            item,
            time.elapsed().as_millis()
        );
    }

    Ok(())
}

async fn migrate_scheduler(from: &str, to: &str) -> Result<(), anyhow::Error> {
    let time = std::time::Instant::now();
    println!("load scheduler from {}", from);
    let src: Box<dyn infra_scheduler::Scheduler> = match from.to_lowercase().as_str().trim() {
        "sqlite" => Box::<infra_scheduler::sqlite::SqliteScheduler>::default(),
        "mysql" => Box::<infra_scheduler::mysql::MySqlScheduler>::default(),
        "postgres" | "postgresql" => Box::<infra_scheduler::postgres::PostgresScheduler>::default(),
        _ => return Ok(()),
    };
    let dest: Box<dyn infra_scheduler::Scheduler> = match to.to_lowercase().as_str().trim() {
        "sqlite" => Box::<infra_scheduler::sqlite::SqliteScheduler>::default(),
        "mysql" => Box::<infra_scheduler::mysql::MySqlScheduler>::default(),
        "postgres" | "postgresql" => Box::<infra_scheduler::postgres::PostgresScheduler>::default(),
        _ => panic!("invalid scheduler destination"),
    };
    src.create_table().await?;
    dest.create_table().await?;
    dest.create_table_index().await?;

    let items = src.list(None).await?;
    for item in items.iter() {
        dest.push(item.to_owned()).await?;
    }
    println!(
        "migrated scheduler from source, took {} ms",
        time.elapsed().as_millis()
    );

    Ok(())
}
