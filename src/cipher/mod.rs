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

use o2_enterprise::enterprise::cipher::http_repr::HttpKey;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod registry;

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct KeyAddRequest {
    pub name: String,
    #[schema(value_type = Object)]
    pub key: HttpKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyGetResponse {
    pub name: String,
    #[schema(value_type = Object)]
    pub key: HttpKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyInfo {
    pub name: String,
    #[schema(value_type = Object)]
    pub key: HttpKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyListResponse {
    pub keys: Vec<KeyInfo>,
}
#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::cipher::http_repr::{HttpMechanism, HttpStore};
    use serde_json;

    use super::*;

    /// Helper function to create a test HttpKey
    fn create_test_http_key() -> HttpKey {
        HttpKey {
            mechanism: HttpMechanism {
                r#type: "test".to_string(),
                simple_algorithm: None,
            },
            store: HttpStore {
                r#type: "test".to_string(),
                local: None,
                akeyless: None,
            },
        }
    }

    #[test]
    fn test_key_add_request_construction() {
        let name = "test-key".to_string();
        let key = create_test_http_key();

        let request = KeyAddRequest {
            name: name.clone(),
            key: key.clone(),
        };

        assert_eq!(request.name, name);
        assert_eq!(request.key.mechanism.r#type, "test");
        assert_eq!(request.key.store.r#type, "test");
    }

    #[test]
    fn test_key_get_response_serialization_deserialization() {
        let response = KeyGetResponse {
            name: "test-key".to_string(),
            key: create_test_http_key(),
        };

        // Test serialization
        let serialized = serde_json::to_string(&response);
        assert!(serialized.is_ok(), "Serialization should succeed");

        // Test deserialization
        let serialized = serialized.unwrap();
        let deserialized_result: Result<KeyGetResponse, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok_and(|r| r.name == "test-key"),
            "Deserialization should succeed"
        );
    }

    #[test]
    fn test_key_info_serialization_deserialization() {
        let key_info = KeyInfo {
            name: "test-key".to_string(),
            key: create_test_http_key(),
        };

        // Test serialization
        let serialized = serde_json::to_string(&key_info);
        assert!(serialized.is_ok(), "Serialization should succeed");

        // Test deserialization
        let serialized = serialized.unwrap();
        let deserialized_result: Result<KeyInfo, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok_and(|r| r.name == "test-key"),
            "Deserialization should succeed"
        );
    }

    #[test]
    fn test_key_list_response_serialization_deserialization() {
        let key_list = KeyListResponse {
            keys: vec![
                KeyInfo {
                    name: "key1".to_string(),
                    key: create_test_http_key(),
                },
                KeyInfo {
                    name: "key2".to_string(),
                    key: create_test_http_key(),
                },
            ],
        };

        // Test serialization
        let serialized = serde_json::to_string(&key_list);
        assert!(serialized.is_ok(), "Serialization should succeed");

        // Test deserialization
        let serialized = serialized.unwrap();
        let deserialized_result: Result<KeyListResponse, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok(),
            "Deserialization should succeed"
        );

        let deserialized = deserialized_result.unwrap();
        assert_eq!(deserialized.keys.len(), 2);
        assert_eq!(deserialized.keys[0].name, "key1");
        assert_eq!(deserialized.keys[1].name, "key2");
    }

    #[test]
    fn test_key_list_response_empty() {
        let key_list = KeyListResponse { keys: vec![] };

        let serialized = serde_json::to_string(&key_list);
        assert!(serialized.is_ok(), "Serialization should succeed");

        let serialized = serialized.unwrap();
        let deserialized_result: Result<KeyListResponse, _> = serde_json::from_str(&serialized);
        assert!(
            deserialized_result.is_ok_and(|r| r.keys.is_empty()),
            "Deserialization should succeed and return an empty list"
        );
    }

    #[test]
    fn test_key_add_request_deserialization() {
        let json = r#"
        {
            "name": "test-key",
            "key": {
                "mechanism": {"type": "test"},
                "store": {"type": "test"}
            }
        }
        "#;

        let result: Result<KeyAddRequest, _> = serde_json::from_str(json);
        assert!(result.is_ok_and(|r| {
            r.name == "test-key" && r.key.mechanism.r#type == "test" && r.key.store.r#type == "test"
        }));
    }
}
