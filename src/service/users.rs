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

use super::db;
use crate::{common::auth::get_hash, meta::http::HttpResponse as MetaHttpResponse};
use crate::{
    handler::http::auth::is_root_user,
    meta::user::{User, UserList, UserResponse, UserRole},
};
use crate::{
    infra::config::{CONFIG, USERS},
    meta::user::UpdateUser,
};

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

pub async fn update_user(
    org_id: &str,
    email: &str,
    self_update: bool,
    initiator_id: &str,
    user: UpdateUser,
) -> Result<HttpResponse, Error> {
    let mut allow_password_update = false;

    let existing_user = if is_root_user(email).await {
        db::user::get(None, email).await
    } else {
        db::user::get(Some(org_id), email).await
    };

    if existing_user.is_ok() {
        let mut new_user;
        let mut is_updated = false;
        let mut message = "";
        match existing_user.unwrap() {
            Some(local_user) => {
                if !self_update {
                    if is_root_user(initiator_id).await {
                        allow_password_update = true
                    } else {
                        let initiating_user = db::user::get(Some(org_id), initiator_id)
                            .await
                            .unwrap()
                            .unwrap();
                        if (local_user.role.eq(&UserRole::Root)
                            && initiating_user.role.eq(&UserRole::Root))
                            || (!local_user.role.eq(&UserRole::Root)
                                && (initiating_user.role.eq(&UserRole::Admin)
                                    || initiating_user.role.eq(&UserRole::Root)))
                        {
                            allow_password_update = true
                        }
                    }
                }

                new_user = local_user.clone();
                if self_update && user.old_password.is_some() && user.new_password.is_some() {
                    if local_user.password.eq(&get_hash(
                        &user.clone().old_password.unwrap(),
                        &local_user.salt,
                    )) {
                        new_user.password = get_hash(&user.new_password.unwrap(), &local_user.salt);
                        is_updated = true;
                    } else {
                        message =
                        "Existing/old password mismatch , please provide valid existing password"
                    }
                } else if self_update && user.old_password.is_none() {
                    message = "Please provide existing password"
                } else if !self_update && allow_password_update && user.new_password.is_some() {
                    new_user.password = get_hash(&user.new_password.unwrap(), &local_user.salt);
                    is_updated = true;
                } else {
                    message = "You are not authorised to change the password"
                }
                if user.first_name.is_some() {
                    new_user.first_name = user.first_name.unwrap();
                    is_updated = true;
                }
                if user.last_name.is_some() {
                    new_user.last_name = user.last_name.unwrap();
                    is_updated = true;
                }
                if user.role.is_some()
                    && (!self_update
                        || (local_user.role.eq(&UserRole::Admin)
                            || local_user.role.eq(&UserRole::Root)))
                {
                    new_user.role = user.role.unwrap();
                    is_updated = true;
                }
                if user.token.is_some() {
                    new_user.token = user.token.unwrap();
                    is_updated = true;
                }
                if is_updated {
                    db::user::set(org_id, new_user).await.unwrap();
                    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                        http::StatusCode::OK.into(),
                        "User updated successfully".to_string(),
                    )))
                } else {
                    if message.is_empty() {
                        message = "Not allowed to update";
                    }
                    Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
                        http::StatusCode::BAD_REQUEST.into(),
                        message.to_string(),
                    )))
                }
            }
            None => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                Some("User not found".to_string()),
            ))),
        }
    } else {
        Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some("User not found".to_string()),
        )))
    }
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

pub async fn list_users(org_id: &str) -> Result<HttpResponse, Error> {
    let mut user_list: Vec<UserResponse> = vec![];
    for user in USERS.iter() {
        if user.key().contains(org_id) || !user.key().contains('/') {
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

pub async fn delete_user(org_id: &str, email_id: &str) -> Result<HttpResponse, Error> {
    let result = db::user::delete(org_id, email_id).await;
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

pub async fn root_user_exists() -> bool {
    let local_users = USERS.clone();
    if !local_users.is_empty() {
        local_users.retain(|k, v| k.contains('/') && v.role.eq(&UserRole::Root));
        local_users.is_empty()
    } else {
        db::user::root_user_exists().await
    }
}
