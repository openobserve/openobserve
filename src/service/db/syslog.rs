use std::sync::Arc;

use crate::{
    common::json,
    infra::{
        config::SYSLOG_ROUTES,
        db::{self, Event},
    },
    meta::syslog::SyslogRoute,
};
use tracing::instrument;

#[instrument(err)]
pub async fn list() -> Result<Vec<SyslogRoute>, anyhow::Error> {
    Ok(db::DEFAULT
        .list("/syslog/route/")
        .await?
        .values()
        .map(|val| json::from_slice(val).unwrap())
        .collect())
}

#[instrument(err, skip(route))]
pub async fn set(route: &SyslogRoute) -> Result<(), anyhow::Error> {
    Ok(db::DEFAULT
        .put(
            &format!("/syslog/route/{}", route.id),
            json::to_vec(route).unwrap().into(),
        )
        .await?)
}

#[instrument(err)]
pub async fn get(id: &str) -> Result<SyslogRoute, anyhow::Error> {
    let val = db::DEFAULT.get(&format!("/syslog/route/{id}")).await?;
    Ok(json::from_slice(&val).unwrap())
}

#[instrument(err)]
pub async fn delete(id: &str) -> Result<(), anyhow::Error> {
    Ok(db::DEFAULT
        .delete(&format!("/syslog/route/{id}"), false)
        .await?)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/syslog/route/";
    let mut events = db::DEFAULT.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching syslog routes");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_syslog: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let item_value: SyslogRoute = json::from_slice(&ev.value.unwrap()).unwrap();
                SYSLOG_ROUTES.insert(item_value.id.to_owned(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                SYSLOG_ROUTES.remove(item_key);
            }
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/syslog/route/";
    let ret = db::DEFAULT.list(key).await?;
    for (_, item_value) in ret {
        let json_val: SyslogRoute = json::from_slice(&item_value).unwrap();
        SYSLOG_ROUTES.insert(json_val.id.to_owned(), json_val);
    }
    log::info!("[TRACE] SyslogRoutes Cached");
    Ok(())
}
