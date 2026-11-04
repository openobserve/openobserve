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

//! AutoObserve's incident path: the port opens a finding's incident; the list reads it back.

use async_trait::async_trait;
use config::meta::alerts::{incidents::AlertKind, rca_runs::RunSummaryFields};
use infra::table::entity::{alert_incident_alerts, alert_incidents};
use o2_enterprise::enterprise::autoobserve::{
    api::Page,
    contract::ActionRequest,
    paging_enabled_for,
    plugins::stream::{PageSubject, page_subject},
    ports::{ActionRefused, InvestigationPort},
};
use serde::{Deserialize, Serialize};

use crate::alerts::incidents::{
    FINDING_KIND_DIMENSION, FINDING_STREAM_NAME_DIMENSION, FINDING_STREAM_TYPE_DIMENSION,
    FindingIncident, finding_dimensions, incidents_enabled, open_finding_incident,
};

/// Prefixes every finding's trigger id, so it can never equal an alert's id in `alert_id`.
pub const SUBJECT_PREFIX: &str = "autoobserve:";
pub const REFUSED_INCIDENTS_OFF: &str = "incidents are off or not licensed";

/// P6 over main's incident path: the incident's own automatic analysis is the investigation.
pub struct IncidentInvestigation;

#[async_trait]
impl InvestigationPort for IncidentInvestigation {
    async fn start(&self, request: &ActionRequest) -> anyhow::Result<String> {
        refuse_unless(incidents_enabled())?;
        let subject = page_subject(request)
            .ok_or_else(|| anyhow::anyhow!("the finding is not on a stream"))?;
        let finding = finding_incident(&subject, &request.org);
        // The act's timeout drops this future; spawned, the incident work still runs to its end.
        let outcome = tokio::spawn(async move { open_finding_incident(&finding).await }).await??;
        Ok(outcome.incident_id().to_string())
    }
}

/// The body of `GET /api/v2/{org}/autoobserve/incidents`; every key is present, null when unknown.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AutoObserveIncidents {
    pub paging: bool,
    pub has_more: bool,
    pub items: Vec<AutoObserveIncident>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AutoObserveIncident {
    pub finding: FindingView,
    pub incident: IncidentView,
    pub investigation: InvestigationView,
}

/// Kind and stream are null when the incident's group values cannot be read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FindingView {
    pub id: String,
    pub kind: Option<String>,
    pub stream_type: Option<String>,
    pub stream_name: Option<String>,
    pub first_seen_at: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IncidentView {
    pub id: String,
    pub status: String,
    pub severity: String,
    pub title: String,
    pub created_at: i64,
}

/// Mirrors the incident's own `rca_*` columns; `summary` is decoded, never the stored string.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InvestigationView {
    pub run_id: Option<String>,
    pub state: Option<String>,
    pub outcome: Option<String>,
    pub summary: Option<RunSummaryFields>,
    pub not_run_reason: Option<String>,
}

/// The pure half of `start`: the subject the incident path correlates on.
pub fn finding_incident(s: &PageSubject, org: &str) -> FindingIncident {
    FindingIncident {
        org_id: org.to_string(),
        subject_id: format!("{SUBJECT_PREFIX}{}", s.finding_id),
        title: s.title.clone(),
        dimensions: finding_dimensions(&s.decision_kind, &s.stream_type, &s.stream_name),
        triggered_at: s.signal_at,
    }
}

/// The org's AutoObserve incidents, newest first, with whether paging is on for it.
pub async fn list(org: &str, page: Page) -> Result<AutoObserveIncidents, anyhow::Error> {
    let (rows, has_more) = infra::table::alert_incidents::list_by_alert_kind(
        org,
        AlertKind::AutoObserve.as_str(),
        u64::try_from(page.limit)?,
        u64::try_from(page.offset)?,
    )
    .await?;
    Ok(AutoObserveIncidents {
        paging: paging_enabled_for(org),
        has_more,
        items: rows.iter().map(|(i, l)| item_of(i, l)).collect(),
    })
}

