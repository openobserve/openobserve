// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Applies downtime rows replicated from another region, so each region decides locally.

use config::{
    meta::{
        downtimes::Downtime,
        folder::{DEFAULT_FOLDER, Folder, FolderType},
    },
    utils::time::now_micros,
};
use infra::{
    coordinator,
    errors::{Error, Result},
    table::{self, downtimes::RowVersion},
};
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    super_cluster::queue::{DowntimeMessage, Message},
};
use openobserve_core::slo::corrections::{self, RemeasurePlan};
use sea_orm::{ConnectionTrait, TransactionTrait};

/// Compare-and-swap rounds before a replicated write gives up on a row that keeps changing.
const WRITE_ATTEMPTS: usize = 8;

/// The re-measure plan of a put, injected so a test plans against its own database.
type PlanFuture<'a> = std::pin::Pin<
    Box<dyn Future<Output = std::result::Result<RemeasurePlan, anyhow::Error>> + Send + 'a>,
>;

/// What an applied replicated Delete does next, not polled when the Delete is stale.
type AfterDelete<'a> = std::pin::Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;

/// How a replicated put orders against the stored row.
#[derive(Clone, Copy, Debug, PartialEq)]
enum PutOrder {
    Stale,
    Apply,
    /// The same version from two regions with different `updated_at`.
    Conflict {
        apply: bool,
    },
}

impl PutOrder {
    fn applies(self) -> bool {
        matches!(self, Self::Apply | Self::Conflict { apply: true })
    }
}

/// A put checked against the row it read; it writes only while that row is unchanged.
#[derive(Debug)]
struct PlannedPut {
    stored: Option<RowVersion>,
    /// The live row the put replaces, for the SLO re-measure.
    before: Option<Downtime>,
    downtime: Downtime,
    coverage_changed: bool,
}

/// A written put with the re-measures its transaction queued.
#[derive(Debug)]
struct WrittenPut {
    planned: PlannedPut,
    plan: RemeasurePlan,
}

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg: DowntimeMessage = msg
        .try_into()
        .map_err(|e| Error::Message(format!("[DOWNTIMES] Failed to deserialize: {e}")))?;
    apply(msg, get_o2_config().downtimes.enabled).await
}

/// With the flag off the message is acked unapplied, as the local routes refuse every write.
async fn apply(msg: DowntimeMessage, enabled: bool) -> Result<()> {
    if !enabled {
        log::debug!("[DOWNTIMES] downtimes are off here, skipping a replicated message");
        return Ok(());
    }
    match msg {
        DowntimeMessage::Put { org, mut downtime } => {
            downtime.org = org;
            downtime.folder_id = local_folder_id(&downtime).await?;
            let client = infra::db::get_orm_client_rw().await;
            let planner = |before: Option<Downtime>, after: Downtime| -> PlanFuture<'static> {
                Box::pin(async move {
                    corrections::plan_for_downtime(&after.org, before.as_ref(), &after).await
                })
            };
            let Some(written) = apply_put(client, &downtime, &planner).await? else {
                return Ok(());
            };
            // A redelivered Put sees no coverage change, so the mutes go before the emit.
            if written.planned.coverage_changed {
                openobserve_core::downtimes::forget_recorded_mutes(&downtime.org, &downtime.id)
                    .await;
            }
            coordinator::downtimes::emit_put_event(&downtime.org, &downtime.id).await?;
            written.plan.trigger(&written.planned.downtime.id).await;
            Ok(())
        }
        DowntimeMessage::Delete {
            org,
            id,
            version,
            deleted_at,
        } => {
            let client = infra::db::get_orm_client_rw().await;
            if deleted_at > 0
                && table::downtimes::version_with(client, &org, &id)
                    .await?
                    .is_none()
            {
                table::folders::get_or_create(&org, default_folder(), FolderType::Downtimes)
                    .await?;
            }
            // Mutes first: a failed emit is redelivered, and then the delete no longer applies.
            let after: AfterDelete<'_> = Box::pin(async {
                openobserve_core::downtimes::forget_recorded_mutes(&org, &id).await;
                coordinator::downtimes::emit_delete_event(&org, &id).await
            });
            apply_delete_message(client, &org, &id, version, deleted_at, after).await
        }
    }
}

