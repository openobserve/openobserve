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

//! Hides `Content-Encoding: snappy` from `RequestDecompressionLayer`, which would answer 415.

use axum::{extract::Request, http::header, middleware::Next, response::Response};

/// Drops the header only on the routes that decode snappy themselves; the rest keep their 415.
pub async fn preprocess_encoding_middleware(mut request: Request, next: Next) -> Response {
    // `remove` drops values this never inspected, so a multi-valued header is left to its 415
    let only_snappy = {
        let mut encodings = request.headers().get_all(header::CONTENT_ENCODING).iter();
        encodings
            .next()
            .is_some_and(|v| v.to_str().is_ok_and(|s| s.eq_ignore_ascii_case("snappy")))
            && encodings.next().is_none()
    };

    if only_snappy && is_snappy_capable_route(request.uri().path()) {
        request.headers_mut().remove(header::CONTENT_ENCODING);
    }

    next.run(request).await
}

fn is_snappy_capable_route(path: &str) -> bool {
    // the `/api` nest and ZO_BASE_URI both shift the prefix, so only the suffix is reliable
    path.ends_with("/loki/api/v1/push") || path.ends_with("/prometheus/api/v1/write")
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, Bytes},
        http::{Request, StatusCode},
        middleware,
        routing::post,
    };
    use tower::ServiceExt;
    use tower_http::decompression::RequestDecompressionLayer;

    use super::*;

    const LOKI_ROUTE: &str = "/{org_id}/loki/api/v1/push";
    const LOKI_URI: &str = "/default/loki/api/v1/push";

    async fn echo_encoding_handler(req: Request<Body>) -> String {
        req.headers()
            .get(header::CONTENT_ENCODING)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("none")
            .to_string()
    }

    async fn echo_body_handler(body: Bytes) -> Bytes {
        body
    }

    async fn echo_encoding(route: &str, uri: &str, encoding: Option<&str>) -> String {
        let app = Router::new()
            .route(route, post(echo_encoding_handler))
            .layer(middleware::from_fn(preprocess_encoding_middleware));

        let mut builder = Request::builder().uri(uri).method("POST");
        if let Some(encoding) = encoding {
            builder = builder.header("Content-Encoding", encoding);
        }

        let response = app
            .oneshot(builder.body(Body::from("test")).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8_lossy(&body).into_owned()
    }

    fn decompressing_app(route: &str) -> Router {
        Router::new()
            .route(route, post(echo_body_handler))
            .layer(RequestDecompressionLayer::new())
            .layer(middleware::from_fn(preprocess_encoding_middleware))
    }

    #[tokio::test]
    async fn test_snappy_stripped_on_loki_push() {
        assert_eq!(
            echo_encoding(LOKI_ROUTE, LOKI_URI, Some("snappy")).await,
            "none"
        );
    }

    #[tokio::test]
    async fn test_snappy_stripped_on_prometheus_remote_write() {
        let encoding = echo_encoding(
            "/{org_id}/prometheus/api/v1/write",
            "/default/prometheus/api/v1/write",
            Some("snappy"),
        )
        .await;
        assert_eq!(encoding, "none");
    }

    #[tokio::test]
    async fn test_snappy_stripped_when_the_api_prefix_is_not_nested_away() {
        let encoding = echo_encoding(
            "/api/{org_id}/loki/api/v1/push",
            "/api/default/loki/api/v1/push",
            Some("snappy"),
        )
        .await;
        assert_eq!(encoding, "none");
    }

    #[tokio::test]
    async fn test_snappy_stripped_regardless_of_case() {
        assert_eq!(
            echo_encoding(LOKI_ROUTE, LOKI_URI, Some("SNAPPY")).await,
            "none"
        );
    }

    #[tokio::test]
    async fn test_snappy_kept_on_a_route_that_cannot_decode_it() {
        let encoding = echo_encoding("/{org_id}/v1/logs", "/default/v1/logs", Some("snappy")).await;
        assert_eq!(encoding, "snappy");
    }

    #[tokio::test]
    async fn test_snappy_on_otlp_path_returns_415() {
        let request = Request::builder()
            .uri("/default/v1/logs")
            .method("POST")
            .header("Content-Type", "application/x-protobuf")
            .header("Content-Encoding", "snappy")
            .body(Body::from("snappy bytes"))
            .unwrap();

        let response = decompressing_app("/{org_id}/v1/logs")
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[tokio::test]
    async fn test_multi_valued_encoding_is_left_alone() {
        for encodings in [["snappy", "gzip"], ["gzip", "snappy"]] {
            let mut builder = Request::builder().uri(LOKI_URI).method("POST");
            for encoding in encodings {
                builder = builder.header("Content-Encoding", encoding);
            }

            let app = Router::new()
                .route(LOKI_ROUTE, post(echo_encoding_handler))
                .layer(middleware::from_fn(preprocess_encoding_middleware));
            let response = app
                .oneshot(builder.body(Body::from("test")).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);

            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            assert_eq!(
                String::from_utf8_lossy(&body),
                encodings[0],
                "{encodings:?}"
            );
        }
    }

    #[tokio::test]
    async fn test_gzip_passthrough() {
        assert_eq!(
            echo_encoding(LOKI_ROUTE, LOKI_URI, Some("gzip")).await,
            "gzip"
        );
    }

    #[tokio::test]
    async fn test_no_encoding() {
        assert_eq!(echo_encoding(LOKI_ROUTE, LOKI_URI, None).await, "none");
    }

    #[tokio::test]
    async fn test_zstd_request_decompression() {
        let payload = br#"[{"message":"hello"}]"#;
        let compressed = zstd::stream::encode_all(payload.as_slice(), 0).unwrap();

        let request = Request::builder()
            .uri(LOKI_URI)
            .method("POST")
            .header("Content-Type", "application/json")
            .header("Content-Encoding", "zstd")
            .body(Body::from(compressed))
            .unwrap();

        let response = decompressing_app(LOKI_ROUTE)
            .oneshot(request)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), payload);
    }
}
