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

//! Downtimes table operations; rows store the folder key, [Downtime] carries the public id.

use std::collections::HashMap;

use config::meta::{
    downtimes::{Downtime, DowntimeSchedule, Repeat},
    folder::FolderType,
};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    Set,
    sea_query::{Expr, OnConflict},
};
use svix_ksuid::KsuidLike;

use super::{
    entity::{
        downtimes::{ActiveModel, Column, Entity, Model},
        folders,
    },
    folders::{folder_type_into_i16, get_model as get_folder_model},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, Error},
};

/// A fresh downtime id.
pub fn new_id() -> String {
    svix_ksuid::Ksuid::new(None, None).to_string()
}

pub async fn list(org: &str, folder_id: Option<&str>) -> Result<Vec<Downtime>, errors::Error> {
    let client = get_orm_client_ro().await;
    list_with(client, org, folder_id).await
}

pub async fn list_all() -> Result<Vec<Downtime>, errors::Error> {
    let client = get_orm_client_ro().await;
    list_all_with(client).await
}

pub async fn get(org: &str, id: &str) -> Result<Option<Downtime>, errors::Error> {
    let client = get_orm_client_ro().await;
    get_with(client, org, id).await
}

/// Upsert on `id`, so the local write and the super-cluster consumer share one path.
pub async fn put(downtime: &Downtime) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    put_with(client, downtime).await
}

pub async fn delete(org: &str, id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    delete_with(client, org, id).await
}

/// Deletes ended one-time and bounded recurring rows, and cancelled rows, older than `cutoff`.
pub async fn delete_ended_before(cutoff: i64) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_ended_before_with(client, cutoff).await
}

/// `(org, id)` of the rows [delete_ended_before] removes, for the cache and coordinator.
pub async fn list_ended_before(cutoff: i64) -> Result<Vec<(String, String)>, errors::Error> {
    let client = get_orm_client_ro().await;
    list_ended_before_with(client, cutoff).await
}

pub async fn move_to_folder(
    org: &str,
    ids: &[String],
    dst_folder_id: &str,
) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    move_to_folder_with(client, org, ids, dst_folder_id).await
}

/// Rows filed in the folder with this primary key; guards folder deletion.
pub async fn count_by_folder(org: &str, folder_pk: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_ro().await;
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::FolderId.eq(folder_pk))
        .count(client)
        .await?)
}

/// Removes every row of an org and returns the removed ids.
pub async fn delete_by_org(org: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_org_with(client, org).await
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    folder_id: Option<&str>,
) -> Result<Vec<Downtime>, errors::Error> {
    let mut query = Entity::find().filter(Column::Org.eq(org));
    if let Some(folder_id) = folder_id {
        let Some(folder) = get_folder_model(conn, org, folder_id, FolderType::Downtimes).await?
        else {
            return Ok(vec![]);
        };
        query = query.filter(Column::FolderId.eq(folder.id));
    }
    let models = query.order_by_desc(Column::StartsAt).all(conn).await?;
    into_downtimes(conn, models).await
}

