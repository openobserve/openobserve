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

use std::{
    collections::{BTreeSet, HashMap, hash_map::Entry},
    str::FromStr,
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicI64, Ordering},
    },
    time::{Duration, Instant},
};

use axum::{
    Json,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    meta::{
        alerts::{
            alert::Alert,
            change_events::CHANGE_EVENTS_STREAM,
            incidents::{
                AlertKind, CorrelationReason, IncidentEventType, IncidentTopology,
                affected_services,
            },
            what_changed::WhatChanged,
        },
        stream::StreamType,
    },
    utils::{sql::quote_identifier, time::now_micros},
};
use infra::{
    db::get_orm_client_rw,
    idempotency::canonical_sha256,
    table::{
        alert_incidents,
        entity::{alert_incident_alerts::Model as Firing, alert_incidents::Model as Incident},
        incident_events, oncall_responses, oncall_teams, rca_fence,
    },
};
use openobserve_core::alerts::what_changed::{
    ChangeAccess, ChangeScope, ChangeSources, PreparedRead,
};
use serde::Deserialize;
use serde_json::{Value, json};
use svix_ksuid::Ksuid;

use super::{
    Brief, BriefQuery, Grouping, ImpactScope, Owner, Responder, changes,
    impact::{self, ImpactPlan},
};
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::security::{
        self,
        rca_scope::{self, RcaCaller},
    },
};

const BRIEF_TTL: Duration = Duration::from_secs(30);
static BRIEF_CACHE: LazyLock<Mutex<HashMap<CacheKey, CacheSlot>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static LAST_COMPUTED_AT: AtomicI64 = AtomicI64::new(0);

#[derive(Clone, Eq, Hash, PartialEq)]
struct CacheKey {
    incident_id: String,
    seq: i64,
    declared_no_alert: bool,
    authorization: String,
}

type CacheSlot = Arc<tokio::sync::Mutex<Option<Arc<CacheEntry>>>>;

struct CacheEntry {
    expires: Instant,
    body: Arc<Brief>,
    sources: ChangeSources,
}

struct BriefPlan {
    incident: Incident,
    grouping: Grouping,
    declared_no_alert: bool,
    impact: ImpactPlan,
    services: Vec<String>,
    scope: ChangeScope,
}

struct BriefAccess {
    caller: RcaCaller,
    case_read: bool,
    history_read: bool,
    security_case: bool,
}

impl BriefAccess {
    fn fingerprint(
        &self,
        impact: &ImpactPlan,
        changes: &ChangeAccess,
        raw_streams: &BTreeSet<String>,
    ) -> String {
        authorization_fingerprint(
            json!({
                "streams": impact.readable_streams,
                "slos": impact.readable_slos,
                "impact_query_access": impact.query_access,
                "impact_denials": impact.hidden,
                "changes": changes,
                "case_read": self.case_read,
                "security_case": self.security_case,
                "history_read": self.history_read,
            }),
            raw_streams,
        )
    }
}

pub(super) async fn brief(
    org: &str,
    id: &str,
    viewer: &str,
    headers: &HeaderMap,
    query: BriefQuery,
) -> Result<Response, Response> {
    let caller = rca_scope::rca_caller(org, viewer, headers).await;
    if !rca_scope::may_read_incident(org, &caller, id).await {
        return Err(MetaHttpResponse::forbidden(
            "This analysis cannot read that incident",
        ));
    }
    security::guard_case(org, viewer, "GET", id).await?;
    let seq = incident_events::seq_with(get_orm_client_rw().await, org, id)
        .await
        .map_err(MetaHttpResponse::internal_error)?;
    let incident = alert_incidents::get_rw(org, id)
        .await
        .map_err(MetaHttpResponse::internal_error)?
        .ok_or_else(|| MetaHttpResponse::not_found("Incident not found"))?;
    let case_read = security::security_allowed(org, viewer, "GET").await;
    if incident.security_case && !case_read {
        return Err(MetaHttpResponse::forbidden(security::case_refusal("GET")));
    }

    let access = BriefAccess {
        history_read: rca_scope::may_read_run_history(org, &caller, id).await,
        caller,
        case_read,
        security_case: incident.security_case,
    };
    let plan = prepare(incident, viewer).await.map_err(|error| {
        log::error!("[incident brief] {org}/{id}: {error:#}");
        MetaHttpResponse::internal_error("Could not prepare incident brief")
    })?;
    let body = cache_brief(plan, &access, viewer, seq, query)
        .await
        .map_err(MetaHttpResponse::internal_error)?;
    let response = brief_response(&body, headers);
    infra::race_point!("incident_brief.before_response");
    finish_read(&access, org, id, viewer, headers, response.status()).await?;
    Ok(response)
}

