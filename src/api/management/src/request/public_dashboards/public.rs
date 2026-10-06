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

//! The public serving plane. Registered in `basic_routes` — no auth middleware,
//! no OpenFGA. Contract: nothing here runs a query or hits the search engine;
//! it does indexed point-reads against the meta store only. All query execution
//! lives in the background rebuilder.

use std::{
    sync::{LazyLock, RwLock},
    time::Duration,
};

use axum::{
    Json,
    extract::{Extension, Path, Query},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    axum::middlewares::RealIp,
    meta::{
        dashboards::Dashboard,
        public_dashboards::{KeyedRange, PublicVariable, SanitizedDashboard},
    },
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_ro,
    table::{dashboards, entity::public_dashboards::Model, public_dashboards as table},
};
use serde::Deserialize;

use crate::request::public_rate_limit::{Counters, client_ip, over_budget};

const READ_WINDOW: Duration = Duration::from_secs(60);

/// Per-IP read counters for both public dashboard routes.
static READ_RPM: LazyLock<Counters> = LazyLock::new(|| RwLock::new(Default::default()));

#[derive(Deserialize)]
pub struct DataParams {
    range: String,
}

enum Servable {
    NotFound,
    Unavailable,
    Expired,
    Ok(Box<Model>),
}

/// Resolve a slug to a servable link, or why it isn't served: unknown / draft → uniform 404
/// (no existence oracle); paused → 503; expired → 410. Only a slug holder sees the latter two.
async fn resolve(slug: &str) -> Servable {
    if !config::get_config().public_dashboards.enabled {
        return Servable::NotFound;
    }
    let conn = get_orm_client_ro().await;
    let pd = match table::get_by_slug(conn, slug).await {
        Ok(Some(pd)) => pd,
        _ => return Servable::NotFound,
    };
    // visibility: 0 draft, 1 public.
    if pd.visibility != 1 {
        return Servable::NotFound;
    }
    if db::org_status::is_blocked(&pd.org_id) {
        return Servable::Unavailable;
    }
    if pd.expires_at.is_some_and(|exp| exp <= now_micros()) {
        return Servable::Expired;
    }
    if !pd.enabled {
        return Servable::Unavailable;
    }
    Servable::Ok(Box::new(pd))
}

/// GET /api/public_dashboards/{slug} — the sanitized config the viewer renders.
pub async fn config(ip: Option<Extension<RealIp>>, Path(slug): Path<String>) -> Response {
    if rate_limited(ip.map(|e| e.0)) {
        return with_headers(too_many_requests());
    }
    with_headers(serve_config(&slug).await)
}

/// GET /api/public_dashboards/{slug}/data?range= — point-read one range's snapshot.
pub async fn data(
    ip: Option<Extension<RealIp>>,
    Path(slug): Path<String>,
    Query(params): Query<DataParams>,
) -> Response {
    if rate_limited(ip.map(|e| e.0)) {
        return with_headers(too_many_requests());
    }
    with_headers(serve_data(&slug, &params.range).await)
}

async fn serve_config(slug: &str) -> Response {
    let pd = match resolve(slug).await {
        Servable::Ok(pd) => pd,
        Servable::Unavailable => return unavailable(),
        Servable::Expired => return expired(),
        Servable::NotFound => return StatusCode::NOT_FOUND.into_response(),
    };
    let conn = get_orm_client_ro().await;
    let Ok(Some((_folder, dash))) = dashboards::get_by_id(&pd.org_id, &pd.dashboard_id).await
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (title, layout) = project_layout(&dash);
    let available_keys = table::list_snapshot_keys(conn, &pd.id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(key, _)| key)
        .collect();
    let policy = openobserve_core::public_dashboards::time_ranges(&pd);
    Json(SanitizedDashboard {
        title,
        layout,
        ranges: policy
            .ranges
            .iter()
            .map(|range| KeyedRange {
                key: range.key(),
                range: *range,
            })
            .collect(),
        default_key: policy.default.key(),
        available_keys,
        built_at: pd.last_rebuilt_at,
        timestamp_column: config::TIMESTAMP_COL_NAME.to_string(),
        refresh_secs: i64::from(pd.rebuild_secs),
        variables: public_variables(&dash, pd.frozen_variables.as_deref()),
    })
    .into_response()
}

