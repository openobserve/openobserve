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

//! Persistence for `config::meta::eval_job_health`; the decisions live there.

use config::meta::eval_job_health::{
    EvalJobHealth, EvalJobLastError, EvalJobState, EvalJobStateTransition, EvalJobStateUpdate,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait,
    sea_query::OnConflict,
};

use super::entity::{eval_job_state_transitions, eval_job_states};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// Stored health for a batch of jobs; never-measured jobs are absent.
pub async fn get_many(job_ids: &[String]) -> Result<Vec<EvalJobState>, errors::Error> {
    let client = get_orm_client_ro().await;
    get_many_with(client, job_ids).await
}

pub async fn get_many_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    job_ids: &[String],
) -> Result<Vec<EvalJobState>, errors::Error> {
    if job_ids.is_empty() {
        return Ok(vec![]);
    }
    Ok(eval_job_states::Entity::find()
        .filter(eval_job_states::Column::JobId.is_in(job_ids.to_vec()))
        .all(conn)
        .await?
        .into_iter()
        .filter_map(state_from_model)
        .collect())
}

/// Writes the state and its transition in one transaction so `since` and the log never disagree.
pub async fn persist(update: &EvalJobStateUpdate) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    persist_with(client, update).await
}

pub async fn persist_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    update: &EvalJobStateUpdate,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    upsert_state(&txn, &update.state).await?;
    if let Some(transition) = update.transition.as_ref() {
        insert_transition(&txn, transition).await?;
    }
    txn.commit().await?;
    Ok(())
}

pub async fn delete_by_job(job_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_job_with(client, job_id).await
}

