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
}

impl std::fmt::Display for TriggerModule {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            TriggerModule::Alert => write!(f, "alert"),
            TriggerModule::Report => write!(f, "report"),
            TriggerModule::DerivedStream => write!(f, "derived_stream"),
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

#[derive(Default, Serialize, Deserialize, Debug)]
pub struct ScheduledTriggerData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_end_time: Option<i64>,
    #[serde(default)]
    pub tolerance: i64,
    #[serde(default)]
    pub last_satisfied_at: Option<i64>,
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
