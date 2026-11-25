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
    extract::{Path, Query},
    response::Response,
};
use config::{
    meta::{alerts::alert::ListAlertsParams, stream::StreamType},
    utils::schema::format_stream_name,
};
use infra::db::get_orm_client_ro;
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use openobserve_core::alerts::{
    alert,
    library::{self, ExistingAlert, SuggestRequest, matcher::StreamFacts, needs::normalize},
};
#[cfg(feature = "enterprise")]
use openobserve_core::auth::UserEmail;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const DAY_MICROS: i64 = 24 * 3_600 * 1_000_000;

#[derive(Clone, Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SuggestionsQuery {
    /// `logs`, `metrics` or `traces`.
    pub stream_type: String,
    pub stream_name: String,
    /// `scheduled` (default) or `anomaly_detection`.
    #[serde(default)]
    pub alert_type: Option<String>,
    /// Library matches returned, default 4, at most 50; `counts` always covers all.
    #[serde(default)]
    pub limit: Option<usize>,
}

/// GetAlertLibrarySuggestions
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/library/suggestions",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlertLibrarySuggestions",
    summary = "Ready-made alerts for a stream",
    description = "Library alerts whose query fits the stream's schema (by the fields, labels and metrics each query reads), marked when the org already runs them, followed by built-in starters whose slots this schema can fill. Reads no values and runs no searches.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), SuggestionsQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = library::SuggestResponse),
        (status = 400, description = "Bad stream_type or alert_type", content_type = "application/json", body = ()),
        (status = 403, description = "The caller cannot read the stream or list alerts", content_type = "application/json", body = ()),
        (status = 404, description = "Unknown stream", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"}))
    )
)]
pub async fn get_suggestions(
    Path(org_id): Path<String>,
    Query(query): Query<SuggestionsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let stream_type = match query.stream_type.as_str() {
        "logs" => StreamType::Logs,
        "metrics" => StreamType::Metrics,
        "traces" => StreamType::Traces,
        _ => return MetaHttpResponse::bad_request("stream_type must be logs, metrics or traces"),
    };
    let anomaly = match query.alert_type.as_deref() {
        None | Some("scheduled") => false,
        Some("anomaly_detection") => true,
        _ => {
            return MetaHttpResponse::bad_request(
                "alert_type must be scheduled or anomaly_detection",
            );
        }
    };
    let name = format_stream_name(query.stream_name.trim().to_string());
    #[cfg(feature = "enterprise")]
    let user_id = Some(user_email.user_id.as_str());
    #[cfg(not(feature = "enterprise"))]
    let user_id: Option<&str> = None;
    #[cfg(feature = "enterprise")]
    if let Some(denied) = openobserve_core::authz::check_stream_permissions(
        &name,
        &org_id,
        &user_email.user_id,
        &stream_type,
        openobserve_core::authz::StreamPermissionResourceType::Search,
    )
    .await
    {
        return denied;
    }
    let schema = match infra::schema::get(&org_id, &name, stream_type).await {
        Ok(schema) if !schema.fields().is_empty() => schema,
        _ => return MetaHttpResponse::not_found(format!("Stream {name} not found")),
    };
    let existing = match visible_alerts(&org_id, user_id, stream_type, &name).await {
        Ok(existing) => existing,
        Err(response) => return response,
    };
    let stats = infra::cache::stats::get_stream_stats(&org_id, &name, stream_type);
    let metrics = if stream_type == StreamType::Metrics {
        db::schema::list_streams_from_cache(&org_id, StreamType::Metrics)
            .await
            .iter()
            .map(|m| normalize(m))
            .collect()
    } else {
        Default::default()
    };
    let fields: Vec<(String, arrow_schema::DataType)> = schema
        .fields()
        .iter()
        .map(|f| (f.name().to_string(), f.data_type().clone()))
        .collect();
    let request = SuggestRequest {
        facts: StreamFacts {
            stream_type,
            name: name.clone(),
            columns: fields.iter().map(|(f, _)| normalize(f)).collect(),
            fresh: stats.doc_time_max >= config::utils::time::now_micros() - DAY_MICROS,
            metrics,
        },
        fields,
        anomaly,
        limit: query
            .limit
            .unwrap_or(library::DEFAULT_LIMIT)
            .min(library::MAX_LIMIT),
        existing,
    };
    MetaHttpResponse::json(library::suggest(&request).await)
}

/// The alerts on this stream the caller can see; in RBAC, only listable folders count.
async fn visible_alerts(
    org_id: &str,
    user_id: Option<&str>,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<Vec<ExistingAlert>, Response> {
    let params = ListAlertsParams::new(org_id).for_stream(stream_type, Some(stream_name));
    #[cfg(feature = "enterprise")]
    let params = match user_id {
        Some(user_id) => match alert::listable_alert_folders(org_id, user_id).await {
            Ok(Some(folders)) if folders.is_empty() => {
                return Err(MetaHttpResponse::forbidden("Unauthorized Access"));
            }
            Ok(Some(folders)) => params.within_folders(folders),
            Ok(None) => params,
            Err(e) => return Err(e.into()),
        },
        None => params,
    };
    let conn = get_orm_client_ro().await;
    match alert::list_v2(conn, user_id, params).await {
        Ok(alerts) => Ok(alerts.iter().map(|(_, a)| ExistingAlert::of(a)).collect()),
        Err(e) => Err(e.into()),
    }
}
