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

//! Fleet Manager inventory: one row per OpAMP collector, written by every node's report flush.

use std::collections::{HashMap, HashSet};

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder, QuerySelect, sea_query::LockType,
};

pub use super::entity::fleet_collectors::Model;
use super::entity::fleet_collectors::{Column, Entity};
use crate::{db::get_orm_client_rw, errors};

const ID_CHUNK: usize = 1000;

/// Never the large text columns, which only the detail view reads.
#[derive(Clone, Debug, PartialEq, FromQueryResult)]
pub struct ListRow {
    pub org_id: String,
    pub id: String,
    pub name: Option<String>,
    pub hostname: Option<String>,
    pub ip: Option<String>,
    pub os: Option<String>,
    pub arch: Option<String>,
    pub distribution: Option<String>,
    pub version: Option<String>,
    pub capabilities: Option<i64>,
    pub healthy: Option<bool>,
    pub enrolled_at: i64,
    pub last_seen_at: i64,
    pub token_id: Option<String>,
    pub config_id: Option<String>,
    pub config_version: Option<i64>,
    pub desired_hash: Option<Vec<u8>>,
    pub assignment_rev: i64,
    pub sent_rev: Option<i64>,
    pub remote_status: Option<i32>,
    pub remote_hash: Option<Vec<u8>>,
    pub remote_error: Option<String>,
    pub effective_hash: Option<Vec<u8>>,
    pub effective_config_id: Option<String>,
    pub effective_config_version: Option<i64>,
    pub active_rollout_id: Option<String>,
    pub fleet_id: String,
}

#[derive(Clone, Debug, PartialEq, FromQueryResult)]
pub struct TargetRow {
    pub id: String,
    pub capabilities: Option<i64>,
    pub assignment_rev: i64,
    pub config_id: Option<String>,
    pub config_version: Option<i64>,
    pub desired_hash: Option<Vec<u8>>,
    pub active_rollout_id: Option<String>,
    pub fleet_id: String,
}

#[derive(Clone, Debug, PartialEq, FromQueryResult)]
pub struct DeliveryRow {
    pub id: String,
    pub assignment_rev: i64,
    pub desired_hash: Option<Vec<u8>>,
    pub sent_rev: Option<i64>,
    pub remote_status: Option<i32>,
    pub remote_hash: Option<Vec<u8>>,
    pub remote_error: Option<String>,
    pub capabilities: Option<i64>,
    pub last_seen_at: i64,
    pub healthy: Option<bool>,
    pub heartbeats: i64,
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<ListRow>, errors::Error> {
    Ok(Entity::find()
        .select_only()
        .columns([
            Column::OrgId,
            Column::Id,
            Column::Name,
            Column::Hostname,
            Column::Ip,
            Column::Os,
            Column::Arch,
            Column::Distribution,
            Column::Version,
            Column::Capabilities,
            Column::Healthy,
            Column::EnrolledAt,
            Column::LastSeenAt,
            Column::TokenId,
            Column::ConfigId,
            Column::ConfigVersion,
            Column::DesiredHash,
            Column::AssignmentRev,
            Column::SentRev,
            Column::RemoteStatus,
            Column::RemoteHash,
            Column::RemoteError,
            Column::EffectiveHash,
            Column::EffectiveConfigId,
            Column::EffectiveConfigVersion,
            Column::ActiveRolloutId,
            Column::FleetId,
        ])
        .filter(Column::OrgId.eq(org_id))
        .into_model::<ListRow>()
        .all(conn)
        .await?)
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?)
}

/// One query for a page of ids; an id with no row is simply absent.
pub async fn get_many_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    ids: &[String],
) -> Result<Vec<Model>, errors::Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.is_in(ids.iter().map(String::as_str)))
        .all(conn)
        .await?)
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Returns the ids it removed, which other nodes still hold as `admitted`.
pub async fn delete_by_org(org_id: &str) -> Result<Vec<String>, errors::Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<String>, errors::Error> {
    let ids: Vec<String> = Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::OrgId.eq(org_id))
        .into_tuple()
        .all(conn)
        .await?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(ids)
}

/// Every collector of a fleet, in id order.
pub async fn ids_in_fleet_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet: &str,
) -> Result<Vec<String>, errors::Error> {
    Ok(Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::FleetId.eq(fleet))
        .order_by_asc(Column::Id)
        .into_tuple()
        .all(conn)
        .await?)
}

