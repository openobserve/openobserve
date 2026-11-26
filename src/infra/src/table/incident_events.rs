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

use std::collections::HashSet;

use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseTransaction, EntityTrait, QueryFilter,
    QuerySelect, Select, Set, TransactionTrait,
    sea_query::{Expr, LockType, Query},
};
use serde::{Deserialize, Serialize};

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::entity::incident_events,
};

const CAUSE_NOTICE_DESTINATIONS: &str = "CauseNoticeDestinations";
const REOPEN_EFFECT_COMPLETED: &str = "ReopenEffectCompleted";

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
pub enum ReopenEffect {
    Workflow(String),
    AutoReopen,
    Repage(Option<String>),
}

/// Encode events for storage, surfacing failures instead of writing a null column.
///
/// `unwrap_or_default()` here would persist JSON `null`, erasing the timeline on a write
/// that was meant to extend it. Propagating the error aborts the surrounding transaction
/// and leaves the existing row untouched.
fn encode_events(events: &[IncidentEvent]) -> Result<serde_json::Value, sea_orm::DbErr> {
    serde_json::to_value(events)
        .map_err(|e| sea_orm::DbErr::Custom(format!("serialize incident events: {e}")))
}

/// Decode a stored `events` JSON column into events.
///
/// Decodes element-wise rather than parsing the array as a whole: one malformed entry must
/// not discard the entire timeline. Every caller that decodes then writes back (`append`,
/// `record_alert`) would otherwise persist the truncated list, turning a transient read
/// failure into permanent data loss.
///
/// Unknown-but-well-formed event types are preserved by `IncidentEventType::Unknown`, so
/// they survive a read/write cycle on an older node during a rolling deploy.
///
/// Note that `Unknown` is a wide net: serde falls back to it for any entry the tagged
/// variants reject, so a *known* tag with a malformed payload is retained too and never
/// reaches the `dropped` counter below. Those two cases mean very different things, so they
/// are logged at different levels — see `malformed` vs `forward_compat`. In practice
/// `dropped` only counts entries that are not JSON objects at all.
fn decode_events(org_id: &str, incident_id: &str, raw: &serde_json::Value) -> Vec<IncidentEvent> {
    let Some(items) = raw.as_array() else {
        if !raw.is_null() {
            log::error!(
                "[INCIDENTS] events column for {org_id}/{incident_id} is not an array; \
                 ignoring stored value"
            );
        }
        return vec![];
    };

    let mut events = Vec::with_capacity(items.len());
    let mut dropped = 0usize;
    let mut malformed = 0usize;
    let mut forward_compat = 0usize;
    for item in items {
        match serde_json::from_value::<IncidentEvent>(item.clone()) {
            Ok(event) => {
                // Separate a newer node's event type (benign) from a known tag whose payload
                // failed to parse (a real bug that would otherwise be invisible).
                if let IncidentEventType::Unknown(raw_event) = &event.event_type {
                    if IncidentEventType::is_known_tag(raw_event) {
                        malformed += 1;
                    } else {
                        forward_compat += 1;
                    }
                }
                events.push(event);
            }
            Err(e) => {
                dropped += 1;
                log::error!(
                    "[INCIDENTS] skipping undecodable event for {org_id}/{incident_id}: {e}"
                );
            }
        }
    }
    if malformed > 0 {
        // Schema drift or a serialization bug: the tag is one we own, so the payload should
        // have decoded. Retained verbatim rather than dropped, but it needs investigation.
        log::error!(
            "[INCIDENTS] {malformed} event(s) for {org_id}/{incident_id} use a known type but \
             failed to decode; retained as opaque JSON"
        );
    }
    if forward_compat > 0 {
        // Expected while a newer node is writing types this binary predates.
        log::debug!(
            "[INCIDENTS] {forward_compat} event(s) for {org_id}/{incident_id} have unrecognized \
             types; preserved for forward compatibility"
        );
    }
    if dropped > 0 {
        log::error!(
            "[INCIDENTS] dropped {dropped} of {} events for {org_id}/{incident_id}",
            items.len()
        );
    }
    events
}

/// An empty events row written with its incident, so its opener's `init` and a joiner's
/// `record_alert` both find a row to lock instead of both inserting one.
pub async fn open_empty_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<(), sea_orm::DbErr> {
    incident_events::Entity::insert(incident_events::ActiveModel {
        org_id: Set(org_id.to_string()),
        incident_id: Set(incident_id.to_string()),
        events: Set(encode_events(&[])?),
        seq: Set(1),
    })
    .on_conflict(
        sea_orm::sea_query::OnConflict::columns([
            incident_events::Column::OrgId,
            incident_events::Column::IncidentId,
        ])
        .do_nothing()
        .to_owned(),
    )
    .exec_without_returning(conn)
    .await?;
    Ok(())
}

/// Initialize events row for a new incident with a Created event
pub async fn init(org_id: &str, incident_id: &str) -> Result<(), sea_orm::DbErr> {
    init_with(get_orm_client_rw().await, org_id, incident_id).await
}

/// [init] on a given connection, in its own transaction.
pub async fn init_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<(), sea_orm::DbErr> {
    let txn = db.begin().await?;
    let mut created = IncidentEvent::created();
    // A moved alert's incident is visible before its setup, so its SplitFrom may already be there.
    match locked_row(&txn, org_id, incident_id).one(&txn).await? {
        Some(model) => {
            let mut events = decode_events(org_id, incident_id, &model.events);
            if !events
                .iter()
                .any(|e| matches!(e.event_type, IncidentEventType::Created))
            {
                let earliest = events.iter().map(|e| e.timestamp).min();
                created.timestamp =
                    earliest.map_or(created.timestamp, |t| t.min(created.timestamp));
                // Why the incident opened stays its first entry.
                let at = events
                    .iter()
                    .take_while(|e| matches!(e.event_type, IncidentEventType::SplitFrom { .. }))
                    .count();
                created.seq = model.seq + 1;
                events.insert(at, created);
                rewrite_in(&txn, model, &events).await?;
            }
        }
        None => insert_in(&txn, org_id, incident_id, vec![created]).await?,
    }
    txn.commit().await
}

/// Get all events for an incident
pub async fn get(org_id: &str, incident_id: &str) -> Result<Vec<IncidentEvent>, sea_orm::DbErr> {
    get_with(get_orm_client_ro().await, org_id, incident_id).await
}

