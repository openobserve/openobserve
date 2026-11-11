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

//! AutoObserve engine routes: coverage, suggestions, and the marks the alert gate reads.

pub mod decisions;
pub mod incidents;
pub mod paging;
pub mod review;
pub mod slack_feed;

use std::{
    collections::{BTreeSet, HashMap},
    future::Future,
    str::FromStr,
};

use async_trait::async_trait;
use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, RawQuery, rejection::QueryRejection},
    response::Response,
};
use config::{meta::autoobserve::marks::ENTITY_TYPE_ALERT, utils::time::now_micros};
use infra::db::get_orm_client_ro;
use o2_enterprise::enterprise::autoobserve::{
    alert_findings::{AlertFindingsRead, DigestRun, RUN_LOOKBACK_US},
    api::{
        self, ApiError, CoverageView, DEFAULT_LIMIT, Deps, MarkFilter, MarkPut, MarkTarget, Page,
        STORAGE_FAILED, SuggestionFilter,
    },
    contract::EntityRef,
    marks::MarkSource,
    names::{dims, kinds},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{alerts::alert, auth::check_permissions, background_access::rbac_enforced};
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::{IntoParams, ToSchema};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::{
        alert_calibration::digests::{latest_alert_findings, offer_reader_changes},
        alert_grants::{AlertAuthority, AlertGrants, LiveAuthority, org_wide_allows},
    },
    service::auth::UserEmail,
};

/// Only whether a DELETE carries a body matters, so reading stops here.
const MAX_DELETE_BODY: usize = 64 * 1024;
const DISABLED_MESSAGE: &str = "AutoObserve is disabled (O2_AUTOOBSERVE_ENABLED=false)";

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CoverageQuery {
    /// `strict` (default) or `weak`: the same rows, with weak cells read as covered by the client.
    pub view: Option<String>,
    /// Keeps only the service with this name or id.
    pub service: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct HistoryQuery {
    /// Start of the first day, in microseconds.
    pub from: i64,
    /// Start of the last day, in microseconds; at most 90 days after `from`.
    pub to: i64,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SuggestionsQuery {
    pub entity_type: Option<String>,
    pub kind: Option<String>,
    /// `proposed`, `accepted`, `rejected` or `withdrawn`; all statuses when absent.
    pub status: Option<String>,
    /// A key-dim value of the subject, or `dim=value`.
    pub subject: Option<String>,
    /// `score` (the default) or `priority`: the panel's order of kinds, then score.
    pub sort: Option<String>,
    /// 1 to 500; 100 when absent.
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct MarksQuery {
    pub mark: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    /// 1 to 500; 100 when absent.
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// Unknown parameters are refused, so a misspelt `group_key` cannot unmark the ungrouped series.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct DeleteMarkQuery {
    /// The alert group's key; absent or empty names the ungrouped series.
    pub group_key: Option<String>,
}

/// An absent or null `group_key` names the ungrouped series; the engine has no all-groups scope.
#[derive(Debug, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MarkBody {
    /// The alert group's key; empty for the ungrouped series.
    pub group_key: Option<String>,
    /// A note kept with the mark.
    pub reason: Option<String>,
}

impl MarkBody {
    /// Unknown fields are refused, so a misspelt `group_key` cannot mark the ungrouped series.
    fn parse(body: &[u8]) -> Result<Self, String> {
        if body.iter().all(u8::is_ascii_whitespace) {
            return Ok(Self::default());
        }
        serde_json::from_slice(body).map_err(|e| format!("invalid mark body: {e}"))
    }

    fn group_key(&self) -> &str {
        self.group_key.as_deref().unwrap_or_default()
    }
}

#[derive(Clone, Copy, Debug)]
struct Subject<'a> {
    resource: &'static str,
    alert_id: Option<&'a str>,
}

impl<'a> Subject<'a> {
    fn of(subject: &'a EntityRef) -> Self {
        // A stream subject quotes its log lines, so it needs org-wide logs read.
        let resource = match subject.kind.as_str() {
            kinds::SYNTHETIC => "synthetics",
            kinds::STREAM => "logs",
            _ => "alerts",
        };
        let alert_id = (subject.kind == ENTITY_TYPE_ALERT)
            .then(|| subject.key_dims.get(dims::ENTITY_ID).map(String::as_str))
            .flatten();
        Self { resource, alert_id }
    }
}

/// The calibration digest, searched only through calibration's protected reader (P5b-D-read).
struct LiveDigest;

#[async_trait]
impl AlertFindingsRead for LiveDigest {
    async fn latest(&self, org: &str, now: i64) -> Result<Option<DigestRun>, ApiError> {
        latest_alert_findings(org, None, now.saturating_sub(RUN_LOOKBACK_US), now)
            .await
            .map_err(|e| {
                log::error!("[AUTOOBSERVE] org {org}: reading calibration findings failed: {e}");
                ApiError::Storage(STORAGE_FAILED.into())
            })
    }
}

/// [`LiveDigest`] with each no-destination finding's change as this reader may apply it.
struct ReaderDigest<'a>(&'a str);

