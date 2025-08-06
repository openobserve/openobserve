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

use std::io::Error;
#[cfg(feature = "enterprise")]
use std::time::{Duration, Instant};

use actix_web::{HttpResponse, http};
#[cfg(feature = "enterprise")]
use config::meta::ratelimit::CachedUserRoles;
use config::{get_config, ider, utils::rand::generate_random_string};
#[cfg(feature = "enterprise")]
use o2_openfga::{
    authorizer::authz::delete_service_account_from_org, config::get_config as get_openfga_config,
};
use regex::Regex;

#[cfg(feature = "enterprise")]
use crate::common::infra::config::USER_ROLES_CACHE;
use crate::{
    common::{
        infra::config::{ROOT_USER, USERS, USERS_RUM_TOKEN},
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::DEFAULT_ORG,
            user::{
                DBUser, UpdateUser, User, UserList, UserOrg, UserRequest, UserResponse, UserRole,
            },
        },
        utils::auth::{get_hash, get_role, is_root_user},
    },
    service::db,
};

pub async fn post_user(
    org_id: &str,
    usr_req: UserRequest,
    initiator_id: &str,
) -> Result<HttpResponse, Error> {
    let email_regex = Regex::new(
        r"^([a-z0-9_+]([a-z0-9_+.-]*[a-z0-9_+])?)@([a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6})",
    )
    .expect("Email regex is valid");
    if !email_regex.is_match(&usr_req.email) {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Invalid email".to_string(),
        )));
    }
    let cfg = get_config();
    let is_allowed = if is_root_user(initiator_id) {
        true
    } else {
        let initiator_user = db::user::get(Some(org_id), initiator_id).await;
        let Ok(initiator_user) = initiator_user else {
            return Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
                http::StatusCode::UNAUTHORIZED.into(),
                "Not Allowed".to_string(),
            )));
        };
        let Some(initiator_user) = initiator_user else {
            return Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
                http::StatusCode::UNAUTHORIZED.into(),
                "Not Allowed".to_string(),
            )));
        };
        initiator_user.role.eq(&UserRole::Admin)
    };

    #[cfg(feature = "enterprise")]
    let is_allowed = if get_openfga_config().enabled {
        // Permission already checked through RBAC
        true
    } else {
        is_allowed
    };

    if is_allowed {
        let existing_user = if is_root_user(&usr_req.email) {
            db::user::get(None, &usr_req.email).await
        } else {
            db::user::get(Some(org_id), &usr_req.email).await
        };
        if existing_user.is_err() {
            let salt = ider::uuid();
            let password = get_hash(&usr_req.password, &salt);
            let password_ext = get_hash(&usr_req.password, &cfg.auth.ext_auth_salt);
            let token = generate_random_string(16);
            let rum_token = format!("rum{}", generate_random_string(16));
            let org_id = org_id.replace(' ', "_");
            let user = usr_req.to_new_dbuser(
                password,
                salt,
                org_id.clone(),
                token,
                rum_token,
                usr_req.is_external,
                password_ext,
            );
            db::user::set(&user).await.unwrap();
            // Update OFGA
            #[cfg(feature = "enterprise")]
            {
                use o2_openfga::{
                    authorizer::authz::{
                        get_org_creation_tuples, get_service_account_creation_tuple,
                        get_user_role_tuple, update_tuples,
                    },
                    meta::mapping::{NON_OWNING_ORG, OFGA_MODELS},
                };
                if get_openfga_config().enabled {
                    let mut tuples = vec![];
                    get_user_role_tuple(
                        &usr_req.role.to_string(),
                        &usr_req.email,
                        &org_id,
                        &mut tuples,
                    );
                    if usr_req.role.eq(&UserRole::ServiceAccount) {
                        get_service_account_creation_tuple(&org_id, &usr_req.email, &mut tuples);
                    }
                    get_org_creation_tuples(
                        &org_id,
                        &mut tuples,
                        OFGA_MODELS
                            .iter()
                            .map(|(_, fga_entity)| fga_entity.key)
                            .collect(),
                        NON_OWNING_ORG.to_vec(),
                    )
                    .await;
                    match update_tuples(tuples, vec![]).await {
                        Ok(_) => {
                            log::info!("User saved successfully in openfga");
                        }
                        Err(e) => {
                            log::error!("Error creating user in openfga: {}", e);
                        }
                    }
                }
            }
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                "User saved successfully".to_string(),
            )))
        } else {
            Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
                http::StatusCode::BAD_REQUEST.into(),
                "User already exists".to_string(),
            )))
        }
    } else {
        Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            "Not Allowed".to_string(),
        )))
    }
}

