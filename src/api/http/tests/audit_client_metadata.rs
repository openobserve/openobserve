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

//! Own test binary: the audit buffer is process-wide, so one test owns it.

#![cfg(feature = "enterprise")]
// macOS ld cannot encode compact-unwind offsets for a binary this size; harmless here.
#![allow(linker_messages)]

use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    middleware,
    routing::get,
};
use config::axum::middlewares::{extract_real_ip, resolve_client_ip_sources};
use o2_enterprise::enterprise::common::auditor;
use openobserve_api_http::handler::http::router::audit_middleware;
use serde_json::Value;
use tower::ServiceExt;

fn boot() {
    let data_dir = std::env::temp_dir().join(format!("o2-audit-client-{}", std::process::id()));
    std::fs::create_dir_all(&data_dir).unwrap();
    // An explicit config file stops config loading from finding a developer `.env` up the tree.
    let env_file = data_dir.join("empty.env");
    std::fs::write(&env_file, "").unwrap();
    config::config_path_manager::set_config_file_path(env_file).unwrap();
    // SAFETY: this binary runs one test, which sets variables before any request.
    unsafe { std::env::set_var("O2_AUDIT_ENABLED", "true") };
}

fn app() -> Router {
    Router::new()
        .route("/default/things", get(|| async { "ok" }))
        .layer(middleware::from_fn(audit_middleware))
        .layer(middleware::from_fn(extract_real_ip))
        .layer(axum::Extension(resolve_client_ip_sources("XRealIp")))
}

async fn drain() -> Vec<Value> {
    let rows = Arc::new(Mutex::new(vec![]));
    let sink = rows.clone();
    auditor::publish_existing_audits("_meta", move |req| async move {
        let batch: Vec<Value> = serde_json::from_slice(&req.data.expect("audit rows").data)?;
        sink.lock().unwrap().extend(batch);
        Ok(Default::default())
    })
    .await;
    std::mem::take(&mut *rows.lock().unwrap())
}

async fn audited(request: Request<Body>) -> Value {
    let response = app().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut rows = drain().await;
    assert_eq!(rows.len(), 1, "one audit row per call: {rows:?}");
    rows.remove(0)
}

#[tokio::test]
async fn the_audit_middleware_records_the_client_ip_and_user_agent() {
    boot();
    drain().await;

    let row = audited(
        Request::get("/default/things")
            .header("x-real-ip", "198.51.100.7")
            .header("user-agent", "AuditTest/1.0")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(row["login_ip"], "198.51.100.7");
    assert_eq!(row["user_agent"], "AuditTest/1.0");
    assert_eq!(
        row["cluster_name"],
        config::get_config().common.cluster_name.as_str()
    );

    let row = audited(Request::get("/default/things").body(Body::empty()).unwrap()).await;
    assert!(row.get("login_ip").is_none(), "{row}");
    assert!(row.get("user_agent").is_none(), "{row}");
}