async fn finish_read(
    access: &BriefAccess,
    org: &str,
    id: &str,
    viewer: &str,
    headers: &HeaderMap,
    status: StatusCode,
) -> Result<(), Response> {
    let forbidden = || MetaHttpResponse::forbidden("The brief's access changed during the read");
    let caller = rca_scope::rca_caller(org, viewer, headers).await;
    if caller != access.caller || !rca_scope::may_read_incident(org, &caller, id).await {
        return Err(forbidden());
    }
    let case_read = security::security_allowed(org, viewer, "GET").await;
    let incident = alert_incidents::get_rw(org, id)
        .await
        .map_err(MetaHttpResponse::internal_error)?
        .ok_or_else(|| MetaHttpResponse::not_found("Incident not found"))?;
    if incident.security_case && !case_read {
        return Err(MetaHttpResponse::forbidden(security::case_refusal("GET")));
    }
    if incident.security_case != access.security_case || case_read != access.case_read {
        return Err(forbidden());
    }
    if let RcaCaller::Bound { run_id, .. } = &caller
        && caller.own_incident() != Some(id)
        && status == StatusCode::OK
    {
        let session = headers
            .get(rca_scope::ASSISTANT_SESSION_HEADER)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(forbidden)?;
        if !rca_fence::record_incident_history_read(org, run_id, session, id)
            .await
            .map_err(MetaHttpResponse::internal_error)?
        {
            return Err(forbidden());
        }
    }
    Ok(())
}

