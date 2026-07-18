// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Organization ingestion-token service API.

use common::meta::organization::OrgIngestionToken;
use config::ider;
use infra::table::org_ingestion_tokens::{self as token_table, OrgIngestionTokenRecord};

use crate::org_ingestion_tokens as store;

/// Create the default ingestion token for a newly created organization.
pub async fn create_default_token(org_id: &str, created_by: &str) -> Result<(), anyhow::Error> {
    let token = token_table::generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    store::add(&OrgIngestionTokenRecord {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        name: "default".to_string(),
        token,
        description: "Default org ingestion token".to_string(),
        is_default: true,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
        updated_at: now,
    })
    .await
}

/// List tokens, creating the system default when the organization has none.
pub async fn list_tokens(org_id: &str) -> Result<Vec<OrgIngestionToken>, anyhow::Error> {
    let mut records = store::list_by_org(org_id).await?;
    if records.is_empty() {
        create_default_token(org_id, "system").await?;
        records = store::list_by_org(org_id).await?;
    }
    Ok(records
        .into_iter()
        .map(|record| OrgIngestionToken {
            name: record.name,
            token: record.token,
            description: record.description,
            is_default: record.is_default,
            enabled: record.enabled,
            created_by: record.created_by,
            created_at: record.created_at,
        })
        .collect())
}

/// Create a named ingestion token. The complete token is returned only here.
pub async fn create_token(
    org_id: &str,
    name: &str,
    description: &str,
    created_by: &str,
) -> Result<OrgIngestionToken, anyhow::Error> {
    let name = name.trim();
    validate_name(name)?;
    if let Some(existing) = store::get_by_name(org_id, name).await? {
        return Err(anyhow::anyhow!(
            "Token with name '{}' already exists in this org",
            existing.name
        ));
    }

    let token = token_table::generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    store::add(&OrgIngestionTokenRecord {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        name: name.to_string(),
        token: token.clone(),
        description: description.to_string(),
        is_default: false,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
        updated_at: now,
    })
    .await?;

    Ok(OrgIngestionToken {
        name: name.to_string(),
        token,
        description: description.to_string(),
        is_default: false,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
    })
}

fn validate_name(name: &str) -> Result<(), anyhow::Error> {
    if name.is_empty() {
        return Err(anyhow::anyhow!("Token name cannot be empty"));
    }
    if name.len() > 256 {
        return Err(anyhow::anyhow!(
            "Token name must be 256 characters or fewer"
        ));
    }
    if !name
        .chars()
        .all(|character| character.is_alphanumeric() || character == '-' || character == '_')
    {
        return Err(anyhow::anyhow!(
            "Token name can only contain alphanumeric characters, hyphens, and underscores"
        ));
    }
    Ok(())
}

/// Rotate a token and return its new complete value.
pub async fn rotate_token(org_id: &str, name: &str) -> Result<OrgIngestionToken, anyhow::Error> {
    let existing = store::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{name}' not found"))?;
    let token = store::rotate_token(org_id, name).await?;

    Ok(OrgIngestionToken {
        name: existing.name,
        token,
        description: existing.description,
        is_default: existing.is_default,
        enabled: existing.enabled,
        created_by: existing.created_by,
        created_at: existing.created_at,
    })
}

pub async fn set_enabled_token(
    org_id: &str,
    name: &str,
    enabled: bool,
) -> Result<(), anyhow::Error> {
    store::set_enabled(org_id, name, enabled).await
}

pub async fn validate_token(
    org_id: &str,
    token: &str,
) -> Result<Option<OrgIngestionTokenRecord>, anyhow::Error> {
    if !token.starts_with(token_table::ORG_INGESTION_TOKEN_PREFIX) {
        return Ok(None);
    }
    store::find_enabled_token(org_id, token).await
}

#[cfg(test)]
mod tests {
    use super::validate_name;

    #[test]
    fn token_name_validation_accepts_supported_characters() {
        assert!(validate_name("prod-pipeline_01").is_ok());
    }

    #[test]
    fn token_name_validation_rejects_empty_and_punctuation() {
        assert!(validate_name("").is_err());
        assert!(validate_name("bad token!").is_err());
    }
}
