// Copyright 2025 OpenObserve Inc.
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

use crate::utils::json;

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
}

impl std::fmt::Display for TriggerModule {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::Alert => write!(f, "alert"),
            Self::Report => write!(f, "report"),
            Self::DerivedStream => write!(f, "derived_stream"),
            Self::QueryRecommendations => write!(f, "query_recommendations"),
            Self::Backfill => write!(f, "backfill"),
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

/// Extended Trigger struct that includes the created_at timestamp from the database
/// Used for listing operations where creation time is needed
#[derive(sqlx::FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct TriggerWithCreatedAt {
    pub id: i64,
    pub org: String,
    pub module: TriggerModule,
    pub module_key: String,
    pub next_run_at: i64,
    pub is_realtime: bool,
    pub is_silenced: bool,
    pub status: TriggerStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<i64>,
    pub retries: i32,
    #[serde(default)]
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>, // Unix timestamp in microseconds
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
pub struct BackfillJob {
    /// Reference to the source pipeline ID
    pub source_pipeline_id: String,

    /// Time range to backfill
    pub start_time: i64,  // microseconds
    pub end_time: i64,    // microseconds

    /// Optional: chunk size for processing large ranges
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_period_minutes: Option<i64>,

    /// Progress tracking
    pub current_position: i64,

    /// Optional: rate limiting
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_execution_time_secs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_between_chunks_secs: Option<i64>,

    /// Delete existing data before backfilling
    #[serde(default)]
    pub delete_before_backfill: bool,

    /// Deletion phase tracking
    #[serde(default)]
    pub deletion_status: DeletionStatus,

    /// Deletion job ID for tracking compactor job
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletion_job_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeletionStatus {
    #[default]
    NotRequired,
    Pending,
    InProgress,
    Completed,
    Failed(String),
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