pub async fn update_db_user(mut db_user: DBUser) -> Result<(), anyhow::Error> {
    if db_user.password.is_empty() {
        let salt = ider::uuid();
        let generated_pass = generate_random_string(8);
        let password = get_hash(&generated_pass, &salt);
        db_user.password = password;
        db_user.salt = salt;
    }
    for org in &mut db_user.organizations {
        if org.token.is_empty() {
            let token = generate_random_string(16);
            org.token = token;
        };
        if org.rum_token.is_none() {
            let rum_token = format!("rum{}", generate_random_string(16));
            org.rum_token = Some(rum_token);
        };
    }
    db::user::set(&db_user).await
}

pub async fn update_user(
    org_id: &str,
    email: &str,
    self_update: bool,
    initiator_id: &str,
    user: UpdateUser,
) -> Result<HttpResponse, Error> {
    let mut allow_password_update = false;
    let is_email_root = is_root_user(email);

    // Only root user can update root user
    if is_email_root && !self_update {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
            http::StatusCode::BAD_REQUEST.into(),
            "Root user cannot be updated".to_string(),
        )));
    }

    // Nobody can update role to root user role
    if !is_email_root && user.role.is_some() && user.role.as_ref().unwrap().eq(&UserRole::Root) {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
            http::StatusCode::BAD_REQUEST.into(),
            "Root user role cannot be updated".to_string(),
        )));
    }

    let existing_user = if is_email_root {
        db::user::get(None, email).await
    } else {
        db::user::get(Some(org_id), email).await
    };

    let mut old_role = None;
    let mut new_role = None;
    let conf = get_config();
    let password_ext_salt = conf.auth.ext_auth_salt.as_str();
    if let Ok(Some(local_user)) = existing_user {
        let mut new_user;
        let mut is_updated = false;
        let mut is_org_updated = false;
        let mut message = "";
        {
            if local_user.is_external {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Updates not allowed in OpenObserve, please update with source system"
                        .to_string(),
                )));
            }
            if !self_update {
                if is_root_user(initiator_id) {
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
                    let new_pass = user.new_password.unwrap();

                    new_user.password = get_hash(&new_pass, &local_user.salt);
                    new_user.password_ext = Some(get_hash(&new_pass, password_ext_salt));
                    log::info!("Password self updated for user: {}", email);
                    is_updated = true;
                } else {
                    message =
                        "Existing/old password mismatch, please provide valid existing password";
                    return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
                        http::StatusCode::BAD_REQUEST.into(),
                        message.to_string(),
                    )));
                }
            } else if self_update && user.old_password.is_none() {
                message = "Please provide existing password"
            } else if !self_update
                && allow_password_update
                && user.new_password.is_some()
                && !local_user.is_external
            {
                let new_pass = user.new_password.unwrap();

                new_user.password = get_hash(&new_pass, &local_user.salt);
                new_user.password_ext = Some(get_hash(&new_pass, password_ext_salt));
                log::info!("Password by root updated for user: {}", email);

                is_updated = true;
            } else {
                message = "You are not authorised to change the password"
            }
            if user.first_name.is_some() && !local_user.is_external {
                new_user.first_name = user.first_name.unwrap();
                is_updated = true;
            }
            if user.last_name.is_some() && !local_user.is_external {
                new_user.last_name = user.last_name.unwrap();
                is_updated = true;
            }
            if user.role.is_some()
                    && !local_user.is_external
                    && (!self_update
                        || (local_user.role.eq(&UserRole::Admin)
                            || local_user.role.eq(&UserRole::Root)))
                    // if the User Role is Root, we do not change the Role
                    // Admins Role can still be mutable.
                    && !local_user.role.eq(&UserRole::Root)
            {
                old_role = Some(new_user.role);
                new_user.role = user.role.unwrap();
                new_role = Some(new_user.role.clone());
                is_org_updated = true;
            }
            if user.token.is_some() {
                new_user.token = user.token.unwrap();
                is_org_updated = true;
            }
            if is_updated || is_org_updated {
                let user = db::user::get_db_user(email).await;
                match user {
                    Ok(mut db_user) => {
                        db_user.password = new_user.password;
                        db_user.password_ext = new_user.password_ext;
                        db_user.first_name = new_user.first_name;
                        db_user.last_name = new_user.last_name;
                        if is_org_updated {
                            let mut orgs = db_user.clone().organizations;
                            let new_orgs = if orgs.is_empty() {
                                vec![UserOrg {
                                    name: org_id.to_string(),
                                    token: new_user.token,
                                    rum_token: new_user.rum_token,
                                    role: new_user.role,
                                }]
                            } else {
                                orgs.retain(|org| !org.name.eq(org_id));
                                orgs.push(UserOrg {
                                    name: org_id.to_string(),
                                    token: new_user.token,
                                    rum_token: new_user.rum_token,
                                    role: new_user.role,
                                });
                                orgs
                            };
                            db_user.organizations = new_orgs;
                        }

                        db::user::set(&db_user).await.unwrap();

                        #[cfg(feature = "enterprise")]
                        {
                            use o2_openfga::authorizer::authz::update_user_role;

                            if get_openfga_config().enabled
                                && old_role.is_some()
                                && new_role.is_some()
                            {
                                let old = old_role.unwrap();
                                let new = new_role.unwrap();
                                if !old.eq(&new) {
                                    let mut old_str = old.to_string();
                                    let mut new_str = new.to_string();
                                    if old.eq(&UserRole::User) || old.eq(&UserRole::ServiceAccount)
                                    {
                                        old_str = "allowed_user".to_string();
                                    }
                                    if new.eq(&UserRole::User) || new.eq(&UserRole::ServiceAccount)
                                    {
                                        new_str = "allowed_user".to_string();
                                    }
                                    if old_str != new_str {
                                        log::debug!(
                                            "updating openfga role for {email} from {old_str} to {new_str}"
                                        );
                                        update_user_role(&old_str, &new_str, email, org_id).await;
                                    }
                                }
                            }
                        }

                        #[cfg(not(feature = "enterprise"))]
                        log::debug!("Role changed from {:?} to {:?}", old_role, new_role);
                        Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                            http::StatusCode::OK.into(),
                            "User updated successfully".to_string(),
                        )))
                    }
                    Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                        http::StatusCode::NOT_FOUND.into(),
                        "User not found".to_string(),
                    ))),
                }
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
    } else {
        Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "User not found".to_string(),
        )))
    }
}

