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

use actix_web::{HttpRequest, HttpResponse, Responder, post, web};
use o2_enterprise::enterprise::{ai, common::config::get_config as get_o2_config};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::{
        models::ai::{PromptRequest, PromptResponse},
        request::search::search_stream::report_to_audit,
    },
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
        let response = ai::service::chat(ai::meta::AiServerRequest::new(
            req_body.messages,
            req_body.model,
        ))
        .await;
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
pub async fn chat_stream(
    org_id: web::Path<String>,
    body: web::Json<PromptRequest>,
    in_req: HttpRequest,
) -> impl Responder {
    let config = get_o2_config();
    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let org_id = org_id.into_inner();
    let trace_id = in_req
        .headers()
        .get("trace_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mut code = 200;
    let req_body = body.into_inner();
    let body_bytes = serde_json::to_string(&req_body).unwrap();

    if !config.ai.enabled {
        let error_message = Some("AI is not enabled".to_string());
        code = 400;
        report_to_audit(
            user_id,
            org_id,
            trace_id,
            code,
            error_message,
            &in_req,
            body_bytes,
        )
        .await;

        return MetaHttpResponse::bad_request("AI is not enabled");
    }
    let auth_str = crate::common::utils::auth::extract_auth_str(&in_req);

    let stream = match ai::service::chat_stream(
        ai::meta::AiServerRequest::new(req_body.messages, req_body.model),
        org_id.clone(),
        auth_str,
    )
    .await
    {
        Ok(stream) => stream,
        Err(e) => {
            let error_message = Some(e.to_string());
            // TODO: Handle the error rather than hard coding
            code = 500;
            report_to_audit(
                user_id,
                org_id,
                trace_id,
                code,
                error_message,
                &in_req,
                body_bytes,
            )
            .await;

            log::error!("Error in chat_stream: {}", e);
            return MetaHttpResponse::bad_request(e.to_string());
        }
    };

    report_to_audit(user_id, org_id, trace_id, code, None, &in_req, body_bytes).await;
    HttpResponse::Ok()
        .content_type("text/event-stream")
        .streaming(stream)
}
