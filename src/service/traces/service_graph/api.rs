// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpResponse, web};
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use {
    config::utils::json,
    prometheus::{Encoder, TextEncoder},
};

/// Query parameters for service graph API
#[derive(Debug, Deserialize)]
pub struct ServiceGraphQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub filter: Option<String>,
}

/// GetServiceGraphMetrics
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/metrics",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetServiceGraphMetrics",
    summary = "Get service graph metrics",
    description = "Retrieves Prometheus-formatted metrics for the service graph. Returns metrics filtered by organization to ensure multi-tenant isolation. Service graph metrics provide insights into service-to-service communication patterns, request rates, and latencies.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "text/plain; version=0.0.4", body = String, example = json!("# HELP traces_service_graph_request_total Total number of requests between services\n# TYPE traces_service_graph_request_total counter\ntraces_service_graph_request_total{client=\"service-a\",org_id=\"default\",server=\"service-b\"} 42\n")),
        (status = 403, description = "Forbidden - Enterprise feature", content_type = "application/json", body = String),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "service_graph_metrics"}))
    )
)]
#[actix_web::get("/{org_id}/traces/service_graph/metrics")]
#[cfg(feature = "enterprise")]
pub async fn get_service_graph_metrics(
    org_id: web::Path<String>,
) -> Result<HttpResponse, actix_web::Error> {
    let metric_families = prometheus::gather();
    let encoder = TextEncoder::new();
    let mut buffer = vec![];

    // Filter metrics to only include those matching the requested org_id
    let filtered_families: Vec<_> = metric_families
        .into_iter()
        .filter_map(|mut family| {
            // Filter out metrics that don't belong to this org
            let filtered_metrics: Vec<_> = family
                .take_metric()
                .into_iter()
                .filter(|metric| {
                    // Check if metric has org_id label matching the requested org
                    metric
                        .get_label()
                        .iter()
                        .any(|label| label.name() == "org_id" && label.value() == org_id.as_str())
                })
                .collect();

            if filtered_metrics.is_empty() {
                None
            } else {
                family.set_metric(filtered_metrics);
                Some(family)
            }
        })
        .collect();

    encoder.encode(&filtered_families, &mut buffer).unwrap();

    Ok(HttpResponse::Ok()
        .content_type("text/plain; version=0.0.4")
        .body(buffer))
}

/// GetServiceGraphMetrics
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/metrics",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetServiceGraphMetrics",
    summary = "Get service graph metrics",
    description = "Retrieves Prometheus-formatted metrics for the service graph. Returns metrics filtered by organization to ensure multi-tenant isolation. Service graph metrics provide insights into service-to-service communication patterns, request rates, and latencies.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "text/plain; version=0.0.4", body = String, example = json!("# HELP traces_service_graph_request_total Total number of requests between services\n# TYPE traces_service_graph_request_total counter\ntraces_service_graph_request_total{client=\"service-a\",org_id=\"default\",server=\"service-b\"} 42\n")),
        (status = 403, description = "Forbidden - Enterprise feature", content_type = "application/json", body = String),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "service_graph_metrics"}))
    )
)]
#[actix_web::get("/{org_id}/traces/service_graph/metrics")]
#[cfg(not(feature = "enterprise"))]
pub async fn get_service_graph_metrics(
    _org_id: web::Path<String>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

/// GetServiceGraphStats
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/stats",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetServiceGraphStats",
    summary = "Get service graph store statistics",
    description = "Retrieves internal statistics about the service graph store for an organization. Returns information about store size, capacity utilization, shard count, and configuration. Useful for monitoring and capacity planning of the service graph storage.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "enabled": true,
            "store_size": 1234,
            "capacity_utilization_percent": 12.5,
            "shard_count": 16,
            "config": {
                "max_items_per_shard": 10000,
                "total_capacity": 160000,
                "wait_duration_ms": 1000
            }
        })),
        (status = 403, description = "Forbidden - Enterprise feature", content_type = "application/json", body = String),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "service_graph_stats"}))
    )
)]
#[actix_web::get("/{org_id}/traces/service_graph/stats")]
#[cfg(feature = "enterprise")]
pub async fn get_store_stats(org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    let store = o2_enterprise::enterprise::service_graph::get_store();
    let org_sizes = store.get_org_sizes();
    let org_capacities = store.get_org_capacity_utilization();

    // Get stats for the requested org only
    let org_store_size = org_sizes.get(org_id.as_str()).copied().unwrap_or(0);
    let org_capacity_util = org_capacities.get(org_id.as_str()).copied().unwrap_or(0.0);

    let stats = json::json!({
        "enabled": config::get_config().service_graph.enabled,
        "store_size": org_store_size,
        "capacity_utilization_percent": org_capacity_util,
        "shard_count": store.shard_count(),
        "config": {
            "max_items_per_shard": store.config().max_items_per_shard,
            "total_capacity": store.config().max_items_per_shard * store.shard_count(),
            "wait_duration_ms": store.config().wait_duration.as_millis(),
        }
    });

    Ok(HttpResponse::Ok().json(stats))
}

/// GetServiceGraphStats
#[utoipa::path(
    get,
    path = "/{org_id}/traces/service_graph/stats",
    context_path = "/api",
    tag = "Traces",
    operation_id = "GetServiceGraphStats",
    summary = "Get service graph store statistics",
    description = "Retrieves internal statistics about the service graph store for an organization. Returns information about store size, capacity utilization, shard count, and configuration. Useful for monitoring and capacity planning of the service graph storage.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({
            "enabled": true,
            "store_size": 1234,
            "capacity_utilization_percent": 12.5,
            "shard_count": 16,
            "config": {
                "max_items_per_shard": 10000,
                "total_capacity": 160000,
                "wait_duration_ms": 1000
            }
        })),
        (status = 403, description = "Forbidden - Enterprise feature", content_type = "application/json", body = String),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Traces", "operation": "service_graph_stats"}))
    )
)]
#[actix_web::get("/{org_id}/traces/service_graph/stats")]
#[cfg(not(feature = "enterprise"))]
pub async fn get_store_stats(_org_id: web::Path<String>) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}
