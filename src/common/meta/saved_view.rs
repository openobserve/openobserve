// Copyright 2025 OpenObserve Inc.
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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, ToSchema)]
pub struct CreateViewRequest {
    /// Base64 encoded string, containing all the data for a given view.
    /// This data is expected to be versioned so that the frontend can
    /// deserialize as required.
    pub data: serde_json::Value,

    /// User-readable name of the view, doesn't need to be unique.
    pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct UpdateViewRequest {
    /// Base64 encoded string, containing all the data for a given view.
    /// This data is expected to be versioned so that the frontend can
    /// deserialize as required.
    pub data: serde_json::Value,

    /// User-readable name of the view, doesn't need to be unique.
    pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct View {
    pub org_id: String,
    pub data: serde_json::Value,
    pub view_id: String,
    pub view_name: String,
}

/// Save the bandwidth for a given view, without sending the actual data
/// This is expected to be used for listing views.
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ViewWithoutData {
    pub org_id: String,
    pub view_id: String,
    pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct ViewsWithoutData {
    pub views: Vec<ViewWithoutData>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct DeleteViewResponse {
    pub org_id: String,
    pub view_id: String,
    // TODO(ansrivas): Check if we have access to view_name
    // pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct CreateViewResponse {
    pub org_id: String,
    pub view_id: String,
    pub view_name: String,
}

#[cfg(test)]
mod tests {
    use serde_json;

    use super::*;

    #[test]
    fn test_create_view_request_serialization_deserialization() {
        let request = CreateViewRequest {
            data: serde_json::json!({"key": "value", "number": 42}),
            view_name: "test-view".to_string(),
        };

        let serialized = serde_json::to_string(&request);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<CreateViewRequest, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.view_name, "test-view");
        assert_eq!(deserialized.data["key"], "value");
        assert_eq!(deserialized.data["number"], 42);
    }

    #[test]
    fn test_update_view_request_serialization_deserialization() {
        let request = UpdateViewRequest {
            data: serde_json::json!({"updated": true, "version": 2}),
            view_name: "updated-view".to_string(),
        };

        let serialized = serde_json::to_string(&request);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<UpdateViewRequest, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.view_name, "updated-view");
        assert_eq!(deserialized.data["updated"], true);
        assert_eq!(deserialized.data["version"], 2);
    }

    #[test]
    fn test_view_serialization_deserialization() {
        let view = View {
            org_id: "org123".to_string(),
            data: serde_json::json!({"dashboard": "main"}),
            view_id: "view456".to_string(),
            view_name: "main-dashboard".to_string(),
        };

        let serialized = serde_json::to_string(&view);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<View, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.org_id, "org123");
        assert_eq!(deserialized.view_id, "view456");
        assert_eq!(deserialized.view_name, "main-dashboard");
        assert_eq!(deserialized.data["dashboard"], "main");
    }

    #[test]
    fn test_view_without_data_serialization_deserialization() {
        let view = ViewWithoutData {
            org_id: "org123".to_string(),
            view_id: "view456".to_string(),
            view_name: "main-dashboard".to_string(),
        };

        let serialized = serde_json::to_string(&view);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<ViewWithoutData, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.org_id, "org123");
        assert_eq!(deserialized.view_id, "view456");
        assert_eq!(deserialized.view_name, "main-dashboard");
    }

    #[test]
    fn test_views_without_data_serialization_deserialization() {
        let views = ViewsWithoutData {
            views: vec![
                ViewWithoutData {
                    org_id: "org123".to_string(),
                    view_id: "view1".to_string(),
                    view_name: "dashboard1".to_string(),
                },
                ViewWithoutData {
                    org_id: "org123".to_string(),
                    view_id: "view2".to_string(),
                    view_name: "dashboard2".to_string(),
                },
            ],
        };

        let serialized = serde_json::to_string(&views);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<ViewsWithoutData, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.views.len(), 2);
        assert_eq!(deserialized.views[0].view_name, "dashboard1");
        assert_eq!(deserialized.views[1].view_name, "dashboard2");
    }

    #[test]
    fn test_views_without_data_empty() {
        let views = ViewsWithoutData { views: vec![] };

        let serialized = serde_json::to_string(&views);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<ViewsWithoutData, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert!(deserialized.views.is_empty());
    }

    #[test]
    fn test_delete_view_response_serialization_deserialization() {
        let response = DeleteViewResponse {
            org_id: "org123".to_string(),
            view_id: "view456".to_string(),
        };

        let serialized = serde_json::to_string(&response);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<DeleteViewResponse, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.org_id, "org123");
        assert_eq!(deserialized.view_id, "view456");
    }

    #[test]
    fn test_create_view_response_serialization_deserialization() {
        let response = CreateViewResponse {
            org_id: "org123".to_string(),
            view_id: "view456".to_string(),
            view_name: "new-dashboard".to_string(),
        };

        let serialized = serde_json::to_string(&response);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<CreateViewResponse, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.org_id, "org123");
        assert_eq!(deserialized.view_id, "view456");
        assert_eq!(deserialized.view_name, "new-dashboard");
    }
}