pub async fn add_user_to_org(
    org_id: &str,
    email: &str,
    role: UserRole,
    initiator_id: &str,
) -> Result<HttpResponse, Error> {
    let existing_user = db::user::get_db_user(email).await;
    let root_user = ROOT_USER.clone();
    if existing_user.is_ok() {
        let mut db_user = existing_user.unwrap();
        let local_org;
        let initiating_user = if is_root_user(initiator_id) {
            local_org = org_id.replace(' ', "_");
            root_user.get("root").unwrap().clone()
        } else {
            local_org = org_id.to_owned();
            db::user::get(Some(org_id), initiator_id)
                .await
                .unwrap()
                .unwrap()
        };
        let role = get_role(role);
        if initiating_user.role.eq(&UserRole::Root) || initiating_user.role.eq(&UserRole::Admin) {
            let token = generate_random_string(16);
            let rum_token = format!("rum{}", generate_random_string(16));
            let mut orgs = db_user.clone().organizations;
            let new_orgs = if orgs.is_empty() {
                vec![UserOrg {
                    name: local_org.to_string(),
                    token,
                    rum_token: Some(rum_token),
                    role: role.clone(),
                }]
            } else {
                if db_user.is_external {
                    for org in orgs.iter() {
                        if org.name.eq(org_id) {
                            // External user is already part of this org
                            return Ok(HttpResponse::Conflict().json(MetaHttpResponse::error(
                                http::StatusCode::CONFLICT.into(),
                                "User is already part of the org".to_string(),
                            )));
                        }
                    }
                }
                orgs.retain(|org| !org.name.eq(&local_org));
                orgs.push(UserOrg {
                    name: local_org.to_string(),
                    token,
                    rum_token: Some(rum_token),
                    role: role.clone(),
                });
                orgs
            };
            db_user.organizations = new_orgs;
            db::user::set(&db_user).await.unwrap();

            // Update OFGA
            #[cfg(feature = "enterprise")]
            {
                use o2_openfga::{
                    authorizer::authz::{
                        get_org_creation_tuples, get_user_role_tuple, update_tuples,
                    },
                    meta::mapping::{NON_OWNING_ORG, OFGA_MODELS},
                };
                if get_openfga_config().enabled {
                    let mut tuples = vec![];
                    get_user_role_tuple(&role.to_string(), email, org_id, &mut tuples);
                    get_org_creation_tuples(
                        org_id,
                        &mut tuples,
                        OFGA_MODELS
                            .iter()
                            .map(|(_, fga_entity)| fga_entity.key)
                            .collect(),
                        NON_OWNING_ORG.to_vec(),
                    )
                    .await;
                    match update_tuples(tuples, vec![]).await {
                        Ok(_) => {
                            log::info!("User added to org successfully in openfga");
                        }
                        Err(e) => {
                            log::error!("Error adding user to the org in openfga: {}", e);
                        }
                    }
                }
            }
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                "User added to org successfully".to_string(),
            )))
        } else {
            Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
                http::StatusCode::UNAUTHORIZED.into(),
                "Not Allowed".to_string(),
            )))
        }
    } else {
        Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "User not found".to_string(),
        )))
    }
}

