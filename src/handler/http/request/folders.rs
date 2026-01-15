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

use axum::{extract::Path, response::Response};
use config::meta::folder::Folder;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::folders::{
        CreateFolderRequestBody, CreateFolderResponseBody, FolderType, GetFolderResponseBody,
        ListFoldersResponseBody, UpdateFolderRequestBody,
    },
    service::folders::{self, FolderError},
};
#[cfg(feature = "enterprise")]
use crate::{common::utils::auth::UserEmail, handler::http::extractors::Headers};

impl From<FolderError> for Response {
    fn from(value: FolderError) -> Self {
        match value {
            FolderError::InfraError(err) => MetaHttpResponse::internal_error(err),
            FolderError::TableReportsError(err) => MetaHttpResponse::internal_error(err),
            FolderError::MissingName => {
                MetaHttpResponse::bad_request("Folder name cannot be empty")
            }
            FolderError::UpdateDefaultFolder => {
                MetaHttpResponse::bad_request("Can't update default folder")
            }
            FolderError::DeleteWithDashboards => MetaHttpResponse::bad_request(
                "Folder contains dashboards, please move/delete dashboards from folder",
            ),
            FolderError::DeleteWithAlerts => MetaHttpResponse::bad_request(
                "Folder contains alerts, please move/delete alerts from folder",
            ),
            FolderError::DeleteWithReports => MetaHttpResponse::bad_request(
                "Folder contains reports, please move/delete reports from folder",
            ),
            FolderError::NotFound => MetaHttpResponse::not_found("Folder not found"),
            FolderError::PermittedFoldersMissingUser => MetaHttpResponse::forbidden(""),
            FolderError::PermittedFoldersValidator(err) => MetaHttpResponse::forbidden(err),
            FolderError::FolderNameAlreadyExists => MetaHttpResponse::bad_request(
                "Folder with this name already exists in this organization",
            ),
        }
    }
}

/// CreateFolder
#[utoipa::path(
    post,
    path = "/v2/{org_id}/folders/{folder_type}",
    context_path = "/api",
    tag = "Folders",
    operation_id = "CreateFolder",
    summary = "Create new folder",
    description = "Creates a new folder for organizing dashboards, alerts, or reports. Folders help users organize their \
                   content into logical groups and manage access permissions when using role-based access control.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_type" = FolderType, Path, description = "Type of data the folder can contain"),
    ),
    request_body(
        content = inline(CreateFolderRequestBody),
        description = "Folder details",
        example = json!({
            "name": "Infrastructure",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Folder created", body = inline(CreateFolderResponseBody)),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a new folder", "category": "folders"}))
    ),
)]
pub async fn create_folder(
    Path((org_id, folder_type)): Path<(String, FolderType)>,
    axum::Json(body): axum::Json<CreateFolderRequestBody>,
) -> Response {
    let folder = body.into();
    match folders::save_folder(&org_id, folder, folder_type.into(), false).await {
        Ok(folder) => {
            let body: CreateFolderResponseBody = folder.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => err.into(),
    }
}

/// UpdateFolder
#[utoipa::path(
    put,
    path = "/v2/{org_id}/folders/{folder_type}/{folder_id}",
    context_path = "/api",
    tag = "Folders",
    operation_id = "UpdateFolder",
    summary = "Update folder details",
    description = "Updates an existing folder's name, description, or other properties. Note that the default folder cannot be updated and folders containing content may have restrictions on certain changes.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_type" = FolderType, Path, description = "Type of data the folder can contain"),
        ("folder_id" = String, Path, description = "Folder name"),
    ),
    request_body(
        content = inline(Folder),
        description = "Folder details",
        example = json!({
            "title": "Infra",
            "description": "Traffic patterns and network performance of the infrastructure",
        }),
    ),
    responses(
        (status = StatusCode::OK, description = "Folder updated", body = String),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update folder properties", "category": "folders"}))
    ),
)]
pub async fn update_folder(
    Path((org_id, folder_type, folder_id)): Path<(String, FolderType, String)>,
    axum::Json(body): axum::Json<UpdateFolderRequestBody>,
) -> Response {
    let folder = body.into();
    match folders::update_folder(&org_id, &folder_id, folder_type.into(), folder).await {
        Ok(_) => MetaHttpResponse::ok("Folder updated"),
        Err(err) => err.into(),
    }
}

