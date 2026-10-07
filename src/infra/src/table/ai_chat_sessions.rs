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

//! The `ai_chat_sessions` index over `_o2_ai_chat_events`: ownership, watermark, epoch fencing.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, Set, SqlErr,
    sea_query::{Expr, Func},
};

pub use super::entity::ai_chat_sessions::Model;
use super::entity::{ai_chat_sessions::*, ai_chat_turns};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// Where a chat's title came from; a later source replaces an earlier one, never the user's.
pub const TITLE_FROM_PROMPT: &str = "prompt";
pub const TITLE_GENERATED: &str = "generated";
pub const TITLE_FROM_USER: &str = "user";

pub const STATUS_ACTIVE: &str = "active";
pub const STATUS_DELETED: &str = "deleted";
/// "No durable event committed": opencode's `seq` is 0-based.
pub const NO_SEQ: i64 = -1;

/// Outcome of [`bind_opencode_session`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Binding {
    /// The chat is (now) bound to this opencode session.
    Bound { epoch: i64, last_committed_seq: i64 },
    /// History of another opencode session is committed; restore instead of splicing two logs.
    Forked { bound_opencode_session_id: String },
}

/// Keyset cursor for [`list_for_user`]: the last row of the previous page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListCursor {
    pub updated_at: i64,
    pub session_id: String,
}

/// A new chat forked from a share (see [`insert_fork`]).
#[derive(Debug, Clone)]
pub struct NewFork<'a> {
    pub org_id: &'a str,
    pub session_id: &'a str,
    pub user_id: &'a str,
    pub user_email: &'a str,
    pub agent_type: &'a str,
    pub title: &'a str,
    pub share_id: &'a str,
    pub seed_seq: i64,
}

/// `column` moved forward to `value`, never back (NULL is unset): the read window never shrinks.
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

/// The chat's index row, inserted if missing; the caller checks `user_id` (ownership is not).
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
        forked_from_share: Set(None),
        fork_seed_seq: Set(None),
        replica_purged_at: Set(None),
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

/// Create a fork's index row; its title counts as the user's, so nothing renames it.
pub async fn insert_fork(fork: &NewFork<'_>, now: i64) -> Result<Model, errors::Error> {
    insert_fork_with(get_orm_client_rw().await, fork, now).await
}

pub async fn insert_fork_with<C: ConnectionTrait>(
    conn: &C,
    fork: &NewFork<'_>,
    now: i64,
) -> Result<Model, errors::Error> {
    let record = ActiveModel {
        org_id: Set(fork.org_id.to_string()),
        session_id: Set(fork.session_id.to_string()),
        user_id: Set(fork.user_id.to_string()),
        user_email: Set(fork.user_email.to_string()),
        opencode_session_id: Set(None),
        agent_type: Set(fork.agent_type.to_string()),
        title: Set(fork.title.to_string()),
        title_source: Set(TITLE_FROM_USER.to_string()),
        status: Set(STATUS_ACTIVE.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        first_event_at: Set(None),
        last_event_at: Set(None),
        last_committed_seq: Set(NO_SEQ),
        session_epoch: Set(1),
        last_turn_id: Set(None),
        forked_from_share: Set(Some(fork.share_id.to_string())),
        fork_seed_seq: Set(Some(fork.seed_seq)),
        replica_purged_at: Set(None),
    };
    Entity::insert(record).exec(conn).await.map_err(db_err)?;
    get_with(conn, fork.org_id, fork.session_id)
        .await?
        .ok_or_else(|| errors::Error::Message("ai_chat_sessions row vanished after insert".into()))
}

/// The rows of `session_ids` in `org_id` that exist, in no particular order.
pub async fn get_many(org_id: &str, session_ids: &[String]) -> Result<Vec<Model>, errors::Error> {
    get_many_with(get_orm_client_ro().await, org_id, session_ids).await
}

pub async fn get_many_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_ids: &[String],
) -> Result<Vec<Model>, errors::Error> {
    let mut rows = Vec::with_capacity(session_ids.len());
    for chunk in session_ids.chunks(500) {
        rows.extend(
            Entity::find()
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::SessionId.is_in(chunk.iter().cloned()))
                .all(conn)
                .await
                .map_err(db_err)?,
        );
    }
    Ok(rows)
}

