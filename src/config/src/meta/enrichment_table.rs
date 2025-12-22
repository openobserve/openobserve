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
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EnrichmentTableStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EnrichmentTableUrlJob {
    pub org_id: String,
    pub table_name: String,
    pub url: String,
    pub status: EnrichmentTableStatus,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub total_bytes_fetched: u64,
    pub total_records_processed: i64,
    pub retry_count: u32,
    pub append_data: bool,
    pub last_byte_position: u64,
    pub supports_range: bool,
}

impl EnrichmentTableUrlJob {
    pub fn new(org_id: String, table_name: String, url: String, append_data: bool) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            org_id,
            table_name,
            url,
            status: EnrichmentTableStatus::Pending,
            error_message: None,
            created_at: now,
            updated_at: now,
            total_bytes_fetched: 0,
            total_records_processed: 0,
            retry_count: 0,
            append_data,
            last_byte_position: 0,
            supports_range: false,
        }
    }

    pub fn mark_processing(&mut self) {
        self.status = EnrichmentTableStatus::Processing;
        self.updated_at = chrono::Utc::now().timestamp_micros();
    }

    pub fn mark_completed(&mut self) {
        self.status = EnrichmentTableStatus::Completed;
        self.error_message = None;
        self.updated_at = chrono::Utc::now().timestamp_micros();
    }

    pub fn mark_failed(&mut self, error: String) {
        self.status = EnrichmentTableStatus::Failed;
        self.error_message = Some(error);
        self.updated_at = chrono::Utc::now().timestamp_micros();
    }

    pub fn increment_retry(&mut self, error: String) {
        self.retry_count += 1;
        self.status = EnrichmentTableStatus::Pending;
        self.error_message = Some(error);
        self.updated_at = chrono::Utc::now().timestamp_micros();
    }

    pub fn update_progress(&mut self, bytes: u64, records: i64) {
        self.total_bytes_fetched += bytes;
        self.total_records_processed += records;
        self.updated_at = chrono::Utc::now().timestamp_micros();
    }
}
