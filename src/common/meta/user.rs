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

use config::meta::user::{DBUser, User, UserOrg, UserRole};
#[cfg(feature = "cloud")]
use o2_enterprise::enterprise::cloud::OrgInviteStatus;
use serde::{Deserialize, Serialize};
#[cfg(feature = "enterprise")]
use strum::IntoEnumIterator;
use utoipa::ToSchema;

use super::organization::OrgRoleMapping;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserRequest {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub password: String,
    #[serde(skip_serializing)]
    pub role: UserOrgRole,
    /// Is the user created via ldap flow.
    #[serde(default)]
    pub is_external: bool,
    #[serde(skip_serializing)]
    pub token: Option<String>,
}

impl UserRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn to_new_dbuser(
        &self,
        password: String,
        salt: String,
        org: String,
        token: String,
        rum_token: String,
        is_external: bool,
        password_ext: String,
    ) -> DBUser {
        DBUser {
            email: self.email.clone(),
            first_name: self.first_name.clone(),
            last_name: self.last_name.clone(),
            password,
            salt,
            organizations: vec![UserOrg {
                name: org.clone(),
                org_name: org,
                token,
                rum_token: Some(rum_token),
                role: self.role.base_role.clone(),
            }],
            is_external,
            password_ext: Some(password_ext),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct PostUserRequest {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub password: String,
    #[serde(skip_serializing, flatten)]
    pub role: UserRoleRequest,
    /// Is the user created via ldap flow.
    #[serde(default)]
    pub is_external: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

impl From<&PostUserRequest> for UserRequest {
    fn from(user: &PostUserRequest) -> Self {
        UserRequest {
            email: user.email.clone(),
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            password: user.password.clone(),
            role: UserOrgRole::from(&user.role),
            is_external: user.is_external,
            token: user.token.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserOrgRole {
    #[serde(rename = "role")]
    pub base_role: UserRole,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub custom_role: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Eq, PartialEq, Default)]
pub struct UpdateUser {
    #[serde(default)]
    pub change_password: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", flatten)]
    pub role: Option<UserRoleRequest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum UserUpdateMode {
    OtherUpdate,
    SelfUpdate,
    CliUpdate,
}

impl UserUpdateMode {
    pub fn is_self_update(&self) -> bool {
        self == &UserUpdateMode::SelfUpdate
    }

    pub fn is_cli_update(&self) -> bool {
        self == &UserUpdateMode::CliUpdate
    }
}

pub fn get_default_user_org() -> UserOrg {
    UserOrg {
        name: "".to_string(),
        org_name: "".to_string(),
        token: "".to_string(),
        rum_token: None,
        role: get_default_user_role(),
    }
}

#[cfg(feature = "enterprise")]
pub fn get_default_user_role() -> UserRole {
    let mut role = UserRole::Admin;
    if o2_openfga::config::get_config().enabled {
        role = o2_dex::config::get_config().default_role.parse().unwrap();
    }
    role
}

#[cfg(not(feature = "enterprise"))]
pub fn get_default_user_role() -> UserRole {
    UserRole::Admin
}

#[cfg(feature = "enterprise")]
pub fn get_roles() -> Vec<UserRole> {
    UserRole::iter().collect()
}

#[cfg(not(feature = "enterprise"))]
pub fn get_roles() -> Vec<UserRole> {
    vec![UserRole::Admin, UserRole::Root, UserRole::ServiceAccount]
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserResponse {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub role: String,
    #[serde(default)]
    pub is_external: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orgs: Option<Vec<OrgRoleMapping>>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserList {
    pub data: Vec<UserResponse>,
}

#[cfg(feature = "cloud")]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum InviteStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "accepted")]
    Accepted,
    #[serde(rename = "rejected")]
    Rejected,
    #[serde(rename = "expired")]
    Expired,
}

#[cfg(feature = "cloud")]
impl From<&OrgInviteStatus> for InviteStatus {
    fn from(status: &OrgInviteStatus) -> Self {
        match status {
            OrgInviteStatus::Pending => InviteStatus::Pending,
            OrgInviteStatus::Accepted => InviteStatus::Accepted,
            OrgInviteStatus::Rejected => InviteStatus::Rejected,
            OrgInviteStatus::Expired => InviteStatus::Expired,
        }
    }
}

#[cfg(feature = "cloud")]
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserInvite {
    pub org_name: String,
    pub org_id: String,
    pub inviter_id: String,
    pub token: String,
    pub role: String,
    pub status: InviteStatus,
    pub expires_at: i64,
}

#[cfg(feature = "cloud")]
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserInviteList {
    pub data: Vec<UserInvite>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct SignInUser {
    pub name: String,
    pub password: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct SignInResponse {
    pub status: bool,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct TokenValidationResponse {
    pub is_valid: bool,
    pub user_email: String,
    pub user_name: String,
    pub family_name: String,
    pub given_name: String,
    pub is_internal_user: bool,
    pub user_role: Option<UserRole>,
}
pub struct TokenValidationResponseBuilder {
    pub response: TokenValidationResponse,
}

impl Default for TokenValidationResponseBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Builder for creating a `TokenValidationResponse` from a `DBUser`.
impl TokenValidationResponseBuilder {
    /// Creates a new `TokenValidationResponseBuilder` from a `DBUser`.
    ///
    /// # Arguments
    ///
    /// * `user` - The `DBUser` object used to build the `TokenValidationResponse`.
    ///
    /// # Returns
    ///
    /// A `TokenValidationResponseBuilder` object.
    pub fn from_db_user(user: &DBUser) -> TokenValidationResponseBuilder {
        Self {
            response: TokenValidationResponse {
                is_valid: true,
                user_email: user.email.clone(),
                is_internal_user: !user.is_external,
                user_role: None,
                user_name: user.first_name.clone(),
                given_name: user.first_name.clone(),
                family_name: user.last_name.clone(),
            },
        }
    }

    /// Creates a new `TokenValidationResponseBuilder` from a `User`.
    ///
    /// Arguments
    ///
    /// * `user` - The `User` object used to build the `TokenValidationResponse`.
    pub fn from_user(user: &User) -> TokenValidationResponseBuilder {
        Self {
            response: TokenValidationResponse {
                is_valid: true,
                user_email: user.email.clone(),
                is_internal_user: !user.is_external,
                user_role: Some(user.role.clone()),
                user_name: user.first_name.clone(),
                given_name: user.first_name.clone(),
                family_name: user.last_name.clone(),
            },
        }
    }

    pub fn new() -> TokenValidationResponseBuilder {
        Self {
            response: TokenValidationResponse::default(),
        }
    }

    pub fn is_valid(mut self, is_valid: bool) -> Self {
        self.response.is_valid = is_valid;
        self
    }

    pub fn user_email(mut self, user_email: String) -> Self {
        self.response.user_email = user_email;
        self
    }

    pub fn user_name(mut self, user_name: String) -> Self {
        self.response.user_name = user_name;
        self
    }

    pub fn family_name(mut self, family_name: String) -> Self {
        self.response.family_name = family_name;
        self
    }

    pub fn given_name(mut self, given_name: String) -> Self {
        self.response.given_name = given_name;
        self
    }

    pub fn is_internal_user(mut self, is_internal_user: bool) -> Self {
        self.response.is_internal_user = is_internal_user;
        self
    }

    pub fn user_role(mut self, user_role: Option<UserRole>) -> Self {
        self.response.user_role = user_role;
        self
    }

    pub fn build(self) -> TokenValidationResponse {
        TokenValidationResponse {
            is_valid: self.response.is_valid,
            user_email: self.response.user_email,
            user_name: self.response.user_name,
            family_name: self.response.family_name,
            given_name: self.response.given_name,
            is_internal_user: self.response.is_internal_user,
            user_role: self.response.user_role,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct RoleOrg {
    pub role: UserRole,
    pub org: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_role: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct UserGroup {
    pub name: String,
    pub users: Option<std::collections::HashSet<String>>,
    pub roles: Option<std::collections::HashSet<String>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct UserGroupRequest {
    pub add_users: Option<std::collections::HashSet<String>>,
    pub remove_users: Option<std::collections::HashSet<String>>,
    pub add_roles: Option<std::collections::HashSet<String>>,
    pub remove_roles: Option<std::collections::HashSet<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Default, Serialize, Deserialize, ToSchema)]
pub struct UserRoleRequest {
    pub role: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "custom_role"
    )]
    pub custom: Option<Vec<String>>,
}

impl From<&UserRoleRequest> for UserOrgRole {
    fn from(role: &UserRoleRequest) -> Self {
        let standard_role = get_roles()
            .into_iter()
            .find(|user_role| user_role.to_string().eq_ignore_ascii_case(&role.role));

        let custom_role = if let Some(role) = role.custom.as_ref() {
            Some(role.clone())
        } else if standard_role.is_none() {
            Some(vec![role.role.clone()])
        } else {
            None
        };

        let base_role = standard_role.unwrap_or_else(get_default_user_role);

        UserOrgRole {
            base_role,
            custom_role,
        }
    }
}

#[cfg(feature = "enterprise")]
pub fn is_standard_role(role: &str) -> bool {
    for user_role in UserRole::iter() {
        if user_role.to_string().eq_ignore_ascii_case(role) {
            return true;
        }
    }
    false
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct RolesResponse {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct AuthTokensExt {
    pub auth_ext: String,
    pub refresh_token: String,
    pub request_time: i64,
    pub expires_in: i64,
}

impl AuthTokensExt {
    /// Checks if the token is still valid or not
    pub fn has_expired(&self) -> bool {
        chrono::Utc::now().timestamp() - self.request_time > self.expires_in
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn test_user_request() {
        let request = UserRequest {
            email: "test@example.com".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            password: "password123".to_string(),
            role: UserOrgRole {
                base_role: UserRole::Admin,
                custom_role: None,
            },
            is_external: false,
            token: None,
        };

        assert_eq!(request.email, "test@example.com");
        assert_eq!(request.first_name, "John");
        assert_eq!(request.last_name, "Doe");
        assert_eq!(request.password, "password123");
        assert_eq!(request.role.base_role, UserRole::Admin);
        assert!(request.role.custom_role.is_none());
        assert!(!request.is_external);
        assert!(request.token.is_none());
    }

    #[test]
    fn test_user_request_to_new_dbuser() {
        let request = UserRequest {
            email: "test@example.com".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            password: "hashed_password".to_string(),
            role: UserOrgRole {
                base_role: UserRole::Admin,
                custom_role: None,
            },
            is_external: false,
            token: None,
        };

        let db_user = request.to_new_dbuser(
            "hashed_password".to_string(),
            "salt".to_string(),
            "org1".to_string(),
            "token123".to_string(),
            "rum_token123".to_string(),
            false,
            "password_ext".to_string(),
        );

        assert_eq!(db_user.email, "test@example.com");
        assert_eq!(db_user.first_name, "John");
        assert_eq!(db_user.last_name, "Doe");
        assert_eq!(db_user.password, "hashed_password");
        assert_eq!(db_user.salt, "salt");
        assert_eq!(db_user.organizations.len(), 1);
        assert_eq!(db_user.organizations[0].name, "org1");
        assert_eq!(db_user.organizations[0].token, "token123");
        assert_eq!(
            db_user.organizations[0].rum_token,
            Some("rum_token123".to_string())
        );
        assert_eq!(db_user.organizations[0].role, UserRole::Admin);
        assert!(!db_user.is_external);
        assert_eq!(db_user.password_ext, Some("password_ext".to_string()));
    }

    #[test]
    fn test_post_user_request() {
        let request = PostUserRequest {
            email: "test@example.com".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            password: "password123".to_string(),
            role: UserRoleRequest {
                role: "Admin".to_string(),
                custom: None,
            },
            is_external: false,
            token: None,
        };

        assert_eq!(request.email, "test@example.com");
        assert_eq!(request.first_name, "John");
        assert_eq!(request.last_name, "Doe");
        assert_eq!(request.password, "password123");
        assert_eq!(request.role.role, "Admin");
        assert!(request.role.custom.is_none());
        assert!(!request.is_external);
        assert!(request.token.is_none());
    }

    #[test]
    fn test_post_user_request_to_user_request() {
        let post_request = PostUserRequest {
            email: "test@example.com".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            password: "password123".to_string(),
            role: UserRoleRequest {
                role: "Admin".to_string(),
                custom: None,
            },
            is_external: false,
            token: None,
        };

        let user_request = UserRequest::from(&post_request);

        assert_eq!(user_request.email, "test@example.com");
        assert_eq!(user_request.first_name, "John");
        assert_eq!(user_request.last_name, "Doe");
        assert_eq!(user_request.password, "password123");
        assert_eq!(user_request.role.base_role, UserRole::Admin);
        assert!(user_request.role.custom_role.is_none());
        assert!(!user_request.is_external);
        assert!(user_request.token.is_none());
    }

    #[test]
    fn test_update_user() {
        let update = UpdateUser {
            change_password: true,
            first_name: Some("John".to_string()),
            last_name: Some("Doe".to_string()),
            old_password: Some("old123".to_string()),
            new_password: Some("new123".to_string()),
            role: Some(UserRoleRequest {
                role: "Admin".to_string(),
                custom: None,
            }),
            token: Some("token123".to_string()),
        };

        assert!(update.change_password);
        assert_eq!(update.first_name, Some("John".to_string()));
        assert_eq!(update.last_name, Some("Doe".to_string()));
        assert_eq!(update.old_password, Some("old123".to_string()));
        assert_eq!(update.new_password, Some("new123".to_string()));
        assert!(update.role.is_some());
        assert_eq!(update.token, Some("token123".to_string()));
    }

    #[test]
    fn test_user_response() {
        let response = UserResponse {
            email: "test@example.com".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            role: "Admin".to_string(),
            is_external: false,
            orgs: Some(vec![OrgRoleMapping {
                org_id: "org1".to_string(),
                org_name: "org1".to_string(),
                role: UserRole::Admin,
            }]),
            created_at: 1234567890,
        };

        assert_eq!(response.email, "test@example.com");
        assert_eq!(response.first_name, "John");
        assert_eq!(response.last_name, "Doe");
        assert_eq!(response.role, "Admin");
        assert!(!response.is_external);
        assert!(response.orgs.is_some());
        assert_eq!(response.created_at, 1234567890);
    }

    #[test]
    fn test_user_list() {
        let list = UserList {
            data: vec![UserResponse {
                email: "test@example.com".to_string(),
                first_name: "John".to_string(),
                last_name: "Doe".to_string(),
                role: "Admin".to_string(),
                is_external: false,
                orgs: None,
                created_at: 1234567890,
            }],
        };

        assert_eq!(list.data.len(), 1);
        assert_eq!(list.data[0].email, "test@example.com");
    }

    #[test]
    fn test_user_group() {
        let mut users = HashSet::new();
        users.insert("user1".to_string());
        users.insert("user2".to_string());

        let mut roles = HashSet::new();
        roles.insert("role1".to_string());
        roles.insert("role2".to_string());

        let group = UserGroup {
            name: "test_group".to_string(),
            users: Some(users.clone()),
            roles: Some(roles.clone()),
        };

        assert_eq!(group.name, "test_group");
        assert_eq!(group.users, Some(users));
        assert_eq!(group.roles, Some(roles));
    }

    #[test]
    fn test_user_group_request() {
        let mut add_users = HashSet::new();
        add_users.insert("user1".to_string());

        let mut remove_users = HashSet::new();
        remove_users.insert("user2".to_string());

        let mut add_roles = HashSet::new();
        add_roles.insert("role1".to_string());

        let mut remove_roles = HashSet::new();
        remove_roles.insert("role2".to_string());

        let request = UserGroupRequest {
            add_users: Some(add_users.clone()),
            remove_users: Some(remove_users.clone()),
            add_roles: Some(add_roles.clone()),
            remove_roles: Some(remove_roles.clone()),
        };

        assert_eq!(request.add_users, Some(add_users));
        assert_eq!(request.remove_users, Some(remove_users));
        assert_eq!(request.add_roles, Some(add_roles));
        assert_eq!(request.remove_roles, Some(remove_roles));
    }

    #[test]
    fn test_user_role_request() {
        let request = UserRoleRequest {
            role: "Admin".to_string(),
            custom: Some(vec!["custom1".to_string(), "custom2".to_string()]),
        };

        assert_eq!(request.role, "Admin");
        assert_eq!(
            request.custom,
            Some(vec!["custom1".to_string(), "custom2".to_string()])
        );
    }

    #[test]
    fn test_user_role_request_to_user_org_role() {
        let request = UserRoleRequest {
            role: "Admin".to_string(),
            custom: Some(vec!["custom1".to_string(), "custom2".to_string()]),
        };

        let org_role = UserOrgRole::from(&request);

        assert_eq!(org_role.base_role, UserRole::Admin);
        assert_eq!(
            org_role.custom_role,
            Some(vec!["custom1".to_string(), "custom2".to_string()])
        );
    }

    #[test]
    fn test_roles_response() {
        let response = RolesResponse {
            label: "Admin".to_string(),
            value: "admin".to_string(),
        };

        assert_eq!(response.label, "Admin");
        assert_eq!(response.value, "admin");
    }

    #[test]
    fn test_auth_tokens() {
        let tokens = AuthTokens {
            access_token: "access123".to_string(),
            refresh_token: "refresh123".to_string(),
        };

        assert_eq!(tokens.access_token, "access123");
        assert_eq!(tokens.refresh_token, "refresh123");
    }

    #[test]
    fn test_auth_tokens_ext() {
        let tokens = AuthTokensExt {
            auth_ext: "auth123".to_string(),
            refresh_token: "refresh123".to_string(),
            request_time: 1234567890,
            expires_in: 3600,
        };

        assert_eq!(tokens.auth_ext, "auth123");
        assert_eq!(tokens.refresh_token, "refresh123");
        assert_eq!(tokens.request_time, 1234567890);
        assert_eq!(tokens.expires_in, 3600);
    }

    #[test]
    fn test_token_validation_response_builder() {
        let builder = TokenValidationResponseBuilder::new()
            .is_valid(true)
            .user_email("test@example.com".to_string())
            .user_name("John Doe".to_string())
            .family_name("Doe".to_string())
            .given_name("John".to_string())
            .is_internal_user(true)
            .user_role(Some(UserRole::Admin));

        let response = builder.build();

        assert!(response.is_valid);
        assert_eq!(response.user_email, "test@example.com");
        assert_eq!(response.user_name, "John Doe");
        assert_eq!(response.family_name, "Doe");
        assert_eq!(response.given_name, "John");
        assert!(response.is_internal_user);
        assert_eq!(response.user_role, Some(UserRole::Admin));
    }

    #[test]
    fn test_get_default_user_org() {
        let org = get_default_user_org();

        assert_eq!(org.name, "");
        assert_eq!(org.token, "");
        assert!(org.rum_token.is_none());
        assert_eq!(org.role, get_default_user_role());
    }

    #[test]
    fn test_get_default_user_role() {
        let role = get_default_user_role();

        // Default role should be Admin in non-enterprise mode
        #[cfg(not(feature = "enterprise"))]
        assert_eq!(role, UserRole::Admin);

        // In enterprise mode, it depends on configuration
        #[cfg(feature = "enterprise")]
        {
            // Just verify it returns a valid UserRole
            assert!(matches!(
                role,
                UserRole::Admin | UserRole::Root | UserRole::ServiceAccount
            ));
        }
    }

    #[test]
    fn test_get_roles() {
        let roles = get_roles();

        assert!(!roles.is_empty());

        // Non-enterprise mode should have specific roles
        #[cfg(not(feature = "enterprise"))]
        {
            assert_eq!(roles.len(), 3);
            assert!(roles.contains(&UserRole::Admin));
            assert!(roles.contains(&UserRole::Root));
            assert!(roles.contains(&UserRole::ServiceAccount));
        }

        // Enterprise mode uses iterator over all roles
        #[cfg(feature = "enterprise")]
        {
            assert!(roles.contains(&UserRole::Admin));
            assert!(roles.contains(&UserRole::Root));
            assert!(roles.contains(&UserRole::ServiceAccount));
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_is_standard_role() {
        // Test valid standard roles
        assert!(is_standard_role("admin"));
        assert!(is_standard_role("ADMIN"));
        assert!(is_standard_role("Admin"));
        assert!(is_standard_role("root"));
        assert!(is_standard_role("ROOT"));
        assert!(is_standard_role("Root"));

        // Test invalid roles
        assert!(!is_standard_role("custom_role"));
        assert!(!is_standard_role("invalid"));
        assert!(!is_standard_role(""));
        assert!(!is_standard_role("   "));
    }

    #[test]
    fn test_token_validation_response_builder_from_db_user() {
        let db_user = DBUser {
            email: "test@example.com".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            password: "hashed".to_string(),
            salt: "salt".to_string(),
            organizations: vec![],
            is_external: false,
            password_ext: None,
        };

        let response = TokenValidationResponseBuilder::from_db_user(&db_user).build();

        assert!(response.is_valid);
        assert_eq!(response.user_email, "test@example.com");
        assert_eq!(response.user_name, "John");
        assert_eq!(response.given_name, "John");
        assert_eq!(response.family_name, "Doe");
        assert!(response.is_internal_user);
        assert!(response.user_role.is_none());
    }

    #[test]
    fn test_token_validation_response_builder_from_db_user_external() {
        let db_user = DBUser {
            email: "external@example.com".to_string(),
            first_name: "Jane".to_string(),
            last_name: "Smith".to_string(),
            password: "hashed".to_string(),
            salt: "salt".to_string(),
            organizations: vec![],
            is_external: true,
            password_ext: None,
        };

        let response = TokenValidationResponseBuilder::from_db_user(&db_user).build();

        assert!(response.is_valid);
        assert_eq!(response.user_email, "external@example.com");
        assert!(!response.is_internal_user);
    }

    #[test]
    fn test_token_validation_response_builder_from_user() {
        let user = User {
            email: "test@example.com".to_string(),
            first_name: "John".to_string(),
            last_name: "Doe".to_string(),
            password: "password".to_string(),
            salt: "salt".to_string(),
            token: "token".to_string(),
            rum_token: None,
            role: UserRole::Admin,
            org: "test_org".to_string(),
            is_external: false,
            password_ext: None,
        };

        let response = TokenValidationResponseBuilder::from_user(&user).build();

        assert!(response.is_valid);
        assert_eq!(response.user_email, "test@example.com");
        assert_eq!(response.user_name, "John");
        assert_eq!(response.given_name, "John");
        assert_eq!(response.family_name, "Doe");
        assert!(response.is_internal_user);
        assert_eq!(response.user_role, Some(UserRole::Admin));
    }

    #[test]
    fn test_user_role_request_custom_role_conversion() {
        let request = UserRoleRequest {
            role: "custom_role_name".to_string(),
            custom: None,
        };

        let org_role = UserOrgRole::from(&request);

        // When role is not standard and no custom roles provided,
        // the role name should be added as custom role
        assert_eq!(org_role.base_role, get_default_user_role());
        assert_eq!(
            org_role.custom_role,
            Some(vec!["custom_role_name".to_string()])
        );
    }

    #[test]
    fn test_user_role_request_with_custom_roles() {
        let request = UserRoleRequest {
            role: "custom_role_name".to_string(),
            custom: Some(vec!["perm1".to_string(), "perm2".to_string()]),
        };

        let org_role = UserOrgRole::from(&request);

        // When custom roles are provided, use them instead of role name
        assert_eq!(org_role.base_role, get_default_user_role());
        assert_eq!(
            org_role.custom_role,
            Some(vec!["perm1".to_string(), "perm2".to_string()])
        );
    }

    #[test]
    fn test_user_role_request_empty_role() {
        let request = UserRoleRequest {
            role: "".to_string(),
            custom: None,
        };

        let org_role = UserOrgRole::from(&request);

        // Empty role should be treated as custom
        assert_eq!(org_role.base_role, get_default_user_role());
        assert_eq!(org_role.custom_role, Some(vec!["".to_string()]));
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_invite_status_conversion() {
        use o2_enterprise::enterprise::cloud::OrgInviteStatus;

        assert_eq!(
            InviteStatus::from(&OrgInviteStatus::Pending),
            InviteStatus::Pending
        );
        assert_eq!(
            InviteStatus::from(&OrgInviteStatus::Accepted),
            InviteStatus::Accepted
        );
        assert_eq!(
            InviteStatus::from(&OrgInviteStatus::Rejected),
            InviteStatus::Rejected
        );
        assert_eq!(
            InviteStatus::from(&OrgInviteStatus::Expired),
            InviteStatus::Expired
        );
    }
}