/// [get] on the primary, for a decision an event written in the same transaction as a change
/// drives.
pub async fn get_rw(org_id: &str, incident_id: &str) -> Result<Vec<IncidentEvent>, sea_orm::DbErr> {
    get_with(get_orm_client_rw().await, org_id, incident_id).await
}

/// [get] on a given connection, such as a transaction holding the incident row.
pub async fn get_with<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<Vec<IncidentEvent>, sea_orm::DbErr> {
    let row = event_row(org_id, incident_id).one(db).await?;
    Ok(row.map_or_else(Vec::new, |model| {
        visible_events(org_id, incident_id, &model.events)
    }))
}

/// Holding the incident lock keeps a superseding review outside the caller's write.
pub async fn cause_review_is_current_in(
    txn: &DatabaseTransaction,
    org: &str,
    incident: &str,
    transition_id: &str,
) -> Result<bool, sea_orm::DbErr> {
    if super::alert_incidents::get_locked(txn, org, incident)
        .await?
        .is_none()
    {
        return Ok(false);
    }
    cause_review_is_current_with(txn, org, incident, transition_id).await
}

pub async fn cause_review_is_current_with(
    conn: &impl ConnectionTrait,
    org: &str,
    incident: &str,
    transition_id: &str,
) -> Result<bool, sea_orm::DbErr> {
    use super::entity::alert_incidents as incidents;

    let reviewed = Query::select()
        .column(incidents::Column::Id)
        .from(incidents::Entity)
        .and_where(Expr::col(incidents::Column::OrgId).eq(org))
        .and_where(Expr::col(incidents::Column::CauseReviewedAt).is_not_null())
        .to_owned();
    let events = event_row(org, incident)
        .filter(incident_events::Column::IncidentId.in_subquery(reviewed))
        .select_only()
        .column(incident_events::Column::Events)
        .into_tuple::<serde_json::Value>()
        .one(conn)
        .await?;

    Ok(events
        .as_ref()
        .and_then(serde_json::Value::as_array)
        .and_then(|events| {
            events
                .iter()
                .rev()
                .find(|event| event["type"].as_str() == Some("CauseReviewed"))
        })
        .and_then(|event| event["data"]["transition_id"].as_str())
        == Some(transition_id))
}

pub async fn cause_notice_destinations_in(
    txn: &DatabaseTransaction,
    org: &str,
    incident: &str,
) -> Result<Option<Vec<String>>, sea_orm::DbErr> {
    let Some(row) = event_row(org, incident).one(txn).await? else {
        return Ok(None);
    };
    let destinations = decode_events(org, incident, &row.events)
        .into_iter()
        .find_map(|event| match event.event_type {
            IncidentEventType::Unknown(mut raw)
                if raw["type"].as_str() == Some(CAUSE_NOTICE_DESTINATIONS) =>
            {
                Some(raw["data"].take())
            }
            _ => None,
        });
    destinations
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| {
            sea_orm::DbErr::Custom(format!("decode cause notice destinations: {error}"))
        })
}

pub async fn record_cause_notice_destinations_in(
    txn: &DatabaseTransaction,
    org: &str,
    incident: &str,
    at: i64,
    destinations: &[String],
) -> Result<(), sea_orm::DbErr> {
    append_in(
        txn,
        org,
        incident,
        IncidentEvent {
            timestamp: at,
            seq: 0,
            event_type: IncidentEventType::Unknown(serde_json::json!({
                "type": CAUSE_NOTICE_DESTINATIONS,
                "data": destinations,
            })),
        },
    )
    .await
}

pub async fn completed_reopen_effects(
    org: &str,
    incident: &str,
    transition_id: &str,
) -> Result<HashSet<ReopenEffect>, sea_orm::DbErr> {
    completed_reopen_effects_with(get_orm_client_rw().await, org, incident, transition_id).await
}

pub async fn complete_reopen_effect(
    org: &str,
    incident: &str,
    transition_id: &str,
    effect: ReopenEffect,
) -> Result<(), sea_orm::DbErr> {
    let txn = get_orm_client_rw().await.begin().await?;
    claim_reopen_effect_in(&txn, org, incident, transition_id, effect).await?;
    txn.commit().await
}

pub async fn claim_reopen_effect_in(
    txn: &DatabaseTransaction,
    org: &str,
    incident: &str,
    transition_id: &str,
    effect: ReopenEffect,
) -> Result<bool, sea_orm::DbErr> {
    let model = locked_row(txn, org, incident)
        .one(txn)
        .await?
        .ok_or_else(|| sea_orm::DbErr::RecordNotFound("Reopen timeline".into()))?;
    let mut events = decode_events(org, incident, &model.events);
    // Live unack can restart several pages, shifting which response a retry would select.
    if events.iter().any(|event| {
        let claimed = reopen_effect(event, transition_id);
        claimed.as_ref() == Some(&effect)
            || matches!(
                (claimed, &effect),
                (Some(ReopenEffect::Repage(_)), ReopenEffect::Repage(_))
            )
    }) {
        return Ok(false);
    }
    events.push(IncidentEvent {
        timestamp: config::utils::time::now_micros(),
        seq: model.seq + 1,
        event_type: IncidentEventType::Unknown(serde_json::json!({
            "type": REOPEN_EFFECT_COMPLETED,
            "data": {"transition_id": transition_id, "effect": effect},
        })),
    });
    rewrite_in(txn, model, &events).await?;
    Ok(true)
}

/// An incident's events with the row's `seq`; `(vec![], 0)` when it has no row yet.
pub async fn get_page(
    org_id: &str,
    incident_id: &str,
) -> Result<(Vec<IncidentEvent>, i64), sea_orm::DbErr> {
    get_page_with(get_orm_client_ro().await, org_id, incident_id).await
}

/// [get_page] on a given connection.
pub async fn get_page_with<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<(Vec<IncidentEvent>, i64), sea_orm::DbErr> {
    let row = event_row(org_id, incident_id).one(db).await?;
    Ok(row.map_or((vec![], 0), |model| {
        (
            visible_events(org_id, incident_id, &model.events),
            model.seq,
        )
    }))
}

/// The row's `seq` alone, without reading the events; 0 when the incident has no row yet.
pub async fn seq(org_id: &str, incident_id: &str) -> Result<i64, sea_orm::DbErr> {
    seq_with(get_orm_client_ro().await, org_id, incident_id).await
}

