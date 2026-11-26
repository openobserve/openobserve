// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

mod candidate;
pub(super) mod capture;
mod effects;
pub(super) mod source;

use std::{collections::HashMap, future::Future};

use config::{
    meta::{
        alerts::{
            incidents::{
                AddContextRequest, ContextSource, DeclareRequest, IncidentEvent, IncidentEventType,
                IncidentSeverity, ResultSummary,
            },
            priority::AlertPriority,
        },
        downtimes::ActiveDowntime,
        oncall::RoutingDecision,
    },
    utils::time::now_micros,
};
use infra::{
    db::{clock_micros, get_orm_client_ro, get_orm_client_rw},
    table::{
        alert_incidents::{self, DeclaredIncident},
        entity::{alert_incidents::Model as Incident, incident_contexts::Model as ContextRow},
        incident_contexts, incident_declare_keys, incident_events,
    },
};
use o2_enterprise::enterprise::oncall::{self, insight, routing};
use sea_orm::{ActiveModelTrait, ConnectionTrait, DatabaseTransaction, Set, TransactionTrait};
use serde::Serialize;
use serde_json::{Value, json};
use svix_ksuid::{Ksuid, KsuidLike};
use utoipa::ToSchema;

use crate::{
    alerts::{downtimes, rca_steering},
    authz::QuerySource,
};

const ATTACHMENT_LIMIT: &str = "Attachment limit reached";
const KEY_IN_USE: &str = "Idempotency-Key is already used for an attachment";

