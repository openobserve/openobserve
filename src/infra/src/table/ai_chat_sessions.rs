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
//!
//! A chat is bound to ONE opencode session for its whole life. Its durable
//! events (sequence numbers included) continue across o2-ai replicas because
//! a replica that lost the session restores it from the stream instead of
//! starting a new one. `session_epoch` counts those ownership changes and
//! fences writers: a writer holding an older epoch cannot move the watermark.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    Set, SqlErr,
    sea_query::{Expr, Func},
};

pub use super::entity::ai_chat_sessions::Model;
use super::entity::ai_chat_sessions::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// Where a chat's title came from; a later source only replaces an earlier
/// one in this order, and a title the user chose is never replaced.
pub const TITLE_FROM_PROMPT: &str = "prompt";
pub const TITLE_GENERATED: &str = "generated";
pub const TITLE_FROM_USER: &str = "user";

pub const STATUS_ACTIVE: &str = "active";
pub const STATUS_DELETED: &str = "deleted";
/// "No durable event committed": opencode's `seq` is 0-based.
pub const NO_SEQ: i64 = -1;

/// Outcome of binding a chat to the opencode session producing its events
/// (see [`bind_opencode_session`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Binding {
    /// The chat is (now) bound to this opencode session.
    Bound { epoch: i64, last_committed_seq: i64 },
    /// The chat has committed history under ANOTHER opencode session. The
    /// caller must not store these events: appending them would splice two
    /// unrelated event logs into one conversation. Restoring the replica from
    /// the stream is the fix.
    Forked { bound_opencode_session_id: String },
}

/// Keyset cursor for [`list_for_user`]: the last row of the previous page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListCursor {
    pub updated_at: i64,
    pub session_id: String,
}

/// `column` moved forward to `value`, never back (NULL counts as unset). The
/// reader's time window ends at `last_event_at`, so it must never shrink
/// under events already written (a history refresh and a turn can race).
fn not_before(column: Column, value: i64) -> sea_orm::sea_query::SimpleExpr {
    sea_orm::sea_query::CaseStatement::new()
        .case(
            Condition::any().add(column.is_null()).add(column.lt(value)),
            Expr::value(value),
        )
        .finally(Expr::col(column))
        .into()
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
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
        .map_err(db_err)
}

/// Insert the index row for a chat if it does not exist yet, and return it.
///
/// Ownership is NOT checked here: the caller compares `user_id` on the
/// returned row so a session id replayed by another user is refused rather
/// than silently re-owned. Two first turns racing on the same id both end up
/// with the same row (unique violation → re-read).
pub async fn get_or_create(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    user_email: &str,
    agent_type: &str,
    now: i64,
) -> Result<Model, errors::Error> {
    get_or_create_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        user_id,
        user_email,
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
    user_email: &str,
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
        user_email: Set(user_email.to_string()),
        opencode_session_id: Set(None),
        agent_type: Set(agent_type.to_string()),
        title: Set(String::new()),
        title_source: Set(String::new()),
        status: Set(STATUS_ACTIVE.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        first_event_at: Set(None),
        last_event_at: Set(None),
        last_committed_seq: Set(NO_SEQ),
        session_epoch: Set(1),
        last_turn_id: Set(None),
    };
    if let Err(e) = Entity::insert(record).exec(conn).await {
        match e.sql_err() {
            // Lost the race with a concurrent first turn: the row exists now.
            Some(SqlErr::UniqueConstraintViolation(_)) => {}
            _ => return Err(db_err(e)),
        }
    }
    get_with(conn, org_id, session_id)
        .await?
        .ok_or_else(|| errors::Error::Message("ai_chat_sessions row vanished after insert".into()))
}

/// Record the turn about to run. Returns `false` when `turn_id` is the turn
/// already recorded — a retried request that must not start a second model
/// run. Callers hold the session's turn lease, so this never races a
/// concurrent turn of the same chat.
pub async fn begin_turn(
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    begin_turn_with(get_orm_client_rw().await, org_id, session_id, turn_id, now).await
}