/// [seq] on a given connection.
pub async fn seq_with<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<i64, sea_orm::DbErr> {
    let seq = event_row(org_id, incident_id)
        .select_only()
        .column(incident_events::Column::Seq)
        .into_tuple::<i64>()
        .one(db)
        .await?;
    Ok(seq.unwrap_or(0))
}

/// Assemble the reconstructed timeline from authoritative incident/alert columns.
///
/// Split out from [`reconstruct_if_empty`] so the event-shaping rules are testable without
/// a database. Events carry their historical timestamps — deliberately not the
/// `IncidentEvent::*` constructors, which stamp `now()` and would date a rebuilt timeline to
/// the moment of repair.
fn build_reconstructed_events(
    created_at: i64,
    resolution: Option<(i64, Option<String>)>,
    alerts: impl Iterator<Item = (String, String, i64)>,
) -> Vec<IncidentEvent> {
    let mut events = Vec::new();

    for (alert_id, alert_name, fired_at) in alerts {
        events.push(IncidentEvent {
            timestamp: fired_at,
            seq: 0,
            event_type: IncidentEventType::Alert {
                alert_id,
                alert_name,
                // Each join row is one firing; the pre-compaction shape is the honest
                // representation, since the original per-event counts are unrecoverable.
                count: 1,
                first_at: fired_at,
                last_at: fired_at,
            },
        });
    }

    if let Some((resolved_at, user_id)) = resolution {
        events.push(IncidentEvent {
            timestamp: resolved_at,
            seq: 0,
            event_type: IncidentEventType::Resolved { user_id },
        });
    }

    events.sort_by_key(|e| e.timestamp);

    // `Created` is prepended after sorting rather than sorted in with the rest. The
    // triggering alert routinely fires a few hundred milliseconds BEFORE the incident row
    // is written (observed locally: alert at ..419417 vs created_at ..883003), so sorting
    // purely by timestamp renders an "Alert" above the "Created" that opens the incident.
    // The incident cannot precede its own creation in any readable timeline, so it is
    // pinned to the front while every other event keeps its true chronological position.
    events.insert(
        0,
        IncidentEvent {
            timestamp: created_at,
            seq: 0,
            event_type: IncidentEventType::Created,
        },
    );

    events
}

/// Rebuild a partial timeline for incidents whose events row was emptied by the pre-fix
/// read/write cycle (see [`decode_events`]).
///
/// Releases up to v0.91.x decoded the events column with `unwrap_or_default()`, so a single
/// unparseable entry yielded `[]`, and the next `append` persisted that — permanently losing
/// the timeline. The lost events cannot be recovered; they were never stored anywhere else.
/// What *can* be rebuilt is the subset derivable from authoritative columns that were never
/// part of the corrupted blob:
///
/// - `Created` from `alert_incidents.created_at`
/// - `Alert` from the `alert_incident_alerts` join rows (id, name, fired-at all preserved)
/// - `Resolved` from `alert_incidents.resolved_at`
///
/// Deliberately NOT reconstructed: comments, acknowledgements, title/severity/assignment
/// changes and RCA events. Those exist only in the lost blob, and inventing them would be
/// worse than a gap. The result is therefore explicitly partial — an incomplete-but-true
/// timeline, preferred over a blank Activity tab.
///
/// Returns the number of events written, or `None` if the row was left untouched. A row is
/// only repaired when it currently decodes to zero events; a timeline with any surviving
/// content is never rewritten.
pub async fn reconstruct_if_empty(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<usize>, sea_orm::DbErr> {
    reconstruct_if_empty_with(get_orm_client_rw().await, org_id, incident_id).await
}

/// [reconstruct_if_empty] on a given connection, in its own transaction.
pub async fn reconstruct_if_empty_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    incident_id: &str,
) -> Result<Option<usize>, sea_orm::DbErr> {
    let txn = db.begin().await?;

    // Locked so an append landing during the rebuild waits instead of being overwritten.
    let row = locked_row(&txn, org_id, incident_id).one(&txn).await?;

    // Only touch rows that are genuinely empty. Anything with surviving events is left
    // alone — a partial rebuild must never displace real history.
    if let Some(model) = &row
        && !decode_events(org_id, incident_id, &model.events).is_empty()
    {
        txn.rollback().await?;
        return Ok(None);
    }

    let Some(incident) = super::entity::alert_incidents::Entity::find()
        .filter(super::entity::alert_incidents::Column::Id.eq(incident_id))
        .filter(super::entity::alert_incidents::Column::OrgId.eq(org_id))
        .one(&txn)
        .await?
    else {
        txn.rollback().await?;
        return Ok(None);
    };

    let alerts = super::entity::alert_incident_alerts::Entity::find()
        .filter(super::entity::alert_incident_alerts::Column::IncidentId.eq(incident_id))
        .all(&txn)
        .await?;

    let resolution = incident.resolved_at.map(|at| {
        let resolver = incident
            .resolved_by
            .filter(|actor| actor != super::alert_incidents::SYSTEM_RESOLVER);
        (at, resolver)
    });
    let mut events = build_reconstructed_events(
        incident.created_at,
        resolution,
        alerts
            .into_iter()
            .map(|a| (a.alert_id, a.alert_name, a.alert_fired_at)),
    );
    let count = events.len();

    match row {
        Some(model) => {
            let seq = model.seq + 1;
            events.iter_mut().for_each(|e| e.seq = seq);
            rewrite_in(&txn, model, &events).await?;
        }
        None => insert_in(&txn, org_id, incident_id, events).await?,
    }

    txn.commit().await?;
    log::info!(
        "[INCIDENTS] reconstructed {count} event(s) for {org_id}/{incident_id} from incident \
         and alert rows; pre-corruption history could not be recovered"
    );
    Ok(Some(count))
}

