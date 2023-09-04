use crate::common::infra::config::CONFIG;
use crate::common::infra::db::etcd::Etcd;
use crate::common::infra::db::{self, Db};
use crate::common::migration::load_meta::db::sled::SledDb;

/* const ITEM_PREFIXS: [&str; 12] = [
    "/function",
    "/templates",
    "/destinations",
    "/dashboard",
    "/kv",
    "/metrics_members",
    "/metrics_leader",
    "/trigger",
    "/alerts",
    "/schema",
    "/compact",
    "/user",
]; */
const ITEM_PREFIXS: [&str; 1] = ["/"];

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
        println!("resouces length from etcd is {}", res.len());
        for (key, value) in res.iter() {
            dest.put(key, value.clone(), false).await?;
        }
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
