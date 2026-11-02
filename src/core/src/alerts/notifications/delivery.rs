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

//! The shared send path on the delivery ledger: claim, send, finish, replay and fan out.

use config::{
    meta::{
        alerts::notification_kind::NotificationKind,
        destinations::{DestinationType, Module},
    },
    utils::time::now_micros,
};
use futures::future::BoxFuture;
use infra::{
    db::get_orm_client_rw,
    table::notification_deliveries::{
        self as ledger, Claim, EpisodeKey, FanoutDestination, Finish, NewDelivery, Refusal,
    },
};
use sea_orm::{DatabaseTransaction, TransactionTrait};
use svix_ksuid::KsuidLike;

use super::{
    NotificationContext,
    format::derive_channel_format,
    notify::{
        DeliveryRow, NotifyError, Prepared, Resolved, SOURCE_PLATFORM_RESOLVE, SkipReason, cap,
        prepare, transport,
    },
    record::{IMAGE_DROPPED, ReplayRecord, platform_name, transport_of},
};

/// The producer state change that commits in the same transaction as a resolve fan out.
pub type StateChange =
    Box<dyn for<'a> FnOnce(&'a DatabaseTransaction) -> BoxFuture<'a, anyhow::Result<()>> + Send>;

/// The identity of one send on the ledger, before the rendered record is known.
pub fn new_delivery(
    org_id: &str,
    resolved: &Resolved,
    ctx: &NotificationContext,
    subject: Option<&str>,
) -> NewDelivery {
    let platform = super::platform::platform_of(&resolved.destination_type);
    NewDelivery {
        org: org_id.to_string(),
        kind: ctx.kind.as_str().to_string(),
        object_id: ctx.object_id.clone(),
        episode_id: ctx.episode_id.clone().unwrap_or_default(),
        event: ctx.event.clone(),
        destination: resolved.destination.name.clone(),
        channel: resolved.channel.wire_name().to_string(),
        platform: platform.map(|p| platform_name(p).to_string()),
        template_source: resolved.effective.source.as_str().to_string(),
        template_name: resolved.effective.template().name.clone(),
        template_skipped: resolved.effective.skipped_json(),
        opens_episode: ctx.kind.opens_episode(&ctx.event),
        closed_at_insert: ctx.kind.closed_at_insert(&ctx.event),
        max_attempts: ledger::DEFAULT_MAX_ATTEMPTS,
        subject: subject.map(str::to_string),
        payload: String::new(),
    }
}

/// Render, claim the ledger row, send and finish it; `send` for every non-alert kind.
pub async fn send_on_ledger(
    org_id: &str,
    resolved: &Resolved,
    subject: Option<&str>,
    ctx: &NotificationContext,
) -> Result<DeliveryRow, NotifyError> {
    let mut new = new_delivery(org_id, resolved, ctx, subject);
    let prepared = match prepare(resolved, subject, ctx) {
        Ok(p) => p,
        Err(e) => {
            record_terminal(&new, &e).await;
            return Err(e);
        }
    };
    fill_prepared(&mut new, &prepared);
    let (payload, image_dropped) = prepared.record.to_stored();
    new.payload = payload;
    let token = svix_ksuid::Ksuid::new(None, None).to_string();
    let db = get_orm_client_rw().await;
    let row = match ledger::claim(db, &new, &token, now_micros())
        .await
        .map_err(|e| NotifyError::Transport(e.to_string()))?
    {
        Claim::Owned(row) => *row,
        Claim::Refused(refusal) => return Err(NotifyError::Skipped(skip_of(&refusal))),
    };
    let result = transport(org_id, &resolved.destination_type, &prepared.record).await;
    finish_row(&row, &token, ctx.kind, &result, image_dropped).await;
    result.map(|_| DeliveryRow {
        id: row.id,
        status: ledger::STATUS_SENT.into(),
        status_code: None,
        attempt: row.attempt,
    })
}

/// Send a stored row again from its record with the destination as it is now.
pub async fn replay(row_id: &str) -> Result<DeliveryRow, NotifyError> {
    let token = svix_ksuid::Ksuid::new(None, None).to_string();
    let db = get_orm_client_rw().await;
    let row = match ledger::reclaim(db, row_id, &token, now_micros())
        .await
        .map_err(|e| NotifyError::Transport(e.to_string()))?
    {
        Claim::Owned(row) => *row,
        Claim::Refused(refusal) => return Err(NotifyError::Skipped(skip_of(&refusal))),
    };
    let kind = NotificationKind::parse(&row.kind).unwrap_or_default();
    let result = replay_owned(&row).await;
    finish_row(&row, &token, kind, &result, false).await;
    result.map(|_| DeliveryRow {
        id: row.id,
        status: ledger::STATUS_SENT.into(),
        status_code: None,
        attempt: row.attempt,
    })
}

