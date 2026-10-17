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
use infra::{
    coordinator::downtimes as coordinator,
    table::{
        downtimes::{self as table, Guard},
        slo_backfill_jobs::Remeasure,
    },
};
use sea_orm::ConnectionTrait;
#[cfg(feature = "enterprise")]
pub use super_cluster::replicates;

/// `org -> rows`. Replaced whole per org, so a reader never sees a partial org.
static DOWNTIMES: LazyLock<RwLock<HashMap<String, Arc<Vec<Downtime>>>>> =
    LazyLock::new(Default::default);

/// Writes the row with its SLO re-measures, tells this region's nodes, then the other regions.
pub async fn set(downtime: &Downtime, remeasures: &[Remeasure]) -> Result<(), anyhow::Error> {
    write(downtime, Guard::None, remeasures).await?;
    reload_org(&downtime.org).await?;
    Ok(())
}

/// [set] for an edit: writes only if the stored row still has `expected_updated_at`.
pub async fn set_if_unchanged(
    downtime: &Downtime,
    expected_updated_at: i64,
    remeasures: &[Remeasure],
) -> Result<bool, anyhow::Error> {
    if !write(downtime, Guard::Unchanged(expected_updated_at), remeasures).await? {
        return Ok(false);
    }
    reload_org(&downtime.org).await?;
    Ok(true)
}

/// [set_if_unchanged] without this node's reload, for a batch that calls [reload_org] once after.
pub async fn write_if_unchanged(
    downtime: &Downtime,
    expected_updated_at: i64,
) -> Result<bool, anyhow::Error> {
    write(downtime, Guard::Unchanged(expected_updated_at), &[]).await
}

/// [set] for a follow-up row, written only while `parent_id` still has `expected_updated_at`.
pub async fn set_if_parent_unchanged(
    downtime: &Downtime,
    parent_id: &str,
    expected_updated_at: i64,
    remeasures: &[Remeasure],
) -> Result<bool, anyhow::Error> {
    let guard = Guard::ParentUnchanged {
        parent_id,
        updated_at: expected_updated_at,
    };
    if !write(downtime, guard, remeasures).await? {
        return Ok(false);
    }
    reload_org(&downtime.org).await?;
    Ok(true)
}

/// [set_if_unchanged] for a live follow-up, with its parent bumped in the same transaction.
pub async fn set_follow_up_if_unchanged(
    downtime: &Downtime,
    expected_updated_at: i64,
    parent_id: &str,
    parent_updated_at: i64,
    remeasures: &[Remeasure],
) -> Result<bool, anyhow::Error> {
    let guard = Guard::FollowUpUnchanged {
        updated_at: expected_updated_at,
        parent_id,
        parent_updated_at,
    };
    if !write(downtime, guard, remeasures).await? {
        return Ok(false);
    }
    reload_org(&downtime.org).await?;
    replicate(&downtime.org, parent_id).await;
    Ok(true)
}

/// Sends the stored row to the other regions, for a write that changed it as a side effect.
pub async fn replicate(org: &str, id: &str) {
    #[cfg(feature = "enterprise")]
    super_cluster::emit_stored(org, id).await;
    #[cfg(not(feature = "enterprise"))]
    let _ = (org, id);
}

/// Deletes the row only while it is still at `stored`; false when another write moved it first.
pub async fn delete(org: &str, id: &str, stored: table::RowVersion) -> Result<bool, anyhow::Error> {
    let Some(tombstone) = table::delete_if_stored(org, id, stored).await? else {
        return Ok(false);
    };
    coordinator::emit_delete_event(org, id).await?;
    remove_cached(org, id);
    // Other regions order by the tombstone's own version and time, so both travel as written.
    #[cfg(feature = "enterprise")]
    super_cluster::emit_delete(org, id, tombstone.version, tombstone.updated_at).await;
    #[cfg(not(feature = "enterprise"))]
    let _ = tombstone;
    Ok(true)
}

/// Org deletion: every row, every node cache, every region and every OpenFGA tuple.
pub async fn delete_by_org(org: &str) -> Result<(), anyhow::Error> {
    let conn = infra::db::get_orm_client_ro().await;
    let rows = table::list_with(conn, org, None).await?;
    let ids = table::list_ids_by_org_with(conn, org).await?;
    // A retry lists no deleted row, so every side effect runs while the rows still exist.
    evict_org(org, &ids).await?;
    for row in &rows {
        crate::authz::remove_ownership(org, "downtimes", ownership(row)).await;
    }
    let removed = table::delete_by_org(org).await?;
    // The delete names each row the listing missed, whose tuple and copies go after it.
    let missed: Vec<(String, String)> = removed
        .iter()
        .filter(|(id, _)| !ids.contains(id))
        .cloned()
        .collect();
    for (id, folder_id) in &missed {
        let owned = Authz {
            obj_id: id.clone(),
            parent_type: "downtime_folders".to_string(),
            parent: folder_id.clone(),
        };
        crate::authz::remove_ownership(org, "downtimes", owned).await;
    }
    let missed: Vec<String> = missed.into_iter().map(|(id, _)| id).collect();
    evict_org(org, &missed).await?;
    let removed = removed.into_iter().map(|(id, _)| id).collect();
    // A cache reload before the delete can refill the caches, and no retry lists a deleted row.
    if let Err(e) = evict_org(org, &with_removed(ids, removed)).await {
        log::warn!("[DOWNTIMES] eviction of org {org} after the row delete failed: {e}");
    }
    Ok(())
}

