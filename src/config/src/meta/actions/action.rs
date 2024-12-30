// Copyright (c) 2024.

use ahash::HashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Action {
    #[serde(default)]
    pub blob: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub cron_expr: String,
    #[serde(default)]
    pub environment_variables: HashMap<String, String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct GetActionsResponse {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub cron_expr: String,
    #[serde(default)]
    pub environment_variables: HashMap<String, String>,
    #[serde(default)]
    pub blob: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct UpdateActionRequest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub cron_expr: String,
    #[serde(default)]
    pub environment_variables: HashMap<String, String>,
}
