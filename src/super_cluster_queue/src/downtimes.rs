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

use config::meta::{
    downtimes::Downtime,
    folder::{DEFAULT_FOLDER, Folder, FolderType},
};
use infra::{
    coordinator,
    errors::{Error, Result},
    table::{self, downtimes::RowVersion},
};
use o2_enterprise::enterprise::super_cluster::queue::{DowntimeMessage, Message};
use sea_orm::ConnectionTrait;

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

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg: DowntimeMessage = msg
        .try_into()
        .map_err(|e| Error::Message(format!("[DOWNTIMES] Failed to deserialize: {e}")))?;
    match msg {
        DowntimeMessage::Put { org, mut downtime } => {
            downtime.org = org;
            downtime.folder_id = local_folder_id(&downtime).await?;
            let client = infra::db::get_orm_client_rw().await;
            let Some(coverage_changed) = apply_put(client, &downtime).await? else {
                return Ok(());
            };
            coordinator::downtimes::emit_put_event(&downtime.org, &downtime.id).await?;
            if coverage_changed {
                forget_recorded_mutes(&downtime.id).await;
            }
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
            apply_delete(client, &org, &id, version, deleted_at).await?;
            coordinator::downtimes::emit_delete_event(&org, &id).await
        }
    }
}

/// A Delete that overtakes its Put leaves a tombstone, so the late Put cannot make the row live.
async fn apply_delete<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    version: i64,
    deleted_at: i64,
) -> Result<()> {
    if table::downtimes::delete_at_least_with(conn, org, id, version)
        .await?
        .is_some()
        || deleted_at <= 0
    {
        return Ok(());
    }
    let folder = table::folders::get_model(conn, org, DEFAULT_FOLDER, FolderType::Downtimes)
        .await?
        .ok_or_else(|| {
            Error::Message(format!(
                "[DOWNTIMES] no default downtime folder in {org} for the tombstone of {id}"
            ))
        })?;
    table::downtimes::insert_tombstone_with(conn, org, id, &folder.id, version, deleted_at).await?;
    // A Put that raced the insert and is older than this Delete is tombstoned as well.
    if let Some(stored) = table::downtimes::version_with(conn, org, id).await?
        && !stored.deleted
        && stored.version < version
    {
        table::downtimes::delete_at_least_with(conn, org, id, version).await?;
    }
    Ok(())
}

