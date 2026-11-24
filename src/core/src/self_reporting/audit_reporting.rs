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

use std::{future::Future, time::Duration};

use anyhow::{Result, anyhow};
use config::utils::json;
use o2_enterprise::enterprise::common::{
    auditor::{self, AuditMessage},
    config::get_config as get_o2_config,
};
use proto::cluster_rpc::{IngestionRequest, IngestionResponse};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};

const AUDIT_REPORTING_TIMEOUT: Duration = Duration::from_secs(30);
const AUDIT_REQUEUE_CAP_BATCHES: usize = 20;

#[derive(Clone)]
struct ReportingSettings {
    mode: String,
    url: String,
    creds: String,
    batch_size: usize,
    timeout: Duration,
}

impl ReportingSettings {
    fn from_config() -> Self {
        let cfg = get_o2_config();
        Self {
            mode: cfg.common.audit_reporting_mode.clone(),
            url: cfg.common.audit_reporting_url.clone(),
            creds: cfg.common.audit_reporting_creds.clone(),
            batch_size: cfg.common.audit_batch_size,
            timeout: AUDIT_REPORTING_TIMEOUT,
        }
    }

    fn requeue_cap(&self) -> usize {
        self.batch_size.saturating_mul(AUDIT_REQUEUE_CAP_BATCHES)
    }
}

/// Publishes one audit batch per `O2_AUDIT_REPORTING_MODE`, following usage reporting.
pub(crate) async fn publish(request: IngestionRequest) -> Result<IngestionResponse> {
    publish_with(&ReportingSettings::from_config(), request, ingest_locally).await
}

async fn publish_with<F, Fut>(
    settings: &ReportingSettings,
    request: IngestionRequest,
    local_write: F,
) -> Result<IngestionResponse>
where
    F: FnOnce(IngestionRequest) -> Fut,
    Fut: Future<Output = Result<IngestionResponse>>,
{
    let mode = settings.mode.as_str();
    if mode == "local" {
        return local_write(request).await;
    }

    // Never return Err below: auditor pushes an Err batch back, so the remote would get it twice.
    let body = request.data.as_ref().map(|data| data.data.clone());
    if let Some(body) = body.as_deref()
        && !settings.url.is_empty()
        && !settings.creds.is_empty()
        && let Err(e) = post_remote(settings, body.to_vec()).await
    {
        log::error!("[AUDIT-REPORTING] Error in ingesting audit data to external URL: {e}");
        if mode != "both" {
            requeue(settings.requeue_cap(), body).await;
        }
    }

    if mode != "remote" {
        match local_write(request).await {
            Ok(resp) if resp.status_code == 200 => {}
            result => {
                let err = result.map_or_else(|e| e.to_string(), |resp| resp.message);
                log::error!("[AUDIT-REPORTING] Error in ingesting audit data locally: {err}");
                if mode != "both"
                    && let Some(body) = body.as_deref()
                {
                    requeue(settings.requeue_cap(), body).await;
                }
            }
        }
    }

    Ok(IngestionResponse {
        status_code: 200,
        message: mode.to_string(),
    })
}

async fn post_remote(settings: &ReportingSettings, body: Vec<u8>) -> Result<()> {
    let url = url::Url::parse(&settings.url).unwrap();
    let creds = if settings.creds.starts_with("Basic") {
        settings.creds.to_string()
    } else {
        format!("Basic {}", settings.creds)
    };
    let resp = reqwest::Client::builder()
        .timeout(settings.timeout)
        .build()?
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, creds)
        .body(body)
        .send()
        .await?;
    let resp_status = resp.status();
    if !resp_status.is_success() {
        return Err(anyhow!(
            resp.text()
                .await
                .unwrap_or_else(|_| resp_status.to_string())
        ));
    }
    Ok(())
}

