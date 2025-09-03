// Copyright (c) 2024.

use std::{collections::HashMap, fmt::Display};

use chrono::{DateTime, Utc};
use sea_orm::{DeriveActiveEnum, EnumIter};
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionDetailsType {
    #[default]
    Once,
    Repeat,
    Service,
}

impl std::fmt::Display for ExecutionDetailsType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ExecutionDetailsType::Once => "once",
            ExecutionDetailsType::Repeat => "repeat",
            ExecutionDetailsType::Service => "service",
        };
        write!(f, "{s}")
    }
}

impl TryFrom<&str> for ExecutionDetailsType {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "once" => Ok(ExecutionDetailsType::Once),
            "repeat" => Ok(ExecutionDetailsType::Repeat),
            "service" => Ok(ExecutionDetailsType::Service),
            _ => Err(anyhow::anyhow!("Invalid ExecutionDetailsType")),
        }
    }
}

#[derive(
    Debug,
    Default,
    Clone,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    EnumIter,
    DeriveActiveEnum,
    ToSchema,
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
        write!(f, "{s}")
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Action {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
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
    pub environment_variables: HashMap<String, String>,
    #[serde(default)]
    pub created_by: String,
    pub status: ActionStatus,
    #[schema(value_type = String)]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = Option<String>)]
    pub last_executed_at: Option<DateTime<Utc>>,
    // User Set variable
    pub zip_file_name: String,
    // default to created_at
    #[serde(default)]
    #[schema(value_type = String)]
    pub last_modified_at: DateTime<Utc>,
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    pub last_successful_at: Option<DateTime<Utc>>,
    pub origin_cluster_url: String,
    pub service_account: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateActionDetailsRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub environment_variables: Option<HashMap<String, String>>,
    #[serde(default)]
    pub cron_expr: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub service_account: Option<String>,
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
    Service,
}

impl Display for ActionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = match self {
            ActionType::Job => "job".to_string(),
            ActionType::CronJob => "cronjob".to_string(),
            ActionType::Service => "service".to_string(),
        };
        write!(f, "{str}")
    }
}
impl TryFrom<&str> for ActionType {
    type Error = anyhow::Error;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "job" => Ok(ActionType::Job),
            "cronjob" => Ok(ActionType::CronJob),
            "service" => Ok(ActionType::Service),
            _ => Err(anyhow::anyhow!("Invalid action type: {s}")),
        }
    }
}

