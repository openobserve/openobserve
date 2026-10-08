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

//! Downtime rows and the per-node cache every send point reads synchronously.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, RwLock},
};

use common::meta::authz::Authz;
use config::meta::downtimes::Downtime;
use infra::{coordinator::downtimes as coordinator, table::downtimes as table};

/// `org -> rows`. Replaced whole per org, so a reader never sees a partial org.
static DOWNTIMES: LazyLock<RwLock<HashMap<String, Arc<Vec<Downtime>>>>> =
    LazyLock::new(Default::default);

/// Writes the row, tells this region's nodes, then the other regions.
pub async fn set(downtime: &Downtime) -> Result<(), anyhow::Error> {
    table::put(downtime).await?;
    coordinator::emit_put_event(&downtime.org, &downtime.id).await?;
    reload_org(&downtime.org).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_put(downtime).await;
    Ok(())
}

/// [set] for an edit: writes only if the stored row still has `expected_updated_at`.
pub async fn set_if_unchanged(
    downtime: &Downtime,
    expected_updated_at: i64,
) -> Result<bool, anyhow::Error> {
    if !table::put_if_unchanged(downtime, expected_updated_at).await? {
        return Ok(false);
    }
    coordinator::emit_put_event(&downtime.org, &downtime.id).await?;
    reload_org(&downtime.org).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_put(downtime).await;
    Ok(true)
}

pub async fn delete(org: &str, id: &str) -> Result<(), anyhow::Error> {
    table::delete(org, id).await?;
    coordinator::emit_delete_event(org, id).await?;
    remove_cached(org, id);
    #[cfg(feature = "enterprise")]
    super_cluster::emit_delete(org, id).await;
    Ok(())
}

/// Org deletion: every row, every node cache, every region and every OpenFGA tuple.
pub async fn delete_by_org(org: &str) -> Result<(), anyhow::Error> {
    let rows = table::list(org, None).await?;
    let ids = table::delete_by_org(org).await?;
    for id in &ids {
        coordinator::emit_delete_event(org, id).await?;
        #[cfg(feature = "enterprise")]
        super_cluster::emit_delete(org, id).await;
    }
    remove_org(org);
    for row in &rows {
        crate::authz::remove_ownership(org, "downtimes", ownership(row)).await;
    }
    Ok(())
}

/// Retention sweep for this region only; soft-deleted rows lost their tuple at delete time.
pub async fn delete_ended_before(cutoff: i64) -> Result<u64, anyhow::Error> {
    let ended = table::list_ended_before(cutoff).await?;
    let removed = table::delete_ended_before(cutoff).await?;
    // The listed rows carry the folder the OpenFGA tuple hangs off; the cache of this node
    // need not hold them (a fresh node, or the flag off here), so it is not the source.
    for row in &ended {
        coordinator::emit_delete_event(&row.org, &row.id).await?;
        crate::authz::remove_ownership(&row.org, "downtimes", ownership(row)).await;
        remove_cached(&row.org, &row.id);
    }
    Ok(removed)
}

/// Loads every row of every org, replacing the cache.
pub async fn cache() -> Result<(), anyhow::Error> {
    let mut by_org: HashMap<String, Vec<Downtime>> = HashMap::new();
    for downtime in table::list_all().await? {
        by_org
            .entry(downtime.org.clone())
            .or_default()
            .push(downtime);
    }
    let fresh = by_org
        .into_iter()
        .map(|(org, rows)| (org, Arc::new(rows)))
        .collect();
    *DOWNTIMES.write().unwrap_or_else(|e| e.into_inner()) = fresh;
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    coordinator::watch_events(on_put, on_delete).await
}

