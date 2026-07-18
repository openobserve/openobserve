// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::LazyLock;

use common::{
    infra::config::ORG_USERS,
    meta::{authz::Authz, organization::DEFAULT_ORG, user::UserOrgRole},
};
use config::meta::user::UserRole;
use regex::Regex;

pub static RE_OFGA_UNSUPPORTED_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[:#?\s'\"%&]+"#).unwrap());

static RE_SPACE_AROUND: LazyLock<Regex> = LazyLock::new(|| {
    let char_pattern = r#"[^a-zA-Z0-9:#?'\"&%\s]"#;
    let pattern = format!(r"(\s+{char_pattern}\s+)|(\s+{char_pattern})|({char_pattern}\s+)");
    Regex::new(&pattern).unwrap()
});

pub fn into_ofga_supported_format(name: &str) -> String {
    let result = RE_SPACE_AROUND.replace_all(name, |captures: &regex::Captures| {
        captures
            .iter()
            .find_map(|value| value)
            .map(|value| value.as_str().trim())
            .unwrap_or("")
            .to_string()
    });
    RE_OFGA_UNSUPPORTED_NAME
        .replace_all(&result, "_")
        .to_string()
}

pub fn is_ofga_unsupported(name: &str) -> bool {
    RE_OFGA_UNSUPPORTED_NAME.is_match(name)
}

#[cfg(feature = "enterprise")]
pub fn is_ofga_object_visible(
    org_id: &str,
    object_type: &str,
    object_id: &str,
    permitted_objects: Option<&[String]>,
) -> bool {
    permitted_objects.is_none_or(|objects| {
        objects.contains(&format!("{object_type}:{object_id}"))
            || objects.contains(&format!("{object_type}:_all_{org_id}"))
    })
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
        && let Err(error) = o2_openfga::authorizer::authz::delete_org_tuples(org_id).await
    {
        log::error!("[auth] failed to delete org tuples for {org_id}: {error}");
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

#[cfg(feature = "enterprise")]
pub async fn set_ownership(org_id: &str, object_type: &str, object: Authz) {
    if !o2_openfga::config::get_config().enabled {
        return;
    }

    use o2_openfga::{authorizer, meta::mapping::OFGA_MODELS};

    let object_name = OFGA_MODELS.get(object_type).unwrap().key;
    let object_name = format!("{object_name}:{}", object.obj_id);
    let parent_type = if object.parent_type.is_empty() {
        ""
    } else {
        OFGA_MODELS.get(object.parent_type.as_str()).unwrap().key
    };

    if object_type == "folders"
        && authorizer::authz::check_folder_exists(org_id, &object.obj_id).await
    {
        log::debug!(
            "folder tuples already exist for org: {org_id}; folder: {}",
            object.obj_id
        );
        return;
    }
    if object.parent_type == "folders" {
        authorizer::authz::check_folder_exists(org_id, &object.parent).await;
    }
    authorizer::authz::set_ownership(org_id, &object_name, &object.parent, parent_type).await;
}

#[cfg(not(feature = "enterprise"))]
pub async fn set_ownership(_org_id: &str, _object_type: &str, _object: Authz) {}

#[cfg(feature = "enterprise")]
pub async fn remove_ownership(org_id: &str, object_type: &str, object: Authz) {
    if !o2_openfga::config::get_config().enabled {
        return;
    }

    use o2_openfga::{authorizer, meta::mapping::OFGA_MODELS};

    let object_name = OFGA_MODELS.get(object_type).unwrap().key;
    let object_name = format!("{object_name}:{}", object.obj_id);
    let parent_type = if object.parent_type.is_empty() {
        ""
    } else {
        OFGA_MODELS.get(object.parent_type.as_str()).unwrap().key
    };
    authorizer::authz::remove_ownership(org_id, &object_name, &object.parent, parent_type).await;
}

#[cfg(not(feature = "enterprise"))]
pub async fn remove_ownership(_org_id: &str, _object_type: &str, _object: Authz) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_unsupported_names() {
        assert!(is_ofga_unsupported("bad name"));
        assert_eq!(into_ofga_supported_format("hello world"), "hello_world");
    }
}
