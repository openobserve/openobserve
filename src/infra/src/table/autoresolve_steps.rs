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

//! `autoresolve_steps`: the planned tool calls of a run; a step is consumed at most once.

use std::collections::{HashMap, HashSet};

use config::meta::autoresolve::StepState;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
    sea_query::{Expr, Query},
};

use super::entity::{
    autoresolve_runs,
    autoresolve_steps::{ActiveModel, Column, Entity, Model},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

/// Ids per `IN` list, so a long list stays inside one query's parameter budget.
const ID_CHUNK: usize = 1000;
/// Rows read before one per connection and run is kept; a busy connection repeats runs.
const CHANGED_ROWS_READ: u64 = 200;

/// The row a plan step is inserted as.
#[derive(Debug, Clone)]
pub struct NewStep {
    pub id: String,
    pub org: String,
    pub run_id: String,
    pub revision: i32,
    /// `None` for a held step, which belongs to no option.
    pub option_id: Option<String>,
    pub seq: i32,
    pub kind: String,
    pub connection_id: String,
    pub connection_name: String,
    pub tool: String,
    pub arguments: String,
    pub refs: String,
    pub args_hash: String,
    pub reason: String,
    pub preview: Option<String>,
    pub tool_def_hash: String,
    pub connection_fingerprint: Option<String>,
    pub state: StepState,
    pub result: Option<String>,
    pub result_raw: Option<String>,
    pub consumed_at_us: Option<i64>,
    pub finished_at_us: Option<i64>,
    pub created_at_us: i64,
}

/// What a step must still match at the moment it is consumed.
#[derive(Debug, Clone)]
pub struct ConsumePins {
    pub args_hash: String,
    pub tool: String,
    pub connection_id: String,
    pub tool_def_hash: String,
    pub connection_fingerprint: String,
}

pub async fn list_for_run(org: &str, run_id: &str) -> Result<Vec<Model>, Error> {
    list_for_run_with(get_orm_client_ro().await, org, run_id).await
}

pub async fn list_for_run_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    run_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::RunId.eq(run_id))
        .order_by_asc(Column::Revision)
        .order_by_asc(Column::Seq)
        .order_by_asc(Column::Id)
        .all(conn)
        .await?)
}

/// Steps of `region`'s runs that started before the cutoff and never finished, oldest first.
pub async fn list_running_since_before_with<C: ConnectionTrait>(
    conn: &C,
    region: &str,
    cutoff_us: i64,
    limit: u64,
) -> Result<Vec<Model>, Error> {
    let in_region = Query::select()
        .column(autoresolve_runs::Column::Id)
        .from(autoresolve_runs::Entity)
        .and_where(autoresolve_runs::Column::Region.eq(region))
        .to_owned();
    Ok(Entity::find()
        .filter(Column::State.eq(StepState::Running.as_str()))
        .filter(Column::ConsumedAtUs.lt(cutoff_us))
        .filter(Column::RunId.in_subquery(in_region))
        .order_by_asc(Column::ConsumedAtUs)
        .limit(limit)
        .all(conn)
        .await?)
}

/// Other runs' steps on `connection_ids` sent at or after `since_us` that may have changed
/// something, one per connection and run, newest first, at most `limit`.
pub async fn changed_since_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    run_id: &str,
    connection_ids: &[String],
    since_us: i64,
    limit: usize,
) -> Result<Vec<Model>, Error> {
    let changed = [
        StepState::Running,
        StepState::Done,
        StepState::OutcomeUnknown,
    ];
    let rows = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::RunId.ne(run_id))
        .filter(Column::ConnectionId.is_in(connection_ids.iter().take(ID_CHUNK).cloned()))
        .filter(Column::ConsumedAtUs.gte(since_us))
        .filter(Column::State.is_in(changed.map(|s| s.as_str())))
        .order_by_desc(Column::ConsumedAtUs)
        .order_by_desc(Column::Id)
        .limit(CHANGED_ROWS_READ)
        .all(conn)
        .await?;
    let mut seen = HashSet::new();
    Ok(rows
        .into_iter()
        .filter(|s| seen.insert((s.connection_id.clone(), s.run_id.clone())))
        .take(limit)
        .collect())
}

/// The (run, revision) pairs of `run_ids` with at least one step that was sent.
pub async fn sent_revisions(
    org: &str,
    run_ids: &[String],
) -> Result<HashSet<(String, i32)>, Error> {
    sent_revisions_with(get_orm_client_ro().await, org, run_ids).await
}

pub async fn sent_revisions_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    run_ids: &[String],
) -> Result<HashSet<(String, i32)>, Error> {
    let mut sent = HashSet::new();
    for chunk in run_ids.chunks(ID_CHUNK) {
        let pairs: Vec<(String, i32)> = Entity::find()
            .select_only()
            .column(Column::RunId)
            .column(Column::Revision)
            .distinct()
            .filter(Column::Org.eq(org))
            .filter(Column::RunId.is_in(chunk.to_vec()))
            .filter(Column::ConsumedAtUs.is_not_null())
            .into_tuple()
            .all(conn)
            .await?;
        sent.extend(pairs);
    }
    Ok(sent)
}

