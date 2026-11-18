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

//! Starter Packs catalog endpoint (Enterprise feature).

use axum::{extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use {
    axum::{Json, http::header, response::IntoResponse},
    o2_enterprise::enterprise::starter_packs::catalog::STARTER_PACKS_DEFAULTS,
};

/// The Starter Packs catalog as served to the web app.
#[cfg(feature = "enterprise")]
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct StarterPackCatalog {
    pub catalog_version: String,
    pub source: CatalogSource,
    pub packs: Vec<serde_json::Value>,
}

/// Where the served catalog came from.
#[cfg(feature = "enterprise")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum CatalogSource {
    Remote,
    Seed,
}

/// Get the Starter Packs catalog
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/{org_id}/starter_packs/catalog",
    context_path = "/api",
    tag = "Starter Packs",
    operation_id = "GetStarterPacksCatalog",
    summary = "Get the Starter Packs catalog",
    description = "Returns the packs offered on the Starter Packs page. `source` is `seed` until the server has downloaded the published catalog.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = StarterPackCatalog),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Starter Packs", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_catalog(_org_id: Path<String>) -> Response {
    let catalog = STARTER_PACKS_DEFAULTS.get();
    let body = StarterPackCatalog {
        catalog_version: catalog.catalog_version.clone(),
        source: if catalog.from_seed {
            CatalogSource::Seed
        } else {
            CatalogSource::Remote
        },
        packs: catalog.packs.clone(),
    };
    (
        [(header::CACHE_CONTROL, "private, max-age=300")],
        Json(body),
    )
        .into_response()
}

/// Get the Starter Packs catalog (OSS - Not Supported)
#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/starter_packs/catalog",
    context_path = "/api",
    tag = "Starter Packs",
    operation_id = "GetStarterPacksCatalog",
    summary = "Get the Starter Packs catalog",
    description = "Starter Packs are an Enterprise feature; this build always answers 403.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 403, description = "Forbidden - Enterprise feature"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Starter Packs", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_catalog(_org_id: Path<String>) -> Response {
    axum::response::Response::builder()
        .status(axum::http::StatusCode::FORBIDDEN)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            "\"Enterprise feature not available\"",
        ))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn oss_build_answers_403() {
        let resp = get_catalog(Path("default".to_string())).await;
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn enterprise_build_serves_the_seed_before_any_fetch() {
        let resp = get_catalog(Path("default".to_string())).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "private, max-age=300"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["source"], "seed");
        assert_eq!(body["packs"].as_array().unwrap().len(), 2);
    }
}