/// Runs `after` only when the delete applied, as the local delete clears the mutes of its row.
async fn apply_delete_message<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    version: i64,
    deleted_at: i64,
    after: AfterDelete<'_>,
) -> Result<()> {
    if !apply_delete(conn, org, id, version, deleted_at).await? {
        return Ok(());
    }
    after.await
}

/// Tombstones at the Delete's own version and time unless the stored row is newer; true if written.
async fn apply_delete<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    version: i64,
    deleted_at: i64,
) -> Result<bool> {
    // An org deletion, or a region that predates the fields, sends no order, so it deletes locally.
    if version <= 0 || deleted_at <= 0 {
        return Ok(table::downtimes::delete_with(conn, org, id)
            .await?
            .is_some());
    }
    for _ in 0..WRITE_ATTEMPTS {
        let written = match table::downtimes::version_with(conn, org, id).await? {
            None => {
                let folder = default_folder_pk(conn, org, id).await?;
                table::downtimes::insert_tombstone_with(conn, org, id, &folder, version, deleted_at)
                    .await?
            }
            Some(stored) if !delete_applies(stored, version, deleted_at) => {
                log::info!(
                    "[DOWNTIMES] skipping a stale delete of {org}/{id} (version {version} vs stored {stored:?})"
                );
                return Ok(false);
            }
            Some(stored) => {
                table::downtimes::tombstone_if_stored_with(
                    conn, org, id, stored, version, deleted_at,
                )
                .await?
            }
        };
        if written {
            return Ok(true);
        }
    }
    Err(Error::Message(format!(
        "[DOWNTIMES] {org}/{id} kept changing during a replicated delete"
    )))
}

/// Writes the put with its re-measures unless the stored row is newer; `None` if it wrote none.
async fn apply_put<'a, C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    downtime: &Downtime,
    planner: &(dyn Fn(Option<Downtime>, Downtime) -> PlanFuture<'a> + Sync),
) -> Result<Option<WrittenPut>> {
    for _ in 0..WRITE_ATTEMPTS {
        let Some(planned) = plan_put(conn, downtime).await? else {
            return Ok(None);
        };
        let plan = remeasure_plan(&planned, planner).await?;
        if write_put(conn, &planned, &plan).await? {
            return Ok(Some(WrittenPut { planned, plan }));
        }
    }
    Err(Error::Message(format!(
        "[DOWNTIMES] {}/{} kept changing during a replicated put",
        downtime.org, downtime.id
    )))
}

/// Orders the put against the stored row; `None` if the stored row wins.
async fn plan_put<C: ConnectionTrait>(conn: &C, downtime: &Downtime) -> Result<Option<PlannedPut>> {
    let stored = table::downtimes::version_with(conn, &downtime.org, &downtime.id).await?;
    // The queue neither orders nor deduplicates, so an older Put must not undo a newer edit.
    let order = stored.map_or(PutOrder::Apply, |stored| {
        put_order(stored, downtime.version, downtime.updated_at)
    });
    log_order(order, downtime, stored);
    if !order.applies() {
        return Ok(None);
    }
    let before = table::downtimes::get_with(conn, &downtime.org, &downtime.id).await?;
    let mut downtime = downtime.clone();
    if let Some(before) = &before {
        downtime.origin_region = before.origin_region.clone();
    }
    let coverage_changed = before
        .as_ref()
        .is_some_and(|before| !before.same_coverage(&downtime));
    Ok(Some(PlannedPut {
        stored,
        before,
        downtime,
        coverage_changed,
    }))
}

/// One transaction, so a failed queue leaves the row as it was and the redelivery plans again.
async fn write_put<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    planned: &PlannedPut,
    plan: &RemeasurePlan,
) -> Result<bool> {
    let txn = conn.begin().await?;
    if !table::downtimes::put_if_stored_with(&txn, &planned.downtime, planned.stored).await? {
        txn.rollback().await?;
        return Ok(false);
    }
    table::slo_backfill_jobs::queue_remeasures(&txn, plan.jobs(), now_micros() / 1_000_000).await?;
    txn.commit().await?;
    Ok(true)
}