async fn serve_data(slug: &str, range_key: &str) -> Response {
    let pd = match resolve(slug).await {
        Servable::Ok(pd) => pd,
        Servable::Unavailable => return unavailable(),
        Servable::Expired => return expired(),
        Servable::NotFound => return StatusCode::NOT_FOUND.into_response(),
    };
    let conn = get_orm_client_ro().await;
    match table::get_snapshot(conn, &pd.id, range_key).await {
        Ok(Some(snap)) => match serde_json::from_str::<serde_json::Value>(&snap.data) {
            Ok(v) => Json(v).into_response(),
            Err(_) => (StatusCode::ACCEPTED, "preparing").into_response(),
        },
        Ok(None) => (StatusCode::ACCEPTED, "preparing").into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Visible variables with their frozen values; one missing from the capture shows as null.
fn public_variables(dash: &Dashboard, frozen: Option<&str>) -> Vec<PublicVariable> {
    let frozen: std::collections::BTreeMap<String, serde_json::Value> = frozen
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let Some(list) = dash.v8.as_ref().and_then(|v8| v8.variables.as_ref()) else {
        return vec![];
    };
    list.list
        .iter()
        .filter(|v| v.hide_on_dashboard != Some(true))
        .map(|v| PublicVariable {
            label: if v.label.is_empty() {
                v.name.clone()
            } else {
                v.label.clone()
            },
            value: frozen
                .get(&v.name)
                .cloned()
                .unwrap_or(serde_json::Value::Null),
        })
        .collect()
}

/// True if this IP is over its per-minute budget; 0 rpm disables the limiter.
fn rate_limited(ip: Option<RealIp>) -> bool {
    let rpm = u32::try_from(config::get_config().public_dashboards.rpm).unwrap_or(u32::MAX);
    rpm != 0 && over_budget(&READ_RPM, client_ip(ip), READ_WINDOW, rpm)
}

/// The slug is a bearer secret, so no response is indexed or leaks it through `Referer`.
fn with_headers(mut resp: Response) -> Response {
    let headers = resp.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "x-robots-tag",
        HeaderValue::from_static("noindex, nofollow"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    resp
}

fn too_many_requests() -> Response {
    (StatusCode::TOO_MANY_REQUESTS, "Too many requests").into_response()
}

fn expired() -> Response {
    (StatusCode::GONE, "expired").into_response()
}

fn unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "This dashboard is currently unavailable.",
    )
        .into_response()
}

/// Project a viewer-safe layout from the dashboard: v8 tabs/panels with query
/// text and stream names stripped. (v8 only in this cut.)
fn project_layout(dash: &Dashboard) -> (String, serde_json::Value) {
    let Some(v8) = dash.v8.as_ref() else {
        return (String::new(), serde_json::Value::Null);
    };
    let mut layout = serde_json::to_value(&v8.tabs).unwrap_or(serde_json::Value::Null);
    strip_secrets(&mut layout);
    (v8.title.clone(), layout)
}

/// Recursively drop keys that would leak SQL/PromQL, filter predicates, or
/// stream internals. Data is pre-materialized, so none of these are needed to
/// render; every one of them can carry author-authored query text or literals.
fn strip_secrets(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(map) => {
            for key in [
                "query",
                "vrlFunctionQuery",
                "vrl_function_query",
                "sql",
                "stream",
                "rawQuery",
                "raw_query",
                "filter",
                "havingConditions",
                "having_conditions",
                "promqlLabels",
                "promql_labels",
                "promqlOperations",
                "promql_operations",
                "customChartContent",
                "custom_chart_content",
            ] {
                map.remove(key);
            }
            for val in map.values_mut() {
                strip_secrets(val);
            }
        }
        serde_json::Value::Array(arr) => {
            for val in arr.iter_mut() {
                strip_secrets(val);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_secrets_removes_query_sql_stream_at_every_level() {
        let mut v = serde_json::json!({
            "title": "keep me",
            "query": "select * from top",
            "sql": "select 1",
            "stream": "top_stream",
            "vrlFunctionQuery": "vrl_a",
            "vrl_function_query": "vrl_b",
            "tabs": [{
                "panels": [{
                    "id": "p1",
                    "query": "select * from leak",
                    "queries": [{
                        "stream": "secret_stream",
                        "fields": {
                            "stream": "nested_stream",
                            "x": [{ "alias": "x_axis", "rawQuery": "SELECT secret_col FROM s" }],
                            "filter": { "conditions": [{ "column": "cust_id", "value": "acme-secret-123" }] }
                        }
                    }]
                }]
            }]
        });
        strip_secrets(&mut v);
        let s = serde_json::to_string(&v).unwrap();
        // Every query/sql/stream/filter value must be gone, at all nesting levels.
        assert!(!s.contains("select") && !s.contains("SELECT"), "{s}");
        assert!(!s.contains("secret_col"), "{s}");
        assert!(!s.contains("top_stream"), "{s}");
        assert!(!s.contains("secret_stream"), "{s}");
        assert!(!s.contains("nested_stream"), "{s}");
        assert!(
            !s.contains("cust_id") && !s.contains("acme-secret-123"),
            "{s}"
        );
        assert!(!s.contains("vrl_a") && !s.contains("vrl_b"), "{s}");
        let mut chart = serde_json::json!({ "panels": [{ "customChartContent": "alert(1)" }] });
        strip_secrets(&mut chart);
        assert!(!chart.to_string().contains("alert(1)"));
        // Non-secret render structure is preserved.
        assert!(s.contains("keep me"), "{s}");
        assert!(s.contains("\"id\":\"p1\""), "{s}");
        assert!(s.contains("x_axis"), "{s}");
    }

    #[test]
    fn strip_secrets_is_a_noop_on_scalars() {
        let mut v = serde_json::json!("plain");
        strip_secrets(&mut v);
        assert_eq!(v, serde_json::json!("plain"));
    }

    #[test]
    fn every_public_response_carries_the_privacy_headers() {
        let resp = with_headers(StatusCode::NOT_FOUND.into_response());
        let h = resp.headers();
        assert_eq!(h[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(h["x-robots-tag"], "noindex, nofollow");
        assert_eq!(h[header::REFERRER_POLICY], "no-referrer");
    }
}