async fn replay_owned(
    row: &infra::table::entity::notification_deliveries::Model,
) -> Result<String, NotifyError> {
    let Some(record) = ReplayRecord::parse(&row.payload) else {
        return Err(NotifyError::Render("replay record does not parse".into()));
    };
    let dest = match super::super::destinations::get(&row.org, &row.destination).await {
        Ok(dest) => dest,
        Err(_) => return Err(NotifyError::DestinationNotFound(row.destination.clone())),
    };
    let Module::Alert {
        destination_type, ..
    } = &dest.module
    else {
        return Err(NotifyError::NotAlertDestination(row.destination.clone()));
    };
    if destination_changed(&record, destination_type, &row.channel) {
        return Err(NotifyError::Skipped(SkipReason::DestinationChanged));
    }
    transport(&row.org, destination_type, &record).await
}

/// The stored record no longer fits: another transport, or another channel format.
pub fn destination_changed(
    record: &ReplayRecord,
    dest_type: &DestinationType,
    channel: &str,
) -> bool {
    let now_channel = derive_channel_format(dest_type).wire_name();
    let fits = match record.transport() {
        "platform_resolve" => super::platform::platform_of(dest_type).is_some(),
        transport => transport == transport_of(dest_type),
    };
    !fits || now_channel != channel
}

/// One sweeper pass: expire stale claims, then replay up to 100 rows that are due.
pub async fn retry_tick() -> Result<usize, anyhow::Error> {
    let db = get_orm_client_rw().await;
    let now = now_micros();
    ledger::expire_leases(db, now).await?;
    let mut sent = 0;
    for row in ledger::retry_candidates(db, now, 100).await? {
        if replay(&row.id).await.is_ok() {
            sent += 1;
        }
    }
    Ok(sent)
}

/// Delete delivery rows past their retention; episode routing state outlives them.
pub async fn retention_tick() -> Result<u64, anyhow::Error> {
    let cfg = config::get_config();
    let day = 24 * 3600 * 1_000_000;
    Ok(ledger::delete_expired(
        get_orm_client_rw().await,
        now_micros(),
        cfg.limit.notification_delivery_retention_days.max(1) * day,
        cfg.limit.notification_delivery_max_age_days.max(1) * day,
    )
    .await?)
}

/// Render one destination's resolve row for a fan out; a platform gets a protocol record.
pub async fn fanout_destination(
    org_id: &str,
    dest_name: &str,
    explicit: &[config::meta::destinations::Template],
    subject: Option<&str>,
    ctx: &NotificationContext,
) -> Result<FanoutDestination, NotifyError> {
    let resolved = super::notify::resolve(org_id, dest_name, explicit, ctx.kind).await?;
    let mut ctx = ctx.clone();
    super::notify::apply_destination_metadata(&resolved.destination_type, &mut ctx);
    let prepared = prepare(&resolved, subject, &ctx)?;
    Ok(FanoutDestination {
        destination: dest_name.to_string(),
        channel: resolved.channel.wire_name().to_string(),
        platform: prepared.platform.map(|p| platform_name(p).to_string()),
        template_source: prepared.template_source,
        template_name: prepared.template_name,
        subject: subject.map(str::to_string),
        payload: prepared.record.to_stored().0,
    })
}

/// Close an episode with the producer's state change in one transaction, then send the resolves.
#[allow(clippy::too_many_arguments)]
pub async fn resolve_episode(
    org_id: &str,
    kind: NotificationKind,
    episode_id: &str,
    object_id: &str,
    current: Vec<FanoutDestination>,
    recorded: Vec<FanoutDestination>,
    closed_by: &str,
    write_resolves: bool,
    state_change: StateChange,
) -> Result<Vec<Result<DeliveryRow, NotifyError>>, anyhow::Error> {
    let key = EpisodeKey {
        org: org_id.to_string(),
        kind: kind.as_str().to_string(),
        episode_id: episode_id.to_string(),
    };
    let db = get_orm_client_rw().await;
    let txn = db.begin().await?;
    state_change(&txn).await?;
    ledger::resolve_episode_in(
        &txn,
        &key,
        object_id,
        &current,
        |r| {
            recorded
                .iter()
                .find(|d| d.destination == r.destination)
                .cloned()
                .or_else(|| platform_resolve_for(r, episode_id))
        },
        closed_by,
        write_resolves,
        now_micros(),
    )
    .await?;
    txn.commit().await?;
    let mut results = Vec::new();
    for row in ledger::queued_resolves(db, &key).await? {
        results.push(replay(&row.id).await);
    }
    Ok(results)
}

