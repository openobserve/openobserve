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

//! `autoresolve_runs`: one row per autoresolve run; state moves are conditional updates.

use config::meta::autoresolve::{RunState, TriggerKind};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseBackend,
    DatabaseTransaction, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Select,
    Set, SqlErr, TransactionTrait, UpdateMany,
    sea_query::{Expr, Func, LikeExpr, LockType, Query, SimpleExpr},
};
use svix_ksuid::KsuidLike;

use super::{
    autoresolve_run_connections,
    entity::{
        autoresolve_run_connections as chosen,
        autoresolve_runs::{ActiveModel, Column, Entity, Model},
    },
};
use crate::{
    db::{escape_like_prefix, get_orm_client_ro, get_orm_client_rw},
    errors::{DbError, Error},
};

/// The row a run starts as: `investigating`, revision 1.
#[derive(Debug, Clone)]
pub struct NewRun {
    pub id: String,
    pub org: String,
    pub region: String,
    pub autoresolve_id: Option<String>,
    pub goal: String,
    /// JSON text, as the columns store it.
    pub connection_ids: String,
    pub connection_names: String,
    pub trigger_kind: TriggerKind,
    pub trigger_context: Option<String>,
    /// An email, or `system` for runs no person started.
    pub requester: String,
    pub turn_identity: String,
    pub session_id: String,
    pub approval_channel: String,
    pub turn_deadline_us: Option<i64>,
    pub idempotency_key: String,
    pub now_us: i64,
}

/// Columns a state move sets; `None` leaves a column alone, and a nullable column takes
/// `Some(None)` to clear, as a replan or a hold must.
#[derive(Debug, Clone, Default)]
pub struct RunPatch {
    pub revision: Option<i32>,
    pub plan: Option<String>,
    pub plan_fingerprint: Option<String>,
    pub chosen_option_id: Option<Option<String>>,
    pub approved_by: Option<Option<String>>,
    pub approved_at_us: Option<Option<i64>>,
    pub approval_channel: Option<String>,
    pub approval_deadline_us: Option<Option<i64>>,
    pub turn_deadline_us: Option<Option<i64>>,
    pub turn_started_at_us: Option<Option<i64>>,
    pub check_retried_at_us: Option<Option<i64>>,
    pub slack_ref: Option<String>,
    pub outcome_verdict: Option<Option<String>>,
    pub outcome_explanation: Option<Option<String>>,
    /// Set when a run leaves `worse` and never cleared: a revert that ends neutral still shows it.
    pub prior_verdict: Option<String>,
    pub error: Option<Option<String>>,
    pub ended_at_us: Option<Option<i64>>,
    pub person_verdict: Option<Option<String>>,
    pub updated_at_us: i64,
}

impl RunPatch {
    fn apply(self, update: UpdateMany<Entity>) -> UpdateMany<Entity> {
        let update = update.col_expr(Column::UpdatedAtUs, Expr::value(self.updated_at_us));
        let update = set(update, Column::Revision, self.revision);
        let update = set(update, Column::Plan, self.plan);
        let update = set(update, Column::PlanFingerprint, self.plan_fingerprint);
        let update = set(update, Column::ChosenOptionId, self.chosen_option_id);
        let update = set(update, Column::ApprovedBy, self.approved_by);
        let update = set(update, Column::ApprovedAtUs, self.approved_at_us);
        let update = set(update, Column::ApprovalChannel, self.approval_channel);
        let update = set(
            update,
            Column::ApprovalDeadlineUs,
            self.approval_deadline_us,
        );
        let update = set(update, Column::TurnDeadlineUs, self.turn_deadline_us);
        let update = set(update, Column::TurnStartedAtUs, self.turn_started_at_us);
        let update = set(update, Column::CheckRetriedAtUs, self.check_retried_at_us);
        let update = set(update, Column::SlackRef, self.slack_ref);
        let update = set(update, Column::OutcomeVerdict, self.outcome_verdict);
        let update = set(update, Column::OutcomeExplanation, self.outcome_explanation);
        let update = set(update, Column::PriorVerdict, self.prior_verdict);
        let update = set(update, Column::Error, self.error);
        let update = set(update, Column::PersonVerdict, self.person_verdict);
        set(update, Column::EndedAtUs, self.ended_at_us)
    }
}

