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

//! Fleet management: every permission is an OpenFGA check, as on dashboards, and never a role.

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
    AuditQuery, CollectorsQuery, CreateConfigRequest, CreateFleetRequest, CreateTokenRequest,
    FleetSettings, FlowQuery, MoveCollectorsRequest, PageQuery, PublishRequest,
    RenameCollectorRequest, RenameFleetRequest, RolloutsQuery, SaveDraftRequest, SetDesiredRequest,
    Settings, SkipRequest, ValidateRequest,
};
#[cfg(feature = "enterprise")]
use config::meta::folder::{Folder, FolderType};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
use openobserve_api_common::extractors::ValidatedJson;

#[cfg(feature = "enterprise")]
use crate::service::auth::{UserEmail, check_permissions};

/// The org-level module of fleet-wide reads and writes that name no single fleet.
#[cfg(feature = "enterprise")]
const FLEET: &str = "fleet";
#[cfg(feature = "enterprise")]
const FLEET_CONFIGS: &str = "fleet_configs";
/// Settings, audit, summary and pipelines.
#[cfg(feature = "enterprise")]
const FLEET_MANAGEMENT: &str = "fleet_management";
#[cfg(feature = "enterprise")]
const FLEETS: &str = "fleets";

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/collectors",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetCollectors",
    summary = "List the org's collectors, or one fleet's, one page at a time",
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
        use config::meta::fleet::CollectorList;

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
        let fleets = match query.fleet {
            None => permitted,
            Some(fleet) => Some(in_fleet(&org_id, user_id, fleet, permitted).await),
        };
        let page = PageQuery {
            offset: query.offset,
            limit: query.limit,
        };
        match o2_enterprise::enterprise::fleet::service::list_collectors(&org_id, fleets.as_ref())
            .await
        {
            Ok(list) => {
                let (total, items) = page.page(list.items);
                MetaHttpResponse::json(CollectorList { total, items })
            }
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
    summary = "Get one collector with its assignment, delivery evidence and history",
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
    patch,
    path = "/{org_id}/fleet/collectors/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "RenameFleetCollector",
    summary = "Set a collector's nickname; an empty name falls back to the host name",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Collector instance UID"),
    ),
    request_body(content = RenameCollectorRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The renamed collector", content_type = "application/json", body = config::meta::fleet::Collector),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn rename_collector(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::service;

        if let Err(refused) = collector_write(&org_id, &user_email.user_id, &id).await {
            return refused;
        }
        let req = match serde_json::from_value::<RenameCollectorRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        match service::rename_collector(&org_id, &id, req.name.trim()).await {
            Ok(collector) => MetaHttpResponse::json(collector),
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
    delete,
    path = "/{org_id}/fleet/collectors/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "DeleteFleetCollector",
    summary = "Delete a collector's row; a live host with a valid token reappears on its next heartbeat",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Collector instance UID"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_collector(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::service;

        if let Err(refused) = collector_write(&org_id, &user_email.user_id, &id).await {
            return refused;
        }
        match service::delete_collector(&org_id, &id).await {
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
    post,
    path = "/{org_id}/fleet/collectors/{id}/restart",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "RestartFleetCollector",
    summary = "Queue a restart command, sent with the collector's next message",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Collector instance UID"),
    ),
    responses(
        (status = 202, description = "Queued", content_type = "application/json", body = config::meta::fleet::RestartQueued),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn restart_collector(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::service;

        if let Err(refused) = collector_write(&org_id, &user_email.user_id, &id).await {
            return refused;
        }
        match service::restart_collector(&org_id, &id).await {
            Ok(queued) => (StatusCode::ACCEPTED, axum::Json(queued)).into_response(),
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
    post,
    path = "/{org_id}/fleet/collectors/{id}/redeliver",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "RedeliverFleetCollector",
    summary = "Rewrite the collector's assignment at a new revision to force a fresh apply",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Collector instance UID"),
    ),
    responses(
        (status = 202, description = "Rewritten", content_type = "application/json", body = config::meta::fleet::Redelivered),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Nothing assigned", content_type = "application/json", body = Object),
    ),
)]
pub async fn redeliver_collector(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::service;

        if let Err(refused) = collector_write(&org_id, &user_email.user_id, &id).await {
            return refused;
        }
        match service::redeliver_collector(&org_id, &id).await {
            Ok(redelivered) => (StatusCode::ACCEPTED, axum::Json(redelivered)).into_response(),
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
    path = "/{org_id}/fleet/fleets",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleets",
    summary = "The fleets the caller may list; state is null where the caller may not read the fleet",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), PageQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::FleetList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_fleets(
    Path(org_id): Path<String>,
    Query(page): Query<PageQuery>,
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
        let mut fleets = Vec::with_capacity(listed.len());
        for folder in listed {
            let readable = fleet_read(&org_id, user_id, &folder.folder_id)
                .await
                .is_none();
            let mut item = fleet_item(folder, &states);
            if !readable {
                item.state = None;
                item.settings = FleetSettings::default();
            }
            fleets.push(item);
        }
        let (total, items) = page.page(fleets);
        MetaHttpResponse::json(FleetList { total, items })
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, page);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/fleet/fleets",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "CreateFleet",
    summary = "Create a fleet; the creator receives full rights on it",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = CreateFleetRequest, content_type = "application/json"),
    responses(
        (status = 201, description = "Created", content_type = "application/json", body = config::meta::fleet::Fleet),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 409, description = "Name exists", content_type = "application/json", body = Object),
    ),
)]
pub async fn create_fleet(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !fleet_create_allowed(&org_id, user_id).await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let req = match serde_json::from_value::<CreateFleetRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        let folder = Folder {
            folder_id: String::new(),
            name: req.name,
            description: String::new(),
            icon: None,
        };
        match db::folders::save_folder(&org_id, folder, FolderType::Fleets, false).await {
            Ok(folder) => {
                (StatusCode::CREATED, axum::Json(fleet_item(folder, &[]))).into_response()
            }
            Err(e) => folder_response(e),
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
    path = "/{org_id}/fleet/fleets/{fleet_id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleet",
    summary = "Get one fleet with its versions, counts and setting overrides",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::Fleet),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_fleet(
    Path((org_id, fleet_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if let Some(refused) = fleet_read(&org_id, user_id, &fleet_id).await {
            return refused;
        }
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        let folder = match db::folders::get_folder(&org_id, &fleet_id, FolderType::Fleets).await {
            Ok(folder) => folder,
            Err(e) => return folder_response(e),
        };
        match o2_enterprise::enterprise::fleet::fleets::list_fleets(&org_id).await {
            Ok(states) => MetaHttpResponse::json(fleet_item(folder, &states)),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, fleet_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    patch,
    path = "/{org_id}/fleet/fleets/{fleet_id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "RenameFleet",
    summary = "Rename a fleet",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    request_body(content = RenameFleetRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Renamed", content_type = "application/json", body = config::meta::fleet::Fleet),
        (status = 400, description = "Invalid, or the default fleet", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Name exists", content_type = "application/json", body = Object),
    ),
)]
pub async fn rename_fleet(
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
        let req = match serde_json::from_value::<RenameFleetRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        let name = req.name.trim();
        if name.is_empty() {
            return MetaHttpResponse::bad_request("name must not be empty");
        }
        let mut folder = match db::folders::get_folder(&org_id, &fleet_id, FolderType::Fleets).await
        {
            Ok(folder) => folder,
            Err(e) => return folder_response(e),
        };
        folder.name = name.to_string();
        let renamed =
            db::folders::update_folder(&org_id, &fleet_id, FolderType::Fleets, folder).await;
        let folder = match renamed {
            Ok(folder) => folder,
            Err(e) => return folder_response(e),
        };
        match o2_enterprise::enterprise::fleet::fleets::list_fleets(&org_id).await {
            Ok(states) => MetaHttpResponse::json(fleet_item(folder, &states)),
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
    delete,
    path = "/{org_id}/fleet/fleets/{fleet_id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "DeleteFleet",
    summary = "Delete an empty fleet; the default fleet is never deleted",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Still referenced, the default fleet, or changing", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_fleet(
    Path((org_id, fleet_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if let Some(refused) = fleet_write(&org_id, user_id, &fleet_id, "DELETE").await {
            return refused;
        }
        if fleet_id == config::meta::folder::DEFAULT_FOLDER {
            return MetaHttpResponse::conflict("the default fleet cannot be deleted");
        }
        match db::folders::delete_folder(&org_id, &fleet_id, FolderType::Fleets).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(e) => folder_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, fleet_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/fleet/fleets/{fleet_id}/settings",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetOverrides",
    summary = "A fleet's setting overrides; a null field inherits the organization default",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = FleetSettings),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_fleet_settings(
    Path((org_id, fleet_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::settings;

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if let Some(refused) = fleet_read(&org_id, user_id, &fleet_id).await {
            return refused;
        }
        match settings::get_fleet_settings(&org_id, &fleet_id).await {
            Ok(settings) => MetaHttpResponse::json(settings),
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, fleet_id);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/fleet/fleets/{fleet_id}/settings",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "UpdateFleetOverrides",
    summary = "Replace a fleet's setting overrides",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    request_body(content = FleetSettings, content_type = "application/json"),
    responses(
        (status = 200, description = "The overrides as stored", content_type = "application/json", body = FleetSettings),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn put_fleet_settings(
    Path((org_id, fleet_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::settings;

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        if let Some(refused) = fleet_write(&org_id, user_id, &fleet_id, "PUT").await {
            return refused;
        }
        let req = match serde_json::from_value::<FleetSettings>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if let Err(e) = req.validate() {
            return MetaHttpResponse::bad_request(e);
        }
        match settings::put_fleet_settings(&org_id, &fleet_id, req).await {
            Ok(settings) => MetaHttpResponse::json(settings),
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
    put,
    path = "/{org_id}/fleet/fleets/{fleet_id}/desired",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "SetFleetDesired",
    summary = "Change a fleet's desired version, which starts a rollout; an already desired version returns its rollout",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    request_body(content = SetDesiredRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The rollout", content_type = "application/json", body = config::meta::fleet::Rollout),
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
        let req = match desired_request(&org_id, user_id, &fleet_id, body).await {
            Ok(req) => req,
            Err(refused) => return refused,
        };
        match o2_enterprise::enterprise::fleet::rollouts::set_desired(
            &org_id, user_id, &fleet_id, req,
        )
        .await
        {
            Ok(rollout) => MetaHttpResponse::json(rollout),
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
    post,
    path = "/{org_id}/fleet/fleets/{fleet_id}/desired/preview",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "PreviewFleetDesired",
    summary = "The phases a desired-version change would run for the fleet's current size; changes nothing",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("fleet_id" = String, Path, description = "Fleet id"),
    ),
    request_body(content = SetDesiredRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The plan", content_type = "application/json", body = config::meta::fleet::PlanPreview),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Fleet not found", content_type = "application/json", body = Object),
    ),
)]
pub async fn preview_desired(
    Path((org_id, fleet_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        let req = match desired_request(&org_id, user_id, &fleet_id, body).await {
            Ok(req) => req,
            Err(refused) => return refused,
        };
        match o2_enterprise::enterprise::fleet::rollouts::preview_plan(&org_id, &fleet_id, &req)
            .await
        {
            Ok(plan) => MetaHttpResponse::json(plan),
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
    post,
    path = "/{org_id}/fleet/fleets/move",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "MoveFleetCollectors",
    summary = "Move up to 1000 collectors to another fleet, which assigns its stable version at once",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = MoveCollectorsRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Moved", content_type = "application/json", body = config::meta::fleet::MoveCollectorsResponse),
        (status = 400, description = "Invalid, too many, or already in the destination", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "A collector or the destination not found", content_type = "application/json", body = Object),
        (status = 409, description = "A collector moved meanwhile", content_type = "application/json", body = Object),
    ),
)]
pub async fn move_collectors(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use config::meta::fleet::MAX_MOVE_COLLECTORS;
        use o2_enterprise::enterprise::fleet::fleets;

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let req = match serde_json::from_value::<MoveCollectorsRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if req.collector_ids.len() > MAX_MOVE_COLLECTORS {
            return MetaHttpResponse::bad_request(format!(
                "at most {MAX_MOVE_COLLECTORS} collectors move at once"
            ));
        }
        if let Some(failed) = ensure_default_fleet(&org_id).await {
            return failed;
        }
        let found = match fleets::collector_fleets(&org_id, &req.collector_ids).await {
            Ok(found) => found,
            Err(e) => return to_response(e),
        };
        let sources = match fleets::move_sources(&found, &req.collector_ids, None) {
            Ok(sources) => sources,
            Err(e) => return to_response(e.into()),
        };
        // §13: a move needs `PUT` on every source fleet and on the destination.
        let dest = req.to_fleet.as_str();
        let mut distinct: HashSet<&str> = sources.values().map(String::as_str).collect();
        distinct.insert(dest);
        for fleet in distinct {
            if let Some(refused) = fleet_write(&org_id, user_id, fleet, "PUT").await {
                return refused;
            }
        }
        let mv = fleets::Move { dest, sources };
        match fleets::move_collectors(&org_id, mv).await {
            Ok(moved) => MetaHttpResponse::json(moved),
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
    path = "/{org_id}/fleet/tokens",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetTokens",
    summary = "List enrollment tokens with their values",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), PageQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::TokenList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_tokens(
    Path(org_id): Path<String>,
    Query(page): Query<PageQuery>,
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
            Ok(list) => {
                let (total, items) = page.page(list.items);
                MetaHttpResponse::json(config::meta::fleet::TokenList { total, items })
            }
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, page);
        MetaHttpResponse::forbidden("Not Supported")
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/fleet/tokens",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "CreateFleetToken",
    summary = "Create an enrollment token placing collectors in a fleet",
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
        if let Some(refused) = fleet_write(&org_id, user_id, &req.fleet, "PUT").await {
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
    params(("org_id" = String, Path, description = "Organization name"), PageQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::FleetConfigList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_configs(
    Path(org_id): Path<String>,
    Query(page): Query<PageQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, &user_email.user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let fleets = permitted.as_ref();
        match o2_enterprise::enterprise::fleet::configs::list_configs(&org_id, fleets).await {
            Ok(list) => {
                let (total, items) = page.page(list.items);
                MetaHttpResponse::json(config::meta::fleet::FleetConfigList { total, items })
            }
            Err(e) => to_response(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, page);
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
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "POST").await {
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
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "GET").await {
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
        (status = 409, description = "Referenced; the body's `references` holds the counts", content_type = "application/json", body = Object),
    ),
)]
pub async fn delete_config(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "DELETE").await {
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
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "PUT").await {
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
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "POST").await {
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
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "GET").await {
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
        if !allowed_on(FLEET_CONFIGS, &org_id, &user_email.user_id, "GET").await {
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
    path = "/{org_id}/fleet/rollouts",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ListFleetRollouts",
    summary = "List the org's rollouts, or one fleet's, newest first",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), RolloutsQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::RolloutList),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn list_rollouts(
    Path(org_id): Path<String>,
    Query(query): Query<RolloutsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use config::meta::fleet::RolloutList;

        let user_id = &user_email.user_id;
        if !allowed(&org_id, user_id, "LIST").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let fleets = match query.fleet {
            None => permitted,
            Some(fleet) => Some(in_fleet(&org_id, user_id, fleet, permitted).await),
        };
        let page = PageQuery {
            offset: query.offset,
            limit: query.limit,
        };
        match o2_enterprise::enterprise::fleet::rollouts::list_rollouts(&org_id, fleets.as_ref())
            .await
        {
            Ok(list) => {
                let listed = list
                    .items
                    .into_iter()
                    .filter(|r| fleets.as_ref().is_none_or(|f| f.contains(&r.fleet.id)))
                    .collect();
                let (total, items) = page.page(listed);
                MetaHttpResponse::json(RolloutList { total, items })
            }
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
    path = "/{org_id}/fleet/rollouts/{id}",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetRollout",
    summary = "Get one rollout with its phases, members, halt and events",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Rollout id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::Rollout),
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
            Ok(rollout) => match fleet_read(&org_id, user_id, &rollout.fleet.id).await {
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
    post,
    path = "/{org_id}/fleet/rollouts/{id}/resume",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "ResumeFleetRollout",
    summary = "Continue a halted rollout from its halted phase",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Rollout id"),
    ),
    responses(
        (status = 200, description = "The rollout", content_type = "application/json", body = config::meta::fleet::Rollout),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Not halted, or the halt does not offer this exit", content_type = "application/json", body = Object),
    ),
)]
pub async fn resume_rollout(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::rollouts;

        let user_id = &user_email.user_id;
        if let Err(refused) = rollout_write(&org_id, user_id, &id).await {
            return refused;
        }
        match rollouts::resume(&org_id, &id, user_id).await {
            Ok(rollout) => MetaHttpResponse::json(rollout),
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
    post,
    path = "/{org_id}/fleet/rollouts/{id}/skip",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "SkipFleetRolloutCollectors",
    summary = "Exclude the failing collectors from a halted rollout and continue it",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Rollout id"),
    ),
    request_body(content = SkipRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "The rollout", content_type = "application/json", body = config::meta::fleet::Rollout),
        (status = 400, description = "Invalid", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Not halted, or the halt does not offer this exit", content_type = "application/json", body = Object),
    ),
)]
pub async fn skip_rollout(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ValidatedJson(body): ValidatedJson<serde_json::Value>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::rollouts;

        let user_id = &user_email.user_id;
        if let Err(refused) = rollout_write(&org_id, user_id, &id).await {
            return refused;
        }
        let req = match serde_json::from_value::<SkipRequest>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if req.collector_ids.is_empty() {
            return MetaHttpResponse::bad_request("collector_ids must not be empty");
        }
        match rollouts::skip(&org_id, &id, user_id, &req.collector_ids).await {
            Ok(rollout) => MetaHttpResponse::json(rollout),
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
    path = "/{org_id}/fleet/rollouts/{id}/rollback",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "RollbackFleetRollout",
    summary = "Start an immediate rollout back to stable and mark this one rolled back",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("id" = String, Path, description = "Rollout id"),
    ),
    responses(
        (status = 200, description = "The rollout to stable", content_type = "application/json", body = config::meta::fleet::Rollout),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "Not found", content_type = "application/json", body = Object),
        (status = 409, description = "Not halted, or the halt does not offer this exit", content_type = "application/json", body = Object),
    ),
)]
pub async fn rollback_rollout(
    Path((org_id, id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::fleet::rollouts;

        let user_id = &user_email.user_id;
        if let Err(refused) = rollout_write(&org_id, user_id, &id).await {
            return refused;
        }
        match rollouts::rollback(&org_id, &id, user_id).await {
            Ok(rollout) => MetaHttpResponse::json(rollout),
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
        if !allowed_on(FLEET_MANAGEMENT, &org_id, &user_email.user_id, "GET").await {
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
    path = "/{org_id}/fleet/pipelines",
    context_path = "/api",
    tag = "Fleet",
    operation_id = "GetFleetPipelines",
    summary = "Throughput and issues per OTel pipeline of each readable fleet for the Pipelines page",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), FlowQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = config::meta::fleet::PipelinesResponse),
        (status = 400, description = "Invalid window", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_pipelines(
    Path(org_id): Path<String>,
    Query(query): Query<FlowQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        if !allowed_on(FLEET_MANAGEMENT, &org_id, user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        let permitted = match permitted_fleets(&org_id, user_id).await {
            Ok(permitted) => permitted,
            Err(refused) => return refused,
        };
        let window = query.window.unwrap_or_default();
        match openobserve_core::fleet::get_pipelines(&org_id, user_id, window, permitted.as_ref())
            .await
        {
            Ok(pipelines) => MetaHttpResponse::json(pipelines),
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
        if !allowed_on(FLEET_MANAGEMENT, &org_id, &user_email.user_id, "GET").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        match openobserve_core::fleet::list_audit(&org_id, query).await {
            Ok(mut list) => {
                list.total = list.items.len();
                MetaHttpResponse::json(list)
            }
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
    summary = "The org's fleet settings: target collector version, restricted components and fleet defaults",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Settings),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
    ),
)]
pub async fn get_settings(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !allowed_on(FLEET_MANAGEMENT, &org_id, &user_email.user_id, "GET").await {
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
    request_body(content = Settings, content_type = "application/json"),
    responses(
        (status = 200, description = "The settings as stored", content_type = "application/json", body = Settings),
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
        if !allowed_on(FLEET_MANAGEMENT, &org_id, &user_email.user_id, "PUT").await {
            return MetaHttpResponse::forbidden("Forbidden");
        }
        // Decoded after the permission check, so a bad shape is a 400 an outsider never sees.
        let req = match serde_json::from_value::<Settings>(body) {
            Ok(req) => req,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        if let Err(e) = req.fleet_defaults.validate() {
            return MetaHttpResponse::bad_request(e);
        }
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

/// A second lock behind `route_permissions`, which is first-match-wins and silently shadowable.
#[cfg(feature = "enterprise")]
async fn allowed(org_id: &str, user_id: &str, permission: &str) -> bool {
    allowed_on(FLEET, org_id, user_id, permission).await
}

/// §13: configurations and management are org-level modules of their own.
#[cfg(feature = "enterprise")]
async fn allowed_on(module: &str, org_id: &str, user_id: &str, permission: &str) -> bool {
    #[cfg(test)]
    if let Some(answer) = tests::org_answer(module, permission) {
        return answer;
    }
    check_permissions(
        org_id, org_id, user_id, module, permission, None, true, false, false,
    )
    .await
}

/// §13: creating a fleet is org-level, as creating a dashboard folder is.
#[cfg(feature = "enterprise")]
async fn fleet_create_allowed(org_id: &str, user_id: &str) -> bool {
    allowed(org_id, user_id, "GET").await
        && check_permissions(
            org_id, org_id, user_id, FLEETS, "POST", None, true, false, false,
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

/// §13: every collector write is `PUT` on the collector's current fleet.
#[cfg(feature = "enterprise")]
async fn collector_write(org_id: &str, user_id: &str, id: &str) -> Result<String, Response> {
    use o2_enterprise::enterprise::fleet::{fleets, service::FleetError};

    if !allowed(org_id, user_id, "GET").await {
        return Err(MetaHttpResponse::forbidden("Forbidden"));
    }
    let ids = [id.to_string()];
    let fleet = match fleets::collector_fleets(org_id, &ids).await {
        Ok(found) => found.get(id).cloned(),
        Err(e) => return Err(to_response(e)),
    };
    let Some(fleet) = fleet else {
        return Err(to_response(
            FleetError::CollectorNotFound(id.to_string()).into(),
        ));
    };
    match fleet_write(org_id, user_id, &fleet, "PUT").await {
        Some(refused) => Err(refused),
        None => Ok(fleet),
    }
}

/// §13: a rollout exit is `PUT` on the rollout's fleet.
#[cfg(feature = "enterprise")]
async fn rollout_write(org_id: &str, user_id: &str, id: &str) -> Result<(), Response> {
    if !allowed(org_id, user_id, "GET").await {
        return Err(MetaHttpResponse::forbidden("Forbidden"));
    }
    let rollout = match o2_enterprise::enterprise::fleet::rollouts::get_rollout(org_id, id).await {
        Ok(rollout) => rollout,
        Err(e) => return Err(to_response(e)),
    };
    match fleet_write(org_id, user_id, &rollout.fleet.id, "PUT").await {
        Some(refused) => Err(refused),
        None => Ok(()),
    }
}

/// Checks `PUT` on the fleet, then decodes the body so an unknown field is a 400 and not a 422.
#[cfg(feature = "enterprise")]
async fn desired_request(
    org_id: &str,
    user_id: &str,
    fleet_id: &str,
    body: serde_json::Value,
) -> Result<SetDesiredRequest, Response> {
    if !allowed(org_id, user_id, "GET").await {
        return Err(MetaHttpResponse::forbidden("Forbidden"));
    }
    if let Some(refused) = fleet_write(org_id, user_id, fleet_id, "PUT").await {
        return Err(refused);
    }
    let req =
        serde_json::from_value::<SetDesiredRequest>(body).map_err(MetaHttpResponse::bad_request)?;
    if let Err(e) = validate_batching(&req) {
        return Err(MetaHttpResponse::bad_request(e));
    }
    match ensure_default_fleet(org_id).await {
        Some(failed) => Err(failed),
        None => Ok(req),
    }
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

/// D19b: one fleet's items; without `GET` on it, the D19c filter bounded to it.
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

/// The folder row names the fleet; a fleet without a state row has never been assigned anything.
#[cfg(feature = "enterprise")]
fn fleet_item(folder: Folder, states: &[config::meta::fleet::Fleet]) -> config::meta::fleet::Fleet {
    let found = states.iter().find(|s| s.id == folder.folder_id);
    config::meta::fleet::Fleet {
        state: Some(found.and_then(|s| s.state.clone()).unwrap_or_default()),
        settings: found.map(|s| s.settings).unwrap_or_default(),
        id: folder.folder_id,
        name: folder.name,
    }
}

/// Counts only (§9.2): every size is at least one collector.
#[cfg(feature = "enterprise")]
fn validate_batching(req: &SetDesiredRequest) -> Result<(), String> {
    use config::meta::fleet::Batching;

    if req.version < 1 {
        return Err("version must be at least 1".to_string());
    }
    match req.batching {
        Batching::One => Ok(()),
        Batching::Canary { first } if first >= 1 => Ok(()),
        Batching::Canary { .. } => Err("batching.first must be at least 1".to_string()),
        Batching::Progressive {
            initial,
            multiplier,
            max,
        } => {
            if initial < 1 || max < initial {
                Err("batching needs 1 <= initial <= max".to_string())
            } else if multiplier < 1 {
                Err("batching.multiplier must be at least 1".to_string())
            } else {
                Ok(())
            }
        }
    }
}

#[cfg(feature = "enterprise")]
fn folder_response(e: db::folders::FolderError) -> Response {
    use db::folders::FolderError;
    match e {
        FolderError::NotFound => MetaHttpResponse::not_found("fleet not found"),
        FolderError::MissingName => MetaHttpResponse::bad_request("name must not be empty"),
        FolderError::UpdateDefaultFolder => {
            MetaHttpResponse::bad_request("the default fleet cannot be renamed")
        }
        FolderError::FolderNameAlreadyExists => {
            MetaHttpResponse::conflict("a fleet with this name already exists")
        }
        FolderError::DeleteFleet(message) | FolderError::FleetChanged(message) => {
            MetaHttpResponse::conflict(message)
        }
        FolderError::PermittedFoldersMissingUser | FolderError::PermittedFoldersValidator(_) => {
            MetaHttpResponse::forbidden("Forbidden")
        }
        other => {
            log::error!("[fleet] folder: {other}");
            MetaHttpResponse::internal_error("internal error")
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
        Some(FleetError::ConfigInUse(_, references)) => {
            let body = serde_json::json!({
                "code": StatusCode::CONFLICT.as_u16(),
                "message": e.to_string(),
                "references": references,
            });
            (StatusCode::CONFLICT, axum::Json(body)).into_response()
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

    /// Org-level modules other than `fleet`, which the tests leave to the real check.
    pub(super) fn org_answer(module: &str, verb: &str) -> Option<bool> {
        if module == FLEET {
            return None;
        }
        FGA.with(|fga| {
            fga.borrow_mut().as_mut().map(|fga| {
                let key = (module.to_string(), verb.to_string());
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
            (
                FleetError::ConfigInUse("edge".into(), Default::default()),
                StatusCode::CONFLICT,
            ),
            (FleetError::Disabled, StatusCode::SERVICE_UNAVAILABLE),
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
        let references = config::meta::fleet::References {
            fleets: 2,
            ..Default::default()
        };
        let res = to_response(FleetError::ConfigInUse("edge".into(), references).into());
        assert_eq!(res.status(), StatusCode::CONFLICT);
        assert!(body_text(res).await.contains(r#""fleets":2"#));
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
    async fn configs_and_management_are_checked_on_their_own_modules() {
        let custom = "modules@fleet-fleets-handlers.test";
        seed_member(custom, config::meta::user::UserRole::User, ORG);
        openfga_on(&[(FLEET_CONFIGS, "GET"), (FLEET_MANAGEMENT, "PUT")], None);
        assert!(allowed_on(FLEET_CONFIGS, ORG, custom, "GET").await);
        assert!(!allowed_on(FLEET_CONFIGS, ORG, custom, "POST").await);
        assert!(!allowed_on(FLEET_MANAGEMENT, ORG, custom, "GET").await);
        assert!(allowed_on(FLEET_MANAGEMENT, ORG, custom, "PUT").await);
        assert_eq!(
            asked(),
            vec![
                ("fleet_configs".to_string(), "GET".to_string()),
                ("fleet_configs".to_string(), "POST".to_string()),
                ("fleet_management".to_string(), "GET".to_string()),
                ("fleet_management".to_string(), "PUT".to_string()),
            ]
        );
        let caller = UserEmail {
            user_id: custom.to_string(),
        };
        let res = get_settings(Path(ORG.to_string()), Headers(caller)).await;
        assert_eq!(
            res.status(),
            StatusCode::FORBIDDEN,
            "a settings read is fleet_management GET"
        );
        openfga_off();
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
            (viewer, r#"{"target_version":null}"#, "target_version"),
            (
                custom,
                r#"{"restricted_components":[],"show_drift":true}"#,
                "show_drift",
            ),
            (
                custom,
                r#"{"fleet_defaults":{"heartbeat_interval_secs":0}}"#,
                "heartbeat_interval_secs",
            ),
        ] {
            let (status, text) = put_settings_through_the_router(email, body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{email}: {text}");
            assert!(text.contains(field), "{email}: {text}");
            assert!(!text.contains("administrators"), "no role check remains");
        }
        let body = r#"{"restricted_components":[],"target_collector_version":"0.170"}"#;
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
        let wrong = serde_json::json!({"collector_ids": [], "to_fleet": "f", "folder": "g"});
        assert!(serde_json::from_value::<MoveCollectorsRequest>(wrong).is_err());
        let wrong = serde_json::json!({"config": "edge", "version": 1, "strategy": "immediate"});
        assert!(serde_json::from_value::<SetDesiredRequest>(wrong).is_err());
        let wrong = serde_json::json!({"name": "n", "hostname": "h"});
        assert!(serde_json::from_value::<RenameCollectorRequest>(wrong).is_err());
    }

    #[test]
    fn batching_takes_counts_of_at_least_one_collector() {
        use config::meta::fleet::Batching;

        let req = |version, batching| SetDesiredRequest {
            config: "edge".to_string(),
            version,
            start: Default::default(),
            batching,
            verify: true,
            auto_rollback: false,
        };
        let progressive = |initial, multiplier, max| Batching::Progressive {
            initial,
            multiplier,
            max,
        };
        for ok in [
            Batching::One,
            Batching::Canary { first: 1 },
            progressive(3, 3, 27),
            progressive(5, 1, 5),
        ] {
            assert!(validate_batching(&req(1, ok)).is_ok(), "{ok:?}");
        }
        for bad in [
            Batching::Canary { first: 0 },
            progressive(0, 2, 4),
            progressive(4, 2, 2),
            progressive(1, 0, 4),
        ] {
            assert!(validate_batching(&req(1, bad)).is_err(), "{bad:?}");
        }
        assert!(validate_batching(&req(0, Batching::One)).is_err());
    }

    #[test]
    fn a_fleet_without_a_state_row_lists_with_empty_state() {
        use config::meta::fleet::{Fleet, FleetState, FleetVersion};

        let folder = |id: &str| Folder {
            folder_id: id.to_string(),
            name: format!("name-{id}"),
            description: String::new(),
            icon: None,
        };
        let stored = Fleet {
            id: "f1".to_string(),
            name: "stale".to_string(),
            state: Some(FleetState {
                desired: Some(FleetVersion {
                    config: "edge".to_string(),
                    version: 2,
                }),
                collectors: 3,
                ..Default::default()
            }),
            settings: FleetSettings {
                retention_days: Some(0),
                ..Default::default()
            },
        };
        let item = fleet_item(folder("f1"), std::slice::from_ref(&stored));
        assert_eq!(item.name, "name-f1", "the folder names the fleet");
        assert_eq!(item.state, stored.state);
        assert_eq!(item.settings, stored.settings);
        let empty = fleet_item(folder("f2"), &[stored]);
        assert_eq!(empty.state, Some(FleetState::default()));
        assert_eq!(empty.settings, FleetSettings::default());
    }
}