/// A recorded platform destination needs no render: its resolve is protocol.
fn platform_resolve_for(
    r: &ledger::RecordedDestination,
    episode_id: &str,
) -> Option<FanoutDestination> {
    let platform = super::record::parse_platform(r.platform.as_deref()?)?;
    Some(FanoutDestination {
        destination: r.destination.clone(),
        channel: r.channel.clone(),
        platform: r.platform.clone(),
        template_source: SOURCE_PLATFORM_RESOLVE.into(),
        template_name: String::new(),
        subject: None,
        payload: ReplayRecord::platform_resolve(platform, episode_id)
            .to_stored()
            .0,
    })
}

/// The destinations an episode attempted, for a producer to render their resolve rows first.
pub async fn recorded_destinations(
    org_id: &str,
    kind: NotificationKind,
    episode_id: &str,
) -> Vec<String> {
    let key = EpisodeKey {
        org: org_id.to_string(),
        kind: kind.as_str().to_string(),
        episode_id: episode_id.to_string(),
    };
    ledger::recorded_destinations(get_orm_client_rw().await, &key)
        .await
        .map(|v| v.into_iter().map(|r| r.destination).collect())
        .unwrap_or_default()
}

/// Close open episodes whose owning object is gone, so retention can collect them.
pub async fn close_orphan_episodes() -> Result<usize, anyhow::Error> {
    let db = get_orm_client_rw().await;
    let mut closed = 0;
    for episode in ledger::open_episodes(db, 500).await? {
        let kind = NotificationKind::parse(&episode.kind);
        if object_exists(kind, &episode.org, &episode.object_id).await {
            continue;
        }
        let key = EpisodeKey {
            org: episode.org.clone(),
            kind: episode.kind.clone(),
            episode_id: episode.episode_id.clone(),
        };
        ledger::close_episode(
            db,
            &key,
            &episode.object_id,
            ledger::CLOSED_BY_ORPHAN,
            now_micros(),
        )
        .await?;
        closed += 1;
    }
    Ok(closed)
}

/// Unknown kinds and lookup errors count as existing, so a transient error never closes an episode.
async fn object_exists(kind: Option<NotificationKind>, org: &str, object_id: &str) -> bool {
    match kind {
        Some(NotificationKind::Anomaly) => infra::table::anomaly_detection::config::get_by_id(
            get_orm_client_rw().await,
            org,
            object_id,
        )
        .await
        .map_or(true, |row| row.is_some()),
        Some(NotificationKind::Incident) => infra::table::alert_incidents::get(org, object_id)
            .await
            .map_or(true, |row| row.is_some()),
        _ => true,
    }
}

/// The per object roll up of Data section 2; a Handled skip never makes Delivered read as Partial.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct NotificationSummary {
    pub delivered: u32,
    pub unsuccessful: u32,
    pub handled: u32,
    pub pending: u32,
    pub state: String,
}

/// `None` for an object with no rows, which the panel shows as "No deliveries recorded".
pub fn summarize(
    rows: &[infra::table::entity::notification_deliveries::Model],
) -> Option<NotificationSummary> {
    if rows.is_empty() {
        return None;
    }
    let mut s = NotificationSummary::default();
    for row in rows {
        match row.status.as_str() {
            ledger::STATUS_SENT => s.delivered += 1,
            ledger::STATUS_SKIPPED => match row
                .skip_reason
                .as_deref()
                .and_then(SkipReason::parse)
                .map(SkipReason::outcome)
            {
                Some(super::notify::SkipOutcome::Delivered) => s.delivered += 1,
                Some(super::notify::SkipOutcome::Unsuccessful) => s.unsuccessful += 1,
                Some(super::notify::SkipOutcome::Pending) => s.pending += 1,
                _ => s.handled += 1,
            },
            ledger::STATUS_FAILED if row.retryable && row.attempt < row.max_attempts => {
                s.pending += 1
            }
            ledger::STATUS_FAILED => s.unsuccessful += 1,
            _ => s.pending += 1,
        }
    }
    s.state = match (s.delivered, s.unsuccessful, s.pending) {
        (d, 0, 0) if d > 0 => "delivered",
        (d, ..) if d > 0 => "partial",
        (0, _, p) if p > 0 => "pending",
        (0, 0, 0) => "handled",
        _ => "failed",
    }
    .to_string();
    Some(s)
}