fn brief_response(brief: &Brief, request: &HeaderMap) -> Response {
    let etag = format!("\"{}\"", brief.computed_at);
    let matched = request
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .any(|tag| tag == "*" || tag.strip_prefix("W/").unwrap_or(tag) == etag);
    let mut response = if matched {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        Json(brief).into_response()
    };
    if let Ok(value) = HeaderValue::from_str(&etag) {
        response.headers_mut().insert(header::ETAG, value);
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    response.headers_mut().append(
        header::VARY,
        HeaderValue::from_static("Authorization, Cookie"),
    );
    response
}

async fn prepare(incident: Incident, viewer: &str) -> anyhow::Result<BriefPlan> {
    let firings = alert_incidents::get_incident_alerts_rw(&incident.id).await?;
    let declared_no_alert = firings.is_empty()
        && incident_events::get_rw(&incident.org_id, &incident.id)
            .await?
            .iter()
            .any(|event| matches!(event.event_type, IncidentEventType::Declared { .. }));
    let opening = firings
        .iter()
        .min_by_key(|firing| (firing.alert_fired_at, firing.created_at, &firing.alert_id));
    let alert = load_opening_alert(&incident.org_id, opening).await?;
    let topology = incident.topology_context.as_ref().and_then(|value| {
        match IncidentTopology::deserialize(value) {
            Ok(topology) => Some(topology),
            Err(error) => {
                log::warn!(
                    "[incident brief] invalid topology for {}: {error}",
                    incident.id
                );
                None
            }
        }
    });
    let services = affected_services(&incident.group_values, topology.as_ref());
    let scope = ChangeScope::from_group_values(&incident.group_values);
    let impact_scope = ImpactScope {
        services: services.clone(),
        envs: scope.env.iter().cloned().collect(),
        regions: scope.region.iter().cloned().collect(),
    };
    let mut impact = impact::plan(&incident, alert, opening, impact_scope, viewer).await?;
    impact.hidden.sort_unstable();
    impact.hidden.dedup();
    let reason = opening
        .and_then(|firing| firing.correlation_reason.as_deref())
        .and_then(|reason| reason.parse().ok())
        .unwrap_or(CorrelationReason::AlertId);
    let grouping = Grouping {
        reason,
        alert_count: incident.alert_count,
    };
    Ok(BriefPlan {
        incident,
        grouping,
        declared_no_alert,
        impact,
        services,
        scope,
    })
}

async fn load_opening_alert(org: &str, firing: Option<&Firing>) -> anyhow::Result<Option<Alert>> {
    let Some(local) =
        firing.filter(|row| AlertKind::from_stored(&row.alert_kind) == AlertKind::Internal)
    else {
        return Ok(None);
    };
    let id = match Ksuid::from_str(&local.alert_id) {
        Ok(id) => id,
        Err(error) => {
            log::warn!(
                "[incident brief] invalid opening alert for {}: {error}",
                local.incident_id
            );
            return Ok(None);
        }
    };
    Ok(
        db::alerts::alert::get_by_id(get_orm_client_rw().await, org, id)
            .await?
            .map(|(_, alert)| alert),
    )
}

fn cache_slot(key: CacheKey) -> CacheSlot {
    let mut cache = BRIEF_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    cache.retain(|_, slot| {
        Arc::strong_count(slot) > 1
            || slot
                .try_lock()
                .is_ok_and(|entry| entry.as_ref().is_some_and(|entry| now < entry.expires))
    });
    cache.entry(key).or_default().clone()
}

fn authorization_fingerprint(mut access: Value, raw_streams: &BTreeSet<String>) -> String {
    if !raw_streams.is_empty() {
        access["raw_streams"] = json!(raw_streams);
    }
    canonical_sha256(&access)
}

async fn resolve_impact_raw(impact: &ImpactPlan, viewer: &str) -> BTreeSet<String> {
    let mut raw_streams = BTreeSet::new();
    for (org, stream_type, stream) in &impact.readable_streams {
        let sql = format!("SELECT * FROM {}", quote_identifier(stream));
        let raw = search_service::raw_streams::resolve(
            org,
            stream_type.as_str().into(),
            &sql,
            Some(viewer),
        )
        .await;
        raw_streams.extend(raw.to_vec());
    }
    raw_streams
}

async fn include_change_events_raw(
    mut raw_streams: BTreeSet<String>,
    org: &str,
    viewer: &str,
    changes: &ChangeAccess,
) -> BTreeSet<String> {
    if changes.reads_change_events() {
        let sql = format!("SELECT * FROM \"{CHANGE_EVENTS_STREAM}\"");
        let raw =
            search_service::raw_streams::resolve(org, StreamType::Logs, &sql, Some(viewer)).await;
        raw_streams.extend(raw.to_vec());
    }
    raw_streams
}

async fn cached_brief(
    plan: &BriefPlan,
    access: &BriefAccess,
    viewer: &str,
    seq: i64,
    impact_raw: &BTreeSet<String>,
) -> Option<Arc<Brief>> {
    let candidates = {
        let cache = BRIEF_CACHE
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        cache
            .iter()
            .filter(|(key, _)| {
                key.incident_id == plan.incident.id
                    && key.seq == seq
                    && key.declared_no_alert == plan.declared_no_alert
            })
            .filter_map(|(key, slot)| Some((key.clone(), slot.try_lock().ok()?.as_ref()?.clone())))
            .collect::<Vec<_>>()
    };
    for (key, cached) in candidates {
        if cached.expires <= Instant::now() {
            continue;
        }
        let changes = cached.sources.access(&plan.incident.org_id, viewer).await;
        let raw_streams =
            include_change_events_raw(impact_raw.clone(), &plan.incident.org_id, viewer, &changes)
                .await;
        if cached.expires > Instant::now()
            && key.authorization == access.fingerprint(&plan.impact, &changes, &raw_streams)
        {
            return Some(Arc::clone(&cached.body));
        }
    }
    None
}

async fn cache_brief(
    plan: BriefPlan,
    access: &BriefAccess,
    viewer: &str,
    seq: i64,
    query: BriefQuery,
) -> anyhow::Result<Arc<Brief>> {
    let impact_raw = resolve_impact_raw(&plan.impact, viewer).await;
    if !query.refresh
        && let Some(cached) = cached_brief(&plan, access, viewer, seq, &impact_raw).await
    {
        return Ok(cached);
    }
    let changes = changes::prepare(
        &plan.incident.org_id,
        viewer,
        &plan.scope,
        &plan.services,
        &plan.impact.onset,
        now_micros(),
    )
    .await;
    let raw_streams =
        include_change_events_raw(impact_raw, &plan.incident.org_id, viewer, changes.access())
            .await;
    let slot = cache_slot(CacheKey {
        incident_id: plan.incident.id.clone(),
        seq,
        declared_no_alert: plan.declared_no_alert,
        authorization: access.fingerprint(&plan.impact, changes.access(), &raw_streams),
    });
    let mut entry = slot.lock().await;
    if !query.refresh
        && let Some(cached) = entry
            .as_ref()
            .filter(|cached| Instant::now() < cached.expires)
    {
        return Ok(Arc::clone(&cached.body));
    }

    let sources = changes.sources().clone();
    let body = Arc::new(compute(plan, changes, &raw_streams).await?);
    *entry = Some(Arc::new(CacheEntry {
        expires: Instant::now() + BRIEF_TTL,
        body: Arc::clone(&body),
        sources,
    }));
    Ok(body)
}

async fn compute(
    plan: BriefPlan,
    changes: PreparedRead,
    raw_streams: &BTreeSet<String>,
) -> anyhow::Result<Brief> {
    let BriefPlan {
        incident,
        grouping,
        declared_no_alert,
        impact,
        ..
    } = plan;
    let computed_at = next_computed_at();
    let onset = impact.onset;
    let (result, evidence_against_impact) = impact.read(computed_at, raw_streams).await;
    let mut hidden = impact.hidden;
    let WhatChanged { changes, coverage } = changes::read(changes, &mut hidden, raw_streams).await;
    let responders = read_responders(&incident.org_id, &incident.id).await?;
    let owner = Owner {
        team_id: incident.owner_team_id,
        lead: incident.assigned_to,
        comms: incident.comms_owner,
    };
    hidden.sort_unstable();
    hidden.dedup();
    Ok(Brief {
        impact: result,
        onset,
        evidence_against_impact,
        changes,
        change_coverage: coverage,
        owner,
        responders,
        declared_no_alert,
        similar: Vec::new(),
        related_active: Vec::new(),
        grouping,
        hidden,
        computed_at,
    })
}

async fn read_responders(org: &str, id: &str) -> anyhow::Result<Vec<Responder>> {
    let mut responders = Vec::new();
    let mut team_names = HashMap::new();
    for record in oncall_responses::list_for_incident(org, id).await? {
        let team_name = match record.team_id.as_ref() {
            Some(team_id) => {
                if let Entry::Vacant(entry) = team_names.entry(team_id.clone()) {
                    let name = oncall_teams::get(org, team_id).await?.map(|team| team.name);
                    entry.insert(name);
                }
                team_names.get(team_id).cloned().flatten()
            }
            None => None,
        };
        let responder_name = match record.acked_by.as_deref() {
            Some(email) => openobserve_core::users::get_user(Some(org), email)
                .await
                .map(|user| {
                    format!("{} {}", user.first_name, user.last_name)
                        .trim()
                        .to_string()
                })
                .filter(|name| !name.is_empty()),
            None => None,
        };
        responders.push(Responder {
            responder: record.acked_by,
            responder_name,
            team_id: record.team_id,
            team_name,
            ack_state: record.state,
        });
    }
    Ok(responders)
}

fn next_computed_at() -> i64 {
    let now = now_micros();
    // A validator must identify one cached representation even when two computations share a tick.
    let advance = |last: i64| now.max(last.saturating_add(1));
    let last = LAST_COMPUTED_AT
        .try_update(Ordering::Relaxed, Ordering::Relaxed, |last| {
            Some(advance(last))
        })
        .unwrap_or_else(|last| last);
    advance(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_brief_fingerprint_distinguishes_raw_access() {
        let access = json!({"streams": [["org", "logs", "app"]]});
        let redacted = authorization_fingerprint(access.clone(), &BTreeSet::new());
        assert_eq!(redacted, canonical_sha256(&access));
        let raw = BTreeSet::from(["logs/app".to_string()]);
        assert_ne!(redacted, authorization_fingerprint(access, &raw));
    }
}
