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

use axum::{
    extract::{Path, Query},
    response::Response,
};
use db::authz::{remove_ownership, set_ownership};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::{UserEmail, is_ofga_object_visible};
use openobserve_core::llm_evaluations::{
    remote_tasks::{
        PublishOutcome, RenderContext, VerificationOutcome, bench, verify::verify_candidate,
    },
    secrets::{self, SecretError, SecretMaterial, SecretOwnerKind},
};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::remote_tasks::{
        ActivateRemoteTaskSecretRequestBody, CreateRemoteTaskRequestBody,
        CreateRemoteTaskResponseBody, ListRemoteTasksResponseBody, PublishRemoteTaskResponseBody,
        RemoteTaskRequestBody, RemoteTaskResponseBody, RemoteTaskSecretMetadataBody,
        RemoteTaskSigningStatusResponseBody, RemoteTaskStatsQuery, RemoteTaskStatsResponseBody,
        ReplaceRemoteTaskSecretRequestBody, RotateRemoteTaskSecretRequestBody,
        TestConnectionRequestBody, TestRemoteTaskRequestBody, TestRemoteTaskResponseBody,
        TestRemoteTaskSecretCandidateResponseBody, TestRunRequestBody, TestRunResponseBody,
        VerificationReportBody, WrittenRemoteTaskSecretResponseBody,
    },
    service::llm_evaluations::remote_tasks::{self, RemoteTaskError, stats::RemoteTaskStatsError},
};