pub async fn get_user(org_id: Option<&str>, name: &str) -> Option<User> {
    let key = match org_id {
        Some(local_org) => format!("{local_org}/{name}"),
        None => format!("{DEFAULT_ORG}/{name}"),
    };
    let user = USERS.get(&key);
    match user {
        Some(loc_user) => Some(loc_user.value().clone()),
        None => db::user::get(org_id, name).await.ok().flatten(),
    }
}

pub async fn get_user_by_token(org_id: &str, token: &str) -> Option<User> {
    let rum_tokens = USERS_RUM_TOKEN.clone();
    let key = format!("{DEFAULT_ORG}/{token}");
    if let Some(user) = rum_tokens.get(&key) {
        return Some(user.value().clone());
    }

    let key = format!("{org_id}/{token}");
    if let Some(user) = rum_tokens.get(&key) {
        return Some(user.value().clone());
    }

    // need to drop the reference to rum_tokens to avoid deadlock of dashmap
    drop(rum_tokens);

    if let Some(user_from_db) = db::user::get_by_token(Some(org_id), token)
        .await
        .ok()
        .flatten()
    {
        if is_root_user(&user_from_db.email) {
            USERS_RUM_TOKEN
                .clone()
                .insert(format!("{DEFAULT_ORG}/{token}"), user_from_db.clone());
        }
        USERS_RUM_TOKEN.clone().insert(key, user_from_db.clone());
        Some(user_from_db)
    } else {
        log::info!(
            "get_user_by_token: User not found even in db {} {}",
            org_id,
            token
        );
        None
    }
}

