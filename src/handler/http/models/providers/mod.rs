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
use utoipa::ToSchema;

/// HTTP request body for creating/updating a Provider.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRequestBody {
    pub name: String,
    #[serde(alias = "provider_type")]
    pub provider_type: String,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(alias = "default_model")]
    pub default_model: String,
    #[serde(default)]
    #[serde(alias = "available_models")]
    pub available_models: Vec<String>,
    #[serde(alias = "auth_config")]
    pub auth_config: serde_json::Value,
    #[serde(default)]
    #[serde(alias = "is_default")]
    pub is_default: bool,
}

/// HTTP response body for a Provider (auth_config masked).
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderResponseBody {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub provider_type: String,
    pub endpoint: Option<String>,
    pub default_model: String,
    pub available_models: Vec<String>,
    /// API key / auth config is masked in responses.
    pub auth_config_masked: bool,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// HTTP response body for listing Providers.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListProvidersResponseBody {
    pub list: Vec<ProviderResponseBody>,
}

impl From<ProviderRequestBody> for infra::table::providers::Provider {
    fn from(value: ProviderRequestBody) -> Self {
        Self {
            id: String::new(),
            org_id: String::new(),
            name: value.name,
            provider_type: value.provider_type,
            endpoint: value.endpoint,
            default_model: value.default_model,
            available_models: value.available_models,
            auth_config: value.auth_config,
            is_default: value.is_default,
            created_at: 0,
            updated_at: 0,
        }
    }
}

impl From<infra::table::providers::Provider> for ProviderResponseBody {
    fn from(value: infra::table::providers::Provider) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            name: value.name,
            provider_type: value.provider_type,
            endpoint: value.endpoint,
            default_model: value.default_model,
            available_models: value.available_models,
            auth_config_masked: true,
            is_default: value.is_default,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<Vec<infra::table::providers::Provider>> for ListProvidersResponseBody {
    fn from(value: Vec<infra::table::providers::Provider>) -> Self {
        Self {
            list: value.into_iter().map(ProviderResponseBody::from).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_response_masks_auth() {
        let provider = infra::table::providers::Provider {
            id: "abc".to_string(),
            org_id: "org1".to_string(),
            name: "OpenAI".to_string(),
            provider_type: "openai".to_string(),
            endpoint: None,
            default_model: "gpt-4".to_string(),
            available_models: vec!["gpt-4".to_string()],
            auth_config: serde_json::json!({"api_key": "secret"}),
            is_default: false,
            created_at: 1000,
            updated_at: 2000,
        };
        let resp = ProviderResponseBody::from(provider);
        assert!(resp.auth_config_masked);
        assert_eq!(resp.name, "OpenAI");
    }

    #[test]
    fn test_provider_request_body_defaults() {
        let body = ProviderRequestBody {
            name: "Test".to_string(),
            provider_type: "openai".to_string(),
            endpoint: None,
            default_model: "gpt-4".to_string(),
            available_models: vec![],
            auth_config: serde_json::json!({"api_key": "k"}),
            is_default: false,
        };
        let provider = infra::table::providers::Provider::from(body);
        assert!(provider.id.is_empty());
        assert_eq!(provider.name, "Test");
    }

    #[test]
    fn test_provider_request_body_accepts_snake_case_json() {
        let body: ProviderRequestBody = serde_json::from_value(serde_json::json!({
            "name": "Test",
            "provider_type": "openai",
            "default_model": "gpt-4o",
            "available_models": ["gpt-4o", "gpt-4o-mini"],
            "auth_config": {"api_key": "k"},
            "is_default": true
        }))
        .unwrap();

        assert_eq!(body.provider_type, "openai");
        assert_eq!(body.default_model, "gpt-4o");
        assert_eq!(body.available_models, vec!["gpt-4o", "gpt-4o-mini"]);
        assert_eq!(body.auth_config, serde_json::json!({"api_key": "k"}));
        assert!(body.is_default);
    }
}
