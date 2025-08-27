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

use std::{
    future::{Ready, ready},
    rc::Rc,
};

use actix_web::{
    Error,
    body::MessageBody,
    dev::{Service, ServiceRequest, ServiceResponse, Transform, forward_ready},
};
use futures::future::LocalBoxFuture;

use crate::common::meta::ingestion::INGESTION_EP;

pub struct IngestionCheck;

impl IngestionCheck {
    pub fn new() -> Self {
        Self
    }
}

impl Default for IngestionCheck {
    fn default() -> Self {
        Self::new()
    }
}

impl<S, B> Transform<S, ServiceRequest> for IngestionCheck
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = IngestionCheckMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(IngestionCheckMiddleware {
            service: Rc::new(service),
        }))
    }
}

pub struct IngestionCheckMiddleware<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for IngestionCheckMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);

        Box::pin(async move {
            // Get the path and check if it's an ingestion endpoint
            let path = req.path();
            let method = req.method();

            // Check if this is a POST request to an ingestion endpoint
            if method == actix_web::http::Method::POST && is_ingestion_endpoint(path) {
                // Extract org_id from the path
                if let Some(org_id) = extract_org_id_from_path(path) {
                    // Determine stream type from path
                    let stream_type = determine_stream_type_from_path(path);

                    match crate::service::ingestion::check_ingestion_allowed(
                        &org_id,
                        stream_type,
                        None,
                    )
                    .await
                    {
                        Ok(_) => {
                            // Quota check passed, continue with the request

                            service.call(req).await
                        }
                        Err(e) => {
                            // Quota check failed, return error
                            log::error!("[INGESTION_MIDDLEWARE] Quota check failed: {e}");

                            if matches!(e, infra::errors::Error::IngestionError(_)) {
                                Err(actix_web::error::ErrorForbidden(format!(
                                    "Ingestion quota exceeded: {e}",
                                )))
                            } else if matches!(e, infra::errors::Error::ResourceError(_)) {
                                Err(actix_web::error::ErrorServiceUnavailable(format!(
                                    "Ingestion resource error: {e}",
                                )))
                            } else {
                                Err(actix_web::error::ErrorInternalServerError(e))
                            }
                        }
                    }
                } else {
                    // Could not extract org_id, let the request proceed , request will fail in
                    // handler
                    service.call(req).await
                }
            } else {
                // Not an ingestion endpoint, proceed normally
                service.call(req).await
            }
        })
    }
}

/// Check if the given path is an ingestion endpoint
fn is_ingestion_endpoint(path: &str) -> bool {
    let path_segments: Vec<&str> = path.split('/').collect();

    // Look for ingestion endpoint patterns in the path
    // Paths typically look like: /api/{org_id}/[ingest/]logs/_json,
    // /api/{org_id}/[ingest/]metrics/_json, etc.
    for segment in &path_segments {
        if INGESTION_EP.contains(segment) {
            return true;
        }
    }

    false
}

/// Extract org_id from the request path
/// Expected path format: /api/{org_id}/...
fn extract_org_id_from_path(path: &str) -> Option<String> {
    let path_segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Path should be: [api, org_id, ...]
    if path_segments.len() >= 2 && path_segments[0] == "api" {
        let org_id = path_segments[1].to_string();
        Some(org_id)
    } else {
        None
    }
}

/// Determine the stream type from the request path
fn determine_stream_type_from_path(path: &str) -> config::meta::stream::StreamType {
    if path.contains("/logs/")
        || path.contains("/_bulk")
        || path.contains("/_json") && !path.contains("/metrics/")
    {
        config::meta::stream::StreamType::Logs
    } else if path.contains("/metrics/") || path.contains("/write") {
        config::meta::stream::StreamType::Metrics
    } else if path.contains("/traces/") {
        config::meta::stream::StreamType::Traces
    } else {
        // Default to Logs for unknown paths
        config::meta::stream::StreamType::Logs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_ingestion_endpoint() {
        assert!(is_ingestion_endpoint("/api/org1/ingest/logs/_json"));
        assert!(is_ingestion_endpoint("/api/org1/ingest/metrics/_json"));
        assert!(is_ingestion_endpoint("/api/org1/_bulk"));
        assert!(is_ingestion_endpoint("/api/org1/traces/write"));
        assert!(is_ingestion_endpoint("/api/org1/logs/_json"));

        assert!(!is_ingestion_endpoint("/api/org1/streams"));
        assert!(!is_ingestion_endpoint("/api/org1/search"));
        assert!(!is_ingestion_endpoint("/api/org1/alerts"));
    }

    #[test]
    fn test_extract_org_id_from_path() {
        assert_eq!(
            extract_org_id_from_path("/api/testorg/ingest/logs/_json"),
            Some("testorg".to_string())
        );
        assert_eq!(
            extract_org_id_from_path("/api/myorg/streams"),
            Some("myorg".to_string())
        );
        assert_eq!(extract_org_id_from_path("/invalid/path"), None);
        assert_eq!(extract_org_id_from_path("/api"), None);
    }

    #[test]
    fn test_determine_stream_type_from_path() {
        assert_eq!(
            determine_stream_type_from_path("/api/org1/ingest/logs/_json"),
            config::meta::stream::StreamType::Logs
        );
        assert_eq!(
            determine_stream_type_from_path("/api/org1/ingest/metrics/_json"),
            config::meta::stream::StreamType::Metrics
        );
        assert_eq!(
            determine_stream_type_from_path("/api/org1/traces/write"),
            config::meta::stream::StreamType::Traces
        );
        assert_eq!(
            determine_stream_type_from_path("/api/org1/_bulk"),
            config::meta::stream::StreamType::Logs
        );
        assert_eq!(
            determine_stream_type_from_path("/api/org1/v1/metrics"),
            config::meta::stream::StreamType::Metrics
        );
    }
}
