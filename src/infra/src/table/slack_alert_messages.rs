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

//! `slack_alert_messages`: the Slack message of each firing, and its render outbox versions.

use config::{
    meta::slack::{
        MessageState, SLACK_ALERT_MESSAGE_CONTENT_MAX_BYTES, SlackAlertMessage,
        SlackAlertMessageKey, SlackMessageContent,
    },
    utils::{json, time::now_micros},
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Select, Set,
    UpdateMany,
    sea_query::{Expr, Func, OnConflict},
};

use super::{
    entity::slack_alert_messages::{ActiveModel, Column, Entity, Model},
    slack_shared::{db_err, decode_all, enum_text, parse_enum},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

/// False when the firing already has a row on this destination.
pub async fn insert_firing(row: &SlackAlertMessage) -> Result<bool, Error> {
    insert_firing_with(get_orm_client_rw().await, row).await
}

pub async fn get_by_key(key: &SlackAlertMessageKey) -> Result<Option<SlackAlertMessage>, Error> {
    get_by_key_with(get_orm_client_ro().await, key).await
}

/// Every destination's row for one firing, for the `Refresh` events after an outbox bump.
pub async fn list_by_firing(
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    list_by_firing_with(
        get_orm_client_ro().await,
        alert_id,
        group_key,
        firing_started_at,
    )
    .await
}

/// The group's newest cleared message on the destination, the candidate for re-fire reuse.
pub async fn latest_cleared_for(
    destination_id: &str,
    alert_id: &str,
    group_key: &str,
) -> Result<Option<SlackAlertMessage>, Error> {
    latest_cleared_for_with(
        get_orm_client_ro().await,
        destination_id,
        alert_id,
        group_key,
    )
    .await
}

/// Adds one to `wanted_seq` of every row of the firing; returns the rows bumped.
pub async fn bump_wanted(
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
) -> Result<u64, Error> {
    bump_wanted_with(
        get_orm_client_rw().await,
        alert_id,
        group_key,
        firing_started_at,
    )
    .await
}

pub async fn set_posting(key: &SlackAlertMessageKey, at: i64) -> Result<bool, Error> {
    set_posting_with(get_orm_client_rw().await, key, at).await
}

pub async fn set_auto_investigated(key: &SlackAlertMessageKey, at: i64) -> Result<bool, Error> {
    set_auto_investigated_with(get_orm_client_rw().await, key, at).await
}

pub async fn set_posted(
    key: &SlackAlertMessageKey,
    message_ts: &str,
    at: i64,
) -> Result<bool, Error> {
    set_posted_with(get_orm_client_rw().await, key, message_ts, at).await
}

/// Records a render of `read_seq`; `pending_since` clears only when nothing was bumped meanwhile.
pub async fn mark_rendered_cas(key: &SlackAlertMessageKey, read_seq: i64) -> Result<bool, Error> {
    mark_rendered_cas_with(get_orm_client_rw().await, key, read_seq).await
}

pub async fn set_state(
    key: &SlackAlertMessageKey,
    state: MessageState,
    at: i64,
) -> Result<bool, Error> {
    set_state_with(get_orm_client_rw().await, key, state, at).await
}

/// Stores the content a re-render rebuilds from; refuses more than 16 KB of JSON.
pub async fn set_content(
    key: &SlackAlertMessageKey,
    content: &SlackMessageContent,
    at: i64,
) -> Result<bool, Error> {
    set_content_with(get_orm_client_rw().await, key, content, at).await
}

/// Rows whose latest change is not rendered yet and has waited since before `before`.
pub async fn list_pending_older_than(
    before: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    list_pending_older_than_with(get_orm_client_ro().await, before, limit).await
}

pub async fn list_open(limit: u64) -> Result<Vec<SlackAlertMessage>, Error> {
    list_open_with(get_orm_client_ro().await, limit).await
}

pub async fn delete_terminal_before(at: i64) -> Result<u64, Error> {
    delete_terminal_before_with(get_orm_client_rw().await, at).await
}

pub async fn delete_by_destination(destination_id: &str) -> Result<u64, Error> {
    delete_by_destination_with(get_orm_client_rw().await, destination_id).await
}

pub async fn delete_by_alert(org_id: &str, alert_id: &str) -> Result<u64, Error> {
    delete_by_alert_with(get_orm_client_rw().await, org_id, alert_id).await
}

pub async fn delete_by_installation(installation_id: &str) -> Result<u64, Error> {
    delete_by_installation_with(get_orm_client_rw().await, installation_id).await
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn set_digest_ts(
    key: &SlackAlertMessageKey,
    digest_ts: &str,
    at: i64,
) -> Result<bool, Error> {
    set_digest_ts_with(get_orm_client_rw().await, key, digest_ts, at).await
}

/// Firings of a channel folded by digest mode but not yet on a digest message.
pub async fn list_unfolded(
    installation_id: &str,
    channel_id: &str,
    since: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    list_unfolded_with(
        get_orm_client_ro().await,
        installation_id,
        channel_id,
        since,
        limit,
    )
    .await
}

pub async fn list_by_digest(
    installation_id: &str,
    channel_id: &str,
    digest_ts: &str,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    list_by_digest_with(
        get_orm_client_ro().await,
        installation_id,
        channel_id,
        digest_ts,
        limit,
    )
    .await
}

pub async fn list_terminal_before(at: i64, limit: u64) -> Result<Vec<SlackAlertMessage>, Error> {
    list_terminal_before_with(get_orm_client_ro().await, at, limit).await
}

/// Firings that ended between `from` and `to` without ever reaching Slack: the outage digest.
pub async fn list_ended_unposted(
    installation_id: &str,
    from: i64,
    to: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    list_ended_unposted_with(get_orm_client_ro().await, installation_id, from, to, limit).await
}

/// Rows Slack does not show yet, waiting since before `before`: failed posts, unrendered changes.
pub async fn list_waiting(
    installation_id: Option<&str>,
    before: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    list_waiting_with(get_orm_client_ro().await, installation_id, before, limit).await
}

pub async fn insert_firing_with<C: ConnectionTrait>(
    conn: &C,
    row: &SlackAlertMessage,
) -> Result<bool, Error> {
    let inserted = Entity::insert(to_active(row)?)
        .on_conflict(
            OnConflict::columns([
                Column::DestinationId,
                Column::AlertId,
                Column::GroupKey,
                Column::FiringStartedAt,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(inserted > 0)
}

pub async fn get_by_key_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
) -> Result<Option<SlackAlertMessage>, Error> {
    by_key(live(), key)
        .one(conn)
        .await?
        .map(from_model)
        .transpose()
}

pub async fn list_by_firing_with<C: ConnectionTrait>(
    conn: &C,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let models = live()
        .filter(Column::AlertId.eq(alert_id))
        .filter(Column::GroupKey.eq(group_key))
        .filter(Column::FiringStartedAt.eq(firing_started_at))
        .order_by_asc(Column::DestinationId)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

/// The row's `updated_at` is its clear time: only state and content writes move it.
pub async fn latest_cleared_for_with<C: ConnectionTrait>(
    conn: &C,
    destination_id: &str,
    alert_id: &str,
    group_key: &str,
) -> Result<Option<SlackAlertMessage>, Error> {
    live()
        .filter(Column::DestinationId.eq(destination_id))
        .filter(Column::AlertId.eq(alert_id))
        .filter(Column::GroupKey.eq(group_key))
        .filter(Column::State.eq(enum_text(&MessageState::Cleared)?))
        .order_by_desc(Column::FiringStartedAt)
        .one(conn)
        .await?
        .map(from_model)
        .transpose()
}

pub async fn bump_wanted_with<C: ConnectionTrait>(
    conn: &C,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
) -> Result<u64, Error> {
    // No guard on pending_since: a bump during a render must still raise wanted_seq.
    let result = Entity::update_many()
        .col_expr(Column::WantedSeq, Expr::col(Column::WantedSeq).add(1))
        .col_expr(
            Column::PendingSince,
            Func::coalesce([
                Expr::col(Column::PendingSince).into(),
                Expr::val(now_micros()).into(),
            ])
            .into(),
        )
        .filter(Column::AlertId.eq(alert_id))
        .filter(Column::GroupKey.eq(group_key))
        .filter(Column::FiringStartedAt.eq(firing_started_at))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

pub async fn set_posting_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
    at: i64,
) -> Result<bool, Error> {
    let update = Entity::update_many().col_expr(Column::PostingSince, Expr::value(at));
    exec_for_key(conn, update, key).await
}

pub async fn set_auto_investigated_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
    at: i64,
) -> Result<bool, Error> {
    let update = Entity::update_many()
        .col_expr(Column::LastAutoInvestigatedAt, Expr::value(Some(at)))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    exec_for_key(conn, update, key).await
}

pub async fn set_posted_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
    message_ts: &str,
    at: i64,
) -> Result<bool, Error> {
    let update = Entity::update_many()
        .col_expr(Column::MessageTs, Expr::value(message_ts))
        .col_expr(Column::PostingSince, Expr::value(Option::<i64>::None))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    exec_for_key(conn, update, key).await
}

pub async fn mark_rendered_cas_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
    read_seq: i64,
) -> Result<bool, Error> {
    let update = Entity::update_many()
        .col_expr(Column::RenderedSeq, Expr::value(read_seq))
        .col_expr(
            Column::PendingSince,
            Expr::case(
                Expr::col(Column::WantedSeq).eq(read_seq),
                Expr::value(Option::<i64>::None),
            )
            .finally(Expr::col(Column::PendingSince))
            .into(),
        )
        .filter(Column::RenderedSeq.lte(read_seq));
    exec_for_key(conn, update, key).await
}

pub async fn set_state_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
    state: MessageState,
    at: i64,
) -> Result<bool, Error> {
    let update = Entity::update_many()
        .col_expr(Column::State, Expr::value(enum_text(&state)?))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    exec_for_key(conn, update, key).await
}

pub async fn set_content_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
    content: &SlackMessageContent,
    at: i64,
) -> Result<bool, Error> {
    let update = Entity::update_many()
        .col_expr(Column::Content, Expr::value(content_text(Some(content))?))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    exec_for_key(conn, update, key).await
}

