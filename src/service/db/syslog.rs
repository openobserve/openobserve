// Copyright 2025 OpenObserve Inc.
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

use std::sync::Arc;

use config::utils::json;
use infra::cluster_coordinator::events::{MetaAction, MetaEvent};

use crate::{
    common::{
        infra::config::{SYSLOG_ENABLED, SYSLOG_ROUTES},
        meta::syslog::SyslogRoute,
    },
    service::db,
};

pub const SYSLOG_ROUTES_KEY: &str = "/syslog/route/";
pub const SYSLOG_SETTINGS_KEY: &str = "/syslog/enabled";

#[tracing::instrument(name = "service:db:syslog:toggle_syslog_setting")]
pub async fn toggle_syslog_setting(enabled: bool) -> Result<(), anyhow::Error> {
    Ok(db::put(
        SYSLOG_SETTINGS_KEY,
        json::to_vec(&json::Value::Bool(enabled)).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await?)
}

#[tracing::instrument(name = "service:db:syslog:list")]
pub async fn list() -> Result<Vec<SyslogRoute>, anyhow::Error> {
    Ok(db::list(SYSLOG_ROUTES_KEY)
        .await?
        .values()
        .map(|val| json::from_slice(val).unwrap())
        .collect())
}

#[tracing::instrument(name = "service:db:syslog:set", skip_all)]
pub async fn set(route: &SyslogRoute) -> Result<(), anyhow::Error> {
    Ok(db::put(
        &format!("{SYSLOG_ROUTES_KEY}{}", route.id),
        json::to_vec(route).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await?)
}

#[tracing::instrument(name = "service:db:syslog:get")]
pub async fn get(id: &str) -> Result<SyslogRoute, anyhow::Error> {
    let val = db::get(&format!("{SYSLOG_ROUTES_KEY}{id}")).await?;
    Ok(json::from_slice(&val).unwrap())
}

#[tracing::instrument(name = "service:db:syslog:delete")]
pub async fn delete(id: &str) -> Result<(), anyhow::Error> {
    Ok(db::delete(&format!("/syslog/route/{id}"), false, db::NEED_WATCH, None).await?)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = SYSLOG_ROUTES_KEY;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching syslog routes");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_syslog: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let _ = handle_put(&ev.key).await;
            }
            db::Event::Delete(ev) => {
                let _ = handle_delete(&ev.key).await;
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn handle_syslog_event(event: MetaEvent) -> Result<(), anyhow::Error> {
    match event.action {
        MetaAction::Put => handle_put(&event.key).await,
        MetaAction::Delete => handle_delete(&event.key).await,
    }
}

async fn handle_put(event_key: &str) -> Result<(), anyhow::Error> {
    let item_value: SyslogRoute = match db::get(event_key).await {
        Ok(val) => match json::from_slice(&val) {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error getting value: {}", e);
                return Err(anyhow::anyhow!("Error getting value: {}", e));
            }
        },
        Err(e) => {
            log::error!("Error getting value: {}", e);
            return Err(anyhow::anyhow!("Error getting value: {}", e));
        }
    };
    SYSLOG_ROUTES.insert(item_value.id.to_owned(), item_value);
    Ok(())
}

async fn handle_delete(event_key: &str) -> Result<(), anyhow::Error> {
    let item_key = event_key.strip_prefix(SYSLOG_ROUTES_KEY).unwrap();
    SYSLOG_ROUTES.remove(item_key);
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = SYSLOG_ROUTES_KEY;
    let ret = db::list(key).await?;
    for (_, item_value) in ret {
        let json_val: SyslogRoute = json::from_slice(&item_value).unwrap();
        SYSLOG_ROUTES.insert(json_val.id.to_owned(), json_val);
    }
    log::info!("SyslogRoutes Cached");
    Ok(())
}

pub async fn watch_syslog_settings() -> Result<(), anyhow::Error> {
    let key = SYSLOG_SETTINGS_KEY;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching SyslogServer settings");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_syslog: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let _ = handle_syslog_settings_put(&ev.key).await;
            }
            db::Event::Delete(_) => {
                let _ = handle_syslog_settings_delete().await;
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn handle_syslog_settings_event(event: MetaEvent) -> Result<(), anyhow::Error> {
    match event.action {
        MetaAction::Put => handle_syslog_settings_put(&event.key).await,
        MetaAction::Delete => handle_syslog_settings_delete().await,
    }
}

async fn handle_syslog_settings_put(event_key: &str) -> Result<(), anyhow::Error> {
    let item_value: bool = match db::get(event_key).await {
        Ok(val) => match json::from_slice(&val) {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error getting value: {}", e);
                return Err(anyhow::anyhow!("Error getting value: {}", e));
            }
        },
        Err(e) => {
            log::error!("Error getting value: {}", e);
            return Err(anyhow::anyhow!("Error getting value: {}", e));
        }
    };
    let mut syslog_enabled = SYSLOG_ENABLED.write();
    *syslog_enabled = item_value;
    Ok(())
}

async fn handle_syslog_settings_delete() -> Result<(), anyhow::Error> {
    let mut syslog_enabled = SYSLOG_ENABLED.write();
    *syslog_enabled = false;
    Ok(())
}

pub async fn cache_syslog_settings() -> Result<(), anyhow::Error> {
    let key = SYSLOG_SETTINGS_KEY;
    if let Ok(val) = db::get(key).await {
        let item_value: bool = json::from_slice(&val).unwrap();
        let mut syslog_enabled = SYSLOG_ENABLED.write();
        *syslog_enabled = item_value;
    }
    log::info!("SyslogServer settings Cached");
    Ok(())
}
