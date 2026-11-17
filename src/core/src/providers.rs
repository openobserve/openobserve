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

use common::meta::authz::Authz;
use config::ider;
use db::authz::{remove_ownership, set_ownership};
use infra::table;

use crate::auth::is_ofga_object_visible;

/// Errors that can occur when interacting with LLM providers.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("InfraError# Internal error")]
    InfraError(#[from] infra::errors::Error),

    #[error("Provider name cannot be empty")]
    MissingName,

    #[error("Provider with this name already exists in this organization")]
    ProviderNameAlreadyExists,

    #[error("Provider not found")]
    NotFound,

    #[error("Invalid provider config: {0}")]
    InvalidConfig(String),

    #[error("Provider is used by active scorers: {0}")]
    ProviderInUse(String),
}

fn scorer_uses_provider(scorer: &table::scorers::Scorer, provider_id: &str) -> bool {
    scorer.params.get("provider_id").and_then(|v| v.as_str()) == Some(provider_id)
}

pub const SAVED_KEY_TARGET_CHANGED_MESSAGE: &str =
    "Enter the API key again for a changed provider type or endpoint";

fn has_api_key(auth_config: &serde_json::Value) -> bool {
    auth_config
        .get("api_key")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
}

fn resolve_updated_auth_config(
    requested: &serde_json::Value,
    existing: &serde_json::Value,
) -> serde_json::Value {
    if has_api_key(requested) {
        requested.clone()
    } else {
        existing.clone()
    }
}

#[cfg(feature = "enterprise")]
fn validate_provider_config(provider: &table::providers::Provider) -> Result<(), ProviderError> {
    o2_enterprise::enterprise::llm_evaluations::providers::PreparedProvider::parse(provider.into())
        .map(|_| ())
        .map_err(|e| ProviderError::InvalidConfig(e.to_string()))
}

/// A blank endpoint stays `None` so a changed default still reaches providers that never set one.
#[cfg(feature = "enterprise")]
fn normalize_provider_endpoint(
    provider: &mut table::providers::Provider,
) -> Result<(), ProviderError> {
    let configured = provider
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(configured) = configured else {
        provider.endpoint = None;
        return Ok(());
    };

    let resolved =
        o2_enterprise::enterprise::llm_evaluations::providers::resolve_endpoint_for_type(
            &provider.provider_type,
            Some(configured),
        )
        .map_err(|e| ProviderError::InvalidConfig(e.to_string()))?;
    provider.endpoint = Some(resolved);
    Ok(())
}

/// The URL a provider calls, with a blank endpoint resolved to the default of its type.
#[cfg(feature = "enterprise")]
fn saved_key_target(provider_type: &str, endpoint: Option<&str>) -> Option<String> {
    let configured = endpoint.map(str::trim).filter(|value| !value.is_empty());
    o2_enterprise::enterprise::llm_evaluations::providers::resolve_endpoint_for_type(
        provider_type,
        configured,
    )
    .ok()
}

#[cfg(not(feature = "enterprise"))]
fn saved_key_target(_provider_type: &str, endpoint: Option<&str>) -> Option<String> {
    Some(endpoint.map(str::trim).unwrap_or_default().to_string())
}

/// Whether `requested` may use `saved`'s key: only for the same provider type and resolved URL.
pub fn may_reuse_saved_key(
    requested: &table::providers::Provider,
    saved: &table::providers::Provider,
) -> bool {
    if !has_api_key(&saved.auth_config) {
        return true;
    }
    let provider_type = saved.provider_type.trim();
    if !requested
        .provider_type
        .trim()
        .eq_ignore_ascii_case(provider_type)
    {
        return false;
    }
    let requested = saved_key_target(provider_type, requested.endpoint.as_deref());
    requested.is_some() && requested == saved_key_target(provider_type, saved.endpoint.as_deref())
}

