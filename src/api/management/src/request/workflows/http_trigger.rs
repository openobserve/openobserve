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

//! Management routes of a workflow's HTTP endpoint: config, credentials, reveal and test runs.

use axum::{
    Json,
    extract::Path,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use infra::table::workflow_http_triggers::AuthMode;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, check_permissions},
    workflows::http_trigger::{
        enqueue,
        manage::{self, EndpointPermissions, ManageError, UpsertOutcome, UpsertRequest},
    },
};

use super::WorkflowTestResult;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::organization::require_credential_access,
    service::workflows::{self, TestWorkflowOptions},
};

const NO_STORE: &str = "no-store, private";
const REVEAL_ACTION: &str = "reveal a workflow endpoint credential";
const ROTATE_ACTION: &str = "mint a workflow endpoint credential";

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct PutHttpTriggerBody {
    pub enabled: bool,
    pub auth_mode: String,
    pub max_body_bytes: Option<i64>,
    pub rate_limit_per_minute: Option<i32>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct RotateBody {
    pub overlap_seconds: i64,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
pub struct HttpTriggerTestBody {
    #[serde(default)]
    pub data: Vec<serde_json::Value>,
    #[serde(default)]
    pub from_node: Option<String>,
    #[serde(default)]
    pub run_destinations: bool,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct SecretResponse<T: serde::Serialize> {
    #[serde(flatten)]
    pub body: T,
    pub secret: Option<String>,
}

/// The 404 still tells the UI what the caller may do and what the org allows.
#[derive(serde::Serialize)]
struct NotConfiguredBody {
    #[serde(flatten)]
    base: MetaHttpResponse,
    permissions: EndpointPermissions,
    org_rate_limit_per_minute: u32,
    secrets_encrypted_at_rest: bool,
}

/// GetWorkflowHttpTrigger
#[utoipa::path(
    get,
    path = "/{org_id}/workflows/{id}/http_trigger",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "getWorkflowHttpTrigger",
    summary = "Get the HTTP endpoint of a workflow",
    description = "Configuration, live credentials (display prefix only) and what the caller may do",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = manage::TriggerView),
        (status = 404, description = "No endpoint is configured (not_configured)", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Workflows", "operation": "get"})),
    )
)]
pub async fn get_http_trigger(
    Headers(user): Headers<UserEmail>,
    Path((org_id, id)): Path<(String, String)>,
) -> Response {
    let permissions = endpoint_permissions(&org_id, &id, &user.user_id).await;
    match manage::get(&org_id, &id, permissions).await {
        Ok(view) => MetaHttpResponse::json(view),
        Err(ManageError::NotConfigured) => {
            let mut base = MetaHttpResponse::error(
                StatusCode::NOT_FOUND,
                "No HTTP endpoint is configured for this workflow",
            );
            base.error_detail = Some("not_configured".to_string());
            let body = NotConfiguredBody {
                base,
                permissions,
                org_rate_limit_per_minute: manage::org_budget(),
                secrets_encrypted_at_rest: manage::secrets_encrypted_at_rest(),
            };
            (StatusCode::NOT_FOUND, Json(body)).into_response()
        }
        Err(e) => manage_error(e),
    }
}

/// PutWorkflowHttpTrigger
#[utoipa::path(
    put,
    path = "/{org_id}/workflows/{id}/http_trigger",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "putWorkflowHttpTrigger",
    summary = "Turn on, update or switch the mode of a workflow's HTTP endpoint",
    description = "Creating the endpoint or switching its mode mints a credential and returns it once in `secret`",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id (published or draft)"),
    ),
    request_body(content = PutHttpTriggerBody, description = "Endpoint settings", content_type = "application/json"),
    responses(
        (status = 200, description = "Updated; a mode switch also carries the new `secret`", content_type = "application/json", body = Object),
        (status = 201, description = "Created, with the new `secret`", content_type = "application/json", body = Object),
        (status = 400, description = "invalid_limit or invalid_auth_mode", content_type = "application/json", body = ()),
        (status = 403, description = "Minting a credential needs credential access", content_type = "application/json", body = ()),
        (status = 404, description = "workflow_not_found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error, e.g. stored secrets are off", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Workflows", "operation": "update"})),
    )
)]
pub async fn put_http_trigger(
    Headers(user): Headers<UserEmail>,
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<PutHttpTriggerBody>,
) -> Response {
    let Some(auth_mode) = AuthMode::parse(&body.auth_mode) else {
        return coded(
            StatusCode::BAD_REQUEST,
            "invalid_auth_mode",
            "auth_mode must be token or signature",
        );
    };
    let req = UpsertRequest {
        enabled: body.enabled,
        auth_mode,
        max_body_bytes: body.max_body_bytes,
        rate_limit_per_minute: body.rate_limit_per_minute,
    };
    let permissions = endpoint_permissions(&org_id, &id, &user.user_id).await;
    let access = credential_access(&org_id, &user.user_id).await;
    match manage::upsert(&org_id, &id, req, &user.user_id, permissions, access).await {
        Ok(UpsertOutcome::Created { config, secret }) => {
            with_secret(StatusCode::CREATED, config, secret.plaintext)
        }
        Ok(UpsertOutcome::ModeSwitched { config, secret }) => {
            with_secret(StatusCode::OK, config, secret.plaintext)
        }
        Ok(UpsertOutcome::Updated { config }) => MetaHttpResponse::json(SecretResponse {
            body: config,
            secret: None,
        }),
        Err(e) => manage_error(e),
    }
}

