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

//! D11 for SysRcaAgent: bind each read to the run's stored subject and keep case history out.

use axum::http::HeaderMap;
use config::meta::{
    alerts::{
        incidents::{IncidentEvent, IncidentEventType},
        rca_runs::RunSubjectType,
    },
    user::{SRE_AGENT_EMAIL_PREFIX, SRE_AGENT_EMAIL_SUFFIX},
};

/// The header an RCA run's agent sends on every first-party read.
pub const ASSISTANT_SESSION_HEADER: &str = "x-o2-assistant-session-id";

/// Who is reading, for the D11 history and target guards.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RcaCaller {
    /// Not SysRcaAgent: the ordinary ACL decides.
    Human,
    /// SysRcaAgent bound to exactly one live run of the org.
    Bound {
        subject_type: RunSubjectType,
        subject_id: String,
        /// The run's incident: the subject itself, or an alert run's linked incident.
        incident_id: Option<String>,
        /// False for a security-case subject or one whose classification failed.
        history_allowed: bool,
    },
    /// SysRcaAgent with a missing, unknown, foreign-org or ambiguous session: fails closed.
    Unbound,
}

impl RcaCaller {
    pub fn is_rca(&self) -> bool {
        !matches!(self, Self::Human)
    }

    /// Past incidents and past runs: only a bound run whose subject is not a case.
    pub fn history_allowed(&self) -> bool {
        match self {
            Self::Human => true,
            Self::Bound {
                history_allowed, ..
            } => *history_allowed,
            Self::Unbound => false,
        }
    }

    /// The incident this run investigates, when it has one.
    pub fn own_incident(&self) -> Option<&str> {
        match self {
            Self::Bound { incident_id, .. } => incident_id.as_deref(),
            _ => None,
        }
    }

    /// The case timeline is projected for an RCA caller that may not read history.
    pub fn projects_timeline(&self) -> bool {
        self.is_rca() && !self.history_allowed()
    }
}

/// SysRcaAgent of this org, by its service-account email.
pub fn is_sys_rca_agent(org_id: &str, user_id: &str) -> bool {
    let email = format!("{SRE_AGENT_EMAIL_PREFIX}{org_id}{SRE_AGENT_EMAIL_SUFFIX}");
    user_id.eq_ignore_ascii_case(&email)
}

