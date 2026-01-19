// Copyright 2026 OpenObserve Inc.
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

use axum::{
    Json, http,
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use config::meta::ratelimit::CachedUserRoles;
use config::{
    META_ORG_ID, get_config, ider,
    meta::user::{DBUser, User, UserOrg, UserRole},
    utils::rand::generate_random_string,
};
use hashbrown::HashMap;
use infra::table::org_users::OrgUserRecord;
#[cfg(feature = "enterprise")]
use o2_openfga::{
    authorizer::authz::delete_service_account_from_org, config::get_config as get_openfga_config,
};

use super::db::org_users::get_cached_user_org;
#[cfg(feature = "enterprise")]
use crate::common::infra::config::USER_ROLES_CACHE;
#[cfg(feature = "cloud")]
use crate::common::meta::user::{InviteStatus, UserInvite, UserInviteList};
use crate::{
    common::{
        infra::config::{ORG_USERS, ROOT_USER, USERS_RUM_TOKEN},
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{DEFAULT_ORG, OrgRoleMapping},
            user::{
                UpdateUser, UserList, UserOrgRole, UserRequest, UserResponse, UserUpdateMode,
                get_default_user_org,
            },
        },
        utils::auth::{get_hash, get_role, is_root_user, is_valid_email},
    },
    service::{db, organization},
};

