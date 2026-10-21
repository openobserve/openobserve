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

//! Receive arm of message type 96: one HTTP trigger and its credentials as a versioned snapshot.

use infra::{
    errors::{Error, Result},
    table::workflow_http_triggers::{self as table, ApplyOutcome, TriggerSnapshot},
};
use o2_enterprise::enterprise::super_cluster::queue::Message;

const KEY_PREFIX: &str = "/workflow_http_triggers/";

/// Seam over the store and the coordinator so the ack rules are testable without either.
trait SnapshotSink {
    async fn apply(&self, snapshot: TriggerSnapshot) -> Result<ApplyOutcome>;
    async fn invalidate(&self, trigger_id: &str) -> Result<()>;
}

struct MetaStore;

impl SnapshotSink for MetaStore {
    async fn apply(&self, snapshot: TriggerSnapshot) -> Result<ApplyOutcome> {
        table::apply_snapshot(snapshot).await
    }

    async fn invalidate(&self, trigger_id: &str) -> Result<()> {
        db::workflow_http_triggers::notify_local(trigger_id)
            .await
            .map_err(|e| Error::Message(e.to_string()))
    }
}

pub(crate) async fn process(msg: Message) -> Result<()> {
    process_with(&MetaStore, msg).await
}

/// Acks a poison message, returns DB errors for redelivery, and evicts every trigger it wrote.
async fn process_with<S: SnapshotSink>(sink: &S, msg: Message) -> Result<()> {
    let Some(snapshot) = decode(&msg) else {
        log::error!(
            "[SUPER_CLUSTER:DB] skipped an undecodable workflow http trigger snapshot, key {}",
            msg.key
        );
        return Ok(());
    };
    let trigger_id = snapshot.trigger.id.clone();
    let origin_cluster = snapshot.origin_cluster.clone();
    let outcome = match sink.apply(snapshot).await {
        Ok(outcome) => outcome,
        Err(e) => {
            config::metrics::WORKFLOW_HOOK_SNAPSHOT_APPLY_FAILURES
                .with_label_values(&[origin_cluster.as_str()])
                .inc();
            log::error!("{}: {e}", apply_failure_log(&msg.key));
            return Err(e);
        }
    };
    if outcome == ApplyOutcome::Stale {
        return Ok(());
    }
    evict(sink, &trigger_id).await;
    if let ApplyOutcome::CollisionWon { loser } = &outcome {
        evict(sink, loser).await;
    }
    Ok(())
}

async fn evict<S: SnapshotSink>(sink: &S, trigger_id: &str) {
    if let Err(e) = sink.invalidate(trigger_id).await {
        log::error!(
            "[SUPER_CLUSTER:DB] workflow http trigger cache eviction failed for {trigger_id}: {e}"
        );
    }
}

/// A body whose trigger id differs from the key's is treated as malformed, not applied.
fn decode(msg: &Message) -> Option<TriggerSnapshot> {
    let snapshot: TriggerSnapshot = serde_json::from_slice(msg.value.as_deref()?).ok()?;
    (msg.key.strip_prefix(KEY_PREFIX) == Some(snapshot.trigger.id.as_str())).then_some(snapshot)
}