pub async fn delete_by_org(org: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected)
}

pub async fn insert_many<C: ConnectionTrait>(conn: &C, steps: Vec<NewStep>) -> Result<(), Error> {
    for step in steps {
        ActiveModel {
            id: Set(step.id),
            org: Set(step.org),
            run_id: Set(step.run_id),
            revision: Set(step.revision),
            option_id: Set(step.option_id),
            seq: Set(step.seq),
            kind: Set(step.kind),
            connection_id: Set(step.connection_id),
            connection_name: Set(step.connection_name),
            tool: Set(step.tool),
            arguments: Set(step.arguments),
            refs: Set(step.refs),
            args_hash: Set(step.args_hash),
            reason: Set(step.reason),
            preview: Set(step.preview),
            tool_def_hash: Set(step.tool_def_hash),
            connection_fingerprint: Set(step.connection_fingerprint),
            state: Set(step.state.as_str().to_string()),
            result: Set(step.result),
            result_raw: Set(step.result_raw),
            error: Set(None),
            consumed_at_us: Set(step.consumed_at_us),
            finished_at_us: Set(step.finished_at_us),
            created_at_us: Set(step.created_at_us),
        }
        .insert(conn)
        .await?;
    }
    Ok(())
}

/// Approves the chosen option's proposed steps of `revision`, pinning each to its connection's
/// fingerprint, and supersedes the other options' proposed steps; returns how many were approved.
pub async fn approve_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    run_id: &str,
    revision: i32,
    option_id: &str,
    fingerprints: &HashMap<String, String>,
) -> Result<u64, Error> {
    let proposed = || {
        Entity::update_many()
            .filter(Column::Org.eq(org))
            .filter(Column::RunId.eq(run_id))
            .filter(Column::Revision.eq(revision))
            .filter(Column::State.eq(StepState::Proposed.as_str()))
    };
    let mut approved = 0;
    for (connection_id, fingerprint) in fingerprints {
        let res = proposed()
            .col_expr(Column::State, Expr::value(StepState::Approved.as_str()))
            .col_expr(
                Column::ConnectionFingerprint,
                Expr::value(fingerprint.as_str()),
            )
            .filter(Column::OptionId.eq(option_id))
            .filter(Column::ConnectionId.eq(connection_id.as_str()))
            .exec(conn)
            .await?;
        approved += res.rows_affected;
    }
    proposed()
        .col_expr(Column::State, Expr::value(StepState::Superseded.as_str()))
        .filter(Column::OptionId.ne(option_id))
        .exec(conn)
        .await?;
    Ok(approved)
}

/// Starts an approved step once, and only while every pin still matches; false otherwise.
pub async fn consume_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    step_id: &str,
    pins: &ConsumePins,
    now_us: i64,
) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::State, Expr::value(StepState::Running.as_str()))
        .col_expr(Column::ConsumedAtUs, Expr::value(now_us))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(step_id))
        .filter(Column::State.eq(StepState::Approved.as_str()))
        .filter(Column::ConsumedAtUs.is_null())
        .filter(Column::ArgsHash.eq(pins.args_hash.as_str()))
        .filter(Column::Tool.eq(pins.tool.as_str()))
        .filter(Column::ConnectionId.eq(pins.connection_id.as_str()))
        .filter(Column::ToolDefHash.eq(pins.tool_def_hash.as_str()))
        .filter(Column::ConnectionFingerprint.eq(pins.connection_fingerprint.as_str()))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Ends a running step; false when it was not running.
#[allow(clippy::too_many_arguments)]
pub async fn finish<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    step_id: &str,
    to: StepState,
    result: Option<String>,
    result_raw: Option<String>,
    error: Option<String>,
    now_us: i64,
) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::State, Expr::value(to.as_str()))
        .col_expr(Column::Result, Expr::value(result))
        .col_expr(Column::ResultRaw, Expr::value(result_raw))
        .col_expr(Column::Error, Expr::value(error))
        .col_expr(Column::FinishedAtUs, Expr::value(now_us))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(step_id))
        .filter(Column::State.eq(StepState::Running.as_str()))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Fails an approved step before its call was sent; false when it was not approved.
pub async fn fail_unsent<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    step_id: &str,
    error: &str,
    now_us: i64,
) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::State, Expr::value(StepState::Failed.as_str()))
        .col_expr(Column::Error, Expr::value(error))
        .col_expr(Column::FinishedAtUs, Expr::value(now_us))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(step_id))
        .filter(Column::State.eq(StepState::Approved.as_str()))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Moves the steps that are in one of `from`; returns how many moved.