pub async fn list_users(
    _user_id: &str,
    org_id: &str,
    role: Option<UserRole>,
    permitted: Option<Vec<String>>,
) -> Result<HttpResponse, Error> {
    // If the role is not
    #[cfg(feature = "enterprise")]
    if get_openfga_config().enabled {
        let need_check_permission = !matches!(role, Some(UserRole::ServiceAccount));

        if need_check_permission && permitted.is_none() {
            let mut user_list = vec![];
            if let Some(user) = USERS.get(&format!("{org_id}/{_user_id}")) {
                user_list.push(UserResponse {
                    email: user.value().email.clone(),
                    role: user.value().role.clone(),
                    first_name: user.value().first_name.clone(),
                    last_name: user.value().last_name.clone(),
                    is_external: user.value().is_external,
                });
            }
            return Ok(HttpResponse::Ok().json(UserList { data: user_list }));
        }
    }

    let mut user_list: Vec<UserResponse> = USERS
        .iter()
        .filter(|user| user.key().starts_with(&format!("{org_id}/"))) // Filter by organization ID
        .filter(|user| {
            if let Some(ref required_role) = role {
                // Filter by role if specified
                user.value().role == *required_role
            } else {
                user.value().role!=UserRole::ServiceAccount
            }
        })
        .map(|user| UserResponse {
            email: user.value().email.clone(),
            role: user.value().role.clone(),
            first_name: user.value().first_name.clone(),
            last_name: user.value().last_name.clone(),
            is_external: user.value().is_external,
        })
        .collect();

    user_list.retain(|user| {
        if user.role.eq(&UserRole::ServiceAccount)
            && let Some(permitted) = &permitted
        {
            permitted.contains(&format!("service_accounts:{}", user.email))
                || permitted.contains(&format!("service_accounts:_all_{org_id}"))
        } else {
            true
        }
    });

    #[cfg(feature = "enterprise")]
    {
        if !org_id.eq(DEFAULT_ORG) && role.is_none() {
            let root = ROOT_USER.get("root").unwrap();
            let root_user = root.value();
            let mut enterprise_user_list = user_list;
            enterprise_user_list.push(UserResponse {
                email: root_user.email.clone(),
                role: root_user.role.clone(),
                first_name: root_user.first_name.clone(),
                last_name: root_user.last_name.clone(),
                is_external: root_user.is_external,
            });
            return Ok(HttpResponse::Ok().json(UserList {
                data: enterprise_user_list,
            }));
        }
    }

    Ok(HttpResponse::Ok().json(UserList { data: user_list }))
}

