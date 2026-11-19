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

use std::str::FromStr;

use config::meta::oncall::SubjectRef;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
    sea_query::{Expr, OnConflict},
};
use sha2::{Digest, Sha256};

use super::entity::rca_delivery_obligations::{ActiveModel, Column, Entity, Model};
use crate::db::get_orm_client_rw;

pub const OUTCOME_DELIVERED: &str = "delivered";
pub const OUTCOME_NO_VERDICT: &str = "no_verdict";
pub const OUTCOME_GENERATION_MISMATCH: &str = "generation_mismatch";
pub const OUTCOME_RECORD_GONE: &str = "record_gone";

#[derive(Debug, Clone)]
pub struct Recipient {
    pub response_id: String,
    pub subject: SubjectRef,
    pub ladder_run: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObligationKind {
    Verdict,
    NoVerdict,
}

impl ObligationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Verdict => "verdict",
            Self::NoVerdict => "no_verdict",
        }
    }
}

impl FromStr for ObligationKind {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "verdict" => Ok(Self::Verdict),
            "no_verdict" => Ok(Self::NoVerdict),
            _ => Err(format!("unknown obligation kind: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObligationState {
    Armed,
    Pending,
    Done,
}

impl ObligationState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Armed => "armed",
            Self::Pending => "pending",
            Self::Done => "done",
        }
    }
}

impl FromStr for ObligationState {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "armed" => Ok(Self::Armed),
            "pending" => Ok(Self::Pending),
            "done" => Ok(Self::Done),
            _ => Err(format!("unknown obligation state: {value}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Obligation {
    pub id: String,
    pub org_id: String,
    pub run_id: String,
    pub response_id: String,
    pub subject: SubjectRef,
    pub ladder_run: i32,
    pub kind: Option<ObligationKind>,
    pub state: ObligationState,
    pub attempts: i32,
    pub next_attempt_at_us: i64,
}

pub fn obligation_id(org_id: &str, run_id: &str, response_id: &str) -> String {
    let key = format!("{org_id}|{run_id}|{response_id}");
    hex::encode(Sha256::digest(key.as_bytes()))
}

/// Repeated arming preserves each recipient's original generation and delivery state.
pub async fn arm_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
    recipients: &[Recipient],
    now_us: i64,
) -> Result<(), DbErr> {
    for recipient in recipients {
        let subject = serde_json::to_string(&recipient.subject)
            .map_err(|error| DbErr::Custom(error.to_string()))?;
        Entity::insert(ActiveModel {
            id: Set(obligation_id(org_id, run_id, &recipient.response_id)),
            org_id: Set(org_id.to_string()),
            run_id: Set(run_id.to_string()),
            response_id: Set(recipient.response_id.clone()),
            subject: Set(subject),
            ladder_run: Set(recipient.ladder_run),
            kind: Set(None),
            state: Set(ObligationState::Armed.as_str().to_string()),
            attempts: Set(0),
            next_attempt_at: Set(now_us),
            outcome: Set(None),
            created_at: Set(now_us),
            updated_at: Set(now_us),
        })
        .on_conflict(OnConflict::column(Column::Id).do_nothing().to_owned())
        .exec_without_returning(conn)
        .await?;
    }
    Ok(())
}

/// Settles only armed rows inside the run's terminal-transition transaction.
pub async fn settle_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
    kind: ObligationKind,
    now_us: i64,
) -> Result<u64, DbErr> {
    Ok(Entity::update_many()
        .col_expr(
            Column::State,
            Expr::value(ObligationState::Pending.as_str()),
        )
        .col_expr(Column::Kind, Expr::value(kind.as_str()))
        .col_expr(Column::NextAttemptAt, Expr::value(now_us))
        .col_expr(Column::UpdatedAt, Expr::value(now_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .filter(Column::State.eq(ObligationState::Armed.as_str()))
        .exec(conn)
        .await?
        .rows_affected)
}

/// Replaces a withheld verdict only while delivery remains pending.
pub async fn convert_pending_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
    kind: ObligationKind,
    now_us: i64,
) -> Result<u64, DbErr> {
    Ok(Entity::update_many()
        .col_expr(Column::Kind, Expr::value(kind.as_str()))
        .col_expr(Column::UpdatedAt, Expr::value(now_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .filter(Column::State.eq(ObligationState::Pending.as_str()))
        .exec(conn)
        .await?
        .rows_affected)
}

pub async fn due(now_us: i64, limit: u64) -> Result<Vec<Obligation>, DbErr> {
    due_in(get_orm_client_rw().await, now_us, limit).await
}

pub async fn for_run(org_id: &str, run_id: &str) -> Result<Vec<Obligation>, DbErr> {
    for_run_in(get_orm_client_rw().await, org_id, run_id).await
}

/// Only the caller that changes a pending row to done receives `true`.
pub async fn mark_done(org_id: &str, id: &str, outcome: &str, now_us: i64) -> Result<bool, DbErr> {
    mark_done_in(get_orm_client_rw().await, org_id, id, outcome, now_us).await
}

pub async fn retry_later(
    org_id: &str,
    id: &str,
    next_attempt_at_us: i64,
    now_us: i64,
) -> Result<(), DbErr> {
    retry_later_in(
        get_orm_client_rw().await,
        org_id,
        id,
        next_attempt_at_us,
        now_us,
    )
    .await
}

pub async fn pending_count() -> Result<u64, DbErr> {
    pending_count_in(get_orm_client_rw().await).await
}

pub async fn delete_for_runs_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_ids: &[String],
) -> Result<(), DbErr> {
    if run_ids.is_empty() {
        return Ok(());
    }
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.is_in(run_ids.iter().map(String::as_str)))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_org(org_id: &str) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

async fn due_in<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    limit: u64,
) -> Result<Vec<Obligation>, DbErr> {
    Ok(Entity::find()
        .filter(Column::State.eq(ObligationState::Pending.as_str()))
        .filter(Column::NextAttemptAt.lte(now_us))
        .order_by_asc(Column::NextAttemptAt)
        .order_by_asc(Column::Id)
        .limit(limit)
        .all(conn)
        .await?
        .into_iter()
        .filter_map(to_obligation)
        .collect())
}

async fn for_run_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    run_id: &str,
) -> Result<Vec<Obligation>, DbErr> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::RunId.eq(run_id))
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::Id)
        .all(conn)
        .await?
        .into_iter()
        .filter_map(to_obligation)
        .collect())
}