#[async_trait]
impl AlertFindingsRead for ReaderDigest<'_> {
    async fn latest(&self, org: &str, now: i64) -> Result<Option<DigestRun>, ApiError> {
        let mut run = LiveDigest.latest(org, now).await?;
        if let Some(run) = run.as_mut() {
            offer_reader_changes(org, self.0, &mut run.records).await;
        }
        Ok(run)
    }
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/entity_types",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveEntityTypes",
    summary = "List the engine's entity types",
    description = "The registered plugins with their capabilities and decision kinds, the analyzers with the suggestion kinds each raises, and the known marks.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List the AutoObserve entity types, analyzers and marks", "category": "autoobserve"}))
    )
)]
pub async fn entity_types(Path(_org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    respond(Deps::live().and_then(|deps| api::entity_types(&deps)))
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/coverage",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveCoverage",
    summary = "Get the coverage matrix",
    description = "This region's newest coverage matrix: one row per watched service with the evidence for each signal class. `pass_at`, `refreshed_at` and `quality` are null, and `rows` is empty, when the engine has written no pass in the last day. `learning` is present unless the learning state could not be read, in which case it and every `learning_until` are left out: how many of the org's streams the stream watches still learn and how many have the `history_days_needed` days they need, with `next_ready_at` (microseconds) the soonest a learning stream is ready, null when none learns. Each listed stream's `learning_until` is when its history will be enough, null once it is or when no stream watch applies.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), CoverageQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Unknown view", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get the AutoObserve monitoring coverage matrix", "category": "autoobserve"}))
    )
)]
pub async fn coverage(
    Path(org_id): Path<String>,
    query: Result<Query<CoverageQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let query = match parse_query(query) {
        Ok(query) => query,
        Err(refused) => return refused,
    };
    let view = match CoverageView::parse(query.view.as_deref()) {
        Ok(view) => view,
        Err(e) => return failed(&e),
    };
    serve(|deps| async move {
        let service = query.service.as_deref().filter(|s| !s.is_empty());
        api::coverage(&deps, &org_id, view, service, now_micros()).await
    })
    .await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/coverage/history",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveCoverageHistory",
    summary = "Get daily coverage snapshots",
    description = "The daily coverage snapshot of each day whose start lies in [from, to].",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), HistoryQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "A missing bound, from after to, or a span over 90 days", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "Get daily AutoObserve coverage snapshots", "category": "autoobserve"}))
    )
)]
pub async fn coverage_history(
    Path(org_id): Path<String>,
    query: Result<Query<HistoryQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let query = match parse_query(query) {
        Ok(query) => query,
        Err(refused) => return refused,
    };
    serve(|deps| async move { api::coverage_history(&deps, &org_id, query.from, query.to).await })
        .await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/suggestions",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveSuggestions",
    summary = "List suggestions",
    description = "Each suggestion's newest state from the last 7 days, highest score first, with a stored accept or reject applied. `total` counts the matches before paging; a decision made since the last engine pass can drop an item from a status-filtered page. `last_seen_at` is when the suggestion last changed or was confirmed (at most 24 h old while current). Where alert calibration owns alert findings, an alert's broken-definition finding is listed once as `alert_not_working` from the newest calibration run, and dismissed findings are left out. Where the deployment lists them, a source that stopped sending while its stream kept flowing is listed as `source_silence`, one per outage, until a day after every source of the outage sends again.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), SuggestionsQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown entity type or status, a malformed kind, or a limit outside 1 to 500", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List AutoObserve suggestions", "category": "autoobserve"}))
    )
)]
pub async fn suggestions(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    query: Result<Query<SuggestionsQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let query = match parse_query(query) {
        Ok(query) => query,
        Err(refused) => return refused,
    };
    let page = page(query.limit, query.offset);
    let filter = SuggestionFilter {
        entity_type: query.entity_type,
        kind: query.kind,
        status: query.status,
        subject: query.subject,
        sort: query.sort,
    };
    serve(|deps| async move {
        let readable = |subjects| readable_subjects(&org_id, &user.user_id, subjects);
        api::suggestions(
            &deps,
            &org_id,
            &filter,
            page,
            now_micros(),
            readable,
            &ReaderDigest(&user.user_id),
        )
        .await
    })
    .await
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/marks",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveListMarks",
    summary = "List marks",
    description = "Marks on entities the caller can read, in key order, narrowed by mark, entity type and entity id. `total` counts the matches before paging.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), MarksQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown mark or entity type, a malformed entity id, or a limit outside 1 to 500", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List AutoObserve marks such as protected alerts", "category": "autoobserve"}))
    )
)]
pub async fn list_marks(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    query: Result<Query<MarksQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let query = match parse_query(query) {
        Ok(query) => query,
        Err(refused) => return refused,
    };
    let page = page(query.limit, query.offset);
    let filter = MarkFilter {
        mark: query.mark,
        entity_type: query.entity_type,
        entity_id: query.entity_id,
    };
    serve(|deps| async move {
        let readable = |subjects| readable_subjects(&org_id, &user.user_id, subjects);
        api::list_marks(&deps, &org_id, &filter, page, readable).await
    })
    .await
}

