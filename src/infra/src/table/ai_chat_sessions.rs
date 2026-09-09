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

//! Service layer for the `ai_chat_sessions` index (server-side chat persistence).
//!
//! The table is a small index over the protected `_o2_ai_chat_events` stream:
//! ownership, timestamps and the committed watermark. Every function has a
//! `_with` twin taking a connection so the logic is testable on an in-memory
//! SQLite.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, SqlErr,
    sea_query::{Expr, Func},
};

use super::entity::ai_chat_sessions::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub const STATUS_ACTIVE: &str = "active";
pub const STATUS_DELETED: &str = "deleted";
/// "No durable event committed": opencode's `seq` is 0-based.
pub const NO_SEQ: i64 = -1;

/// Outcome of binding a chat to the opencode session that is producing its
/// events (see [`bind_opencode_session`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub epoch: i64,
    pub last_committed_seq: i64,
    /// True when the chat was re-bound to a DIFFERENT opencode session and a
    /// new epoch started (the watermark was reset to [`NO_SEQ`]).
    pub new_epoch: bool,
}

pub async fn get(org_id: &str, session_id: &str) -> Result<Option<Model>, errors::Error> {
    get_with(get_orm_client_ro().await, org_id, session_id).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
) -> Result<Option<Model>, errors::Error> {
    Entity::find_by_id((org_id.to_string(), session_id.to_string()))
        .one(conn)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()).into())
}

/// Insert the index row for a chat if it does not exist yet, and return it.
///
/// Ownership is NOT checked here: the caller compares `user_id` on the
/// returned row so a session id replayed by another user is refused with a
/// 403 rather than silently re-owned. Two first turns racing on the same id
/// both end up with the same row (unique violation → re-read).
pub async fn get_or_create(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    agent_type: &str,
    now: i64,
) -> Result<Model, errors::Error> {
    get_or_create_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        user_id,
        agent_type,
        now,
    )
    .await
}

pub async fn get_or_create_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    user_id: &str,
    agent_type: &str,
    now: i64,
) -> Result<Model, errors::Error> {
    if let Some(row) = get_with(conn, org_id, session_id).await? {
        return Ok(row);
    }
    let record = ActiveModel {
        org_id: Set(org_id.to_string()),
        session_id: Set(session_id.to_string()),
        user_id: Set(user_id.to_string()),
        opencode_session_id: Set(None),
        agent_type: Set(agent_type.to_string()),
        title: Set(String::new()),
        status: Set(STATUS_ACTIVE.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        first_event_at: Set(None),
        last_event_at: Set(None),
        last_committed_seq: Set(NO_SEQ),
        session_epoch: Set(1),
    };
    match Entity::insert(record).exec(conn).await {
        Ok(_) => {}
        Err(e) => match e.sql_err() {
            // Lost the race with a concurrent first turn: the row exists now.
            Some(SqlErr::UniqueConstraintViolation(_)) => {}
            _ => return Err(errors::DbError::SeaORMError(e.to_string()).into()),
        },
    }
    get_with(conn, org_id, session_id)
        .await?
        .ok_or_else(|| errors::Error::Message("ai_chat_sessions row vanished after insert".into()))
}

/// Record which opencode session produces this chat's events.
///
/// First binding sets it. The same session is a no-op. A DIFFERENT session
/// means the replica rebuilt the conversation from scratch (its local copy
/// was lost): the epoch increments and the watermark resets, so the new
/// session's events — whose `seq` restarts at 0 — are stored under a fresh
/// epoch instead of colliding with the committed prefix.
pub async fn bind_opencode_session(
    org_id: &str,
    session_id: &str,
    opencode_session_id: &str,
    now: i64,
) -> Result<Binding, errors::Error> {
    bind_opencode_session_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        opencode_session_id,
        now,
    )
    .await
}