/// What the run list narrows by; every field is optional.
#[derive(Debug, Clone, Default)]
pub struct RunFilter {
    /// Any of these states; empty means every state.
    pub states: Vec<RunState>,
    pub requester: Option<String>,
    pub connection_id: Option<String>,
    pub autoresolve_id: Option<String>,
    pub from_us: Option<i64>,
    pub to_us: Option<i64>,
    /// Matches inside the goal, ignoring case; `%` and `_` match only themselves.
    pub q: Option<String>,
}

/// The run's connection lists after one was added, and that connection's own row; all JSON.
#[derive(Debug, Clone)]
pub struct AddedConnection<'a> {
    pub connection_id: &'a str,
    pub connection_ids: &'a str,
    pub connection_names: &'a str,
    pub added_connections: &'a str,
}

/// A new run id: a KSUID, so ids sort by time.
pub fn new_run_id() -> String {
    svix_ksuid::Ksuid::new(None, None).to_string()
}

/// A taken `(org, idempotency_key)`, or a second live run of one saved autoresolve, fails with
/// `DbError::UniqueViolation`.
pub async fn insert(run: NewRun) -> Result<Model, Error> {
    insert_with(get_orm_client_rw().await, run).await
}

/// Inserts the run and one `autoresolve_run_connections` row per chosen connection, together.
pub async fn insert_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    run: NewRun,
) -> Result<Model, Error> {
    let chosen: Vec<String> = serde_json::from_str(&run.connection_ids)?;
    let txn = conn.begin().await?;
    let row = ActiveModel {
        id: Set(run.id),
        org: Set(run.org),
        region: Set(run.region),
        autoresolve_id: Set(run.autoresolve_id),
        goal: Set(run.goal),
        connection_ids: Set(run.connection_ids),
        connection_names: Set(run.connection_names),
        trigger_kind: Set(run.trigger_kind.as_str().to_string()),
        trigger_context: Set(run.trigger_context),
        requester: Set(run.requester),
        turn_identity: Set(run.turn_identity),
        session_id: Set(run.session_id),
        state: Set(RunState::Investigating.as_str().to_string()),
        revision: Set(1),
        plan: Set(None),
        plan_fingerprint: Set(None),
        chosen_option_id: Set(None),
        approved_by: Set(None),
        approved_at_us: Set(None),
        approval_channel: Set(run.approval_channel),
        approval_deadline_us: Set(None),
        turn_deadline_us: Set(run.turn_deadline_us),
        slack_ref: Set(None),
        outcome_verdict: Set(None),
        outcome_explanation: Set(None),
        prior_verdict: Set(None),
        error: Set(None),
        idempotency_key: Set(run.idempotency_key),
        created_at_us: Set(run.now_us),
        updated_at_us: Set(run.now_us),
        ended_at_us: Set(None),
        plan_corrections: Set(None),
        person_verdict: Set(None),
        added_connections: Set(None),
        turn_started_at_us: Set(run.turn_deadline_us.map(|_| run.now_us)),
        check_retried_at_us: Set(None),
    }
    .insert(&txn)
    .await
    .map_err(unique_violation)?;
    autoresolve_run_connections::insert_many_with(&txn, &row.org, &row.id, &chosen).await?;
    txn.commit().await?;
    Ok(row)
}

pub async fn get(org: &str, id: &str) -> Result<Option<Model>, Error> {
    get_with(get_orm_client_rw().await, org, id).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find_by_id(id.to_string())
        .filter(Column::Org.eq(org))
        .one(conn)
        .await?)
}

/// Each run's `created_at_us` by id; unknown ids are left out.
pub async fn created_at_by_ids_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    ids: &[String],
) -> Result<std::collections::HashMap<String, i64>, Error> {
    if ids.is_empty() {
        return Ok(Default::default());
    }
    let rows: Vec<(String, i64)> = Entity::find()
        .select_only()
        .column(Column::Id)
        .column(Column::CreatedAtUs)
        .filter(Column::Org.eq(org))
        .filter(Column::Id.is_in(ids.iter().cloned()))
        .into_tuple()
        .all(conn)
        .await?;
    Ok(rows.into_iter().collect())
}

