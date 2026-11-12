// Copyright 2026 OpenObserve Inc.
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

use bytes::Bytes;
use common::infra::config::KVS;
use config::meta::autoobserve::DISMISSAL_PREFIX;
use infra::{
    db::{delete_from_db_coordinator, put_into_db_coordinator},
    errors::{Error, Result},
};
use o2_enterprise::enterprise::{
    alert_calibration_service::dismissals,
    super_cluster::queue::{Message, MessageType},
};

/// Process KV messages from super cluster queue
///
/// This handler processes KV put/delete messages from the super cluster.
/// Unlike other handlers that write to the meta table, this handler:
/// 1. Writes to the dedicated kv_store table
/// 2. Publishes coordinator event for within-cluster synchronization
/// 3. Updates the local KVS cache
///
/// Key format: /kv/{org_id}/{key}
pub(crate) async fn process(msg: Message) -> Result<()> {
    // Parse the key to extract org_id and kv_key
    // Expected format: /kv/{org_id}/{key}
    let key = msg.key.strip_prefix("/kv/").ok_or_else(|| {
        Error::Message(format!(
            "Invalid KV key format, expected /kv/{{org_id}}/{{key}}: {}",
            msg.key
        ))
    })?;

    let parts: Vec<&str> = key.splitn(2, '/').collect();
    if parts.len() != 2 {
        return Err(Error::Message(format!(
            "Invalid KV key format, expected org_id/key: {}",
            key
        )));
    }

    let org_id = parts[0];
    let kv_key = parts[1];

    match msg.message_type {
        MessageType::Put => {
            let value = msg.value.ok_or_else(|| {
                Error::Message(format!("KV put message missing value for key: {}", msg.key))
            })?;

            // A writer can publish after losing its lease, so a dismissal applies only if newer.
            if kv_key.starts_with(DISMISSAL_PREFIX) {
                let applied = dismissals::apply_replica(org_id, kv_key, &value)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
                if !applied {
                    log::debug!(
                        "[SUPER_CLUSTER:KV] Kept the newer stored dismissal {org_id}/{kv_key}"
                    );
                    return Ok(());
                }
            } else {
                infra::table::kv_store::set(org_id, kv_key, &value).await?;
            }

            // Publish coordinator event for within-cluster synchronization
            // This ensures other nodes in the same cluster get notified
            // put_into_db_coordinator handles local vs cluster mode correctly
            if let Err(e) = put_into_db_coordinator(&msg.key, Bytes::new(), true, None).await {
                log::error!(
                    "[SUPER_CLUSTER:KV] Failed to sync to coordinator: {} - {e}",
                    msg.key
                );
            }

            // Update local cache
            let cache_key = format!("{}/{}", org_id, kv_key);
            db::kv::cache(cache_key, kv_key, value);

            log::debug!(
                "[SUPER_CLUSTER:KV] Put key: {}/{} to kv_store table and coordinator",
                org_id,
                kv_key
            );
        }
        MessageType::Delete(_with_prefix) => {
            // Delete from kv_store table (primary storage)
            infra::table::kv_store::delete(org_id, kv_key).await?;

            // Publish coordinator delete event for within-cluster synchronization
            if let Err(e) = delete_from_db_coordinator(&msg.key, false, true, None).await {
                log::error!(
                    "[SUPER_CLUSTER:KV] Failed to delete from coordinator: {} - {e}",
                    msg.key
                );
            }

            // Remove from local cache
            let cache_key = format!("{}/{}", org_id, kv_key);
            KVS.remove(&cache_key);

            log::debug!(
                "[SUPER_CLUSTER:KV] Delete key: {}/{} from kv_store table and coordinator",
                org_id,
                kv_key
            );
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:KV] Invalid message type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type for KV".to_string()));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::autoobserve::dismissal_key;

    use super::*;

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    fn put(org: &str, key: &str, value: String) -> Message {
        let key = format!("/kv/{org}/{key}");
        Message::new(key, Some(Bytes::from(value)), None, true, MessageType::Put)
    }

    fn dismissal(revision: u64) -> String {
        serde_json::json!({
            "version": 1, "id": "f1", "rule_id": "noise", "pattern": null,
            "scope_kind": "alert", "scope_key": "a1", "state": "active", "revision": revision,
            "reason": "expected", "note": null, "actor": "u-ops", "dismissed_at": 1,
            "duration_days": null, "expires_at": null, "reopened_at": null,
            "reopened_by": null, "updated_at": 1
        })
        .to_string()
    }

    async fn stored(org: &str, key: &str) -> String {
        let row = infra::table::kv_store::get(org, key)
            .await
            .unwrap()
            .unwrap();
        String::from_utf8(row.value).unwrap()
    }

    #[tokio::test]
    async fn a_late_dismissal_publish_cannot_roll_back_a_newer_revision() {
        if !meta_store().await {
            return;
        }
        let org = format!("t_sc_kv_{}", config::utils::time::now_micros());
        let key = dismissal_key("a1", "f1");
        process(put(&org, &key, dismissal(3))).await.unwrap();
        process(put(&org, &key, dismissal(2))).await.unwrap();
        assert_eq!(stored(&org, &key).await, dismissal(3));
        process(put(&org, &key, dismissal(4))).await.unwrap();
        assert_eq!(stored(&org, &key).await, dismissal(4));
        process(put(&org, "plain", "2".to_string())).await.unwrap();
        process(put(&org, "plain", "1".to_string())).await.unwrap();
        assert_eq!(stored(&org, "plain").await, "1");
        infra::table::kv_store::delete_by_org(&org).await.unwrap();
    }
}