/// Record the turn about to run under the lease; `false` when `turn_id` is already recorded.
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

/// Binds the opencode session (another only while nothing is committed); epoch returned as is.
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
    // Conditional on an empty watermark so a concurrent commit under the old binding survives.
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

/// Starts a new epoch (each turn and restore) by CAS on `expected_epoch`; `None` if it moved.
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
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok((result.rows_affected == 1).then_some(expected_epoch + 1))
}

/// Moves the watermark from exactly `expected_prev_seq` to `new_seq` at `epoch`; `false`: fenced.
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

/// A provisional title from the first prompt, only while the chat has none.
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

/// The title opencode generated; replaces a provisional one, never the user's ([`rename`]).
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

/// The user's title; `false` without an active chat of `user_id`. A rename is not activity.
pub async fn rename(
    org_id: &str,
    session_id: &str,
    user_id: &str,
    title: &str,
) -> Result<bool, errors::Error> {
    rename_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        user_id,
        title,
    )
    .await
}

pub async fn rename_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    user_id: &str,
    title: &str,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Title, Expr::value(title.to_string()))
        .col_expr(
            Column::TitleSource,
            Expr::value(TITLE_FROM_USER.to_string()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Tombstone a chat so every read and write stops; `false` without an active chat of `user_id`.
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

/// Tombstone every active chat `user_id` owns in `org_id`; returns their session ids.
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
    // Bounded statements: thousands of chats must not become one unbounded IN list.
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

/// Session ids of every active chat `user_id` owns in `org_id`.
pub async fn active_ids_for_user(
    org_id: &str,
    user_id: &str,
) -> Result<Vec<String>, errors::Error> {
    active_ids_for_user_with(get_orm_client_ro().await, org_id, user_id).await
}

pub async fn active_ids_for_user_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_id: &str,
) -> Result<Vec<String>, errors::Error> {
    Entity::find()
        .select_only()
        .column(Column::SessionId)
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .into_tuple()
        .all(conn)
        .await
        .map_err(db_err)
}

/// Deleted chats whose o2-ai copies are not yet confirmed gone, least recently tried first.
pub async fn due_for_replica_purge(
    org_id: &str,
    limit: u64,
    repurge_since: i64,
) -> Result<Vec<Model>, errors::Error> {
    due_for_replica_purge_with(get_orm_client_ro().await, org_id, limit, repurge_since).await
}

/// Deleted chats not yet purged everywhere first, then ones purged after `repurge_since`.
pub async fn due_for_replica_purge_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    limit: u64,
    repurge_since: i64,
) -> Result<Vec<Model>, errors::Error> {
    let mut rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Status.eq(STATUS_DELETED))
        .filter(Column::ReplicaPurgedAt.is_null())
        .order_by_asc(Column::UpdatedAt)
        .limit(limit)
        .all(conn)
        .await
        .map_err(db_err)?;
    let left = limit.saturating_sub(rows.len() as u64);
    if left > 0 {
        // A replica that was down at delete time only gets the delete on a later pass.
        rows.extend(
            Entity::find()
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::Status.eq(STATUS_DELETED))
                .filter(Column::ReplicaPurgedAt.gt(repurge_since))
                .order_by_asc(Column::ReplicaPurgedAt)
                .limit(left)
                .all(conn)
                .await
                .map_err(db_err)?,
        );
    }
    Ok(rows)
}

/// Every live o2-ai replica confirmed it no longer holds this deleted chat.
pub async fn mark_replica_purged(
    org_id: &str,
    session_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    mark_replica_purged_with(get_orm_client_rw().await, org_id, session_id, now).await
}

