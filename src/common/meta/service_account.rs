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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Eq, PartialEq, Default)]
pub struct ServiceAccountRequest {
    pub email: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct APIToken {
    pub token: String,
    pub user: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Eq, PartialEq, Default)]
pub struct UpdateServiceAccountRequest {
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_account_request() {
        let request = ServiceAccountRequest {
            email: "test@example.com".to_string(),
            first_name: "Test".to_string(),
            last_name: "User".to_string(),
        };

        assert_eq!(request.email, "test@example.com");
        assert_eq!(request.first_name, "Test");
        assert_eq!(request.last_name, "User");
    }

    #[test]
    fn test_api_token() {
        let token = APIToken {
            token: "test-token".to_string(),
            user: "test-user".to_string(),
        };

        assert_eq!(token.token, "test-token");
        assert_eq!(token.user, "test-user");
    }

    #[test]
    fn test_api_token_serialization() {
        let token = APIToken {
            token: "test-token".to_string(),
            user: "test-user".to_string(),
        };

        let serialized = serde_json::to_string(&token).unwrap();
        let deserialized: APIToken = serde_json::from_str(&serialized).unwrap();

        assert_eq!(token.token, deserialized.token);
        assert_eq!(token.user, deserialized.user);
    }

    #[test]
    fn test_update_service_account_request() {
        let request = UpdateServiceAccountRequest {
            first_name: "Updated".to_string(),
            last_name: "Name".to_string(),
        };

        assert_eq!(request.first_name, "Updated");
        assert_eq!(request.last_name, "Name");
    }

    #[test]
    fn test_update_service_account_request_default() {
        let request = UpdateServiceAccountRequest::default();
        assert_eq!(request.first_name, "");
        assert_eq!(request.last_name, "");
    }
}