/// The org's runs, newest first, with the total behind the filter; `page` is zero-based.
pub async fn list(
    org: &str,
    filter: &RunFilter,
    page: u64,
    page_size: u64,
) -> Result<(Vec<Model>, u64), Error> {
    list_with(get_orm_client_ro().await, org, filter, page, page_size).await
}

/// `region`'s runs still waiting for approval after their deadline, most overdue first.
pub async fn list_waiting_past_deadline_with<C: ConnectionTrait>(
    conn: &C,
    region: &str,
    now_us: i64,
    limit: u64,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::Region.eq(region))
        .filter(Column::State.eq(RunState::WaitingApproval.as_str()))
        .filter(Column::ApprovalDeadlineUs.lt(now_us))
        .order_by_asc(Column::ApprovalDeadlineUs)
        .limit(limit)
        .all(conn)
        .await?)
}

/// `region`'s live runs whose turn deadline has passed: their worker is presumed dead.
pub async fn list_live_past_turn_deadline_with<C: ConnectionTrait>(
    conn: &C,
    region: &str,
    now_us: i64,
    limit: u64,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::Region.eq(region))
        .filter(Column::State.is_in(live_states()))
        .filter(Column::TurnDeadlineUs.lt(now_us))
        .order_by_asc(Column::TurnDeadlineUs)
        .limit(limit)
        .all(conn)
        .await?)
}

/// The autoresolve's run that has not ended, one waiting for approval included, if any.
pub async fn live_for_autoresolve(org: &str, autoresolve_id: &str) -> Result<Option<Model>, Error> {
    live_for_autoresolve_with(get_orm_client_rw().await, org, autoresolve_id).await
}

pub async fn live_for_autoresolve_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    autoresolve_id: &str,
) -> Result<Option<Model>, Error> {
    let mut states = live_states();
    states.push(RunState::WaitingApproval.as_str());
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::AutoresolveId.eq(autoresolve_id))
        .filter(Column::State.is_in(states))
        .order_by_desc(Column::CreatedAtUs)
        .one(conn)
        .await?)
}

pub async fn delete_by_org(org: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected)
}

/// Moves the run only while it is in one of `from`; false when another caller moved it first.
/// Reviving a run while another run of its autoresolve is live: `DbError::UniqueViolation`.
pub async fn set_state_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    from: &[RunState],
    to: RunState,
    patch: RunPatch,
) -> Result<bool, Error> {
    let from: Vec<&str> = from.iter().map(RunState::as_str).collect();
    let update =
        patch.apply(Entity::update_many().col_expr(Column::State, Expr::value(to.as_str())));
    let res = update
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .filter(Column::State.is_in(from))
        .exec(conn)
        .await
        .map_err(unique_violation)?;
    Ok(res.rows_affected == 1)
}

/// Records where the run's Slack card is; a second post never replaces the first.
pub async fn set_slack_ref(org: &str, id: &str, slack_ref: &str) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::SlackRef, Expr::value(slack_ref))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .filter(Column::SlackRef.is_null())
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Sets or clears `error` only while the run is in one of `states`; no other column moves.
pub async fn set_error_if_state_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    states: &[RunState],
    error: Option<String>,
) -> Result<bool, Error> {
    let states: Vec<&str> = states.iter().map(RunState::as_str).collect();
    let res = Entity::update_many()
        .col_expr(Column::Error, Expr::value(error))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .filter(Column::State.is_in(states))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Records which corrections the run's latest planning turn read, as a JSON array of ids.
pub async fn set_plan_corrections(org: &str, id: &str, ids_json: &str) -> Result<(), Error> {
    Entity::update_many()
        .col_expr(Column::PlanCorrections, Expr::value(ids_json))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

/// Sets the person's verdict only while the run is in one of `states` at `revision`; it bumps
/// `updated_at_us` so an open run page redraws.
pub async fn set_person_verdict_if_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    states: &[RunState],
    revision: i32,
    verdict_json: &str,
    now_us: i64,
) -> Result<bool, Error> {
    let states: Vec<&str> = states.iter().map(RunState::as_str).collect();
    let res = Entity::update_many()
        .col_expr(Column::PersonVerdict, Expr::value(verdict_json))
        .col_expr(Column::UpdatedAtUs, Expr::value(now_us))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .filter(Column::State.is_in(states))
        .filter(Column::Revision.eq(revision))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Writes the run's new connection lists and its `autoresolve_run_connections` row together.
pub async fn add_connection_with(
    txn: &DatabaseTransaction,
    org: &str,
    id: &str,
    added: AddedConnection<'_>,
) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::ConnectionIds, Expr::value(added.connection_ids))
        .col_expr(Column::ConnectionNames, Expr::value(added.connection_names))
        .col_expr(
            Column::AddedConnections,
            Expr::value(added.added_connections),
        )
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(txn)
        .await?;
    if res.rows_affected != 1 {
        return Ok(false);
    }
    let ids = [added.connection_id.to_string()];
    autoresolve_run_connections::insert_many_with(txn, org, id, &ids).await?;
    Ok(true)
}

