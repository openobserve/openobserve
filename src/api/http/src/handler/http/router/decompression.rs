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

//! Decodes snappy request bodies, which `RequestDecompressionLayer` would answer with 415.

use std::io::Read;

use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{HeaderMap, header},
    middleware::Next,
    response::Response,
};
use http_body::Frame;
use http_body_util::{BodyExt, Full, Limited, StreamBody};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

/// Stream identifier chunk that opens every framed snappy stream.
const SNAPPY_FRAMING_HEADER: &[u8] = b"\xff\x06\x00\x00sNaPpY";

#[derive(Clone, Copy, Debug, PartialEq)]
enum SnappyEncoding {
    Snappy,
    Framed,
}

impl SnappyEncoding {
    fn from_headers(headers: &HeaderMap) -> Option<Self> {
        // `remove` drops values this never inspected, so a multi-valued header is left to its 415
        let mut values = headers.get_all(header::CONTENT_ENCODING).iter();
        let value = values.next()?.to_str().ok()?;
        if values.next().is_some() {
            return None;
        }
        if value.eq_ignore_ascii_case("snappy") {
            Some(Self::Snappy)
        } else if value.eq_ignore_ascii_case("x-snappy-framed") {
            Some(Self::Framed)
        } else {
            None
        }
    }
}

/// Decodes `snappy` / `x-snappy-framed` bodies, except on routes whose handler decodes raw snappy.
pub async fn preprocess_encoding_middleware(mut request: Request, next: Next) -> Response {
    let Some(encoding) = SnappyEncoding::from_headers(request.headers()) else {
        return next.run(request).await;
    };

    if is_snappy_capable_route(request.uri().path()) {
        // those handlers only read raw snappy, so framed keeps its 415
        if encoding == SnappyEncoding::Snappy {
            request.headers_mut().remove(header::CONTENT_ENCODING);
        }
        return next.run(request).await;
    }

    let limit = config::get_config().limit.req_payload_limit;
    request.headers_mut().remove(header::CONTENT_ENCODING);
    request.headers_mut().remove(header::CONTENT_LENGTH);
    next.run(request.map(|body| decoded_body(body, encoding, limit)))
        .await
}

fn is_snappy_capable_route(path: &str) -> bool {
    // the `/api` nest and ZO_BASE_URI both shift the prefix, so only the suffix is reliable
    path.ends_with("/loki/api/v1/push") || path.ends_with("/prometheus/api/v1/write")
}

fn decoded_body(body: Body, encoding: SnappyEncoding, limit: usize) -> Body {
    // lazy, like RequestDecompressionLayer: nothing is decoded until the handler reads, after auth
    let decoded =
        futures::stream::once(
            async move { decode_body(body, encoding, limit).await.map(Frame::data) },
        );
    // not `Body::from_stream`: its extra error wrapper hides `LengthLimitError` from axum's 413
    Body::new(StreamBody::new(decoded))
}

async fn decode_body(
    body: Body,
    encoding: SnappyEncoding,
    limit: usize,
) -> Result<Bytes, BoxError> {
    let compressed = Limited::new(body, limit).collect().await?.to_bytes();
    match decode_snappy(&compressed, encoding, limit)? {
        Some(decoded) => Ok(decoded),
        None => Err(length_limit_error().await),
    }
}

/// Returns `None` when the decoded body would exceed `limit`.
fn decode_snappy(
    compressed: &[u8],
    encoding: SnappyEncoding,
    limit: usize,
) -> Result<Option<Bytes>, BoxError> {
    // older OTel collectors sent framed data as `snappy`; the collector's own receiver sniffs too
    if encoding == SnappyEncoding::Framed || compressed.starts_with(SNAPPY_FRAMING_HEADER) {
        let mut decoded = Vec::new();
        snap::read::FrameDecoder::new(compressed)
            .take(limit as u64 + 1)
            .read_to_end(&mut decoded)
            .map_err(invalid_snappy)?;
        return Ok((decoded.len() <= limit).then(|| decoded.into()));
    }

    // the block preamble carries the decoded length, so oversize is caught before allocating
    if snap::raw::decompress_len(compressed).map_err(invalid_snappy)? > limit {
        return Ok(None);
    }
    snap::raw::Decoder::new()
        .decompress_vec(compressed)
        .map(|decoded| Some(decoded.into()))
        .map_err(invalid_snappy)
}

fn invalid_snappy(e: impl std::fmt::Display) -> BoxError {
    format!("invalid snappy request body: {e}").into()
}