pub async fn bind_opencode_session_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    opencode_session_id: &str,
    now: i64,
) -> Result<Binding, errors::Error> {
    let row = get_with(conn, org_id, session_id)
        .await?
        .ok_or_else(|| errors::Error::Message(format!("unknown chat session {session_id}")))?;
    match row.opencode_session_id.as_deref() {
        Some(current) if current == opencode_session_id => Ok(Binding {
            epoch: row.session_epoch,
            last_committed_seq: row.last_committed_seq,
            new_epoch: false,
        }),
        None => {
            Entity::update_many()
                .col_expr(
                    Column::OpencodeSessionId,
                    Expr::value(Some(opencode_session_id.to_string())),
                )
                .col_expr(Column::UpdatedAt, Expr::value(now))
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::SessionId.eq(session_id))
                .exec(conn)
                .await
                .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;
            Ok(Binding {
                epoch: row.session_epoch,
                last_committed_seq: row.last_committed_seq,
                new_epoch: false,
            })
        }
        Some(_) => {
            let epoch = row.session_epoch + 1;
            Entity::update_many()
                .col_expr(
                    Column::OpencodeSessionId,
                    Expr::value(Some(opencode_session_id.to_string())),
                )
                .col_expr(Column::SessionEpoch, Expr::value(epoch))
                .col_expr(Column::LastCommittedSeq, Expr::value(NO_SEQ))
                .col_expr(Column::FirstEventAt, Expr::value(Option::<i64>::None))
                .col_expr(Column::LastEventAt, Expr::value(Option::<i64>::None))
                .col_expr(Column::UpdatedAt, Expr::value(now))
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::SessionId.eq(session_id))
                .exec(conn)
                .await
                .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;
            Ok(Binding {
                epoch,
                last_committed_seq: NO_SEQ,
                new_epoch: true,
            })
        }
    }
}

/// Advance the committed watermark to `new_seq` — only if the row still
/// carries `epoch` and its watermark is exactly `expected_prev_seq`.
///
/// Returns `false` when the update was fenced (another epoch or another
/// writer moved the watermark); the caller must then stop persisting this
/// turn. The watermark is never set from an observed maximum: it only ever
/// moves to the end of a contiguous, acknowledged batch.
pub async fn advance_watermark(
    org_id: &str,
    session_id: &str,
    epoch: i64,
    expected_prev_seq: i64,
    new_seq: i64,
    first_event_at: i64,
    last_event_at: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    advance_watermark_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        epoch,
        expected_prev_seq,
        new_seq,
        first_event_at,
        last_event_at,
        now,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn advance_watermark_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    epoch: i64,
    expected_prev_seq: i64,
    new_seq: i64,
    first_event_at: i64,
    last_event_at: i64,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::LastCommittedSeq, Expr::value(new_seq))
        .col_expr(Column::LastEventAt, Expr::value(last_event_at))
        .col_expr(
            Column::FirstEventAt,
            Func::coalesce([
                Expr::col(Column::FirstEventAt).into(),
                Expr::value(first_event_at),
            ])
            .into(),
        )
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::SessionEpoch.eq(epoch))
        .filter(Column::LastCommittedSeq.eq(expected_prev_seq))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .exec(conn)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;
    Ok(result.rows_affected == 1)
}

pub async fn set_title(
    org_id: &str,
    session_id: &str,
    title: &str,
    now: i64,
) -> Result<(), errors::Error> {
    set_title_with(get_orm_client_rw().await, org_id, session_id, title, now).await
}

pub async fn set_title_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    title: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::Title, Expr::value(title.to_string()))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .exec(conn)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;
    Ok(())
}

pub async fn set_status(
    org_id: &str,
    session_id: &str,
    status: &str,
    now: i64,
) -> Result<(), errors::Error> {
    set_status_with(get_orm_client_rw().await, org_id, session_id, status, now).await
}

