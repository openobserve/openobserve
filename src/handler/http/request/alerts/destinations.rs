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

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::Response,
};

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::{
        extractors::Headers,
        models::destinations::Destination,
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
    service::{alerts::destinations, db::alerts::destinations::DestinationError},
};

impl From<DestinationError> for Response {
    fn from(value: DestinationError) -> Self {
        match &value {
            DestinationError::UsedByAlert(_) => MetaHttpResponse::conflict(value),
            DestinationError::UsedByPipeline(_) => MetaHttpResponse::conflict(value),
            DestinationError::InfraError(err) => MetaHttpResponse::internal_error(err),
            DestinationError::NotFound => MetaHttpResponse::not_found(value),
            other_err => MetaHttpResponse::bad_request(other_err),
        }
    }
}

/// CreateDestination
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/destinations",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateDestination",
    summary = "Create alert or pipeline destination",
    description = "Creates a new destination configuration for an organization. Destinations define where notifications \
                   are sent (for alerts) or where data is routed (for pipelines). For alert destinations, this includes \
                   webhooks, email addresses, Slack channels, PagerDuty integrations, and other notification services. \
                   For pipeline destinations, this includes external systems like OpenObserve, Splunk, Elasticsearch, etc. \
                   Use the 'module' query parameter to specify destination type: 'alert' (default) or 'pipeline'.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("module" = Option<String>, Query, description = "Destination module type: 'alert' (default) or 'pipeline'"),
      ),
    request_body(content = inline(Destination), description = "Destination data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create alert/pipeline destination, alert destination must have a template", "category": "alerts"}))
    )
)]
pub async fn save_destination(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Json(dest): Json<Destination>,
) -> Response {
    // Check the module query parameter to determine if this is an alert or pipeline destination
    let module = query.get("module").map(|s| s.as_str());
    let is_alert = module != Some("pipeline");

    let dest = match dest.into(org_id, is_alert) {
        Ok(dest) => dest,
        Err(e) => return e.into(),
    };
    match destinations::save("", dest, true).await {
        Ok(v) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Destination saved")
                .with_id(v.id.map(|id| id.to_string()).unwrap_or_default())
                .with_name(v.name),
        ),
        Err(e) => e.into(),
    }
}

/// UpdateDestination
#[utoipa::path(
    put,
    path = "/{org_id}/alerts/destinations/{destination_name}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateDestination",
    summary = "Update alert or pipeline destination",
    description = "Updates an existing destination configuration. For alert destinations, allows modification of settings \
                   such as webhook URLs, authentication credentials, notification channels, and other delivery parameters. \
                   For pipeline destinations, allows updating external system endpoints, output formats, and metadata. \
                   Use the 'module' query parameter to specify destination type: 'alert' (default) or 'pipeline'.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("destination_name" = String, Path, description = "Destination name"),
        ("module" = Option<String>, Query, description = "Destination module type: 'alert' (default) or 'pipeline'"),
      ),
    request_body(content = inline(Destination), description = "Destination data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update alert destination", "category": "alerts"}))
    )
)]
pub async fn update_destination(
    Path((org_id, name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Json(dest): Json<Destination>,
) -> Response {
    // Check the module query parameter to determine if this is an alert or pipeline destination
    let module = query.get("module").map(|s| s.as_str());
    let is_alert = module != Some("pipeline");

    let dest = match dest.into(org_id, is_alert) {
        Ok(dest) => dest,
        Err(e) => return e.into(),
    };
    match destinations::save(&name, dest, false).await {
        Ok(_) => MetaHttpResponse::ok("Destination updated"),
        Err(e) => e.into(),
    }
}

/// GetDestination
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/destinations/{destination_name}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetDestination",
    summary = "Get alert destination",
    description = "Retrieves the configuration details for a specific alert destination. Returns the complete destination \
                   setup including delivery method, authentication credentials, notification settings, and other \
                   configuration parameters. Used for reviewing and managing existing destination configurations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("destination_name" = String, Path, description = "Destination name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(Destination)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get destination details", "category": "alerts"}))
    )
)]
pub async fn get_destination(Path((org_id, name)): Path<(String, String)>) -> Response {
    match destinations::get(&org_id, &name).await {
        Ok(data) => MetaHttpResponse::json(Destination::from(data)),
        Err(e) => MetaHttpResponse::not_found(e),
    }
}

/// ListDestinations
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/destinations",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListDestinations",
    summary = "List alert destinations",
    description = "Retrieves a list of all alert destinations configured for an organization. Optionally filter by module \
                   type (alert or pipeline) to get specific destination categories. Returns destination names, types, and \
                   basic configuration details to help administrators manage notification routing and review available \
                   delivery options.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("module" = Option<String>, Query, description = "Destination module filter, none, alert, or pipeline"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Destination>)),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all alert destinations", "category": "alerts"}))
    )
)]
pub async fn list_destinations(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let module = query.get("module").map(|s| s.as_str());

    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id,
            "GET",
            "destination",
        )
        .await
        {
            Ok(list) => {
                _permitted = list;
            }
            Err(e) => {
                return crate::common::meta::http::HttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }

    match destinations::list(&org_id, module, _permitted).await {
        Ok(data) => {
            MetaHttpResponse::json(data.into_iter().map(Destination::from).collect::<Vec<_>>())
        }
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// DeleteDestination
#[utoipa::path(
    delete,
    path = "/{org_id}/alerts/destinations/{destination_name}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertDestination",
    summary = "Delete alert destination",
    description = "Removes an alert destination configuration from the organization. The destination must not be in use by \
                   any active alerts or pipelines before deletion. Once deleted, any alerts previously configured to use \
                   this destination will need to be updated with alternative notification methods to continue functioning.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("destination_name" = String, Path, description = "Destination name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 409, description = "Conflict", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete alert destination", "category": "alerts"}))
    )
)]
pub async fn delete_destination(Path((org_id, name)): Path<(String, String)>) -> Response {
    match destinations::delete(&org_id, &name).await {
        Ok(_) => MetaHttpResponse::ok("Alert destination deleted"),
        Err(e) => e.into(),
    }
}

/// DeleteDestinationBulk
#[utoipa::path(
    delete,
    path = "/{org_id}/alerts/destinations/bulk",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertDestinationBulk",
    summary = "Delete multiple alert destination",
    description = "Removes multiple alert destination configuration from the organization. The destinations must not be in use by \
                   any active alerts or pipelines before deletion. Once deleted, any alerts previously configured to use \
                   these destination will need to be updated with alternative notification methods to continue functioning.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "Destination ids", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_destination_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for name in &req.ids {
        if !check_permissions(name, &org_id, &_user_id, "destinations", "DELETE", None).await {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for name in req.ids {
        match destinations::delete(&org_id, &name).await {
            Ok(_) => {
                successful.push(name);
            }
            Err(e) => {
                log::error!("error deleting destination {org_id}/{name} : {e}");
                unsuccessful.push(name);
                err = Some(e.to_string());
            }
        }
    }
    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}
