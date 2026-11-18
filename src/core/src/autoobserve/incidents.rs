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

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use async_trait::async_trait;
use config::{
    meta::{
        alerts::{
            incidents::{AlertKind, IncidentEvent, IncidentEventType},
            rca_runs::{AutoRunOpts, RunSummaryFields, RunTrigger},
        },
        oncall::{ResolutionCause, Response, SubjectType},
    },
    utils::time::now_micros,
};
use futures::{StreamExt, TryStreamExt};
use infra::table::{
    alert_incidents::CaseFilter,
    entity::{alert_incident_alerts, alert_incidents},
    oncall_ownership::Landing,
    service_streams::ServiceRecord,
};
use o2_enterprise::enterprise::{
    autoobserve::{
        INTERVAL_SECS,
        api::{Deps, Page},
        context::{
            self, CohortStreams, IssueContext, IssueIncident, IssueRef, SpentPage, ViewerResolver,
            for_issues, issue_by_id, issue_for,
        },
        contract::ActionRequest,
        decisions::{Action, Change, DecisionView},
        names::decision_kinds,
        outcomes::{self, OutcomeReport, OutcomeSource, OutcomeSubject},
        page_routing::{catalogue, cohort_dimensions, compatible, stream_dimensions},
        paging_enabled_for,
        plugins::stream::{PageSubject, cohort_title, finding_id, page_subject},
        ports::{ActionRefused, InvestigationPort, Recovery},
    },
    slack::insights::copy::reason_word,
};
use serde::{Deserialize, Serialize};

use super::ports::SearchAdapter;
use crate::alerts::incidents::{
    AutoStart, BudgetedPage, FINDING_KIND_DIMENSION, FINDING_STREAM_NAME_DIMENSION,
    FINDING_STREAM_TYPE_DIMENSION, FindingIncident, FindingPager, OncallPager, budgeted_page,
    finding_dimensions, incidents_enabled, open_finding_incident, resolve_finding_firing,
    start_automatic_rca,
};

/// Prefixes every finding's trigger id, so it can never equal an alert's id in `alert_id`.
pub const SUBJECT_PREFIX: &str = "autoobserve:";
pub const REFUSED_INCIDENTS_OFF: &str = "incidents are off or not licensed";
/// A failed route is retried the next tick, so two ticks without a record mean it failed (R8).
pub const PAGE_PENDING_US: i64 = 2 * INTERVAL_SECS * 1_000_000;
/// The queue keeps one row per dimension path, so this many rows hold every recent sample.
const UNROUTED_SCANNED: u64 = 500;
/// Issue lookups in flight for one page of incidents.
const ISSUE_READS: usize = 8;
const KEPT_OPEN: &str = "This incident stays open because someone acknowledged or was assigned it; \
                         resolve it when you are done.";

/// A finding's decision kind, stream entity id and onset.
type IssueKey = (String, String, i64);
/// One member's issue lookup: its incident's index, its key and the recovery its links recorded.
type MemberIssue = (usize, IssueKey, Option<i64>);

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

    /// Two reads for all of a pass's recoveries, so paging off costs no query per stream.
    async fn open_incidents(&self, recoveries: &[Recovery]) -> anyhow::Result<Vec<bool>> {
        let Some(org) = recoveries.first().map(|r| r.org.clone()) else {
            return Ok(Vec::new());
        };
        if !incidents_enabled() {
            return Ok(vec![false; recoveries.len()]);
        }
        let subjects: Vec<String> = recoveries.iter().map(recovery_subject).collect();
        // A finding never opens a security case, so only ops incidents can hold one.
        let wanted: HashMap<String, CaseFilter> = subjects
            .iter()
            .map(|s| (s.clone(), CaseFilter::NoCases))
            .collect();
        let open =
            infra::table::alert_incidents::find_open_incidents_containing_alerts(&org, &wanted)
                .await?;
        Ok(recoveries
            .iter()
            .zip(&subjects)
            .map(|(r, s)| r.org == org && open.contains_key(s))
            .collect())
    }

    /// The first run just finished, so the cooldown is skipped; the new run extends its report.
    async fn reanalyse(&self, org: &str, incident_id: &str) -> anyhow::Result<bool> {
        let (org, incident_id) = (org.to_string(), incident_id.to_string());
        // Spawned, so the hook's timeout cannot drop a start between its writes.
        let started = tokio::spawn(async move {
            start_automatic_rca(
                &org,
                &incident_id,
                RunTrigger::EvidenceSettled,
                AutoRunOpts::evidence_settled(),
            )
            .await
        })
        .await?;
        Ok(started == AutoStart::Started)
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
    /// What changed before the finding and what it breaks, as this caller may see it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<IssueContext>,
    /// The incident and its page as a Slack issue thread reads them; never in the route's body.
    #[serde(skip)]
    pub issue_incident: Option<IssueIncident>,
    /// Every AutoObserve firing it holds as (finding id, onset), repeats kept; never in the body.
    #[serde(skip)]
    pub firings: BTreeSet<(String, i64)>,
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
    /// The org's daily page budget was spent, so it opened and was analysed but paged nobody.
    Budgeted,
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

/// How a responder answered an incident's page; each of its AutoObserve issues records it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RespondedAs {
    Acknowledged {
        by: String,
        at: i64,
    },
    Resolved {
        by: String,
        at: i64,
        cause: Option<ResolutionCause>,
    },
}