pub async fn remove_user_from_org(
    org_id: &str,
    email_id: &str,
    initiator_id: &str,
) -> Result<HttpResponse, Error> {
    let initiating_user = if is_root_user(initiator_id) {
        ROOT_USER.get("root").unwrap().clone()
    } else {
        db::user::get(Some(org_id), initiator_id)
            .await
            .unwrap()
            .unwrap()
    };
    if initiating_user.role.eq(&UserRole::Root) || initiating_user.role.eq(&UserRole::Admin) {
        let ret_user = db::user::get_db_user(email_id).await;
        match ret_user {
            Ok(mut user) => {
                if is_root_user(user.email.as_str()) {
                    return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                        http::StatusCode::FORBIDDEN.into(),
                        "Not Allowed".to_string(),
                    )));
                }

                if !user.organizations.is_empty() {
                    let mut orgs = user.clone().organizations;
                    if orgs.len() == 1 {
                        if orgs[0].role.eq(&UserRole::ServiceAccount) && user.is_external {
                            return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
                                http::StatusCode::FORBIDDEN.into(),
                                "Not Allowed".to_string(),
                            )));
                        }

                        let _ = db::user::delete(email_id).await;
                        #[cfg(feature = "enterprise")]
                        {
                            use o2_openfga::authorizer::authz::delete_user_from_org;
                            let user_role = &orgs[0].role;
                            let user_fga_role = if user_role.eq(&UserRole::ServiceAccount)
                                || user_role.eq(&UserRole::User)
                            {
                                "allowed_user".to_string()
                            } else {
                                user_role.to_string()
                            };
                            if get_openfga_config().enabled {
                                log::debug!("delete user single org, role: {}", &user_fga_role);
                                delete_user_from_org(org_id, email_id, &user_fga_role).await;
                                if user_role.eq(&UserRole::ServiceAccount) {
                                    delete_service_account_from_org(org_id, email_id).await;
                                }
                            }
                        }
                    } else {
                        let mut _user_fga_role: Option<String> = None;
                        #[cfg(feature = "enterprise")]
                        let mut is_service_account = false;
                        #[cfg(feature = "enterprise")]
                        for org in orgs.iter() {
                            if org.role.eq(&UserRole::ServiceAccount) && user.is_external {
                                return Ok(HttpResponse::Forbidden().json(
                                    MetaHttpResponse::error(
                                        http::StatusCode::FORBIDDEN.into(),
                                        "Not Allowed".to_string(),
                                    ),
                                ));
                            }
                            if org.name.eq(&org_id.to_string()) {
                                let user_role = &org.role;
                                is_service_account = user_role.eq(&UserRole::ServiceAccount);
                                _user_fga_role =
                                    if is_service_account || user_role.eq(&UserRole::User) {
                                        Some("allowed_user".to_string())
                                    } else {
                                        Some(user_role.to_string())
                                    };
                            }
                        }
                        orgs.retain(|x| !x.name.eq(&org_id.to_string()));
                        user.organizations = orgs;
                        let resp = db::user::set(&user).await;
                        // special case as we cache flattened user struct
                        if resp.is_ok() {
                            USERS.remove(&format!("{org_id}/{email_id}"));
                            #[cfg(feature = "enterprise")]
                            {
                                use o2_openfga::authorizer::authz::delete_user_from_org;
                                log::debug!(
                                    "user_fga_role, multi org: {}",
                                    _user_fga_role.as_ref().unwrap()
                                );
                                if get_openfga_config().enabled && _user_fga_role.is_some() {
                                    delete_user_from_org(
                                        org_id,
                                        email_id,
                                        _user_fga_role.unwrap().as_str(),
                                    )
                                    .await;
                                    if is_service_account {
                                        delete_service_account_from_org(org_id, email_id).await;
                                    }
                                }
                            }
                        }
                    }
                    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                        http::StatusCode::OK.into(),
                        "User removed from organization".to_string(),
                    )))
                } else {
                    Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                        http::StatusCode::NOT_FOUND.into(),
                        "User for the organization not found".to_string(),
                    )))
                }
            }
            Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                http::StatusCode::NOT_FOUND.into(),
                "User for the organization not found".to_string(),
            ))),
        }
    } else {
        Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
            http::StatusCode::UNAUTHORIZED.into(),
            "Not Allowed".to_string(),
        )))
    }
}

