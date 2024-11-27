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

use std::io::Error;

use actix_web::{http, HttpResponse};
use config::{
    get_config, ider,
    meta::user::{DBUser, User, UserOrg, UserRole},
    utils::rand::generate_random_string,
};
use hashbrown::HashMap;
use infra::table::org_users::OrgUserRecord;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;

use super::db::org_users::get_cached_user_org;
#[cfg(feature = "enterprise")]
use crate::common::meta::user::{InviteStatus, UserInvite, UserInviteList};
use crate::{
    common::{
        infra::config::{ORG_USERS, ROOT_USER, USERS_RUM_TOKEN},
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{OrgRoleMapping, DEFAULT_ORG},
            user::{
                get_default_user_org, UpdateUser, UserList, UserOrgRole, UserRequest, UserResponse,
            },
        },
        utils::auth::{get_hash, get_role, is_root_user},
    },
    service::{db, organization},
};

pub async fn post_user(
    org_id: &str,
    usr_req: UserRequest,
    initiator_id: &str,
) -> Result<HttpResponse, Error> {
    let initiator_user = if is_root_user(initiator_id) {
        db::user::get(None, initiator_id).await
    } else {
        db::user::get(Some(org_id), initiator_id).await
    };
    let cfg = get_config();

    let Ok(initiator_user) = initiator_user else {
        return Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
            http::StatusCode::UNAUTHORIZED.into(),
            "Not Allowed".to_string(),
        )));
    };
    let Some(_initiator_user) = initiator_user else {
        return Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
            http::StatusCode::UNAUTHORIZED.into(),
            "Not Allowed".to_string(),
        )));
    };

    // For non-enterprise, it is only Admin or Root user
    #[cfg(not(feature = "enterprise"))]
    let is_allowed = true;
    #[cfg(feature = "enterprise")]
    let is_allowed = if get_o2_config().openfga.enabled {
        // Permission already checked through RBAC
        true
    } else {
        _initiator_user.role.eq(&UserRole::Root) || _initiator_user.role.eq(&UserRole::Admin)
    };
    if is_root_user(initiator_id) || is_allowed {
        let existing_user = if is_root_user(&usr_req.email) {
            db::user::get(None, &usr_req.email).await
        } else {
            db::user::get(Some(org_id), &usr_req.email).await
        };
        if existing_user.is_err() {
            if !usr_req.is_external {
                if usr_req.password.is_empty() {
                    return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
                        http::StatusCode::BAD_REQUEST.into(),
                        "Password required to create new user".to_string(),
                    )));
                }
            }
            let salt = ider::uuid();
            let password = get_hash(&usr_req.password, &salt);
            let password_ext = get_hash(&usr_req.password, &cfg.auth.ext_auth_salt);
            let token = generate_random_string(16);
            let rum_token = format!("rum{}", generate_random_string(16));
            let user = usr_req.to_new_dbuser(
                password,
                salt,
                org_id.replace(' ', "_"),
                token,
                rum_token,
                usr_req.is_external,
                password_ext,
            );

            // Save the user in the database
            if db::user::add(&user).await.is_err() {
                return Ok(
                    HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                        "Failed to save user".to_string(),
                    )),
                );
            }
            // Update OFGA
            #[cfg(feature = "enterprise")]
            {
                use o2_enterprise::enterprise::openfga::authorizer::authz::{
                    get_user_crole_tuple, get_user_role_tuple, update_tuples,
                };
                if get_o2_config().openfga.enabled {
                    let mut tuples = vec![];
                    let org_id = org_id.replace(' ', "_");
                    get_user_role_tuple(
                        &usr_req.role.base_role.to_string(),
                        &usr_req.email,
                        &org_id,
                        &mut tuples,
                    );
                    if usr_req.role.custom_role.is_some() {
                        let custom_role = usr_req.role.custom_role.unwrap();
                        tuples.push(get_user_crole_tuple(&org_id, &custom_role, &usr_req.email));
                    }
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
        Ok(HttpResponse::Unauthorized().json(MetaHttpResponse::error(
            http::StatusCode::UNAUTHORIZED.into(),
            "Not Allowed".to_string(),
        )))
    }
}

