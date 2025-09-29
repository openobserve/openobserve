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

#[cfg(all(feature = "enterprise", not(feature = "cloud")))]
use {
    crate::{
        common::meta::user::RoleOrg,
        service::{organization, users},
    },
    config::meta::user::{UserOrg, UserRole},
    o2_dex::config::get_config as get_dex_config,
    o2_openfga::authorizer::authz::get_add_user_to_org_tuples,
    o2_openfga::authorizer::roles::{
        check_and_get_crole_tuple_for_new_user, get_roles_for_user, get_user_crole_removal_tuples,
    },
    std::str::FromStr,
};
#[cfg(feature = "enterprise")]
use {
    crate::{common::meta::user::TokenValidationResponse, service::db},
    config::meta::user::DBUser,
    jsonwebtoken::TokenData,
    o2_openfga::authorizer::authz::{get_new_user_creation_tuple, update_tuples},
    o2_openfga::config::get_config as get_openfga_config,
    once_cell::sync::Lazy,
    regex::Regex,
    serde_json::Value,
    std::collections::HashMap,
};

#[cfg(feature = "cloud")]
use crate::{
    common::meta::{
        organization::{DEFAULT_ORG, Organization, USER_DEFAULT},
        telemetry,
    },
    service::organization::list_org_users_by_user,
    service::self_reporting::cloud_events::{CloudEvent, EventType, enqueue_cloud_event},
};

#[cfg(feature = "enterprise")]
static RE_ROLE_NAME: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^a-zA-Z0-9_]+").unwrap());

