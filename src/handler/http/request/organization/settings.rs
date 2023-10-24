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

use actix_web::{get, post, web, HttpResponse};
use std::io::Error;

use crate::common::{
    meta::{
        http::HttpResponse as MetaHttpResponse,
        organization::{OrganizationSetting, OrganizationSettingResponse},
    },
    utils::json,
};
use crate::service::db::organization::{get_org_setting, set_org_setting, ORG_SETTINGS_KEY_PREFIX};

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
) -> Result<HttpResponse, Error> {
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
async fn get(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();
    let org_settings = match get_org_setting(&org_id).await {
        Ok(s) => s,
        Err(e) => {
            let err = e.to_string();
            let expected_err = format!(
                "DbError# key {}/{} does not exist",
                ORG_SETTINGS_KEY_PREFIX, org_id
            );
            if err.contains(&expected_err) {
                let setting = OrganizationSetting::default();
                if let Ok(()) = set_org_setting(&org_id, &setting).await {
                    return Ok(
                        HttpResponse::Ok().json(OrganizationSettingResponse { data: setting })
                    );
                }
            }
            return Ok(MetaHttpResponse::bad_request(&err));
        }
    };
    let data: OrganizationSetting = json::from_slice(&org_settings).unwrap();
    Ok(HttpResponse::Ok().json(OrganizationSettingResponse { data }))
}
