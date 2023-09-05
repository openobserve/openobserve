use crate::common::infra::config::CONFIG;
use crate::common::infra::db::etcd::Etcd;
use crate::common::infra::db::{self, Db};
use crate::common::meta::alert::Trigger;
use crate::common::migration::load_meta::db::sled::SledDb;
use crate::common::utils::json;

const ITEM_PREFIXS: [&str; 12] = [
    "/function",        // works fine
    "/templates",       // works fine
    "/destinations",    // works fine
    "/dashboard",       // works fine
    "/kv",              // works fine , no data
    "/metrics_members", // data issue , removed data
    "/metrics_leader",  // data issue , removed data
    "/trigger",         // works fine
    "/alerts",          // works fine
    "/schema",          // works fine
    "/compact",         // works fine
    "/user",            // works fine
];

pub async fn load_meta_from_sled() -> Result<(), anyhow::Error> {
    let src;
    let dest;
    if CONFIG.common.local_mode {
        src = Box::<SledDb>::default();
        dest = db::default();
    } else {
        panic!("enable local mode to migrate from sled");
    }
    for item in ITEM_PREFIXS {
        let res = src.list(item).await?;
        for (key, value) in res.iter() {
            dest.put(key, value.clone(), false).await?;
        }
    }

    Ok(())
}

pub async fn load_meta_from_etcd() -> Result<(), anyhow::Error> {
    println!("load meta from etcd");
    let src;
    let dest;
    if !CONFIG.common.local_mode {
        src = Box::<Etcd>::default();
        dest = db::default();
    } else {
        panic!("disable local mode to migrate from etcd");
    }

    for item in ITEM_PREFIXS {
        let res = src.list(item).await?;
        println!(
            "resouces length for prefix {} from etcd is {}",
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
            dest.put(key, value.clone(), false).await?;
        }
        println!("migrated  prefix {} from etcd ", item);
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
