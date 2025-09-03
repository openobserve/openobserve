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

use std::{collections::HashMap, io::Error};

use actix_web::{HttpRequest, HttpResponse, delete, get, http::StatusCode, post, put, web};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::destinations::Destination,
    service::{alerts::destinations, db::alerts::destinations::DestinationError},
};

impl From<DestinationError> for HttpResponse {
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
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateDestination",
    summary = "Create alert destination",
    description = "Creates a new alert destination configuration for an organization. Destinations define where alert \
                   notifications are sent when alert conditions are met, including webhooks, email addresses, Slack \
                   channels, PagerDuty integrations, and other notification services. The destination can be used by \
                   multiple alerts within the organization.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    request_body(content = Destination, description = "Destination data", content_type = "application/json"),  
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "create"}))
    )
)]
#[post("/{org_id}/alerts/destinations")]
pub async fn save_destination(
    path: web::Path<String>,
    dest: web::Json<Destination>,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let dest = match dest.into_inner().into(org_id) {
        Ok(dest) => dest,
        Err(e) => return Ok(e.into()),
    };
    log::warn!("dest module is alert: {}", dest.is_alert_destinations());
    match destinations::save("", dest, true).await {
        Ok(v) => Ok(MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Destination saved")
                .with_id(v.id.map(|id| id.to_string()).unwrap_or_default())
                .with_name(v.name),
        )),
        Err(e) => Ok(e.into()),
    }
}

/// UpdateDestination
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateDestination",
    summary = "Update alert destination",
    description = "Updates an existing alert destination configuration. Allows modification of destination settings such as \
                   webhook URLs, authentication credentials, notification channels, and other delivery parameters. The \
                   updated configuration will apply to all future alert notifications using this destination.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("destination_name" = String, Path, description = "Destination name"),
      ),
    request_body(content = Destination, description = "Destination data", content_type = "application/json"),  
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "update"}))
    )
)]
#[put("/{org_id}/alerts/destinations/{destination_name}")]
pub async fn update_destination(
    path: web::Path<(String, String)>,
    dest: web::Json<Destination>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let dest = match dest.into_inner().into(org_id) {
        Ok(dest) => dest,
        Err(e) => return Ok(e.into()),
    };
    match destinations::save(&name, dest, false).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Destination updated")),
        Err(e) => Ok(e.into()),
    }
}

/// GetDestination
#[utoipa::path(
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
        (status = 200, description = "Success",  content_type = "application/json", body = Destination),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()), 
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "get"}))
    )
)]
#[get("/{org_id}/alerts/destinations/{destination_name}")]
async fn get_destination(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match destinations::get(&org_id, &name).await {
        Ok(data) => Ok(MetaHttpResponse::json(Destination::from(data))),
        Err(e) => Ok(MetaHttpResponse::not_found(e)),
    }
}

/// ListDestinations
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<Destination>),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "list"}))
    )
)]
#[get("/{org_id}/alerts/destinations")]
async fn list_destinations(
    path: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let module = query.get("module").map(|s| s.as_str());

    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        let user_id = req.headers().get("user_id").unwrap();
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id.to_str().unwrap(),
            "GET",
            "destination",
        )
        .await
        {
            Ok(list) => {
                _permitted = list;
            }
            Err(e) => {
                return Ok(crate::common::meta::http::HttpResponse::forbidden(
                    e.to_string(),
                ));
            }
        }
        // Get List of allowed objects ends
    }

    match destinations::list(&org_id, module, _permitted).await {
        Ok(data) => Ok(MetaHttpResponse::json(
            data.into_iter().map(Destination::from).collect::<Vec<_>>(),
        )),
        Err(e) => Ok(MetaHttpResponse::bad_request(e)),
    }
}

/// DeleteDestination
#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Destinations", "operation": "delete"}))
    )
)]
#[delete("/{org_id}/alerts/destinations/{destination_name}")]
async fn delete_destination(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    match destinations::delete(&org_id, &name).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Alert destination deleted")),
        Err(e) => Ok(e.into()),
    }
}
