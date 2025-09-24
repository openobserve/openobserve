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

use std::{future::Future, sync::Arc};

use config::meta::alerts::alert::Alert;
use itertools::Itertools;

use crate::{db::Event, errors::Error};

pub const ALERT_WATCHER_PREFIX: &str = "/alerts/";

/// Sends event to the cluster coordinator indicating that an alert has been put
/// into the database.
pub async fn emit_put_event(
    org: &str,
    alert: &Alert,
    folder_id: Option<String>,
) -> Result<(), Error> {
    let alert_id = alert.get_unique_key();
    let key = alert_key(org, &alert_id);
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(
            &key,
            bytes::Bytes::from(folder_id.unwrap_or("default".to_string())),
            true,
            None,
        )
        .await?;
    Ok(())
}

/// Sends event to the cluster coordinator indicating that an alert has been
/// deleted from the database.
pub async fn emit_delete_event(org: &str, alert_id: &str) -> Result<(), Error> {
    let key = alert_key(org, alert_id);
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator.delete(&key, false, true, None).await
}

/// Watch for alert events published to the cluster coordinator.
pub async fn watch_events<OnPut, OnPutFut, OnDelete, OnDeleteFut>(
    on_put: OnPut,
    on_delete: OnDelete,
) -> Result<(), anyhow::Error>
where
    OnPut: Fn(String, String, Option<String>) -> OnPutFut,
    OnPutFut: Future<Output = Result<(), anyhow::Error>>,
    OnDelete: Fn(String, String) -> OnDeleteFut,
    OnDeleteFut: Future<Output = Result<(), anyhow::Error>>,
{
    let cluster_coordinator = super::get_coordinator().await;
    let mut events = cluster_coordinator.watch(ALERT_WATCHER_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alerts");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alerts: event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let Some((org, alert_id)) = parse_alert_key(&ev.key) else {
                    log::error!("watch_alerts: failed to parse event key {}", &ev.key);
                    continue;
                };
                let folder_id = ev.value.map(|v| String::from_utf8_lossy(&v).to_string());
                if let Err(e) = (on_put)(org, alert_id, folder_id).await {
                    log::error!("Error in alert put handler: {e}");
                }
            }
            Event::Delete(ev) => {
                let Some((org, alert_id)) = parse_alert_key(&ev.key) else {
                    log::error!("watch_alerts: failed to parse event key {}", &ev.key);
                    continue;
                };
                let _ = (on_delete)(org, alert_id).await;
            }
            Event::Empty => {}
        }
    }
    Ok(())
}

/// Returns the key used to identify an individual alert in events sent to
/// cluster cache watchers.
fn alert_key(org: &str, alert_id: &str) -> String {
    format!("/alerts/{org}/{alert_id}")
}

/// Tries to parse the key used to identify an individual alert in events
/// sent to cluster cache watchers. Returns the organization, stream type,
/// stream name, and alert name from the key.
pub fn parse_alert_key(key: &str) -> Option<(String, String)> {
    let parts = key.trim_start_matches("/").split('/').collect_vec();
    if parts.len() < 3 || parts[0] != "alerts" {
        return None;
    }
    let org = parts[1].to_owned();
    let alert_id = parts[2].to_owned();
    Some((org, alert_id))
}
