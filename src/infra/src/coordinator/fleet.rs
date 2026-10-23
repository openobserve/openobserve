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

//! Fleet events: receivers re-read the rows, so put and delete mean the same.

use std::sync::Arc;

use tokio::sync::mpsc;

use crate::{db::Event, errors::Error};

pub const FLEET_WATCHER_PREFIX: &str = "/fleet/";

const KIND_TOKEN: &str = "token";
const KIND_COLLECTOR: &str = "collector";
const KIND_DESIRED: &str = "desired";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FleetEvent {
    Token {
        org_id: String,
        token_id: String,
    },
    Collector {
        org_id: String,
        collector_id: String,
    },
    /// One org's desired configurations changed.
    Desired {
        org_id: String,
    },
}

/// A `put`: one key per token, so the store stays bounded.
pub async fn emit_token_changed(org_id: &str, token_id: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    coordinator
        .put(
            &token_key(org_id, token_id),
            bytes::Bytes::from(""),
            true,
            None,
        )
        .await?;
    Ok(())
}

/// A `delete`: one key per uid ever unenrolled, which a `put` would keep forever.
pub async fn emit_collector_changed(org_id: &str, collector_id: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    coordinator
        .delete(&collector_key(org_id, collector_id), false, true, None)
        .await
}

/// A `put`: one key per org, so the store stays bounded.
pub async fn emit_desired_changed(org_id: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    coordinator
        .put(&desired_key(org_id), bytes::Bytes::from(""), true, None)
        .await?;
    Ok(())
}

/// Only events after this returns are delivered, so subscribe before reading the rows.
pub async fn subscribe() -> Result<Arc<mpsc::Receiver<Event>>, Error> {
    let coordinator = super::get_coordinator().await;
    coordinator.watch(FLEET_WATCHER_PREFIX).await
}

/// Hands every fleet event to `on_event`, which lives in the enterprise crate.
pub async fn run<F>(
    mut events: Arc<mpsc::Receiver<Event>>,
    on_event: F,
) -> Result<(), anyhow::Error>
where
    F: Fn(FleetEvent) + Send + Sync + 'static,
{
    let events = Arc::get_mut(&mut events)
        .ok_or_else(|| anyhow::anyhow!("watch_fleet: the receiver is shared"))?;
    log::info!("Start watching fleet events");
    loop {
        let Some(ev) = events.recv().await else {
            log::error!("watch_fleet: event channel closed");
            break;
        };
        let key = match &ev {
            Event::Put(e) => e.key.clone(),
            Event::Delete(e) => e.key.clone(),
            Event::Empty => continue,
        };
        match parse(&key) {
            Some(event) => on_event(event),
            None => log::debug!("watch_fleet: ignoring key {key}"),
        }
    }
    Ok(())
}

fn token_key(org_id: &str, token_id: &str) -> String {
    format!("{FLEET_WATCHER_PREFIX}{KIND_TOKEN}/{org_id}/{token_id}")
}

fn collector_key(org_id: &str, collector_id: &str) -> String {
    format!("{FLEET_WATCHER_PREFIX}{KIND_COLLECTOR}/{org_id}/{collector_id}")
}

fn desired_key(org_id: &str) -> String {
    format!("{FLEET_WATCHER_PREFIX}{KIND_DESIRED}/{org_id}")
}

/// Unknown kinds are not errors: a newer node may emit a kind this one has never heard of.
fn parse(key: &str) -> Option<FleetEvent> {
    let parts: Vec<&str> = key.strip_prefix(FLEET_WATCHER_PREFIX)?.split('/').collect();
    if let [KIND_DESIRED, org_id] = parts.as_slice() {
        return (!org_id.is_empty()).then(|| FleetEvent::Desired {
            org_id: org_id.to_string(),
        });
    }
    let [kind, org_id, id] = parts.as_slice() else {
        return None;
    };
    if org_id.is_empty() || id.is_empty() {
        return None;
    }
    let (org_id, id) = (org_id.to_string(), id.to_string());
    match *kind {
        KIND_TOKEN => Some(FleetEvent::Token {
            org_id,
            token_id: id,
        }),
        KIND_COLLECTOR => Some(FleetEvent::Collector {
            org_id,
            collector_id: id,
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_sort_under_the_prefix_and_parse_back() {
        let token = token_key("default", "tok-1");
        let collector = collector_key("default", "0190a6f0-0000-7000-8000-000000000001");
        for key in [&token, &collector] {
            assert!(key.starts_with(FLEET_WATCHER_PREFIX), "{key}");
        }
        assert_eq!(
            parse(&token),
            Some(FleetEvent::Token {
                org_id: "default".to_string(),
                token_id: "tok-1".to_string(),
            })
        );
        assert_eq!(
            parse(&collector),
            Some(FleetEvent::Collector {
                org_id: "default".to_string(),
                collector_id: "0190a6f0-0000-7000-8000-000000000001".to_string(),
            })
        );
    }

    #[test]
    fn the_desired_key_is_one_per_org_and_parses_back() {
        assert_eq!(desired_key("default"), "/fleet/desired/default");
        assert_eq!(
            parse("/fleet/desired/default"),
            Some(FleetEvent::Desired {
                org_id: "default".to_string()
            })
        );
    }

    #[test]
    fn malformed_or_unknown_keys_are_none() {
        for key in [
            "",
            "/",
            "/fleet/",
            "/fleet/token",
            "/fleet/token/default",
            "/fleet/token/default/",
            "/fleet/token//tok",
            "/fleet/token/default/tok/extra",
            "/fleet/collector/default",
            "/fleet/desired/",
            "/fleet/desired//x",
            "/fleet/desired/a/b",
            "/fleet/nonsense/a/b",
            "/oncall_cache/team/default/t",
        ] {
            assert_eq!(parse(key), None, "{key}");
        }
    }
}