/// Append a generic event to an incident's event timeline
pub async fn append(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<(), sea_orm::DbErr> {
    append_with(get_orm_client_rw().await, org_id, incident_id, event).await
}

/// A persisted resolution timestamp lets retries repair a missing event without duplicating it.
pub async fn ensure_resolved(
    org_id: &str,
    incident_id: &str,
    resolved_at: i64,
    user_id: &str,
) -> Result<(), sea_orm::DbErr> {
    let txn = get_orm_client_rw().await.begin().await?;
    let mut event = IncidentEvent::resolved(Some(user_id.to_string()));
    event.timestamp = resolved_at;
    append_once_in(&txn, org_id, incident_id, event, true).await?;
    txn.commit().await
}

/// [append] on a given connection, in its own transaction (a savepoint when `db` is one).
pub async fn append_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<(), sea_orm::DbErr> {
    let txn = db.begin().await?;
    append_in(&txn, org_id, incident_id, event).await?;
    txn.commit().await?;
    Ok(())
}

/// [append] inside the caller's transaction, so the event commits or rolls back with it.
pub async fn append_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<(), sea_orm::DbErr> {
    append_once_in(txn, org_id, incident_id, event, false).await
}

/// Drops one alert's firing entries and the wording of its severity raises, in the caller's
/// transaction; the raises' levels and alert id stay so a put-back can replay them.
pub async fn forget_alert_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    incident_id: &str,
    alert_id: &str,
) -> Result<(), sea_orm::DbErr> {
    let Some(model) = locked_row(txn, org_id, incident_id).one(txn).await? else {
        return Ok(());
    };
    let mut events = decode_events(org_id, incident_id, &model.events);
    let before = events.len();
    events.retain(
        |e| !matches!(&e.event_type, IncidentEventType::Alert { alert_id: a, .. } if a == alert_id),
    );
    let mut changed = events.len() != before;
    for event in &mut events {
        if let IncidentEventType::SeverityUpgrade {
            reason,
            alert_id: Some(by),
            ..
        } = &mut event.event_type
            && by == alert_id
            && !reason.is_empty()
        {
            reason.clear();
            event.seq = model.seq + 1;
            changed = true;
        }
    }
    if !changed {
        return Ok(());
    }
    rewrite_in(txn, model, &events).await
}

async fn append_once_in(
    txn: &DatabaseTransaction,
    org_id: &str,
    incident_id: &str,
    mut event: IncidentEvent,
    resolution: bool,
) -> Result<(), sea_orm::DbErr> {
    crate::race_point!("incident_events.before_row_read");
    let row = locked_row(txn, org_id, incident_id).one(txn).await?;

    match row {
        Some(model) => {
            let mut events = decode_events(org_id, incident_id, &model.events);
            if resolution && has_resolution(&events, event.timestamp) {
                return Ok(());
            }
            event.seq = model.seq + 1;
            events.push(event);
            rewrite_in(txn, model, &events).await
        }
        // Row doesn't exist yet (incident created before events table)
        None => insert_in(txn, org_id, incident_id, vec![event]).await,
    }
}

/// Writes `events` over `model`'s row and raises its `seq` by one; the caller holds the row lock.
async fn rewrite_in<C: ConnectionTrait>(
    conn: &C,
    model: incident_events::Model,
    events: &[IncidentEvent],
) -> Result<(), sea_orm::DbErr> {
    let seq = model.seq + 1;
    let mut active: incident_events::ActiveModel = model.into();
    active.events = Set(encode_events(events)?);
    active.seq = Set(seq);
    active.update(conn).await?;
    Ok(())
}

/// The first write of a row: `seq` 1, stamped on every event it carries.
async fn insert_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
    mut events: Vec<IncidentEvent>,
) -> Result<(), sea_orm::DbErr> {
    events.iter_mut().for_each(|e| e.seq = 1);
    incident_events::ActiveModel {
        org_id: Set(org_id.to_string()),
        incident_id: Set(incident_id.to_string()),
        events: Set(encode_events(&events)?),
        seq: Set(1),
    }
    .insert(conn)
    .await?;
    Ok(())
}

fn has_resolution(events: &[IncidentEvent], resolved_at: i64) -> bool {
    events.iter().any(|event| {
        event.timestamp >= resolved_at
            && matches!(
                event.event_type,
                config::meta::alerts::incidents::IncidentEventType::Resolved { .. }
            )
    })
}

async fn completed_reopen_effects_with(
    db: &impl ConnectionTrait,
    org: &str,
    incident: &str,
    transition_id: &str,
) -> Result<HashSet<ReopenEffect>, sea_orm::DbErr> {
    let row = event_row(org, incident).one(db).await?;
    Ok(row.map_or_else(HashSet::new, |row| {
        decode_events(org, incident, &row.events)
            .iter()
            .filter_map(|event| reopen_effect(event, transition_id))
            .collect()
    }))
}

fn reopen_effect(event: &IncidentEvent, transition_id: &str) -> Option<ReopenEffect> {
    let IncidentEventType::Unknown(raw) = &event.event_type else {
        return None;
    };
    if raw["type"].as_str() == Some(REOPEN_EFFECT_COMPLETED)
        && raw["data"]["transition_id"].as_str() == Some(transition_id)
    {
        return serde_json::from_value(raw["data"]["effect"].clone()).ok();
    }
    None
}

fn visible_events(org: &str, incident: &str, raw: &serde_json::Value) -> Vec<IncidentEvent> {
    let mut events = decode_events(org, incident, raw);
    events.retain(|event| match &event.event_type {
        IncidentEventType::Unknown(raw) => !matches!(
            raw["type"].as_str(),
            Some("DeclareEffects" | CAUSE_NOTICE_DESTINATIONS | REOPEN_EFFECT_COMPLETED)
        ),
        _ => true,
    });
    events
}

fn event_row(org_id: &str, incident_id: &str) -> Select<incident_events::Entity> {
    incident_events::Entity::find()
        .filter(incident_events::Column::OrgId.eq(org_id))
        .filter(incident_events::Column::IncidentId.eq(incident_id))
}

/// Row lock so concurrent rewrites cannot drop each other's event; SQLite has no `FOR UPDATE`.
fn locked_row(
    txn: &DatabaseTransaction,
    org_id: &str,
    incident_id: &str,
) -> Select<incident_events::Entity> {
    let query = event_row(org_id, incident_id);
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Sqlite {
        query
    } else {
        query.lock(LockType::Update)
    }
}

pub async fn record_alert(
    org_id: &str,
    incident_id: &str,
    alert_id: &str,
    alert_name: &str,
    triggered_at: i64,
) -> Result<Option<bool>, sea_orm::DbErr> {
    let db = get_orm_client_rw().await;
    record_alert_with(db, org_id, incident_id, alert_id, alert_name, triggered_at).await
}

