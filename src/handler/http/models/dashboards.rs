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

use chrono::{DateTime, FixedOffset, Utc};
use config::meta::{
    dashboards::{Dashboard as MetaDashboard, v1, v2, v3, v4, v5, v6, v7, v8},
    folder::Folder as MetaFolder,
};
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

impl From<Vec<(MetaFolder, MetaDashboard)>> for ListDashboardsResponseBody {
    fn from(value: Vec<(MetaFolder, MetaDashboard)>) -> Self {
        let dashboards = value.into_iter().map(|fd| fd.into()).collect();
        Self { dashboards }
    }
}

impl From<(MetaFolder, MetaDashboard)> for ListDashboardsResponseBodyItem {
    #[allow(deprecated)]
    fn from(value: (MetaFolder, MetaDashboard)) -> Self {
        let folder = value.0;
        let dashboard = value.1;
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