#[utoipa::path(
    put,
    path = "/v2/{org_id}/autoobserve/marks/{mark}/{entity_type}/{entity_id}",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObservePutMark",
    summary = "Set a mark",
    description = "Marks one series of an entity, for example protects an alert group. A missing or null `group_key` marks the ungrouped series (`\"\"`), never every group. A put equal to the stored mark writes nothing and answers `unchanged`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("mark" = String, Path, description = "The mark, e.g. protected"),
        ("entity_type" = String, Path, description = "The entity type, e.g. alert"),
        ("entity_id" = String, Path, description = "The entity's id"),
    ),
    request_body(content = inline(MarkBody), description = "Optional; an empty body marks the ungrouped series", content_type = "application/json"),
    responses(
        (status = 200, description = "`change` is created, updated or unchanged", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown mark or entity type, a malformed id, an over-long field, or an invalid body", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "The write failed, or the mark changed but its history row was not written", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Protect an alert group from AutoObserve investigation skips", "category": "autoobserve"}))
    )
)]
pub async fn put_mark(
    Path((org_id, mark, entity_type, entity_id)): Path<(String, String, String, String)>,
    Headers(user): Headers<UserEmail>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    if let Err(refused) = refuse_query(query.as_deref()) {
        return refused;
    }
    let body = match MarkBody::parse(&body) {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    if !may_change_mark(&org_id, &user.user_id, &entity_type, &entity_id).await {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    let put = MarkPut {
        target: MarkTarget {
            mark,
            entity_type,
            entity_id,
            group_key: body.group_key().to_string(),
        },
        reason: body.reason,
        source: MarkSource::Manual,
        suggestion_id: None,
    };
    serve(|deps| async move {
        api::put_mark(&deps, &org_id, &put, &user.user_id, now_micros()).await
    })
    .await
}

#[utoipa::path(
    delete,
    path = "/v2/{org_id}/autoobserve/marks/{mark}/{entity_type}/{entity_id}",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveDeleteMark",
    summary = "Remove a mark",
    description = "Removes the mark from one series of an entity. The `group_key` query parameter names the series; absent or empty names the ungrouped series (`\"\"`), never every group. The request has no body. Removing an absent mark writes nothing and answers `absent`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("mark" = String, Path, description = "The mark, e.g. protected"),
        ("entity_type" = String, Path, description = "The entity type, e.g. alert"),
        ("entity_id" = String, Path, description = "The entity's id"),
        DeleteMarkQuery,
    ),
    responses(
        (status = 200, description = "`change` is deleted or absent", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown mark or entity type, a malformed id or query, or a request body", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "The delete failed, or the mark was removed but its history row was not written", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Remove an AutoObserve mark from an alert group", "category": "autoobserve", "requires_confirmation": true}))
    )
)]
pub async fn delete_mark(
    Path((org_id, mark, entity_type, entity_id)): Path<(String, String, String, String)>,
    Headers(user): Headers<UserEmail>,
    query: Result<Query<DeleteMarkQuery>, QueryRejection>,
    body: Body,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let query = match parse_query(query) {
        Ok(query) => query,
        Err(refused) => return refused,
    };
    if let Err(refused) = refuse_body(body).await {
        return refused;
    }
    if !may_change_mark(&org_id, &user.user_id, &entity_type, &entity_id).await {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    let target = MarkTarget {
        mark,
        entity_type,
        entity_id,
        group_key: query.group_key.unwrap_or_default(),
    };
    serve(|deps| async move {
        api::delete_mark(&deps, &org_id, &target, &user.user_id, now_micros()).await
    })
    .await
}

fn page(limit: Option<usize>, offset: Option<usize>) -> Page {
    Page {
        limit: limit.unwrap_or(DEFAULT_LIMIT),
        offset: offset.unwrap_or(0),
    }
}

/// Every route is a 404 while the deployment switch is off, as alert calibration's are.
fn deployment_disabled() -> Option<Response> {
    (!engine_enabled()).then(|| MetaHttpResponse::not_found(DISABLED_MESSAGE))
}

fn engine_enabled() -> bool {
    #[cfg(test)]
    if let Some(on) = tests::ENGINE_ON.with(std::cell::Cell::get) {
        return on;
    }
    o2_enterprise::enterprise::autoobserve::is_enabled()
}

/// Deps fail with `Unavailable` where the engine never initialised, such as on a router node.
async fn serve<T, F, Fut>(call: F) -> Response
where
    T: Serialize,
    F: FnOnce(Deps) -> Fut,
    Fut: Future<Output = Result<T, ApiError>>,
{
    match Deps::live() {
        Ok(deps) => respond(call(deps).await),
        Err(e) => failed(&e),
    }
}

fn respond<T: Serialize>(result: Result<T, ApiError>) -> Response {
    match result {
        Ok(body) => MetaHttpResponse::json(body),
        Err(e) => failed(&e),
    }
}

fn failed(e: &ApiError) -> Response {
    error_response(e.status(), e)
}

fn error_response(status: u16, message: impl ToString) -> Response {
    match status {
        400 => MetaHttpResponse::bad_request(message),
        503 => MetaHttpResponse::service_unavailable(message),
        _ => MetaHttpResponse::internal_error(message),
    }
}

/// Axum's own query rejection is plain text; these routes document a JSON 400.
fn parse_query<T>(query: Result<Query<T>, QueryRejection>) -> Result<T, Response> {
    query
        .map(|Query(q)| q)
        .map_err(|e| MetaHttpResponse::bad_request(format!("invalid query: {}", e.body_text())))
}

/// A body naming `group_key` would otherwise be ignored and unmark the ungrouped series.
async fn refuse_body(body: Body) -> Result<(), Response> {
    let empty = axum::body::to_bytes(body, MAX_DELETE_BODY)
        .await
        .is_ok_and(|b| b.iter().all(u8::is_ascii_whitespace));
    if empty {
        return Ok(());
    }
    Err(MetaHttpResponse::bad_request(
        "DELETE takes group_key as a query parameter and no body",
    ))
}

/// A query naming `group_key` would otherwise be ignored and mark the ungrouped series.
fn refuse_query(query: Option<&str>) -> Result<(), Response> {
    if query.is_none_or(str::is_empty) {
        return Ok(());
    }
    Err(MetaHttpResponse::bad_request(
        "PUT takes group_key in the body and no query string",
    ))
}

/// The newest calibration run, its `finding_ids` scoped as this reader's page lists them.
async fn run_read_by(org_id: &str, user_id: &str, now: i64) -> Option<DigestRun> {
    let since = now.saturating_sub(RUN_LOOKBACK_US);
    latest_alert_findings(org_id, Some(user_id), since, now)
        .await
        .inspect_err(|e| {
            log::error!("[AUTOOBSERVE] org {org_id}: reading calibration findings failed: {e}")
        })
        .ok()
        .flatten()
}

/// An alert subject a role cannot read org-wide is still readable through its folder or own grant.
async fn readable_subjects(org_id: &str, user_id: &str, subjects: Vec<EntityRef>) -> Vec<bool> {
    if !rbac_enforced().await {
        return vec![true; subjects.len()];
    }
    let subjects: Vec<Subject<'_>> = subjects.iter().map(Subject::of).collect();
    readable_mask(&LiveAuthority { org_id, user_id }, &subjects).await
}

/// One org-wide check per resource, then one grant listing and one folder read for the alerts left.
async fn readable_mask<A: AlertAuthority>(auth: &A, subjects: &[Subject<'_>]) -> Vec<bool> {
    let mut org_wide: HashMap<&'static str, bool> = HashMap::new();
    for subject in subjects {
        if !org_wide.contains_key(subject.resource) {
            let allowed = auth.org_wide(subject.resource).await;
            org_wide.insert(subject.resource, allowed);
        }
    }
    let wide = |s: &Subject<'_>| org_wide.get(s.resource).copied().unwrap_or(false);
    let pending: BTreeSet<&str> = subjects
        .iter()
        .filter(|s| !wide(s))
        .filter_map(|s| s.alert_id)
        .collect();
    let grants = if pending.is_empty() {
        AlertGrants::default()
    } else {
        auth.grants().await
    };
    let folders = if grants.is_empty() {
        HashMap::new()
    } else {
        let ids = pending.iter().map(|id| id.to_string()).collect();
        auth.folders_of(ids).await
    };
    subjects
        .iter()
        .map(|s| {
            wide(s)
                || s.alert_id.is_some_and(|id| {
                    folders
                        .get(id)
                        .is_some_and(|folder| grants.allows(id, folder))
                })
        })
        .collect()
}

/// A mark whose alert is gone has no per-alert grant left, so it needs alerts PUT org-wide.
async fn may_change_mark(org_id: &str, user_id: &str, entity_type: &str, entity_id: &str) -> bool {
    #[cfg(test)]
    if let Some(allowed) = tests::MAY_CHANGE.with(std::cell::Cell::get) {
        return allowed;
    }
    if !rbac_enforced().await {
        return true;
    }
    if entity_type == ENTITY_TYPE_ALERT
        && let Some(allowed) = alert_allows(org_id, user_id, entity_id, "PUT").await
    {
        return allowed;
    }
    org_wide_allows(org_id, user_id, "alerts", "PUT").await
}

/// The per-alert check the alert handlers make; `None` when no alert has this id.
async fn alert_allows(org_id: &str, user_id: &str, alert_id: &str, method: &str) -> Option<bool> {
    let ksuid = Ksuid::from_str(alert_id).ok()?;
    let (folder, _) = alert::get_by_id(get_orm_client_ro().await, org_id, ksuid)
        .await
        .ok()?;
    Some(
        check_permissions(
            alert_id,
            org_id,
            user_id,
            "alerts",
            method,
            Some(&folder.folder_id),
            false,
            true,
            false,
        )
        .await,
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode, Uri},
        routing,
    };
    use tower::ServiceExt;

    use super::*;
    use crate::request::alert_grants::tests::CountingAuthority;

    thread_local! {
        /// The deployment switch as this test's thread sees it; None reads the config.
        pub(super) static ENGINE_ON: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
        /// The RBAC answer for a mark change on this test's thread; None asks RBAC.
        pub(super) static MAY_CHANGE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
    }

    fn app() -> Router {
        Router::new()
            .route("/v2/{org_id}/autoobserve/coverage", routing::get(coverage))
            .route(
                "/v2/{org_id}/autoobserve/coverage/history",
                routing::get(coverage_history),
            )
            .route(
                "/v2/{org_id}/autoobserve/suggestions",
                routing::get(suggestions),
            )
            .route("/v2/{org_id}/autoobserve/marks", routing::get(list_marks))
            .route(
                "/v2/{org_id}/autoobserve/marks/{mark}/{entity_type}/{entity_id}",
                routing::put(put_mark).delete(delete_mark),
            )
    }

    async fn send(method: &str, uri: &str, body: &str) -> Response {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("user_id", "root@example.com")
            .body(Body::from(body.to_string()))
            .unwrap();
        app().oneshot(request).await.unwrap()
    }

    async fn status(method: &str, uri: &str, body: &str) -> StatusCode {
        send(method, uri, body).await.status()
    }

    fn is_json(response: &Response) -> bool {
        response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("application/json"))
    }

    fn query<T: serde::de::DeserializeOwned>(uri: &str) -> Result<T, String> {
        let uri: Uri = uri.parse().unwrap();
        Query::<T>::try_from_uri(&uri)
            .map(|Query(q)| q)
            .map_err(|e| e.to_string())
    }

    #[test]
    fn each_service_error_status_gets_its_own_response() {
        for (code, want) in [
            (400, StatusCode::BAD_REQUEST),
            (503, StatusCode::SERVICE_UNAVAILABLE),
            (500, StatusCode::INTERNAL_SERVER_ERROR),
        ] {
            assert_eq!(error_response(code, "x").status(), want, "{code}");
        }
    }

    #[test]
    fn a_missing_or_null_group_key_is_the_ungrouped_series() {
        for body in [
            "",
            "  \n",
            "{}",
            r#"{"group_key":null}"#,
            r#"{"reason":"why"}"#,
        ] {
            let parsed = MarkBody::parse(body.as_bytes()).unwrap();
            assert_eq!(parsed.group_key(), "", "{body:?}");
        }
        let grouped = MarkBody::parse(br#"{"group_key":"host=a","reason":"r"}"#).unwrap();
        assert_eq!(
            (grouped.group_key(), grouped.reason.as_deref()),
            ("host=a", Some("r"))
        );
    }

    #[test]
    fn a_misspelt_or_malformed_mark_body_is_refused() {
        assert!(MarkBody::parse(br#"{"groupKey":"host=a"}"#).is_err());
        assert!(MarkBody::parse(b"{not json").is_err());
        assert!(MarkBody::parse(br#"{"group_key":7}"#).is_err());
    }

    #[test]
    fn paging_and_filters_read_from_the_query_string() {
        let q: SuggestionsQuery = query(
            "/x?entity_type=service&kind=coverage_gap&status=proposed&subject=checkout&sort=priority&limit=5&offset=10",
        )
        .unwrap();
        assert_eq!(q.sort.as_deref(), Some("priority"));
        assert_eq!(
            (
                q.entity_type.as_deref(),
                q.kind.as_deref(),
                q.status.as_deref(),
                q.subject.as_deref(),
                q.limit,
                q.offset
            ),
            (
                Some("service"),
                Some("coverage_gap"),
                Some("proposed"),
                Some("checkout"),
                Some(5),
                Some(10)
            )
        );
        let none: MarksQuery = query("/x").unwrap();
        assert_eq!((none.limit, none.offset, none.mark), (None, None, None));
        let marks: MarksQuery = query("/x?mark=protected&entity_id=a1&limit=2").unwrap();
        assert_eq!(
            (
                marks.mark.as_deref(),
                marks.entity_id.as_deref(),
                marks.limit
            ),
            (Some("protected"), Some("a1"), Some(2))
        );
        assert!(query::<MarksQuery>("/x?limit=abc").is_err());
        assert!(query::<SuggestionsQuery>("/x?offset=-1").is_err());
        assert!(query::<HistoryQuery>("/x?from=1").is_err());
    }

    #[test]
    fn a_rejected_query_is_a_json_400() {
        for uri in ["/x?limit=abc", "/x?offset=-3"] {
            let uri: Uri = uri.parse().unwrap();
            let Err(refused) = parse_query(Query::<MarksQuery>::try_from_uri(&uri)) else {
                panic!("{uri} parsed");
            };
            assert_eq!(refused.status(), StatusCode::BAD_REQUEST, "{uri}");
            assert!(is_json(&refused), "{uri}");
        }
        let uri: Uri = "/x?from=1".parse().unwrap();
        assert!(parse_query(Query::<HistoryQuery>::try_from_uri(&uri)).is_err());
        let uri: Uri = "/x?group_key=host%3Da".parse().unwrap();
        let q = parse_query(Query::<DeleteMarkQuery>::try_from_uri(&uri)).unwrap();
        assert_eq!(q.group_key.as_deref(), Some("host=a"));
    }

    #[test]
    fn a_misspelt_group_key_in_a_query_is_refused() {
        let uri: Uri = "/x?groupKey=host%3Da".parse().unwrap();
        let Err(refused) = parse_query(Query::<DeleteMarkQuery>::try_from_uri(&uri)) else {
            panic!("an unknown DELETE parameter was accepted");
        };
        assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
        assert!(is_json(&refused));
        assert!(refuse_query(None).is_ok());
        assert!(refuse_query(Some("")).is_ok());
        let Err(refused) = refuse_query(Some("group_key=host%3Da")) else {
            panic!("a PUT query string was accepted");
        };
        assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
        assert!(is_json(&refused));
    }

    /// Refused before the permission check, so the caller learns its request was wrong.
    #[tokio::test]
    async fn a_mark_route_refuses_a_group_key_it_would_ignore() {
        ENGINE_ON.with(|on| on.set(Some(true)));
        MAY_CHANGE.with(|may| may.set(Some(false)));
        let mark = "/v2/o/autoobserve/marks/protected/alert/a1";
        for (method, uri) in [
            ("DELETE", format!("{mark}?groupKey=host%3Da")),
            ("PUT", format!("{mark}?group_key=host%3Da")),
        ] {
            let response = send(method, &uri, "").await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{method}");
            assert!(is_json(&response), "{method}");
        }
    }

    #[tokio::test]
    async fn a_delete_takes_no_body() {
        assert!(refuse_body(Body::empty()).await.is_ok());
        assert!(refuse_body(Body::from(" \n")).await.is_ok());
        let Err(refused) = refuse_body(Body::from(r#"{"group_key":"host=a"}"#)).await else {
            panic!("a body was accepted");
        };
        assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
        assert!(is_json(&refused));
    }

    fn alert_subject(id: &str) -> Subject<'_> {
        Subject {
            resource: "alerts",
            alert_id: Some(id),
        }
    }

    #[tokio::test]
    async fn five_thousand_subjects_on_four_alerts_cost_constant_permission_calls() {
        let auth = CountingAuthority {
            org_wide: HashMap::from([("synthetics", true)]),
            folders: HashMap::from([
                ("a0".to_string(), "ops".to_string()),
                ("a1".to_string(), "pay".to_string()),
                ("a2".to_string(), "pay".to_string()),
            ]),
            grants: vec!["afolder:ops".into(), "alert:pay/a2".into()],
            ..Default::default()
        };
        let ids = ["a0", "a1", "a2", "gone"];
        let mut subjects: Vec<Subject<'_>> =
            (0..5_000).map(|i| alert_subject(ids[i % 4])).collect();
        subjects.push(Subject {
            resource: "synthetics",
            alert_id: None,
        });
        subjects.push(Subject {
            resource: "alerts",
            alert_id: None,
        });
        let mask = readable_mask(&auth, &subjects).await;
        assert_eq!(&mask[..4], [true, false, true, false]);
        assert!(mask[..5_000].chunks(4).all(|c| c == &mask[..4]));
        assert_eq!(
            &mask[5_000..],
            [true, false],
            "synthetics org-wide; a kindless alert never"
        );
        assert_eq!(
            auth.org_wide_calls.load(Ordering::SeqCst),
            2,
            "one per resource"
        );
        assert_eq!(auth.grant_calls.load(Ordering::SeqCst), 1);
        assert_eq!(auth.folder_reads.load(Ordering::SeqCst), 1);
        assert_eq!(
            auth.alerts_read.load(Ordering::SeqCst),
            4,
            "deduped by alert id"
        );

        let ungranted = CountingAuthority {
            org_wide: HashMap::from([("synthetics", true)]),
            folders: auth.folders.clone(),
            ..Default::default()
        };
        let mask = readable_mask(&ungranted, &subjects).await;
        assert!(mask[..5_000].iter().all(|ok| !ok));
        assert_eq!(&mask[5_000..], [true, false]);
        assert_eq!(
            (
                ungranted.grant_calls.load(Ordering::SeqCst),
                ungranted.folder_reads.load(Ordering::SeqCst),
            ),
            (1, 0),
            "no grant, so no alert's folder is read"
        );
    }

    #[tokio::test]
    async fn a_stream_subject_needs_org_wide_logs_read() {
        let stream = EntityRef::new(kinds::STREAM, &[(dims::STREAM_NAME, "app")]);
        let alert = EntityRef::new(ENTITY_TYPE_ALERT, &[(dims::ENTITY_ID, "a0")]);
        let subjects = [Subject::of(&stream), Subject::of(&alert)];
        let alerts_only = CountingAuthority {
            org_wide: HashMap::from([("alerts", true), ("logs", false)]),
            ..Default::default()
        };
        assert_eq!(readable_mask(&alerts_only, &subjects).await, [false, true]);
        let logs_too = CountingAuthority {
            org_wide: HashMap::from([("alerts", true), ("logs", true)]),
            ..Default::default()
        };
        assert_eq!(readable_mask(&logs_too, &subjects).await, [true, true]);
        let logs_only = CountingAuthority {
            org_wide: HashMap::from([("logs", true)]),
            ..Default::default()
        };
        assert_eq!(
            readable_mask(&logs_only, &subjects).await,
            [true, false],
            "an alert subject still needs alerts read"
        );
    }

    #[tokio::test]
    async fn an_org_wide_reader_lists_no_grants_and_reads_no_alerts() {
        let auth = CountingAuthority {
            org_wide: HashMap::from([("alerts", true)]),
            ..Default::default()
        };
        let subjects: Vec<Subject<'_>> = (0..1_000).map(|_| alert_subject("a0")).collect();
        assert!(readable_mask(&auth, &subjects).await.iter().all(|ok| *ok));
        assert_eq!(auth.org_wide_calls.load(Ordering::SeqCst), 1);
        assert_eq!(auth.grant_calls.load(Ordering::SeqCst), 0);
        assert_eq!(auth.folder_reads.load(Ordering::SeqCst), 0);
        assert!(readable_mask(&auth, &[]).await.is_empty());
    }

    #[tokio::test]
    async fn a_source_silence_stream_subject_needs_logs_read_org_wide() {
        let stream = EntityRef::new(
            kinds::STREAM,
            &[("stream_type", "logs"), ("stream_name", "k8s_events")],
        );
        let subject = Subject::of(&stream);
        assert_eq!((subject.resource, subject.alert_id), ("logs", None));
        let folder_reader = CountingAuthority {
            folders: HashMap::from([("a0".to_string(), "ops".to_string())]),
            grants: vec!["afolder:ops".into()],
            ..Default::default()
        };
        assert_eq!(readable_mask(&folder_reader, &[subject]).await, [false]);
        let org_reader = CountingAuthority {
            org_wide: HashMap::from([("logs", true)]),
            ..Default::default()
        };
        assert_eq!(readable_mask(&org_reader, &[subject]).await, [true]);
    }

    /// Calibration v1's convention: a switched-off deployment answers 404 before any other check.
    #[tokio::test]
    async fn every_route_is_a_404_while_the_deployment_switch_is_off() {
        ENGINE_ON.with(|on| on.set(Some(false)));
        MAY_CHANGE.with(|may| may.set(Some(false)));
        let mark = "/v2/o/autoobserve/marks/protected/alert/a1";
        for (method, uri, body) in [
            ("GET", "/v2/o/autoobserve/coverage", ""),
            ("GET", "/v2/o/autoobserve/coverage?view=loose", ""),
            ("GET", "/v2/o/autoobserve/coverage/history?from=0&to=1", ""),
            ("GET", "/v2/o/autoobserve/suggestions?limit=abc", ""),
            ("GET", "/v2/o/autoobserve/marks", ""),
            ("PUT", mark, ""),
            ("DELETE", mark, r#"{"group_key":"host=a"}"#),
        ] {
            let response = send(method, uri, body).await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {uri}");
            assert!(is_json(&response), "{method} {uri}");
            let body = axum::body::to_bytes(response.into_body(), MAX_DELETE_BODY)
                .await
                .unwrap();
            assert!(
                String::from_utf8_lossy(&body).contains("O2_AUTOOBSERVE_ENABLED"),
                "{method} {uri}"
            );
        }
        assert_eq!(
            entity_types(Path("o".into())).await.status(),
            StatusCode::NOT_FOUND
        );
    }

    /// A real permission denial stays a 403 while the engine is on.
    #[tokio::test]
    async fn a_denied_mark_change_is_a_403_not_a_404() {
        ENGINE_ON.with(|on| on.set(Some(true)));
        MAY_CHANGE.with(|may| may.set(Some(false)));
        let mark = "/v2/o/autoobserve/marks/protected/alert/a1";
        for method in ["PUT", "DELETE"] {
            let response = send(method, mark, "").await;
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method}");
            assert!(is_json(&response), "{method}");
        }
    }

    #[tokio::test]
    async fn without_the_engine_a_valid_request_is_a_503_and_a_bad_one_a_400() {
        ENGINE_ON.with(|on| on.set(Some(true)));
        let mark = "/v2/o/autoobserve/marks/protected/alert/a1";
        for (method, uri, body) in [
            ("GET", "/v2/o/autoobserve/coverage", ""),
            ("GET", "/v2/o/autoobserve/coverage/history?from=0&to=1", ""),
            ("GET", "/v2/o/autoobserve/suggestions?limit=5&offset=5", ""),
            ("GET", "/v2/o/autoobserve/marks", ""),
            ("PUT", mark, ""),
            ("DELETE", mark, ""),
            (
                "DELETE",
                "/v2/o/autoobserve/marks/protected/alert/a1?group_key=host%3Da",
                "",
            ),
        ] {
            assert_eq!(
                status(method, uri, body).await,
                StatusCode::SERVICE_UNAVAILABLE,
                "{method} {uri}"
            );
        }
        for (method, uri, body) in [
            ("GET", "/v2/o/autoobserve/coverage?view=loose", ""),
            ("PUT", mark, r#"{"groupKey":"host=a"}"#),
            ("DELETE", mark, r#"{"group_key":"host=a"}"#),
            ("GET", "/v2/o/autoobserve/suggestions?limit=abc", ""),
            ("GET", "/v2/o/autoobserve/marks?offset=-3", ""),
            ("GET", "/v2/o/autoobserve/coverage/history?from=1", ""),
        ] {
            let response = send(method, uri, body).await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{method} {uri}");
            assert!(is_json(&response), "{method} {uri}");
        }
    }

    #[test]
    fn engine_errors_and_default_paging_map_as_documented() {
        for (e, want) in [
            (ApiError::Invalid("x".into()), StatusCode::BAD_REQUEST),
            (ApiError::Unavailable, StatusCode::SERVICE_UNAVAILABLE),
            (
                ApiError::Storage("x".into()),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ] {
            assert_eq!(failed(&e).status(), want, "{e:?}");
        }
        assert_eq!(page(None, None), Page::default());
        assert_eq!(
            page(Some(7), Some(14)),
            Page {
                limit: 7,
                offset: 14
            }
        );
    }
}
