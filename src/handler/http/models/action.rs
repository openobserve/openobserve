// Copyright (c) 2024. OpenObserve Inc.
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

use std::collections::HashMap;

use anyhow::anyhow;
use chrono::{DateTime, Utc};
use config::meta::actions::action::{Action, ActionStatus, ExecutionDetailsType};
use serde::{Deserialize, Serialize, Serializer};

#[derive(Debug, Serialize, Deserialize)]
pub struct GetActionInfoResponse {
    pub id: String,
    pub name: String,
    #[serde(serialize_with = "serialize_datetime")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "serialize_datetime")]
    pub last_run_at: DateTime<Utc>,
    #[serde(serialize_with = "serialize_option_datetime")]
    pub last_successful_at: Option<DateTime<Utc>>,
    pub created_by: String,
    pub status: ActionStatus,
    pub execution_details_type: ExecutionDetailsType,
}

impl TryFrom<Action> for GetActionInfoResponse {
    type Error = anyhow::Error;

    fn try_from(value: Action) -> Result<Self, Self::Error> {
        Ok(GetActionInfoResponse {
            id: value.id.ok_or(anyhow!("No Id for action"))?.to_string(),
            name: value.name,
            created_at: value.created_at,
            last_run_at: value.last_executed_at.unwrap_or(value.created_at),
            last_successful_at: value.last_successful_at,
            created_by: value.created_by,
            status: value.status,
            execution_details_type: value.execution_details,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetActionListResponse {
    pub actions: Vec<GetActionInfoResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetActionDetailsResponse {
    pub id: String,
    pub name: String,
    pub environment_variables: HashMap<String, String>,
    pub execution_details: ExecutionDetailsType,
    pub cron_expr: Option<String>,
    pub zip_file_name: String,
    pub description: Option<String>,
    pub service_account: String,
}

impl TryFrom<Action> for GetActionDetailsResponse {
    type Error = anyhow::Error;

    fn try_from(value: Action) -> Result<Self, Self::Error> {
        Ok(GetActionDetailsResponse {
            id: value.id.ok_or(anyhow!("No Id for action"))?.to_string(),
            name: value.name,
            environment_variables: value.environment_variables,
            execution_details: value.execution_details,
            cron_expr: value.cron_expr,
            zip_file_name: value.zip_file_name,
            description: value.description,
            service_account: value.service_account,
        })
    }
}

// Function to serialize DateTime<Utc> to Unix microseconds
fn serialize_datetime<S>(dt: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_i64(dt.timestamp_micros())
}

// Function to serialize Option<DateTime<Utc>> to Unix microseconds
fn serialize_option_datetime<S>(
    dt: &Option<DateTime<Utc>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match dt {
        Some(dt) => serializer.serialize_some(&dt.timestamp_micros()),
        None => serializer.serialize_none(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestActionRequest {
    pub inputs: Vec<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use chrono::TimeZone;
    use config::meta::actions::action::{ActionStatus, ExecutionDetailsType};
    use svix_ksuid::Ksuid;

    use super::*;

    // A valid KSUID in base62 format.
    const TEST_KSUID: &str = "0ujtsYcgvSTl8PAuAdqWYSMnLOv";

    fn test_ksuid() -> Ksuid {
        Ksuid::from_str(TEST_KSUID).unwrap()
    }

    fn make_action(
        id: Option<Ksuid>,
        last_executed_at: Option<DateTime<Utc>>,
        last_successful_at: Option<DateTime<Utc>>,
    ) -> Action {
        Action {
            id,
            org_id: "test_org".to_string(),
            name: "my_action".to_string(),
            execution_details: ExecutionDetailsType::Once,
            cron_expr: None,
            environment_variables: HashMap::new(),
            created_by: "user@example.com".to_string(),
            status: ActionStatus::Ready,
            created_at: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
            last_executed_at,
            last_successful_at,
            zip_file_name: "action.zip".to_string(),
            last_modified_at: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
            origin_cluster_url: "".to_string(),
            service_account: "sa@example.com".to_string(),
            description: None,
            zip_file_path: None,
        }
    }

    #[test]
    fn test_try_from_action_into_info_response_with_id() {
        let action = make_action(Some(test_ksuid()), None, None);
        let resp = GetActionInfoResponse::try_from(action).unwrap();
        assert_eq!(resp.name, "my_action");
        assert_eq!(resp.created_by, "user@example.com");
        // last_run_at falls back to created_at when last_executed_at is None
        assert_eq!(
            resp.last_run_at,
            Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap()
        );
        assert!(resp.last_successful_at.is_none());
    }

    #[test]
    fn test_try_from_action_info_response_no_id_errors() {
        let action = make_action(None, None, None);
        let err = GetActionInfoResponse::try_from(action).unwrap_err();
        assert!(err.to_string().contains("No Id"));
    }

    #[test]
    fn test_try_from_action_info_response_with_last_executed_at() {
        let last_exec = Utc.with_ymd_and_hms(2024, 6, 1, 12, 0, 0).unwrap();
        let last_success = Utc.with_ymd_and_hms(2024, 5, 1, 0, 0, 0).unwrap();
        let action = make_action(Some(test_ksuid()), Some(last_exec), Some(last_success));
        let resp = GetActionInfoResponse::try_from(action).unwrap();
        assert_eq!(resp.last_run_at, last_exec);
        assert_eq!(resp.last_successful_at, Some(last_success));
    }

    #[test]
    fn test_try_from_action_into_details_response_with_id() {
        let action = make_action(Some(test_ksuid()), None, None);
        let resp = GetActionDetailsResponse::try_from(action).unwrap();
        assert_eq!(resp.name, "my_action");
        assert_eq!(resp.service_account, "sa@example.com");
        assert!(resp.cron_expr.is_none());
        assert!(resp.description.is_none());
    }

    #[test]
    fn test_try_from_action_details_response_no_id_errors() {
        let action = make_action(None, None, None);
        let result = GetActionDetailsResponse::try_from(action);
        assert!(result.is_err());
    }

    #[test]
    fn test_serialize_datetime_fields() {
        // Covers serialize_datetime (required field) and serialize_option_datetime (None case)
        // in a single serialization pass.
        let action = make_action(Some(test_ksuid()), None, None);
        let resp = GetActionInfoResponse::try_from(action).unwrap();
        let json = serde_json::to_value(&resp).unwrap();
        let expected_micros = Utc
            .with_ymd_and_hms(2024, 1, 1, 0, 0, 0)
            .unwrap()
            .timestamp_micros();
        assert_eq!(json["created_at"], expected_micros);
        assert!(json["last_successful_at"].is_null());
    }

    #[test]
    fn test_serialize_option_datetime_some() {
        let success_at = Utc.with_ymd_and_hms(2024, 3, 15, 10, 30, 0).unwrap();
        let action = make_action(Some(test_ksuid()), None, Some(success_at));
        let resp = GetActionInfoResponse::try_from(action).unwrap();
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["last_successful_at"], success_at.timestamp_micros());
    }
}