pub async fn mark_replica_purged_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::ReplicaPurgedAt, Expr::value(Some(now)))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::Status.eq(STATUS_DELETED))
        .filter(Column::ReplicaPurgedAt.is_null())
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// A replica purge attempt failed: the chat goes to the back of the queue.
pub async fn defer_replica_purge(
    org_id: &str,
    session_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    defer_replica_purge_with(get_orm_client_rw().await, org_id, session_id, now).await
}

pub async fn defer_replica_purge_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::Status.eq(STATUS_DELETED))
        .filter(Column::ReplicaPurgedAt.is_null())
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
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

/// Removes rows (active or tombstoned) whose oldest events predate `cutoff`; returns how many.
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

/// Active chats used since `active_since` with events before `stale_before`, oldest first.
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

/// Moves the read window onto a rewrite through `copied_seq`; `false` if more was committed.
pub async fn set_refreshed_range(
    org_id: &str,
    session_id: &str,
    first: i64,
    last: i64,
    copied_seq: i64,
) -> Result<bool, errors::Error> {
    set_refreshed_range_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        first,
        last,
        copied_seq,
    )
    .await
}

pub async fn set_refreshed_range_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    first: i64,
    last: i64,
    copied_seq: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(
            Column::FirstEventAt,
            not_before(Column::FirstEventAt, first),
        )
        .col_expr(Column::LastEventAt, not_before(Column::LastEventAt, last))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::LastCommittedSeq.eq(copied_seq))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// A page of a user's active chats, newest first; an empty chat only while a turn runs.
pub async fn list_for_user(
    org_id: &str,
    user_id: &str,
    after: Option<&ListCursor>,
    limit: u64,
    running_since: i64,
) -> Result<Vec<Model>, errors::Error> {
    list_for_user_with(
        get_orm_client_ro().await,
        org_id,
        user_id,
        after,
        limit,
        running_since,
    )
    .await
}

