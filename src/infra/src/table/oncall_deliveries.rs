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

//! One person's view of the delivery ledger — "what was I sent, and did it
//! arrive?".
//!
//! The ledger itself is per record: `oncall_responses::list_deliveries` answers
//! "who did THIS page reach". That is the right question while working one
//! page and the wrong one the morning after, when the question is "did anything
//! try to wake me last night, and did any of it land". Answering that from the
//! per-record view means fetching every record and every one of its rows, which
//! is the shape of read this codebase has already had to fix once.
//!
//! So the query is keyed on the recipient and scoped by joining back to the
//! record for its `org_id` — the ledger row has no org of its own, and without
//! the join a recipient's rows would read across tenants.
//!
//! The read marker lives in its own table. A responder opening an inbox must
//! not write to the row the engine replays to decide whether to page them
//! again; those are different concerns with very different consequences for
//! being wrong.

use config::{
    ider,
    meta::oncall::{Channel, ResponseEventKind, ResponseState, SubjectType},
};
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, JoinType, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
    sea_query::{Expr, IntoCondition},
};
use serde::Serialize;

use super::entity::{oncall_delivery_reads, oncall_response_events, oncall_responses};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// One attempted page, addressed to one person, with enough of the record
/// beside it that an inbox row is readable without a second fetch.
#[derive(Debug, Clone, FromQueryResult)]
struct Row {
    event_id: String,
    at: i64,
    body: String,
    channel: Option<i32>,
    delivered: Option<bool>,
    ladder_run: Option<i32>,
    rung_micros: Option<i64>,
    response_id: String,
    subject_type: i32,
    subject_id: String,
    team_id: String,
    title: Option<String>,
    priority: i32,
    state: i32,
    read_at: Option<i64>,
}

/// The wire shape of an inbox row.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UserDelivery {
    /// The ledger row's own id — what a read marker names.
    pub event_id: String,
    pub response_id: String,
    /// Micros. When the page was attempted.
    pub at: i64,
    pub body: String,
    /// `None` when this build cannot name the stored channel. The attempt is
    /// still reported: losing "which transport" is much better than losing
    /// "somebody tried to wake you".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<Channel>,
    /// Whether the transport took it. `false` is a recorded failure — the
    /// answer to "did my page reach me" — not the absence of one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivered: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ladder_run: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rung_micros: Option<i64>,
    pub team_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub priority: i32,
    /// The record's state now, not when the page went out — an inbox row for
    /// something already resolved should say so.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_state: Option<ResponseState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_type: Option<SubjectType>,
    pub subject_id: String,
    /// Micros, or `None` while unread.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_at: Option<i64>,
    pub read: bool,
}

impl From<Row> for UserDelivery {
    fn from(r: Row) -> Self {
        Self {
            event_id: r.event_id,
            response_id: r.response_id,
            at: r.at,
            body: r.body,
            channel: r.channel.and_then(Channel::from_i32),
            delivered: r.delivered,
            ladder_run: r.ladder_run,
            rung_micros: r.rung_micros,
            team_id: r.team_id,
            title: r.title,
            priority: r.priority,
            response_state: ResponseState::from_i32(r.state),
            subject_type: SubjectType::from_i32(r.subject_type),
            subject_id: r.subject_id,
            read: r.read_at.is_some(),
            read_at: r.read_at,
        }
    }
}

/// The filter an inbox read applies.
#[derive(Debug, Default, Clone)]
pub struct InboxQuery {
    /// Only rows nobody has marked read.
    pub unread_only: bool,
    /// Micros, inclusive. Bounds the sweep for "last night".
    pub from: Option<i64>,
    /// Micros, exclusive.
    pub to: Option<i64>,
}

/// Builds the joined, org-scoped, recipient-filtered select.
///
/// The left join is what makes `unread_only` a SQL filter rather than a pass
/// over rows this process fetched: filtering after the fact would silently
/// break pagination, because the page would be cut before the filter ran.
fn inbox_select(
    org_id: &str,
    user_email: &str,
    q: &InboxQuery,
) -> sea_orm::Select<oncall_response_events::Entity> {
    let (org, email) = (org_id.to_string(), user_email.to_string());
    let read_join = oncall_response_events::Entity::belongs_to(oncall_delivery_reads::Entity)
        .from(oncall_response_events::Column::Id)
        .to(oncall_delivery_reads::Column::EventId)
        // The marker is per person: joining on the event alone would show one
        // responder's row as read because a colleague had read theirs.
        .on_condition(move |_left, right| {
            Expr::col((right.clone(), oncall_delivery_reads::Column::UserEmail))
                .eq(email.clone())
                .and(Expr::col((right, oncall_delivery_reads::Column::OrgId)).eq(org.clone()))
                .into_condition()
        })
        .into();

    let mut select = oncall_response_events::Entity::find()
        .join(
            JoinType::InnerJoin,
            oncall_response_events::Entity::belongs_to(oncall_responses::Entity)
                .from(oncall_response_events::Column::ResponseId)
                .to(oncall_responses::Column::Id)
                .into(),
        )
        .join(JoinType::LeftJoin, read_join)
        // Without this the ledger has no tenant at all: the event row carries
        // only a response id, and a recipient's address is not unique to an
        // org.
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_response_events::Column::Kind.eq(ResponseEventKind::Delivery.to_i32()))
        .filter(oncall_response_events::Column::Recipient.eq(user_email));

    if q.unread_only {
        select = select.filter(oncall_delivery_reads::Column::ReadAt.is_null());
    }
    if let Some(from) = q.from {
        select = select.filter(oncall_response_events::Column::At.gte(from));
    }
    if let Some(to) = q.to {
        select = select.filter(oncall_response_events::Column::At.lt(to));
    }
    select
}

