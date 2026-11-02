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

//! The notification delivery ledger; every function takes `now` so the lease rules are testable.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, DatabaseTransaction, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
    sea_query::{Alias, Expr, OnConflict, Query},
};
use svix_ksuid::KsuidLike;

use super::entity::{
    notification_deliveries::{ActiveModel, Column, Entity, Model},
    notification_episode_destinations as dest_records, notification_episodes as episodes,
};
use crate::errors;

pub const STATUS_PENDING: &str = "pending";
pub const STATUS_QUEUED: &str = "queued";
pub const STATUS_SENT: &str = "sent";
pub const STATUS_FAILED: &str = "failed";
pub const STATUS_SKIPPED: &str = "skipped";

pub const EVENT_RESOLVED: &str = "resolved";

pub const OUTCOME_ATTEMPTED: &str = "attempted";
pub const OUTCOME_SENT: &str = "sent";
pub const OUTCOME_UNKNOWN: &str = "unknown";

pub const SKIP_SUPERSEDED: &str = "Superseded";
pub const SKIP_NO_TRIGGER_RECORDED: &str = "NoTriggerRecorded";

pub const CLOSED_BY_RESOLVE: &str = "resolve";
pub const CLOSED_BY_PRODUCER: &str = "producer";
pub const CLOSED_BY_ORPHAN: &str = "orphan";

pub const DEFAULT_MAX_ATTEMPTS: i32 = 5;
/// Five minutes: longer than the shared transport timeout, so a live send never loses its claim.
pub const LEASE_US: i64 = 5 * 60 * 1_000_000;
pub const LEASE_EXPIRED: &str = "lease expired";

/// The (org, kind, episode) an episode row and its delivery rows share.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpisodeKey {
    pub org: String,
    pub kind: String,
    pub episode_id: String,
}

/// A send that wants a row: the identity, the routing facts, and the rendered record.
#[derive(Clone, Debug, Default)]
pub struct NewDelivery {
    pub org: String,
    pub kind: String,
    pub object_id: String,
    pub episode_id: String,
    pub event: String,
    pub destination: String,
    pub channel: String,
    pub platform: Option<String>,
    pub template_source: String,
    pub template_name: String,
    pub template_skipped: String,
    pub opens_episode: bool,
    pub closed_at_insert: bool,
    pub max_attempts: i32,
    pub subject: Option<String>,
    pub payload: String,
}

impl NewDelivery {
    fn episode(&self) -> EpisodeKey {
        EpisodeKey {
            org: self.org.clone(),
            kind: self.kind.clone(),
            episode_id: self.episode_id.clone(),
        }
    }

    fn is_resolve(&self) -> bool {
        self.event == EVENT_RESOLVED
    }
}

/// Why a claim did not hand the caller a row to send.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    AlreadyDelivered,
    /// A terminal row's own stored skip reason.
    Stored(String),
    InFlight,
    RetryScheduled,
    Exhausted,
    Superseded,
    NoTriggerRecorded,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Claim {
    Owned(Box<Model>),
    Refused(Refusal),
}

/// How one transport attempt ended, as the finish records it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finish {
    pub sent: bool,
    /// False when the transport gave no answer (timeout, reset): the outcome is unknown.
    pub answered: bool,
    pub retryable: bool,
    pub status_code: Option<i32>,
    pub error: Option<String>,
    pub skip_reason: Option<String>,
}

/// One destination of a resolve fan out with the record its resolve row replays.
#[derive(Clone, Debug, Default)]
pub struct FanoutDestination {
    pub destination: String,
    pub channel: String,
    pub platform: Option<String>,
    pub template_source: String,
    pub template_name: String,
    pub subject: Option<String>,
    pub payload: String,
}

/// A destination the episode attempted, read under the episode lock.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordedDestination {
    pub destination: String,
    pub channel: String,
    pub platform: Option<String>,
    pub trigger_outcome: String,
}

#[derive(Clone, Debug, Default)]
pub struct ListFilter {
    pub org: String,
    pub kind: String,
    pub object_id: Option<String>,
    pub episode_id: Option<String>,
    pub event: Option<String>,
    pub destination: Option<String>,
    pub status: Option<String>,
    pub from: u64,
    pub size: u64,
}

/// Minutes to wait after failed attempt 1, 2, 3 and 4: about 81 minutes over five attempts.
pub fn backoff_us(attempt: i32) -> i64 {
    let minutes = match attempt {
        ..=1 => 1,
        2 => 5,
        3 => 15,
        _ => 60,
    };
    minutes * 60 * 1_000_000
}

