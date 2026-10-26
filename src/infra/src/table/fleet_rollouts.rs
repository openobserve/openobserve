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

//! Fleet rollouts and their members; a member's live state is derived from its collector.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
    sea_query::{Alias, Expr, JoinType, LockType, Query},
};

pub use super::entity::{fleet_rollout_members::Model as MemberModel, fleet_rollouts::Model};
use super::entity::{
    fleet_rollout_members::{
        ActiveModel as MemberActiveModel, Column as MemberColumn, Entity as MemberEntity,
    },
    fleet_rollouts::{ActiveModel, Column, Entity},
};
use crate::{db::get_orm_client_rw, errors::Error};

// 10 binds per member row.
const INSERT_CHUNK: usize = 1000;
const ID_CHUNK: usize = 1000;

/// A member with its collector's delivery columns; the collector side is `None` once deleted.
#[derive(Clone, Debug, PartialEq, FromQueryResult)]
pub struct MemberDelivery {
    pub rollout_id: String,
    pub collector_id: String,
    pub phase: i32,
    pub state: String,
    pub assigned_rev: i64,
    pub assignment_rev: Option<i64>,
    pub desired_hash: Option<Vec<u8>>,
    pub sent_rev: Option<i64>,
    pub remote_status: Option<i32>,
    pub remote_hash: Option<Vec<u8>>,
    pub capabilities: Option<i64>,
    pub last_seen_at: Option<i64>,
    pub active_rollout_id: Option<String>,
    pub healthy: Option<bool>,
    pub heartbeats: Option<i64>,
    pub heartbeat_base: Option<i64>,
}

pub async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    row: Model,
    members: Vec<MemberModel>,
) -> Result<(), Error> {
    let record = ActiveModel {
        id: Set(row.id),
        org_id: Set(row.org_id),
        config_id: Set(row.config_id),
        from_version: Set(row.from_version),
        to_version: Set(row.to_version),
        fleet_id: Set(row.fleet_id),
        strategy: Set(row.strategy),
        status: Set(row.status),
        phases: Set(row.phases),
        failure: Set(row.failure),
        events: Set(row.events),
        started_at: Set(row.started_at),
        started_by: Set(row.started_by),
        rev: Set(row.rev),
        auto_rollback: Set(row.auto_rollback),
        scheduled_for: Set(row.scheduled_for),
        gates: Set(row.gates),
    };
    Entity::insert(record).exec_without_returning(conn).await?;
    for chunk in members.chunks(INSERT_CHUNK) {
        MemberEntity::insert_many(chunk.iter().cloned().map(member_active_model))
            .exec_without_returning(conn)
            .await?;
    }
    Ok(())
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
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
) -> Result<Vec<Model>, Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.is_in(ids.iter().map(String::as_str)))
        .all(conn)
        .await?)
}

/// Takes the row's lock on PostgreSQL, with no `rev` guard: whatever a tick did, it is read here.
pub async fn lock_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id));
    if conn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock(LockType::Update);
    }
    Ok(query.one(conn).await?)
}

pub async fn list_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_desc(Column::StartedAt)
        .order_by_desc(Column::Id)
        .all(conn)
        .await?)
}

/// `(to_version, status, started_at)` of every rollout of one config, newest first.
pub async fn list_for_config_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    config_id: &str,
) -> Result<Vec<(i64, String, i64)>, Error> {
    Ok(Entity::find()
        .select_only()
        .columns([Column::ToVersion, Column::Status, Column::StartedAt])
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ConfigId.eq(config_id))
        .order_by_desc(Column::StartedAt)
        .order_by_desc(Column::Id)
        .into_tuple()
        .all(conn)
        .await?)
}

/// The fence: bumps `rev` only if nobody moved the row since `rev` was read; 0 lost the race.
pub async fn guard_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    rev: i64,
    statuses: &[&str],
) -> Result<u64, Error> {
    let res = Entity::update_many()
        .col_expr(Column::Rev, Expr::cust("rev + 1"))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::Rev.eq(rev))
        .filter(Column::Status.is_in(statuses.iter().copied()))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Writes status, phases, failure, events and gates of a row the caller already fenced.