/// [record_alert] on a given connection, in its own transaction.
pub async fn record_alert_with<C: TransactionTrait>(
    db: &C,
    org_id: &str,
    incident_id: &str,
    alert_id: &str,
    alert_name: &str,
    triggered_at: i64,
) -> Result<Option<bool>, sea_orm::DbErr> {
    let txn = db.begin().await?;

    let row = locked_row(&txn, org_id, incident_id).one(&txn).await?;
    // A move out drops the alert's entries under this lock; a firing it already moved records none.
    if !super::alert_incidents::has_member_in(&txn, incident_id, alert_id).await? {
        txn.rollback().await?;
        return Ok(None);
    }

    let waited = match row {
        Some(model) => {
            let mut events = decode_events(org_id, incident_id, &model.events);
            let waited = config::meta::alerts::incidents::manual_reopen_awaits_firing(&events);
            let touched = config::meta::alerts::incidents::push_alert_event(
                &mut events,
                alert_id,
                alert_name,
                triggered_at,
            );
            // A repeat firing changes its entry in place; the new seq lets a `since` reader see it.
            events[touched].seq = model.seq + 1;
            rewrite_in(&txn, model, &events).await?;
            waited
        }
        None => {
            let events = vec![IncidentEvent::alert(alert_id, alert_name, triggered_at)];
            insert_in(&txn, org_id, incident_id, events).await?;
            false
        }
    };

    txn.commit().await?;
    Ok(Some(waited))
}

