use crate::common::infra::config::CONFIG;
use crate::common::infra::db::etcd::Etcd;
use crate::common::infra::db::{self, Db};
use crate::common::meta::alert::Trigger;
use crate::common::migration::load_meta::db::sled::SledDb;
use crate::common::utils::json;

const ITEM_PREFIXES: [&str; 10] = [
    "/function",     // works fine
    "/templates",    // works fine
    "/destinations", // works fine
    "/dashboard",    // works fine
    "/kv",           // works fine , no data
    //"/metrics_members", // data issue , removed data
    //"/metrics_leader",  // data issue , removed data
    "/trigger", // works fine
    "/alerts",  // works fine
    "/schema",  // works fine
    "/compact", // works fine
    "/user",    // works fine
];

pub async fn load_meta_from_sled() -> Result<(), anyhow::Error> {
    let (src, dest) = if CONFIG.common.local_mode {
        (Box::<SledDb>::default(), db::default())
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
        (Box::<Etcd>::default(), db::default())
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
                    println!("error while migrating key {} from etcd {}", key, e);
                }
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

pub async fn load() -> Result<(), anyhow::Error> {
    println!("local mode is {}", CONFIG.common.local_mode);
    if CONFIG.common.local_mode {
        load_meta_from_sled().await
    } else {
        load_meta_from_etcd().await
    }
}