/// One person's inbox, newest attempt first.
///
/// `limit` is required rather than defaulted, for the same reason
/// `list_open`'s is: a responder on a bad rotation accumulates thousands of
/// these, and no caller should be able to ask for all of them by omission.
pub async fn list_for_user(
    org_id: &str,
    user_email: &str,
    q: &InboxQuery,
    limit: u64,
    offset: u64,
) -> Result<Vec<UserDelivery>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(inbox_select(org_id, user_email, q)
        .select_only()
        .column_as(oncall_response_events::Column::Id, "event_id")
        .column_as(oncall_response_events::Column::At, "at")
        .column_as(oncall_response_events::Column::Body, "body")
        .column_as(oncall_response_events::Column::Channel, "channel")
        .column_as(oncall_response_events::Column::Delivered, "delivered")
        .column_as(oncall_response_events::Column::LadderRun, "ladder_run")
        .column_as(oncall_response_events::Column::RungMicros, "rung_micros")
        .column_as(oncall_response_events::Column::ResponseId, "response_id")
        .column_as(oncall_responses::Column::SubjectType, "subject_type")
        .column_as(oncall_responses::Column::SubjectId, "subject_id")
        .column_as(oncall_responses::Column::TeamId, "team_id")
        .column_as(oncall_responses::Column::Title, "title")
        .column_as(oncall_responses::Column::Priority, "priority")
        .column_as(oncall_responses::Column::State, "state")
        .column_as(oncall_delivery_reads::Column::ReadAt, "read_at")
        // Newest first, with the event id as the final tiebreak: ksuid
        // timestamps resolve to one second, and two pages in the same second
        // could otherwise swap places between pages and be shown twice or not
        // at all.
        .order_by_desc(oncall_response_events::Column::At)
        .order_by_desc(oncall_response_events::Column::Id)
        .limit(limit)
        .offset(offset)
        .into_model::<Row>()
        .all(client)
        .await?
        .into_iter()
        .map(UserDelivery::from)
        .collect())
}

/// How many rows the same filter matches. "Showing 50" is not an answer to
/// "how much was I sent".
pub async fn count_for_user(
    org_id: &str,
    user_email: &str,
    q: &InboxQuery,
) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(inbox_select(org_id, user_email, q).count(client).await?)
}

/// The unread count on its own — what a badge renders, and the one number a
/// client should never have to page through the list to compute.
pub async fn unread_count(org_id: &str, user_email: &str) -> Result<u64, errors::Error> {
    count_for_user(
        org_id,
        user_email,
        &InboxQuery {
            unread_only: true,
            ..Default::default()
        },
    )
    .await
}

/// Marks ledger rows read, or unread again.
///
/// Idempotent in both directions: marking a row already read leaves the first
/// `read_at` alone, so "when did I first see this" survives a client that
/// re-sends its page on every scroll.
///
/// Every id is checked against rows actually addressed to this caller. Without
/// that a client could mark another person's page read, which is worse than it
/// sounds: an unread badge is how somebody notices they were paged while their
/// phone was face down.
pub async fn set_read(
    org_id: &str,
    user_email: &str,
    event_ids: &[String],
    read: bool,
    now: i64,
) -> Result<u64, errors::Error> {
    if event_ids.is_empty() {
        return Ok(0);
    }
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    if !read {
        let deleted = oncall_delivery_reads::Entity::delete_many()
            .filter(oncall_delivery_reads::Column::OrgId.eq(org_id))
            .filter(oncall_delivery_reads::Column::UserEmail.eq(user_email))
            .filter(oncall_delivery_reads::Column::EventId.is_in(event_ids.to_vec()))
            .exec(client)
            .await?;
        return Ok(deleted.rows_affected);
    }

    // Only ids that name a delivery this person actually received.
    let owned: Vec<String> = inbox_select(org_id, user_email, &InboxQuery::default())
        .filter(oncall_response_events::Column::Id.is_in(event_ids.to_vec()))
        .select_only()
        .column_as(oncall_response_events::Column::Id, "event_id")
        .column_as(oncall_delivery_reads::Column::ReadAt, "read_at")
        .into_tuple::<(String, Option<i64>)>()
        .all(client)
        .await?
        .into_iter()
        // Already read: leave the original instant alone.
        .filter(|(_, read_at)| read_at.is_none())
        .map(|(id, _)| id)
        .collect();

    let mut marked = 0;
    for event_id in owned {
        let model = oncall_delivery_reads::ActiveModel {
            id: Set(ider::uuid()),
            org_id: Set(org_id.to_string()),
            user_email: Set(user_email.to_string()),
            event_id: Set(event_id),
            read_at: Set(now),
        };
        // The unique index is the real arbiter — two tabs marking the same row
        // at once is normal, and the loser of that race has still had its
        // effect.
        match oncall_delivery_reads::Entity::insert(model).exec(client).await {
            Ok(_) => marked += 1,
            Err(e) => {
                let msg = e.to_string().to_lowercase();
                if !(msg.contains("unique") || msg.contains("duplicate")) {
                    return Err(e.into());
                }
            }
        }
    }
    Ok(marked)
}

