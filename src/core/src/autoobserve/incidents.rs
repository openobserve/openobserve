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

use std::collections::{BTreeMap, HashMap, HashSet};

use async_trait::async_trait;
use config::meta::alerts::{incidents::AlertKind, rca_runs::RunSummaryFields};
use infra::table::{
    entity::{alert_incident_alerts, alert_incidents},
    oncall_ownership::Landing,
    service_streams::ServiceRecord,
};
use o2_enterprise::enterprise::autoobserve::{
    INTERVAL_SECS,
    api::Page,
    contract::ActionRequest,
    names::decision_kinds,
    page_routing::{catalogue, cohort_dimensions, stream_service},
    paging_enabled_for,
    plugins::stream::{PageSubject, cohort_title, finding_id, page_subject},
    ports::{ActionRefused, InvestigationPort, Recovery},
};
use serde::{Deserialize, Serialize};

use crate::alerts::incidents::{
    FINDING_KIND_DIMENSION, FINDING_STREAM_NAME_DIMENSION, FINDING_STREAM_TYPE_DIMENSION,
    FindingIncident, FindingPager, OncallPager, finding_dimensions, incidents_enabled,
    open_finding_incident, resolve_finding_firing,
};

/// Prefixes every finding's trigger id, so it can never equal an alert's id in `alert_id`.
pub const SUBJECT_PREFIX: &str = "autoobserve:";
pub const REFUSED_INCIDENTS_OFF: &str = "incidents are off or not licensed";
/// A failed route is retried the next tick, so two ticks without a record mean it failed (R8).
pub const PAGE_PENDING_US: i64 = 2 * INTERVAL_SECS * 1_000_000;
/// The queue keeps one row per dimension path, so this many rows hold every recent sample.
const UNROUTED_SCANNED: u64 = 500;

/// P6 over main's incident path: the incident's own automatic analysis is the investigation.
pub struct IncidentInvestigation;

#[async_trait]
impl InvestigationPort for IncidentInvestigation {
    async fn start(&self, request: &ActionRequest) -> anyhow::Result<String> {
        refuse_unless(incidents_enabled())?;
        let subject = page_subject(request)
            .ok_or_else(|| anyhow::anyhow!("the finding is not on a stream"))?;
        let records = catalogue(&request.org).await;
        let finding = finding_incident(&subject, &request.org, &records);
        // The act's timeout drops this future; spawned, the incident work still runs to its end.
        let outcome = tokio::spawn(async move { open_finding_incident(&finding).await }).await??;
        Ok(outcome.incident_id().to_string())
    }

    /// Incidents off opened nothing, so there is nothing to resolve.
    async fn resolve(&self, recovery: &Recovery) -> anyhow::Result<bool> {
        if !incidents_enabled() {
            return Ok(false);
        }
        let (org, subject) = (recovery.org.clone(), recovery_subject(recovery));
        let (at, back) = (recovery.signal_at, recovery.recovered_at);
        // The pull's budget drops this future; spawned, a resolve already begun still finishes.
        let resolve = async move { resolve_finding_firing(&org, &subject, at, back).await };
        Ok(tokio::spawn(resolve).await??)
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
    /// Every stream in the incident, first seen first; left out only by bodies older than cohorts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<MemberView>,
    /// Who was paged, or why nobody was; left out only by bodies older than R8.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<PageView>,
}

/// One stream of an incident; its type and name are null once the org no longer has the stream.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MemberView {
    pub id: String,
    pub title: String,
    pub stream_type: Option<String>,
    pub stream_name: Option<String>,
    pub first_seen_at: i64,
    /// Null while any of its firings is still open.
    pub recovered_at: Option<i64>,
}