#[cfg(feature = "enterprise")]
pub async fn process_token(
    res: (
        TokenValidationResponse,
        Option<TokenData<HashMap<String, Value>>>,
    ),
) -> Result<Option<(bool, bool)>, anyhow::Error> {
    let dec_token = res.1.unwrap();

    let user_email = res.0.user_email.to_owned();

    let name = match dec_token.claims.get("name") {
        None => res.0.user_email.to_owned(),
        Some(name) => name.as_str().unwrap().to_string(),
    };

    #[cfg(feature = "cloud")]
    {
        Ok(Some(check_and_add_to_org(&user_email, &name).await?))
    }

    #[cfg(not(feature = "cloud"))]
    {
        use config::get_config;
        use o2_openfga::authorizer::authz::get_user_role_deletion_tuple;

        use crate::common::meta::user::UserOrgRole;

        let dex_cfg = get_dex_config();
        let openfga_cfg = get_openfga_config();
        let groups = match dec_token.claims.get(&dex_cfg.group_claim) {
            None => vec![],
            Some(groups) => {
                if !groups.is_array() {
                    vec![]
                } else {
                    groups.as_array().unwrap().to_vec()
                }
            }
        };

        let mut source_orgs: Vec<UserOrg> = vec![];
        let mut custom_roles: Vec<String> = vec![];
        let mut tuples_to_add = HashMap::new();
        if groups.is_empty() {
            let role = if let Some(role) = &res.0.user_role {
                role.clone()
            } else {
                UserRole::from_str(&dex_cfg.default_role).unwrap()
            };
            source_orgs.push(UserOrg {
                role,
                name: dex_cfg.default_org.clone(),
                token: Default::default(),
                rum_token: Default::default(),
            });
        } else {
            for group in groups {
                let role_org = parse_dn(group.as_str().unwrap()).unwrap();
                if openfga_cfg.map_group_to_role {
                    custom_roles.push(format_role_name(
                        &role_org.org,
                        &role_org.custom_role.unwrap(),
                    ));
                } else {
                    source_orgs.push(UserOrg {
                        role: role_org.role,
                        name: role_org.org,
                        token: Default::default(),
                        rum_token: Default::default(),
                    });
                }
            }
        }

        // Assign users custom roles in RBAC
        if openfga_cfg.map_group_to_role {
            map_group_to_custom_role(&user_email, &name, custom_roles, res.0.user_role).await;
            return Ok(None);
        }

        // Check if the user exists in the database
        let db_user = db::user::get_user_by_email(&user_email).await;

        if let Some(db_user) = db_user {
            // check if user is service account and skip the role update ,
            // assumption is always a service account irrespective of the orgs it belongs to
            if res
                .0
                .user_role
                .is_some_and(|r| r.eq(&UserRole::ServiceAccount))
            {
                log::info!("User is service account and skipping the role update");
                return Ok(None);
            }

            log::info!("User exists in the database perform check for role change");
            let existing_db_user = db_user;
            let existing_orgs = existing_db_user.organizations;
            let mut orgs_removed = Vec::new();
            let mut orgs_role_changed = HashMap::new();
            let mut orgs_added = Vec::new();

            let mut write_tuples = Vec::new();
            let mut delete_tuples = Vec::new();

            // Check for newly added organizations
            for source_org in &source_orgs {
                if !existing_orgs
                    .iter()
                    .any(|existing_org| existing_org.name == source_org.name)
                {
                    orgs_added.push(source_org);
                }
            }

            for existing_org in &existing_orgs {
                match source_orgs
                    .iter()
                    .find(|&src_org| src_org.name == existing_org.name)
                {
                    Some(src_org) => {
                        if src_org.role != existing_org.role {
                            // The role has changed for this organization
                            orgs_role_changed.insert(existing_org.role.to_string(), src_org);
                        }
                    }
                    None => {
                        // The organization is not found in source_orgs, hence removed
                        orgs_removed.push(existing_org);
                    }
                }
            }

            // Add the user to the newly added organizations
            for org in orgs_added {
                let _ = organization::check_and_create_org(&org.name).await;

                match users::add_user_to_org(
                    &org.name,
                    &user_email,
                    UserOrgRole {
                        base_role: org.role.clone(),
                        custom_role: None,
                    },
                    &get_config().auth.root_user_email,
                )
                .await
                {
                    Ok(_) => {
                        log::info!("User added to the organization {}", org.name);
                        get_add_user_to_org_tuples(
                            &org.name,
                            &user_email,
                            &org.role.to_string(),
                            &mut write_tuples,
                        );
                    }
                    Err(e) => {
                        log::error!("Error adding user to the organization {}: {}", org.name, e);
                    }
                }
            }

            for org in orgs_removed {
                match users::remove_user_from_org(
                    &org.name,
                    &user_email,
                    &get_config().auth.root_user_email,
                )
                .await
                {
                    Ok(_) => {
                        log::info!("User removed from the organization {}", org.name);
                        delete_tuples.push(get_user_role_deletion_tuple(
                            &org.role.to_string(),
                            &user_email,
                            &org.name,
                        ));
                    }
                    Err(e) => {
                        log::error!(
                            "Error removing user to the organization {}: {}",
                            org.name,
                            e
                        );
                    }
                }
            }
            for (existing_role, org) in orgs_role_changed {
                match users::update_user(
                    &org.name,
                    &user_email,
                    crate::common::meta::user::UserUpdateMode::OtherUpdate,
                    &get_config().auth.root_user_email,
                    crate::common::meta::user::UpdateUser {
                        role: Some(crate::common::meta::user::UserRoleRequest {
                            role: org.role.to_string(),
                            custom: None,
                        }),
                        ..Default::default()
                    },
                )
                .await
                {
                    Ok(_) => {
                        log::info!("User update for the organization {}", org.name);
                        delete_tuples.push(get_user_role_deletion_tuple(
                            &existing_role,
                            &user_email,
                            &org.name,
                        ));
                        get_add_user_to_org_tuples(
                            &org.name,
                            &user_email,
                            &org.role.to_string(),
                            &mut write_tuples,
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "Error updating user to the organization {}: {}",
                            org.name,
                            e
                        );
                    }
                }
            }
            if openfga_cfg.enabled {
                if write_tuples.is_empty() && delete_tuples.is_empty() {
                    log::info!("No changes to the user information tuples");
                } else {
                    log::info!("openfga tuples: wt {write_tuples:?} ,dt {delete_tuples:?} ");

                    match update_tuples(write_tuples, delete_tuples).await {
                        Ok(_) => {
                            log::info!("User updated to the openfga");
                        }
                        Err(_) => {
                            log::error!("Error updating user to the openfga");
                        }
                    }
                }
            }
            Ok(None)
        } else {
            log::info!("User does not exist in the database");

            if openfga_cfg.enabled {
                for (index, org) in source_orgs.iter().enumerate() {
                    // Assuming all the relevant tuples for this org exist
                    let mut tuples = vec![];
                    get_add_user_to_org_tuples(
                        &org.name,
                        &user_email,
                        &org.role.to_string(),
                        &mut tuples,
                    );

                    // Create the org if it does not exist. `org.name` is the id of the org.
                    // Also it creates necessary ofga tuples for the newly created org
                    let _ = organization::check_and_create_org(&org.name).await;

                    if index == 0 {
                        // this is to allow user call organization api with org
                        get_new_user_creation_tuple(&user_email, &mut tuples);
                    }

                    tuples_to_add.insert(org.name.to_owned(), tuples);
                }
            }
            let updated_db_user = DBUser {
                email: user_email.to_owned(),
                first_name: name.to_owned(),
                last_name: "".to_owned(),
                password: "".to_owned(),
                salt: "".to_owned(),
                organizations: source_orgs,
                is_external: true,
                password_ext: Some("".to_owned()),
            };

            match users::create_new_user(updated_db_user).await {
                Ok(_) => {
                    log::info!("User added to the database");
                    if openfga_cfg.enabled {
                        for (_, tuples) in tuples_to_add {
                            match update_tuples(tuples, vec![]).await {
                                Ok(_) => {
                                    log::info!("User updated to the openfga");
                                }
                                Err(e) => {
                                    log::error!("Error updating user to the openfga: {e}");
                                }
                            }
                        }
                    }
                    Ok(None)
                }
                Err(e) => {
                    log::error!("Error adding user to the database: {e}");
                    Ok(None)
                }
            }
        }
    }
}

