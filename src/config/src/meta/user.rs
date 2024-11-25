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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

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

#[derive(Clone, Default, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserOrg {
    pub name: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub rum_token: Option<String>,
    #[serde(default)]
    pub role: UserRole,
}

impl PartialEq for UserOrg {
    fn eq(&self, other: &Self) -> bool {
        !self.name.eq(&other.name)
    }
}

#[derive(Clone, Default, Debug, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum UserRole {
    #[serde(rename = "admin")]
    #[default]
    Admin,
    #[serde(rename = "member")] // admin in OpenSource
    Member,
    #[serde(rename = "root")]
    Root,
    #[serde(rename = "viewer")] // read only user
    Viewer,
    #[serde(rename = "user")] // No access only login user
    User,
    #[serde(rename = "editor")]
    Editor,
    #[serde(rename = "service_account")]
    ServiceAccount,
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
