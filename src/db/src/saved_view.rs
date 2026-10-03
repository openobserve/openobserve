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
    default_view_type,
};
use config::utils::json;
use infra::errors::Error;

use crate as db;

pub const SAVED_VIEWS_KEY_PREFIX: &str = "/organization/savedviews";

pub async fn set_view(org_id: &str, view: &CreateViewRequest) -> Result<View, Error> {
    if view_exists_with_name(org_id, &view.view_name)
        .await
        .is_some()
    {
        return Err(Error::Message(format!(
            "Saved view with name '{}' already exists in this organization",
            view.view_name
        )));
    }
    let view_id = config::ider::uuid();
    let view = new_view(org_id, &view_id, view);
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
    if let Some(existing_id) = view_exists_with_name(org_id, &view.view_name).await
        && existing_id != view_id
    {
        return Err(Error::Message(format!(
            "Saved view with name '{}' already exists in this organization",
            view.view_name
        )));
    }
    let key = format!("{SAVED_VIEWS_KEY_PREFIX}/{org_id}/{view_id}");
    let updated_view = apply_update(get_view(org_id, view_id).await?, view);
    let val = json::to_vec(&updated_view)
        .map_err(|e| Error::Message(format!("Failed to serialize saved view: {e}")))?;
    if val.is_empty() {
        return Err(Error::Message("Saved views value is empty".to_string()));
    }
    db::put(&key, val.into(), db::NO_NEED_WATCH, None).await?;
    Ok(updated_view)
}

fn new_view(org_id: &str, view_id: &str, view: &CreateViewRequest) -> View {
    View {
        org_id: org_id.into(),
        view_id: view_id.into(),
        data: view.data.clone(),
        view_name: view.view_name.clone(),
        view_type: view.view_type.clone().or_else(default_view_type),
    }
}

/// A request without `view_type` keeps the stored one.
fn apply_update(original: View, view: &UpdateViewRequest) -> View {
    View {
        data: view.data.clone(),
        view_name: view.view_name.clone(),
        view_type: view.view_type.clone().or(original.view_type),
        ..original
    }
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
    let key = format!("{SAVED_VIEWS_KEY_PREFIX}/{org_id}");
    let ret = db::list_values(&key).await?;
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

/// Check if a saved view with the given name already exists in the org.
/// Returns `Some(view_id)` if found, `None` otherwise.
async fn view_exists_with_name(org_id: &str, view_name: &str) -> Option<String> {
    let views = get_views_list_only(org_id).await.ok()?;
    views
        .views
        .iter()
        .find(|v| v.view_name.eq_ignore_ascii_case(view_name))
        .map(|v| v.view_id.clone())
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

    fn stored(view_type: &str) -> View {
        View {
            org_id: "o".into(),
            data: json::json!({"v": 1}),
            view_id: "id".into(),
            view_name: "old".into(),
            view_type: Some(view_type.into()),
        }
    }

    #[test]
    fn test_update_without_view_type_keeps_stored() {
        let req = UpdateViewRequest {
            data: json::json!({"v": 2}),
            view_name: "new".into(),
            view_type: None,
        };
        let updated = apply_update(stored("metrics_explorer"), &req);
        assert_eq!(updated.view_type.as_deref(), Some("metrics_explorer"));
        assert_eq!(updated.view_name, "new");
        assert_eq!(updated.data, json::json!({"v": 2}));
        assert_eq!(updated.view_id, "id");
    }

    #[test]
    fn test_update_with_view_type_replaces_stored() {
        let req = UpdateViewRequest {
            data: json::json!({}),
            view_name: "new".into(),
            view_type: Some("metrics_explorer".into()),
        };
        let updated = apply_update(stored("logs"), &req);
        assert_eq!(updated.view_type.as_deref(), Some("metrics_explorer"));
    }

    #[test]
    fn test_new_view_without_view_type_is_logs() {
        let req = CreateViewRequest {
            data: json::json!({}),
            view_name: "n".into(),
            view_type: None,
        };
        let view = new_view("o", "id", &req);
        assert_eq!(view.view_type.as_deref(), Some("logs"));
    }
}
