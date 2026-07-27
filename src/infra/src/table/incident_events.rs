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
    for item in items {
        match serde_json::from_value::<IncidentEvent>(item.clone()) {
            Ok(event) => events.push(event),
            Err(e) => {
                dropped += 1;
                log::error!(
                    "[INCIDENTS] skipping undecodable event for {org_id}/{incident_id}: {e}"
                );
            }
        }
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