#[derive(Debug, thiserror::Error)]
pub enum DeclareError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Forbidden")]
    Forbidden,
    #[error("Not found")]
    NotFound,
    #[error("{0}")]
    Conflict(&'static str),
    #[error("No team to page")]
    NoTeam,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl DeclareError {
    fn bad(message: &str) -> Self {
        Self::BadRequest(message.to_owned())
    }
}

impl From<sea_orm::DbErr> for DeclareError {
    fn from(error: sea_orm::DbErr) -> Self {
        Self::Internal(error.into())
    }
}

impl From<infra::errors::Error> for DeclareError {
    fn from(error: infra::errors::Error) -> Self {
        Self::Internal(error.into())
    }
}

impl From<serde_json::Error> for DeclareError {
    fn from(error: serde_json::Error) -> Self {
        Self::Internal(error.into())
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
pub struct DeclareResponse {
    pub incident_id: String,
    pub created: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeclarePreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate: Option<DeclareCandidate>,
    pub routing: DeclareRouting,
    pub oncall_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downtime: Option<ActiveDowntime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onset: Option<DeclareOnset>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeclareCandidate {
    pub incident_id: String,
    pub title: Option<String>,
    pub reason: String,
    pub scope_match: ScopeMatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScopeMatch {
    Exact,
    Possible,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeclareRouting {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<String>,
    pub responders: Vec<Value>,
    pub no_route: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeclareOnset {
    pub at: i64,
    pub method: &'static str,
}

struct Subject<'a> {
    org: &'a str,
    source: Option<&'a ContextSource>,
    groups: HashMap<String, String>,
    impact_start_at: Option<i64>,
    now: i64,
}

impl Subject<'_> {
    fn window_start(&self) -> i64 {
        self.source
            .map(|source| source.target.start_us)
            .or(self.impact_start_at)
            .unwrap_or(self.now)
    }

    fn streams(&self) -> Option<String> {
        let target = &self.source?.target;
        (!target.streams.is_empty()).then(|| target.streams.join(","))
    }

    fn non_service_fingerprint(&self) -> Option<String> {
        if self.groups.contains_key("service") {
            return None;
        }
        let target = &self.source?.target;
        let query = target.fingerprint.as_deref()?;
        Some(source::sha256(&format!(
            "streams={}\nquery={query}",
            target.streams.join(",")
        )))
    }
}

struct Prepared<'a> {
    subject: Subject<'a>,
    request: &'a DeclareRequest,
    user: &'a str,
    key: &'a str,
    note: Option<String>,
    summary: Option<ResultSummary>,
    team: Option<String>,
}

enum WriteResult {
    Replay(DeclareResponse),
    KeyTaken,
    Written(DeclareResponse),
}

struct Attachment<'a> {
    source: &'a ContextSource,
    role: &'static str,
    author: &'a str,
    note: Option<&'a str>,
    key: Option<&'a str>,
    summary: Option<&'a ResultSummary>,
    now: i64,
}

struct Metadata<'a> {
    id: &'a str,
    role: &'a str,
    kind: &'a str,
    author: &'a str,
    title: &'a str,
    window: (i64, i64),
}

trait DeclareRuntime: Sync {
    fn authorize(
        &self,
        user: &str,
        sources: &[QuerySource],
    ) -> impl Future<Output = Result<(), DeclareError>> + Send {
        async move {
            crate::authz::authorize_query_sources(user, sources)
                .await
                .map_err(|_| DeclareError::Forbidden)
        }
    }

    fn capture(
        &self,
        org: &str,
        user: &str,
        source: &ContextSource,
    ) -> impl Future<Output = ResultSummary> + Send;

    fn onset(
        &self,
        org: &str,
        user: &str,
        source: &ContextSource,
    ) -> impl Future<Output = Option<i64>> + Send;

    fn routing(
        &self,
        org: &str,
        dimensions: &HashMap<String, String>,
        fallback: Option<&str>,
    ) -> impl Future<Output = Result<DeclareRouting, DeclareError>> + Send;

    fn oncall_enabled(&self) -> bool;

    fn now(&self) -> i64 {
        now_micros()
    }

    fn muted_downtime(
        &self,
        org: &str,
        dimensions: &HashMap<String, String>,
        at: i64,
    ) -> Option<String> {
        downtimes::active_for_declare(org, dimensions, at)
            .filter(|window| window.incident_mode.is_muted())
            .map(|window| window.id)
    }

    fn destinations(
        &self,
        txn: &DatabaseTransaction,
        incident: &Incident,
    ) -> impl Future<Output = anyhow::Result<Vec<String>>> + Send {
        async move { effects::destinations(txn, incident).await }
    }

    fn run_effect(
        &self,
        effect: effects::Dispatch<'_>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

struct Live;

impl DeclareRuntime for Live {
    async fn capture(&self, org: &str, user: &str, source: &ContextSource) -> ResultSummary {
        capture::capture(org, user, source).await
    }

    async fn onset(&self, org: &str, user: &str, source: &ContextSource) -> Option<i64> {
        capture::onset(org, user, source).await
    }

    async fn routing(
        &self,
        org: &str,
        dimensions: &HashMap<String, String>,
        fallback: Option<&str>,
    ) -> Result<DeclareRouting, DeclareError> {
        let mut routed = routing::decide(org, None, dimensions).await?;
        if let Some(team) = selected_team(&routed.decision, fallback) {
            routed = routing::decide(org, Some(team), dimensions).await?;
        }
        let winning_rule = match &routed.decision {
            RoutingDecision::Ownership { rule_id, .. } => Some(rule_id.as_str()),
            _ => None,
        };
        let team = routed.team_id().map(str::to_owned);
        let responders = match insight::routing_context(
            org,
            team.as_deref(),
            winning_rule,
            dimensions,
            now_micros(),
        )
        .await
        {
            Ok(context) => context
                .current_responder
                .map(serde_json::to_value)
                .transpose()?
                .into_iter()
                .collect(),
            Err(error) => {
                log::warn!("[incidents] Declare routing preview in {org}: {error}");
                Vec::new()
            }
        };
        Ok(DeclareRouting {
            no_route: team.is_none(),
            team,
            responders,
        })
    }

    fn oncall_enabled(&self) -> bool {
        oncall::is_enabled()
    }

    async fn run_effect(&self, effect: effects::Dispatch<'_>) -> anyhow::Result<()> {
        effects::dispatch(effect).await
    }
}

pub fn validate_key(key: &str) -> Result<(), DeclareError> {
    if key.trim().is_empty() || key.chars().count() > 64 {
        return Err(DeclareError::bad(
            "Idempotency-Key must have 1 to 64 characters",
        ));
    }
    Ok(())
}

pub async fn preview_declare(
    org: &str,
    user: &str,
    request: DeclareRequest,
) -> Result<DeclarePreview, DeclareError> {
    preview_with(org, user, request, &Live).await
}

pub async fn declare_incident(
    org: &str,
    user: &str,
    key: &str,
    request: DeclareRequest,
) -> Result<DeclareResponse, DeclareError> {
    declare_with(org, user, key, request, &Live).await
}

pub async fn add_context(
    org: &str,
    id: &str,
    user: &str,
    key: Option<&str>,
    request: AddContextRequest,
) -> Result<String, DeclareError> {
    add_context_with(org, id, user, key, request, &Live).await
}

pub async fn list_contexts(org: &str, id: &str, user: &str) -> Result<Vec<Value>, DeclareError> {
    list_contexts_with(org, id, user, &Live).await
}

pub async fn get_context(
    org: &str,
    id: &str,
    cid: &str,
    user: &str,
) -> Result<Value, DeclareError> {
    get_context_with(org, id, cid, user, &Live).await
}

pub(super) async fn team_has_member(team: &str, user: &str) -> Result<bool, DeclareError> {
    Ok(infra::table::oncall_teams::list_members(team)
        .await?
        .iter()
        .any(|entry| entry.user_email.eq_ignore_ascii_case(user)))
}

pub(super) async fn may_page_team(org: &str, user: &str, team: &str) -> Result<bool, DeclareError> {
    Ok(team_has_member(team, user).await?
        || crate::auth::check_permissions(
            org, org, user, "oncall", "PUT", None, true, false, false,
        )
        .await)
}

async fn list_contexts_with(
    org: &str,
    id: &str,
    user: &str,
    runtime: &impl DeclareRuntime,
) -> Result<Vec<Value>, DeclareError> {
    let conn = get_orm_client_ro().await;
    alert_incidents::get_with(conn, org, id)
        .await?
        .ok_or(DeclareError::NotFound)?;
    let mut contexts = Vec::new();
    for row in incident_contexts::list_metadata(conn, org, id).await? {
        let readable = source::readable(org, user, &row.target, &row.kind, runtime).await;
        contexts.push(metadata(
            Metadata {
                id: &row.id,
                role: &row.role,
                kind: &row.kind,
                author: &row.created_by,
                title: &row.title,
                window: (row.start_at, row.end_at),
            },
            readable,
        ));
    }
    Ok(contexts)
}

async fn get_context_with(
    org: &str,
    id: &str,
    cid: &str,
    user: &str,
    runtime: &impl DeclareRuntime,
) -> Result<Value, DeclareError> {
    let row = incident_contexts::get(get_orm_client_ro().await, org, id, cid)
        .await?
        .ok_or(DeclareError::NotFound)?;
    let readable = source::readable(org, user, &row.target, &row.kind, runtime).await;
    let mut value = metadata(
        Metadata {
            id: &row.id,
            role: &row.role,
            kind: &row.kind,
            author: &row.created_by,
            title: &row.title,
            window: (row.start_at, row.end_at),
        },
        readable,
    );
    if readable {
        value["note"] = json!(row.note);
        value["target"] = serde_json::from_str(&row.target)?;
        value["origin"] = serde_json::from_str(&row.origin)?;
        if let Some(summary) = row.result_summary {
            value["result_summary"] = serde_json::from_str(&summary)?;
        }
    }
    Ok(value)
}

fn metadata(row: Metadata<'_>, readable: bool) -> Value {
    let mut value = json!({
        "kind": row.kind,
        "created_by": row.author,
        "start_at": row.window.0,
        "end_at": row.window.1,
        "title": if readable { row.title } else { "Restricted context" },
    });
    if readable {
        value["id"] = json!(row.id);
        value["role"] = json!(row.role);
    }
    value
}

async fn preview_with(
    org: &str,
    user: &str,
    mut request: DeclareRequest,
    runtime: &impl DeclareRuntime,
) -> Result<DeclarePreview, DeclareError> {
    let source = prepare_source(org, user, request.source.take(), runtime).await?;
    validate_request(org, user, &request).await?;
    let subject = subject(org, &request, source.as_ref(), runtime.now());
    let conn = get_orm_client_ro().await;
    let candidate = candidate::find(conn, &subject)
        .await?
        .map(candidate::Candidate::preview);
    let (routing, onset) = tokio::join!(
        runtime.routing(org, &subject.groups, request.page_team_id.as_deref()),
        measure_onset(org, user, source.as_ref(), runtime)
    );
    Ok(DeclarePreview {
        candidate,
        routing: routing?,
        oncall_enabled: runtime.oncall_enabled(),
        downtime: downtimes::active_for_declare(org, &subject.groups, subject.now),
        onset,
    })
}

async fn declare_with(
    org: &str,
    user: &str,
    key: &str,
    mut request: DeclareRequest,
    runtime: &impl DeclareRuntime,
) -> Result<DeclareResponse, DeclareError> {
    validate_key(key)?;
    let source = prepare_source(org, user, request.source.take(), runtime).await?;
    let db = get_orm_client_rw().await;
    if let Some(response) = replay(db, org, key).await? {
        effects::resume(org, key, &response, runtime).await;
        return Ok(response);
    }
    let note = validate_request(org, user, &request).await?;
    let mut prepared = prepare_write(
        subject(org, &request, source.as_ref(), runtime.now()),
        user,
        key,
        &request,
        note,
        runtime,
    )
    .await?;
    let txn = db.begin().await?;
    let response = match write_declare(&txn, &mut prepared, runtime).await? {
        WriteResult::Replay(response) => {
            txn.rollback().await?;
            response
        }
        WriteResult::KeyTaken => {
            txn.rollback().await?;
            replay(db, org, key).await?.ok_or(DeclareError::NotFound)?
        }
        WriteResult::Written(response) => {
            txn.commit().await?;
            infra::race_point!("declare.after_commit");
            response
        }
    };
    effects::resume(org, key, &response, runtime).await;
    Ok(response)
}

async fn add_context_with(
    org: &str,
    id: &str,
    user: &str,
    key: Option<&str>,
    request: AddContextRequest,
    runtime: &impl DeclareRuntime,
) -> Result<String, DeclareError> {
    if let Some(key) = key {
        validate_key(key)?;
    }
    let mut source = source::prepare(org, user, request.source, runtime).await?;
    let note = validate_note(request.note.as_deref())?;
    let db = get_orm_client_rw().await;
    if let Some(key) = key
        && let Some(cid) = incident_contexts::get_id_by_key(db, org, id, key).await?
    {
        return Ok(cid);
    }
    alert_incidents::get_with(db, org, id)
        .await?
        .ok_or(DeclareError::NotFound)?;
    cap_context_window(&mut source, runtime.now())?;
    let summary = capture_summary(org, user, Some(&source), runtime).await;
    let attachment = Attachment {
        source: &source,
        role: "added",
        author: user,
        note: note.as_deref(),
        key,
        summary: summary.as_ref(),
        now: now_micros(),
    };
    infra::race_point!("declare.before_context_lock");
    let txn = db.begin().await?;
    let incident = alert_incidents::get_locked(&txn, org, id)
        .await?
        .ok_or(DeclareError::NotFound)?;
    if let Some(key) = key {
        if let Some(cid) = incident_contexts::get_id_by_key(&txn, org, id, key).await? {
            txn.rollback().await?;
            return Ok(cid);
        }
        if incident_declare_keys::get(&txn, org, key)
            .await?
            .is_some_and(|row| row.incident_id == id)
        {
            return Err(DeclareError::Conflict(KEY_IN_USE));
        }
    }
    let cid = insert_context(&txn, &incident, attachment).await?;
    txn.commit().await?;
    Ok(cid)
}

fn selected_team<'a>(routing: &RoutingDecision, fallback: Option<&'a str>) -> Option<&'a str> {
    match routing {
        RoutingDecision::Ownership { .. } | RoutingDecision::Explicit { .. } => None,
        RoutingDecision::Default { .. } | RoutingDecision::Unrouted => fallback,
    }
}

fn cap_context_window(source: &mut ContextSource, now: i64) -> Result<(), DeclareError> {
    source.target.end_us = source.target.end_us.min(now);
    if source.target.start_us >= source.target.end_us {
        return Err(DeclareError::bad(
            "Context window must start before capture time",
        ));
    }
    Ok(())
}

async fn prepare_source(
    org: &str,
    user: &str,
    source: Option<ContextSource>,
    runtime: &impl DeclareRuntime,
) -> Result<Option<ContextSource>, DeclareError> {
    match source {
        Some(source) => {
            let mut source = source::prepare(org, user, source, runtime).await?;
            cap_context_window(&mut source, runtime.now())?;
            Ok(Some(source))
        }
        None => Ok(None),
    }
}

async fn validate_request(
    org: &str,
    user: &str,
    request: &DeclareRequest,
) -> Result<Option<String>, DeclareError> {
    if request.title.trim().is_empty() || request.title.chars().count() > 256 {
        return Err(DeclareError::bad("Title must have 1 to 256 characters"));
    }
    if let Some(team) = request.page_team_id.as_deref() {
        authorize_team(org, user, team).await?;
    }
    validate_note(request.note.as_deref())
}

fn validate_note(note: Option<&str>) -> Result<Option<String>, DeclareError> {
    let Some(note) = note.map(str::trim).filter(|note| !note.is_empty()) else {
        return Ok(None);
    };
    if note.chars().count() > 1000 || note.contains(['\r', '\n']) {
        return Err(DeclareError::bad(
            "Note must be one line of at most 1000 characters",
        ));
    }
    rca_steering::validate_guidance(note)
        .map(Some)
        .map_err(|_| DeclareError::bad("Invalid note"))
}

async fn authorize_team(org: &str, user: &str, team: &str) -> Result<(), DeclareError> {
    if infra::table::oncall_teams::get(org, team).await?.is_some()
        && may_page_team(org, user, team).await?
    {
        return Ok(());
    }
    Err(DeclareError::Forbidden)
}

fn subject<'a>(
    org: &'a str,
    request: &DeclareRequest,
    source: Option<&'a ContextSource>,
    now: i64,
) -> Subject<'a> {
    let groups = [
        ("service", request.service.as_deref()),
        ("env", request.env.as_deref()),
        ("region", request.region.as_deref()),
    ]
    .into_iter()
    .filter_map(|(name, value)| {
        let value = routing::normalize_value(value?);
        (!value.is_empty() && value != "unknown").then(|| (name.to_owned(), value))
    })
    .collect();
    Subject {
        org,
        source,
        groups,
        impact_start_at: request.impact_start_at,
        now,
    }
}

