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

use std::sync::{Arc, OnceLock};

use common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};
use infra::{coordinator::org_status as coordinator, db, errors, table::organizations};

/// Node-local clean-up for an org this node learns is deleting or deleted.
static ORG_GONE_HOOK: OnceLock<fn(&str)> = OnceLock::new();

/// Update local cache and broadcast to cluster — used when the DB write was already done
/// atomically via `set_status_if` (e.g. in `initiate_deletion`).
pub async fn broadcast_deleting(org_id: &str) -> Result<(), errors::Error> {
    ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::Deleting);
    run_org_gone_hook(org_id);
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

/// Update local cache + broadcast that an org's deletion finished and its row is a tombstone.
pub async fn broadcast_deleted(org_id: &str) -> Result<(), errors::Error> {
    ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::Deleted);
    run_org_gone_hook(org_id);
    coordinator::emit_deleted_event(org_id).await?;
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

/// True for pending, deleting and tombstoned orgs, which every gate treats as gone.
pub fn is_blocked(org_id: &str) -> bool {
    ORG_STATUS_CACHE
        .get(org_id)
        .map(|v| {
            matches!(
                *v,
                OrgStatus::Deleting | OrgStatus::PendingDeletion | OrgStatus::Deleted
            )
        })
        .unwrap_or(false)
}

/// True for deleting and tombstoned orgs, the states that run the org-gone hook.
pub fn is_gone(org_id: &str) -> bool {
    ORG_STATUS_CACHE
        .get(org_id)
        .is_some_and(|v| matches!(*v, OrgStatus::Deleting | OrgStatus::Deleted))
}

/// False when the org is blocked, in the cache or by its row's status, or has no row.
pub async fn is_active(org_id: &str) -> bool {
    read_active(org_id).await.unwrap_or(false)
}

/// `is_active` that returns a failed row read as an error instead of reading it as inactive.
pub async fn read_active(org_id: &str) -> Result<bool, errors::Error> {
    if is_blocked(org_id) {
        return Ok(false);
    }
    Ok(organizations::find(org_id)
        .await?
        .is_some_and(|org| !coordinator::is_blocking_status(&org.status)))
}

/// Sets the clean-up every status path runs, after the cache marks an org deleting or deleted.
pub fn set_org_gone_hook(hook: fn(&str)) {
    if ORG_GONE_HOOK.set(hook).is_err() {
        log::warn!("[org_status] org gone hook already set; keeping the first one");
    }
}

