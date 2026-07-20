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

use std::sync::LazyLock;

use regex::Regex;

use crate::meta::authz::Authz;

pub static RE_OFGA_UNSUPPORTED_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[:#?\s'"%&]+"#).unwrap());
static RE_SPACE_AROUND: LazyLock<Regex> = LazyLock::new(|| {
    let char_pattern = r#"[^a-zA-Z0-9:#?'"&%\s]"#;
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

/// Returns whether an object is visible under an optional OpenFGA object list.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_openfga_unsupported_names() {
        assert!(is_ofga_unsupported("name with space"));
        assert_eq!(into_ofga_supported_format("foo : bar"), "foo_bar");
    }
}
