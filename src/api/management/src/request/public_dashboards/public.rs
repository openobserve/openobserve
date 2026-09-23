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

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::{
    meta::{
        dashboards::Dashboard,
        public_dashboards::{SanitizedDashboard, TimeRangePolicy},
    },
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_ro,
    table::{dashboards, entity::public_dashboards::Model, public_dashboards as table},
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct DataParams {
    preset: i64,
}

enum Servable {
    NotFound,
    Unavailable,
    Ok(Box<Model>),
}

/// Resolve a slug to a servable share record, or a reason it is not served.
/// Unknown / draft / disabled → uniform 404 (no existence oracle); expired /
/// org-suspended → neutral "unavailable".
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
    if pd.visibility != 1 || !pd.enabled {
        return Servable::NotFound;
    }
    if let Some(exp) = pd.expires_at
        && exp <= now_micros()
    {
        return Servable::Unavailable;
    }
    // TODO(R14): the public plane carries no `blocked_orgs_middleware`, so a
    // suspended/blocked org must be rejected here → Servable::Unavailable.
    Servable::Ok(Box::new(pd))
}

/// GET /api/public_dashboards/{slug} — the sanitized config the viewer renders.
pub async fn config(Path(slug): Path<String>) -> Response {
    let pd = match resolve(&slug).await {
        Servable::Ok(pd) => pd,
        Servable::Unavailable => return unavailable(),
        Servable::NotFound => return StatusCode::NOT_FOUND.into_response(),
    };
    let conn = get_orm_client_ro().await;
    let Ok(Some((_folder, dash))) = dashboards::get_by_id(&pd.org_id, &pd.dashboard_id).await
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (title, layout) = project_layout(&dash);
    let available_presets = table::list_snapshot_presets(conn, &pd.id)
        .await
        .unwrap_or_default();
    Json(SanitizedDashboard {
        title,
        layout,
        time_range: time_policy(&pd),
        available_presets,
        built_at: pd.last_rebuilt_at,
        timestamp_column: config::TIMESTAMP_COL_NAME.to_string(),
        refresh_secs: i64::from(pd.rebuild_secs),
    })
    .into_response()
}

/// GET /api/public_dashboards/{slug}/data?preset= — point-read one snapshot.
pub async fn data(Path(slug): Path<String>, Query(params): Query<DataParams>) -> Response {
    let pd = match resolve(&slug).await {
        Servable::Ok(pd) => pd,
        Servable::Unavailable => return unavailable(),
        Servable::NotFound => return StatusCode::NOT_FOUND.into_response(),
    };
    let conn = get_orm_client_ro().await;
    match table::get_snapshot(conn, &pd.id, params.preset).await {
        Ok(Some(snap)) => match serde_json::from_str::<serde_json::Value>(&snap.data) {
            Ok(v) => Json(v).into_response(),
            Err(_) => (StatusCode::ACCEPTED, "preparing").into_response(),
        },
        Ok(None) => (StatusCode::ACCEPTED, "preparing").into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "This dashboard is currently unavailable.",
    )
        .into_response()
}

fn time_policy(pd: &Model) -> TimeRangePolicy {
    TimeRangePolicy {
        editable: pd.time_range_editable,
        default_range_secs: pd.default_range_secs,
        allowed_presets_secs: pd
            .allowed_presets_secs
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default(),
    }
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
}
