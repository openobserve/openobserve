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

use common::meta::saved_view::{
    CreateViewRequest, UpdateViewRequest, View, ViewWithoutData, ViewsWithoutData,
};
use config::utils::json;
use infra::errors::Error;

use crate as db;

pub const SAVED_VIEWS_KEY_PREFIX: &str = "/organization/savedviews";
const DEFAULT_VIEW_TYPE: &str = "logs";
const VIEW_TYPES: [&str; 2] = ["logs", "traces"];

pub async fn set_view(org_id: &str, view: &CreateViewRequest) -> Result<View, Error> {
    let view_type = view.view_type.as_deref().unwrap_or(DEFAULT_VIEW_TYPE);
    if !VIEW_TYPES.contains(&view_type) {
        return Err(Error::Message(format!(
            "Invalid view_type '{view_type}', expected one of: {}",
            VIEW_TYPES.join(", ")
        )));
    }
    if view_exists_with_name(org_id, &view.view_name, view_type)
        .await
        .is_some()
    {
        return Err(Error::Message(format!(
            "Saved view with name '{}' already exists in this organization",
            view.view_name
        )));
    }
    let view_id = config::ider::uuid();
    let view = View {
        org_id: org_id.into(),
        view_id: view_id.clone(),
        data: view.data.clone(),
        view_name: view.view_name.clone(),
        view_type: view.view_type.clone(),
    };
    let key = format!("{SAVED_VIEWS_KEY_PREFIX}/{org_id}/{view_id}");
    let val = json::to_vec(&view)
        .map_err(|e| Error::Message(format!("Failed to serialize saved view: {e}")))?;
    if val.is_empty() {
        return Err(Error::Message("Saved views value is empty".to_string()));
    }
    db::put(&key, val.into(), db::NO_NEED_WATCH, None).await?;
    Ok(view)
}

/// Update the given view
pub async fn update_view(
    org_id: &str,
    view_id: &str,
    view: &UpdateViewRequest,
) -> Result<View, Error> {
    let original_view = get_view(org_id, view_id).await?;
    let view_type = original_view
        .view_type
        .as_deref()
        .unwrap_or(DEFAULT_VIEW_TYPE);
    if let Some(existing_id) = view_exists_with_name(org_id, &view.view_name, view_type).await
        && existing_id != view_id
    {
        return Err(Error::Message(format!(
            "Saved view with name '{}' already exists in this organization",
            view.view_name
        )));
    }
    let key = format!("{SAVED_VIEWS_KEY_PREFIX}/{org_id}/{view_id}");
    let updated_view = View {
        data: view.data.clone(),
        view_name: view.view_name.clone(),
        ..original_view
    };
    let val = json::to_vec(&updated_view)
        .map_err(|e| Error::Message(format!("Failed to serialize saved view: {e}")))?;
    if val.is_empty() {
        return Err(Error::Message("Saved views value is empty".to_string()));
    }
    db::put(&key, val.into(), db::NO_NEED_WATCH, None).await?;
    Ok(updated_view)
}

/// Get the saved view id associated with an org_id
pub async fn get_view(org_id: &str, view_id: &str) -> Result<View, Error> {
    let key = format!("{SAVED_VIEWS_KEY_PREFIX}/{org_id}/{view_id}");
    let ret = db::get(&key).await?;
    let view = json::from_slice(&ret)
        .map_err(|e| Error::Message(format!("Failed to deserialize saved view: {e}")))?;
    Ok(view)
}

/// Return all the saved views but query limited data only, associated with a
/// provided org_id This will not contain the payload.
pub async fn get_views_list_only(org_id: &str) -> Result<ViewsWithoutData, Error> {
    let ret = db::list_values(&list_prefix(org_id)).await?;
    let mut views: Vec<ViewWithoutData> = ret
        .iter()
        .filter_map(|view| json::from_slice(view).ok())
        .collect();
    views.sort_by_key(|v| v.view_name.clone());

    Ok(ViewsWithoutData { views })
}

/// Delete a saved view id associated with an org-id
// pub async fn delete_view(org_id: &str, view_id: &str) -> Result<View, Error>
// {
pub async fn delete_view(org_id: &str, view_id: &str) -> Result<(), Error> {
    let key = format!("{SAVED_VIEWS_KEY_PREFIX}/{org_id}/{view_id}");
    db::delete(&key, false, db::NO_NEED_WATCH, None).await?;
    Ok(())
}

async fn view_exists_with_name(org_id: &str, view_name: &str, view_type: &str) -> Option<String> {
    let views = get_views_list_only(org_id).await.ok()?;
    views
        .views
        .iter()
        .find(|v| {
            v.view_type.as_deref().unwrap_or(DEFAULT_VIEW_TYPE) == view_type
                && v.view_name.eq_ignore_ascii_case(view_name)
        })
        .map(|v| v.view_id.clone())
}

// Defensive trailing `/`: a pure prefix-scanning store would otherwise match org `ab` for `a`.
fn list_prefix(org_id: &str) -> String {
    format!("{SAVED_VIEWS_KEY_PREFIX}/{org_id}/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_saved_views_key_prefix_value() {
        assert_eq!(SAVED_VIEWS_KEY_PREFIX, "/organization/savedviews");
    }

    #[test]
    fn test_saved_views_key_prefix_starts_with_slash() {
        assert!(SAVED_VIEWS_KEY_PREFIX.starts_with('/'));
    }

    #[test]
    fn test_list_prefix_does_not_match_an_org_sharing_its_prefix() {
        let own_key = format!("{SAVED_VIEWS_KEY_PREFIX}/a/view1");
        let other_key = format!("{SAVED_VIEWS_KEY_PREFIX}/ab/view1");
        assert!(own_key.starts_with(&list_prefix("a")));
        assert!(!other_key.starts_with(&list_prefix("a")));
    }
}
