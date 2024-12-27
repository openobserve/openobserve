// Copyright 2024 OpenObserve Inc.
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

use actix_web::{get, post, web, HttpResponse};
use config::meta::{alerts::alert::Alert as MetaAlert, folder::DEFAULT_FOLDER};
use infra::db::{connect_to_orm, ORM_CLIENT};
use svix_ksuid::Ksuid;

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::models::alerts::{
        requests::CreateAlertRequestBody, responses::GetAlertResponseBody,
    },
    service::alerts::alert::{self, AlertError},
};

#[allow(deprecated)]
pub mod deprecated;
pub mod destinations;
pub mod templates;

impl From<AlertError> for HttpResponse {
    fn from(value: AlertError) -> Self {
        match &value {
            AlertError::InfraError(err) => MetaHttpResponse::internal_error(err),
            AlertError::CreateDefaultFolderError => MetaHttpResponse::internal_error(value),
            AlertError::AlertNameMissing => MetaHttpResponse::bad_request(value),
            AlertError::AlertNameOfgaUnsupported => MetaHttpResponse::bad_request(value),
            AlertError::AlertNameContainsForwardSlash => MetaHttpResponse::bad_request(value),
            AlertError::AlertDestinationMissing => MetaHttpResponse::bad_request(value),
            AlertError::CreateAlreadyExists => MetaHttpResponse::conflict(value),
            AlertError::CreateFolderNotFound => MetaHttpResponse::not_found(value),
            AlertError::AlertNotFound => MetaHttpResponse::not_found(value),
            AlertError::AlertDestinationNotFound { .. } => MetaHttpResponse::not_found(value),
            AlertError::StreamNotFound { .. } => MetaHttpResponse::not_found(value),
            AlertError::DecodeVrl(err) => MetaHttpResponse::bad_request(err),
            AlertError::ParseCron(err) => MetaHttpResponse::bad_request(err),
            AlertError::RealtimeMissingCustomQuery => MetaHttpResponse::bad_request(value),
            AlertError::SqlMissingQuery => MetaHttpResponse::bad_request(value),
            AlertError::SqlContainsSelectStar => MetaHttpResponse::bad_request(value),
            AlertError::PromqlMissingQuery => MetaHttpResponse::bad_request(value),
            AlertError::SendNotificationError { .. } => MetaHttpResponse::internal_error(value),
            AlertError::GetDestinationWithTemplateError(error) => {
                MetaHttpResponse::internal_error(error)
            }
            AlertError::PeriodExceedsMaxQueryRange { .. } => MetaHttpResponse::bad_request(value),
            AlertError::ResolveStreamNameError(_) => MetaHttpResponse::internal_error(value),
        }
    }
}

/// CreateAlert
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateAlert",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    request_body(content = CreateAlertRequestBody, description = "Alert data", content_type = "application/json"),    
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = HttpResponse),
    )
)]
#[post("v2/{org_id}/alerts")]
pub async fn create_alert(
    path: web::Path<String>,
    req_body: web::Json<CreateAlertRequestBody>,
    user_email: UserEmail,
) -> HttpResponse {
    let org_id = path.into_inner();
    let req_body = req_body.into_inner();

    let folder_id = req_body
        .folder_id
        .clone()
        .unwrap_or(DEFAULT_FOLDER.to_string());
    let mut alert: MetaAlert = req_body.into();
    alert.owner = Some(user_email.user_id.clone());
    alert.last_edited_by = Some(user_email.user_id);

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::create(client, &org_id, &folder_id, alert).await {
        Ok(_) => MetaHttpResponse::ok("Alert saved"),
        Err(e) => e.into(),
    }
}

/// GetAlert
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlert",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = Ksuid, Path, description = "Alert ID"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = GetAlertResponseBody),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("v2/{org_id}/alerts/{alert_id}")]
async fn get_alert(path: web::Path<(String, Ksuid)>) -> HttpResponse {
    let (org_id, alert_id) = path.into_inner();

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok(alert) => {
            let resp_body: GetAlertResponseBody = alert.into();
            MetaHttpResponse::json(resp_body)
        }
        Err(e) => e.into(),
    }
}