pub async fn list_all_with<C: ConnectionTrait>(conn: &C) -> Result<Vec<Downtime>, errors::Error> {
    let models = Entity::find().all(conn).await?;
    into_downtimes(conn, models).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<Downtime>, errors::Error> {
    let Some(model) = Entity::find_by_id(id)
        .filter(Column::Org.eq(org))
        .one(conn)
        .await?
    else {
        return Ok(None);
    };
    Ok(into_downtimes(conn, vec![model]).await?.pop())
}

pub async fn put_with<C: ConnectionTrait>(
    conn: &C,
    downtime: &Downtime,
) -> Result<(), errors::Error> {
    let folder = get_folder_model(
        conn,
        &downtime.org,
        &downtime.folder_id,
        FolderType::Downtimes,
    )
    .await?
    .ok_or_else(|| {
        Error::Message(format!(
            "downtime folder {} not found in org {}",
            downtime.folder_id, downtime.org
        ))
    })?;
    Entity::insert(to_active_model(downtime, folder.id)?)
        .on_conflict(
            OnConflict::column(Column::Id)
                .update_columns([
                    Column::Org,
                    Column::FolderId,
                    Column::Name,
                    Column::Reason,
                    Column::Condition,
                    Column::Targets,
                    Column::ShowBanner,
                    Column::Repeat,
                    Column::StartsAt,
                    Column::EndsAt,
                    Column::Timezone,
                    Column::StartTimeLocal,
                    Column::DurationSecs,
                    Column::Weekdays,
                    Column::CancelledAt,
                    Column::CancelledBy,
                    Column::CreatedBy,
                    Column::CreatedAt,
                    Column::UpdatedBy,
                    Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_ended_before_with<C: ConnectionTrait>(
    conn: &C,
    cutoff: i64,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(ended_before(cutoff))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn list_ended_before_with<C: ConnectionTrait>(
    conn: &C,
    cutoff: i64,
) -> Result<Vec<(String, String)>, errors::Error> {
    Ok(Entity::find()
        .filter(ended_before(cutoff))
        .all(conn)
        .await?
        .into_iter()
        .map(|m| (m.org, m.id))
        .collect())
}

pub async fn move_to_folder_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    ids: &[String],
    dst_folder_id: &str,
) -> Result<u64, errors::Error> {
    if ids.is_empty() {
        return Ok(0);
    }
    let folder = get_folder_model(conn, org, dst_folder_id, FolderType::Downtimes)
        .await?
        .ok_or_else(|| Error::Message(format!("downtime folder {dst_folder_id} not found")))?;
    let res = Entity::update_many()
        .col_expr(Column::FolderId, Expr::value(folder.id))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .filter(Column::Org.eq(org))
        .filter(Column::Id.is_in(ids.to_vec()))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Vec<String>, errors::Error> {
    let ids: Vec<String> = Entity::find()
        .filter(Column::Org.eq(org))
        .all(conn)
        .await?
        .into_iter()
        .map(|m| m.id)
        .collect();
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(conn)
        .await?;
    Ok(ids)
}

/// Open-ended recurring rows have no `ends_at`, so they never match.
fn ended_before(cutoff: i64) -> Condition {
    Condition::any()
        .add(Column::EndsAt.lt(cutoff))
        .add(Column::CancelledAt.lt(cutoff))
}

fn to_active_model(d: &Downtime, folder_pk: String) -> Result<ActiveModel, errors::Error> {
    Ok(ActiveModel {
        id: Set(d.id.clone()),
        org: Set(d.org.clone()),
        folder_id: Set(folder_pk),
        name: Set(d.name.clone()),
        reason: Set(d.reason.clone()),
        condition: Set(d.condition.as_ref().map(serde_json::to_value).transpose()?),
        targets: Set(serde_json::to_value(&d.targets)?),
        show_banner: Set(d.show_banner),
        repeat: Set(d.schedule.repeat.to_i16()),
        starts_at: Set(d.schedule.starts_at),
        ends_at: Set(d.schedule.ends_at),
        timezone: Set(d.schedule.timezone.clone()),
        start_time_local: Set(d.schedule.start_time_local.clone()),
        duration_secs: Set(d.schedule.duration_secs),
        weekdays: Set(Some(serde_json::to_value(&d.schedule.weekdays)?)),
        cancelled_at: Set(d.cancelled_at),
        cancelled_by: Set(d.cancelled_by.clone()),
        created_by: Set(d.created_by.clone()),
        created_at: Set(d.created_at),
        updated_by: Set(d.updated_by.clone()),
        updated_at: Set(d.updated_at),
    })
}

fn from_model(m: Model, folder_id: String) -> Result<Downtime, errors::Error> {
    let repeat = Repeat::from_i16(m.repeat).ok_or_else(|| {
        Error::Message(format!("downtime {} has unknown repeat {}", m.id, m.repeat))
    })?;
    Ok(Downtime {
        condition: m.condition.map(serde_json::from_value).transpose()?,
        targets: serde_json::from_value(m.targets)?,
        schedule: DowntimeSchedule {
            repeat,
            starts_at: m.starts_at,
            ends_at: m.ends_at,
            timezone: m.timezone,
            start_time_local: m.start_time_local,
            duration_secs: m.duration_secs,
            weekdays: m
                .weekdays
                .map(serde_json::from_value)
                .transpose()?
                .unwrap_or_default(),
        },
        id: m.id,
        org: m.org,
        folder_id,
        name: m.name,
        reason: m.reason,
        cancelled_at: m.cancelled_at,
        cancelled_by: m.cancelled_by,
        show_banner: m.show_banner,
        created_by: m.created_by,
        created_at: m.created_at,
        updated_by: m.updated_by,
        updated_at: m.updated_at,
    })
}

/// A row that no longer parses is logged and skipped, so one bad row cannot hide the others.
async fn into_downtimes<C: ConnectionTrait>(
    conn: &C,
    models: Vec<Model>,
) -> Result<Vec<Downtime>, errors::Error> {
    let slugs = folder_slugs(conn, &models).await?;
    Ok(models
        .into_iter()
        .filter_map(|m| {
            let folder_id = slugs
                .get(&m.folder_id)
                .cloned()
                .unwrap_or_else(|| m.folder_id.clone());
            let id = m.id.clone();
            from_model(m, folder_id)
                .inspect_err(|e| log::warn!("[DOWNTIMES] skipping unreadable row {id}: {e}"))
                .ok()
        })
        .collect())
}

async fn folder_slugs<C: ConnectionTrait>(
    conn: &C,
    models: &[Model],
) -> Result<HashMap<String, String>, errors::Error> {
    if models.is_empty() {
        return Ok(HashMap::new());
    }
    let mut pks: Vec<String> = models.iter().map(|m| m.folder_id.clone()).collect();
    pks.sort_unstable();
    pks.dedup();
    Ok(folders::Entity::find()
        .filter(folders::Column::Id.is_in(pks))
        .filter(folders::Column::Type.eq(folder_type_into_i16(FolderType::Downtimes)))
        .all(conn)
        .await?
        .into_iter()
        .map(|f| (f.id, f.folder_id))
        .collect())
}

#[cfg(test)]
mod tests {
    use config::meta::downtimes::{DowntimeTarget, TargetFolders, TargetModule};
    use sea_orm::{Database, DatabaseConnection, Schema};

    use super::*;

    const DAY: i64 = 86_400_000_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(folders::Entity),
            schema.create_table_from_entity(Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        for (pk, org, slug, folder_type) in [
            ("pk-default", "acme", "default", FolderType::Downtimes),
            ("pk-planned", "acme", "planned", FolderType::Downtimes),
            ("pk-alerts", "acme", "planned", FolderType::Alerts),
            ("pk-other", "other", "default", FolderType::Downtimes),
        ] {
            folders::Entity::insert(folders::ActiveModel {
                id: Set(pk.to_string()),
                org: Set(org.to_string()),
                folder_id: Set(slug.to_string()),
                name: Set(slug.to_string()),
                description: Set(None),
                icon: Set(None),
                r#type: Set(folder_type_into_i16(folder_type)),
            })
            .exec(&db)
            .await
            .unwrap();
        }
        db
    }

    fn downtime(id: &str, repeat: Repeat, ends_at: Option<i64>) -> Downtime {
        Downtime {
            id: id.to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: id.to_string(),
            reason: None,
            condition: None,
            targets: vec![DowntimeTarget {
                module: TargetModule::Alerts,
                folders: TargetFolders::All,
                tags: vec![],
                ids: vec![],
                slo_mode: None,
            }],
            schedule: DowntimeSchedule {
                repeat,
                starts_at: 10 * DAY,
                ends_at,
                timezone: "UTC".to_string(),
                start_time_local: (repeat != Repeat::None).then(|| "02:00".to_string()),
                duration_secs: 3600,
                weekdays: if repeat == Repeat::Weekly {
                    vec![7]
                } else {
                    vec![]
                },
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

    fn ids(rows: &[Downtime]) -> Vec<&str> {
        let mut ids: Vec<&str> = rows.iter().map(|d| d.id.as_str()).collect();
        ids.sort_unstable();
        ids
    }

    #[test]
    fn a_new_id_is_a_ksuid() {
        assert_eq!(new_id().len(), 27);
    }

    #[tokio::test]
    async fn put_then_get_returns_the_row_with_its_public_folder_id() {
        let db = db().await;
        let mut d = downtime("d1", Repeat::Weekly, None);
        d.folder_id = "planned".to_string();
        d.reason = Some("CHG-1".to_string());
        put_with(&db, &d).await.unwrap();

        let stored = Entity::find_by_id("d1").one(&db).await.unwrap().unwrap();
        assert_eq!(stored.folder_id, "pk-planned");
        assert_eq!(get_with(&db, "acme", "d1").await.unwrap(), Some(d));
        assert_eq!(get_with(&db, "other", "d1").await.unwrap(), None);
    }

    #[tokio::test]
    async fn put_is_an_upsert_on_the_id() {
        let db = db().await;
        let mut d = downtime("d1", Repeat::None, Some(11 * DAY));
        put_with(&db, &d).await.unwrap();
        d.name = "renamed".to_string();
        d.cancelled_at = Some(10 * DAY);
        put_with(&db, &d).await.unwrap();

        let rows = list_with(&db, "acme", None).await.unwrap();
        assert_eq!(rows, vec![d]);
    }

    #[tokio::test]
    async fn put_refuses_a_folder_that_does_not_exist() {
        let db = db().await;
        let mut d = downtime("d1", Repeat::None, Some(11 * DAY));
        d.folder_id = "missing".to_string();
        assert!(put_with(&db, &d).await.is_err());
    }

    #[tokio::test]
    async fn list_filters_by_org_and_by_folder() {
        let db = db().await;
        let mut planned = downtime("d2", Repeat::Daily, None);
        planned.folder_id = "planned".to_string();
        put_with(&db, &downtime("d1", Repeat::None, Some(11 * DAY)))
            .await
            .unwrap();
        put_with(&db, &planned).await.unwrap();
        let mut foreign = downtime("d3", Repeat::None, Some(11 * DAY));
        foreign.org = "other".to_string();
        put_with(&db, &foreign).await.unwrap();

        assert_eq!(
            ids(&list_with(&db, "acme", None).await.unwrap()),
            ["d1", "d2"]
        );
        assert_eq!(
            ids(&list_with(&db, "acme", Some("planned")).await.unwrap()),
            ["d2"]
        );
        assert!(
            list_with(&db, "acme", Some("nope"))
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(ids(&list_all_with(&db).await.unwrap()), ["d1", "d2", "d3"]);
    }

    #[tokio::test]
    async fn delete_removes_only_the_named_row() {
        let db = db().await;
        put_with(&db, &downtime("d1", Repeat::None, Some(11 * DAY)))
            .await
            .unwrap();
        put_with(&db, &downtime("d2", Repeat::None, Some(11 * DAY)))
            .await
            .unwrap();
        delete_with(&db, "acme", "d1").await.unwrap();
        assert_eq!(ids(&list_with(&db, "acme", None).await.unwrap()), ["d2"]);
    }

    #[tokio::test]
    async fn move_to_folder_moves_only_the_named_ids() {
        let db = db().await;
        for id in ["d1", "d2", "d3"] {
            put_with(&db, &downtime(id, Repeat::None, Some(11 * DAY)))
                .await
                .unwrap();
        }
        let moved = move_to_folder_with(
            &db,
            "acme",
            &["d1".to_string(), "d3".to_string()],
            "planned",
        )
        .await
        .unwrap();
        assert_eq!(moved, 2);
        assert_eq!(
            ids(&list_with(&db, "acme", Some("planned")).await.unwrap()),
            ["d1", "d3"]
        );
        assert_eq!(
            ids(&list_with(&db, "acme", Some("default")).await.unwrap()),
            ["d2"]
        );
        assert!(
            move_to_folder_with(&db, "acme", &["d2".to_string()], "missing")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn delete_ended_before_leaves_scheduled_and_recurring_rows_alone() {
        let db = db().await;
        let cutoff = 20 * DAY;
        let mut cancelled = downtime("cancelled", Repeat::Daily, None);
        cancelled.cancelled_at = Some(12 * DAY);
        let mut cancelled_recently = downtime("cancelled_recently", Repeat::None, Some(30 * DAY));
        cancelled_recently.cancelled_at = Some(25 * DAY);
        for d in [
            downtime("ended_once", Repeat::None, Some(11 * DAY)),
            downtime("ended_weekly", Repeat::Weekly, Some(15 * DAY)),
            cancelled,
            downtime("scheduled_once", Repeat::None, Some(40 * DAY)),
            downtime("open_weekly", Repeat::Weekly, None),
            downtime("bounded_weekly", Repeat::Weekly, Some(60 * DAY)),
            cancelled_recently,
        ] {
            put_with(&db, &d).await.unwrap();
        }

        let mut listed = list_ended_before_with(&db, cutoff).await.unwrap();
        listed.sort_unstable();
        assert_eq!(
            listed.iter().map(|(_, id)| id.as_str()).collect::<Vec<_>>(),
            ["cancelled", "ended_once", "ended_weekly"]
        );
        assert_eq!(delete_ended_before_with(&db, cutoff).await.unwrap(), 3);
        assert_eq!(
            ids(&list_with(&db, "acme", None).await.unwrap()),
            [
                "bounded_weekly",
                "cancelled_recently",
                "open_weekly",
                "scheduled_once"
            ]
        );
    }

    #[tokio::test]
    async fn delete_by_org_returns_the_removed_ids_and_spares_other_orgs() {
        let db = db().await;
        put_with(&db, &downtime("d1", Repeat::None, Some(11 * DAY)))
            .await
            .unwrap();
        let mut foreign = downtime("d2", Repeat::None, Some(11 * DAY));
        foreign.org = "other".to_string();
        put_with(&db, &foreign).await.unwrap();

        assert_eq!(delete_by_org_with(&db, "acme").await.unwrap(), ["d1"]);
        assert_eq!(ids(&list_all_with(&db).await.unwrap()), ["d2"]);
    }
}
