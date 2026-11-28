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
use infra::table::{
    incident_events::{self, ReopenEffect},
    workflows::get_all_associations_for_trigger_type,
};
use serde_json::Value;

use crate::{
    alerts::incidents::get_incident_with_triggers,
    workflows::{TriggerRequest, send_member_workflow_trigger},
};

async fn get_event_metadata(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<HashMap<String, Value>, anyhow::Error> {
    let incident = get_incident_with_triggers(org_id, incident_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("incident with given id not found"))?;

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
        IncidentEventType::SeverityUpgrade {
            from, to, reason, ..
        } => {
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
            metadata.push((
                "user_id",
                user_id.unwrap_or_else(|| "system".to_string()).into(),
            ));
        }

        IncidentEventType::Reopened {
            user_id,
            reason,
            transition_id,
        } => {
            metadata.push(("event_type", "reopened".into()));
            if let Some(transition_id) = transition_id {
                metadata.push(("transition_id", transition_id.into()));
            }
            metadata.push(("user_id", user_id.into()));
            metadata.push(("reason", reason.into()));
        }

        IncidentEventType::AckEndedByPageResolve { user_id } => {
            metadata.push(("event_type", "ack_ended_by_page_resolve".into()));
            metadata.push(("user_id", user_id.into()));
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
        IncidentEventType::AssignmentChanged {
            from,
            to,
            user_id,
            role,
            via,
        } => {
            let event_type = assignment_event_type(role.as_deref());
            metadata.push(("event_type", event_type.into()));
            if let Some(user_id) = user_id {
                metadata.push(("user_id", user_id.into()));
            }
            if let Some(role) = role {
                metadata.push(("role", role.into()));
            }
            if let Some(via) = via {
                metadata.push(("via", via.into()));
            }
            metadata.push((
                "from_user",
                from.unwrap_or_else(|| "unknown".to_string()).into(),
            ));
            metadata.push((
                "to_user",
                to.unwrap_or_else(|| "unknown".to_string()).into(),
            ));
        }

        IncidentEventType::OwnerTeamChanged { from, to, user_id } => {
            metadata.push(("event_type", "owner_team_changed".into()));
            if let Some(user_id) = user_id {
                metadata.push(("user_id", user_id.into()));
            }
            metadata.push(("from_team", from.unwrap_or_default().into()));
            metadata.push(("to_team", to.unwrap_or_default().into()));
        }

        IncidentEventType::ImpactWindowChanged {
            from_start,
            from_end,
            to_start,
            to_end,
            user_id,
        } => {
            metadata.push(("event_type", "impact_window_changed".into()));
            if let Some(user_id) = user_id {
                metadata.push(("user_id", user_id.into()));
            }
            for (key, at) in [
                ("from_start", from_start),
                ("from_end", from_end),
                ("to_start", to_start),
                ("to_end", to_end),
            ] {
                if let Some(at) = at {
                    metadata.push((key, at.into()));
                }
            }
        }

        IncidentEventType::Verdict {
            user_id,
            verdict,
            reason,
        } => {
            metadata.push(("event_type", "verdict".into()));
            metadata.push(("user_id", user_id.into()));
            metadata.push(("verdict", verdict.as_str().into()));
            metadata.push(("reason", reason.into()));
        }

        IncidentEventType::AlertsAttached {
            user_id,
            alert_names,
            ..
        } => {
            metadata.push(("event_type", "alerts_attached".into()));
            metadata.push(("user_id", user_id.into()));
            metadata.push(("alert_names", alert_names.join(", ").into()));
        }

        IncidentEventType::EventAttached {
            user_id,
            stream,
            event_at,
        } => {
            metadata.push(("event_type", "event_attached".into()));
            metadata.push(("user_id", user_id.into()));
            metadata.push(("stream", stream.into()));
            metadata.push(("event_at", event_at.to_string().into()));
        }

        IncidentEventType::DetectionJoined {
            alert_id,
            alert_name,
            rule,
            level,
            ..
        } => {
            metadata.push(("event_type", "detection_joined".into()));
            metadata.push(("alert_id", alert_id.into()));
            metadata.push(("alert_name", alert_name.into()));
            metadata.push(("rule", rule.into()));
            metadata.push(("level", level.into()));
        }

        IncidentEventType::Comment { user_id, comment } => {
            metadata.push(("event_type", "comment".into()));
            metadata.push(("user_id", user_id.into()));
            metadata.push(("comment", comment.into()));
        }

        IncidentEventType::SplitFrom {
            from_incident_id,
            alert_id,
            alert_name,
            inferred_by,
            reason,
            ..
        } => {
            metadata.push(("event_type", "split_from".into()));
            metadata.push(("from_incident_id", from_incident_id.into()));
            metadata.push(("alert_id", alert_id.into()));
            metadata.push(("alert_name", alert_name.into()));
            metadata.push(("inferred_by", inferred_by.as_str().to_string().into()));
            metadata.push(("reason", reason.into()));
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
            error_code,
        } => {
            metadata.push(("event_type", "ai_analysis_failed".into()));
            metadata.push(("reason", reason.into()));
            metadata.push(("analysis_trigger_type", trigger_type.to_string().into()));
            metadata.push(("error_details", error_details.unwrap_or_default().into()));
            if let Some(code) = error_code {
                metadata.push(("error_code", code.into()));
            }
        }
        IncidentEventType::AIAnalysisCancelled { user_id } => {
            metadata.push(("event_type", "ai_analysis_cancelled".into()));
            metadata.push(("user_id", user_id.into()));
        }
        IncidentEventType::AiAnalysisSteered {
            run_id,
            steer_id,
            user_id,
            kind,
        } => {
            metadata.push(("event_type", "ai_analysis_steered".into()));
            metadata.push(("run_id", run_id.into()));
            metadata.push(("steer_id", steer_id.into()));
            metadata.push(("user_id", user_id.into()));
            metadata.push(("kind", kind.into()));
        }
        IncidentEventType::AiAnalysisNeedsInput {
            run_id,
            question_id,
            need,
            question,
            deadline_at,
        } => {
            metadata.push(("event_type", "ai_analysis_needs_input".into()));
            metadata.push(("run_id", run_id.into()));
            metadata.push(("question_id", question_id.into()));
            metadata.push(("need", need.into()));
            metadata.push(("question", question.into()));
            metadata.push(("deadline_at", deadline_at.into()));
        }
        IncidentEventType::AnalysisSkipped {
            reason,
            covering_run_id,
            ..
        } => {
            metadata.push(("event_type", "analysis_skipped".into()));
            metadata.push(("reason", reason.as_str().into()));
            metadata.push(("covering_run_id", covering_run_id.into()));
        }
        IncidentEventType::FixApplied {
            transition_id,
            attempt_id,
            kind,
            actor,
            ..
        } => {
            metadata.push(("event_type", "fix_applied".into()));
            metadata.push(("attempt_id", attempt_id.into()));
            metadata.push(("kind", kind.into()));
            metadata.push(("actor", actor.into()));
            if let Some(id) = transition_id {
                metadata.push(("transition_id", id.into()));
            }
        }
        IncidentEventType::FixSuperseded {
            transition_id,
            attempt_id,
            superseded_attempt_id,
        } => {
            metadata.push(("event_type", "fix_superseded".into()));
            metadata.push(("attempt_id", attempt_id.into()));
            metadata.push(("superseded_attempt_id", superseded_attempt_id.into()));
            if let Some(id) = transition_id {
                metadata.push(("transition_id", id.into()));
            }
        }
        IncidentEventType::FixRetracted {
            transition_id,
            attempt_id,
            revived_attempt_id,
        } => {
            metadata.push(("event_type", "fix_retracted".into()));
            metadata.push(("attempt_id", attempt_id.into()));
            if let Some(id) = transition_id {
                metadata.push(("transition_id", id.into()));
            }
            if let Some(id) = revived_attempt_id {
                metadata.push(("revived_attempt_id", id.into()));
            }
        }
        IncidentEventType::FixClaimed {
            transition_id,
            option_key,
            actor,
            expires_at,
            ..
        } => {
            metadata.push(("event_type", "fix_claimed".into()));
            metadata.push(("option_key", option_key.into()));
            metadata.push(("actor", actor.into()));
            metadata.push(("expires_at", expires_at.into()));
            if let Some(id) = transition_id {
                metadata.push(("transition_id", id.into()));
            }
        }
        IncidentEventType::RollbackObserved {
            transition_id,
            attempt_id,
            change_ref,
            at,
        } => {
            metadata.push(("event_type", "rollback_observed".into()));
            metadata.push(("transition_id", transition_id.into()));
            metadata.push(("attempt_id", attempt_id.into()));
            metadata.push(("change_ref", change_ref.into()));
            metadata.push(("at", at.into()));
        }
        IncidentEventType::RecoveryVerified { transition_id } => {
            metadata.push(("event_type", "recovery_verified".into()));
            metadata.push(("transition_id", transition_id.into()));
        }
        IncidentEventType::RecoveryHeld { transition_id } => {
            metadata.push(("event_type", "recovery_held".into()));
            metadata.push(("transition_id", transition_id.into()));
        }
        IncidentEventType::RecoveryRelapsed {
            transition_id,
            check_id,
            phase,
        } => {
            metadata.push(("event_type", "recovery_relapsed".into()));
            metadata.push(("transition_id", transition_id.into()));
            metadata.push(("check_id", check_id.into()));
            metadata.push(("phase", phase.as_str().into()));
            metadata.push(("actor", "system (relapse)".into()));
        }
        IncidentEventType::RecoveryFailed {
            transition_id,
            check_id,
            reason,
            attempt_id,
        } => {
            metadata.push(("event_type", "recovery_failed".into()));
            metadata.push(("transition_id", transition_id.into()));
            metadata.push(("check_id", check_id.into()));
            metadata.push(("reason", reason.as_str().into()));
            if let Some(id) = attempt_id {
                metadata.push(("attempt_id", id.into()));
            }
        }
        IncidentEventType::TeamPaged {
            team_id,
            actor,
            transition_id,
        } => {
            metadata.push(("event_type", "team_paged".into()));
            metadata.push(("team_id", team_id.into()));
            metadata.push(("actor", actor.into()));
            metadata.push(("transition_id", transition_id.into()));
        }
        IncidentEventType::CauseReviewed {
            cause_class,
            cause_text,
            actor,
            transition_id,
        } => {
            metadata.push(("event_type", "cause_reviewed".into()));
            metadata.push(("cause_class", cause_class.as_str().into()));
            metadata.push(("cause_text", cause_text.into()));
            metadata.push(("actor", actor.into()));
            metadata.push(("transition_id", transition_id.into()));
        }
        IncidentEventType::FeedbackGiven {
            run_id,
            target_kind,
            target_id,
            verdict,
            actor,
        } => {
            metadata.push(("event_type", "feedback_given".into()));
            metadata.push(("run_id", run_id.into()));
            metadata.push(("target_kind", target_kind.into()));
            metadata.push(("target_id", target_id.into()));
            metadata.push(("verdict", verdict.into()));
            metadata.push(("actor", actor.into()));
        }
        IncidentEventType::ResolutionRecorded {
            transition_id,
            actor,
            details,
        } => {
            metadata.push(("event_type", "resolution_recorded".into()));
            metadata.push(("transition_id", transition_id.into()));
            metadata.push(("actor", actor.into()));
            if let Some(cause) = details.resolution_cause {
                metadata.push(("resolution_cause", cause.as_str().into()));
            }
            if let Some(note) = details.resolution_note {
                metadata.push(("resolution_note", note.into()));
            }
            if let Some(impact) = details.customer_impact {
                metadata.push(("customer_impact", impact.as_str().into()));
            }
        }
        IncidentEventType::RecoveryConditionChanged {
            check_id,
            actor,
            transition_id,
            ..
        } => {
            metadata.push(("event_type", "recovery_condition_changed".into()));
            metadata.push(("check_id", check_id.into()));
            metadata.push(("actor", actor.into()));
            metadata.push(("transition_id", transition_id.into()));
        }
        IncidentEventType::Declared { declared_by } => {
            metadata.push(("event_type", "declared".into()));
            metadata.push(("declared_by", declared_by.into()));
        }
        IncidentEventType::ContextAttached { context_id, kind } => {
            metadata.push(("event_type", "context_attached".into()));
            metadata.push(("context_id", context_id.into()));
            metadata.push(("kind", kind.as_str().into()));
        }
        IncidentEventType::Unknown(value) => {
            metadata.push(("event_type", "unknown".into()));
            metadata.push(("value", value));
        }
    }

    let ret: HashMap<_, _> = metadata
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();

    Ok(ret)
}

/// A comms-owner change is its own event to a workflow, never a change of the lead.
fn assignment_event_type(role: Option<&str>) -> &'static str {
    match role {
        Some(config::meta::alerts::incidents::COMMS_ROLE) => "comms_owner_changed",
        _ => "assignment_changed",
    }
}

