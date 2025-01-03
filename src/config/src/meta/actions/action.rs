// Copyright (c) 2024.

use std::collections::HashMap;

use sea_orm::{DeriveActiveEnum, EnumIter};
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

#[derive(
    Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum,
)]
#[sea_orm(db_type = "Enum", rs_type = "String", enum_name = "execution_details")]
pub enum ExecutionDetailsType {
    #[sea_orm(string_value = "once")]
    #[default]
    Once,
    #[sea_orm(string_value = "repeat")]
    Repeat,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Action {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Ksuid>,
    #[serde(default)]
    pub blob: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub execution_details: ExecutionDetailsType,
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