pub async fn list_pending_older_than_with<C: ConnectionTrait>(
    conn: &C,
    before: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let models = live()
        .filter(Expr::col(Column::RenderedSeq).lt(Expr::col(Column::WantedSeq)))
        .filter(Column::PendingSince.lt(before))
        .order_by_asc(Column::PendingSince)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn list_open_with<C: ConnectionTrait>(
    conn: &C,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let models = live()
        .filter(Column::State.is_in(state_texts(&MessageState::OPEN)?))
        .order_by_asc(Column::DestinationId)
        .order_by_asc(Column::AlertId)
        .order_by_asc(Column::GroupKey)
        .order_by_asc(Column::FiringStartedAt)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

/// Open rows folded into a channel digest (no message of their own), one page in key order.
pub async fn list_folded_with<C: ConnectionTrait>(
    conn: &C,
    offset: u64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let folded = Column::DigestTs
        .is_not_null()
        .or(Column::PostingSince.is_null());
    let models = live()
        .filter(Column::State.is_in(state_texts(&MessageState::OPEN)?))
        .filter(Column::MessageTs.is_null())
        .filter(folded)
        .order_by_asc(Column::DestinationId)
        .order_by_asc(Column::AlertId)
        .order_by_asc(Column::GroupKey)
        .order_by_asc(Column::FiringStartedAt)
        .offset(offset)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn delete_terminal_before_with<C: ConnectionTrait>(
    conn: &C,
    at: i64,
) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(Column::State.is_in(state_texts(&MessageState::TERMINAL)?))
        .filter(Column::UpdatedAt.lt(at))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

pub async fn delete_by_destination_with<C: ConnectionTrait>(
    conn: &C,
    destination_id: &str,
) -> Result<u64, Error> {
    delete_where(conn, Column::DestinationId.eq(destination_id)).await
}

pub async fn delete_by_alert_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.eq(alert_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

pub async fn delete_by_installation_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
) -> Result<u64, Error> {
    delete_where(conn, Column::InstallationId.eq(installation_id)).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    delete_where(conn, Column::OrgId.eq(org_id)).await
}

pub async fn set_digest_ts_with<C: ConnectionTrait>(
    conn: &C,
    key: &SlackAlertMessageKey,
    digest_ts: &str,
    at: i64,
) -> Result<bool, Error> {
    let update = Entity::update_many()
        .col_expr(Column::DigestTs, Expr::value(digest_ts))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    exec_for_key(conn, update, key).await
}

/// A folded row never had a post attempt, so `posting_since` tells it from a post that failed.
pub async fn list_unfolded_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    channel_id: &str,
    since: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let models = live()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::ChannelId.eq(channel_id))
        .filter(Column::MessageTs.is_null())
        .filter(Column::DigestTs.is_null())
        .filter(Column::PostingSince.is_null())
        .filter(Column::CreatedAt.gte(since))
        .order_by_asc(Column::CreatedAt)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn list_by_digest_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    channel_id: &str,
    digest_ts: &str,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let models = live()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::ChannelId.eq(channel_id))
        .filter(Column::DigestTs.eq(digest_ts))
        .order_by_asc(Column::FiringStartedAt)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn list_terminal_before_with<C: ConnectionTrait>(
    conn: &C,
    at: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let models = live()
        .filter(Column::State.is_in(state_texts(&MessageState::TERMINAL)?))
        .filter(Column::UpdatedAt.lt(at))
        .order_by_asc(Column::UpdatedAt)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn list_ended_unposted_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    from: i64,
    to: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let models = live()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::MessageTs.is_null())
        .filter(Column::DigestTs.is_null())
        // A failed row's channel refused it for good; no digest line reaches it either.
        .filter(Column::State.is_in(state_texts(&[MessageState::Cleared, MessageState::Gone])?))
        .filter(Column::CreatedAt.lte(to))
        .filter(Column::UpdatedAt.gte(from))
        .order_by_asc(Column::ChannelId)
        .order_by_asc(Column::FiringStartedAt)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

pub async fn list_waiting_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: Option<&str>,
    before: i64,
    limit: u64,
) -> Result<Vec<SlackAlertMessage>, Error> {
    let unposted = Column::MessageTs
        .is_null()
        .and(Column::DigestTs.is_null())
        .and(Column::PostingSince.is_not_null())
        .and(Column::State.is_in(state_texts(&MessageState::OPEN)?))
        .and(Column::PostingSince.lt(before));
    let unrendered = Expr::col(Column::RenderedSeq)
        .lt(Expr::col(Column::WantedSeq))
        .and(Column::PendingSince.lt(before));
    let mut query = live()
        .filter(unposted.or(unrendered))
        .filter(Column::State.ne(enum_text(&MessageState::Failed)?));
    if let Some(installation_id) = installation_id {
        query = query.filter(Column::InstallationId.eq(installation_id));
    }
    let models = query
        .order_by_asc(Column::CreatedAt)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_rows(models))
}

