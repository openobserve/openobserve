// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use crate::common::meta::organization::OrganizationSettingResponse;
use crate::common::utils::json;
use crate::service::db::organization::get_org_setting;
use crate::{
    common::meta::{self, organization::OrganizationSetting},
    service::db::organization::set_org_setting,
};
use actix_web::{get, http, post, web, HttpResponse};
use std::io::Error;

/** Organization specific settings */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "OrganizationSetting",
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
) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    if settings.scrape_interval == 0 {
        return bad_request("scrape_interval should be a positive value");
    }

    match set_org_setting(&org_id, &settings).await {
        Ok(()) => Ok(HttpResponse::Ok().json(serde_json::json!({"successful": "true"}))),
        Err(e) => bad_request(e.to_string().as_str()),
    }
}

/** Retrieve organization specific settings*/
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "OrganizationSetting",
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
async fn get(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let settings = match get_org_setting(&org_id).await {
        Ok(settings) => settings,
        Err(e) => {
            let err = e.to_string();
            let expected_err = format!("DbError# key /organization/{org_id} does not exist");
            if err.contains(&expected_err) {
                let setting = OrganizationSetting::default();
                if let Ok(()) = set_org_setting(&org_id, &setting).await {
                    return Ok(
                        HttpResponse::Ok().json(OrganizationSettingResponse { data: setting })
                    );
                }
            }
            return bad_request(&err);
        }
    };
    let data: OrganizationSetting = json::from_slice(&settings).unwrap();
    Ok(HttpResponse::Ok().json(OrganizationSettingResponse { data }))
}

fn bad_request(message: &str) -> Result<HttpResponse, Error> {
    Ok(
        HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            message.to_string(),
        )),
    )
}
