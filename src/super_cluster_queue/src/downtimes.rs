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
        DowntimeMessage::Delete { org, id } => {
            table::downtimes::delete(&org, &id).await?;
            coordinator::downtimes::emit_delete_event(&org, &id).await
        }
    }
}

/// Writes the put unless the stored row is newer; `Some(coverage changed)` if it wrote.
async fn apply_put<C: ConnectionTrait>(conn: &C, downtime: &Downtime) -> Result<Option<bool>> {
    let stored = table::downtimes::version_with(conn, &downtime.org, &downtime.id).await?;
    // The queue neither orders nor deduplicates, so an older Put must not undo a newer edit.
    if stored.is_some_and(|stored| is_stale(stored, downtime.updated_at)) {
        log::info!(
            "[DOWNTIMES] skipping a stale put of {}/{} (updated_at {} vs stored {:?})",
            downtime.org,
            downtime.id,
            downtime.updated_at,
            stored
        );
        return Ok(None);
    }
    let before = table::downtimes::get_with(conn, &downtime.org, &downtime.id).await?;
    let coverage_changed = before.is_some_and(|before| !before.same_coverage(downtime));
    table::downtimes::put_with(conn, downtime).await?;
    Ok(Some(coverage_changed))
}

/// A soft-deleted row is the newest version until a strictly newer put arrives.
fn is_stale(stored: RowVersion, put_updated_at: i64) -> bool {
    if stored.deleted {
        stored.updated_at >= put_updated_at
    } else {
        stored.updated_at > put_updated_at
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
    let default = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: DEFAULT_FOLDER.to_owned(),
        description: DEFAULT_FOLDER.to_owned(),
        icon: None,
    };
    table::folders::get_or_create(&downtime.org, default, FolderType::Downtimes).await?;
    Ok(DEFAULT_FOLDER.to_owned())
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
            version: 0,
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
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            None
        );
        assert_eq!(deleted_at(&db).await, tombstone);
    }

    #[tokio::test]
    async fn a_newer_put_after_a_delete_restores_the_row() {
        let db = db().await;
        apply_put(&db, &downtime(10)).await.unwrap();
        table::downtimes::delete_with(&db, "acme", "d1")
            .await
            .unwrap();
        let newer = downtime(deleted_at(&db).await + 1);

        assert_eq!(apply_put(&db, &newer).await.unwrap(), Some(false));
        assert_eq!(
            table::downtimes::get_with(&db, "acme", "d1").await.unwrap(),
            Some(newer)
        );
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
}