pub async fn begin_turn_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    turn_id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::LastTurnId, Expr::value(Some(turn_id.to_string())))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .filter(
            Condition::any()
                .add(Column::LastTurnId.is_null())
                .add(Column::LastTurnId.ne(turn_id)),
        )
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Record which opencode session produces this chat's events.
///
/// The first binding sets it; the same session again is a no-op. A DIFFERENT
/// session is accepted only while nothing is committed (the earlier session
/// never produced stored history, so there is nothing to continue). Otherwise
/// the result is [`Binding::Forked`] and the row is left untouched.
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
    if row.opencode_session_id.as_deref() == Some(opencode_session_id) {
        return Ok(Binding::Bound {
            epoch: row.session_epoch,
            last_committed_seq: row.last_committed_seq,
        });
    }
    // Conditional on the watermark still being empty, so a concurrent commit
    // under the old binding cannot be orphaned by this re-bind.
    let result = Entity::update_many()
        .col_expr(
            Column::OpencodeSessionId,
            Expr::value(Some(opencode_session_id.to_string())),
        )
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::LastCommittedSeq.eq(NO_SEQ))
        .exec(conn)
        .await
        .map_err(db_err)?;
    if result.rows_affected == 1 {
        return Ok(Binding::Bound {
            epoch: row.session_epoch,
            last_committed_seq: NO_SEQ,
        });
    }
    let current = get_with(conn, org_id, session_id).await?;
    Ok(Binding::Forked {
        bound_opencode_session_id: current
            .and_then(|r| r.opencode_session_id)
            .unwrap_or_default(),
    })
}

/// Start a new ownership epoch (a replica was just restored from the stream).
/// Compare-and-set on `expected_epoch`: returns the new epoch, or `None` when
/// another restore got there first.
pub async fn bump_epoch(
    org_id: &str,
    session_id: &str,
    expected_epoch: i64,
    now: i64,
) -> Result<Option<i64>, errors::Error> {
    bump_epoch_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        expected_epoch,
        now,
    )
    .await
}

pub async fn bump_epoch_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    expected_epoch: i64,
    now: i64,
) -> Result<Option<i64>, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::SessionEpoch, Expr::value(expected_epoch + 1))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::SessionEpoch.eq(expected_epoch))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok((result.rows_affected == 1).then_some(expected_epoch + 1))
}

/// Advance the committed watermark to `new_seq` — only if the row still
/// carries `epoch` and its watermark is exactly `expected_prev_seq`.
///
/// Returns `false` when the update was fenced (another epoch or another
/// writer moved the watermark); the caller must then stop persisting this
/// turn. The watermark is never set from an observed maximum: it only ever
/// moves to the end of a contiguous, acknowledged batch.
#[allow(clippy::too_many_arguments)]
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
        .col_expr(
            Column::LastEventAt,
            not_before(Column::LastEventAt, last_event_at),
        )
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
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// A provisional title from the chat's first prompt, so a new chat is never
/// listed untitled. Only while the chat has no title at all.
pub async fn set_prompt_title(
    org_id: &str,
    session_id: &str,
    title: &str,
    now: i64,
) -> Result<(), errors::Error> {
    set_prompt_title_with(get_orm_client_rw().await, org_id, session_id, title, now).await
}

pub async fn set_prompt_title_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    title: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::Title, Expr::value(title.to_string()))
        .col_expr(
            Column::TitleSource,
            Expr::value(TITLE_FROM_PROMPT.to_string()),
        )
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TitleSource.eq(""))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// The title opencode generated. Replaces a provisional one; never a title
/// the user chose ([`rename`]).
pub async fn set_auto_title(
    org_id: &str,
    session_id: &str,
    title: &str,
    now: i64,
) -> Result<(), errors::Error> {
    set_auto_title_with(get_orm_client_rw().await, org_id, session_id, title, now).await
}

pub async fn set_auto_title_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    title: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::Title, Expr::value(title.to_string()))
        .col_expr(
            Column::TitleSource,
            Expr::value(TITLE_GENERATED.to_string()),
        )
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::TitleSource.ne(TITLE_FROM_USER))
        .filter(Column::Title.ne(title))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// The user renamed the chat. Returns `false` when there is no active chat
/// with that id owned by `user_id`.
pub async fn rename(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    title: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    rename_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        user_id,
        title,
        now,
    )
    .await
}