/// DeleteWorkflowHttpTrigger
#[utoipa::path(
    delete,
    path = "/{org_id}/workflows/{id}/http_trigger",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "deleteWorkflowHttpTrigger",
    summary = "Delete a workflow's HTTP endpoint",
    description = "Revokes every credential, deletes their stored secrets and the queued runs",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, description = "not_configured", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Workflows", "operation": "delete"})),
    )
)]
pub async fn delete_http_trigger(Path((org_id, id)): Path<(String, String)>) -> Response {
    match manage::delete(&org_id, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => manage_error(e),
    }
}

/// RotateWorkflowHttpCredential
#[utoipa::path(
    post,
    path = "/{org_id}/workflows/{id}/http_trigger/credentials",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "rotateWorkflowHttpCredential",
    summary = "Mint a new credential for a workflow's HTTP endpoint",
    description = "The old credential stays valid for `overlap_seconds` (0, 3600, 86400 or 604800), or is revoked at once for 0",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
    ),
    request_body(content = RotateBody, description = "Overlap of the old credential", content_type = "application/json"),
    responses(
        (status = 201, description = "The new credential with its `secret`", content_type = "application/json", body = Object),
        (status = 400, description = "invalid_overlap", content_type = "application/json", body = ()),
        (status = 403, description = "Minting a credential needs credential access", content_type = "application/json", body = ()),
        (status = 404, description = "not_configured", content_type = "application/json", body = ()),
        (status = 409, description = "credential_retiring: revoke the retiring credential first", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Workflows", "operation": "update"})),
    )
)]
pub async fn rotate_http_credential(
    Headers(user): Headers<UserEmail>,
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<RotateBody>,
) -> Response {
    if let Err(denied) = require_credential_access(&org_id, &user.user_id, ROTATE_ACTION).await {
        return denied;
    }
    match manage::rotate(&org_id, &id, body.overlap_seconds, &user.user_id).await {
        Ok((view, secret)) => with_secret(StatusCode::CREATED, view, secret.plaintext),
        Err(e) => manage_error(e),
    }
}

/// RevokeWorkflowHttpCredential
#[utoipa::path(
    delete,
    path = "/{org_id}/workflows/{id}/http_trigger/credentials/{cred_id}",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "revokeWorkflowHttpCredential",
    summary = "Revoke a credential of a workflow's HTTP endpoint",
    description = "",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
        ("cred_id" = String, Path, description = "Credential id"),
    ),
    responses(
        (status = 204, description = "Revoked"),
        (status = 404, description = "not_configured or credential_not_found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Workflows", "operation": "delete"})),
    )
)]
pub async fn revoke_http_credential(
    Path((org_id, id, cred_id)): Path<(String, String, String)>,
) -> Response {
    match manage::revoke(&org_id, &id, &cred_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => manage_error(e),
    }
}

