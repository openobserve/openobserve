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

//! Organization-level alert configuration storage
//!
//! This module provides functions to store and retrieve org-level alert configs
//! using the existing key-value DB interface.

use config::meta::alerts::{correlation::CorrelationConfig, deduplication::DeduplicationConfig};
use infra::db;

const MODULE: &str = "alert_config";
const CORRELATION_KEY: &str = "correlation";
const DEDUPLICATION_KEY: &str = "deduplication";

/// Get correlation config for an organization
pub async fn get_correlation_config(
    org_id: &str,
) -> Result<Option<CorrelationConfig>, anyhow::Error> {
    let key = db::build_key(MODULE, org_id, CORRELATION_KEY, 0);
    let db = db::get_db().await;

    match db.get(&key).await {
        Ok(bytes) => {
            let config: CorrelationConfig = serde_json::from_slice(&bytes)?;
            Ok(Some(config))
        }
        Err(infra::errors::Error::DbError(infra::errors::DbError::KeyNotExists(_))) => Ok(None),
        Err(e) => Err(anyhow::anyhow!("Failed to get correlation config: {}", e)),
    }
}

/// Set correlation config for an organization
pub async fn set_correlation_config(
    org_id: &str,
    config: &CorrelationConfig,
) -> Result<(), anyhow::Error> {
    // Validate the config before storing
    config.validate().map_err(|e| anyhow::anyhow!("{}", e))?;

    let key = db::build_key(MODULE, org_id, CORRELATION_KEY, 0);
    let value = serde_json::to_vec(config)?;
    let db = db::get_db().await;

    db.put(&key, value.into(), db::NO_NEED_WATCH, None)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to set correlation config: {}", e))?;

    Ok(())
}

/// Delete correlation config for an organization
pub async fn delete_correlation_config(org_id: &str) -> Result<(), anyhow::Error> {
    let key = db::build_key(MODULE, org_id, CORRELATION_KEY, 0);
    let db = db::get_db().await;

    db.delete_if_exists(&key, false, db::NO_NEED_WATCH)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to delete correlation config: {}", e))?;

    Ok(())
}

/// Get deduplication config for an organization
pub async fn get_deduplication_config(
    org_id: &str,
) -> Result<Option<DeduplicationConfig>, anyhow::Error> {
    let key = db::build_key(MODULE, org_id, DEDUPLICATION_KEY, 0);
    let db = db::get_db().await;

    match db.get(&key).await {
        Ok(bytes) => {
            let config: DeduplicationConfig = serde_json::from_slice(&bytes)?;
            Ok(Some(config))
        }
        Err(infra::errors::Error::DbError(infra::errors::DbError::KeyNotExists(_))) => Ok(None),
        Err(e) => Err(anyhow::anyhow!("Failed to get deduplication config: {}", e)),
    }
}

/// Set deduplication config for an organization
pub async fn set_deduplication_config(
    org_id: &str,
    config: &DeduplicationConfig,
) -> Result<(), anyhow::Error> {
    let key = db::build_key(MODULE, org_id, DEDUPLICATION_KEY, 0);
    let value = serde_json::to_vec(config)?;
    let db = db::get_db().await;

    db.put(&key, value.into(), db::NO_NEED_WATCH, None)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to set deduplication config: {}", e))?;

    Ok(())
}

/// Delete deduplication config for an organization
pub async fn delete_deduplication_config(org_id: &str) -> Result<(), anyhow::Error> {
    let key = db::build_key(MODULE, org_id, DEDUPLICATION_KEY, 0);
    let db = db::get_db().await;

    db.delete_if_exists(&key, false, db::NO_NEED_WATCH)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to delete deduplication config: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_key() {
        let key = db::build_key(MODULE, "org123", CORRELATION_KEY, 0);
        assert_eq!(key, "/alert_config/org123/correlation");
    }
}