impl RespondedAs {
    /// An acknowledgement is a response, never a verdict; a resolve's cause may judge the issue.
    pub fn report(&self, org: &str, issue: IssueRef) -> OutcomeReport {
        let (source, by, at, (verdict, cause)) = match self {
            Self::Acknowledged { by, at } => (OutcomeSource::IncidentAck, by, *at, (None, None)),
            Self::Resolved { by, at, cause } => (
                OutcomeSource::OncallResolve,
                by,
                *at,
                outcomes::of_resolution_cause(cause.as_ref().map(ResolutionCause::as_str)),
            ),
        };
        OutcomeReport {
            org: org.to_string(),
            subject: OutcomeSubject::Issue(issue),
            source,
            actor: Some(by.clone()),
            at,
            responded: true,
            verdict,
            cause,
            effect: None,
            note: None,
            step_helpful: None,
            step_id: None,
        }
    }
}

/// The pure half of `start`: the subject the incident path correlates on, scoped by `records`.
pub fn finding_incident(s: &PageSubject, org: &str, records: &[ServiceRecord]) -> FindingIncident {
    let dims = stream_dimensions(records, &s.stream_type, &s.stream_name);
    let mut streams = vec![(s.stream_type.clone(), s.stream_name.clone())];
    streams.extend(
        s.cohort
            .iter()
            .filter(|(t, n)| compatible(&stream_dimensions(records, t, n), &dims))
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
        dims,
    }
}

/// The trigger id `start` gave the finding's firing, so its recovery finds the same incident.
pub fn recovery_subject(r: &Recovery) -> String {
    let id = finding_id(&r.org, &r.decision_kind, &r.entity_id);
    format!("{SUBJECT_PREFIX}{id}")
}

/// The org's AutoObserve incidents, newest first, with whether paging is on for it.
/// `only` narrows the list to one incident id.
pub async fn list(
    org: &str,
    page: Page,
    only: Option<&str>,
) -> Result<AutoObserveIncidents, anyhow::Error> {
    let oncall_on = o2_enterprise::enterprise::oncall::is_enabled();
    list_with(
        org,
        page,
        only,
        oncall_on,
        config::utils::time::now_micros(),
    )
    .await
}

/// [list], told whether on-call runs and when now is, so every page outcome can be tested.
pub async fn list_with(
    org: &str,
    page: Page,
    only: Option<&str>,
    oncall_on: bool,
    now: i64,
) -> Result<AutoObserveIncidents, anyhow::Error> {
    let kind = AlertKind::AutoObserve.as_str();
    let (rows, has_more) = infra::table::alert_incidents::list_by_alert_kind(
        org,
        kind,
        only,
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
            let held = links.get(&i.id).map_or(&[][..], Vec::as_slice);
            let mut item = item_of(i, l);
            item.members = members_of(held, &names);
            item.firings.extend(held.iter().map(firing_of));
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
        let (page, incident) = page_of(org, item, &unrouted, staffed_since, now).await?;
        item.page = Some(page);
        item.issue_incident = Some(incident);
    }
    Ok(AutoObserveIncidents {
        paging: paging_enabled_for(org).await,
        has_more,
        items,
    })
}

