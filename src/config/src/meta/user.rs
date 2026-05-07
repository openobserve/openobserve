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

use core::clone::Clone;
use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use strum::EnumIter;
use utoipa::ToSchema;

/// Email prefix/suffix for system-managed SRE agent service accounts.
/// These are used both at runtime (organization.rs) and in DB migrations —
/// kept here as the single source of truth for runtime code.
/// NOTE: Migration files inline these literals directly (frozen snapshot pattern).
pub const SRE_AGENT_EMAIL_PREFIX: &str = "o2-sre-agent.org-";
pub const SRE_AGENT_EMAIL_SUFFIX: &str = "@openobserve.internal";

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct DBUser {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub password: String,
    #[serde(default)]
    pub salt: String,
    pub organizations: Vec<UserOrg>,
    #[serde(default)]
    pub is_external: bool,
    pub password_ext: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserOrg {
    pub name: String,
    #[serde(default)]
    pub org_name: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub rum_token: Option<String>,
    pub role: UserRole,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ToSchema, EnumIter)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Root = 0,
    Admin = 1,
    Editor = 2,
    // read only user
    Viewer = 3,
    // No access only login user
    User = 4,
    ServiceAccount = 5,
    // System-managed SRE agent service account — read-only access to telemetry/alerts/incidents
    SreAgent = 6,
}

impl From<UserRole> for i16 {
    fn from(role: UserRole) -> i16 {
        match role {
            UserRole::Root => 0,
            UserRole::Admin => 1,
            UserRole::Editor => 2,
            UserRole::Viewer => 3,
            UserRole::User => 4,
            UserRole::ServiceAccount => 5,
            UserRole::SreAgent => 6,
        }
    }
}

impl From<i16> for UserRole {
    fn from(role: i16) -> Self {
        match role {
            0 => UserRole::Root,
            1 => UserRole::Admin,
            2 => UserRole::Editor,
            3 => UserRole::Viewer,
            4 => UserRole::User,
            5 => UserRole::ServiceAccount,
            6 => UserRole::SreAgent,
            _ => UserRole::Admin,
        }
    }
}

impl PartialOrd for UserRole {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        let self_val = self.clone() as i16;
        let other_val = other.clone() as i16;
        Some(other_val.cmp(&self_val))
    }
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            UserRole::Admin => write!(f, "admin"),
            UserRole::Root => write!(f, "root"),
            UserRole::Viewer => write!(f, "viewer"),
            UserRole::Editor => write!(f, "editor"),
            UserRole::User => write!(f, "user"),
            UserRole::ServiceAccount => write!(f, "service_account"),
            UserRole::SreAgent => write!(f, "sre_agent"),
        }
    }
}

impl UserRole {
    /// Returns true for any role that represents a service account (human or system).
    pub fn is_service_account(&self) -> bool {
        matches!(self, UserRole::ServiceAccount | UserRole::SreAgent)
    }

    pub fn get_label(&self) -> String {
        match self {
            UserRole::Admin => "Admin".to_string(),
            UserRole::Root => "Root".to_string(),
            UserRole::Viewer => "Viewer".to_string(),
            UserRole::Editor => "Editor".to_string(),
            UserRole::User => "User".to_string(),
            UserRole::ServiceAccount => "Service Account".to_string(),
            UserRole::SreAgent => "SRE Agent".to_string(),
        }
    }

    /// Check if a string is a valid standard role name
    /// Returns true if the string matches one of the UserRole enum variants
    pub fn is_valid_role(role: &str) -> bool {
        matches!(
            role,
            "admin" | "root" | "viewer" | "editor" | "user" | "service_account" | "sre_agent"
        )
    }
}

// Implementing FromStr for UserRole
impl FromStr for UserRole {
    type Err = ();

    fn from_str(input: &str) -> Result<UserRole, Self::Err> {
        match input {
            "admin" => Ok(UserRole::Admin),
            "root" => Ok(UserRole::Root),
            "viewer" => Ok(UserRole::Viewer),
            "editor" => Ok(UserRole::Editor),
            "user" => Ok(UserRole::User),
            "service_account" => Ok(UserRole::ServiceAccount),
            "sre_agent" => Ok(UserRole::SreAgent),
            _ => Ok(UserRole::Admin),
        }
    }
}

