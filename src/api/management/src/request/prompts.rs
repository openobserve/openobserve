// Copyright 2026 OpenObserve Inc.

use std::collections::BTreeSet;

use axum::{
    Json,
    extract::{Path, Query},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    prompts::{self, MutationContext, PromptError, PromptSelector, PromptSource, ResolvePurpose},
};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::models::prompts::{
    CreatePromptRequestBody, CreatePromptVersionRequestBody, ListPromptActivityResponseBody,
    ListPromptVersionsResponseBody, ListPromptsResponseBody, MatchPromptsRequestBody,
    MatchPromptsResponseBody, MovePromptLabelRequestBody, PromptActivityResponseBody,
    PromptErrorResponseBody, PromptLabelResponseBody, PromptMatchResponseBody,
    PromptMutationResponseBody, PromptResponseBody, PromptSecretRequestBody,
    PromptSecretResponseBody, PromptSettingsRequestBody, PromptSettingsResponseBody,
    PromptVersionResponseBody, ResolvedPromptResponseBody, UpdatePromptRequestBody,
};
#[cfg(feature = "enterprise")]
use crate::service::auth::check_permissions;

const FOLDER_WARNING: &str = "299 OpenObserve \"prompt folder assertion mismatch\"";

#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ListPromptsQuery {
    #[serde(default)]
    pub include_archived: bool,
    pub folder_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, IntoParams)]
pub struct AppendPromptVersionQuery {
    pub if_head: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ResolvePromptQuery {
    /// Prompt name.
    pub name: String,
    /// Movable label to resolve. Defaults to `production` when both `label`
    /// and `version` are omitted.
    pub label: Option<String>,
    /// Immutable prompt version to resolve.
    pub version: Option<i32>,
    #[serde(alias = "folderId", alias = "folder_id")]
    /// Optional folder assertion. A mismatch returns the prompt with an HTTP
    /// `Warning` header.
    pub folder: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct DeletePromptLabelQuery {
    pub if_version: Option<i32>,
}

fn context(user: &UserEmail, via: PromptSource) -> MutationContext {
    MutationContext {
        actor: user.user_id.clone(),
        via,
    }
}

async fn can_move_protected_label(
    org_id: &str,
    _user_id: &str,
    label: &str,
) -> Result<bool, Response> {
    let settings = db::prompt_settings::get(org_id).await.map_err(|error| {
        log::error!("[Prompts] settings read failed before label authorization: {error}");
        internal_error()
    })?;
    if !settings.protected_labels.contains(label) {
        return Ok(false);
    }
    #[cfg(feature = "enterprise")]
    {
        Ok(check_permissions(
            label, org_id, _user_id, "prompts", "PUT", None, false, false, false,
        )
        .await)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        Ok(true)
    }
}

async fn can_manage_prompt_settings(org_id: &str, _user_id: &str) -> bool {
    #[cfg(feature = "enterprise")]
    {
        check_permissions(
            org_id, org_id, _user_id, "prompts", "PUT", None, false, false, false,
        )
        .await
    }
    #[cfg(not(feature = "enterprise"))]
    {
        true
    }
}

async fn require_prompt_write(org_id: &str, user_id: &str) -> Result<(), Response> {
    if can_manage_prompt_settings(org_id, user_id).await {
        Ok(())
    } else {
        Err(machine_error(
            StatusCode::FORBIDDEN,
            "unauthorized_access",
            "Unauthorized Access",
        ))
    }
}

fn validate_protected_labels(labels: BTreeSet<String>) -> Result<BTreeSet<String>, PromptError> {
    labels
        .into_iter()
        .map(|label| {
            let label = prompts::validate_label(&label)?;
            if label == prompts::LATEST_LABEL {
                return Err(PromptError::InvalidLabel);
            }
            Ok(label)
        })
        .collect()
}

fn idempotency_key(headers: &HeaderMap) -> Result<Option<String>, Response> {
    headers
        .get("Idempotency-Key")
        .map(|value| {
            value.to_str().map(str::to_string).map_err(|_| {
                machine_error(
                    StatusCode::BAD_REQUEST,
                    "invalid_idempotency_key",
                    "Idempotency-Key must be valid ASCII",
                )
            })
        })
        .transpose()
}

fn internal_error() -> Response {
    machine_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_error",
        "Internal server error",
    )
}

fn machine_error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(PromptErrorResponseBody {
            code: code.to_string(),
            message: message.into(),
        }),
    )
        .into_response()
}

