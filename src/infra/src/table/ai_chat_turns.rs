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

//! `ai_chat_turns`: one row per submitted turn, inserted under the lease and finished once.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, Set, SqlErr, TransactionTrait, sea_query::Expr,
};

pub use super::entity::ai_chat_turns::Model;
use super::entity::{ai_chat_sessions, ai_chat_turns::*};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub const TURN_RUNNING: &str = "running";
pub const TURN_COMPLETED: &str = "completed";
pub const TURN_CANCELLED: &str = "cancelled";
pub const TURN_FAILED: &str = "failed";
pub const TURN_INTERRUPTED: &str = "interrupted";

/// Decisions kept per turn; a turn asks a handful, so the cap only bounds a misbehaving client.
pub const MAX_DECISIONS: usize = 64;

// SQLite has no row locks, so this node's appends also queue here.
static DECISION_WRITES: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Outcome of [`admit`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    /// A new turn id: recorded as running.
    Admitted,
    /// A failed or interrupted turn that stored nothing, submitted again.
    Retried,
    /// The turn id was seen before; running it again would re-run the model.
    AlreadySubmitted,
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// Records `turn_id` as running from `start_seq`; under the lease any other running turn is dead.
pub async fn admit(
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    start_seq: i64,
    now: i64,
) -> Result<Admission, errors::Error> {
    admit_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        turn_id,
        start_seq,
        now,
    )
    .await
}

pub async fn admit_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    start_seq: i64,
    now: i64,
) -> Result<Admission, errors::Error> {
    let record = ActiveModel {
        org_id: Set(org_id.to_string()),
        session_id: Set(session_id.to_string()),
        turn_id: Set(turn_id.to_string()),
        status: Set(TURN_RUNNING.to_string()),
        error_code: Set(None),
        start_seq: Set(Some(start_seq)),
        end_seq: Set(None),
        started_at: Set(now),
        ended_at: Set(None),
        first_event_at: Set(None),
        version_of: Set(None),
        decisions: Set(None),
    };
    let admission = match Entity::insert(record).exec(conn).await {
        Ok(_) => Admission::Admitted,
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                if retry_failed_with(conn, org_id, session_id, turn_id, start_seq, now).await? {
                    Admission::Retried
                } else {
                    Admission::AlreadySubmitted
                }
            }
            _ => return Err(db_err(e)),
        },
    };
    if admission != Admission::AlreadySubmitted {
        interrupt_others_with(conn, org_id, session_id, turn_id, now).await?;
    }
    Ok(admission)
}

/// Marks `turn_id` as a new version of `version_of`; `false` when the turn is unknown.
pub async fn set_version_of(
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    version_of: &str,
) -> Result<bool, errors::Error> {
    set_version_of_with(
        get_orm_client_rw().await,
        (org_id, session_id, turn_id),
        version_of,
    )
    .await
}

pub async fn set_version_of_with<C: ConnectionTrait>(
    conn: &C,
    (org_id, session_id, turn_id): (&str, &str, &str),
    version_of: &str,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::VersionOf, Expr::value(version_of.to_string()))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TurnId.eq(turn_id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Appends an answered approval to the session's newest turn; `false` when it has no turn.
pub async fn add_decision(
    org_id: &str,
    session_id: &str,
    decision: serde_json::Value,
) -> Result<bool, errors::Error> {
    let _queued = DECISION_WRITES.lock().await;
    add_decision_with(get_orm_client_rw().await, org_id, session_id, decision).await
}

/// Appends under a row lock, so two confirms of one turn both keep their decision.
pub async fn add_decision_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    decision: serde_json::Value,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await.map_err(db_err)?;
    let newest = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .order_by_desc(Column::StartedAt)
        .lock_exclusive()
        .one(&txn)
        .await
        .map_err(db_err)?;
    let Some(newest) = newest else {
        return Ok(false);
    };
    let mut decisions = decisions_of(&newest);
    if decisions.len() >= MAX_DECISIONS {
        return Ok(true);
    }
    decisions.push(decision);
    Entity::update_many()
        .col_expr(
            Column::Decisions,
            Expr::value(serde_json::Value::Array(decisions).to_string()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TurnId.eq(newest.turn_id.as_str()))
        .exec(&txn)
        .await
        .map_err(db_err)?;
    txn.commit().await.map_err(db_err)?;
    Ok(true)
}

/// Records how a running turn ended (`false` if not running); `None` start keeps admission's.
#[allow(clippy::too_many_arguments)]
pub async fn finish(
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    status: &str,
    error_code: Option<&str>,
    start_seq: Option<i64>,
    end_seq: Option<i64>,
    now: i64,
) -> Result<bool, errors::Error> {
    finish_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        turn_id,
        status,
        error_code,
        start_seq,
        end_seq,
        now,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn finish_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    status: &str,
    error_code: Option<&str>,
    start_seq: Option<i64>,
    end_seq: Option<i64>,
    now: i64,
) -> Result<bool, errors::Error> {
    let mut update = Entity::update_many()
        .col_expr(Column::Status, Expr::value(status))
        .col_expr(
            Column::ErrorCode,
            Expr::value(error_code.map(str::to_string)),
        )
        .col_expr(Column::EndSeq, Expr::value(end_seq))
        .col_expr(Column::EndedAt, Expr::value(Some(now)));
    if let Some(start_seq) = start_seq {
        update = update.col_expr(Column::StartSeq, Expr::value(Some(start_seq)));
    }
    let result = update
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TurnId.eq(turn_id))
        .filter(Column::Status.eq(TURN_RUNNING))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Stamps the turn's first forwarded o2-ai event once; `false` if it already had one.
pub async fn set_first_event_at(
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    at: i64,
) -> Result<bool, errors::Error> {
    set_first_event_at_with(get_orm_client_rw().await, org_id, session_id, turn_id, at).await
}

pub async fn set_first_event_at_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    at: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::FirstEventAt, Expr::value(Some(at)))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TurnId.eq(turn_id))
        .filter(Column::FirstEventAt.is_null())
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Every turn record of a chat, oldest first.
pub async fn list_for_session(org_id: &str, session_id: &str) -> Result<Vec<Model>, errors::Error> {
    list_for_session_with(get_orm_client_ro().await, org_id, session_id).await
}