fn fill_prepared(new: &mut NewDelivery, prepared: &Prepared) {
    new.template_source = prepared.template_source.clone();
    new.template_name = prepared.template_name.clone();
    new.template_skipped = prepared.template_skipped.clone();
}

fn skip_of(refusal: &Refusal) -> SkipReason {
    match refusal {
        Refusal::AlreadyDelivered => SkipReason::AlreadyDelivered,
        Refusal::InFlight => SkipReason::InFlight,
        Refusal::RetryScheduled => SkipReason::RetryScheduled,
        Refusal::Exhausted => SkipReason::Exhausted,
        Refusal::Superseded => SkipReason::Superseded,
        Refusal::NoTriggerRecorded => SkipReason::NoTriggerRecorded,
        Refusal::Stored(reason) => {
            SkipReason::parse(reason).unwrap_or(SkipReason::AlreadyDelivered)
        }
    }
}

/// The finish a transport result maps to; a known answer is never an unknown outcome.
pub fn finish_of(result: &Result<String, NotifyError>, image_dropped: bool) -> Finish {
    let note = |e: String| {
        if image_dropped {
            format!("{e}; {IMAGE_DROPPED}")
        } else {
            e
        }
    };
    match result {
        Ok(detail) => Finish {
            sent: true,
            answered: true,
            retryable: false,
            status_code: None,
            error: detail
                .starts_with(super::platform::NOTHING_TO_CLOSE)
                .then(|| cap(detail)),
            skip_reason: None,
        },
        Err(NotifyError::Skipped(reason)) => Finish {
            sent: false,
            answered: true,
            retryable: false,
            status_code: None,
            error: None,
            skip_reason: Some(reason.as_str().to_string()),
        },
        Err(NotifyError::DestinationNotFound(_)) => Finish {
            sent: false,
            answered: true,
            retryable: false,
            status_code: None,
            error: Some("destination deleted".into()),
            skip_reason: None,
        },
        Err(e) => Finish {
            sent: false,
            answered: !matches!(e, NotifyError::Transport(_)),
            retryable: e.is_retryable(),
            status_code: e.status_code().map(i32::from),
            error: Some(note(cap(&e.to_string()))),
            skip_reason: None,
        },
    }
}

async fn finish_row(
    row: &infra::table::entity::notification_deliveries::Model,
    token: &str,
    kind: NotificationKind,
    result: &Result<String, NotifyError>,
    image_dropped: bool,
) {
    let finish = finish_of(result, image_dropped);
    let status = if finish.sent {
        ledger::STATUS_SENT
    } else if finish.skip_reason.is_some() {
        ledger::STATUS_SKIPPED
    } else {
        ledger::STATUS_FAILED
    };
    match ledger::finish(
        get_orm_client_rw().await,
        &row.id,
        token,
        &finish,
        now_micros(),
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => log::warn!(
            "[NOTIFY] delivery {} lost its claim before it finished; the result is not recorded",
            row.id
        ),
        Err(e) => log::error!("[NOTIFY] finish of delivery {} failed: {e}", row.id),
    }
    config::metrics::NOTIFICATIONS_TOTAL
        .with_label_values(&[kind.as_str(), row.channel.as_str(), status])
        .inc();
    log::info!(
        "[NOTIFY] kind={kind} event={} destination={} channel={} template_source={} status={status} attempt={}",
        row.event,
        row.destination,
        row.channel,
        row.template_source,
        row.attempt
    );
}

/// A send that never reaches a transport still leaves its row: a platform skip or a render failure.
async fn record_terminal(new: &NewDelivery, error: &NotifyError) {
    let keep = matches!(
        error,
        NotifyError::Render(_)
            | NotifyError::Skipped(SkipReason::PlatformNoAck | SkipReason::PlatformNotForKind)
    );
    if !keep {
        return;
    }
    let mut new = new.clone();
    new.payload = serde_json::to_string(&ReplayRecord::truncated()).unwrap_or_default();
    if matches!(error, NotifyError::Skipped(_)) {
        new.template_source = SOURCE_PLATFORM_RESOLVE.into();
    }
    if let Err(e) = ledger::insert_terminal(
        get_orm_client_rw().await,
        &new,
        &finish_of(&Err(clone_error(error)), false),
        now_micros(),
    )
    .await
    {
        log::error!("[NOTIFY] could not record the {} row: {e}", new.event);
    }
}