#[tracing::instrument(skip(provider))]
pub async fn save_provider(
    org_id: &str,
    mut provider: table::providers::Provider,
) -> Result<table::providers::Provider, ProviderError> {
    provider.name = provider.name.trim().to_string();
    if provider.name.is_empty() {
        return Err(ProviderError::MissingName);
    }

    if provider.id.is_empty() {
        provider.id = ider::generate();
    }

    #[cfg(feature = "enterprise")]
    normalize_provider_endpoint(&mut provider)?;
    #[cfg(feature = "enterprise")]
    validate_provider_config(&provider)?;

    // Check name uniqueness within org
    let existing = table::providers::get_all_by_org(org_id).await?;
    if existing.iter().any(|p| p.name == provider.name) {
        return Err(ProviderError::ProviderNameAlreadyExists);
    }

    table::providers::add(&provider).await?;
    set_ownership(org_id, "providers", Authz::new(&provider.id)).await;
    publish_provider_put(&provider).await;
    Ok(provider)
}

#[tracing::instrument(skip(provider))]
pub async fn update_provider(
    org_id: &str,
    provider_id: &str,
    mut provider: table::providers::Provider,
) -> Result<table::providers::Provider, ProviderError> {
    provider.name = provider.name.trim().to_string();
    if provider.name.is_empty() {
        return Err(ProviderError::MissingName);
    }

    let existing = table::providers::get(org_id, provider_id)
        .await?
        .ok_or(ProviderError::NotFound)?;
    if !has_api_key(&provider.auth_config) && !may_reuse_saved_key(&provider, &existing) {
        return Err(ProviderError::InvalidConfig(
            SAVED_KEY_TARGET_CHANGED_MESSAGE.to_string(),
        ));
    }
    provider.auth_config =
        resolve_updated_auth_config(&provider.auth_config, &existing.auth_config);

    // Check name uniqueness excluding self
    let all = table::providers::get_all_by_org(org_id).await?;
    if all
        .iter()
        .any(|p| p.name == provider.name && p.id.trim() != provider_id)
    {
        return Err(ProviderError::ProviderNameAlreadyExists);
    }

    provider.id = provider_id.to_string();
    provider.created_at = existing.created_at;
    #[cfg(feature = "enterprise")]
    normalize_provider_endpoint(&mut provider)?;
    #[cfg(feature = "enterprise")]
    validate_provider_config(&provider)?;
    table::providers::update(&provider).await?;
    publish_provider_put(&provider).await;
    Ok(provider)
}

#[tracing::instrument()]
pub async fn list_providers(
    org_id: &str,
    permitted_objects: Option<Vec<String>>,
) -> Result<Vec<table::providers::Provider>, ProviderError> {
    let providers = table::providers::get_all_by_org(org_id).await?;
    Ok(providers
        .into_iter()
        .filter(|provider| {
            is_ofga_object_visible(
                org_id,
                "provider",
                &provider.id,
                permitted_objects.as_deref(),
            )
        })
        .collect())
}

#[tracing::instrument()]
pub async fn get_provider(
    org_id: &str,
    provider_id: &str,
) -> Result<table::providers::Provider, ProviderError> {
    table::providers::get(org_id, provider_id)
        .await?
        .ok_or(ProviderError::NotFound)
}

