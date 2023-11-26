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

use actix_web::{get, post, put, web, HttpResponse, Result};
use actix_web_httpauth::extractors::basic::BasicAuth;
use std::collections::HashSet;
use std::io::Error;

use crate::common::infra::config::{STREAM_SCHEMAS, USERS};
use crate::common::meta::organization::{
    OrgDetails, OrgUser, OrganizationResponse, PasscodeResponse, RumIngestionResponse, CUSTOM,
    DEFAULT_ORG, THRESHOLD,
};
use crate::common::utils::auth::is_root_user;
use crate::service::organization::{self, update_passcode};
use crate::service::organization::{get_passcode, get_rum_token, update_rum_token};

pub mod es;
pub mod settings;

/** GetOrganizations */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetUserOrganizations",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = OrganizationResponse),
    )
)]
#[get("/{org_id}/organizations")]
pub async fn organizations(credentials: BasicAuth) -> Result<HttpResponse, Error> {
    let user_id = credentials.user_id();
    let mut id = 0;

    let mut orgs: Vec<OrgDetails> = vec![];
    let mut org_names = HashSet::new();
    let user_detail = OrgUser {
        first_name: user_id.to_string(),
        last_name: user_id.to_string(),
        email: user_id.to_string(),
    };

    let is_root_user = is_root_user(user_id);
    if is_root_user {
        id += 1;
        org_names.insert(DEFAULT_ORG.to_string());
        orgs.push(OrgDetails {
            id,
            identifier: DEFAULT_ORG.to_string(),
            name: DEFAULT_ORG.to_string(),
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: DEFAULT_ORG.to_string(),
            user_obj: user_detail.clone(),
        });

        for schema in STREAM_SCHEMAS.iter() {
            if !schema.key().contains('/') {
                continue;
            }

            id += 1;
            let org = OrgDetails {
                id,
                identifier: schema.key().split('/').collect::<Vec<&str>>()[0].to_string(),
                name: schema.key().split('/').collect::<Vec<&str>>()[0].to_string(),
                user_email: user_id.to_string(),
                ingest_threshold: THRESHOLD,
                search_threshold: THRESHOLD,
                org_type: CUSTOM.to_string(),
                user_obj: user_detail.clone(),
            };
            if !org_names.contains(&org.identifier) {
                org_names.insert(org.identifier.clone());
                orgs.push(org)
            }
        }
    }
    for user in USERS.iter() {
        if !user.key().contains('/') {
            continue;
        }
        if !user.key().ends_with(&format!("/{user_id}")) {
            continue;
        }

        id += 1;
        let org = OrgDetails {
            id,
            identifier: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
            name: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: CUSTOM.to_string(),
            user_obj: user_detail.clone(),
        };
        if !org_names.contains(&org.identifier) {
            org_names.insert(org.identifier.clone());
            orgs.push(org)
        }
    }
    orgs.sort_by(|a, b| a.name.cmp(&b.name));
    let org_response = OrganizationResponse { data: orgs };

    Ok(HttpResponse::Ok().json(org_response))
}

/** GetOrganizationSummary */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationSummary",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = OrgSummary),
    )
)]
#[get("/{org_id}/summary")]
async fn org_summary(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let org_summary = organization::get_summary(&org).await;
    Ok(HttpResponse::Ok().json(org_summary))
}

/** GetIngestToken */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationUserIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = PasscodeResponse),
    )
)]
#[get("/{org_id}/organizations/passcode")]
async fn get_user_passcode(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    let passcode = get_passcode(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode }))
}

/** UpdateIngestToken */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "UpdateOrganizationUserIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = PasscodeResponse),
    )
)]
#[put("/{org_id}/organizations/passcode")]
async fn update_user_passcode(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    let passcode = update_passcode(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode }))
}

/** GetRumIngestToken */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationUserRumIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = RumIngestionResponse),
    )
)]
#[get("/{org_id}/organizations/rumtoken")]
async fn get_user_rumtoken(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    let rumtoken = get_rum_token(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(RumIngestionResponse { data: rumtoken }))
}

/** UpdateRumIngestToken */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "UpdateOrganizationUserRumIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = RumIngestionResponse),
    )
)]
#[put("/{org_id}/organizations/rumtoken")]
async fn update_user_rumtoken(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    let rumtoken = update_rum_token(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(RumIngestionResponse { data: rumtoken }))
}

/** CreateRumIngestToken */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "CreateOrganizationUserRumIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = RumIngestionResponse),
    )
)]
#[post("/{org_id}/organizations/rumtoken")]
async fn create_user_rumtoken(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id) {
        org_id = None;
    }
    let rumtoken = update_rum_token(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(RumIngestionResponse { data: rumtoken }))
}