async fn measure_onset(
    org: &str,
    user: &str,
    source: Option<&ContextSource>,
    runtime: &impl DeclareRuntime,
) -> Option<DeclareOnset> {
    let source = source?;
    if let Some(at) = source.origin.selection_start_us
        && (source.target.start_us..source.target.end_us).contains(&at)
    {
        return Some(DeclareOnset {
            at,
            method: "selection",
        });
    }
    let detected = if source.target.has_query() {
        runtime.onset(org, user, source).await
    } else {
        None
    };
    Some(match detected {
        Some(at) => DeclareOnset {
            at,
            method: "detected",
        },
        None => DeclareOnset {
            at: source.target.start_us,
            method: "window_start",
        },
    })
}

async fn capture_summary(
    org: &str,
    user: &str,
    source: Option<&ContextSource>,
    runtime: &impl DeclareRuntime,
) -> Option<ResultSummary> {
    let source = source.filter(|source| source.target.has_query())?;
    Some(runtime.capture(org, user, source).await)
}

async fn prepare_write<'a>(
    mut subject: Subject<'a>,
    user: &'a str,
    key: &'a str,
    request: &'a DeclareRequest,
    note: Option<String>,
    runtime: &impl DeclareRuntime,
) -> Result<Prepared<'a>, DeclareError> {
    let org = subject.org;
    let (summary, onset, routing) = tokio::join!(
        capture_summary(org, user, subject.source, runtime),
        async {
            if subject.impact_start_at.is_some() {
                return None;
            }
            measure_onset(org, user, subject.source, runtime).await
        },
        runtime.routing(org, &subject.groups, request.page_team_id.as_deref()),
    );
    subject.impact_start_at = subject.impact_start_at.or(onset.map(|onset| onset.at));
    Ok(Prepared {
        subject,
        request,
        user,
        key,
        note,
        summary,
        team: routing?.team,
    })
}