/// Reads the run under a row lock, except on SQLite, which serializes writers.
pub async fn locked(
    conn: &DatabaseTransaction,
    org: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    let mut query = Entity::find_by_id(id.to_string()).filter(Column::Org.eq(org));
    if conn.get_database_backend() != DatabaseBackend::Sqlite {
        query = query.lock(LockType::Update);
    }
    Ok(query.one(conn).await?)
}

#[cfg(any(test, feature = "test-utils"))]
pub async fn create_tables_for_tests(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), sea_orm::DbErr> {
    use sea_orm_migration::{MigrationTrait, SchemaManager};

    crate::table::migration::autoresolve_migration_for_test()
        .up(&SchemaManager::new(db))
        .await?;
    crate::table::migration::autoresolve_corrections_migration_for_test()
        .up(&SchemaManager::new(db))
        .await
}

pub(crate) async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    filter: &RunFilter,
    page: u64,
    page_size: u64,
) -> Result<(Vec<Model>, u64), Error> {
    let paginator = filtered(org, filter)
        .order_by_desc(Column::CreatedAtUs)
        .order_by_desc(Column::Id)
        .paginate(conn, page_size.max(1));
    let total = paginator.num_items().await?;
    Ok((paginator.fetch_page(page).await?, total))
}

fn set<V: Into<SimpleExpr>>(
    update: UpdateMany<Entity>,
    col: Column,
    value: Option<V>,
) -> UpdateMany<Entity> {
    match value {
        Some(v) => update.col_expr(col, Expr::value(v)),
        None => update,
    }
}

fn unique_violation(e: sea_orm::DbErr) -> Error {
    match e.sql_err() {
        Some(SqlErr::UniqueConstraintViolation(_)) => Error::DbError(DbError::UniqueViolation),
        _ => e.into(),
    }
}

fn live_states() -> Vec<&'static str> {
    [
        RunState::Investigating,
        RunState::Proceeding,
        RunState::Checking,
    ]
    .iter()
    .map(RunState::as_str)
    .collect()
}

fn filtered(org: &str, filter: &RunFilter) -> Select<Entity> {
    let mut cond = Condition::all().add(Column::Org.eq(org));
    if !filter.states.is_empty() {
        cond = cond.add(Column::State.is_in(filter.states.iter().map(RunState::as_str)));
    }
    if let Some(requester) = &filter.requester {
        cond = cond.add(Column::Requester.eq(requester.as_str()));
    }
    if let Some(autoresolve_id) = &filter.autoresolve_id {
        cond = cond.add(Column::AutoresolveId.eq(autoresolve_id.as_str()));
    }
    if let Some(from_us) = filter.from_us {
        cond = cond.add(Column::CreatedAtUs.gte(from_us));
    }
    if let Some(to_us) = filter.to_us {
        cond = cond.add(Column::CreatedAtUs.lt(to_us));
    }
    if let Some(q) = &filter.q {
        let pattern = format!("%{}%", escape_like_prefix(&q.to_lowercase()));
        cond = cond.add(
            Expr::expr(Func::lower(Expr::col((Entity, Column::Goal))))
                .like(LikeExpr::new(pattern).escape('\\')),
        );
    }
    if let Some(connection_id) = &filter.connection_id {
        cond = cond.add(Expr::exists(chose_connection(org, connection_id)));
    }
    Entity::find().filter(cond)
}

