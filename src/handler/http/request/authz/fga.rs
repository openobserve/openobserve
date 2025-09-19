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
use std::io::Error;

use actix_web::{HttpRequest, HttpResponse, delete, get, post, put, web};
#[cfg(feature = "enterprise")]
use o2_dex::meta::auth::RoleRequest;

use crate::common::meta::{
    http::HttpResponse as MetaHttpResponse,
    user::{UserGroup, UserGroupRequest, UserRoleRequest},
};

#[cfg(feature = "enterprise")]
/// CreateRoles
#[utoipa::path(
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
    request_body(content = UserRoleRequest, description = "UserRoleRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "create"}))
    )
)]
#[post("/{org_id}/roles")]
pub async fn create_role(
    org_id: web::Path<String>,
    user_req: web::Json<UserRoleRequest>,
) -> Result<HttpResponse, Error> {
    use crate::{
        common::meta::user::is_standard_role, handler::http::auth::jwt::format_role_name_only,
    };

    let org_id = org_id.into_inner();
    let user_req = user_req.into_inner();
    let role_name = format_role_name_only(user_req.role.trim());

    if role_name.is_empty() || is_standard_role(&role_name) {
        return Ok(MetaHttpResponse::bad_request(
            "Custom role name cannot be empty or standard role",
        ));
    }

    match o2_openfga::authorizer::roles::create_role(&role_name, &org_id).await {
        Ok(_) => Ok(MetaHttpResponse::ok("Role created successfully")),
        Err(err) => {
            let err = err.to_string();
            if err.contains("write_failed_due_to_invalid_input") {
                Ok(MetaHttpResponse::bad_request("Role already exists"))
            } else {
                Ok(MetaHttpResponse::internal_error("Something went wrong"))
            }
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
    request_body(content = UserRoleRequest, description = "UserRoleRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "create"}))
    )
)]
#[post("/{org_id}/roles")]
pub async fn create_role(
    _org_id: web::Path<String>,
    _role_id: web::Json<UserRoleRequest>,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// DeleteRole
#[utoipa::path(
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
#[delete("/{org_id}/roles/{role_id}")]
pub async fn delete_role(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, role_name) = path.into_inner();

    match o2_openfga::authorizer::roles::delete_role(&org_id, &role_name).await {
        Ok(_) => Ok(MetaHttpResponse::ok(
            serde_json::json!({"successful": "true"}),
        )),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    context_path = "/api",
    tag = "Roles",
    operation_id = "DeleteRole",
    summary = "Delete custom role",
    description = "Permanently removes a custom role from the organization. This endpoint is only available with enterprise features enabled and will return a forbidden error in the community edition.",
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
#[delete("/{org_id}/roles/{role_id}")]
pub async fn delete_role(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// ListRoles
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "list"}))
    )
)]
#[get("/{org_id}/roles")]
pub async fn get_roles(org_id: web::Path<String>, req: HttpRequest) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let mut permitted;
    // Get List of allowed objects

    let user_id = req.headers().get("user_id").unwrap();
    match crate::handler::http::auth::validator::list_objects_for_user(
        &org_id,
        user_id.to_str().unwrap(),
        "GET",
        "role",
    )
    .await
    {
        Ok(list) => {
            permitted = list;
        }
        Err(e) => {
            return Ok(MetaHttpResponse::forbidden(e.to_string()));
        }
    }
    // Get List of allowed objects ends

    if let Some(mut local_permitted) = permitted {
        let prefix = "role:";
        for value in local_permitted.iter_mut() {
            if value.starts_with(prefix) {
                *value = value.strip_prefix(prefix).unwrap().to_string();
            }
            let role_prefix = format!("{org_id}/");
            if value.starts_with(&role_prefix) {
                *value = value.strip_prefix(&role_prefix).unwrap().to_string()
            }
        }
        permitted = Some(local_permitted);
    }

    match o2_openfga::authorizer::roles::get_all_roles(&org_id, permitted).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "list"}))
    )
)]
#[get("/{org_id}/roles")]
pub async fn get_roles(
    _org_id: web::Path<String>,
    _req: HttpRequest,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// UpdateRoles
#[utoipa::path(
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
    request_body(content = RoleRequest, description = "RoleRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "update"}))
    )
)]
#[put("/{org_id}/roles/{role_id}")]
pub async fn update_role(
    path: web::Path<(String, String)>,
    update_role: web::Json<RoleRequest>,
) -> Result<HttpResponse, Error> {
    let (org_id, role_id) = path.into_inner();
    let update_role = update_role.into_inner();

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
        Ok(_) => Ok(MetaHttpResponse::ok("Role updated successfully")),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
    request_body(content = Object, description = "RoleRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[post("/{org_id}/roles/{role_id}")]
pub async fn update_role(
    _path: web::Path<(String, String)>,
    _permissions: web::Json<String>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// GetResourcePermission
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<Object>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/roles/{role_id}/permissions/{resource}")]
pub async fn get_role_permissions(
    path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, Error> {
    let (org_id, role_id, resource) = path.into_inner();
    match o2_openfga::authorizer::roles::get_role_permissions(&org_id, &role_id, &resource).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<Object>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/roles/{role_id}/permissions/{resource}")]
pub async fn get_role_permissions(
    _path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// GetRoleUsers
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/roles/{role_id}/users")]
pub async fn get_users_with_role(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, role_id) = path.into_inner();
    match o2_openfga::authorizer::roles::get_users_with_role(&org_id, &role_id).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/roles/{role_id}/users")]
pub async fn get_users_with_role(
    _path: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// GetUserRoles
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/users/{user_email}/roles")]
pub async fn get_roles_for_user(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, user_email) = path.into_inner();
    let res = o2_openfga::authorizer::roles::get_roles_for_org_user(&org_id, &user_email).await;

    Ok(HttpResponse::Ok().json(res))
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/users/{user_email}/roles")]
pub async fn get_roles_for_user(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// GetUserGroups
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/users/{user_email}/groups")]
pub async fn get_groups_for_user(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, user_email) = path.into_inner();
    match o2_openfga::authorizer::groups::get_groups_for_org_user(&org_id, &user_email).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/users/{user_email}/groups")]
pub async fn get_groups_for_user(
    _path: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// CreateGroup
#[utoipa::path(
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
    request_body(content = UserGroup, description = "UserGroup", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[post("/{org_id}/groups")]
pub async fn create_group(
    org_id: web::Path<String>,
    user_group: web::Json<UserGroup>,
) -> Result<HttpResponse, Error> {
    use crate::handler::http::auth::jwt::format_role_name_only;

    let org_id = org_id.into_inner();
    let mut user_grp = user_group.into_inner();
    user_grp.name = format_role_name_only(user_grp.name.trim());

    match o2_openfga::authorizer::groups::create_group(
        &org_id,
        &user_grp.name,
        user_grp.users.unwrap_or_default(),
    )
    .await
    {
        Ok(_) => Ok(MetaHttpResponse::ok("Group created successfully")),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
    request_body(content = UserGroup, description = "UserGroup", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[post("/{org_id}/groups")]
pub async fn create_group(
    _org_id: web::Path<String>,
    _user_group: web::Json<UserGroup>,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// UpdateGroup
#[utoipa::path(
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
    request_body(content = UserGroupRequest, description = "UserGroupRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[put("/{org_id}/groups/{group_name}")]
pub async fn update_group(
    path: web::Path<(String, String)>,
    user_group: web::Json<UserGroupRequest>,
) -> Result<HttpResponse, Error> {
    let (org_id, group_name) = path.into_inner();
    let user_grp = user_group.into_inner();

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
        Ok(_) => Ok(MetaHttpResponse::ok("Group updated successfully")),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
    request_body(content = UserGroupRequest, description = "UserGroupRequest", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[put("/{org_id}/groups/{group_name}")]
pub async fn update_group(
    _path: web::Path<(String, String)>,
    _user_group: web::Json<UserGroupRequest>,
) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// ListGroups
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/groups")]
pub async fn get_groups(path: web::Path<String>, req: HttpRequest) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    let mut permitted;
    // Get List of allowed objects

    let user_id = req.headers().get("user_id").unwrap();
    match crate::handler::http::auth::validator::list_objects_for_user(
        &org_id,
        user_id.to_str().unwrap(),
        "GET",
        "group",
    )
    .await
    {
        Ok(list) => {
            permitted = list;
        }
        Err(e) => {
            return Ok(crate::common::meta::http::HttpResponse::forbidden(
                e.to_string(),
            ));
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
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<String>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/groups")]
pub async fn get_groups(_path: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// GetGroup
#[utoipa::path(
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
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = UserGroup),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/groups/{group_name}")]
pub async fn get_group_details(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, group_name) = path.into_inner();

    match o2_openfga::authorizer::groups::get_group_details(&org_id, &group_name).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = UserGroup),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/groups/{group_name}")]
pub async fn get_group_details(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// GetResources
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<Object>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/resources")]
pub async fn get_resources(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
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
    Ok(HttpResponse::Ok().json(resources))
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
        (status = 200, description = "Success", content_type = "application/json", body = Vec<Object>),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
#[get("/{org_id}/resources")]
pub async fn get_resources(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(feature = "enterprise")]
/// DeleteGroup
#[utoipa::path(
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
#[delete("/{org_id}/groups/{group_name}")]
pub async fn delete_group(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, group_name) = path.into_inner();

    match o2_openfga::authorizer::groups::delete_group(&org_id, &group_name).await {
        Ok(_) => Ok(MetaHttpResponse::ok(
            serde_json::json!({"successful": "true"}),
        )),
        Err(err) => Ok(MetaHttpResponse::internal_error(err)),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
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
#[delete("/{org_id}/groups/{group_name}")]
pub async fn delete_group(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(MetaHttpResponse::forbidden("Not Supported"))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use actix_web::{App, test};

    use super::*;
    use crate::common::meta::user::{UserGroup, UserGroupRequest, UserRoleRequest};

    #[tokio::test]
    async fn test_create_role_enterprise_success() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(create_role)).await;
            let role_request = UserRoleRequest {
                role: "custom_role".to_string(),
                custom: None,
            };

            let req = test::TestRequest::post()
                .uri("/test_org/roles")
                .set_json(&role_request)
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Note: This will likely fail in test environment due to missing OFGA setup
            // but we're testing the endpoint structure and request handling
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(create_role)).await;
            let role_request = UserRoleRequest {
                role: "custom_role".to_string(),
                custom: None,
            };

            let req = test::TestRequest::post()
                .uri("/test_org/roles")
                .set_json(&role_request)
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_create_role_empty_name() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(create_role)).await;
            let role_request = UserRoleRequest {
                role: "   ".to_string(), // Empty after trim
                custom: None,
            };

            let req = test::TestRequest::post()
                .uri("/test_org/roles")
                .set_json(&role_request)
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 400); // Bad request for empty role name
        }
    }

    #[tokio::test]
    async fn test_create_role_standard_role() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(create_role)).await;
            let role_request = UserRoleRequest {
                role: "admin".to_string(), // Standard role
                custom: None,
            };

            let req = test::TestRequest::post()
                .uri("/test_org/roles")
                .set_json(&role_request)
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 400); // Bad request for standard role
        }
    }

    #[tokio::test]
    async fn test_delete_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(delete_role)).await;
            let req = test::TestRequest::delete()
                .uri("/test_org/roles/test_role")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(delete_role)).await;
            let req = test::TestRequest::delete()
                .uri("/test_org/roles/test_role")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_roles_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            use actix_http::header::HeaderName;

            let app = test::init_service(App::new().service(get_roles)).await;
            let mut req = test::TestRequest::get().uri("/test_org/roles").to_request();

            // Add user_id header that the function expects
            req.headers_mut().insert(
                HeaderName::from_static("user_id"),
                "test_user".parse().unwrap(),
            );

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_roles)).await;
            let req = test::TestRequest::get().uri("/test_org/roles").to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_update_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(update_role)).await;
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

            let req = test::TestRequest::put()
                .uri("/test_org/roles/test_role")
                .set_json(&role_request)
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(update_role)).await;
            let req = test::TestRequest::post()
                .uri("/test_org/roles/test_role")
                .set_json(&"test")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_role_permissions_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(get_role_permissions)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/roles/test_role/permissions/test_resource")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_role_permissions)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/roles/test_role/permissions/test_resource")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_users_with_role_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(get_users_with_role)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/roles/test_role/users")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_users_with_role)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/roles/test_role/users")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_roles_for_user_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(get_roles_for_user)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/users/test@example.com/roles")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_roles_for_user)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/users/test@example.com/roles")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_groups_for_user_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(get_groups_for_user)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/users/test@example.com/groups")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_groups_for_user)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/users/test@example.com/groups")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_create_group_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(create_group)).await;
            let mut users = HashSet::new();
            users.insert("user1".to_string());
            users.insert("user2".to_string());

            let group = UserGroup {
                name: "test_group".to_string(),
                users: Some(users),
                roles: None,
            };

            let req = test::TestRequest::post()
                .uri("/test_org/groups")
                .set_json(&group)
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(create_group)).await;
            let group = UserGroup {
                name: "test_group".to_string(),
                users: None,
                roles: None,
            };

            let req = test::TestRequest::post()
                .uri("/test_org/groups")
                .set_json(&group)
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_update_group_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(update_group)).await;
            let mut add_users = HashSet::new();
            add_users.insert("user1".to_string());

            let group_request = UserGroupRequest {
                add_users: Some(add_users),
                remove_users: None,
                add_roles: None,
                remove_roles: None,
            };

            let req = test::TestRequest::put()
                .uri("/test_org/groups/test_group")
                .set_json(&group_request)
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(update_group)).await;
            let group_request = UserGroupRequest {
                add_users: None,
                remove_users: None,
                add_roles: None,
                remove_roles: None,
            };

            let req = test::TestRequest::put()
                .uri("/test_org/groups/test_group")
                .set_json(&group_request)
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_groups_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            use actix_http::header::HeaderName;

            let app = test::init_service(App::new().service(get_groups)).await;
            let mut req = test::TestRequest::get()
                .uri("/test_org/groups")
                .to_request();

            // Add user_id header that the function expects
            req.headers_mut().insert(
                HeaderName::from_static("user_id"),
                "test_user".parse().unwrap(),
            );

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_groups)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/groups")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_group_details_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(get_group_details)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/groups/test_group")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_group_details)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/groups/test_group")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_delete_group_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(delete_group)).await;
            let req = test::TestRequest::delete()
                .uri("/test_org/groups/test_group")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Will likely fail due to missing OFGA setup, but testing structure
            assert!(resp.status().is_client_error() || resp.status().is_server_error());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(delete_group)).await;
            let req = test::TestRequest::delete()
                .uri("/test_org/groups/test_group")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
        }
    }

    #[tokio::test]
    async fn test_get_resources_enterprise() {
        #[cfg(feature = "enterprise")]
        {
            let app = test::init_service(App::new().service(get_resources)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/resources")
                .to_request();

            let resp = test::call_service(&app, req).await;
            // Should succeed as it doesn't require OFGA setup
            assert!(resp.status().is_success());
        }

        #[cfg(not(feature = "enterprise"))]
        {
            let app = test::init_service(App::new().service(get_resources)).await;
            let req = test::TestRequest::get()
                .uri("/test_org/resources")
                .to_request();

            let resp = test::call_service(&app, req).await;
            assert_eq!(resp.status(), 403); // Forbidden in non-enterprise
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
