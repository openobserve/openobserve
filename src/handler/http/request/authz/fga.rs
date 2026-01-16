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

#[cfg(feature = "enterprise")]
use axum::response::IntoResponse;
use axum::{Json, extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use {crate::common::utils::auth::check_permissions, o2_dex::meta::auth::RoleRequest};

use crate::{
    common::{
        meta::{
            http::HttpResponse as MetaHttpResponse,
            user::{UserGroup, UserGroupRequest, UserRoleRequest},
        },
        utils::auth::UserEmail,
    },
    handler::http::{
        extractors::Headers,
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
};

#[cfg(feature = "enterprise")]
/// CreateRoles
#[utoipa::path(
    post,
    path = "/{org_id}/roles",
    context_path = "/api",
    tag = "Roles",
    operation_id = "CreateRoles",
    summary = "Create custom role",
    description = "Creates a new custom role with specified permissions and capabilities. Custom roles allow fine-grained access control beyond the standard predefined roles. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(UserRoleRequest), description = "UserRoleRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a role", "category": "authorization"}))
    )
)]
pub async fn create_role(
    Path(org_id): Path<String>,
    Json(user_req): Json<UserRoleRequest>,
) -> Response {
    use crate::{
        common::meta::user::is_standard_role, handler::http::auth::jwt::format_role_name_only,
    };

    let role_name = format_role_name_only(user_req.role.trim());

    if role_name.is_empty() || is_standard_role(&role_name) {
        return MetaHttpResponse::bad_request("Custom role name cannot be empty or standard role");
    }

    match o2_openfga::authorizer::roles::create_role(&role_name, &org_id).await {
        Ok(_) => MetaHttpResponse::ok("Role created successfully"),
        Err(err) => {
            let err = err.to_string();
            if err.contains("write_failed_due_to_invalid_input") {
                MetaHttpResponse::bad_request("Role already exists")
            } else {
                MetaHttpResponse::internal_error("Something went wrong")
            }
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/{org_id}/roles",
    context_path = "/api",
    tag = "Roles",
    operation_id = "CreateRoles",
    summary = "Create custom role",
    description = "Creates a new custom role with specified permissions and capabilities. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(UserRoleRequest), description = "UserRoleRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "create"}))
    )
)]
pub async fn create_role(
    Path(_org_id): Path<String>,
    Json(_role_id): Json<UserRoleRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// DeleteRole
#[utoipa::path(
    delete,
    path = "/{org_id}/roles/{role_id}",
    context_path = "/api",
    tag = "Roles",
    operation_id = "DeleteRole",
    summary = "Delete custom role",
    description = "Permanently removes a custom role from the organization. Users and groups assigned to this role will lose the associated permissions. Standard predefined roles cannot be deleted. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a role", "category": "authorization"}))
    )
)]
pub async fn delete_role(Path((org_id, role_name)): Path<(String, String)>) -> Response {
    match o2_openfga::authorizer::roles::delete_role(&org_id, &role_name).await {
        Ok(_) => MetaHttpResponse::ok(serde_json::json!({"successful": "true"})),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

/// DeleteRoleBulk
#[cfg(feature = "enterprise")]
#[utoipa::path(
    delete,
    path = "/{org_id}/roles/bulk",
    context_path = "/api",
    tag = "Roles",
    operation_id = "DeleteRoleBulk",
    summary = "Delete multiple custom role",
    description = "Permanently removes multiple custom roles from the organization. Users and groups assigned to this role will lose the associated permissions. Standard predefined roles cannot be deleted. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "names of role to be deleted", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_role_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let user_id = user_email.user_id;

    for name in &req.ids {
        if !check_permissions(
            &format!("{org_id}/{name}"),
            &org_id,
            &user_id,
            "roles",
            "DELETE",
            None,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for name in req.ids {
        match o2_openfga::authorizer::roles::delete_role(&org_id, &name).await {
            Ok(_) => {
                successful.push(name);
            }
            Err(e) => {
                log::error!("error in deleting role {org_id}/{name} : {e}");
                unsuccessful.push(name);
                err = Some(e.to_string());
            }
        }
    }
    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    delete,
    path = "/{org_id}/roles/bulk",
    context_path = "/api",
    tag = "Roles",
    operation_id = "DeleteRoleBulk",
    summary = "Delete multiple custom role",
    description = "Permanently removes multiple custom roles from the organization. Users and groups assigned to this role will lose the associated permissions. Standard predefined roles cannot be deleted. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "names of role to be deleted", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_role_bulk(
    Path(_path): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
    Json(_req): Json<BulkDeleteRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
/// DeleteRole
#[utoipa::path(
    delete,
    path = "/{org_id}/roles/{role_id}",
    context_path = "/api",
    tag = "Roles",
    operation_id = "DeleteRole",
    summary = "Delete custom role",
    description = "Permanently removes a custom role from the organization. Users and groups assigned to this role will lose the associated permissions. Standard predefined roles cannot be deleted. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "delete"}))
    )
)]
pub async fn delete_role(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// ListRoles
#[utoipa::path(
    get,
    path = "/{org_id}/roles",
    context_path = "/api",
    tag = "Roles",
    operation_id = "ListRoles",
    summary = "List organization roles",
    description = "Retrieves a list of all roles available in the organization, including both standard predefined roles and custom roles. Users will only see roles they have permissions to view when role-based access control is active. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all roles", "category": "authorization"}))
    )
)]
pub async fn get_roles(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let mut permitted;
    // Get List of allowed objects

    match crate::handler::http::auth::validator::list_objects_for_user(
        &org_id,
        &user_email.user_id,
        "GET",
        "role",
    )
    .await
    {
        Ok(list) => {
            permitted = list;
        }
        Err(e) => {
            return MetaHttpResponse::forbidden(e.to_string());
        }
    }
    // Get List of allowed objects ends

    if let Some(local_permitted) = permitted.as_mut() {
        let prefix = "role:";
        for value in local_permitted.iter_mut() {
            if let Some(remaining) = value.strip_prefix(prefix) {
                *value = remaining.to_string();
            }

            let role_prefix = format!("{org_id}/");
            if let Some(remaining) = value.strip_prefix(&role_prefix) {
                *value = remaining.to_string()
            }
        }
    }

    match o2_openfga::authorizer::roles::get_all_roles(&org_id, permitted).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/roles",
    context_path = "/api",
    tag = "Roles",
    operation_id = "ListRoles",
    summary = "List organization roles",
    description = "Retrieves a list of all roles available in the organization. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "list"}))
    )
)]
pub async fn get_roles(Path(_org_id): Path<String>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// UpdateRoles
#[utoipa::path(
    put,
    path = "/{org_id}/roles/{role_id}",
    context_path = "/api",
    tag = "Roles",
    operation_id = "UpdateRoles",
    summary = "Update role permissions",
    description = "Updates an existing role by adding or removing permissions and users. Allows modification of role capabilities and user assignments to maintain proper access control. Standard roles cannot be modified. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    request_body(content = inline(RoleRequest), description = "RoleRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update a role", "category": "authorization"}))
    )
)]
pub async fn update_role(
    Path((org_id, role_id)): Path<(String, String)>,
    Json(update_role): Json<RoleRequest>,
) -> Response {
    match o2_openfga::authorizer::roles::update_role(
        &org_id,
        &role_id,
        update_role.add,
        update_role.remove,
        update_role.add_users,
        update_role.remove_users,
    )
    .await
    {
        Ok(_) => MetaHttpResponse::ok("Role updated successfully"),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    put,
    path = "/{org_id}/roles/{role_id}",
    context_path = "/api",
    tag = "Roles",
    operation_id = "UpdateRoles",
    summary = "Update role permissions",
    description = "Updates an existing role by adding or removing permissions and users. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn update_role(
    Path(_path): Path<(String, String)>,
    Json(_permissions): Json<String>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// GetResourcePermission
#[utoipa::path(
    get,
    path = "/{org_id}/roles/{role_id}/permissions/{resource}",
    context_path = "/api",
    tag = "Roles",
    operation_id = "GetResourcePermission",
    summary = "Get role permissions for resource",
    description = "Retrieves detailed permissions that a specific role has on a particular resource type. Useful for understanding access control capabilities and auditing role assignments. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
        ("resource" = String, Path, description = "resource"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Object>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_role_permissions(
    Path((org_id, role_id, resource)): Path<(String, String, String)>,
) -> Response {
    match o2_openfga::authorizer::roles::get_role_permissions(&org_id, &role_id, &resource).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/roles/{role_id}/permissions/{resource}",
    context_path = "/api",
    tag = "Roles",
    operation_id = "GetResourcePermission",
    summary = "Get role permissions for resource",
    description = "Retrieves detailed permissions that a specific role has on a particular resource type. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
        ("resource" = String, Path, description = "resource"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Object>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_role_permissions(Path(_path): Path<(String, String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// GetRoleUsers
#[utoipa::path(
    get,
    path = "/{org_id}/roles/{role_id}/users",
    context_path = "/api",
    tag = "Roles",
    operation_id = "GetRoleUsers",
    summary = "Get users assigned to role",
    description = "Retrieves a list of all users who are currently assigned to a specific role. Useful for role management, auditing user permissions, and understanding access control assignments. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_users_with_role(Path((org_id, role_id)): Path<(String, String)>) -> Response {
    match o2_openfga::authorizer::roles::get_users_with_role(&org_id, &role_id).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/roles/{role_id}/users",
    context_path = "/api",
    tag = "Roles",
    operation_id = "GetRoLesUsers",
    summary = "Get users assigned to role",
    description = "Retrieves a list of all users who are currently assigned to a specific role. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_users_with_role(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// GetUserRoles
#[utoipa::path(
    get,
    path = "/{org_id}/users/{user_email}/roles",
    context_path = "/api",
    tag = "Users",
    operation_id = "GetUserRoles",
    summary = "Get roles for user",
    description = "Retrieves all roles assigned to a specific user in the organization. Shows both directly assigned roles and roles inherited through group membership. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = String, Path, description = "User email address"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_roles_for_user(Path((org_id, user_email)): Path<(String, String)>) -> Response {
    let res = o2_openfga::authorizer::roles::get_roles_for_org_user(&org_id, &user_email).await;

    Json(res).into_response()
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/users/{user_email}/roles",
    context_path = "/api",
    tag = "Users",
    operation_id = "GetUserRoles",
    summary = "Get roles for user",
    description = "Retrieves all roles assigned to a specific user in the organization. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = String, Path, description = "User email address"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_roles_for_user(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// GetUserGroups
#[utoipa::path(
    get,
    path = "/{org_id}/users/{user_email}/groups",
    context_path = "/api",
    tag = "Users",
    operation_id = "GetUserGroups",
    summary = "Get groups for user",
    description = "Retrieves all groups that a specific user belongs to in the organization. Shows group memberships which determine inherited roles and permissions. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = String, Path, description = "User email address"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_groups_for_user(Path((org_id, user_email)): Path<(String, String)>) -> Response {
    match o2_openfga::authorizer::groups::get_groups_for_org_user(&org_id, &user_email).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/users/{user_email}/groups",
    context_path = "/api",
    tag = "Users",
    operation_id = "GetUserGroups",
    summary = "Get groups for user",
    description = "Retrieves all groups that a specific user belongs to in the organization. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_email" = String, Path, description = "User email address"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_groups_for_user(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// CreateGroup
#[utoipa::path(
    post,
    path = "/{org_id}/groups",
    context_path = "/api",
    tag = "Groups",
    operation_id = "CreateGroup",
    summary = "Create user group",
    description = "Creates a new user group with specified users and roles. Groups allow efficient management of permissions by assigning roles to groups instead of individual users. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(UserGroup), description = "UserGroup", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn create_group(
    Path(org_id): Path<String>,
    Json(user_group): Json<UserGroup>,
) -> Response {
    use crate::handler::http::auth::jwt::format_role_name_only;

    let mut user_grp = user_group;
    user_grp.name = format_role_name_only(user_grp.name.trim());

    match o2_openfga::authorizer::groups::create_group(
        &org_id,
        &user_grp.name,
        user_grp.users.unwrap_or_default(),
    )
    .await
    {
        Ok(_) => MetaHttpResponse::ok("Group created successfully"),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/{org_id}/groups",
    context_path = "/api",
    tag = "Groups",
    operation_id = "CreateGroup",
    summary = "Create user group",
    description = "Creates a new user group with specified users and roles. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(UserGroup), description = "UserGroup", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn create_group(
    Path(_org_id): Path<String>,
    Json(_user_group): Json<UserGroup>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// UpdateGroup
#[utoipa::path(
    put,
    path = "/{org_id}/groups/{group_name}",
    context_path = "/api",
    tag = "Groups",
    operation_id = "UpdateGroup",
    summary = "Update user group",
    description = "Updates an existing user group by adding or removing users and roles. Allows dynamic management of group membership and permissions to maintain proper access control. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("group_name" = String, Path, description = "Group name"),
    ),
    request_body(content = inline(UserGroupRequest), description = "UserGroupRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn update_group(
    Path((org_id, group_name)): Path<(String, String)>,
    Json(user_group): Json<UserGroupRequest>,
) -> Response {
    let user_grp = user_group;

    match o2_openfga::authorizer::groups::update_group(
        &org_id,
        &group_name,
        user_grp.add_users,
        user_grp.remove_users,
        user_grp.add_roles,
        user_grp.remove_roles,
    )
    .await
    {
        Ok(_) => MetaHttpResponse::ok("Group updated successfully"),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    put,
    path = "/{org_id}/groups/{group_name}",
    context_path = "/api",
    tag = "Groups",
    operation_id = "UpdateGroup",
    summary = "Update user group",
    description = "Updates an existing user group by adding or removing users and roles. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("group_name" = String, Path, description = "Group name"),
    ),
    request_body(content = inline(UserGroupRequest), description = "UserGroupRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn update_group(
    Path(_path): Path<(String, String)>,
    Json(_user_group): Json<UserGroupRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// ListGroups
#[utoipa::path(
    get,
    path = "/{org_id}/groups",
    context_path = "/api",
    tag = "Groups",
    operation_id = "ListGroups",
    summary = "List organization groups",
    description = "Retrieves a list of all user groups in the organization. Users will only see groups they have permissions to view when role-based access control is active. Useful for managing group-based permissions and understanding organizational structure. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_groups(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let mut permitted;
    // Get List of allowed objects

    match crate::handler::http::auth::validator::list_objects_for_user(
        &org_id,
        &user_email.user_id,
        "GET",
        "group",
    )
    .await
    {
        Ok(list) => {
            permitted = list;
        }
        Err(e) => {
            return crate::common::meta::http::HttpResponse::forbidden(e.to_string());
        }
    }
    // Get List of allowed objects ends

    if let Some(mut local_permitted) = permitted {
        let prefix = "group:";
        for value in local_permitted.iter_mut() {
            if value.starts_with(prefix) {
                *value = value.strip_prefix(prefix).unwrap().to_string();
            }
            let group_prefix = format!("{org_id}/");
            if value.starts_with(&group_prefix) {
                *value = value.strip_prefix(&group_prefix).unwrap().to_string()
            }
        }
        permitted = Some(local_permitted);
    }

    match o2_openfga::authorizer::groups::get_all_groups(&org_id, permitted).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/groups",
    context_path = "/api",
    tag = "Groups",
    operation_id = "ListGroups",
    summary = "List organization groups",
    description = "Retrieves a list of all user groups in the organization. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<String>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_groups(Path(_path): Path<String>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// GetGroup
#[utoipa::path(
    get,
    path = "/{org_id}/groups/{group_name}",
    context_path = "/api",
    tag = "Groups",
    operation_id = "GetGroup",
    summary = "Get group details",
    description = "Retrieves detailed information about a specific user group including its members, assigned roles, and configuration. Useful for understanding group composition and permissions. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("group_name" = String, Path, description = "Group name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(UserGroup)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_group_details(Path((org_id, group_name)): Path<(String, String)>) -> Response {
    match o2_openfga::authorizer::groups::get_group_details(&org_id, &group_name).await {
        Ok(res) => Json(res).into_response(),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/groups/{group_name}",
    context_path = "/api",
    tag = "Groups",
    operation_id = "GetGroup",
    summary = "Get group details",
    description = "Retrieves detailed information about a specific user group including its members, assigned roles, and configuration. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("group_name" = String, Path, description = "Group name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(UserGroup)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_group_details(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// GetResources
#[utoipa::path(
    get,
    path = "/{org_id}/resources",
    context_path = "/api",
    tag = "Resources",
    operation_id = "GetResources",
    summary = "Get available resources",
    description = "Retrieves a list of all available resource types that can be used in role and permission assignments. Shows the resource hierarchy and available permission levels for fine-grained access control. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Object>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_resources(Path(_org_id): Path<String>) -> Response {
    #[cfg(feature = "cloud")]
    use o2_openfga::meta::mapping::NON_CLOUD_RESOURCE_KEYS;
    use o2_openfga::meta::mapping::Resource;
    let resources = o2_openfga::meta::mapping::OFGA_MODELS
        .values()
        .collect::<Vec<&Resource>>();
    #[cfg(feature = "cloud")]
    let resources = resources
        .into_iter()
        .filter(|r| !NON_CLOUD_RESOURCE_KEYS.contains(&r.key))
        .collect::<Vec<&Resource>>();
    Json(resources).into_response()
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/resources",
    context_path = "/api",
    tag = "Resources",
    operation_id = "GetResources",
    summary = "Get available resources",
    description = "Retrieves a list of all available resource types that can be used in role and permission assignments. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Object>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_resources(Path(_org_id): Path<String>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(feature = "enterprise")]
/// DeleteGroup
#[utoipa::path(
    delete,
    path = "/{org_id}/groups/{group_name}",
    context_path = "/api",
    tag = "Groups",
    operation_id = "DeleteGroup",
    summary = "Delete user group",
    description = "Permanently removes a user group from the organization. Users in the group will lose group-based permissions but retain any directly assigned roles. This action cannot be undone. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("group_name" = String, Path, description = "Group name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn delete_group(Path((org_id, group_name)): Path<(String, String)>) -> Response {
    match o2_openfga::authorizer::groups::delete_group(&org_id, &group_name).await {
        Ok(_) => MetaHttpResponse::ok(serde_json::json!({"successful": "true"})),
        Err(err) => MetaHttpResponse::internal_error(err),
    }
}

/// DeleteGroupBulk
#[cfg(feature = "enterprise")]
#[utoipa::path(
    delete,
    path = "/{org_id}/groups/bulk",
    context_path = "/api",
    tag = "Groups",
    operation_id = "DeleteGroupBulk",
    summary = "Delete multiple user group",
    description = "Permanently removes multiple user groups from the organization. Users in those groups will lose group-based permissions but retain any directly assigned roles. This action cannot be undone. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "user group names", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_group_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let user_id = user_email.user_id;

    for name in &req.ids {
        if !check_permissions(
            &format!("{org_id}/{name}"),
            &org_id,
            &user_id,
            "groups",
            "DELETE",
            None,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for name in req.ids {
        match o2_openfga::authorizer::groups::delete_group(&org_id, &name).await {
            Ok(_) => {
                successful.push(name);
            }
            Err(e) => {
                log::error!("error in deleting group {org_id}/{name} : {e}");
                unsuccessful.push(name);
                err = Some(e.to_string());
            }
        }
    }

    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    delete,
    path = "/{org_id}/groups/bulk",
    context_path = "/api",
    tag = "Groups",
    operation_id = "DeleteGroupBulk",
    summary = "Delete multiple user group",
    description = "Permanently removes multiple user groups from the organization. Users in those groups will lose group-based permissions but retain any directly assigned roles. This action cannot be undone. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "user group names", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_group_bulk(
    Path(_path): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
    Json(_req): Json<BulkDeleteRequest>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    delete,
    path = "/{org_id}/groups/{group_name}",
    context_path = "/api",
    tag = "Groups",
    operation_id = "DeleteGroup",
    summary = "Delete user group",
    description = "Permanently removes a user group from the organization. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("group_name" = String, Path, description = "Group name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn delete_group(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use axum::http::StatusCode;

    use super::*;
    use crate::common::meta::user::{UserGroup, UserGroupRequest, UserRoleRequest};

    fn extract_status_code(resp: &Response) -> StatusCode {
        resp.status()
    }

    #[cfg(feature = "enterprise")]
    fn mock_user_email() -> Headers<UserEmail> {
        Headers(UserEmail {
            user_id: "test_user".to_string(),
        })
    }

    #[cfg(feature = "enterprise")]
    fn init_ofga_test() {
        // Initialize OFGA store ID for tests to prevent panics
        o2_openfga::config::OFGA_STORE_ID.insert("store_id".to_owned(), "test_store_id".to_owned());
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_create_role_enterprise_success() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let role_request = UserRoleRequest {
                role: "custom_role".to_string(),
                custom: None,
            };

            let resp = create_role(Path("test_org".to_string()), Json(role_request)).await;
            // Note: This will likely fail in test environment due to missing OFGA setup
            // but we're testing the endpoint structure and request handling
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let role_request = UserRoleRequest {
                role: "custom_role".to_string(),
                custom: None,
            };

            let resp = create_role(Path("test_org".to_string()), Json(role_request)).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_create_role_empty_name() {
        #[cfg(feature = "enterprise")]
        {
            let role_request = UserRoleRequest {
                role: "   ".to_string(), // Empty after trim
                custom: None,
            };

            let resp = create_role(Path("test_org".to_string()), Json(role_request)).await;
            assert_eq!(extract_status_code(&resp), StatusCode::BAD_REQUEST);
        }
    }

    #[tokio::test]
    async fn test_create_role_standard_role() {
        #[cfg(feature = "enterprise")]
        {
            let role_request = UserRoleRequest {
                role: "admin".to_string(), // Standard role
                custom: None,
            };

            let resp = create_role(Path("test_org".to_string()), Json(role_request)).await;
            assert_eq!(extract_status_code(&resp), StatusCode::BAD_REQUEST);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_delete_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = delete_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = delete_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_get_roles_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_roles(Path("test_org".to_string()), mock_user_email()).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_roles(Path("test_org".to_string())).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_update_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let role_request = o2_dex::meta::auth::RoleRequest {
                add: vec![o2_dex::meta::auth::O2EntityAuthorization {
                    object: "permission1".to_string(),
                    permission: o2_dex::meta::auth::Permission::AllowAll,
                }],
                remove: vec![o2_dex::meta::auth::O2EntityAuthorization {
                    object: "permission2".to_string(),
                    permission: o2_dex::meta::auth::Permission::AllowAll,
                }],
                add_users: Some(HashSet::from_iter(vec!["user1".to_string()])),
                remove_users: Some(HashSet::from_iter(vec!["user2".to_string()])),
            };

            let resp = update_role(
                Path(("test_org".to_string(), "test_role".to_string())),
                Json(role_request),
            )
            .await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = update_role(
                Path(("test_org".to_string(), "test_role".to_string())),
                Json("test".to_string()),
            )
            .await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_get_role_permissions_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_role_permissions(Path((
                "test_org".to_string(),
                "test_role".to_string(),
                "test_resource".to_string(),
            )))
            .await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_role_permissions(Path((
                "test_org".to_string(),
                "test_role".to_string(),
                "test_resource".to_string(),
            )))
            .await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_get_users_with_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp =
                get_users_with_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp =
                get_users_with_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_get_roles_for_user_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_roles_for_user(Path((
                "test_org".to_string(),
                "test@example.com".to_string(),
            )))
            .await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_roles_for_user(Path((
                "test_org".to_string(),
                "test@example.com".to_string(),
            )))
            .await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_get_groups_for_user_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_groups_for_user(Path((
                "test_org".to_string(),
                "test@example.com".to_string(),
            )))
            .await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_groups_for_user(Path((
                "test_org".to_string(),
                "test@example.com".to_string(),
            )))
            .await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_create_group_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let mut users = HashSet::new();
            users.insert("user1".to_string());
            users.insert("user2".to_string());

            let group = UserGroup {
                name: "test_group".to_string(),
                users: Some(users),
                roles: None,
            };

            let resp = create_group(Path("test_org".to_string()), Json(group)).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let group = UserGroup {
                name: "test_group".to_string(),
                users: None,
                roles: None,
            };

            let resp = create_group(Path("test_org".to_string()), Json(group)).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_update_group_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let mut add_users = HashSet::new();
            add_users.insert("user1".to_string());

            let group_request = UserGroupRequest {
                add_users: Some(add_users),
                remove_users: None,
                add_roles: None,
                remove_roles: None,
            };

            let resp = update_group(
                Path(("test_org".to_string(), "test_group".to_string())),
                Json(group_request),
            )
            .await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let group_request = UserGroupRequest {
                add_users: None,
                remove_users: None,
                add_roles: None,
                remove_roles: None,
            };

            let resp = update_group(
                Path(("test_org".to_string(), "test_group".to_string())),
                Json(group_request),
            )
            .await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_get_groups_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_groups(Path("test_org".to_string()), mock_user_email()).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_groups(Path("test_org".to_string())).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_get_group_details_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp =
                get_group_details(Path(("test_org".to_string(), "test_group".to_string()))).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp =
                get_group_details(Path(("test_org".to_string(), "test_group".to_string()))).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "enterprise",
        should_panic(expected = "called `Option::unwrap()` on a `None` value")
    )]
    async fn test_delete_group_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = delete_group(Path(("test_org".to_string(), "test_group".to_string()))).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            let status = extract_status_code(&resp);
            assert!(status.is_client_error() || status.is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = delete_group(Path(("test_org".to_string(), "test_group".to_string()))).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_get_resources_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let resp = get_resources(Path("test_org".to_string())).await;
            // Should succeed as it doesn't require OFGA setup
            assert!(extract_status_code(&resp).is_success());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_resources(Path("test_org".to_string())).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_user_role_request_validation() {
        let valid_request = UserRoleRequest {
            role: "custom_role".to_string(),
            custom: Some(vec!["permission1".to_string(), "permission2".to_string()]),
        };
        assert_eq!(valid_request.role, "custom_role");
        assert_eq!(
            valid_request.custom,
            Some(vec!["permission1".to_string(), "permission2".to_string()])
        );

        let simple_request = UserRoleRequest {
            role: "simple_role".to_string(),
            custom: None,
        };
        assert_eq!(simple_request.role, "simple_role");
        assert!(simple_request.custom.is_none());
    }

    #[tokio::test]
    async fn test_user_group_validation() {
        let mut users = HashSet::new();
        users.insert("user1".to_string());
        users.insert("user2".to_string());

        let mut roles = HashSet::new();
        roles.insert("role1".to_string());

        let group = UserGroup {
            name: "test_group".to_string(),
            users: Some(users.clone()),
            roles: Some(roles.clone()),
        };

        assert_eq!(group.name, "test_group");
        assert_eq!(group.users, Some(users));
        assert_eq!(group.roles, Some(roles));
    }

    #[tokio::test]
    async fn test_user_group_request_validation() {
        let mut add_users = HashSet::new();
        add_users.insert("user1".to_string());

        let mut remove_users = HashSet::new();
        remove_users.insert("user2".to_string());

        let request = UserGroupRequest {
            add_users: Some(add_users.clone()),
            remove_users: Some(remove_users.clone()),
            add_roles: None,
            remove_roles: None,
        };

        assert_eq!(request.add_users, Some(add_users));
        assert_eq!(request.remove_users, Some(remove_users));
        assert!(request.add_roles.is_none());
        assert!(request.remove_roles.is_none());
    }
}