impl DBUser {
    pub fn get_user(&self, org_id: String) -> Option<User> {
        if self.organizations.is_empty() {
            return None;
        }

        let mut local = self.clone();
        local.organizations.retain(|org| org.name.eq(&org_id));
        if local.organizations.is_empty() {
            return None;
        }

        let org = local.organizations.first().unwrap();
        Some(User {
            email: local.email,
            first_name: local.first_name,
            last_name: local.last_name,
            password: local.password,
            role: org.role.clone(),
            org: org.name.clone(),
            token: org.token.clone(),
            rum_token: org.rum_token.clone(),
            salt: local.salt,
            is_external: self.is_external,
            password_ext: self.password_ext.clone(),
        })
    }

    pub fn get_all_users(&self) -> Vec<User> {
        let mut ret_val = vec![];
        if self.organizations.is_empty() {
            ret_val
        } else {
            for org in self.organizations.clone() {
                ret_val.push(User {
                    email: self.email.clone(),
                    first_name: self.first_name.clone(),
                    last_name: self.last_name.clone(),
                    password: self.password.clone(),
                    role: org.role,
                    org: org.name,
                    token: org.token,
                    rum_token: org.rum_token,
                    salt: self.salt.clone(),
                    is_external: self.is_external,
                    password_ext: self.password_ext.clone(),
                })
            }
            ret_val
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct User {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub password: String,
    #[serde(default)]
    pub salt: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub rum_token: Option<String>,
    pub role: UserRole,
    pub org: String,
    /// Is the user authenticated and created via LDAP
    pub is_external: bool,
    pub password_ext: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UserType {
    Internal,
    /// Is the user authenticated and created via LDAP
    External,
}

impl From<i16> for UserType {
    fn from(user_type: i16) -> UserType {
        match user_type {
            0 => UserType::Internal,
            1 => UserType::External,
            _ => UserType::Internal,
        }
    }
}

impl From<UserType> for i16 {
    fn from(user_type: UserType) -> i16 {
        match user_type {
            UserType::Internal => 0,
            UserType::External => 1,
        }
    }
}

impl UserType {
    pub fn is_external(&self) -> bool {
        match self {
            UserType::Internal => false,
            UserType::External => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    mod user_role_serde {
        use super::*;

        #[test]
        fn test_serialize_to_snake_case() {
            assert_eq!(serde_json::to_string(&UserRole::Root).unwrap(), "\"root\"");
            assert_eq!(
                serde_json::to_string(&UserRole::Admin).unwrap(),
                "\"admin\""
            );
            assert_eq!(
                serde_json::to_string(&UserRole::Editor).unwrap(),
                "\"editor\""
            );
            assert_eq!(
                serde_json::to_string(&UserRole::Viewer).unwrap(),
                "\"viewer\""
            );
            assert_eq!(serde_json::to_string(&UserRole::User).unwrap(), "\"user\"");
            assert_eq!(
                serde_json::to_string(&UserRole::ServiceAccount).unwrap(),
                "\"service_account\""
            );
        }

        #[test]
        fn test_deserialize_from_snake_case() {
            assert_eq!(
                serde_json::from_str::<UserRole>("\"root\"").unwrap(),
                UserRole::Root
            );
            assert_eq!(
                serde_json::from_str::<UserRole>("\"admin\"").unwrap(),
                UserRole::Admin
            );
            assert_eq!(
                serde_json::from_str::<UserRole>("\"editor\"").unwrap(),
                UserRole::Editor
            );
            assert_eq!(
                serde_json::from_str::<UserRole>("\"viewer\"").unwrap(),
                UserRole::Viewer
            );
            assert_eq!(
                serde_json::from_str::<UserRole>("\"user\"").unwrap(),
                UserRole::User
            );
            assert_eq!(
                serde_json::from_str::<UserRole>("\"service_account\"").unwrap(),
                UserRole::ServiceAccount
            );
        }

        #[test]
        fn test_deserialize_invalid_role_fails() {
            assert!(serde_json::from_str::<UserRole>("\"invalid\"").is_err());
            assert!(serde_json::from_str::<UserRole>("\"Admin\"").is_err()); // PascalCase should fail
            assert!(serde_json::from_str::<UserRole>("\"ADMIN\"").is_err()); // UPPERCASE should fail
        }
    }

    mod user_role_ordering {
        use std::cmp::Ordering;

        use super::*;

        #[test]
        fn test_root_is_highest_privilege() {
            assert!(UserRole::Root > UserRole::Admin);
            assert!(UserRole::Root > UserRole::Editor);
            assert!(UserRole::Root > UserRole::Viewer);
            assert!(UserRole::Root > UserRole::User);
            assert!(UserRole::Root > UserRole::ServiceAccount);
        }

        #[test]
        fn test_admin_greater_than_lower_roles() {
            assert!(UserRole::Admin > UserRole::Editor);
            assert!(UserRole::Admin > UserRole::Viewer);
            assert!(UserRole::Admin > UserRole::User);
            assert!(UserRole::Admin > UserRole::ServiceAccount);
        }

        #[test]
        fn test_privilege_ordering_chain() {
            // Root > Admin > Editor > Viewer > User > ServiceAccount
            assert!(UserRole::Root > UserRole::Admin);
            assert!(UserRole::Admin > UserRole::Editor);
            assert!(UserRole::Editor > UserRole::Viewer);
            assert!(UserRole::Viewer > UserRole::User);
            assert!(UserRole::User > UserRole::ServiceAccount);
        }

        #[test]
        fn test_partial_cmp_returns_correct_ordering() {
            assert_eq!(
                UserRole::Root.partial_cmp(&UserRole::Admin),
                Some(Ordering::Greater)
            );
            assert_eq!(
                UserRole::Admin.partial_cmp(&UserRole::Root),
                Some(Ordering::Less)
            );
            assert_eq!(
                UserRole::Admin.partial_cmp(&UserRole::Admin),
                Some(Ordering::Equal)
            );
        }
    }

    mod user_role_display {
        use super::*;

        #[test]
        fn test_display_output() {
            assert_eq!(format!("{}", UserRole::Root), "root");
            assert_eq!(format!("{}", UserRole::Admin), "admin");
            assert_eq!(format!("{}", UserRole::Editor), "editor");
            assert_eq!(format!("{}", UserRole::Viewer), "viewer");
            assert_eq!(format!("{}", UserRole::User), "user");
            assert_eq!(format!("{}", UserRole::ServiceAccount), "service_account");
        }
    }

    mod user_role_from_str {
        use super::*;

        #[test]
        fn test_valid_role_strings() {
            assert_eq!(UserRole::from_str("root").unwrap(), UserRole::Root);
            assert_eq!(UserRole::from_str("admin").unwrap(), UserRole::Admin);
            assert_eq!(UserRole::from_str("editor").unwrap(), UserRole::Editor);
            assert_eq!(UserRole::from_str("viewer").unwrap(), UserRole::Viewer);
            assert_eq!(UserRole::from_str("user").unwrap(), UserRole::User);
            assert_eq!(
                UserRole::from_str("service_account").unwrap(),
                UserRole::ServiceAccount
            );
        }

        #[test]
        fn test_invalid_string_defaults_to_admin() {
            assert_eq!(UserRole::from_str("invalid").unwrap(), UserRole::Admin);
            assert_eq!(UserRole::from_str("").unwrap(), UserRole::Admin);
            assert_eq!(UserRole::from_str("Admin").unwrap(), UserRole::Admin); // case sensitive
        }
    }

    #[test]
    fn test_user_role_is_service_account() {
        assert!(UserRole::ServiceAccount.is_service_account());
        assert!(UserRole::SreAgent.is_service_account());
        assert!(!UserRole::Admin.is_service_account());
        assert!(!UserRole::Viewer.is_service_account());
        assert!(!UserRole::Root.is_service_account());
    }

    #[test]
    fn test_user_role_get_label() {
        assert_eq!(UserRole::Admin.get_label(), "Admin");
        assert_eq!(UserRole::Root.get_label(), "Root");
        assert_eq!(UserRole::Viewer.get_label(), "Viewer");
        assert_eq!(UserRole::Editor.get_label(), "Editor");
        assert_eq!(UserRole::User.get_label(), "User");
        assert_eq!(UserRole::ServiceAccount.get_label(), "Service Account");
        assert_eq!(UserRole::SreAgent.get_label(), "SRE Agent");
    }

    #[test]
    fn test_user_role_is_valid_role() {
        assert!(UserRole::is_valid_role("admin"));
        assert!(UserRole::is_valid_role("root"));
        assert!(UserRole::is_valid_role("viewer"));
        assert!(UserRole::is_valid_role("editor"));
        assert!(UserRole::is_valid_role("user"));
        assert!(UserRole::is_valid_role("service_account"));
        assert!(UserRole::is_valid_role("sre_agent"));
        assert!(!UserRole::is_valid_role("Admin")); // case sensitive
        assert!(!UserRole::is_valid_role("superadmin"));
        assert!(!UserRole::is_valid_role(""));
    }

    #[test]
    fn test_user_type_from_i16() {
        assert_eq!(UserType::from(0_i16), UserType::Internal);
        assert_eq!(UserType::from(1_i16), UserType::External);
        assert_eq!(UserType::from(99_i16), UserType::Internal); // unknown → Internal
    }

    #[test]
    fn test_user_type_into_i16() {
        assert_eq!(i16::from(UserType::Internal), 0_i16);
        assert_eq!(i16::from(UserType::External), 1_i16);
    }

    #[test]
    fn test_user_type_is_external() {
        assert!(!UserType::Internal.is_external());
        assert!(UserType::External.is_external());
    }

    fn make_db_user() -> DBUser {
        DBUser {
            email: "alice@example.com".to_string(),
            first_name: "Alice".to_string(),
            last_name: "Smith".to_string(),
            password: "hash".to_string(),
            salt: "salt".to_string(),
            organizations: vec![
                UserOrg {
                    name: "org1".to_string(),
                    org_name: "Org One".to_string(),
                    token: "tok1".to_string(),
                    rum_token: None,
                    role: UserRole::Admin,
                },
                UserOrg {
                    name: "org2".to_string(),
                    org_name: "Org Two".to_string(),
                    token: "tok2".to_string(),
                    rum_token: Some("rum2".to_string()),
                    role: UserRole::Viewer,
                },
            ],
            is_external: false,
            password_ext: None,
        }
    }

    #[test]
    fn test_db_user_get_user_found() {
        let db_user = make_db_user();
        let user = db_user.get_user("org1".to_string()).unwrap();
        assert_eq!(user.email, "alice@example.com");
        assert_eq!(user.org, "org1");
        assert!(matches!(user.role, UserRole::Admin));
        assert_eq!(user.token, "tok1");
    }

    #[test]
    fn test_db_user_get_user_not_found() {
        let db_user = make_db_user();
        assert!(db_user.get_user("org_none".to_string()).is_none());
    }

    #[test]
    fn test_db_user_get_user_empty_orgs() {
        let mut db_user = make_db_user();
        db_user.organizations.clear();
        assert!(db_user.get_user("org1".to_string()).is_none());
    }

    #[test]
    fn test_db_user_get_all_users() {
        let db_user = make_db_user();
        let users = db_user.get_all_users();
        assert_eq!(users.len(), 2);
        assert!(users.iter().any(|u| u.org == "org1"));
        assert!(users.iter().any(|u| u.org == "org2"));
        // all share the same email
        assert!(users.iter().all(|u| u.email == "alice@example.com"));
    }

    #[test]
    fn test_db_user_get_all_users_empty() {
        let mut db_user = make_db_user();
        db_user.organizations.clear();
        assert!(db_user.get_all_users().is_empty());
    }

    #[test]
    fn test_user_role_sre_agent_display_and_from_str() {
        // Display: SreAgent → "sre_agent"
        assert_eq!(format!("{}", UserRole::SreAgent), "sre_agent");
        // from_str: "sre_agent" → SreAgent
        assert_eq!(UserRole::from_str("sre_agent").unwrap(), UserRole::SreAgent);
    }

    #[test]
    fn test_user_role_from_i16_all_variants() {
        assert_eq!(UserRole::from(0_i16), UserRole::Root);
        assert_eq!(UserRole::from(1_i16), UserRole::Admin);
        assert_eq!(UserRole::from(2_i16), UserRole::Editor);
        assert_eq!(UserRole::from(3_i16), UserRole::Viewer);
        assert_eq!(UserRole::from(4_i16), UserRole::User);
        assert_eq!(UserRole::from(5_i16), UserRole::ServiceAccount);
        assert_eq!(UserRole::from(6_i16), UserRole::SreAgent);
        assert_eq!(UserRole::from(99_i16), UserRole::Admin); // unknown → Admin
    }

    #[test]
    fn test_user_role_into_i16_all_variants() {
        assert_eq!(i16::from(UserRole::Root), 0);
        assert_eq!(i16::from(UserRole::Admin), 1);
        assert_eq!(i16::from(UserRole::Editor), 2);
        assert_eq!(i16::from(UserRole::Viewer), 3);
        assert_eq!(i16::from(UserRole::User), 4);
        assert_eq!(i16::from(UserRole::ServiceAccount), 5);
        assert_eq!(i16::from(UserRole::SreAgent), 6);
    }
}
