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

#[cfg(feature = "enterprise")]
use axum::response::Response;
use config::meta::user::UserRole;
#[cfg(feature = "enterprise")]
use config::meta::{stream::StreamType, user::User};

use crate::common::utils::auth::AuthExtractor;
#[cfg(feature = "enterprise")]
use crate::common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::is_root_user};

#[cfg(feature = "enterprise")]
#[derive(Clone, Copy)]
pub enum StreamPermissionResourceType {
    Search,
    PatternExtract,
    Insights,
}

/// Checks stream permissions, returning `Some(forbidden response)` when the
/// user is not permitted and `None` when access is allowed.
#[cfg(feature = "enterprise")]
pub async fn check_stream_permissions(
    stream_name: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &StreamType,
    permission_resource_type: StreamPermissionResourceType,
) -> Option<Response> {
    if is_root_user(user_id) {
        return None;
    }

    use o2_openfga::{
        config::get_config,
        meta::mapping::{LOGS_INSIGHTS_KEY, LOGS_PATTERN_KEY, OFGA_MODELS},
    };

    let user: User = crate::service::users::get_user(Some(org_id), user_id)
        .await
        .unwrap();
    let stream_type_str = stream_type.as_str();
    let config = get_config();
    let mut o2_model_type = "";

    match permission_resource_type {
        StreamPermissionResourceType::PatternExtract if config.logs_pattern_rbac_enabled => {
            o2_model_type = LOGS_PATTERN_KEY;
        }
        StreamPermissionResourceType::Insights if config.logs_pattern_rbac_enabled => {
            o2_model_type = LOGS_INSIGHTS_KEY;
        }
        _ => {}
    }

    if o2_model_type.is_empty() {
        o2_model_type = OFGA_MODELS
            .get(stream_type_str)
            .map_or(stream_type_str, |model| model.key);
    }

    if check_permissions(
        user_id,
        AuthExtractor {
            auth: "".to_string(),
            method: "GET".to_string(),
            o2_type: format!("{o2_model_type}:{stream_name}"),
            org_id: org_id.to_string(),
            bypass_check: false,
            parent_id: "".to_string(),
            use_all_org: false,
            use_self_context: false,
            use_self_parent: true,
        },
        user.role,
        user.is_external,
    )
    .await
    {
        None
    } else {
        Some(MetaHttpResponse::forbidden("Unauthorized Access"))
    }
}

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
    db::authz::list_objects_for_user(org_id, user_id, permission, object_type).await
}

#[cfg(not(feature = "enterprise"))]
pub async fn list_objects_for_user(
    _org_id: &str,
    _user_id: &str,
    _permission: &str,
    _object_type: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    db::authz::list_objects_for_user(_org_id, _user_id, _permission, _object_type).await
}
