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

use std::sync::Arc;

use config::utils::json;
use infra::scheduler;

use crate::{
    common::{infra::config::DASHBOARD_REPORTS, meta::dashboards::reports::Report},
    service::db,
};

pub async fn get(org_id: &str, name: &str) -> Result<Report, anyhow::Error> {
    let report_key = format!("{org_id}/{name}");
    if let Some(v) = DASHBOARD_REPORTS.get(&report_key) {
        Ok(v.value().clone())
    } else {
        let key = format!("/reports/{org_id}/{name}");
        match db::get(&key).await {
            Ok(val) => Ok(json::from_slice(&val)?),
            Err(_) => Err(anyhow::anyhow!("Report not found")),
        }
    }
}

pub async fn set(org_id: &str, report: &Report, create: bool) -> Result<(), anyhow::Error> {
    match set_without_updating_trigger(org_id, report).await {
        Ok(schedule_key) => {
            let trigger = scheduler::Trigger {
                org: org_id.to_string(),
                module: scheduler::TriggerModule::Report,
                module_key: schedule_key,
                next_run_at: report.start,
                ..Default::default()
            };
            if create {
                match scheduler::push(trigger).await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        log::error!("Failed to save trigger: {}", e);
                        Ok(())
                    }
                }
            } else {
                match scheduler::update_trigger(trigger).await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        log::error!("Failed to update trigger: {}", e);
                        Ok(())
                    }
                }
            }
        }
        Err(e) => Err(anyhow::anyhow!("Error saving report: {}", e)),
    }
}

pub async fn set_without_updating_trigger(
    org_id: &str,
    report: &Report,
) -> Result<String, anyhow::Error> {
    let schedule_key = report.name.to_string();
    let key = format!("/reports/{org_id}/{}", &schedule_key);
    match db::put(
        &key,
        json::to_vec(report).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await
    {
        Ok(_) => Ok(schedule_key),
        Err(e) => Err(anyhow::anyhow!("{e}")),
    }
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let key = format!("/reports/{org_id}/{name}");
    match db::delete(&key, false, db::NEED_WATCH, None).await {
        Ok(_) => match scheduler::delete(org_id, scheduler::TriggerModule::Report, name).await {
            Ok(_) => Ok(()),
            Err(e) => {
                log::error!("Failed to delete trigger: {}", e);
                Ok(())
            }
        },
        Err(e) => Err(anyhow::anyhow!("Error deleting report: {}", e)),
    }
}

pub async fn list(org_id: &str) -> Result<Vec<Report>, anyhow::Error> {
    let key = format!("/reports/{org_id}");
    let ret = db::list_values(&key).await?;
    let mut items: Vec<Report> = Vec::with_capacity(ret.len());
    for item_value in ret {
        let json_val = json::from_slice(&item_value)?;
        items.push(json_val)
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/reports/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching reports");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_reports: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Report = json::from_slice(&ev.value.unwrap()).unwrap();
                DASHBOARD_REPORTS.insert(item_key.to_owned(), item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                DASHBOARD_REPORTS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/reports/";
    let ret = db::list(key).await?;
    for (item_key, item_value) in ret {
        let key = item_key.strip_prefix(key).unwrap();
        let json_val: Report = json::from_slice(&item_value).unwrap();
        DASHBOARD_REPORTS.insert(key.to_owned(), json_val);
    }
    log::info!("Reports Cached");
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/reports/";
    Ok(db::delete(key, true, db::NO_NEED_WATCH, None).await?)
}
