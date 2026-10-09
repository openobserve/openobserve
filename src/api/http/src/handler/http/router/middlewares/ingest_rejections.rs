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
    extract::{OriginalUri, Request},
    http::Method,
    middleware::Next,
    response::Response,
};
use common::meta::ingestion_routes::is_ingestion_write;
use config::utils::time::now_micros;
use openobserve_core::ingestion::rejections::{
    IngestRejection, RejectionOrg, RejectionReason, RejectionTokenName, record_rejection,
    should_record,
};

trait RejectionSink {
    fn reason(&self, org_id: &str, status: u16) -> Option<RejectionReason>;
    fn record(&self, org_id: &str, rejection: IngestRejection);
}

struct NodeSink;

impl RejectionSink for NodeSink {
    fn reason(&self, org_id: &str, status: u16) -> Option<RejectionReason> {
        should_record(org_id, status)
    }

    fn record(&self, org_id: &str, rejection: IngestRejection) {
        record_rejection(org_id, rejection);
    }
}

/// Records a rejected ingest write for the org's first-event diagnosis; the response is unchanged.
pub async fn ingest_rejections_middleware(request: Request, next: Next) -> Response {
    record_rejections(request, next, &NodeSink).await
}

async fn record_rejections(request: Request, next: Next, sink: &impl RejectionSink) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let original_path = request
        .extensions()
        .get::<OriginalUri>()
        .map(|uri| uri.0.path().to_string());
    let response = next.run(request).await;
    if response.status().is_client_error() {
        record_if_rejected(sink, &method, &path, original_path.as_deref(), &response);
    }
    response
}

fn record_if_rejected(
    sink: &impl RejectionSink,
    method: &Method,
    path: &str,
    original_path: Option<&str>,
    response: &Response,
) {
    let Some(org_id) = rejected_org(method, path, response) else {
        return;
    };
    let status = response.status().as_u16();
    let Some(reason) = sink.reason(&org_id, status) else {
        return;
    };
    let token_name = response
        .extensions()
        .get::<RejectionTokenName>()
        .map(|name| name.0.as_str());
    sink.record(
        &org_id,
        IngestRejection::new(
            now_micros(),
            status,
            reason,
            original_path.unwrap_or(path),
            token_name,
        ),
    );
}