async fn mark_done_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    outcome: &str,
    now_us: i64,
) -> Result<bool, DbErr> {
    let result = Entity::update_many()
        .col_expr(Column::State, Expr::value(ObligationState::Done.as_str()))
        .col_expr(Column::Outcome, Expr::value(outcome))
        .col_expr(Column::UpdatedAt, Expr::value(now_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::State.eq(ObligationState::Pending.as_str()))
        .exec(conn)
        .await?;
    Ok(result.rows_affected > 0)
}

async fn retry_later_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    next_attempt_at_us: i64,
    now_us: i64,
) -> Result<(), DbErr> {
    Entity::update_many()
        .col_expr(Column::Attempts, Expr::col(Column::Attempts).add(1))
        .col_expr(Column::NextAttemptAt, Expr::value(next_attempt_at_us))
        .col_expr(Column::UpdatedAt, Expr::value(now_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::State.eq(ObligationState::Pending.as_str()))
        .exec(conn)
        .await?;
    Ok(())
}

async fn pending_count_in<C: ConnectionTrait>(conn: &C) -> Result<u64, DbErr> {
    Entity::find()
        .filter(Column::State.eq(ObligationState::Pending.as_str()))
        .count(conn)
        .await
}

fn to_obligation(row: Model) -> Option<Obligation> {
    let subject = match serde_json::from_str(&row.subject) {
        Ok(subject) => subject,
        Err(error) => {
            log::warn!(
                "[RCA_DELIVERY_OBLIGATIONS] row {} has invalid subject: {error}",
                row.id
            );
            return None;
        }
    };
    let state = match ObligationState::from_str(&row.state) {
        Ok(state) => state,
        Err(error) => {
            log::warn!(
                "[RCA_DELIVERY_OBLIGATIONS] row {} has invalid state: {error}",
                row.id
            );
            return None;
        }
    };
    let kind = match row
        .kind
        .as_deref()
        .map(ObligationKind::from_str)
        .transpose()
    {
        Ok(kind) => kind,
        Err(error) => {
            log::warn!(
                "[RCA_DELIVERY_OBLIGATIONS] row {} has invalid kind: {error}",
                row.id
            );
            return None;
        }
    };
    Some(Obligation {
        id: row.id,
        org_id: row.org_id,
        run_id: row.run_id,
        response_id: row.response_id,
        subject,
        ladder_run: row.ladder_run,
        kind,
        state,
        attempts: row.attempts,
        next_attempt_at_us: row.next_attempt_at,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::SubjectType;
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    const ORG: &str = "acme";
    const RUN: &str = "run_1";

    async fn db() -> DatabaseConnection {
        let mut options = ConnectOptions::new("sqlite::memory:".to_string());
        options.max_connections(1);
        let db = Database::connect(options).await.unwrap();
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&table)).await.unwrap();
        db
    }

    fn recipient(response_id: &str) -> Recipient {
        Recipient {
            response_id: response_id.to_string(),
            subject: SubjectRef::new(SubjectType::Incident, "incident_1", 1),
            ladder_run: 2,
        }
    }

    async fn stored(db: &DatabaseConnection, response_id: &str) -> Model {
        Entity::find_by_id(obligation_id(ORG, RUN, response_id))
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn arming_twice_preserves_one_row_per_recipient() {
        let db = db().await;
        let recipients = [recipient("response_1"), recipient("response_2")];
        arm_in(&db, ORG, RUN, &recipients, 10).await.unwrap();
        arm_in(&db, ORG, RUN, &recipients, 20).await.unwrap();
        assert_eq!(Entity::find().count(&db).await.unwrap(), 2);
        let rows = for_run_in(&db, ORG, RUN).await.unwrap();
        assert_eq!(rows.len(), 2);
        for row in rows {
            assert_eq!(row.subject, recipients[0].subject);
            assert_eq!(row.ladder_run, 2);
            assert_eq!(row.kind, None);
            assert_eq!(row.state, ObligationState::Armed);
            assert_eq!(row.attempts, 0);
            assert_eq!(row.next_attempt_at_us, 10);
            assert_eq!(row.id.len(), 64);
        }
        assert_ne!(
            obligation_id(ORG, RUN, "response_1"),
            obligation_id("other", RUN, "response_1")
        );
        assert_eq!(stored(&db, "response_1").await.created_at, 10);
        assert_eq!(stored(&db, "response_1").await.updated_at, 10);
    }

    #[tokio::test]
    async fn settling_is_scoped_and_repeated_settlement_preserves_pending_and_done_rows() {
        let db = db().await;
        arm_in(
            &db,
            ORG,
            RUN,
            &[recipient("done"), recipient("pending")],
            10,
        )
        .await
        .unwrap();
        arm_in(&db, ORG, "other_run", &[recipient("other_run")], 10)
            .await
            .unwrap();
        arm_in(&db, "other", RUN, &[recipient("other_org")], 10)
            .await
            .unwrap();
        assert_eq!(
            settle_in(&db, ORG, RUN, ObligationKind::Verdict, 20)
                .await
                .unwrap(),
            2
        );
        let done_id = obligation_id(ORG, RUN, "done");
        assert!(
            mark_done_in(&db, ORG, &done_id, OUTCOME_DELIVERED, 21)
                .await
                .unwrap()
        );
        assert_eq!(
            settle_in(&db, ORG, RUN, ObligationKind::NoVerdict, 22)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            convert_pending_in(&db, ORG, RUN, ObligationKind::NoVerdict, 23)
                .await
                .unwrap(),
            1
        );
        let done = stored(&db, "done").await;
        assert_eq!(done.state, "done");
        assert_eq!(done.kind.as_deref(), Some("verdict"));
        let pending = stored(&db, "pending").await;
        assert_eq!(pending.state, "pending");
        assert_eq!(pending.kind.as_deref(), Some("no_verdict"));
        assert_eq!(pending.next_attempt_at, 20);
        assert_eq!(pending.updated_at, 23);
        for (org, run) in [(ORG, "other_run"), ("other", RUN)] {
            let rows = for_run_in(&db, org, run).await.unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].state, ObligationState::Armed);
            assert_eq!(rows[0].kind, None);
        }
    }

    #[tokio::test]
    async fn completion_succeeds_once_and_only_pending_rows_can_retry() {
        let db = db().await;
        arm_in(&db, ORG, RUN, &[recipient("response_1")], 10)
            .await
            .unwrap();
        let id = obligation_id(ORG, RUN, "response_1");
        assert!(
            !mark_done_in(&db, ORG, &id, OUTCOME_DELIVERED, 11)
                .await
                .unwrap()
        );
        retry_later_in(&db, ORG, &id, 100, 11).await.unwrap();
        assert_eq!(stored(&db, "response_1").await.attempts, 0);
        settle_in(&db, ORG, RUN, ObligationKind::Verdict, 20)
            .await
            .unwrap();
        assert!(
            !mark_done_in(&db, "other", &id, OUTCOME_DELIVERED, 21)
                .await
                .unwrap()
        );
        retry_later_in(&db, "other", &id, 200, 21).await.unwrap();
        assert_eq!(stored(&db, "response_1").await.attempts, 0);
        retry_later_in(&db, ORG, &id, 100, 30).await.unwrap();
        retry_later_in(&db, ORG, &id, 150, 31).await.unwrap();
        let row = stored(&db, "response_1").await;
        assert_eq!(row.attempts, 2);
        assert_eq!(row.next_attempt_at, 150);
        assert_eq!(row.updated_at, 31);
        assert!(
            mark_done_in(&db, ORG, &id, OUTCOME_DELIVERED, 40)
                .await
                .unwrap()
        );
        assert!(
            !mark_done_in(&db, ORG, &id, OUTCOME_NO_VERDICT, 41)
                .await
                .unwrap()
        );
        retry_later_in(&db, ORG, &id, 300, 42).await.unwrap();
        let row = stored(&db, "response_1").await;
        assert_eq!(row.state, "done");
        assert_eq!(row.outcome.as_deref(), Some(OUTCOME_DELIVERED));
        assert_eq!(row.attempts, 2);
        assert_eq!(row.next_attempt_at, 150);
        assert_eq!(row.updated_at, 40);
    }

    #[tokio::test]
    async fn due_orders_eligible_pending_rows_and_count_includes_future_retries() {
        let db = db().await;
        let recipients = [
            recipient("first"),
            recipient("second"),
            recipient("later"),
            recipient("done"),
        ];
        arm_in(&db, ORG, RUN, &recipients, 1).await.unwrap();
        settle_in(&db, ORG, RUN, ObligationKind::Verdict, 10)
            .await
            .unwrap();
        for (response, next_attempt) in [("first", 30), ("second", 20), ("later", 101)] {
            retry_later_in(
                &db,
                ORG,
                &obligation_id(ORG, RUN, response),
                next_attempt,
                11,
            )
            .await
            .unwrap();
        }
        mark_done_in(
            &db,
            ORG,
            &obligation_id(ORG, RUN, "done"),
            OUTCOME_DELIVERED,
            12,
        )
        .await
        .unwrap();
        arm_in(&db, ORG, "armed_run", &[recipient("armed")], 1)
            .await
            .unwrap();
        for (now, limit, expected) in [
            (19, 10, vec![]),
            (20, 10, vec!["second"]),
            (100, 1, vec!["second"]),
            (100, 10, vec!["second", "first"]),
            (100, 0, vec![]),
        ] {
            let rows = due_in(&db, now, limit).await.unwrap();
            assert_eq!(
                rows.iter()
                    .map(|row| row.response_id.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
        }
        assert_eq!(pending_count_in(&db).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn readers_skip_invalid_subjects_states_and_kinds() {
        let db = db().await;
        let recipients = [
            recipient("valid"),
            recipient("bad_subject"),
            recipient("bad_state"),
            recipient("bad_kind"),
        ];
        arm_in(&db, ORG, RUN, &recipients, 10).await.unwrap();
        for (response, column, value) in [
            ("bad_subject", Column::Subject, "{"),
            ("bad_state", Column::State, "future_state"),
            ("bad_kind", Column::Kind, "future_kind"),
        ] {
            Entity::update_many()
                .col_expr(column, Expr::value(value))
                .filter(Column::Id.eq(obligation_id(ORG, RUN, response)))
                .exec(&db)
                .await
                .unwrap();
        }
        let rows = for_run_in(&db, ORG, RUN).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].response_id, "valid");
    }
}
