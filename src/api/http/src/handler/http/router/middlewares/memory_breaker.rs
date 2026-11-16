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

use axum::{
    Json,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use common::meta::ingestion_routes::{is_ingestion_write, is_opamp};
use openobserve_core::ingestion::check_memory_circuit_breaker;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Refuses an ingest write on a tripped memory circuit breaker before its body is read or decoded.
pub async fn memory_breaker_middleware(request: Request, next: Next) -> Response {
    refuse_writes_when(request, next, check_memory_circuit_breaker).await
}

async fn refuse_writes_when(
    request: Request,
    next: Next,
    check: impl FnOnce() -> infra::errors::Result<()>,
) -> Response {
    // The breaker is a single atomic load; the route is classified only once it has tripped.
    if let Err(e) = check()
        && is_data_write(&request)
    {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(MetaHttpResponse::error(StatusCode::SERVICE_UNAVAILABLE, e)),
        )
            .into_response();
    }
    next.run(request).await
}

/// OpAMP manages agents and writes no data, so it stays up while the breaker is tripped.
fn is_data_write(request: &Request) -> bool {
    let path = request.uri().path();
    let route = crate::handler::http::router::matched_route(request);
    is_ingestion_write(request.method(), path, route.as_deref()) && !is_opamp(path)
}

#[cfg(test)]
mod tests {
    use std::{
        convert::Infallible,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
    };

    use axum::{
        Router,
        body::{Body, Bytes},
        http::Method,
        middleware,
        routing::{get, post},
    };
    use infra::errors::Error;
    use tower::ServiceExt;

    use super::*;

    fn tripped() -> infra::errors::Result<()> {
        Err(Error::ResourceError(
            "MemoryCircuitBreakerError".to_string(),
        ))
    }

    fn closed() -> infra::errors::Result<()> {
        Ok(())
    }

    fn app(check: fn() -> infra::errors::Result<()>) -> Router {
        let routes = Router::new()
            .route("/{org_id}/{stream_name}/_json", post(read_body))
            .route("/{org_id}/v1/opamp", post(read_body))
            .route("/{org_id}/streams", get(read_body))
            .layer(middleware::from_fn(move |req, next| {
                refuse_writes_when(req, next, check)
            }));
        Router::new().nest("/api", routes)
    }

    async fn read_body(body: Bytes) -> StatusCode {
        assert_eq!(body, Bytes::from_static(b"{}"));
        StatusCode::OK
    }

    /// A body that records whether anything polled it.
    fn watched_body() -> (Body, Arc<AtomicBool>) {
        let read = Arc::new(AtomicBool::new(false));
        let flag = read.clone();
        let stream = futures::stream::once(async move {
            flag.store(true, Ordering::SeqCst);
            Ok::<_, Infallible>(Bytes::from_static(b"{}"))
        });
        (Body::from_stream(stream), read)
    }

    async fn send(
        check: fn() -> infra::errors::Result<()>,
        method: Method,
        uri: &str,
    ) -> (StatusCode, bool, Bytes) {
        let (body, read) = watched_body();
        let req = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .body(body)
            .unwrap();
        let resp = app(check).oneshot(req).await.unwrap();
        let status = resp.status();
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, read.load(Ordering::SeqCst), body)
    }

    #[tokio::test]
    async fn test_tripped_breaker_refuses_a_write_without_reading_its_body() {
        let (status, read, body) = send(tripped, Method::POST, "/api/default/logs/_json").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(!read, "the body was read before the write was refused");
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], 503);
        assert_eq!(body["message"], "Error# MemoryCircuitBreakerError");
    }

    #[tokio::test]
    async fn test_closed_breaker_lets_the_write_through() {
        let (status, read, _) = send(closed, Method::POST, "/api/default/logs/_json").await;
        assert_eq!(status, StatusCode::OK);
        assert!(read);
    }

    #[tokio::test]
    async fn test_tripped_breaker_keeps_reads_and_opamp_up() {
        for (method, uri) in [
            (Method::GET, "/api/default/streams"),
            (Method::POST, "/api/default/v1/opamp"),
        ] {
            let (status, read, _) = send(tripped, method, uri).await;
            assert_eq!(status, StatusCode::OK, "{uri}");
            assert!(read, "{uri}");
        }
    }
}
