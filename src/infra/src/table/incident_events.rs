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

use config::meta::alerts::incidents::IncidentEvent;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};

use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    table::entity::incident_events,
};

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
    use config::meta::alerts::incidents::IncidentEventType;

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

/// Initialize events row for a new incident with a Created event
pub async fn init(org_id: &str, incident_id: &str) -> Result<(), sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let event = IncidentEvent::created();
    let events_json = encode_events(&[event])?;

    let model = incident_events::ActiveModel {
        org_id: Set(org_id.to_string()),
        incident_id: Set(incident_id.to_string()),
        events: Set(events_json),
    };
    model.insert(db).await?;
    Ok(())
}

/// Get all events for an incident
pub async fn get(org_id: &str, incident_id: &str) -> Result<Vec<IncidentEvent>, sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = incident_events::Entity::find()
        .filter(incident_events::Column::OrgId.eq(org_id))
        .filter(incident_events::Column::IncidentId.eq(incident_id))
        .one(db)
        .await?;

    match row {
        Some(model) => Ok(decode_events(org_id, incident_id, &model.events)),
        None => Ok(vec![]),
    }
}

/// Assemble the reconstructed timeline from authoritative incident/alert columns.
///
/// Split out from [`reconstruct_if_empty`] so the event-shaping rules are testable without
/// a database. Events carry their historical timestamps — deliberately not the
/// `IncidentEvent::*` constructors, which stamp `now()` and would date a rebuilt timeline to
/// the moment of repair.
fn build_reconstructed_events(
    created_at: i64,
    resolved_at: Option<i64>,
    alerts: impl Iterator<Item = (String, String, i64)>,
) -> Vec<IncidentEvent> {
    use config::meta::alerts::incidents::IncidentEventType;

    let mut events = vec![IncidentEvent {
        timestamp: created_at,
        event_type: IncidentEventType::Created,
    }];

    for (alert_id, alert_name, fired_at) in alerts {
        events.push(IncidentEvent {
            timestamp: fired_at,
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

    if let Some(resolved_at) = resolved_at {
        events.push(IncidentEvent {
            timestamp: resolved_at,
            // The acting user is not recorded on the incident row; `None` reads as
            // system-resolved, which is the truthful choice over guessing an identity.
            event_type: IncidentEventType::Resolved { user_id: None },
        });
    }

    events.sort_by_key(|e| e.timestamp);
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
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = db.begin().await?;

    let row = incident_events::Entity::find()
        .filter(incident_events::Column::OrgId.eq(org_id))
        .filter(incident_events::Column::IncidentId.eq(incident_id))
        .one(&txn)
        .await?;

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

    let events = build_reconstructed_events(
        incident.created_at,
        incident.resolved_at,
        alerts
            .into_iter()
            .map(|a| (a.alert_id, a.alert_name, a.alert_fired_at)),
    );
    let events_json = encode_events(&events)?;
    let count = events.len();

    match row {
        Some(model) => {
            let mut active: incident_events::ActiveModel = model.into();
            active.events = Set(events_json);
            active.update(&txn).await?;
        }
        None => {
            let model = incident_events::ActiveModel {
                org_id: Set(org_id.to_string()),
                incident_id: Set(incident_id.to_string()),
                events: Set(events_json),
            };
            model.insert(&txn).await?;
        }
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
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = db.begin().await?;

    let row = incident_events::Entity::find()
        .filter(incident_events::Column::OrgId.eq(org_id))
        .filter(incident_events::Column::IncidentId.eq(incident_id))
        .one(&txn)
        .await?;

    match row {
        Some(model) => {
            let mut events = decode_events(org_id, incident_id, &model.events);
            events.push(event);
            let events_json = encode_events(&events)?;

            let mut active: incident_events::ActiveModel = model.into();
            active.events = Set(events_json);
            active.update(&txn).await?;
        }
        None => {
            // Row doesn't exist yet (incident created before events table)
            let events_json = encode_events(&[event])?;
            let model = incident_events::ActiveModel {
                org_id: Set(org_id.to_string()),
                incident_id: Set(incident_id.to_string()),
                events: Set(events_json),
            };
            model.insert(&txn).await?;
        }
    }

    txn.commit().await?;
    Ok(())
}

/// Record an alert event with compaction.
/// Scans backwards through the trailing block of consecutive Alert events; if a matching
/// alert_id is found within that block, its count is incremented. If a non-Alert event is
/// encountered first (or the list is empty), a new Alert event is appended.
pub async fn record_alert(
    org_id: &str,
    incident_id: &str,
    alert_id: &str,
    alert_name: &str,
    triggered_at: i64,
) -> Result<(), sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = db.begin().await?;

    let row = incident_events::Entity::find()
        .filter(incident_events::Column::OrgId.eq(org_id))
        .filter(incident_events::Column::IncidentId.eq(incident_id))
        .one(&txn)
        .await?;

    match row {
        Some(model) => {
            let mut events = decode_events(org_id, incident_id, &model.events);

            // Scan backwards through the trailing block of Alert events.
            // If a matching alert_id is found within that block, increment it.
            // Stop (and append) as soon as a non-Alert event is encountered.
            let compacted = 'scan: {
                for event in events.iter_mut().rev() {
                    if !event.is_alert() {
                        break 'scan false;
                    }
                    if event.is_alert_for(alert_id) {
                        event.increment_alert(alert_id, triggered_at);
                        break 'scan true;
                    }
                }
                false
            };

            if !compacted {
                events.push(IncidentEvent::alert(alert_id, alert_name, triggered_at));
            }
            let events_json = encode_events(&events)?;

            let mut active: incident_events::ActiveModel = model.into();
            active.events = Set(events_json);
            active.update(&txn).await?;
        }
        None => {
            // Row doesn't exist yet
            let events = vec![IncidentEvent::alert(alert_id, alert_name, triggered_at)];
            let model = incident_events::ActiveModel {
                org_id: Set(org_id.to_string()),
                incident_id: Set(incident_id.to_string()),
                events: Set(encode_events(&events)?),
            };
            model.insert(&txn).await?;
        }
    }

    txn.commit().await?;
    Ok(())
}

/// Deletes all incident event entries belonging to the given org.
pub async fn delete_by_org(org_id: &str) -> Result<(), sea_orm::DbErr> {
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

        let events = build_reconstructed_events(100, Some(400), alerts.into_iter());

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
            Some(30),
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
}