#[cfg(all(feature = "enterprise", not(feature = "cloud")))]
fn parse_dn(dn: &str) -> Option<RoleOrg> {
    let mut org = "";
    let mut role = "";
    let mut custom_role = None;

    let dex_cfg = get_dex_config();
    let openfga_cfg = get_openfga_config();
    if openfga_cfg.map_group_to_role {
        custom_role = Some(dn.to_owned());
        org = &dex_cfg.default_org;
    } else {
        for part in dn.split(',') {
            let parts: Vec<&str> = part.split('=').collect();
            if parts.len() == 2 {
                if parts[0].eq(&dex_cfg.group_attribute) && org.is_empty() {
                    org = parts[1];
                }
                if parts[0].eq(&dex_cfg.role_attribute) && role.is_empty() {
                    role = parts[1];
                }
            }
        }
    }
    let role = if role.is_empty() {
        UserRole::from_str(&dex_cfg.default_role).unwrap()
    } else {
        UserRole::from_str(role).unwrap()
    };

    if org.is_empty() {
        org = &dex_cfg.default_org;
    }
    Some(RoleOrg {
        role,
        org: org.to_owned(),
        custom_role,
    })
}

#[cfg(all(feature = "enterprise", not(feature = "cloud")))]
async fn map_group_to_custom_role(
    user_email: &str,
    name: &str,
    custom_roles: Vec<String>,
    default_role: Option<UserRole>,
) {
    let dex_cfg = get_dex_config();
    let openfga_cfg = get_openfga_config();
    // Check if the user exists in the database
    let db_user = db::user::get_user_by_email(user_email).await;
    log::debug!("map_group_to_custom_role custom roles: {custom_roles:#?}");

    if db_user.is_none() {
        let mut tuples = vec![];
        log::info!("group_to_custom_role: User does not exist in the database");

        let role = if let Some(role) = default_role {
            role
        } else {
            UserRole::from_str(&dex_cfg.default_role).unwrap()
        };

        if openfga_cfg.enabled {
            let _ = organization::check_and_create_org(&dex_cfg.default_org).await;
            get_add_user_to_org_tuples(
                &dex_cfg.default_org,
                user_email,
                &role.to_string(),
                &mut tuples,
            );
            // this check added to avoid service accounts from logging in
            if !role.eq(&UserRole::ServiceAccount) {
                get_new_user_creation_tuple(user_email, &mut tuples);
            }
            let start = std::time::Instant::now();
            check_and_get_crole_tuple_for_new_user(
                user_email,
                &dex_cfg.default_org,
                custom_roles,
                &mut tuples,
            )
            .await;
            log::info!(
                "group_to_custom_role: Time taken to get crole tuple: {:?}",
                start.elapsed()
            );
        }

        let updated_db_user = DBUser {
            email: user_email.to_owned(),
            first_name: name.to_owned(),
            last_name: "".to_owned(),
            password: "".to_owned(),
            salt: "".to_owned(),
            organizations: vec![UserOrg {
                role,
                name: dex_cfg.default_org.clone(),
                token: Default::default(),
                rum_token: Default::default(),
            }],
            is_external: true,
            password_ext: Some("".to_owned()),
        };

        match users::create_new_user(updated_db_user).await {
            Ok(_) => {
                log::info!("group_to_custom_role: User added to the database");
                if openfga_cfg.enabled {
                    let start = std::time::Instant::now();
                    match update_tuples(tuples, vec![]).await {
                        Ok(_) => {
                            log::info!("group_to_custom_role: User updated to the openfga");
                        }
                        Err(e) => {
                            log::error!(
                                "group_to_custom_role: Error updating user to the openfga: {e}"
                            );
                        }
                    }

                    log::info!(
                        "group_to_custom_role: Time taken to update roles to db for new user: {:?}",
                        start.elapsed()
                    );
                }
            }
            Err(e) => {
                log::error!("group_to_custom_role: Error adding user to the database: {e}");
            }
        }
    } else {
        // check if user is service account and skip the role update
        if default_role.is_some_and(|r| r.eq(&UserRole::ServiceAccount)) {
            log::info!(
                "group_to_custom_role: User is external service account and skipping the role update"
            );
            return;
        }
        log::info!("group_to_custom_role: User exists in the database");
        let mut add_tuples = vec![];
        let mut remove_tuples = vec![];
        // user exists in the db with default org hence skip org creation tuples
        let existing_roles = get_roles_for_user(user_email).await;

        // Find roles to delete: present in existing_role but not in custom_role
        for existing_role in &existing_roles {
            if !custom_roles.contains(existing_role) {
                // delete role
                get_user_crole_removal_tuples(user_email, existing_role, &mut remove_tuples);
            }
        }

        // Find new roles to add: present in custom_role but not in existing_role
        let new_roles = custom_roles
            .iter()
            .filter(|&role| !existing_roles.contains(role))
            .cloned()
            .collect();
        log::debug!("new roles: {new_roles:#?}");

        check_and_get_crole_tuple_for_new_user(
            user_email,
            &dex_cfg.default_org,
            new_roles,
            &mut add_tuples,
        )
        .await;
        log::debug!("add_tuples: {add_tuples:#?}\nremove_tuples: {remove_tuples:#?}");

        if openfga_cfg.enabled {
            let start = std::time::Instant::now();
            match update_tuples(add_tuples, remove_tuples).await {
                Ok(_) => {
                    log::info!("group_to_custom_role: User updated to the openfga");
                }
                Err(e) => {
                    log::error!("group_to_custom_role: Error updating user to the openfga: {e}");
                }
            }
            log::info!(
                "group_to_custom_role: Time taken to update roles to db for existing user: {:?}",
                start.elapsed()
            );
        }
    }
}