fn remote_task_error_response(value: RemoteTaskError) -> Response {
    match value {
        RemoteTaskError::Database(err) => {
            log::error!("[RemoteTask] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        RemoteTaskError::Malformed(err) => {
            log::error!("[RemoteTask] malformed stored row: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        RemoteTaskError::NotFound => MetaHttpResponse::not_found("Remote task not found"),
        RemoteTaskError::NoDraft => MetaHttpResponse::not_found(value),
        RemoteTaskError::DuplicateName => MetaHttpResponse::conflict(value),
        RemoteTaskError::NotReferenceable(_) => MetaHttpResponse::conflict(value),
        RemoteTaskError::MissingName
        | RemoteTaskError::UnpinnedReference(_)
        | RemoteTaskError::Invalid(_) => MetaHttpResponse::bad_request(value),
        RemoteTaskError::Secret(error) => secret_error_response(error),
    }
}

fn remote_task_stats_error_response(value: RemoteTaskStatsError) -> Response {
    match value {
        RemoteTaskStatsError::RemoteTask(error) => remote_task_error_response(error),
        error @ RemoteTaskStatsError::InvalidWindow => MetaHttpResponse::bad_request(error),
        error @ RemoteTaskStatsError::VersionNotFound(_) => MetaHttpResponse::not_found(error),
        RemoteTaskStatsError::Experiment(error) => {
            log::error!("[RemoteTaskStats] experiment lookup failed: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        RemoteTaskStatsError::Search(error) => {
            log::error!("[RemoteTaskStats] search failed: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        error @ (RemoteTaskStatsError::IncompleteSearch
        | RemoteTaskStatsError::MalformedResponse(_)) => {
            log::error!("[RemoteTaskStats] {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
    }
}

fn secret_error_response(value: SecretError) -> Response {
    match value {
        SecretError::NotFound | SecretError::OwnerMismatch => {
            MetaHttpResponse::not_found("Remote task secret not found")
        }
        SecretError::Conflict(_) | SecretError::CandidateNotVerified => {
            MetaHttpResponse::conflict(value)
        }
        SecretError::Invalid(_) => MetaHttpResponse::bad_request(value),
        SecretError::Database(error) => {
            log::error!("[RemoteTaskSecret] database error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        SecretError::Malformed(error) | SecretError::Encryption(error) => {
            log::error!("[RemoteTaskSecret] internal error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
    }
}

/// The sample a test connection sends when the operator entered none.
fn sample_context(body: TestConnectionRequestBody) -> RenderContext {
    RenderContext {
        input: body
            .input
            .unwrap_or_else(|| serde_json::json!("sample input")),
        metadata: body.metadata.unwrap_or_else(|| serde_json::json!({})),
        context: serde_json::json!({
            "experiment_id": "test-connection",
            "experiment_name": "Test connection",
            "dataset": serde_json::Value::Null,
            "snapshot_version": serde_json::Value::Null,
            "row_id": "test-connection",
            "trial_index": 0,
        }),
    }
}

async fn configured_auth_secret_ref(org_id: &str, entity_id: &str) -> Result<String, Response> {
    let task = remote_tasks::get(org_id, entity_id)
        .await
        .map_err(remote_task_error_response)?;
    task.spec
        .auth
        .secret_ref()
        .map(str::to_string)
        .ok_or_else(|| MetaHttpResponse::bad_request("Remote task has no configured auth secret"))
}

async fn configured_header_secret_ref(
    org_id: &str,
    entity_id: &str,
    header_name: &str,
) -> Result<String, Response> {
    let task = remote_tasks::get(org_id, entity_id)
        .await
        .map_err(remote_task_error_response)?;
    task.spec
        .custom_headers
        .iter()
        .find(|header| header.key.eq_ignore_ascii_case(header_name))
        .and_then(|header| header.secret_ref.clone())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            MetaHttpResponse::bad_request(format!(
                "Remote task header '{header_name}' has no configured secret"
            ))
        })
}

async fn configured_signing_task(
    org_id: &str,
    entity_id: &str,
) -> Result<
    (
        openobserve_core::llm_evaluations::remote_tasks::RemoteTask,
        String,
    ),
    Response,
> {
    let task = remote_tasks::get(org_id, entity_id)
        .await
        .map_err(remote_task_error_response)?;
    let secret_ref = task
        .spec
        .signing
        .secret_ref
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            MetaHttpResponse::bad_request("Remote task has no configured signing secret")
        })?;
    Ok((task, secret_ref))
}

/// ReplaceRemoteTaskAuthSecret
#[utoipa::path(
    put,
    path = "/{org_id}/tasks/{entity_id}/auth",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "ReplaceRemoteTaskAuthSecret",
    summary = "Replace the remote task auth secret",
    description = "Re-encrypts the replacement for the configured auth method. Remote task versions are unchanged.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(content = inline(ReplaceRemoteTaskSecretRequestBody)),
    responses(
        (status = 200, body = inline(RemoteTaskSecretMetadataBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn replace_remote_task_auth_secret(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<ReplaceRemoteTaskSecretRequestBody>,
) -> Response {
    let secret_ref = match configured_auth_secret_ref(&org_id, &entity_id).await {
        Ok(secret_ref) => secret_ref,
        Err(response) => return response,
    };
    match secrets::replace_auth(
        &org_id,
        SecretOwnerKind::Task,
        &entity_id,
        &secret_ref,
        body.material.into(),
    )
    .await
    {
        Ok(metadata) => MetaHttpResponse::json(RemoteTaskSecretMetadataBody::from(metadata)),
        Err(error) => secret_error_response(error),
    }
}

/// RevokeRemoteTaskAuthSecret
#[utoipa::path(
    delete,
    path = "/{org_id}/tasks/{entity_id}/auth",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "RevokeRemoteTaskAuthSecret",
    summary = "Revoke the remote task auth secret",
    description = "Revokes the value behind the configured auth reference without changing remote task versions.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn revoke_remote_task_auth_secret(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    let secret_ref = match configured_auth_secret_ref(&org_id, &entity_id).await {
        Ok(secret_ref) => secret_ref,
        Err(response) => return response,
    };
    match secrets::revoke(&org_id, SecretOwnerKind::Task, &entity_id, &secret_ref).await {
        Ok(()) => MetaHttpResponse::ok("Remote task auth secret revoked"),
        Err(error) => secret_error_response(error),
    }
}

/// ReplaceRemoteTaskHeaderSecret
#[utoipa::path(
    put,
    path = "/{org_id}/tasks/{entity_id}/headers/{header_name}/secret",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "ReplaceRemoteTaskHeaderSecret",
    summary = "Replace a secret-backed remote task header",
    description = "Re-encrypts the replacement behind the named header's configured reference. Remote task versions are unchanged.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
        ("header_name" = String, Path, description = "Configured custom header name"),
    ),
    request_body(content = inline(ReplaceRemoteTaskSecretRequestBody)),
    responses(
        (status = 200, body = inline(RemoteTaskSecretMetadataBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn replace_remote_task_header_secret(
    Path((org_id, entity_id, header_name)): Path<(String, String, String)>,
    axum::Json(body): axum::Json<ReplaceRemoteTaskSecretRequestBody>,
) -> Response {
    let secret_ref = match configured_header_secret_ref(&org_id, &entity_id, &header_name).await {
        Ok(secret_ref) => secret_ref,
        Err(response) => return response,
    };
    match secrets::replace_auth(
        &org_id,
        SecretOwnerKind::Task,
        &entity_id,
        &secret_ref,
        body.material.into(),
    )
    .await
    {
        Ok(metadata) => MetaHttpResponse::json(RemoteTaskSecretMetadataBody::from(metadata)),
        Err(error) => secret_error_response(error),
    }
}

/// RevokeRemoteTaskHeaderSecret
#[utoipa::path(
    delete,
    path = "/{org_id}/tasks/{entity_id}/headers/{header_name}/secret",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "RevokeRemoteTaskHeaderSecret",
    summary = "Revoke a secret-backed remote task header",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
        ("header_name" = String, Path, description = "Configured custom header name"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn revoke_remote_task_header_secret(
    Path((org_id, entity_id, header_name)): Path<(String, String, String)>,
) -> Response {
    let secret_ref = match configured_header_secret_ref(&org_id, &entity_id, &header_name).await {
        Ok(secret_ref) => secret_ref,
        Err(response) => return response,
    };
    match secrets::revoke(&org_id, SecretOwnerKind::Task, &entity_id, &secret_ref).await {
        Ok(()) => MetaHttpResponse::ok("Remote task header secret revoked"),
        Err(error) => secret_error_response(error),
    }
}

/// GetRemoteTaskSigningStatus
#[utoipa::path(
    get,
    path = "/{org_id}/tasks/{entity_id}/signing",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "GetRemoteTaskSigningStatus",
    summary = "Get the remote task signing lifecycle status",
    description = "Returns current, candidate, and grace metadata without secret values or storage references.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, body = inline(RemoteTaskSigningStatusResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn get_remote_task_signing_status(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    let (_, configured_ref) = match configured_signing_task(&org_id, &entity_id).await {
        Ok(configured) => configured,
        Err(response) => return response,
    };
    if let Err(error) = secrets::sweep_expired().await {
        return secret_error_response(error);
    }
    match secrets::list_for_owner(&org_id, SecretOwnerKind::Task, &entity_id).await {
        Ok(list) => MetaHttpResponse::json(RemoteTaskSigningStatusResponseBody {
            keys: list
                .into_iter()
                .filter(|metadata| metadata.secret_ref == configured_ref)
                .map(Into::into)
                .collect(),
        }),
        Err(error) => secret_error_response(error),
    }
}

/// RotateRemoteTaskSigningSecret
#[utoipa::path(
    post,
    path = "/{org_id}/tasks/{entity_id}/signing/rotate",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "RotateRemoteTaskSigningSecret",
    summary = "Create a signing-key candidate",
    description = "Returns candidate plaintext exactly once. The candidate must pass an explicit test before activation.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(content = inline(RotateRemoteTaskSecretRequestBody)),
    responses(
        (status = 200, body = inline(WrittenRemoteTaskSecretResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
)]
pub async fn rotate_remote_task_signing_secret(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<RotateRemoteTaskSecretRequestBody>,
) -> Response {
    let (_, secret_ref) = match configured_signing_task(&org_id, &entity_id).await {
        Ok(configured) => configured,
        Err(response) => return response,
    };
    let material = body
        .material
        .map(SecretMaterial::from)
        .unwrap_or_else(secrets::generate_signing_material);
    match secrets::rotate_signing(
        &org_id,
        SecretOwnerKind::Task,
        &entity_id,
        &secret_ref,
        body.key_id,
        material,
    )
    .await
    {
        Ok(secret) => MetaHttpResponse::json(WrittenRemoteTaskSecretResponseBody::from(secret)),
        Err(error) => secret_error_response(error),
    }
}

/// TestRemoteTaskSigningCandidate
#[utoipa::path(
    post,
    path = "/{org_id}/tasks/{entity_id}/signing/test",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "TestRemoteTaskSigningCandidate",
    summary = "Test a signing-key candidate",
    description = "Sends one explicit request signed with the candidate. Only a successful test permits activation.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(content = inline(TestConnectionRequestBody)),
    responses(
        (status = 200, body = inline(TestRemoteTaskSecretCandidateResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn test_remote_task_signing_candidate(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<TestConnectionRequestBody>,
) -> Response {
    // Rotation is independent of draft versioning, so test against the latest
    // published configuration. `get` falls back to the draft only for a head
    // that has never published.
    let (task, secret_ref) = match configured_signing_task(&org_id, &entity_id).await {
        Ok(configured) => configured,
        Err(response) => return response,
    };

    let outcome = verify_candidate(&task, &sample_context(body)).await;
    let (verified, error, report) = match outcome {
        VerificationOutcome::Passed(report) => (true, None, report),
        VerificationOutcome::Failed { error, report } => (false, Some(error), report),
    };
    let secret = if verified {
        match secrets::mark_candidate_verified(
            &org_id,
            SecretOwnerKind::Task,
            &entity_id,
            &secret_ref,
        )
        .await
        {
            Ok(metadata) => Some(RemoteTaskSecretMetadataBody::from(metadata)),
            Err(error) => return secret_error_response(error),
        }
    } else {
        None
    };
    MetaHttpResponse::json(TestRemoteTaskSecretCandidateResponseBody {
        verified,
        error,
        secret,
        report: VerificationReportBody::from(report),
    })
}

/// ActivateRemoteTaskSigningCandidate
#[utoipa::path(
    post,
    path = "/{org_id}/tasks/{entity_id}/signing/activate",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "ActivateRemoteTaskSigningCandidate",
    summary = "Activate a verified signing-key candidate",
    description = "Makes the candidate current and retains the old key for at most 24 hours.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(content = inline(ActivateRemoteTaskSecretRequestBody)),
    responses(
        (status = 200, body = inline(RemoteTaskSecretMetadataBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
)]
pub async fn activate_remote_task_signing_candidate(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<ActivateRemoteTaskSecretRequestBody>,
) -> Response {
    let (_, secret_ref) = match configured_signing_task(&org_id, &entity_id).await {
        Ok(configured) => configured,
        Err(response) => return response,
    };
    match secrets::activate_signing(
        &org_id,
        SecretOwnerKind::Task,
        &entity_id,
        &secret_ref,
        body.grace_period_ms,
    )
    .await
    {
        Ok(metadata) => MetaHttpResponse::json(RemoteTaskSecretMetadataBody::from(metadata)),
        Err(error) => secret_error_response(error),
    }
}

/// EndRemoteTaskSigningGrace
#[utoipa::path(
    post,
    path = "/{org_id}/tasks/{entity_id}/signing/end_grace",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "EndRemoteTaskSigningGrace",
    summary = "End the previous signing key grace period early",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn end_remote_task_signing_grace(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    let (_, secret_ref) = match configured_signing_task(&org_id, &entity_id).await {
        Ok(configured) => configured,
        Err(response) => return response,
    };
    match secrets::end_grace_early(&org_id, SecretOwnerKind::Task, &entity_id, &secret_ref).await {
        Ok(()) => MetaHttpResponse::ok("Signing-key grace period ended"),
        Err(error) => secret_error_response(error),
    }
}

/// RevokeRemoteTaskSigningSecret
#[utoipa::path(
    delete,
    path = "/{org_id}/tasks/{entity_id}/signing",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "RevokeRemoteTaskSigningSecret",
    summary = "Revoke the remote task signing secret",
    description = "Revokes all values behind the configured signing reference without changing remote task versions.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
)]
pub async fn revoke_remote_task_signing_secret(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    let (_, secret_ref) = match configured_signing_task(&org_id, &entity_id).await {
        Ok(configured) => configured,
        Err(response) => return response,
    };
    match secrets::revoke(&org_id, SecretOwnerKind::Task, &entity_id, &secret_ref).await {
        Ok(()) => MetaHttpResponse::ok("Remote task signing secret revoked"),
        Err(error) => secret_error_response(error),
    }
}

/// ListRemoteTasks
#[utoipa::path(
    get,
    path = "/{org_id}/tasks",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "ListRemoteTasks",
    summary = "List remote tasks",
    description = "Lists each remote task head at its newest row.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, body = inline(ListRemoteTasksResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "list"})),
    ),
)]
pub async fn list_remote_tasks(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let permitted_objects = {
        match openobserve_api_common::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "remote_task",
        )
        .await
        {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        }
    };
    match remote_tasks::list(&org_id).await {
        Ok(list) => {
            let referenced_by = match remote_tasks::stats::referenced_by_counts(&org_id).await {
                Ok(counts) => counts,
                Err(error) => return remote_task_stats_error_response(error),
            };
            #[cfg(feature = "enterprise")]
            let list = list
                .into_iter()
                .filter(|task| {
                    is_ofga_object_visible(
                        &org_id,
                        "remote_task",
                        &task.entity_id,
                        permitted_objects.as_deref(),
                    )
                })
                .collect::<Vec<_>>();
            let body = ListRemoteTasksResponseBody {
                list: list
                    .into_iter()
                    .map(|task| {
                        let count = referenced_by.get(&task.entity_id).copied().unwrap_or(0);
                        RemoteTaskResponseBody::from(task).with_referenced_by(count)
                    })
                    .collect(),
            };
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// CreateRemoteTask
#[utoipa::path(
    post,
    path = "/{org_id}/tasks",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "CreateRemoteTask",
    summary = "Register a remote task",
    description = "Registers a remote task as an unverified draft. No Experiment can \
                   reference it until a test connection publishes a version.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(CreateRemoteTaskRequestBody), description = "Remote task payload with inline write-only Secret material"),
    responses(
        (status = 200, body = inline(CreateRemoteTaskResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "create"})),
    ),
)]
pub async fn create_remote_task(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<CreateRemoteTaskRequestBody>,
) -> Response {
    let registration = match body.into_registration() {
        Ok(registration) => registration,
        Err(error) => return MetaHttpResponse::bad_request(error),
    };
    match remote_tasks::register(&org_id, registration).await {
        Ok(outcome) => {
            set_ownership(&org_id, "remote_tasks", Authz::new(&outcome.task.entity_id)).await;
            let body: CreateRemoteTaskResponseBody = outcome.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// TestRemoteTask
#[utoipa::path(
    post,
    path = "/{org_id}/tasks/test",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "TestRemoteTask",
    summary = "Test an inline remote task",
    description = "Calls an inline Remote Task candidate once using the submitted contract and write-only Secret material. No Task, version, execution record, or Secret row is written.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(TestRemoteTaskRequestBody), description = "Complete registration candidate plus sample input and metadata"),
    responses(
        (status = 200, body = inline(TestRemoteTaskResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "test"})),
    ),
)]
pub async fn test_remote_task(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<TestRemoteTaskRequestBody>,
) -> Response {
    let TestRemoteTaskRequestBody {
        candidate,
        input,
        metadata,
    } = body;
    let registration = match candidate.into_registration() {
        Ok(registration) => registration,
        Err(error) => return MetaHttpResponse::bad_request(error),
    };
    let sample = sample_context(TestConnectionRequestBody { input, metadata });
    match remote_tasks::test_registration(&org_id, registration, &sample).await {
        Ok(VerificationOutcome::Passed(report)) => {
            MetaHttpResponse::json(TestRemoteTaskResponseBody {
                verified: true,
                error: None,
                report: report.into(),
            })
        }
        Ok(VerificationOutcome::Failed { error, report }) => {
            MetaHttpResponse::json(TestRemoteTaskResponseBody {
                verified: false,
                error: Some(error),
                report: report.into(),
            })
        }
        Err(error) => remote_task_error_response(error),
    }
}

/// GetRemoteTask
#[utoipa::path(
    get,
    path = "/{org_id}/tasks/{entity_id}",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "GetRemoteTask",
    summary = "Get a remote task",
    description = "Returns the head's newest published version, or its draft when it \
                   has never published one.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, body = inline(RemoteTaskResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "get"})),
    ),
)]
pub async fn get_remote_task(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match remote_tasks::get(&org_id, &entity_id).await {
        Ok(task) => {
            let body: RemoteTaskResponseBody = task.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// ListRemoteTaskVersions
#[utoipa::path(
    get,
    path = "/{org_id}/tasks/{entity_id}/versions",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "ListRemoteTaskVersions",
    summary = "List remote task versions",
    description = "Returns every version of the head, newest first, including its draft.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, body = inline(ListRemoteTasksResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "list"})),
    ),
)]
pub async fn list_remote_task_versions(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    match remote_tasks::get_versions(&org_id, &entity_id).await {
        Ok(versions) => {
            let body: ListRemoteTasksResponseBody = versions.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// GetRemoteTaskStats
#[utoipa::path(
    get,
    path = "/{org_id}/tasks/{entity_id}/stats",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "GetRemoteTaskStats",
    summary = "Get remote task execution statistics",
    description = "Aggregates latest-wins terminal execution records whose own server timestamp falls inside the requested window. The head includes every published version unless version narrows it.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
        ("windowMs" = u64, Query, description = "Window ending now, measured against execution-record _timestamp"),
        ("version" = Option<i32>, Query, description = "Optional published version"),
    ),
    responses(
        (status = 200, body = inline(RemoteTaskStatsResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "stats"})),
    ),
)]
pub async fn get_remote_task_stats(
    Path((org_id, entity_id)): Path<(String, String)>,
    Query(query): Query<RemoteTaskStatsQuery>,
) -> Response {
    match remote_tasks::stats::get(&org_id, &entity_id, query.version, query.window_ms).await {
        Ok(stats) => MetaHttpResponse::json(RemoteTaskStatsResponseBody::from(stats)),
        Err(error) => remote_task_stats_error_response(error),
    }
}

/// SaveRemoteTaskDraft
#[utoipa::path(
    put,
    path = "/{org_id}/tasks/{entity_id}",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "SaveRemoteTaskDraft",
    summary = "Save the remote task draft",
    description = "Writes the head's single draft, copying the selected published version \
                   first when no draft exists. Published versions are untouched.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(content = inline(RemoteTaskRequestBody), description = "Remote task payload"),
    responses(
        (status = 200, body = inline(RemoteTaskResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "update"})),
    ),
)]
pub async fn save_remote_task_draft(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<RemoteTaskRequestBody>,
) -> Response {
    let description = body.description.clone();
    let from_version = body.from_version;
    match remote_tasks::save_draft(
        &org_id,
        &entity_id,
        from_version,
        body.into_spec(),
        description,
    )
    .await
    {
        Ok(task) => {
            let body: RemoteTaskResponseBody = task.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// GetRemoteTaskDraft
#[utoipa::path(
    get,
    path = "/{org_id}/tasks/{entity_id}/draft",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "GetRemoteTaskDraft",
    summary = "Get the remote task draft",
    description = "Returns the head's unpublished draft, if it has one.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, body = inline(RemoteTaskResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "get"})),
    ),
)]
pub async fn get_remote_task_draft(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match remote_tasks::get_draft(&org_id, &entity_id).await {
        Ok(Some(task)) => {
            let body: RemoteTaskResponseBody = task.into();
            MetaHttpResponse::json(body)
        }
        Ok(None) => MetaHttpResponse::not_found("Remote task has no draft"),
        Err(err) => remote_task_error_response(err),
    }
}

