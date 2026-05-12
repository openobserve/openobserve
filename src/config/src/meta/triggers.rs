// Copyright 2026 OpenObserve Inc.
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

use crate::{stats::MemorySize, utils::json};

#[derive(Debug, Clone, sqlx::Type, PartialEq, Serialize, Deserialize, Default)]
#[repr(i32)]
pub enum TriggerStatus {
    #[default]
    Waiting,
    Processing,
    Completed,
}

#[derive(
    Debug, Clone, sqlx::Type, PartialEq, Serialize, Deserialize, Default, Eq, std::hash::Hash,
)]
#[repr(i32)]
pub enum TriggerModule {
    Report,
    #[default]
    Alert,
    DerivedStream,
    QueryRecommendations,
    Backfill,
    AnomalyDetection,
}

impl std::fmt::Display for TriggerModule {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::Alert => write!(f, "alert"),
            Self::Report => write!(f, "report"),
            Self::DerivedStream => write!(f, "derived_stream"),
            Self::QueryRecommendations => write!(f, "query_recommendations"),
            Self::Backfill => write!(f, "backfill"),
            Self::AnomalyDetection => write!(f, "anomaly_detection"),
        }
    }
}

#[derive(sqlx::FromRow, Debug, Clone, Default)]
pub struct TriggerId {
    pub id: i64,
}

#[derive(sqlx::FromRow, Debug, Clone, Serialize, Deserialize, Default)]
pub struct Trigger {
    pub id: i64,
    pub org: String,
    pub module: TriggerModule,
    pub module_key: String,
    pub next_run_at: i64,
    pub is_realtime: bool,
    pub is_silenced: bool,
    pub status: TriggerStatus,
    // #[sqlx(default)] only works when the column itself is missing.
    // For NULL value it does not work.
    // TODO: See https://github.com/launchbadge/sqlx/issues/1106
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<i64>,
    pub retries: i32,
    #[serde(default)]
    pub data: String,
}

impl MemorySize for Trigger {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Trigger>()
            + self.org.mem_size()
            + self.module_key.mem_size()
            + self.data.mem_size()
    }
}

#[derive(Default, Serialize, Deserialize, Debug)]
pub struct ScheduledTriggerData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_end_time: Option<i64>,
    #[serde(default)]
    pub tolerance: i64,
    #[serde(default)]
    pub last_satisfied_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backfill_job: Option<BackfillJob>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
/// Dynamic state for backfill job stored in trigger data
/// Static configuration is stored in backfill_jobs table
pub struct BackfillJob {
    /// Progress tracking - current position in the time range
    pub current_position: i64, // microseconds

    /// Deletion phase tracking
    #[serde(default)]
    pub deletion_status: DeletionStatus,

    /// Deletion job IDs for tracking compactor jobs (one per destination stream)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deletion_job_ids: Vec<String>,

    /// Error message if any error occurred during backfill or deletion
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeletionStatus {
    #[default]
    NotRequired,
    Pending,
    InProgress,
    Completed,
}

impl ScheduledTriggerData {
    /// Does not reset the last_satisfied_at field
    pub fn reset(&mut self) {
        self.period_end_time = None;
        self.tolerance = 0;
    }

    pub fn to_json_string(&self) -> String {
        json::to_string(self).unwrap()
    }

