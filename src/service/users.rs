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

use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use std::io::Error;
use uuid::Uuid;

use crate::infra::config::{CONFIG, USERS};
use crate::meta::user::{User, UserList, UserResponse};
use crate::{common::auth::get_hash, meta::http::HttpResponse as MetaHttpResponse};

use super::db;

pub async fn post_user(org_id: &str, mut user: User) -> Result<HttpResponse, Error> {
    let salt = Uuid::new_v4().to_string();
    user.password = get_hash(&user.password, &salt);
    user.salt = salt;
    db::user::set(org_id, user).await.unwrap();
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "User saved successfully".to_string(),
    )))
}

pub async fn get_user(org_id: Option<&str>, name: &str) -> Option<User> {
    let mut local_org = "";
    let user_key = if name.eq(&CONFIG.auth.useremail) {
        name.to_owned()
    } else {
        match org_id {
            Some(org) => {
                local_org = org;
                format!("{}/{}", org, name)
            }
            None => name.to_owned(),
        }
    };
    let user = USERS.get(&user_key);
    match user {
        Some(loc_user) => Some(loc_user.value().clone()),
        None => {
            let res = db::user::get(Some(local_org), name).await;
            if res.is_err() {
                None
            } else {
                res.unwrap()
            }
        }
    }
}

pub async fn list_user(org_id: &str) -> Result<HttpResponse, Error> {
    let mut user_list: Vec<UserResponse> = vec![];
    for user in USERS.iter() {
        if user.key().contains(org_id) {
            user_list.push(UserResponse {
                email: user.value().email.clone(),
                role: user.value().role.clone(),
                first_name: user.value().first_name.clone(),
                last_name: user.value().last_name.clone(),
            })
        }
    }
    Ok(HttpResponse::Ok().json(UserList { data: user_list }))
}

pub async fn delete_user(org_id: &str, name: &str) -> Result<HttpResponse, Error> {
    let result = db::user::delete(org_id, name).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "User deleted".to_string(),
        ))),
        Err(err) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some(err.to_string()),
        ))),
    }
}