/// Writes the folder ownership tuple of every cached row in one batched write; rows created
/// before the RBAC fix lack it, and OpenFGA ignores a tuple that already exists, so a rerun
/// writes nothing new. The error of the write is returned, so the caller sets its done flag
/// only after every tuple landed.
#[cfg(feature = "enterprise")]
pub async fn backfill_ownership() -> Result<usize, anyhow::Error> {
    let tuples = ownership_backfill(&all_cached());
    let writes: Vec<_> = tuples
        .iter()
        .flat_map(|(org, authz)| crate::authz::ownership_tuples(org, "downtimes", authz))
        .collect();
    if !writes.is_empty() {
        o2_openfga::authorizer::authz::update_tuples(writes, vec![]).await?;
    }
    Ok(tuples.len())
}

#[cfg(not(feature = "enterprise"))]
pub async fn backfill_ownership() -> Result<usize, anyhow::Error> {
    Ok(ownership_backfill(&all_cached()).len())
}

/// The cached rows of an org; cheap to clone, never partial.
pub fn list_cached(org: &str) -> Arc<Vec<Downtime>> {
    DOWNTIMES
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(org)
        .cloned()
        .unwrap_or_default()
}

/// The OpenFGA object of a downtime, parented by its folder so folder grants reach it.
pub fn ownership(downtime: &Downtime) -> Authz {
    Authz {
        obj_id: downtime.id.clone(),
        parent_type: "downtime_folders".to_string(),
        parent: downtime.folder_id.clone(),
    }
}

/// Reloads one org from the table so the cache never holds half a row.
pub async fn reload_org(org: &str) -> Result<(), anyhow::Error> {
    let rows = table::list(org, None).await?;
    replace_org(org, rows);
    Ok(())
}

async fn on_put(org: String, _id: String) -> Result<(), anyhow::Error> {
    reload_org(&org).await
}

async fn on_delete(org: String, id: String) -> Result<(), anyhow::Error> {
    remove_cached(&org, &id);
    Ok(())
}

fn all_cached() -> Vec<Arc<Vec<Downtime>>> {
    DOWNTIMES
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .cloned()
        .collect()
}

/// `(org, tuple)` for every row, each parented by the folder it is filed in.
fn ownership_backfill(orgs: &[Arc<Vec<Downtime>>]) -> Vec<(String, Authz)> {
    orgs.iter()
        .flat_map(|rows| rows.iter())
        .map(|row| (row.org.clone(), ownership(row)))
        .collect()
}

fn replace_org(org: &str, rows: Vec<Downtime>) {
    let mut cache = DOWNTIMES.write().unwrap_or_else(|e| e.into_inner());
    if rows.is_empty() {
        cache.remove(org);
    } else {
        cache.insert(org.to_string(), Arc::new(rows));
    }
}

fn remove_cached(org: &str, id: &str) {
    let mut cache = DOWNTIMES.write().unwrap_or_else(|e| e.into_inner());
    let Some(rows) = cache.get(org) else {
        return;
    };
    if !rows.iter().any(|d| d.id == id) {
        return;
    }
    let kept: Vec<Downtime> = rows.iter().filter(|d| d.id != id).cloned().collect();
    if kept.is_empty() {
        cache.remove(org);
    } else {
        cache.insert(org.to_string(), Arc::new(kept));
    }
}

fn remove_org(org: &str) {
    DOWNTIMES
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .remove(org);
}

/// Best effort: the local write happened, and the next edit repairs a lost message (`put` upserts).
#[cfg(feature = "enterprise")]
mod super_cluster {
    use config::{get_config, meta::downtimes::Downtime};
    use o2_enterprise::enterprise::{
        common::config::get_config as get_o2_config, super_cluster::queue,
    };

    /// A region that is not upgraded cannot read byte 93, so nothing is sent until the flag is on.
    fn enabled() -> bool {
        let o2 = get_o2_config();
        o2.super_cluster.enabled && o2.downtimes.enabled && !get_config().common.local_mode
    }