/// Load org status from DB into the in-memory cache at startup.
pub async fn load_from_db() -> Result<(), anyhow::Error> {
    let orgs = organizations::list(organizations::ListFilter::default()).await?;
    for org in orgs {
        match org.status.as_str() {
            "deleting" => {
                ORG_STATUS_CACHE.insert(org.identifier.clone(), OrgStatus::Deleting);
                run_org_gone_hook(&org.identifier);
            }
            "pending_deletion" => {
                ORG_STATUS_CACHE.insert(org.identifier.clone(), OrgStatus::PendingDeletion);
            }
            "deleted" => {
                ORG_STATUS_CACHE.insert(org.identifier.clone(), OrgStatus::Deleted);
                run_org_gone_hook(&org.identifier);
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
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator
        .watch(coordinator::ORG_STATUS_KEY_PREFIX)
        .await?;
    let events = Arc::get_mut(&mut events).unwrap();

    log::info!("Start watching org status events");
    loop {
        match events.recv().await {
            Some(event) => apply_event(event).await,
            None => {
                log::error!("watch_org_status: event channel closed");
                return Ok(());
            }
        }
    }
}

/// Every event means the org's row changed or went, so the cached row is dropped first.
async fn apply_event(event: db::Event) {
    use infra::coordinator::org_status::ORG_STATUS_KEY_PREFIX;

    let (db::Event::Put(ev) | db::Event::Delete(ev)) = &event else {
        return;
    };
    let Some(org_id) = ev.key.strip_prefix(ORG_STATUS_KEY_PREFIX) else {
        return;
    };
    organizations::invalidate_cache(Some(org_id)).await;
    if matches!(event, db::Event::Put(_)) {
        apply_put(org_id, ev.value.as_deref()).await;
    } else {
        ORG_STATUS_CACHE.remove(org_id);
        log::info!("[org_status] org {org_id} evicted from cache");
    }
}

async fn apply_put(org_id: &str, value: Option<&[u8]>) {
    use infra::coordinator::org_status::{
        STATUS_ACTIVE, STATUS_DELETED, STATUS_DELETING, STATUS_PENDING_DELETION,
    };

    // The DB is the fallback for a coordinator backend that delivers no inline value.
    let status = match value {
        Some(v) => String::from_utf8_lossy(v).to_string(),
        None => match organizations::get(org_id).await {
            Ok(org) => org.status,
            Err(e) => {
                log::error!("[org_status] cannot resolve status for {org_id}: {e}");
                return;
            }
        },
    };
    match status.as_str() {
        STATUS_DELETING => {
            ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::Deleting);
            log::info!("[org_status] org {org_id} marked deleting in cache");
            run_org_gone_hook(org_id);
        }
        STATUS_PENDING_DELETION => {
            ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::PendingDeletion);
            log::info!("[org_status] org {org_id} marked pending_deletion in cache");
        }
        STATUS_DELETED => {
            ORG_STATUS_CACHE.insert(org_id.to_string(), OrgStatus::Deleted);
            log::info!("[org_status] org {org_id} marked deleted in cache");
            run_org_gone_hook(org_id);
        }
        STATUS_ACTIVE => {
            ORG_STATUS_CACHE.remove(org_id);
            log::info!("[org_status] org {org_id} active, cleared from cache");
        }
        other => {
            // Loud, because clearing the entry could unblock an org that is really being deleted.
            log::warn!(
                "[org_status] org {org_id} unexpected status={other:?}; clearing from cache"
            );
            ORG_STATUS_CACHE.remove(org_id);
        }
    }
}

/// Callers run it after the cache insert, so a writer that re-checks the status misses no removal.
fn run_org_gone_hook(org_id: &str) {
    if let Some(hook) = ORG_GONE_HOOK.get() {
        hook(org_id);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ORG_STATUS_CACHE, OrgStatus, apply_event, coordinator, is_active, is_blocked, is_gone,
        organizations, read_active, set_org_gone_hook,
    };

    /// `(org, blocked when the hook ran)` for each hook call; tests filter by their own org ids.
    static GONE_CALLS: std::sync::Mutex<Vec<(String, bool)>> = std::sync::Mutex::new(Vec::new());

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
    fn test_is_blocked_true_for_deleted() {
        with_org_status("org-deleted-tombstone", OrgStatus::Deleted, || {
            assert!(is_blocked("org-deleted-tombstone"));
        });
    }

    #[test]
    fn test_is_gone_only_for_deleting_and_deleted() {
        for (status, gone) in [
            (OrgStatus::Active, false),
            (OrgStatus::PendingDeletion, false),
            (OrgStatus::Deleting, true),
            (OrgStatus::Deleted, true),
        ] {
            with_org_status("org-is-gone", status, || {
                assert_eq!(is_gone("org-is-gone"), gone);
            });
        }
        assert!(!is_gone("org-is-gone-unknown"));
    }

    #[test]
    fn test_is_blocked_false_for_active() {
        with_org_status("org-active", OrgStatus::Active, || {
            assert!(!is_blocked("org-active"));
        });
    }

    #[tokio::test]
    async fn test_is_active_false_for_blocked_and_missing_orgs() {
        ORG_STATUS_CACHE.insert("org-active-check-blocked".into(), OrgStatus::Deleting);
        assert!(!is_active("org-active-check-blocked").await);
        ORG_STATUS_CACHE.remove("org-active-check-blocked");
        assert!(!is_active("org-active-check-never-created").await);
    }

    #[tokio::test]
    async fn test_a_blocking_row_is_inactive_when_the_status_cache_does_not_block_it() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_row_blocks_{}", config::utils::time::now_micros());
        organizations::add(
            &org_id,
            &org_id,
            config::meta::organization::OrganizationType::Custom,
        )
        .await
        .unwrap();
        let mut seen = vec![(
            read_active(&org_id).await.unwrap(),
            is_active(&org_id).await,
        )];
        let mut from = coordinator::STATUS_ACTIVE;
        for status in [
            coordinator::STATUS_PENDING_DELETION,
            coordinator::STATUS_DELETING,
            coordinator::STATUS_DELETED,
        ] {
            let flipped = organizations::set_status_if(&org_id, from, status).await;
            assert!(flipped.unwrap());
            from = status;
            seen.push((
                read_active(&org_id).await.unwrap(),
                is_active(&org_id).await,
            ));
        }
        organizations::remove(&org_id).await.unwrap();

        assert!(
            !is_blocked(&org_id),
            "the status cache must not be what blocks it"
        );
        assert_eq!(
            seen,
            [(true, true), (false, false), (false, false), (false, false)]
        );
    }

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    #[tokio::test]
    async fn test_every_status_event_drops_the_cached_org_row() {
        use infra::{
            coordinator::org_status::ORG_STATUS_KEY_PREFIX,
            db::{Event, EventData},
            table::organizations,
        };
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_status_event_{}", config::utils::time::now_micros());
        organizations::add(
            &org_id,
            &org_id,
            config::meta::organization::OrganizationType::Custom,
        )
        .await
        .unwrap();
        // Another node's write changes the row but not this node's cached copy.
        infra::db::get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "UPDATE organizations SET status = 'pending_deletion' WHERE identifier = '{org_id}'"
            ))
            .await
            .unwrap();
        apply_event(Event::Put(EventData {
            key: format!("{ORG_STATUS_KEY_PREFIX}{org_id}"),
            value: Some("pending_deletion".into()),
            start_dt: None,
        }))
        .await;
        let status = organizations::get(&org_id).await.unwrap().status;
        organizations::remove(&org_id).await.unwrap();
        ORG_STATUS_CACHE.remove(&org_id);
        assert_eq!(
            status, "pending_deletion",
            "the cached row outlived the event"
        );
    }

    fn record_gone(org_id: &str) {
        GONE_CALLS
            .lock()
            .unwrap()
            .push((org_id.to_string(), is_blocked(org_id)));
    }

    fn gone_calls_for(org_id: &str) -> Vec<bool> {
        GONE_CALLS
            .lock()
            .unwrap()
            .iter()
            .filter(|(org, _)| org == org_id)
            .map(|(_, blocked)| *blocked)
            .collect()
    }

    #[tokio::test]
    async fn test_deleting_and_deleted_events_run_the_gone_hook_after_the_cache() {
        use infra::{
            coordinator::org_status::ORG_STATUS_KEY_PREFIX,
            db::{Event, EventData},
        };
        set_org_gone_hook(record_gone);
        let event = |org: &str, status: &str| {
            Event::Put(EventData {
                key: format!("{ORG_STATUS_KEY_PREFIX}{org}"),
                value: Some(status.as_bytes().to_vec().into()),
                start_dt: None,
            })
        };
        for (org, status, calls) in [
            ("gone-hook-deleting", "deleting", vec![true]),
            ("gone-hook-deleted", "deleted", vec![true]),
            ("gone-hook-pending", "pending_deletion", vec![]),
            ("gone-hook-active", "active", vec![]),
        ] {
            apply_event(event(org, status)).await;
            ORG_STATUS_CACHE.remove(org);
            assert_eq!(gone_calls_for(org), calls, "{status}");
        }
    }
}
