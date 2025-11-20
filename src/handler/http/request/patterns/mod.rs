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

use actix_web::{HttpResponse, post, web};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::utils::check_stream_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
};

/// Extract patterns from search results
///
/// This endpoint runs a search query and extracts patterns from the results.
/// It internally uses the same search infrastructure as _search but returns
/// only the extracted patterns.
///
/// POST /api/{org_id}/streams/{stream_name}/patterns/extract
#[utoipa::path(
    context_path = "/api",
    tag = "Patterns",
    operation_id = "ExtractPatterns",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    request_body(
        content = config::meta::search::Request,
        description = "Search query (same format as _search endpoint)",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "Success", body = serde_json::Value),
        (status = 400, description = "Bad Request"),
        (status = 403, description = "Forbidden - Enterprise feature only or Unauthorized Access"),
        (status = 500, description = "Internal Server Error"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Search", "operation": "get"}))
    )
)]
#[post("/{org_id}/streams/{stream_name}/patterns/extract")]
pub async fn extract_patterns(
    path: web::Path<(String, String)>,
    in_req: actix_web::HttpRequest,
    body: web::Bytes,
    Headers(user_email): Headers<UserEmail>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, stream_name) = path.into_inner();
    let user_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    {
        use tokio::sync::mpsc;

        use crate::service::search::streaming;

        let trace_id = config::ider::generate_trace_id();

        // Store body bytes for auditing
        let body_bytes = body.clone();

        log::info!(
            "[PATTERNS trace_id {}] Pattern extraction requested for {}/{}",
            trace_id,
            org_id,
            stream_name
        );

        // Parse the request body
        let mut req: config::meta::search::Request = match config::utils::json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[PATTERNS trace_id {}] Failed to parse request body: {}",
                    trace_id,
                    e
                );
                return Ok(MetaHttpResponse::bad_request(format!(
                    "Invalid request body: {e}"
                )));
            }
        };

        // Create audit context
        #[cfg(feature = "enterprise")]
        let audit_ctx = Some(crate::common::meta::search::AuditContext {
            method: in_req.method().to_string(),
            path: in_req.path().to_string(),
            query_params: in_req.query_string().to_string(),
            body: String::from_utf8_lossy(&body_bytes).to_string(),
        });
        #[cfg(not(feature = "enterprise"))]
        let audit_ctx = None;

        // Create a channel to receive search results
        let (tx, mut rx) = mpsc::channel(100);

        // Extract stream names from SQL query (just like _search_stream does)
        let stream_names = match config::meta::sql::resolve_stream_names(&req.query.sql) {
            Ok(names) => names,
            Err(e) => {
                log::error!(
                    "[PATTERNS trace_id {}] Failed to resolve stream names from SQL: {}",
                    trace_id,
                    e
                );
                return Ok(MetaHttpResponse::bad_request(format!(
                    "Invalid SQL query: {e}"
                )));
            }
        };

        log::info!(
            "[PATTERNS trace_id {}] Resolved stream names from SQL: {:?}",
            trace_id,
            stream_names
        );

        // Check permissions for each stream (same as _search API)
        #[cfg(feature = "enterprise")]
        for stream_name_check in stream_names.iter() {
            if let Some(res) = check_stream_permissions(
                stream_name_check,
                &org_id,
                &user_id,
                &config::meta::stream::StreamType::Logs,
            )
            .await
            {
                log::warn!(
                    "[PATTERNS trace_id {}] Unauthorized access attempt by user {} for stream {}",
                    trace_id,
                    user_id,
                    stream_name_check
                );
                return Ok(res);
            }
        }

        // Set size limit for pattern extraction using O2 config
        // This determines the maximum number of logs to analyze for pattern detection
        // Default is 10K which aligns with industry standards for pattern quality
        if req.query.size == 0 || req.query.size == -1 {
            let o2_config = get_o2_config();
            req.query.size = if o2_config.log_patterns.max_logs_for_extraction > 0 {
                o2_config.log_patterns.max_logs_for_extraction as i64
            } else {
                config::get_config().limit.query_default_limit
            };
        }

        log::info!(
            "[PATTERNS trace_id {}] Query configuration - size: {}, sampling_ratio: {:?}",
            trace_id,
            req.query.size,
            req.query.sampling_ratio
        );

        // Set search_type if not already set (required by search execution)
        if req.search_type.is_none() {
            req.search_type = Some(config::meta::search::SearchEventType::Other);
        }

        // Spawn the search task with pattern extraction enabled
        let org_id_clone = org_id.clone();
        let user_id_clone = user_id.clone();
        let trace_id_clone = trace_id.clone();

        tokio::spawn(async move {
            streaming::process_search_stream_request(
                org_id_clone,
                user_id_clone,
                trace_id_clone,
                req,
                config::meta::stream::StreamType::Logs,
                stream_names, // Use resolved stream names from SQL
                config::meta::sql::OrderBy::default(),
                tracing::Span::current(),
                tx,
                None,      // values_ctx
                None,      // fallback_order_by_col
                audit_ctx, // audit_ctx - now populated for auditing
                false,     // is_multi_stream_search
                true,      // extract_patterns = TRUE
            )
            .await;
        });

        // Collect only the pattern results
        let mut patterns_result = None;
        let mut response_count = 0;

        while let Some(result) = rx.recv().await {
            response_count += 1;
            log::debug!(
                "[PATTERNS trace_id {}] Received response #{}",
                trace_id,
                response_count
            );

            match result {
                Ok(config::meta::search::StreamResponses::PatternExtractionResult { patterns }) => {
                    log::info!(
                        "[PATTERNS trace_id {}] Received pattern extraction result",
                        trace_id
                    );
                    patterns_result = Some(patterns);
                    break; // We only need the patterns
                }
                Ok(_) => {
                    // Ignore other response types (histogram, search results, etc.)
                    continue;
                }
                Err(e) => {
                    log::error!(
                        "[PATTERNS trace_id {}] Error during pattern extraction: {}",
                        trace_id,
                        e
                    );
                    return Ok(MetaHttpResponse::internal_error(format!(
                        "Pattern extraction failed: {e}"
                    )));
                }
            }
        }

        log::info!(
            "[PATTERNS trace_id {}] Channel closed after {} responses",
            trace_id,
            response_count
        );

        if let Some(patterns) = patterns_result {
            log::info!(
                "[PATTERNS trace_id {}] Successfully extracted patterns",
                trace_id
            );
            Ok(MetaHttpResponse::json(patterns))
        } else {
            log::warn!(
                "[PATTERNS trace_id {}] No patterns were extracted",
                trace_id
            );
            Ok(MetaHttpResponse::json(serde_json::json!({
                "patterns": [],
                "statistics": {
                    "total_logs_analyzed": 0,
                    "total_patterns_found": 0,
                    "coverage_percentage": 0.0,
                    "extraction_time_ms": 0
                }
            })))
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        Ok(MetaHttpResponse::forbidden(
            "Pattern extraction is an enterprise feature",
        ))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_pattern_extraction_uses_search_request() {
        // This endpoint now accepts config::meta::search::Request
        // which is the same format as the _search endpoint
        let search_req = config::meta::search::Request {
            query: config::meta::search::Query {
                sql: "SELECT * FROM logs WHERE severity='ERROR'".to_string(),
                start_time: 0,
                end_time: chrono::Utc::now().timestamp_micros(),
                size: 1000,
                ..Default::default()
            },
            ..Default::default()
        };

        let json = serde_json::to_string(&search_req).unwrap();
        assert!(json.contains("SELECT"));
    }
}
