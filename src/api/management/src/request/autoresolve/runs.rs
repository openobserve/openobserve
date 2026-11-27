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

//! The run page: the summary, the run list, starting a run, one run and its live stream, and
//! the decisions on its plan.

use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Path, Query, rejection::QueryRejection},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    meta::autoresolve::{CorrectionKind, PersonVerdict, RunState},
    utils::time::now_micros,
};
use infra::table::autoresolve_runs::RunFilter;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    alerts::rca_live::LIVE_PROBE_INTERVAL,
    autoresolve::{
        AutoResolveError, MAX_GOAL_CHARS,
        approve::{self, ApproveError, ReplanInput},
        corrections,
        live::{self, LiveRun},
        start_person_run,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::{IntoParams, ToSchema};

use super::{autoresolve_error, disabled, failed, parse_body, refusal, status_of};
use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::auth::UserEmail};

const DEFAULT_PAGE_SIZE: u64 = 25;
const MAX_PAGE_SIZE: u64 = 100;
const DEFAULT_WINDOW_US: i64 = 7 * 24 * 3600 * 1_000_000;
const RUN_NOT_FOUND: &str = "Run not found.";
const NO_CONNECTIONS_MESSAGE: &str =
    "No MCP is registered. Add one in AI Toolsets, then start the run again.";

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct RunsQuery {
    /// Comma-separated run states; every state when absent.
    pub state: Option<String>,
    /// The email of the person who started the run.
    pub requester: Option<String>,
    /// A connection id the run's steps use.
    pub connection: Option<String>,
    /// Runs created at or after this time, in microseconds; the last 7 days when neither bound
    /// is given.
    pub from_us: Option<i64>,
    /// Runs created before this time, in microseconds.
    pub to_us: Option<i64>,
    /// Text inside the goal, ignoring case.
    pub q: Option<String>,
    /// Only the runs of this saved AutoResolve.
    pub autoresolve_id: Option<String>,
    /// 1-based; 1 when absent.
    pub page: Option<u64>,
    /// 1 to 100; 25 when absent.
    pub page_size: Option<u64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct StartRunBody {
    /// What the run should achieve, in the person's words.
    pub goal: String,
    /// The MCP connections the run may use, 1 to the summary's `max_connections`; every turn
    /// loads only these.
    #[serde(default)]
    pub connection_ids: Vec<String>,
    /// The incident the run works on; refused with 409 while the incident has a live run.
    #[serde(default)]
    pub incident_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StartedRun {
    pub run_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ApproveBody {
    /// The option's id from the plan, `A` to `D`.
    pub option_id: String,
    /// The plan's `fingerprint`; a changed plan is refused.
    pub plan_fingerprint: String,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct DeclineBody {
    /// The plan's `fingerprint`; when given, a changed plan is refused.
    #[serde(default)]
    pub plan_fingerprint: Option<String>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ReplanBody {
    /// What the next plan should do differently; with a `kind`, at most 500 characters are kept.
    #[serde(default)]
    pub note: String,
    /// Makes the note a correction, stored with the run; `not_fixed` also answers an ended run.
    #[serde(default)]
    pub kind: Option<CorrectionKind>,
    /// Keep the correction for the saved AutoResolve's later runs; ignored on an ad-hoc run.
    #[serde(default = "remember_by_default")]
    pub remember: bool,
    /// The option the correction is about.
    #[serde(default)]
    pub option_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct VerdictBody {
    /// Only `fixed`; a "not fixed" answer is a replan with kind `not_fixed`.
    pub verdict: PersonVerdict,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddConnectionBody {
    /// The AI toolset id of an MCP connection the run does not have.
    pub connection_id: String,
}

/// AutoResolveGetSummary
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/summary",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveGetSummary",
    summary = "Get the AutoResolve page summary",
    description = "The MCP connections a person can choose for a run, at most `max_connections` of them, whether the caller may approve changes through each, and the region the runs live in.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Summary", content_type = "application/json", body = openobserve_core::autoresolve::live::AutoResolveSummary),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_summary(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match live::summary(&org_id, &user.user_id).await {
        Ok(summary) => MetaHttpResponse::json(summary),
        Err(e) => autoresolve_error("summary", e),
    }
}

/// AutoResolveGetIncident
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/incidents/{incident_id}",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveGetIncident",
    summary = "Get an incident's AutoResolve",
    description = "The incident's one run (its live run, else its newest), the saved AutoResolves whose trigger names an alert of the incident (incident-triggered first), and the RCA's probable cause as a goal for a new run.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("incident_id" = String, Path, description = "Incident id"),
    ),
    responses(
        (status = 200, description = "The incident's AutoResolve", content_type = "application/json", body = openobserve_core::autoresolve::incident::IncidentAutoResolve),
        (status = 404, description = "The incident is not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_incident(Path((org_id, incident_id)): Path<(String, String)>) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match openobserve_core::autoresolve::incident::view(&org_id, &incident_id).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(e) => autoresolve_error("incident", e),
    }
}

/// AutoResolveListRuns
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/runs",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveListRuns",
    summary = "List runs",
    description = "The org's runs, newest first, with the total behind the filters.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), RunsQuery),
    responses(
        (status = 200, description = "One page of runs", content_type = "application/json", body = openobserve_core::autoresolve::live::AutoResolveRunList),
        (status = 400, description = "An unknown state or a malformed parameter", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_runs(
    Path(org_id): Path<String>,
    query: Result<Query<RunsQuery>, QueryRejection>,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let Ok(Query(query)) = query else {
        return refusal(StatusCode::BAD_REQUEST, "A query parameter is malformed.");
    };
    let (filter, page, page_size) = match run_filter(query, now_micros()) {
        Ok(parsed) => parsed,
        Err(bad) => return bad,
    };
    match live::list_runs(&org_id, &filter, page, page_size).await {
        Ok(list) => MetaHttpResponse::json(list),
        Err(e) => autoresolve_error("list runs", e),
    }
}

/// AutoResolveStartRun
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveStartRun",
    summary = "Start a run",
    description = "Starts a run as the caller over the MCP connections chosen in the body. The run investigates and proposes a plan; nothing changes until someone approves an option.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = StartRunBody, description = "The goal and the chosen connections", content_type = "application/json"),
    responses(
        (status = 201, description = "Started", content_type = "application/json", body = StartedRun),
        (status = 400, description = "The body is not valid, or the connections are not: none, more than the summary's `max_connections`, an unknown one (an MCP the caller may not list is refused the same way), or one that is not an MCP connection (named in `connection`)", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 422, description = "An empty or over-long goal, or no MCP connection", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "The AI turn could not start", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn start_run(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let body: StartRunBody = match parse_body(&body) {
        Ok(body) => body,
        Err(bad) => return bad,
    };
    let goal = body.goal.trim();
    if goal.is_empty() {
        return refusal(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Describe what the run should do.",
        );
    }
    if goal.chars().count() > MAX_GOAL_CHARS {
        return refusal(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("The goal can be at most {MAX_GOAL_CHARS} characters."),
        );
    }
    let incident_id = body
        .incident_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty());
    match start_person_run(
        &org_id,
        &user.user_id,
        goal,
        &body.connection_ids,
        incident_id,
    )
    .await
    {
        Ok(run_id) => (StatusCode::CREATED, Json(StartedRun { run_id })).into_response(),
        Err(AutoResolveError::NoConnections) => {
            refusal(StatusCode::UNPROCESSABLE_ENTITY, NO_CONNECTIONS_MESSAGE)
        }
        Err(e) => autoresolve_error("start run", e),
    }
}

/// AutoResolveGetRun
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveGetRun",
    summary = "Get a run",
    description = "The run with its plan, the chosen option's steps, who may approve, the outcome and the investigation thread.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    responses(
        (status = 200, description = "The run", content_type = "application/json", body = openobserve_core::autoresolve::live::AutoResolveRunDetail),
        (status = 404, description = "Run not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_run(
    Path((org_id, run_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    match live::snapshot(&org_id, &run_id, &user.user_id).await {
        Ok(Some(run)) => MetaHttpResponse::json(run),
        Ok(None) => MetaHttpResponse::not_found(RUN_NOT_FOUND),
        Err(e) => autoresolve_error("get run", e),
    }
}

/// AutoResolveGetRunLiveStream
#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/live_stream",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveGetRunLiveStream",
    summary = "Stream a run's changes",
    description = "Server-sent events. `snapshot` carries the whole run, the body of `GET …/runs/{run_id}`, each time it changes. `end` carries `{state}` once the run ended, then the stream closes. A stream also closes after 300 s; reconnect to get a fresh snapshot.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    responses(
        (status = 200, description = "Event stream", content_type = "text/event-stream", body = String),
        (status = 404, description = "Run not found, or AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_run_live_stream(
    Path((org_id, run_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    // Everything the stream can refuse is a JSON answer before the first byte.
    match infra::table::autoresolve_runs::get(&org_id, &run_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return MetaHttpResponse::not_found(RUN_NOT_FOUND),
        Err(e) => return failed("live stream", e),
    }
    let mut live = LiveRun::new(&org_id, &run_id, &user.user_id, now_micros());
    let events = async_stream::stream! {
        let mut probe = tokio::time::interval(LIVE_PROBE_INTERVAL);
        probe.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        while !live.is_done() {
            probe.tick().await;
            for frame in live.tick(now_micros()).await {
                yield Ok::<Bytes, std::io::Error>(Bytes::from(frame.to_sse()));
            }
        }
    };
    axum::http::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime::TEXT_EVENT_STREAM.as_ref())
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(events))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// AutoResolveApproveRun
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/approve",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveApproveRun",
    summary = "Approve one option of a run's plan",
    description = "Runs the option's steps in order. The caller must be allowed to approve changes through every connection the option uses; a refusal with 403 lists who may.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = ApproveBody, description = "The option and the plan it belongs to", content_type = "application/json"),
    responses(
        (status = 204, description = "Approved; the steps start running"),
        (status = 400, description = "The body is not valid", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not approve; `approvers` lists who may", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "Already decided, the plan changed, or a connection changed; `reason` \"connection_removed\" names a removed connection in `connection`", content_type = "application/json", body = Object),
        (status = 422, description = "The option is not part of the plan", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "The AI turn could not start", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn approve_run(
    Path((org_id, run_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let body: ApproveBody = match parse_body(&body) {
        Ok(body) => body,
        Err(bad) => return bad,
    };
    decided(
        approve::approve(
            &org_id,
            &run_id,
            &user.user_id,
            &body.option_id,
            &body.plan_fingerprint,
        )
        .await,
    )
}

/// AutoResolveDeclineRun
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/decline",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveDeclineRun",
    summary = "Decline a run's plan",
    description = "Ends a run waiting for approval without running anything. The requester or anyone who may approve on one of its connections can decline.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = DeclineBody, description = "Optionally, the plan being declined", content_type = "application/json"),
    responses(
        (status = 204, description = "Declined"),
        (status = 400, description = "The body is not valid", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not decide; `approvers` lists who may", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "The run is not waiting for a decision, or the plan changed", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn decline_run(
    Path((org_id, run_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let body: DeclineBody = if body.is_empty() {
        DeclineBody::default()
    } else {
        match parse_body(&body) {
            Ok(body) => body,
            Err(bad) => return bad,
        }
    };
    let fingerprint = body.plan_fingerprint.as_deref();
    decided(approve::decline(&org_id, &run_id, &user.user_id, fingerprint).await)
}

/// AutoResolveReplanRun
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/replan",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveReplanRun",
    summary = "Ask for a new plan",
    description = "Drops the waiting plan, or follows up a run that made things worse, with a new planning turn that reads `note`. With a `kind` the note is also stored as a correction: `wrong_cause`, `wrong_fix` and `out_of_scope` while the plan waits, `not_fixed` after a run that made its change, which also records the caller's verdict.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = ReplanBody, description = "What the next plan should do differently", content_type = "application/json"),
    responses(
        (status = 204, description = "A new planning turn started"),
        (status = 400, description = "The body is not valid", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not decide; `approvers` lists who may", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "The run cannot be replanned now, or another run of its AutoResolve is in progress", content_type = "application/json", body = Object),
        (status = 422, description = "A correction without a note", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "The AI turn could not start", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn replan_run(
    Path((org_id, run_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let body: ReplanBody = if body.is_empty() {
        ReplanBody::default()
    } else {
        match parse_body(&body) {
            Ok(body) => body,
            Err(bad) => return bad,
        }
    };
    let input = ReplanInput {
        note: body.note,
        kind: body.kind,
        remember: body.remember,
        option_id: body.option_id,
    };
    decided(approve::replan(&org_id, &run_id, &user.user_id, input).await)
}

/// AutoResolvePostRunVerdict
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/verdict",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolvePostRunVerdict",
    summary = "Confirm a run fixed the problem",
    description = "Records the caller's \"yes, it fixed it\" next to the agent's verdict on an ended run that made its change. No new plan starts.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = VerdictBody, description = "The verdict", content_type = "application/json"),
    responses(
        (status = 204, description = "Recorded"),
        (status = 400, description = "The body is not valid", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not decide; `approvers` lists who may", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "The run did not end after making its change; `message` says so", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn post_verdict(
    Path((org_id, run_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let body: VerdictBody = match parse_body(&body) {
        Ok(body) => body,
        Err(bad) => return bad,
    };
    if body.verdict != PersonVerdict::Fixed {
        let message = "Send \"not fixed\" as a replan with kind not_fixed and a note.";
        return refusal(StatusCode::BAD_REQUEST, message);
    }
    decided(corrections::record_verdict(&org_id, &run_id, &user.user_id).await)
}

/// AutoResolveAddRunConnection
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/add_connection",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveAddRunConnection",
    summary = "Add the missing connection and plan again",
    description = "Adds an org MCP connection to the run and to its saved AutoResolve, and starts a new planning turn. When the saved AutoResolve did not have the connection yet, its trigger turns off until someone approves it again. A run whose plan waits for approval takes any org MCP connection it does not have; a run that ended without an option takes only the connection its plan said it needs. A saved AutoResolve's run needs someone who may edit it and approve changes through the connection.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = AddConnectionBody, description = "The connection to add", content_type = "application/json"),
    responses(
        (status = 204, description = "Added; a new planning turn started"),
        (status = 400, description = "The body is not valid", content_type = "application/json", body = Object),
        (status = 403, description = "The caller may not add it; `message` names what is missing and `approvers` who may", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled, or the saved AutoResolve is gone", content_type = "application/json", body = Object),
        (status = 409, description = "The run cannot take a connection now (`message` says when it can), or another run of its AutoResolve is in progress", content_type = "application/json", body = Object),
        (status = 422, description = "The run already has it, has the most connections, its ended plan needs another connection, or it is not an MCP connection", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
        (status = 503, description = "The AI turn could not start", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn add_connection(
    Path((org_id, run_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    if let Some(off) = disabled() {
        return off;
    }
    let body: AddConnectionBody = match parse_body(&body) {
        Ok(body) => body,
        Err(bad) => return bad,
    };
    let added = corrections::add_connection(&org_id, &run_id, &user.user_id, &body.connection_id);
    decided(added.await)
}

fn run_filter(query: RunsQuery, now_us: i64) -> Result<(RunFilter, u64, u64), Response> {
    let mut states = Vec::new();
    for name in query.state.iter().flat_map(|s| s.split(',')).map(str::trim) {
        if name.is_empty() {
            continue;
        }
        match RunState::parse(name) {
            Some(state) => states.push(state),
            None => {
                return Err(refusal(
                    StatusCode::BAD_REQUEST,
                    format!("\"{name}\" is not a run state."),
                ));
            }
        }
    }
    let from_us = match (query.from_us, query.to_us) {
        (None, None) => Some(now_us.saturating_sub(DEFAULT_WINDOW_US)),
        (from_us, _) => from_us,
    };
    let filter = RunFilter {
        states,
        requester: query.requester.filter(|r| !r.trim().is_empty()),
        connection_id: query.connection.filter(|c| !c.trim().is_empty()),
        autoresolve_id: query.autoresolve_id.filter(|a| !a.trim().is_empty()),
        from_us,
        to_us: query.to_us,
        q: query.q.filter(|q| !q.trim().is_empty()),
    };
    let page = query.page.unwrap_or(1).max(1) - 1;
    let page_size = query
        .page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    Ok((filter, page, page_size))
}

fn remember_by_default() -> bool {
    true
}

fn decided(result: Result<(), ApproveError>) -> Response {
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => approve_error(e),
    }
}

/// A 403 names who may decide, so the person knows whom to ask.
pub(super) fn approve_error(e: ApproveError) -> Response {
    let message = e.to_string();
    match e {
        ApproveError::Db(e) => failed("decision", e),
        ApproveError::NoPermission { approvers } | ApproveError::CannotChange { approvers, .. } => {
            let body = json!({ "code": 403, "message": message, "approvers": approvers });
            (StatusCode::FORBIDDEN, Json(body)).into_response()
        }
        ApproveError::ConnectionRemoved { connection } => {
            let body = json!({
                "code": StatusCode::CONFLICT.as_u16(),
                "reason": "connection_removed",
                "message": message,
                "connection": connection,
            });
            (StatusCode::CONFLICT, Json(body)).into_response()
        }
        e => refusal(status_of(e.status()), message),
    }
}

#[cfg(test)]
mod tests {
    use openobserve_core::autoresolve::{
        approve::{Approver, ApproverKind},
        live::AutoResolveConnectionRef,
    };
    use serde_json::Value;

    use super::*;

    #[tokio::test]
    async fn approve_error_maps_to_status_and_message() {
        let alice = Approver {
            kind: ApproverKind::Role,
            name: "sre".to_string(),
        };
        let removed = || ApproveError::ConnectionRemoved {
            connection: AutoResolveConnectionRef {
                id: "c1".to_string(),
                name: "github".to_string(),
                removed: true,
            },
        };
        let renamed = || ApproveError::ConnectionRenamed {
            name: "github".to_string(),
        };
        let no_permission = ApproveError::NoPermission {
            approvers: vec![alice.clone()],
        };
        #[rustfmt::skip]
        let cases: Vec<(&str, ApproveError, u16, Option<&str>)> = vec![
            ("no permission", no_permission, 403, None),
            ("not waiting", ApproveError::NotWaiting, 409, None),
            ("plan changed", ApproveError::PlanChanged, 409, None),
            ("connection removed", removed(), 409, None),
            ("connection renamed", renamed(), 409, None),
            ("another run live", ApproveError::AnotherRunLive, 409, None),
            ("wrong state", ApproveError::WrongState("Only a run that ended after making its change can say whether it fixed the problem.".into()), 409, None),
            ("unknown option", ApproveError::UnknownOption, 422, None),
            ("cannot change", ApproveError::CannotChange { reason: "Only someone who may approve changes through the postgres MCP can add it to this run.".into(), approvers: vec![alice.clone()] }, 403, None),
            ("correction without a note", ApproveError::NoteRequired, 422, None),
            ("refused", ApproveError::Refused("That MCP is already part of this run.".into()), 422, None),
            ("not found", ApproveError::NotFound("That correction is not on this AutoResolve.".into()), 404, None),
            ("turn", ApproveError::Turn("The AI turn could not start.".into()), 503, None),
            ("db", ApproveError::Db(anyhow::anyhow!("relation autoresolve_runs is locked")), 500, Some(super::super::FAILED_MESSAGE)),
        ];
        for (label, error, status, message) in cases {
            let want_message = message.map_or_else(|| error.to_string(), str::to_string);
            let response = approve_error(error);
            assert_eq!(response.status().as_u16(), status, "{label}");
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["message"], want_message, "{label}");
            let approvers = if status == 403 {
                json!([alice])
            } else {
                Value::Null
            };
            assert_eq!(body["approvers"], approvers, "{label}");
            let (reason, connection) = match label {
                "connection removed" => (
                    json!("connection_removed"),
                    json!({"id": "c1", "name": "github", "removed": true}),
                ),
                _ => (Value::Null, Value::Null),
            };
            assert_eq!(
                (&body["code"], &body["reason"], &body["connection"]),
                (&json!(status), &reason, &connection),
                "{label}"
            );
        }
    }
}
