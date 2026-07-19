// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{future::Future, str::FromStr};

use axum::{extract::Path, response::Response};
use openobserve_core::alerts::snapshots::{self, AlertSnapshotManifestView};
use svix_ksuid::Ksuid;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::alerts::responses::AlertSnapshotManifestResponseBody,
};

/// GetAlertSnapshotManifest
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/snapshots/{snapshot_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlertSnapshotManifest",
    summary = "Get alert snapshot manifest",
    description = "Retrieves the deterministic file-reference manifest captured for a scheduled alert occurrence.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("snapshot_id" = String, Path, description = "Alert snapshot ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(AlertSnapshotManifestResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get alert snapshot manifest by ID", "category": "alerts"}))
    )
)]
pub async fn get_alert_snapshot_manifest(
    Path((org_id, snapshot_id)): Path<(String, String)>,
) -> Response {
    get_alert_snapshot_manifest_with_lookup(org_id, snapshot_id, |org_id, snapshot_id| async move {
        snapshots::get_snapshot_manifest_view(&org_id, snapshot_id).await
    })
    .await
}

async fn get_alert_snapshot_manifest_with_lookup<F, Fut>(
    org_id: String,
    snapshot_id: String,
    lookup: F,
) -> Response
where
    F: FnOnce(String, Ksuid) -> Fut,
    Fut: Future<Output = anyhow::Result<Option<AlertSnapshotManifestView>>>,
{
    let snapshot_id_str = snapshot_id.clone();
    let snapshot_id = match Ksuid::from_str(&snapshot_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert snapshot id {snapshot_id}"));
        }
    };

    match lookup(org_id, snapshot_id).await {
        Ok(Some(manifest)) => {
            let body: AlertSnapshotManifestResponseBody = manifest.into();
            MetaHttpResponse::json(body)
        }
        Ok(None) => {
            MetaHttpResponse::not_found(format!("alert snapshot {snapshot_id_str} not found"))
        }
        Err(e) => {
            MetaHttpResponse::internal_error(format!("failed to get alert snapshot manifest: {e}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    use axum::{body::to_bytes, http::StatusCode};
    use config::meta::stream::StreamType as MetaStreamType;
    use serde_json::Value;

    use super::*;

    fn ksuid() -> Ksuid {
        Ksuid::from_str("2XQ4VYiGLnsBUbQ1uJ2ldokUULN").unwrap()
    }

    fn other_ksuid() -> Ksuid {
        Ksuid::from_str("2XQ4VdD2xcWd1FJV6m2ndOg7qxp").unwrap()
    }

    fn manifest(snapshot_id: Ksuid) -> AlertSnapshotManifestView {
        AlertSnapshotManifestView {
            snapshot_id,
            org_id: "org1".to_string(),
            alert_id: other_ksuid(),
            alert_name: Some("error-rate".to_string()),
            trigger_timestamp: 30,
            window_start: 10,
            window_end: 30,
            created_at: 31,
            schema_version: 1,
            streams: vec![stream(
                MetaStreamType::Logs,
                "app",
                vec![file(Some(1), "files/org1/logs/app/a.parquet", 10, 30)],
            )],
        }
    }

    fn stream(
        stream_type: MetaStreamType,
        stream_name: &str,
        files: Vec<snapshots::AlertSnapshotFileRefView>,
    ) -> snapshots::AlertSnapshotStreamView {
        snapshots::AlertSnapshotStreamView {
            stream_type,
            stream_name: stream_name.to_string(),
            files,
        }
    }

    fn file(
        file_id: Option<i64>,
        file_key: &str,
        min_ts: i64,
        max_ts: i64,
    ) -> snapshots::AlertSnapshotFileRefView {
        snapshots::AlertSnapshotFileRefView {
            file_id,
            file_key: file_key.to_string(),
            min_ts,
            max_ts,
        }
    }

    async fn json_response(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        (status, value)
    }

    #[tokio::test]
    async fn retrieves_snapshot_manifest_successfully() {
        let snapshot_id = ksuid();
        let (status, body) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org1".to_string(),
                snapshot_id.to_string(),
                move |org_id, requested_snapshot_id| async move {
                    assert_eq!(org_id, "org1");
                    assert_eq!(requested_snapshot_id, snapshot_id);
                    Ok(Some(manifest(snapshot_id)))
                },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["snapshot_id"], snapshot_id.to_string());
        assert_eq!(body["org_id"], "org1");
        assert_eq!(body["alert_id"], other_ksuid().to_string());
        assert_eq!(body["alert_name"], "error-rate");
        assert_eq!(body["trigger_timestamp"], 30);
        assert_eq!(body["window_start"], 10);
        assert_eq!(body["window_end"], 30);
        assert_eq!(body["created_at"], 31);
        assert_eq!(body["schema_version"], 1);
        assert_eq!(body["streams"][0]["stream_type"], "logs");
        assert_eq!(body["streams"][0]["stream_name"], "app");
        assert_eq!(body["streams"][0]["files"][0]["file_id"], 1);
        assert_eq!(
            body["streams"][0]["files"][0]["file_key"],
            "files/org1/logs/app/a.parquet"
        );
    }

    #[tokio::test]
    async fn response_preserves_multiple_streams_and_files_order() {
        let snapshot_id = ksuid();
        let mut item = manifest(snapshot_id);
        item.streams = vec![
            stream(
                MetaStreamType::Logs,
                "app",
                vec![
                    file(Some(1), "files/org1/logs/app/a.parquet", 10, 20),
                    file(Some(2), "files/org1/logs/app/b.parquet", 20, 30),
                ],
            ),
            stream(
                MetaStreamType::Metrics,
                "cpu",
                vec![file(Some(3), "files/org1/metrics/cpu/a.parquet", 10, 30)],
            ),
        ];

        let (_, body) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org1".to_string(),
                snapshot_id.to_string(),
                |_, _| async move { Ok(Some(item)) },
            )
            .await,
        )
        .await;

        assert_eq!(body["streams"][0]["stream_type"], "logs");
        assert_eq!(
            body["streams"][0]["files"][0]["file_key"],
            "files/org1/logs/app/a.parquet"
        );
        assert_eq!(
            body["streams"][0]["files"][1]["file_key"],
            "files/org1/logs/app/b.parquet"
        );
        assert_eq!(body["streams"][1]["stream_type"], "metrics");
        assert_eq!(
            body["streams"][1]["files"][0]["file_key"],
            "files/org1/metrics/cpu/a.parquet"
        );
    }

    #[tokio::test]
    async fn empty_file_manifest_is_returned() {
        let snapshot_id = ksuid();
        let mut item = manifest(snapshot_id);
        item.streams[0].files.clear();

        let (status, body) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org1".to_string(),
                snapshot_id.to_string(),
                |_, _| async move { Ok(Some(item)) },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["streams"][0]["files"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn missing_snapshot_returns_not_found() {
        let snapshot_id = ksuid();
        let (status, _) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org1".to_string(),
                snapshot_id.to_string(),
                |_, _| async { Ok(None) },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn cross_organization_request_returns_not_found() {
        let snapshot_id = ksuid();
        let (status, _) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org2".to_string(),
                snapshot_id.to_string(),
                move |org_id, requested_snapshot_id| async move {
                    assert_eq!(org_id, "org2");
                    assert_eq!(requested_snapshot_id, snapshot_id);
                    Ok(None)
                },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn malformed_snapshot_id_returns_not_found_without_lookup() {
        let lookup_called = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&lookup_called);
        let (status, _) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org1".to_string(),
                "not-a-ksuid".to_string(),
                move |_, _| {
                    flag.store(true, Ordering::SeqCst);
                    async { Ok(None) }
                },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(!lookup_called.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn persistence_error_maps_to_internal_error() {
        let snapshot_id = ksuid();
        let (status, body) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org1".to_string(),
                snapshot_id.to_string(),
                |_, _| async { Err(anyhow::anyhow!("database unavailable")) },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(
            body["message"]
                .as_str()
                .unwrap()
                .contains("failed to get alert snapshot manifest")
        );
    }

    #[tokio::test]
    async fn response_does_not_include_sensitive_fields() {
        let snapshot_id = ksuid();
        let (_, body) = json_response(
            get_alert_snapshot_manifest_with_lookup(
                "org1".to_string(),
                snapshot_id.to_string(),
                move |_, _| async move { Ok(Some(manifest(snapshot_id))) },
            )
            .await,
        )
        .await;
        let encoded = serde_json::to_string(&body).unwrap();

        assert!(!encoded.contains("credential"));
        assert!(!encoded.contains("signed"));
        assert!(!encoded.contains("storage_account"));
        assert!(!encoded.contains("notification"));
        assert!(!encoded.contains("deleted"));
    }
}
