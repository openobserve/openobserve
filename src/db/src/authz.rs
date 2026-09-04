// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use common::meta::authz::Authz;

#[cfg(feature = "enterprise")]
pub async fn set_ownership(org_id: &str, obj_type: &str, obj: Authz) {
    if o2_openfga::config::get_config().enabled {
        use o2_openfga::{authorizer, meta::mapping::OFGA_MODELS};

        let obj_str = format!("{}:{}", OFGA_MODELS.get(obj_type).unwrap().key, obj.obj_id);
        let parent_type = if obj.parent_type.is_empty() {
            ""
        } else {
            OFGA_MODELS.get(obj.parent_type.as_str()).unwrap().key
        };

        // Default folder is already created for new organizations. This also
        // creates missing tuples for organizations created before folder RBAC.
        if obj_type.eq("folders")
            && authorizer::authz::check_folder_exists(org_id, &obj.obj_id).await
        {
            log::debug!(
                "folder tuples already exists for org: {org_id}; folder: {}",
                obj.obj_id
            );
            return;
        } else if obj.parent_type.eq("folders") {
            authorizer::authz::check_folder_exists(org_id, &obj.parent).await;
        }
        authorizer::authz::set_ownership(org_id, &obj_str, &obj.parent, parent_type).await;
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn set_ownership(_org_id: &str, _obj_type: &str, _obj: Authz) {}

#[cfg(feature = "enterprise")]
pub async fn remove_ownership(org_id: &str, obj_type: &str, obj: Authz) {
    if o2_openfga::config::get_config().enabled {
        use o2_openfga::{authorizer, meta::mapping::OFGA_MODELS};

        let obj_str = format!("{}:{}", OFGA_MODELS.get(obj_type).unwrap().key, obj.obj_id);
        let parent_type = if obj.parent_type.is_empty() {
            ""
        } else {
            OFGA_MODELS.get(obj.parent_type.as_str()).unwrap().key
        };

        authorizer::authz::remove_ownership(org_id, &obj_str, &obj.parent, parent_type).await;
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn remove_ownership(_org_id: &str, _obj_type: &str, _obj: Authz) {}

#[cfg(feature = "enterprise")]
pub async fn list_objects_for_user(
    org_id: &str,
    user_id: &str,
    permission: &str,
    object_type: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    let openfga_config = o2_openfga::config::get_config();
    if crate::user::is_root_user(user_id)
        || !openfga_config.enabled
        || !openfga_config.list_only_permitted
    {
        return Ok(None);
    }

    let role = crate::user::get(Some(org_id), user_id)
        .await
        .ok()
        .flatten()
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
