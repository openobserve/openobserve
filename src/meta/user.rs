use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct User {
    pub name: String,
    pub password: String,
    pub role: UserRole,
    #[serde(default)]
    pub salt: String,
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
    #[serde(rename = "user")]
    User,
    #[serde(rename = "root")]
    Root,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserResponse {
    pub name: String,
    pub role: UserRole,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct UserList {
    pub list: Vec<UserResponse>,
}
