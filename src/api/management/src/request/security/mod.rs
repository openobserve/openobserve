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

use axum::Json;
use openobserve_builtins::ocsf::{self, OcsfPack};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct OcsfPacksResponse {
    pub ocsf_version: String,
    pub packs: Vec<OcsfPack>,
}

/// ListOcsfPacks
#[utoipa::path(
    get,
    path = "/{org_id}/security/ocsf/packs",
    context_path = "/api",
    tag = "Security",
    operation_id = "ListOcsfPacks",
    summary = "List the built-in OCSF mapping packs",
    description = "The OCSF version and every pack compiled into this build, with its VRL program; holds no org data",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = OcsfPacksResponse),
    ),
)]
pub async fn list_ocsf_packs() -> Json<OcsfPacksResponse> {
    Json(OcsfPacksResponse {
        ocsf_version: ocsf::OCSF_VERSION.to_string(),
        packs: ocsf::packs().to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};

    use super::*;

    #[tokio::test]
    async fn test_list_ocsf_packs_returns_the_version_and_every_pack() {
        let response = list_ocsf_packs().await.into_response();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["ocsf_version"], "1.6.0");
        let packs = body["packs"].as_array().unwrap();
        assert_eq!(packs.len(), ocsf::packs().len());
        let entity = packs.iter().find(|p| p["id"] == "entity").unwrap();
        let mut keys = entity
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        keys.sort();
        assert_eq!(
            keys,
            [
                "id",
                "kind",
                "label",
                "ocsf_classes",
                "product_name",
                "requires_all",
                "source_type",
                "vendor_name",
                "version",
                "vrl"
            ]
        );
        assert_eq!(entity["kind"], "entity");
        assert_eq!(entity["version"], 1);
        assert!(entity["vrl"].as_str().unwrap().ends_with("\n."));
    }
}