async fn length_limit_error() -> BoxError {
    // axum answers 413 only for `LengthLimitError`, which is non_exhaustive, so borrow Limited's
    match Limited::new(Full::new(Bytes::from_static(b"\0")), 0)
        .collect()
        .await
    {
        Err(e) => e,
        Ok(_) => "length limit exceeded".into(),
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        http::{Request, StatusCode},
        middleware,
        routing::post,
    };
    use tower::ServiceExt;
    use tower_http::decompression::RequestDecompressionLayer;

    use super::*;

    const LOKI_ROUTE: &str = "/{org_id}/loki/api/v1/push";
    const LOKI_URI: &str = "/default/loki/api/v1/push";
    const OTLP_ROUTE: &str = "/{org_id}/v1/logs";
    const OTLP_URI: &str = "/default/v1/logs";
    const PAYLOAD: &[u8] =
        br#"{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"body":{"stringValue":"hello"}}]}]}]}"#;

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

    async fn post_encoded(uri: &str, encoding: &str, body: Vec<u8>) -> (StatusCode, Bytes) {
        let request = Request::builder()
            .uri(uri)
            .method("POST")
            .header("Content-Type", "application/json")
            .header("Content-Encoding", encoding)
            .body(Body::from(body))
            .unwrap();

        let response = decompressing_app(OTLP_ROUTE)
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, body)
    }

    fn raw_snappy(payload: &[u8]) -> Vec<u8> {
        snap::raw::Encoder::new().compress_vec(payload).unwrap()
    }

    fn framed_snappy(payload: &[u8]) -> Vec<u8> {
        let mut encoder = snap::write::FrameEncoder::new(Vec::new());
        std::io::Write::write_all(&mut encoder, payload).unwrap();
        encoder.into_inner().unwrap()
    }

    async fn status_with_limit(
        compressed: Vec<u8>,
        encoding: SnappyEncoding,
        limit: usize,
    ) -> StatusCode {
        let request = Request::builder()
            .uri("/")
            .method("POST")
            .body(decoded_body(Body::from(compressed), encoding, limit))
            .unwrap();

        Router::new()
            .route("/", post(echo_body_handler))
            .oneshot(request)
            .await
            .unwrap()
            .status()
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
    async fn test_framed_snappy_kept_on_loki_push() {
        assert_eq!(
            echo_encoding(LOKI_ROUTE, LOKI_URI, Some("x-snappy-framed")).await,
            "x-snappy-framed"
        );
    }

    #[tokio::test]
    async fn test_raw_snappy_decoded_on_otlp() {
        let (status, body) = post_encoded(OTLP_URI, "snappy", raw_snappy(PAYLOAD)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.as_ref(), PAYLOAD);
    }

    #[tokio::test]
    async fn test_framed_body_sent_as_snappy_decoded_on_otlp() {
        let (status, body) = post_encoded(OTLP_URI, "snappy", framed_snappy(PAYLOAD)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.as_ref(), PAYLOAD);
    }

    #[tokio::test]
    async fn test_x_snappy_framed_decoded_on_otlp() {
        let (status, body) =
            post_encoded(OTLP_URI, "X-Snappy-Framed", framed_snappy(PAYLOAD)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.as_ref(), PAYLOAD);
    }

    #[tokio::test]
    async fn test_invalid_snappy_returns_400() {
        let (status, body) = post_encoded(OTLP_URI, "snappy", b"not snappy".to_vec()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            String::from_utf8_lossy(&body).contains("invalid snappy request body"),
            "{body:?}"
        );
    }

    #[tokio::test]
    async fn test_raw_x_snappy_framed_returns_400() {
        let (status, _) = post_encoded(OTLP_URI, "x-snappy-framed", raw_snappy(PAYLOAD)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn test_decoded_body_above_limit_returns_413() {
        let limit = PAYLOAD.len() - 1;
        for (compressed, encoding) in [
            (raw_snappy(PAYLOAD), SnappyEncoding::Snappy),
            (framed_snappy(PAYLOAD), SnappyEncoding::Snappy),
            (framed_snappy(PAYLOAD), SnappyEncoding::Framed),
        ] {
            let status = status_with_limit(compressed, encoding, limit).await;
            assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "{encoding:?}");
        }
    }

    #[tokio::test]
    async fn test_decoded_body_at_limit_is_accepted() {
        let status =
            status_with_limit(raw_snappy(PAYLOAD), SnappyEncoding::Snappy, PAYLOAD.len()).await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn test_compressed_body_above_limit_returns_413() {
        let compressed = raw_snappy(PAYLOAD);
        let limit = compressed.len() - 1;
        let status = status_with_limit(compressed, SnappyEncoding::Snappy, limit).await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
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
        let compressed = zstd::stream::encode_all(PAYLOAD, 0).unwrap();
        let (status, body) = post_encoded(OTLP_URI, "zstd", compressed).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.as_ref(), PAYLOAD);
    }
}