pub(crate) fn prompt_error_response(error: PromptError) -> Response {
    let (status, code) = match &error {
        PromptError::InvalidPromptName => (StatusCode::BAD_REQUEST, "invalid_prompt_name"),
        PromptError::InvalidSelector | PromptError::InvalidBase => {
            (StatusCode::BAD_REQUEST, "invalid_selector")
        }
        PromptError::PromptNotFound => (StatusCode::NOT_FOUND, "prompt_not_found"),
        PromptError::VersionNotFound => (StatusCode::NOT_FOUND, "version_not_found"),
        PromptError::LabelNotFound => (StatusCode::NOT_FOUND, "label_not_found"),
        PromptError::LabelGone => (StatusCode::NOT_FOUND, "label_gone"),
        PromptError::HeadAdvanced => (StatusCode::CONFLICT, "head_advanced"),
        PromptError::IdempotencyConflict => (StatusCode::CONFLICT, "idempotency_conflict"),
        PromptError::ProtectedLabelForbidden => {
            (StatusCode::FORBIDDEN, "protected_label_forbidden")
        }
        PromptError::LatestLabelImmutable => (StatusCode::CONFLICT, "latest_label_immutable"),
        PromptError::ArchivedPrompt => (StatusCode::CONFLICT, "archived_prompt"),
        PromptError::FolderNotFound => (StatusCode::NOT_FOUND, "folder_not_found"),
        PromptError::DuplicateName => (StatusCode::CONFLICT, "duplicate_name"),
        PromptError::InvalidPayload(_) => (StatusCode::BAD_REQUEST, "invalid_payload"),
        PromptError::InvalidPromptType => (StatusCode::BAD_REQUEST, "invalid_prompt_type"),
        PromptError::InvalidPromptSource => (StatusCode::BAD_REQUEST, "invalid_prompt_source"),
        PromptError::InvalidConfig(_) => (StatusCode::BAD_REQUEST, "invalid_config"),
        PromptError::ProviderNotAllowed => (StatusCode::BAD_REQUEST, "provider_not_allowed"),
        PromptError::MissingCommitMessage => (StatusCode::BAD_REQUEST, "missing_commit_message"),
        PromptError::InvalidLabel => (StatusCode::BAD_REQUEST, "invalid_label"),
        PromptError::Settings(db::prompt_settings::PromptSettingsError::SecretNotConfigured) => {
            (StatusCode::BAD_REQUEST, "webhook_not_configured")
        }
        PromptError::InvalidStoredData(_)
        | PromptError::MalformedReplay(_)
        | PromptError::Storage(_)
        | PromptError::Infrastructure(_)
        | PromptError::Folder(_)
        | PromptError::Settings(_)
        | PromptError::Idempotency(_) => {
            log::error!("[Prompts] internal error: {error}");
            (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
        }
    };
    let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
        "Internal server error".to_string()
    } else {
        error.to_string()
    };
    machine_error(status, code, message)
}

