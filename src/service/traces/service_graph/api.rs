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
use config::utils::json;
use prometheus::{Encoder, TextEncoder};
use serde::Deserialize;

/// Query parameters for service graph API
#[derive(Debug, Deserialize)]
pub struct ServiceGraphQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub filter: Option<String>,
}

/// Handler for service graph metrics endpoint (Prometheus format)
///
/// Returns Prometheus metrics filtered by org_id.
/// Metrics are filtered by the `org_id` label to ensure multi-tenant isolation.
#[actix_web::get("/{org_id}/traces/service_graph/metrics")]
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

/// Get service graph store statistics
///
/// Returns statistics filtered by org_id to ensure multi-tenant isolation.
#[actix_web::get("/{org_id}/traces/service_graph/stats")]
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