pub async fn create_new_user(mut db_user: DBUser) -> Result<(), anyhow::Error> {
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
    db::user::add(&db_user).await?;
    Ok(())
}

pub async fn update_user(
    org_id: &str,
    email: &str,
    self_update: bool,
    initiator_id: &str,
    user: UpdateUser,
) -> Result<HttpResponse, Error> {
    let mut allow_password_update = false;

    let existing_user = if is_root_user(email) {
        db::user::get(None, email).await
    } else {
        db::user::get(Some(org_id), email).await
    };

    let mut old_role = None;
    let mut new_role = None;
    let conf = get_config();
    let password_ext_salt = conf.auth.ext_auth_salt.as_str();
    if existing_user.is_ok() {
        let mut new_user;
        let mut is_updated = false;
        let mut is_org_updated = false;
        let mut message = "";
        match existing_user.unwrap() {
            Some(local_user) => {
                if local_user.is_external {
                    return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
                        http::StatusCode::BAD_REQUEST.into(),
                        "Updates not allowed with external users, please update with source system"
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
                        message = "Existing/old password mismatch, please provide valid existing password";
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
                    let new_org_role = UserOrgRole::from(&user.role.unwrap());
                    old_role = Some(new_user.role);
                    new_user.role = new_org_role.base_role;
                    new_role = Some(new_user.role.clone());
                    is_org_updated = true;
                }
                if user.token.is_some() {
                    new_user.token = user.token.unwrap();
                    is_org_updated = true;
                }

                if !message.is_empty() {
                    return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::message(
                        http::StatusCode::BAD_REQUEST.into(),
                        message.to_string(),
                    )));
                }

                if is_updated
                    && db::user::update(
                        email,
                        &new_user.first_name,
                        &new_user.last_name,
                        &new_user.password,
                        new_user.password_ext,
                    )
                    .await
                    .is_err()
                {
                    return Ok(
                        HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                            http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                            "Failed to update user".to_string(),
                        )),
                    );
                }

                // Update the organization membership
                if is_org_updated {
                    if db::org_users::get(org_id, email).await.is_ok() {
                        if let Err(e) = db::org_users::update(
                            org_id,
                            email,
                            new_user.role.into(),
                            &new_user.token,
                            new_user.rum_token,
                        )
                        .await
                        {
                            log::error!("Error updating org user relation: {}", e);
                            return Ok(HttpResponse::InternalServerError().json(
                                MetaHttpResponse::error(
                                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                                    "Failed to update organization membership for user".to_string(),
                                ),
                            ));
                        }
                    } else {
                        if let Err(e) = db::org_users::add(
                            org_id,
                            email,
                            new_user.role.into(),
                            &new_user.token,
                            new_user.rum_token,
                        )
                        .await
                        {
                            log::error!("Error adding org user relation: {}", e);
                            return Ok(HttpResponse::InternalServerError().json(
                                MetaHttpResponse::error(
                                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                                    "Failed to add organization membership for user".to_string(),
                                ),
                            ));
                        }
                    }

                    #[cfg(feature = "enterprise")]
                    {
                        use o2_enterprise::enterprise::openfga::authorizer::authz::update_user_role;

                        if get_o2_config().openfga.enabled
                            && old_role.is_some()
                            && new_role.is_some()
                        {
                            let old = old_role.unwrap();
                            let new = new_role.unwrap();
                            if !old.eq(&new) {
                                let mut old_str = old.to_string();
                                let mut new_str = new.to_string();
                                if old.eq(&UserRole::User) || old.eq(&UserRole::ServiceAccount) {
                                    old_str = "allowed_user".to_string();
                                }
                                if new.eq(&UserRole::User) || new.eq(&UserRole::ServiceAccount) {
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
                }

                #[cfg(not(feature = "enterprise"))]
                log::debug!("Role changed from {:?} to {:?}", old_role, new_role);
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK.into(),
                    "User updated successfully".to_string(),
                )))
            }
            None => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                http::StatusCode::NOT_FOUND.into(),
                "User not found".to_string(),
            ))),
        }
    } else {
        Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            "User not found".to_string(),
        )))
    }
}