fn log_order(order: PutOrder, downtime: &Downtime, stored: Option<RowVersion>) {
    match order {
        PutOrder::Conflict { apply } => log::warn!(
            "[DOWNTIMES] two regions wrote version {} of {}/{}; keeping the later updated_at ({})",
            downtime.version,
            downtime.org,
            downtime.id,
            if apply {
                "the incoming row"
            } else {
                "the stored row"
            }
        ),
        PutOrder::Stale => log::info!(
            "[DOWNTIMES] skipping a stale put of {}/{} (version {}, updated_at {} vs stored {:?})",
            downtime.org,
            downtime.id,
            downtime.version,
            downtime.updated_at,
            stored
        ),
        PutOrder::Apply => {}
    }
}

/// Version first, since region clocks differ; equal versions from two regions fall to `updated_at`.
fn put_order(stored: RowVersion, version: i64, updated_at: i64) -> PutOrder {
    match version.cmp(&stored.version) {
        std::cmp::Ordering::Less => PutOrder::Stale,
        std::cmp::Ordering::Greater => PutOrder::Apply,
        std::cmp::Ordering::Equal => {
            // A tombstone wins a tie, so only a strictly later row restores it.
            let apply = if stored.deleted {
                updated_at > stored.updated_at
            } else {
                updated_at >= stored.updated_at
            };
            match (updated_at == stored.updated_at, apply) {
                (false, apply) => PutOrder::Conflict { apply },
                (true, true) => PutOrder::Apply,
                (true, false) => PutOrder::Stale,
            }
        }
    }
}

/// The mirror of [put_order]: a tombstone wins a tie unless the live row is strictly later.
fn delete_applies(stored: RowVersion, version: i64, deleted_at: i64) -> bool {
    match version.cmp(&stored.version) {
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Equal if stored.deleted => deleted_at > stored.updated_at,
        std::cmp::Ordering::Equal => deleted_at >= stored.updated_at,
    }
}

/// Slices and re-measure jobs are per region, so a replicated edit re-measures here as a save does.
async fn remeasure_plan<'a>(
    planned: &PlannedPut,
    planner: &(dyn Fn(Option<Downtime>, Downtime) -> PlanFuture<'a> + Sync),
) -> Result<RemeasurePlan> {
    let (before, after) = (planned.before.as_ref(), &planned.downtime);
    if !openobserve_core::downtimes::corrections_may_change(before, after) {
        return Ok(RemeasurePlan::default());
    }
    planner(before.cloned(), after.clone()).await.map_err(|e| {
        Error::Message(format!(
            "[DOWNTIMES] could not plan the SLO re-measure of {}/{}: {e}",
            after.org, after.id
        ))
    })
}

/// A row that arrives before its folder is filed in the default folder until its next edit.
async fn local_folder_id(downtime: &Downtime) -> Result<String> {
    if table::folders::get_pk_by_name(&downtime.org, &downtime.folder_id, FolderType::Downtimes)
        .await?
        .is_some()
    {
        return Ok(downtime.folder_id.clone());
    }
    log::warn!(
        "[DOWNTIMES] folder {} of downtime {}/{} is not in this region yet, filing it in the default folder",
        downtime.folder_id,
        downtime.org,
        downtime.id
    );
    table::folders::get_or_create(&downtime.org, default_folder(), FolderType::Downtimes).await?;
    Ok(DEFAULT_FOLDER.to_owned())
}

async fn default_folder_pk<C: ConnectionTrait>(conn: &C, org: &str, id: &str) -> Result<String> {
    let folder = table::folders::get_model(conn, org, DEFAULT_FOLDER, FolderType::Downtimes)
        .await?
        .ok_or_else(|| {
            Error::Message(format!(
                "[DOWNTIMES] no default downtime folder in {org} for the tombstone of {id}"
            ))
        })?;
    Ok(folder.id)
}

