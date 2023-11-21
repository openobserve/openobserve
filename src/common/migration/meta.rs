use chrono::Utc;

use crate::common::{
    infra::{
        config::CONFIG,
        db::{self, Db},
    },
    meta::alert::Trigger,
    utils::{file::get_file_meta, json},
};

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

pub async fn run() -> Result<(), anyhow::Error> {
    if CONFIG.common.local_mode {
        load_meta_from_sled().await
    } else {
        load_meta_from_etcd().await
    }
}

pub async fn load_meta_from_sled() -> Result<(), anyhow::Error> {
    if get_file_meta(&format!("{}db", CONFIG.sled.data_dir)).is_err() {
        // there is no local db, no need upgrade
        return Ok(());
    }
    let (src, dest) = if CONFIG.common.local_mode {
        (Box::<db::sled::SledDb>::default(), db::get_db().await)
    } else {
        panic!("enable local mode to migrate from sled");
    };
    for item in ITEM_PREFIXES {
        let time = std::time::Instant::now();
        let res = src.list(item).await?;
        println!(
            "resources length for prefix {} from sled is {}",
            item,
            res.len()
        );

        for (key, value) in res.iter() {
            let final_key;
            let key = if key.starts_with("/trigger") {
                let local_val: Trigger = json::from_slice(value).unwrap();
                final_key = format!("/trigger/{}/{}", local_val.org, local_val.alert_name);
                &final_key
            } else {
                key
            };
            match dest.put(key, value.clone(), false).await {
                Ok(_) => {}
                Err(e) => {
                    println!(
                        "error while migrating key {} from sled to sqlite {}",
                        key, e
                    );
                }
            }
        }
        println!(
            "migrated  prefix {} from sled , took {} secs",
            item,
            time.elapsed().as_secs()
        );
    }

    Ok(())
}

pub async fn load_meta_from_etcd() -> Result<(), anyhow::Error> {
    println!("load meta from etcd");
    let (src, dest) = if !CONFIG.common.local_mode {
        (Box::<db::etcd::Etcd>::default(), db::get_db().await)
    } else {
        panic!("disable local mode to migrate from etcd");
    };

    for item in ITEM_PREFIXES {
        let time = std::time::Instant::now();
        let res = src.list(item).await?;
        println!(
            "resources length for prefix {} from etcd is {}",
            item,
            res.len()
        );
        let mut count = 0;
        for (key, value) in res.iter() {
            let final_key;
            let key = if key.starts_with("/trigger") {
                let local_val: Trigger = json::from_slice(value).unwrap();
                final_key = format!("/trigger/{}/{}", local_val.org, local_val.alert_name);
                &final_key
            } else {
                key
            };
            match dest.put(key, value.clone(), false).await {
                Ok(_) => {
                    count += 1;
                }
                Err(e) => {
                    println!("error while migrating key {} from etcd {}", key, e);
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
            "migrated  prefix {} from etcd , took {} secs",
            item,
            time.elapsed().as_secs()
        );
    }

    Ok(())
}