pub async fn delete_by_job_with<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    job_id: &str,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    eval_job_states::Entity::delete_many()
        .filter(eval_job_states::Column::JobId.eq(job_id))
        .exec(&txn)
        .await?;
    eval_job_state_transitions::Entity::delete_many()
        .filter(eval_job_state_transitions::Column::JobId.eq(job_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

/// Returns the number of transitions deleted.
pub async fn delete_transitions_before(cutoff: i64) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    Ok(eval_job_state_transitions::Entity::delete_many()
        .filter(eval_job_state_transitions::Column::At.lt(cutoff))
        .exec(client)
        .await?
        .rows_affected)
}

/// An unknown `health` id reads as never measured rather than failing the list.
fn state_from_model(m: eval_job_states::Model) -> Option<EvalJobState> {
    let last_error = match (m.last_error_kind, m.last_error_at) {
        (Some(kind), Some(at)) => Some(EvalJobLastError {
            kind,
            message: m.last_error_message.unwrap_or_default(),
            at,
        }),
        _ => None,
    };
    Some(EvalJobState {
        job_id: m.job_id,
        org_id: m.org_id,
        health: EvalJobHealth::from_i32(m.health)?,
        since: m.since,
        evaluated_at: m.evaluated_at,
        recent_runs: count_from_db(m.recent_runs),
        recent_errors: count_from_db(m.recent_errors),
        scores_24h: count_from_db(m.scores_24h),
        last_success_at: m.last_success_at,
        last_error,
    })
}

fn count_from_db(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn count_to_db(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

async fn upsert_state<C: sea_orm::ConnectionTrait>(
    conn: &C,
    state: &EvalJobState,
) -> Result<(), errors::Error> {
    let model = eval_job_states::ActiveModel {
        job_id: Set(state.job_id.clone()),
        org_id: Set(state.org_id.clone()),
        health: Set(state.health.to_i32()),
        since: Set(state.since),
        evaluated_at: Set(state.evaluated_at),
        recent_runs: Set(count_to_db(state.recent_runs)),
        recent_errors: Set(count_to_db(state.recent_errors)),
        scores_24h: Set(count_to_db(state.scores_24h)),
        last_success_at: Set(state.last_success_at),
        last_error_kind: Set(state.last_error.as_ref().map(|e| e.kind.clone())),
        last_error_message: Set(state.last_error.as_ref().map(|e| e.message.clone())),
        last_error_at: Set(state.last_error.as_ref().map(|e| e.at)),
    };
    eval_job_states::Entity::insert(model)
        .on_conflict(
            OnConflict::column(eval_job_states::Column::JobId)
                .update_columns([
                    eval_job_states::Column::Health,
                    eval_job_states::Column::Since,
                    eval_job_states::Column::EvaluatedAt,
                    eval_job_states::Column::RecentRuns,
                    eval_job_states::Column::RecentErrors,
                    eval_job_states::Column::Scores24h,
                    eval_job_states::Column::LastSuccessAt,
                    eval_job_states::Column::LastErrorKind,
                    eval_job_states::Column::LastErrorMessage,
                    eval_job_states::Column::LastErrorAt,
                ])
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

async fn insert_transition<C: sea_orm::ConnectionTrait>(
    conn: &C,
    t: &EvalJobStateTransition,
) -> Result<(), errors::Error> {
    eval_job_state_transitions::ActiveModel {
        job_id: Set(t.job_id.clone()),
        org_id: Set(t.org_id.clone()),
        from_health: Set(t.from_health.map(EvalJobHealth::to_i32)),
        to_health: Set(t.to_health.to_i32()),
        at: Set(t.at),
        ..Default::default()
    }
    .insert(conn)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::eval_job_health::{EvalJobHealthObservation, apply_health};
    use sea_orm::{EntityTrait, PaginatorTrait};

    use super::*;

    async fn db() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectionTrait, Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(eval_job_states::Entity),
            schema.create_table_from_entity(eval_job_state_transitions::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    fn observed(health: EvalJobHealth) -> EvalJobHealthObservation {
        EvalJobHealthObservation {
            health,
            recent_runs: 10,
            recent_errors: 3,
            scores_24h: 40,
            last_success_at: Some(90),
            last_error: Some(EvalJobLastError {
                kind: "provider_auth".to_string(),
                message: "401 Unauthorized".to_string(),
                at: 95,
            }),
        }
    }

    async fn pass(
        db: &sea_orm::DatabaseConnection,
        job_id: &str,
        health: EvalJobHealth,
        at: i64,
    ) -> EvalJobState {
        let prev = get_many_with(db, &[job_id.to_string()])
            .await
            .unwrap()
            .pop();
        let update = apply_health(job_id, "org", prev.as_ref(), observed(health), at);
        persist_with(db, &update).await.unwrap();
        get_many_with(db, &[job_id.to_string()])
            .await
            .unwrap()
            .pop()
            .expect("row written")
    }

    #[tokio::test]
    async fn passes_round_trip_and_log_only_changes() {
        let db = db().await;
        let first = pass(&db, "job-1", EvalJobHealth::Healthy, 100).await;
        let steady = pass(&db, "job-1", EvalJobHealth::Healthy, 200).await;
        let changed = pass(&db, "job-1", EvalJobHealth::WaitingForCredentials, 300).await;

        assert_eq!(first.since, 100);
        assert_eq!(steady.since, 100);
        assert_eq!(steady.evaluated_at, 200);
        assert_eq!(changed.health, EvalJobHealth::WaitingForCredentials);
        assert_eq!(changed.since, 300);
        assert_eq!(
            changed.last_error,
            observed(EvalJobHealth::Healthy).last_error
        );
        assert_eq!(
            eval_job_state_transitions::Entity::find()
                .count(&db)
                .await
                .unwrap(),
            2,
            "a steady pass must not log a transition"
        );
    }

    #[tokio::test]
    async fn cleared_error_is_cleared_on_the_row() {
        let db = db().await;
        pass(&db, "job-1", EvalJobHealth::Degraded, 100).await;
        let update = apply_health(
            "job-1",
            "org",
            None,
            EvalJobHealthObservation::no_runs(),
            200,
        );
        persist_with(&db, &update).await.unwrap();
        let row = get_many_with(&db, &["job-1".to_string()])
            .await
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(row.health, EvalJobHealth::NoRecentRuns);
        assert_eq!(row.last_error, None);
        assert_eq!(row.last_success_at, None);
    }

    #[tokio::test]
    async fn unknown_health_reads_as_never_measured() {
        let db = db().await;
        pass(&db, "job-1", EvalJobHealth::Healthy, 100).await;
        eval_job_states::Entity::update_many()
            .col_expr(
                eval_job_states::Column::Health,
                sea_orm::sea_query::Expr::value(99),
            )
            .exec(&db)
            .await
            .unwrap();
        assert!(
            get_many_with(&db, &["job-1".to_string()])
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn delete_by_job_removes_only_that_job() {
        let db = db().await;
        pass(&db, "job-1", EvalJobHealth::Healthy, 100).await;
        pass(&db, "job-2", EvalJobHealth::Healthy, 100).await;
        delete_by_job_with(&db, "job-1").await.unwrap();

        let ids = ["job-1".to_string(), "job-2".to_string()];
        let left = get_many_with(&db, &ids).await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].job_id, "job-2");
        assert_eq!(
            eval_job_state_transitions::Entity::find()
                .count(&db)
                .await
                .unwrap(),
            1
        );
    }
}
