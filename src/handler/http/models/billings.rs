// Copyright 2024 OpenObserve Inc.
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

//! These models define the schemas of HTTP request and response JSON bodies in
//! billings API endpoints.

use o2_enterprise::enterprise::cloud::org_usage::OrgUsageRecord;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// HTTP request body for `CreateQuotaThreshold` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct GetQuotaThresholdResponseBody {
    pub data: OrgQuotaThreshold,
    pub message: String,
}

/// HTTP response body for `CreateQuotaThreshold` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct CreateFolderResponseBody(pub Folder);

/// HTTP response body for `GetFolder` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct GetFolderResponseBody(pub Folder);

/// HTTP request body for `UpdateFolder` endpoint.
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct UpdateFolderRequestBody(pub Folder);

/// HTTP response body for `ListFolder` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ListFoldersResponseBody {
    pub list: Vec<Folder>,
}

/// Indicates the type of data that the folder can contain.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FolderType {
    Dashboards,
    Alerts,
}

/// Common folder fields used in HTTP request and response bodies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    #[serde(default)]
    pub folder_id: String,
    pub name: String,
    pub description: String,
}

impl From<config::meta::folder::Folder> for CreateFolderResponseBody {
    fn from(value: config::meta::folder::Folder) -> Self {
        Self(value.into())
    }
}

impl From<config::meta::folder::Folder> for GetFolderResponseBody {
    fn from(value: config::meta::folder::Folder) -> Self {
        Self(value.into())
    }
}

impl From<UpdateFolderRequestBody> for config::meta::folder::Folder {
    fn from(value: UpdateFolderRequestBody) -> Self {
        value.0.into()
    }
}

impl From<FolderType> for infra::table::folders::FolderType {
    fn from(value: FolderType) -> Self {
        match value {
            FolderType::Dashboards => Self::Dashboards,
            FolderType::Alerts => Self::Alerts,
        }
    }
}

impl From<Vec<config::meta::folder::Folder>> for ListFoldersResponseBody {
    fn from(value: Vec<config::meta::folder::Folder>) -> Self {
        Self {
            list: value.into_iter().map(Folder::from).collect(),
        }
    }
}

impl From<config::meta::folder::Folder> for Folder {
    fn from(value: config::meta::folder::Folder) -> Self {
        Self {
            folder_id: value.folder_id,
            name: value.name,
            description: value.description,
        }
    }
}

impl From<Folder> for config::meta::folder::Folder {
    fn from(value: Folder) -> Self {
        Self {
            folder_id: value.folder_id,
            name: value.name,
            description: value.description,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema, Default)]
pub struct OrgQuotaThreshold {
    ingestion: i64,
    query: i64,
    pipeline_process: i64,
    rum_session: i64,
    dashboard: i64,
    metric: i64,
    trace: i64,
}

impl From<OrgUsageRecord> for GetQuotaThresholdResponseBody {
    fn from(value: OrgUsageRecord) -> Self {
        let data = OrgQuotaThreshold {
            ingestion: value.ingestion_size,
            query: value.query_size,
            pipeline_process: value.pipeline_process_size,
            rum_session: value.rum_session_size,
            dashboard: value.dashboard_size,
            metric: value.metric_size,
            trace: value.trace_size,
        };
        Self {
            data,
            message: "Organization monthly quota pulled successfully.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use config::utils::json;

    use super::{GetQuotaThresholdResponseBody, OrgQuotaThreshold};

    #[test]
    fn test_data() {
        let data = OrgQuotaThreshold {
            ..Default::default()
        };
        let resp = GetQuotaThresholdResponseBody {
            data,
            message: "hello".to_string(),
        };

        let r_str = json::to_string(&resp).unwrap();
        println!("{r_str}");
    }
}