/// Each item's issue context, merged over its members, as the resolver's caller may see it.
pub async fn attach_context(
    org: &str,
    items: &mut [AutoObserveIncident],
    resolver: &dyn ViewerResolver,
) -> anyhow::Result<()> {
    if !context::enabled() {
        return Ok(());
    }
    let members = member_issues(org, items);
    let keys: Vec<IssueKey> = members.iter().map(|(_, key, _)| key.clone()).collect();
    let issues: Vec<Option<IssueRef>> = futures::stream::iter(keys)
        .map(|key| issue_of(org.to_string(), Some(key)))
        .buffered(ISSUE_READS)
        .try_collect()
        .await?;
    let grouped = per_incident(items.len(), &members, issues);
    let found: Vec<IssueRef> = grouped.iter().flatten().cloned().collect();
    if found.is_empty() {
        return Ok(());
    }
    let mut contexts = for_issues(&SearchAdapter, org, &found, resolver)
        .await?
        .into_iter();
    for (item, issues) in items.iter_mut().zip(&grouped) {
        let mut parts: Vec<IssueContext> = contexts.by_ref().take(issues.len()).collect();
        item.context = match parts.len() {
            0 => None,
            1 => parts.pop(),
            _ => Some(context::merge(parts)),
        };
    }
    Ok(())
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
        context: None,
        issue_incident: None,
        firings: BTreeSet::from([firing_of(link)]),
    }
}

/// Records the response on each AutoObserve issue of the incident; a failure is only logged.
pub async fn responder_outcome(org: String, incident_id: String, responded: RespondedAs) {
    if let Err(e) = report_response(&org, &incident_id, &responded).await {
        log::warn!("[AUTOOBSERVE] org {org}: incident {incident_id}: response not recorded: {e}");
    }
}

/// Spawns [responder_outcome] unless AutoObserve is off: then no issue takes the response,
/// so a responder's action costs no read of the incident's alerts.
pub fn respond_to_incident(org: String, incident_id: String, responded: RespondedAs) {
    if o2_enterprise::enterprise::autoobserve::is_enabled() {
        tokio::spawn(responder_outcome(org, incident_id, responded));
    }
}

/// [respond_to_incident] for the incident a page record belongs to, if it has one.
pub fn respond_to_page(record: &Response, responded: RespondedAs) {
    let incident = record.incident_id.clone().or_else(|| {
        (record.subject.subject_type == SubjectType::Incident)
            .then(|| record.subject.source_id.clone())
    });
    if let Some(incident_id) = incident {
        respond_to_incident(record.org_id.clone(), incident_id, responded);
    }
}

/// Appends a system line to the incident's timeline, where its responders read it.
pub async fn note_decision(org: &str, incident_id: &str, line: &str) -> anyhow::Result<()> {
    let event = IncidentEvent::comment("system", line);
    infra::table::incident_events::append(org, incident_id, event).await?;
    Ok(())
}

/// Notes an issue decision on the incident its issue opened, when it opened one; only logged.
pub async fn note_issue_decision(org: String, change: Change, view: DecisionView) {
    let Some(line) = decision_line(change, &view) else {
        return;
    };
    let noted = async {
        match issue_incident_id(&org, &view.id).await? {
            Some(incident_id) => note_decision(&org, &incident_id, &line).await,
            None => Ok(()),
        }
    };
    if let Err(e) = noted.await {
        log::warn!(
            "[AUTOOBSERVE] org {org}: decision {} not noted: {e}",
            view.id
        );
    }
}

/// Z3: data came back while a person holds the incident; one note per episode of its firings.
pub async fn note_kept_open(org: &str, incident_id: &str, back_us: i64) -> anyhow::Result<()> {
    let links = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;
    let events = infra::table::incident_events::get(org, incident_id).await?;
    if noted_since_last_firing(&links, &events) {
        return Ok(());
    }
    note_decision(org, incident_id, &kept_open_line(back_us)).await
}

