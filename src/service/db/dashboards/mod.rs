// Copyright 2026 OpenObserve Inc.
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

pub mod reports;

use std::sync::Arc;

use infra::{
    coordinator::dashboards::DASHBOARDS_WATCH_PREFIX,
    db::{self, Event},
    table,
};

use crate::common::infra::config::DASHBOARD_ID_TO_ORG;

/// Returns true iff `dashboard_id` exists in `org_id`. Reads from the in-memory
/// `DASHBOARD_ID_TO_ORG` cache; on a cache miss falls back to a scoped `get_by_id`
/// (cheap — single-row DB lookup using the org index) and warms the cache.
///
/// Callers should treat `false` as a 404-equivalent (no existence oracle).
pub async fn dashboard_in_org(org_id: &str, dashboard_id: &str) -> bool {
    if let Some(org) = DASHBOARD_ID_TO_ORG.read().await.get(dashboard_id).cloned() {
        return org == org_id;
    }
    match table::dashboards::get_by_id(org_id, dashboard_id).await {
        Ok(Some(_)) => {
            DASHBOARD_ID_TO_ORG
                .write()
                .await
                .insert(dashboard_id.to_string(), org_id.to_string());
            true
        }
        Ok(None) => false,
        Err(e) => {
            log::error!("[Dashboard] error checking dashboard {dashboard_id} in org {org_id}: {e}");
            false
        }
    }
}

/// Bootstraps `DASHBOARD_ID_TO_ORG` from the DB. Lightweight — does not load dashboard
/// bodies, only `(id, org)` pairs. Safe to call on every node type (routers included).
pub async fn cache_id_to_org() -> Result<(), anyhow::Error> {
    let dashboards = table::dashboards::list_all().await?;
    let mut id_to_org = DASHBOARD_ID_TO_ORG.write().await;
    id_to_org.clear();
    for (org, dash) in dashboards.iter() {
        if let Some(id) = dash.dashboard_id() {
            id_to_org.insert(id.to_string(), org.clone());
        }
    }
    log::info!(
        "[Dashboard] Cached id->org mapping for {} dashboards",
        id_to_org.len()
    );
    Ok(())
}

/// Watcher that keeps `DASHBOARD_ID_TO_ORG` in sync across the cluster. Runs on every
/// node type. The coordinator key format is `/dashboards/{org}/{dashboard_id}`, so we
/// can parse the org out of the event key directly without an extra DB read on Delete.
pub async fn watch_id_to_org() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(DASHBOARDS_WATCH_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[Dashboard::watch_id_to_org] started");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("[Dashboard::watch_id_to_org] event channel closed");
                break;
            }
        };
        match ev {
            Event::Put(ev) => {
                let Some((org_id, dashboard_id)) = parse_key(&ev.key) else {
                    log::warn!("[Dashboard::watch_id_to_org] malformed put key: {}", ev.key);
                    continue;
                };
                DASHBOARD_ID_TO_ORG
                    .write()
                    .await
                    .insert(dashboard_id.to_string(), org_id.to_string());
            }
            Event::Delete(ev) => {
                let Some((_org_id, dashboard_id)) = parse_key(&ev.key) else {
                    log::warn!(
                        "[Dashboard::watch_id_to_org] malformed delete key: {}",
                        ev.key
                    );
                    continue;
                };
                DASHBOARD_ID_TO_ORG.write().await.remove(dashboard_id);
            }
            Event::Empty => {}
        }
    }
    log::info!("[Dashboard::watch_id_to_org] ended");
    Ok(())
}

/// Parses `/dashboards/{org}/{dashboard_id}` into `(org, dashboard_id)`.
fn parse_key(key: &str) -> Option<(&str, &str)> {
    let rest = key.strip_prefix(DASHBOARDS_WATCH_PREFIX)?;
    rest.split_once('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_key_valid() {
        assert_eq!(
            parse_key("/dashboards/my-org/dash-123"),
            Some(("my-org", "dash-123"))
        );
    }

    #[test]
    fn test_parse_key_wrong_prefix() {
        assert_eq!(parse_key("/pipelines/foo/bar"), None);
    }

    #[test]
    fn test_parse_key_missing_separator() {
        assert_eq!(parse_key("/dashboards/just-org"), None);
    }
}