pub async fn save_state_with<C: ConnectionTrait>(conn: &C, row: &Model) -> Result<(), Error> {
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(row.status.clone()))
        .col_expr(Column::Phases, Expr::value(row.phases.clone()))
        .col_expr(Column::Failure, Expr::value(row.failure.clone()))
        .col_expr(Column::Events, Expr::value(row.events.clone()))
        .col_expr(Column::Gates, Expr::value(row.gates.clone()))
        .filter(Column::OrgId.eq(&row.org_id))
        .filter(Column::Id.eq(&row.id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn members_with<C: ConnectionTrait>(
    conn: &C,
    rollout_id: &str,
) -> Result<Vec<MemberModel>, Error> {
    Ok(MemberEntity::find()
        .filter(MemberColumn::RolloutId.eq(rollout_id))
        .order_by_asc(MemberColumn::Phase)
        .order_by_asc(MemberColumn::CollectorId)
        .all(conn)
        .await?)
}

pub async fn set_member_state_with<C: ConnectionTrait>(
    conn: &C,
    rollout_id: &str,
    ids: &[String],
    state: &str,
) -> Result<(), Error> {
    for chunk in ids.chunks(ID_CHUNK) {
        MemberEntity::update_many()
            .col_expr(MemberColumn::State, Expr::value(state))
            .filter(MemberColumn::RolloutId.eq(rollout_id))
            .filter(MemberColumn::CollectorId.is_in(chunk))
            .exec(conn)
            .await?;
    }
    Ok(())
}

pub async fn members_with_delivery_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    rollout_id: Option<&str>,
) -> Result<Vec<MemberDelivery>, Error> {
    let backend = conn.get_database_backend();
    let mut query = Query::select();
    query
        .expr(Expr::cust(
            "m.rollout_id, m.collector_id, m.phase, m.state, m.assigned_rev, \
             c.assignment_rev, c.desired_hash, c.sent_rev, c.remote_status, \
             c.remote_hash, c.capabilities, c.last_seen_at, c.active_rollout_id, \
             c.healthy, c.heartbeats, m.heartbeat_base",
        ))
        .from_as(Alias::new("fleet_rollout_members"), Alias::new("m"))
        .join_as(
            JoinType::LeftJoin,
            Alias::new("fleet_collectors"),
            Alias::new("c"),
            Expr::cust("c.org_id = m.org_id AND c.id = m.collector_id"),
        )
        .and_where(Expr::col((Alias::new("m"), MemberColumn::OrgId)).eq(org_id));
    if let Some(rollout_id) = rollout_id {
        query.and_where(Expr::col((Alias::new("m"), MemberColumn::RolloutId)).eq(rollout_id));
    }
    query.order_by_expr(Expr::cust("m.phase"), sea_orm::Order::Asc);
    query.order_by_expr(Expr::cust("m.collector_id"), sea_orm::Order::Asc);
    Ok(MemberDelivery::find_by_statement(backend.build(&query))
        .all(conn)
        .await?)
}

pub async fn delete_by_org(org_id: &str) -> Result<(), Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_with<C: TransactionTrait>(db: &C, org_id: &str) -> Result<(), Error> {
    let txn = db.begin().await?;
    MemberEntity::delete_many()
        .filter(MemberColumn::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

fn member_active_model(m: MemberModel) -> MemberActiveModel {
    MemberActiveModel {
        rollout_id: Set(m.rollout_id),
        collector_id: Set(m.collector_id),
        org_id: Set(m.org_id),
        phase: Set(m.phase),
        prev_config_id: Set(m.prev_config_id),
        prev_version: Set(m.prev_version),
        state: Set(m.state),
        assigned_rev: Set(m.assigned_rev),
        heartbeat_base: Set(m.heartbeat_base),
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::{super::entity::fleet_collectors as collectors, *};
    use crate::table::migration::create_fleet_collectors_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_fleet_collectors_for_test(&db).await.unwrap();
        db
    }

    fn rollout(org_id: &str, id: &str, config_id: &str, status: &str, at: i64) -> Model {
        Model {
            id: id.to_string(),
            org_id: org_id.to_string(),
            config_id: config_id.to_string(),
            from_version: None,
            to_version: 1,
            fleet_id: "f".to_string(),
            strategy: "immediate".to_string(),
            status: status.to_string(),
            phases: "[]".to_string(),
            failure: None,
            events: "[]".to_string(),
            started_at: at,
            started_by: "u".to_string(),
            rev: 0,
            auto_rollback: false,
            scheduled_for: None,
            gates: None,
        }
    }

    fn member(rollout_id: &str, collector_id: &str, phase: i32) -> MemberModel {
        MemberModel {
            rollout_id: rollout_id.to_string(),
            collector_id: collector_id.to_string(),
            org_id: "o1".to_string(),
            phase,
            prev_config_id: None,
            prev_version: None,
            state: "assigned".to_string(),
            assigned_rev: 0,
            heartbeat_base: None,
        }
    }

    fn ids(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    fn collector(org_id: &str, id: &str) -> collectors::Model {
        collectors::Model {
            org_id: org_id.to_string(),
            id: id.to_string(),
            capabilities: Some(4098),
            capabilities_at: Some(1),
            enrolled_at: 1,
            last_seen_at: 1,
            fleet_id: "default".to_string(),
            ..Default::default()
        }
    }

    async fn insert_collectors<C: ConnectionTrait>(db: &C, rows: Vec<collectors::Model>) {
        collectors::Entity::insert_many(rows.into_iter().map(collectors::ActiveModel::from))
            .exec_without_returning(db)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn insert_get_and_list_are_org_scoped_newest_first() {
        let db = db().await;
        insert_with(
            &db,
            rollout("o1", "r1", "edge", "completed", 10),
            vec![
                member("r1", "b", 0),
                member("r1", "a", 1),
                member("r1", "c", 0),
            ],
        )
        .await
        .unwrap();
        insert_with(&db, rollout("o1", "r2", "edge", "in_progress", 20), vec![])
            .await
            .unwrap();
        insert_with(&db, rollout("o2", "r3", "edge", "in_progress", 30), vec![])
            .await
            .unwrap();
        assert_eq!(
            get_with(&db, "o1", "r1").await.unwrap().unwrap(),
            rollout("o1", "r1", "edge", "completed", 10)
        );
        assert!(get_with(&db, "o2", "r1").await.unwrap().is_none());
        let listed: Vec<String> = list_with(&db, "o1")
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(listed, vec!["r2", "r1"]);
        let order: Vec<String> = members_with(&db, "r1")
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.collector_id)
            .collect();
        assert_eq!(order, vec!["b", "c", "a"]);
        assert_eq!(
            list_for_config_with(&db, "o1", "edge").await.unwrap(),
            vec![
                (1, "in_progress".to_string(), 20),
                (1, "completed".to_string(), 10)
            ]
        );
    }

    #[tokio::test]
    async fn guard_fences_on_rev_and_status() {
        let db = db().await;
        insert_with(&db, rollout("o1", "r1", "edge", "in_progress", 1), vec![])
            .await
            .unwrap();
        assert_eq!(
            guard_with(&db, "o1", "r1", 1, &["in_progress"])
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            guard_with(&db, "o1", "r1", 0, &["halted"]).await.unwrap(),
            0
        );
        assert_eq!(
            get_with(&db, "o1", "r1").await.unwrap().unwrap().rev,
            0,
            "a refused guard changes nothing"
        );
        assert_eq!(
            guard_with(&db, "o1", "r1", 0, &["in_progress"])
                .await
                .unwrap(),
            1
        );
        assert_eq!(get_with(&db, "o1", "r1").await.unwrap().unwrap().rev, 1);
    }

    #[tokio::test]
    async fn lock_reads_the_row_and_is_org_scoped() {
        let db = db().await;
        insert_with(&db, rollout("o1", "live", "edge", "halted", 2), vec![])
            .await
            .unwrap();
        assert_eq!(
            lock_with(&db, "o1", "live")
                .await
                .unwrap()
                .map(|r| r.status),
            Some("halted".to_string())
        );
        assert!(lock_with(&db, "o2", "live").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn save_state_and_member_state() {
        let db = db().await;
        let mut row = rollout("o1", "r1", "edge", "in_progress", 1);
        insert_with(
            &db,
            row.clone(),
            vec![member("r1", "a", 0), member("r1", "b", 0)],
        )
        .await
        .unwrap();
        set_member_state_with(&db, "r1", &ids(&["b"]), "running")
            .await
            .unwrap();
        assert_eq!(members_with(&db, "r1").await.unwrap()[1].state, "running");

        row.status = "halted".to_string();
        row.failure =
            Some(serde_json::json!({"gate": "rejected", "kind": "rejection"}).to_string());
        row.events = serde_json::json!([{"key": "rejected", "at": 5}]).to_string();
        save_state_with(&db, &row).await.unwrap();
        assert_eq!(get_with(&db, "o1", "r1").await.unwrap().unwrap(), row);
    }

    #[tokio::test]
    async fn members_with_delivery_joins_the_collector_and_is_org_scoped() {
        let db = db().await;
        insert_collectors(
            &db,
            vec![collectors::Model {
                assignment_rev: 1,
                desired_hash: Some(vec![1; 32]),
                active_rollout_id: Some("r1".to_string()),
                ..collector("o1", "a")
            }],
        )
        .await;
        insert_with(
            &db,
            rollout("o1", "r1", "edge", "in_progress", 1),
            vec![member("r1", "a", 0), member("r1", "deleted", 0)],
        )
        .await
        .unwrap();
        insert_with(
            &db,
            rollout("o1", "r2", "edge", "completed", 1),
            vec![member("r2", "a", 0)],
        )
        .await
        .unwrap();
        let mut other = member("r3", "x", 0);
        other.org_id = "o2".to_string();
        insert_with(
            &db,
            rollout("o2", "r3", "edge", "in_progress", 1),
            vec![other],
        )
        .await
        .unwrap();

        let rows = members_with_delivery_with(&db, "o1", Some("r1"))
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].collector_id, "a");
        assert_eq!(rows[0].assignment_rev, Some(1));
        assert_eq!(rows[0].desired_hash, Some(vec![1; 32]));
        assert_eq!(rows[0].active_rollout_id.as_deref(), Some("r1"));
        assert_eq!(rows[0].last_seen_at, Some(1));
        assert_eq!(rows[1].collector_id, "deleted");
        assert_eq!((rows[1].assignment_rev, rows[1].last_seen_at), (None, None));
        assert_eq!(
            members_with_delivery_with(&db, "o1", None)
                .await
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            members_with_delivery_with(&db, "o2", None)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn delete_by_org_is_org_scoped() {
        let db = db().await;
        insert_with(
            &db,
            rollout("o1", "r1", "edge", "completed", 1),
            vec![member("r1", "a", 0)],
        )
        .await
        .unwrap();
        let mut other = member("o2r", "x", 0);
        other.org_id = "o2".to_string();
        insert_with(
            &db,
            rollout("o2", "o2r", "edge", "completed", 1),
            vec![other],
        )
        .await
        .unwrap();
        delete_by_org_with(&db, "o1").await.unwrap();
        assert!(list_with(&db, "o1").await.unwrap().is_empty());
        assert!(members_with(&db, "r1").await.unwrap().is_empty());
        assert_eq!(members_with(&db, "o2r").await.unwrap().len(), 1);
        assert_eq!(list_with(&db, "o2").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn staged_columns_round_trip() {
        let db = db().await;
        let mut row = rollout("o1", "r1", "edge", "in_progress", 1);
        row.auto_rollback = true;
        row.scheduled_for = Some(99);
        insert_with(&db, row.clone(), vec![member("r1", "a", 0)])
            .await
            .unwrap();
        assert_eq!(get_with(&db, "o1", "r1").await.unwrap().unwrap(), row);
        row.gates =
            Some(serde_json::json!([{"id": "heartbeat", "window_start_at": 7}]).to_string());
        save_state_with(&db, &row).await.unwrap();
        assert_eq!(get_with(&db, "o1", "r1").await.unwrap().unwrap(), row);
    }
}
