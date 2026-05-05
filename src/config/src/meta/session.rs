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

/// Request to assume a service account in a target organization
///
/// This allows meta service accounts to obtain temporary session tokens
/// for accessing a target organization as a specific service account.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct AssumeServiceAccountRequest {
    /// Target organization ID
    pub org_id: String,
    /// Service account email to assume (optional, defaults to caller's user_id)
    #[serde(default)]
    pub service_account: Option<String>,
    /// Optional duration in seconds (default: 3600, max: 86400)
    #[serde(default)]
    pub duration_seconds: Option<u64>,
}

/// Response from assume service account operation
///
/// Contains the session credentials needed to access the target organization.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AssumeServiceAccountResponse {
    /// Session ID to use for authentication
    pub session_id: String,
    /// Target organization ID
    pub org_id: String,
    /// Assumed service account role
    pub role_name: String,
    /// Expiration timestamp (ISO 8601)
    pub expires_at: String,
    /// Duration in seconds until expiration
    pub expires_in: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_assume_request_defaults_optional_fields() {
        let json = r#"{"org_id":"default"}"#;
        let req: AssumeServiceAccountRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.org_id, "default");
        assert!(req.service_account.is_none());
        assert!(req.duration_seconds.is_none());
    }

    #[test]
    fn test_assume_request_all_fields() {
        let json =
            r#"{"org_id":"myorg","service_account":"svc@example.com","duration_seconds":3600}"#;
        let req: AssumeServiceAccountRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.org_id, "myorg");
        assert_eq!(req.service_account, Some("svc@example.com".to_string()));
        assert_eq!(req.duration_seconds, Some(3600));
    }

    #[test]
    fn test_assume_request_serialize_roundtrip() {
        let req = AssumeServiceAccountRequest {
            org_id: "org1".to_string(),
            service_account: Some("bot@example.com".to_string()),
            duration_seconds: Some(7200),
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: AssumeServiceAccountRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.org_id, req.org_id);
        assert_eq!(back.service_account, req.service_account);
        assert_eq!(back.duration_seconds, req.duration_seconds);
    }

    #[test]
    fn test_assume_response_serialize() {
        let resp = AssumeServiceAccountResponse {
            session_id: "sess-abc".to_string(),
            org_id: "org1".to_string(),
            role_name: "admin".to_string(),
            expires_at: "2026-01-01T00:00:00Z".to_string(),
            expires_in: 3600,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"session_id\":\"sess-abc\""));
        assert!(json.contains("\"org_id\":\"org1\""));
        assert!(json.contains("\"expires_in\":3600"));
    }
}
