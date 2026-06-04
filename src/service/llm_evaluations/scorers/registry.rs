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
use infra::table::{self, scorers::ScorerType};

use crate::common::{
    meta::authz::Authz,
    utils::auth::{remove_ownership, set_ownership},
};

/// Errors that can occur when interacting with scorers.
#[derive(Debug, thiserror::Error)]
pub enum ScorerError {
    #[error("InfraError# Internal error")]
    InfraError(#[from] infra::errors::Error),

    #[error("Scorer name cannot be empty")]
    MissingName,

    #[error("Scorer not found")]
    NotFound,

    #[error("Invalid scorer_type '{0}'. Must be one of: llm_judge, remote")]
    InvalidScorerType(String),

    #[error("scorer_type is immutable and cannot be changed on update")]
    ScorerTypeImmutable,

    #[error("produces_score is immutable and cannot be changed on update")]
    ProducesScoreConfigIdImmutable,

    #[error("Score config version not found")]
    ScoreConfigVersionNotFound,

    #[error("Invalid LLM Judge output schema: {0}")]
    InvalidOutputSchema(String),

    #[error("Invalid scorer test request: {0}")]
    InvalidTestRequest(String),

    #[error("Scorer name already exists")]
    DuplicateName,

    #[error("Scorer cannot be deleted because it is used by one or more eval jobs")]
    InUseByEvalJob,
}

#[tracing::instrument(skip(scorer))]
pub async fn save_scorer(
    org_id: &str,
    mut scorer: table::scorers::Scorer,
) -> Result<table::scorers::Scorer, ScorerError> {
    scorer.name = scorer.name.trim().to_string();
    if scorer.name.is_empty() {
        return Err(ScorerError::MissingName);
    }

    if table::scorers::get_by_active_name(org_id, &scorer.name)
        .await?
        .is_some()
    {
        return Err(ScorerError::DuplicateName);
    }

    scorer.id = ider::generate();
    scorer.entity_id = ider::generate();
    scorer.org_id = org_id.to_string();
    scorer.version = 1;
    scorer.produces_score_config_version = resolve_score_config_version(org_id, &scorer).await?;
    let now = Utc::now().timestamp_millis();
    scorer.created_at = now;
    scorer.updated_at = now;
    scorer.is_active = true;

    table::scorers::add(&scorer).await?;
    set_ownership(org_id, "scorers", Authz::new(&scorer.entity_id)).await;
    publish_scorer_put(&scorer).await;
    Ok(scorer)
}

#[tracing::instrument(skip(scorer))]
pub async fn update_scorer(
    org_id: &str,
    entity_id: &str,
    mut scorer: table::scorers::Scorer,
) -> Result<table::scorers::Scorer, ScorerError> {
    let existing = table::scorers::get_by_entity_id(org_id, entity_id)
        .await?
        .ok_or(ScorerError::NotFound)?;

    // scorer_type is immutable; produced score config can change with a new scorer version.
    if scorer.scorer_type != existing.scorer_type {
        return Err(ScorerError::ScorerTypeImmutable);
    }
    let produces_score_config_id = scorer
        .produces_score_config_id
        .clone()
        .or_else(|| existing.produces_score_config_id.clone());

    let new_name = scorer.name.trim().to_string();
    let new_name = if new_name.is_empty() {
        existing.name.clone()
    } else {
        new_name
    };

    if new_name != existing.name
        && table::scorers::get_by_active_name(org_id, &new_name)
            .await?
            .is_some()
    {
        return Err(ScorerError::DuplicateName);
    }

    let latest_version = table::scorers::get_latest_version(org_id, entity_id).await?;

    scorer.id = ider::generate();
    scorer.entity_id = existing.entity_id;
    scorer.org_id = org_id.to_string();
    scorer.name = new_name;
    scorer.scorer_type = existing.scorer_type;
    scorer.produces_score_config_id = produces_score_config_id;
    scorer.produces_score_config_version = resolve_score_config_version(org_id, &scorer).await?;
    scorer.version = latest_version + 1;
    let now = Utc::now().timestamp_millis();
    scorer.created_at = now;
    scorer.updated_at = now;
    scorer.is_active = true;

    table::scorers::delete(entity_id, org_id).await?;
    table::scorers::add(&scorer).await?;
    publish_scorer_put(&scorer).await;
    Ok(scorer)
}

async fn resolve_score_config_version(
    org_id: &str,
    scorer: &table::scorers::Scorer,
) -> Result<Option<i32>, ScorerError> {
    match scorer.produces_score_config_id.as_deref() {
        Some(entity_id) if !entity_id.is_empty() => {
            if let Some(version) = scorer.produces_score_config_version {
                let score_config =
                    table::score_configs::get_by_entity_id_and_version(org_id, entity_id, version)
                        .await?;
                return match score_config {
                    Some(_) => Ok(Some(version)),
                    None => Err(ScorerError::ScoreConfigVersionNotFound),
                };
            }
            table::score_configs::get_by_entity_id(org_id, entity_id)
                .await?
                .map(|score_config| Some(score_config.version))
                .ok_or(ScorerError::ScoreConfigVersionNotFound)
        }
        _ => Ok(None),
    }
}

#[tracing::instrument()]
pub async fn list_scorers(
    org_id: &str,
    scorer_type: Option<&ScorerType>,
) -> Result<Vec<table::scorers::Scorer>, ScorerError> {
    let scorers = match scorer_type {
        Some(t) => table::scorers::get_by_type(org_id, t).await?,
        None => table::scorers::get_all_by_org(org_id).await?,
    };
    Ok(scorers)
}

#[tracing::instrument()]
pub async fn get_scorer(
    org_id: &str,
    entity_id: &str,
) -> Result<table::scorers::Scorer, ScorerError> {
    table::scorers::get_by_entity_id(org_id, entity_id)
        .await?
        .ok_or(ScorerError::NotFound)
}

#[tracing::instrument()]
pub async fn get_scorer_versions(
    org_id: &str,
    entity_id: &str,
) -> Result<Vec<table::scorers::Scorer>, ScorerError> {
    let versions = table::scorers::get_versions(org_id, entity_id).await?;
    Ok(versions)
}

#[tracing::instrument()]
pub async fn delete_scorer(org_id: &str, entity_id: &str) -> Result<(), ScorerError> {
    table::scorers::get_by_entity_id(org_id, entity_id)
        .await?
        .ok_or(ScorerError::NotFound)?;
    if table::online_eval_jobs::has_non_archived_by_scorer_ref(org_id, entity_id).await? {
        return Err(ScorerError::InUseByEvalJob);
    }
    table::scorers::delete(entity_id, org_id).await?;
    remove_ownership(org_id, "scorers", Authz::new(entity_id)).await;
    publish_scorer_delete(org_id, entity_id).await;
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn publish_scorer_put(scorer: &table::scorers::Scorer) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/scorers/{}/{}", scorer.org_id, scorer.entity_id);
    let message = o2_enterprise::enterprise::super_cluster::queue::EvalScorerMessage::Put {
        scorer: scorer.clone(),
    };
    match config::utils::json::to_vec(&message) {
        Ok(value) => {
            if let Err(e) =
                o2_enterprise::enterprise::super_cluster::queue::eval_scorer_put(&key, value.into())
                    .await
            {
                log::error!("[Scorer] error publishing super cluster scorer put: {e}");
            }
        }
        Err(e) => log::error!("[Scorer] error serializing scorer super cluster message: {e}"),
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_scorer_put(_scorer: &table::scorers::Scorer) {}

#[cfg(feature = "enterprise")]
async fn publish_scorer_delete(org_id: &str, entity_id: &str) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }

    let key = format!("/eval/scorers/{}/{}", org_id, entity_id);
    if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::eval_scorer_delete(&key).await
    {
        log::error!("[Scorer] error publishing super cluster scorer delete: {e}");
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_scorer_delete(_org_id: &str, _entity_id: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scorer_error_variants() {
        let cases = vec![
            ScorerError::MissingName,
            ScorerError::NotFound,
            ScorerError::InvalidScorerType("bad".to_string()),
            ScorerError::ScorerTypeImmutable,
            ScorerError::ProducesScoreConfigIdImmutable,
            ScorerError::InvalidOutputSchema("bad".to_string()),
            ScorerError::InvalidTestRequest("bad".to_string()),
            ScorerError::DuplicateName,
            ScorerError::InUseByEvalJob,
        ];
        for c in cases {
            // each error should produce a non-empty display message
            assert!(!c.to_string().is_empty());
        }
    }

    #[test]
    fn test_scorer_type_parse() {
        assert_eq!("llm_judge".parse::<ScorerType>(), Ok(ScorerType::LlmJudge));
        assert_eq!("remote".parse::<ScorerType>(), Ok(ScorerType::Remote));
        assert!("code".parse::<ScorerType>().is_err());
        assert!("".parse::<ScorerType>().is_err());
    }
}