/// A refusal of the deployment or licence, which the stream hook writes as a budget row.
pub fn refuse_unless(incidents_on: bool) -> anyhow::Result<()> {
    if incidents_on {
        return Ok(());
    }
    Err(ActionRefused(REFUSED_INCIDENTS_OFF.to_string()).into())
}

pub fn item_of(
    incident: &alert_incidents::Model,
    link: &alert_incident_alerts::Model,
) -> AutoObserveIncident {
    let dim = |k: &str| {
        incident
            .group_values
            .get(k)
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };
    let id = link.alert_id.strip_prefix(SUBJECT_PREFIX);
    AutoObserveIncident {
        finding: FindingView {
            id: id.unwrap_or(&link.alert_id).to_string(),
            kind: dim(FINDING_KIND_DIMENSION),
            stream_type: dim(FINDING_STREAM_TYPE_DIMENSION),
            stream_name: dim(FINDING_STREAM_NAME_DIMENSION),
            first_seen_at: link.alert_fired_at,
        },
        incident: IncidentView {
            id: incident.id.clone(),
            status: incident.status.clone(),
            severity: incident.severity.clone(),
            title: incident
                .title
                .clone()
                .unwrap_or_else(|| link.alert_name.clone()),
            created_at: incident.created_at,
        },
        investigation: InvestigationView {
            run_id: incident.rca_run_id.clone(),
            state: incident.rca_state.clone(),
            outcome: incident.rca_outcome.clone(),
            summary: incident
                .rca_summary
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok()),
            not_run_reason: incident.rca_off_reason.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::autoobserve::{
        contract::ActionKind,
        names::{decision_kinds, kinds},
        plugins::stream::page_title,
    };

    use super::*;

    fn subject() -> PageSubject {
        let request = ActionRequest {
            org: "demo-org".into(),
            entity_type: kinds::STREAM.into(),
            entity_id: "logs/checkout".into(),
            decision_kind: decision_kinds::STREAM_SILENCE.into(),
            group_key: String::new(),
            action: ActionKind::Investigate,
            signal_at: 1_762_300_000_000_000,
        };
        page_subject(&request).unwrap()
    }

    fn incident(group_values: serde_json::Value) -> alert_incidents::Model {
        alert_incidents::Model {
            id: "inc-1".into(),
            org_id: "demo-org".into(),
            status: "open".into(),
            severity: "P2".into(),
            group_values,
            key_type: "AlertId".into(),
            topology_context: None,
            first_alert_at: 10,
            last_alert_at: 10,
            resolved_at: None,
            alert_count: 1,
            title: Some("checkout (logs) stopped sending data".into()),
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: 11,
            updated_at: 11,
            muted_by_downtime_id: None,
            rca_run_id: None,
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
            security_case: false,
            historical: false,
        }
    }

    fn link(finding_id: &str) -> alert_incident_alerts::Model {
        alert_incident_alerts::Model {
            incident_id: "inc-1".into(),
            alert_id: format!("{SUBJECT_PREFIX}{finding_id}"),
            alert_fired_at: 10,
            alert_name: "checkout (logs) stopped sending data".into(),
            alert_kind: AlertKind::AutoObserve.as_str().into(),
            correlation_reason: Some("alert_id".into()),
            created_at: 11,
            resolved_at: None,
        }
    }

    fn finding_dims() -> serde_json::Value {
        serde_json::to_value(finding_dimensions("stream_silence", "logs", "checkout")).unwrap()
    }

    #[test]
    fn a_page_subject_maps_to_an_alert_id_incident_at_the_onset() {
        let s = subject();
        let f = finding_incident(&s, "demo-org");
        assert_eq!(f.org_id, "demo-org");
        assert_eq!(f.subject_id, format!("autoobserve:{}", s.finding_id));
        assert_eq!(
            f.subject_id.len(),
            76,
            "inside the 256-char alert_id column"
        );
        assert_eq!(
            f.title,
            page_title(decision_kinds::STREAM_SILENCE, "logs", "checkout")
        );
        assert_eq!(f.triggered_at, s.signal_at);
        assert_eq!(
            f.dimensions,
            finding_dimensions("stream_silence", "logs", "checkout")
        );
    }

    #[tokio::test]
    async fn incidents_off_refuses_before_any_write() {
        assert!(refuse_unless(true).is_ok());
        let refused = refuse_unless(false).unwrap_err();
        assert_eq!(
            refused
                .downcast_ref::<ActionRefused>()
                .map(|r| r.0.as_str()),
            Some(REFUSED_INCIDENTS_OFF)
        );
        assert!(!incidents_enabled(), "the test config leaves incidents off");
        let request = ActionRequest {
            org: "demo-org".into(),
            entity_type: kinds::STREAM.into(),
            entity_id: "logs/checkout".into(),
            decision_kind: decision_kinds::STREAM_SILENCE.into(),
            group_key: String::new(),
            action: ActionKind::Investigate,
            signal_at: 1,
        };
        let e = IncidentInvestigation.start(&request).await.unwrap_err();
        assert!(e.downcast_ref::<ActionRefused>().is_some(), "{e}");
    }

    #[test]
    fn an_item_carries_the_finding_incident_and_investigation() {
        let id = "a".repeat(64);
        let summary = config::meta::alerts::rca_runs::RunSummaryFields {
            detail: Some("agent unreachable".into()),
            steps: 1,
            ..Default::default()
        };
        let mut failed = incident(finding_dims());
        failed.rca_run_id = Some("run-1".into());
        failed.rca_state = Some("failed".into());
        failed.rca_summary = Some(serde_json::to_string(&summary).unwrap());
        let item = item_of(&failed, &link(&id));
        assert_eq!(item.finding.id, id);
        assert_eq!(item.finding.kind.as_deref(), Some("stream_silence"));
        assert_eq!(item.finding.stream_type.as_deref(), Some("logs"));
        assert_eq!(item.finding.stream_name.as_deref(), Some("checkout"));
        assert_eq!(item.finding.first_seen_at, 10);
        assert_eq!(
            (
                item.incident.id.as_str(),
                item.incident.status.as_str(),
                item.incident.severity.as_str(),
                item.incident.title.as_str(),
                item.incident.created_at
            ),
            (
                "inc-1",
                "open",
                "P2",
                "checkout (logs) stopped sending data",
                11
            )
        );
        assert_eq!(item.investigation.run_id.as_deref(), Some("run-1"));
        assert_eq!(item.investigation.state.as_deref(), Some("failed"));
        assert_eq!(item.investigation.summary, Some(summary));
        let body = serde_json::to_value(&item).unwrap();
        assert!(body["investigation"]["summary"].is_object(), "{body}");

        let mut off = incident(finding_dims());
        off.rca_off_reason = Some("l0_off".into());
        let item = item_of(&off, &link(&id));
        assert_eq!(item.investigation.state, None);
        assert_eq!(item.investigation.run_id, None);
        assert_eq!(item.investigation.not_run_reason.as_deref(), Some("l0_off"));
        let body = serde_json::to_value(&item).unwrap();
        assert!(
            body["investigation"]["summary"].is_null(),
            "present as null"
        );

        let mut running = incident(finding_dims());
        running.rca_run_id = Some("run-2".into());
        running.rca_state = Some("running".into());
        running.rca_summary = Some("not json".into());
        let item = item_of(&running, &link(&id));
        assert_eq!(item.investigation.state.as_deref(), Some("running"));
        assert_eq!(
            item.investigation.summary, None,
            "an unreadable summary is null"
        );
    }

    #[test]
    fn an_item_with_unreadable_dims_still_lists_the_incident() {
        let item = item_of(&incident(serde_json::json!({})), &link(&"b".repeat(64)));
        assert_eq!(item.finding.kind, None);
        assert_eq!(item.finding.stream_type, None);
        assert_eq!(item.finding.stream_name, None);
        assert_eq!(item.incident.id, "inc-1");
        let item = item_of(&incident(serde_json::json!("garbage")), &link("c"));
        assert_eq!((item.finding.kind, item.finding.id.as_str()), (None, "c"));
    }
}
