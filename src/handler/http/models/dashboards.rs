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

use chrono::{DateTime, FixedOffset, Utc};
use config::meta::{
    dashboards::{
        Dashboard as MetaDashboard, DashboardListError, v1, v2, v3, v4, v5, v6, v7, v8,
        validation::ValidationError,
    },
    folder::Folder as MetaFolder,
};
use hashbrown::HashMap;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

/// HTTP request body for the `CreateDashboard`/`UpdateDashboard` endpoints.
#[derive(Debug, ToSchema, Serialize)]
#[serde(untagged)]
pub enum DashboardRequestBody {
    V1(v1::Dashboard),
    V2(v2::Dashboard),
    V3(v3::Dashboard),
    V4(v4::Dashboard),
    V5(v5::Dashboard),
    V6(v6::Dashboard),
    V7(v7::Dashboard),
    V8(v8::Dashboard),
}

/// Tracks the max version of dashboard currently supported.
/// This value is used as the default when `version` key is missing
/// in body. This helps avoid manually updating the code when a new
/// version of dashboard is added.
const LATEST_DASHBOARD_VERSION: i64 = std::mem::variant_count::<DashboardRequestBody>() as i64;

impl<'de> Deserialize<'de> for DashboardRequestBody {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Map::<String, Value>::deserialize(deserializer)?;

        let version = value
            .get("version")
            .and_then(Value::as_i64)
            .unwrap_or(LATEST_DASHBOARD_VERSION);

        let dash = match version {
            1 => Self::V1(v1::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            2 => Self::V2(v2::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            3 => Self::V3(v3::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            4 => Self::V4(v4::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            5 => Self::V5(v5::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            6 => Self::V6(v6::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            7 => Self::V7(v7::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            8 => Self::V8(v8::Dashboard::deserialize(value).map_err(serde::de::Error::custom)?),
            _ => {
                return Err(serde::de::Error::custom(format!(
                    "unsupported version: {version}"
                )));
            }
        };

        Ok(dash)
    }
}

/// HTTP response body for `CreateDashboard`/`UpdateDashboard` endpoints.
#[derive(Debug, Serialize, ToSchema)]
pub struct DashboardResponseBody(MetaDashboard);

/// HTTP URL query component that contains parameters for listing dashboards.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(style = Form, parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ListDashboardsQuery {
    /// Optional folder ID filter parameter
    ///
    /// If neither `folder` nor any other filter parameter are set then this
    /// will search for all dashboards in the "default" folder.
    ///
    /// If `folder` is not set and another filter parameter, such as `title`, is
    /// set then this will search for dashboards in all folders.
    folder: Option<String>,

    /// The optional case-insensitive title substring with which to filter
    /// dashboards.
    title: Option<String>,

    /// The optional number of dashboards to retrieve. If not set then all
    /// dashboards that match the query parameters will be returned.
    ///
    /// Currently this parameter is only untilized by the API when the `title`
    /// parameter is also set.
    page_size: Option<u64>,
}

/// HTTP response body for `ListDashboards` endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct ListDashboardsResponseBody {
    pub dashboards: Vec<ListDashboardsResponseBodyItem>,
    /// Dashboards that could not be deserialized. Empty when all dashboards
    /// loaded successfully.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<DashboardListError>,
}

/// An item in the list returned by the `ListDashboards` endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct ListDashboardsResponseBodyItem {
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v1: Option<v1::Dashboard>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v2: Option<v2::Dashboard>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v3: Option<v3::Dashboard>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v4: Option<v4::Dashboard>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v5: Option<v5::Dashboard>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v6: Option<v6::Dashboard>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v7: Option<v7::Dashboard>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v8: Option<v8::Dashboard>,

    pub version: i32,
    pub hash: String,

    pub folder_id: String,
    pub folder_name: String,
    pub dashboard_id: String,
    pub title: String,
    pub description: String,
    pub role: String,
    pub owner: String,
    #[schema(value_type = String, format = DateTime)]
    pub created: DateTime<FixedOffset>,
    // TODO: All client APIs should return camelCase
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    /// Validation errors for this dashboard. Empty when valid.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub validation_errors: Vec<ValidationError>,
}

/// HTTP request body for `MoveDashboard` endpoint.
#[derive(Debug, Clone, PartialEq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveDashboardRequestBody {
    pub from: String,
    pub to: String,
}

/// HTTP request body for `MoveDashboards` endpoint.
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct MoveDashboardsRequestBody {
    /// IDs of the dashboards to move.
    pub dashboard_ids: Vec<String>,

    /// Indicates the folder to which dashboard should be moved.
    pub dst_folder_id: String,
}

/// Request body for AddPanel and UpdatePanel endpoints.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PanelRequestBody {
    pub panel: v8::Panel,
    pub tab_id: Option<String>,
}

/// Response body for AddPanel and UpdatePanel endpoints.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PanelResponseBody {
    pub panel: v8::Panel,
    pub hash: String,
    pub tab_id: String,
}

