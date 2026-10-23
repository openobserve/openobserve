// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct BulkDeleteRequest {
    pub ids: Vec<String>,
}

#[derive(Default, Serialize, ToSchema)]
pub struct BulkDeleteResponse {
    pub successful: Vec<String>,
    pub unsuccessful: Vec<String>,
    pub err: Option<String>,
}

/// Rejects ranges the file_list layer refuses, which would otherwise surface as a search 500.
pub fn validate_time_range(start_time: i64, end_time: i64) -> Result<(), &'static str> {
    if start_time <= 0 {
        return Err("start_time must be a positive Unix timestamp in microseconds");
    }
    if start_time >= end_time {
        return Err("start_time must be before end_time");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_time_range() {
        assert!(validate_time_range(1, 2).is_ok());
        assert!(validate_time_range(0, 2).is_err());
        assert!(validate_time_range(-5, 2).is_err());
        assert!(validate_time_range(2, 2).is_err());
        assert!(validate_time_range(3, 2).is_err());
    }

    #[test]
    fn test_bulk_delete_response_default() {
        let resp = BulkDeleteResponse::default();
        assert!(resp.successful.is_empty());
        assert!(resp.unsuccessful.is_empty());
        assert!(resp.err.is_none());
    }

    #[test]
    fn test_bulk_delete_request_roundtrip() {
        let req = BulkDeleteRequest {
            ids: vec!["id1".to_string(), "id2".to_string()],
        };
        let json = serde_json::to_string(&req).unwrap();
        let deserialized: BulkDeleteRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.ids.len(), 2);
        assert_eq!(deserialized.ids[0], "id1");
    }

    #[test]
    fn test_bulk_delete_response_serializes() {
        let resp = BulkDeleteResponse {
            successful: vec!["ok1".to_string()],
            unsuccessful: vec!["fail1".to_string()],
            err: Some("some error".to_string()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("ok1"));
        assert!(json.contains("fail1"));
        assert!(json.contains("some error"));
    }
}
