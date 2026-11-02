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
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use {o2_dex::meta::auth::RoleRequest, openobserve_core::auth::check_permissions};

use crate::{
    common::meta::{
        http::HttpResponse as MetaHttpResponse,
        user::{UserGroup, UserGroupRequest, UserRoleRequest},
    },
    request::{BulkDeleteRequest, BulkDeleteResponse},
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
    use openobserve_api_common::auth::jwt::format_role_name_only;

    use crate::common::meta::user::is_standard_role;

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
        (status = 400, description = "Invalid role name", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a role", "category": "authorization", "requires_confirmation": true}))
    )
)]
pub async fn delete_role(Path((org_id, role_name)): Path<(String, String)>) -> Response {
    if !is_storable_name("role", &org_id, &role_name) {
        return MetaHttpResponse::bad_request("Invalid role name");
    }
    match o2_openfga::authorizer::roles::delete_role(&org_id, &role_name).await {
        Ok(_) => MetaHttpResponse::ok(serde_json::json!({"successful": "true"})),
        Err(e) => failure_response(&e, "Failed to delete role"),
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
        (status = 400, description = "Invalid role name", content_type = "application/json", body = ()),
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
    if req
        .ids
        .iter()
        .any(|name| !is_storable_name("role", &org_id, name))
    {
        return MetaHttpResponse::bad_request("Invalid role name");
    }
    let user_id = user_email.user_id;

    for name in &req.ids {
        if !check_permissions(
            &format!("{org_id}/{name}"),
            &org_id,
            &user_id,
            "roles",
            "DELETE",
            None,
            false,
            false,
            true,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let org = org_id.as_str();
    MetaHttpResponse::json(
        bulk_delete(
            req.ids,
            |name| async move { o2_openfga::authorizer::roles::delete_role(org, &name).await },
            "Failed to delete role",
        )
        .await,
    )
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

    match openobserve_api_common::auth::validator::list_objects_for_user(
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

    lookup_response(
        o2_openfga::authorizer::roles::get_all_roles(&org_id, permitted).await,
        "Failed to list roles",
    )
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
        (status = 400, description = "Invalid role name or user id", content_type = "application/json", body = ()),
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
    use o2_openfga::authorizer::{is_valid_tuple_user, org_scoped_object, roles::format_role_user};

    // The role also becomes the `role:{org}/{name}#has` user, which has its own length limit.
    if org_scoped_object("role", &org_id, &role_id).is_none()
        || !is_valid_tuple_user(&format_role_user(&org_id, &role_id))
    {
        return MetaHttpResponse::bad_request("Invalid role name");
    }
    if !update_role
        .add_users
        .iter()
        .chain(update_role.remove_users.iter())
        .flatten()
        .all(|user| o2_openfga::authorizer::is_valid_user_id(user))
    {
        return MetaHttpResponse::bad_request("Invalid user id in role users");
    }
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
        Err(e) => failure_response(&e, "Failed to update role"),
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
    lookup_response(
        o2_openfga::authorizer::roles::get_role_permissions(&org_id, &role_id, &resource).await,
        "Failed to get role permissions",
    )
}

#[cfg(feature = "enterprise")]
/// GetRolePermissions
#[utoipa::path(
    get,
    path = "/{org_id}/roles/{role_id}/permissions",
    context_path = "/api",
    tag = "Roles",
    operation_id = "GetRolePermissions",
    summary = "Get all role permissions",
    description = "Retrieves all permissions a role has across every resource type in a single request. Replaces issuing one request per resource type. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Object>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_all_role_permissions(Path((org_id, role_id)): Path<(String, String)>) -> Response {
    lookup_response(
        o2_openfga::authorizer::roles::get_all_role_permissions(&org_id, &role_id).await,
        "Failed to get role permissions",
    )
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/roles/{role_id}/permissions",
    context_path = "/api",
    tag = "Roles",
    operation_id = "GetRolePermissions",
    summary = "Get all role permissions",
    description = "Retrieves all permissions a role has across every resource type in a single request. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("role_id" = String, Path, description = "Role Id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Object>)),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_all_role_permissions(Path(_path): Path<(String, String)>) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
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
    lookup_response(
        o2_openfga::authorizer::roles::get_users_with_role(&org_id, &role_id).await,
        "Failed to get users with role",
    )
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
    lookup_response(
        o2_openfga::authorizer::roles::get_roles_for_org_user(&org_id, &user_email).await,
        "Failed to get roles for user",
    )
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
/// GetAllUsersRoles
#[utoipa::path(
    get,
    path = "/{org_id}/users/roles/all",
    context_path = "/api",
    tag = "Users",
    operation_id = "GetAllUsersRoles",
    summary = "Get roles for all users",
    description = "Retrieves the roles assigned to every user in the organization in a single request, returned as a map of user email to role list. Replaces issuing one request per user. Requires enterprise features to be enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_roles_for_all_users(Path(org_id): Path<String>) -> Response {
    lookup_response(
        o2_openfga::authorizer::roles::get_roles_for_all_org_users(&org_id).await,
        "Failed to get roles for users",
    )
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/{org_id}/users/roles/all",
    context_path = "/api",
    tag = "Users",
    operation_id = "GetAllUsersRoles",
    summary = "Get roles for all users",
    description = "Retrieves the roles assigned to every user in the organization in a single request. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_roles_for_all_users(Path(_path): Path<String>) -> Response {
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
        (status = 400, description = "Invalid user id", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_groups_for_user(Path((org_id, user_email)): Path<(String, String)>) -> Response {
    if !o2_openfga::authorizer::is_valid_user_id(&user_email) {
        return MetaHttpResponse::bad_request("Invalid user id");
    }
    lookup_response(
        o2_openfga::authorizer::groups::get_groups_for_org_user(&org_id, &user_email).await,
        "Failed to get groups for user",
    )
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
        (status = 400, description = "Invalid group name or user id", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn create_group(
    Path(org_id): Path<String>,
    Json(user_group): Json<UserGroup>,
) -> Response {
    use openobserve_api_common::auth::jwt::format_role_name_only;

    let mut user_grp = user_group;
    user_grp.name = format_role_name_only(user_grp.name.trim());
    let users = user_grp.users.unwrap_or_default();

    if o2_openfga::authorizer::org_scoped_object("group", &org_id, &user_grp.name).is_none() {
        return MetaHttpResponse::bad_request("Invalid group name");
    }
    if !users
        .iter()
        .all(|user| o2_openfga::authorizer::is_valid_user_id(user))
    {
        return MetaHttpResponse::bad_request("Invalid user id in group users");
    }

    match o2_openfga::authorizer::groups::create_group(&org_id, &user_grp.name, users).await {
        Ok(_) => MetaHttpResponse::ok("Group created successfully"),
        // The authorizer's error carries raw OpenFGA text, which stays in the server log.
        Err(_) => MetaHttpResponse::internal_error("Failed to create group"),
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
        (status = 400, description = "Invalid group name or user id", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn update_group(
    Path((org_id, group_name)): Path<(String, String)>,
    Json(user_group): Json<UserGroupRequest>,
) -> Response {
    let user_grp = user_group;

    if o2_openfga::authorizer::org_scoped_object("group", &org_id, &group_name).is_none() {
        return MetaHttpResponse::bad_request("Invalid group name");
    }
    if !user_grp
        .add_users
        .iter()
        .chain(user_grp.remove_users.iter())
        .flatten()
        .all(|user| o2_openfga::authorizer::is_valid_user_id(user))
    {
        return MetaHttpResponse::bad_request("Invalid user id in group users");
    }

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
        // The authorizer's error carries raw OpenFGA text, which stays in the server log.
        Err(_) => MetaHttpResponse::internal_error("Failed to update group"),
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

    match openobserve_api_common::auth::validator::list_objects_for_user(
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
            return common::meta::http::HttpResponse::forbidden(e.to_string());
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

    lookup_response(
        o2_openfga::authorizer::groups::get_all_groups(&org_id, permitted).await,
        "Failed to list groups",
    )
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
        (status = 400, description = "Invalid group name", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn get_group_details(Path((org_id, group_name)): Path<(String, String)>) -> Response {
    if !is_storable_name("group", &org_id, &group_name) {
        return MetaHttpResponse::bad_request("Invalid group name");
    }
    lookup_response(
        o2_openfga::authorizer::groups::get_group_details(&org_id, &group_name).await,
        "Failed to get group",
    )
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
pub async fn get_resources(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "cloud")]
    use o2_openfga::meta::mapping::NON_CLOUD_RESOURCE_KEYS;
    use o2_openfga::meta::mapping::{Resource, remove_resource_keys};
    let resources = o2_openfga::meta::mapping::OFGA_MODELS
        .values()
        .collect::<Vec<&Resource>>();
    #[cfg(feature = "cloud")]
    let resources = resources
        .into_iter()
        .filter(|r| !NON_CLOUD_RESOURCE_KEYS.contains(&r.key))
        .collect::<Vec<&Resource>>();

    let remove_keys = remove_resource_keys();
    let resources = resources
        .into_iter()
        .filter(|r| !remove_keys.contains(&r.key))
        .collect::<Vec<&Resource>>();
    let resources = hide_slack_unless_enabled(
        resources,
        o2_enterprise::enterprise::slack::enabled_for(&org_id),
    );
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
        (status = 400, description = "Invalid group name", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn delete_group(Path((org_id, group_name)): Path<(String, String)>) -> Response {
    if !is_storable_name("group", &org_id, &group_name) {
        return MetaHttpResponse::bad_request("Invalid group name");
    }
    match o2_openfga::authorizer::groups::delete_group(&org_id, &group_name).await {
        Ok(_) => MetaHttpResponse::ok(serde_json::json!({"successful": "true"})),
        Err(e) => failure_response(&e, "Failed to delete group"),
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
        (status = 400, description = "Invalid group name", content_type = "application/json", body = ()),
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
    if req
        .ids
        .iter()
        .any(|name| !is_storable_name("group", &org_id, name))
    {
        return MetaHttpResponse::bad_request("Invalid group name");
    }
    let user_id = user_email.user_id;

    for name in &req.ids {
        if !check_permissions(
            &format!("{org_id}/{name}"),
            &org_id,
            &user_id,
            "groups",
            "DELETE",
            None,
            false,
            false,
            true,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let org = org_id.as_str();
    MetaHttpResponse::json(
        bulk_delete(
            req.ids,
            |name| async move { o2_openfga::authorizer::groups::delete_group(org, &name).await },
            "Failed to delete group",
        )
        .await,
    )
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

#[cfg(feature = "enterprise")]
fn hide_slack_unless_enabled<'a, 'b>(
    resources: Vec<&'b o2_openfga::meta::mapping::Resource<'a>>,
    slack_enabled: bool,
) -> Vec<&'b o2_openfga::meta::mapping::Resource<'a>> {
    let slack_key = o2_openfga::meta::mapping::OFGA_MODELS
        .get("slack")
        .map(|r| r.key);
    if slack_enabled || slack_key.is_none() {
        return resources;
    }
    resources
        .into_iter()
        .filter(|r| Some(r.key) != slack_key)
        .collect()
}

/// The lookup's result, or a fixed 500 that keeps the OpenFGA error in the server log.
#[cfg(feature = "enterprise")]
fn lookup_response<T: serde::Serialize>(
    result: Result<T, anyhow::Error>,
    failure: &str,
) -> Response {
    match result {
        Ok(found) => Json(found).into_response(),
        Err(e) => failure_response(&e, failure),
    }
}

#[cfg(feature = "enterprise")]
fn failure_response(e: &anyhow::Error, failure: &str) -> Response {
    // The authorizer's error carries raw OpenFGA text, which stays in the server log.
    log::error!("{failure}: {e}");
    MetaHttpResponse::internal_error(failure)
}

#[cfg(feature = "enterprise")]
fn is_storable_name(object_type: &str, org_id: &str, name: &str) -> bool {
    // Shape only: an empty name was storable before, so such a role or group must stay deletable.
    o2_openfga::authorizer::is_valid_tuple_object(&format!("{object_type}:{org_id}/{name}"))
}

#[cfg(feature = "enterprise")]
async fn bulk_delete<F, Fut>(ids: Vec<String>, delete: F, failure: &str) -> BulkDeleteResponse
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    let mut successful = Vec::with_capacity(ids.len());
    let mut unsuccessful = Vec::with_capacity(ids.len());
    let mut err = None;
    for name in ids {
        match delete(name.clone()).await {
            Ok(_) => successful.push(name),
            Err(e) => {
                log::error!("{failure} {name}: {e}");
                unsuccessful.push(name);
                err = Some(failure.to_string());
            }
        }
    }
    BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use axum::http::StatusCode;
    use common::meta::user::{UserGroup, UserGroupRequest, UserRoleRequest};

    use super::*;

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
    async fn response_json(resp: Response) -> serde_json::Value {
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    // Only the store id is set; the OpenFGA client stays unset, so OpenFGA calls answer 500.
    #[cfg(feature = "enterprise")]
    fn init_ofga_test() {
        o2_openfga::config::OFGA_STORE_ID.insert("store_id".to_owned(), "test_store_id".to_owned());
    }

    #[tokio::test]
    async fn test_create_role_enterprise_success() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let role_request = UserRoleRequest {
                role: "custom_role".to_string(),
                custom: None,
            };

            let resp = create_role(Path("test_org".to_string()), Json(role_request)).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
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
    async fn test_delete_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = delete_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to delete role"
            );
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = delete_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_get_roles_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_roles(Path("test_org".to_string()), mock_user_email()).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(response_json(resp).await["message"], "Failed to list roles");
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_roles(Path("test_org".to_string())).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
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
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to update role"
            );
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
            assert_eq!(extract_status_code(&resp), StatusCode::OK);
            assert_eq!(response_json(resp).await, serde_json::json!([]));

            // A known resource reaches OpenFGA, which unit tests never initialise.
            let resp = get_role_permissions(Path((
                "test_org".to_string(),
                "test_role".to_string(),
                "dashboards".to_string(),
            )))
            .await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
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
    async fn test_get_users_with_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp =
                get_users_with_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            // The failing-read 500 is covered by `lookup_response_hides_the_openfga_error`.
            assert!(
                !o2_openfga::config::get_config().enabled,
                "unit tests run without OpenFGA"
            );
            assert_eq!(extract_status_code(&resp), StatusCode::OK);
            assert_eq!(response_json(resp).await, serde_json::json!([]));
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp =
                get_users_with_role(Path(("test_org".to_string(), "test_role".to_string()))).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_get_roles_for_user_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_roles_for_user(Path((
                "test_org".to_string(),
                "test@example.com".to_string(),
            )))
            .await;
            // The failing-read 500 is covered by `lookup_response_hides_the_openfga_error`.
            assert!(
                !o2_openfga::config::get_config().enabled,
                "unit tests run without OpenFGA"
            );
            assert_eq!(extract_status_code(&resp), StatusCode::OK);
            assert_eq!(response_json(resp).await, serde_json::json!([]));
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

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn lookup_response_hides_the_openfga_error() {
        let failed = lookup_response(
            Err::<Vec<String>, _>(anyhow::anyhow!("raw OpenFGA text")),
            "Failed to get roles for user",
        );
        assert_eq!(
            extract_status_code(&failed),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            response_json(failed).await["message"],
            "Failed to get roles for user"
        );
        let found = lookup_response(Ok(vec!["editor".to_string()]), "unused");
        assert_eq!(extract_status_code(&found), StatusCode::OK);
        assert_eq!(response_json(found).await, serde_json::json!(["editor"]));
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn roles_and_groups_reject_unstorable_input_with_400() {
        init_ofga_test();
        let path = |name: &str| Path(("test_org".to_string(), name.to_string()));
        let bulk = |name: &str| BulkDeleteRequest {
            ids: vec!["fine".to_string(), name.to_string()],
        };
        for name in ["a#b", "a b", "a:b"] {
            let responses = [
                delete_role(path(name)).await,
                delete_group(path(name)).await,
                get_group_details(path(name)).await,
                delete_role_bulk(
                    Path("test_org".to_string()),
                    mock_user_email(),
                    Json(bulk(name)),
                )
                .await,
                delete_group_bulk(
                    Path("test_org".to_string()),
                    mock_user_email(),
                    Json(bulk(name)),
                )
                .await,
            ];
            for resp in responses {
                assert_eq!(
                    extract_status_code(&resp),
                    StatusCode::BAD_REQUEST,
                    "{name:?}"
                );
            }
        }
        for user in ["*", "a#b", ""] {
            let resp = get_groups_for_user(path(user)).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::BAD_REQUEST,
                "{user:?}"
            );
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn update_role_rejects_invalid_input_with_400() {
        init_ofga_test();
        let members = |user: &str| Some(HashSet::from([user.to_string()]));
        for (name, add_users, remove_users) in [
            ("test_role", members("*"), None),
            ("test_role", None, members("a#b")),
            ("a#b", None, None),
            ("", members("user1"), None),
        ] {
            let role_request = o2_dex::meta::auth::RoleRequest {
                add: vec![],
                remove: vec![],
                add_users,
                remove_users,
            };
            let resp = update_role(
                Path(("test_org".to_string(), name.to_string())),
                Json(role_request),
            )
            .await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::BAD_REQUEST,
                "{name:?}"
            );
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn bulk_delete_hides_the_openfga_error() {
        let resp = bulk_delete(
            vec!["kept".to_string(), "broken".to_string()],
            |name| async move {
                if name == "broken" {
                    Err(anyhow::anyhow!("raw OpenFGA text"))
                } else {
                    Ok(())
                }
            },
            "Failed to delete role",
        )
        .await;
        assert_eq!(resp.successful, vec!["kept".to_string()]);
        assert_eq!(resp.unsuccessful, vec!["broken".to_string()]);
        assert_eq!(resp.err.as_deref(), Some("Failed to delete role"));
    }

    #[tokio::test]
    async fn test_get_roles_for_all_users_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_roles_for_all_users(Path("test_org".to_string())).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to get roles for users"
            );
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_roles_for_all_users(Path("test_org".to_string())).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_get_groups_for_user_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_groups_for_user(Path((
                "test_org".to_string(),
                "test@example.com".to_string(),
            )))
            .await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to get groups for user"
            );
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
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to create group"
            );
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

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn create_group_rejects_invalid_input_with_400() {
        init_ofga_test();
        for (name, user) in [
            ("test_group", "*"),
            ("test_group", "a#b"),
            ("test_group", ""),
            ("", "user1"),
        ] {
            let group = UserGroup {
                name: name.to_string(),
                users: Some(HashSet::from([user.to_string()])),
                roles: None,
            };
            let resp = create_group(Path("test_org".to_string()), Json(group)).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::BAD_REQUEST,
                "{name:?} {user:?}"
            );
        }
    }

    #[tokio::test]
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
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to update group"
            );
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

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn update_group_rejects_invalid_input_with_400() {
        init_ofga_test();
        let members = |user: &str| Some(HashSet::from([user.to_string()]));
        for (name, add_users, remove_users) in [
            ("test_group", members("*"), None),
            ("test_group", members("a#b"), None),
            ("test_group", None, members("")),
            ("", members("user1"), None),
        ] {
            let group_request = UserGroupRequest {
                add_users,
                remove_users,
                add_roles: None,
                remove_roles: None,
            };
            let resp = update_group(
                Path(("test_org".to_string(), name.to_string())),
                Json(group_request),
            )
            .await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::BAD_REQUEST,
                "{name:?}"
            );
        }
    }

    #[tokio::test]
    async fn test_get_groups_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = get_groups(Path("test_org".to_string()), mock_user_email()).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to list groups"
            );
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp = get_groups(Path("test_org".to_string())).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_get_group_details_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp =
                get_group_details(Path(("test_org".to_string(), "test_group".to_string()))).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(response_json(resp).await["message"], "Failed to get group");
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let resp =
                get_group_details(Path(("test_org".to_string(), "test_group".to_string()))).await;
            assert_eq!(extract_status_code(&resp), StatusCode::FORBIDDEN);
        }
    }

    #[tokio::test]
    async fn test_delete_group_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            init_ofga_test();
            let resp = delete_group(Path(("test_org".to_string(), "test_group".to_string()))).await;
            assert_eq!(
                extract_status_code(&resp),
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                response_json(resp).await["message"],
                "Failed to delete group"
            );
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

    #[cfg(feature = "enterprise")]
    #[test]
    fn slack_resource_is_listed_only_while_slack_is_enabled() {
        use o2_openfga::meta::mapping::{OFGA_MODELS, Resource};
        let keys = |resources: &[&Resource]| -> Vec<String> {
            resources.iter().map(|r| r.key.to_string()).collect()
        };
        let all: Vec<&Resource> = OFGA_MODELS.values().collect();
        let off = hide_slack_unless_enabled(all.clone(), false);
        assert!(!keys(&off).contains(&"slack_integration".to_string()));
        assert_eq!(off.len(), all.len() - 1);
        let on = hide_slack_unless_enabled(all.clone(), true);
        assert!(keys(&on).contains(&"slack_integration".to_string()));
        assert_eq!(on.len(), all.len());
    }
}