/// PUT row plus `require_credential_access`; never cached; audits every successful reveal.
#[utoipa::path(
    get,
    path = "/{org_id}/workflows/{id}/http_trigger/credentials/{cred_id}/secret",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "revealWorkflowHttpCredentialSecret",
    summary = "Show the value of a live credential of a workflow's HTTP endpoint",
    description = "Audited; never cached",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id"),
        ("cred_id" = String, Path, description = "Credential id"),
    ),
    responses(
        (status = 200, description = "The credential and its `secret`", content_type = "application/json", body = Object),
        (status = 403, description = "Needs credential access", content_type = "application/json", body = ()),
        (status = 404, description = "not_configured or credential_not_found", content_type = "application/json", body = ()),
        (status = 500, description = "The stored secret is missing or unreadable", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Workflows", "operation": "get"})),
    )
)]
pub async fn reveal_http_credential_secret(
    Headers(user): Headers<UserEmail>,
    Path((org_id, id, cred_id)): Path<(String, String, String)>,
) -> Response {
    if let Err(denied) = require_credential_access(&org_id, &user.user_id, REVEAL_ACTION).await {
        return denied;
    }
    let (view, trigger_id) = match manage::reveal_secret(&org_id, &id, &cred_id).await {
        Ok(revealed) => revealed,
        Err(e) => return manage_error(e),
    };
    let path = format!("{org_id}/workflows/{id}/http_trigger/credentials/{cred_id}/secret");
    let body = enqueue::reveal_audit_body(
        &id,
        &trigger_id,
        &view.id,
        &view.display_prefix,
        view.kind.as_str(),
        view.state.as_str(),
    );
    enqueue::write_audit(|| enqueue::reveal_audit_message(&org_id, &user.user_id, &path, body))
        .await;
    no_store((StatusCode::OK, Json(view)).into_response())
}

/// TestWorkflowHttpTrigger
#[utoipa::path(
    post,
    path = "/{org_id}/workflows/{id}/http_trigger/test",
    context_path = "/api",
    tag = "Workflows",
    operation_id = "testWorkflowHttpTrigger",
    summary = "Run a workflow on a sample HTTP call",
    description = "Runs the saved version of the workflow, not unsaved editor changes. The steps get the input a real call gets; destinations are suppressed unless `run_destinations` is true",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
        ("id" = String, Path, description = "Workflow id (the draft is used when it is not published)"),
    ),
    request_body(content = HttpTriggerTestBody, description = "Sample data", content_type = "application/json"),
    responses(
        (status = 200, description = "Per-node inputs, outputs and errors", content_type = "application/json", body = Object),
        (status = 400, description = "The workflow could not run", content_type = "application/json", body = ()),
        (status = 404, description = "not_configured or workflow_not_found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Workflows", "operation": "create"})),
    )
)]
pub async fn test_http_trigger(
    Headers(user): Headers<UserEmail>,
    Path((org_id, id)): Path<(String, String)>,
    Json(body): Json<HttpTriggerTestBody>,
) -> Response {
    let trigger_id = match manage::trigger_id(&org_id, &id).await {
        Ok(trigger_id) => trigger_id,
        Err(e) => return manage_error(e),
    };
    let (mut workflow, is_draft) = match stored_workflow(&org_id, &id).await {
        Ok(found) => found,
        Err(e) => return manage_error(e),
    };
    workflow.id = format!("test-{}", config::ider::uuid());
    let input = manage::hook_test_input(&trigger_id, body.data);
    match workflows::test_workflow(
        &org_id,
        &id,
        workflow,
        vec![input],
        body.from_node,
        TestWorkflowOptions {
            is_draft,
            suppress_destinations: !body.run_destinations,
        },
        &user.user_id,
    )
    .await
    {
        Ok(v) => MetaHttpResponse::json(WorkflowTestResult {
            errors: v.errors,
            inputs: v.inputs,
            outputs: v.outputs,
        }),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// With OpenFGA off every member may edit and test, but only Admin/Root may see a credential.
async fn endpoint_permissions(
    org_id: &str,
    workflow_id: &str,
    user_id: &str,
) -> EndpointPermissions {
    let allowed = |method: &'static str| {
        check_permissions(
            workflow_id,
            org_id,
            user_id,
            "workflows",
            method,
            None,
            false,
            true,
            false,
        )
    };
    let edit = allowed("PUT").await;
    let test = allowed("POST").await;
    EndpointPermissions {
        edit,
        test,
        reveal: edit && credential_access(org_id, user_id).await,
    }
}

async fn credential_access(org_id: &str, user_id: &str) -> bool {
    require_credential_access(org_id, user_id, REVEAL_ACTION)
        .await
        .is_ok()
}

/// The published row, else the draft, as the editor shows it.
async fn stored_workflow(
    org_id: &str,
    workflow_id: &str,
) -> Result<(infra::table::workflows::Workflow, bool), ManageError> {
    let internal = |e: anyhow::Error| ManageError::Internal(e.to_string());
    if let Some(workflow) = workflows::get_workflow_by_id(org_id, workflow_id)
        .await
        .map_err(internal)?
    {
        return Ok((workflow, false));
    }
    workflows::get_draft_by_id(org_id, workflow_id)
        .await
        .map_err(internal)?
        .map(|draft| (draft, true))
        .ok_or(ManageError::WorkflowNotFound)
}

fn with_secret<T: serde::Serialize>(status: StatusCode, body: T, secret: String) -> Response {
    no_store(
        (
            status,
            Json(SecretResponse {
                body,
                secret: Some(secret),
            }),
        )
            .into_response(),
    )
}

fn no_store(mut resp: Response) -> Response {
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(NO_STORE));
    resp
}

