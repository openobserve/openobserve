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

use std::sync::Arc;

use infra::{coordinator::org_status as coordinator, db, errors, table::organizations};

use crate::common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};

/// Update local cache and broadcast to cluster — used when the DB write was already done
/// atomically via `set_status_if` (e.g. in `initiate_deletion`).
pub async fn broadcast_deleting(org_id: &str) -> Result<(), errors::Error> {
    ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::Deleting);
    coordinator::emit_deleting_event(org_id).await?;
    Ok(())
}

/// Update local cache + broadcast that an org entered pending_deletion (soft delete).
/// The DB status/deleted_at were already written atomically by the caller.
pub async fn broadcast_pending_deletion(org_id: &str) -> Result<(), errors::Error> {
    ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::PendingDeletion);
    coordinator::emit_pending_event(org_id).await?;
    Ok(())
}

/// Evict an org from the status cache on all nodes (called after deletion completes).
pub async fn evict(org_id: &str) -> Result<(), errors::Error> {
    ORG_STATUS_CACHE.remove(org_id);
    coordinator::emit_evict_event(org_id).await?;
    Ok(())
}

/// Resurrect: remove from the blocked cache and broadcast eviction so all nodes
/// treat the org as active again.
pub async fn set_active(org_id: &str) -> Result<(), errors::Error> {
    ORG_STATUS_CACHE.remove(org_id);
    coordinator::emit_evict_event(org_id).await?;
    Ok(())
}

/// True when the org is either pending deletion or actively being deleted — used
/// by the blocking middleware to hide + block the org from all normal access.
pub fn is_blocked(org_id: &str) -> bool {
    ORG_STATUS_CACHE
        .get(org_id)
        .map(|v| *v == OrgStatus::Deleting || *v == OrgStatus::PendingDeletion)
        .unwrap_or(false)
}

/// Load org status from DB into the in-memory cache at startup.
pub async fn load_from_db() -> Result<(), anyhow::Error> {
    let orgs = organizations::list(organizations::ListFilter::default()).await?;
    for org in orgs {
        match org.status.as_str() {
            "deleting" => {
                ORG_STATUS_CACHE.insert(org.identifier.clone(), OrgStatus::Deleting);
            }
            "pending_deletion" => {
                ORG_STATUS_CACHE.insert(org.identifier.clone(), OrgStatus::PendingDeletion);
            }
            _ => {}
        }
    }
    Ok(())
}

/// Watch coordinator events for org status changes and keep the local cache in sync.
///
/// A single watched prefix carries every status transition: a `Put` on
/// `/organization/status/{org}` with value "deleting" / "pending_deletion"
/// updates the cache; a `Delete` on that key evicts the org (active/gone).
pub async fn watch() -> Result<(), anyhow::Error> {
    use infra::coordinator::org_status::{
        ORG_STATUS_KEY_PREFIX, STATUS_ACTIVE, STATUS_DELETING, STATUS_PENDING_DELETION,
    };

    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(ORG_STATUS_KEY_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();

    log::info!("Start watching org status events");
    loop {
        match events.recv().await {
            Some(db::Event::Put(ev)) => {
                let Some(org_id) = ev.key.strip_prefix(ORG_STATUS_KEY_PREFIX) else {
                    continue;
                };
                // Prefer the inline event value; fall back to the DB (source of
                // truth) if a coordinator backend delivers no value inline.
                let status = match ev.value.as_ref() {
                    Some(v) => String::from_utf8_lossy(v).to_string(),
                    None => match organizations::get(org_id).await {
                        Ok(org) => org.status,
                        Err(e) => {
                            log::error!("[org_status] cannot resolve status for {org_id}: {e}");
                            continue;
                        }
                    },
                };
                match status.as_str() {
                    STATUS_DELETING => {
                        ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::Deleting);
                        log::info!("[org_status] org {org_id} marked deleting in cache");
                    }
                    STATUS_PENDING_DELETION => {
                        ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::PendingDeletion);
                        log::info!("[org_status] org {org_id} marked pending_deletion in cache");
                    }
                    STATUS_ACTIVE => {
                        // active (e.g. resurrected) → no longer blocked.
                        ORG_STATUS_CACHE.remove(org_id);
                        log::info!("[org_status] org {org_id} active, cleared from cache");
                    }
                    other => {
                        // No code path should emit any other status. Warn loudly:
                        // silently clearing the cache here could un-block an org that
                        // is genuinely pending_deletion/deleting.
                        log::warn!(
                            "[org_status] org {org_id} unexpected status={other:?}; clearing from cache"
                        );
                        ORG_STATUS_CACHE.remove(org_id);
                    }
                }
            }
            Some(db::Event::Delete(ev)) => {
                if let Some(org_id) = ev.key.strip_prefix(ORG_STATUS_KEY_PREFIX) {
                    ORG_STATUS_CACHE.remove(org_id);
                    log::info!("[org_status] org {org_id} evicted from cache");
                }
            }
            Some(db::Event::Empty) => {}
            None => {
                log::error!("watch_org_status: event channel closed");
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ORG_STATUS_CACHE, OrgStatus, is_blocked};

    /// Seeds the shared cache for one org and cleans up afterwards. Org ids are
    /// unique per test so tests stay independent under parallel execution.
    fn with_org_status(org_id: &str, status: OrgStatus, assertion: impl FnOnce()) {
        ORG_STATUS_CACHE.insert(org_id.to_string(), status);
        assertion();
        ORG_STATUS_CACHE.remove(org_id);
    }

    #[test]
    fn test_is_blocked_false_for_unknown_org() {
        assert!(!is_blocked("nope-unknown-org"));
    }

    #[test]
    fn test_is_blocked_true_for_pending_deletion() {
        // Soft-delete grace window: the org must already read as gone to users.
        with_org_status("org-pending-deletion", OrgStatus::PendingDeletion, || {
            assert!(is_blocked("org-pending-deletion"));
        });
    }

    #[test]
    fn test_is_blocked_true_for_deleting() {
        with_org_status("org-deleting", OrgStatus::Deleting, || {
            assert!(is_blocked("org-deleting"));
        });
    }

    #[test]
    fn test_is_blocked_false_for_active() {
        with_org_status("org-active", OrgStatus::Active, || {
            assert!(!is_blocked("org-active"));
        });
    }
}
