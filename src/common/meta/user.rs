// Copyright 2023 Zinc Labs Inc.
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
use std::fmt;
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserRequest {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub password: String,
    #[serde(skip_serializing)]
    pub role: UserRole,
}

impl UserRequest {
    pub fn to_new_dbuser(
        &self,
        password: String,
        salt: String,
        org: String,
        token: String,
        rum_token: String,
    ) -> DBUser {
        DBUser {
            email: self.email.clone(),
            first_name: self.first_name.clone(),
            last_name: self.last_name.clone(),
            password,
            salt,
            organizations: vec![UserOrg {
                name: org,
                token,
                rum_token: Some(rum_token),
                role: self.role.clone(),
            }],
        }
    }
}

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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserOrgRole {
    pub role: UserRole,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Eq, PartialEq, Default)]
pub struct UpdateUser {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<UserRole>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum UserRole {
    #[serde(rename = "admin")]
    Admin,
    #[serde(rename = "member")]
    #[default]
    Member,
    #[serde(rename = "root")]
    Root,
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            UserRole::Admin => write!(f, "admin"),
            UserRole::Member => write!(f, "member"),
            UserRole::Root => write!(f, "root"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserResponse {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub role: UserRole,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserList {
    pub data: Vec<UserResponse>,
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
