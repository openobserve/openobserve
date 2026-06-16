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

use config::ider;
use infra::table;

use crate::common::{
    meta::authz::Authz,
    utils::auth::{is_ofga_object_visible, remove_ownership, set_ownership},
};

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

#[cfg(feature = "enterprise")]
fn validate_provider_config(provider: &table::providers::Provider) -> Result<(), ProviderError> {
    o2_enterprise::enterprise::llm_evaluations::provider::PreparedProvider::parse(provider.into())
        .map(|_| ())
        .map_err(|e| ProviderError::InvalidConfig(e.to_string()))
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

    let existing = table::providers::get(provider_id)
        .await?
        .ok_or(ProviderError::NotFound)?;
    if existing.org_id != org_id {
        return Err(ProviderError::NotFound);
    }

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
    let provider = table::providers::get(provider_id)
        .await?
        .ok_or(ProviderError::NotFound)?;
    if provider.org_id != org_id {
        return Err(ProviderError::NotFound);
    }
    Ok(provider)
}

#[tracing::instrument()]
pub async fn delete_provider(org_id: &str, provider_id: &str) -> Result<(), ProviderError> {
    let provider = table::providers::get(provider_id)
        .await?
        .ok_or(ProviderError::NotFound)?;
    if provider.org_id != org_id {
        return Err(ProviderError::NotFound);
    }

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
}
