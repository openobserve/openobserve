// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Super-cluster queue processor for semantic groups synchronization.
//!
//! Synchronizes organization-level alert deduplication configuration including:
//! - Semantic field groups (field name equivalences)
//! - Alert fingerprinting rules
//! - FQN priority dimensions
//!
//! Changes propagate to all regions for consistent deduplication behavior.

use infra::{db, errors::Result};
use o2_enterprise::enterprise::super_cluster::queue::{Message, SemanticGroupsMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg = msg.try_into().map_err(|e| {
        infra::errors::Error::Message(format!("[SEMANTIC_GROUPS] Failed to deserialize: {}", e))
    })?;
    process_msg(msg).await
}

pub(crate) async fn process_msg(msg: SemanticGroupsMessage) -> Result<()> {
    match msg {
        SemanticGroupsMessage::Put { org_id, config } => {
            log::debug!(
                "[SUPER_CLUSTER:semantic_groups] Put config for org={}",
                org_id
            );
            let key = db::build_key("alert_config", &org_id, "deduplication", 0);
            let value = config::utils::json::to_vec(&config)?;
            let db = db::get_db().await;
            db.put(&key, value.into(), db::NO_NEED_WATCH, None).await?;
        }
        SemanticGroupsMessage::Delete { org_id } => {
            log::debug!(
                "[SUPER_CLUSTER:semantic_groups] Delete config for org={}",
                org_id
            );
            let key = db::build_key("alert_config", &org_id, "deduplication", 0);
            let db = db::get_db().await;
            db.delete_if_exists(&key, false, db::NO_NEED_WATCH).await?;
        }
    }
    Ok(())
}
