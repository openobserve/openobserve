// Copyright (c) 2024.

use std::{collections::HashMap, fmt::Display};

use chrono::{DateTime, Utc};
use regex::Regex;
use sea_orm::{DeriveActiveEnum, EnumIter};
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionDetailsType {
    #[default]
    Once,
    Repeat,
}

impl std::fmt::Display for ExecutionDetailsType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ExecutionDetailsType::Once => "Once",
            ExecutionDetailsType::Repeat => "Repeat",
        };
        write!(f, "{}", s)
    }
}

impl TryFrom<&str> for ExecutionDetailsType {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "Once" => Ok(ExecutionDetailsType::Once),
            "Repeat" => Ok(ExecutionDetailsType::Repeat),
            _ => Err(anyhow::anyhow!("Invalid ExecutionDetailsType")),
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

impl Display for ActionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ActionStatus::Ready => "ready",
            ActionStatus::Running => "running",
            ActionStatus::Errored => "errored",
            ActionStatus::Completed => "completed",
        };
        write!(f, "{}", s)
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
    pub description: Option<String>,
    #[serde(default)]
    pub zip_file_path: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub execution_details: ExecutionDetailsType,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(deserialize_with = "validate_env_vars")]
    pub environment_variables: HashMap<String, String>,
    #[serde(default)]
    pub created_by: String,
    pub status: ActionStatus,
    pub created_at: DateTime<Utc>,
    pub last_executed_at: Option<DateTime<Utc>>,
    // User Set variable
    pub zip_file_name: String,
    // default to created_at
    #[serde(default)]
    pub last_modified_at: DateTime<Utc>,
    #[serde(default)]
    pub last_successful_at: Option<DateTime<Utc>>,
    pub origin_cluster_url: String,
    pub service_account: String,
}

fn validate_env_vars<'de, D>(deserializer: D) -> Result<HashMap<String, String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let map: HashMap<String, String> = HashMap::deserialize(deserializer)?;
    let key_regex = Regex::new(r"^[A-Z][A-Z0-9_]*$").unwrap();

    for key in map.keys() {
        if !key_regex.is_match(key) {
            return Err(serde::de::Error::custom(
                "Environment variable keys must be uppercase and alphanumeric",
            ));
        }
    }
    Ok(map)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateActionDetailsRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub environment_variables: Option<HashMap<String, String>>,
    #[serde(default)]
    pub execution_details: Option<ExecutionDetailsType>,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub service_account: Option<String>,
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
    pub ksuid: String,
    #[serde(default)]
    pub runtime: String,
    #[serde(default)]
    pub origin_cluster_url: String,
    #[serde(default)]
    pub sa_token: String,
    #[serde(default)]
    pub service_account: String,
}

/// Request send to Action Deployer, to deploy an action
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct UpdateActionRequest {
    #[serde(default)]
    pub job_name: Option<String>,
    #[serde(default)]
    pub label_name: Option<String>,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub environment_variables: Option<HashMap<String, String>>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ActionType {
    #[default]
    Job,
    CronJob,
}

impl Display for ActionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = match self {
            ActionType::Job => "job".to_string(),
            ActionType::CronJob => "cronjob".to_string(),
        };
        write!(f, "{}", str)
    }
}
impl TryFrom<&str> for ActionType {
    type Error = anyhow::Error;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "job" => Ok(ActionType::Job),
            "cronjob" => Ok(ActionType::CronJob),
            _ => Err(anyhow::anyhow!("Invalid action type: {}", s)),
        }
    }
}

impl From<ExecutionDetailsType> for ActionType {
    fn from(e: ExecutionDetailsType) -> Self {
        match e {
            ExecutionDetailsType::Once => ActionType::Job,
            ExecutionDetailsType::Repeat => ActionType::CronJob,
        }
    }
}

/// Response from Action Deployer, to get the status of an action
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct ActionRunningStatusResponse {
    #[serde(default)]
    pub id: String,
    pub action_status: ActionStatus,
    pub created_at: DateTime<Utc>,
    pub last_executed_at: Option<DateTime<Utc>>,
    pub last_successful_at: Option<DateTime<Utc>>,
}