    pub fn from_json_string(s: &str) -> Result<Self, serde_json::Error> {
        json::from_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trigger_module_display() {
        assert_eq!(TriggerModule::Alert.to_string(), "alert");
        assert_eq!(TriggerModule::Report.to_string(), "report");
        assert_eq!(TriggerModule::DerivedStream.to_string(), "derived_stream");
        assert_eq!(
            TriggerModule::QueryRecommendations.to_string(),
            "query_recommendations"
        );
        assert_eq!(TriggerModule::Backfill.to_string(), "backfill");
        assert_eq!(
            TriggerModule::AnomalyDetection.to_string(),
            "anomaly_detection"
        );
    }

    #[test]
    fn test_scheduled_trigger_data_reset_preserves_last_satisfied_at() {
        let mut data = ScheduledTriggerData {
            period_end_time: Some(1000),
            tolerance: 42,
            last_satisfied_at: Some(999),
            backfill_job: None,
        };
        data.reset();
        assert!(data.period_end_time.is_none());
        assert_eq!(data.tolerance, 0);
        // reset must NOT clear last_satisfied_at
        assert_eq!(data.last_satisfied_at, Some(999));
    }

    #[test]
    fn test_scheduled_trigger_data_reset_already_default() {
        let mut data = ScheduledTriggerData::default();
        data.reset(); // should not panic
        assert!(data.period_end_time.is_none());
        assert_eq!(data.tolerance, 0);
    }

    #[test]
    fn test_scheduled_trigger_data_json_roundtrip() {
        let data = ScheduledTriggerData {
            period_end_time: Some(1_234_567),
            tolerance: 10,
            last_satisfied_at: Some(9_999_999),
            backfill_job: None,
        };
        let json = data.to_json_string();
        let restored = ScheduledTriggerData::from_json_string(&json).unwrap();
        assert_eq!(restored.period_end_time, data.period_end_time);
        assert_eq!(restored.tolerance, data.tolerance);
        assert_eq!(restored.last_satisfied_at, data.last_satisfied_at);
    }

    #[test]
    fn test_scheduled_trigger_data_from_invalid_json() {
        let result = ScheduledTriggerData::from_json_string("not json");
        assert!(result.is_err());
    }

    #[test]
    fn test_scheduled_trigger_data_json_omits_none_fields() {
        let data = ScheduledTriggerData::default();
        let json = data.to_json_string();
        // period_end_time is None → skip_serializing_if omits it
        assert!(!json.contains("period_end_time"));
    }

    #[test]
    fn test_deletion_status_default_is_not_required() {
        let s: DeletionStatus = Default::default();
        assert_eq!(s, DeletionStatus::NotRequired);
    }

    #[test]
    fn test_deletion_status_serde_roundtrip_all_variants() {
        for (variant, expected) in [
            (DeletionStatus::NotRequired, "\"not_required\""),
            (DeletionStatus::Pending, "\"pending\""),
            (DeletionStatus::InProgress, "\"in_progress\""),
            (DeletionStatus::Completed, "\"completed\""),
        ] {
            let s = serde_json::to_string(&variant).unwrap();
            assert_eq!(s, expected);
            let back: DeletionStatus = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_backfill_job_deletion_job_ids_skip_serializing_when_empty() {
        let job = BackfillJob {
            current_position: 100,
            deletion_status: DeletionStatus::NotRequired,
            deletion_job_ids: vec![],
            error: None,
        };
        let val = serde_json::to_value(&job).unwrap();
        assert!(!val.as_object().unwrap().contains_key("deletion_job_ids"));
        assert!(!val.as_object().unwrap().contains_key("error"));
    }

    #[test]
    fn test_backfill_job_with_ids_and_error_serializes() {
        let job = BackfillJob {
            current_position: 999,
            deletion_status: DeletionStatus::InProgress,
            deletion_job_ids: vec!["job1".to_string(), "job2".to_string()],
            error: Some("oops".to_string()),
        };
        let val = serde_json::to_value(&job).unwrap();
        assert_eq!(val["deletion_job_ids"].as_array().unwrap().len(), 2);
        assert_eq!(val["error"], "oops");
        assert_eq!(val["current_position"], 999_i64);
    }

    #[test]
    fn test_trigger_status_default_is_waiting() {
        let s: TriggerStatus = Default::default();
        assert_eq!(s, TriggerStatus::Waiting);
    }

    #[test]
    fn test_trigger_status_serde_roundtrip() {
        for variant in [
            TriggerStatus::Waiting,
            TriggerStatus::Processing,
            TriggerStatus::Completed,
        ] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: TriggerStatus = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_trigger_start_end_time_none_absent_from_json() {
        let t = Trigger {
            id: 1,
            org: "org".to_string(),
            module: TriggerModule::Alert,
            module_key: "k".to_string(),
            next_run_at: 0,
            is_realtime: false,
            is_silenced: false,
            status: TriggerStatus::Waiting,
            start_time: None,
            end_time: None,
            retries: 0,
            data: "{}".to_string(),
        };
        let json = serde_json::to_value(&t).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("start_time"));
        assert!(!obj.contains_key("end_time"));
    }

    #[test]
    fn test_trigger_start_end_time_some_present_in_json() {
        let t = Trigger {
            id: 2,
            org: "org".to_string(),
            module: TriggerModule::Alert,
            module_key: "k".to_string(),
            next_run_at: 0,
            is_realtime: false,
            is_silenced: false,
            status: TriggerStatus::Waiting,
            start_time: Some(1000),
            end_time: Some(2000),
            retries: 0,
            data: "{}".to_string(),
        };
        let json = serde_json::to_value(&t).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("start_time"));
        assert_eq!(obj["start_time"], serde_json::json!(1000_i64));
        assert!(obj.contains_key("end_time"));
        assert_eq!(obj["end_time"], serde_json::json!(2000_i64));
    }

    #[test]
    fn test_trigger_mem_size_at_least_struct_size() {
        let t = Trigger {
            id: 1,
            org: "myorg".to_string(),
            module: TriggerModule::Alert,
            module_key: "key".to_string(),
            next_run_at: 0,
            is_realtime: false,
            is_silenced: false,
            status: TriggerStatus::Waiting,
            start_time: None,
            end_time: None,
            retries: 0,
            data: "{}".to_string(),
        };
        assert!(t.mem_size() >= std::mem::size_of::<Trigger>());
    }

    #[test]
    fn test_scheduled_trigger_data_with_backfill_job_json_roundtrip() {
        let data = ScheduledTriggerData {
            period_end_time: Some(500),
            tolerance: 5,
            last_satisfied_at: None,
            backfill_job: Some(BackfillJob {
                current_position: 42,
                deletion_status: DeletionStatus::Pending,
                deletion_job_ids: vec!["j1".to_string()],
                error: None,
            }),
        };
        let json = data.to_json_string();
        let restored = ScheduledTriggerData::from_json_string(&json).unwrap();
        let bj = restored.backfill_job.unwrap();
        assert_eq!(bj.current_position, 42);
        assert_eq!(bj.deletion_status, DeletionStatus::Pending);
        assert_eq!(bj.deletion_job_ids.len(), 1);
    }
}
