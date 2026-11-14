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

//! Detection tuning: per-detection exceptions, org allowlists and suppressions.

use std::sync::{Arc, Mutex};

use axum::{Json, extract::Path, response::Response};
use config::meta::alerts::incidents::CaseVerdict;
use o2_enterprise::enterprise::security::{
    audit, cases,
    tuning::{
        ALL_DETECTIONS, AllowList, AllowListInput, DetectionException, EntityKind, ExceptionView,
        MAX_EXCEPTIONS, MAX_EXCEPTIONS_PER_DETECTION, MAX_LISTS, MAX_SUPPRESSION_MINUTES,
        MAX_SUPPRESSIONS, MAX_TRIAGE_SUPPRESSION_MINUTES, NewException, Suppression,
        TuningSettings, UnenforcedDetection, unenforceable,
    },
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use svix_ksuid::{Ksuid, KsuidLike};
use utoipa::ToSchema;

use super::security_allowed;
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Most detections one "suppress similar" covers.
const MAX_SUPPRESSED_DETECTIONS: usize = 20;
/// Most entities one "suppress similar" on a rolled-up case covers.
const MAX_SUPPRESSED_ENTITIES: usize = 20;
/// Why the triage grant alone cannot create a suppression.
const AUTHOR_SUPPRESSION: &str =
    "Suppressions longer than 7 days or across every detection need the Security write permission";

#[derive(Debug, Serialize, ToSchema)]
pub struct ExceptionsResponse {
    pub exceptions: Vec<ExceptionView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AllowListsResponse {
    pub lists: Vec<AllowList>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SuppressionsResponse {
    pub suppressions: Vec<Suppression>,
}

/// A suppression on one entity, or "suppress similar" from a case when `case_id` is set.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct NewSuppression {
    #[serde(default)]
    pub alert_id: Option<String>,
    #[serde(default)]
    pub entity_kind: Option<EntityKind>,
    #[serde(default)]
    pub entity_value: Option<String>,
    #[serde(default)]
    pub case_id: Option<String>,
    pub duration_minutes: u32,
    pub reason: String,
    /// With `case_id`, also close the case as benign.
    #[serde(default)]
    pub close_case: bool,
}

/// Why a tuning write was refused.
#[derive(Debug)]
enum Refusal {
    BadRequest(String),
    NotFound(String),
    Conflict(String),
}

impl Refusal {
    fn response(self) -> Response {
        match self {
            Self::BadRequest(m) => MetaHttpResponse::bad_request(m),
            Self::NotFound(m) => MetaHttpResponse::not_found(m),
            Self::Conflict(m) => MetaHttpResponse::conflict(m),
        }
    }
}

/// A detection an exception may run against: its id, name, SQL, stream and stream columns.
struct ExceptionTarget {
    alert_id: String,
    name: String,
    sql: String,
    stream: String,
    columns: Vec<String>,
}

/// ListDetectionExceptions
#[utoipa::path(
    get,
    path = "/{org_id}/security/detections/{alert_id}/exceptions",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListDetectionExceptions",
    summary = "A detection's exceptions",
    description = "The exceptions that keep matching rows of a detection from firing; `_all` lists the org-wide ones",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Detection id, or `_all`"),
    ),
    responses((status = 200, description = "Success", content_type = "application/json", body = ExceptionsResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_exceptions(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("Security tuning needs the Security read permission");
    }
    let now = now_micros();
    let tuning = match read_tuning(&org_id).await {
        Ok(tuning) => tuning,
        Err(resp) => return resp,
    };
    let own: Vec<&DetectionException> = tuning
        .exceptions
        .iter()
        .filter(|e| e.alert_id == alert_id)
        .collect();
    let targets = if own.is_empty() {
        Vec::new()
    } else {
        exception_targets(&org_id, &alert_id).await
    };
    MetaHttpResponse::json(ExceptionsResponse {
        exceptions: own
            .into_iter()
            .map(|exception| ExceptionView {
                expired: exception.expired(now),
                not_enforced: not_enforced(exception, &targets, &tuning.lists),
                exception: exception.clone(),
            })
            .collect(),
    })
}

/// CreateDetectionException
#[utoipa::path(
    post,
    path = "/{org_id}/security/detections/{alert_id}/exceptions",
    context_path = "/api",
    tag = "Security",
    operation_id = "CreateDetectionException",
    summary = "Add an exception to a detection",
    description = "Rows of the detection whose field matches any of the values never fire or open a case. Applied when the detection runs; its stored Sigma and SQL stay as they are. `_all` adds an org-wide exception. Needs the Security write grant.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Detection id, or `_all`"),
    ),
    request_body(content = NewException, content_type = "application/json"),
    responses(
        (status = 200, description = "The exception", content_type = "application/json", body = ExceptionView),
        (status = 400, description = "Invalid exception", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security write grant", content_type = "application/json", body = ()),
        (status = 404, description = "Detection not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn create_exception(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(input): Json<NewException>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "POST").await {
        return MetaHttpResponse::forbidden("Exceptions need the Security write permission");
    }
    let columns = match detection_columns(&org_id, &alert_id).await {
        Ok(columns) => columns,
        Err(resp) => return resp,
    };
    let lists = match read_tuning(&org_id).await {
        Ok(tuning) => tuning.lists.clone(),
        Err(resp) => return resp,
    };
    let input = match input.validated(columns.as_deref(), &lists) {
        Ok(input) => input,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    let exception = DetectionException::create(
        &alert_id,
        input,
        &user_id,
        now_micros(),
        Ksuid::new(None, None).to_string(),
    );
    let unenforced = match enforceable(&org_id, &exception, &lists).await {
        Ok(unenforced) => unenforced,
        Err(resp) => return resp,
    };
    let stored = exception.clone();
    audit::mark();
    match write_tuning(&org_id, move |tuning| {
        let own = tuning
            .exceptions
            .iter()
            .filter(|e| e.alert_id == stored.alert_id)
            .count();
        if own >= MAX_EXCEPTIONS_PER_DETECTION || tuning.exceptions.len() >= MAX_EXCEPTIONS {
            return Err(Refusal::BadRequest(format!(
                "A detection holds at most {MAX_EXCEPTIONS_PER_DETECTION} exceptions"
            )));
        }
        tuning.exceptions.push(stored);
        Ok(())
    })
    .await
    {
        Ok(()) => MetaHttpResponse::json(ExceptionView {
            expired: false,
            exception,
            not_enforced: unenforced,
        }),
        Err(resp) => resp,
    }
}

/// UpdateDetectionException
#[utoipa::path(
    put,
    path = "/{org_id}/security/detections/{alert_id}/exceptions/{exception_id}",
    context_path = "/api",
    tag = "Security",
    operation_id = "UpdateDetectionException",
    summary = "Edit a detection's exception",
    description = "Replaces the exception's field, operator, values, reason and expiry. Needs the Security write grant.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Detection id, or `_all`"),
        ("exception_id" = String, Path, description = "Exception id"),
    ),
    request_body(content = NewException, content_type = "application/json"),
    responses(
        (status = 200, description = "The exception", content_type = "application/json", body = ExceptionView),
        (status = 400, description = "Invalid exception", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security write grant", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn update_exception(
    Path((org_id, alert_id, exception_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(input): Json<NewException>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "POST").await {
        return MetaHttpResponse::forbidden("Exceptions need the Security write permission");
    }
    let columns = match detection_columns(&org_id, &alert_id).await {
        Ok(columns) => columns,
        Err(resp) => return resp,
    };
    let lists = match read_tuning(&org_id).await {
        Ok(tuning) => tuning.lists.clone(),
        Err(resp) => return resp,
    };
    let input = match input.validated(columns.as_deref(), &lists) {
        Ok(input) => input,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    let now = now_micros();
    let draft = DetectionException::create(&alert_id, input.clone(), &user_id, now, String::new());
    let unenforced = match enforceable(&org_id, &draft, &lists).await {
        Ok(unenforced) => unenforced,
        Err(resp) => return resp,
    };
    audit::mark();
    match write_tuning(&org_id, move |tuning| {
        let Some(existing) = tuning
            .exceptions
            .iter_mut()
            .find(|e| e.id == exception_id && e.alert_id == alert_id)
        else {
            return Err(Refusal::NotFound("Exception not found".to_string()));
        };
        existing.field = input.field;
        existing.operator = input.operator;
        existing.values = input.values;
        existing.comment = input.comment;
        existing.expires_at = input.expires_at;
        existing.updated_by = Some(user_id);
        existing.updated_at = Some(now);
        Ok(existing.clone())
    })
    .await
    {
        Ok(exception) => MetaHttpResponse::json(ExceptionView {
            expired: exception.expired(now),
            exception,
            not_enforced: unenforced,
        }),
        Err(resp) => resp,
    }
}

/// DeleteDetectionException
#[utoipa::path(
    delete,
    path = "/{org_id}/security/detections/{alert_id}/exceptions/{exception_id}",
    context_path = "/api",
    tag = "Security",
    operation_id = "DeleteDetectionException",
    summary = "Remove a detection's exception",
    description = "Rows the exception kept out fire again from the detection's next run. Needs the Security admin grant.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Detection id, or `_all`"),
        ("exception_id" = String, Path, description = "Exception id"),
    ),
    responses(
        (status = 200, description = "Removed", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security admin grant", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn delete_exception(
    Path((org_id, alert_id, exception_id)): Path<(String, String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "DELETE").await {
        return MetaHttpResponse::forbidden(
            "Removing an exception needs the Security admin permission",
        );
    }
    audit::mark();
    match write_tuning(&org_id, move |tuning| {
        let before = tuning.exceptions.len();
        tuning
            .exceptions
            .retain(|e| !(e.id == exception_id && e.alert_id == alert_id));
        if tuning.exceptions.len() == before {
            return Err(Refusal::NotFound("Exception not found".to_string()));
        }
        Ok(())
    })
    .await
    {
        Ok(()) => MetaHttpResponse::json(serde_json::json!({"deleted": true})),
        Err(resp) => resp,
    }
}

/// ListSecurityAllowlists
#[utoipa::path(
    get,
    path = "/{org_id}/security/allowlists",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListSecurityAllowlists",
    summary = "The org's Security allowlists",
    description = "Known egress addresses, sanctioned scanners, service accounts, privileged accounts and critical hosts that exceptions and case priority read",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, description = "Success", content_type = "application/json", body = AllowListsResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_allowlists(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("Security tuning needs the Security read permission");
    }
    match read_tuning(&org_id).await {
        Ok(tuning) => MetaHttpResponse::json(AllowListsResponse {
            lists: tuning.lists.clone(),
        }),
        Err(resp) => resp,
    }
}

/// PutSecurityAllowlist
#[utoipa::path(
    put,
    path = "/{org_id}/security/allowlists/{list_id}",
    context_path = "/api",
    tag = "Security",
    operation_id = "PutSecurityAllowlist",
    summary = "Create or replace a Security allowlist",
    description = "Known egress and scanner lists hold IP addresses or CIDRs. Needs the Security write grant.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("list_id" = String, Path, description = "List id: 1 to 64 of a-z, 0-9, '_' or '-'"),
    ),
    request_body(content = AllowListInput, content_type = "application/json"),
    responses(
        (status = 200, description = "The list", content_type = "application/json", body = AllowList),
        (status = 400, description = "Invalid list", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security write grant", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn put_allowlist(
    Path((org_id, list_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(input): Json<AllowListInput>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "POST").await {
        return MetaHttpResponse::forbidden("Allowlists need the Security write permission");
    }
    let list = match input.into_list(&list_id, &user_id, now_micros()) {
        Ok(list) => list,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    let stored = list.clone();
    audit::mark();
    match write_tuning(&org_id, move |tuning| {
        match tuning.lists.iter().position(|l| l.id == stored.id) {
            Some(at) => tuning.lists[at] = stored,
            None if tuning.lists.len() >= MAX_LISTS => {
                return Err(Refusal::BadRequest(format!(
                    "An org holds at most {MAX_LISTS} allowlists"
                )));
            }
            None => tuning.lists.push(stored),
        }
        Ok(())
    })
    .await
    {
        Ok(()) => MetaHttpResponse::json(list),
        Err(resp) => resp,
    }
}

/// DeleteSecurityAllowlist
#[utoipa::path(
    delete,
    path = "/{org_id}/security/allowlists/{list_id}",
    context_path = "/api",
    tag = "Security",
    operation_id = "DeleteSecurityAllowlist",
    summary = "Remove a Security allowlist",
    description = "Refused while an exception reads the list. Needs the Security admin grant.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("list_id" = String, Path, description = "List id"),
    ),
    responses(
        (status = 200, description = "Removed", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security admin grant", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
        (status = 409, description = "An exception reads the list", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn delete_allowlist(
    Path((org_id, list_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "DELETE").await {
        return MetaHttpResponse::forbidden(
            "Removing an allowlist needs the Security admin permission",
        );
    }
    audit::mark();
    match write_tuning(&org_id, move |tuning| {
        if tuning.exceptions.iter().any(|e| {
            e.values.contains(&list_id)
                && e.operator
                    == o2_enterprise::enterprise::security::tuning::ExceptionOperator::InList
        }) {
            return Err(Refusal::Conflict(format!(
                "An exception reads the list '{list_id}'; remove it first"
            )));
        }
        let before = tuning.lists.len();
        tuning.lists.retain(|l| l.id != list_id);
        if tuning.lists.len() == before {
            return Err(Refusal::NotFound("Allowlist not found".to_string()));
        }
        Ok(())
    })
    .await
    {
        Ok(()) => MetaHttpResponse::json(serde_json::json!({"deleted": true})),
        Err(resp) => resp,
    }
}

/// ListSecuritySuppressions
#[utoipa::path(
    get,
    path = "/{org_id}/security/suppressions",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListSecuritySuppressions",
    summary = "Active suppressions",
    description = "Detections whose firings on an entity are dropped until a time",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses((status = 200, description = "Success", content_type = "application/json", body = SuppressionsResponse)),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_suppressions(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("Security tuning needs the Security read permission");
    }
    let now = now_micros();
    match read_tuning(&org_id).await {
        Ok(tuning) => MetaHttpResponse::json(SuppressionsResponse {
            suppressions: tuning
                .suppressions
                .iter()
                .filter(|s| s.until > now)
                .cloned()
                .collect(),
        }),
        Err(resp) => resp,
    }
}

/// CreateSecuritySuppression
#[utoipa::path(
    post,
    path = "/{org_id}/security/suppressions",
    context_path = "/api",
    tag = "Security",
    operation_id = "CreateSecuritySuppression",
    summary = "Suppress a detection on an entity, or suppress similar from a case",
    description = "Drops firings of a detection (or every detection when `alert_id` is absent) on one host, user or address for `duration_minutes`. With `case_id` the detections and entities come from the case, and `close_case` closes it as benign. The Security triage grant may suppress one detection on an entity for up to 7 days with a reason; every-detection or longer suppressions need the Security write grant.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = NewSuppression, content_type = "application/json"),
    responses(
        (status = 200, description = "The suppressions", content_type = "application/json", body = SuppressionsResponse),
        (status = 400, description = "Invalid suppression", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security triage grant, or the write grant for a wider suppression", content_type = "application/json", body = ()),
        (status = 404, description = "Case not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn create_suppression(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<NewSuppression>,
) -> Response {
    let user_id = user_email.user_id;
    let author = security_allowed(&org_id, &user_id, "POST").await;
    let triage = author || security_allowed(&org_id, &user_id, "PUT").await;
    if !triage {
        return MetaHttpResponse::forbidden("Suppressions need the Security triage permission");
    }
    if req.close_case && !security_allowed(&org_id, &user_id, "PUT").await {
        return MetaHttpResponse::forbidden(super::case_refusal("PUT"));
    }
    if let Some(refusal) = scope_refusal(&req, author) {
        return MetaHttpResponse::forbidden(refusal);
    }
    let created = match store_suppressions(&org_id, &req, &user_id).await {
        Ok(created) => created,
        Err(resp) => return resp,
    };
    if req.close_case
        && let Some(case_id) = req.case_id.as_deref()
        && let Err(e) = super::triage::close_case(
            &org_id,
            case_id,
            CaseVerdict::Benign,
            &format!("Suppressed similar: {}", req.reason.trim()),
            &user_id,
        )
        .await
    {
        log::error!("[SECURITY] could not close suppressed case {org_id}/{case_id}: {e}");
    }
    MetaHttpResponse::json(SuppressionsResponse {
        suppressions: created,
    })
}

/// DeleteSecuritySuppression
#[utoipa::path(
    delete,
    path = "/{org_id}/security/suppressions/{suppression_id}",
    context_path = "/api",
    tag = "Security",
    operation_id = "DeleteSecuritySuppression",
    summary = "End a suppression",
    description = "Firings it dropped fire again from the detection's next run. Needs the Security admin grant.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("suppression_id" = String, Path, description = "Suppression id"),
    ),
    responses(
        (status = 200, description = "Removed", content_type = "application/json", body = ()),
        (status = 403, description = "Needs the Security admin grant", content_type = "application/json", body = ()),
        (status = 404, description = "Not found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn delete_suppression(
    Path((org_id, suppression_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "DELETE").await {
        return MetaHttpResponse::forbidden(
            "Ending a suppression needs the Security admin permission",
        );
    }
    audit::mark();
    match write_tuning(&org_id, move |tuning| {
        let before = tuning.suppressions.len();
        tuning.suppressions.retain(|s| s.id != suppression_id);
        if tuning.suppressions.len() == before {
            return Err(Refusal::NotFound("Suppression not found".to_string()));
        }
        Ok(())
    })
    .await
    {
        Ok(()) => MetaHttpResponse::json(serde_json::json!({"deleted": true})),
        Err(resp) => resp,
    }
}

/// Validates and stores the suppressions one request asks for, audited.
pub(super) async fn store_suppressions(
    org_id: &str,
    req: &NewSuppression,
    user_id: &str,
) -> Result<Vec<Suppression>, Response> {
    let reason = req.reason.trim().to_string();
    if reason.is_empty() || reason.chars().count() > cases::MAX_VERDICT_REASON_CHARS {
        return Err(MetaHttpResponse::bad_request(format!(
            "The reason must be 1 to {} characters",
            cases::MAX_VERDICT_REASON_CHARS
        )));
    }
    if !(1..=MAX_SUPPRESSION_MINUTES).contains(&req.duration_minutes) {
        return Err(MetaHttpResponse::bad_request(format!(
            "The duration must be 1 to {MAX_SUPPRESSION_MINUTES} minutes"
        )));
    }
    let targets = suppression_targets(org_id, req).await?;
    let now = now_micros();
    let until = now + i64::from(req.duration_minutes) * 60_000_000;
    let created: Vec<Suppression> = targets
        .detections
        .iter()
        .flat_map(|alert_id| {
            targets.entities.iter().map(|(kind, value)| Suppression {
                id: Ksuid::new(None, None).to_string(),
                alert_id: alert_id.clone(),
                entity_kind: *kind,
                entity_value: value.clone(),
                until,
                reason: reason.clone(),
                created_by: user_id.to_string(),
                created_at: now,
                case_id: req.case_id.clone(),
            })
        })
        .collect();
    let stored = created.clone();
    audit::mark();
    write_tuning(org_id, move |tuning| {
        if tuning.suppressions.len() + stored.len() > MAX_SUPPRESSIONS {
            return Err(Refusal::BadRequest(format!(
                "An org holds at most {MAX_SUPPRESSIONS} active suppressions"
            )));
        }
        tuning.suppressions.extend(stored);
        Ok(())
    })
    .await?;
    Ok(created)
}

/// Why the triage grant alone may not create `req`; authors may create any suppression.
pub(super) fn scope_refusal(req: &NewSuppression, author: bool) -> Option<&'static str> {
    let names_detection = req.case_id.is_some()
        || req
            .alert_id
            .as_deref()
            .is_some_and(|a| !a.trim().is_empty());
    (!author && (req.duration_minutes > MAX_TRIAGE_SUPPRESSION_MINUTES || !names_detection))
        .then_some(AUTHOR_SUPPRESSION)
}

/// What one suppression request covers: detections (`None` = all) on each entity.
struct SuppressionTargets {
    detections: Vec<Option<String>>,
    entities: Vec<(EntityKind, String)>,
}

async fn suppression_targets(
    org_id: &str,
    req: &NewSuppression,
) -> Result<SuppressionTargets, Response> {
    let Some(case_id) = req.case_id.as_deref() else {
        let (Some(kind), Some(raw)) = (req.entity_kind, req.entity_value.as_deref()) else {
            return Err(MetaHttpResponse::bad_request(
                "Name the entity, or the case to suppress similar firings of",
            ));
        };
        let Some(entity) = cases::entity_from(kind.as_str(), raw) else {
            return Err(MetaHttpResponse::bad_request(format!(
                "'{}' is not a {} entity",
                raw.trim(),
                kind.as_str()
            )));
        };
        let alert_id = req
            .alert_id
            .as_deref()
            .map(str::trim)
            .filter(|a| !a.is_empty());
        if let Some(alert_id) = alert_id
            && !super::is_siem_alert(org_id, alert_id).await
        {
            return Err(MetaHttpResponse::bad_request(format!(
                "{alert_id} is not a Security detection"
            )));
        }
        return Ok(SuppressionTargets {
            detections: vec![alert_id.map(str::to_string)],
            entities: vec![(kind, entity.value)],
        });
    };
    let case = match infra::table::alert_incidents::get(org_id, case_id).await {
        Ok(Some(case)) => case,
        Ok(None) => return Err(MetaHttpResponse::not_found("Incident not found")),
        Err(e) => return Err(MetaHttpResponse::internal_error(e)),
    };
    if !case.security_case && !super::incident_touches_siem(org_id, case_id).await {
        return Err(MetaHttpResponse::bad_request("Not a Security case"));
    }
    let named = cases::case_entities(&case.group_values);
    // A keyed case is about its key entity; a rolled-up one about each entity it absorbed.
    let entities: Vec<(EntityKind, String)> = named
        .into_iter()
        .filter_map(|(kind, value)| Some((EntityKind::of_name(kind)?, value)))
        .take(if keyed(&case.group_values) {
            1
        } else {
            MAX_SUPPRESSED_ENTITIES
        })
        .collect();
    if entities.is_empty() {
        return Err(MetaHttpResponse::bad_request(
            "The case names no host, user or address to suppress",
        ));
    }
    // The case key may hold a rule id shared by several detections, so its firings name them.
    let links = infra::table::alert_incidents::get_incident_alerts(case_id)
        .await
        .map_err(MetaHttpResponse::internal_error)?;
    let mut detections: Vec<Option<String>> = Vec::new();
    for link in links {
        let id = Some(link.alert_id);
        if !detections.contains(&id) && detections.len() < MAX_SUPPRESSED_DETECTIONS {
            detections.push(id);
        }
    }
    if detections.is_empty() {
        return Err(MetaHttpResponse::bad_request(
            "The case has no detection to suppress",
        ));
    }
    Ok(SuppressionTargets {
        detections,
        entities,
    })
}

/// Whether a case's match key names an entity, rather than only listing what it rolled up.
fn keyed(group_values: &serde_json::Value) -> bool {
    let dims = cases::match_key(group_values);
    [cases::HOST_KEY, cases::USER_KEY, cases::IP_KEY]
        .iter()
        .any(|key| dims.contains_key(*key))
}

/// The detection's stream columns; `None` for org-wide exceptions, which match any stream.
async fn detection_columns(org_id: &str, alert_id: &str) -> Result<Option<Vec<String>>, Response> {
    if alert_id == ALL_DETECTIONS {
        return Ok(None);
    }
    let not_found = || MetaHttpResponse::not_found("Detection not found");
    let Ok(id) = alert_id.parse::<Ksuid>() else {
        return Err(not_found());
    };
    if !super::is_siem_alert(org_id, alert_id).await {
        return Err(not_found());
    }
    let alert = match db::alerts::alert::get_by_id(infra::db::get_orm_client_ro().await, org_id, id)
        .await
    {
        Ok(Some((_, alert))) => alert,
        Ok(None) => return Err(not_found()),
        Err(e) => return Err(MetaHttpResponse::internal_error(e)),
    };
    match infra::schema::get(org_id, &alert.stream_name, alert.stream_type).await {
        Ok(schema) => Ok(Some(
            schema.fields().iter().map(|f| f.name().clone()).collect(),
        )),
        Err(e) => Err(MetaHttpResponse::internal_error(e)),
    }
}

async fn read_tuning(org_id: &str) -> Result<Arc<TuningSettings>, Response> {
    db::organization::read_org_setting(org_id, |s| s.security_tuning.shared())
        .await
        .map_err(MetaHttpResponse::internal_error)
}

/// Applies `apply` to the org's tuning and stores it; ended suppressions are pruned on the way.
async fn write_tuning<T: Send + 'static>(
    org_id: &str,
    apply: impl FnOnce(&mut TuningSettings) -> Result<T, Refusal> + Send + 'static,
) -> Result<T, Response> {
    let outcome: Arc<Mutex<Option<Result<T, Refusal>>>> = Arc::new(Mutex::new(None));
    let slot = outcome.clone();
    let now = now_micros();
    let written = db::organization::update_org_setting(org_id, move |data| {
        let tuning = data.security_tuning.make_mut();
        let before = serde_json::to_vec(&*tuning).map_or(0, |b| b.len());
        tuning.prune(now);
        let result = apply(tuning).and_then(|value| within_size(tuning, before).map(|()| value));
        let ok = result.is_ok();
        if let Ok(mut slot) = slot.lock() {
            *slot = Some(result);
        }
        ok
    })
    .await;
    if let Err(e) = written {
        return Err(MetaHttpResponse::internal_error(e));
    }
    let result = outcome.lock().ok().and_then(|mut slot| slot.take());
    match result {
        Some(Ok(value)) => Ok(value),
        Some(Err(refusal)) => Err(refusal.response()),
        None => Err(MetaHttpResponse::internal_error(
            "The tuning write did not run",
        )),
    }
}

/// Refuses a write that leaves the tuning over its cap and larger than it found it.
fn within_size(tuning: &TuningSettings, before: usize) -> Result<(), Refusal> {
    match tuning.check_size() {
        Err(msg) if serde_json::to_vec(tuning).map_or(0, |b| b.len()) > before => {
            Err(Refusal::BadRequest(msg))
        }
        _ => Ok(()),
    }
}

/// The detections an exception on `alert_id` applies to: that one, or every one for `_all`.
async fn exception_targets(org_id: &str, alert_id: &str) -> Vec<ExceptionTarget> {
    let prefix = format!("{org_id}/");
    let alerts: Vec<config::meta::alerts::alert::Alert> = common::infra::config::ALERTS
        .read()
        .await
        .iter()
        .filter(|(key, (_, alert))| {
            key.starts_with(&prefix)
                && super::marks_siem(alert.context_attributes.as_ref())
                && (alert_id == ALL_DETECTIONS
                    || alert.id.is_some_and(|id| id.to_string() == alert_id))
        })
        .map(|(_, (_, alert))| alert.clone())
        .collect();
    let mut schemas: std::collections::HashMap<(String, String), Vec<String>> =
        std::collections::HashMap::new();
    let mut targets = Vec::with_capacity(alerts.len());
    for alert in alerts {
        let Some(sql) = alert
            .query_condition
            .sql
            .clone()
            .filter(|s| !s.trim().is_empty())
        else {
            continue;
        };
        let key = (alert.stream_type.to_string(), alert.stream_name.clone());
        if !schemas.contains_key(&key) {
            let columns = infra::schema::get(org_id, &alert.stream_name, alert.stream_type)
                .await
                .map(|schema| schema.fields().iter().map(|f| f.name().clone()).collect())
                .unwrap_or_default();
            schemas.insert(key.clone(), columns);
        }
        targets.push(ExceptionTarget {
            alert_id: alert.id.map(|id| id.to_string()).unwrap_or_default(),
            name: alert.name,
            sql,
            stream: alert.stream_name,
            columns: schemas.get(&key).cloned().unwrap_or_default(),
        });
    }
    targets
}

/// The detections whose SQL cannot carry `exception`, so the scheduler would only filter rows.
fn not_enforced(
    exception: &DetectionException,
    targets: &[ExceptionTarget],
    lists: &[AllowList],
) -> Vec<UnenforcedDetection> {
    targets
        .iter()
        .filter_map(|t| {
            unenforceable(exception, &t.sql, &t.stream, lists, &t.columns).map(|reason| {
                UnenforcedDetection {
                    alert_id: t.alert_id.clone(),
                    name: t.name.clone(),
                    reason,
                }
            })
        })
        .collect()
}

/// Refuses an exception its own detection's SQL cannot carry; `_all` reports those it misses.
async fn enforceable(
    org_id: &str,
    exception: &DetectionException,
    lists: &[AllowList],
) -> Result<Vec<UnenforcedDetection>, Response> {
    let targets = exception_targets(org_id, &exception.alert_id).await;
    let unenforced = not_enforced(exception, &targets, lists);
    match unenforced.first() {
        Some(miss) if exception.alert_id != ALL_DETECTIONS => {
            Err(MetaHttpResponse::bad_request(format!(
                "This exception cannot be enforced on this detection, so matching events would still be searched and only some dropped: {}. Use a field the detection's query reads from its stream directly.",
                miss.reason
            )))
        }
        _ => Ok(unenforced),
    }
}

fn now_micros() -> i64 {
    chrono::Utc::now().timestamp_micros()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_a_suppression_needs_an_entity_or_a_case() {
        let req = NewSuppression {
            alert_id: None,
            entity_kind: None,
            entity_value: None,
            case_id: None,
            duration_minutes: 60,
            reason: "travel".to_string(),
            close_case: false,
        };
        let refused = suppression_targets("acme", &req).await.err().unwrap();
        assert_eq!(refused.status(), axum::http::StatusCode::BAD_REQUEST);
        let bad_ip = NewSuppression {
            entity_kind: Some(EntityKind::Ip),
            entity_value: Some("not an ip".to_string()),
            ..req.clone()
        };
        assert!(suppression_targets("acme", &bad_ip).await.is_err());
        let user = NewSuppression {
            entity_kind: Some(EntityKind::User),
            entity_value: Some("CORP\\Dave".to_string()),
            ..req
        };
        let targets = suppression_targets("acme", &user).await.ok().unwrap();
        assert_eq!(targets.detections, [None]);
        assert_eq!(
            targets.entities,
            [(EntityKind::User, "dave@corp".to_string())]
        );
    }

    #[test]
    fn test_triage_suppresses_one_detection_for_a_week_at_most() {
        let base = NewSuppression {
            alert_id: Some("31det".to_string()),
            entity_kind: Some(EntityKind::Host),
            entity_value: Some("win-fin-008".to_string()),
            case_id: None,
            duration_minutes: MAX_TRIAGE_SUPPRESSION_MINUTES,
            reason: "patch window".to_string(),
            close_case: false,
        };
        assert_eq!(scope_refusal(&base, false), None);
        let from_case = NewSuppression {
            alert_id: None,
            case_id: Some("2case".to_string()),
            ..base.clone()
        };
        assert_eq!(scope_refusal(&from_case, false), None);
        let longer = NewSuppression {
            duration_minutes: MAX_TRIAGE_SUPPRESSION_MINUTES + 1,
            ..base.clone()
        };
        assert_eq!(scope_refusal(&longer, false), Some(AUTHOR_SUPPRESSION));
        assert_eq!(scope_refusal(&longer, true), None);
        let every_detection = NewSuppression {
            alert_id: Some(" ".to_string()),
            ..base
        };
        assert_eq!(
            scope_refusal(&every_detection, false),
            Some(AUTHOR_SUPPRESSION)
        );
        assert_eq!(scope_refusal(&every_detection, true), None);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_the_triage_grant_is_held_to_narrow_suppressions() {
        use axum::http::StatusCode;

        let reader = "q-reader@acme.io";
        let triager = "q-triager@acme.io";
        super::super::tests::grant(reader, &["GET"]);
        super::super::tests::grant(triager, &["GET", "PUT"]);
        let call = |user: &str, req: NewSuppression| {
            create_suppression(
                Path("acme".to_string()),
                Headers(UserEmail {
                    user_id: user.to_string(),
                }),
                Json(req),
            )
        };
        let req = NewSuppression {
            alert_id: None,
            entity_kind: Some(EntityKind::Ip),
            entity_value: Some("10.0.0.5".to_string()),
            case_id: None,
            duration_minutes: 60,
            reason: "scanner".to_string(),
            close_case: false,
        };
        assert_eq!(
            call(reader, req.clone()).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(triager, req.clone()).await.status(),
            StatusCode::FORBIDDEN,
            "every detection on an entity is authoring"
        );
        let too_long = NewSuppression {
            alert_id: Some("31det".to_string()),
            duration_minutes: MAX_TRIAGE_SUPPRESSION_MINUTES + 60,
            ..req
        };
        assert_eq!(
            call(triager, too_long).await.status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn test_only_a_case_key_entity_makes_a_case_keyed() {
        assert!(keyed(
            &serde_json::json!({cases::HOST_KEY: "win-1", cases::DETECTION_KEY: "d"})
        ));
        let mut rolled = serde_json::json!({});
        cases::list_entity(&mut rolled, &cases::entity_from("user", "kevin").unwrap());
        assert!(!keyed(&rolled));
        assert_eq!(cases::case_entities(&rolled).len(), 1);
    }

    #[tokio::test]
    async fn test_org_wide_exceptions_skip_the_column_check() {
        assert!(matches!(
            detection_columns("acme", ALL_DETECTIONS).await,
            Ok(None)
        ));
        let refused = detection_columns("acme", "not-a-ksuid")
            .await
            .err()
            .unwrap();
        assert_eq!(refused.status(), axum::http::StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_a_write_that_grows_tuning_past_the_cap_is_refused() {
        use o2_enterprise::enterprise::security::tuning::{ListPurpose, MAX_LIST_VALUES};

        let mut tuning = TuningSettings::default();
        assert!(within_size(&tuning, 0).is_ok());
        let values: Vec<String> = (0..MAX_LIST_VALUES).map(|i| format!("{i:0>500}")).collect();
        for i in 0..3 {
            tuning.lists.push(AllowList {
                id: format!("l{i}"),
                name: "big".to_string(),
                purpose: ListPurpose::Other,
                values: values.clone(),
                description: String::new(),
                updated_by: "a".to_string(),
                updated_at: 0,
            });
        }
        let refused = within_size(&tuning, 0).err().unwrap().response();
        assert_eq!(refused.status(), axum::http::StatusCode::BAD_REQUEST);
        let size = serde_json::to_vec(&tuning).unwrap().len();
        assert!(
            within_size(&tuning, size).is_ok(),
            "a write that shrinks an oversized blob still goes through"
        );
    }

    #[tokio::test]
    async fn test_an_exception_a_detection_cannot_carry_is_refused_or_reported() {
        use common::meta::stream::StreamCreate;
        use config::meta::{
            alerts::alert::{Alert, SIEM_ATTRIBUTE},
            folder::Folder,
            stream::{StreamField, StreamSettings, StreamType},
        };
        use o2_enterprise::enterprise::security::tuning::ExceptionOperator;

        super::super::tests::meta_store().await;
        let org = format!("tune{}", &config::ider::uuid().replace('-', "")[..10]);
        let created = stream::create_stream(
            &org,
            "fw",
            StreamType::Logs,
            StreamCreate {
                fields: ["user", "host"]
                    .iter()
                    .map(|name| StreamField {
                        name: name.to_string(),
                        r#type: "Utf8".to_string(),
                    })
                    .collect(),
                settings: StreamSettings::default(),
            },
        )
        .await
        .unwrap();
        assert_eq!(created.status(), axum::http::StatusCode::OK);
        let plant = |sql: &str| {
            let id = Ksuid::new(None, None);
            let mut alert = Alert::default();
            alert.id = Some(id);
            alert.org_id = org.clone();
            alert.name = format!("det-{id}");
            alert.stream_name = "fw".to_string();
            alert.query_condition.sql = Some(sql.to_string());
            alert.context_attributes = Some(
                [(SIEM_ATTRIBUTE.to_string(), "true".to_string())]
                    .into_iter()
                    .collect(),
            );
            (id.to_string(), alert)
        };
        let (joined, join_alert) =
            plant("SELECT a.user FROM \"fw\" a JOIN \"dns\" b ON a.host = b.host");
        let (plain, plain_alert) = plant("SELECT * FROM \"fw\" WHERE host = 'x'");
        for (id, alert) in [(&joined, join_alert), (&plain, plain_alert)] {
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(&org, id),
                (Folder::default(), alert),
            );
        }
        let exception = |alert_id: &str| {
            DetectionException::create(
                alert_id,
                NewException {
                    field: "user".to_string(),
                    operator: ExceptionOperator::Equals,
                    values: vec!["svc-scan".to_string()],
                    comment: "scanner".to_string(),
                    expires_at: None,
                },
                "author",
                1,
                "e1".to_string(),
            )
        };
        let refused = enforceable(&org, &exception(&joined), &[])
            .await
            .err()
            .unwrap();
        assert_eq!(refused.status(), axum::http::StatusCode::BAD_REQUEST);
        assert!(
            enforceable(&org, &exception(&plain), &[])
                .await
                .unwrap()
                .is_empty()
        );
        let missed = enforceable(&org, &exception(ALL_DETECTIONS), &[])
            .await
            .unwrap();
        assert_eq!(
            missed
                .iter()
                .map(|m| m.alert_id.as_str())
                .collect::<Vec<_>>(),
            [joined.as_str()]
        );
    }

    #[test]
    fn test_refusals_map_to_their_status() {
        use axum::http::StatusCode;
        assert_eq!(
            Refusal::BadRequest("x".into()).response().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            Refusal::NotFound("x".into()).response().status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            Refusal::Conflict("x".into()).response().status(),
            StatusCode::CONFLICT
        );
    }
}
