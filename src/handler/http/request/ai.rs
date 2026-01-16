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

use std::collections::HashMap;

use actix_web::{HttpRequest, HttpResponse, Responder, post, web};
use o2_enterprise::enterprise::{ai, common::infra::config::get_config as get_o2_config};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::{
        models::ai::{PromptRequest, PromptResponse},
        request::search::search_stream::report_to_audit,
    },
};

/// Extract headers from the request that match the configured passthrough patterns.
/// Supports exact matches and prefix wildcards (e.g., "x-forwarded-*").
fn extract_passthrough_headers(
    req: &HttpRequest,
    passthrough_config: &str,
) -> HashMap<String, String> {
    let mut headers = HashMap::new();

    // Parse the passthrough config into patterns
    let patterns: Vec<&str> = passthrough_config
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    for (header_name, header_value) in req.headers() {
        let header_name_lower = header_name.as_str().to_lowercase();

        for pattern in &patterns {
            let pattern_lower = pattern.to_lowercase();
            let matches = if pattern_lower.ends_with('*') {
                // Prefix match (e.g., "x-forwarded-*" matches "x-forwarded-for")
                let prefix = &pattern_lower[..pattern_lower.len() - 1];
                header_name_lower.starts_with(prefix)
            } else {
                // Exact match
                header_name_lower == pattern_lower
            };

            if matches {
                if let Ok(value) = header_value.to_str() {
                    headers.insert(header_name_lower.clone(), value.to_string());
                }
                break;
            }
        }
    }

    headers
}

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
pub async fn chat(body: web::Json<PromptRequest>, in_req: HttpRequest) -> impl Responder {
    let config = get_o2_config();

    if config.ai.enabled {
        let req_body = body.into_inner();

        // Extract headers to pass through to the LLM gateway
        let passthrough_headers =
            extract_passthrough_headers(&in_req, &config.ai.passthrough_headers);

        let response = ai::service::chat(
            ai::meta::AiServerRequest::new(req_body.messages, req_body.model),
            passthrough_headers,
        )
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
    let auth_str = crate::common::utils::auth::extract_auth_str(&in_req).await;

    // Extract headers to pass through to the LLM gateway
    let passthrough_headers = extract_passthrough_headers(&in_req, &config.ai.passthrough_headers);

    let stream = match ai::service::chat_stream(
        ai::meta::AiServerRequest::new(req_body.messages, req_body.model),
        org_id.clone(),
        auth_str,
        user_id.clone(),
        passthrough_headers,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_passthrough_headers_exact_match() {
        // Create a test request with headers
        let req = actix_web::test::TestRequest::default()
            .insert_header(("User-Agent", "Mozilla/5.0"))
            .insert_header(("X-Custom-Header", "custom-value"))
            .insert_header(("Authorization", "Bearer secret"))
            .to_http_request();

        let config = "user-agent,x-custom-header";
        let headers = extract_passthrough_headers(&req, config);

        assert_eq!(headers.len(), 2);
        assert_eq!(headers.get("user-agent"), Some(&"Mozilla/5.0".to_string()));
        assert_eq!(
            headers.get("x-custom-header"),
            Some(&"custom-value".to_string())
        );
        // Authorization should not be included
        assert!(headers.get("authorization").is_none());
    }

    #[test]
    fn test_extract_passthrough_headers_wildcard_match() {
        let req = actix_web::test::TestRequest::default()
            .insert_header(("X-Forwarded-For", "192.168.1.1"))
            .insert_header(("X-Forwarded-Proto", "https"))
            .insert_header(("X-Forwarded-Host", "example.com"))
            .insert_header(("X-Other-Header", "other"))
            .to_http_request();

        let config = "x-forwarded-*";
        let headers = extract_passthrough_headers(&req, config);

        assert_eq!(headers.len(), 3);
        assert_eq!(
            headers.get("x-forwarded-for"),
            Some(&"192.168.1.1".to_string())
        );
        assert_eq!(headers.get("x-forwarded-proto"), Some(&"https".to_string()));
        assert_eq!(
            headers.get("x-forwarded-host"),
            Some(&"example.com".to_string())
        );
        // X-Other-Header should not match
        assert!(headers.get("x-other-header").is_none());
    }

    #[test]
    fn test_extract_passthrough_headers_mixed_patterns() {
        let req = actix_web::test::TestRequest::default()
            .insert_header(("User-Agent", "curl/7.68.0"))
            .insert_header(("X-Forwarded-For", "10.0.0.1"))
            .insert_header(("X-Forwarded-Proto", "http"))
            .insert_header(("X-Request-Id", "abc-123"))
            .to_http_request();

        let config = "x-forwarded-*,user-agent,x-request-id";
        let headers = extract_passthrough_headers(&req, config);

        assert_eq!(headers.len(), 4);
        assert!(headers.contains_key("user-agent"));
        assert!(headers.contains_key("x-forwarded-for"));
        assert!(headers.contains_key("x-forwarded-proto"));
        assert!(headers.contains_key("x-request-id"));
    }

    #[test]
    fn test_extract_passthrough_headers_empty_config() {
        let req = actix_web::test::TestRequest::default()
            .insert_header(("User-Agent", "test"))
            .to_http_request();

        let config = "";
        let headers = extract_passthrough_headers(&req, config);

        assert!(headers.is_empty());
    }

    #[test]
    fn test_extract_passthrough_headers_case_insensitive() {
        let req = actix_web::test::TestRequest::default()
            .insert_header(("USER-AGENT", "test-agent"))
            .insert_header(("X-FORWARDED-FOR", "1.2.3.4"))
            .to_http_request();

        let config = "User-Agent,x-forwarded-for";
        let headers = extract_passthrough_headers(&req, config);

        assert_eq!(headers.len(), 2);
        assert_eq!(headers.get("user-agent"), Some(&"test-agent".to_string()));
        assert_eq!(headers.get("x-forwarded-for"), Some(&"1.2.3.4".to_string()));
    }
}
