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

//! Fleet Manager: every permission is an OpenFGA check, as on dashboards, and never a role.

#[cfg(feature = "enterprise")]
use std::collections::HashSet;

use axum::{
    extract::{Path, Query},
    response::Response,
};
#[cfg(feature = "enterprise")]
use axum::{http::StatusCode, response::IntoResponse};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::meta::fleet::{
    AuditQuery, CollectorsQuery, CreateConfigRequest, CreateTokenRequest, FleetSettings, FlowQuery,
    MoveCollectorsRequest, MoveQuery, PublishRequest, SaveDraftRequest, SetDesiredRequest,
    ValidateRequest,
};
#[cfg(feature = "enterprise")]
use config::meta::folder::FolderType;
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use openobserve_api_common::extractors::ValidatedJson;

#[cfg(feature = "enterprise")]
use crate::service::auth::{UserEmail, check_permissions};

#[cfg(feature = "enterprise")]
const FLEET: &str = "fleet";
#[cfg(feature = "enterprise")]
const FLEETS: &str = "fleets";

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/collectors",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetCollectors",
    summary = "List the org's OpAMP collectors, or one fleet's",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), CollectorsQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::CollectorList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_collectors(
    Path(org_id): Path<String>,
    Query(query): Query<CollectorsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        let permitted = match permitted_fleets(&org_id, user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let fleets = match query.folder {
            None => permitted,
            Some(fleet) => Some(in_fleet(&org_id, user_id, fleet, permitted).await),
        };
        match o2_enterprise::enterprise::fleet::service::list_collectors(&org_id, fleets.as_ref())
            .await
        {
            Ok(list) => MetaHttpResponse::json(list),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, query);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/collectors/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetCollector",
    summary = "Get one OpAMP collector",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Collector instance UID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::CollectorDetail),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_collector(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::service::get_collector(&org_id, &id).await {
            Ok(collector) => {
                match fleet_read(&org_id, user_id, &collector.collector.fleet.id).await {
                    Some(refused) => refused,
                    None => MetaHttpResponse::json(collector),
                }
            }
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/summary",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetSummary",
    summary = "Collector counts by status and version",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::FleetSummary),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn summary(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, &user_email.user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        match o2_enterprise::enterprise::fleet::service::summary(&org_id, permitted.as_ref()).await
        {
            Ok(summary) => MetaHttpResponse::json(summary),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/fleets",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleets",
    summary = "The fleets, each with its desired and stable versions where readable",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::FleetList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_fleets(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use config::meta::fleet::FleetList;

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        // The shared folder list decides which fleets show, exactly as for dashboards.
        let listed =
            match db::folders::list_folders(&org_id, Some(user_id), FolderType::Fleets).await {
                Ok(listed) => listed,
                Err(e) => return MetaHttpResponse::forbidden(e),
            };
        let states = match o2_enterprise::enterprise::fleet::fleets::list_fleets(&org_id).await {
            Ok(states) => states,
            Err(e) => return to_response(e),
        };
        let mut readable = HashSet::new();
        for fleet in &listed {
            if fleet_read(&org_id, user_id, &fleet.folder_id)
                .await
                .is_none()
            {
                readable.insert(fleet.folder_id.clone());
            }
        }
        let items =
            o2_enterprise::enterprise::fleet::fleets::list_items(listed, &states, &readable);
        MetaHttpResponse::json(FleetList { items })
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/fleet/fleets/{fleet_id}/desired",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "SetFleetDesired",
    summary = "Set a fleet's desired configuration version, which a new revision converges to",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    request_body(content = SetDesiredRequest, content_type = "application/json"),
    responses(
        (status = 201, description = "The new revision", content_type = "application/json", body = config::meta::fleet::Rollout),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Fleet, configuration or version not found", content_type = "application/json", body = Object),
        (status = 409, description = "A cluster upgrade is in progress, or desired keeps changing", content_type = "application/json", body = Object),
    ),
)]
pub async fn set_desired(
    Path((org_id, fleet_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if let Some(refused) = fleet_write(&org_id, user_id, &fleet_id, "PUT").await {
            return refused;
        }
        // Decoded here, not by the extractor, so an unknown field is a 400 and not a 422.
        let req = match serde_json::from_value::<SetDesiredRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        match o2_enterprise::enterprise::fleet::rollouts::set_desired(
            &org_id, user_id, &fleet_id, req,
        )
        .await
        {
            Ok(rollout) => (StatusCode::CREATED, axum::Json(rollout)).into_response(),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, fleet_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    patch,
    path = "/v2/{org_id}/fleets/move",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "MoveFleetCollectors",
    summary = "Move collectors to another fleet, which applies its stable version at once",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), MoveQuery),
    request_body(content = MoveCollectorsRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Moved", content_type = "application/json", body = config::meta::fleet::MoveCollectorsResponse),
        (status = 400, description = "Invalid, or already in the destination", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "A collector or the destination not found", content_type = "application/json", body = Object),
        (status = 409, description = "A collector moved meanwhile", content_type = "application/json", body = Object),
    ),
)]
pub async fn move_collectors(
    Path(org_id): Path<String>,
    Query(query): Query<MoveQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::fleets;

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let req = match serde_json::from_value::<MoveCollectorsRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        let found = match fleets::collector_fleets(&org_id, &req.collector_ids).await {
            Ok(found) => found,
            Err(e) => return to_response(e),
        };
        let folder = query.folder.as_deref();
        let sources = match fleets::move_sources(&found, &req.collector_ids, folder) {
            Ok(sources) => sources,
            Err(e) => return to_response(e.into()),
        };
        // The dashboards move: `PUT` on every source, then `POST` on the destination (D17).
        let distinct: HashSet<&String> = sources.values().collect();
        for fleet in distinct {
            if let Some(refused) = fleet_write(&org_id, user_id, fleet, "PUT").await {
                return refused;
            }
        }
        let dest = req.dst_folder_id.as_str();
        if let Some(refused) = fleet_write(&org_id, user_id, dest, "POST").await {
            return refused;
        }
        let mv = fleets::Move { dest, sources };
        match fleets::move_collectors(&org_id, mv).await {
            Ok(moved) => MetaHttpResponse::json(moved),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, query, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/fleet/collectors/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "UnenrollFleetCollector",
    summary = "Unenroll a collector",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Collector instance UID"),
    ),
    responses(
        (status = 204, description = "Unenrolled"),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "The collector moved meanwhile", content_type = "application/json", body = Object),
    ),
)]
pub async fn unenroll_collector(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::{fleets, service};

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let ids = [id.clone()];
        let fleet = match fleets::collector_fleets(&org_id, &ids).await {
            Ok(found) => found.get(&id).cloned(),
            Err(e) => return to_response(e),
        };
        let Some(fleet) = fleet else {
            return to_response(service::FleetError::CollectorNotFound(id).into());
        };
        if let Some(refused) = fleet_write(&org_id, user_id, &fleet, "DELETE").await {
            return refused;
        }
        match service::unenroll_collector(&org_id, &id, &fleet).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/tokens",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetTokens",
    summary = "List enrollment tokens; never returns a secret",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::TokenList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_tokens(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, &user_email.user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let fleets = permitted.as_ref();
        match o2_enterprise::enterprise::fleet::service::list_tokens(&org_id, fleets).await {
            Ok(list) => MetaHttpResponse::json(list),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/fleet/tokens",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "CreateFleetToken",
    summary = "Create an enrollment token placing collectors in a fleet; the plaintext is returned only here",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = CreateTokenRequest, content_type = "application/json"),
    responses(
        (status = 201, description = "Created", content_type = "application/json", body = config::meta::fleet::CreatedToken),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Fleet not found", content_type = "application/json", body = Object),
        (status = 409, description = "Name exists", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_token(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let req = match serde_json::from_value::<CreateTokenRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        if let Some(refused) = fleet_write(&org_id, user_id, &req.fleet, "POST").await {
            return refused;
        }
        match o2_enterprise::enterprise::fleet::service::create_token(&org_id, user_id, req).await {
            Ok(created) => (StatusCode::CREATED, axum::Json(created)).into_response(),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/fleet/tokens/{id}/revoke",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "RevokeFleetToken",
    summary = "Revoke an enrollment token and disconnect its collectors",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Token id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::EnrollmentToken),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn revoke_token(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::service;

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let fleet = match service::token_fleet(&org_id, &id).await {
            Ok(fleet) => fleet,
            Err(e) => return to_response(e),
        };
        if let Some(refused) = fleet_write(&org_id, user_id, &fleet, "PUT").await {
            return refused;
        }
        match service::revoke_token(&org_id, &id).await {
            Ok(token) => MetaHttpResponse::json(token),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/configs",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetConfigs",
    summary = "List the org's collector configurations",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::FleetConfigList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_configs(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, &user_email.user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let fleets = permitted.as_ref();
        match o2_enterprise::enterprise::fleet::configs::list_configs(&org_id, fleets).await {
            Ok(list) => MetaHttpResponse::json(list),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/fleet/configs",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "CreateFleetConfig",
    summary = "Create a configuration with its first draft",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = CreateConfigRequest, content_type = "application/json"),
    responses(
        (status = 201, description = "Created", content_type = "application/json", body = config::meta::fleet::FleetConfigDetail),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 409, description = "Id exists", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_config(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<CreateConfigRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::configs::create_config(
            &org_id,
            &user_email.user_id,
            body,
        )
        .await
        {
            Ok(detail) => (StatusCode::CREATED, axum::Json(detail)).into_response(),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/configs/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetConfig",
    summary = "Get a configuration with its draft and version history",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Configuration id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::FleetConfigDetail),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_config(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, &user_email.user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let fleets = permitted.as_ref();
        match o2_enterprise::enterprise::fleet::configs::get_config(&org_id, &id, fleets).await {
            Ok(detail) => MetaHttpResponse::json(detail),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/fleet/configs/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "DeleteFleetConfig",
    summary = "Delete a configuration and all its versions",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Configuration id"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "In use", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_config(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "DELETE").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::configs::delete_config(&org_id, &id).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/fleet/configs/{id}/draft",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "SaveFleetConfigDraft",
    summary = "Replace a configuration's draft",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Configuration id"),
    ),
    request_body(content = SaveDraftRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Saved", content_type = "application/json", body = config::meta::fleet::DraftSaved),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn save_config_draft(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<SaveDraftRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::configs::save_draft(
            &org_id,
            &user_email.user_id,
            &id,
            body,
        )
        .await
        {
            Ok(saved) => MetaHttpResponse::json(saved),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/fleet/configs/{id}/versions",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "PublishFleetConfigVersion",
    summary = "Publish the YAML as the configuration's next version",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Configuration id"),
    ),
    request_body(content = PublishRequest, content_type = "application/json"),
    responses(
        (status = 201, description = "Published", content_type = "application/json", body = config::meta::fleet::Published),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Published concurrently", content_type = "application/json", body = Object),
        (status = 422, description = "Validation errors", content_type = "application/json", body = config::meta::fleet::ValidationFailed),
    ),
)]
pub async fn publish_config_version(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<PublishRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "POST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::configs::publish(
            &org_id,
            &user_email.user_id,
            &id,
            body,
        )
        .await
        {
            Ok(published) => (StatusCode::CREATED, axum::Json(published)).into_response(),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/configs/{id}/versions/{version}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetConfigVersion",
    summary = "Get one published version's YAML and hash",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Configuration id"),
        ("version" = i64, Path, description = "Version number"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::ConfigVersion),
        (status = 400, description = "Invalid version", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_config_version(
    Path((org_id, id, version)): Path<(String, String, i64)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::configs::get_version(&org_id, &id, version).await {
            Ok(v) => MetaHttpResponse::json(v),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id, version);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/fleet/configs/validate",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ValidateFleetConfig",
    summary = "Validate a configuration's YAML without saving it",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = ValidateRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The issues found, also when there are errors", content_type = "application/json", body = config::meta::fleet::ValidationResult),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn validate_config(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<ValidateRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // Validate changes nothing, so a viewer may run it.
        if !allowed(&org_id, &user_email.user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::configs::validate_config(&org_id, body).await {
            Ok(result) => MetaHttpResponse::json(result),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/audit",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetAudit",
    summary = "The fleet audit trail from the audit stream: the newest 500 events of the last 30 days or of a period",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), AuditQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::AuditList),
        (status = 400, description = "Invalid period", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_audit(
    Path(org_id): Path<String>,
    Query(query): Query<AuditQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Audit rows carry no fleet, so only org-wide fleet access may read them.
        match permitted_fleets(&org_id, &user_email.user_id).await {
            Ok(None) => {}
            Ok(Some(_)) => return MetaHttpResponse::forbidden("Forbidden"),
            Err(refused) => return refused,
        }
        match openobserve_core::fleet::list_audit(&org_id, query).await {
            Ok(list) => MetaHttpResponse::json(list),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, query);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/settings",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetSettings",
    summary = "The org's fleet settings: restricted components and the target collector version",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = FleetSettings),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_settings(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::settings::get_settings(&org_id).await {
            Ok(settings) => MetaHttpResponse::json(settings),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/fleet/settings",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "UpdateFleetSettings",
    summary = "Replace the org's fleet settings",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = FleetSettings, content_type = "application/json"),
    responses(
        (status = 200, description = "The settings as stored", content_type = "application/json", body = FleetSettings),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn update_settings(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Decoded after the permission check, so a bad shape is a 400 an outsider never sees.
        let req = match serde_json::from_value::<FleetSettings>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        match o2_enterprise::enterprise::fleet::settings::update_settings(&org_id, req).await {
            Ok(settings) => MetaHttpResponse::json(settings),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, body);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/rollouts",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetRollouts",
    summary = "List the org's revisions, newest first",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::RolloutList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_rollouts(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed(&org_id, &user_email.user_id, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, &user_email.user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let fleets = permitted.as_ref();
        match o2_enterprise::enterprise::fleet::rollouts::list_rollouts(&org_id, fleets).await {
            Ok(list) => MetaHttpResponse::json(list),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/rollouts/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetRollout",
    summary = "Get one revision with its members",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Revision id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::RolloutDetail),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_rollout(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match o2_enterprise::enterprise::fleet::rollouts::get_rollout(&org_id, &id).await {
            Ok(rollout) => match fleet_read(&org_id, user_id, &rollout.rollout.fleet.id).await {
                Some(refused) => refused,
                None => MetaHttpResponse::json(rollout),
            },
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/flow",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetFlow",
    summary = "Throughput and export issues per (configuration, destination) for the flow map",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), FlowQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::FlowResponse),
        (status = 400, description = "Invalid window", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_flow(
    Path(org_id): Path<String>,
    Query(query): Query<FlowQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let window = query.window.unwrap_or_default();
        match openobserve_core::fleet::get_flow(&org_id, user_id, window, permitted.as_ref()).await
        {
            Ok(flow) => MetaHttpResponse::json(flow),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, query);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

/// A second lock behind `route_permissions`, which is first-match-wins and silently shadowable.
#[cfg(feature = "enterprise")]
async fn allowed(org_id: &str, user_id: &str, permission: &str) -> bool {
    check_permissions(
        org_id, org_id, user_id, FLEET, permission, None, true, false, false,
    )
    .await
}

/// D17-D18: the fleet's own check, as dashboards check theirs; no role is ever looked up.
#[cfg(feature = "enterprise")]
async fn fleet_write(org_id: &str, user_id: &str, fleet: &str, verb: &str) -> Option<Response> {
    (!fleet_allowed(org_id, user_id, fleet, verb).await)
        .then(|| MetaHttpResponse::forbidden("Forbidden"))
}

/// D19a: an item read checks `GET` on the item's fleet, whatever the list setting.
#[cfg(feature = "enterprise")]
async fn fleet_read(org_id: &str, user_id: &str, fleet: &str) -> Option<Response> {
    fleet_write(org_id, user_id, fleet, "GET").await
}

#[cfg(feature = "enterprise")]
async fn fleet_allowed(org_id: &str, user_id: &str, fleet: &str, verb: &str) -> bool {
    #[cfg(test)]
    if let Some(answer) = tests::fga_answer(org_id, user_id, fleet, verb) {
        return answer;
    }
    check_permissions(
        fleet, org_id, user_id, FLEETS, verb, None, false, false, true,
    )
    .await
}

/// D19c: the fleets whose items an org-wide list or aggregate shows; `None` is unfiltered.
#[cfg(feature = "enterprise")]
async fn permitted_fleets(
    org_id: &str,
    user_id: &str,
) -> Result<Option<HashSet<String>>, Response> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    let key = OFGA_MODELS.get(FLEETS).map_or(FLEETS, |model| model.key);
    #[cfg(test)]
    if let Some(objects) = tests::listed_objects(org_id, user_id) {
        return Ok(permitted_from(org_id, key, objects));
    }
    match db::authz::list_objects_for_user(org_id, user_id, "GET", key).await {
        Ok(objects) => Ok(permitted_from(org_id, key, objects)),
        Err(e) => Err(MetaHttpResponse::forbidden(e)),
    }
}

/// `fleets:_all_{org}` covers every fleet, as `permitted_folders` reads it.
#[cfg(feature = "enterprise")]
fn permitted_from(
    org_id: &str,
    key: &str,
    objects: Option<Vec<String>>,
) -> Option<HashSet<String>> {
    let objects = objects?;
    let prefix = format!("{key}:");
    if objects.contains(&format!("{prefix}_all_{org_id}")) {
        return None;
    }
    Some(
        objects
            .iter()
            .filter_map(|o| o.strip_prefix(&prefix))
            .map(str::to_string)
            .collect(),
    )
}

/// D19b: one fleet's collectors; without `GET` on it, the D19c filter bounded to it.
#[cfg(feature = "enterprise")]
async fn in_fleet(
    org_id: &str,
    user_id: &str,
    fleet: String,
    permitted: Option<HashSet<String>>,
) -> HashSet<String> {
    let readable = fleet_read(org_id, user_id, &fleet).await.is_none()
        || permitted.is_none_or(|p| p.contains(&fleet));
    if readable {
        HashSet::from([fleet])
    } else {
        HashSet::new()
    }
}

#[cfg(feature = "enterprise")]
async fn ensure_default_fleet(org_id: &str) -> Option<Response> {
    match db::folders::ensure_default_folder(org_id, FolderType::Fleets).await {
        Ok(_) => None,
        Err(e) => {
            log::error!("[fleet] default fleet of {org_id}: {e}");
            Some(MetaHttpResponse::internal_error("internal error"))
        }
    }
}

/// The `sea-orm` text carries SQL fragments, so a server fault is logged, not returned.
#[cfg(feature = "enterprise")]
fn to_response(e: anyhow::Error) -> Response {
    use config::meta::fleet::ValidationFailed;
    use o2_enterprise::enterprise::fleet::service::FleetError;
    match e.downcast_ref::<FleetError>() {
        Some(FleetError::ValidationFailed(issues)) => {
            let body = ValidationFailed {
                code: StatusCode::UNPROCESSABLE_ENTITY.as_u16(),
                message: e.to_string(),
                issues: issues.clone(),
            };
            (StatusCode::UNPROCESSABLE_ENTITY, axum::Json(body)).into_response()
        }
        Some(err) => MetaHttpResponse::error(err.status_code(), e.to_string()).into_response(),
        None => {
            log::error!("[fleet] {e}");
            MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                "internal error".to_string(),
            )
            .into_response()
        }
    }
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use std::cell::RefCell;

    use o2_enterprise::enterprise::fleet::service::FleetError;

    use super::*;

    /// What OpenFGA answers in a test that turns it on: `(object, verb)` grants and list results.
    #[derive(Default)]
    struct Fga {
        grants: HashSet<(String, String)>,
        listed: Option<Option<Vec<String>>>,
        asked: Vec<(String, String)>,
    }

    thread_local! {
        static FGA: RefCell<Option<Fga>> = const { RefCell::new(None) };
    }

    /// `None` lets the real `check_permissions` answer, as with OpenFGA off.
    pub(super) fn fga_answer(
        _org_id: &str,
        _user_id: &str,
        fleet: &str,
        verb: &str,
    ) -> Option<bool> {
        FGA.with(|fga| {
            fga.borrow_mut().as_mut().map(|fga| {
                let key = (format!("fleets:{fleet}"), verb.to_string());
                fga.asked.push(key.clone());
                fga.grants.contains(&key)
            })
        })
    }

    pub(super) fn listed_objects(_org_id: &str, _user_id: &str) -> Option<Option<Vec<String>>> {
        FGA.with(|fga| fga.borrow().as_ref().and_then(|fga| fga.listed.clone()))
    }

    fn openfga_on(grants: &[(&str, &str)], listed: Option<Option<Vec<&str>>>) {
        let fga = Fga {
            grants: grants
                .iter()
                .map(|(object, verb)| (object.to_string(), verb.to_string()))
                .collect(),
            listed: listed.map(|l| l.map(|v| v.into_iter().map(str::to_string).collect())),
            asked: vec![],
        };
        FGA.with(|cell| *cell.borrow_mut() = Some(fga));
    }

    fn openfga_off() {
        FGA.with(|cell| *cell.borrow_mut() = None);
    }

    fn asked() -> Vec<(String, String)> {
        FGA.with(|fga| {
            fga.borrow()
                .as_ref()
                .map(|f| f.asked.clone())
                .unwrap_or_default()
        })
    }

    const ORG: &str = "fleet-fleets-handlers";

    fn seed_member(email: &str, role: config::meta::user::UserRole, org: &str) {
        use common::infra::config::{ORG_USERS, USERS};
        USERS.insert(
            email.to_string(),
            infra::table::users::UserRecord {
                email: email.to_string(),
                first_name: "F".to_string(),
                last_name: "L".to_string(),
                password: "hash".to_string(),
                salt: "salt".to_string(),
                is_root: role == config::meta::user::UserRole::Root,
                password_ext: None,
                user_type: config::meta::user::UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                password_updated_at: None,
            },
        );
        ORG_USERS.insert(
            format!("{org}/{email}"),
            infra::table::org_users::OrgUserRecord {
                role,
                token: "token".to_string(),
                rum_token: None,
                org_id: org.to_string(),
                email: email.to_string(),
                created_at: 0,
                allow_static_token: true,
            },
        );
    }

    fn forget(email: &str, org: &str) {
        common::infra::config::USERS.remove(email);
        common::infra::config::ORG_USERS.remove(&format!("{org}/{email}"));
    }

    async fn body_text(res: Response) -> String {
        let body = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8_lossy(&body).into_owned()
    }

    #[tokio::test]
    async fn fleet_errors_map_to_their_status_and_hide_server_faults() {
        use config::meta::fleet::{ConfigIssue, IssueSeverity, Issues};

        for (err, status) in [
            (
                FleetError::CollectorNotFound("c1".into()),
                StatusCode::NOT_FOUND,
            ),
            (
                FleetError::TokenNotFound("t1".into()),
                StatusCode::NOT_FOUND,
            ),
            (
                FleetError::ConfigNotFound("edge".into()),
                StatusCode::NOT_FOUND,
            ),
            (
                FleetError::VersionNotFound("edge".into(), 3),
                StatusCode::NOT_FOUND,
            ),
            (
                FleetError::RolloutNotFound("r1".into()),
                StatusCode::NOT_FOUND,
            ),
            (FleetError::FleetNotFound("f".into()), StatusCode::NOT_FOUND),
            (
                FleetError::TokenNameExists("n".into()),
                StatusCode::CONFLICT,
            ),
            (
                FleetError::ConfigExists("edge".into()),
                StatusCode::CONFLICT,
            ),
            (FleetError::Conflict("edge".into()), StatusCode::CONFLICT),
            (FleetError::ConfigInUse("edge".into()), StatusCode::CONFLICT),
            (FleetError::ClusterUpgrading, StatusCode::CONFLICT),
            (FleetError::Moved("c1".into()), StatusCode::CONFLICT),
            (
                FleetError::RolloutBusy {
                    collector: "c1".into(),
                    rollout: None,
                },
                StatusCode::CONFLICT,
            ),
            (
                FleetError::RolloutState {
                    id: "r1".into(),
                    status: "completed".into(),
                },
                StatusCode::CONFLICT,
            ),
            (FleetError::Invalid("bad".into()), StatusCode::BAD_REQUEST),
        ] {
            assert_eq!(to_response(err.clone().into()).status(), status, "{err}");
        }
        let issues = Issues::from([(
            "logs".to_string(),
            vec![ConfigIssue {
                severity: IssueSeverity::Error,
                text: "No exporter".to_string(),
            }],
        )]);
        let res = to_response(FleetError::ValidationFailed(issues).into());
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let other = to_response(anyhow::anyhow!("SELECT secret FROM x"));
        assert_eq!(other.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!body_text(other).await.contains("SELECT secret"));
    }

    #[tokio::test]
    async fn a_fleet_write_is_the_fleets_fga_check_and_never_a_role() {
        use config::meta::user::UserRole;

        let (root, custom) = (
            "root@fleet-fleets-handlers.test",
            "custom@fleet-fleets-handlers.test",
        );
        seed_member(root, UserRole::Root, "default");
        seed_member(custom, UserRole::User, ORG);

        openfga_off();
        assert!(fleet_write(ORG, root, "f", "PUT").await.is_none(), "root");
        assert!(
            fleet_write(ORG, custom, "f", "PUT").await.is_none(),
            "OpenFGA off: allowed, with no role lookup"
        );
        assert!(
            fleet_write(ORG, "stranger@fleet-fleets-handlers.test", "f", "PUT")
                .await
                .is_some(),
            "not a member of the org"
        );

        openfga_on(&[("fleets:f", "PUT")], None);
        assert!(fleet_write(ORG, custom, "f", "PUT").await.is_none());
        let refused = fleet_write(ORG, custom, "g", "PUT").await;
        assert_eq!(refused.map(|r| r.status()), Some(StatusCode::FORBIDDEN));
        assert_eq!(
            fleet_write(ORG, custom, "f", "DELETE")
                .await
                .map(|r| r.status()),
            Some(StatusCode::FORBIDDEN),
            "each verb is its own grant"
        );
        assert_eq!(
            asked(),
            vec![
                ("fleets:f".to_string(), "PUT".to_string()),
                ("fleets:g".to_string(), "PUT".to_string()),
                ("fleets:f".to_string(), "DELETE".to_string()),
            ],
            "exactly the fleet's check, nothing else"
        );
        assert!(
            fleet_read(ORG, custom, "g").await.is_some(),
            "an item read outside the user's fleets is 403 whatever the list setting"
        );
        openfga_off();
        forget(root, "default");
        forget(custom, ORG);
    }

    #[tokio::test]
    async fn permitted_fleets_follow_the_dashboards_list_rules() {
        let custom = "lister@fleet-fleets-handlers.test";
        seed_member(custom, config::meta::user::UserRole::User, ORG);
        openfga_off();
        assert_eq!(
            permitted_fleets(ORG, custom).await.ok(),
            Some(None),
            "OpenFGA off, or the list flag off: unfiltered"
        );
        for (listed, want) in [
            (None, None),
            (
                Some(vec![format!("fleets:_all_{ORG}"), "fleets:f".to_string()]),
                None,
            ),
            (
                Some(vec!["fleets:f".to_string(), "fleets:g".to_string()]),
                Some(HashSet::from(["f".to_string(), "g".to_string()])),
            ),
            (Some(vec![]), Some(HashSet::new())),
        ] {
            assert_eq!(
                permitted_from(ORG, "fleets", listed.clone()),
                want,
                "{listed:?}"
            );
        }
        forget(custom, ORG);
    }

    #[tokio::test]
    async fn a_fleet_scoped_list_without_get_falls_back_to_the_list_filter_inside_it() {
        let custom = "scoped@fleet-fleets-handlers.test";
        seed_member(custom, config::meta::user::UserRole::User, ORG);
        let f = || "f".to_string();
        openfga_on(&[("fleets:f", "GET")], None);
        assert_eq!(
            in_fleet(ORG, custom, f(), Some(HashSet::new())).await,
            HashSet::from([f()]),
            "GET on F: its collectors"
        );
        openfga_on(&[], None);
        assert_eq!(
            in_fleet(ORG, custom, f(), None).await,
            HashSet::from([f()]),
            "LIST only, list flag off: F's collectors and nothing outside F"
        );
        assert!(
            in_fleet(ORG, custom, f(), Some(HashSet::from(["g".to_string()])))
                .await
                .is_empty(),
            "LIST only, list flag on, F not permitted: none"
        );
        assert_eq!(
            in_fleet(ORG, custom, f(), Some(HashSet::from([f()]))).await,
            HashSet::from([f()])
        );
        openfga_off();
        forget(custom, ORG);
    }

    async fn put_settings_through_the_router(email: &str, body: &str) -> (StatusCode, String) {
        let app = axum::Router::new().route(
            "/api/{org_id}/fleet/settings",
            axum::routing::put(update_settings),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let res = reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .put(format!("http://{addr}/api/{ORG}/fleet/settings"))
            .header("user_id", email)
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap();
        let status = StatusCode::from_u16(res.status().as_u16()).unwrap();
        let text = res.text().await.unwrap();
        server.abort();
        (status, text)
    }

    #[tokio::test]
    async fn settings_are_decided_by_the_fleet_check_alone_and_a_bad_shape_is_400() {
        let (viewer, custom) = (
            "settings-viewer@fleet-fleets-handlers.test",
            "settings-custom@fleet-fleets-handlers.test",
        );
        seed_member(viewer, config::meta::user::UserRole::Viewer, ORG);
        seed_member(custom, config::meta::user::UserRole::User, ORG);
        for (email, body, field) in [
            (viewer, r#"{"restricted_components":[]}"#, "target_version"),
            (
                custom,
                r#"{"restricted_components":[],"target_version":null,"show_drift":true}"#,
                "show_drift",
            ),
        ] {
            let (status, text) = put_settings_through_the_router(email, body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{email}: {text}");
            assert!(text.contains(field), "{email}: {text}");
            assert!(!text.contains("administrators"), "no role check remains");
        }
        let body = r#"{"restricted_components":[],"target_version":"0.170"}"#;
        let (status, text) = put_settings_through_the_router(custom, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{text}");
        assert!(text.contains("MAJOR.MINOR.PATCH"), "{text}");
        let (status, _) =
            put_settings_through_the_router("stranger@fleet-fleets-handlers.test", body).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "an outsider is refused first"
        );
        forget(viewer, ORG);
        forget(custom, ORG);
    }

    #[tokio::test]
    async fn requests_refuse_unknown_fields_with_a_400() {
        for body in [
            serde_json::json!({"name": "t", "labels": {"env": "prod"}}),
            serde_json::json!({"name": "t", "fleet": "default", "x": 1}),
        ] {
            assert!(serde_json::from_value::<CreateTokenRequest>(body).is_err());
        }
        let wrong = serde_json::json!({"collector_ids": [], "dst_folder_id": "f", "folder": "g"});
        assert!(serde_json::from_value::<MoveCollectorsRequest>(wrong).is_err());
        let wrong = serde_json::json!({"config": "edge", "version": 1, "strategy": "immediate",
            "target": {"collectors": []}});
        assert!(serde_json::from_value::<SetDesiredRequest>(wrong).is_err());
    }
}