/// Resolves the caller; SysRcaAgent's binding is the stored run, never a claimed argument.
pub async fn rca_caller(org_id: &str, user_id: &str, headers: &HeaderMap) -> RcaCaller {
    if !is_sys_rca_agent(org_id, user_id) {
        return RcaCaller::Human;
    }
    let Some(session_id) = headers
        .get(ASSISTANT_SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
    else {
        return RcaCaller::Unbound;
    };
    let run = match infra::table::rca_runs::live_run_for_session(org_id, session_id).await {
        Ok(Some(run)) => run,
        Ok(None) => return RcaCaller::Unbound,
        Err(e) => {
            log::warn!("[RCA_SCOPE] cannot resolve session {session_id} of {org_id}: {e}");
            return RcaCaller::Unbound;
        }
    };
    let item = infra::table::rca_runs::to_item(&run);
    let incident_id = match item.subject_type {
        RunSubjectType::Incident => Some(run.subject_id.clone()),
        RunSubjectType::Alert => run.incident_id.clone(),
    };
    let history_allowed = match incident_id.as_deref() {
        Some(id) => openobserve_core::alerts::incidents::incident_history_allowed(org_id, id).await,
        None => true,
    };
    RcaCaller::Bound {
        subject_type: item.subject_type,
        subject_id: run.subject_id,
        incident_id,
        history_allowed,
    }
}

/// Detail and events of `target`: a case or unbound run reads only its own incident, and a
/// normal run reads its own or a known non-case incident (D'4, F-02).
pub async fn may_read_incident(org_id: &str, caller: &RcaCaller, target: &str) -> bool {
    match caller {
        RcaCaller::Human => true,
        RcaCaller::Unbound => false,
        RcaCaller::Bound {
            incident_id,
            history_allowed,
            ..
        } => {
            if incident_id.as_deref() == Some(target) {
                return true;
            }
            *history_allowed
                && openobserve_core::alerts::incidents::incident_history_allowed(org_id, target)
                    .await
        }
    }
}

/// Past runs of `target`: the caller may read history and the target is a known non-case.
pub async fn may_read_run_history(org_id: &str, caller: &RcaCaller, target: &str) -> bool {
    match caller {
        RcaCaller::Human => true,
        _ => {
            caller.history_allowed()
                && openobserve_core::alerts::incidents::incident_history_allowed(org_id, target)
                    .await
        }
    }
}

/// Alert chronology only: every RCA, comment, verdict, split and unknown kind is dropped.
pub fn is_chronology(event: &IncidentEvent) -> bool {
    matches!(
        event.event_type,
        IncidentEventType::Created
            | IncidentEventType::Alert { .. }
            | IncidentEventType::SeverityUpgrade { .. }
            | IncidentEventType::SeverityOverride { .. }
            | IncidentEventType::Acknowledged { .. }
            | IncidentEventType::Resolved { .. }
            | IncidentEventType::Reopened { .. }
            | IncidentEventType::AckEndedByPageResolve { .. }
            | IncidentEventType::DimensionsUpgraded { .. }
            | IncidentEventType::TitleChanged { .. }
            | IncidentEventType::AssignmentChanged { .. }
            | IncidentEventType::AlertsAttached { .. }
            | IncidentEventType::EventAttached { .. }
            | IncidentEventType::DetectionJoined { .. }
    )
}

/// The case timeline a SysRcaAgent run may see; applied after reading, before serializing.
pub fn project_timeline(events: Vec<IncidentEvent>) -> Vec<IncidentEvent> {
    events.into_iter().filter(is_chronology).collect()
}

/// Removes the top-level `rca` key of a serialized incident, in place.
pub fn strip_rca(incident: &mut serde_json::Value) {
    if let Some(fields) = incident.as_object_mut() {
        fields.remove("rca");
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn event(value: serde_json::Value) -> IncidentEvent {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn only_the_service_account_of_this_org_is_sys_rca_agent() {
        assert!(is_sys_rca_agent(
            "acme",
            "o2-sre-agent.org-acme@openobserve.internal"
        ));
        assert!(is_sys_rca_agent(
            "AcMe",
            "o2-sre-agent.org-acme@openobserve.internal"
        ));
        assert!(!is_sys_rca_agent(
            "other",
            "o2-sre-agent.org-acme@openobserve.internal"
        ));
        assert!(!is_sys_rca_agent("acme", "alice@example.com"));
    }

    #[test]
    fn a_case_timeline_keeps_chronology_and_drops_prior_analysis() {
        let events = vec![
            event(json!({ "timestamp": 1, "type": "Created" })),
            event(json!({ "timestamp": 2, "type": "Alert", "data": {
                "alert_id": "a", "alert_name": "n", "count": 1, "first_at": 1, "last_at": 2
            }})),
            event(
                json!({ "timestamp": 3, "type": "ai_analysis_needs_input", "data": {
                    "run_id": "r1", "question_id": "q", "need": "n", "question": "which deploy?",
                    "deadline_at": 9
                }}),
            ),
            event(
                json!({ "timestamp": 4, "type": "ai_analysis_failed", "data": {
                    "reason": "x", "trigger_type": "manual", "error_details": "boom"
                }}),
            ),
            event(json!({ "timestamp": 5, "type": "Comment", "data": {
                "user_id": "u", "comment": "earlier analysis said..."
            }})),
            event(json!({ "timestamp": 6, "type": "a_kind_from_a_newer_binary", "data": {} })),
        ];
        let kept = project_timeline(events);
        let kinds: Vec<i64> = kept.iter().map(|e| e.timestamp).collect();
        assert_eq!(kinds, vec![1, 2]);
    }

    #[test]
    fn an_unbound_rca_caller_reads_no_history_and_projects() {
        assert!(!RcaCaller::Unbound.history_allowed());
        assert!(RcaCaller::Unbound.projects_timeline());
        assert!(RcaCaller::Human.history_allowed());
        assert!(!RcaCaller::Human.projects_timeline());
        let case = RcaCaller::Bound {
            subject_type: RunSubjectType::Incident,
            subject_id: "inc_case".to_string(),
            incident_id: Some("inc_case".to_string()),
            history_allowed: false,
        };
        assert!(case.projects_timeline());
        assert_eq!(case.own_incident(), Some("inc_case"));
    }

    #[tokio::test]
    async fn own_target_reads_never_classify_the_target() {
        let case = RcaCaller::Bound {
            subject_type: RunSubjectType::Incident,
            subject_id: "inc_case".to_string(),
            incident_id: Some("inc_case".to_string()),
            history_allowed: false,
        };
        assert!(may_read_incident("acme", &case, "inc_case").await);
        assert!(!may_read_incident("acme", &case, "inc_other").await);
        assert!(!may_read_incident("acme", &RcaCaller::Unbound, "inc_case").await);
        assert!(may_read_incident("acme", &RcaCaller::Human, "inc_case").await);
        assert!(!may_read_run_history("acme", &case, "inc_case").await);
    }

    #[test]
    fn stripping_rca_removes_only_the_top_level_key() {
        let mut incident = json!({ "id": "inc_1", "rca": { "history": [] }, "alerts": [] });
        strip_rca(&mut incident);
        assert_eq!(incident, json!({ "id": "inc_1", "alerts": [] }));
    }
}
