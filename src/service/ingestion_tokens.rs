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

use crate::common::{infra::config::ORG_INGESTION_TOKENS, meta::organization::OrgIngestionToken};
use crate::service::db::org_ingestion_tokens::cache_key;

const MASKED_SUFFIX_LEN: usize = 4;

/// Mask a token for display: shows prefix + last 4 chars, middle replaced with ****.
fn mask_token(token: &str) -> String {
    if token.len() <= 8 {
        return "****".to_string();
    }
    let prefix = &token[..5]; // "o2oi_"
    let suffix = &token[token.len() - MASKED_SUFFIX_LEN..];
    format!("{}****{}", prefix, suffix)
}

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
    org_ingestion_tokens::add(&record).await?;

    // Populate cache
    ORG_INGESTION_TOKENS.insert(cache_key(org_id, &token_value), "default".to_string());

    Ok(())
}

/// List all tokens for an org.
pub async fn list_tokens(org_id: &str) -> Result<Vec<OrgIngestionToken>, anyhow::Error> {
    let records = org_ingestion_tokens::list_by_org(org_id).await?;
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
    if let Some(existing) = org_ingestion_tokens::get_by_name(org_id, name).await? {
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
    org_ingestion_tokens::add(&record).await?;

    // Populate cache
    ORG_INGESTION_TOKENS.insert(cache_key(org_id, &token_value), name.to_string());

    Ok(OrgIngestionToken {
        name: name.to_string(),
        token: token_value, // full token, unmasked
        description: description.to_string(),
        is_default: false,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
    })
}

/// Rotate a token's value. Returns the new full token (only time it's shown unmasked).
pub async fn rotate_token(org_id: &str, name: &str) -> Result<OrgIngestionToken, anyhow::Error> {
    let existing = org_ingestion_tokens::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{}' not found", name))?;

    // Remove old token from cache
    ORG_INGESTION_TOKENS.remove(&cache_key(org_id, &existing.token));

    let new_token = org_ingestion_tokens::rotate_token(org_id, name).await?;

    // Insert new token into cache
    ORG_INGESTION_TOKENS.insert(cache_key(org_id, &new_token), existing.name.clone());

    Ok(OrgIngestionToken {
        name: existing.name,
        token: new_token, // full token, unmasked
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
    let existing = org_ingestion_tokens::get_by_name(org_id, name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Token '{}' not found", name))?;

    org_ingestion_tokens::set_enabled(org_id, name, enabled).await?;

    if enabled {
        // Insert into cache
        ORG_INGESTION_TOKENS.insert(cache_key(org_id, &existing.token), existing.name);
    } else {
        // Remove from cache (disabled tokens should not authenticate)
        ORG_INGESTION_TOKENS.remove(&cache_key(org_id, &existing.token));
    }

    Ok(())
}

/// Validate an org token credential. Returns Some(token_record) if valid, None if not found.
pub async fn validate_token(
    org_id: &str,
    token: &str,
) -> Result<Option<org_ingestion_tokens::OrgIngestionTokenRecord>, anyhow::Error> {
    if !token.starts_with(org_ingestion_tokens::ORG_INGESTION_TOKEN_PREFIX) {
        return Ok(None);
    }
    org_ingestion_tokens::find_by_token(org_id, token)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// Mask a token value for display. Useful outside of list_tokens.
pub fn mask_token_value(token: &str) -> String {
    mask_token(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_token() {
        let token = "o2oi_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
        let masked = mask_token(token);
        assert_eq!(masked, "o2oi_****c5d6");
    }

    #[test]
    fn test_mask_token_exactly_8_chars() {
        // 8 chars → len <= 8 → returns "****"
        let masked = mask_token("o2oi_abc");
        assert_eq!(masked, "****");
    }

    #[test]
    fn test_mask_token_9_chars() {
        // 9 chars → len > 8 → "o2oi_" prefix + "****" + last 4
        let masked = mask_token("o2oi_abcd");
        assert_eq!(masked, "o2oi_****abcd");
    }

    #[test]
    fn test_mask_token_empty() {
        let masked = mask_token("");
        assert_eq!(masked, "****");
    }

    #[test]
    fn test_mask_token_value_public() {
        // mask_token_value delegates to mask_token
        let masked = mask_token_value("o2oi_test12345678");
        assert_eq!(masked, "o2oi_****5678");
    }

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
