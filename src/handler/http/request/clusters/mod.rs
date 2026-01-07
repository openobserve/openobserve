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

use axum::response::Response;
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use {
    config::meta::cluster::RoleGroup,
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// ListClusters
#[utoipa::path(
    get,
    path = "/clusters",
    context_path = "/api",
    tag = "Clusters",
    operation_id = "ListClusters",
    summary = "List available clusters",
    description = "Retrieves a list of all available clusters organized by region. Each region contains a list of cluster names \
                   that can be used for data processing and storage. This information is useful for understanding your \
                   deployment topology and selecting appropriate clusters for workload distribution.",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(HashMap<String, Vec<String>>)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Clusters", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_clusters() -> Response {
    #[cfg(feature = "enterprise")]
    let clusters = if get_o2_config().super_cluster.enabled {
        match o2_enterprise::enterprise::super_cluster::kv::cluster::list_by_role_group(Some(
            RoleGroup::Interactive,
        ))
        .await
        {
            Ok(clusters) => {
                let mut regions = HashMap::with_capacity(clusters.len());
                for c in clusters {
                    let region: &mut Vec<_> = regions.entry(c.region).or_insert_with(Vec::new);
                    region.push(c.name);
                }
                regions
            }
            Err(e) => {
                return MetaHttpResponse::internal_error(e);
            }
        }
    } else {
        HashMap::new()
    };
    #[cfg(not(feature = "enterprise"))]
    let clusters: HashMap<String, Vec<String>> = HashMap::new();
    MetaHttpResponse::json(clusters)
}