async fn replay<C: ConnectionTrait>(
    db: &C,
    org: &str,
    key: &str,
) -> Result<Option<DeclareResponse>, DeclareError> {
    let Some(row) = incident_declare_keys::get(db, org, key).await? else {
        return Ok(None);
    };
    let context_id = incident_contexts::get_id_by_key(db, org, &row.incident_id, key).await?;
    Ok(Some(DeclareResponse {
        incident_id: row.incident_id,
        created: row.created,
        context_id,
    }))
}

async fn lock_declare(
    txn: &DatabaseTransaction,
    subject: &Subject<'_>,
) -> Result<(), DeclareError> {
    let org = subject.org;
    infra::race_point!("declare.before_lock");
    if let Some(service) = subject.groups.get("service") {
        alert_incidents::lock_correlation(
            txn,
            &format!("incident_declare/{org}/service/{service}"),
        )
        .await?;
    }
    if let Some(streams) = subject.streams() {
        alert_incidents::lock_correlation(
            txn,
            &format!("incident_declare/{org}/streams/{streams}"),
        )
        .await?;
    }
    Ok(())
}

async fn write_declare(
    txn: &DatabaseTransaction,
    prepared: &mut Prepared<'_>,
    runtime: &impl DeclareRuntime,
) -> Result<WriteResult, DeclareError> {
    lock_declare(txn, &prepared.subject).await?;
    prepared.subject.now = clock_micros(txn).await?;
    let subject = &prepared.subject;
    let org = subject.org;
    if let Some(response) = replay(txn, org, prepared.key).await? {
        return Ok(WriteResult::Replay(response));
    }
    let existing = match candidate::find(txn, subject).await? {
        Some(candidate) if candidate.scope == ScopeMatch::Exact => {
            alert_incidents::get_locked(txn, org, &candidate.incident.id)
                .await?
                .filter(|incident| candidate::still_matches(&candidate, incident, subject))
        }
        _ => None,
    };
    let (priority, team) = page_plan(prepared, existing.as_ref())?;
    let (incident, created) = match existing {
        Some(incident) => (incident, false),
        None => (open_incident(txn, prepared, runtime).await?, true),
    };
    infra::race_point!("declare.before_key_insert");
    let reserved = incident_declare_keys::insert_in(
        txn,
        infra::table::entity::incident_declare_keys::Model {
            org_id: org.to_owned(),
            declare_key: prepared.key.to_owned(),
            incident_id: incident.id.clone(),
            created,
            created_at: subject.now,
        },
    )
    .await?;
    if !reserved {
        return Ok(WriteResult::KeyTaken);
    }
    let context_id = record_declare(txn, prepared, &incident, created).await?;
    let incident = if priority.is_some() && !created {
        raise_severity(txn, incident, prepared.request.severity).await?
    } else {
        incident
    };
    let response = DeclareResponse {
        incident_id: incident.id.clone(),
        created,
        context_id,
    };
    effects::record(txn, prepared, &incident, &response, priority, team, runtime).await?;
    Ok(WriteResult::Written(response))
}

