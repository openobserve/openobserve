// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct User {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    pub password: String,
    pub role: UserRole,
    #[serde(default)]
    pub salt: String,
    #[serde(default)]
    pub token: String,
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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct SignInUser {
    pub name: String,
    pub password: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum UserRole {
    #[serde(rename = "admin")]
    Admin,
    #[serde(rename = "member")]
    User,
    #[serde(rename = "root")]
    Root,
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