/// Each known collector's fleet; unknown ids are absent.
pub async fn fleets_of_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    ids: &[String],
) -> Result<HashMap<String, String>, errors::Error> {
    let mut out = HashMap::with_capacity(ids.len());
    for chunk in ids.chunks(ID_CHUNK) {
        let rows: Vec<(String, String)> = Entity::find()
            .select_only()
            .columns([Column::Id, Column::FleetId])
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::Id.is_in(chunk))
            .into_tuple()
            .all(conn)
            .await?;
        out.extend(rows);
    }
    Ok(out)
}

pub async fn count_in_fleet_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet: &str,
) -> Result<u64, errors::Error> {
    use sea_orm::PaginatorTrait;
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::FleetId.eq(fleet))
        .count(conn)
        .await?)
}

/// Locks the rows in id order on PostgreSQL and reads what a move or placement decides on.
pub async fn lock_targets_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    ids: &[String],
) -> Result<Vec<TargetRow>, errors::Error> {
    let mut sorted = ids.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    let mut rows = Vec::with_capacity(sorted.len());
    for chunk in sorted.chunks(ID_CHUNK) {
        let mut query = Entity::find()
            .select_only()
            .columns([
                Column::Id,
                Column::Capabilities,
                Column::AssignmentRev,
                Column::ConfigId,
                Column::ConfigVersion,
                Column::DesiredHash,
                Column::ActiveRolloutId,
                Column::FleetId,
            ])
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::Id.is_in(chunk))
            .order_by_asc(Column::Id);
        if conn.get_database_backend() == DatabaseBackend::Postgres {
            query = query.lock(LockType::Update);
        }
        rows.extend(query.into_model::<TargetRow>().all(conn).await?);
    }
    Ok(rows)
}

pub async fn targets_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    ids: &[String],
) -> Result<Vec<TargetRow>, errors::Error> {
    let mut rows = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(ID_CHUNK) {
        rows.extend(
            Entity::find()
                .select_only()
                .columns([
                    Column::Id,
                    Column::Capabilities,
                    Column::AssignmentRev,
                    Column::ConfigId,
                    Column::ConfigVersion,
                    Column::DesiredHash,
                    Column::ActiveRolloutId,
                    Column::FleetId,
                ])
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::Id.is_in(chunk))
                .order_by_asc(Column::Id)
                .into_model::<TargetRow>()
                .all(conn)
                .await?,
        );
    }
    Ok(rows)
}

/// The tick's terminal re-read: locks the rows on PostgreSQL; SQLite is single-writer.
pub async fn lock_delivery_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    ids: &[String],
) -> Result<Vec<DeliveryRow>, errors::Error> {
    let mut sorted = ids.to_vec();
    sorted.sort_unstable();
    let mut rows = Vec::with_capacity(ids.len());
    for chunk in sorted.chunks(ID_CHUNK) {
        let mut query = Entity::find()
            .select_only()
            .columns([
                Column::Id,
                Column::AssignmentRev,
                Column::DesiredHash,
                Column::SentRev,
                Column::RemoteStatus,
                Column::RemoteHash,
                Column::RemoteError,
                Column::Capabilities,
                Column::LastSeenAt,
                Column::Healthy,
                Column::Heartbeats,
            ])
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::Id.is_in(chunk))
            .order_by_asc(Column::Id);
        if conn.get_database_backend() == DatabaseBackend::Postgres {
            query = query.lock(LockType::Update);
        }
        rows.extend(query.into_model::<DeliveryRow>().all(conn).await?);
    }
    Ok(rows)
}

pub async fn count_by_config_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleets: Option<&HashSet<String>>,
) -> Result<HashMap<String, usize>, errors::Error> {
    let mut query = Entity::find()
        .select_only()
        .column(Column::ConfigId)
        .column_as(Column::Id.count(), "count")
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ConfigId.is_not_null());
    if let Some(fleets) = fleets {
        query = query.filter(Column::FleetId.is_in(fleets.iter().map(String::as_str)));
    }
    let rows: Vec<(String, i64)> = query
        .group_by(Column::ConfigId)
        .into_tuple()
        .all(conn)
        .await?;
    Ok(rows
        .into_iter()
        .map(|(id, n)| (id, usize::try_from(n).unwrap_or_default()))
        .collect())
}

