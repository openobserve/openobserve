// Copyright 2023 Zinc Labs Inc.
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

use crate::{
    common::{
        infra::errors::{DbError, Error},
        meta::{
            http::HttpResponse as MetaHttpResponse, organization::OrganizationSetting,
            organization::OrganizationSettingResponse,
        },
        utils::json,
    },
    service::db::organization::{get_org_setting, set_org_setting},
};

use actix_web::{get, post, web, HttpResponse};
use std::io::Error as StdErr;

/** Organization specific settings */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "OrganizationSettingCreate",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = OrganizationSetting, description = "Organization settings", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/settings")]
async fn create(
    path: web::Path<String>,
    settings: web::Json<OrganizationSetting>,
) -> Result<HttpResponse, StdErr> {
    if settings.scrape_interval == 0 {
        return Ok(MetaHttpResponse::bad_request(
            "scrape_interval should be a positive value",
        ));
    }

    let org_id = path.into_inner();
    match set_org_setting(&org_id, &settings).await {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({"successful": "true"}))),
        Err(e) => Ok(MetaHttpResponse::bad_request(e.to_string().as_str())),
    }
}

/** Retrieve organization specific settings*/
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "OrganizationSettingGet",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/settings")]
async fn get(path: web::Path<String>) -> Result<HttpResponse, StdErr> {
    let org_id = path.into_inner();
    match get_org_setting(&org_id).await {
        Ok(s) => {
            let data: OrganizationSetting = json::from_slice(&s).unwrap();
            Ok(HttpResponse::Ok().json(OrganizationSettingResponse { data }))
        }
        Err(err) => {
            if let Error::DbError(DbError::KeyNotExists(_e)) = &err {
                let setting = OrganizationSetting::default();
                if let Ok(()) = set_org_setting(&org_id, &setting).await {
                    return Ok(
                        HttpResponse::Ok().json(OrganizationSettingResponse { data: setting })
                    );
                }
            };
            Ok(MetaHttpResponse::bad_request(&err))
        }
    }
}
