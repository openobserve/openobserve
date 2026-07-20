// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Authentication helpers tied to organization and membership state.

use common::{
    infra::config::{ORG_USERS, PASSWORD_HASH},
    meta::{organization::DEFAULT_ORG, user::UserOrgRole},
};
use config::{meta::user::UserRole, utils::hash::get_passcode_hash};

pub fn get_hash(pass: &str, salt: &str) -> String {
    let key = format!("{pass}{salt}");
    match PASSWORD_HASH.get(&key) {
        Some(hash) => hash.value().to_string(),
        None => {
            let hash = get_passcode_hash(pass, salt);
            PASSWORD_HASH.insert(key, hash.clone());
            hash
        }
    }
}

pub fn is_root_user(user_id: &str) -> bool {
    ORG_USERS
        .get(&format!("{DEFAULT_ORG}/{user_id}"))
        .is_some_and(|user| user.role == UserRole::Root)
}

#[cfg(feature = "enterprise")]
pub async fn save_org_tuples(org_id: &str) {
    if o2_openfga::config::get_config().enabled {
        o2_openfga::authorizer::authz::save_org_tuples(org_id).await;
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn save_org_tuples(_org_id: &str) {}

#[cfg(feature = "enterprise")]
pub async fn delete_org_tuples(org_id: &str) {
    if o2_openfga::config::get_config().enabled
        && let Err(err) = o2_openfga::authorizer::authz::delete_org_tuples(org_id).await
    {
        log::error!("[auth] failed to delete org tuples for {org_id}: {err}");
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn delete_org_tuples(_org_id: &str) {}

#[cfg(feature = "enterprise")]
pub fn get_role(role: &UserOrgRole) -> UserRole {
    use std::str::FromStr;

    let role = o2_openfga::authorizer::roles::get_role(role.base_role.to_string());
    UserRole::from_str(&role).unwrap()
}

#[cfg(not(feature = "enterprise"))]
pub fn get_role(_role: &UserOrgRole) -> UserRole {
    UserRole::Admin
}