/// Claim the row of `new` for this worker, inserting it when it does not exist yet.
pub async fn claim(
    db: &DatabaseConnection,
    new: &NewDelivery,
    token: &str,
    now: i64,
) -> Result<Claim, errors::Error> {
    let txn = db.begin().await?;
    let claim = claim_in(&txn, new, token, now).await?;
    txn.commit().await?;
    Ok(claim)
}

/// Re-claim an existing row by id: the sweeper's entry, and a queued resolve after a fan out.
pub async fn reclaim(
    db: &DatabaseConnection,
    id: &str,
    token: &str,
    now: i64,
) -> Result<Claim, errors::Error> {
    let txn = db.begin().await?;
    let Some(row) = Entity::find_by_id(id).one(&txn).await? else {
        txn.commit().await?;
        return Ok(Claim::Refused(Refusal::Stored("deleted".into())));
    };
    let platform = is_platform_resolve(&row);
    if row.event == EVENT_RESOLVED {
        reconcile_expired_triggers(&txn, &key_of(&row), Some(&row.destination), now).await?;
    }
    let claim = take_existing(&txn, &row, token, now, None, platform).await?;
    txn.commit().await?;
    Ok(claim)
}

async fn claim_in(
    txn: &DatabaseTransaction,
    new: &NewDelivery,
    token: &str,
    now: i64,
) -> Result<Claim, errors::Error> {
    let key = new.episode();
    if new.opens_episode {
        ensure_episode(txn, &key, &new.object_id, now).await?;
        let episode = lock_episode(txn, &key).await?;
        if episode.and_then(|e| e.closed_at).is_some() {
            insert_row(txn, new, now, RowStart::Superseded).await?;
            return Ok(Claim::Refused(Refusal::Superseded));
        }
        record_attempted(txn, &key, new, now).await?;
    }
    if new.is_resolve() {
        reconcile_expired_triggers(txn, &key, Some(&new.destination), now).await?;
        if trigger_in_flight(txn, &key, &new.destination).await? {
            insert_row(txn, new, now, RowStart::Queued).await?;
            return Ok(Claim::Refused(Refusal::InFlight));
        }
    }
    let start = if new.closed_at_insert {
        RowStart::PendingClosed(token)
    } else {
        RowStart::Pending(token)
    };
    if insert_row(txn, new, now, start).await? {
        let row = find_key(txn, new).await?.ok_or(errors::Error::DbError(
            errors::DbError::SeaORMError("claimed row vanished".into()),
        ))?;
        return decide_resolve(txn, row, new.platform.is_some(), now).await;
    }
    let row =
        find_key(txn, new)
            .await?
            .ok_or(errors::Error::DbError(errors::DbError::SeaORMError(
                "conflicting row vanished".into(),
            )))?;
    take_existing(
        txn,
        &row,
        token,
        now,
        Some(&new.payload),
        new.platform.is_some(),
    )
    .await
}

/// The one guarded UPDATE of Delivery section 1c, then the reason read when it matched nothing.
async fn take_existing(
    txn: &DatabaseTransaction,
    row: &Model,
    token: &str,
    now: i64,
    payload: Option<&str>,
    platform: bool,
) -> Result<Claim, errors::Error> {
    let mut update = Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_PENDING))
        .col_expr(Column::Attempt, Expr::col(Column::Attempt).add(1))
        .col_expr(Column::ClaimToken, Expr::value(token))
        .col_expr(Column::ClaimedAt, Expr::value(now))
        .filter(Column::Id.eq(&row.id))
        .filter(Expr::col(Column::Attempt).lt(Expr::col(Column::MaxAttempts)))
        .filter(
            Condition::any()
                .add(Column::EpisodeClosedAt.is_null())
                .add(Column::OpensEpisode.eq(false)),
        )
        .filter(
            Condition::any()
                .add(
                    Condition::all()
                        .add(Column::Status.eq(STATUS_FAILED))
                        .add(Column::Retryable.eq(true))
                        .add(Column::NextRetryAt.lte(now)),
                )
                .add(
                    Condition::all()
                        .add(Column::Status.eq(STATUS_QUEUED))
                        .add(Column::NextRetryAt.lte(now)),
                )
                .add(
                    Condition::all()
                        .add(Column::Status.eq(STATUS_PENDING))
                        .add(Column::ClaimedAt.lt(now - LEASE_US)),
                ),
        );
    if let Some(payload) = payload {
        update = update.col_expr(Column::Payload, Expr::value(payload));
    }
    if row.event == EVENT_RESOLVED {
        update = update
            .filter(Expr::exists(pending_trigger_query(&key_of(row), &row.destination)).not());
    }
    let updated = update.exec(txn).await?.rows_affected;
    let fresh = Entity::find_by_id(&row.id).one(txn).await?;
    let Some(fresh) = fresh else {
        return Ok(Claim::Refused(Refusal::Stored("deleted".into())));
    };
    if updated == 1 {
        return decide_resolve(txn, fresh, platform, now).await;
    }
    Ok(Claim::Refused(refusal_of(&fresh, now)))
}