pub async fn rename_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    user_id: &str,
    title: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Title, Expr::value(title.to_string()))
        .col_expr(
            Column::TitleSource,
            Expr::value(TITLE_FROM_USER.to_string()),
        )
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Tombstone a chat: every read and write stops at once; the stream rows are
/// removed by retention. Returns `false` when there is no active chat with
/// that id owned by `user_id`.
pub async fn mark_deleted(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    mark_deleted_with(get_orm_client_rw().await, org_id, session_id, user_id, now).await
}

pub async fn mark_deleted_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    user_id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_DELETED.to_string()))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Tombstone every active chat `user_id` owns in `org_id`; returns their
/// session ids (so the caller can drop the replicas' working copies too).
pub async fn mark_all_deleted(
    org_id: &str,
    user_id: &str,
    now: i64,
) -> Result<Vec<String>, errors::Error> {
    mark_all_deleted_with(get_orm_client_rw().await, org_id, user_id, now).await
}

pub async fn mark_all_deleted_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_id: &str,
    now: i64,
) -> Result<Vec<String>, errors::Error> {
    let session_ids: Vec<String> = Entity::find()
        .select_only()
        .column(Column::SessionId)
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .into_tuple()
        .all(conn)
        .await
        .map_err(db_err)?;
    let mut deleted = Vec::with_capacity(session_ids.len());
    // Bounded statements: a user with thousands of chats must not produce
    // one unbounded IN list.
    for chunk in session_ids.chunks(500) {
        Entity::update_many()
            .col_expr(Column::Status, Expr::value(STATUS_DELETED.to_string()))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::UserId.eq(user_id))
            .filter(Column::Status.eq(STATUS_ACTIVE))
            .filter(Column::SessionId.is_in(chunk.iter().cloned()))
            .exec(conn)
            .await
            .map_err(db_err)?;
        deleted.extend_from_slice(chunk);
    }
    Ok(deleted)
}

/// Orgs that have chat index rows (for the retention sweep).
pub async fn orgs_with_chats() -> Result<Vec<String>, errors::Error> {
    orgs_with_chats_with(get_orm_client_ro().await).await
}

pub async fn orgs_with_chats_with<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<String>, errors::Error> {
    Entity::find()
        .select_only()
        .column(Column::OrgId)
        .distinct()
        .into_tuple()
        .all(conn)
        .await
        .map_err(db_err)
}

/// Remove the index rows of `org_id` whose oldest stored events have aged out
/// of the chat-events stream (`first_event_at` before `cutoff`, micros),
/// active or tombstoned alike: an active row would claim history that no
/// longer reads back, and a tombstone is only needed while its events still
/// exist (it keeps a deleted chat from being continued). Chats in use are kept
/// clear of this by [`refresh candidates`](due_for_refresh) being rewritten.
/// Returns how many rows were removed.
pub async fn purge_expired(org_id: &str, cutoff: i64) -> Result<u64, errors::Error> {
    purge_expired_with(get_orm_client_rw().await, org_id, cutoff).await
}

pub async fn purge_expired_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    cutoff: i64,
) -> Result<u64, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(
            Condition::any()
                .add(Column::FirstEventAt.lt(cutoff))
                // Never committed anything: its age is its last update.
                .add(
                    Condition::all()
                        .add(Column::FirstEventAt.is_null())
                        .add(Column::UpdatedAt.lt(cutoff)),
                ),
        )
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

/// Active chats of `org_id` in use since `active_since` whose oldest stored
/// events predate `stale_before`: their committed history is rewritten with
/// fresh timestamps so it never ages out while the chat is in use. At most
/// `limit` rows, oldest first.
pub async fn due_for_refresh(
    org_id: &str,
    stale_before: i64,
    active_since: i64,
    limit: u64,
) -> Result<Vec<Model>, errors::Error> {
    due_for_refresh_with(
        get_orm_client_ro().await,
        org_id,
        stale_before,
        active_since,
        limit,
    )
    .await
}

pub async fn due_for_refresh_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    stale_before: i64,
    active_since: i64,
    limit: u64,
) -> Result<Vec<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .filter(Column::FirstEventAt.lt(stale_before))
        .filter(Column::LastEventAt.gte(active_since))
        .order_by_asc(Column::FirstEventAt)
        .limit(limit)
        .all(conn)
        .await
        .map_err(db_err)
}

