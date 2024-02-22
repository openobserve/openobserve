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

use config::{
    cluster::{is_alert_manager, LOCAL_NODE_ROLE},
    utils::json,
};
use infra::db as infra_db;

use crate::{
    common::{
        infra::config::DASHBOARD_REPORTS,
        meta::{alerts::triggers::Trigger, dashboards::reports::Report},
    },
    service::alerts::triggers,
};

pub async fn get(org_id: &str, name: &str) -> Result<Report, anyhow::Error> {
    let report_key = format!("{org_id}/{name}");
    if let Some(v) = DASHBOARD_REPORTS.get(&report_key) {
        Ok(v.value().clone())
    } else {
        let db = infra_db::get_db().await;
        let key = format!("/reports/{org_id}/{name}");
        match db.get(&key).await {
            Ok(val) => Ok(json::from_slice(&val)?),
            Err(_) => Err(anyhow::anyhow!("Report not found")),
        }
    }
}

pub async fn set(org_id: &str, report: &Report) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/reports/{org_id}/{}", report.name);
    if let Err(e) = db
        .put(
            &key,
            json::to_vec(report).unwrap().into(),
            infra_db::NEED_WATCH,
        )
        .await
    {
        return Err(anyhow::anyhow!("Error save report: {}", e));
    }
    Ok(())
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/reports/{org_id}/{name}");
    db.delete(&key, false, infra_db::NEED_WATCH)
        .await
        .map_err(|e| anyhow::anyhow!("Error deleting report: {}", e))
}

pub async fn list(org_id: &str) -> Result<Vec<Report>, anyhow::Error> {
    let db = infra_db::get_db().await;

    let key = format!("/reports/{org_id}");
    let ret = db.list_values(&key).await?;
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
    let cluster_coordinator = infra_db::get_coordinator().await;
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
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Report = json::from_slice(&ev.value.unwrap()).unwrap();
                let start_time = item_value.start;
                DASHBOARD_REPORTS.insert(item_key.to_owned(), item_value);

                // add to triggers
                if is_alert_manager(&LOCAL_NODE_ROLE) {
                    let columns = item_key.split('/').collect::<Vec<&str>>();
                    let org_id = columns[0];
                    let report_name = columns[1];
                    let trigger = Trigger {
                        next_run_at: start_time,
                        is_realtime: false,
                        is_silenced: false,
                    };
                    if let Err(e) = triggers::save_report(org_id, report_name, &trigger).await {
                        log::error!("Failed to save trigger: {}", e);
                    }
                }
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                DASHBOARD_REPORTS.remove(item_key);

                // delete from triggers
                if is_alert_manager(&LOCAL_NODE_ROLE) {
                    let columns = item_key.split('/').collect::<Vec<&str>>();
                    let org_id = columns[0];
                    let report_name = columns[1];
                    _ = triggers::delete_report(org_id, report_name).await;
                }
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/reports/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let key = item_key.strip_prefix(key).unwrap();
        let json_val: Report = json::from_slice(&item_value).unwrap();
        DASHBOARD_REPORTS.insert(key.to_owned(), json_val);
    }
    log::info!("Reports Cached");
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/reports/";
    Ok(db.delete(key, true, infra_db::NO_NEED_WATCH).await?)
}