fn chose_connection(org: &str, connection_id: &str) -> sea_orm::sea_query::SelectStatement {
    Query::select()
        .expr(Expr::val(1))
        .from(chosen::Entity)
        .and_where(Expr::col((chosen::Entity, chosen::Column::Org)).eq(org))
        .and_where(Expr::col((chosen::Entity, chosen::Column::ConnectionId)).eq(connection_id))
        .and_where(Expr::col((chosen::Entity, chosen::Column::RunId)).equals((Entity, Column::Id)))
        .to_owned()
}

#[cfg(test)]
mod tests {
    use config::meta::autoresolve::{RunState, TriggerKind};

    use super::*;
    use crate::table::{
        autoresolve_test_support::{backends, drop_schema},
        entity::autoresolve_steps,
    };

    const NOW: i64 = 1_000_000_000_000;

    fn new_run(id: &str) -> NewRun {
        NewRun {
            id: id.into(),
            org: "acme".into(),
            region: "default".into(),
            autoresolve_id: None,
            goal: "restart the stuck pod".into(),
            connection_ids: "[]".into(),
            connection_names: "{}".into(),
            trigger_kind: TriggerKind::Person,
            trigger_context: None,
            requester: "dana@acme.com".into(),
            turn_identity: "dana@acme.com".into(),
            session_id: "sess".into(),
            approval_channel: "screen".into(),
            turn_deadline_us: None,
            idempotency_key: format!("key-{id}"),
            now_us: 1,
        }
    }

    async fn waiting(db: &sea_orm::DatabaseConnection, id: &str, region: &str, deadline: i64) {
        let run = NewRun {
            region: region.into(),
            ..new_run(id)
        };
        insert_with(db, run).await.unwrap();
        let patch = RunPatch {
            approval_deadline_us: Some(Some(deadline)),
            updated_at_us: NOW,
            ..Default::default()
        };
        assert!(
            set_state_with(
                db,
                "acme",
                id,
                &[RunState::Investigating],
                RunState::WaitingApproval,
                patch
            )
            .await
            .unwrap()
        );
    }

