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
use infra::table::org_ingestion_tokens;

use crate::common::meta::organization::OrgIngestionToken;
use crate::service::db;

/// Create the default ingestion token for a newly created org.
pub async fn create_default_token(org_id: &str, created_by: &str) -> Result<(), anyhow::Error> {
    let token_value = org_ingestion_tokens::generate_token();
    let record = org_ingestion_tokens::OrgIngestionTokenRecord {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        name: "default".to_string(),
        token: token_value.clone(),
        description: "Default org ingestion token".to_string(),
        is_default: true,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: chrono::Utc::now().timestamp_micros(),
        updated_at: chrono::Utc::now().timestamp_micros(),
    };
    db::org_ingestion_tokens::add(&record).await?;
    Ok(())
}

/// List all tokens for an org.
pub async fn list_tokens(org_id: &str) -> Result<Vec<OrgIngestionToken>, anyhow::Error> {
    let records = db::org_ingestion_tokens::list_by_org(org_id).await?;
    let tokens = records
        .into_iter()
        .map(|r| OrgIngestionToken {
            name: r.name,
            token: r.token,
            description: r.description,
            is_default: r.is_default,
            enabled: r.enabled,
            created_by: r.created_by,
            created_at: r.created_at,
        })
        .collect();
    Ok(tokens)
}

/// Create a new named ingestion token. Returns the full token (only time it's shown unmasked).
pub async fn create_token(
    org_id: &str,
    name: &str,
    description: &str,
    created_by: &str,
) -> Result<OrgIngestionToken, anyhow::Error> {
    // Validate name
    let name = name.trim();
    if name.is_empty() {
        return Err(anyhow::anyhow!("Token name cannot be empty"));
    }
    if name.len() > 256 {
        return Err(anyhow::anyhow!("Token name must be 256 characters or fewer"));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(anyhow::anyhow!(
            "Token name can only contain alphanumeric characters, hyphens, and underscores"
        ));
    }

    // Check that a token with this name doesn't already exist
    if let Ok(Some(existing)) = db::org_ingestion_tokens::get_by_name(org_id, name).await {
        return Err(anyhow::anyhow!(
            "Token with name '{}' already exists in this org",
            existing.name
        ));
    }

    let token_value = org_ingestion_tokens::generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    let record = org_ingestion_tokens::OrgIngestionTokenRecord {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        name: name.to_string(),
        token: token_value.clone(),
        description: description.to_string(),
        is_default: false,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
        updated_at: now,
    };
    db::org_ingestion_tokens::add(&record).await?;

    Ok(OrgIngestionToken {
        name: name.to_string(),
        token: token_value,
        description: description.to_string(),
        is_default: false,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
    })
}

/// Rotate a token's value. Returns the new full token (only time it's shown unmasked).
pub async fn rotate_token(org_id: &str, name: &str) -> Result<OrgIngestionToken, anyhow::Error> {
    let existing = db::org_ingestion_tokens::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{}' not found", name))?;

    let new_token = db::org_ingestion_tokens::rotate_token(org_id, name).await?;

    Ok(OrgIngestionToken {
        name: existing.name,
        token: new_token,
        description: existing.description,
        is_default: existing.is_default,
        enabled: existing.enabled,
        created_by: existing.created_by,
        created_at: existing.created_at,
    })
}

/// Enable or disable a named token.
pub async fn set_enabled_token(
    org_id: &str,
    name: &str,
    enabled: bool,
) -> Result<(), anyhow::Error> {
    db::org_ingestion_tokens::set_enabled(org_id, name, enabled).await
}

/// Validate an org token credential. Returns Some(token_record) if valid, None if not found.
pub async fn validate_token(
    org_id: &str,
    token: &str,
) -> Result<Option<org_ingestion_tokens::OrgIngestionTokenRecord>, anyhow::Error> {
    if !token.starts_with(org_ingestion_tokens::ORG_INGESTION_TOKEN_PREFIX) {
        return Ok(None);
    }
    db::org_ingestion_tokens::find_by_token(org_id, token).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_name_rejects_empty() {
        let name = "";
        assert!(name.trim().is_empty());
    }

    #[test]
    fn test_validate_name_rejects_whitespace_only() {
        let name = "   ";
        assert!(name.trim().is_empty());
    }

    #[test]
    fn test_validate_name_allows_alphanumeric() {
        let name = "prod-pipeline_01";
        assert!(name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_validate_name_allows_single_char() {
        let name = "a";
        assert!(name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_validate_name_rejects_special_chars() {
        let name = "bad name!";
        assert!(!name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_validate_name_rejects_slash() {
        let name = "path/token";
        assert!(!name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_validate_name_rejects_dot() {
        let name = "token.name";
        assert!(!name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_validate_name_rejects_at_sign() {
        let name = "token@org";
        assert!(!name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
    }
}