    pub(super) async fn emit_put(downtime: &Downtime) {
        if !enabled() {
            return;
        }
        if let Err(e) = queue::downtimes_put(&downtime.org, downtime).await {
            log::error!(
                "[DOWNTIMES] super cluster put {}/{} failed: {e}",
                downtime.org,
                downtime.id
            );
        }
    }

    pub(super) async fn emit_delete(org: &str, id: &str) {
        if !enabled() {
            return;
        }
        if let Err(e) = queue::downtimes_delete(org, id).await {
            log::error!("[DOWNTIMES] super cluster delete {org}/{id} failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::downtimes::{DowntimeSchedule, Repeat};

    use super::*;

    fn downtime(org: &str, id: &str) -> Downtime {
        Downtime {
            id: id.to_string(),
            org: org.to_string(),
            folder_id: "default".to_string(),
            name: id.to_string(),
            reason: None,
            condition: None,
            targets: vec![],
            schedule: DowntimeSchedule {
                repeat: Repeat::None,
                starts_at: 1,
                ends_at: Some(2),
                timezone: "UTC".to_string(),
                start_time_local: None,
                duration_secs: 60,
                weekdays: vec![],
            },
            cancelled_at: None,
            cancelled_by: None,
            show_banner: true,
            created_by: "lin".to_string(),
            created_at: 1,
            updated_by: "lin".to_string(),
            updated_at: 1,
        }
    }

    fn ids(org: &str) -> Vec<String> {
        list_cached(org).iter().map(|d| d.id.clone()).collect()
    }

    #[test]
    fn a_reload_replaces_the_org_list_and_a_delete_removes_one_id() {
        let org = "db_downtimes_cache_test";
        replace_org(org, vec![downtime(org, "a"), downtime(org, "b")]);
        assert_eq!(ids(org), ["a", "b"]);

        replace_org(org, vec![downtime(org, "c")]);
        assert_eq!(ids(org), ["c"], "a reload replaces, never merges");

        replace_org(org, vec![downtime(org, "c"), downtime(org, "d")]);
        remove_cached(org, "c");
        assert_eq!(ids(org), ["d"]);
        remove_cached(org, "missing");
        assert_eq!(ids(org), ["d"]);

        remove_cached(org, "d");
        assert!(list_cached(org).is_empty());
    }

    #[test]
    fn remove_org_drops_every_row_of_that_org_only() {
        let (a, b) = ("db_downtimes_org_a", "db_downtimes_org_b");
        replace_org(a, vec![downtime(a, "x")]);
        replace_org(b, vec![downtime(b, "y")]);
        remove_org(a);
        assert!(list_cached(a).is_empty());
        assert_eq!(ids(b), ["y"]);
    }

    #[test]
    fn ownership_parents_the_downtime_by_its_folder_public_id() {
        let mut row = downtime("acme", "dt-1");
        row.folder_id = "payments".to_string();
        let owner = ownership(&row);
        assert_eq!(owner.obj_id, "dt-1");
        assert_eq!(owner.parent_type, "downtime_folders");
        assert_eq!(owner.parent, "payments");
    }

    #[test]
    fn the_ownership_backfill_covers_every_row_of_every_org_under_its_folder() {
        let mut moved = downtime("acme", "dt-2");
        moved.folder_id = "payments".to_string();
        let orgs = vec![
            Arc::new(vec![downtime("acme", "dt-1"), moved]),
            Arc::new(vec![downtime("beta", "dt-3")]),
        ];
        let tuples: Vec<(String, String, String)> = ownership_backfill(&orgs)
            .into_iter()
            .map(|(org, a)| (org, a.obj_id, a.parent))
            .collect();
        let expected = |org: &str, id: &str, folder: &str| {
            (org.to_string(), id.to_string(), folder.to_string())
        };
        assert_eq!(
            tuples,
            vec![
                expected("acme", "dt-1", "default"),
                expected("acme", "dt-2", "payments"),
                expected("beta", "dt-3", "default"),
            ]
        );
        assert!(ownership_backfill(&[]).is_empty());
    }
}