pub async fn list_for_user_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_id: &str,
    after: Option<&ListCursor>,
    limit: u64,
    running_since: i64,
) -> Result<Vec<Model>, errors::Error> {
    let running = ai_chat_turns::Entity::find()
        .select_only()
        .column(ai_chat_turns::Column::SessionId)
        .filter(ai_chat_turns::Column::OrgId.eq(org_id))
        .filter(ai_chat_turns::Column::Status.eq(super::ai_chat_turns::TURN_RUNNING))
        .filter(ai_chat_turns::Column::StartedAt.gte(running_since))
        .into_query();
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserId.eq(user_id))
        .filter(Column::Status.eq(STATUS_ACTIVE))
        .filter(
            Condition::any()
                .add(Column::LastCommittedSeq.ne(NO_SEQ))
                .add(Column::ForkedFromShare.is_not_null())
                .add(Column::SessionId.in_subquery(running)),
        );
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
        for stmt in [
            schema.create_table_from_entity(Entity),
            schema.create_table_from_entity(ai_chat_turns::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
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

        // Another caller (even another user) gets the existing row; ownership is the caller's call.
        let again = chat(&db, SID, BOB, 20).await;
        assert_eq!(again.user_id, ALICE);
        assert_eq!(again.created_at, 10);
        assert!(get_with(&db, "other-org", SID).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_fork_keeps_its_title_and_remembers_its_seed() {
        let db = db().await;
        let fork = NewFork {
            org_id: ORG,
            session_id: SID,
            user_id: BOB,
            user_email: "b@x",
            agent_type: "o2-ai",
            title: "p99 regression (copy)",
            share_id: "share-1",
            seed_seq: 7,
        };
        let row = insert_fork_with(&db, &fork, 10).await.unwrap();
        assert_eq!(row.user_id, BOB);
        assert_eq!(row.last_committed_seq, NO_SEQ);
        assert_eq!(row.forked_from_share.as_deref(), Some("share-1"));
        assert_eq!(row.fork_seed_seq, Some(7));
        assert!(insert_fork_with(&db, &fork, 11).await.is_err());

        set_prompt_title_with(&db, ORG, SID, "first prompt", 12)
            .await
            .unwrap();
        set_auto_title_with(&db, ORG, SID, "generated", 13)
            .await
            .unwrap();
        assert_eq!(title_of(&db).await.0, "p99 regression (copy)");

        chat(&db, "other", ALICE, 20).await;
        let mut found: Vec<_> = get_many_with(&db, ORG, &[SID.into(), "other".into(), "x".into()])
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.session_id)
            .collect();
        found.sort();
        assert_eq!(found, vec![SID.to_string(), "other".to_string()]);
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
        assert!(!rename_with(&db, ORG, SID, BOB, "mine").await.unwrap());
        assert!(
            rename_with(&db, ORG, SID, ALICE, "p99 regression")
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

        // A rewrite of fewer events than are committed now leaves the window alone.
        assert!(
            !set_refreshed_range_with(&db, ORG, "in-use", 1000, 1010, 2)
                .await
                .unwrap()
        );
        assert_eq!(
            get_with(&db, ORG, "in-use")
                .await
                .unwrap()
                .unwrap()
                .first_event_at,
            Some(50)
        );
        // The rewrite moves the window forward; a later commit never pulls its end back.
        assert!(
            set_refreshed_range_with(&db, ORG, "in-use", 1000, 1010, 3)
                .await
                .unwrap()
        );
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

    /// A chat with one committed batch, last active at `now`.
    async fn used_chat(db: &sea_orm::DatabaseConnection, sid: &str, user: &str, now: i64) {
        chat(db, sid, user, now).await;
        assert!(
            advance_watermark_with(db, ORG, sid, 1, NO_SEQ, 0, now, now, now)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn listing_is_per_owner_newest_first_and_keyset_paginated() {
        let db = db().await;
        for (i, sid) in ["s1", "s2", "s3", "s4"].iter().enumerate() {
            used_chat(&db, sid, ALICE, 100 + i as i64).await;
        }
        used_chat(&db, "bob-chat", BOB, 500).await;
        // Same updated_at: the session id breaks the tie deterministically.
        used_chat(&db, "s0", ALICE, 103).await;
        assert!(mark_deleted_with(&db, ORG, "s1", ALICE, 99).await.unwrap());
        // mark_deleted bumped s1's updated_at; it is still excluded.

        let page1 = list_for_user_with(&db, ORG, ALICE, None, 2, 0)
            .await
            .unwrap();
        let ids: Vec<_> = page1.iter().map(|r| r.session_id.as_str()).collect();
        assert_eq!(ids, vec!["s4", "s0"]);
        let last = page1.last().unwrap();
        let cursor = ListCursor {
            updated_at: last.updated_at,
            session_id: last.session_id.clone(),
        };
        let page2 = list_for_user_with(&db, ORG, ALICE, Some(&cursor), 10, 0)
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
            list_for_user_with(&db, ORG, ALICE, None, 10, 0)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_for_user_with(&db, ORG, BOB, None, 10, 0)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    async fn listed(db: &sea_orm::DatabaseConnection, running_since: i64) -> Vec<String> {
        list_for_user_with(db, ORG, ALICE, None, 10, running_since)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.session_id)
            .collect()
    }

    #[tokio::test]
    async fn a_chat_with_nothing_stored_is_listed_only_while_its_turn_runs() {
        use crate::table::ai_chat_turns::{self, TURN_FAILED};

        let db = db().await;
        used_chat(&db, "used", ALICE, 10).await;
        chat(&db, "empty", ALICE, 20).await;
        assert_eq!(listed(&db, 0).await, vec!["used"]);

        ai_chat_turns::admit_with(&db, ORG, "empty", "t1", 0, 30)
            .await
            .unwrap();
        assert_eq!(listed(&db, 0).await, vec!["empty", "used"]);
        // A running turn older than the longest allowed turn died.
        assert_eq!(listed(&db, 31).await, vec!["used"]);
        ai_chat_turns::finish_with(&db, ORG, "empty", "t1", TURN_FAILED, None, None, None, 40)
            .await
            .unwrap();
        assert_eq!(listed(&db, 0).await, vec!["used"]);

        let fork = NewFork {
            org_id: ORG,
            session_id: "fork",
            user_id: ALICE,
            user_email: "a@x",
            agent_type: "o2-ai",
            title: "copy",
            share_id: "share-1",
            seed_seq: 3,
        };
        insert_fork_with(&db, &fork, 50).await.unwrap();
        assert_eq!(listed(&db, 0).await, vec!["fork", "used"]);
    }

    #[tokio::test]
    async fn a_rename_does_not_reorder_the_list() {
        let db = db().await;
        used_chat(&db, "older", ALICE, 10).await;
        used_chat(&db, "newer", ALICE, 20).await;
        assert!(
            rename_with(&db, ORG, "older", ALICE, "renamed")
                .await
                .unwrap()
        );
        assert_eq!(listed(&db, 0).await, vec!["newer", "older"]);
        let row = get_with(&db, ORG, "older").await.unwrap().unwrap();
        assert_eq!((row.title.as_str(), row.updated_at), ("renamed", 10));
    }

    #[tokio::test]
    async fn deleted_chats_are_purged_from_replicas_until_confirmed_and_for_a_window() {
        let db = db().await;
        for sid in ["old", "recent", "confirmed", "active"] {
            used_chat(&db, sid, ALICE, 10).await;
        }
        assert!(mark_deleted_with(&db, ORG, "old", ALICE, 50).await.unwrap());
        assert!(
            mark_deleted_with(&db, ORG, "recent", ALICE, 200)
                .await
                .unwrap()
        );
        assert!(
            mark_deleted_with(&db, ORG, "confirmed", ALICE, 210)
                .await
                .unwrap()
        );
        mark_replica_purged_with(&db, ORG, "confirmed", 220)
            .await
            .unwrap();
        // An active chat is never marked.
        mark_replica_purged_with(&db, ORG, "active", 220)
            .await
            .unwrap();
        let due_ids =
            |due: Vec<Model>| -> Vec<String> { due.into_iter().map(|r| r.session_id).collect() };
        // However long ago it was deleted, an unconfirmed purge is retried.
        assert_eq!(
            due_ids(
                due_for_replica_purge_with(&db, ORG, 10, 1000)
                    .await
                    .unwrap()
            ),
            vec!["old", "recent"]
        );
        assert_eq!(
            due_ids(due_for_replica_purge_with(&db, ORG, 1, 1000).await.unwrap()),
            vec!["old"]
        );
        // A purge confirmed inside the window is re-sent after the unconfirmed ones.
        assert_eq!(
            due_ids(due_for_replica_purge_with(&db, ORG, 10, 100).await.unwrap()),
            vec!["old", "recent", "confirmed"]
        );
        // Re-confirming keeps the first confirmation time, so the window ends.
        mark_replica_purged_with(&db, ORG, "confirmed", 900)
            .await
            .unwrap();
        let confirmed = get_with(&db, ORG, "confirmed").await.unwrap().unwrap();
        assert_eq!(confirmed.replica_purged_at, Some(220));
        // A failed attempt moves it behind the others, so one stuck chat never starves the rest.
        defer_replica_purge_with(&db, ORG, "old", 300)
            .await
            .unwrap();
        assert_eq!(
            due_ids(due_for_replica_purge_with(&db, ORG, 1, 1000).await.unwrap()),
            vec!["recent"]
        );
        let active = get_with(&db, ORG, "active").await.unwrap().unwrap();
        assert_eq!(active.replica_purged_at, None);
        assert_eq!(
            active_ids_for_user_with(&db, ORG, ALICE).await.unwrap(),
            vec!["active".to_string()]
        );
    }
}