fn apply_failure_log(key: &str) -> String {
    format!(
        "[SUPER_CLUSTER:DB] workflow http trigger snapshot apply failed, key {key}, left for redelivery"
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use infra::table::workflow_http_triggers::{
        AuthMode, CredentialKind, CredentialState, ReplicatedCredential, ReplicatedTrigger,
    };
    use o2_enterprise::enterprise::super_cluster::queue::MessageType;

    use super::*;

    /// Records what reached the store and the coordinator.
    struct FakeSink {
        outcome: std::result::Result<ApplyOutcome, String>,
        applied: Mutex<Vec<String>>,
        evicted: Mutex<Vec<String>>,
    }

    impl FakeSink {
        fn new(outcome: std::result::Result<ApplyOutcome, String>) -> Self {
            Self {
                outcome,
                applied: Mutex::new(Vec::new()),
                evicted: Mutex::new(Vec::new()),
            }
        }
    }

    impl SnapshotSink for FakeSink {
        async fn apply(&self, snapshot: TriggerSnapshot) -> Result<ApplyOutcome> {
            self.applied.lock().unwrap().push(snapshot.trigger.id);
            self.outcome.clone().map_err(Error::Message)
        }

        async fn invalidate(&self, trigger_id: &str) -> Result<()> {
            self.evicted.lock().unwrap().push(trigger_id.to_string());
            Ok(())
        }
    }

    fn snapshot(trigger_id: &str, origin_cluster: &str) -> TriggerSnapshot {
        TriggerSnapshot {
            version: 2,
            origin_cluster: origin_cluster.to_string(),
            deleted: false,
            trigger: ReplicatedTrigger {
                id: trigger_id.to_string(),
                org_id: "acme".to_string(),
                workflow_id: "wf-1".to_string(),
                enabled: true,
                auth_mode: AuthMode::Signature,
                max_body_bytes: 1_048_576,
                rate_limit_per_minute: 60,
                created_by: "a@x.io".to_string(),
                created_at: 1,
                updated_at: 2,
                deleted_at: None,
            },
            credentials: vec![ReplicatedCredential {
                id: "c1".to_string(),
                kind: CredentialKind::SigningSecret,
                display_prefix: "whsec_abcd…wxyz".to_string(),
                token_sha256: None,
                state: CredentialState::Active,
                expires_at: None,
                revoked_at: None,
                created_by: "a@x.io".to_string(),
                created_at: 1,
                updated_at: 2,
                secret: Some("whsec_c2VjcmV0".to_string()),
            }],
        }
    }

    fn message(key: &str, value: Vec<u8>) -> Message {
        Message::new(
            key.to_string(),
            Some(value.into()),
            None,
            true,
            MessageType::WorkflowHttpTriggerPut,
        )
    }

    fn snapshot_message(snapshot: &TriggerSnapshot) -> Message {
        message(
            &format!("{KEY_PREFIX}{}", snapshot.trigger.id),
            serde_json::to_vec(snapshot).unwrap(),
        )
    }

    #[tokio::test]
    async fn a_malformed_snapshot_is_acked() {
        let sink = FakeSink::new(Ok(ApplyOutcome::Applied));
        let garbage = message("/workflow_http_triggers/t1", b"{not json".to_vec());
        assert!(process_with(&sink, garbage).await.is_ok());
        let mismatched = message(
            "/workflow_http_triggers/other",
            serde_json::to_vec(&snapshot("t1", "r1")).unwrap(),
        );
        assert!(process_with(&sink, mismatched).await.is_ok());
        assert!(sink.applied.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_db_error_is_returned_for_redelivery() {
        let origin = "r-db-error";
        let failures = || {
            config::metrics::WORKFLOW_HOOK_SNAPSHOT_APPLY_FAILURES
                .with_label_values(&[origin])
                .get()
        };
        let before = failures();
        let sink = FakeSink::new(Err("database is locked".to_string()));
        let result = process_with(&sink, snapshot_message(&snapshot("t1", origin))).await;
        assert!(result.is_err(), "a DB error must not be acked");
        assert_eq!(failures(), before + 1);
        assert!(sink.evicted.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn apply_puts_the_cache_invalidation_key() {
        let applied = FakeSink::new(Ok(ApplyOutcome::Applied));
        process_with(&applied, snapshot_message(&snapshot("t1", "r1")))
            .await
            .unwrap();
        assert_eq!(*applied.evicted.lock().unwrap(), ["t1"]);

        let stale = FakeSink::new(Ok(ApplyOutcome::Stale));
        process_with(&stale, snapshot_message(&snapshot("t1", "r1")))
            .await
            .unwrap();
        assert!(stale.evicted.lock().unwrap().is_empty());
        assert_eq!(
            db::workflow_http_triggers::TRIGGER_KEY_PREFIX,
            "/workflow_http_trigger/"
        );
    }

    #[tokio::test]
    async fn a_won_collision_also_evicts_the_losing_trigger() {
        let won = FakeSink::new(Ok(ApplyOutcome::CollisionWon {
            loser: "t-lost".to_string(),
        }));
        process_with(&won, snapshot_message(&snapshot("t1", "r1")))
            .await
            .unwrap();
        assert_eq!(*won.evicted.lock().unwrap(), ["t1", "t-lost"]);
    }

    #[test]
    fn apply_failure_log_names_only_the_key() {
        let line = apply_failure_log("/workflow_http_triggers/t1");
        assert!(line.contains("/workflow_http_triggers/t1"), "{line}");
        let body = serde_json::to_string(&snapshot("t1", "r1")).unwrap();
        assert!(!line.contains("whsec_"), "{line}");
        assert!(!line.contains(&body), "{line}");
    }
}