    #[tokio::test]
    async fn set_state_with_only_moves_from_the_given_states() {
        for (backend, db, schema) in backends().await {
            let of_flow = |id: &str| NewRun {
                autoresolve_id: Some("f1".into()),
                ..new_run(id)
            };
            insert_with(&db, of_flow("r1")).await.unwrap();
            let same_key = NewRun {
                id: "r2".into(),
                ..new_run("r1")
            };
            fn unique<T>(r: &Result<T, Error>) -> bool {
                matches!(r, Err(Error::DbError(DbError::UniqueViolation)))
            }
            let taken = insert_with(&db, same_key).await;
            assert!(unique(&taken), "{backend}: {taken:?}");
            let second_live = insert_with(&db, of_flow("r3")).await;
            assert!(unique(&second_live), "{backend}: {second_live:?}");
            let from = [RunState::Investigating];
            let patch = || RunPatch {
                updated_at_us: NOW,
                ..Default::default()
            };
            assert!(
                set_state_with(&db, "acme", "r1", &from, RunState::WaitingApproval, patch())
                    .await
                    .unwrap(),
                "{backend}"
            );
            let from = [RunState::WaitingApproval];
            assert!(
                set_state_with(&db, "acme", "r1", &from, RunState::Proceeding, patch())
                    .await
                    .unwrap(),
                "{backend}"
            );
            assert!(
                !set_state_with(&db, "acme", "r1", &from, RunState::Proceeding, patch())
                    .await
                    .unwrap(),
                "{backend}"
            );
            let ended = RunPatch {
                chosen_option_id: Some(Some("A".into())),
                approved_by: Some(Some("dana@acme.com".into())),
                approved_at_us: Some(Some(NOW)),
                outcome_verdict: Some(Some("worse".into())),
                outcome_explanation: Some(Some("latency up".into())),
                error: Some(Some("boom".into())),
                ended_at_us: Some(Some(NOW)),
                ..patch()
            };
            let from = [RunState::Proceeding];
            assert!(
                set_state_with(&db, "acme", "r1", &from, RunState::Worse, ended)
                    .await
                    .unwrap()
            );
            let cleared = RunPatch {
                chosen_option_id: Some(None),
                approved_by: Some(None),
                approved_at_us: Some(None),
                outcome_verdict: Some(None),
                outcome_explanation: Some(None),
                error: Some(None),
                ended_at_us: Some(None),
                ..patch()
            };
            let from = [RunState::Worse];
            insert_with(&db, of_flow("r3")).await.unwrap();
            let revived =
                set_state_with(&db, "acme", "r1", &from, RunState::Investigating, patch()).await;
            assert!(unique(&revived), "{backend}: {revived:?}");
            let r3_from = [RunState::Investigating];
            set_state_with(&db, "acme", "r3", &r3_from, RunState::Failed, patch())
                .await
                .unwrap();
            assert!(
                set_state_with(&db, "acme", "r1", &from, RunState::Investigating, cleared)
                    .await
                    .unwrap()
            );
            let row = Entity::find_by_id("r1").one(&db).await.unwrap().unwrap();
            let left = (
                row.chosen_option_id,
                row.approved_by,
                row.approved_at_us,
                row.outcome_verdict,
                row.outcome_explanation,
                row.error,
                row.ended_at_us,
            );
            assert_eq!(
                left,
                (None, None, None, None, None, None, None),
                "{backend}"
            );
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn list_with_narrows_by_connection_and_goal() {
        for (backend, db, schema) in backends().await {
            for (id, goal, chosen) in [
                ("r1", "Restart the stuck pod", "[]"),
                ("r2", "cut 50% of traffic", "[]"),
                ("r3", "cut 500 of traffic", "[]"),
                ("r4", "look at the queue", r#"["Z","X"]"#),
            ] {
                let run = NewRun {
                    goal: goal.into(),
                    connection_ids: chosen.into(),
                    ..new_run(id)
                };
                insert_with(&db, run).await.unwrap();
            }
            let step = autoresolve_steps::ActiveModel {
                id: Set("s1".into()),
                org: Set("acme".into()),
                run_id: Set("r1".into()),
                revision: Set(1),
                seq: Set(1),
                kind: Set("change".into()),
                connection_id: Set("X".into()),
                connection_name: Set("x".into()),
                tool: Set("restart".into()),
                arguments: Set("{}".into()),
                refs: Set("[]".into()),
                args_hash: Set("h".into()),
                reason: Set("r".into()),
                tool_def_hash: Set("d".into()),
                state: Set("proposed".into()),
                created_at_us: Set(1),
                ..Default::default()
            };
            step.insert(&db).await.unwrap();
            let by_connection = |c: &str| RunFilter {
                connection_id: Some(c.into()),
                ..Default::default()
            };
            let by_goal = |q: &str| RunFilter {
                q: Some(q.into()),
                ..Default::default()
            };
            let cases = [
                (by_connection("X"), vec!["r4"]),
                (by_connection("Y"), vec![]),
                (by_goal("RESTART"), vec!["r1"]),
                (by_goal("50%"), vec!["r2"]),
            ];
            for (filter, want) in cases {
                let (rows, total) = list_with(&db, "acme", &filter, 0, 10).await.unwrap();
                let ids: Vec<String> = rows.into_iter().map(|m| m.id).collect();
                assert_eq!(ids, want, "{backend} {filter:?}");
                assert_eq!(total, want.len() as u64, "{backend} {filter:?}");
            }
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn list_waiting_past_deadline_returns_only_overdue_waiting_runs() {
        for (backend, db, schema) in backends().await {
            waiting(&db, "overdue", "default", NOW - 1).await;
            waiting(&db, "future", "default", NOW + 1).await;
            waiting(&db, "moved_on", "default", NOW - 1).await;
            waiting(&db, "elsewhere", "other", NOW - 1).await;
            let from = [RunState::WaitingApproval];
            let patch = RunPatch {
                updated_at_us: NOW,
                ..Default::default()
            };
            assert!(
                set_state_with(&db, "acme", "moved_on", &from, RunState::Proceeding, patch)
                    .await
                    .unwrap()
            );
            let ids: Vec<String> = list_waiting_past_deadline_with(&db, "default", NOW, 10)
                .await
                .unwrap()
                .into_iter()
                .map(|m| m.id)
                .collect();
            assert_eq!(ids, vec!["overdue".to_string()], "{backend}");
            drop_schema(schema).await;
        }
    }
}