/// The incident holding the issue's own firing; the finding's other incidents are other episodes.
pub fn incident_of(
    org: &str,
    issue: &IssueRef,
    items: &[AutoObserveIncident],
) -> Option<IssueIncident> {
    let firing = (
        finding_id(org, &issue.decision_kind, &issue.entity_id()),
        issue.onset_us,
    );
    items
        .iter()
        .find(|item| item.firings.contains(&firing))
        .and_then(|item| item.issue_incident.clone())
}

pub(crate) fn kept_open_line(back_us: i64) -> String {
    match chrono::DateTime::from_timestamp_micros(back_us) {
        Some(at) => format!("Data is back since {} UTC. {KEPT_OPEN}", at.format("%H:%M")),
        None => format!("Data is back. {KEPT_OPEN}"),
    }
}

/// A link's finding id and the onset it fired at, the pair its issue is read by.
fn firing_of(link: &alert_incident_alerts::Model) -> (String, i64) {
    let id = link.alert_id.strip_prefix(SUBJECT_PREFIX);
    (
        id.unwrap_or(&link.alert_id).to_string(),
        link.alert_fired_at,
    )
}

/// A kept-open note written after the newest firing joined already speaks for this recovery.
fn noted_since_last_firing(
    links: &[alert_incident_alerts::Model],
    events: &[IncidentEvent],
) -> bool {
    let joined = links.iter().map(|l| l.created_at).max().unwrap_or(i64::MIN);
    events.iter().any(|e| {
        e.timestamp >= joined
            && matches!(&e.event_type, IncidentEventType::Comment { user_id, comment }
                if user_id == "system" && comment.ends_with(KEPT_OPEN))
    })
}

/// The timeline line of an issue decision; None for one that changed nothing on the issue.
fn decision_line(change: Change, view: &DecisionView) -> Option<String> {
    let actor = &view.actor;
    match change {
        Change::Undone => Some(format!(
            "{actor} undid the AutoObserve dismissal of this issue."
        )),
        Change::Created | Change::Updated if view.action == Action::Dismiss => {
            Some(match view.reason.as_deref() {
                Some(reason) => format!(
                    "{actor} dismissed this issue in AutoObserve ({}).",
                    reason_word(reason)
                ),
                None => format!("{actor} dismissed this issue in AutoObserve."),
            })
        }
        _ => None,
    }
}

/// Each AutoObserve firing of an incident as the issue it pages for: kind, stream and onset.
fn member_firings(
    org: &str,
    links: &[alert_incident_alerts::Model],
    names: &HashMap<String, (String, String)>,
) -> Vec<IssueKey> {
    let mut out = BTreeSet::new();
    for link in links
        .iter()
        .filter(|l| l.alert_kind == AlertKind::AutoObserve.as_str())
    {
        let Some(id) = link.alert_id.strip_prefix(SUBJECT_PREFIX) else {
            continue;
        };
        let Some((stream_type, name)) = names.get(id) else {
            continue;
        };
        let entity = format!("{stream_type}/{name}");
        if let Some(kind) = paged_kind(org, id, &entity) {
            out.insert((kind.to_string(), entity, link.alert_fired_at));
        }
    }
    out.into_iter().collect()
}

fn issue_incident(
    org: &str,
    item: &AutoObserveIncident,
    page: &PageView,
    record: Option<&Response>,
    budget_spent_by: Option<SpentPage>,
) -> IssueIncident {
    let members = &item.members;
    let cohort = (members.len() >= 2).then(|| CohortStreams {
        streams: u32::try_from(members.len()).unwrap_or(u32::MAX),
        names: members
            .iter()
            .filter_map(|m| m.stream_name.clone())
            .take(3)
            .collect(),
    });
    IssueIncident {
        incident_id: item.incident.id.clone(),
        status: item.incident.status.clone(),
        paged: page.outcome == PageOutcome::Paged,
        page_failed: page.outcome == PageOutcome::Failed,
        response_id: record.map(|r| r.id.clone()),
        team_name: page.team_name.clone(),
        acked_by: record.and_then(|r| r.acked_by.clone()),
        acked_at: record.and_then(|r| r.acked_at),
        page_url: record.map(|r| {
            let cfg = config::get_config();
            page_url(&cfg.common.web_url, &cfg.common.base_uri, org, &r.id)
        }),
        cohort,
        budget_spent_by,
        paged_at: record
            .filter(|_| page.outcome == PageOutcome::Paged)
            .map(|r| r.opened_at),
    }
}