pub async fn list_for_session_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
) -> Result<Vec<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .order_by_asc(Column::StartedAt)
        .order_by_asc(Column::TurnId)
        .all(conn)
        .await
        .map_err(db_err)
}

/// The turns of `session_ids` marked running and started at or after `stale_before`, one query.
pub async fn running_for_sessions(
    org_id: &str,
    session_ids: &[String],
    stale_before: i64,
) -> Result<Vec<Model>, errors::Error> {
    running_for_sessions_with(get_orm_client_ro().await, org_id, session_ids, stale_before).await
}

pub async fn running_for_sessions_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_ids: &[String],
    stale_before: i64,
) -> Result<Vec<Model>, errors::Error> {
    if session_ids.is_empty() {
        return Ok(Vec::new());
    }
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.is_in(session_ids.iter().cloned()))
        .filter(Column::Status.eq(TURN_RUNNING))
        .filter(Column::StartedAt.gte(stale_before))
        .order_by_asc(Column::StartedAt)
        .all(conn)
        .await
        .map_err(db_err)
}

/// The records of these `(session_id, turn_id)` pairs of one org, one query.
pub async fn get_many(
    org_id: &str,
    keys: &[(String, String)],
) -> Result<Vec<Model>, errors::Error> {
    get_many_with(get_orm_client_ro().await, org_id, keys).await
}

pub async fn get_many_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    keys: &[(String, String)],
) -> Result<Vec<Model>, errors::Error> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.is_in(keys.iter().map(|(sid, _)| sid.clone())))
        .filter(Column::TurnId.is_in(keys.iter().map(|(_, tid)| tid.clone())))
        .all(conn)
        .await
        .map_err(db_err)?;
    Ok(records
        .into_iter()
        .filter(|r| {
            keys.iter()
                .any(|(sid, tid)| *sid == r.session_id && *tid == r.turn_id)
        })
        .collect())
}

pub async fn get(
    org_id: &str,
    session_id: &str,
    turn_id: &str,
) -> Result<Option<Model>, errors::Error> {
    get_with(get_orm_client_ro().await, org_id, session_id, turn_id).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    turn_id: &str,
) -> Result<Option<Model>, errors::Error> {
    Entity::find_by_id((
        org_id.to_string(),
        session_id.to_string(),
        turn_id.to_string(),
    ))
    .one(conn)
    .await
    .map_err(db_err)
}

/// Remove the turn records of chats whose index row is gone (retention).
pub async fn purge_orphans(org_id: &str) -> Result<u64, errors::Error> {
    purge_orphans_with(get_orm_client_rw().await, org_id).await
}

pub async fn purge_orphans_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let live = ai_chat_sessions::Entity::find()
        .select_only()
        .column(ai_chat_sessions::Column::SessionId)
        .filter(ai_chat_sessions::Column::OrgId.eq(org_id))
        .into_query();
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Condition::all().add(Column::SessionId.not_in_subquery(live)))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

