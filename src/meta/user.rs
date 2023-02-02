use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub name: String,
    pub password: String,
    pub role: Role,
    #[serde(default)]
    pub salt: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SignInUser {
    pub name: String,
    pub password: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum Role {
    Admin,
    User,
    Root,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UserResponse {
    pub name: String,
    pub role: Role,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UserList {
    pub list: Vec<UserResponse>,
}
