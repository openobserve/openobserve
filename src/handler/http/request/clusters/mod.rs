// Copyright 2024 Zinc Labs Inc.
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

use std::io::Error;

use actix_web::{get, HttpResponse};
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use {o2_enterprise::enterprise::common::infra::config::O2_CONFIG, std::io::ErrorKind};

/// ListClusters
#[utoipa::path(
    context_path = "/api",
    tag = "Clusters",
    operation_id = "ListClusters",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HashMap<String, Vec<String>>),
    )
)]
#[get("/clusters")]
pub async fn list_clusters() -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    let clusters = if O2_CONFIG.super_cluster.enabled {
        let clusters = o2_enterprise::enterprise::super_cluster::kv::cluster::list()
            .await
            .map_err(|e| Error::new(ErrorKind::Other, e))?;
        let mut regions = HashMap::with_capacity(clusters.len());
        for c in clusters {
            let region: &mut Vec<_> = regions.entry(c.region).or_insert_with(Vec::new);
            region.push(c.name);
        }
        regions
    } else {
        HashMap::new()
    };
    #[cfg(not(feature = "enterprise"))]
    let clusters: HashMap<String, String> = HashMap::new();
    Ok(HttpResponse::Ok().json(clusters))
}