/// Response body for DeletePanel endpoint.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeletePanelResponseBody {
    pub hash: String,
    pub panel_id: String,
}

impl From<DashboardRequestBody> for MetaDashboard {
    fn from(value: DashboardRequestBody) -> Self {
        match value {
            DashboardRequestBody::V1(d) => d.into(),
            DashboardRequestBody::V2(d) => d.into(),
            DashboardRequestBody::V3(d) => d.into(),
            DashboardRequestBody::V4(d) => d.into(),
            DashboardRequestBody::V5(d) => d.into(),
            DashboardRequestBody::V6(d) => d.into(),
            DashboardRequestBody::V7(d) => d.into(),
            DashboardRequestBody::V8(d) => d.into(),
        }
    }
}

impl From<MetaDashboard> for DashboardResponseBody {
    fn from(value: MetaDashboard) -> Self {
        Self(value)
    }
}

impl ListDashboardsQuery {
    pub fn into(self, org_id: &str) -> config::meta::dashboards::ListDashboardsParams {
        let mut query = match &self {
            Self {
                folder: Some(f),
                title: Some(t),
                ..
            } => config::meta::dashboards::ListDashboardsParams::new(org_id)
                .with_folder_id(f)
                .where_title_contains(t),
            Self {
                folder: None,
                title: Some(t),
                ..
            } => {
                config::meta::dashboards::ListDashboardsParams::new(org_id).where_title_contains(t)
            }
            Self {
                folder: Some(f),
                title: None,
                ..
            } => config::meta::dashboards::ListDashboardsParams::new(org_id).with_folder_id(f),
            Self {
                folder: None,
                title: None,
                ..
            } => {
                // To preserve backwards-compatability when no filter parameters
                // are given we will list the contents of the default folder.
                config::meta::dashboards::ListDashboardsParams::new(org_id)
                    .with_folder_id(config::meta::folder::DEFAULT_FOLDER)
            }
        };

        // The API currently only supports using page_size to limit the output
        // to the top results. And the page_size parameter is only used when the
        // title parameter is provided to search dashboards by title pattern.
        // When the title parameter is not set we simply want to return all
        // dashboards that match the selected folder so we ignore the page_size
        // parameter.
        if self.title.is_some_and(|t| !t.is_empty())
            && let Some(page_size) = self.page_size
        {
            query = query.paginate(page_size, 0)
        }

        query
    }
}

impl ListDashboardsResponseBody {
    pub fn from_result(
        items: Vec<(MetaFolder, MetaDashboard)>,
        errors: Vec<DashboardListError>,
        validation_errors: HashMap<String, Vec<ValidationError>>,
    ) -> Self {
        let dashboards = items
            .into_iter()
            .map(|(folder, dashboard)| {
                let dash_id = dashboard.dashboard_id().unwrap_or_default().to_owned();
                let v_errors = validation_errors.get(&dash_id).cloned().unwrap_or_default();
                ListDashboardsResponseBodyItem::from_parts(folder, dashboard, v_errors)
            })
            .collect();
        Self { dashboards, errors }
    }
}

