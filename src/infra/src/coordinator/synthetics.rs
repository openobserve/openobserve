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

use crate::{db::Event, errors::Error};

pub const SYNTHETICS_WATCHER_PREFIX: &str = "/synthetics/";

const KIND_CHECK: &str = "check";
const KIND_LOCATION: &str = "location";
const KIND_TOKEN: &str = "token";
const KIND_AGENT: &str = "agent";

/// A check definition was created or updated.
pub async fn emit_check_put(org_id: &str, synthetics_id: &str) -> Result<(), Error> {
    emit_put(&check_key(org_id, synthetics_id)).await
}

/// A check definition was deleted.
pub async fn emit_check_delete(org_id: &str, synthetics_id: &str) -> Result<(), Error> {
    emit_delete(&check_key(org_id, synthetics_id)).await
}

/// The location registry changed (add / update / remove).
pub async fn emit_locations_changed() -> Result<(), Error> {
    emit_put(&format!("{SYNTHETICS_WATCHER_PREFIX}{KIND_LOCATION}/all")).await
}

/// An org's probe tokens changed — created, enabled/disabled, or default moved.
///
/// Disabling a token is revocation, so this is the event whose delivery latency
/// is the fleet-wide revocation window.
pub async fn emit_tokens_changed(org_id: &str) -> Result<(), Error> {
    emit_put(&format!("{SYNTHETICS_WATCHER_PREFIX}{KIND_TOKEN}/{org_id}")).await
}

/// An agent re-registered, so its capabilities may have changed.
pub async fn emit_agent_changed(agent_id: &str) -> Result<(), Error> {
    emit_put(&format!(
        "{SYNTHETICS_WATCHER_PREFIX}{KIND_AGENT}/{agent_id}"
    ))
    .await
}

async fn emit_put(key: &str) -> Result<(), Error> {
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(key, bytes::Bytes::from(""), true, None)
        .await?;
    Ok(())
}

async fn emit_delete(key: &str) -> Result<(), Error> {
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator.delete(key, false, true, None).await
}

fn check_key(org_id: &str, synthetics_id: &str) -> String {
    format!("{SYNTHETICS_WATCHER_PREFIX}{KIND_CHECK}/{org_id}/{synthetics_id}")
}

/// Watches synthetics events and invalidates the matching local cache.
///
/// Spawned once per node at startup. Both `Put` and `Delete` invalidate — the
/// caches hold no value from the event itself, so the two cases are the same
/// action, and a deleted check must stop being served just as surely as an
/// edited one.
pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = super::get_coordinator().await;
    let mut events = cluster_coordinator.watch(SYNTHETICS_WATCHER_PREFIX).await?;
    let events = std::sync::Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching synthetics cache events");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_synthetics: event channel closed");
                break;
            }
        };
        let key = match &ev {
            Event::Put(e) => e.key.clone(),
            Event::Delete(e) => e.key.clone(),
            Event::Empty => continue,
        };
        apply(&key).await;
    }
    Ok(())
}

/// Applies one event key to the local caches. Unknown keys are logged and
/// ignored rather than panicking — a newer node may emit a kind this build does
/// not understand yet.
async fn apply(key: &str) {
    let parts: Vec<&str> = key.trim_start_matches('/').split('/').collect();
    // parts[0] == "synthetics"
    match parts.get(1).copied() {
        Some(KIND_CHECK) => match (parts.get(2), parts.get(3)) {
            (Some(org), Some(id)) => crate::table::synthetics_checks::invalidate_cache(org, id),
            _ => log::error!("watch_synthetics: malformed check key {key}"),
        },
        Some(KIND_LOCATION) => crate::table::synthetics_locations::invalidate_cache().await,
        Some(KIND_TOKEN) => crate::table::synthetics_probe_tokens::invalidate_cache(),
        Some(KIND_AGENT) => match parts.get(2) {
            Some(agent_id) => crate::table::synthetics_agents::invalidate_cache(agent_id),
            None => log::error!("watch_synthetics: malformed agent key {key}"),
        },
        other => log::debug!("watch_synthetics: ignoring unknown event kind {other:?} ({key})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_key_format() {
        assert_eq!(
            check_key("myorg", "abc123"),
            "/synthetics/check/myorg/abc123"
        );
    }

    #[test]
    fn test_watch_prefix_covers_every_kind() {
        // Every emitted key must sort under the single watch prefix, or the
        // watcher silently never sees it.
        for k in [
            check_key("o", "i"),
            format!("{SYNTHETICS_WATCHER_PREFIX}{KIND_LOCATION}/all"),
            format!("{SYNTHETICS_WATCHER_PREFIX}{KIND_TOKEN}/o"),
            format!("{SYNTHETICS_WATCHER_PREFIX}{KIND_AGENT}/a"),
        ] {
            assert!(k.starts_with(SYNTHETICS_WATCHER_PREFIX), "{k}");
        }
    }

    #[test]
    fn test_key_parses_into_kind_and_ids() {
        let key = check_key("myorg", "abc123");
        let parts: Vec<&str> = key.trim_start_matches('/').split('/').collect();
        assert_eq!(parts[0], "synthetics");
        assert_eq!(parts[1], KIND_CHECK);
        assert_eq!(parts[2], "myorg");
        assert_eq!(parts[3], "abc123");
    }

    #[test]
    fn test_org_and_id_with_unusual_chars_still_parse() {
        // Org ids and ksuids are alphanumeric today; this guards the parse
        // against a future id format that is merely long or mixed-case.
        let key = check_key("Org-With_Dash", "3HGpH7OjyQHnknWNzXNIDXeF6zi");
        let parts: Vec<&str> = key.trim_start_matches('/').split('/').collect();
        assert_eq!(parts[2], "Org-With_Dash");
        assert_eq!(parts[3], "3HGpH7OjyQHnknWNzXNIDXeF6zi");
    }
}
