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
use infra::table::workflows::get_all_associations_for_trigger_type;
use itertools::Itertools;

use crate::{
    alerts::incidents::get_incident_with_alerts,
    workflows::{WorkflowTriggerType, send_workflow_trigger},
};

async fn get_event_metadata(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<HashMap<String, String>, anyhow::Error> {
    let incident = get_incident_with_alerts(org_id, incident_id)
        .await?
        .ok_or(anyhow::anyhow!("incident with given id not found"))?;

    let mut metadata = Vec::new();

    let now = chrono::Utc::now().timestamp_micros();

    metadata.push(("org_id", org_id.to_string()));
    metadata.push(("incident_id", incident_id.to_string()));
    metadata.push(("_timestamp", now.to_string()));
    metadata.push(("created_at", incident.incident.created_at.to_string()));
    metadata.push(("updated_at", incident.incident.updated_at.to_string()));
    metadata.push((
        "first_alert_at",
        incident.incident.first_alert_at.to_string(),
    ));
    metadata.push(("last_alert_at", incident.incident.last_alert_at.to_string()));
    metadata.push(("severity", incident.incident.severity.to_string()));
    metadata.push(("title", incident.incident.title.unwrap_or_default()));
    metadata.push(("status", incident.incident.status.to_string()));

    let alert_names = incident
        .triggers
        .iter()
        .map(|a| a.alert_name.clone())
        .join(",");
    let alert_ids = incident
        .triggers
        .iter()
        .map(|a| a.alert_id.clone())
        .join(",");
    metadata.push(("alert_names", alert_names));
    metadata.push(("alert_ids", alert_ids));

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
            metadata.push(("alert_name", alert_name));
            metadata.push(("alert_id", alert_id));
            metadata.push(("alert_count", count.to_string()));
            metadata.push(("first_alert_at", first_at.to_string()));
            metadata.push(("last_alert_at", last_at.to_string()));
        }
        IncidentEventType::SeverityUpgrade { from, to, reason } => {
            metadata.push(("event_type", "severity_upgrade".into()));
            metadata.push(("old_severity", from.to_string()));
            metadata.push(("new_severity", to.to_string()));
            metadata.push(("reason", reason));
        }
        IncidentEventType::SeverityOverride { from, to, user_id } => {
            metadata.push(("event_type", "severity_override".into()));
            metadata.push(("old_severity", from.to_string()));
            metadata.push(("new_severity", to.to_string()));
            metadata.push(("user_id", user_id));
        }

        IncidentEventType::Acknowledged { user_id } => {
            metadata.push(("event_type", "acknowledged".into()));
            metadata.push(("user_id", user_id));
        }

        IncidentEventType::Resolved { user_id } => {
            metadata.push(("event_type", "resolved".into()));
            metadata.push(("user_id", user_id.unwrap_or("system".to_string())));
        }

        IncidentEventType::Reopened { user_id, reason } => {
            metadata.push(("event_type", "reopened".into()));
            metadata.push(("user_id", user_id));
            metadata.push(("reason", reason));
        }

        IncidentEventType::DimensionsUpgraded { from_key, to_key } => {
            metadata.push(("event_type", "dimensions_upgraded".into()));
            metadata.push(("from_key", from_key));
            metadata.push(("to_key", to_key));
        }

        IncidentEventType::TitleChanged { from, to, user_id } => {
            metadata.push(("event_type", "title_changed".into()));
            metadata.push(("old_title", from));
            metadata.push(("new_title", to));
            metadata.push(("user_id", user_id));
        }
        IncidentEventType::AssignmentChanged { from, to } => {
            metadata.push(("event_type", "assignment_changed".into()));
            metadata.push(("from_user", from.unwrap_or("unknown".to_string())));
            metadata.push(("to_user", to.unwrap_or("unknown".to_string())));
        }

        IncidentEventType::Comment { user_id, comment } => {
            metadata.push(("event_type", "comment".into()));
            metadata.push(("user_id", user_id));
            metadata.push(("comment", comment));
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
            metadata.push(("reason", reason));
            metadata.push(("analysis_trigger_tpe", trigger_type.to_string()));
            metadata.push(("error_details", error_details.unwrap_or_default()));
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