fn live() -> Select<Entity> {
    Entity::find().filter(Column::DeletedAt.is_null())
}

fn by_key<Q: QueryFilter>(query: Q, key: &SlackAlertMessageKey) -> Q {
    query
        .filter(Column::DestinationId.eq(&key.destination_id))
        .filter(Column::AlertId.eq(&key.alert_id))
        .filter(Column::GroupKey.eq(&key.group_key))
        .filter(Column::FiringStartedAt.eq(key.firing_started_at))
}

async fn exec_for_key<C: ConnectionTrait>(
    conn: &C,
    update: UpdateMany<Entity>,
    key: &SlackAlertMessageKey,
) -> Result<bool, Error> {
    let result = by_key(update, key).exec(conn).await?;
    Ok(result.rows_affected > 0)
}

async fn delete_where<C: ConnectionTrait>(
    conn: &C,
    condition: sea_orm::sea_query::SimpleExpr,
) -> Result<u64, Error> {
    let result = Entity::delete_many().filter(condition).exec(conn).await?;
    Ok(result.rows_affected)
}

fn state_texts(states: &[MessageState]) -> Result<Vec<String>, Error> {
    states.iter().map(enum_text).collect()
}

fn content_text(content: Option<&SlackMessageContent>) -> Result<Option<String>, Error> {
    let Some(content) = content else {
        return Ok(None);
    };
    let text = json::to_string(content)?;
    if text.len() > SLACK_ALERT_MESSAGE_CONTENT_MAX_BYTES {
        return Err(Error::Message(format!(
            "slack_alert_messages content is {} bytes, over the {} byte limit",
            text.len(),
            SLACK_ALERT_MESSAGE_CONTENT_MAX_BYTES
        )));
    }
    Ok(Some(text))
}