fn default_folder() -> Folder {
    Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: DEFAULT_FOLDER.to_owned(),
        description: DEFAULT_FOLDER.to_owned(),
        icon: None,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::meta::{
        downtimes::{DowntimeSchedule, DowntimeTarget, Repeat, TargetFolders, TargetModule},
        slo::{CountSource, SliConfig, Slo, SloDefinition, slice::Writer},
    };
    use infra::table::{
        entity::{downtimes as entity, folders, slo_backfill_jobs, slo_status},
        slo as slo_table,
    };
    use sea_orm::{Database, DatabaseConnection, EntityTrait, Schema, Set};

    use super::*;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(folders::Entity),
            schema.create_table_from_entity(entity::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        folders::Entity::insert(folders::ActiveModel {
            id: Set("pk-default".to_string()),
            org: Set("acme".to_string()),
            folder_id: Set("default".to_string()),
            name: Set("default".to_string()),
            description: Set(None),
            icon: Set(None),
            // The stored value of `FolderType::Downtimes`.
            r#type: Set(6),
        })
        .exec(&db)
        .await
        .unwrap();
        db
    }

    fn downtime(updated_at: i64) -> Downtime {
        versioned(0, updated_at)
    }

    fn versioned(version: i64, updated_at: i64) -> Downtime {
        Downtime {
            id: "d1".to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: format!("v{updated_at}"),
            reason: None,
            condition: None,
            targets: vec![],
            schedule: DowntimeSchedule {
                repeat: Repeat::Weekly,
                starts_at: 1,
                ends_at: None,
                timezone: "UTC".to_string(),
                start_time_local: Some("02:00".to_string()),
                duration_secs: 60,
                weekdays: vec![7],
            },
            cancelled_at: None,
            cancelled_by: None,
            show_banner: true,
            notifications: None,
            origin_region: None,
            version,
            created_by: "lin".to_string(),
            created_at: 1,
            updated_by: "lin".to_string(),
            updated_at,
        }
    }

    async fn deleted_at(db: &DatabaseConnection) -> i64 {
        let stored = entity::Entity::find_by_id("d1")
            .one(db)
            .await
            .unwrap()
            .unwrap();
        stored.deleted_at.expect("soft-deleted")
    }

    /// [apply_put] with nothing to re-measure, as `Some(coverage changed)` when it wrote.
    async fn put<C: ConnectionTrait + TransactionTrait>(
        conn: &C,
        downtime: &Downtime,
    ) -> Result<Option<bool>> {
        let planner = |_: Option<Downtime>, _: Downtime| -> PlanFuture<'static> {
            Box::pin(async { Ok(RemeasurePlan::default()) })
        };
        Ok(apply_put(conn, downtime, &planner)
            .await?
            .map(|written| written.planned.coverage_changed))
    }

    #[tokio::test]
    async fn a_redelivered_older_put_after_a_delete_writes_nothing() {
        let db = db().await;
        put(&db, &downtime(10)).await.unwrap();
        table::downtimes::delete_with(&db, "acme", "d1")
            .await
            .unwrap();
        let tombstone = deleted_at(&db).await;

        assert_eq!(put(&db, &downtime(10)).await.unwrap(), None);
        assert_eq!(put(&db, &downtime(tombstone)).await.unwrap(), None);
        // An older version stays stale even with a clock ahead of the tombstone.
        assert_eq!(put(&db, &downtime(tombstone + 1_000)).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        assert_eq!(deleted_at(&db).await, tombstone);
    }

    #[tokio::test]
    async fn a_higher_version_after_a_delete_restores_the_row() {
        let db = db().await;
        put(&db, &versioned(1, 10)).await.unwrap();
        table::downtimes::delete_with(&db, "acme", "d1")
            .await
            .unwrap();
        // The delete is version 2; a clock behind the tombstone does not matter.
        let older = versioned(1, deleted_at(&db).await + 1);
        assert_eq!(put(&db, &older).await.unwrap(), None);
        let newer = versioned(3, 5);
        assert_eq!(put(&db, &newer).await.unwrap(), Some(false));
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            Some(newer)
        );
    }

    #[tokio::test]
    async fn a_delete_that_overtakes_missed_updates_keeps_their_late_puts_out() {
        let db = db().await;
        // This region saw version 1 only; the deleting region wrote 2 and 3, then deleted at 4.
        put(&db, &versioned(1, 10)).await.unwrap();
        assert!(apply_delete(&db, "acme", "d1", 4, 40).await.unwrap());
        assert_eq!(put(&db, &versioned(3, 30)).await.unwrap(), None);
        assert_eq!(put(&db, &versioned(2, 20)).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        // A Delete from a region that predates the field (version 0) still bumps locally.
        put(&db, &versioned(5, 50)).await.unwrap();
        assert!(apply_delete(&db, "acme", "d1", 0, 0).await.unwrap());
        let stored = table::downtimes::version_with(&db, "acme", "d1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!((stored.version, stored.deleted), (6, true));
    }

    #[tokio::test]
    async fn a_newer_delete_raises_a_local_tombstone_so_late_puts_stay_out() {
        let db = db().await;
        // B deletes its version 1 locally while A edits through 3 and deletes at 4.
        put(&db, &versioned(1, 10)).await.unwrap();
        assert_eq!(
            table::downtimes::delete_with(&db, "acme", "d1")
                .await
                .unwrap()
                .map(|t| t.version),
            Some(2)
        );
        assert!(apply_delete(&db, "acme", "d1", 4, 40).await.unwrap());
        assert_eq!(put(&db, &versioned(3, i64::MAX)).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_delete_before_its_put_leaves_no_live_row() {
        let db = db().await;
        apply_delete(&db, "acme", "d1", 2, 1_000).await.unwrap();
        assert_eq!(put(&db, &versioned(1, 500)).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        assert_eq!(deleted_at(&db).await, 1_000);
        // A later edit from another region still restores it, as with any tombstone.
        assert_eq!(put(&db, &versioned(3, 2_000)).await.unwrap(), Some(false));
    }

    #[tokio::test]
    async fn a_delete_without_deleted_at_leaves_a_missing_row_missing() {
        let db = db().await;
        apply_delete(&db, "acme", "d1", 0, 0).await.unwrap();
        assert_eq!(
            table::downtimes::version_with(&db, "acme", "d1")
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_higher_version_wins_whatever_its_clock_says() {
        let db = db().await;
        put(&db, &versioned(2, 100)).await.unwrap();
        assert_eq!(put(&db, &versioned(1, 500)).await.unwrap(), None);
        assert_eq!(put(&db, &versioned(3, 50)).await.unwrap(), Some(false));
        let stored = table::downtimes::get_with(&db, "acme", "d1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!((stored.version, stored.updated_at), (3, 50));
    }

    #[tokio::test]
    async fn equal_versions_from_two_regions_keep_the_later_updated_at() {
        let db = db().await;
        put(&db, &versioned(2, 100)).await.unwrap();
        assert_eq!(put(&db, &versioned(2, 90)).await.unwrap(), None);
        assert_eq!(put(&db, &versioned(2, 110)).await.unwrap(), Some(false));
        assert_eq!(put(&db, &versioned(2, 110)).await.unwrap(), Some(false));
        let stored = table::downtimes::get_with(&db, "acme", "d1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.updated_at, 110);
    }

    #[test]
    fn put_order_reads_the_version_then_the_clock() {
        let live = |version, updated_at| RowVersion {
            version,
            updated_at,
            deleted: false,
        };
        assert_eq!(put_order(live(2, 100), 1, 900), PutOrder::Stale);
        assert_eq!(put_order(live(2, 100), 3, 1), PutOrder::Apply);
        assert_eq!(put_order(live(2, 100), 2, 100), PutOrder::Apply);
        assert_eq!(
            put_order(live(2, 100), 2, 101),
            PutOrder::Conflict { apply: true }
        );
        assert_eq!(
            put_order(live(2, 100), 2, 99),
            PutOrder::Conflict { apply: false }
        );
        let tombstone = RowVersion {
            deleted: true,
            ..live(2, 100)
        };
        assert_eq!(put_order(tombstone, 2, 100), PutOrder::Stale);
    }

    #[tokio::test]
    async fn an_older_put_never_reverts_a_newer_live_row() {
        let db = db().await;
        assert_eq!(put(&db, &downtime(20)).await.unwrap(), Some(false));
        assert_eq!(put(&db, &downtime(10)).await.unwrap(), None);
        assert_eq!(put(&db, &downtime(20)).await.unwrap(), Some(false));
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1")
                .await
                .unwrap()
                .map(|d| d.updated_at),
            Some(20)
        );
    }

    #[tokio::test]
    async fn a_put_from_another_region_keeps_the_origin_region() {
        let db = db().await;
        let mut created = downtime(10);
        created.origin_region = Some("us-east".to_string());
        put(&db, &created).await.unwrap();

        let mut edited = downtime(20);
        edited.origin_region = Some("eu-west".to_string());
        put(&db, &edited).await.unwrap();
        let stored = table::downtimes::get_with(&db, "acme", "d1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.origin_region.as_deref(), Some("us-east"));
        assert_eq!(stored.updated_at, 20);
    }

    #[tokio::test]
    async fn a_redelivered_delete_after_a_restoring_put_leaves_the_row_live() {
        let db = db().await;
        put(&db, &versioned(1, 10)).await.unwrap();
        assert!(apply_delete(&db, "acme", "d1", 2, 20).await.unwrap());
        let restored = versioned(3, 30);
        assert_eq!(put(&db, &restored).await.unwrap(), Some(false));

        assert!(!apply_delete(&db, "acme", "d1", 2, 20).await.unwrap());
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            Some(restored)
        );
    }

    #[tokio::test]
    async fn a_replicated_delete_keeps_its_own_version_and_time() {
        let db = db().await;
        put(&db, &versioned(1, 10)).await.unwrap();
        assert!(apply_delete(&db, "acme", "d1", 4, 5_000).await.unwrap());
        let tombstone = RowVersion {
            version: 4,
            updated_at: 5_000,
            deleted: true,
        };
        assert_eq!(
            table::downtimes::version_with(&db, "acme", "d1")
                .await
                .unwrap(),
            Some(tombstone)
        );
        // A redelivery, and an older Delete, leave the tombstone as it is.
        assert!(!apply_delete(&db, "acme", "d1", 4, 5_000).await.unwrap());
        assert!(!apply_delete(&db, "acme", "d1", 3, 9_000).await.unwrap());
        assert_eq!(
            table::downtimes::version_with(&db, "acme", "d1")
                .await
                .unwrap(),
            Some(tombstone)
        );
    }

    #[tokio::test]
    async fn a_local_delete_between_the_read_and_the_write_of_a_put_stands() {
        let db = db().await;
        put(&db, &versioned(1, 10)).await.unwrap();
        let incoming = versioned(2, 20);
        let planned = plan_put(&db, &incoming).await.unwrap().unwrap();

        table::downtimes::delete_with(&db, "acme", "d1")
            .await
            .unwrap();
        assert!(
            !write_put(&db, &planned, &RemeasurePlan::default())
                .await
                .unwrap()
        );
        // The local tombstone is version 2 too, and it is later, so the put is stale on its retry.
        assert_eq!(put(&db, &incoming).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_local_edit_between_the_read_and_the_write_of_a_put_stands() {
        let db = db().await;
        put(&db, &versioned(1, 10)).await.unwrap();
        let incoming = versioned(2, 20);
        let planned = plan_put(&db, &incoming).await.unwrap().unwrap();

        let mut local = versioned(3, 30);
        local.name = "local edit".to_string();
        assert!(
            table::downtimes::put_if_unchanged_with(&db, &local, 10)
                .await
                .unwrap()
        );
        assert!(
            !write_put(&db, &planned, &RemeasurePlan::default())
                .await
                .unwrap()
        );
        assert_eq!(put(&db, &incoming).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            Some(local)
        );
    }

    #[tokio::test]
    async fn a_put_planned_against_a_missing_row_loses_to_a_delete_that_lands_first() {
        let db = db().await;
        let incoming = versioned(1, 10);
        let planned = plan_put(&db, &incoming).await.unwrap().unwrap();

        assert!(apply_delete(&db, "acme", "d1", 2, 20).await.unwrap());
        assert!(
            !write_put(&db, &planned, &RemeasurePlan::default())
                .await
                .unwrap()
        );
        assert_eq!(put(&db, &incoming).await.unwrap(), None);
        assert_eq!(deleted_at(&db).await, 20);
    }

    #[test]
    fn delete_applies_mirrors_the_put_order() {
        let row = |version, updated_at, deleted| RowVersion {
            version,
            updated_at,
            deleted,
        };
        assert!(!delete_applies(row(3, 100, false), 2, 900));
        assert!(delete_applies(row(3, 100, false), 4, 1));
        // A tie keeps whichever is later, the tombstone on equal times, as put_order does.
        assert!(delete_applies(row(2, 100, false), 2, 100));
        assert!(!delete_applies(row(2, 100, false), 2, 99));
        assert!(!delete_applies(row(2, 100, true), 2, 100));
        assert!(delete_applies(row(2, 100, true), 2, 101));
        for (stored_at, incoming_at) in [(100, 99), (100, 100), (100, 101)] {
            let live_after_delete = !delete_applies(row(2, stored_at, false), 2, incoming_at);
            let live_after_put = put_order(row(2, incoming_at, true), 2, stored_at).applies();
            assert_eq!(live_after_delete, live_after_put);
        }
    }

    #[tokio::test]
    async fn a_put_at_the_version_of_a_tombstone_moved_by_a_folder_delete_is_skipped() {
        let db = db().await;
        folders::Entity::insert(folders::ActiveModel {
            id: Set("pk-ops".to_string()),
            org: Set("acme".to_string()),
            folder_id: Set("ops".to_string()),
            name: Set("ops".to_string()),
            description: Set(None),
            icon: Set(None),
            r#type: Set(6),
        })
        .exec(&db)
        .await
        .unwrap();
        let mut row = versioned(1, 10);
        row.folder_id = "ops".to_string();
        put(&db, &row).await.unwrap();
        assert!(apply_delete(&db, "acme", "d1", 2, 20).await.unwrap());
        assert!(
            table::downtimes::release_folder_with(&db, "acme", "pk-ops")
                .await
                .unwrap()
        );

        let late = Downtime {
            folder_id: DEFAULT_FOLDER.to_string(),
            ..versioned(2, 20)
        };
        assert_eq!(put(&db, &late).await.unwrap(), None);
        assert!(
            table::downtimes::version_with(&db, "acme", "d1")
                .await
                .unwrap()
                .is_some_and(|stored| stored.deleted)
        );
    }

    const HOUR_SECS: i64 = 3_600;

    /// The SLO `s1` measured up to 20:00 with the tables a re-measure writes.
    async fn slo_db() -> (DatabaseConnection, Vec<(Slo, HashMap<String, String>)>) {
        let db = db().await;
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(slo_backfill_jobs::Entity),
            schema.create_table_from_entity(slo_status::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        slo_table::init_generation(&db, "s1", 1).await.unwrap();
        slo_table::apply_status(
            &db,
            &slo_table::StatusWrite {
                slo_id: "s1".to_string(),
                definition_generation: 1,
                writer: Writer::Incremental,
                deltas: vec![],
                watermark_end: Some(20 * HOUR_SECS),
                trailing_slices: None,
                burn_windows: None,
                computed_at: 20 * HOUR_SECS,
            },
        )
        .await
        .unwrap();
        let slo = Slo {
            id: "s1".to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: "s1".to_string(),
            description: String::new(),
            definition: SloDefinition {
                sli_config: SliConfig::Count {
                    source: CountSource::SingleQuery {
                        stream: "requests".to_string(),
                        stream_type: "logs".to_string(),
                        scope: None,
                        good_expr: "status < 500".to_string(),
                    },
                },
                group_by: None,
                window_secs: 86_400,
                slice_interval_secs: 300,
            },
            target: 99.9,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 1,
        };
        (db, vec![(slo, HashMap::new())])
    }

    /// A one-hour window from 10:00 over every SLO.
    fn slo_downtime() -> Downtime {
        Downtime {
            targets: vec![DowntimeTarget {
                module: TargetModule::Slos,
                folders: TargetFolders::All,
                tags: vec![],
                ids: vec![],
                slo_mode: None,
                incident_mode: Default::default(),
            }],
            schedule: DowntimeSchedule {
                repeat: Repeat::None,
                starts_at: 10 * HOUR_SECS * 1_000_000,
                ends_at: Some(11 * HOUR_SECS * 1_000_000),
                timezone: "UTC".to_string(),
                start_time_local: None,
                duration_secs: HOUR_SECS,
                weekdays: vec![],
            },
            ..versioned(1, 10)
        }
    }

    /// The planner of a region whose SLOs are `slos`, reading their slices from `db`.
    fn planner_over<'a>(
        db: &'a DatabaseConnection,
        slos: &'a [(Slo, HashMap<String, String>)],
    ) -> impl Fn(Option<Downtime>, Downtime) -> PlanFuture<'a> + Sync + 'a {
        move |before, after| {
            Box::pin(async move {
                corrections::plan_remeasures(db, slos, before.as_ref(), &after).await
            })
        }
    }

    async fn jobs(db: &DatabaseConnection) -> Vec<slo_backfill_jobs::Model> {
        slo_backfill_jobs::Entity::find().all(db).await.unwrap()
    }

    #[tokio::test]
    async fn a_replicated_put_that_covers_an_slo_queues_its_re_measure_with_the_row() {
        let (db, slos) = slo_db().await;
        let replicated = slo_downtime();
        let planner = planner_over(&db, &slos);
        let written = apply_put(&db, &replicated, &planner)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(written.plan.jobs().len(), 1);

        // A rename of the stored row moves no window, so it plans nothing.
        let renamed = Downtime {
            name: "renamed".to_string(),
            version: 2,
            updated_at: 20,
            ..replicated.clone()
        };
        let planned_again = std::sync::atomic::AtomicBool::new(false);
        let planner = |_: Option<Downtime>, _: Downtime| -> PlanFuture<'_> {
            planned_again.store(true, std::sync::atomic::Ordering::Relaxed);
            Box::pin(async { Ok(RemeasurePlan::default()) })
        };
        let written = apply_put(&db, &renamed, &planner).await.unwrap().unwrap();
        assert!(written.planned.before.is_some());
        assert!(!planned_again.load(std::sync::atomic::Ordering::Relaxed));

        let jobs = jobs(&db).await;
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].kind, table::slo_backfill_jobs::KIND_REMEASURE);
        assert_eq!(
            (jobs[0].range_start, jobs[0].range_end),
            (10 * HOUR_SECS, 11 * HOUR_SECS)
        );
    }

    #[tokio::test]
    async fn a_put_whose_re_measure_cannot_be_queued_writes_no_row_and_its_redelivery_does() {
        let (db, slos) = slo_db().await;
        db.execute_unprepared(
            "CREATE TRIGGER refuse_jobs BEFORE INSERT ON slo_backfill_jobs \
             BEGIN SELECT RAISE(ABORT, 'refused'); END",
        )
        .await
        .unwrap();
        let replicated = slo_downtime();
        let planner = planner_over(&db, &slos);
        assert!(apply_put(&db, &replicated, &planner).await.is_err());
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        assert!(jobs(&db).await.is_empty());

        db.execute_unprepared("DROP TRIGGER refuse_jobs")
            .await
            .unwrap();
        let planner = planner_over(&db, &slos);
        assert!(
            apply_put(&db, &replicated, &planner)
                .await
                .unwrap()
                .is_some()
        );
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            Some(replicated)
        );
        assert_eq!(jobs(&db).await.len(), 1);
    }

    #[tokio::test]
    async fn a_put_whose_plan_fails_writes_no_row() {
        let db = db().await;
        let planner = |_: Option<Downtime>, _: Downtime| -> PlanFuture<'static> {
            Box::pin(async { Err(anyhow::anyhow!("SLO list unreadable")) })
        };
        assert!(apply_put(&db, &slo_downtime(), &planner).await.is_err());
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_replicated_delete_clears_the_mutes_recorded_under_the_row() {
        use infra::table::{alert_states, entity::alert_states as states};

        let db = db().await;
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(states::Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        put(&db, &versioned(1, 10)).await.unwrap();
        alert_states::set_last_downtime_id_with(&db, "alert-1", Some("d1"))
            .await
            .unwrap();
        let ids = vec!["alert-1".to_string()];

        // A stale Delete applies nothing, so it clears nothing.
        let forget = || -> AfterDelete<'_> {
            Box::pin(async {
                alert_states::clear_last_downtime_id_with(&db, "d1").await?;
                Ok(())
            })
        };
        apply_delete_message(&db, "acme", "d1", 1, 5, forget())
            .await
            .unwrap();
        assert_eq!(
            alert_states::last_downtime_ids_with(&db, &ids)
                .await
                .unwrap()
                .get("alert-1")
                .map(String::as_str),
            Some("d1")
        );

        apply_delete_message(&db, "acme", "d1", 2, 20, forget())
            .await
            .unwrap();
        assert!(
            alert_states::last_downtime_ids_with(&db, &ids)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn with_downtimes_off_a_replicated_put_writes_nothing() {
        // The flag is checked first; with it on, the folder lookup would need the region database.
        let msg = DowntimeMessage::Put {
            org: "acme".to_string(),
            downtime: Box::new(slo_downtime()),
        };
        apply(msg, false).await.unwrap();
        let delete = DowntimeMessage::Delete {
            org: "acme".to_string(),
            id: "d1".to_string(),
            version: 2,
            deleted_at: 20,
        };
        apply(delete, false).await.unwrap();
    }
}