pub async fn count_on_version_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet_id: &str,
    config_id: &str,
    version: i64,
) -> Result<u64, errors::Error> {
    use sea_orm::PaginatorTrait;
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::FleetId.eq(fleet_id))
        .filter(Column::ConfigId.eq(config_id))
        .filter(Column::ConfigVersion.eq(version))
        .count(conn)
        .await?)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::{super::entity::fleet_collectors::ActiveModel, *};
    use crate::table::migration::create_fleet_collectors_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_fleet_collectors_for_test(&db).await.unwrap();
        db
    }

    fn seen(org_id: &str, id: &str, at: i64) -> Model {
        Model {
            org_id: org_id.to_string(),
            id: id.to_string(),
            enrolled_at: at,
            last_seen_at: at,
            fleet_id: "default".to_string(),
            ..Default::default()
        }
    }

    fn in_fleet(id: &str, fleet: &str) -> Model {
        Model {
            fleet_id: fleet.to_string(),
            ..seen("o1", id, 10)
        }
    }

    async fn insert(db: &DatabaseConnection, rows: Vec<Model>) {
        Entity::insert_many(rows.into_iter().map(ActiveModel::from))
            .exec_without_returning(db)
            .await
            .unwrap();
    }

    fn ids_of(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn list_is_org_scoped() {
        let db = db().await;
        insert(
            &db,
            vec![
                seen("o1", "a", 10),
                seen("o1", "b", 10),
                seen("o2", "c", 10),
            ],
        )
        .await;
        let mut ids: Vec<String> = list_with(&db, "o1")
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
        assert!(get_with(&db, "o3", "a").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_by_org_returns_the_ids_it_removed() {
        let db = db().await;
        insert(
            &db,
            vec![
                seen("o1", "a", 10),
                seen("o1", "b", 20),
                seen("o2", "c", 20),
            ],
        )
        .await;
        let mut removed = delete_by_org_with(&db, "o1").await.unwrap();
        removed.sort();
        assert_eq!(removed, vec!["a", "b"]);
        assert!(list_with(&db, "o1").await.unwrap().is_empty());
        assert!(get_with(&db, "o1", "b").await.unwrap().is_none());
        assert!(get_with(&db, "o2", "c").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn the_list_never_carries_the_large_texts_and_the_detail_does() {
        let db = db().await;
        let big = "x".repeat(1 << 20);
        let row = Model {
            effective_config: Some(big),
            effective_hash: Some(vec![1; 32]),
            ..seen("o1", "a", 10)
        };
        insert(&db, vec![row]).await;
        let list = list_with(&db, "o1").await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].effective_hash, Some(vec![1; 32]));
        let debug = format!("{list:?}");
        assert!(debug.len() < 10_000, "a large text reached the list row");
        let detail = get_with(&db, "o1", "a").await.unwrap().unwrap();
        assert_eq!(detail.effective_config.map(|t| t.len()), Some(1 << 20));
    }

    #[tokio::test]
    async fn lock_delivery_reads_the_derivation_columns_in_id_order() {
        let db = db().await;
        let assigned = Model {
            capabilities: Some(4098),
            assignment_rev: 1,
            desired_hash: Some(vec![1; 32]),
            ..seen("o1", "a", 10)
        };
        let unhealthy = Model {
            healthy: Some(false),
            heartbeats: 3,
            ..seen("o1", "b", 10)
        };
        insert(&db, vec![unhealthy, assigned]).await;
        let rows = lock_delivery_with(&db, "o1", &ids_of(&["b", "a", "missing"]))
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "a");
        assert_eq!(rows[0].assignment_rev, 1);
        assert_eq!(rows[0].desired_hash, Some(vec![1; 32]));
        assert_eq!(rows[0].capabilities, Some(4098));
        assert_eq!((rows[0].healthy, rows[0].heartbeats), (None, 0));
        assert_eq!((rows[1].healthy, rows[1].heartbeats), (Some(false), 3));
    }

    #[tokio::test]
    async fn fleet_reads_are_scoped_to_the_fleet() {
        let db = db().await;
        insert(
            &db,
            vec![
                in_fleet("b", "f"),
                in_fleet("a", "f"),
                in_fleet("nobits", "f"),
                seen("o1", "other", 10),
            ],
        )
        .await;
        assert_eq!(
            ids_in_fleet_with(&db, "o1", "f").await.unwrap(),
            vec!["a", "b", "nobits"]
        );
        assert_eq!(count_in_fleet_with(&db, "o1", "f").await.unwrap(), 3);
        let fleets = fleets_of_with(&db, "o1", &ids_of(&["a", "other", "x"]))
            .await
            .unwrap();
        assert_eq!(fleets.len(), 2);
        assert_eq!(fleets["a"], "f");
        assert_eq!(fleets["other"], "default");
    }
}
