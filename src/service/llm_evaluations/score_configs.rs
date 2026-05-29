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

use chrono::Utc;
use config::ider;
use infra::table;

use crate::common::{
    meta::authz::Authz,
    utils::auth::{remove_ownership, set_ownership},
};

/// Errors that can occur when interacting with score configs.
#[derive(Debug, thiserror::Error)]
pub enum ScoreConfigError {
    #[error("InfraError# Internal error")]
    InfraError(#[from] infra::errors::Error),

    #[error("Score config name cannot be empty")]
    MissingName,

    #[error("Score config not found")]
    NotFound,

    #[error("Score config name already exists")]
    DuplicateName,
}

#[tracing::instrument(skip(config))]
pub async fn save_score_config(
    org_id: &str,
    mut config: table::score_configs::ScoreConfig,
) -> Result<table::score_configs::ScoreConfig, ScoreConfigError> {
    config.name = config.name.trim().to_string();
    if config.name.is_empty() {
        return Err(ScoreConfigError::MissingName);
    }

    if table::score_configs::get_by_active_name(org_id, &config.name)
        .await?
        .is_some()
    {
        return Err(ScoreConfigError::DuplicateName);
    }

    config.id = ider::generate();
    config.entity_id = ider::generate();
    config.org_id = org_id.to_string();
    config.version = 1;
    let now = Utc::now().timestamp_millis();
    config.created_at = now;
    config.updated_at = now;

    table::score_configs::add(&config).await?;
    set_ownership(org_id, "score_configs", Authz::new(&config.entity_id)).await;
    publish_score_config_put(&config).await;
    Ok(config)
}

#[tracing::instrument(skip(config))]
pub async fn update_score_config(
    org_id: &str,
    entity_id: &str,
    mut config: table::score_configs::ScoreConfig,
) -> Result<table::score_configs::ScoreConfig, ScoreConfigError> {
    // Get existing latest
    let existing = table::score_configs::get_by_entity_id(org_id, entity_id)
        .await?
        .ok_or(ScoreConfigError::NotFound)?;

    let new_name = config.name.trim().to_string();
    let new_name = if new_name.is_empty() {
        existing.name.clone()
    } else {
        new_name
    };

    if new_name != existing.name
        && table::score_configs::get_by_active_name(org_id, &new_name)
            .await?
            .is_some()
    {
        return Err(ScoreConfigError::DuplicateName);
    }

    let latest_version = table::score_configs::get_latest_version(org_id, entity_id).await?;

    config.id = ider::generate();
    config.entity_id = existing.entity_id;
    config.org_id = org_id.to_string();
    config.version = latest_version + 1;
    let now = Utc::now().timestamp_millis();
    config.created_at = now;
    config.updated_at = now;
    config.is_active = true;

    config.name = new_name;
    // data_type is immutable - preserve from existing
    config.data_type = existing.data_type;

    table::score_configs::delete(entity_id, org_id).await?;
    table::score_configs::add(&config).await?;
    publish_score_config_put(&config).await;
    Ok(config)
}

#[tracing::instrument()]
pub async fn list_score_configs(
    org_id: &str,
) -> Result<Vec<table::score_configs::ScoreConfig>, ScoreConfigError> {
    let configs = table::score_configs::get_all_by_org(org_id).await?;
    Ok(configs)
}

#[tracing::instrument()]
pub async fn get_score_config(
    org_id: &str,
    entity_id: &str,
) -> Result<table::score_configs::ScoreConfig, ScoreConfigError> {
    let config = table::score_configs::get_by_entity_id(org_id, entity_id)
        .await?
        .ok_or(ScoreConfigError::NotFound)?;
    Ok(config)
}

#[tracing::instrument()]
pub async fn get_score_config_versions(
    org_id: &str,
    entity_id: &str,
) -> Result<Vec<table::score_configs::ScoreConfig>, ScoreConfigError> {
    let versions = table::score_configs::get_versions(org_id, entity_id).await?;
    Ok(versions)
}

#[tracing::instrument()]
pub async fn delete_score_config(org_id: &str, entity_id: &str) -> Result<(), ScoreConfigError> {
    table::score_configs::get_by_entity_id(org_id, entity_id)
        .await?
        .ok_or(ScoreConfigError::NotFound)?;
    table::score_configs::delete(entity_id, org_id).await?;
    remove_ownership(org_id, "score_configs", Authz::new(entity_id)).await;
    publish_score_config_delete(org_id, entity_id).await;
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn publish_score_config_put(config: &table::score_configs::ScoreConfig) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/score_configs/{}/{}", config.org_id, config.entity_id);
    let message = o2_enterprise::enterprise::super_cluster::queue::EvalScoreConfigMessage::Put {
        config: config.clone(),
    };
    match config::utils::json::to_vec(&message) {
        Ok(value) => {
            if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::eval_score_config_put(
                &key,
                value.into(),
            )
            .await
            {
                log::error!("[ScoreConfig] error publishing super cluster score config put: {e}");
            }
        }
        Err(e) => {
            log::error!("[ScoreConfig] error serializing score config super cluster message: {e}")
        }
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_score_config_put(_config: &table::score_configs::ScoreConfig) {}

#[cfg(feature = "enterprise")]
async fn publish_score_config_delete(org_id: &str, entity_id: &str) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/score_configs/{}/{}", org_id, entity_id);
    if let Err(e) =
        o2_enterprise::enterprise::super_cluster::queue::eval_score_config_delete(&key).await
    {
        log::error!("[ScoreConfig] error publishing super cluster score config delete: {e}");
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_score_config_delete(_org_id: &str, _entity_id: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_config_error_variants() {
        let infra_error =
            ScoreConfigError::InfraError(infra::errors::Error::Message("test".to_string()));
        assert!(matches!(infra_error, ScoreConfigError::InfraError(_)));

        let missing_name = ScoreConfigError::MissingName;
        assert!(matches!(missing_name, ScoreConfigError::MissingName));

        let not_found = ScoreConfigError::NotFound;
        assert!(matches!(not_found, ScoreConfigError::NotFound));

        let duplicate_name = ScoreConfigError::DuplicateName;
        assert!(matches!(duplicate_name, ScoreConfigError::DuplicateName));
    }
}