#[utoipa::path(
    get, path = "/{org_id}/prompts", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ListPromptsQuery),
    responses((status = 200, body = inline(ListPromptsResponseBody)))
)]
pub async fn list_prompts(
    Path(org_id): Path<String>,
    Query(query): Query<ListPromptsQuery>,
) -> Response {
    match prompts::list_prompts(&org_id, query.include_archived, query.folder_id.as_deref()).await {
        Ok(list) => Json(ListPromptsResponseBody {
            list: list.into_iter().map(Into::into).collect(),
        })
        .into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    post, path = "/{org_id}/prompts", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path)), request_body = inline(CreatePromptRequestBody),
    responses((status = 200, body = inline(PromptMutationResponseBody)))
)]
pub async fn create_prompt(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    headers: HeaderMap,
    Json(body): Json<CreatePromptRequestBody>,
) -> Response {
    if let Err(response) = require_prompt_write(&org_id, &user.user_id).await {
        return response;
    }
    let idempotency_key = match idempotency_key(&headers) {
        Ok(key) => key,
        Err(response) => return response,
    };
    let request = match prompts::CreatePrompt::try_from(body) {
        Ok(request) => request,
        Err(error) => return prompt_error_response(error),
    };
    let via = request.source;
    match prompts::create_prompt(
        &org_id,
        &context(&user, via),
        request,
        idempotency_key.as_deref(),
    )
    .await
    {
        Ok(result) => Json(PromptMutationResponseBody::from(result)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    post, path = "/{org_id}/prompts/match", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path)), request_body = inline(MatchPromptsRequestBody),
    responses((status = 200, body = inline(MatchPromptsResponseBody)))
)]
pub async fn match_prompts(
    Path(org_id): Path<String>,
    Json(body): Json<MatchPromptsRequestBody>,
) -> Response {
    let (prompt_type, payload, config) = match body.into_core() {
        Ok(request) => request,
        Err(error) => return prompt_error_response(error),
    };
    if let Err(error) = prompts::validate_payload(prompt_type, &payload) {
        return prompt_error_response(error);
    }
    let hash = prompts::content_hash(&payload, &config);
    let versions = match prompts::find_content_matches(&org_id, &hash).await {
        Ok(versions) => versions,
        Err(error) => return prompt_error_response(error),
    };
    let mut matches = Vec::with_capacity(versions.len());
    for version in versions {
        let prompt = match prompts::get_prompt(&org_id, &version.entity_id).await {
            Ok(prompt) => prompt,
            Err(PromptError::PromptNotFound) => continue,
            Err(error) => return prompt_error_response(error),
        };
        if prompt.status != prompts::PromptStatus::Active || prompt.prompt_type != prompt_type {
            continue;
        }
        matches.push(PromptMatchResponseBody {
            id: version.id,
            entity_id: prompt.entity_id,
            name: prompt.name,
            version: version.version,
            content_hash: version.content_hash,
        });
    }
    Json(MatchPromptsResponseBody { matches }).into_response()
}

#[utoipa::path(
    get, path = "/{org_id}/prompts/resolve", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ResolvePromptQuery),
    responses(
        (
            status = 200,
            body = inline(ResolvedPromptResponseBody),
            headers(("Warning" = String, description = "Folder assertion mismatch"))
        ),
        (status = 304)
    )
)]
pub async fn resolve_prompt(
    Path(org_id): Path<String>,
    Query(query): Query<ResolvePromptQuery>,
    headers: HeaderMap,
) -> Response {
    let selector = match (query.label, query.version) {
        (Some(_), Some(_)) => {
            return machine_error(
                StatusCode::BAD_REQUEST,
                "invalid_selector",
                "label and version are mutually exclusive",
            );
        }
        (Some(label), None) => PromptSelector::Label(label),
        (None, Some(version)) => PromptSelector::Version(version),
        (None, None) => PromptSelector::Label("production".to_string()),
    };
    let resolved = match prompts::resolve_by_name(
        &org_id,
        &query.name,
        selector,
        ResolvePurpose::Runtime,
        query.folder.as_deref(),
    )
    .await
    {
        Ok(resolved) => resolved,
        Err(error) => return prompt_error_response(error),
    };
    let etag = format!(
        "\"{}\"",
        infra::idempotency::canonical_sha256(&serde_json::json!({
            "entity_id": resolved.prompt.entity_id,
            "version": resolved.version.version,
            "label": resolved.label,
            "content_hash": resolved.version.content_hash,
        }))
    );
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == etag)
    {
        return StatusCode::NOT_MODIFIED.into_response();
    }
    let folder_mismatch = resolved.folder_assertion_mismatch;
    let mut response = Json(ResolvedPromptResponseBody::from(resolved)).into_response();
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&etag).expect("canonical hash makes a valid ETag"),
    );
    if folder_mismatch {
        response
            .headers_mut()
            .insert(header::WARNING, HeaderValue::from_static(FOLDER_WARNING));
    }
    response
}