async fn open_incident(
    txn: &DatabaseTransaction,
    prepared: &Prepared<'_>,
    runtime: &impl DeclareRuntime,
) -> Result<Incident, DeclareError> {
    let subject = &prepared.subject;
    let muted_by = if prepared.request.page_through_downtime {
        None
    } else {
        runtime.muted_downtime(subject.org, &subject.groups, runtime.now())
    };
    Ok(alert_incidents::insert_declared_in(
        txn,
        DeclaredIncident {
            org: subject.org,
            severity: prepared.request.severity.as_str(),
            title: &prepared.request.title,
            groups: serde_json::to_value(&subject.groups)?,
            now: subject.now,
            impact_start_at: subject.impact_start_at,
            source_fingerprint: subject.non_service_fingerprint(),
            owner_team_id: prepared.team.clone(),
            muted_by,
        },
    )
    .await?)
}

fn page_plan(
    prepared: &Prepared<'_>,
    incident: Option<&Incident>,
) -> Result<(Option<AlertPriority>, Option<String>), DeclareError> {
    let severity = prepared.request.severity;
    let priority = match severity {
        IncidentSeverity::P1 => Some(AlertPriority::P1),
        IncidentSeverity::P2 => Some(AlertPriority::P2),
        IncidentSeverity::P3 | IncidentSeverity::P4 => None,
    };
    let team = prepared
        .team
        .clone()
        .or_else(|| incident.and_then(|row| row.owner_team_id.clone()));
    if priority.is_some() && team.is_none() {
        return Err(DeclareError::NoTeam);
    }
    let current = incident
        .map(|row| row.severity.parse::<IncidentSeverity>())
        .transpose()
        .map_err(anyhow::Error::msg)?;
    let priority =
        priority.filter(|_| current.is_none_or(|level| severity.as_str() < level.as_str()));
    Ok((priority, team))
}

