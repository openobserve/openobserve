// Copyright 2026 OpenObserve Inc.
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

//! Preprocessing middleware for Content-Encoding header to support snappy pass-through.
//!
//! This middleware removes `Content-Encoding: snappy` before the request reaches
//! tower_http's RequestDecompressionLayer (which only supports gzip/deflate/brotli).
//! This allows handlers like Prometheus remote write to manually decompress snappy data.

use axum::{extract::Request, http::header, middleware::Next, response::Response};

/// Custom header name to preserve original snappy encoding information.
/// Handlers can check this header to know if they need to decompress snappy data.
pub const X_ORIGINAL_ENCODING: &str = "x-original-content-encoding";

/// Middleware that preprocesses Content-Encoding header before tower_http decompression.
///
/// If Content-Encoding is "snappy":
/// - Removes the Content-Encoding header (so tower_http doesn't return 415)
/// - Adds X-Original-Content-Encoding: snappy (so handler knows to decompress)
///
/// All other encodings (gzip, deflate, brotli, identity) pass through unchanged
/// and are handled by tower_http's RequestDecompressionLayer.
pub async fn preprocess_encoding_middleware(mut request: Request, next: Next) -> Response {
    // Check if Content-Encoding is snappy
    let is_snappy = request
        .headers()
        .get(header::CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.eq_ignore_ascii_case("snappy"))
        .unwrap_or(false);

    if is_snappy {
        // Clone the encoding value before modifying headers
        let encoding_value = request.headers().get(header::CONTENT_ENCODING).cloned();

        // Remove Content-Encoding so tower_http doesn't reject it with 415
        request.headers_mut().remove(header::CONTENT_ENCODING);

        // Preserve original encoding info for handler
        if let Some(value) = encoding_value {
            request.headers_mut().insert(
                axum::http::HeaderName::from_static(X_ORIGINAL_ENCODING),
                value,
            );
        }
    }

    next.run(request).await
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        middleware,
        routing::post,
    };
    use tower::ServiceExt;

    use super::*;

    async fn echo_headers_handler(req: Request<Body>) -> String {
        use axum::http::HeaderValue;

        let content_encoding = req
            .headers()
            .get(header::CONTENT_ENCODING)
            .and_then(|v: &HeaderValue| v.to_str().ok())
            .unwrap_or("none");
        let original_encoding = req
            .headers()
            .get(X_ORIGINAL_ENCODING)
            .and_then(|v: &HeaderValue| v.to_str().ok())
            .unwrap_or("none");
        format!(
            "content-encoding:{},original:{}",
            content_encoding, original_encoding
        )
    }

    #[tokio::test]
    async fn test_snappy_preprocessing() {
        let app = Router::new()
            .route("/test", post(echo_headers_handler))
            .layer(middleware::from_fn(preprocess_encoding_middleware));

        let request = Request::builder()
            .uri("/test")
            .method("POST")
            .header("Content-Encoding", "snappy")
            .body(Body::from("test"))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_str = String::from_utf8_lossy(&body);

        // Content-Encoding should be removed, X-Original-Content-Encoding should be set
        assert_eq!(body_str, "content-encoding:none,original:snappy");
    }

    #[tokio::test]
    async fn test_gzip_passthrough() {
        let app = Router::new()
            .route("/test", post(echo_headers_handler))
            .layer(middleware::from_fn(preprocess_encoding_middleware));

        let request = Request::builder()
            .uri("/test")
            .method("POST")
            .header("Content-Encoding", "gzip")
            .body(Body::from("test"))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_str = String::from_utf8_lossy(&body);

        // Content-Encoding should remain unchanged for gzip
        assert_eq!(body_str, "content-encoding:gzip,original:none");
    }

    #[tokio::test]
    async fn test_no_encoding() {
        let app = Router::new()
            .route("/test", post(echo_headers_handler))
            .layer(middleware::from_fn(preprocess_encoding_middleware));

        let request = Request::builder()
            .uri("/test")
            .method("POST")
            .body(Body::from("test"))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_str = String::from_utf8_lossy(&body);

        assert_eq!(body_str, "content-encoding:none,original:none");
    }
}
