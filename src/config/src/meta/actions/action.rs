// Copyright (c) 2024.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
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

impl From<&str> for ExecutionDetailsType {
    fn from(s: &str) -> Self {
        match s {
            "once" => ExecutionDetailsType::Once,
            "repeat" => ExecutionDetailsType::Repeat,
            _ => ExecutionDetailsType::Once,
        }
    }
}

#[derive(
    Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum,
)]
#[sea_orm(db_type = "Enum", rs_type = "String", enum_name = "status")]
pub enum ActionStatus {
    #[default]
    #[sea_orm(string_value = "ready")]
    Ready,
    #[sea_orm(string_value = "running")]
    Running,
    #[sea_orm(string_value = "errored")]
    Errored,
    #[sea_orm(string_value = "completed")]
    Completed,
}

impl TryFrom<&str> for ActionStatus {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "ready" => Ok(ActionStatus::Ready),
            "running" => Ok(ActionStatus::Running),
            "errored" => Ok(ActionStatus::Errored),
            "completed" => Ok(ActionStatus::Completed),
            _ => Err(anyhow::anyhow!("Invalid ActionStatus")),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Action {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Ksuid>,
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub zip_file_path: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub execution_details: ExecutionDetailsType,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub environment_variables: HashMap<String, String>,
    #[serde(default)]
    pub created_by: String,
    pub status: ActionStatus,
    pub created_at: DateTime<Utc>,
    pub last_executed_at: Option<DateTime<Utc>>,
    pub failure_count: i32,
    pub zip_file_name: String,
    // default to created_at
    #[serde(default)]
    pub last_modified_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateActionDetailsRequest {
    pub name: Option<String>,
    pub environment_variables: Option<HashMap<String, String>>,
    pub frequency: Option<ExecutionDetailsType>,
    pub cron_expr: Option<String>,
}

/// Request send to Action Deployer, to deploy an action
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct DeployActionRequest {
    #[serde(default)]
    pub job_name: String,
    #[serde(default)]
    pub label_name: String,
    #[serde(default)]
    pub execution_details: ExecutionDetailsType,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub environment_variables: HashMap<String, String>,
    #[serde(default)]
    pub origin_cluster_id: String,
}

/// Response from Action Deployer, to get the status of an action
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct ActionRunningStatusResponse {
    #[serde(default)]
    pub id: String,
    pub action_status: ActionStatus,
    pub created_at: DateTime<Utc>,
    pub last_executed_at: DateTime<Utc>,
    // pub last_successful_at: DateTime<Utc>,
    pub failure_count: i32,
}
