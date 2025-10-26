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
use o2_enterprise::enterprise::log_patterns::{ExtractionRequest, PatternExtractor};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Request to extract patterns from logs
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ExtractPatternsRequest {
    /// Log messages to analyze
    pub log_messages: Vec<String>,

    /// Extraction configuration
    #[serde(default)]
    pub config: Option<ExtractPatternsConfig>,
}

/// Configuration for pattern extraction
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ExtractPatternsConfig {
    /// Sample size (default: 10000)
    pub sample_size: Option<usize>,

    /// Similarity threshold (default: 0.4)
    pub similarity_threshold: Option<f64>,

    /// Tree depth (default: 4)
    pub depth: Option<usize>,

    /// Min logs per pattern (default: 10)
    pub min_cluster_size: Option<usize>,
}

/// Extract patterns from log messages
///
/// Phase 1 MVP: On-demand pattern extraction only
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
        content = ExtractPatternsRequest,
        description = "Log messages and configuration",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 400, description = "Bad Request"),
        (status = 403, description = "Forbidden - Enterprise feature only"),
        (status = 500, description = "Internal Server Error"),
    ),
)]
#[post("/{org_id}/streams/{stream_name}/patterns/extract")]
pub async fn extract_patterns(
    path: web::Path<(String, String)>,
    body: web::Json<ExtractPatternsRequest>,
) -> Result<HttpResponse, actix_web::Error> {
    let (org_id, stream_name) = path.into_inner();

    #[cfg(feature = "enterprise")]
    {
        // Validate request
        if body.log_messages.is_empty() {
            return Ok(MetaHttpResponse::bad_request("No log messages provided"));
        }

        // Convert to enterprise request format
        let config = if let Some(cfg) = &body.config {
            o2_enterprise::enterprise::log_patterns::ExtractionConfig {
                sample_size: cfg.sample_size.unwrap_or(10_000),
                similarity_threshold: cfg.similarity_threshold.unwrap_or(0.4),
                depth: cfg.depth.unwrap_or(4),
                max_child: 100,
                max_clusters: Some(1000),
                min_cluster_size: cfg.min_cluster_size.unwrap_or(10),
                masking_mode: o2_enterprise::enterprise::log_patterns::MaskingMode::Auto,
            }
        } else {
            Default::default()
        };

        let extraction_request = ExtractionRequest {
            stream_name: stream_name.clone(),
            log_messages: body.log_messages.clone(),
            config,
        };

        // Call enterprise pattern extractor
        match PatternExtractor::extract_patterns(extraction_request) {
            Ok(response) => Ok(MetaHttpResponse::json(response)),
            Err(e) => {
                log::error!(
                    "[PATTERNS] Failed to extract patterns for stream {}/{}: {}",
                    org_id,
                    stream_name,
                    e
                );
                Ok(MetaHttpResponse::internal_error(format!(
                    "Pattern extraction failed: {e}"
                )))
            }
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
    use super::*;

    #[test]
    fn test_extract_patterns_request_serialization() {
        let request = ExtractPatternsRequest {
            log_messages: vec!["test log 1".to_string(), "test log 2".to_string()],
            config: Some(ExtractPatternsConfig {
                sample_size: Some(1000),
                similarity_threshold: Some(0.5),
                depth: Some(4),
                min_cluster_size: Some(5),
            }),
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("test log 1"));
    }
}
