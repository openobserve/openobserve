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

//! The routes o2-ai posts a run's plan, outcome, step calls and step results to. Each needs the
//! run's own token and the internal secret; the model never calls them.

use axum::{
    Extension,
    body::Bytes,
    extract::Path,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use config::{
    meta::autoresolve::{ConsumeRequest, OutcomeInput, PlanInput, StepResultInput},
    utils::{delegation::SCOPE_AUTORESOLVE, str::constant_time_eq},
};
use o2_enterprise::enterprise::{
    ai::client::INTERNAL_SECRET_HEADER, common::config::get_config as get_o2_config,
};
use openobserve_api_common::auth::delegation::DelegatedCaller;
use openobserve_core::autoresolve::{
    consume::{consume, record_result},
    plan::{PlanError, accept_outcome, accept_plan},
};

use super::{autoresolve_error, disabled, failed, parse_internal_body, refusal, status_of};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const REFUSED_MESSAGE: &str = "This route needs the run's token and the internal secret.";

/// AutoResolvePostPlan
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/plan",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolvePostPlan",
    summary = "Submit a run's plan",
    description = "Internal: o2-ai posts the plan the model submitted. Needs the run's token and `x-o2-internal-secret`. A refusal answers one sentence in `message` that the model can act on.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = PlanInput, description = "The plan, up to four options", content_type = "application/json"),
    responses(
        (status = 200, description = "Accepted: the fingerprint and option ids", content_type = "application/json", body = openobserve_core::autoresolve::plan::PlanAccepted),
        (status = 400, description = "The body is not a plan", content_type = "application/json", body = Object),
        (status = 403, description = "Not the run's token, or no internal secret", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "The run is not waiting for a plan", content_type = "application/json", body = Object),
        (status = 422, description = "The plan was refused", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn post_plan(
    Path((org_id, run_id)): Path<(String, String)>,
    headers: HeaderMap,
    caller: Option<Extension<DelegatedCaller>>,
    body: Bytes,
) -> Response {
    if let Some(refused) = refused(&headers, caller.as_deref(), &run_id) {
        return refused;
    }
    let plan: PlanInput = match parse_internal_body(&body) {
        Ok(plan) => plan,
        Err(bad) => return bad,
    };
    match accept_plan(&org_id, &run_id, plan).await {
        Ok(accepted) => MetaHttpResponse::json(accepted),
        Err(e) => plan_error(e),
    }
}

/// AutoResolvePostOutcome
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/outcome",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolvePostOutcome",
    summary = "Report a run's outcome",
    description = "Internal: o2-ai posts the verdict the model reported after the steps ran. Needs the run's token and `x-o2-internal-secret`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = OutcomeInput, description = "The verdict and its explanation", content_type = "application/json"),
    responses(
        (status = 204, description = "Recorded"),
        (status = 400, description = "The body is not an outcome", content_type = "application/json", body = Object),
        (status = 403, description = "Not the run's token, or no internal secret", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "The run is not waiting for an outcome", content_type = "application/json", body = Object),
        (status = 422, description = "The outcome was refused", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn post_outcome(
    Path((org_id, run_id)): Path<(String, String)>,
    headers: HeaderMap,
    caller: Option<Extension<DelegatedCaller>>,
    body: Bytes,
) -> Response {
    if let Some(refused) = refused(&headers, caller.as_deref(), &run_id) {
        return refused;
    }
    let outcome: OutcomeInput = match parse_internal_body(&body) {
        Ok(outcome) => outcome,
        Err(bad) => return bad,
    };
    match accept_outcome(&org_id, &run_id, outcome).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => plan_error(e),
    }
}

/// AutoResolveConsumeStep
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/consume",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolveConsumeStep",
    summary = "Ask whether a tool call may run",
    description = "Internal: o2-ai asks before forwarding a tool call of an execute turn. `decision` is `run` (with the approved arguments and the write headers), `refuse` or `hold`. Needs the run's token and `x-o2-internal-secret`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
    ),
    request_body(content = ConsumeRequest, description = "The tool call the model made", content_type = "application/json"),
    responses(
        (status = 200, description = "The decision", content_type = "application/json", body = config::meta::autoresolve::ConsumeResponse),
        (status = 400, description = "The body is not a tool call", content_type = "application/json", body = Object),
        (status = 403, description = "Not the run's token, or no internal secret", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn consume_step(
    Path((org_id, run_id)): Path<(String, String)>,
    headers: HeaderMap,
    caller: Option<Extension<DelegatedCaller>>,
    body: Bytes,
) -> Response {
    if let Some(refused) = refused(&headers, caller.as_deref(), &run_id) {
        return refused;
    }
    let call: ConsumeRequest = match parse_internal_body(&body) {
        Ok(call) => call,
        Err(bad) => return bad,
    };
    match consume(&org_id, &run_id, call).await {
        Ok(decision) => MetaHttpResponse::json(decision),
        Err(e) => autoresolve_error("consume", e),
    }
}

/// AutoResolvePostStepResult
#[utoipa::path(
    post,
    path = "/v2/{org_id}/autoresolve/runs/{run_id}/steps/{step_id}/result",
    context_path = "/api",
    tag = "AutoResolve",
    operation_id = "AutoResolvePostStepResult",
    summary = "Record a step's result",
    description = "Internal: o2-ai posts what the connection answered to a step that `consume` allowed. Needs the run's token and `x-o2-internal-secret`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("run_id" = String, Path, description = "Run id"),
        ("step_id" = String, Path, description = "Step id from the `run` decision"),
    ),
    request_body(content = StepResultInput, description = "The result, the error, or that no answer came back", content_type = "application/json"),
    responses(
        (status = 204, description = "Recorded"),
        (status = 400, description = "The body is not a step result", content_type = "application/json", body = Object),
        (status = 403, description = "Not the run's token, or no internal secret", content_type = "application/json", body = Object),
        (status = 404, description = "AutoResolve is not enabled", content_type = "application/json", body = Object),
        (status = 409, description = "The step is not running", content_type = "application/json", body = Object),
        (status = 500, description = "Internal error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoResolve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn post_step_result(
    Path((org_id, run_id, step_id)): Path<(String, String, String)>,
    headers: HeaderMap,
    caller: Option<Extension<DelegatedCaller>>,
    body: Bytes,
) -> Response {
    if let Some(refused) = refused(&headers, caller.as_deref(), &run_id) {
        return refused;
    }
    let result: StepResultInput = match parse_internal_body(&body) {
        Ok(result) => result,
        Err(bad) => return bad,
    };
    match record_result(&org_id, &run_id, &step_id, result).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => autoresolve_error("step result", e),
    }
}

/// True only for the run's own token together with the configured internal secret.
pub(crate) fn internal_caller_ok(
    headers: &HeaderMap,
    caller: Option<&DelegatedCaller>,
    run: &str,
) -> bool {
    caller_ok_with(headers, caller, run, &get_o2_config().ai.internal_secret)
}

fn caller_ok_with(
    headers: &HeaderMap,
    caller: Option<&DelegatedCaller>,
    run: &str,
    secret: &str,
) -> bool {
    let Some(caller) = caller else {
        return false;
    };
    if caller.scope != SCOPE_AUTORESOLVE || caller.link_id != run || secret.is_empty() {
        return false;
    }
    let mut sent = headers.get_all(INTERNAL_SECRET_HEADER).iter();
    match (sent.next(), sent.next()) {
        (Some(value), None) => constant_time_eq(value.as_bytes(), secret.as_bytes()),
        _ => false,
    }
}

fn refused(headers: &HeaderMap, caller: Option<&DelegatedCaller>, run: &str) -> Option<Response> {
    if let Some(off) = disabled() {
        return Some(off);
    }
    (!internal_caller_ok(headers, caller, run))
        .then(|| refusal(StatusCode::FORBIDDEN, REFUSED_MESSAGE))
}

fn plan_error(e: PlanError) -> Response {
    match e {
        PlanError::Db(e) => failed("plan or outcome intake", e),
        e => refusal(status_of(e.status()), e),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    fn caller(scope: &str, run: &str) -> DelegatedCaller {
        DelegatedCaller {
            link_id: run.to_string(),
            installation_id: String::new(),
            org: "default".to_string(),
            jti: "j1".to_string(),
            scope: scope.to_string(),
        }
    }

    #[test]
    fn internal_routes_need_the_run_token_and_the_secret() {
        let run_token = caller(SCOPE_AUTORESOLVE, "r1");
        let other_run = caller(SCOPE_AUTORESOLVE, "r2");
        let assistant = caller("assistant", "r1");
        #[rustfmt::skip]
        type Case<'a> = (&'a str, Option<&'a DelegatedCaller>, &'a [&'a str], &'a str, bool);
        let cases: [Case; 9] = [
            (
                "token and secret",
                Some(&run_token),
                &["s3cret"],
                "s3cret",
                true,
            ),
            (
                "other run's token",
                Some(&other_run),
                &["s3cret"],
                "s3cret",
                false,
            ),
            (
                "assistant token",
                Some(&assistant),
                &["s3cret"],
                "s3cret",
                false,
            ),
            ("no token", None, &["s3cret"], "s3cret", false),
            ("no secret", Some(&run_token), &[], "s3cret", false),
            (
                "wrong secret",
                Some(&run_token),
                &["s3crex"],
                "s3cret",
                false,
            ),
            (
                "secret prefix",
                Some(&run_token),
                &["s3cre"],
                "s3cret",
                false,
            ),
            (
                "secret sent twice",
                Some(&run_token),
                &["s3cret", "s3cret"],
                "s3cret",
                false,
            ),
            (
                "empty configured secret",
                Some(&run_token),
                &[""],
                "",
                false,
            ),
        ];
        for (label, caller, sent, configured, want) in cases {
            let mut headers = HeaderMap::new();
            for value in sent {
                headers.append(
                    INTERNAL_SECRET_HEADER,
                    HeaderValue::from_str(value).unwrap(),
                );
            }
            assert_eq!(
                caller_ok_with(&headers, caller, "r1", configured),
                want,
                "{label}"
            );
        }
    }
}
