use std::io::Error;

use actix_web::{HttpResponse, Result, delete, get, http::StatusCode, post, put, web};
use o2_enterprise::enterprise::ai::prompt::{
    meta::{CreatePromptRequest, UpdatePromptRequest},
    service as prompt_service,
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// ListPrompts
///
/// #{"ratelimit_module":"Prompt", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "ListPrompts",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = PromptResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[get("/{org_id}/ai/prompts")]
pub async fn list_prompts(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    match prompt_service::list_prompts().await {
        Ok(response) => Ok(MetaHttpResponse::json(response)),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

/// CreatePrompt
///
/// #{"ratelimit_module":"Prompt", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "CreatePrompt",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name")
    ),
    request_body(
        content = PromptRequest,
        description = "Prompt details", 
        example = json!({
            "name": "My Prompt",
            "description": "This is a prompt",
            "content": "Write a SQL query to get the top 10 users by response time in the default stream",
            "active": true
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt created", body = PromptResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[post("/{org_id}/ai/prompts")]
pub async fn create_prompt(
    _org_id: web::Path<String>,
    request: web::Json<CreatePromptRequest>,
) -> Result<HttpResponse, Error> {
    match prompt_service::create_prompt(request.into_inner()).await {
        Ok(prompt) => Ok(MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Prompt created")
                .with_id(prompt.id)
                .with_name(prompt.name),
        )),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

/// GetPrompt
///
/// #{"ratelimit_module":"Prompt", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "GetPrompt",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Prompt ID")
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt retrieved", body = PromptResponse),
        (status = StatusCode::NOT_FOUND, description = "Prompt not found", body = MetaHttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[get("/{org_id}/ai/prompts/{id}")]
pub async fn get_prompt(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, id) = path.into_inner();
    match prompt_service::get_prompt(&id).await {
        Ok(prompt) => Ok(MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Prompt retrieved")
                .with_id(prompt.id)
                .with_name(prompt.name),
        )),
        Err(err) => Ok(MetaHttpResponse::not_found(err.to_string())),
    }
}

/// UpdatePrompt
///
/// #{"ratelimit_module":"Prompt", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "UpdatePrompt",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Prompt ID")
    ),
    request_body(
        content = PromptRequest,
        description = "Prompt details", 
        example = json!({
            "name": "My Prompt",
            "description": "This is a prompt",  
            "content": "Write a SQL query to get the top 10 users by response time in the default stream",
            "active": true
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt updated", body = PromptResponse), 
        (status = StatusCode::NOT_FOUND, description = "Prompt not found", body = MetaHttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[put("/{org_id}/ai/prompts/{id}")]
pub async fn update_prompt(
    path: web::Path<(String, String)>,
    request: web::Json<UpdatePromptRequest>,
) -> Result<HttpResponse, Error> {
    let (_org_id, id) = path.into_inner();
    match prompt_service::update_prompt(&id, request.into_inner()).await {
        Ok(prompt) => Ok(MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Prompt updated")
                .with_id(prompt.id)
                .with_name(prompt.name),
        )),
        Err(err) => Ok(MetaHttpResponse::bad_request(err.to_string())),
    }
}

/// DeletePrompt
///
/// #{"ratelimit_module":"Prompt", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "DeletePrompt",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Prompt ID")
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt deleted", body = PromptResponse),
        (status = StatusCode::NOT_FOUND, description = "Prompt not found", body = MetaHttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[delete("/{org_id}/ai/prompts/{id}")]
pub async fn delete_prompt(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, id) = path.into_inner();
    match prompt_service::delete_prompt(&id).await {
        Ok(()) => Ok(HttpResponse::NoContent().finish()),
        Err(err) => Ok(MetaHttpResponse::not_found(err.to_string())),
    }
}

/// ActivatePrompt
///
/// #{"ratelimit_module":"Prompt", "ratelimit_module_operation":"activate"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "ActivatePrompt",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Prompt ID")
    ),
    responses(
        (status = StatusCode::OK, description = "Prompt activated", body = PromptResponse),
        (status = StatusCode::NOT_FOUND, description = "Prompt not found", body = MetaHttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[post("/{org_id}/ai/prompts/{id}/activate")]
pub async fn activate_prompt(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, id) = path.into_inner();
    match prompt_service::set_active_prompt(&id).await {
        Ok(()) => Ok(MetaHttpResponse::ok("Prompt activated successfully")),
        Err(err) => Ok(MetaHttpResponse::bad_request(err.to_string())),
    }
}