fn clone_error(e: &NotifyError) -> NotifyError {
    match e {
        NotifyError::Skipped(r) => NotifyError::Skipped(*r),
        other => NotifyError::Render(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::{Email, Endpoint};

    use super::*;

    #[test]
    fn finish_maps_answers_and_silence() {
        let f = finish_of(
            &Err(NotifyError::Rejected {
                status: 503,
                body: "x".into(),
            }),
            false,
        );
        assert!(f.answered && f.retryable && f.status_code == Some(503));
        let f = finish_of(&Err(NotifyError::Transport("timeout".into())), false);
        assert!(!f.answered && f.retryable);
        let f = finish_of(
            &Err(NotifyError::Skipped(SkipReason::NoOrgMemberRecipient)),
            false,
        );
        assert_eq!(f.skip_reason.as_deref(), Some("NoOrgMemberRecipient"));
        let f = finish_of(
            &Err(NotifyError::Rejected {
                status: 503,
                body: String::new(),
            }),
            true,
        );
        assert!(f.error.unwrap().ends_with(IMAGE_DROPPED));
        let f = finish_of(&Ok("nothing to close: x".into()), false);
        assert!(f.sent);
        assert!(f.error.unwrap().starts_with("nothing to close"));
        let f = finish_of(&Err(NotifyError::DestinationNotFound("d".into())), false);
        assert!(!f.retryable);
        assert_eq!(f.error.as_deref(), Some("destination deleted"));
    }

    fn row(
        status: &str,
        skip: Option<&str>,
        retryable: bool,
        attempt: i32,
    ) -> infra::table::entity::notification_deliveries::Model {
        infra::table::entity::notification_deliveries::Model {
            id: String::new(),
            org: String::new(),
            kind: String::new(),
            object_id: String::new(),
            episode_id: String::new(),
            event: String::new(),
            destination: String::new(),
            channel: String::new(),
            template_source: String::new(),
            template_name: String::new(),
            template_skipped: String::new(),
            opens_episode: false,
            status: status.into(),
            attempt,
            max_attempts: 5,
            retryable,
            status_code: None,
            error: None,
            skip_reason: skip.map(str::to_string),
            subject: None,
            payload: String::new(),
            claim_token: None,
            claimed_at: None,
            finished_at: None,
            next_retry_at: None,
            created_at: 0,
            episode_closed_at: None,
        }
    }

    #[test]
    fn summary_counting_rule() {
        assert_eq!(summarize(&[]), None);
        let handled_and_sent = [
            row("sent", None, false, 1),
            row("skipped", Some("PlatformNoAck"), false, 0),
        ];
        let s = summarize(&handled_and_sent).unwrap();
        assert_eq!(
            s.state, "delivered",
            "a Handled skip never makes Delivered Partial"
        );
        assert_eq!(s.handled, 1);
        let partial = [row("sent", None, false, 1), row("failed", None, true, 2)];
        assert_eq!(summarize(&partial).unwrap().state, "partial");
        let failed = [
            row("failed", None, false, 5),
            row("skipped", Some("NoOrgMemberRecipient"), false, 1),
        ];
        assert_eq!(summarize(&failed).unwrap().state, "failed");
        let pending = [row("queued", None, false, 0)];
        assert_eq!(summarize(&pending).unwrap().state, "pending");
        let handled = [row("skipped", Some("PlatformNotForKind"), false, 0)];
        assert_eq!(summarize(&handled).unwrap().state, "handled");
    }

    #[test]
    fn a_destination_edited_to_another_transport_is_changed() {
        let record = ReplayRecord::http("POST", "{}".into(), None);
        let slack = DestinationType::Http(Endpoint {
            destination_type: Some("slack".into()),
            ..Default::default()
        });
        assert!(!destination_changed(&record, &slack, "slack"));
        let email = DestinationType::Email(Email::default());
        assert!(destination_changed(&record, &email, "slack"));
        let teams = DestinationType::Http(Endpoint {
            destination_type: Some("discord".into()),
            ..Default::default()
        });
        assert!(destination_changed(&record, &teams, "slack"));
    }
}