/// DiscardRemoteTaskDraft
#[utoipa::path(
    delete,
    path = "/{org_id}/tasks/{entity_id}/draft",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "DiscardRemoteTaskDraft",
    summary = "Discard the remote task draft",
    description = "Drops the head's unpublished draft. Published versions are untouched.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "delete"})),
    ),
)]
pub async fn discard_remote_task_draft(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    match remote_tasks::discard_draft(&org_id, &entity_id).await {
        Ok(()) => MetaHttpResponse::ok("Draft discarded"),
        Err(err) => remote_task_error_response(err),
    }
}

/// PublishRemoteTask
#[utoipa::path(
    post,
    path = "/{org_id}/tasks/{entity_id}/test_connection",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "PublishRemoteTask",
    summary = "Test connection and publish",
    description = "Calls the endpoint using the draft's own contract. A failure records \
                   why and publishes nothing; a success publishes the next immutable \
                   version, which becomes referenceable. This is the only way a version \
                   is published.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(
        content = inline(TestConnectionRequestBody),
        description = "Sample sent to the configured endpoint",
    ),
    responses(
        (status = 200, body = inline(PublishRemoteTaskResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "update"})),
    ),
)]
pub async fn publish_remote_task(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<TestConnectionRequestBody>,
) -> Response {
    let sample = sample_context(body);
    match remote_tasks::publish(&org_id, &entity_id, &sample).await {
        Ok(PublishOutcome::Published { task, plan, report }) => {
            MetaHttpResponse::json(PublishRemoteTaskResponseBody {
                published: true,
                version_bumped: plan.bumps_version(),
                error: None,
                task: task.into(),
                report: report.into(),
            })
        }
        Ok(PublishOutcome::TestFailed {
            draft,
            error,
            report,
        }) => MetaHttpResponse::json(PublishRemoteTaskResponseBody {
            published: false,
            version_bumped: false,
            error: Some(error),
            task: draft.into(),
            report: report.into(),
        }),
        Err(err) => remote_task_error_response(err),
    }
}