/// Name why a claim matched nothing; advisory, the UPDATE already decided.
fn refusal_of(row: &Model, now: i64) -> Refusal {
    match row.status.as_str() {
        STATUS_SENT => Refusal::AlreadyDelivered,
        STATUS_SKIPPED => match row.skip_reason.as_deref() {
            Some(SKIP_SUPERSEDED) => Refusal::Superseded,
            Some(SKIP_NO_TRIGGER_RECORDED) => Refusal::NoTriggerRecorded,
            Some(reason) => Refusal::Stored(reason.to_string()),
            None => Refusal::AlreadyDelivered,
        },
        _ if row.attempt >= row.max_attempts => Refusal::Exhausted,
        STATUS_PENDING if row.claimed_at.unwrap_or(0) >= now - LEASE_US => Refusal::InFlight,
        STATUS_QUEUED => Refusal::InFlight,
        STATUS_FAILED if !row.retryable => Refusal::Exhausted,
        STATUS_FAILED if row.next_retry_at.unwrap_or(0) > now => Refusal::RetryScheduled,
        _ => Refusal::InFlight,
    }
}

/// Step c of the resolve claim: a platform resolve needs a trigger that may have reached it.
async fn decide_resolve(
    txn: &DatabaseTransaction,
    row: Model,
    platform: bool,
    now: i64,
) -> Result<Claim, errors::Error> {
    if row.event != EVENT_RESOLVED || !platform {
        return Ok(Claim::Owned(Box::new(row)));
    }
    let record = dest_records::Entity::find_by_id((
        row.org.clone(),
        row.kind.clone(),
        row.episode_id.clone(),
        row.destination.clone(),
    ))
    .one(txn)
    .await?;
    let reached = record
        .is_some_and(|r| r.trigger_outcome == OUTCOME_SENT || r.trigger_outcome == OUTCOME_UNKNOWN);
    if reached {
        return Ok(Claim::Owned(Box::new(row)));
    }
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_SKIPPED))
        .col_expr(Column::SkipReason, Expr::value(SKIP_NO_TRIGGER_RECORDED))
        .col_expr(Column::Retryable, Expr::value(false))
        .col_expr(Column::FinishedAt, Expr::value(now))
        .col_expr(Column::ClaimToken, Expr::value(Option::<String>::None))
        .filter(Column::Id.eq(&row.id))
        .exec(txn)
        .await?;
    Ok(Claim::Refused(Refusal::NoTriggerRecorded))
}

/// Record a transport result; a stale token or a row taken away writes nothing at all.
pub async fn finish(
    db: &DatabaseConnection,
    id: &str,
    token: &str,
    result: &Finish,
    now: i64,
) -> Result<bool, errors::Error> {
    let txn = db.begin().await?;
    let Some(row) = Entity::find_by_id(id).one(&txn).await? else {
        txn.rollback().await?;
        return Ok(false);
    };
    let status = match (result.sent, &result.skip_reason) {
        (true, _) => STATUS_SENT,
        (false, Some(_)) => STATUS_SKIPPED,
        (false, None) => STATUS_FAILED,
    };
    let retryable = !result.sent && result.skip_reason.is_none() && result.retryable;
    let next_retry_at = retryable.then(|| now + backoff_us(row.attempt));
    let updated = Entity::update_many()
        .col_expr(Column::Status, Expr::value(status))
        .col_expr(Column::StatusCode, Expr::value(result.status_code))
        .col_expr(Column::Error, Expr::value(result.error.clone()))
        .col_expr(Column::SkipReason, Expr::value(result.skip_reason.clone()))
        .col_expr(Column::Retryable, Expr::value(retryable))
        .col_expr(Column::FinishedAt, Expr::value(now))
        .col_expr(Column::NextRetryAt, Expr::value(next_retry_at))
        .col_expr(Column::ClaimToken, Expr::value(Option::<String>::None))
        .filter(Column::Id.eq(id))
        .filter(Column::ClaimToken.eq(token))
        .filter(Column::Status.eq(STATUS_PENDING))
        .exec(&txn)
        .await?
        .rows_affected;
    if updated == 0 {
        txn.rollback().await?;
        return Ok(false);
    }
    if row.opens_episode {
        let outcome = match (result.sent, result.answered) {
            (true, _) => Some(OUTCOME_SENT),
            (false, false) => Some(OUTCOME_UNKNOWN),
            (false, true) => None,
        };
        settle_trigger(&txn, &row, outcome, !result.sent, now).await?;
    }
    txn.commit().await?;
    Ok(true)
}