impl From<ExecutionDetailsType> for ActionType {
    fn from(e: ExecutionDetailsType) -> Self {
        match e {
            ExecutionDetailsType::Once => ActionType::Job,
            ExecutionDetailsType::Repeat => ActionType::CronJob,
            ExecutionDetailsType::Service => ActionType::Service,
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::Utc;
    use svix_ksuid::{Ksuid, KsuidLike};

    use super::*;

    #[test]
    fn test_execution_details_type_display() {
        assert_eq!(ExecutionDetailsType::Once.to_string(), "once");
        assert_eq!(ExecutionDetailsType::Repeat.to_string(), "repeat");
        assert_eq!(ExecutionDetailsType::Service.to_string(), "service");
    }

    #[test]
    fn test_execution_details_type_try_from_str() {
        assert_eq!(
            ExecutionDetailsType::try_from("once").unwrap(),
            ExecutionDetailsType::Once
        );
        assert_eq!(
            ExecutionDetailsType::try_from("repeat").unwrap(),
            ExecutionDetailsType::Repeat
        );
        assert_eq!(
            ExecutionDetailsType::try_from("service").unwrap(),
            ExecutionDetailsType::Service
        );
        assert!(ExecutionDetailsType::try_from("invalid").is_err());
    }

    #[test]
    fn test_action_status_display() {
        assert_eq!(ActionStatus::Ready.to_string(), "ready");
        assert_eq!(ActionStatus::Running.to_string(), "running");
        assert_eq!(ActionStatus::Errored.to_string(), "errored");
        assert_eq!(ActionStatus::Completed.to_string(), "completed");
    }

    #[test]
    fn test_action_status_try_from_str() {
        assert_eq!(
            ActionStatus::try_from("ready").unwrap(),
            ActionStatus::Ready
        );
        assert_eq!(
            ActionStatus::try_from("running").unwrap(),
            ActionStatus::Running
        );
        assert_eq!(
            ActionStatus::try_from("errored").unwrap(),
            ActionStatus::Errored
        );
        assert_eq!(
            ActionStatus::try_from("completed").unwrap(),
            ActionStatus::Completed
        );
        assert!(ActionStatus::try_from("invalid").is_err());
    }

    #[test]
    fn test_action_type_display() {
        assert_eq!(ActionType::Job.to_string(), "job");
        assert_eq!(ActionType::CronJob.to_string(), "cronjob");
        assert_eq!(ActionType::Service.to_string(), "service");
    }

    #[test]
    fn test_action_type_try_from_str() {
        assert_eq!(ActionType::try_from("job").unwrap(), ActionType::Job);
        assert_eq!(
            ActionType::try_from("cronjob").unwrap(),
            ActionType::CronJob
        );
        assert_eq!(
            ActionType::try_from("service").unwrap(),
            ActionType::Service
        );
        assert!(ActionType::try_from("invalid").is_err());
    }

    #[test]
    fn test_action_type_from_execution_details_type() {
        assert_eq!(
            ActionType::from(ExecutionDetailsType::Once),
            ActionType::Job
        );
        assert_eq!(
            ActionType::from(ExecutionDetailsType::Repeat),
            ActionType::CronJob
        );
        assert_eq!(
            ActionType::from(ExecutionDetailsType::Service),
            ActionType::Service
        );
    }

    #[test]
    fn test_action_struct_creation() {
        let now = Utc::now();
        let mut env_vars = HashMap::new();
        env_vars.insert("KEY1".to_string(), "VALUE1".to_string());
        env_vars.insert("KEY2".to_string(), "VALUE2".to_string());

        let action = Action {
            id: Some(Ksuid::new(None, None)),
            org_id: "test_org".to_string(),
            description: Some("Test action".to_string()),
            zip_file_path: Some("/path/to/zip".to_string()),
            name: "test_action".to_string(),
            execution_details: ExecutionDetailsType::Once,
            cron_expr: None,
            environment_variables: env_vars.clone(),
            created_by: "test_user".to_string(),
            status: ActionStatus::Ready,
            created_at: now,
            last_executed_at: None,
            zip_file_name: "test.zip".to_string(),
            last_modified_at: now,
            last_successful_at: None,
            origin_cluster_url: "https://cluster.example.com".to_string(),
            service_account: "test_service_account".to_string(),
        };

        assert_eq!(action.org_id, "test_org");
        assert_eq!(action.name, "test_action");
        assert_eq!(action.execution_details, ExecutionDetailsType::Once);
        assert_eq!(action.environment_variables, env_vars);
        assert_eq!(action.status, ActionStatus::Ready);
        assert_eq!(action.zip_file_name, "test.zip");
        assert_eq!(action.origin_cluster_url, "https://cluster.example.com");
        assert_eq!(action.service_account, "test_service_account");
    }

    #[test]
    fn test_update_action_details_request() {
        let mut env_vars = HashMap::new();
        env_vars.insert("NEW_KEY".to_string(), "NEW_VALUE".to_string());

        let request = UpdateActionDetailsRequest {
            name: Some("updated_name".to_string()),
            environment_variables: Some(env_vars.clone()),
            cron_expr: Some("0 0 * * *".to_string()),
            description: Some("Updated description".to_string()),
            service_account: Some("updated_service_account".to_string()),
        };

        assert_eq!(request.name, Some("updated_name".to_string()));
        assert_eq!(request.environment_variables, Some(env_vars));
        assert_eq!(request.cron_expr, Some("0 0 * * *".to_string()));
        assert_eq!(request.description, Some("Updated description".to_string()));
        assert_eq!(
            request.service_account,
            Some("updated_service_account".to_string())
        );
    }

    #[test]
    fn test_update_action_request() {
        let mut env_vars = HashMap::new();
        env_vars.insert("JOB_KEY".to_string(), "JOB_VALUE".to_string());

        let request = UpdateActionRequest {
            job_name: Some("test_job".to_string()),
            label_name: Some("test_label".to_string()),
            cron_expr: Some("0 */6 * * *".to_string()),
            environment_variables: Some(env_vars.clone()),
        };

        assert_eq!(request.job_name, Some("test_job".to_string()));
        assert_eq!(request.label_name, Some("test_label".to_string()));
        assert_eq!(request.cron_expr, Some("0 */6 * * *".to_string()));
        assert_eq!(request.environment_variables, Some(env_vars));
    }

    #[test]
    fn test_action_running_status_response() {
        let now = Utc::now();
        let response = ActionRunningStatusResponse {
            id: "test_id".to_string(),
            action_status: ActionStatus::Running,
            created_at: now,
            last_executed_at: Some(now),
            last_successful_at: None,
        };

        assert_eq!(response.id, "test_id");
        assert_eq!(response.action_status, ActionStatus::Running);
        assert_eq!(response.created_at, now);
        assert_eq!(response.last_executed_at, Some(now));
        assert_eq!(response.last_successful_at, None);
    }

    #[test]
    fn test_serialization_deserialization() {
        let now = Utc::now();
        let mut env_vars = HashMap::new();
        env_vars.insert("TEST_KEY".to_string(), "TEST_VALUE".to_string());

        let action = Action {
            id: Some(Ksuid::new(None, None)),
            org_id: "test_org".to_string(),
            description: Some("Test action".to_string()),
            zip_file_path: Some("/path/to/zip".to_string()),
            name: "test_action".to_string(),
            execution_details: ExecutionDetailsType::Repeat,
            cron_expr: Some("0 0 * * *".to_string()),
            environment_variables: env_vars,
            created_by: "test_user".to_string(),
            status: ActionStatus::Completed,
            created_at: now,
            last_executed_at: Some(now),
            zip_file_name: "test.zip".to_string(),
            last_modified_at: now,
            last_successful_at: Some(now),
            origin_cluster_url: "https://cluster.example.com".to_string(),
            service_account: "test_service_account".to_string(),
        };

        // Test serialization
        let json = serde_json::to_string(&action).expect("Failed to serialize");
        assert!(!json.is_empty());

        // Test deserialization
        let deserialized: Action = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.org_id, action.org_id);
        assert_eq!(deserialized.name, action.name);
        assert_eq!(deserialized.execution_details, action.execution_details);
        assert_eq!(deserialized.status, action.status);
    }
}