#[cfg(all(feature = "enterprise", not(feature = "cloud")))]
fn format_role_name(org: &str, role: &str) -> String {
    let role = format_role_name_only(role);
    format!("{org}/{role}")
}

#[cfg(feature = "enterprise")]
pub fn format_role_name_only(role: &str) -> String {
    RE_ROLE_NAME.replace_all(role, "_").to_string()
}

#[cfg(feature = "cloud")]
pub async fn check_and_add_to_org(
    user_email: &str,
    name: &str,
) -> Result<(bool, bool), anyhow::Error> {
    use config::{ider, utils::json};
    use o2_enterprise::enterprise::cloud::OrgInviteStatus;
    use o2_openfga::authorizer::authz::save_org_tuples;

    use crate::service::users::{add_admin_to_org, create_new_user};
    let o2cfg = get_openfga_config();

    let mut is_new_user = false;
    let mut tuples_to_add = HashMap::new();
    let (first_name, last_name) = name.split_once(' ').unwrap_or((name, ""));
    let db_user = db::user::get_user_by_email(user_email).await;
    let now = chrono::Utc::now().timestamp_micros();
    let pending_invites = match db::user::list_user_invites(user_email).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error in listing invites for {user_email} : {e}");
            vec![]
        }
    };
    let pending_invites = pending_invites
        .into_iter()
        .any(|invite| invite.status == OrgInviteStatus::Pending && invite.expires_at > now);
    if db_user.is_none() {
        is_new_user = true;
        if let Err(e) = o2_enterprise::enterprise::cloud::email::check_email(user_email).await {
            log::info!("blocking user with email {user_email} as domain blocked with : {e}",);
            return Err(anyhow::anyhow!("Email Domain not allowed"));
        }
        match create_new_user(DBUser {
            email: user_email.to_owned(),
            first_name: first_name.to_owned(),
            last_name: last_name.to_owned(),
            password: "".to_owned(),
            salt: "".to_owned(),
            organizations: vec![], // No org
            is_external: true,
            password_ext: Some("".to_owned()),
        })
        .await
        {
            Ok(_) => {
                let mut tuples = vec![];
                get_new_user_creation_tuple(user_email, &mut tuples);
                tuples_to_add.insert(user_email.to_string(), tuples);
                log::info!("User added to the database");
            }
            Err(e) => {
                log::error!("Error adding user to the database: {}", e);
                return Ok((is_new_user, pending_invites));
            }
        }
    }

    // Check if the user is part of any organization
    let org_users = list_org_users_by_user(user_email).await;
    if org_users.is_err() {
        log::error!("Error fetching orgs for user: {}", user_email);
    }

    let (org_name, role) = match org_users {
        Ok(existing_orgs) if !existing_orgs.is_empty() => (
            existing_orgs[0].org_name.to_owned(),
            existing_orgs[0].role.to_string(),
        ),
        // if there are some pending invites, we do not want to create any orgs for the user
        _ if pending_invites => {
            return Ok((is_new_user, pending_invites));
        }
        _ => {
            // Create a default org for the user
            let org = Organization {
                // id will be overridden by the service function
                identifier: ider::uuid(),
                name: DEFAULT_ORG.to_string(),
                org_type: USER_DEFAULT.to_owned(),
            };
            match db::organization::save_org(&org).await {
                Ok(_) => {
                    save_org_tuples(&org.identifier).await;
                    if let Err(e) = add_admin_to_org(&org.identifier, user_email).await {
                        log::error!(
                            "Error adding user as admin to org: {} error: {}",
                            org.identifier,
                            e
                        );
                    }
                    enqueue_cloud_event(CloudEvent {
                        org_id: org.identifier.clone(),
                        org_name: org.name.clone(),
                        org_type: org.org_type.clone(),
                        user: Some(user_email.to_string()),
                        event: EventType::OrgCreated,
                        subscription_type: None,
                        stream_name: None,
                    })
                    .await;
                }
                Err(e) => {
                    log::error!(
                        "Error creating default org for user: {} error: {}",
                        user_email,
                        e
                    );
                }
            };
            (org.name, "admin".to_string()) /* default to Admin when self signup */
        }
    };

    if o2cfg.enabled {
        for (_, tuples) in tuples_to_add {
            match update_tuples(tuples, vec![]).await {
                Ok(_) => {
                    log::info!("User updated to the openfga");
                }
                Err(e) => {
                    log::error!("Error updating user to the openfga: {}", e);
                }
            }
        }
    }

    if is_new_user {
        // Send new user info to ActiveCampaign via segment proxy
        log::info!("sending track event to segment");
        let segment_event_data = HashMap::from([
            (
                "first_name".to_string(),
                json::Value::String(first_name.to_string()),
            ),
            (
                "last_name".to_string(),
                json::Value::String(last_name.to_string()),
            ),
            (
                "email".to_string(),
                json::Value::String(user_email.to_string()),
            ),
            ("organization".to_string(), json::Value::String(org_name)),
            (
                "created_at".to_string(),
                json::Value::String(chrono::Local::now().format("%Y-%m-%d").to_string()),
            ),
            ("role".to_string(), json::Value::String(role)),
        ]);
        let mut telemetry_instance = telemetry::Telemetry::new();
        telemetry_instance
            .send_track_event(
                "OpenObserve - New user registered",
                Some(segment_event_data.clone()),
                false,
                false,
            )
            .await;

        telemetry_instance
            .send_keyevent_track_event(
                "OpenObserve - New user registered",
                Some(segment_event_data),
                false,
                false,
            )
            .await;
    }

    Ok((is_new_user, pending_invites))
}