/// Raise the destination record, retire an unsent trigger of a closed episode, wake its resolve.
async fn settle_trigger<C: ConnectionTrait>(
    conn: &C,
    row: &Model,
    outcome: Option<&str>,
    unsent: bool,
    now: i64,
) -> Result<(), errors::Error> {
    let key = key_of(row);
    if let Some(outcome) = outcome {
        raise_record(conn, &key, &row.destination, outcome, now).await?;
    }
    let closed =
        episodes::Entity::find_by_id((key.org.clone(), key.kind.clone(), key.episode_id.clone()))
            .one(conn)
            .await?
            .and_then(|e| e.closed_at)
            .is_some();
    if closed && unsent {
        Entity::update_many()
            .col_expr(Column::Status, Expr::value(STATUS_SKIPPED))
            .col_expr(Column::SkipReason, Expr::value(SKIP_SUPERSEDED))
            .col_expr(Column::Retryable, Expr::value(false))
            .col_expr(Column::ClaimToken, Expr::value(Option::<String>::None))
            .col_expr(Column::FinishedAt, Expr::value(now))
            .filter(Column::Id.eq(&row.id))
            .exec(conn)
            .await?;
    }
    wake_resolve(conn, &key, &row.destination, now).await
}

async fn wake_resolve<C: ConnectionTrait>(
    conn: &C,
    key: &EpisodeKey,
    destination: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::NextRetryAt, Expr::value(now))
        .filter(Column::Org.eq(&key.org))
        .filter(Column::Kind.eq(&key.kind))
        .filter(Column::EpisodeId.eq(&key.episode_id))
        .filter(Column::Destination.eq(destination))
        .filter(Column::Event.eq(EVENT_RESOLVED))
        .filter(Column::Status.eq(STATUS_QUEUED))
        .exec(conn)
        .await?;
    Ok(())
}

/// Write a row that ends where it starts: a platform skip or a render failure, never sent.
pub async fn insert_terminal(
    db: &DatabaseConnection,
    new: &NewDelivery,
    result: &Finish,
    now: i64,
) -> Result<(), errors::Error> {
    if !insert_row(db, new, now, RowStart::Queued).await? {
        return Ok(());
    }
    let status = if result.skip_reason.is_some() {
        STATUS_SKIPPED
    } else {
        STATUS_FAILED
    };
    let closed = new.closed_at_insert.then_some(now);
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(status))
        .col_expr(Column::SkipReason, Expr::value(result.skip_reason.clone()))
        .col_expr(Column::Error, Expr::value(result.error.clone()))
        .col_expr(Column::Retryable, Expr::value(false))
        .col_expr(Column::FinishedAt, Expr::value(now))
        .col_expr(Column::NextRetryAt, Expr::value(Option::<i64>::None))
        .col_expr(Column::EpisodeClosedAt, Expr::value(closed))
        .filter(Column::Org.eq(&new.org))
        .filter(Column::Kind.eq(&new.kind))
        .filter(Column::EpisodeId.eq(&new.episode_id))
        .filter(Column::Event.eq(&new.event))
        .filter(Column::Destination.eq(&new.destination))
        .exec(db)
        .await?;
    Ok(())
}

/// Close the episode and queue a resolve per destination inside the producer's own transaction.
#[allow(clippy::too_many_arguments)]
pub async fn resolve_episode_in(
    txn: &DatabaseTransaction,
    key: &EpisodeKey,
    object_id: &str,
    current: &[FanoutDestination],
    recorded_only: impl Fn(&RecordedDestination) -> Option<FanoutDestination>,
    closed_by: &str,
    write_resolves: bool,
    now: i64,
) -> Result<Vec<String>, errors::Error> {
    ensure_episode(txn, key, object_id, now).await?;
    episodes::Entity::update_many()
        .col_expr(episodes::Column::ClosedAt, Expr::value(now))
        .col_expr(episodes::Column::ClosedBy, Expr::value(closed_by))
        .filter(episodes::Column::Org.eq(&key.org))
        .filter(episodes::Column::Kind.eq(&key.kind))
        .filter(episodes::Column::EpisodeId.eq(&key.episode_id))
        .filter(episodes::Column::ClosedAt.is_null())
        .exec(txn)
        .await?;
    let recorded = recorded_destinations(txn, key).await?;

    Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_SKIPPED))
        .col_expr(Column::SkipReason, Expr::value(SKIP_SUPERSEDED))
        .col_expr(Column::Retryable, Expr::value(false))
        .col_expr(Column::FinishedAt, Expr::value(now))
        .col_expr(Column::ClaimToken, Expr::value(Option::<String>::None))
        .filter(episode_filter(key))
        .filter(Column::OpensEpisode.eq(true))
        .filter(Column::Status.eq(STATUS_FAILED))
        .filter(Column::Retryable.eq(true))
        .exec(txn)
        .await?;

    let mut written = Vec::new();
    if write_resolves {
        let mut set: Vec<FanoutDestination> = current.to_vec();
        for r in &recorded {
            if set.iter().any(|d| d.destination == r.destination) {
                continue;
            }
            if let Some(d) = recorded_only(r) {
                set.push(d);
            }
        }
        for d in &set {
            let new = NewDelivery {
                org: key.org.clone(),
                kind: key.kind.clone(),
                object_id: object_id.to_string(),
                episode_id: key.episode_id.clone(),
                event: EVENT_RESOLVED.to_string(),
                destination: d.destination.clone(),
                channel: d.channel.clone(),
                platform: d.platform.clone(),
                template_source: d.template_source.clone(),
                template_name: d.template_name.clone(),
                template_skipped: "[]".into(),
                opens_episode: false,
                closed_at_insert: false,
                max_attempts: DEFAULT_MAX_ATTEMPTS,
                subject: d.subject.clone(),
                payload: d.payload.clone(),
            };
            insert_row(txn, &new, now, RowStart::Queued).await?;
            written.push(d.destination.clone());
        }
    }

    Entity::update_many()
        .col_expr(Column::EpisodeClosedAt, Expr::value(now))
        .filter(episode_filter(key))
        .filter(Column::EpisodeClosedAt.is_null())
        .exec(txn)
        .await?;
    Ok(written)
}