/// Writes the put unless the stored row is newer; `Some(coverage changed)` if it wrote.
async fn apply_put<C: ConnectionTrait>(conn: &C, downtime: &Downtime) -> Result<Option<bool>> {
    let stored = table::downtimes::version_with(conn, &downtime.org, &downtime.id).await?;
    // The queue neither orders nor deduplicates, so an older Put must not undo a newer edit.
    let order = stored.map_or(PutOrder::Apply, |stored| {
        put_order(stored, downtime.version, downtime.updated_at)
    });
    if let PutOrder::Conflict { apply } = order {
        log::warn!(
            "[DOWNTIMES] two regions wrote version {} of {}/{}; keeping the later updated_at ({})",
            downtime.version,
            downtime.org,
            downtime.id,
            if apply {
                "the incoming row"
            } else {
                "the stored row"
            }
        );
    }
    if !order.applies() {
        log::info!(
            "[DOWNTIMES] skipping a stale put of {}/{} (version {}, updated_at {} vs stored {:?})",
            downtime.org,
            downtime.id,
            downtime.version,
            downtime.updated_at,
            stored
        );
        return Ok(None);
    }
    let before = table::downtimes::get_with(conn, &downtime.org, &downtime.id).await?;
    let mut downtime = downtime.clone();
    if let Some(before) = &before {
        downtime.origin_region = before.origin_region.clone();
    }
    let coverage_changed = before.is_some_and(|before| !before.same_coverage(&downtime));
    table::downtimes::put_with(conn, &downtime).await?;
    Ok(Some(coverage_changed))
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

/// The same rule as the region that made the edit; a failure only delays the chip's correction.
async fn forget_recorded_mutes(id: &str) {
    if let Err(e) = table::alert_states::clear_last_downtime_id(id).await {
        log::warn!("[DOWNTIMES] could not clear the recorded mutes of {id}: {e}");
    }
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
    use config::meta::downtimes::{DowntimeSchedule, Repeat};
    use infra::table::entity::{downtimes as entity, folders};
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

    #[tokio::test]
    async fn a_redelivered_older_put_after_a_delete_writes_nothing() {
        let db = db().await;
        apply_put(&db, &downtime(10)).await.unwrap();
        table::downtimes::delete_with(&db, "acme", "d1")
            .await
            .unwrap();
        let tombstone = deleted_at(&db).await;

        assert_eq!(apply_put(&db, &downtime(10)).await.unwrap(), None);
        assert_eq!(apply_put(&db, &downtime(tombstone)).await.unwrap(), None);
        // An older version stays stale even with a clock ahead of the tombstone.
        assert_eq!(
            apply_put(&db, &downtime(tombstone + 1_000)).await.unwrap(),
            None
        );
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        assert_eq!(deleted_at(&db).await, tombstone);
    }

    #[tokio::test]
    async fn a_higher_version_after_a_delete_restores_the_row() {
        let db = db().await;
        apply_put(&db, &versioned(1, 10)).await.unwrap();
        table::downtimes::delete_with(&db, "acme", "d1")
            .await
            .unwrap();
        // The delete is version 2; a clock behind the tombstone does not matter.
        let older = versioned(1, deleted_at(&db).await + 1);
        assert_eq!(apply_put(&db, &older).await.unwrap(), None);
        let newer = versioned(3, 5);
        assert_eq!(apply_put(&db, &newer).await.unwrap(), Some(false));
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            Some(newer)
        );
    }

    #[tokio::test]
    async fn a_delete_that_overtakes_missed_updates_keeps_their_late_puts_out() {
        let db = db().await;
        // This region saw version 1 only; the deleting region wrote 2 and 3, then deleted at 4.
        apply_put(&db, &versioned(1, 10)).await.unwrap();
        let tombstone = table::downtimes::delete_at_least_with(&db, "acme", "d1", 4)
            .await
            .unwrap();
        assert_eq!(tombstone, Some(4));
        assert_eq!(apply_put(&db, &versioned(3, 30)).await.unwrap(), None);
        assert_eq!(apply_put(&db, &versioned(2, 20)).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        // A Delete from a region that predates the field (version 0) still bumps locally.
        apply_put(&db, &versioned(5, 50)).await.unwrap();
        assert_eq!(
            table::downtimes::delete_at_least_with(&db, "acme", "d1", 0)
                .await
                .unwrap(),
            Some(6)
        );
    }

    #[tokio::test]
    async fn a_newer_delete_raises_a_local_tombstone_so_late_puts_stay_out() {
        let db = db().await;
        // B deletes its version 1 locally while A edits through 3 and deletes at 4.
        apply_put(&db, &versioned(1, 10)).await.unwrap();
        assert_eq!(
            table::downtimes::delete_with(&db, "acme", "d1")
                .await
                .unwrap(),
            Some(2)
        );
        assert_eq!(
            table::downtimes::delete_at_least_with(&db, "acme", "d1", 4)
                .await
                .unwrap(),
            Some(4)
        );
        assert_eq!(apply_put(&db, &versioned(3, i64::MAX)).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_delete_before_its_put_leaves_no_live_row() {
        let db = db().await;
        apply_delete(&db, "acme", "d1", 2, 1_000).await.unwrap();
        assert_eq!(apply_put(&db, &versioned(1, 500)).await.unwrap(), None);
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        assert_eq!(deleted_at(&db).await, 1_000);
        // A later edit from another region still restores it, as with any tombstone.
        assert_eq!(
            apply_put(&db, &versioned(3, 2_000)).await.unwrap(),
            Some(false)
        );
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
        apply_put(&db, &versioned(2, 100)).await.unwrap();
        assert_eq!(apply_put(&db, &versioned(1, 500)).await.unwrap(), None);
        assert_eq!(
            apply_put(&db, &versioned(3, 50)).await.unwrap(),
            Some(false)
        );
        let stored = table::downtimes::get_with(&db, "acme", "d1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!((stored.version, stored.updated_at), (3, 50));
    }

    #[tokio::test]
    async fn equal_versions_from_two_regions_keep_the_later_updated_at() {
        let db = db().await;
        apply_put(&db, &versioned(2, 100)).await.unwrap();
        assert_eq!(apply_put(&db, &versioned(2, 90)).await.unwrap(), None);
        assert_eq!(
            apply_put(&db, &versioned(2, 110)).await.unwrap(),
            Some(false)
        );
        assert_eq!(
            apply_put(&db, &versioned(2, 110)).await.unwrap(),
            Some(false)
        );
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
        assert_eq!(apply_put(&db, &downtime(20)).await.unwrap(), Some(false));
        assert_eq!(apply_put(&db, &downtime(10)).await.unwrap(), None);
        assert_eq!(apply_put(&db, &downtime(20)).await.unwrap(), Some(false));
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
        apply_put(&db, &created).await.unwrap();

        let mut edited = downtime(20);
        edited.origin_region = Some("eu-west".to_string());
        apply_put(&db, &edited).await.unwrap();
        let stored = table::downtimes::get_with(&db, "acme", "d1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.origin_region.as_deref(), Some("us-east"));
        assert_eq!(stored.updated_at, 20);
    }
}