#[utoipa::path(
    get, path = "/{org_id}/prompts/settings", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path)),
    responses((status = 200, body = inline(PromptSettingsResponseBody)))
)]
pub async fn get_prompt_settings(Path(org_id): Path<String>) -> Response {
    match db::prompt_settings::get(&org_id).await {
        Ok(settings) => Json(PromptSettingsResponseBody::from(settings)).into_response(),
        Err(error) => {
            log::error!("[Prompts] settings read failed: {error}");
            internal_error()
        }
    }
}

#[utoipa::path(
    put, path = "/{org_id}/prompts/settings", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path)), request_body = inline(PromptSettingsRequestBody),
    responses((status = 200, body = inline(PromptSettingsResponseBody)))
)]
pub async fn update_prompt_settings(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Json(mut body): Json<PromptSettingsRequestBody>,
) -> Response {
    if !can_manage_prompt_settings(&org_id, &user.user_id).await {
        return machine_error(
            StatusCode::FORBIDDEN,
            "unauthorized_access",
            "Unauthorized Access",
        );
    }
    body.protected_labels = match validate_protected_labels(body.protected_labels) {
        Ok(labels) => labels,
        Err(error) => return prompt_error_response(error),
    };
    if let Some(webhook) = &mut body.webhook {
        webhook.endpoint = match infra::outbound_http::validate_endpoint(&webhook.endpoint) {
            Ok(endpoint) => endpoint.to_string(),
            Err(error) => {
                return machine_error(StatusCode::BAD_REQUEST, "invalid_webhook_endpoint", error);
            }
        };
    }
    let current = match db::prompt_settings::get(&org_id).await {
        Ok(settings) => settings,
        Err(error) => {
            log::error!("[Prompts] settings read failed: {error}");
            return internal_error();
        }
    };
    let secret_ref = current.webhook.and_then(|webhook| webhook.secret_ref);
    match db::prompt_settings::set(&org_id, &user.user_id, body.into_settings(secret_ref)).await {
        Ok(settings) => Json(PromptSettingsResponseBody::from(settings)).into_response(),
        Err(error) => {
            log::error!("[Prompts] settings update failed: {error}");
            internal_error()
        }
    }
}

#[utoipa::path(
    put, path = "/{org_id}/prompts/settings/secret", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path)), request_body = inline(PromptSecretRequestBody),
    responses((status = 200, body = inline(PromptSecretResponseBody)))
)]
pub async fn update_prompt_secret(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<PromptSecretRequestBody>,
) -> Response {
    if !can_manage_prompt_settings(&org_id, &user.user_id).await {
        return machine_error(
            StatusCode::FORBIDDEN,
            "unauthorized_access",
            "Unauthorized Access",
        );
    }
    if body.secret.is_empty() {
        return machine_error(
            StatusCode::BAD_REQUEST,
            "invalid_secret",
            "secret cannot be empty",
        );
    }
    match db::prompt_settings::set_webhook_secret(&org_id, &user.user_id, body.secret).await {
        Ok(_) => Json(PromptSecretResponseBody {
            secret_configured: true,
        })
        .into_response(),
        Err(error) => prompt_error_response(PromptError::Settings(error)),
    }
}