/// The queued resolve rows of an episode, for the producer to claim right after its commit.
pub async fn queued_resolves<C: ConnectionTrait>(
    conn: &C,
    key: &EpisodeKey,
) -> Result<Vec<Model>, errors::Error> {
    Ok(Entity::find()
        .filter(episode_filter(key))
        .filter(Column::Event.eq(EVENT_RESOLVED))
        .filter(Column::Status.eq(STATUS_QUEUED))
        .all(conn)
        .await?)
}

/// Every destination the episode ever attempted, read under its row lock.
pub async fn recorded_destinations<C: ConnectionTrait>(
    conn: &C,
    key: &EpisodeKey,
) -> Result<Vec<RecordedDestination>, errors::Error> {
    Ok(dest_records::Entity::find()
        .filter(dest_records::Column::Org.eq(&key.org))
        .filter(dest_records::Column::Kind.eq(&key.kind))
        .filter(dest_records::Column::EpisodeId.eq(&key.episode_id))
        .order_by_asc(dest_records::Column::Destination)
        .all(conn)
        .await?
        .into_iter()
        .map(|r| RecordedDestination {
            destination: r.destination,
            channel: r.channel,
            platform: r.platform,
            trigger_outcome: r.trigger_outcome,
        })
        .collect())
}

/// Fail every claim that outlived the lease, clearing its token and leaving `attempt` unchanged.
pub async fn expire_leases(db: &DatabaseConnection, now: i64) -> Result<u64, errors::Error> {
    let stale = Entity::find()
        .filter(Column::Status.eq(STATUS_PENDING))
        .filter(Column::ClaimedAt.lt(now - LEASE_US))
        .limit(100)
        .all(db)
        .await?;
    let mut expired = 0;
    for row in stale {
        let txn = db.begin().await?;
        if expire_one(&txn, &row, now).await? {
            expired += 1;
        }
        txn.commit().await?;
    }
    Ok(expired)
}

/// Step a of the resolve claim: the same statements as the sweeper, for one destination.
async fn reconcile_expired_triggers(
    txn: &DatabaseTransaction,
    key: &EpisodeKey,
    destination: Option<&str>,
    now: i64,
) -> Result<(), errors::Error> {
    let mut find = Entity::find()
        .filter(episode_filter(key))
        .filter(Column::OpensEpisode.eq(true))
        .filter(Column::Status.eq(STATUS_PENDING))
        .filter(Column::ClaimedAt.lt(now - LEASE_US));
    if let Some(destination) = destination {
        find = find.filter(Column::Destination.eq(destination));
    }
    for row in find.all(txn).await? {
        expire_one(txn, &row, now).await?;
    }
    Ok(())
}

async fn expire_one<C: ConnectionTrait>(
    conn: &C,
    row: &Model,
    now: i64,
) -> Result<bool, errors::Error> {
    let updated = Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_FAILED))
        .col_expr(Column::Error, Expr::value(LEASE_EXPIRED))
        .col_expr(Column::NextRetryAt, Expr::value(now))
        .col_expr(Column::ClaimToken, Expr::value(Option::<String>::None))
        .col_expr(
            Column::Retryable,
            Expr::value(row.attempt < row.max_attempts),
        )
        .col_expr(Column::FinishedAt, Expr::value(now))
        .filter(Column::Id.eq(&row.id))
        .filter(Column::Status.eq(STATUS_PENDING))
        .filter(Column::ClaimedAt.lt(now - LEASE_US))
        .exec(conn)
        .await?
        .rows_affected;
    if updated == 1 && row.opens_episode {
        settle_trigger(conn, row, Some(OUTCOME_UNKNOWN), true, now).await?;
    }
    Ok(updated == 1)
}