pub async fn post_user(
    org_id: &str,
    mut usr_req: UserRequest,
    initiator_id: &str,
) -> Result<Response, Error> {
    if !is_valid_email(&usr_req.email) {
        return Ok(MetaHttpResponse::bad_request("Invalid email"));
    }
    let cfg = get_config();
    usr_req.email = usr_req.email.to_lowercase();
    if usr_req.role.custom_role.is_some() {
        #[cfg(not(feature = "enterprise"))]
        return Ok(MetaHttpResponse::bad_request("Custom roles not allowed"));
        #[cfg(feature = "enterprise")]
        if !get_openfga_config().enabled {
            return Ok(MetaHttpResponse::bad_request("Custom roles not allowed"));
        } else {
            match o2_openfga::authorizer::roles::get_all_roles(org_id, None).await {
                Ok(res) => {
                    for custom_role in usr_req.role.custom_role.as_ref().unwrap() {
                        if !res.contains(custom_role) {
                            return Ok(MetaHttpResponse::bad_request("Custom role not found"));
                        }
                    }
                }
                Err(e) => {
                    log::error!("Error fetching custom roles during post user: {e}");
                    return Ok(MetaHttpResponse::bad_request("Custom role not found"));
                }
            }
        }
    }

    let is_allowed = if is_root_user(initiator_id) {
        true
    } else {
        let initiator_user = db::user::get(Some(org_id), initiator_id).await;
        let Ok(initiator_user) = initiator_user else {
            return Ok(MetaHttpResponse::unauthorized("Not Allowed"));
        };
        let Some(initiator_user) = initiator_user else {
            return Ok(MetaHttpResponse::unauthorized("Not Allowed"));
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
            if !usr_req.is_external
                && usr_req.role.base_role.ne(&UserRole::ServiceAccount)
                && usr_req.password.is_empty()
            {
                return Ok(MetaHttpResponse::bad_request(
                    "Password required to create new user",
                ));
            }
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

            // Save the user in the database
            if db::user::add(&user).await.is_err() {
                return Ok(MetaHttpResponse::internal_error("Failed to save user"));
            }
            // Update OFGA
            #[cfg(feature = "enterprise")]
            {
                use o2_openfga::authorizer::authz::{
                    get_add_user_to_org_tuples, get_service_account_creation_tuple,
                    get_user_crole_tuple, update_tuples,
                };
                if get_openfga_config().enabled {
                    let mut tuples = vec![];
                    let org_id = org_id.replace(' ', "_");
                    get_add_user_to_org_tuples(
                        &org_id,
                        &usr_req.email,
                        &usr_req.role.base_role.to_string(),
                        &mut tuples,
                    );
                    if usr_req.role.base_role.eq(&UserRole::ServiceAccount) {
                        get_service_account_creation_tuple(&org_id, &usr_req.email, &mut tuples);
                    }
                    if usr_req.role.custom_role.is_some() {
                        let custom_role = usr_req.role.custom_role.unwrap();
                        custom_role.iter().for_each(|crole| {
                            tuples.push(get_user_crole_tuple(&org_id, crole, &usr_req.email));
                        });
                    }
                    match update_tuples(tuples, vec![]).await {
                        Ok(_) => {
                            log::info!("User saved successfully in openfga");
                        }
                        Err(e) => {
                            log::error!("Error creating user in openfga: {e}");
                        }
                    }
                }
            }
            Ok(MetaHttpResponse::ok("User saved successfully"))
        } else {
            Ok(MetaHttpResponse::bad_request("User already exists"))
        }
    } else {
        Ok(MetaHttpResponse::forbidden("Not Allowed"))
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
    update_mode: UserUpdateMode,
    initiator_id: &str,
    mut user: UpdateUser,
) -> Result<Response, Error> {
    let mut allow_password_update = false;
    if !is_valid_email(email) {
        return Ok(MetaHttpResponse::bad_request("Invalid email"));
    }
    let is_email_root = is_root_user(email);

    #[cfg(not(feature = "enterprise"))]
    if is_email_root {
        user.role = Some(crate::common::meta::user::UserRoleRequest {
            role: UserRole::Root.to_string(),
            custom: None,
        });
    }
    user.role = user.role.clone();

    // Only root user can update root user
    if is_email_root && !update_mode.is_self_update() && !update_mode.is_cli_update() {
        return Ok(MetaHttpResponse::bad_request("Root user cannot be updated"));
    }

    // Nobody can update role to root user role
    if !is_email_root
        && user
            .role
            .as_ref()
            .is_some_and(|role_req| role_req.role.eq(&UserRole::Root.to_string()))
    {
        return Ok(MetaHttpResponse::bad_request(
            "Root user role cannot be updated",
        ));
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
    if let Ok(existing_user) = existing_user {
        let mut new_user;
        let mut is_updated = false;
        let mut is_org_updated = false;
        let mut message = "";
        #[cfg(feature = "enterprise")]
        let mut custom_roles = vec![];
        #[cfg(feature = "enterprise")]
        let mut custom_roles_need_change = false;
        match existing_user {
            Some(local_user) => {
                if local_user.is_external {
                    return Ok(MetaHttpResponse::bad_request(
                        "Updates not allowed with external users, please update with source system",
                    ));
                }
                if !update_mode.is_self_update() {
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
                if local_user.role.eq(&UserRole::Root)
                    && !update_mode.is_self_update()
                    && !update_mode.is_cli_update()
                {
                    return Ok(MetaHttpResponse::bad_request(
                        "Only root user can update its details",
                    ));
                }
                new_user = local_user.clone();
                if update_mode.is_self_update()
                    && user.old_password.is_some()
                    && user.new_password.is_some()
                {
                    if local_user.password.eq(&get_hash(
                        &user.clone().old_password.unwrap(),
                        &local_user.salt,
                    )) {
                        let new_pass = user.new_password.unwrap();

                        new_user.password = get_hash(&new_pass, &local_user.salt);
                        new_user.password_ext = Some(get_hash(&new_pass, password_ext_salt));
                        log::info!("Password self updated for user: {email}");
                        is_updated = true;
                    } else {
                        message = "Existing/old password mismatch, please provide valid existing password";
                        return Ok(MetaHttpResponse::bad_request(message));
                    }
                } else if update_mode.is_self_update()
                    && user.new_password.is_some()
                    && user.old_password.is_none()
                {
                    message = "Please provide existing password";
                } else if !update_mode.is_self_update()
                    && allow_password_update
                    && user.new_password.is_some()
                    && !local_user.is_external
                {
                    let new_pass = user.new_password.unwrap();

                    new_user.password = get_hash(&new_pass, &local_user.salt);
                    new_user.password_ext = Some(get_hash(&new_pass, password_ext_salt));
                    log::info!("Password by root updated for user: {email}");

                    is_updated = true;
                } else if user.new_password.is_some() {
                    message = "You are not authorised to change the password";
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
                    && (!update_mode.is_self_update()
                        || (local_user.role.eq(&UserRole::Admin)
                            // Editor can update other's roles, but viewer can update only self
                            || local_user.role.eq(&UserRole::Editor)
                            || local_user.role.eq(&UserRole::Viewer)
                            || local_user.role.eq(&UserRole::Root)))
                // if the User Role is Root, we do not change the Role
                // Admins Role can still be mutable.
                {
                    let new_org_role = UserOrgRole::from(&user.role.unwrap());
                    old_role = Some(new_user.role);
                    new_user.role = new_org_role.base_role;
                    new_role = Some(new_user.role.clone());
                    if local_user.role.eq(&UserRole::Root) && new_user.role.ne(&UserRole::Root) {
                        message = "Root user role cannot be changed";
                    } else if update_mode.is_self_update() && local_user.role < new_user.role {
                        message = "Self role cannot be upgraded";
                    } else if local_user.role.ne(&new_user.role) {
                        #[cfg(feature = "enterprise")]
                        if new_org_role.custom_role.is_some() {
                            custom_roles_need_change = true;
                            custom_roles.extend(new_org_role.custom_role.unwrap());
                        }
                        is_org_updated = true;
                    }
                }
                if user.token.is_some() {
                    new_user.token = user.token.unwrap();
                    is_org_updated = true;
                }

                if !message.is_empty() {
                    return Ok(MetaHttpResponse::bad_request(message));
                }

                if !is_updated && !is_org_updated {
                    return Ok(MetaHttpResponse::bad_request("No changes to update"));
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
                    return Ok(MetaHttpResponse::internal_error("Failed to update user"));
                }

                // Update the organization membership
                if is_org_updated {
                    if db::org_users::get(org_id, email).await.is_ok() {
                        if let Err(e) = db::org_users::update(
                            org_id,
                            email,
                            new_user.role,
                            &new_user.token,
                            new_user.rum_token,
                        )
                        .await
                        {
                            log::error!("Error updating org user relation: {e}");
                            return Ok(MetaHttpResponse::internal_error(
                                "Failed to update organization membership for user",
                            ));
                        }
                    } else if let Err(e) = db::org_users::add(
                        org_id,
                        email,
                        new_user.role,
                        &new_user.token,
                        new_user.rum_token,
                    )
                    .await
                    {
                        log::error!("Error adding org user relation: {e}");
                        return Ok(MetaHttpResponse::internal_error(
                            "Failed to add organization membership for user",
                        ));
                    }

                    #[cfg(feature = "enterprise")]
                    {
                        use o2_openfga::authorizer::{
                            authz::{get_user_crole_tuple, update_tuples, update_user_role},
                            roles::{
                                get_role_key, get_roles_for_org_user, get_user_crole_removal_tuples,
                            },
                        };

                        if get_openfga_config().enabled
                            && let Some(old) = old_role
                            && let Some(new) = new_role
                        {
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
                            if custom_roles_need_change {
                                let existing_roles = get_roles_for_org_user(org_id, email).await;
                                let mut write_tuples = vec![];
                                let mut delete_tuples = vec![];
                                custom_roles.iter().for_each(|crole| {
                                    if !existing_roles.contains(crole) {
                                        write_tuples
                                            .push(get_user_crole_tuple(org_id, crole, email));
                                    }
                                });
                                existing_roles.iter().for_each(|crole| {
                                    if !custom_roles.contains(crole) {
                                        get_user_crole_removal_tuples(
                                            email,
                                            &get_role_key(org_id, crole),
                                            &mut delete_tuples,
                                        );
                                    }
                                });
                                if let Err(e) = update_tuples(write_tuples, delete_tuples).await {
                                    log::error!(
                                        "Error updating custom roles for user {email} in {org_id} org : {e}"
                                    );
                                    return Ok(MetaHttpResponse::internal_error(
                                        "Failed to update custom roles for user",
                                    ));
                                }
                            }
                        }
                    }
                }

                #[cfg(not(feature = "enterprise"))]
                log::debug!("Role changed from {old_role:?} to {new_role:?}");
                Ok(MetaHttpResponse::ok("User updated successfully"))
            }
            None => Ok(MetaHttpResponse::not_found("User not found")),
        }
    } else {
        Ok(MetaHttpResponse::not_found("User not found"))
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

        // Assign Admin role by default
        let role = UserRole::Admin;

        // Add user to the organization
        crate::service::db::org_users::add(
            org_id,
            user_email,
            role.clone(),
            &token,
            Some(rum_token),
        )
        .await?;

        // Update OFGA
        #[cfg(feature = "enterprise")]
        {
            use o2_openfga::authorizer::authz::{get_add_user_to_org_tuples, update_tuples};
            if get_openfga_config().enabled {
                let mut tuples = vec![];
                get_add_user_to_org_tuples(org_id, user_email, &role.to_string(), &mut tuples);
                match update_tuples(tuples, vec![]).await {
                    Ok(_) => {
                        log::info!("User added to org successfully in openfga");
                    }
                    Err(e) => {
                        log::error!("Error adding user to the org in openfga: {e}");
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
) -> Result<Response, Error> {
    if !is_valid_email(email) {
        return Ok(MetaHttpResponse::bad_request("Invalid email"));
    }
    let email = email.trim().to_lowercase();
    let existing_user = db::user::get_user_record(&email).await;
    let root_user = ROOT_USER.clone();
    if let Ok(existing_user) = existing_user {
        // If the user is root, we don't need to add to the org, as root user
        // already has access to all organizations.
        if existing_user.is_root {
            return Ok(MetaHttpResponse::conflict(
                "User is root user, no need to add to organization.",
            ));
        }

        let initiating_user = if is_root_user(initiator_id) {
            let local_org = org_id.replace(' ', "_");
            // If the org does not exist, create it
            let _ = organization::check_and_create_org(&local_org).await;
            root_user.get("root").unwrap().clone()
        } else {
            match db::user::get(Some(org_id), initiator_id).await {
                Ok(user) => user.unwrap(),
                Err(e) => {
                    log::error!("Error fetching user: {e}");
                    return Ok(MetaHttpResponse::not_found("User not found"));
                }
            }
        };
        let base_role = get_role(&role);
        let is_allowed =
            initiating_user.role.eq(&UserRole::Root) || initiating_user.role.eq(&UserRole::Admin);
        #[cfg(feature = "enterprise")]
        let is_allowed = if get_openfga_config().enabled {
            // Permission already checked through RBAC
            true
        } else {
            is_allowed
        };

        if is_allowed {
            let token = generate_random_string(16);
            let rum_token = format!("rum{}", generate_random_string(16));
            let is_member = db::org_users::get(org_id, &email).await.is_ok();
            if is_member {
                return Ok(MetaHttpResponse::conflict(
                    "User is already part of the organization",
                ));
            }

            if db::org_users::add(org_id, &email, base_role.clone(), &token, Some(rum_token))
                .await
                .is_err()
            {
                return Ok(MetaHttpResponse::internal_error(
                    "Failed to add user to org",
                ));
            }

            // Update OFGA
            #[cfg(feature = "enterprise")]
            {
                use o2_openfga::authorizer::authz::{
                    get_add_user_to_org_tuples, get_user_crole_tuple, update_tuples,
                };
                if get_openfga_config().enabled {
                    let mut tuples = vec![];
                    get_add_user_to_org_tuples(org_id, &email, &base_role.to_string(), &mut tuples);
                    if role.custom_role.is_some() {
                        let custom_role = role.custom_role.unwrap();
                        custom_role.iter().for_each(|crole| {
                            tuples.push(get_user_crole_tuple(org_id, crole, &email));
                        });
                    }
                    match update_tuples(tuples, vec![]).await {
                        Ok(_) => {
                            log::info!("User added to org successfully in openfga");
                        }
                        Err(e) => {
                            log::error!("Error adding user to the org in openfga: {e}");
                        }
                    }
                }
            }
            Ok(MetaHttpResponse::ok("User added to org successfully"))
        } else {
            Ok(MetaHttpResponse::forbidden("Not Allowed"))
        }
    } else {
        Ok((
            http::StatusCode::UNPROCESSABLE_ENTITY,
            Json(MetaHttpResponse::error(
                http::StatusCode::UNPROCESSABLE_ENTITY,
                "User not found",
            )),
        )
            .into_response())
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

    if let Some(user_from_db) = db::user::get_by_token(Some(org_id), token)
        .await
        .ok()
        .flatten()
    {
        log::info!("get_user_by_token: User found updating cache");
        let org_user_record = OrgUserRecord {
            email: user_from_db.email.clone(),
            role: user_from_db.role.clone(),
            org_id: user_from_db.org.clone(),
            token: user_from_db.token.clone(),
            rum_token: user_from_db.rum_token.clone(),
            created_at: 0,
            allow_static_token: true,
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
        log::info!("get_user_by_token: User not found even in db {org_id} {token}");
        None
    }
}

pub async fn list_users(
    _user_id: &str,
    org_id: &str,
    role: Option<UserRole>,
    permitted: Option<Vec<String>>,
    list_all: bool,
) -> Result<Response, Error> {
    let mut user_list: Vec<UserResponse> = vec![];
    let is_list_all = list_all & org_id.eq(META_ORG_ID);
    let mut user_orgs: HashMap<String, Vec<OrgRoleMapping>> = HashMap::new();
    log::debug!("Listing users for org: {org_id}");

    #[cfg(feature = "enterprise")]
    if get_openfga_config().enabled && role.is_none() && permitted.is_none() {
        // This user does not have list users permission
        // Hence only return this specific user
        if let Some(user) = get_user(Some(org_id), _user_id).await {
            user_list.push(UserResponse {
                email: user.email.clone(),
                role: user.role.to_string(),
                first_name: user.first_name.clone(),
                last_name: user.last_name.clone(),
                is_external: user.is_external,
                orgs: None,
                created_at: 0, // Not used
            });
        }
        return Ok(MetaHttpResponse::json(UserList { data: user_list }));
    }

    for org_user in ORG_USERS.iter() {
        // If list all user, maintain a list of orgs for each user
        if is_list_all {
            let (org, id) = org_user.key().split_once('/').unwrap();
            if let Some(org_record) = organization::get_org(org).await {
                user_orgs
                    .entry(id.to_string())
                    .or_default()
                    .push(OrgRoleMapping {
                        org_id: org.to_string(),
                        role: org_user.value().role.clone(),
                        org_name: org_record.name,
                    });
            }
        } else if org_user.key().starts_with(&format!("{org_id}/"))
            && let Some(user) = get_user(Some(org_id), org_user.value().email.as_str()).await
        {
            let should_include = if let Some(ref required_role) = role {
                // Filter by role if specified
                user.role.eq(required_role)
            } else {
                user.role.ne(&UserRole::ServiceAccount)
            };
            if should_include {
                user_list.push(UserResponse {
                    email: user.email.clone(),
                    role: user.role.to_string(),
                    first_name: user.first_name.clone(),
                    last_name: user.last_name.clone(),
                    is_external: user.is_external,
                    orgs: None,
                    created_at: org_user.value().created_at,
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
            let (role, created_at) = match ORG_USERS.get(&format!("{org_id}/{}", user.email)) {
                Some(org_user) => {
                    let value = org_user.value();
                    (value.role.to_string(), value.created_at)
                }
                None => ("".to_string(), 0),
            };
            user_list.push(UserResponse {
                email: user.email.clone(),
                role,
                first_name: user.first_name.clone(),
                last_name: user.last_name.clone(),
                is_external: user.user_type.is_external(),
                orgs: user_orgs.get(user.email.as_str()).cloned(),
                created_at,
            });
        }
    }

    user_list.retain(|user| {
        if user.role.eq(&UserRole::ServiceAccount.to_string())
            && let Some(ref permitted) = permitted
        {
            permitted.contains(&format!("service_accounts:{}", user.email))
                || permitted.contains(&format!("service_accounts:_all_{org_id}"))
        } else {
            true
        }
    });

    #[cfg(not(feature = "cloud"))]
    {
        if !org_id.eq(DEFAULT_ORG) && role.is_none() {
            let root = ROOT_USER.get("root").unwrap();
            let root_user = root.value();
            user_list.push(UserResponse {
                email: root_user.email.clone(),
                role: root_user.role.to_string(),
                first_name: root_user.first_name.clone(),
                last_name: root_user.last_name.clone(),
                is_external: root_user.is_external,
                orgs: None,
                created_at: 0,
            });
        }
    }

    user_list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(MetaHttpResponse::json(UserList { data: user_list }))
}

pub async fn remove_user_from_org(
    org_id: &str,
    email_id: &str,
    initiator_id: &str,
) -> Result<Response, Error> {
    let email_id = email_id.to_lowercase();
    let initiator_id = initiator_id.to_lowercase();
    let initiating_user = if is_root_user(&initiator_id) {
        ROOT_USER.get("root").unwrap().to_owned()
    } else {
        db::user::get(Some(org_id), &initiator_id)
            .await
            .unwrap()
            .unwrap()
    };

    let is_allowed =
        initiating_user.role.eq(&UserRole::Root) || initiating_user.role.eq(&UserRole::Admin);
    #[cfg(feature = "enterprise")]
    let is_allowed = if get_openfga_config().enabled {
        // Permission already checked through RBAC
        true
    } else {
        is_allowed
    };

    if is_allowed {
        let ret_user = db::user::get_db_user(&email_id).await;
        match ret_user {
            Ok(mut user) => {
                if is_root_user(user.email.as_str()) {
                    return Ok(MetaHttpResponse::forbidden("Not Allowed"));
                }

                if initiating_user.email == email_id {
                    return Ok(MetaHttpResponse::forbidden("Not Allowed"));
                }

                #[cfg(feature = "cloud")]
                {
                    use o2_enterprise::enterprise::cloud::org_invites;

                    if let Err(e) = org_invites::delete_invites_for_user(org_id, &email_id).await {
                        log::error!(
                            "error deleting invites when deleting user {email_id} from org {org_id} : {e}"
                        );
                        return Ok(MetaHttpResponse::internal_error(
                            "error deleting user invites",
                        ));
                    }
                }

                if !user.organizations.is_empty() {
                    let orgs = &mut user.organizations;
                    if orgs.len() == 1 {
                        if orgs[0].role.eq(&UserRole::ServiceAccount) && user.is_external {
                            return Ok(MetaHttpResponse::forbidden("Not Allowed"));
                        }
                        if let Err(e) = db::user::delete(&email_id).await {
                            log::error!("error deleting user from db : {e}");
                            return Ok(MetaHttpResponse::internal_error(e.to_string()));
                        }
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
                                delete_user_from_org(org_id, &email_id, &user_fga_role).await;
                                if user_role.eq(&UserRole::ServiceAccount) {
                                    delete_service_account_from_org(org_id, &email_id).await;
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
                                return Ok(MetaHttpResponse::forbidden("Not Allowed"));
                            }
                            if org.name.eq(org_id) {
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
                        orgs.retain(|x| !x.name.eq(org_id));
                        let resp = db::org_users::remove(org_id, &email_id).await;
                        // special case as we cache flattened user struct
                        match resp {
                            Ok(_) => {
                                #[cfg(feature = "enterprise")]
                                {
                                    use o2_openfga::authorizer::authz::delete_user_from_org;
                                    log::debug!(
                                        "user_fga_role, multi org: {}",
                                        _user_fga_role.as_ref().unwrap()
                                    );
                                    if get_openfga_config().enabled
                                        && let Some(_user_fga_role) = _user_fga_role
                                    {
                                        delete_user_from_org(
                                            org_id,
                                            &email_id,
                                            _user_fga_role.as_str(),
                                        )
                                        .await;
                                        if is_service_account {
                                            delete_service_account_from_org(org_id, &email_id)
                                                .await;
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                log::error!("error deleting user {email_id} from {org_id} : {e}");
                                return Ok(MetaHttpResponse::internal_error(e.to_string()));
                            }
                        }
                    }
                    Ok(MetaHttpResponse::ok("User removed from organization"))
                } else {
                    Ok(MetaHttpResponse::not_found(
                        "User for the organization not found",
                    ))
                }
            }
            Err(_) => Ok(MetaHttpResponse::not_found(
                "User for the organization not found",
            )),
        }
    } else {
        Ok(MetaHttpResponse::unauthorized("Not Allowed"))
    }
}

pub async fn delete_user(email_id: &str) -> Result<Response, Error> {
    let result = db::user::delete(email_id).await;
    match result {
        Ok(_) => Ok(MetaHttpResponse::ok("User deleted")),
        Err(e) => Ok(MetaHttpResponse::not_found(e)),
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
        local_orgs.retain(|org| !org.name.eq(org_id));
        if local_orgs.is_empty() {
            (false, get_default_user_org())
        } else {
            (true, local_orgs.first().unwrap().clone())
        }
    }
}

#[cfg(feature = "cloud")]
pub async fn list_user_invites(user_id: &str, only_pending: bool) -> Result<Response, Error> {
    let result = db::user::list_user_invites(user_id).await;
    match result {
        Ok(res) => {
            let mut result: Vec<UserInvite> = Vec::with_capacity(res.len());

            for invite in res {
                result.push(UserInvite {
                    org_name: db::organization::get_org(&invite.org_id)
                        .await
                        .map(|org| org.name)
                        .unwrap_or("default".to_string()),
                    role: invite.role,
                    org_id: invite.org_id,
                    token: invite.token,
                    inviter_id: invite.inviter_id,
                    status: InviteStatus::from(&invite.status),
                    expires_at: invite.expires_at,
                });
            }

            if only_pending {
                let now = chrono::Utc::now().timestamp_micros();

                result.retain(|invite| {
                    invite.status == InviteStatus::Pending && invite.expires_at > now
                });
            }
            Ok(MetaHttpResponse::json(UserInviteList { data: result }))
        }
        Err(e) => Ok(MetaHttpResponse::not_found(e.to_string())),
    }
}

pub(crate) async fn create_root_user(
    org_id: &str,
    user_req: UserRequest,
) -> Result<(), anyhow::Error> {
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
    match db::user::add(&user).await {
        Ok(_) => Ok(()),
        Err(e) => {
            if db::user::root_user_exists().await {
                Ok(())
            } else {
                log::error!("Error creating root user: {e}");
                Err(e)
            }
        }
    }
}

pub async fn create_root_user_if_not_exists(
    org_id: &str,
    usr_req: UserRequest,
) -> Result<(), anyhow::Error> {
    if db::user::root_user_exists().await {
        return Ok(());
    }
    create_root_user(org_id, usr_req).await
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
    if let Some(cached) = cache.get(user_email)
        && cached.expires_at > Instant::now()
    {
        return Some(cached.roles.clone());
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

/// Creates a service account user record if it doesn't already exist
/// This is used when creating organizations with a specified service account
pub async fn create_service_account_if_not_exists(email: &str) -> Result<(), anyhow::Error> {
    // Check if user already exists
    if db::user::get_user_record(email).await.is_ok() {
        log::debug!("Service account '{}' already exists", email);
        return Ok(());
    }

    log::info!("Creating new service account user record for '{}'", email);

    // Create the user record in the users table
    let random_password = generate_random_string(32);
    let salt = ider::uuid();
    let password_hash = get_hash(&random_password, &salt);
    let cfg = get_config();
    let password_ext = get_hash(&random_password, &cfg.auth.ext_auth_salt);
    let now = chrono::Utc::now().timestamp_micros();
    let user_record = infra::table::users::UserRecord {
        email: email.to_string(),
        first_name: email.split('@').next().unwrap_or("Service").to_string(),
        last_name: "Account".to_string(),
        password: password_hash.clone(),
        salt,
        is_root: false,
        password_ext: Some(password_ext),
        user_type: config::meta::user::UserType::Internal,
        created_at: now,
        updated_at: now,
    };

    infra::table::users::add(user_record).await?;
    log::info!("Service account user record created for '{}'", email);

    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::user::{UserRole, UserType};
    use infra::{
        db::{self as infra_db, ORM_CLIENT, connect_to_orm},
        table as infra_table,
    };
    use tokio::sync::Mutex;

    use super::*;
    use crate::common::{infra::config::USERS, meta::user::get_default_user_role};

    // Mutex to ensure test setup is serialized to prevent race conditions
    static TEST_SETUP_LOCK: tokio::sync::OnceCell<Mutex<()>> = tokio::sync::OnceCell::const_new();

    #[test]
    fn test_is_user_from_org() {
        let target_org = "org1".to_string();

        let user_org = UserOrg {
            name: "org2".to_string(),
            org_name: "Organization 2".to_string(),
            token: "token2".to_string(),
            rum_token: Some("rum2".to_string()),
            role: get_default_user_role(),
        };

        let matched_org = UserOrg {
            name: target_org.clone(),
            org_name: "Organization 1".to_string(),
            token: "token1".to_string(),
            rum_token: Some("rum1".to_string()),
            role: get_default_user_role(),
        };

        let (found, org) = is_user_from_org(vec![], &target_org);
        assert!(!found);
        assert_eq!(org.name, "");

        let (found, org) = is_user_from_org(vec![matched_org.clone()], &target_org);
        assert!(!found);
        assert_eq!(org.name, "");

        let (found, org) =
            is_user_from_org(vec![matched_org.clone(), user_org.clone()], &target_org);
        assert!(found);
        assert_eq!(org.name, "org2");
    }

    async fn set_up() {
        // Acquire lock to serialize database setup across concurrent tests
        let lock = TEST_SETUP_LOCK
            .get_or_init(|| async { Mutex::new(()) })
            .await;
        let _guard = lock.lock().await;

        let _ = ORM_CLIENT.get_or_init(connect_to_orm).await;
        // clear the table here as previous tests could have written to it
        let _ = infra::table::org_users::clear().await;
        let _ = infra::table::users::clear().await;
        let _ = infra::table::organizations::clear().await;
        let _ = infra_db::create_table().await;
        let _ = infra_table::create_user_tables().await;
        // Create organization - this should succeed now that we hold the lock
        organization::check_and_create_org_without_ofga("dummy")
            .await
            .expect("Failed to create dummy organization");

        // Clear global caches to ensure test isolation
        USERS.clear();
        ORG_USERS.clear();

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
                allow_static_token: true,
            },
        );
        ROOT_USER.insert(
            "root".to_string(),
            User {
                email: "root@zo.dev".to_string(),
                first_name: "Root".to_string(),
                last_name: "User".to_string(),
                password: "root_password_hash".to_string(),
                salt: "root_salt".to_string(),
                token: "root_token".to_string(),
                rum_token: Some("root_rum_token".to_string()),
                role: UserRole::Root,
                org: "default".to_string(),
                is_external: false,
                password_ext: Some("root_password_ext_hash".to_string()),
            },
        );
    }

    #[tokio::test]
    async fn test_list_users() {
        set_up().await;
        assert!(list_users("", "dummy", None, None, false).await.is_ok())
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
                token: None,
            },
            "admin@zo.dev",
        )
        .await;
        assert!(resp.is_ok());
    }

    #[tokio::test]
    async fn test_user() {
        set_up().await;

        let resp = update_user(
            "dummy",
            "user2@example.com",
            UserUpdateMode::SelfUpdate,
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
            UserUpdateMode::OtherUpdate,
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

    #[tokio::test]
    async fn test_create_new_user() {
        set_up().await;

        let db_user = DBUser {
            email: "newuser@example.com".to_string(),
            password: "".to_string(),
            salt: "".to_string(),
            first_name: "New".to_string(),
            last_name: "User".to_string(),
            password_ext: None,
            is_external: false,
            organizations: vec![UserOrg {
                name: "dummy".to_string(),
                org_name: "Dummy Org".to_string(),
                token: "".to_string(),
                rum_token: None,
                role: UserRole::User,
            }],
        };

        let result = create_new_user(db_user).await;
        if let Err(e) = &result {
            println!("Error creating user: {e:?}");
        }
        assert!(result.is_ok());

        // Test creating another user with pre-existing password and token
        let db_user2 = DBUser {
            email: "existinguser@example.com".to_string(),
            password: "existing_password".to_string(),
            salt: "existing_salt".to_string(),
            first_name: "Existing".to_string(),
            last_name: "User".to_string(),
            password_ext: None,
            is_external: false,
            organizations: vec![UserOrg {
                name: "dummy".to_string(),
                org_name: "Dummy Org".to_string(),
                token: "existing_token".to_string(),
                rum_token: Some("existing_rum".to_string()),
                role: UserRole::User,
            }],
        };

        let result = create_new_user(db_user2).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_delete_user() {
        set_up().await;

        let resp = delete_user("nonexistent@example.com").await;
        assert!(resp.is_ok());

        let resp = delete_user("admin@zo.dev").await;
        assert!(resp.is_ok());
    }

    #[tokio::test]
    async fn test_root_user_exists_edge_cases() {
        set_up().await;

        let exists = root_user_exists().await;
        assert!(!exists);

        crate::common::infra::config::ROOT_USER.insert(
            "root".to_string(),
            User {
                email: "root@example.com".to_string(),
                first_name: "Root".to_string(),
                last_name: "User".to_string(),
                password: "root_pass".to_string(),
                salt: "root_salt".to_string(),
                password_ext: Some("root_pass_ext".to_string()),
                role: UserRole::Root,
                token: "root_token".to_string(),
                rum_token: Some("root_rum".to_string()),
                org: "default".to_string(),
                is_external: false,
            },
        );

        let exists = root_user_exists().await;
        assert!(!exists);
    }

    #[tokio::test]
    async fn test_create_root_user_if_not_exists() {
        set_up().await;

        let user_req = UserRequest {
            email: "root@example.com".to_string(),
            password: "root_password".to_string(),
            role: UserOrgRole {
                base_role: UserRole::Root,
                custom_role: None,
            },
            first_name: "Root".to_string(),
            last_name: "User".to_string(),
            is_external: false,
            token: Some("root_token".to_string()),
        };

        let result = create_root_user_if_not_exists("default", user_req).await;
        assert!(result.is_ok());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_get_user_roles_by_org_id() {
        let roles = vec![
            "org1/role1".to_string(),
            "org1/role2".to_string(),
            "org2/role3".to_string(),
            "global_role".to_string(),
        ];

        let org1_roles = get_user_roles_by_org_id(roles.clone(), Some("org1"));
        assert_eq!(org1_roles, vec!["role1".to_string(), "role2".to_string()]);

        let org2_roles = get_user_roles_by_org_id(roles.clone(), Some("org2"));
        assert_eq!(org2_roles, vec!["role3".to_string()]);

        let all_roles = get_user_roles_by_org_id(roles.clone(), None);
        assert_eq!(all_roles, roles);

        let empty_roles = get_user_roles_by_org_id(vec![], Some("org1"));
        assert_eq!(empty_roles, Vec::<String>::new());
    }

    #[tokio::test]
    async fn test_post_user_validation() {
        set_up().await;

        let invalid_email_req = UserRequest {
            email: "invalid-email".to_string(),
            password: "password123".to_string(),
            role: UserOrgRole {
                base_role: UserRole::User,
                custom_role: None,
            },
            first_name: "Test".to_string(),
            last_name: "User".to_string(),
            is_external: false,
            token: None,
        };

        let resp = post_user("dummy", invalid_email_req, "admin@zo.dev").await;
        assert!(resp.is_ok());
        let response = resp.unwrap();
        assert_eq!(response.status(), 400);

        let empty_password_req = UserRequest {
            email: "test@example.com".to_string(),
            password: "".to_string(),
            role: UserOrgRole {
                base_role: UserRole::User,
                custom_role: None,
            },
            first_name: "Test".to_string(),
            last_name: "User".to_string(),
            is_external: false,
            token: None,
        };

        let resp = post_user("dummy", empty_password_req, "admin@zo.dev").await;
        assert!(resp.is_ok());
        let response = resp.unwrap();
        assert_eq!(response.status(), 400);

        let existing_user_req = UserRequest {
            email: "admin@zo.dev".to_string(),
            password: "password123".to_string(),
            role: UserOrgRole {
                base_role: UserRole::User,
                custom_role: None,
            },
            first_name: "Test".to_string(),
            last_name: "User".to_string(),
            is_external: false,
            token: None,
        };

        let resp = post_user("dummy", existing_user_req, "admin@zo.dev").await;
        assert!(resp.is_ok());
        let response = resp.unwrap();
        assert_eq!(response.status(), 400);
    }

    #[tokio::test]
    async fn test_update_user_validation() {
        set_up().await;

        let resp = update_user(
            "dummy",
            "invalid-email",
            UserUpdateMode::OtherUpdate,
            "admin@zo.dev",
            UpdateUser {
                token: None,
                first_name: None,
                last_name: None,
                old_password: None,
                new_password: None,
                role: None,
                change_password: false,
            },
        )
        .await;
        assert!(resp.is_ok());
        let response = resp.unwrap();
        assert_eq!(response.status(), 400);

        let resp = update_user(
            "dummy",
            "nonexistent@example.com",
            UserUpdateMode::OtherUpdate,
            "admin@zo.dev",
            UpdateUser {
                token: None,
                first_name: Some("New Name".to_string()),
                last_name: None,
                old_password: None,
                new_password: None,
                role: None,
                change_password: false,
            },
        )
        .await;
        assert!(resp.is_ok());
        let response = resp.unwrap();
        assert_eq!(response.status(), 404);
    }

    #[tokio::test]
    async fn test_add_user_to_org_validation() {
        set_up().await;

        let resp = add_user_to_org(
            "dummy",
            "invalid-email",
            UserOrgRole {
                base_role: UserRole::User,
                custom_role: None,
            },
            "admin@zo.dev",
        )
        .await;
        assert!(resp.is_ok());
        let response = resp.unwrap();
        assert_eq!(response.status(), 400);

        let resp = add_user_to_org(
            "dummy",
            "nonexistent@example.com",
            UserOrgRole {
                base_role: UserRole::User,
                custom_role: None,
            },
            "admin@zo.dev",
        )
        .await;
        assert!(resp.is_ok());
        let response = resp.unwrap();
        assert_eq!(response.status(), 422);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_get_user_roles_by_org_id_with_org() {
        let roles = vec![
            "org1/admin".to_string(),
            "org1/editor".to_string(),
            "org2/viewer".to_string(),
        ];

        let filtered = get_user_roles_by_org_id(roles, Some("org1"));

        assert_eq!(filtered.len(), 2);
        assert!(filtered.contains(&"admin".to_string()));
        assert!(filtered.contains(&"editor".to_string()));
        assert!(!filtered.contains(&"viewer".to_string()));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_get_user_roles_by_org_id_without_org() {
        let roles = vec!["org1/admin".to_string(), "org2/viewer".to_string()];

        let filtered = get_user_roles_by_org_id(roles.clone(), None);

        // None org_id returns all roles
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered, roles);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_get_user_roles_by_org_id_no_matching_org() {
        let roles = vec!["org1/admin".to_string(), "org2/editor".to_string()];

        let filtered = get_user_roles_by_org_id(roles, Some("org3"));

        // No roles match org3
        assert_eq!(filtered.len(), 0);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_get_user_roles_by_org_id_empty_roles() {
        let roles = vec![];

        let filtered = get_user_roles_by_org_id(roles, Some("org1"));

        assert_eq!(filtered.len(), 0);
    }
}