fn decode_rows(models: Vec<Model>) -> Vec<SlackAlertMessage> {
    decode_all(
        "slack_alert_messages",
        models,
        |m| {
            format!(
                "{}/{}/{}/{}",
                m.destination_id, m.alert_id, m.group_key, m.firing_started_at
            )
        },
        from_model,
    )
}

fn to_active(row: &SlackAlertMessage) -> Result<ActiveModel, Error> {
    Ok(ActiveModel {
        destination_id: Set(row.destination_id.clone()),
        org_id: Set(row.org_id.clone()),
        alert_id: Set(row.alert_id.clone()),
        group_key: Set(row.group_key.clone()),
        firing_started_at: Set(row.firing_started_at),
        installation_id: Set(row.installation_id.clone()),
        channel_id: Set(row.channel_id.clone()),
        message_ts: Set(row.message_ts.clone()),
        digest_ts: Set(row.digest_ts.clone()),
        reuses_firing_started_at: Set(row.reuses_firing_started_at),
        refire_count: Set(row.refire_count),
        first_fired_at: Set(row.first_fired_at),
        state: Set(enum_text(&row.state)?),
        wanted_seq: Set(row.wanted_seq),
        rendered_seq: Set(row.rendered_seq),
        pending_since: Set(row.pending_since),
        posting_since: Set(row.posting_since),
        last_auto_investigated_at: Set(row.last_auto_investigated_at),
        content: Set(content_text(row.content.as_ref())?),
        created_at: Set(row.created_at),
        updated_at: Set(row.updated_at),
        origin_region: Set(row.origin_region.clone()),
        deleted_at: Set(row.deleted_at),
    })
}