/// Rows the sweeper may claim now, oldest retry time first.
pub async fn retry_candidates(
    db: &DatabaseConnection,
    now: i64,
    limit: u64,
) -> Result<Vec<Model>, errors::Error> {
    Ok(Entity::find()
        .filter(Expr::col(Column::Attempt).lt(Expr::col(Column::MaxAttempts)))
        .filter(Column::NextRetryAt.lte(now))
        .filter(
            Condition::any()
                .add(Column::EpisodeClosedAt.is_null())
                .add(Column::OpensEpisode.eq(false)),
        )
        .filter(
            Condition::any()
                .add(
                    Condition::all()
                        .add(Column::Status.eq(STATUS_FAILED))
                        .add(Column::Retryable.eq(true)),
                )
                .add(Column::Status.eq(STATUS_QUEUED)),
        )
        .order_by_asc(Column::NextRetryAt)
        .limit(limit)
        .all(db)
        .await?)
}

/// Delete expired delivery rows; episode routing rows go only 30 days after the episode closed.
pub async fn delete_expired(
    db: &DatabaseConnection,
    now: i64,
    retention_us: i64,
    max_age_us: i64,
) -> Result<u64, errors::Error> {
    let deliveries = Entity::delete_many()
        .filter(
            Condition::any()
                .add(Column::EpisodeClosedAt.lt(now - retention_us))
                .add(Column::CreatedAt.lt(now - max_age_us)),
        )
        .exec(db)
        .await?
        .rows_affected;
    let cutoff = now - 30 * 24 * 3600 * 1_000_000;
    let closed: Vec<episodes::Model> = episodes::Entity::find()
        .filter(episodes::Column::ClosedAt.lt(cutoff))
        .limit(500)
        .all(db)
        .await?;
    for e in closed {
        let txn = db.begin().await?;
        dest_records::Entity::delete_many()
            .filter(dest_records::Column::Org.eq(&e.org))
            .filter(dest_records::Column::Kind.eq(&e.kind))
            .filter(dest_records::Column::EpisodeId.eq(&e.episode_id))
            .exec(&txn)
            .await?;
        episodes::Entity::delete_by_id((e.org, e.kind, e.episode_id))
            .exec(&txn)
            .await?;
        txn.commit().await?;
    }
    Ok(deliveries)
}

/// Open episodes, for the daily orphan check of their owning objects.
pub async fn open_episodes(
    db: &DatabaseConnection,
    limit: u64,
) -> Result<Vec<episodes::Model>, errors::Error> {
    Ok(episodes::Entity::find()
        .filter(episodes::Column::ClosedAt.is_null())
        .order_by_asc(episodes::Column::CreatedAt)
        .limit(limit)
        .all(db)
        .await?)
}

/// Close an episode with no resolve rows: gate off, a muted recovery, or an orphan.
pub async fn close_episode(
    db: &DatabaseConnection,
    key: &EpisodeKey,
    object_id: &str,
    closed_by: &str,
    now: i64,
) -> Result<(), errors::Error> {
    let txn = db.begin().await?;
    resolve_episode_in(&txn, key, object_id, &[], |_| None, closed_by, false, now).await?;
    txn.commit().await?;
    Ok(())
}

pub async fn get<C: ConnectionTrait>(conn: &C, id: &str) -> Result<Option<Model>, errors::Error> {
    Ok(Entity::find_by_id(id).one(conn).await?)
}

pub async fn get_episode<C: ConnectionTrait>(
    conn: &C,
    key: &EpisodeKey,
) -> Result<Option<episodes::Model>, errors::Error> {
    Ok(
        episodes::Entity::find_by_id((key.org.clone(), key.kind.clone(), key.episode_id.clone()))
            .one(conn)
            .await?,
    )
}