/// The HEC collector names the org in a response extension; API writes carry it in the path.
fn rejected_org(method: &Method, path: &str, response: &Response) -> Option<String> {
    if let Some(org) = response.extensions().get::<RejectionOrg>() {
        return Some(org.0.clone());
    }
    let relative = path.trim_start_matches('/');
    if !is_ingestion_write(method, relative) {
        return None;
    }
    let relative = relative.strip_prefix("v2/").unwrap_or(relative);
    relative.split('/').next().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{HashMap, HashSet},
        future::Future,
        pin::Pin,
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use axum::{
        Router,
        body::Body,
        http::{Request as HttpRequest, StatusCode},
        middleware,
        response::IntoResponse,
        routing::{get, post},
    };
    use bytes::Bytes;
    use openobserve_core::ingestion::rejections::{
        MAX_ORG_KEY_LEN, MEMO_CAPACITY, Recorder, RejectionKv, rejection_reason,
    };
    use tokio::task::JoinHandle;
    use tower::ServiceExt;

    use super::*;

    type KvFuture<'a, T> = Pin<Box<dyn Future<Output = infra::errors::Result<T>> + Send + 'a>>;

    /// One in-memory key per org that counts writes.
    #[derive(Default)]
    struct MemoryKv {
        keys: Mutex<HashMap<String, (Bytes, u64)>>,
        gets: AtomicUsize,
        puts: AtomicUsize,
    }

    impl MemoryKv {
        fn entries(&self, org_id: &str) -> Vec<IngestRejection> {
            self.keys
                .lock()
                .unwrap()
                .get(org_id)
                .map(|(value, _)| serde_json::from_slice(value).unwrap())
                .unwrap_or_default()
        }
    }

    impl RejectionKv for MemoryKv {
        fn get<'a, 'b, 'c>(&'a self, org_id: &'b str) -> KvFuture<'c, Option<(Bytes, u64)>>
        where
            'a: 'c,
            'b: 'c,
            Self: 'c,
        {
            Box::pin(async move {
                self.gets.fetch_add(1, Ordering::SeqCst);
                Ok(self.keys.lock().unwrap().get(org_id).cloned())
            })
        }

        fn put_if_revision<'a, 'b, 'c>(
            &'a self,
            org_id: &'b str,
            value: Bytes,
            revision: Option<u64>,
        ) -> KvFuture<'c, bool>
        where
            'a: 'c,
            'b: 'c,
            Self: 'c,
        {
            Box::pin(async move {
                self.puts.fetch_add(1, Ordering::SeqCst);
                let mut keys = self.keys.lock().unwrap();
                let current = keys.get(org_id).map(|(_, revision)| *revision);
                if current != revision {
                    return Ok(false);
                }
                keys.insert(org_id.to_string(), (value, current.unwrap_or(0) + 1));
                Ok(true)
            })
        }

        fn delete<'a, 'b, 'c>(&'a self, org_id: &'b str) -> KvFuture<'c, ()>
        where
            'a: 'c,
            'b: 'c,
            Self: 'c,
        {
            Box::pin(async move {
                self.keys.lock().unwrap().remove(org_id);
                Ok(())
            })
        }
    }

    /// A per-test org list and recorder, so parallel tests never share the node's caches.
    struct TestSink {
        known: HashSet<String>,
        recorder: Arc<Recorder<MemoryKv>>,
        kv: Arc<MemoryKv>,
        tasks: Mutex<Vec<JoinHandle<()>>>,
    }

    impl TestSink {
        fn new(known: &[&str]) -> Arc<Self> {
            let kv = Arc::new(MemoryKv::default());
            Arc::new(Self {
                known: known.iter().map(|org| org.to_string()).collect(),
                recorder: Arc::new(Recorder::new(kv.clone(), |_| false, MEMO_CAPACITY)),
                kv,
                tasks: Mutex::new(Vec::new()),
            })
        }

        async fn settle(&self) {
            let tasks = std::mem::take(&mut *self.tasks.lock().unwrap());
            for task in tasks {
                task.await.unwrap();
            }
        }
    }

    impl RejectionSink for TestSink {
        fn reason(&self, org_id: &str, status: u16) -> Option<RejectionReason> {
            rejection_reason(org_id, status, |org| self.known.contains(org))
        }

        fn record(&self, org_id: &str, rejection: IngestRejection) {
            if let Some(task) = self.recorder.record(org_id, rejection, now_micros()) {
                self.tasks.lock().unwrap().push(task);
            }
        }
    }

    async fn answer(request: Request) -> Response {
        let status = request
            .headers()
            .get("x-status")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(200);
        let mut response = StatusCode::from_u16(status).unwrap().into_response();
        if let Some(token) = request.headers().get("x-token") {
            response
                .extensions_mut()
                .insert(RejectionTokenName(token.to_str().unwrap().to_string()));
        }
        response
    }

    async fn hec_answer(request: Request) -> Response {
        let org = request
            .headers()
            .get("x-hec-org")
            .map(|v| v.to_str().unwrap().to_string());
        let mut response = answer(request).await;
        if let Some(org) = org {
            response.extensions_mut().insert(RejectionOrg(org));
        }
        response
    }

    fn app(sink: &Arc<TestSink>) -> Router {
        let layer = |sink: Arc<TestSink>| {
            middleware::from_fn(move |request: Request, next: Next| {
                let sink = sink.clone();
                async move { record_rejections(request, next, sink.as_ref()).await }
            })
        };
        let api = Router::new()
            .route("/{org_id}/{stream_name}/_json", post(answer))
            .route("/{org_id}/{stream_name}/_multi", post(answer))
            .route("/{org_id}/_bulk", post(answer))
            .route("/{org_id}/v1/logs", post(answer))
            .route("/{org_id}/v1/metrics", post(answer))
            .route("/{org_id}/v1/traces", post(answer))
            .route("/{org_id}/prometheus/api/v1/write", post(answer))
            .route("/{org_id}/streams", get(answer))
            .layer(layer(sink.clone()));
        let hec = Router::new()
            .route("/services/collector", post(hec_answer))
            .layer(layer(sink.clone()));
        Router::new().nest("/api", api).merge(hec)
    }

    async fn send(
        sink: &Arc<TestSink>,
        method: &str,
        uri: &str,
        status: u16,
        headers: &[(&str, &str)],
    ) -> StatusCode {
        let mut builder = HttpRequest::builder()
            .method(method)
            .uri(uri)
            .header("x-status", status.to_string());
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        let request = builder.body(Body::empty()).unwrap();
        let status = app(sink).oneshot(request).await.unwrap().status();
        sink.settle().await;
        status
    }

    #[tokio::test]
    async fn test_every_site_records_every_mapped_status() {
        let org = "rej_mw_sites";
        let sites = [
            format!("/api/{org}/s/_json"),
            format!("/api/{org}/s/_multi"),
            format!("/api/{org}/_bulk"),
            format!("/api/{org}/v1/logs"),
            format!("/api/{org}/v1/metrics"),
            format!("/api/{org}/v1/traces"),
            format!("/api/{org}/prometheus/api/v1/write"),
        ];
        let statuses = [
            (401, RejectionReason::InvalidCredentials),
            (403, RejectionReason::InvalidCredentials),
            (400, RejectionReason::MalformedBody),
            (413, RejectionReason::BatchTooLarge),
            (429, RejectionReason::RateOrQuota),
        ];
        for site in &sites {
            for (status, reason) in statuses {
                let sink = TestSink::new(&[org]);
                assert_eq!(
                    send(&sink, "POST", site, status, &[]).await.as_u16(),
                    status
                );
                let entries = sink.kv.entries(org);
                assert_eq!(entries.len(), 1, "{site} {status}");
                assert_eq!((entries[0].status, entries[0].reason), (status, reason));
                assert_eq!(&entries[0].path, site);
                assert_eq!(entries[0].token_name, None);
            }
        }
    }

    #[tokio::test]
    async fn test_hec_records_through_the_response_extension() {
        let org = "rej_mw_hec";
        let sink = TestSink::new(&[org]);
        send(
            &sink,
            "POST",
            "/services/collector",
            400,
            &[("x-hec-org", org)],
        )
        .await;
        let entries = sink.kv.entries(org);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].reason, RejectionReason::MalformedBody);
        assert_eq!(entries[0].path, "/services/collector");

        send(&sink, "POST", "/services/collector", 401, &[]).await;
        assert_eq!(sink.kv.entries(org).len(), 1, "no resolved org, no record");
    }

    #[tokio::test]
    async fn test_token_name_is_kept_and_success_is_not_recorded() {
        let org = "rej_mw_token";
        let sink = TestSink::new(&[org]);
        let uri = format!("/api/{org}/_bulk");
        send(&sink, "POST", &uri, 200, &[("x-token", "ci-token")]).await;
        assert!(sink.kv.entries(org).is_empty());
        send(&sink, "POST", &uri, 413, &[("x-token", "ci-token")]).await;
        let entries = sink.kv.entries(org);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].token_name.as_deref(), Some("ci-token"));
    }

    #[tokio::test]
    async fn test_not_found_server_errors_and_non_ingest_routes_are_never_recorded() {
        let org = "rej_mw_skip";
        let sink = TestSink::new(&[org]);
        send(&sink, "POST", &format!("/api/{org}/_bulk"), 404, &[]).await;
        send(&sink, "POST", &format!("/api/{org}/_bulk"), 500, &[]).await;
        send(&sink, "POST", &format!("/api/{org}/_bulk"), 503, &[]).await;
        send(&sink, "GET", &format!("/api/{org}/streams"), 403, &[]).await;
        assert!(sink.kv.keys.lock().unwrap().is_empty());
        assert_eq!(sink.kv.gets.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_unknown_orgs_add_no_key_and_a_known_org_survives() {
        let org = "rej_mw_survivor";
        let sink = TestSink::new(&[org]);
        send(&sink, "POST", &format!("/api/{org}/_bulk"), 401, &[]).await;
        for i in 0..10_001 {
            let random = format!("rej_mw_random_{i}_{}", i * 7919 % 10_007);
            send(&sink, "POST", &format!("/api/{random}/_bulk"), 401, &[]).await;
        }
        let keys = sink.kv.keys.lock().unwrap();
        assert_eq!(keys.len(), 1);
        drop(keys);
        assert_eq!(sink.kv.entries(org).len(), 1);
        assert_eq!(sink.kv.gets.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_org_key_longer_than_256_is_refused() {
        let long = "k".repeat(MAX_ORG_KEY_LEN + 1);
        let sink = TestSink::new(&[&long]);
        send(&sink, "POST", &format!("/api/{long}/_bulk"), 401, &[]).await;
        assert!(sink.kv.keys.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_one_reason_sent_twenty_times_writes_once() {
        let org = "rej_mw_once";
        let sink = TestSink::new(&[org]);
        send(&sink, "POST", &format!("/api/{org}/_bulk"), 413, &[]).await;
        for _ in 0..20 {
            send(&sink, "POST", &format!("/api/{org}/_bulk"), 401, &[]).await;
        }
        let entries = sink.kv.entries(org);
        let reasons = entries.iter().map(|e| e.reason).collect::<Vec<_>>();
        assert_eq!(
            reasons,
            [
                RejectionReason::BatchTooLarge,
                RejectionReason::InvalidCredentials
            ]
        );
        assert_eq!(sink.kv.puts.load(Ordering::SeqCst), 2);
        assert_eq!(sink.kv.gets.load(Ordering::SeqCst), 2);
    }
}