/// The incident's page as on-call recorded it; the team is null unless it paged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PageView {
    pub outcome: PageOutcome,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageOutcome {
    Paged,
    /// No rule and no default team took it, or the org had no on-call team when it opened.
    Unrouted,
    /// No record two ticks after it opened while routing names a team: routing or paging errored.
    Failed,
    /// Opened under two ticks ago and not routed yet.
    Pending,
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

/// The pure half of `start`: the subject the incident path correlates on, scoped by `records`.
pub fn finding_incident(s: &PageSubject, org: &str, records: &[ServiceRecord]) -> FindingIncident {
    let scope = stream_service(records, &s.stream_type, &s.stream_name);
    let mut streams = vec![(s.stream_type.clone(), s.stream_name.clone())];
    streams.extend(
        s.cohort
            .iter()
            .filter(|(t, n)| stream_service(records, t, n) == scope)
            .cloned(),
    );
    FindingIncident {
        org_id: org.to_string(),
        subject_id: format!("{SUBJECT_PREFIX}{}", s.finding_id),
        title: s.title.clone(),
        dimensions: finding_dimensions(&s.decision_kind, &s.stream_type, &s.stream_name),
        triggered_at: s.signal_at,
        page_title: cohort_title(
            &s.decision_kind,
            &s.stream_type,
            &s.stream_name,
            streams.len(),
        ),
        streams,
        cohort: true,
        scope,
    }
}

/// The trigger id `start` gave the finding's firing, so its recovery finds the same incident.
pub fn recovery_subject(r: &Recovery) -> String {
    let id = finding_id(&r.org, &r.decision_kind, &r.entity_id);
    format!("{SUBJECT_PREFIX}{id}")
}

/// The org's AutoObserve incidents, newest first, with whether paging is on for it.
pub async fn list(org: &str, page: Page) -> Result<AutoObserveIncidents, anyhow::Error> {
    let oncall_on = o2_enterprise::enterprise::oncall::is_enabled();
    list_with(org, page, oncall_on, config::utils::time::now_micros()).await
}

/// [list], told whether on-call runs and when now is, so every page outcome can be tested.
pub async fn list_with(
    org: &str,
    page: Page,
    oncall_on: bool,
    now: i64,
) -> Result<AutoObserveIncidents, anyhow::Error> {
    let kind = AlertKind::AutoObserve.as_str();
    let (rows, has_more) = infra::table::alert_incidents::list_by_alert_kind(
        org,
        kind,
        u64::try_from(page.limit)?,
        u64::try_from(page.offset)?,
    )
    .await?;
    let ids: Vec<String> = rows.iter().map(|(i, _)| i.id.clone()).collect();
    let mut links: HashMap<String, Vec<alert_incident_alerts::Model>> = HashMap::new();
    for link in infra::table::alert_incidents::links_with_alert_kind(&ids, kind).await? {
        links
            .entry(link.incident_id.clone())
            .or_default()
            .push(link);
    }
    let names = stream_names(org).await;
    let mut items: Vec<AutoObserveIncident> = rows
        .iter()
        .map(|(i, l)| {
            let mut item = item_of(i, l);
            item.members = members_of(links.get(&i.id).map_or(&[], Vec::as_slice), &names);
            item
        })
        .collect();
    let unrouted = unrouted_samples(org).await?;
    let staffed_since = if oncall_on {
        first_team_at(org).await?
    } else {
        None
    };
    for item in &mut items {
        item.page = Some(page_of(org, item, &unrouted, staffed_since, now).await?);
    }
    Ok(AutoObserveIncidents {
        paging: paging_enabled_for(org).await,
        has_more,
        items,
    })
}

pub fn members_of(
    links: &[alert_incident_alerts::Model],
    names: &HashMap<String, (String, String)>,
) -> Vec<MemberView> {
    let mut by_id: BTreeMap<&str, Vec<&alert_incident_alerts::Model>> = BTreeMap::new();
    for link in links {
        by_id.entry(link.alert_id.as_str()).or_default().push(link);
    }
    let mut members: Vec<MemberView> = by_id
        .into_iter()
        .map(|(alert_id, firings)| {
            let id = alert_id.strip_prefix(SUBJECT_PREFIX).unwrap_or(alert_id);
            let first = firings.iter().min_by_key(|l| l.alert_fired_at).copied();
            let open = firings.iter().any(|l| l.resolved_at.is_none());
            let stream = names.get(id);
            MemberView {
                id: id.to_string(),
                title: first.map(|l| l.alert_name.clone()).unwrap_or_default(),
                stream_type: stream.map(|(t, _)| t.clone()),
                stream_name: stream.map(|(_, n)| n.clone()),
                first_seen_at: first.map_or(0, |l| l.alert_fired_at),
                recovered_at: (!open)
                    .then(|| firings.iter().filter_map(|l| l.resolved_at).max())
                    .flatten(),
            }
        })
        .collect();
    members.sort_by(|a, b| (a.first_seen_at, &a.id).cmp(&(b.first_seen_at, &b.id)));
    members
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
        members: Vec::new(),
        page: None,
    }
}

async fn unrouted_samples(org: &str) -> anyhow::Result<HashSet<String>> {
    let rows =
        infra::table::oncall_ownership::list_unrouted(org, true, Landing::Nobody, UNROUTED_SCANNED)
            .await?;
    Ok(rows.into_iter().filter_map(|r| r.last_source_id).collect())
}