#[tracing::instrument()]
pub async fn delete_provider(org_id: &str, provider_id: &str) -> Result<(), ProviderError> {
    table::providers::get(org_id, provider_id)
        .await?
        .ok_or(ProviderError::NotFound)?;

    let dependent_scorers: Vec<_> = table::scorers::get_all_by_org(org_id)
        .await?
        .into_iter()
        .filter(|scorer| scorer_uses_provider(scorer, provider_id))
        .map(|scorer| scorer.name)
        .collect();
    if !dependent_scorers.is_empty() {
        return Err(ProviderError::ProviderInUse(dependent_scorers.join(", ")));
    }

    table::providers::delete(provider_id).await?;
    remove_ownership(org_id, "providers", Authz::new(provider_id)).await;
    publish_provider_delete(provider_id).await;
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn publish_provider_put(provider: &table::providers::Provider) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/providers/{}", provider.id.trim());
    let message = o2_enterprise::enterprise::super_cluster::queue::EvalProviderMessage::Put {
        provider: provider.clone(),
    };
    match config::utils::json::to_vec(&message) {
        Ok(value) => {
            if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::eval_provider_put(
                &key,
                value.into(),
            )
            .await
            {
                log::error!("[Provider] error publishing super cluster provider put: {e}");
            }
        }
        Err(e) => log::error!("[Provider] error serializing provider super cluster message: {e}"),
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_provider_put(_provider: &table::providers::Provider) {}

#[cfg(feature = "enterprise")]
async fn publish_provider_delete(provider_id: &str) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/providers/{}", provider_id.trim());
    if let Err(e) =
        o2_enterprise::enterprise::super_cluster::queue::eval_provider_delete(&key).await
    {
        log::error!("[Provider] error publishing super cluster provider delete: {e}");
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_provider_delete(_provider_id: &str) {}

#[tracing::instrument()]
pub async fn get_default_provider(
    org_id: &str,
) -> Result<table::providers::Provider, ProviderError> {
    let provider = table::providers::get_default(org_id)
        .await?
        .ok_or(ProviderError::NotFound)?;
    Ok(provider)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_error_variants() {
        let infra_error =
            ProviderError::InfraError(infra::errors::Error::Message("test".to_string()));
        assert!(matches!(infra_error, ProviderError::InfraError(_)));

        let missing_name = ProviderError::MissingName;
        assert!(matches!(missing_name, ProviderError::MissingName));

        let name_exists = ProviderError::ProviderNameAlreadyExists;
        assert!(matches!(
            name_exists,
            ProviderError::ProviderNameAlreadyExists
        ));

        let not_found = ProviderError::NotFound;
        assert!(matches!(not_found, ProviderError::NotFound));

        let invalid_config = ProviderError::InvalidConfig("bad endpoint".to_string());
        assert!(matches!(invalid_config, ProviderError::InvalidConfig(_)));

        let provider_in_use = ProviderError::ProviderInUse("judge".to_string());
        assert!(matches!(provider_in_use, ProviderError::ProviderInUse(_)));
    }

    // Rows stored before base URLs were accepted hold the full completions URL already.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_normalize_keeps_a_legacy_full_url_and_completes_a_base_url() {
        let mut provider = table::providers::Provider {
            id: "p1".to_string(),
            org_id: "org".to_string(),
            name: "OpenAI".to_string(),
            provider_type: "openai".to_string(),
            endpoint: Some("https://api.openai.com/v1/chat/completions".to_string()),
            default_model: "gpt-4o".to_string(),
            available_models: vec![],
            auth_config: serde_json::json!({"api_key": "k"}),
            rate_limits: None,
            is_default: false,
            created_at: 0,
            updated_at: 0,
        };
        normalize_provider_endpoint(&mut provider).unwrap();
        normalize_provider_endpoint(&mut provider).unwrap();
        assert_eq!(
            provider.endpoint.as_deref(),
            Some("https://api.openai.com/v1/chat/completions")
        );

        provider.endpoint = Some("https://api.openai.com/v1".to_string());
        normalize_provider_endpoint(&mut provider).unwrap();
        assert_eq!(
            provider.endpoint.as_deref(),
            Some("https://api.openai.com/v1/chat/completions")
        );

        provider.endpoint = Some("   ".to_string());
        normalize_provider_endpoint(&mut provider).unwrap();
        assert!(provider.endpoint.is_none());
    }

    #[test]
    fn test_provider_name_trimming() {
        let name = "  OpenAI  ";
        let trimmed = name.trim().to_string();
        assert_eq!(trimmed, "OpenAI");
    }

    #[test]
    fn test_scorer_uses_provider() {
        let scorer = table::scorers::Scorer {
            id: "scorer-1".to_string(),
            org_id: "org".to_string(),
            entity_id: "scorer-entity-1".to_string(),
            name: "judge".to_string(),
            version: 1,
            scorer_type: table::scorers::ScorerType::LlmJudge,
            description: None,
            produces_score_config_id: None,
            produces_score_config_version: None,
            template: String::new(),
            output_schema: None,
            params: serde_json::json!({"provider_id": "provider-1"}),
            is_active: true,
            created_at: 0,
            updated_at: 0,
        };

        assert!(scorer_uses_provider(&scorer, "provider-1"));
        assert!(!scorer_uses_provider(&scorer, "provider-2"));
    }

    fn provider_with(
        provider_type: &str,
        endpoint: Option<&str>,
        auth_config: serde_json::Value,
    ) -> table::providers::Provider {
        table::providers::Provider {
            provider_type: provider_type.to_string(),
            endpoint: endpoint.map(str::to_string),
            id: String::new(),
            org_id: String::new(),
            name: String::new(),
            default_model: String::new(),
            available_models: vec![],
            auth_config,
            rate_limits: None,
            is_default: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn test_saved_key_is_reused_only_for_the_saved_type_and_endpoint() {
        let provider = |provider_type: &str, endpoint: Option<&str>| {
            provider_with(provider_type, endpoint, serde_json::Value::Null)
        };
        let key = serde_json::json!({"api_key": "sk-saved"});
        let saved = provider_with(
            "openai",
            Some("https://proxy.example/v1/chat/completions"),
            key.clone(),
        );
        assert!(may_reuse_saved_key(&saved.clone(), &saved));
        assert!(may_reuse_saved_key(
            &provider(
                "OpenAI ",
                Some(" https://proxy.example/v1/chat/completions ")
            ),
            &saved
        ));
        assert!(!may_reuse_saved_key(
            &provider(
                "openai",
                Some("https://attacker.example/v1/chat/completions")
            ),
            &saved
        ));
        assert!(!may_reuse_saved_key(&provider("openai", None), &saved));
        assert!(!may_reuse_saved_key(
            &provider(
                "anthropic",
                Some("https://proxy.example/v1/chat/completions")
            ),
            &saved
        ));

        let saved_default = provider_with("openai", None, key);
        assert!(may_reuse_saved_key(
            &provider("openai", Some("  ")),
            &saved_default
        ));
        assert!(!may_reuse_saved_key(
            &provider("openai", Some("https://attacker.example")),
            &saved_default
        ));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_saved_default_endpoint_matches_the_same_url_typed_by_hand() {
        let default_url = "https://api.openai.com/v1/chat/completions";
        let key = serde_json::json!({"api_key": "sk-saved"});
        let saved_default = provider_with("openai", None, key.clone());
        let typed = provider_with("openai", Some(default_url), serde_json::Value::Null);
        assert!(may_reuse_saved_key(&typed, &saved_default));

        let saved_typed = provider_with("openai", Some(default_url), key);
        let blank = provider_with("openai", None, serde_json::Value::Null);
        assert!(may_reuse_saved_key(&blank, &saved_typed));
    }

    #[test]
    fn test_provider_without_a_saved_key_may_change_its_endpoint() {
        for auth_config in [
            serde_json::Value::Null,
            serde_json::json!({}),
            serde_json::json!({"api_key": "  "}),
        ] {
            let saved = provider_with("ollama", Some("http://old.example:11434"), auth_config);
            let edited = provider_with(
                "ollama",
                Some("http://new.example:11434"),
                serde_json::Value::Null,
            );
            assert!(may_reuse_saved_key(&edited, &saved));
        }
    }

    #[test]
    fn test_blank_updated_api_key_preserves_existing_auth_config() {
        let existing = serde_json::json!({"api_key": "sk-existing"});
        let requested = serde_json::json!({"api_key": "  "});

        assert_eq!(resolve_updated_auth_config(&requested, &existing), existing);
    }

    #[test]
    fn test_non_empty_updated_api_key_replaces_existing_auth_config() {
        let existing = serde_json::json!({"api_key": "sk-existing"});
        let requested = serde_json::json!({"api_key": "sk-new"});

        assert_eq!(
            resolve_updated_auth_config(&requested, &existing),
            requested
        );
    }
}