fn coded(status: StatusCode, code: &str, message: &str) -> Response {
    let mut body = MetaHttpResponse::error(status, message);
    body.error_detail = Some(code.to_string());
    (status, Json(body)).into_response()
}

fn manage_error(e: ManageError) -> Response {
    let (status, code, message) = match &e {
        ManageError::WorkflowNotFound => (
            StatusCode::NOT_FOUND,
            "workflow_not_found",
            "No published or draft workflow has this id",
        ),
        ManageError::NotConfigured => (
            StatusCode::NOT_FOUND,
            "not_configured",
            "No HTTP endpoint is configured for this workflow",
        ),
        ManageError::InvalidLimit => (
            StatusCode::BAD_REQUEST,
            "invalid_limit",
            "max_body_bytes must be 1 KiB to 1 MiB and rate_limit_per_minute 1 to the org budget",
        ),
        ManageError::InvalidOverlap => (
            StatusCode::BAD_REQUEST,
            "invalid_overlap",
            "overlap_seconds must be 0, 3600, 86400 or 604800",
        ),
        ManageError::CredentialRetiring => (
            StatusCode::CONFLICT,
            "credential_retiring",
            "Revoke the retiring credential first",
        ),
        ManageError::CredentialNotFound => (
            StatusCode::NOT_FOUND,
            "credential_not_found",
            "No live credential with this id",
        ),
        ManageError::CredentialAccessRequired => (
            StatusCode::FORBIDDEN,
            "credential_access_required",
            "Admin or Root role required to mint a workflow endpoint credential",
        ),
        ManageError::Internal(detail) => {
            log::error!("[WORKFLOW_HOOK] management request failed: {detail}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "Internal error; nothing was changed",
            )
        }
    };
    coded(status, code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body_json(resp: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn every_manage_error_has_a_status_and_code() {
        let cases = [
            (ManageError::WorkflowNotFound, 404, "workflow_not_found"),
            (ManageError::NotConfigured, 404, "not_configured"),
            (ManageError::InvalidLimit, 400, "invalid_limit"),
            (ManageError::InvalidOverlap, 400, "invalid_overlap"),
            (ManageError::CredentialRetiring, 409, "credential_retiring"),
            (ManageError::CredentialNotFound, 404, "credential_not_found"),
            (
                ManageError::CredentialAccessRequired,
                403,
                "credential_access_required",
            ),
            (
                ManageError::Internal("db detail o2wh_x".to_string()),
                500,
                "internal_error",
            ),
        ];
        for (error, status, code) in cases {
            let resp = manage_error(error);
            assert_eq!(resp.status().as_u16(), status, "{code}");
            let json = body_json(resp).await;
            assert_eq!(json["error_detail"], code);
            assert_eq!(json["code"], status);
            assert!(!json.to_string().contains("o2wh_x"), "{json}");
        }
    }

    #[tokio::test]
    async fn secret_responses_are_no_store_and_flatten_the_secret() {
        let resp = with_secret(
            StatusCode::CREATED,
            serde_json::json!({"id": "c1", "display_prefix": "o2wh_abcd…wxyz"}),
            "o2wh_value".to_string(),
        );
        assert_eq!(resp.status(), StatusCode::CREATED);
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store, private"
        );
        let json = body_json(resp).await;
        assert_eq!(json["id"], "c1");
        assert_eq!(json["secret"], "o2wh_value");
    }

    #[test]
    fn the_test_body_defaults_to_suppressed_destinations() {
        let body: HttpTriggerTestBody = serde_json::from_str("{}").unwrap();
        assert!(body.data.is_empty());
        assert!(body.from_node.is_none());
        assert!(!body.run_destinations);
    }
}
