// Copyright 2024 OpenObserve Inc.
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

use axum::{Json, extract::Path, http::StatusCode, response::Response};
use config::meta::ai::PromptType;
use o2_enterprise::enterprise::ai::agent::prompt::{
    meta::UpdatePromptRequest, service as prompt_service,
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse, handler::http::models::ai::PromptResponse,
};

/// ListPrompts
#[utoipa::path(
    get,
    path = "/{org_id}/ai/prompts",
    context_path = "/api",
    tag = "Ai",
    operation_id = "ListPrompts",
    summary = "List all AI prompts",
    description = "Retrieves all available AI prompts for the organization",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = inline(PromptResponse)),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Prompt", "operation": "list"}))
    )
)]
pub async fn list_prompts(Path(org_id): Path<String>) -> Response {
    // Ensure this API is only available for the "_meta" organization
    if org_id != config::META_ORG_ID {
        return MetaHttpResponse::forbidden(
            "This API is only available for the _meta organization",
        );
    }
    match prompt_service::get_all_prompts().await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

/// GetPrompt
#[utoipa::path(
    get,
    path = "/{org_id}/ai/prompts/{prompt_type}",
    context_path = "/api",
    tag = "Ai",
    operation_id = "GetPrompt",
    summary = "Get AI prompt by type",
    description = "Retrieves a specific AI prompt configuration by its type identifier",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Prompt ID")
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt retrieved", body = inline(PromptResponse)),
        (status = StatusCode::NOT_FOUND, description = "Prompt not found", body = Object),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Prompt", "operation": "get"}))
    )
)]
pub async fn get_prompt(Path((org_id, prompt_type)): Path<(String, PromptType)>) -> Response {
    // Ensure this API is only available for the "_meta" organization
    if org_id != config::META_ORG_ID {
        return MetaHttpResponse::forbidden(
            "This API is only available for the _meta organization",
        );
    }

    match prompt_service::get_prompt(prompt_type).await {
        Ok(prompt) => MetaHttpResponse::json(prompt),
        Err(err) => MetaHttpResponse::not_found(err),
    }
}

/// UpdatePrompt
#[utoipa::path(
    put,
    path = "/{org_id}/ai/prompts",
    context_path = "/api",
    tag = "Ai",
    operation_id = "UpdatePrompt",
    summary = "Update AI prompt",
    description = "Updates an existing AI prompt with new configuration and content",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    request_body(
        content = inline(UpdatePromptRequest),
        description = "Prompt details",
        example = json!({
            "content": "Write a SQL query to get the top 10 users by response time in the default stream"
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt updated", body = inline(PromptResponse)),
        (status = StatusCode::NOT_FOUND, description = "Prompt not found", body = Object),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Prompt", "operation": "update"}))
    )
)]
pub async fn update_prompt(
    Path(org_id): Path<String>,
    Json(request): Json<UpdatePromptRequest>,
) -> Response {
    // Ensure this API is only available for the "_meta" organization
    if org_id != config::META_ORG_ID {
        return MetaHttpResponse::forbidden(
            "This API is only available for the _meta organization",
        );
    }
    match prompt_service::update_prompt(request.content.clone()).await {
        Ok(_) => {
            // Emit cluster coordinator event to notify nodes in current cluster
            if let Err(e) = infra::coordinator::ai_prompts::emit_put_event().await {
                log::error!("Failed to emit AI prompt update event to cluster coordinator: {e}");
            }

            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
            {
                use bytes::Bytes;
                use o2_enterprise::enterprise::super_cluster::queue::{
                    AiPromptMessage, ai_prompt_put,
                };

                let msg = AiPromptMessage::Update {
                    content: request.content,
                };

                if let Err(e) =
                    ai_prompt_put("", Bytes::from(serde_json::to_string(&msg).unwrap())).await
                {
                    log::error!("Failed to publish AI prompt update message to super cluster: {e}");
                }
            }

            MetaHttpResponse::ok("Prompt updated")
        }
        Err(err) => MetaHttpResponse::bad_request(err),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/ai/prompts",
    context_path = "/api",
    tag = "Ai",
    operation_id = "RollbackPrompt",
    summary = "Rollback AI prompt to previous version",
    description = "Reverts an AI prompt to its previous version or configuration",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt rolled back to default", body = inline(PromptResponse)),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = Object),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = Object),
    ),
)]
pub async fn rollback_prompt(Path(org_id): Path<String>) -> Response {
    // Ensure this API is only available for the "_meta" organization
    if org_id != config::META_ORG_ID {
        return MetaHttpResponse::forbidden(
            "This API is only available for the _meta organization",
        );
    }
    match prompt_service::rollback_to_default_prompt().await {
        Ok(()) => {
            // Emit cluster coordinator event to notify nodes in current cluster
            if let Err(e) = infra::coordinator::ai_prompts::emit_rollback_event().await {
                log::error!("Failed to emit AI prompt rollback event to cluster coordinator: {e}");
            }

            axum::http::Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(axum::body::Body::empty())
                .unwrap_or_else(|_| Response::new(axum::body::Body::empty()))
        }
        Err(err) => MetaHttpResponse::not_found(err),
    }
}
