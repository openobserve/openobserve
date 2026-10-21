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

//! Own test binary: it installs the process-wide audit publisher and a batch size of one.

#![cfg(feature = "enterprise")]

use std::sync::{Arc, Mutex, Once};

use async_trait::async_trait;
use config::utils::json::{self, Value};
use o2_enterprise::enterprise::common::auditor::Protocol;
use proto::cluster_rpc;

static PUBLISHED: Mutex<Vec<Value>> = Mutex::new(Vec::new());
static SETUP: Once = Once::new();
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Capture;

#[async_trait]
impl audit::AuditPublisher for Capture {
    async fn publish(
        &self,
        request: cluster_rpc::IngestionRequest,
    ) -> Result<cluster_rpc::IngestionResponse, anyhow::Error> {
        let rows: Vec<Value> = json::from_slice(&request.data.expect("audit rows").data)?;
        PUBLISHED.lock().unwrap().extend(rows);
        Ok(cluster_rpc::IngestionResponse::default())
    }
}

fn setup() {
    SETUP.call_once(|| {
        // SAFETY: set before any thread reads the enterprise config, which is loaded once.
        unsafe {
            std::env::set_var("O2_AUDIT_ENABLED", "true");
            std::env::set_var("O2_AUDIT_BATCH_SIZE", "1");
        }
        assert!(audit::set_audit_publisher(Arc::new(Capture)).is_ok());
    });
}

async fn published_by(report: impl std::future::Future<Output = ()>) -> Value {
    PUBLISHED.lock().unwrap().clear();
    report.await;
    let rows = std::mem::take(&mut *PUBLISHED.lock().unwrap());
    assert_eq!(rows.len(), 1, "one audit row per report: {rows:?}");
    rows.into_iter().next().unwrap()
}

#[tokio::test]
async fn report_with_protocol_records_the_given_protocol() {
    setup();
    let _serial = SERIAL.lock().await;
    let row = published_by(audit::report_with_protocol(
        Protocol::Slack,
        "alice@acme.com".to_string(),
        "acme".to_string(),
        "trace-1".to_string(),
        200,
        None,
        "POST".to_string(),
        "/api/slack/events".to_string(),
        String::new(),
        "{}".to_string(),
    ))
    .await;
    assert_eq!(row["protocol"], "Slack");
    assert_eq!(row["org_id"], "acme");
    assert_eq!(row["user_email"], "alice@acme.com");
    assert_eq!(row["http_path"], "/api/slack/events");
    assert_eq!(row["http_response_code"], 200);
    assert_eq!(row["trace_id"], "trace-1");
}

#[tokio::test]
async fn report_http_keeps_http() {
    setup();
    let _serial = SERIAL.lock().await;
    let row = published_by(audit::report_http(
        "alice@acme.com".to_string(),
        "acme".to_string(),
        "trace-2".to_string(),
        403,
        Some("denied".to_string()),
        "GET".to_string(),
        "/api/acme/streams".to_string(),
        String::new(),
        String::new(),
    ))
    .await;
    assert_eq!(row["protocol"], "Http");
    assert_eq!(row["error_msg"], "denied");
}