/// When the org's oldest on-call team was made; on-call pages nobody in an org without one.
async fn first_team_at(org: &str) -> anyhow::Result<Option<i64>> {
    let teams = infra::table::oncall_teams::list(org).await?;
    Ok(teams.iter().map(|t| t.created_at).min())
}

async fn page_of(
    org: &str,
    item: &AutoObserveIncident,
    unrouted: &HashSet<String>,
    staffed_since: Option<i64>,
    now: i64,
) -> anyhow::Result<PageView> {
    let id = &item.incident.id;
    let record = OncallPager.record(org, id).await?;
    if let Some(team) = record.as_ref().and_then(|r| r.team_id.clone()) {
        let team_name = infra::table::oncall_teams::get_cached(org, &team)
            .await?
            .map(|t| t.name);
        return Ok(PageView {
            outcome: PageOutcome::Paged,
            team_id: Some(team),
            team_name,
        });
    }
    // Paging ran when it opened, so a team added later never makes it pending or failed.
    let staffed = staffed_since.is_some_and(|at| at <= item.incident.created_at);
    // A teamless record is how on-call keeps a page nobody owns: it woke no one.
    let outcome = if !staffed || record.is_some() || unrouted.contains(id) {
        PageOutcome::Unrouted
    } else if now - item.incident.created_at < PAGE_PENDING_US {
        PageOutcome::Pending
    } else if routes_nowhere(org, &item.members).await? {
        PageOutcome::Unrouted
    } else {
        PageOutcome::Failed
    };
    Ok(PageView {
        outcome,
        team_id: None,
        team_name: None,
    })
}

/// Routing decided now, for an incident whose queue sample a later page of its path replaced.
async fn routes_nowhere(org: &str, members: &[MemberView]) -> anyhow::Result<bool> {
    let streams: Vec<(String, String)> = members
        .iter()
        .filter_map(|m| Some((m.stream_type.clone()?, m.stream_name.clone()?)))
        .collect();
    let dimensions = cohort_dimensions(org, &streams).await;
    let routed = o2_enterprise::enterprise::oncall::routing::decide(org, None, &dimensions).await?;
    Ok(routed.team_id().is_none())
}

/// Each paged kind's finding id for every stream the org still has, so a member reads by name.
async fn stream_names(org: &str) -> HashMap<String, (String, String)> {
    let streams = crate::autoobserve::ports::org_streams_now(org).await;
    let mut names = HashMap::new();
    for (stream_type, name) in streams {
        let entity = format!("{stream_type}/{name}");
        for kind in decision_kinds::PAGED {
            names.insert(
                finding_id(org, kind, &entity),
                (stream_type.to_string(), name.clone()),
            );
        }
    }
    names
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
            peers: Vec::new(),
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
        let f = finding_incident(&s, "demo-org", &[]);
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
        // Not on a stream: past the gate (ENT defaults incidents on) it fails before opening one.
        let request = ActionRequest {
            org: "demo-org".into(),
            entity_type: kinds::STREAM.into(),
            entity_id: "checkout".into(),
            decision_kind: decision_kinds::STREAM_SILENCE.into(),
            group_key: String::new(),
            action: ActionKind::Investigate,
            signal_at: 1,
            peers: Vec::new(),
        };
        let e = IncidentInvestigation.start(&request).await.unwrap_err();
        let on = incidents_enabled();
        assert_eq!(e.downcast_ref::<ActionRefused>().is_some(), !on, "{e}");
        if on {
            assert_eq!(e.to_string(), "the finding is not on a stream");
        }
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

    #[tokio::test]
    async fn a_recovery_names_the_subject_its_page_opened_and_incidents_off_resolve_nothing() {
        let recovery = Recovery {
            org: "demo-org".into(),
            decision_kind: decision_kinds::STREAM_SILENCE.into(),
            entity_id: "logs/checkout".into(),
            signal_at: 1_762_300_000_000_000,
            recovered_at: 1_762_300_900_000_000,
        };
        let opened = finding_incident(&subject(), "demo-org", &[]);
        assert_eq!(recovery_subject(&recovery), opened.subject_id);
        let drop = Recovery {
            decision_kind: decision_kinds::STREAM_DROP.into(),
            ..recovery.clone()
        };
        assert_ne!(recovery_subject(&drop), opened.subject_id, "per kind");
        let resolved = IncidentInvestigation.resolve(&recovery).await;
        if incidents_enabled() {
            assert!(
                !matches!(resolved, Ok(true)),
                "no incident holds this firing"
            );
        } else {
            assert!(!resolved.unwrap(), "incidents off resolve nothing");
        }
    }
}