pub async fn add_admin_to_org(org_id: &str, user_email: &str) -> Result<(), anyhow::Error> {
    if is_root_user(user_email) {
        // user is already a root user
        Ok(())
    } else {
        if db::user::get_user_record(user_email).await.is_err() {
            return Err(anyhow::anyhow!("User not found"));
        }
        let token = generate_random_string(16);
        let rum_token = format!("rum{}", generate_random_string(16));
        // Add user to the organization
        db::org_users::add(
            org_id,
            user_email,
            UserRole::Admin.into(),
            &token,
            Some(rum_token),
        )
        .await?;

        // Update OFGA
        #[cfg(feature = "enterprise")]
        {
            use o2_enterprise::enterprise::{
                common::infra::config::get_config as get_o2_config,
                openfga::authorizer::authz::{get_user_role_tuple, update_tuples},
            };
            if get_o2_config().openfga.enabled {
                let mut tuples = vec![];
                get_user_role_tuple(
                    &UserRole::Admin.to_string(),
                    user_email,
                    org_id,
                    &mut tuples,
                );
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
        Ok(())
    }
}

pub async fn add_user_to_org(
    org_id: &str,
    email: &str,
    role: UserOrgRole,
    initiator_id: &str,
) -> Result<HttpResponse, Error> {
    let existing_user = db::user::get_user_record(email).await;
    let root_user = ROOT_USER.clone();
    if existing_user.is_ok() {
        let _initiating_user = if is_root_user(initiator_id) {
            let local_org = org_id.replace(' ', "_");
            // If the org does not exist, create it
            let _ = organization::check_and_create_org(&local_org).await;
            root_user.get("root").unwrap().clone()
        } else {
            match db::user::get(Some(org_id), initiator_id).await {
                Ok(user) => user.unwrap(),
                Err(e) => {
                    log::error!("Error fetching user: {}", e);
                    return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                        http::StatusCode::NOT_FOUND.into(),
                        "User not found".to_string(),
                    )));
                }
            }
        };
        let base_role = get_role(&role);
        #[cfg(not(feature = "enterprise"))]
        let is_allowed = true;
        #[cfg(feature = "enterprise")]
        let is_allowed = if get_o2_config().openfga.enabled {
            // Permission already checked through RBAC
            true
        } else {
            _initiating_user.role.eq(&UserRole::Root) || _initiating_user.role.eq(&UserRole::Admin)
        };

        if is_allowed {
            let token = generate_random_string(16);
            let rum_token = format!("rum{}", generate_random_string(16));
            let is_member = db::org_users::get(org_id, email).await.is_ok();
            if is_member {
                return Ok(HttpResponse::Conflict().json(MetaHttpResponse::error(
                    http::StatusCode::CONFLICT.into(),
                    "User is already part of the org".to_string(),
                )));
            }

            if db::org_users::add(
                org_id,
                email,
                base_role.clone().into(),
                &token,
                Some(rum_token),
            )
            .await
            .is_err()
            {
                return Ok(
                    HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                        "Failed to add user to org".to_string(),
                    )),
                );
            }

            // Update OFGA
            #[cfg(feature = "enterprise")]
            {
                use o2_enterprise::enterprise::openfga::authorizer::authz::{
                    get_user_crole_tuple, get_user_role_tuple, update_tuples,
                };
                if get_o2_config().openfga.enabled {
                    let mut tuples = vec![];
                    get_user_role_tuple(&base_role.to_string(), email, org_id, &mut tuples);
                    if role.custom_role.is_some() {
                        let custom_role = role.custom_role.unwrap();
                        tuples.push(get_user_crole_tuple(org_id, &custom_role, email));
                    }
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
        Ok(
            HttpResponse::UnprocessableEntity().json(MetaHttpResponse::error(
                http::StatusCode::UNPROCESSABLE_ENTITY.into(),
                "User not found".to_string(),
            )),
        )
    }
}

