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
use svix_ksuid::KsuidLike;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EnrichmentTableStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

impl From<EnrichmentTableStatus> for i16 {
    fn from(status: EnrichmentTableStatus) -> Self {
        match status {
            EnrichmentTableStatus::Pending => 0,
            EnrichmentTableStatus::Processing => 1,
            EnrichmentTableStatus::Completed => 2,
            EnrichmentTableStatus::Failed => 3,
        }
    }
}

impl From<&EnrichmentTableStatus> for i16 {
    fn from(status: &EnrichmentTableStatus) -> Self {
        match status {
            EnrichmentTableStatus::Pending => 0,
            EnrichmentTableStatus::Processing => 1,
            EnrichmentTableStatus::Completed => 2,
            EnrichmentTableStatus::Failed => 3,
        }
    }
}

impl From<i16> for EnrichmentTableStatus {
    fn from(status: i16) -> Self {
        match status {
            0 => EnrichmentTableStatus::Pending,
            1 => EnrichmentTableStatus::Processing,
            2 => EnrichmentTableStatus::Completed,
            3 => EnrichmentTableStatus::Failed,
            _ => EnrichmentTableStatus::Pending, // Default fallback for invalid values
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EnrichmentTableUrlJob {
    pub id: String, // KSUID (27 chars)
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
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        Self {
            id,
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_i16_mapping() {
        // These codes are persisted in the DB; changing them breaks stored jobs.
        let cases = [
            (EnrichmentTableStatus::Pending, 0),
            (EnrichmentTableStatus::Processing, 1),
            (EnrichmentTableStatus::Completed, 2),
            (EnrichmentTableStatus::Failed, 3),
        ];
        for (status, code) in cases {
            assert_eq!(i16::from(&status), code);
            assert_eq!(i16::from(status.clone()), code);
            assert_eq!(EnrichmentTableStatus::from(code), status);
        }
        for invalid in [99, -1] {
            assert_eq!(
                EnrichmentTableStatus::from(invalid),
                EnrichmentTableStatus::Pending
            );
        }
    }

    #[test]
    fn test_multiple_status_transitions() {
        let mut job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            false,
        );

        // Pending -> Processing refreshes updated_at: stale-job recovery keys off it
        job.updated_at = 0;
        job.mark_processing();
        assert_eq!(job.status, EnrichmentTableStatus::Processing);
        assert!(job.updated_at > 0);

        // Processing -> Failed
        job.mark_failed("Error occurred".to_string());
        assert_eq!(job.status, EnrichmentTableStatus::Failed);
        assert_eq!(job.error_message, Some("Error occurred".to_string()));

        // Failed -> Pending (via increment_retry)
        job.increment_retry("Retrying after failure".to_string());
        assert_eq!(job.status, EnrichmentTableStatus::Pending);
        assert_eq!(job.retry_count, 1);
        assert_eq!(
            job.error_message,
            Some("Retrying after failure".to_string())
        );
        job.increment_retry("Second retry".to_string());
        assert_eq!(job.retry_count, 2);

        // Pending -> Processing -> Completed clears the error
        job.mark_processing();
        job.mark_completed();
        assert_eq!(job.status, EnrichmentTableStatus::Completed);
        assert_eq!(job.error_message, None);
    }
}