/// Remove every turn record of `org_id`, for the org's deletion; returns how many.
pub async fn delete_by_org(org_id: &str) -> Result<u64, errors::Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

/// The decisions recorded on a turn, oldest first.
pub fn decisions_of(record: &Model) -> Vec<serde_json::Value> {
    match record.decisions.as_deref().map(serde_json::from_str) {
        Some(Ok(serde_json::Value::Array(decisions))) => decisions,
        _ => Vec::new(),
    }
}

/// Marked running and started after `stale_before` (older ones died without finishing).
pub fn is_running(record: &Model, stale_before: i64) -> bool {
    record.status == TURN_RUNNING && record.started_at >= stale_before
}

/// Reset a failed or interrupted turn that stored nothing back to running.
async fn retry_failed_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    start_seq: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value(TURN_RUNNING))
        .col_expr(Column::ErrorCode, Expr::value(Option::<String>::None))
        .col_expr(Column::StartSeq, Expr::value(Some(start_seq)))
        .col_expr(Column::StartedAt, Expr::value(now))
        .col_expr(Column::EndedAt, Expr::value(Option::<i64>::None))
        .col_expr(Column::FirstEventAt, Expr::value(Option::<i64>::None))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TurnId.eq(turn_id))
        .filter(Column::EndSeq.is_null())
        .filter(
            Condition::any()
                .add(Column::Status.eq(TURN_FAILED))
                // Its own start is still the next seq: nothing was committed since it began.
                .add(
                    Condition::all()
                        .add(Column::Status.eq(TURN_INTERRUPTED))
                        .add(Column::StartSeq.eq(start_seq)),
                ),
        )
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

