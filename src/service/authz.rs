// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use config::meta::user::UserRole;

use crate::common::utils::auth::AuthExtractor;
#[cfg(feature = "enterprise")]
use crate::common::utils::auth::is_root_user;

#[cfg(feature = "enterprise")]
pub async fn check_permissions(
    user_id: &str,
    auth_info: AuthExtractor,
    role: UserRole,
    _is_external: bool,
) -> bool {
    use crate::common::infra::config::ORG_USERS;

    if !o2_openfga::config::get_config().enabled {
        return true;
    }

    if o2_enterprise::enterprise::license::block_feature_for_report_failure().await {
        return true;
    }

    let object_str = auth_info.o2_type;
    log::debug!("Role of user {user_id} is {role:#?}");
    let role = if role == UserRole::Root {
        return true;
    } else {
        role.to_string()
    };

    let org_id = &auth_info.org_id;
    let effective_role = if org_id == config::META_ORG_ID {
        match ORG_USERS.get(&format!("{}/{user_id}", config::META_ORG_ID)) {
            Some(user) => user.role.to_string(),
            None => role,
        }
    } else {
        role
    };

    o2_openfga::authorizer::authz::is_allowed(
        org_id,
        user_id,
        &auth_info.method,
        &object_str,
        &auth_info.parent_id,
        &effective_role,
        auth_info.use_all_org,
        auth_info.use_self_context,
        auth_info.use_self_parent,
    )
    .await
}

#[cfg(not(feature = "enterprise"))]
pub async fn check_permissions(
    _user_id: &str,
    _auth_info: AuthExtractor,
    _role: UserRole,
    _is_external: bool,
) -> bool {
    true
}

#[cfg(feature = "enterprise")]
pub async fn list_objects_for_user(
    org_id: &str,
    user_id: &str,
    permission: &str,
    object_type: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    let openfga_config = o2_openfga::config::get_config();
    if is_root_user(user_id) || !openfga_config.enabled || !openfga_config.list_only_permitted {
        return Ok(None);
    }

    let role = crate::service::users::get_user(Some(org_id), user_id)
        .await
        .map(|user| user.role.to_string())
        .unwrap_or_default();
    let objects = o2_openfga::authorizer::authz::list_objects(
        user_id,
        permission,
        object_type,
        org_id,
        &role,
    )
    .await
    .map_err(|_| anyhow::anyhow!("Unauthorized Access"))?;
    log::debug!("list_objects_for_user for user {user_id} from {org_id} org returns: {objects:#?}");
    Ok(Some(objects))
}

#[cfg(not(feature = "enterprise"))]
pub async fn list_objects_for_user(
    _org_id: &str,
    _user_id: &str,
    _permission: &str,
    _object_type: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    Ok(None)
}
