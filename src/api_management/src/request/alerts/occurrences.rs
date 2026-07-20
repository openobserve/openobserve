// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{future::Future, str::FromStr};

use axum::{
    extract::{Path, Query},
    response::Response,
};
use openobserve_core::alerts::occurrences::{
    self, AlertOccurrenceSummary, AlertOccurrenceView, DEFAULT_OCCURRENCE_LIST_LIMIT,
    MAX_OCCURRENCE_LIST_LIMIT,
};
use serde::Deserialize;
use svix_ksuid::Ksuid;
use utoipa::{IntoParams, ToSchema};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::alerts::responses::{AlertOccurrenceResponseBody, ListAlertOccurrencesResponseBody},
};

#[derive(Clone, Debug, Deserialize, IntoParams, ToSchema)]
pub struct ListAlertOccurrencesQuery {
    #[serde(default = "default_limit")]
    pub limit: u64,
    #[serde(default)]
    pub offset: u64,
}

fn default_limit() -> u64 {
    DEFAULT_OCCURRENCE_LIST_LIMIT
}

/// ListAlertOccurrences
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/occurrences",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlertOccurrences",
    summary = "List alert occurrences",
    description = "Lists bounded audit records for scheduled alert occurrences. The records explain why an alert fired and do not provide full evaluation reconstruction.",
    security(("Authorization"= [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ListAlertOccurrencesQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(ListAlertOccurrencesResponseBody)),
        (status = 400, description = "Bad Request", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List bounded scheduled alert occurrence audit records", "category": "alerts"}))
    )
)]
pub async fn list_alert_occurrences(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(query): Query<ListAlertOccurrencesQuery>,
) -> Response {
    list_alert_occurrences_with_lookup(
        org_id,
        alert_id,
        query,
        |org_id, alert_id, limit, offset| async move {
            occurrences::list_occurrence_summaries(&org_id, alert_id, limit, offset).await
        },
    )
    .await
}

async fn list_alert_occurrences_with_lookup<F, Fut>(
    org_id: String,
    alert_id: String,
    query: ListAlertOccurrencesQuery,
    lookup: F,
) -> Response
where
    F: FnOnce(String, Ksuid, u64, u64) -> Fut,
    Fut: Future<Output = anyhow::Result<Vec<AlertOccurrenceSummary>>>,
{
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => return MetaHttpResponse::bad_request("invalid alert id"),
    };
    let limit = occurrences::clamp_list_limit(query.limit);
    let offset = query.offset;

    match lookup(org_id, alert_id, limit, offset).await {
        Ok(occurrences) => MetaHttpResponse::json(ListAlertOccurrencesResponseBody {
            limit,
            offset,
            max_limit: MAX_OCCURRENCE_LIST_LIMIT,
            occurrences: occurrences.into_iter().map(Into::into).collect(),
        }),
        Err(e) => {
            MetaHttpResponse::internal_error(format!("failed to list alert occurrences: {e}"))
        }
    }
}

/// GetAlertOccurrence
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/occurrences/{occurrence_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlertOccurrence",
    summary = "Get alert occurrence",
    description = "Retrieves a bounded scheduled alert occurrence audit record. The record does not provide full evaluation reconstruction.",
    security(("Authorization"= [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("occurrence_id" = String, Path, description = "Alert occurrence ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(AlertOccurrenceResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get bounded scheduled alert occurrence audit record by ID", "category": "alerts"}))
    )
)]
pub async fn get_alert_occurrence(
    Path((org_id, occurrence_id)): Path<(String, String)>,
) -> Response {
    get_alert_occurrence_with_lookup(org_id, occurrence_id, |org_id, occurrence_id| async move {
        occurrences::get_occurrence_view(&org_id, occurrence_id).await
    })
    .await
}