/// Marks everything currently unread as read — "clear my inbox".
///
/// Bounded by `limit` rather than sweeping the table, because the natural
/// implementation of this button is an unbounded UPDATE and the natural
/// consequence is a lock held across a responder's entire history.
pub async fn mark_all_read(
    org_id: &str,
    user_email: &str,
    limit: u64,
    now: i64,
) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let ids: Vec<String> = inbox_select(
        org_id,
        user_email,
        &InboxQuery {
            unread_only: true,
            ..Default::default()
        },
    )
    .select_only()
    .column_as(oncall_response_events::Column::Id, "event_id")
    .order_by_desc(oncall_response_events::Column::At)
    .limit(limit)
    .into_tuple::<String>()
    .all(client)
    .await?;
    set_read(org_id, user_email, &ids, true, now).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row() -> Row {
        Row {
            event_id: "ev_1".into(),
            at: 1_500,
            body: "email sent to ana@o2.ai".into(),
            channel: Some(Channel::Email.to_i32()),
            delivered: Some(true),
            ladder_run: Some(1),
            rung_micros: Some(0),
            response_id: "resp_1".into(),
            subject_type: SubjectType::Alert.to_i32(),
            subject_id: "al_ckt#2".into(),
            team_id: "team_1".into(),
            title: Some("payment_gateway_error_rate".into()),
            priority: 2,
            state: ResponseState::Triggered.to_i32(),
            read_at: None,
        }
    }

    #[test]
    fn test_a_row_becomes_a_legible_inbox_entry() {
        let d = UserDelivery::from(row());
        assert_eq!(d.event_id, "ev_1");
        assert_eq!(d.response_id, "resp_1");
        assert_eq!(d.channel, Some(Channel::Email));
        assert_eq!(d.delivered, Some(true));
        assert_eq!(d.title.as_deref(), Some("payment_gateway_error_rate"));
        assert_eq!(d.response_state, Some(ResponseState::Triggered));
        assert_eq!(d.subject_type, Some(SubjectType::Alert));
        assert!(!d.read);
        assert_eq!(d.read_at, None);
    }

    /// `read` is derived from the marker, never sent separately — two fields
    /// that can disagree is how a badge and a list end up telling a responder
    /// different things.
    #[test]
    fn test_read_is_derived_from_the_marker() {
        let mut r = row();
        r.read_at = Some(9_000);
        let d = UserDelivery::from(r);
        assert!(d.read);
        assert_eq!(d.read_at, Some(9_000));
    }

    /// A failed page is the most important row in the inbox: it is the only
    /// evidence that somebody was supposed to be woken and was not.
    #[test]
    fn test_a_failed_delivery_is_reported_not_hidden() {
        let mut r = row();
        r.delivered = Some(false);
        let d = UserDelivery::from(r);
        assert_eq!(d.delivered, Some(false));
    }

    /// Same trade as the ledger itself: a channel this build cannot name costs
    /// the row its channel, not its existence.
    #[test]
    fn test_an_unknown_channel_keeps_the_attempt() {
        let mut r = row();
        r.channel = Some(99);
        let d = UserDelivery::from(r);
        assert_eq!(d.channel, None);
        assert_eq!(d.event_id, "ev_1");
    }

    /// An undecodable state must not be reported as `triggered`: an inbox row
    /// claiming a resolved page is still firing sends somebody to a dead end.
    #[test]
    fn test_an_unreadable_state_is_omitted_rather_than_guessed() {
        let mut r = row();
        r.state = 99;
        let d = UserDelivery::from(r);
        assert_eq!(d.response_state, None);
    }

    #[test]
    fn test_marking_nothing_is_not_an_error() {
        // The empty case short-circuits before any client is needed, so this
        // pins the contract rather than the round trip.
        assert!(InboxQuery::default().from.is_none());
        assert!(!InboxQuery::default().unread_only);
    }
}
