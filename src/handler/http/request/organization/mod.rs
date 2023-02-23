// Copyright 2022 Zinc Labs Inc. and Contributors
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

use actix_web::{get, put, web, HttpResponse, Result};
use actix_web_httpauth::extractors::basic::BasicAuth;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Error;

use crate::common::auth::is_root_user;
use crate::infra::config::USERS;
use crate::meta::organization::PasscodeResponse;
use crate::service::organization::get_passcode;
use crate::service::organization::{self, update_passcode};

const DEFAULT: &str = "default";
const CUSTOM: &str = "custom";
const THRESHOLD: i64 = 9383939382;

#[derive(Serialize, Clone, PartialEq, Eq)]
struct Organization {
    identifier: String,
    label: String,
}

#[derive(Serialize, Clone, PartialEq, Eq)]
struct User {
    first_name: String,
    last_name: String,
    email: String,
}

#[derive(Serialize, Clone, Eq)]
struct OrganizationDetails {
    id: i64,
    identifier: String,
    name: String,
    user_email: String,
    ingest_threshold: i64,
    search_threshold: i64,
    #[serde(rename = "type")]
    org_type: String,
    #[serde(rename = "UserObj")]
    user_obj: User,
}

impl PartialEq for OrganizationDetails {
    fn eq(&self, other: &Self) -> bool {
        self.identifier.eq(&other.identifier)
            && self.name.eq(&other.name)
            && self.user_email.eq(&other.user_email)
            && self.org_type.eq(&other.org_type)
    }
}

#[derive(Serialize)]
struct OrganizationResponse {
    data: Vec<OrganizationDetails>,
}

#[get("/organizarions_by_username/{user_name}")]
pub async fn organizarions_by_username(user_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let mut orgs = Vec::new();
    let mut org_names = HashSet::new();
    let user_id = user_id.to_string();
    let user_id = user_id.as_str();
    let is_root_user = is_root_user(user_id).await;
    if is_root_user {
        let org = Organization {
            identifier: DEFAULT.to_string(),
            label: DEFAULT.to_string(),
        };
        org_names.insert(DEFAULT.to_string());
        orgs.push(org);
    }

    for user in USERS.iter() {
        if !user.key().contains('/') {
            continue;
        }
        if !is_root_user && !user.key().ends_with(format!("/{}", user_id).as_str()) {
            continue;
        }
        let org = Organization {
            identifier: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
            label: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
        };
        if !org_names.contains(&org.identifier) {
            org_names.insert(org.identifier.clone());
            orgs.push(org);
        }
    }

    Ok(HttpResponse::Ok().json(orgs))
}

#[get("/{org_id}/organizations")]
pub async fn organizations(credentials: BasicAuth) -> Result<HttpResponse, Error> {
    //let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut id = 0;

    let mut orgs: Vec<OrganizationDetails> = vec![];
    let mut org_names = HashSet::new();
    let user_detail = User {
        first_name: user_id.to_string(),
        last_name: user_id.to_string(),
        email: user_id.to_string(),
    };

    let is_root_user = is_root_user(user_id).await;
    if is_root_user {
        id += 1;
        org_names.insert(DEFAULT.to_string());
        orgs.push(OrganizationDetails {
            id,
            identifier: DEFAULT.to_string(),
            name: DEFAULT.to_string(),
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: DEFAULT.to_string(),
            user_obj: user_detail.clone(),
        });
    }

    for user in USERS.iter() {
        if !user.key().contains('/') {
            continue;
        }
        if !is_root_user && !user.key().ends_with(format!("/{}", user_id).as_str()) {
            continue;
        }

        id += 1;
        let org = OrganizationDetails {
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

    let org_response = OrganizationResponse { data: orgs };

    Ok(HttpResponse::Ok().json(org_response))
}

#[get("/{org_id}/summary")]
async fn org_summary(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let org_summary = organization::get_summary(&org).await;
    Ok(HttpResponse::Ok().json(org_summary))
}

#[get("/{org_id}/organizations/passcode")]
async fn get_user_passcode(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id).await {
        org_id = None;
    }
    let passcode = get_passcode(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode }))
}

#[put("/{org_id}/organizations/passcode")]
async fn update_user_passcode(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id).await {
        org_id = None;
    }
    let passcode = update_passcode(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode }))
}