// NOTE: This is specifically for sending event trigger without appending event in db
// This should ideally avoided for anything except created and alert events, has its handling for db
// is different than other event types. For anything other than these, we should use the
// append_event fn below
pub async fn send_incident_event_trigger(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<(), anyhow::Error> {
    let member = match &event.event_type {
        IncidentEventType::Alert { alert_id, .. } => Some(alert_id.clone()),
        _ => None,
    };
    send_member_event_trigger(org_id, incident_id, event, member).await
}

/// The event's workflows run only while `member` is still in the incident when they start.
pub async fn send_member_event_trigger(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
    member: Option<String>,
) -> Result<(), anyhow::Error> {
    send_event_workflows(org_id, incident_id, event, member, false).await
}

#[cfg(feature = "enterprise")]
pub(crate) async fn send_rca_event_trigger(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
    fenced: bool,
) -> Result<(), anyhow::Error> {
    send_event_workflows(org_id, incident_id, event, None, fenced).await
}

pub async fn append_event(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
) -> Result<(), anyhow::Error> {
    infra::table::incident_events::append(org_id, incident_id, event.clone()).await?;

    send_incident_event_trigger(org_id, incident_id, event).await?;

    Ok(())
}

pub async fn append_event_send(
    org_id: String,
    incident_id: String,
    event: IncidentEvent,
) -> Result<(), anyhow::Error> {
    append_event(&org_id, &incident_id, event).await?;
    Ok(())
}

async fn send_event_workflows(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
    member: Option<String>,
    fenced: bool,
) -> Result<(), anyhow::Error> {
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

    let transition_id = match &event.event_type {
        IncidentEventType::Reopened { transition_id, .. } => transition_id.clone(),
        _ => None,
    };
    let mut completed = match &transition_id {
        Some(id) => incident_events::completed_reopen_effects(org_id, incident_id, id).await?,
        None => Default::default(),
    };
    let mut metadata = match get_event_metadata(org_id, incident_id, event).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error getting incident event metadata for {org_id}/{incident_id} : {e}");
            return Ok(());
        }
    };
    if fenced {
        metadata.remove("error_details");
    }

    for workflow in workflows {
        let effect = transition_id
            .as_ref()
            .map(|_| ReopenEffect::Workflow(workflow.workflow_id.clone()));
        if effect
            .as_ref()
            .is_some_and(|effect| completed.contains(effect))
        {
            continue;
        }
        let trace_id = config::ider::generate_trace_id();
        log::info!(
            "associating trace id {trace_id} with workflow {} for incident {incident_id} event trigger",
            workflow.workflow_id
        );
        let request = TriggerRequest {
            trace_id: &trace_id,
            org_id,
            source_id: incident_id.to_string(),
            trigger_type: WorkflowTriggerType::IncidentEvent,
            workflow_id: &workflow.workflow_id,
            metadata: metadata.clone(),
            member_alert_id: member.clone(),
        };
        match send_member_workflow_trigger(request, &[]).await {
            Ok(_) => {
                if let (Some(id), Some(effect)) = (&transition_id, effect) {
                    incident_events::complete_reopen_effect(
                        org_id,
                        incident_id,
                        id,
                        effect.clone(),
                    )
                    .await?;
                    completed.insert(effect);
                }
            }
            Err(e) => {
                log::error!(
                    "error sending workflow trigger for {org_id}/{} trace_id {trace_id} incident {incident_id} : {e}",
                    workflow.workflow_id
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_comms_owner_change_is_not_a_lead_assignment() {
        assert_eq!(assignment_event_type(Some("comms")), "comms_owner_changed");
        assert_eq!(assignment_event_type(None), "assignment_changed");
        assert_eq!(assignment_event_type(Some("lead")), "assignment_changed");
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn workflow_metadata_keeps_empty_rca_failure_details() {
        use config::meta::alerts::incidents::AnalysisTriggerType;

        use crate::alerts::rca_runs::tests::{new_incident, s19_meta};

        if !s19_meta().await {
            return;
        }
        let (org, incident) = new_incident(None).await;
        let event =
            IncidentEvent::ai_analysis_failed("Timed out", AnalysisTriggerType::Manual, None);
        let metadata = get_event_metadata(&org, &incident, event).await.unwrap();
        assert_eq!(
            metadata.get("error_details").and_then(Value::as_str),
            Some("")
        );
    }
}
