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
        use o2_openfga::authorizer;

        let Some((obj_str, parent_type)) = ofga_object(obj_type, &obj) else {
            return;
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

/// The tuples `set_ownership` would write for `obj`, for a caller that batches many objects
/// into one write. The folder existence check of `set_ownership` is not repeated here.
#[cfg(feature = "enterprise")]
pub fn ownership_tuples(
    org_id: &str,
    obj_type: &str,
    obj: &Authz,
) -> Vec<o2_openfga::authorizer::authz::TupleKey> {
    let Some((obj_str, parent_type)) = ofga_object(obj_type, obj) else {
        return vec![];
    };
    o2_openfga::authorizer::authz::ownership_tuples(org_id, &obj_str, &obj.parent, parent_type)
}

#[cfg(feature = "enterprise")]
pub async fn remove_ownership(org_id: &str, obj_type: &str, obj: Authz) {
    if o2_openfga::config::get_config().enabled {
        let Some((obj_str, parent_type)) = ofga_object(obj_type, &obj) else {
            return;
        };
        o2_openfga::authorizer::authz::remove_ownership(org_id, &obj_str, &obj.parent, parent_type)
            .await;
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn remove_ownership(_org_id: &str, _obj_type: &str, _obj: Authz) {}

/// Whether ownership tuples are written and removed at all.
#[cfg(feature = "enterprise")]
pub fn tracks_ownership() -> bool {
    o2_openfga::config::get_config().enabled
}

#[cfg(not(feature = "enterprise"))]
pub fn tracks_ownership() -> bool {
    false
}

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

/// OpenFGA object and parent type of `obj`; `None` when either type is unmapped.
#[cfg(feature = "enterprise")]
fn ofga_object(obj_type: &str, obj: &Authz) -> Option<(String, &'static str)> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    // Unmapped types must not panic: ingestion calls this after the schema is saved.
    let Some(model) = OFGA_MODELS.get(obj_type) else {
        log::error!(
            "[OFGA] no model for type {obj_type}, ownership of {} not tracked",
            obj.obj_id
        );
        return None;
    };
    let parent_type = if obj.parent_type.is_empty() {
        ""
    } else if let Some(parent) = OFGA_MODELS.get(obj.parent_type.as_str()) {
        parent.key
    } else {
        log::error!(
            "[OFGA] no model for parent type {}, ownership of {obj_type}:{} not tracked",
            obj.parent_type,
            obj.obj_id
        );
        return None;
    };
    Some((format!("{}:{}", model.key, obj.obj_id), parent_type))
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use super::*;

    #[test]
    fn test_ofga_object_skips_unmapped_types() {
        assert!(ofga_object("no_such_type", &Authz::new("s")).is_none());

        let mut obj = Authz::new("s");
        obj.parent_type = "no_such_type".to_string();
        obj.parent = "p".to_string();
        assert!(ofga_object("logs", &obj).is_none());

        assert_eq!(
            ofga_object("logs", &Authz::new("s")),
            Some(("logs:s".to_string(), ""))
        );
    }
}