pub async fn delete_user(email_id: &str) -> Result<HttpResponse, Error> {
    let result = db::user::delete(email_id).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "User deleted".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

pub async fn root_user_exists() -> bool {
    let local_users = ROOT_USER.clone();
    if !local_users.is_empty() {
        local_users.is_empty()
    } else {
        db::user::root_user_exists().await
    }
}

pub(crate) async fn create_root_user(org_id: &str, user_req: UserRequest) -> Result<(), Error> {
    let cfg = get_config();
    let salt = ider::uuid();
    let password = get_hash(&user_req.password, &salt);
    let password_ext = get_hash(&user_req.password, &cfg.auth.ext_auth_salt);
    let token = user_req
        .token
        .clone()
        .unwrap_or_else(|| generate_random_string(16));
    let rum_token = format!(
        "rum{}",
        user_req
            .token
            .clone()
            .unwrap_or_else(|| generate_random_string(16))
    );
    let user = user_req.to_new_dbuser(
        password,
        salt,
        org_id.replace(' ', "_"),
        token,
        rum_token,
        user_req.is_external,
        password_ext,
    );
    db::user::set(&user).await.unwrap();
    Ok(())
}

#[cfg(feature = "enterprise")]
pub async fn get_user_roles(user_email: &str, org_id: Option<&str>) -> Vec<String> {
    if let Some(roles) = check_cache(user_email).await {
        return get_user_roles_by_org_id(roles, org_id);
    }

    let roles = o2_openfga::authorizer::roles::get_roles_for_user(user_email).await;
    update_cache(user_email, roles.clone()).await;

    get_user_roles_by_org_id(roles, org_id)
}
#[cfg(feature = "enterprise")]
fn get_user_roles_by_org_id(roles: Vec<String>, org_id: Option<&str>) -> Vec<String> {
    match org_id {
        Some(org_id) => roles
            .iter()
            .filter_map(|role| {
                let parts: Vec<&str> = role.split('/').collect();
                if parts.first() == Some(&org_id) {
                    parts.get(1).map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect(),
        None => roles,
    }
}
#[cfg(feature = "enterprise")]
async fn check_cache(user_email: &str) -> Option<Vec<String>> {
    let cache = USER_ROLES_CACHE.read().await;
    if let Some(cached) = cache.get(user_email) {
        if cached.expires_at > Instant::now() {
            return Some(cached.roles.clone());
        }
    }
    None
}
#[cfg(feature = "enterprise")]
async fn update_cache(user_email: &str, roles: Vec<String>) {
    let mut cache = USER_ROLES_CACHE.write().await;
    cache.insert(
        user_email.to_string(),
        CachedUserRoles {
            roles,
            expires_at: Instant::now() + Duration::from_secs(60),
        },
    );
}

#[cfg(test)]
mod tests {
    use infra::db as infra_db;

    use super::*;

    async fn set_up() {
        USERS.insert(
            "dummy/admin@zo.dev".to_string(),
            User {
                email: "admin@zo.dev".to_string(),
                password: "pass#123".to_string(),
                role: crate::common::meta::user::UserRole::Admin,
                salt: String::new(),
                token: "token".to_string(),
                rum_token: Some("rum_token".to_string()),
                first_name: "admin".to_owned(),
                last_name: "".to_owned(),
                org: "dummy".to_string(),
                is_external: false,
                password_ext: Some("pass#123".to_string()),
            },
        );
    }

    #[tokio::test]
    async fn test_list_users() {
        set_up().await;
        assert!(list_users("", "dummy", None, None).await.is_ok())
    }

    #[tokio::test]
    async fn test_root_user_exists() {
        set_up().await;
        assert!(!root_user_exists().await);
    }

    #[tokio::test]
    async fn test_get_user() {
        set_up().await;
        assert!(get_user(Some("dummy"), "admin@zo.dev").await.is_some())
    }

    #[tokio::test]
    async fn test_post_user() {
        infra_db::create_table().await.unwrap();
        set_up().await;

        let resp = post_user(
            "dummy",
            UserRequest {
                email: "user@zo.dev".to_string(),
                password: "pass#123".to_string(),
                role: crate::common::meta::user::UserRole::Admin,
                first_name: "user".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
                token: None,
            },
            "admin@zo.dev",
        )
        .await;
        assert!(resp.is_ok());
    }

    #[tokio::test]
    async fn test_user() {
        infra_db::create_table().await.unwrap();
        set_up().await;

        let resp = update_user(
            "dummy",
            "user2@example.com",
            true,
            "user2@example.com",
            UpdateUser {
                token: Some("new_token".to_string()),
                first_name: Some("first_name".to_string()),
                last_name: Some("last_name".to_string()),
                old_password: Some("pass".to_string()),
                new_password: Some("new_pass".to_string()),
                role: Some(crate::common::meta::user::UserRole::Member),
                change_password: false,
            },
        )
        .await;

        assert!(resp.is_ok());

        let resp = update_user(
            "dummy",
            "user2@example.com",
            false,
            "admin@zo.dev",
            UpdateUser {
                token: Some("new_token".to_string()),
                first_name: Some("first_name".to_string()),
                last_name: Some("last_name".to_string()),
                old_password: None,
                new_password: None,
                role: Some(crate::common::meta::user::UserRole::Admin),
                change_password: false,
            },
        )
        .await;

        assert!(resp.is_ok());

        let resp = add_user_to_org(
            "dummy",
            "user2@example.com",
            UserRole::Member,
            "admin@zo.dev",
        )
        .await;

        assert!(resp.is_ok());

        let resp = remove_user_from_org("dummy", "user2@example.com", "admin@zo.dev").await;

        assert!(resp.is_ok());
    }
}
