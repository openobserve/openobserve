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

    pub fn update_progress(&mut self, bytes: u64, records: i64) {
        self.total_bytes_fetched += bytes;
        self.total_records_processed += records;
        self.updated_at = chrono::Utc::now().timestamp_micros();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_to_i16_conversion() {
        assert_eq!(i16::from(EnrichmentTableStatus::Pending), 0);
        assert_eq!(i16::from(EnrichmentTableStatus::Processing), 1);
        assert_eq!(i16::from(EnrichmentTableStatus::Completed), 2);
        assert_eq!(i16::from(EnrichmentTableStatus::Failed), 3);
    }

    #[test]
    fn test_status_from_ref_to_i16_conversion() {
        assert_eq!(i16::from(&EnrichmentTableStatus::Pending), 0);
        assert_eq!(i16::from(&EnrichmentTableStatus::Processing), 1);
        assert_eq!(i16::from(&EnrichmentTableStatus::Completed), 2);
        assert_eq!(i16::from(&EnrichmentTableStatus::Failed), 3);
    }

    #[test]
    fn test_i16_to_status_conversion() {
        assert_eq!(
            EnrichmentTableStatus::from(0),
            EnrichmentTableStatus::Pending
        );
        assert_eq!(
            EnrichmentTableStatus::from(1),
            EnrichmentTableStatus::Processing
        );
        assert_eq!(
            EnrichmentTableStatus::from(2),
            EnrichmentTableStatus::Completed
        );
        assert_eq!(
            EnrichmentTableStatus::from(3),
            EnrichmentTableStatus::Failed
        );
    }

    #[test]
    fn test_i16_to_status_invalid_defaults_to_pending() {
        // Test that invalid status codes default to Pending
        assert_eq!(
            EnrichmentTableStatus::from(99),
            EnrichmentTableStatus::Pending
        );
        assert_eq!(
            EnrichmentTableStatus::from(-1),
            EnrichmentTableStatus::Pending
        );
    }

    #[test]
    fn test_enrichment_table_url_job_new() {
        let job = EnrichmentTableUrlJob::new(
            "test_org".to_string(),
            "test_table".to_string(),
            "https://example.com/data.csv".to_string(),
            false,
        );

        assert_eq!(job.org_id, "test_org");
        assert_eq!(job.table_name, "test_table");
        assert_eq!(job.url, "https://example.com/data.csv");
        assert_eq!(job.status, EnrichmentTableStatus::Pending);
        assert_eq!(job.error_message, None);
        assert_eq!(job.total_bytes_fetched, 0);
        assert_eq!(job.total_records_processed, 0);
        assert_eq!(job.retry_count, 0);
        assert_eq!(job.append_data, false);
        assert_eq!(job.last_byte_position, 0);
        assert_eq!(job.supports_range, false);
    }

    #[test]
    fn test_mark_processing() {
        let mut job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            false,
        );
        let before = job.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(10));
        job.mark_processing();

        assert_eq!(job.status, EnrichmentTableStatus::Processing);
        assert!(job.updated_at > before);
    }

    #[test]
    fn test_mark_completed() {
        let mut job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            false,
        );
        job.error_message = Some("error".to_string());

        job.mark_completed();

        assert_eq!(job.status, EnrichmentTableStatus::Completed);
        assert_eq!(job.error_message, None);
    }

    #[test]
    fn test_mark_failed() {
        let mut job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            false,
        );

        job.mark_failed("Test error".to_string());

        assert_eq!(job.status, EnrichmentTableStatus::Failed);
        assert_eq!(job.error_message, Some("Test error".to_string()));
    }

    #[test]
    fn test_increment_retry() {
        let mut job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            false,
        );
        job.status = EnrichmentTableStatus::Processing;

        job.increment_retry("Retry error".to_string());

        assert_eq!(job.retry_count, 1);
        assert_eq!(job.status, EnrichmentTableStatus::Pending);
        assert_eq!(job.error_message, Some("Retry error".to_string()));

        job.increment_retry("Second retry".to_string());
        assert_eq!(job.retry_count, 2);
    }

    #[test]
    fn test_update_progress() {
        let mut job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            false,
        );

        job.update_progress(1024, 10);
        assert_eq!(job.total_bytes_fetched, 1024);
        assert_eq!(job.total_records_processed, 10);

        job.update_progress(2048, 20);
        assert_eq!(job.total_bytes_fetched, 3072);
        assert_eq!(job.total_records_processed, 30);
    }

    #[test]
    fn test_job_with_append_data_true() {
        let job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            true,
        );
        assert_eq!(job.append_data, true);
    }

    #[test]
    fn test_multiple_status_transitions() {
        let mut job = EnrichmentTableUrlJob::new(
            "org".to_string(),
            "table".to_string(),
            "url".to_string(),
            false,
        );

        // Pending -> Processing
        job.mark_processing();
        assert_eq!(job.status, EnrichmentTableStatus::Processing);

        // Processing -> Failed
        job.mark_failed("Error occurred".to_string());
        assert_eq!(job.status, EnrichmentTableStatus::Failed);
        assert_eq!(job.error_message, Some("Error occurred".to_string()));

        // Failed -> Pending (via increment_retry)
        job.increment_retry("Retrying after failure".to_string());
        assert_eq!(job.status, EnrichmentTableStatus::Pending);
        assert_eq!(job.retry_count, 1);

        // Pending -> Processing -> Completed
        job.mark_processing();
        job.mark_completed();
        assert_eq!(job.status, EnrichmentTableStatus::Completed);
        assert_eq!(job.error_message, None);
    }

    #[test]
    fn test_bidirectional_status_conversion() {
        // Test round-trip conversion
        let statuses = vec![
            EnrichmentTableStatus::Pending,
            EnrichmentTableStatus::Processing,
            EnrichmentTableStatus::Completed,
            EnrichmentTableStatus::Failed,
        ];

        for status in statuses {
            let as_i16: i16 = status.clone().into();
            let back_to_status: EnrichmentTableStatus = as_i16.into();
            assert_eq!(status, back_to_status);
        }
    }
}