/// The read API: newest first, one page plus the total.
pub async fn list<C: ConnectionTrait>(
    conn: &C,
    filter: &ListFilter,
) -> Result<(u64, Vec<Model>), errors::Error> {
    let mut find = Entity::find()
        .filter(Column::Org.eq(&filter.org))
        .filter(Column::Kind.eq(&filter.kind));
    if let Some(v) = &filter.object_id {
        find = find.filter(Column::ObjectId.eq(v));
    }
    if let Some(v) = &filter.episode_id {
        find = find.filter(Column::EpisodeId.eq(v));
    }
    if let Some(v) = &filter.event {
        find = find.filter(Column::Event.eq(v));
    }
    if let Some(v) = &filter.destination {
        find = find.filter(Column::Destination.eq(v));
    }
    if let Some(v) = &filter.status {
        find = find.filter(Column::Status.eq(v));
    }
    let total = find.clone().count(conn).await?;
    let rows = find
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::Id)
        .offset(filter.from)
        .limit(filter.size)
        .all(conn)
        .await?;
    Ok((total, rows))
}

fn key_of(row: &Model) -> EpisodeKey {
    EpisodeKey {
        org: row.org.clone(),
        kind: row.kind.clone(),
        episode_id: row.episode_id.clone(),
    }
}

fn is_platform_resolve(row: &Model) -> bool {
    row.template_source == "platform_resolve"
}

fn episode_filter(key: &EpisodeKey) -> Condition {
    Condition::all()
        .add(Column::Org.eq(&key.org))
        .add(Column::Kind.eq(&key.kind))
        .add(Column::EpisodeId.eq(&key.episode_id))
}

fn pending_trigger_query(
    key: &EpisodeKey,
    destination: &str,
) -> sea_orm::sea_query::SelectStatement {
    let t = Alias::new("t");
    Query::select()
        .expr(Expr::val(1))
        .from_as(Entity, t.clone())
        .and_where(Expr::col((t.clone(), Column::Org)).eq(&key.org))
        .and_where(Expr::col((t.clone(), Column::Kind)).eq(&key.kind))
        .and_where(Expr::col((t.clone(), Column::EpisodeId)).eq(&key.episode_id))
        .and_where(Expr::col((t.clone(), Column::Destination)).eq(destination))
        .and_where(Expr::col((t.clone(), Column::OpensEpisode)).eq(true))
        .and_where(Expr::col((t, Column::Status)).eq(STATUS_PENDING))
        .to_owned()
}

async fn trigger_in_flight(
    txn: &DatabaseTransaction,
    key: &EpisodeKey,
    destination: &str,
) -> Result<bool, errors::Error> {
    Ok(Entity::find()
        .filter(episode_filter(key))
        .filter(Column::Destination.eq(destination))
        .filter(Column::OpensEpisode.eq(true))
        .filter(Column::Status.eq(STATUS_PENDING))
        .count(txn)
        .await?
        > 0)
}

async fn ensure_episode<C: ConnectionTrait>(
    conn: &C,
    key: &EpisodeKey,
    object_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    episodes::Entity::insert(episodes::ActiveModel {
        org: Set(key.org.clone()),
        kind: Set(key.kind.clone()),
        episode_id: Set(key.episode_id.clone()),
        object_id: Set(object_id.to_string()),
        opened_at: Set(now),
        closed_at: Set(None),
        closed_by: Set(None),
        created_at: Set(now),
    })
    .on_conflict(
        OnConflict::columns([
            episodes::Column::Org,
            episodes::Column::Kind,
            episodes::Column::EpisodeId,
        ])
        .do_nothing()
        .to_owned(),
    )
    .exec_without_returning(conn)
    .await?;
    Ok(())
}

/// SELECT … FOR UPDATE on Postgres; SQLite serializes write transactions on its own.
async fn lock_episode(
    txn: &DatabaseTransaction,
    key: &EpisodeKey,
) -> Result<Option<episodes::Model>, errors::Error> {
    let find = episodes::Entity::find()
        .filter(episodes::Column::Org.eq(&key.org))
        .filter(episodes::Column::Kind.eq(&key.kind))
        .filter(episodes::Column::EpisodeId.eq(&key.episode_id));
    let find = if txn.get_database_backend() == sea_orm::DbBackend::Postgres {
        find.lock_exclusive()
    } else {
        find
    };
    Ok(find.one(txn).await?)
}

async fn record_attempted<C: ConnectionTrait>(
    conn: &C,
    key: &EpisodeKey,
    new: &NewDelivery,
    now: i64,
) -> Result<(), errors::Error> {
    dest_records::Entity::insert(dest_records::ActiveModel {
        org: Set(key.org.clone()),
        kind: Set(key.kind.clone()),
        episode_id: Set(key.episode_id.clone()),
        destination: Set(new.destination.clone()),
        channel: Set(new.channel.clone()),
        platform: Set(new.platform.clone()),
        trigger_outcome: Set(OUTCOME_ATTEMPTED.to_string()),
        first_sent_at: Set(None),
        updated_at: Set(now),
    })
    .on_conflict(
        OnConflict::columns([
            dest_records::Column::Org,
            dest_records::Column::Kind,
            dest_records::Column::EpisodeId,
            dest_records::Column::Destination,
        ])
        .do_nothing()
        .to_owned(),
    )
    .exec_without_returning(conn)
    .await?;
    Ok(())
}