async fn get_alert_occurrence_with_lookup<F, Fut>(
    org_id: String,
    occurrence_id: String,
    lookup: F,
) -> Response
where
    F: FnOnce(String, Ksuid) -> Fut,
    Fut: Future<Output = anyhow::Result<Option<AlertOccurrenceView>>>,
{
    let occurrence_id_str = occurrence_id.clone();
    let occurrence_id = match Ksuid::from_str(&occurrence_id) {
        Ok(id) => id,
        Err(_) => return MetaHttpResponse::not_found("invalid alert occurrence id"),
    };

    match lookup(org_id, occurrence_id).await {
        Ok(Some(occurrence)) => {
            MetaHttpResponse::json(AlertOccurrenceResponseBody::from(occurrence))
        }
        Ok(None) => {
            MetaHttpResponse::not_found(format!("alert occurrence {occurrence_id_str} not found"))
        }
        Err(e) => MetaHttpResponse::internal_error(format!("failed to get alert occurrence: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode};
    use serde_json::Value;

    use super::*;

    fn ksuid() -> Ksuid {
        Ksuid::from_str("2XQ4VYiGLnsBUbQ1uJ2ldokUULN").unwrap()
    }

    fn alert_id() -> Ksuid {
        Ksuid::from_str("2XQ4VdD2xcWd1FJV6m2ndOg7qxp").unwrap()
    }

    fn occurrence(occurrence_id: Ksuid) -> AlertOccurrenceView {
        AlertOccurrenceView {
            occurrence_id,
            org_id: "org1".to_string(),
            alert_id: alert_id(),
            alert_name: Some("error_rate".to_string()),
            alert_updated_at: Some(1000),
            config_hash: "md5:abc".to_string(),
            window_start: 10,
            window_end: 20,
            trigger_timestamp: 20,
            query_type: "sql".to_string(),
            condition_operator: ">=".to_string(),
            threshold_value: Some(3),
            matched_count: 4,
            result_preview: occurrences::AlertOccurrenceResultPreview {
                matched_count: 4,
                rows: vec![serde_json::json!({"count": 4})],
                truncated: false,
                max_rows: 10,
                max_bytes: 65536,
            },
            query_took: Some(15),
            trace_id: Some("scheduler/query".to_string()),
            created_at: 21,
            schema_version: 1,
        }
    }

    fn summary(occurrence_id: Ksuid) -> AlertOccurrenceSummary {
        let detail = occurrence(occurrence_id);
        AlertOccurrenceSummary {
            occurrence_id: detail.occurrence_id,
            org_id: detail.org_id,
            alert_id: detail.alert_id,
            alert_name: detail.alert_name,
            alert_updated_at: detail.alert_updated_at,
            config_hash: detail.config_hash,
            window_start: detail.window_start,
            window_end: detail.window_end,
            trigger_timestamp: detail.trigger_timestamp,
            query_type: detail.query_type,
            condition_operator: detail.condition_operator,
            threshold_value: detail.threshold_value,
            matched_count: detail.matched_count,
            result_truncated: false,
            trace_id: detail.trace_id,
            created_at: detail.created_at,
            schema_version: detail.schema_version,
        }
    }

    async fn json_response(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        (status, value)
    }

    #[tokio::test]
    async fn gets_occurrence_successfully() {
        let occurrence_id = ksuid();
        let (status, body) = json_response(
            get_alert_occurrence_with_lookup(
                "org1".to_string(),
                occurrence_id.to_string(),
                move |org_id, requested_id| async move {
                    assert_eq!(org_id, "org1");
                    assert_eq!(requested_id, occurrence_id);
                    Ok(Some(occurrence(occurrence_id)))
                },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["occurrence_id"], occurrence_id.to_string());
        assert_eq!(body["alert_id"], alert_id().to_string());
        assert_eq!(body["matched_count"], 4);
        assert_eq!(body["result_preview"]["rows"][0]["count"], 4);
    }

    #[tokio::test]
    async fn missing_occurrence_returns_not_found() {
        let occurrence_id = ksuid();
        let (status, _) = json_response(
            get_alert_occurrence_with_lookup(
                "org1".to_string(),
                occurrence_id.to_string(),
                |_, _| async { Ok(None) },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn lists_occurrences_with_clamped_limit() {
        let occurrence_id = ksuid();
        let (status, body) = json_response(
            list_alert_occurrences_with_lookup(
                "org1".to_string(),
                alert_id().to_string(),
                ListAlertOccurrencesQuery {
                    limit: 500,
                    offset: 5,
                },
                move |org_id, requested_alert_id, limit, offset| async move {
                    assert_eq!(org_id, "org1");
                    assert_eq!(requested_alert_id, alert_id());
                    assert_eq!(limit, MAX_OCCURRENCE_LIST_LIMIT);
                    assert_eq!(offset, 5);
                    Ok(vec![summary(occurrence_id)])
                },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["limit"], MAX_OCCURRENCE_LIST_LIMIT);
        assert_eq!(body["offset"], 5);
        assert_eq!(
            body["occurrences"][0]["occurrence_id"],
            occurrence_id.to_string()
        );
        assert!(body["occurrences"][0].get("result_preview").is_none());
    }

    #[tokio::test]
    async fn malformed_alert_id_returns_bad_request() {
        let (status, _) = json_response(
            list_alert_occurrences_with_lookup(
                "org1".to_string(),
                "not-a-ksuid".to_string(),
                ListAlertOccurrencesQuery {
                    limit: 10,
                    offset: 0,
                },
                |_, _, _, _| async { Ok(vec![]) },
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
}