/// Deletes all incident event entries belonging to the given org.
pub async fn delete_by_org(org_id: &str) -> Result<(), sea_orm::DbErr> {
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

    let db = get_orm_client_rw().await;
    incident_events::Entity::delete_many()
        .filter(incident_events::Column::OrgId.eq(org_id))
        .exec(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::incidents::IncidentEventType;

    use super::*;

    /// SQLite, then a Postgres schema of its own when `ZO_META_POSTGRES_DSN` is set.
    async fn event_backends() -> Vec<(&'static str, sea_orm::DatabaseConnection, Option<String>)> {
        use sea_orm::{ConnectOptions, Database};

        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let mut out = vec![("sqlite", Database::connect(opts).await.unwrap(), None)];
        if let Some(schema) = event_schema().await {
            out.insert(
                0,
                ("postgres", schema_connection(&schema).await, Some(schema)),
            );
        }
        for (_, db, _) in &out {
            let backend = db.get_database_backend();
            let table =
                sea_orm::Schema::new(backend).create_table_from_entity(incident_events::Entity);
            db.execute(backend.build(&table)).await.unwrap();
        }
        out
    }

    /// A fresh schema on `ZO_META_POSTGRES_DSN`; the SQLite lane sets the variable empty.
    async fn event_schema() -> Option<String> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!("iev_test_{}", config::ider::generate().to_ascii_lowercase());
        let admin = sea_orm::Database::connect(&dsn).await.unwrap();
        let create = format!(r#"CREATE SCHEMA "{schema}""#);
        admin.execute_unprepared(&create).await.unwrap();
        Some(schema)
    }

    async fn schema_connection(schema: &str) -> sea_orm::DatabaseConnection {
        let mut options =
            sea_orm::ConnectOptions::new(std::env::var("ZO_META_POSTGRES_DSN").unwrap());
        options
            .max_connections(1)
            .set_schema_search_path(schema.to_string());
        sea_orm::Database::connect(options).await.unwrap()
    }

    async fn drop_event_schema(schema: Option<String>) {
        let Some(schema) = schema else {
            return;
        };
        let admin = sea_orm::Database::connect(std::env::var("ZO_META_POSTGRES_DSN").unwrap())
            .await
            .unwrap();
        let drop = format!(r#"DROP SCHEMA "{schema}" CASCADE"#);
        admin.execute_unprepared(&drop).await.unwrap();
        println!("postgres arm ran");
    }

    async fn resolutions(db: &sea_orm::DatabaseConnection) -> Vec<IncidentEvent> {
        let row = incident_events::Entity::find()
            .one(db)
            .await
            .unwrap()
            .unwrap();
        decode_events("demo-org", "incident", &row.events)
    }

    fn resolution_at(timestamp: i64) -> IncidentEvent {
        let mut event = IncidentEvent::resolved(None);
        event.timestamp = timestamp;
        event
    }

    #[tokio::test]
    async fn incidents_reopen_effects_are_idempotent_and_hidden() {
        for (_, db, schema) in event_backends().await {
            append_with(&db, "demo-org", "incident", IncidentEvent::created())
                .await
                .unwrap();
            let effects = [
                ReopenEffect::Workflow("flow".to_owned()),
                ReopenEffect::AutoReopen,
            ];
            for _ in 0..2 {
                for effect in &effects {
                    let txn = db.begin().await.unwrap();
                    claim_reopen_effect_in(
                        &txn,
                        "demo-org",
                        "incident",
                        "transition-1",
                        effect.clone(),
                    )
                    .await
                    .unwrap();
                    txn.commit().await.unwrap();
                }
            }
            assert_eq!(
                completed_reopen_effects_with(&db, "demo-org", "incident", "transition-1")
                    .await
                    .unwrap(),
                HashSet::from(effects),
            );
            assert!(
                completed_reopen_effects_with(&db, "demo-org", "incident", "transition-2")
                    .await
                    .unwrap()
                    .is_empty()
            );
            let (events, seq) = get_page_with(&db, "demo-org", "incident").await.unwrap();
            assert_eq!(events.len(), 1);
            assert_eq!(seq, 3);
            drop_event_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn resolution_event_repair_survives_rollback_and_retries() {
        for (backend, db, schema) in event_backends().await {
            append_with(&db, "demo-org", "incident", IncidentEvent::created())
                .await
                .unwrap();
            let event = resolution_at(100);
            let interrupted = db.begin().await.unwrap();
            append_once_in(&interrupted, "demo-org", "incident", event.clone(), true)
                .await
                .unwrap();
            interrupted.rollback().await.unwrap();
            for _ in 0..2 {
                let retry = db.begin().await.unwrap();
                append_once_in(&retry, "demo-org", "incident", event.clone(), true)
                    .await
                    .unwrap();
                retry.commit().await.unwrap();
            }
            let events = resolutions(&db).await;
            assert_eq!(events.len(), 2, "{backend}");
            assert!(has_resolution(&events, 100), "{backend}");
            assert!(
                !has_resolution(&events, 101),
                "{backend}: a later resolution needs its own event"
            );
            let later = db.begin().await.unwrap();
            append_once_in(&later, "demo-org", "incident", resolution_at(101), true)
                .await
                .unwrap();
            later.commit().await.unwrap();
            assert!(has_resolution(&resolutions(&db).await, 101), "{backend}");
            drop_event_schema(schema).await;
        }
    }

    /// SQLite's write pool has one connection, so two writes there cannot overlap at all.
    #[tokio::test]
    async fn an_event_written_while_a_repair_holds_the_row_keeps_both_on_postgres() {
        let Some(schema) = event_schema().await else {
            println!("postgres arm skipped: ZO_META_POSTGRES_DSN is unset");
            return;
        };
        let (db, other) = (
            schema_connection(&schema).await,
            schema_connection(&schema).await,
        );
        let backend = db.get_database_backend();
        let table = sea_orm::Schema::new(backend).create_table_from_entity(incident_events::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        append_with(&db, "demo-org", "incident", IncidentEvent::created())
            .await
            .unwrap();
        let repair = db.begin().await.unwrap();
        append_once_in(&repair, "demo-org", "incident", resolution_at(100), true)
            .await
            .unwrap();
        let comment = IncidentEvent::comment("someone@example.com", "still looking");
        let second = append_with(&other, "demo-org", "incident", comment);
        tokio::pin!(second);
        let early = tokio::time::timeout(std::time::Duration::from_millis(500), &mut second).await;
        assert!(early.is_err(), "the second write waits on the row lock");
        repair.commit().await.unwrap();
        second.await.unwrap();
        let events = resolutions(&db).await;
        assert!(
            has_resolution(&events, 100),
            "the overlapping write kept the repair"
        );
        assert_eq!(events.len(), 3, "created, the resolution, the comment");
        let retry = db.begin().await.unwrap();
        append_once_in(&retry, "demo-org", "incident", resolution_at(100), true)
            .await
            .unwrap();
        retry.commit().await.unwrap();
        assert_eq!(resolutions(&db).await.len(), 3, "the retry records it once");
        drop_event_schema(Some(schema)).await;
    }

    #[test]
    fn test_decode_events_preserves_unknown_and_skips_non_objects() {
        let raw = serde_json::json!([
            {"timestamp": 1, "type": "Created"},
            {"timestamp": 2, "type": "some_future_event", "data": {"k": "v"}},
            "not-an-event",
            {"timestamp": 3, "type": "ai_analysis_complete"},
        ]);

        let events = decode_events("org", "inc", &raw);

        // The bare string is undecodable and dropped; everything else survives.
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0].event_type, IncidentEventType::Created));
        assert!(matches!(
            events[1].event_type,
            IncidentEventType::Unknown(_)
        ));
        assert!(matches!(
            events[2].event_type,
            IncidentEventType::AIAnalysisComplete
        ));
    }

    #[test]
    fn test_decode_events_handles_non_array_and_null() {
        assert!(decode_events("org", "inc", &serde_json::Value::Null).is_empty());
        assert!(decode_events("org", "inc", &serde_json::json!({"a": 1})).is_empty());
    }

    /// A malformed *known* event is retained (not dropped), which is the whole point of the
    /// Unknown catch-all — losing it would reintroduce the data loss this guards against.
    #[test]
    fn test_decode_events_retains_malformed_known_event() {
        let raw = serde_json::json!([
            {"timestamp": 1, "type": "Created"},
            {"timestamp": 2, "type": "Comment", "data": {"user_id": 5}},
        ]);

        let events = decode_events("org", "inc", &raw);
        assert_eq!(events.len(), 2, "malformed known event must be retained");

        let IncidentEventType::Unknown(inner) = &events[1].event_type else {
            panic!("expected malformed known event to land in Unknown");
        };
        assert!(
            IncidentEventType::is_known_tag(inner),
            "should be classified as schema drift, not forward-compat"
        );
    }

    #[test]
    fn test_reconstructed_events_are_ordered_and_use_historical_timestamps() {
        // Alerts deliberately out of order to prove sorting.
        let alerts = vec![
            ("a2".to_string(), "Disk full".to_string(), 300),
            ("a1".to_string(), "CPU high".to_string(), 200),
        ];

        let events = build_reconstructed_events(100, Some((400, None)), alerts.into_iter());

        let timestamps: Vec<i64> = events.iter().map(|e| e.timestamp).collect();
        assert_eq!(
            timestamps,
            vec![100, 200, 300, 400],
            "events must be chronological using stored timestamps, not now()"
        );
        assert!(matches!(events[0].event_type, IncidentEventType::Created));
        assert!(matches!(
            events[3].event_type,
            IncidentEventType::Resolved { user_id: None }
        ));

        match &events[1].event_type {
            IncidentEventType::Alert {
                alert_id,
                count,
                first_at,
                last_at,
                ..
            } => {
                assert_eq!(alert_id, "a1");
                assert_eq!(*count, 1);
                assert_eq!((*first_at, *last_at), (200, 200));
            }
            other => panic!("expected Alert, got {other:?}"),
        }
    }

    /// `Created` must open the timeline even when an alert fired before the incident row
    /// was written. Uses the real timestamps from a local incident, where the triggering
    /// alert preceded `created_at` by ~464ms; sorting purely by timestamp put `Alert` first.
    #[test]
    fn test_reconstructed_created_is_first_despite_earlier_alert() {
        let created_at = 1_784_737_392_883_003;
        let alerts = vec![
            (
                "a1".to_string(),
                "payment_gateway_errors".to_string(),
                1_784_737_392_419_417, // fired BEFORE created_at
            ),
            (
                "a1".to_string(),
                "payment_gateway_errors".to_string(),
                1_784_737_442_419_840,
            ),
        ];

        let events = build_reconstructed_events(
            created_at,
            Some((1_785_020_636_649_257, None)),
            alerts.into_iter(),
        );

        assert!(
            matches!(events[0].event_type, IncidentEventType::Created),
            "Created must anchor the timeline, got {:?}",
            events[0].event_type
        );
        assert!(matches!(
            events.last().unwrap().event_type,
            IncidentEventType::Resolved { .. }
        ));
        // Everything after Created stays in true chronological order.
        let rest: Vec<i64> = events[1..].iter().map(|e| e.timestamp).collect();
        let mut sorted = rest.clone();
        sorted.sort();
        assert_eq!(rest, sorted, "non-Created events must remain chronological");
    }

    #[test]
    fn test_reconstructed_events_unresolved_incident_has_no_resolved_event() {
        let events = build_reconstructed_events(100, None, std::iter::empty());
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0].event_type, IncidentEventType::Created));
    }

    /// The rebuilt timeline must survive the same encode/decode cycle as a real one.
    #[test]
    fn test_reconstructed_events_roundtrip() {
        let events = build_reconstructed_events(
            10,
            Some((30, None)),
            vec![("a1".to_string(), "n".to_string(), 20)].into_iter(),
        );
        let encoded = encode_events(&events).unwrap();
        let decoded = decode_events("org", "inc", &encoded);
        assert_eq!(decoded.len(), 3);
        assert!(
            !decoded
                .iter()
                .any(|e| matches!(e.event_type, IncidentEventType::Unknown(_))),
            "reconstructed events must decode as known types"
        );
    }

    /// `append` and `append_in` write identical rows, with and without an existing row.
    #[tokio::test]
    async fn append_and_append_in_write_identical_rows() {
        use sea_orm::{ConnectOptions, Database, Schema};

        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        db.execute(
            backend.build(&Schema::new(backend).create_table_from_entity(incident_events::Entity)),
        )
        .await
        .unwrap();

        let seed = encode_events(&[IncidentEvent::created()]).unwrap();
        let read = |incident_id: &'static str| {
            let db = &db;
            async move {
                incident_events::Entity::find()
                    .filter(incident_events::Column::OrgId.eq("acme"))
                    .filter(incident_events::Column::IncidentId.eq(incident_id))
                    .one(db)
                    .await
                    .unwrap()
                    .unwrap()
                    .events
            }
        };
        for incident_id in ["inc-a", "inc-b"] {
            incident_events::ActiveModel {
                org_id: Set("acme".to_string()),
                incident_id: Set(incident_id.to_string()),
                events: Set(seed.clone()),
                seq: Set(1),
            }
            .insert(&db)
            .await
            .unwrap();
        }

        let event = IncidentEvent::ai_analysis_begin();
        for (via_append, via_append_in) in [("inc-a", "inc-b"), ("new-a", "new-b")] {
            append_with(&db, "acme", via_append, event.clone())
                .await
                .unwrap();
            let txn = db.begin().await.unwrap();
            append_in(&txn, "acme", via_append_in, event.clone())
                .await
                .unwrap();
            txn.commit().await.unwrap();
            assert_eq!(read(via_append).await, read(via_append_in).await);
        }
        assert_eq!(
            decode_events("acme", "inc-a", &read("inc-a").await).len(),
            2
        );
        assert_eq!(
            decode_events("acme", "new-a", &read("new-a").await).len(),
            1
        );
    }

    async fn row(db: &sea_orm::DatabaseConnection, incident_id: &str) -> incident_events::Model {
        incident_events::Entity::find()
            .filter(incident_events::Column::IncidentId.eq(incident_id))
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    fn event_seqs(model: &incident_events::Model) -> Vec<i64> {
        decode_events(&model.org_id, &model.incident_id, &model.events)
            .iter()
            .map(|e| e.seq)
            .collect()
    }

    fn comment(n: usize) -> IncidentEvent {
        IncidentEvent::comment("someone@example.com", format!("note {n}"))
    }

    /// Every write raises `seq` once, so N appends end at N with N distinct event stamps.
    #[tokio::test]
    async fn seq_rises_once_per_append_and_stamps_each_event() {
        for (backend, db, schema) in event_backends().await {
            // SQLite has one writer, so both serial orders stand in for the race.
            for order in [[0, 1], [1, 0]] {
                let incident_id = format!("serial-{}", order[0]);
                for n in order {
                    append_with(&db, "demo-org", &incident_id, comment(n))
                        .await
                        .unwrap();
                }
                let model = row(&db, &incident_id).await;
                assert_eq!(model.seq, 2, "{backend}");
                assert_eq!(event_seqs(&model), vec![1, 2], "{backend}");
                assert_eq!(seq_with(&db, "demo-org", &incident_id).await.unwrap(), 2);
                let (events, page_seq) =
                    get_page_with(&db, "demo-org", &incident_id).await.unwrap();
                assert_eq!((events.len(), page_seq), (2, 2), "{backend}");
            }
            assert_eq!(seq_with(&db, "demo-org", "missing").await.unwrap(), 0);
            drop_event_schema(schema).await;
        }
    }

    /// All appenders meet before the row read, so they contend on the row lock at once.
    #[tokio::test]
    async fn concurrent_appends_get_distinct_seqs_on_postgres() {
        const WRITERS: usize = 4;
        let Some(schema) = event_schema().await else {
            println!("postgres arm skipped: ZO_META_POSTGRES_DSN is unset");
            return;
        };
        let db = schema_connection(&schema).await;
        let backend = db.get_database_backend();
        let table = sea_orm::Schema::new(backend).create_table_from_entity(incident_events::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        open_empty_in(&db, "demo-org", "incident").await.unwrap();
        let race = crate::race::Barriers::new();
        race.arm("incident_events.before_row_read", WRITERS);
        let mut writers = Vec::new();
        for n in 0..WRITERS {
            let (race, conn) = (race.clone(), schema_connection(&schema).await);
            writers.push(tokio::spawn(async move {
                race.run(append_with(&conn, "demo-org", "incident", comment(n)))
                    .await
            }));
        }
        for writer in writers {
            writer.await.unwrap().unwrap();
        }
        race.assert_all_met();
        let model = row(&db, "incident").await;
        assert_eq!(
            model.seq,
            1 + WRITERS as i64,
            "the empty row's insert, then each append"
        );
        let mut seqs = event_seqs(&model);
        seqs.sort_unstable();
        assert_eq!(seqs, (2..=1 + WRITERS as i64).collect::<Vec<_>>());
        drop_event_schema(Some(schema)).await;
    }

    #[tokio::test]
    async fn init_forget_and_reconstruct_raise_seq_and_a_deduped_resolution_does_not() {
        for (backend, db, schema) in event_backends().await {
            let b = db.get_database_backend();
            for stmt in [
                sea_orm::Schema::new(b)
                    .create_table_from_entity(crate::table::entity::alert_incidents::Entity),
                sea_orm::Schema::new(b)
                    .create_table_from_entity(crate::table::entity::alert_incident_alerts::Entity),
            ] {
                db.execute(b.build(&stmt)).await.unwrap();
            }

            init_with(&db, "demo-org", "inc").await.unwrap();
            let model = row(&db, "inc").await;
            assert_eq!((model.seq, event_seqs(&model)), (1, vec![1]), "{backend}");

            let txn = db.begin().await.unwrap();
            append_in(
                &txn,
                "demo-org",
                "inc",
                IncidentEvent::alert("a1", "cpu", 5),
            )
            .await
            .unwrap();
            forget_alert_in(&txn, "demo-org", "inc", "a1")
                .await
                .unwrap();
            txn.commit().await.unwrap();
            let model = row(&db, "inc").await;
            assert_eq!((model.seq, event_seqs(&model)), (3, vec![1]), "{backend}");

            let txn = db.begin().await.unwrap();
            forget_alert_in(&txn, "demo-org", "inc", "a1")
                .await
                .unwrap();
            append_once_in(&txn, "demo-org", "inc", resolution_at(100), true)
                .await
                .unwrap();
            append_once_in(&txn, "demo-org", "inc", resolution_at(100), true)
                .await
                .unwrap();
            txn.commit().await.unwrap();
            assert_eq!(
                row(&db, "inc").await.seq,
                4,
                "{backend}: a forget that removes nothing and the resolution's retry write nothing"
            );

            seed_incident(&db, "emptied").await;
            open_empty_in(&db, "demo-org", "emptied").await.unwrap();
            assert_eq!(
                reconstruct_if_empty_with(&db, "demo-org", "emptied")
                    .await
                    .unwrap(),
                Some(1),
                "{backend}"
            );
            let model = row(&db, "emptied").await;
            assert_eq!((model.seq, event_seqs(&model)), (2, vec![2]), "{backend}");
            drop_event_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn a_reconstructed_resolution_keeps_its_recorded_resolver() {
        for (backend, db, schema) in event_backends().await {
            let b = db.get_database_backend();
            for stmt in [
                sea_orm::Schema::new(b)
                    .create_table_from_entity(crate::table::entity::alert_incidents::Entity),
                sea_orm::Schema::new(b)
                    .create_table_from_entity(crate::table::entity::alert_incident_alerts::Entity),
            ] {
                db.execute(b.build(&stmt)).await.unwrap();
            }
            let actor = "ana@acme.io";
            seed_incident(&db, "emptied").await;
            crate::table::alert_incidents::update_status_by_with(
                &db,
                "demo-org",
                "emptied",
                "resolved",
                Some(actor),
            )
            .await
            .unwrap();
            open_empty_in(&db, "demo-org", "emptied").await.unwrap();

            reconstruct_if_empty_with(&db, "demo-org", "emptied")
                .await
                .unwrap();
            let events = get_with(&db, "demo-org", "emptied").await.unwrap();
            drop_event_schema(schema).await;
            assert!(
                events.iter().any(|event| matches!(
                    &event.event_type,
                    IncidentEventType::Resolved { user_id } if user_id.as_deref() == Some(actor)
                )),
                "{backend}: {events:?}"
            );
        }
    }

    /// A `since` reader holding the first firing's seq must see the repeat's count bump.
    #[tokio::test]
    async fn a_repeat_firing_count_bump_is_returned_by_since() {
        for (backend, db, schema) in event_backends().await {
            let b = db.get_database_backend();
            for stmt in [
                sea_orm::Schema::new(b)
                    .create_table_from_entity(crate::table::entity::alert_incidents::Entity),
                sea_orm::Schema::new(b)
                    .create_table_from_entity(crate::table::entity::alert_incident_alerts::Entity),
            ] {
                db.execute(b.build(&stmt)).await.unwrap();
            }
            seed_incident(&db, "inc").await;
            crate::table::entity::alert_incident_alerts::ActiveModel {
                incident_id: Set("inc".to_string()),
                alert_id: Set("a1".to_string()),
                alert_fired_at: Set(5),
                alert_name: Set("cpu".to_string()),
                alert_kind: Set("scheduled".to_string()),
                correlation_reason: Set(None),
                created_at: Set(5),
                resolved_at: Set(None),
                labels: Set(None),
                severity: Set(None),
            }
            .insert(&db)
            .await
            .unwrap();
            init_with(&db, "demo-org", "inc").await.unwrap();
            record_alert_with(&db, "demo-org", "inc", "a1", "cpu", 5)
                .await
                .unwrap();
            let since = row(&db, "inc").await.seq;
            record_alert_with(&db, "demo-org", "inc", "a1", "cpu", 9)
                .await
                .unwrap();
            let model = row(&db, "inc").await;
            let mut events = decode_events("demo-org", "inc", &model.events);
            assert_eq!(
                events.len(),
                2,
                "{backend}: the repeat counts into one entry"
            );
            events.retain(|event| event.seq > since);
            assert_eq!(
                events.len(),
                1,
                "{backend}: the bumped entry is newer than since"
            );
            assert!(
                matches!(
                    events[0].event_type,
                    IncidentEventType::Alert { count: 2, .. }
                ),
                "{backend}"
            );
            drop_event_schema(schema).await;
        }
    }

    async fn seed_incident(db: &sea_orm::DatabaseConnection, id: &str) {
        crate::table::entity::alert_incidents::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("demo-org".to_string()),
            status: Set("open".to_string()),
            severity: Set("P2".to_string()),
            group_values: Set(serde_json::json!({})),
            key_type: Set("service".to_string()),
            topology_context: Set(None),
            first_alert_at: Set(10),
            last_alert_at: Set(10),
            resolved_at: Set(None),
            alert_count: Set(0),
            title: Set(None),
            assigned_to: Set(None),
            acknowledged_by: Set(None),
            acknowledged_at: Set(None),
            created_at: Set(10),
            updated_at: Set(10),
            muted_by_downtime_id: Set(None),
            rca_run_id: Set(None),
            rca_state: Set(None),
            rca_started_at: Set(None),
            rca_updated_at: Set(None),
            rca_outcome: Set(None),
            rca_confidence: Set(None),
            rca_summary: Set(None),
            rca_off_reason: Set(None),
            security_case: Set(false),
            historical: Set(false),
            last_detection_at: Set(None),
            ..Default::default()
        }
        .insert(db)
        .await
        .unwrap();
    }
}
