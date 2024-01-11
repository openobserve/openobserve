#[cfg(feature = "enterprise")]
use jsonwebtoken::TokenData;
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::meta::user::{DBUser, RoleOrg, TokenValidationResponse, UserOrg},
        service::{db, users},
    },
    o2_enterprise::enterprise::common::infra::config::O2_CONFIG,
};
#[cfg(feature = "enterprise")]
use {serde_json::Value, std::collections::HashMap};

#[cfg(feature = "enterprise")]
pub async fn process_token(
    res: (
        TokenValidationResponse,
        Option<TokenData<HashMap<String, Value>>>,
    ),
) {
    use config::CONFIG;
    use o2_enterprise::enterprise::openfga::authorizer::{
        get_user_org_tuple, get_user_role_tuple, update_tuples,
    };

    let dec_token = res.1.unwrap();

    let groups = match dec_token.claims.get("groups") {
        None => vec![],
        Some(groups) => {
            if !groups.is_array() {
                vec![]
            } else {
                groups.as_array().unwrap().to_vec()
            }
        }
    };
    let name = dec_token.claims.get("name").unwrap().as_str().unwrap();
    let user_email = res.0.user_email.to_owned();
    let mut source_orgs: Vec<UserOrg> = vec![];
    let mut tuples_to_add = HashMap::new();
    for group in groups {
        let role_org = parse_dn(group.as_str().unwrap()).unwrap();

        source_orgs.push(UserOrg {
            role: role_org.role,
            name: role_org.org,
            ..UserOrg::default()
        });
    }

    // Check if the user exists in the database
    let db_user = db::user::get_user_by_email(&user_email).await;
    if db_user.is_none() {
        log::info!("User does not exist in the database");

        for (index, org) in source_orgs.iter().enumerate() {
            let mut tuples = vec![];
            o2_enterprise::enterprise::openfga::authorizer::get_user_creation_tuples(
                &org.name,
                &user_email,
                &org.role.to_string(),
                &mut tuples,
            );

            o2_enterprise::enterprise::openfga::authorizer::get_org_creation_tuples(
                &org.name,
                &mut tuples,
                o2_enterprise::enterprise::openfga::meta::mapping::OFGA_MODELS
                    .iter()
                    .map(|(_, fga_entity)| *fga_entity)
                    .collect(),
                o2_enterprise::enterprise::openfga::meta::mapping::NON_OWNING_ORG.to_vec(),
            );
            if index == 0 {
                // this is to allow user call organization api with org
                tuples.push(get_user_org_tuple(&user_email, &user_email));
            }
            tuples_to_add.insert(org.name.to_owned(), tuples);
        }
        let updated_db_user = DBUser {
            email: user_email.to_owned(),
            first_name: name.to_owned(),
            last_name: "".to_owned(),
            password: "".to_owned(),
            salt: "".to_owned(),
            organizations: source_orgs,
            is_external: true,
        };

        match users::update_db_user(updated_db_user).await {
            Ok(_) => {
                log::info!("User added to the database");
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
            Err(e) => {
                log::error!("Error adding user to the database: {}", e);
            }
        }
    } else {
        log::info!("User exists in the database perform check for role change");
        let existing_db_user = db_user.unwrap();
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
            match users::add_user_to_org(
                &org.name,
                &user_email,
                org.role.clone(),
                &CONFIG.auth.root_user_email,
            )
            .await
            {
                Ok(_) => {
                    log::info!("User added to the organization {}", org.name);
                    write_tuples.push(get_user_role_tuple(
                        &org.role.to_string(),
                        &user_email,
                        &org.name,
                    ));
                }
                Err(e) => {
                    log::error!("Error adding user to the organization {}: {}", org.name, e);
                }
            }
        }

        for org in orgs_removed {
            match users::remove_user_from_org(&org.name, &user_email, &CONFIG.auth.root_user_email)
                .await
            {
                Ok(_) => {
                    log::info!("User removed from the organization {}", org.name);
                    delete_tuples.push(get_user_role_tuple(
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
                false,
                &CONFIG.auth.root_user_email,
                crate::common::meta::user::UpdateUser {
                    role: Some(org.role.clone()),
                    ..Default::default()
                },
            )
            .await
            {
                Ok(_) => {
                    log::info!("User update for the organization {}", org.name);
                    delete_tuples.push(get_user_role_tuple(&existing_role, &user_email, &org.name));
                    write_tuples.push(get_user_role_tuple(
                        &org.role.to_string(),
                        &user_email,
                        &org.name,
                    ));
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

        if write_tuples.is_empty() && delete_tuples.is_empty() {
            log::info!("No changes to the user information tuples");
        } else {
            log::info!(
                "openfga tuples: wt {:?} ,dt {:?} ",
                write_tuples,
                delete_tuples
            );

            match update_tuples(write_tuples, delete_tuples).await {
                Ok(_) => {
                    log::info!("User updated to the openfga");
                }
                Err(_) => {
                    log::error!("Error updating user to the openfga");
                }
            }
        }
    };
}

#[cfg(feature = "enterprise")]
fn parse_dn(dn: &str) -> Option<RoleOrg> {
    let mut org = "";
    let mut role = "";

    for part in dn.split(',') {
        let parts: Vec<&str> = part.split('=').collect();
        if parts.len() == 2 {
            if parts[0].eq(&O2_CONFIG.dex.group_attribute) && org.is_empty() {
                org = parts[1];
            }
            if parts[0].eq(&O2_CONFIG.dex.role_attribute) && role.is_empty() {
                role = parts[1];
            }
        }
    }
    let role = if role.contains("admin") {
        crate::common::meta::user::UserRole::Admin
    } else {
        crate::common::meta::user::UserRole::Member
    };
    if org.is_empty() {
        org = &O2_CONFIG.dex.default_org;
    }
    Some(RoleOrg {
        role,
        org: org.to_owned(),
    })
}