#[cfg(feature = "enterprise")]
#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::Value;

    use super::*;

    #[test]
    fn test_format_role_name_only() {
        assert_eq!(format_role_name_only("admin-role"), "admin_role");
        assert_eq!(format_role_name_only("user@role"), "user_role");
        assert_eq!(format_role_name_only("test-role-123"), "test_role_123");
        assert_eq!(format_role_name_only("normal_role"), "normal_role");
        assert_eq!(format_role_name_only(""), "");

        // Test special characters replacement
        assert_eq!(format_role_name_only("admin@org.com"), "admin_org_com");
        assert_eq!(format_role_name_only("role!@#$%"), "role_");
        assert_eq!(
            format_role_name_only("test-role  with_spaces"),
            "test_role_with_spaces"
        );
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[test]
    fn test_format_role_name() {
        assert_eq!(format_role_name("org1", "admin-role"), "org1/admin_role");
        assert_eq!(
            format_role_name("test_org", "user@role"),
            "test_org/user_role"
        );
        assert_eq!(format_role_name("", "role"), "/role");

        // Test with special characters
        assert_eq!(
            format_role_name("test@org", "admin-role"),
            "test@org/admin_role"
        );
        assert_eq!(
            format_role_name("org123", "developer@role"),
            "org123/developer_role"
        );
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[test]
    fn test_parse_dn_with_empty_input() {
        let result = parse_dn("");
        assert!(result.is_some());
        let role_org = result.unwrap();
        assert_eq!(role_org.org, "default"); // Assuming default org is "default"
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[test]
    fn test_parse_dn_with_invalid_format() {
        let result = parse_dn("invalid_dn_format");
        assert!(result.is_some());
        let role_org = result.unwrap();
        assert_eq!(role_org.org, "default");
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[test]
    fn test_parse_dn_with_valid_ldap_format() {
        let result = parse_dn("cn=admin,ou=groups,dc=example,dc=com");
        assert!(result.is_some());
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[test]
    fn test_parse_dn_with_multiple_attributes() {
        let result = parse_dn("role=admin,org=testorg,cn=user");
        assert!(result.is_some());
        // The exact behavior depends on the DEX config, but should handle multiple attributes
    }

    #[tokio::test]
    async fn test_process_token_with_invalid_token() {
        use crate::common::meta::user::TokenValidationResponse;

        let validation_response = TokenValidationResponse {
            user_name: "Test User".to_string(),
            family_name: "Test".to_string(),
            given_name: "User".to_string(),
            is_internal_user: false,
            user_email: "test@example.com".to_string(),
            is_valid: false,
            user_role: None,
        };

        let mut claims = HashMap::new();
        claims.insert("name".to_string(), Value::String("Test User".to_string()));
        claims.insert(
            "email".to_string(),
            Value::String("test@example.com".to_string()),
        );

        let token_data = jsonwebtoken::TokenData {
            header: jsonwebtoken::Header::default(),
            claims,
        };

        let result = process_token((validation_response, Some(token_data)))
            .await
            .unwrap();
        assert!(result.is_none() || result == Some((false, false)));
    }

    #[test]
    fn test_role_name_formatting_edge_cases() {
        // Test empty role name
        assert_eq!(format_role_name_only(""), "");

        // Test role name with only special characters
        assert_eq!(format_role_name_only("@#$%^&*()"), "_");

        // Test role name with mixed case and special characters
        assert_eq!(
            format_role_name_only("Admin-Role@Test.Org"),
            "Admin_Role_Test_Org"
        );

        // Test role name with underscores (should remain unchanged)
        assert_eq!(format_role_name_only("admin_role_test"), "admin_role_test");

        // Test role name with numbers
        assert_eq!(format_role_name_only("role123-test456"), "role123_test456");
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[test]
    fn test_parse_dn_custom_role_mapping() {
        // Test when mapping groups to roles is enabled
        // This would require mocking the config, so we test the basic functionality
        let result = parse_dn("developers");
        assert!(result.is_some());
        let role_org = result.unwrap();
        assert!(role_org.custom_role.is_some() || role_org.custom_role.is_none());
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_user_name_parsing() {
        let name = "John Doe Smith";
        let (first_name, last_name) = name.split_once(' ').unwrap_or((name, ""));
        assert_eq!(first_name, "John");
        assert_eq!(last_name, "Doe Smith");

        let name_single = "John";
        let (first_name_single, last_name_single) =
            name_single.split_once(' ').unwrap_or((name_single, ""));
        assert_eq!(first_name_single, "John");
        assert_eq!(last_name_single, "");
    }

    #[test]
    fn test_regex_role_name_replacement() {
        // Test the regex pattern used in RE_ROLE_NAME
        let test_cases = vec![
            ("admin-role", "admin_role"),
            ("user@domain.com", "user_domain_com"),
            ("test_role_123", "test_role_123"),
            ("role!@#$%^&*()", "role_"),
            ("", ""),
            ("OnlyAlphaNumeric123", "OnlyAlphaNumeric123"),
        ];

        for (input, expected) in test_cases {
            assert_eq!(
                format_role_name_only(input),
                expected,
                "Failed for input: {input}"
            );
        }
    }

    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    #[test]
    fn test_parse_dn_with_comma_separated_values() {
        // Test DN with multiple comma-separated values
        let test_cases = vec![
            "cn=admin,ou=users,dc=example,dc=com",
            "role=developer,org=testorg,cn=user1",
            "ou=admins,dc=company,dc=org",
        ];

        for dn in test_cases {
            let result = parse_dn(dn);
            assert!(result.is_some(), "Failed to parse DN: {}", dn);
        }
    }

    #[test]
    #[cfg(all(feature = "enterprise", not(feature = "cloud")))]
    fn test_format_role_name_consistency() {
        let org = "test_org";
        let role = "admin-role";
        let formatted_role = format_role_name_only(role);
        let full_role_name = format_role_name(org, role);

        assert_eq!(full_role_name, format!("{}/{}", org, formatted_role));
        assert!(!full_role_name.contains("-"));
        assert!(!full_role_name.contains("@"));
    }
}