/// The finding's decision kind, its stream's entity id and the onset of its current firing.
fn issue_key(item: &AutoObserveIncident) -> Option<IssueKey> {
    let f = &item.finding;
    let entity_id = format!("{}/{}", f.stream_type.as_ref()?, f.stream_name.as_ref()?);
    let onset = current_onset(item, &f.id).unwrap_or(f.first_seen_at);
    Some((f.kind.clone()?, entity_id, onset))
}

/// The finding's newest firing in the incident, the episode `next_step::finding_key` runs RCA on.
fn current_onset(item: &AutoObserveIncident, finding: &str) -> Option<i64> {
    let held = item.firings.iter().filter(|(id, _)| id == finding);
    held.map(|(_, onset)| *onset).max()
}

/// Owns its inputs: a lookup future borrowing the item fails the handler's `Send` check.
async fn issue_of(org: String, key: Option<IssueKey>) -> anyhow::Result<Option<IssueRef>> {
    let Some((kind, entity_id, onset_us)) = key else {
        return Ok(None);
    };
    issue_for(&SearchAdapter, &org, &kind, &entity_id, onset_us).await
}

/// Every member's issue, so a cohort shows each stream's context; a body without members uses the
/// finding.
fn member_issues(org: &str, items: &[AutoObserveIncident]) -> Vec<MemberIssue> {
    let mut out = Vec::new();
    for (n, item) in items.iter().enumerate() {
        if item.members.is_empty() {
            out.extend(issue_key(item).map(|key| (n, key, None)));
        }
        for m in &item.members {
            let (Some(stream_type), Some(name)) = (&m.stream_type, &m.stream_name) else {
                continue;
            };
            let entity = format!("{stream_type}/{name}");
            if let Some(kind) = paged_kind(org, &m.id, &entity) {
                let onset = current_onset(item, &m.id).unwrap_or(m.first_seen_at);
                out.push((n, (kind.to_string(), entity, onset), m.recovered_at));
            }
        }
    }
    out
}