pub async fn set_status_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    status: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(status.to_string()))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .exec(conn)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn db() -> sea_orm::DatabaseConnection {
        use sea_orm::{Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        let stmt = schema.create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    const ORG: &str = "org";
    const SID: &str = "01234567-89ab-7def-8123-456789abcdef";

    #[tokio::test]
    async fn get_or_create_inserts_once_and_never_reowns() {
        let db = db().await;
        let created = get_or_create_with(&db, ORG, SID, "a@x", "o2-ai", 10)
            .await
            .unwrap();
        assert_eq!(created.user_id, "a@x");
        assert_eq!(created.last_committed_seq, NO_SEQ);
        assert_eq!(created.session_epoch, 1);
        assert_eq!(created.status, STATUS_ACTIVE);
        assert!(created.opencode_session_id.is_none());

        // A second caller (even another user) gets the existing row back; the
        // ownership decision belongs to the caller.
        let again = get_or_create_with(&db, ORG, SID, "b@x", "o2-ai", 20)
            .await
            .unwrap();
        assert_eq!(again.user_id, "a@x");
        assert_eq!(again.created_at, 10);
        assert!(get_with(&db, "other-org", SID).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn watermark_only_advances_from_the_expected_prefix_in_the_right_epoch() {
        let db = db().await;
        get_or_create_with(&db, ORG, SID, "a@x", "o2-ai", 10)
            .await
            .unwrap();

        // First batch 0..=4 continues the empty prefix (-1).
        assert!(
            advance_watermark_with(&db, ORG, SID, 1, NO_SEQ, 4, 100, 110, 111)
                .await
                .unwrap()
        );
        let row = get_with(&db, ORG, SID).await.unwrap().unwrap();
        assert_eq!(row.last_committed_seq, 4);
        assert_eq!(row.first_event_at, Some(100));
        assert_eq!(row.last_event_at, Some(110));

        // A batch that does not start right after the watermark is fenced.
        assert!(
            !advance_watermark_with(&db, ORG, SID, 1, 6, 9, 200, 210, 211)
                .await
                .unwrap()
        );
        // So is the right batch under a stale epoch.
        assert!(
            !advance_watermark_with(&db, ORG, SID, 2, 4, 9, 200, 210, 211)
                .await
                .unwrap()
        );
        // The contiguous next batch advances, and first_event_at is kept.
        assert!(
            advance_watermark_with(&db, ORG, SID, 1, 4, 9, 200, 210, 211)
                .await
                .unwrap()
        );
        let row = get_with(&db, ORG, SID).await.unwrap().unwrap();
        assert_eq!(row.last_committed_seq, 9);
        assert_eq!(row.first_event_at, Some(100));
        assert_eq!(row.last_event_at, Some(210));
        assert_eq!(row.updated_at, 211);

        // A deleted chat accepts nothing more.
        set_status_with(&db, ORG, SID, STATUS_DELETED, 300)
            .await
            .unwrap();
        assert!(
            !advance_watermark_with(&db, ORG, SID, 1, 9, 12, 300, 310, 311)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn rebinding_to_another_opencode_session_starts_a_new_epoch() {
        let db = db().await;
        get_or_create_with(&db, ORG, SID, "a@x", "o2-ai", 10)
            .await
            .unwrap();
        let first = bind_opencode_session_with(&db, ORG, SID, "ses_A", 11)
            .await
            .unwrap();
        assert_eq!(
            first,
            Binding {
                epoch: 1,
                last_committed_seq: NO_SEQ,
                new_epoch: false
            }
        );
        assert!(
            advance_watermark_with(&db, ORG, SID, 1, NO_SEQ, 7, 100, 110, 111)
                .await
                .unwrap()
        );

        // Same session again: nothing changes.
        let same = bind_opencode_session_with(&db, ORG, SID, "ses_A", 12)
            .await
            .unwrap();
        assert_eq!(same.epoch, 1);
        assert_eq!(same.last_committed_seq, 7);
        assert!(!same.new_epoch);

        // A different session: epoch 2, watermark reset, old epoch fenced.
        let rebound = bind_opencode_session_with(&db, ORG, SID, "ses_B", 13)
            .await
            .unwrap();
        assert_eq!(
            rebound,
            Binding {
                epoch: 2,
                last_committed_seq: NO_SEQ,
                new_epoch: true
            }
        );
        let row = get_with(&db, ORG, SID).await.unwrap().unwrap();
        assert_eq!(row.opencode_session_id.as_deref(), Some("ses_B"));
        assert!(row.first_event_at.is_none());
        assert!(
            !advance_watermark_with(&db, ORG, SID, 1, 7, 9, 200, 210, 211)
                .await
                .unwrap()
        );
        assert!(
            advance_watermark_with(&db, ORG, SID, 2, NO_SEQ, 3, 200, 210, 211)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn title_is_updated_in_place() {
        let db = db().await;
        get_or_create_with(&db, ORG, SID, "a@x", "o2-ai", 10)
            .await
            .unwrap();
        set_title_with(&db, ORG, SID, "Why is p99 up?", 20)
            .await
            .unwrap();
        let row = get_with(&db, ORG, SID).await.unwrap().unwrap();
        assert_eq!(row.title, "Why is p99 up?");
        assert_eq!(row.updated_at, 20);
    }
}