/// Retention sweep for this region only; soft-deleted rows lost their tuple at delete time.
pub async fn delete_ended_before(cutoff: i64) -> Result<u64, anyhow::Error> {
    let ended = table::list_ended_before(cutoff).await?;
    let removed = table::delete_ended_before(cutoff).await?;
    // The listed rows, not this node's cache, carry the folder each OpenFGA tuple hangs off.
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

pub fn all_cached() -> Vec<Arc<Vec<Downtime>>> {
    DOWNTIMES
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .cloned()
        .collect()
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

/// [reload_org] through `conn`, so a caller can read the primary instead of a replica.
pub async fn reload_org_with<C: ConnectionTrait>(conn: &C, org: &str) -> Result<(), anyhow::Error> {
    let rows = table::list_with(conn, org, None).await?;
    replace_org(org, rows);
    Ok(())
}

/// The table write, then this region's nodes, then the other regions; false if `guard` failed.
async fn write(
    downtime: &Downtime,
    guard: Guard<'_>,
    remeasures: &[Remeasure],
) -> Result<bool, anyhow::Error> {
    if !table::write(downtime, guard, remeasures).await? {
        return Ok(false);
    }
    coordinator::emit_put_event(&downtime.org, &downtime.id).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_put(downtime).await;
    Ok(true)
}

async fn on_put(org: String, _id: String) -> Result<(), anyhow::Error> {
    reload_org(&org).await
}

async fn on_delete(org: String, id: String) -> Result<(), anyhow::Error> {
    remove_cached(&org, &id);
    Ok(())
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

/// Drops this node's rows of the org, then every node's and region's copy of each id.
async fn evict_org(org: &str, ids: &[String]) -> Result<(), anyhow::Error> {
    let local = async { remove_org(org) };
    let broadcast = async {
        for id in ids {
            coordinator::emit_delete_event(org, id).await?;
            // Org deletion removes the rows outright, so no region may keep a tombstone for them.
            #[cfg(feature = "enterprise")]
            super_cluster::emit_delete(org, id, 0, 0).await;
        }
        Ok::<(), anyhow::Error>(())
    };
    crate::teardown::evict(local, broadcast).await
}

/// The listed ids plus any the delete removed that were written after the listing.
fn with_removed(mut listed: Vec<String>, removed: Vec<String>) -> Vec<String> {
    for id in removed {
        if !listed.contains(&id) {
            listed.push(id);
        }
    }
    listed
}

/// Best effort: the local write happened, and the next edit repairs a lost message (`put` upserts).
#[cfg(feature = "enterprise")]
mod super_cluster {
    use config::{get_config, meta::downtimes::Downtime};
    use o2_enterprise::enterprise::{
        common::config::{O2Config, get_config as get_o2_config},
        super_cluster::queue,
    };

    /// A region without downtimes cannot read bytes 93 and 94, so sending waits for its own switch.
    pub fn replicates() -> bool {
        replicates_with(&get_o2_config(), get_config().common.local_mode)
    }

    pub(super) async fn emit_put(downtime: &Downtime) {
        if !replicates() {
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

    pub(super) async fn emit_stored(org: &str, id: &str) {
        if !replicates() {
            return;
        }
        match super::table::get_rw(org, id).await {
            Ok(Some(row)) => emit_put(&row).await,
            Ok(None) => {}
            Err(e) => log::error!("[DOWNTIMES] super cluster put {org}/{id} failed: {e}"),
        }
    }

    pub(super) async fn emit_delete(org: &str, id: &str, version: i64, deleted_at: i64) {
        if !replicates() {
            return;
        }
        if let Err(e) = queue::downtimes_delete(org, id, version, deleted_at).await {
            log::error!("[DOWNTIMES] super cluster delete {org}/{id} failed: {e}");
        }
    }

    pub(super) fn replicates_with(o2: &O2Config, local_mode: bool) -> bool {
        o2.super_cluster.enabled
            && o2.downtimes.enabled
            && o2.downtimes.replication_enabled
            && !local_mode
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
            notifications: None,
            origin_region: None,
            version: 0,
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

    #[test]
    fn the_post_delete_eviction_also_names_rows_written_after_the_listing() {
        let owned = |ids: &[&str]| ids.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        assert_eq!(
            with_removed(owned(&["a", "b"]), owned(&["b", "late", "a"])),
            ["a", "b", "late"]
        );
        assert_eq!(with_removed(owned(&["a"]), vec![]), ["a"]);
        assert_eq!(with_removed(vec![], owned(&["late"])), ["late"]);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_super_cluster_replicates_downtimes_only_with_its_own_switch_on() {
        let mut o2 = o2_enterprise::enterprise::common::config::O2Config::init().unwrap();
        o2.super_cluster.enabled = true;
        o2.downtimes.enabled = true;
        o2.downtimes.replication_enabled = false;
        assert!(
            !super_cluster::replicates_with(&o2, false),
            "a put, a delete, an un-mute and a downtime folder publish nothing"
        );
        o2.downtimes.replication_enabled = true;
        assert!(super_cluster::replicates_with(&o2, false));
        assert!(!super_cluster::replicates_with(&o2, true));
        o2.downtimes.enabled = false;
        assert!(!super_cluster::replicates_with(&o2, false));
        o2.downtimes.enabled = true;
        o2.super_cluster.enabled = false;
        assert!(!super_cluster::replicates_with(&o2, false));
    }
}