pub async fn set_many<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    ids: &[String],
    from: &[StepState],
    to: StepState,
) -> Result<u64, Error> {
    let from: Vec<&str> = from.iter().map(StepState::as_str).collect();
    let mut moved = 0;
    for chunk in ids.chunks(ID_CHUNK) {
        let res = Entity::update_many()
            .col_expr(Column::State, Expr::value(to.as_str()))
            .filter(Column::Org.eq(org))
            .filter(Column::Id.is_in(chunk.to_vec()))
            .filter(Column::State.is_in(from.clone()))
            .exec(conn)
            .await?;
        moved += res.rows_affected;
    }
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use config::meta::autoresolve::StepState;
    use sea_orm::EntityTrait;

    use super::*;
    use crate::table::{
        autoresolve_test_support::{backends, drop_schema},
        entity::autoresolve_steps::Entity,
    };

    const NOW: i64 = 1_000_000_000_000;

    type Mutation = fn(&mut ConsumePins);

    fn pins() -> ConsumePins {
        ConsumePins {
            args_hash: "h1".into(),
            tool: "restart".into(),
            connection_id: "c1".into(),
            tool_def_hash: "d1".into(),
            connection_fingerprint: "f1".into(),
        }
    }

    fn approved_step(id: &str) -> NewStep {
        NewStep {
            id: id.into(),
            org: "acme".into(),
            run_id: "r1".into(),
            revision: 1,
            option_id: Some("A".into()),
            seq: 1,
            kind: "change".into(),
            connection_id: "c1".into(),
            connection_name: "prod".into(),
            tool: "restart".into(),
            arguments: "{}".into(),
            refs: "[]".into(),
            args_hash: "h1".into(),
            reason: "stuck pod".into(),
            preview: None,
            tool_def_hash: "d1".into(),
            connection_fingerprint: Some("f1".into()),
            state: StepState::Approved,
            result: None,
            result_raw: None,
            consumed_at_us: None,
            finished_at_us: None,
            created_at_us: 1,
        }
    }

    #[tokio::test]
    async fn consume_with_marks_a_step_used_once() {
        for (backend, db, schema) in backends().await {
            insert_many(&db, vec![approved_step("s1")]).await.unwrap();
            assert!(
                consume_with(&db, "acme", "s1", &pins(), NOW).await.unwrap(),
                "{backend}"
            );
            assert!(
                !consume_with(&db, "acme", "s1", &pins(), NOW + 1)
                    .await
                    .unwrap(),
                "{backend}"
            );
            let row = Entity::find_by_id("s1").one(&db).await.unwrap().unwrap();
            assert_eq!(row.state, "running", "{backend}");
            assert_eq!(row.consumed_at_us, Some(NOW), "{backend}");
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn step_rows_say_which_runs_sent_changes() {
        let step = |id: &str, run: &str, conn: &str, state: StepState, sent: Option<i64>| NewStep {
            run_id: run.into(),
            connection_id: conn.into(),
            state,
            consumed_at_us: sent,
            ..approved_step(id)
        };
        let rows = vec![
            step("mine", "r1", "c1", StepState::Done, Some(NOW + 5)),
            step("before", "r2", "c1", StepState::Done, Some(NOW - 1)),
            step("failed", "r3", "c1", StepState::Failed, Some(NOW + 1)),
            step("elsewhere", "r4", "c9", StepState::Done, Some(NOW + 1)),
            step("unsent", "r5", "c1", StepState::Approved, None),
            step("r6-first", "r6", "c1", StepState::Done, Some(NOW + 2)),
            step("r6-last", "r6", "c1", StepState::Done, Some(NOW + 3)),
            step("r7", "r7", "c2", StepState::OutcomeUnknown, Some(NOW + 4)),
        ];
        let connections = ["c1".to_string(), "c2".to_string()];
        for (backend, db, schema) in backends().await {
            insert_many(&db, rows.clone()).await.unwrap();
            let changed = changed_since_with(&db, "acme", "r1", &connections, NOW, 10)
                .await
                .unwrap();
            let ids: Vec<&str> = changed.iter().map(|s| s.id.as_str()).collect();
            assert_eq!(ids, ["r7", "r6-last"], "{backend}");
            let runs = ["r1".to_string(), "r5".to_string()];
            let sent = sent_revisions_with(&db, "acme", &runs).await.unwrap();
            assert_eq!(sent, HashSet::from([("r1".to_string(), 1)]), "{backend}");
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn consume_with_refuses_mismatched_pins() {
        let mutate: [(&str, Mutation); 5] = [
            ("args_hash", |p| p.args_hash = "x".into()),
            ("tool", |p| p.tool = "x".into()),
            ("connection_id", |p| p.connection_id = "x".into()),
            ("tool_def_hash", |p| p.tool_def_hash = "x".into()),
            ("connection_fingerprint", |p| {
                p.connection_fingerprint = "x".into()
            }),
        ];
        for (backend, db, schema) in backends().await {
            insert_many(&db, vec![approved_step("s1")]).await.unwrap();
            for (field, change) in mutate {
                let mut wrong = pins();
                change(&mut wrong);
                assert!(
                    !consume_with(&db, "acme", "s1", &wrong, NOW).await.unwrap(),
                    "{backend} {field}"
                );
                let row = Entity::find_by_id("s1").one(&db).await.unwrap().unwrap();
                assert_eq!(row.state, "approved", "{backend} {field}");
                assert_eq!(row.consumed_at_us, None, "{backend} {field}");
            }
            drop_schema(schema).await;
        }
    }
}