/// ListFolders
#[utoipa::path(
    get,
    path = "/v2/{org_id}/folders/{folder_type}",
    context_path = "/api",
    tag = "Folders",
    operation_id = "ListFolders",
    summary = "List organization folders",
    description = "Retrieves a list of all folders in the organization for the specified folder type. Users will only see folders they have access to when role-based access control is enabled.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_type" = FolderType, Path, description = "Type of data the folder can contain"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(ListFoldersResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all folders", "category": "folders"}))
    ),
)]
#[allow(unused_variables)]
pub async fn list_folders(
    Path((org_id, folder_type)): Path<(String, FolderType)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    let user_id = None;

    #[cfg(feature = "enterprise")]
    let user_id = Some(user_email.user_id.as_str());

    match folders::list_folders(&org_id, user_id, folder_type.into()).await {
        Ok(folders) => {
            let body: ListFoldersResponseBody = folders.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => err.into(),
    }
}

/// GetFolder
#[utoipa::path(
    get,
    path = "/v2/{org_id}/folders/{folder_type}/{folder_id}",
    context_path = "/api",
    tag = "Folders",
    operation_id = "GetFolder",
    summary = "Get folder details",
    description = "Retrieves detailed information about a specific folder including its name, description, creation details, and metadata. Returns folder information for the specified folder type and ID.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_type" = FolderType, Path, description = "Type of data the folder can contain"),
        ("folder_id" = String, Path, description = "Folder ID"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(GetFolderResponseBody)),
        (status = StatusCode::NOT_FOUND, description = "Folder not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get folder details by ID", "category": "folders"}))
    ),
)]
pub async fn get_folder(
    Path((org_id, folder_type, folder_id)): Path<(String, FolderType, String)>,
) -> Response {
    match folders::get_folder(&org_id, &folder_id, folder_type.into()).await {
        Ok(folder) => {
            let body: CreateFolderResponseBody = folder.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => err.into(),
    }
}

/// GetFolderByName
#[utoipa::path(
    get,
    path = "/v2/{org_id}/folders/{folder_type}/name/{folder_name}",
    context_path = "/api",
    tag = "Folders",
    operation_id = "GetFolderByName",
    summary = "Get folder by name",
    description = "Retrieves detailed information about a specific folder by its name rather than ID. Useful when you know the folder name but not its unique identifier. Returns folder information for the specified folder type and name.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_type" = FolderType, Path, description = "Type of data the folder can contain"),
        ("folder_name" = String, Path, description = "Folder Name"),
    ),
    responses(
        (status = StatusCode::OK, body = inline(GetFolderResponseBody)),
        (status = StatusCode::NOT_FOUND, description = "Folder not found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get folder by name", "category": "folders"}))
    ),
)]
pub async fn get_folder_by_name(
    Path((org_id, folder_type, folder_name)): Path<(String, FolderType, String)>,
) -> Response {
    match folders::get_folder_by_name(&org_id, &folder_name, folder_type.into()).await {
        Ok(folder) => {
            let body: CreateFolderResponseBody = folder.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => err.into(),
    }
}

/// DeleteFolder
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/folders/{folder_type}/{folder_id}",
    context_path = "/api",
    tag = "Folders",
    operation_id = "DeleteFolder",
    summary = "Delete folder",
    description = "Permanently deletes a folder and removes it from the organization. The folder must be empty (no dashboards, alerts, or reports) before it can be deleted. The default folder cannot be deleted.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder_type" = FolderType, Path, description = "Type of data the folder can contain"),
        ("folder_id" = String, Path, description = "Folder ID"),
    ),
    responses(
        (status = StatusCode::OK, description = "Success", body = String),
        (status = StatusCode::NOT_FOUND, description = "NotFound", body = String),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a folder by ID", "category": "folders"}))
    ),
)]
pub async fn delete_folder(
    Path((org_id, folder_type, folder_id)): Path<(String, FolderType, String)>,
) -> Response {
    match folders::delete_folder(&org_id, &folder_id, folder_type.into()).await {
        Ok(()) => MetaHttpResponse::ok("Folder deleted"),
        Err(err) => err.into(),
    }
}

/// Deprecated folder endpoints.
pub mod deprecated {
    use super::*;

