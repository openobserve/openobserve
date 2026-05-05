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

//! These models define the schemas of HTTP request and response JSON bodies in
//! folders API endpoints.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// HTTP request body for `CreateFolder` endpoint.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderRequestBody {
    pub name: String,
    pub description: String,
}

/// HTTP response body for `CreateFolder` endpoint.
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
    Reports,
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

impl From<CreateFolderRequestBody> for config::meta::folder::Folder {
    fn from(value: CreateFolderRequestBody) -> Self {
        Self {
            folder_id: String::default(),
            name: value.name,
            description: value.description,
        }
    }
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

impl From<FolderType> for config::meta::folder::FolderType {
    fn from(value: FolderType) -> Self {
        match value {
            FolderType::Dashboards => Self::Dashboards,
            FolderType::Alerts => Self::Alerts,
            FolderType::Reports => Self::Reports,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_folder_type_all_variants_convert() {
        assert_eq!(
            config::meta::folder::FolderType::from(FolderType::Dashboards),
            config::meta::folder::FolderType::Dashboards
        );
        assert_eq!(
            config::meta::folder::FolderType::from(FolderType::Alerts),
            config::meta::folder::FolderType::Alerts
        );
        assert_eq!(
            config::meta::folder::FolderType::from(FolderType::Reports),
            config::meta::folder::FolderType::Reports
        );
    }

    #[test]
    fn test_folder_from_config_preserves_fields() {
        let src = config::meta::folder::Folder {
            folder_id: "abc".to_string(),
            name: "My Folder".to_string(),
            description: "a description".to_string(),
        };
        let f = Folder::from(src);
        assert_eq!(f.folder_id, "abc");
        assert_eq!(f.name, "My Folder");
        assert_eq!(f.description, "a description");
    }

    #[test]
    fn test_config_folder_from_folder_preserves_fields() {
        let src = Folder {
            folder_id: "xyz".to_string(),
            name: "Test".to_string(),
            description: "d".to_string(),
        };
        let f = config::meta::folder::Folder::from(src);
        assert_eq!(f.folder_id, "xyz");
        assert_eq!(f.name, "Test");
        assert_eq!(f.description, "d");
    }

    #[test]
    fn test_create_folder_request_body_folder_id_is_empty() {
        let req = CreateFolderRequestBody {
            name: "New Folder".to_string(),
            description: "A description".to_string(),
        };
        let f = config::meta::folder::Folder::from(req);
        assert!(f.folder_id.is_empty());
        assert_eq!(f.name, "New Folder");
        assert_eq!(f.description, "A description");
    }

    #[test]
    fn test_create_folder_response_body_from_config_folder() {
        let src = config::meta::folder::Folder {
            folder_id: "resp1".to_string(),
            name: "Response Folder".to_string(),
            description: "desc".to_string(),
        };
        let resp = CreateFolderResponseBody::from(src);
        assert_eq!(resp.0.folder_id, "resp1");
        assert_eq!(resp.0.name, "Response Folder");
    }

    #[test]
    fn test_get_folder_response_body_from_config_folder() {
        let src = config::meta::folder::Folder {
            folder_id: "get1".to_string(),
            name: "Get Folder".to_string(),
            description: "get desc".to_string(),
        };
        let resp = GetFolderResponseBody::from(src);
        assert_eq!(resp.0.folder_id, "get1");
        assert_eq!(resp.0.description, "get desc");
    }

    #[test]
    fn test_update_folder_request_body_into_config_folder() {
        let req = UpdateFolderRequestBody(Folder {
            folder_id: "upd1".to_string(),
            name: "Updated".to_string(),
            description: "new desc".to_string(),
        });
        let f = config::meta::folder::Folder::from(req);
        assert_eq!(f.folder_id, "upd1");
        assert_eq!(f.name, "Updated");
        assert_eq!(f.description, "new desc");
    }

    #[test]
    fn test_list_folders_response_body_preserves_order_and_fields() {
        let folders = vec![
            config::meta::folder::Folder {
                folder_id: "1".to_string(),
                name: "Alpha".to_string(),
                description: "".to_string(),
            },
            config::meta::folder::Folder {
                folder_id: "2".to_string(),
                name: "Beta".to_string(),
                description: "".to_string(),
            },
        ];
        let resp = ListFoldersResponseBody::from(folders);
        assert_eq!(resp.list.len(), 2);
        assert_eq!(resp.list[0].folder_id, "1");
        assert_eq!(resp.list[0].name, "Alpha");
        assert_eq!(resp.list[1].folder_id, "2");
        assert_eq!(resp.list[1].name, "Beta");
    }
}