/// After a chat's history was rewritten between `first` and `last` (micros):
/// the read window starts at the rewritten copies (the old ones may age out)
/// and reaches at least their end.
pub async fn set_refreshed_range(
    org_id: &str,
    session_id: &str,
    first: i64,
    last: i64,
) -> Result<(), errors::Error> {
    set_refreshed_range_with(get_orm_client_rw().await, org_id, session_id, first, last).await
}

pub async fn set_refreshed_range_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    first: i64,
    last: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(
            Column::FirstEventAt,
            not_before(Column::FirstEventAt, first),
        )
        .col_expr(Column::LastEventAt, not_before(Column::LastEventAt, last))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// One page of a user's active chats, most recently active first, keyset
/// paginated on `(updated_at, session_id)` (see the `user_list` index).
pub async fn list_for_user(
    org_id: &str,
    user_id: &str,
    after: Option<&ListCursor>,
    limit: u64,
) -> Result<Vec<Model>, errors::Error> {
    list_for_user_with(get_orm_client_ro().await, org_id, user_id, after, limit).await
}

pub async fn list_for_user_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_id: &str,
    after: Option<&ListCursor>,
    limit: u64,
) -> Result<Vec<Model>, errors::Error> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Status.eq(STATUS_ACTIVE));
    if let Some(cursor) = after {
        query = query.filter(
            Condition::any()
                .add(Column::UpdatedAt.lt(cursor.updated_at))
                .add(
                    Condition::all()
                        .add(Column::UpdatedAt.eq(cursor.updated_at))
                        .add(Column::SessionId.lt(cursor.session_id.clone())),
                ),
        );
    }
    query
        .order_by_desc(Column::UpdatedAt)
        .order_by_desc(Column::SessionId)
        .limit(limit)
        .all(conn)
        .await
        .map_err(db_err)
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
    const ALICE: &str = "2Q8vXqYk1W0r8aLiceUserId000";
    const BOB: &str = "2Q8vXqYk1W0r8bobUserId00000";

    async fn chat(db: &sea_orm::DatabaseConnection, sid: &str, user: &str, now: i64) -> Model {
        get_or_create_with(db, ORG, sid, user, "a@x", "o2-ai", now)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn get_or_create_inserts_once_and_never_reowns() {
        let db = db().await;
        let created = chat(&db, SID, ALICE, 10).await;
        assert_eq!(created.user_id, ALICE);
        assert_eq!(created.user_email, "a@x");
        assert_eq!(created.last_committed_seq, NO_SEQ);
        assert_eq!(created.session_epoch, 1);
        assert_eq!(created.status, STATUS_ACTIVE);
        assert!(created.opencode_session_id.is_none());

        // A second caller (even another user) gets the existing row back; the
        // ownership decision belongs to the caller.
        let again = chat(&db, SID, BOB, 20).await;
        assert_eq!(again.user_id, ALICE);
        assert_eq!(again.created_at, 10);
        assert!(get_with(&db, "other-org", SID).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_retried_turn_is_recognized() {
        let db = db().await;
        chat(&db, SID, ALICE, 10).await;
        assert!(begin_turn_with(&db, ORG, SID, "turn-1", 11).await.unwrap());
        assert!(!begin_turn_with(&db, ORG, SID, "turn-1", 12).await.unwrap());
        assert!(begin_turn_with(&db, ORG, SID, "turn-2", 13).await.unwrap());
    }

    #[tokio::test]
    async fn watermark_only_advances_from_the_expected_prefix_in_the_right_epoch() {
        let db = db().await;
        chat(&db, SID, ALICE, 10).await;

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
        assert!(mark_deleted_with(&db, ORG, SID, ALICE, 300).await.unwrap());
        assert!(
            !advance_watermark_with(&db, ORG, SID, 1, 9, 12, 300, 310, 311)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn a_chat_with_history_never_rebinds_to_another_opencode_session() {
        let db = db().await;
        chat(&db, SID, ALICE, 10).await;
        let bound = Binding::Bound {
            epoch: 1,
            last_committed_seq: NO_SEQ,
        };
        assert_eq!(
            bind_opencode_session_with(&db, ORG, SID, "ses_A", 11)
                .await
                .unwrap(),
            bound
        );
        // Nothing committed yet: a replacement session is harmless.
        assert_eq!(
            bind_opencode_session_with(&db, ORG, SID, "ses_B", 12)
                .await
                .unwrap(),
            bound
        );
        assert!(
            advance_watermark_with(&db, ORG, SID, 1, NO_SEQ, 7, 100, 110, 111)
                .await
                .unwrap()
        );
        assert_eq!(
            bind_opencode_session_with(&db, ORG, SID, "ses_B", 13)
                .await
                .unwrap(),
            Binding::Bound {
                epoch: 1,
                last_committed_seq: 7
            }
        );
        // Committed history: another session would splice two logs together.
        assert_eq!(
            bind_opencode_session_with(&db, ORG, SID, "ses_C", 14)
                .await
                .unwrap(),
            Binding::Forked {
                bound_opencode_session_id: "ses_B".into()
            }
        );
        let row = get_with(&db, ORG, SID).await.unwrap().unwrap();
        assert_eq!(row.opencode_session_id.as_deref(), Some("ses_B"));
        assert_eq!(row.last_committed_seq, 7);
    }

    #[tokio::test]
    async fn a_restore_bumps_the_epoch_once_and_fences_the_old_writer() {
        let db = db().await;
        chat(&db, SID, ALICE, 10).await;
        assert!(
            advance_watermark_with(&db, ORG, SID, 1, NO_SEQ, 3, 100, 110, 111)
                .await
                .unwrap()
        );
        assert_eq!(
            bump_epoch_with(&db, ORG, SID, 1, 120).await.unwrap(),
            Some(2)
        );
        // A concurrent restore that read epoch 1 loses.
        assert_eq!(bump_epoch_with(&db, ORG, SID, 1, 121).await.unwrap(), None);
        // The previous owner, still on epoch 1, can no longer commit.
        assert!(
            !advance_watermark_with(&db, ORG, SID, 1, 3, 5, 200, 210, 211)
                .await
                .unwrap()
        );
        // The watermark carries over: the restored session continues the log.
        assert!(
            advance_watermark_with(&db, ORG, SID, 2, 3, 5, 200, 210, 211)
                .await
                .unwrap()
        );
    }

    async fn title_of(db: &sea_orm::DatabaseConnection) -> (String, String) {
        let row = get_with(db, ORG, SID).await.unwrap().unwrap();
        (row.title, row.title_source)
    }

    #[tokio::test]
    async fn titles_go_prompt_then_generated_and_a_rename_always_wins() {
        let db = db().await;
        chat(&db, SID, ALICE, 10).await;
        set_prompt_title_with(&db, ORG, SID, "why is p99 up since", 11)
            .await
            .unwrap();
        // A second prompt never replaces the first.
        set_prompt_title_with(&db, ORG, SID, "and now?", 12)
            .await
            .unwrap();
        assert_eq!(
            title_of(&db).await,
            ("why is p99 up since".into(), TITLE_FROM_PROMPT.into())
        );
        set_auto_title_with(&db, ORG, SID, "p99 latency spike", 20)
            .await
            .unwrap();
        assert_eq!(
            title_of(&db).await,
            ("p99 latency spike".into(), TITLE_GENERATED.into())
        );
        set_prompt_title_with(&db, ORG, SID, "later prompt", 21)
            .await
            .unwrap();
        assert_eq!(title_of(&db).await.0, "p99 latency spike");

        // Only the owner can rename, and a rename is never replaced.
        assert!(!rename_with(&db, ORG, SID, BOB, "mine", 30).await.unwrap());
        assert!(
            rename_with(&db, ORG, SID, ALICE, "p99 regression", 31)
                .await
                .unwrap()
        );
        set_auto_title_with(&db, ORG, SID, "something else", 40)
            .await
            .unwrap();
        assert_eq!(
            title_of(&db).await,
            ("p99 regression".into(), TITLE_FROM_USER.into())
        );
    }

    #[tokio::test]
    async fn only_rows_whose_oldest_events_aged_out_are_purged() {
        let db = db().await;
        // (session, first event, last event)
        for (sid, first, last) in [("old", 50, 100), ("recent", 600, 900), ("deleted", 50, 60)] {
            chat(&db, sid, ALICE, 10).await;
            assert!(
                advance_watermark_with(&db, ORG, sid, 1, NO_SEQ, 3, first, last, last)
                    .await
                    .unwrap()
            );
        }
        // Oldest events gone even though it was used lately: purged too.
        chat(&db, "long-lived", ALICE, 10).await;
        assert!(
            advance_watermark_with(&db, ORG, "long-lived", 1, NO_SEQ, 3, 50, 900, 900)
                .await
                .unwrap()
        );
        chat(&db, "empty-old", ALICE, 20).await; // never committed anything
        chat(&db, "empty-new", ALICE, 800).await;
        assert!(
            mark_deleted_with(&db, ORG, "deleted", ALICE, 70)
                .await
                .unwrap()
        );
        get_or_create_with(&db, "other-org", "old", ALICE, "a@x", "o2-ai", 10)
            .await
            .unwrap();

        assert_eq!(purge_expired_with(&db, ORG, 500).await.unwrap(), 4);
        let mut left = Vec::new();
        for sid in [
            "old",
            "recent",
            "deleted",
            "long-lived",
            "empty-old",
            "empty-new",
        ] {
            if get_with(&db, ORG, sid).await.unwrap().is_some() {
                left.push(sid);
            }
        }
        assert_eq!(left, vec!["recent", "empty-new"]);
        assert!(get_with(&db, "other-org", "old").await.unwrap().is_some());
        let mut orgs = orgs_with_chats_with(&db).await.unwrap();
        orgs.sort();
        assert_eq!(orgs, vec!["org", "other-org"]);
    }

    #[tokio::test]
    async fn chats_in_use_with_old_history_are_due_for_refresh() {
        let db = db().await;
        for (sid, first, last) in [("in-use", 50, 900), ("idle", 50, 100), ("fresh", 700, 900)] {
            chat(&db, sid, ALICE, 10).await;
            assert!(
                advance_watermark_with(&db, ORG, sid, 1, NO_SEQ, 3, first, last, last)
                    .await
                    .unwrap()
            );
        }
        let due = due_for_refresh_with(&db, ORG, 500, 500, 10).await.unwrap();
        assert_eq!(
            due.iter()
                .map(|r| r.session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["in-use"]
        );

        // The rewrite moves the window forward; a turn committing meanwhile
        // with an earlier timestamp never pulls its end back.
        set_refreshed_range_with(&db, ORG, "in-use", 1000, 1010)
            .await
            .unwrap();
        assert!(
            advance_watermark_with(&db, ORG, "in-use", 1, 3, 5, 950, 950, 950)
                .await
                .unwrap()
        );
        let row = get_with(&db, ORG, "in-use").await.unwrap().unwrap();
        assert_eq!(
            (row.first_event_at, row.last_event_at),
            (Some(1000), Some(1010))
        );
        assert!(
            due_for_refresh_with(&db, ORG, 500, 500, 10)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn listing_is_per_owner_newest_first_and_keyset_paginated() {
        let db = db().await;
        for (i, sid) in ["s1", "s2", "s3", "s4"].iter().enumerate() {
            chat(&db, sid, ALICE, 100 + i as i64).await;
        }
        chat(&db, "bob-chat", BOB, 500).await;
        // Same updated_at: the session id breaks the tie deterministically.
        chat(&db, "s0", ALICE, 103).await;
        assert!(mark_deleted_with(&db, ORG, "s1", ALICE, 99).await.unwrap());
        // mark_deleted bumped s1's updated_at; it is still excluded.

        let page1 = list_for_user_with(&db, ORG, ALICE, None, 2).await.unwrap();
        let ids: Vec<_> = page1.iter().map(|r| r.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s4", "s0"]);
        let last = page1.last().unwrap();
        let cursor = ListCursor {
            updated_at: last.updated_at,
            session_id: last.session_id.clone(),
        };
        let page2 = list_for_user_with(&db, ORG, ALICE, Some(&cursor), 10)
            .await
            .unwrap();
        let ids: Vec<_> = page2.iter().map(|r| r.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s3", "s2"]);
        // Only the owner can delete.
        assert!(!mark_deleted_with(&db, ORG, "s2", BOB, 600).await.unwrap());

        // Clearing everything touches only the caller's own chats.
        let mut cleared = mark_all_deleted_with(&db, ORG, ALICE, 700).await.unwrap();
        cleared.sort();
        assert_eq!(cleared, vec!["s0", "s2", "s3", "s4"]);
        assert!(
            list_for_user_with(&db, ORG, ALICE, None, 10)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_for_user_with(&db, ORG, BOB, None, 10)
                .await
                .unwrap()
                .len(),
            1
        );
    }
}