    /// CreateFolder
    #[deprecated]
    #[utoipa::path(
        post,
        path = "/{org_id}/folders",
        context_path = "/api",
        tag = "Folders",
        operation_id = "CreateFolderDeprecated",
        summary = "Create a new folder (deprecated)",
        description = "Creates a new dashboard folder - this endpoint is deprecated",
        security(
            ("Authorization" = [])
        ),
        params(
            ("org_id" = String, Path, description = "Organization name"),
        ),
        request_body(
            content = inline(CreateFolderRequestBody),
            description = "Folder details",
            example = json!({
                "name": "Infrastructure",
                "description": "Traffic patterns and network performance of the infrastructure",
            }),
        ),
        responses(
            (status = StatusCode::OK, description = "Folder created", body = inline(CreateFolderResponseBody)),
            (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
        ),
        extensions(
            ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "create"})),
            ("x-o2-mcp" = json!({"enabled": false}))
        ),
    )]
    pub async fn create_folder(
        Path(org_id): Path<String>,
        axum::Json(body): axum::Json<CreateFolderRequestBody>,
    ) -> Response {
        let folder = body.into();
        let folder_type = config::meta::folder::FolderType::Dashboards;
        match folders::save_folder(&org_id, folder, folder_type, false).await {
            Ok(folder) => {
                let body: CreateFolderResponseBody = folder.into();
                MetaHttpResponse::json(body)
            }
            Err(err) => err.into(),
        }
    }

    /// UpdateFolder
    #[deprecated]
    #[utoipa::path(
        put,
        path = "/{org_id}/folders/{folder_id}",
        context_path = "/api",
        tag = "Folders",
        operation_id = "UpdateFolderDeprecated",
        summary = "Update an existing folder (deprecated)",
        description = "Updates folder details like name and description - this endpoint is deprecated",
        security(
            ("Authorization" = [])
        ),
        params(
            ("org_id" = String, Path, description = "Organization name"),
            ("folder_id" = String, Path, description = "Folder name"),
        ),
        request_body(
            content = inline(Folder),
            description = "Folder details",
            example = json!({
                "title": "Infra",
                "description": "Traffic patterns and network performance of the infrastructure",
            }),
        ),
        responses(
            (status = StatusCode::OK, description = "Folder updated", body = String),
            (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = ()),
        ),
        extensions(
            ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "update"})),
            ("x-o2-mcp" = json!({"enabled": false}))
        ),
    )]
    pub async fn update_folder(
        Path((org_id, folder_id)): Path<(String, String)>,
        axum::Json(body): axum::Json<UpdateFolderRequestBody>,
    ) -> Response {
        let folder = body.into();
        let folder_type = config::meta::folder::FolderType::Dashboards;
        match folders::update_folder(&org_id, &folder_id, folder_type, folder).await {
            Ok(_) => MetaHttpResponse::ok("Folder updated"),
            Err(err) => err.into(),
        }
    }

    /// ListFolders
    #[deprecated]
    #[utoipa::path(
        get,
        path = "/{org_id}/folders",
        context_path = "/api",
        tag = "Folders",
        operation_id = "ListFoldersDeprecated",
        summary = "List all folders (deprecated)",
        description = "Retrieves all dashboard folders for the organization - this endpoint is deprecated",
        security(
            ("Authorization" = [])
        ),
        params(
            ("org_id" = String, Path, description = "Organization name"),
        ),
        responses(
            (status = StatusCode::OK, body = inline(ListFoldersResponseBody)),
        ),
        extensions(
            ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "list"})),
            ("x-o2-mcp" = json!({"enabled": false}))
        ),
    )]
    #[allow(unused_variables)]
    pub async fn list_folders(
        Path(org_id): Path<String>,
        #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    ) -> Response {
        #[cfg(not(feature = "enterprise"))]
        let user_id = None;

        #[cfg(feature = "enterprise")]
        let user_id = Some(user_email.user_id.as_str());

        let folder_type = config::meta::folder::FolderType::Dashboards;
        match folders::list_folders(&org_id, user_id, folder_type).await {
            Ok(folders) => {
                let body: ListFoldersResponseBody = folders.into();
                MetaHttpResponse::json(body)
            }
            Err(err) => err.into(),
        }
    }

    /// GetFolder
    #[deprecated]
    #[utoipa::path(
        get,
        path = "/{org_id}/folders/{folder_id}",
        context_path = "/api",
        tag = "Folders",
        operation_id = "GetFolderDeprecated",
        summary = "Get folder by ID (deprecated)",
        description = "Retrieves a specific folder by its identifier - this endpoint is deprecated",
        security(
            ("Authorization" = [])
        ),
        params(
            ("org_id" = String, Path, description = "Organization name"),
            ("folder_id" = String, Path, description = "Folder ID"),
        ),
        responses(
            (status = StatusCode::OK, body = inline(GetFolderResponseBody)),
            (status = StatusCode::NOT_FOUND, description = "Folder not found", body = ()),
        ),
        extensions(
            ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "get"})),
            ("x-o2-mcp" = json!({"enabled": false}))
        ),
    )]
    pub async fn get_folder(Path((org_id, folder_id)): Path<(String, String)>) -> Response {
        let folder_type = config::meta::folder::FolderType::Dashboards;
        match folders::get_folder(&org_id, &folder_id, folder_type).await {
            Ok(folder) => {
                let body: CreateFolderResponseBody = folder.into();
                MetaHttpResponse::json(body)
            }
            Err(err) => err.into(),
        }
    }

    /// GetFolderByName
    #[deprecated]
    #[utoipa::path(
        get,
        path = "/{org_id}/folders/name/{folder_name}",
        context_path = "/api",
        tag = "Folders",
        operation_id = "GetFolderByNameDeprecated",
        summary = "Get folder by name (deprecated)",
        description = "Retrieves a folder using its name instead of ID - this endpoint is deprecated",
        security(
            ("Authorization" = [])
        ),
        params(
            ("org_id" = String, Path, description = "Organization name"),
            ("folder_name" = String, Path, description = "Folder Name"),
        ),
        responses(
            (status = StatusCode::OK, body = inline(GetFolderResponseBody)),
            (status = StatusCode::NOT_FOUND, description = "Folder not found", body = ()),
        ),
        extensions(
            ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "get"})),
            ("x-o2-mcp" = json!({"enabled": false}))
        ),
    )]
    pub async fn get_folder_by_name(
        Path((org_id, folder_name)): Path<(String, String)>,
    ) -> Response {
        let folder_type = config::meta::folder::FolderType::Dashboards;
        match folders::get_folder_by_name(&org_id, &folder_name, folder_type).await {
            Ok(folder) => {
                let body: CreateFolderResponseBody = folder.into();
                MetaHttpResponse::json(body)
            }
            Err(err) => err.into(),
        }
    }

    /// DeleteFolder
    #[deprecated]
    #[utoipa::path(
        delete,
        path = "/{org_id}/folders/{folder_id}",
        context_path = "/api",
        tag = "Folders",
        operation_id = "DeleteFolderDeprecated",
        summary = "Delete a folder (deprecated)",
        description = "Removes a folder and all its contents - this endpoint is deprecated",
        security(
            ("Authorization" = [])
        ),
        params(
            ("org_id" = String, Path, description = "Organization name"),
            ("folder_id" = String, Path, description = "Folder ID"),
        ),
        responses(
            (status = StatusCode::OK, description = "Success", body = ()),
            (status = StatusCode::NOT_FOUND, description = "NotFound", body = ()),
            (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Error", body = ()),
        ),
        extensions(
            ("x-o2-ratelimit" = json!({"module": "Folders", "operation": "delete"})),
            ("x-o2-mcp" = json!({"enabled": false}))
        ),
    )]
    pub async fn delete_folder(Path((org_id, folder_id)): Path<(String, String)>) -> Response {
        let folder_type = config::meta::folder::FolderType::Dashboards;
        match folders::delete_folder(&org_id, &folder_id, folder_type).await {
            Ok(()) => MetaHttpResponse::ok("Folder deleted"),
            Err(err) => err.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_folder_error_conversion() {
        // Test conversion from FolderError to Response
        let test_cases = vec![
            (FolderError::MissingName, 400),
            (FolderError::UpdateDefaultFolder, 400),
            (FolderError::NotFound, 404),
            (FolderError::FolderNameAlreadyExists, 400),
            (FolderError::DeleteWithDashboards, 400),
            (FolderError::DeleteWithAlerts, 400),
            (FolderError::DeleteWithReports, 400),
            (FolderError::PermittedFoldersMissingUser, 403),
            (
                FolderError::PermittedFoldersValidator("test".to_string()),
                403,
            ),
        ];

        for (error, expected_status) in test_cases {
            let response: Response = error.into();
            assert_eq!(response.status().as_u16(), expected_status);
        }
    }
}
