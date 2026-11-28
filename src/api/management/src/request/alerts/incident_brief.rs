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

#[cfg(feature = "enterprise")]
mod changes;
#[cfg(feature = "enterprise")]
mod impact;
#[cfg(feature = "enterprise")]
mod read;

use axum::{
    extract::{Path, Query},
    http::HeaderMap,
    response::Response,
};
use config::meta::{
    alerts::{
        incidents::CorrelationReason,
        what_changed::{ChangeCoverage, ChangeRow},
    },
    oncall::ResponseState,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[cfg(not(feature = "enterprise"))]
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct BriefQuery {
    #[serde(default)]
    pub refresh: bool,
}

#[derive(Serialize, ToSchema)]
#[schema(as = IncidentBrief)]
struct Brief {
    impact: Impact,
    onset: Onset,
    evidence_against_impact: Vec<EvidenceAgainstImpact>,
    changes: Vec<ChangeRow>,
    change_coverage: ChangeCoverage,
    owner: Owner,
    responders: Vec<Responder>,
    declared_no_alert: bool,
    similar: Vec<String>,
    related_active: Vec<String>,
    grouping: Grouping,
    hidden: Vec<HiddenSection>,
    computed_at: i64,
}

#[derive(Clone, Copy, Serialize, ToSchema)]
struct Onset {
    at: i64,
    precision_secs: i64,
}

#[derive(Serialize, ToSchema)]
struct Owner {
    #[serde(skip_serializing_if = "Option::is_none")]
    team_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lead: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    comms: Option<String>,
}

#[derive(Serialize, ToSchema)]
struct Responder {
    #[serde(skip_serializing_if = "Option::is_none")]
    responder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    responder_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
    ack_state: ResponseState,
}

#[derive(Serialize, ToSchema)]
struct Grouping {
    reason: CorrelationReason,
    alert_count: i32,
}

#[derive(PartialEq, Eq, PartialOrd, Ord, Serialize, ToSchema)]
struct HiddenSection {
    section: &'static str,
    stream_type: String,
    stream: String,
}

#[derive(Clone, Default, Serialize, ToSchema)]
struct ImpactScope {
    services: Vec<String>,
    envs: Vec<String>,
    regions: Vec<String>,
}

#[derive(Clone, Serialize, ToSchema)]
#[schema(as = IncidentBriefImpact)]
struct Impact {
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    baseline: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trend: Option<Trend>,
    #[serde(skip_serializing_if = "Option::is_none")]
    series: Option<Vec<(i64, f64)>>,
    source: Option<ImpactSource>,
    availability: Availability,
    scope: ImpactScope,
}

#[derive(Clone, Serialize, ToSchema)]
struct EvidenceAgainstImpact {
    source: ImpactSource,
    value: f64,
    baseline: f64,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImpactSource {
    Slo { id: String, name: String },
    Alert,
    TracesRed { service: String, stream: String },
}

#[derive(Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Measured,
    NoData,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Trend {
    Rising,
    Steady,
    Falling,
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/incidents/{incident_id}/brief",
    context_path = "/api",
    tag = "Incidents",
    operation_id = "GetIncidentBrief",
    summary = "Get an incident brief",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident id"),
        BriefQuery,
        ("If-None-Match" = Option<String>, Header, description = "ETag of the caller's cached brief"),
    ),
    responses(
        (status = 200, description = "Incident brief computed as the caller", body = Brief,
            headers(("ETag" = String, description = "Quoted computation timestamp"))),
        (status = 304, description = "The caller's brief is unchanged",
            headers(("ETag" = String, description = "Quoted computation timestamp"))),
        (status = 403, description = "Insufficient incident or case permission"),
        (status = 404, description = "Incident not found"),
        (status = 500, description = "Could not read the incident brief"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": true, "pinned": true, "description": "Get impact, changes, and responders for an incident", "category": "alerts"}))
    )
)]
pub async fn get(
    Path((org_id, incident_id)): Path<(String, String)>,
    Query(query): Query<BriefQuery>,
    Headers(user): Headers<UserEmail>,
    headers: HeaderMap,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match read::brief(&org_id, &incident_id, &user.user_id, &headers, query).await {
            Ok(response) => response,
            Err(response) => response,
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, incident_id, query, user, headers);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[cfg(all(test, feature = "enterprise"))]
mod tests;