fn from_model(model: Model) -> Result<SlackAlertMessage, Error> {
    let content = model
        .content
        .as_deref()
        .map(|text| {
            json::from_str(text).map_err(|_| Error::Message("undecodable content json".to_string()))
        })
        .transpose()?;
    Ok(SlackAlertMessage {
        state: parse_enum("state", &model.state)?,
        content,
        destination_id: model.destination_id,
        org_id: model.org_id,
        alert_id: model.alert_id,
        group_key: model.group_key,
        firing_started_at: model.firing_started_at,
        installation_id: model.installation_id,
        channel_id: model.channel_id,
        message_ts: model.message_ts,
        digest_ts: model.digest_ts,
        reuses_firing_started_at: model.reuses_firing_started_at,
        refire_count: model.refire_count,
        first_fired_at: model.first_fired_at,
        wanted_seq: model.wanted_seq,
        rendered_seq: model.rendered_seq,
        pending_since: model.pending_since,
        posting_since: model.posting_since,
        last_auto_investigated_at: model.last_auto_investigated_at,
        created_at: model.created_at,
        updated_at: model.updated_at,
        origin_region: model.origin_region,
        deleted_at: model.deleted_at,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::slack::RenderedWire;
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::slack::create_tables_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_test(&db).await.unwrap();
        db
    }

    fn row(destination_id: &str, group_key: &str, firing: i64) -> SlackAlertMessage {
        SlackAlertMessage {
            destination_id: destination_id.into(),
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: group_key.into(),
            firing_started_at: firing,
            installation_id: "i1".into(),
            channel_id: "C1".into(),
            first_fired_at: firing,
            state: MessageState::Firing,
            created_at: firing,
            updated_at: firing,
            origin_region: "default".into(),
            ..Default::default()
        }
    }

    async fn get(db: &DatabaseConnection, r: &SlackAlertMessage) -> SlackAlertMessage {
        get_by_key_with(db, &r.key()).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn every_column_reads_back_and_a_second_insert_is_refused() {
        let db = db().await;
        let full = SlackAlertMessage {
            message_ts: Some("1.1".into()),
            digest_ts: Some("1.2".into()),
            reuses_firing_started_at: Some(5),
            refire_count: 7,
            state: MessageState::Muted,
            wanted_seq: 4,
            rendered_seq: 3,
            pending_since: Some(11),
            posting_since: Some(12),
            last_auto_investigated_at: Some(13),
            content: Some(SlackMessageContent {
                rendered: RenderedWire {
                    title: "t".into(),
                    fields: vec![("a".into(), "b".into())],
                    ..Default::default()
                },
                chart_file_id: Some("F1".into()),
                ..Default::default()
            }),
            ..row("d1", "k", 10)
        };
        assert!(insert_firing_with(&db, &full).await.unwrap());
        assert!(!insert_firing_with(&db, &row("d1", "k", 10)).await.unwrap());
        assert_eq!(get(&db, &full).await, full);
    }

    #[tokio::test]
    async fn bump_wanted_always_adds_one_and_keeps_the_oldest_pending_since() {
        let db = db().await;
        let r = row("d1", "k", 10);
        insert_firing_with(&db, &r).await.unwrap();
        insert_firing_with(&db, &row("d2", "k", 10)).await.unwrap();
        insert_firing_with(&db, &row("d1", "k", 9)).await.unwrap();
        assert_eq!(bump_wanted_with(&db, "a1", "k", 10).await.unwrap(), 2);
        let first = get(&db, &r)
            .await
            .pending_since
            .expect("pending after a bump");
        assert_eq!(bump_wanted_with(&db, "a1", "k", 10).await.unwrap(), 2);
        let after = get(&db, &r).await;
        assert_eq!(after.wanted_seq, 2);
        assert_eq!(after.pending_since, Some(first));
        assert_eq!(get(&db, &row("d1", "k", 9)).await.wanted_seq, 0);
        assert_eq!(bump_wanted_with(&db, "a1", "other", 10).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn mark_rendered_cas_keeps_pending_when_wanted_moved_during_the_render() {
        let db = db().await;
        let r = row("d1", "", 10);
        insert_firing_with(&db, &r).await.unwrap();
        bump_wanted_with(&db, "a1", "", 10).await.unwrap();
        let read = get(&db, &r).await.wanted_seq;
        bump_wanted_with(&db, "a1", "", 10).await.unwrap();
        assert!(mark_rendered_cas_with(&db, &r.key(), read).await.unwrap());
        let mid = get(&db, &r).await;
        assert_eq!((mid.rendered_seq, mid.wanted_seq), (1, 2));
        assert!(mid.pending_since.is_some());
        assert_eq!(
            list_pending_older_than_with(&db, i64::MAX, 10)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(mark_rendered_cas_with(&db, &r.key(), 2).await.unwrap());
        let done = get(&db, &r).await;
        assert_eq!(done.rendered_seq, 2);
        assert_eq!(done.pending_since, None);
        assert!(!mark_rendered_cas_with(&db, &r.key(), 1).await.unwrap());
        assert_eq!(get(&db, &r).await.rendered_seq, 2);
        assert!(
            list_pending_older_than_with(&db, i64::MAX, 10)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn posting_state_and_content_writes() {
        let db = db().await;
        let r = row("d1", "", 10);
        insert_firing_with(&db, &r).await.unwrap();
        assert!(set_posting_with(&db, &r.key(), 20).await.unwrap());
        assert_eq!(get(&db, &r).await.posting_since, Some(20));
        assert!(set_posted_with(&db, &r.key(), "171.5", 21).await.unwrap());
        let posted = get(&db, &r).await;
        assert_eq!(posted.message_ts.as_deref(), Some("171.5"));
        assert_eq!((posted.posting_since, posted.updated_at), (None, 21));
        let content = SlackMessageContent {
            rendered: RenderedWire {
                title: "t".into(),
                ..Default::default()
            },
            chart_file_id: None,
            ..Default::default()
        };
        assert!(set_content_with(&db, &r.key(), &content, 22).await.unwrap());
        assert_eq!(get(&db, &r).await.content, Some(content));
        let huge = SlackMessageContent {
            rendered: RenderedWire {
                body: "x".repeat(SLACK_ALERT_MESSAGE_CONTENT_MAX_BYTES),
                ..Default::default()
            },
            chart_file_id: None,
            ..Default::default()
        };
        assert!(set_content_with(&db, &r.key(), &huge, 23).await.is_err());
        assert!(
            set_state_with(&db, &r.key(), MessageState::Cleared, 30)
                .await
                .unwrap()
        );
        let cleared = get(&db, &r).await;
        assert_eq!(
            (cleared.state, cleared.updated_at),
            (MessageState::Cleared, 30)
        );
        let missing = row("d9", "", 10).key();
        assert!(
            !set_state_with(&db, &missing, MessageState::Gone, 30)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn latest_cleared_open_and_terminal_sweeps() {
        let db = db().await;
        for (firing, state) in [
            (1, MessageState::Cleared),
            (2, MessageState::Cleared),
            (3, MessageState::Firing),
            (4, MessageState::Gone),
        ] {
            insert_firing_with(
                &db,
                &SlackAlertMessage {
                    state,
                    ..row("d1", "k", firing)
                },
            )
            .await
            .unwrap();
        }
        insert_firing_with(
            &db,
            &SlackAlertMessage {
                state: MessageState::Acked,
                ..row("d2", "k", 1)
            },
        )
        .await
        .unwrap();
        let latest = latest_cleared_for_with(&db, "d1", "a1", "k").await.unwrap();
        assert_eq!(latest.map(|m| m.firing_started_at), Some(2));
        assert!(
            latest_cleared_for_with(&db, "d2", "a1", "k")
                .await
                .unwrap()
                .is_none()
        );
        let open: Vec<(String, i64)> = list_open_with(&db, 10)
            .await
            .unwrap()
            .into_iter()
            .map(|m| (m.destination_id, m.firing_started_at))
            .collect();
        assert_eq!(open, [("d1".to_string(), 3), ("d2".to_string(), 1)]);
        assert_eq!(
            list_by_firing_with(&db, "a1", "k", 1).await.unwrap().len(),
            2
        );
        assert_eq!(delete_terminal_before_with(&db, 2).await.unwrap(), 1);
        assert_eq!(delete_terminal_before_with(&db, 100).await.unwrap(), 2);
        assert_eq!(list_open_with(&db, 10).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn deletes_by_destination_alert_installation_and_org() {
        let db = db().await;
        insert_firing_with(&db, &row("d1", "k", 1)).await.unwrap();
        insert_firing_with(&db, &row("d2", "k", 1)).await.unwrap();
        insert_firing_with(
            &db,
            &SlackAlertMessage {
                installation_id: "i2".into(),
                ..row("d3", "k", 1)
            },
        )
        .await
        .unwrap();
        insert_firing_with(
            &db,
            &SlackAlertMessage {
                alert_id: "a2".into(),
                ..row("d4", "k", 1)
            },
        )
        .await
        .unwrap();
        insert_firing_with(
            &db,
            &SlackAlertMessage {
                org_id: "globex".into(),
                alert_id: "a3".into(),
                ..row("d5", "k", 1)
            },
        )
        .await
        .unwrap();
        assert_eq!(delete_by_destination_with(&db, "d1").await.unwrap(), 1);
        assert_eq!(delete_by_installation_with(&db, "i2").await.unwrap(), 1);
        assert_eq!(delete_by_alert_with(&db, "acme", "a2").await.unwrap(), 1);
        assert_eq!(delete_by_org_with(&db, "acme").await.unwrap(), 1);
        assert_eq!(delete_by_org_with(&db, "globex").await.unwrap(), 1);
    }

    #[tokio::test]
    async fn digest_folding_lists_unfolded_rows_then_the_digest_members() {
        let db = db().await;
        for firing in 1..=3 {
            insert_firing_with(&db, &row("d1", "k", firing))
                .await
                .unwrap();
        }
        set_posting_with(&db, &row("d1", "k", 1).key(), 10)
            .await
            .unwrap();
        insert_firing_with(
            &db,
            &SlackAlertMessage {
                channel_id: "C2".into(),
                ..row("d9", "k", 2)
            },
        )
        .await
        .unwrap();
        let unfolded: Vec<i64> = list_unfolded_with(&db, "i1", "C1", 2, 10)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.firing_started_at)
            .collect();
        assert_eq!(
            unfolded,
            [2, 3],
            "a post attempt and another channel are not folded"
        );
        for firing in 2..=3 {
            assert!(
                set_digest_ts_with(&db, &row("d1", "k", firing).key(), "9.1", 20)
                    .await
                    .unwrap()
            );
        }
        assert!(
            list_unfolded_with(&db, "i1", "C1", 0, 10)
                .await
                .unwrap()
                .is_empty()
        );
        let members = list_by_digest_with(&db, "i1", "C1", "9.1", 10)
            .await
            .unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].digest_ts.as_deref(), Some("9.1"));
        assert_eq!(members[0].updated_at, 20);
        assert!(
            list_by_digest_with(&db, "i1", "C2", "9.1", 10)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn waiting_rows_are_failed_posts_and_unrendered_changes_older_than_before() {
        let db = db().await;
        insert_firing_with(&db, &row("d1", "k", 1)).await.unwrap();
        insert_firing_with(&db, &row("d2", "k", 2)).await.unwrap();
        insert_firing_with(&db, &row("d3", "k", 3)).await.unwrap();
        insert_firing_with(
            &db,
            &SlackAlertMessage {
                installation_id: "i2".into(),
                ..row("d4", "k", 4)
            },
        )
        .await
        .unwrap();
        set_posting_with(&db, &row("d1", "k", 1).key(), 10)
            .await
            .unwrap();
        set_posted_with(&db, &row("d2", "k", 2).key(), "1.1", 10)
            .await
            .unwrap();
        bump_wanted_with(&db, "a1", "k", 2).await.unwrap();
        set_digest_ts_with(&db, &row("d3", "k", 3).key(), "9.1", 10)
            .await
            .unwrap();
        set_posting_with(&db, &row("d4", "k", 4).key(), 10)
            .await
            .unwrap();
        let waiting: Vec<String> = list_waiting_with(&db, None, now_micros(), 10)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.destination_id)
            .collect();
        assert_eq!(
            waiting,
            ["d1", "d2", "d4"],
            "a folded row waits for the digest, not for Slack"
        );
        assert_eq!(
            list_waiting_with(&db, Some("i2"), now_micros(), 10)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(
            list_waiting_with(&db, None, 5, 10)
                .await
                .unwrap()
                .is_empty(),
            "nothing waited since before 5"
        );
        set_posted_with(&db, &row("d1", "k", 1).key(), "1.2", 11)
            .await
            .unwrap();
        mark_rendered_cas_with(&db, &row("d2", "k", 2).key(), 1)
            .await
            .unwrap();
        assert_eq!(
            list_waiting_with(&db, None, now_micros(), 10)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn folded_rows_list_page_by_page_without_posted_or_posting_rows() {
        let db = db().await;
        for d in ["d1", "d2", "d3", "d4", "d5"] {
            insert_firing_with(&db, &row(d, "k", 1)).await.unwrap();
        }
        set_digest_ts_with(&db, &row("d2", "k", 1).key(), "9.1", 10)
            .await
            .unwrap();
        set_posting_with(&db, &row("d3", "k", 1).key(), 10)
            .await
            .unwrap();
        set_posted_with(&db, &row("d4", "k", 1).key(), "1.1", 10)
            .await
            .unwrap();
        set_state_with(&db, &row("d5", "k", 1).key(), MessageState::Cleared, 10)
            .await
            .unwrap();
        let page = |offset| {
            let db = &db;
            async move {
                list_folded_with(db, offset, 1)
                    .await
                    .unwrap()
                    .into_iter()
                    .map(|m| m.destination_id)
                    .collect::<Vec<_>>()
            }
        };
        assert_eq!(page(0).await, ["d1"]);
        assert_eq!(page(1).await, ["d2"]);
        assert!(page(2).await.is_empty());
    }

    #[tokio::test]
    async fn a_failed_row_never_waits_and_is_terminal() {
        let db = db().await;
        let unposted = row("d1", "k", 1);
        let unrendered = row("d2", "k", 2);
        for r in [&unposted, &unrendered] {
            insert_firing_with(&db, r).await.unwrap();
        }
        set_posting_with(&db, &unposted.key(), 10).await.unwrap();
        set_posted_with(&db, &unrendered.key(), "1.1", 10)
            .await
            .unwrap();
        bump_wanted_with(&db, "a1", "k", 2).await.unwrap();
        assert_eq!(
            list_waiting_with(&db, None, now_micros(), 10)
                .await
                .unwrap()
                .len(),
            2
        );
        for r in [&unposted, &unrendered] {
            set_state_with(&db, &r.key(), MessageState::Failed, 20)
                .await
                .unwrap();
        }
        assert!(
            list_waiting_with(&db, None, now_micros(), 10)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list_terminal_before_with(&db, 21, 10).await.unwrap().len(),
            2
        );
        assert!(
            list_ended_unposted_with(&db, "i1", 0, 100, 10)
                .await
                .unwrap()
                .is_empty(),
            "no outage digest line for a channel that refused it"
        );
    }

    #[tokio::test]
    async fn terminal_rows_list_oldest_first_and_outage_ended_rows_are_unposted_terminals() {
        let db = db().await;
        for firing in 1..=4 {
            insert_firing_with(&db, &row("d1", "k", firing))
                .await
                .unwrap();
        }
        set_posted_with(&db, &row("d1", "k", 1).key(), "1.1", 10)
            .await
            .unwrap();
        set_state_with(&db, &row("d1", "k", 1).key(), MessageState::Cleared, 30)
            .await
            .unwrap();
        set_state_with(&db, &row("d1", "k", 2).key(), MessageState::Gone, 20)
            .await
            .unwrap();
        set_state_with(&db, &row("d1", "k", 3).key(), MessageState::Cleared, 50)
            .await
            .unwrap();
        let terminal: Vec<i64> = list_terminal_before_with(&db, 40, 10)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.firing_started_at)
            .collect();
        assert_eq!(
            terminal,
            [2, 1],
            "oldest change first; the open row is not listed"
        );
        assert_eq!(
            list_terminal_before_with(&db, 40, 1).await.unwrap().len(),
            1
        );
        let ended: Vec<i64> = list_ended_unposted_with(&db, "i1", 15, 100, 10)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.firing_started_at)
            .collect();
        assert_eq!(
            ended,
            [2, 3],
            "the posted clear gets its green edit instead; the open row is still firing"
        );
        let later: Vec<i64> = list_ended_unposted_with(&db, "i1", 25, 40, 10)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.firing_started_at)
            .collect();
        assert_eq!(
            later,
            [3],
            "a clear the leader records after recovery still counts"
        );
    }
}