async fn requeue(cap: usize, body: &[u8]) {
    let rows: Vec<AuditMessage> = match json::from_slice(body) {
        Ok(rows) => rows,
        Err(e) => {
            log::error!("[AUDIT-REPORTING] Failed to decode audit rows for retry: {e}");
            return;
        }
    };
    if auditor::buffered_len().await + rows.len() > cap {
        log::error!(
            "[AUDIT-REPORTING] Retry buffer is full (cap {cap}), dropping {} audit rows",
            rows.len()
        );
        config::metrics::AUDIT_REQUEUE_DROPPED_TOTAL.inc_by(rows.len() as u64);
        return;
    }
    for row in rows {
        auditor::enqueue(row).await;
    }
}

async fn ingest_locally(request: IngestionRequest) -> Result<IngestionResponse> {
    crate::ingestion::ingestion_service::ingest(request)
        .await
        .map_err(|error| anyhow!(error.to_string()))
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use o2_enterprise::enterprise::common::auditor::{Protocol, ResponseMeta};
    use proto::cluster_rpc::IngestionData;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
    };

    use super::*;

    // AUDIT_DATA is a process-wide buffer, so tests that touch it run one at a time.
    static BUFFER_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[derive(Default)]
    struct Captured {
        headers: String,
        body: Vec<u8>,
    }

    struct Stub {
        url: String,
        hits: Arc<Mutex<Vec<Captured>>>,
    }

    impl Stub {
        async fn start(status: u16) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!(
                "http://{}/api/_meta/audit/_json",
                listener.local_addr().unwrap()
            );
            let hits = Arc::new(Mutex::new(vec![]));
            let recorded = hits.clone();
            tokio::spawn(async move {
                while let Ok((mut sock, _)) = listener.accept().await {
                    let captured = read_request(&mut sock).await;
                    recorded.lock().unwrap().push(captured);
                    let resp = format!(
                        "HTTP/1.1 {status} STUB\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let _ = sock.shutdown().await;
                }
            });
            Self { url, hits }
        }

        fn hit_count(&self) -> usize {
            self.hits.lock().unwrap().len()
        }
    }

    async fn read_request(sock: &mut TcpStream) -> Captured {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = sock.read(&mut chunk).await.unwrap_or(0);
            if n == 0 {
                return Captured::default();
            }
            buf.extend_from_slice(&chunk[..n]);
            let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
                continue;
            };
            let headers = String::from_utf8_lossy(&buf[..end]).to_lowercase();
            let len = content_length(&headers);
            if buf.len() >= end + 4 + len {
                let body = buf[end + 4..end + 4 + len].to_vec();
                return Captured { headers, body };
            }
        }
    }

    fn content_length(headers: &str) -> usize {
        headers
            .lines()
            .find_map(|line| line.strip_prefix("content-length:"))
            .and_then(|value| value.trim().parse().ok())
            .unwrap_or(0)
    }

    async fn refused_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{addr}/api/_meta/audit/_json")
    }

    async fn hanging_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let mut held = vec![];
            while let Ok((sock, _)) = listener.accept().await {
                held.push(sock);
            }
        });
        format!("http://{addr}/api/_meta/audit/_json")
    }

    fn settings(mode: &str, url: &str, creds: &str) -> ReportingSettings {
        ReportingSettings {
            mode: mode.to_string(),
            url: url.to_string(),
            creds: creds.to_string(),
            batch_size: get_o2_config().common.audit_batch_size,
            timeout: Duration::from_millis(500),
        }
    }

    fn row(i: i64) -> AuditMessage {
        AuditMessage {
            user_email: format!("user{i}@example.com"),
            org_id: "default".to_string(),
            _timestamp: i,
            protocol: Protocol::Http,
            login_ip: None,
            user_agent: None,
            response_meta: ResponseMeta {
                http_method: "GET".to_string(),
                http_path: format!("/api/default/path/{i}"),
                http_query_params: String::new(),
                http_body: String::new(),
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
            delegated: None,
            fleet_id: None,
            target: None,
        }
    }

    fn rows(n: i64) -> Vec<AuditMessage> {
        (0..n).map(row).collect()
    }

    fn request(rows: &[AuditMessage]) -> IngestionRequest {
        let values: Vec<json::Value> = rows.iter().map(|r| json::to_value(r).unwrap()).collect();
        IngestionRequest {
            org_id: "_meta".to_string(),
            stream_name: "audit".to_string(),
            stream_type: "logs".to_string(),
            data: Some(IngestionData::from(values)),
            ingestion_type: None,
            metadata: None,
        }
    }

    fn local_writer(
        calls: &Arc<AtomicUsize>,
        ok: bool,
    ) -> impl FnOnce(IngestionRequest) -> std::future::Ready<Result<IngestionResponse>> + use<>
    {
        let calls = calls.clone();
        move |_request| {
            calls.fetch_add(1, Ordering::SeqCst);
            std::future::ready(if ok {
                Ok(IngestionResponse {
                    status_code: 200,
                    message: "local-write".to_string(),
                })
            } else {
                Err(anyhow!("ingester down"))
            })
        }
    }

    async fn drain_buffer() -> Vec<AuditMessage> {
        let out = Arc::new(Mutex::new(vec![]));
        let sink = out.clone();
        auditor::publish_existing_audits("_meta", move |req| async move {
            let rows: Vec<AuditMessage> = json::from_slice(&req.data.unwrap().data).unwrap();
            sink.lock().unwrap().extend(rows);
            Ok(IngestionResponse::default())
        })
        .await;
        std::mem::take(&mut *out.lock().unwrap())
    }

    #[tokio::test]
    async fn local_mode_writes_locally_and_never_posts() {
        let _guard = BUFFER_LOCK.lock().await;
        let stub = Stub::start(200).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let s = settings("local", &stub.url, "abc");

        let resp = publish_with(&s, request(&rows(2)), local_writer(&calls, true))
            .await
            .unwrap();

        assert_eq!(resp.message, "local-write");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(stub.hit_count(), 0);
    }

    #[tokio::test]
    async fn local_mode_returns_the_local_error_as_today() {
        let _guard = BUFFER_LOCK.lock().await;
        let calls = Arc::new(AtomicUsize::new(0));
        let s = settings("local", "", "");

        let result = publish_with(&s, request(&rows(1)), local_writer(&calls, false)).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn remote_mode_posts_the_exact_batch_with_basic_auth() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let stub = Stub::start(200).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let req = request(&rows(3));
        let sent = req.data.as_ref().unwrap().data.clone();

        let resp = publish_with(
            &settings("remote", &stub.url, "abc"),
            req,
            local_writer(&calls, true),
        )
        .await
        .unwrap();

        assert_eq!(resp.status_code, 200);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(drain_buffer().await.is_empty());
        let hits = stub.hits.lock().unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].body, sent);
        assert!(hits[0].headers.contains("content-type: application/json"));
        assert!(hits[0].headers.contains("authorization: basic abc"));
    }

    #[tokio::test]
    async fn creds_that_already_carry_basic_are_not_prefixed_again() {
        let _guard = BUFFER_LOCK.lock().await;
        let stub = Stub::start(200).await;
        let calls = Arc::new(AtomicUsize::new(0));

        publish_with(
            &settings("remote", &stub.url, "Basic xyz"),
            request(&rows(1)),
            local_writer(&calls, true),
        )
        .await
        .unwrap();

        let hits = stub.hits.lock().unwrap();
        assert!(hits[0].headers.contains("authorization: basic xyz"));
        assert!(!hits[0].headers.contains("basic basic"));
    }

    #[tokio::test]
    async fn remote_mode_requeues_rows_when_the_remote_rejects_them() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let stub = Stub::start(500).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let batch = rows(3);

        let resp = publish_with(
            &settings("remote", &stub.url, "abc"),
            request(&batch),
            local_writer(&calls, true),
        )
        .await;

        assert!(resp.is_ok());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(drain_buffer().await, batch);
    }

    #[tokio::test]
    async fn remote_mode_requeues_rows_when_the_remote_is_unreachable() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let batch = rows(2);

        let resp = publish_with(
            &settings("remote", &refused_url().await, "abc"),
            request(&batch),
            local_writer(&Arc::new(AtomicUsize::new(0)), true),
        )
        .await;

        assert!(resp.is_ok());
        assert_eq!(drain_buffer().await, batch);
    }

    #[tokio::test]
    async fn a_failed_remote_batch_is_requeued_once_through_the_auditor() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let stub = Stub::start(500).await;
        let batch_size = get_o2_config().common.audit_batch_size;
        for i in 0..batch_size as i64 - 1 {
            auditor::enqueue(row(i)).await;
        }
        let s = settings("remote", &stub.url, "abc");
        let writer = local_writer(&Arc::new(AtomicUsize::new(0)), true);

        auditor::audit("_meta", row(-1), move |req| async move {
            publish_with(&s, req, writer).await
        })
        .await;

        assert_eq!(stub.hit_count(), 1);
        assert_eq!(drain_buffer().await.len(), batch_size);
    }

    #[tokio::test]
    async fn a_failed_batch_over_the_cap_is_dropped_and_counted() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let mut s = settings("remote", &refused_url().await, "abc");
        s.batch_size = 1;
        let cap = s.requeue_cap();
        for i in 0..cap as i64 - 1 {
            auditor::enqueue(row(i)).await;
        }
        let before = config::metrics::AUDIT_REQUEUE_DROPPED_TOTAL.get();

        publish_with(
            &s,
            request(&rows(2)),
            local_writer(&Arc::new(AtomicUsize::new(0)), true),
        )
        .await
        .unwrap();

        assert_eq!(
            config::metrics::AUDIT_REQUEUE_DROPPED_TOTAL.get() - before,
            2
        );
        assert_eq!(drain_buffer().await.len(), cap - 1);
    }

    #[tokio::test]
    async fn both_mode_writes_locally_and_drops_a_remote_failure() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let stub = Stub::start(500).await;
        let calls = Arc::new(AtomicUsize::new(0));

        let resp = publish_with(
            &settings("both", &stub.url, "abc"),
            request(&rows(2)),
            local_writer(&calls, true),
        )
        .await;

        assert!(resp.is_ok());
        assert_eq!(stub.hit_count(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(drain_buffer().await.is_empty());
    }

    #[tokio::test]
    async fn both_mode_drops_a_local_failure_without_reposting_it() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let stub = Stub::start(200).await;
        let batch_size = get_o2_config().common.audit_batch_size;
        for i in 0..batch_size as i64 - 1 {
            auditor::enqueue(row(i)).await;
        }
        let s = settings("both", &stub.url, "abc");
        let writer = local_writer(&Arc::new(AtomicUsize::new(0)), false);

        auditor::audit("_meta", row(-1), move |req| async move {
            publish_with(&s, req, writer).await
        })
        .await;

        assert_eq!(stub.hit_count(), 1);
        assert!(drain_buffer().await.is_empty());
    }

    #[tokio::test]
    async fn an_unknown_mode_posts_writes_locally_and_retries_both_failures() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let stub = Stub::start(500).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let batch = rows(2);

        let resp = publish_with(
            &settings("foo", &stub.url, "abc"),
            request(&batch),
            local_writer(&calls, false),
        )
        .await;

        assert!(resp.is_ok());
        assert_eq!(stub.hit_count(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let requeued = drain_buffer().await;
        assert_eq!(requeued.len(), batch.len() * 2);
    }

    #[tokio::test]
    async fn remote_mode_without_url_or_creds_writes_nothing() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let stub = Stub::start(200).await;
        for s in [
            settings("remote", "", "abc"),
            settings("remote", &stub.url, ""),
        ] {
            let calls = Arc::new(AtomicUsize::new(0));

            let resp = publish_with(&s, request(&rows(1)), local_writer(&calls, true)).await;

            assert!(resp.is_ok());
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
        assert_eq!(stub.hit_count(), 0);
        assert!(drain_buffer().await.is_empty());
    }

    #[tokio::test]
    async fn a_remote_that_never_answers_times_out_and_requeues() {
        let _guard = BUFFER_LOCK.lock().await;
        drain_buffer().await;
        let batch = rows(1);
        let started = std::time::Instant::now();

        let resp = publish_with(
            &settings("remote", &hanging_url().await, "abc"),
            request(&batch),
            local_writer(&Arc::new(AtomicUsize::new(0)), true),
        )
        .await;

        assert!(resp.is_ok());
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(drain_buffer().await, batch);
    }
}