/// Never lowers a `sent` record; `unknown` only replaces `attempted`.
async fn raise_record<C: ConnectionTrait>(
    conn: &C,
    key: &EpisodeKey,
    destination: &str,
    outcome: &str,
    now: i64,
) -> Result<(), errors::Error> {
    let update = dest_records::Entity::update_many()
        .col_expr(dest_records::Column::TriggerOutcome, Expr::value(outcome))
        .col_expr(dest_records::Column::UpdatedAt, Expr::value(now))
        .filter(dest_records::Column::Org.eq(&key.org))
        .filter(dest_records::Column::Kind.eq(&key.kind))
        .filter(dest_records::Column::EpisodeId.eq(&key.episode_id))
        .filter(dest_records::Column::Destination.eq(destination))
        .filter(dest_records::Column::TriggerOutcome.ne(OUTCOME_SENT));
    if outcome == OUTCOME_SENT {
        dest_records::Entity::update_many()
            .col_expr(dest_records::Column::FirstSentAt, Expr::value(now))
            .filter(dest_records::Column::Org.eq(&key.org))
            .filter(dest_records::Column::Kind.eq(&key.kind))
            .filter(dest_records::Column::EpisodeId.eq(&key.episode_id))
            .filter(dest_records::Column::Destination.eq(destination))
            .filter(dest_records::Column::FirstSentAt.is_null())
            .exec(conn)
            .await?;
    }
    update.exec(conn).await?;
    Ok(())
}

enum RowStart<'a> {
    Pending(&'a str),
    PendingClosed(&'a str),
    Queued,
    Superseded,
}

/// INSERT … ON CONFLICT DO NOTHING; true when this call created the row.
async fn insert_row<C: ConnectionTrait>(
    conn: &C,
    new: &NewDelivery,
    now: i64,
    start: RowStart<'_>,
) -> Result<bool, errors::Error> {
    let (status, attempt, token, claimed_at, next_retry_at, skip, finished, closed) = match start {
        RowStart::Pending(t) => (
            STATUS_PENDING,
            1,
            Some(t),
            Some(now),
            None,
            None,
            None,
            None,
        ),
        RowStart::PendingClosed(t) => (
            STATUS_PENDING,
            1,
            Some(t),
            Some(now),
            None,
            None,
            None,
            Some(now),
        ),
        RowStart::Queued => (STATUS_QUEUED, 0, None, None, Some(now), None, None, None),
        RowStart::Superseded => (
            STATUS_SKIPPED,
            0,
            None,
            None,
            None,
            Some(SKIP_SUPERSEDED),
            Some(now),
            Some(now),
        ),
    };
    let model = ActiveModel {
        id: Set(svix_ksuid::Ksuid::new(None, None).to_string()),
        org: Set(new.org.clone()),
        kind: Set(new.kind.clone()),
        object_id: Set(new.object_id.clone()),
        episode_id: Set(new.episode_id.clone()),
        event: Set(new.event.clone()),
        destination: Set(new.destination.clone()),
        channel: Set(new.channel.clone()),
        template_source: Set(new.template_source.clone()),
        template_name: Set(new.template_name.clone()),
        template_skipped: Set(new.template_skipped.clone()),
        opens_episode: Set(new.opens_episode),
        status: Set(status.to_string()),
        attempt: Set(attempt),
        max_attempts: Set(new.max_attempts.max(1)),
        retryable: Set(false),
        status_code: Set(None),
        error: Set(None),
        skip_reason: Set(skip.map(str::to_string)),
        subject: Set(new.subject.clone()),
        payload: Set(new.payload.clone()),
        claim_token: Set(token.map(str::to_string)),
        claimed_at: Set(claimed_at),
        finished_at: Set(finished),
        next_retry_at: Set(next_retry_at),
        created_at: Set(now),
        episode_closed_at: Set(closed),
    };
    let inserted = Entity::insert(model)
        .on_conflict(
            OnConflict::columns([
                Column::Org,
                Column::Kind,
                Column::EpisodeId,
                Column::Event,
                Column::Destination,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(inserted > 0)
}

async fn find_key<C: ConnectionTrait>(
    conn: &C,
    new: &NewDelivery,
) -> Result<Option<Model>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(&new.org))
        .filter(Column::Kind.eq(&new.kind))
        .filter(Column::EpisodeId.eq(&new.episode_id))
        .filter(Column::Event.eq(&new.event))
        .filter(Column::Destination.eq(&new.destination))
        .one(conn)
        .await?)
}

#[cfg(test)]
mod tests;