#[utoipa::path(
    get, path = "/{org_id}/prompts/{entity_id}", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path)),
    responses((status = 200, body = inline(PromptResponseBody)))
)]
pub async fn get_prompt(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match prompts::get_prompt(&org_id, &entity_id).await {
        Ok(prompt) => Json(PromptResponseBody::from(prompt)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    patch, path = "/{org_id}/prompts/{entity_id}", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path)),
    request_body = inline(UpdatePromptRequestBody),
    responses((status = 200, body = inline(PromptResponseBody)))
)]
pub async fn update_prompt(
    Path((org_id, entity_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<UpdatePromptRequestBody>,
) -> Response {
    if let Err(response) = require_prompt_write(&org_id, &user.user_id).await {
        return response;
    }
    match prompts::update_head(
        &org_id,
        &entity_id,
        &context(&user, PromptSource::Ui),
        body.into(),
    )
    .await
    {
        Ok(prompt) => Json(PromptResponseBody::from(prompt)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    post, path = "/{org_id}/prompts/{entity_id}/archive", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path)),
    responses((status = 200, body = inline(PromptResponseBody)))
)]
pub async fn archive_prompt(
    Path((org_id, entity_id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Err(response) = require_prompt_write(&org_id, &user.user_id).await {
        return response;
    }
    match prompts::archive(&org_id, &entity_id, &context(&user, PromptSource::Ui)).await {
        Ok(prompt) => Json(PromptResponseBody::from(prompt)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    get, path = "/{org_id}/prompts/{entity_id}/versions", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path)),
    responses((status = 200, body = inline(ListPromptVersionsResponseBody)))
)]
pub async fn list_prompt_versions(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match prompts::list_versions(&org_id, &entity_id).await {
        Ok(versions) => Json(ListPromptVersionsResponseBody {
            versions: versions.into_iter().map(Into::into).collect(),
        })
        .into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    post, path = "/{org_id}/prompts/{entity_id}/versions", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path), AppendPromptVersionQuery),
    request_body = inline(CreatePromptVersionRequestBody),
    responses((status = 200, body = inline(PromptMutationResponseBody)))
)]
pub async fn create_prompt_version(
    Path((org_id, entity_id)): Path<(String, String)>,
    Query(query): Query<AppendPromptVersionQuery>,
    Headers(user): Headers<UserEmail>,
    headers: HeaderMap,
    Json(body): Json<CreatePromptVersionRequestBody>,
) -> Response {
    if let Err(response) = require_prompt_write(&org_id, &user.user_id).await {
        return response;
    }
    let idempotency_key = match idempotency_key(&headers) {
        Ok(key) => key,
        Err(response) => return response,
    };
    let request = match body.into_core(query.if_head) {
        Ok(request) => request,
        Err(error) => return prompt_error_response(error),
    };
    let via = request.source;
    match prompts::append_version(
        &org_id,
        &entity_id,
        &context(&user, via),
        request,
        idempotency_key.as_deref(),
    )
    .await
    {
        Ok(result) => Json(PromptMutationResponseBody::from(result)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    get, path = "/{org_id}/prompts/{entity_id}/versions/{version}", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path), ("version" = i32, Path)),
    responses((status = 200, body = inline(PromptVersionResponseBody)))
)]
pub async fn get_prompt_version(
    Path((org_id, entity_id, version)): Path<(String, String, i32)>,
) -> Response {
    match prompts::get_version(&org_id, &entity_id, version).await {
        Ok(version) => Json(PromptVersionResponseBody::from(version)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    get, path = "/{org_id}/prompts/{entity_id}/activity", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path)),
    responses((status = 200, body = inline(ListPromptActivityResponseBody)))
)]
pub async fn list_prompt_activity(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match prompts::list_label_activity(&org_id, &entity_id).await {
        Ok(activity) => Json(ListPromptActivityResponseBody {
            activity: activity
                .into_iter()
                .map(PromptActivityResponseBody::from)
                .collect(),
        })
        .into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    put, path = "/{org_id}/prompts/{entity_id}/labels/{label}", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path), ("label" = String, Path)),
    request_body = inline(MovePromptLabelRequestBody),
    responses((status = 200, body = inline(PromptLabelResponseBody)))
)]
pub async fn move_prompt_label(
    Path((org_id, entity_id, label)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<MovePromptLabelRequestBody>,
) -> Response {
    if let Err(response) = require_prompt_write(&org_id, &user.user_id).await {
        return response;
    }
    let can_move_protected = match can_move_protected_label(&org_id, &user.user_id, &label).await {
        Ok(allowed) => allowed,
        Err(response) => return response,
    };
    match prompts::move_label(
        &org_id,
        &entity_id,
        &label,
        &context(&user, PromptSource::Ui),
        body.into(),
        can_move_protected,
    )
    .await
    {
        Ok(label) => Json(PromptLabelResponseBody::from(label)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[utoipa::path(
    delete, path = "/{org_id}/prompts/{entity_id}/labels/{label}", context_path = "/api", tag = "Prompts",
    params(("org_id" = String, Path), ("entity_id" = String, Path), ("label" = String, Path), DeletePromptLabelQuery),
    responses((status = 200, body = inline(PromptLabelResponseBody)))
)]
pub async fn delete_prompt_label(
    Path((org_id, entity_id, label)): Path<(String, String, String)>,
    Query(query): Query<DeletePromptLabelQuery>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Err(response) = require_prompt_write(&org_id, &user.user_id).await {
        return response;
    }
    let can_move_protected = match can_move_protected_label(&org_id, &user.user_id, &label).await {
        Ok(allowed) => allowed,
        Err(response) => return response,
    };
    match prompts::delete_label(
        &org_id,
        &entity_id,
        &label,
        &context(&user, PromptSource::Ui),
        prompts::DeletePromptLabel {
            if_version: query.if_version,
        },
        can_move_protected,
    )
    .await
    {
        Ok(label) => Json(PromptLabelResponseBody::from(label)).into_response(),
        Err(error) => prompt_error_response(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn prompt_error_codes_have_stable_statuses() {
        let cases = [
            (PromptError::InvalidPromptName, 400, "invalid_prompt_name"),
            (PromptError::InvalidSelector, 400, "invalid_selector"),
            (PromptError::PromptNotFound, 404, "prompt_not_found"),
            (PromptError::VersionNotFound, 404, "version_not_found"),
            (PromptError::LabelNotFound, 404, "label_not_found"),
            (PromptError::LabelGone, 404, "label_gone"),
            (PromptError::HeadAdvanced, 409, "head_advanced"),
            (
                PromptError::IdempotencyConflict,
                409,
                "idempotency_conflict",
            ),
            (
                PromptError::ProtectedLabelForbidden,
                403,
                "protected_label_forbidden",
            ),
            (
                PromptError::LatestLabelImmutable,
                409,
                "latest_label_immutable",
            ),
            (PromptError::ArchivedPrompt, 409, "archived_prompt"),
            (PromptError::FolderNotFound, 404, "folder_not_found"),
            (PromptError::InvalidPromptType, 400, "invalid_prompt_type"),
            (
                PromptError::InvalidPromptSource,
                400,
                "invalid_prompt_source",
            ),
            (
                PromptError::InvalidConfig("unknown field".to_string()),
                400,
                "invalid_config",
            ),
            (PromptError::ProviderNotAllowed, 400, "provider_not_allowed"),
            (
                PromptError::Settings(
                    db::prompt_settings::PromptSettingsError::SecretNotConfigured,
                ),
                400,
                "webhook_not_configured",
            ),
        ];
        for (error, status, code) in cases {
            let response = prompt_error_response(error);
            assert_eq!(response.status().as_u16(), status);
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["code"], code);
        }
    }
}