/// DeleteRemoteTask
#[utoipa::path(
    delete,
    path = "/{org_id}/tasks/{entity_id}",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "DeleteRemoteTask",
    summary = "Delete a remote task",
    description = "Retires the head. Its published versions stay for history but stop \
                   being referenceable.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "delete"})),
    ),
)]
pub async fn delete_remote_task(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match remote_tasks::delete(&org_id, &entity_id).await {
        Ok(()) => {
            remove_ownership(&org_id, "remote_tasks", Authz::new(&entity_id)).await;
            MetaHttpResponse::ok("Remote task deleted")
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// TestRunRemoteTask
#[utoipa::path(
    post,
    path = "/{org_id}/tasks/{entity_id}/test_run",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "TestRunRemoteTask",
    summary = "Try a remote task against a sample",
    description = "Runs the task's latest published version against at most ten samples using \
                   the registered contract, at concurrency min(4, max_concurrency). Volatile: \
                   no Experiment, no execution records, no history. Idempotency keys are \
                   `testrun-` prefixed.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(content = inline(TestRunRequestBody), description = "Samples to try"),
    responses(
        (status = 200, body = inline(TestRunResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "test_run"})),
    ),
)]
pub async fn test_run_remote_task(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<TestRunRequestBody>,
) -> Response {
    let samples = body
        .samples
        .into_iter()
        .enumerate()
        .map(|(index, sample)| bench::BenchSample {
            row_id: sample.row_id.unwrap_or_else(|| format!("sample-{index}")),
            input: sample.input,
            metadata: sample.metadata,
        })
        .collect::<Vec<_>>();

    match remote_tasks::bench::run(&org_id, &entity_id, samples).await {
        Ok(results) => {
            let body = TestRunResponseBody {
                results: results.into_iter().map(Into::into).collect(),
            };
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_test_connection_without_a_sample_still_sends_a_usable_one() {
        let ctx = sample_context(TestConnectionRequestBody::default());
        assert_eq!(ctx.input, serde_json::json!("sample input"));
        assert_eq!(ctx.metadata, serde_json::json!({}));
    }

    #[test]
    fn a_hand_entered_sample_is_what_gets_sent() {
        let ctx = sample_context(TestConnectionRequestBody {
            input: Some(serde_json::json!({"q": "2 + 2"})),
            metadata: Some(serde_json::json!({"lang": "en"})),
        });
        assert_eq!(ctx.input, serde_json::json!({"q": "2 + 2"}));
        assert_eq!(ctx.metadata["lang"], serde_json::json!("en"));
    }

    #[test]
    fn the_test_connection_context_carries_no_reference_answer() {
        let ctx = sample_context(TestConnectionRequestBody::default());
        let rendered = serde_json::to_string(&ctx.context).unwrap();
        assert!(!rendered.contains("expected"));
    }
}
