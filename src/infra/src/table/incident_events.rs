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

/// Initialize events row for a new incident with a Created event
pub async fn init(org_id: &str, incident_id: &str) -> Result<(), sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let event = IncidentEvent::created();
    let events_json = serde_json::to_value(vec![event]).unwrap_or_default();

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
        Some(model) => {
            let events: Vec<IncidentEvent> =
                serde_json::from_value(model.events.clone()).unwrap_or_default();
            Ok(events)
        }
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
            let mut events: Vec<IncidentEvent> =
                serde_json::from_value(model.events.clone()).unwrap_or_default();
            events.push(event);

            let mut active: incident_events::ActiveModel = model.into();
            active.events = Set(serde_json::to_value(events).unwrap_or_default());
            active.update(&txn).await?;
        }
        None => {
            // Row doesn't exist yet (incident created before events table)
            let events_json = serde_json::to_value(vec![event]).unwrap_or_default();
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
/// If an Alert event with the same alert_id exists, increment count and update last_at.
/// Otherwise append a new Alert event.
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
            let mut events: Vec<IncidentEvent> =
                serde_json::from_value(model.events.clone()).unwrap_or_default();

            // Compact only if the last event is an Alert for the same alert_id.
            // Otherwise append a new event (preserves interleaving: A x5, B x3, A x2).
            let compacted = events
                .last_mut()
                .is_some_and(|e| e.increment_alert(alert_id, triggered_at));

            if !compacted {
                events.push(IncidentEvent::alert(alert_id, alert_name, triggered_at));
            }

            let mut active: incident_events::ActiveModel = model.into();
            active.events = Set(serde_json::to_value(events).unwrap_or_default());
            active.update(&txn).await?;
        }
        None => {
            // Row doesn't exist yet
            let events = vec![IncidentEvent::alert(alert_id, alert_name, triggered_at)];
            let model = incident_events::ActiveModel {
                org_id: Set(org_id.to_string()),
                incident_id: Set(incident_id.to_string()),
                events: Set(serde_json::to_value(events).unwrap_or_default()),
            };
            model.insert(&txn).await?;
        }
    }

    txn.commit().await?;
    Ok(())
}