impl ListDashboardsResponseBodyItem {
    #[allow(deprecated)]
    fn from_parts(
        folder: MetaFolder,
        dashboard: MetaDashboard,
        validation_errors: Vec<ValidationError>,
    ) -> Self {
        Self {
            folder_id: folder.folder_id,
            folder_name: folder.name,
            dashboard_id: dashboard.dashboard_id().unwrap_or_default().to_owned(),
            title: dashboard.title().unwrap_or_default().to_owned(),
            description: dashboard.description().unwrap_or_default().to_owned(),
            role: dashboard.role().unwrap_or_default().to_owned(),
            owner: dashboard.owner().unwrap_or_default().to_owned(),
            // TODO: Return timestamp in microseconds just like all other apis
            created: dashboard.created_at_deprecated().unwrap_or_else(|| {
                Utc::now().with_timezone(
                    &FixedOffset::east_opt(0).expect("Out of bounds timezone difference"),
                )
            }),
            hash: dashboard.hash,
            version: dashboard.version,
            updated_at: dashboard.updated_at,
            validation_errors,
            // Populate deprecated fields until they are removed from the API.
            v1: dashboard.v1,
            v2: dashboard.v2,
            v3: dashboard.v3,
            v4: dashboard.v4,
            v5: dashboard.v5,
            v6: dashboard.v6,
            v7: dashboard.v7,
            v8: dashboard.v8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_latest_dashboard_version_is_eight() {
        assert_eq!(LATEST_DASHBOARD_VERSION, 8);
    }

    #[test]
    fn test_deserialize_v2_request_body() {
        let json = serde_json::json!({
            "version": 2,
            "title": "My Dashboard",
            "description": "test"
        });
        let body: DashboardRequestBody = serde_json::from_value(json).unwrap();
        assert!(matches!(body, DashboardRequestBody::V2(_)));
    }

    #[test]
    fn test_deserialize_v8_request_body() {
        let json = serde_json::json!({
            "version": 8,
            "title": "V8 Dashboard",
            "description": "test"
        });
        let body: DashboardRequestBody = serde_json::from_value(json).unwrap();
        assert!(matches!(body, DashboardRequestBody::V8(_)));
    }

    #[test]
    fn test_deserialize_unsupported_version_returns_err() {
        let json = serde_json::json!({
            "version": 99,
            "title": "Bad Version",
            "description": "test"
        });
        let result: Result<DashboardRequestBody, _> = serde_json::from_value(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_from_request_body_v2_sets_version() {
        let json = serde_json::json!({
            "version": 2,
            "title": "Converted",
            "description": "test"
        });
        let body: DashboardRequestBody = serde_json::from_value(json).unwrap();
        let meta: MetaDashboard = body.into();
        assert_eq!(meta.version, 2);
    }

    #[test]
    fn test_list_dashboards_query_folder_and_title() {
        let q: ListDashboardsQuery = serde_json::from_value(serde_json::json!({
            "folder": "my_folder",
            "title": "my_title"
        }))
        .unwrap();
        let params = q.into("my_org");
        assert_eq!(params.org_id, "my_org");
        assert_eq!(params.folder_id.as_deref(), Some("my_folder"));
        assert_eq!(params.title_pat.as_deref(), Some("my_title"));
    }

    #[test]
    fn test_list_dashboards_query_title_only() {
        let q: ListDashboardsQuery = serde_json::from_value(serde_json::json!({
            "title": "search_term"
        }))
        .unwrap();
        let params = q.into("org1");
        assert_eq!(params.org_id, "org1");
        assert!(params.folder_id.is_none());
        assert_eq!(params.title_pat.as_deref(), Some("search_term"));
    }

    #[test]
    fn test_list_dashboards_query_folder_only() {
        let q: ListDashboardsQuery = serde_json::from_value(serde_json::json!({
            "folder": "specific_folder"
        }))
        .unwrap();
        let params = q.into("org2");
        assert_eq!(params.org_id, "org2");
        assert_eq!(params.folder_id.as_deref(), Some("specific_folder"));
        assert!(params.title_pat.is_none());
    }

    #[test]
    fn test_list_dashboards_query_no_params_defaults_to_default_folder() {
        let q: ListDashboardsQuery = serde_json::from_value(serde_json::json!({})).unwrap();
        let params = q.into("org3");
        assert_eq!(params.org_id, "org3");
        assert_eq!(
            params.folder_id.as_deref(),
            Some(config::meta::folder::DEFAULT_FOLDER)
        );
        assert!(params.title_pat.is_none());
    }

    #[test]
    fn test_list_dashboards_query_pagination_applied_when_title_and_page_size_set() {
        let q: ListDashboardsQuery = serde_json::from_value(serde_json::json!({
            "title": "some_title",
            "pageSize": 10
        }))
        .unwrap();
        let params = q.into("org4");
        assert!(params.page_size_and_idx.is_some());
        assert_eq!(params.page_size_and_idx, Some((10, 0)));
    }

    #[test]
    fn test_list_dashboards_query_pagination_ignored_when_title_empty() {
        let q: ListDashboardsQuery = serde_json::from_value(serde_json::json!({
            "title": "",
            "pageSize": 10
        }))
        .unwrap();
        let params = q.into("org5");
        assert!(params.page_size_and_idx.is_none());
    }

    #[test]
    fn test_list_dashboards_query_pagination_ignored_without_page_size() {
        let q: ListDashboardsQuery = serde_json::from_value(serde_json::json!({
            "title": "some_title"
        }))
        .unwrap();
        let params = q.into("org6");
        assert!(params.page_size_and_idx.is_none());
    }

    #[test]
    fn test_move_dashboard_request_body_deserialize() {
        let json = serde_json::json!({"from": "folder_a", "to": "folder_b"});
        let body: MoveDashboardRequestBody = serde_json::from_value(json).unwrap();
        assert_eq!(body.from, "folder_a");
        assert_eq!(body.to, "folder_b");
    }
}
