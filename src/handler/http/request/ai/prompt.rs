use actix_web::{web, HttpResponse, Result};
use std::sync::Arc;
use crate::prompt_manager::{PromptManager, CreatePromptRequest, UpdatePromptRequest, ApiResponse};


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
pub async fn list_prompts(
    org_id: web::Path<String>,
) -> Result<HttpResponse> {
    match prompt_manager.list_prompts(org_id.into_inner()) {
        Ok(response) => Ok(HttpResponse::Ok().json(ApiResponse::success(response))),
        Err(err) => Ok(HttpResponse::InternalServerError().json(ApiResponse::<()>::error(err))),
    }
}

pub async fn create_prompt(
    request: web::Json<CreatePromptRequest>,
) -> Result<HttpResponse> {
    match data.create_prompt(request.into_inner()) {
        Ok(prompt) => Ok(HttpResponse::Created().json(ApiResponse::success(prompt))),
        Err(err) => Ok(HttpResponse::BadRequest().json(ApiResponse::<()>::error(err))),
    }
}

pub async fn get_active_prompt(
    data: web::Data<Arc<PromptManager>>,
) -> Result<HttpResponse> {
    match data.get_active_prompt() {
        Ok(content) => {
            let response = serde_json::json!({
                "content": content
            });
            Ok(HttpResponse::Ok().json(ApiResponse::success(response)))
        }
        Err(err) => Ok(HttpResponse::InternalServerError().json(ApiResponse::<()>::error(err))),
    }
}

pub async fn get_prompt(
    data: web::Data<Arc<PromptManager>>,
    path: web::Path<String>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    match data.get_prompt(&id) {
        Ok(prompt) => Ok(HttpResponse::Ok().json(ApiResponse::success(prompt))),
        Err(err) => Ok(HttpResponse::NotFound().json(ApiResponse::<()>::error(err))),
    }
}

pub async fn update_prompt(
    data: web::Data<Arc<PromptManager>>,
    path: web::Path<String>,
    request: web::Json<UpdatePromptRequest>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    match data.update_prompt(&id, request.into_inner()) {
        Ok(prompt) => Ok(HttpResponse::Ok().json(ApiResponse::success(prompt))),
        Err(err) => Ok(HttpResponse::BadRequest().json(ApiResponse::<()>::error(err))),
    }
}

pub async fn delete_prompt(
    data: web::Data<Arc<PromptManager>>,
    path: web::Path<String>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    match data.delete_prompt(&id) {
        Ok(()) => Ok(HttpResponse::NoContent().finish()),
        Err(err) => Ok(HttpResponse::BadRequest().json(ApiResponse::<()>::error(err))),
    }
}

pub async fn activate_prompt(
    data: web::Data<Arc<PromptManager>>,
    path: web::Path<String>,
) -> Result<HttpResponse> {
    let id = path.into_inner();
    match data.set_active_prompt(&id) {
        Ok(()) => {
            let response = serde_json::json!({
                "message": "Prompt activated successfully"
            });
            Ok(HttpResponse::Ok().json(ApiResponse::success(response)))
        }
        Err(err) => Ok(HttpResponse::BadRequest().json(ApiResponse::<()>::error(err))),
    }
}