pub async fn get_user(org_id: Option<&str>, name: &str) -> Option<User> {
    let org_id = match org_id {
        Some(local_org) => local_org,
        None => DEFAULT_ORG,
    };
    let user = get_cached_user_org(org_id, name);
    match user {
        Some(loc_user) => Some(loc_user),
        None => db::user::get(Some(org_id), name).await.ok().flatten(),
    }
}

pub async fn get_user_by_token(org_id: &str, token: &str) -> Option<User> {
    let rum_tokens = USERS_RUM_TOKEN.clone();
    let key = format!("{DEFAULT_ORG}/{token}");
    if let Some(user) = rum_tokens.get(&key) {
        return get_user(None, &user.email).await;
    }

    let key = format!("{org_id}/{token}");
    if let Some(user) = rum_tokens.get(&key) {
        return get_user(Some(org_id), &user.email).await;
    }

    // need to drop the reference to rum_tokens to avoid deadlock of dashmap
    drop(rum_tokens);

    log::info!("get_user_by_token: User not found in cache, fetching from db");
    if let Some(user_from_db) = db::user::get_by_token(Some(org_id), token)
        .await
        .ok()
        .flatten()
    {
        log::info!("get_user_by_token: User found updating cache");
        let org_user_record = OrgUserRecord {
            email: user_from_db.email.clone(),
            role: user_from_db.role.clone().into(),
            org_id: user_from_db.org.clone(),
            token: user_from_db.token.clone(),
            rum_token: user_from_db.rum_token.clone(),
            created_at: 0,
        };
        if is_root_user(&user_from_db.email) {
            USERS_RUM_TOKEN
                .clone()
                .insert(format!("{DEFAULT_ORG}/{token}"), org_user_record);
        } else {
            USERS_RUM_TOKEN.clone().insert(key, org_user_record);
        }
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

pub async fn list_users(org_id: &str, list_all: bool) -> Result<HttpResponse, Error> {
    let cfg = get_config();
    let mut user_list: Vec<UserResponse> = vec![];
    let is_list_all = list_all & org_id.eq(cfg.common.usage_org.as_str());
    let mut user_orgs: HashMap<String, Vec<OrgRoleMapping>> = HashMap::new();
    log::debug!("Listing users for org: {}", org_id);

    for org_user in ORG_USERS.iter() {
        // If list all user, maintain a list of orgs for each user
        if is_list_all {
            let (org, id) = org_user.key().split_once('/').unwrap();
            if let Some(org_record) = organization::get_org(org).await {
                let user_org = user_orgs.entry(id.to_string()).or_insert(vec![]);
                user_org.push(OrgRoleMapping {
                    org_id: org.to_string(),
                    role: org_user.value().role.clone().into(),
                    org_name: org_record.name,
                });
            }
        } else if org_user.key().starts_with(&format!("{org_id}/")) {
            if let Some(user) = get_user(Some(org_id), org_user.value().email.as_str()).await {
                user_list.push(UserResponse {
                    email: user.email.clone(),
                    role: user.role.to_string(),
                    first_name: user.first_name.clone(),
                    last_name: user.last_name.clone(),
                    is_external: user.is_external,
                    orgs: None,
                });
            }
        }
    }

    if is_list_all {
        let users = db::user::list_users(None).await.unwrap();
        for user in users {
            if is_root_user(&user.email) {
                continue;
            }
            let role = match ORG_USERS.get(&format!("{org_id}/{}", user.email)) {
                Some(org_user) => org_user.value().role.to_string(),
                None => "".to_string(),
            };
            user_list.push(UserResponse {
                email: user.email.clone(),
                role,
                first_name: user.first_name.clone(),
                last_name: user.last_name.clone(),
                is_external: user.user_type.is_external(),
                orgs: user_orgs.get(user.email.as_str()).cloned(),
            });
        }
    }

    #[cfg(feature = "enterprise")]
    {
        if !org_id.eq(DEFAULT_ORG) {
            let root = ROOT_USER.get("root").unwrap();
            let root_user = root.value();
            user_list.push(UserResponse {
                email: root_user.email.clone(),
                role: root_user.role.to_string(),
                first_name: root_user.first_name.clone(),
                last_name: root_user.last_name.clone(),
                is_external: root_user.is_external,
                orgs: None,
            });
        }
    }

    Ok(HttpResponse::Ok().json(UserList { data: user_list }))
}

pub async fn remove_user_from_org(
    org_id: &str,
    email_id: &str,
    initiator_id: &str,
) -> Result<HttpResponse, Error> {
    let email_id = email_id.to_lowercase();
    let initiator_id = initiator_id.to_lowercase();
    let _initiating_user = if is_root_user(&initiator_id) {
        ROOT_USER.get("root").unwrap().to_owned()
    } else {
        db::user::get(Some(org_id), &initiator_id)
            .await
            .unwrap()
            .unwrap()
    };

    #[cfg(not(feature = "enterprise"))]
    let is_allowed = true;
    #[cfg(feature = "enterprise")]
    let is_allowed = if get_o2_config().openfga.enabled {
        // Permission already checked through RBAC
        true
    } else {
        _initiating_user.role.eq(&UserRole::Root) || _initiating_user.role.eq(&UserRole::Admin)
    };

    if is_allowed {
        let ret_user = db::user::get_db_user(&email_id).await;
        match ret_user {
            Ok(mut user) => {
                if !user.organizations.is_empty() {
                    let mut orgs = user.clone().organizations;
                    if orgs.len() == 1 {
                        let _ = db::user::delete(&email_id).await;
                        #[cfg(feature = "enterprise")]
                        {
                            use o2_enterprise::enterprise::openfga::authorizer::authz::delete_user_from_org;
                            let user_role = &orgs[0].role;
                            let user_fga_role = if user_role.eq(&UserRole::ServiceAccount)
                                || user_role.eq(&UserRole::User)
                            {
                                "allowed_user".to_string()
                            } else {
                                user_role.to_string()
                            };
                            if get_o2_config().openfga.enabled {
                                log::debug!("delete user single org, role: {}", &user_fga_role);
                                delete_user_from_org(org_id, &email_id, &user_fga_role).await;
                            }
                        }
                    } else {
                        let mut _user_fga_role: Option<String> = None;
                        #[cfg(feature = "enterprise")]
                        for org in orgs.iter() {
                            if org.name.eq(&org_id.to_string()) {
                                let user_role = &org.role;
                                _user_fga_role = if user_role.eq(&UserRole::ServiceAccount)
                                    || user_role.eq(&UserRole::User)
                                {
                                    Some("allowed_user".to_string())
                                } else {
                                    Some(user_role.to_string())
                                };
                            }
                        }
                        orgs.retain(|x| !x.name.eq(&org_id.to_string()));
                        user.organizations = orgs;
                        let resp = db::org_users::remove(org_id, &email_id).await;
                        // special case as we cache flattened user struct
                        if resp.is_ok() {
                            #[cfg(feature = "enterprise")]
                            {
                                use o2_enterprise::enterprise::openfga::authorizer::authz::delete_user_from_org;
                                log::debug!(
                                    "user_fga_role, multi org: {}",
                                    _user_fga_role.as_ref().unwrap()
                                );
                                if get_o2_config().openfga.enabled && _user_fga_role.is_some() {
                                    delete_user_from_org(
                                        org_id,
                                        &email_id,
                                        _user_fga_role.unwrap().as_str(),
                                    )
                                    .await;
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

pub fn is_user_from_org(orgs: Vec<UserOrg>, org_id: &str) -> (bool, UserOrg) {
    if orgs.is_empty() {
        (false, get_default_user_org())
    } else {
        let mut local_orgs = orgs;
        local_orgs.retain(|org| !org.name.eq(&org_id.to_string()));
        if local_orgs.is_empty() {
            (false, get_default_user_org())
        } else {
            (true, local_orgs.first().unwrap().clone())
        }
    }
}

#[cfg(feature = "enterprise")]
pub async fn list_user_invites(user_id: &str) -> Result<HttpResponse, Error> {
    let result = db::user::list_user_invites(user_id).await;
    match result {
        Ok(res) => {
            let result = res
                .into_iter()
                .map(|invite| UserInvite {
                    role: invite.role,
                    org_id: invite.org_id,
                    token: invite.token,
                    status: InviteStatus::from(&invite.status),
                    expires_at: invite.expires_at,
                })
                .collect();
            Ok(HttpResponse::Ok().json(UserInviteList { data: result }))
        }
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            http::StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

pub(crate) async fn create_root_user(org_id: &str, usr_req: UserRequest) -> Result<(), Error> {
    let cfg = get_config();
    let salt = ider::uuid();
    let password = get_hash(&usr_req.password, &salt);
    let password_ext = get_hash(&usr_req.password, &cfg.auth.ext_auth_salt);
    let token = generate_random_string(16);
    let rum_token = format!("rum{}", generate_random_string(16));
    let user = usr_req.to_new_dbuser(
        password,
        salt,
        org_id.replace(' ', "_"),
        token,
        rum_token,
        usr_req.is_external,
        password_ext,
    );
    db::user::add(&user).await.unwrap();
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::user::{UserRole, UserType};
    use infra::{db as infra_db, table as infra_table};

    use super::*;
    use crate::common::infra::config::USERS;

    async fn set_up() {
        USERS.insert(
            "admin@zo.dev".to_string(),
            infra::table::users::UserRecord {
                email: "admin@zo.dev".to_string(),
                password: "pass#123".to_string(),
                salt: String::new(),
                first_name: "admin".to_owned(),
                last_name: "".to_owned(),
                password_ext: Some("pass#123".to_string()),
                user_type: UserType::Internal,
                is_root: false,
                created_at: 0,
                updated_at: 0,
            },
        );
        ORG_USERS.insert(
            "dummy/admin@zo.dev".to_string(),
            OrgUserRecord {
                role: UserRole::Admin,
                token: "token".to_string(),
                rum_token: Some("rum_token".to_string()),
                org_id: "dummy".to_string(),
                email: "admin@zo.dev".to_string(),
                created_at: 0,
            },
        );
    }

    #[tokio::test]
    async fn test_list_users() {
        set_up().await;
        assert!(list_users("dummy", false).await.is_ok())
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
        infra_table::create_user_tables().await.unwrap();
        set_up().await;

        let resp = post_user(
            "dummy",
            UserRequest {
                email: "user@zo.dev".to_string(),
                password: "pass#123".to_string(),
                role: crate::common::meta::user::UserOrgRole {
                    base_role: UserRole::Admin,
                    custom_role: None,
                },
                first_name: "user".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
            },
            "admin@zo.dev",
        )
        .await;
        assert!(resp.is_ok());
    }

    #[tokio::test]
    async fn test_user() {
        infra_db::create_table().await.unwrap();
        infra_table::create_user_tables().await.unwrap();
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
                role: Some(crate::common::meta::user::UserRoleRequest {
                    role: UserRole::Admin.to_string(),
                    custom: None,
                }),
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
                role: Some(crate::common::meta::user::UserRoleRequest {
                    role: UserRole::Admin.to_string(),
                    custom: None,
                }),
                change_password: false,
            },
        )
        .await;

        assert!(resp.is_ok());

        let resp = add_user_to_org(
            "dummy",
            "user2@example.com",
            UserOrgRole {
                base_role: UserRole::Admin,
                custom_role: None,
            },
            "admin@zo.dev",
        )
        .await;

        assert!(resp.is_ok());

        let resp = remove_user_from_org("dummy", "user2@example.com", "admin@zo.dev").await;

        assert!(resp.is_ok());
    }
}