/// Each incident's issues; stream issue rows record no recovery, so the member's links supply it.
fn per_incident(
    len: usize,
    members: &[MemberIssue],
    found: Vec<Option<IssueRef>>,
) -> Vec<Vec<IssueRef>> {
    let mut out = vec![Vec::new(); len];
    for ((n, _, recovered), issue) in members.iter().zip(found) {
        if let Some(mut issue) = issue {
            issue.recovered_us = issue.recovered_us.or(*recovered);
            out[*n].push(issue);
        }
    }
    out
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

async fn report_response(
    org: &str,
    incident_id: &str,
    responded: &RespondedAs,
) -> anyhow::Result<()> {
    let links = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;
    if !links
        .iter()
        .any(|l| l.alert_kind == AlertKind::AutoObserve.as_str())
    {
        return Ok(());
    }
    let keys = member_firings(org, &links, &stream_names(org).await);
    let deps = Deps::live().map_err(|e| anyhow::anyhow!("AutoObserve is not running: {e:?}"))?;
    for (kind, entity_id, onset_us) in keys {
        if let Some(issue) = issue_for(&SearchAdapter, org, &kind, &entity_id, onset_us).await? {
            outcomes::report(&deps, responded.report(org, issue)).await;
        }
    }
    Ok(())
}

/// The incident the issue's firing joined, found by the subject and onset it opened with.
async fn issue_incident_id(org: &str, issue_id: &str) -> anyhow::Result<Option<String>> {
    let Some(issue) = issue_by_id(&SearchAdapter, org, issue_id, now_micros()).await? else {
        return Ok(None);
    };
    let finding = finding_id(org, &issue.decision_kind, &issue.entity_id());
    let subject = format!("{SUBJECT_PREFIX}{finding}");
    let held =
        infra::table::alert_incidents::find_incident_with_firing(org, &subject, issue.onset_us)
            .await?;
    Ok(held.map(|incident| incident.id))
}

/// The page view and, from the same record, the incident as an issue thread reads it.
async fn page_of(
    org: &str,
    item: &AutoObserveIncident,
    unrouted: &HashSet<String>,
    staffed_since: Option<i64>,
    now: i64,
) -> anyhow::Result<(PageView, IssueIncident)> {
    let record = OncallPager.record(org, &item.incident.id).await?;
    let budgeted = budgeted_page(org, &item.incident.id).await?;
    let held = budgeted.is_some();
    let page = page_view(
        org,
        item,
        record.as_ref(),
        held,
        unrouted,
        staffed_since,
        now,
    )
    .await?;
    let spent = match &budgeted {
        Some(budgeted) => spent_page(org, budgeted).await?,
        None => None,
    };
    let incident = issue_incident(org, item, &page, record.as_ref(), spent);
    Ok((page, incident))
}

async fn page_view(
    org: &str,
    item: &AutoObserveIncident,
    record: Option<&Response>,
    budgeted: bool,
    unrouted: &HashSet<String>,
    staffed_since: Option<i64>,
    now: i64,
) -> anyhow::Result<PageView> {
    let id = &item.incident.id;
    if let Some(team) = record.and_then(|r| r.team_id.clone()) {
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
    let outcome = if budgeted {
        PageOutcome::Budgeted
    } else if !staffed || record.is_some() || unrouted.contains(id) {
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

/// The page that used the budget; None once on-call no longer has its record.
async fn spent_page(org: &str, budgeted: &BudgetedPage) -> anyhow::Result<Option<SpentPage>> {
    // Columns only, so a page whose state this build cannot decode is still named.
    let Some(page) = infra::table::oncall_responses::team_page(org, &budgeted.record_id).await?
    else {
        return Ok(None);
    };
    let team_name = match &page.team_id {
        Some(team) => infra::table::oncall_teams::get_cached(org, team)
            .await?
            .map(|t| t.name),
        None => None,
    };
    let incident_id = page.source_id();
    // The primary: a replica that lags the incident's links or row would title it empty.
    let links = infra::table::alert_incidents::get_incident_alerts_rw(incident_id).await?;
    let members: HashSet<&str> = links
        .iter()
        .filter(|l| l.alert_kind == AlertKind::AutoObserve.as_str())
        .map(|l| l.alert_id.as_str())
        .collect();
    // The incident keeps its first member's dimensions, the stream its post was titled by.
    let stream_name = infra::table::alert_incidents::get_rw(org, incident_id)
        .await?
        .and_then(|i| {
            let name = i.group_values.get(FINDING_STREAM_NAME_DIMENSION)?;
            name.as_str().map(str::to_string)
        })
        .unwrap_or_default();
    Ok(Some(SpentPage {
        team_name,
        paged_at: page.opened_at,
        page_url: Some({
            let cfg = config::get_config();
            page_url(&cfg.common.web_url, &cfg.common.base_uri, org, &page.id)
        }),
        pages_per_day: budgeted.pages_per_day,
        streams: u32::try_from(members.len()).unwrap_or(u32::MAX),
        stream_name,
    }))
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

/// The paged decision kind whose finding on this stream has this id.
fn paged_kind(org: &str, finding: &str, entity: &str) -> Option<&'static str> {
    decision_kinds::PAGED
        .iter()
        .find(|kind| finding_id(org, kind, entity) == finding)
        .copied()
}

/// The on-call page's own address, as on-call's chat messages link it.
fn page_url(web_url: &str, base_uri: &str, org: &str, response_id: &str) -> String {
    format!("{web_url}{base_uri}/web/oncall/responses/{response_id}?org_identifier={org}")
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
            last_detection_at: None,
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
            labels: None,
            severity: None,
        }
    }

    fn finding_dims() -> serde_json::Value {
        serde_json::to_value(finding_dimensions("stream_silence", "logs", "checkout")).unwrap()
    }

    #[test]
    fn the_page_link_keeps_a_sub_path_deployment_base() {
        assert_eq!(
            page_url("https://o2.acme.com", "/o2", "acme", "resp_1"),
            "https://o2.acme.com/o2/web/oncall/responses/resp_1?org_identifier=acme"
        );
    }

    #[test]
    fn a_page_subject_maps_to_an_alert_id_incident_at_the_onset() {
        let record = |service: &str, logs: &[&str]| ServiceRecord {
            id: config::ider::generate(),
            org_id: "demo-org".into(),
            service_name: service.into(),
            set_id: "default".into(),
            disambiguation: serde_json::json!({}),
            all_dimensions: serde_json::json!({}),
            logs_streams: serde_json::json!(logs),
            traces_streams: serde_json::json!([]),
            metrics_streams: serde_json::json!([]),
            profiles_streams: serde_json::json!([]),
            field_name_mapping: None,
            last_seen: 1,
        };
        let records = [
            record("checkout", &["checkout", "cart"]),
            record("payments", &["payments"]),
        ];
        let peer = |n: &str| ("logs".to_string(), n.to_string());
        let s = PageSubject {
            cohort: vec![peer("cart"), peer("payments")],
            ..subject()
        };
        let f = finding_incident(&s, "demo-org", &records);
        assert_eq!(
            f.streams,
            [peer("checkout"), peer("cart")],
            "a peer of another service opens its own incident, so the page leaves it out"
        );
        assert_eq!(f.dims, stream_dimensions(&records, "logs", "checkout"));
        assert!(!f.dims.is_empty());
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
    fn a_cohort_reads_every_members_issue_with_its_recorded_recovery() {
        use o2_enterprise::enterprise::autoobserve::context::subject_of;
        const MINUTE: i64 = 60_000_000;
        let (org, silence, drop) = (
            "demo-org",
            decision_kinds::STREAM_SILENCE,
            decision_kinds::STREAM_DROP,
        );
        let member = |kind: &str, name: &str, seen: i64, recovered: Option<i64>| MemberView {
            id: finding_id(org, kind, &format!("logs/{name}")),
            title: String::new(),
            stream_type: Some("logs".into()),
            stream_name: Some(name.into()),
            first_seen_at: seen,
            recovered_at: recovered,
        };
        let checkout = finding_id(org, silence, "logs/checkout");
        let mut cohort = item_of(&incident(finding_dims()), &link(&checkout));
        cohort.members = vec![
            member(silence, "checkout", 10, None),
            member(drop, "okta_system_log", 20 * MINUTE, Some(95 * MINUTE)),
            member(silence, "okta_admin", 30 * MINUTE, Some(210 * MINUTE)),
            MemberView {
                stream_type: None,
                stream_name: None,
                ..member(silence, "deleted", 40, None)
            },
        ];
        cohort.issue_incident = Some(IssueIncident {
            incident_id: "cohort".into(),
            ..IssueIncident::default()
        });
        let fired = |m: &MemberView, at: i64| alert_incident_alerts::Model {
            alert_fired_at: at,
            ..link(&m.id)
        };
        let mut held: Vec<_> = cohort
            .members
            .iter()
            .map(|m| fired(m, m.first_seen_at))
            .collect();
        held.push(fired(&cohort.members[0], 50 * MINUTE));
        cohort.firings.extend(held.iter().map(firing_of));
        let mut older = item_of(
            &incident(finding_dims()),
            &alert_incident_alerts::Model {
                alert_fired_at: 1,
                ..link(&checkout)
            },
        );
        older.issue_incident = Some(IssueIncident {
            incident_id: "older".into(),
            ..IssueIncident::default()
        });
        older.firings.insert((checkout.clone(), 3));
        let items = [cohort, older];
        let members = member_issues(org, &items);
        let keys: Vec<(usize, &str, &str, i64)> = members
            .iter()
            .map(|(n, (kind, entity, onset), _)| (*n, kind.as_str(), entity.as_str(), *onset))
            .collect();
        assert_eq!(
            keys,
            [
                (0, silence, "logs/checkout", 50 * MINUTE),
                (0, drop, "logs/okta_system_log", 20 * MINUTE),
                (0, silence, "logs/okta_admin", 30 * MINUTE),
                (1, silence, "logs/checkout", 3),
            ],
            "a member and a memberless finding read their newest firing, the one RCA runs on"
        );
        let found: Vec<Option<IssueRef>> = members
            .iter()
            .map(|(_, (kind, entity, onset), _)| {
                Some(IssueRef {
                    org: org.into(),
                    decision_kind: kind.clone(),
                    subject: subject_of(kinds::STREAM, entity),
                    decision_id: format!("{kind}/{entity}"),
                    onset_us: *onset,
                    detected_us: *onset,
                    recovered_us: None,
                    shadow: false,
                    source: None,
                })
            })
            .collect();
        let at = |onset_us| IssueRef {
            onset_us,
            ..found[0].clone().unwrap()
        };
        let joined: Vec<Option<String>> = found
            .iter()
            .flatten()
            .cloned()
            .chain([at(10), at(5), at(60 * MINUTE)])
            .map(|issue| incident_of(org, &issue, &items).map(|i| i.incident_id))
            .collect();
        let named = |s: &str| Some(s.to_string());
        assert_eq!(
            joined,
            [
                named("cohort"),
                named("cohort"),
                named("cohort"),
                named("older"),
                named("cohort"),
                None,
                None,
            ],
            "the incident holding that very firing, a re-fire included; none for an unlinked onset"
        );
        let per = per_incident(items.len(), &members, found);
        let read: Vec<Vec<(&str, Option<i64>)>> = per
            .iter()
            .map(|issues| {
                issues
                    .iter()
                    .map(|i| (i.decision_kind.as_str(), i.recovered_us))
                    .collect()
            })
            .collect();
        assert_eq!(
            read,
            [
                vec![
                    (silence, None),
                    (drop, Some(95 * MINUTE)),
                    (silence, Some(210 * MINUTE)),
                ],
                vec![(silence, None)],
            ]
        );
    }

    #[test]
    fn a_response_reports_on_each_autoobserve_firing_with_its_cause_as_the_verdict() {
        use o2_enterprise::enterprise::autoobserve::{
            context::subject_of, outcomes::CAUSE_EXPECTED, review::Verdict,
        };
        let (org, silence) = ("demo-org", decision_kinds::STREAM_SILENCE);
        let checkout = finding_id(org, silence, "logs/checkout");
        let names = HashMap::from([(checkout.clone(), ("logs".into(), "checkout".into()))]);
        let refired = alert_incident_alerts::Model {
            alert_fired_at: 300,
            ..link(&checkout)
        };
        let alert = alert_incident_alerts::Model {
            alert_id: "alert-1".into(),
            alert_kind: AlertKind::Internal.as_str().into(),
            ..link("unused")
        };
        let deleted = link(&finding_id(org, silence, "logs/deleted"));
        let key = |onset| (silence.to_string(), "logs/checkout".to_string(), onset);
        for (links, want) in [
            (vec![alert.clone()], vec![]),
            (
                vec![alert, deleted, link(&checkout), refired],
                vec![key(10), key(300)],
            ),
        ] {
            assert_eq!(member_firings(org, &links, &names), want);
        }
        let issue = IssueRef {
            org: org.into(),
            decision_kind: silence.into(),
            subject: subject_of(kinds::STREAM, "logs/checkout"),
            decision_id: "d-1".into(),
            onset_us: 10,
            detected_us: 10,
            recovered_us: None,
            shadow: false,
            source: None,
        };
        let by = || "ana@example.com".to_string();
        let resolved = |cause| RespondedAs::Resolved {
            by: by(),
            at: 7,
            cause,
        };
        let (ack, resolve) = (OutcomeSource::IncidentAck, OutcomeSource::OncallResolve);
        for (responded, source, verdict, cause) in [
            (
                RespondedAs::Acknowledged { by: by(), at: 7 },
                ack,
                None,
                None,
            ),
            (resolved(None), resolve, Some(Verdict::Unclear), None),
            (
                resolved(Some(ResolutionCause::NoisyThreshold)),
                resolve,
                Some(Verdict::FalseAlarm),
                None,
            ),
            (
                resolved(Some(ResolutionCause::ExpectedOrMaintenance)),
                resolve,
                None,
                Some(CAUSE_EXPECTED),
            ),
            (
                resolved(Some(ResolutionCause::DependencyFailure)),
                resolve,
                Some(Verdict::Confirmed),
                None,
            ),
        ] {
            let r = responded.report(org, issue.clone());
            let got = (r.source, r.verdict, r.cause.as_deref(), r.responded, r.at);
            assert_eq!(got, (source, verdict, cause, true, 7), "{responded:?}");
            assert_eq!(r.actor.as_deref(), Some("ana@example.com"));
            assert_eq!(r.subject, OutcomeSubject::Issue(issue.clone()));
        }
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
