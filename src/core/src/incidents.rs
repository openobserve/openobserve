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

use std::collections::HashMap;

use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
use db::workflows::WorkflowTriggerType;
use infra::table::workflows::get_all_associations_for_trigger_type;
use serde_json::Value;

use crate::{alerts::incidents::get_incident_with_alerts, workflows::send_workflow_trigger};

async fn get_event_metadata(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<HashMap<String, Value>, anyhow::Error> {
    let incident = get_incident_with_alerts(org_id, incident_id)
        .await?
        .ok_or(anyhow::anyhow!("incident with given id not found"))?;

    let mut metadata: Vec<(&str, Value)> = Vec::new();

    let now = chrono::Utc::now().timestamp_micros();

    metadata.push(("org_id", org_id.into()));
    metadata.push(("incident_id", incident_id.into()));
    metadata.push(("_timestamp", now.into()));
    metadata.push(("created_at", incident.incident.created_at.into()));
    metadata.push(("updated_at", incident.incident.updated_at.into()));
    metadata.push(("first_alert_at", incident.incident.first_alert_at.into()));
    metadata.push(("last_alert_at", incident.incident.last_alert_at.into()));
    metadata.push(("severity", incident.incident.severity.to_string().into()));
    metadata.push(("title", incident.incident.title.unwrap_or_default().into()));
    metadata.push(("status", incident.incident.status.to_string().into()));

    let alert_names: Vec<_> = incident
        .triggers
        .iter()
        .map(|a| a.alert_name.clone())
        .collect();
    let alert_ids: Vec<_> = incident
        .triggers
        .iter()
        .map(|a| a.alert_id.clone())
        .collect();
    metadata.push(("alert_names", alert_names.into()));
    metadata.push(("alert_ids", alert_ids.into()));

    match event.event_type {
        IncidentEventType::Created => {
            metadata.push(("event_type", "created".into()));
        }
        IncidentEventType::Alert {
            alert_id,
            alert_name,
            count,
            first_at,
            last_at,
        } => {
            metadata.push(("event_type", "alert".into()));
            metadata.push(("alert_name", alert_name.into()));
            metadata.push(("alert_id", alert_id.into()));
            metadata.push(("alert_count", count.into()));
            metadata.push(("first_alert_at", first_at.into()));
            metadata.push(("last_alert_at", last_at.into()));
        }
        IncidentEventType::SeverityUpgrade { from, to, reason } => {
            metadata.push(("event_type", "severity_upgrade".into()));
            metadata.push(("old_severity", from.to_string().into()));
            metadata.push(("new_severity", to.to_string().into()));
            metadata.push(("reason", reason.into()));
        }
        IncidentEventType::SeverityOverride { from, to, user_id } => {
            metadata.push(("event_type", "severity_override".into()));
            metadata.push(("old_severity", from.to_string().into()));
            metadata.push(("new_severity", to.to_string().into()));
            metadata.push(("user_id", user_id.into()));
        }

        IncidentEventType::Acknowledged { user_id } => {
            metadata.push(("event_type", "acknowledged".into()));
            metadata.push(("user_id", user_id.into()));
        }

        IncidentEventType::Resolved { user_id } => {
            metadata.push(("event_type", "resolved".into()));
            metadata.push(("user_id", user_id.unwrap_or("system".to_string()).into()));
        }

        IncidentEventType::Reopened { user_id, reason } => {
            metadata.push(("event_type", "reopened".into()));
            metadata.push(("user_id", user_id.into()));
            metadata.push(("reason", reason.into()));
        }

        IncidentEventType::DimensionsUpgraded { from_key, to_key } => {
            metadata.push(("event_type", "dimensions_upgraded".into()));
            metadata.push(("from_key", from_key.into()));
            metadata.push(("to_key", to_key.into()));
        }

        IncidentEventType::TitleChanged { from, to, user_id } => {
            metadata.push(("event_type", "title_changed".into()));
            metadata.push(("old_title", from.into()));
            metadata.push(("new_title", to.into()));
            metadata.push(("user_id", user_id.into()));
        }
        IncidentEventType::AssignmentChanged { from, to } => {
            metadata.push(("event_type", "assignment_changed".into()));
            metadata.push(("from_user", from.unwrap_or("unknown".to_string()).into()));
            metadata.push(("to_user", to.unwrap_or("unknown".to_string()).into()));
        }

        IncidentEventType::Comment { user_id, comment } => {
            metadata.push(("event_type", "comment".into()));
            metadata.push(("user_id", user_id.into()));
            metadata.push(("comment", comment.into()));
        }

        IncidentEventType::AIAnalysisBegin => {
            metadata.push(("event_type", "ai_analysis_begin".into()));
        }

        IncidentEventType::AIAnalysisComplete => {
            metadata.push(("event_type", "ai_analysis_complete".into()));
        }
        IncidentEventType::AIAnalysisFailed {
            reason,
            trigger_type,
            error_details,
        } => {
            metadata.push(("event_type", "ai_analysis_failed".into()));
            metadata.push(("reason", reason.into()));
            metadata.push(("analysis_trigger_tpe", trigger_type.to_string().into()));
            metadata.push(("error_details", error_details.unwrap_or_default().into()));
        }
    }

    let ret: HashMap<_, _> = metadata
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();

    Ok(ret)
}

pub async fn append_event(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<(), anyhow::Error> {
    infra::table::incident_events::append(org_id, incident_id, event.clone()).await?;

    let workflows = match get_all_associations_for_trigger_type(
        org_id,
        &WorkflowTriggerType::IncidentEvent.to_string(),
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!("error getting incident event workflows for {org_id}/{incident_id} : {e}");
            return Ok(());
        }
    };

    let metadata = match get_event_metadata(org_id, incident_id, event).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error getting incident event workflows for {org_id}/{incident_id} : {e}");
            return Ok(());
        }
    };

    for workflow in workflows {
        let trace_id = config::ider::generate_trace_id();
        log::info!(
            "associating trace id {trace_id} with workflow {} for incident {incident_id} event trigger",
            workflow.workflow_id
        );
        send_workflow_trigger(
            &trace_id,
            org_id,
            incident_id.to_string(),
            WorkflowTriggerType::IncidentEvent,
            &workflow.workflow_id,
            metadata.clone(),
            &[],
        )
        .await?;
    }

    Ok(())
}

// this fn is basically a wrapper over the above with types changed
// the ent streaming analyze fn needs to go through it and the types
// make it so that we cannot have params which are &refs , hence
// a thin wrapper which takes params by ownership and calls the above.
// if found a better way remove this completely.
pub async fn append_event_send(
    org_id: String,
    incident_id: String,
    event: IncidentEvent,
) -> Result<(), anyhow::Error> {
    append_event(&org_id, &incident_id, event).await?;
    Ok(())
}