async fn record_declare(
    txn: &DatabaseTransaction,
    prepared: &Prepared<'_>,
    incident: &Incident,
    created: bool,
) -> Result<Option<String>, DeclareError> {
    if incident_contexts::get_id_by_key(txn, &incident.org_id, &incident.id, prepared.key)
        .await?
        .is_some()
    {
        return Err(DeclareError::Conflict(KEY_IN_USE));
    }
    if created {
        append(
            txn,
            incident,
            prepared.subject.now,
            IncidentEventType::Declared {
                declared_by: prepared.user.to_owned(),
            },
        )
        .await?;
    }
    let Some(source) = prepared.subject.source else {
        return Ok(None);
    };
    let attachment = Attachment {
        source,
        role: if created { "declared" } else { "added" },
        author: prepared.user,
        note: prepared.note.as_deref(),
        key: Some(prepared.key),
        summary: prepared.summary.as_ref(),
        now: prepared.subject.now,
    };
    insert_context(txn, incident, attachment).await.map(Some)
}

async fn insert_context(
    txn: &DatabaseTransaction,
    incident: &Incident,
    attachment: Attachment<'_>,
) -> Result<String, DeclareError> {
    let source = attachment.source;
    let id = Ksuid::new(None, None).to_string();
    let row = ContextRow {
        id: id.clone(),
        org_id: incident.org_id.clone(),
        incident_id: incident.id.clone(),
        role: attachment.role.to_owned(),
        kind: source.kind.as_str().to_owned(),
        title: source.title.clone(),
        note: attachment.note.map(str::to_owned),
        target: serde_json::to_string(&source.target)?,
        origin: serde_json::to_string(&source.origin)?,
        start_at: source.target.start_us,
        end_at: source.target.end_us,
        result_summary: attachment.summary.map(serde_json::to_string).transpose()?,
        bytes: 0,
        client_key: attachment.key.map(str::to_owned),
        created_by: attachment.author.to_owned(),
        deleted_at: None,
        created_at: attachment.now,
        updated_at: attachment.now,
    };
    if !incident_contexts::insert_in(txn, row).await? {
        return Err(DeclareError::Conflict(ATTACHMENT_LIMIT));
    }
    if attachment.role == "added" {
        append(
            txn,
            incident,
            attachment.now,
            IncidentEventType::ContextAttached {
                context_id: id.clone(),
                kind: source.kind,
            },
        )
        .await?;
    }
    Ok(id)
}

async fn append(
    txn: &DatabaseTransaction,
    incident: &Incident,
    at: i64,
    event_type: IncidentEventType,
) -> Result<(), DeclareError> {
    incident_events::append_in(
        txn,
        &incident.org_id,
        &incident.id,
        IncidentEvent {
            timestamp: at,
            seq: 0,
            event_type,
        },
    )
    .await?;
    Ok(())
}

async fn raise_severity(
    txn: &DatabaseTransaction,
    incident: Incident,
    severity: IncidentSeverity,
) -> Result<Incident, DeclareError> {
    let previous = incident
        .severity
        .parse::<IncidentSeverity>()
        .map_err(anyhow::Error::msg)?;
    let event =
        IncidentEvent::severity_upgrade(previous, severity, "Incident declared at higher severity");
    incident_events::append_in(txn, &incident.org_id, &incident.id, event).await?;
    let mut row: infra::table::entity::alert_incidents::ActiveModel = incident.into();
    row.severity = Set(severity.as_str().to_owned());
    row.updated_at = Set(now_micros());
    Ok(row.update(txn).await?)
}

#[cfg(test)]
pub(super) mod tests;
