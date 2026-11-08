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
use o2_enterprise::enterprise::security::ocsf::{self, OcsfPack};
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
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "Functions", "operation": "list"}))
    )
)]
pub async fn list_ocsf_packs() -> Json<OcsfPacksResponse> {
    Json(OcsfPacksResponse {
        ocsf_version: ocsf::OCSF_VERSION.to_string(),
        packs: ocsf::packs().to_vec(),
    })
}
