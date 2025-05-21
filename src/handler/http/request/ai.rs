// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpResponse, Responder, post, web};
use o2_enterprise::enterprise::{ai, common::infra::config::get_config as get_o2_config};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::ai::{PromptRequest, PromptResponse},
};

/// CreateChat
///
/// #{"ratelimit_module":"Chat", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "Chat",
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
            "messages": [
                {
                    "role": "user",
                    "content": "Write a SQL query to get the top 10 users by response time in the default stream",
                }
            ]
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = PromptResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[post("/{org_id}/ai/chat")]
pub async fn chat(body: web::Json<PromptRequest>) -> impl Responder {
    let config = get_o2_config();
    if config.ai.enabled {
        let req_body = body.into_inner();
        let response =
            ai::service::chat(ai::AiServerRequest::new(req_body.messages, req_body.model)).await;
        match response {
            Ok(response) => HttpResponse::Ok().json(PromptResponse::from(response)),
            Err(e) => {
                log::error!("Error in chat: {}", e);
                MetaHttpResponse::internal_error(e)
            }
        }
    } else {
        MetaHttpResponse::bad_request("AI is not enabled")
    }
}

/// CreateChatStream
///
/// #{"ratelimit_module":"Chat", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ai",
    operation_id = "ChatStream",
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
            "messages": [
                {
                    "role": "user",
                    "content": "Write a SQL query to get the top 10 users by response time in the default stream",
                }
            ]
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Chat response", body = HttpResponse),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = MetaHttpResponse),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = MetaHttpResponse),
    ),
)]
#[post("/{org_id}/ai/chat_stream")]
pub async fn chat_stream(body: web::Json<PromptRequest>) -> impl Responder {
    let config = get_o2_config();
    if config.ai.enabled {
        let req_body = body.into_inner();
        let response =
            ai::service::chat_stream(ai::AiServerRequest::new(req_body.messages, req_body.model))
                .await;
        match response {
            Ok(stream) => HttpResponse::Ok()
                .content_type("text/event-stream")
                .streaming(stream),
            Err(e) => {
                log::error!("Error in ai chat stream: {}", e);
                MetaHttpResponse::internal_error(e)
            }
        }
    } else {
        MetaHttpResponse::bad_request("AI is not enabled")
    }
}
