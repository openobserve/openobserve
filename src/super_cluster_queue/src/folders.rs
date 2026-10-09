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

use config::meta::folder::{Folder, FolderType};
use infra::{errors::Result, table};
use o2_enterprise::enterprise::super_cluster::queue::{FolderMessage, Message};
use sea_orm::{ConnectionTrait, ModelTrait};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg = msg.try_into()?;
    process_msg(msg).await?;
    Ok(())
}

pub(crate) async fn process_msg(msg: FolderMessage) -> Result<()> {
    match msg {
        FolderMessage::Create {
            org_id,
            id,
            folder_id,
            folder_type,
            name,
            description,
        } => {
            table::folders::put(
                &org_id,
                Some(id),
                Folder {
                    folder_id,
                    name,
                    description: description.unwrap_or_default(),
                    // FolderMessage carries no icon yet — see the note in
                    // db::folders. A replicated folder arrives without one.
                    icon: None,
                },
                folder_type,
            )
            .await?;
        }
        FolderMessage::Update {
            org_id,
            folder_id,
            folder_type,
            name,
            description,
        } => {
            table::folders::put(
                &org_id,
                None,
                Folder {
                    folder_id,
                    name,
                    description: description.unwrap_or_default(),
                    // FolderMessage carries no icon yet — see the note in
                    // db::folders. A replicated folder arrives without one.
                    icon: None,
                },
                folder_type,
            )
            .await?;
        }
        FolderMessage::Delete {
            org_id,
            folder_id,
            folder_type,
        } => {
            let client = infra::db::get_orm_client_rw().await;
            delete_folder(client, &org_id, &folder_id, folder_type).await?;
        }
    };
    Ok(())
}

/// Downtime tombstones hold the folder's FK, so they go first; a live row keeps the folder here.
async fn delete_folder<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    folder_type: FolderType,
) -> Result<()> {
    let Some(model) = table::folders::get_model(conn, org_id, folder_id, folder_type).await? else {
        return Ok(());
    };
    if matches!(folder_type, FolderType::Downtimes)
        && !table::downtimes::release_folder_with(conn, org_id, &model.id).await?
    {
        log::warn!(
            "[FOLDERS] downtime folder {org_id}/{folder_id} still files a live downtime here; keeping it"
        );
        return Ok(());
    }
    model.delete(conn).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::downtimes::{Downtime, DowntimeSchedule, Repeat};
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
            id: Set("pk-ops".to_string()),
            org: Set("acme".to_string()),
            folder_id: Set("ops".to_string()),
            name: Set("ops".to_string()),
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

    fn downtime(id: &str) -> Downtime {
        Downtime {
            id: id.to_string(),
            org: "acme".to_string(),
            folder_id: "ops".to_string(),
            name: id.to_string(),
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
            updated_at: 1,
        }
    }

    async fn folder_exists(db: &DatabaseConnection) -> bool {
        table::folders::get_model(db, "acme", "ops", FolderType::Downtimes)
            .await
            .unwrap()
            .is_some()
    }

    #[tokio::test]
    async fn a_replicated_delete_of_a_folder_with_only_a_tombstone_succeeds() {
        let db = db().await;
        table::downtimes::put_with(&db, &downtime("d1"))
            .await
            .unwrap();
        table::downtimes::delete_with(&db, "acme", "d1")
            .await
            .unwrap();
        delete_folder(&db, "acme", "ops", FolderType::Downtimes)
            .await
            .unwrap();
        assert!(!folder_exists(&db).await);
        assert!(
            table::downtimes::version_with(&db, "acme", "d1")
                .await
                .unwrap()
                .is_some_and(|stored| stored.deleted),
            "the tombstone moves to the default folder"
        );
    }

    #[tokio::test]
    async fn a_replicated_delete_of_a_folder_with_a_live_row_is_acked_and_keeps_it() {
        let db = db().await;
        table::downtimes::put_with(&db, &downtime("d1"))
            .await
            .unwrap();
        delete_folder(&db, "acme", "ops", FolderType::Downtimes)
            .await
            .unwrap();
        assert!(folder_exists(&db).await);
        delete_folder(&db, "acme", "missing", FolderType::Downtimes)
            .await
            .unwrap();
    }
}