async fn interrupt_others_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(TURN_INTERRUPTED))
        .col_expr(Column::EndedAt, Expr::value(Some(now)))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TurnId.ne(turn_id))
        .filter(Column::Status.eq(TURN_RUNNING))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, Schema};

    use super::*;

    const ORG: &str = "org";
    const SID: &str = "01234567-89ab-7def-8123-456789abcdef";

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(Entity),
            schema.create_table_from_entity(ai_chat_sessions::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    async fn record(db: &DatabaseConnection, turn: &str) -> Model {
        Entity::find_by_id((ORG.to_string(), SID.to_string(), turn.to_string()))
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn any_submitted_turn_id_is_recognised_not_only_the_latest() {
        let db = db().await;
        assert_eq!(
            admit_with(&db, ORG, SID, "t1", 0, 10).await.unwrap(),
            Admission::Admitted
        );
        finish_with(
            &db,
            ORG,
            SID,
            "t1",
            TURN_COMPLETED,
            None,
            Some(0),
            Some(5),
            11,
        )
        .await
        .unwrap();
        assert_eq!(
            admit_with(&db, ORG, SID, "t2", 6, 12).await.unwrap(),
            Admission::Admitted
        );
        finish_with(
            &db,
            ORG,
            SID,
            "t2",
            TURN_COMPLETED,
            None,
            Some(6),
            Some(9),
            13,
        )
        .await
        .unwrap();
        for turn in ["t1", "t2"] {
            assert_eq!(
                admit_with(&db, ORG, SID, turn, 10, 14).await.unwrap(),
                Admission::AlreadySubmitted
            );
        }
        assert_eq!(record(&db, "t1").await.status, TURN_COMPLETED);
    }

    #[tokio::test]
    async fn only_a_failed_turn_that_stored_nothing_may_be_retried() {
        let db = db().await;
        admit_with(&db, ORG, SID, "empty", 0, 10).await.unwrap();
        finish_with(
            &db,
            ORG,
            SID,
            "empty",
            TURN_FAILED,
            Some("upstream"),
            None,
            None,
            11,
        )
        .await
        .unwrap();
        let failed = record(&db, "empty").await;
        assert_eq!(
            (failed.start_seq, failed.end_seq),
            (Some(0), None),
            "a None seq keeps the admission value"
        );
        assert_eq!(
            admit_with(&db, ORG, SID, "empty", 0, 20).await.unwrap(),
            Admission::Retried
        );
        let retried = record(&db, "empty").await;
        assert_eq!(retried.status, TURN_RUNNING);
        assert_eq!(retried.error_code, None);
        assert_eq!((retried.started_at, retried.ended_at), (20, None));
        // A running turn is never re-admitted.
        assert_eq!(
            admit_with(&db, ORG, SID, "empty", 0, 21).await.unwrap(),
            Admission::AlreadySubmitted
        );

        admit_with(&db, ORG, SID, "partial", 3, 30).await.unwrap();
        finish_with(
            &db,
            ORG,
            SID,
            "partial",
            TURN_FAILED,
            Some("x"),
            Some(3),
            Some(4),
            31,
        )
        .await
        .unwrap();
        assert_eq!(
            admit_with(&db, ORG, SID, "partial", 5, 32).await.unwrap(),
            Admission::AlreadySubmitted
        );
        admit_with(&db, ORG, SID, "c", 5, 40).await.unwrap();
        finish_with(&db, ORG, SID, "c", TURN_CANCELLED, None, None, None, 41)
            .await
            .unwrap();
        assert_eq!(
            admit_with(&db, ORG, SID, "c", 5, 42).await.unwrap(),
            Admission::AlreadySubmitted
        );
    }

    #[tokio::test]
    async fn an_interrupted_turn_is_retried_only_while_nothing_was_committed_since() {
        let db = db().await;
        admit_with(&db, ORG, SID, "i", 5, 40).await.unwrap();
        finish_with(&db, ORG, SID, "i", TURN_INTERRUPTED, None, None, None, 41)
            .await
            .unwrap();
        assert_eq!(
            admit_with(&db, ORG, SID, "i", 5, 42).await.unwrap(),
            Admission::Retried
        );
        finish_with(&db, ORG, SID, "i", TURN_INTERRUPTED, None, None, None, 43)
            .await
            .unwrap();
        // The watermark moved past its start: it may have stored events.
        assert_eq!(
            admit_with(&db, ORG, SID, "i", 8, 44).await.unwrap(),
            Admission::AlreadySubmitted
        );
    }

    #[tokio::test]
    async fn a_turn_is_finished_once_and_a_dead_one_is_superseded() {
        let db = db().await;
        admit_with(&db, ORG, SID, "dead", 0, 10).await.unwrap();
        admit_with(&db, ORG, SID, "next", 0, 20).await.unwrap();
        let dead = record(&db, "dead").await;
        assert_eq!(
            (dead.status.as_str(), dead.ended_at),
            (TURN_INTERRUPTED, Some(20))
        );
        // The dead task finishing late changes nothing.
        assert!(
            !finish_with(
                &db,
                ORG,
                SID,
                "dead",
                TURN_COMPLETED,
                None,
                Some(0),
                Some(1),
                30
            )
            .await
            .unwrap()
        );
        assert!(
            finish_with(
                &db,
                ORG,
                SID,
                "next",
                TURN_CANCELLED,
                None,
                Some(0),
                Some(2),
                31
            )
            .await
            .unwrap()
        );
        assert!(
            !finish_with(
                &db,
                ORG,
                SID,
                "next",
                TURN_FAILED,
                Some("x"),
                None,
                None,
                32
            )
            .await
            .unwrap()
        );
        let turns = list_for_session_with(&db, ORG, SID).await.unwrap();
        assert_eq!(
            turns.iter().map(|t| t.turn_id.as_str()).collect::<Vec<_>>(),
            vec!["dead", "next"]
        );
        assert_eq!(turns[1].status, TURN_CANCELLED);
        assert_eq!(turns[1].end_seq, Some(2));
    }

    #[tokio::test]
    async fn stale_running_turns_are_not_running() {
        let db = db().await;
        admit_with(&db, ORG, SID, "t", 0, 100).await.unwrap();
        let row = record(&db, "t").await;
        assert!(is_running(&row, 50));
        assert!(!is_running(&row, 150));
    }

    #[tokio::test]
    async fn the_first_event_is_stamped_once_and_cleared_by_a_retry() {
        let db = db().await;
        admit_with(&db, ORG, SID, "t", 0, 10).await.unwrap();
        assert_eq!(record(&db, "t").await.first_event_at, None);
        assert!(
            set_first_event_at_with(&db, ORG, SID, "t", 11)
                .await
                .unwrap()
        );
        assert!(
            !set_first_event_at_with(&db, ORG, SID, "t", 12)
                .await
                .unwrap()
        );
        assert_eq!(record(&db, "t").await.first_event_at, Some(11));
        finish_with(&db, ORG, SID, "t", TURN_FAILED, Some("x"), None, None, 13)
            .await
            .unwrap();
        assert_eq!(
            admit_with(&db, ORG, SID, "t", 0, 20).await.unwrap(),
            Admission::Retried
        );
        assert_eq!(record(&db, "t").await.first_event_at, None);
    }

    #[tokio::test]
    async fn turns_of_purged_chats_are_removed() {
        let db = db().await;
        crate::table::ai_chat_sessions::get_or_create_with(&db, ORG, SID, "u", "a@x", "o2-ai", 1)
            .await
            .unwrap();
        admit_with(&db, ORG, SID, "kept", 0, 10).await.unwrap();
        admit_with(&db, ORG, "gone", "orphan", 0, 10).await.unwrap();
        admit_with(&db, "other", "gone", "other-org", 0, 10)
            .await
            .unwrap();
        assert_eq!(purge_orphans_with(&db, ORG).await.unwrap(), 1);
        assert_eq!(list_for_session_with(&db, ORG, SID).await.unwrap().len(), 1);
        assert_eq!(
            list_for_session_with(&db, "other", "gone")
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn org_delete_removes_every_turn_of_the_org_only() {
        let db = db().await;
        admit_with(&db, ORG, SID, "t1", 0, 10).await.unwrap();
        admit_with(&db, ORG, SID, "t2", 5, 20).await.unwrap();
        admit_with(&db, "other-org", SID, "t1", 0, 10)
            .await
            .unwrap();
        assert_eq!(delete_by_org_with(&db, ORG).await.unwrap(), 2);
        assert!(
            list_for_session_with(&db, ORG, SID)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_for_session_with(&db, "other-org", SID)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn running_turns_of_many_chats_are_read_at_once() {
        let db = db().await;
        let other = "11111111-89ab-7def-8123-456789abcdef";
        admit_with(&db, ORG, SID, "done", 0, 10).await.unwrap();
        finish_with(
            &db,
            ORG,
            SID,
            "done",
            TURN_COMPLETED,
            None,
            None,
            Some(3),
            11,
        )
        .await
        .unwrap();
        admit_with(&db, ORG, SID, "live", 4, 20).await.unwrap();
        admit_with(&db, ORG, other, "stale", 0, 5).await.unwrap();
        admit_with(&db, ORG, "not-listed", "elsewhere", 0, 20)
            .await
            .unwrap();
        let sessions = vec![SID.to_string(), other.to_string()];
        let running = running_for_sessions_with(&db, ORG, &sessions, 10)
            .await
            .unwrap();
        let ids: Vec<&str> = running.iter().map(|r| r.turn_id.as_str()).collect();
        assert_eq!(ids, vec!["live"], "stale and unlisted turns are left out");
        assert!(
            running_for_sessions_with(&db, ORG, &[], 0)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            get_with(&db, ORG, SID, "done")
                .await
                .unwrap()
                .unwrap()
                .end_seq,
            Some(3)
        );
        assert!(get_with(&db, ORG, SID, "nope").await.unwrap().is_none());
        let keys = vec![
            (SID.to_string(), "done".to_string()),
            (other.to_string(), "live".to_string()),
            (other.to_string(), "stale".to_string()),
        ];
        let mut found: Vec<String> = get_many_with(&db, ORG, &keys)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.turn_id)
            .collect();
        found.sort();
        assert_eq!(found, vec!["done", "stale"], "only the exact pairs");
    }

    #[tokio::test]
    async fn versions_and_decisions_land_on_their_turns() {
        let db = db().await;
        admit_with(&db, ORG, SID, "t1", 0, 10).await.unwrap();
        admit_with(&db, ORG, SID, "t2", 5, 20).await.unwrap();
        assert!(
            set_version_of_with(&db, (ORG, SID, "t2"), "t1")
                .await
                .unwrap()
        );
        assert!(
            !set_version_of_with(&db, (ORG, SID, "nope"), "t1")
                .await
                .unwrap()
        );
        assert_eq!(record(&db, "t2").await.version_of.as_deref(), Some("t1"));
        assert_eq!(record(&db, "t1").await.version_of, None);

        let decision = serde_json::json!({"id": "apr_1", "approved": true, "by": "a@x", "at": 1});
        assert!(
            add_decision_with(&db, ORG, SID, decision.clone())
                .await
                .unwrap()
        );
        assert!(
            !add_decision_with(&db, ORG, "other", decision.clone())
                .await
                .unwrap()
        );
        assert_eq!(
            decisions_of(&record(&db, "t2").await),
            vec![decision.clone()]
        );
        assert!(decisions_of(&record(&db, "t1").await).is_empty());
        let second = serde_json::json!({"id": "apr_2", "approved": false});
        let third = serde_json::json!({"id": "apr_3", "approved": true});
        let (a, b) = tokio::join!(
            add_decision_with(&db, ORG, SID, second.clone()),
            add_decision_with(&db, ORG, SID, third.clone()),
        );
        assert!(a.unwrap() && b.unwrap());
        let kept = decisions_of(&record(&db, "t2").await);
        assert_eq!(kept.len(), 3, "{kept:?}");
        assert!(kept.contains(&second) && kept.contains(&third));
    }
}
