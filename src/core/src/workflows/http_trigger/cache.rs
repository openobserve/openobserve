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

//! Per-node lookup cache of trigger config, live credentials and decrypted signing keys.

use std::{
    sync::{
        Arc, LazyLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use config::utils::time::now_micros;
use db::workflow_http_triggers::TRIGGER_KEY_PREFIX;
use hashbrown::HashMap;
use infra::{
    coordinator::get_coordinator,
    db::{Event, get_orm_client_rw},
    secrets::{self, SecretMaterial, SecretOwnerKind},
    table::{
        entity::{
            workflow_http_trigger_credentials::Model as CredentialRow,
            workflow_http_triggers::Model as TriggerRow,
        },
        workflow_http_triggers::{self as triggers, CredentialKind, CredentialState},
    },
};
use tokio::sync::RwLock;

use super::{credentials::LiveCredential, signature::decode_secret};

const TTL: Duration = Duration::from_secs(30);

static CACHE: LazyLock<RwLock<HashMap<String, Arc<CachedTrigger>>>> =
    LazyLock::new(Default::default);
// Bumped by every invalidation, so a load that overlapped one answers its caller uncached.
static EPOCH: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct CachedTrigger {
    pub trigger: TriggerRow,
    pub credentials: Vec<LiveCredential>,
    pub fetched_at: Instant,
}

impl std::fmt::Debug for CachedTrigger {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CachedTrigger")
            .field("trigger_id", &self.trigger.id)
            .field("org_id", &self.trigger.org_id)
            .field("auth_mode", &self.trigger.auth_mode)
            .field("enabled", &self.trigger.enabled)
            .field("credentials", &self.credentials)
            .field("fetched_at", &self.fetched_at)
            .finish()
    }
}

pub async fn get(trigger_id: &str) -> Result<Option<Arc<CachedTrigger>>, anyhow::Error> {
    get_or_load(trigger_id, || load(trigger_id)).await
}

pub async fn invalidate(trigger_id: &str) {
    let mut cache = CACHE.write().await;
    EPOCH.fetch_add(1, Ordering::AcqRel);
    cache.remove(trigger_id);
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let mut events = get_coordinator().await.watch(TRIGGER_KEY_PREFIX).await?;
    let events = Arc::get_mut(&mut events)
        .ok_or_else(|| anyhow::anyhow!("trigger cache watch receiver is shared"))?;
    log::info!("[WORKFLOW_HOOK] start watching trigger cache keys");
    while let Some(event) = events.recv().await {
        let key = match &event {
            Event::Put(e) => e.key.as_str(),
            Event::Delete(e) => e.key.as_str(),
            Event::Empty => continue,
        };
        if let Some(trigger_id) = evicted_trigger(key) {
            invalidate(trigger_id).await;
        }
    }
    log::warn!("[WORKFLOW_HOOK] trigger cache watch channel closed");
    Ok(())
}

/// The epoch is compared under the write lock that `invalidate` also takes.
async fn get_or_load<F, Fut>(
    trigger_id: &str,
    load: F,
) -> Result<Option<Arc<CachedTrigger>>, anyhow::Error>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<Option<CachedTrigger>, anyhow::Error>>,
{
    if let Some(hit) = fresh(&*CACHE.read().await, trigger_id, Instant::now()) {
        return Ok(Some(hit));
    }
    let epoch = EPOCH.load(Ordering::Acquire);
    let loaded = load().await?;
    let mut cache = CACHE.write().await;
    let Some(loaded) = loaded else {
        cache.remove(trigger_id);
        return Ok(None);
    };
    let loaded = Arc::new(loaded);
    if EPOCH.load(Ordering::Acquire) == epoch {
        cache.insert(trigger_id.to_string(), loaded.clone());
    }
    Ok(Some(loaded))
}

async fn load(trigger_id: &str) -> Result<Option<CachedTrigger>, anyhow::Error> {
    let db = get_orm_client_rw().await;
    let Some(trigger) = triggers::get(db, trigger_id).await? else {
        return Ok(None);
    };
    let now = now_micros();
    let mut credentials = Vec::new();
    for row in triggers::list_credentials(db, trigger_id).await? {
        if let Some(credential) = live_credential(&trigger, row, now).await {
            credentials.push(credential);
        }
    }
    Ok(Some(CachedTrigger {
        trigger,
        credentials,
        fetched_at: Instant::now(),
    }))
}

/// A signing key that cannot be decrypted drops only its own credential, logged by id.
async fn live_credential(
    trigger: &TriggerRow,
    row: CredentialRow,
    now_us: i64,
) -> Option<LiveCredential> {
    let kind = CredentialKind::parse(&row.kind)?;
    let state = CredentialState::parse(&row.state)?;
    if !triggers::is_live(state, row.expires_at, now_us) {
        return None;
    }
    let signing_key = match kind {
        CredentialKind::Token => None,
        CredentialKind::SigningSecret => Some(signing_key(trigger, &row).await?),
    };
    Some(LiveCredential {
        id: row.id,
        kind,
        display_prefix: row.display_prefix,
        token_sha256: row.token_sha256,
        signing_key,
        state,
        expires_at: row.expires_at,
    })
}

async fn signing_key(trigger: &TriggerRow, row: &CredentialRow) -> Option<Vec<u8>> {
    let secret_ref = row.secret_ref.as_deref()?;
    let resolved = secrets::resolve_record(
        &trigger.org_id,
        secret_ref,
        SecretOwnerKind::WorkflowTrigger,
        &row.id,
        secrets::CURRENT,
    )
    .await;
    match resolved {
        Ok((_, SecretMaterial::Token { value })) => decode_secret(&value),
        Ok(_) => {
            log::warn!("[WORKFLOW_HOOK] credential {} holds no signing key", row.id);
            None
        }
        Err(e) => {
            log::error!(
                "[WORKFLOW_HOOK] signing key of credential {} unreadable: {e}",
                row.id
            );
            None
        }
    }
}

fn fresh(
    cache: &HashMap<String, Arc<CachedTrigger>>,
    trigger_id: &str,
    now: Instant,
) -> Option<Arc<CachedTrigger>> {
    cache
        .get(trigger_id)
        .filter(|entry| now.duration_since(entry.fetched_at) < TTL)
        .cloned()
}

fn evicted_trigger(key: &str) -> Option<&str> {
    key.strip_prefix(TRIGGER_KEY_PREFIX)
        .filter(|id| !id.is_empty() && !id.contains('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trigger_row(id: &str) -> TriggerRow {
        TriggerRow {
            id: id.to_string(),
            org_id: "acme".to_string(),
            workflow_id: "wf".to_string(),
            enabled: true,
            auth_mode: "token".to_string(),
            max_body_bytes: 1024,
            rate_limit_per_minute: 60,
            created_by: "a@acme.io".to_string(),
            created_at: 1,
            updated_at: 1,
            version: 1,
            origin_cluster: "local".to_string(),
            deleted_at: None,
            last_invoked_at: None,
            rejections: None,
        }
    }

    fn cached(id: &str, fetched_at: Instant) -> Arc<CachedTrigger> {
        Arc::new(CachedTrigger {
            trigger: trigger_row(id),
            credentials: vec![LiveCredential {
                id: "c1".to_string(),
                kind: CredentialKind::SigningSecret,
                display_prefix: "whsec_abcd…wxyz".to_string(),
                token_sha256: None,
                signing_key: Some(b"key-material".to_vec()),
                state: CredentialState::Active,
                expires_at: None,
            }],
            fetched_at,
        })
    }

    #[test]
    fn an_entry_older_than_thirty_seconds_is_refetched() {
        let t0 = Instant::now();
        let mut map = HashMap::new();
        map.insert("t1".to_string(), cached("t1", t0));
        assert!(fresh(&map, "t1", t0 + Duration::from_secs(29)).is_some());
        assert!(fresh(&map, "t1", t0 + TTL).is_none());
        assert!(fresh(&map, "t2", t0).is_none());
    }

    #[tokio::test]
    async fn an_invalidation_evicts_the_entry() {
        CACHE
            .write()
            .await
            .insert("t-evict".to_string(), cached("t-evict", Instant::now()));
        let key = format!("{TRIGGER_KEY_PREFIX}t-evict");
        let trigger_id = evicted_trigger(&key).unwrap();
        invalidate(trigger_id).await;
        assert!(!CACHE.read().await.contains_key("t-evict"));
        assert_eq!(evicted_trigger("/workflow_http_trigger/a/b"), None);
        assert_eq!(evicted_trigger("/other/t1"), None);
    }

    #[tokio::test]
    async fn a_revoke_during_a_load_is_honoured_on_the_next_request() {
        let id = "t-revoke-race";
        let stale = get_or_load(id, || async {
            invalidate(id).await;
            Ok(Some(CachedTrigger::clone(&cached(id, Instant::now()))))
        })
        .await
        .unwrap();
        assert!(
            stale.is_some(),
            "the caller in flight still gets its answer"
        );
        assert!(
            !CACHE.read().await.contains_key(id),
            "a load that overlapped an invalidation is not cached"
        );
        let reloads = std::sync::atomic::AtomicUsize::new(0);
        let fresh = get_or_load(id, || async {
            reloads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(None)
        })
        .await
        .unwrap();
        assert_eq!(reloads.into_inner(), 1, "the next request reloads");
        assert!(fresh.is_none(), "and sees the revoke");
    }

    #[tokio::test]
    async fn token_rows_never_decrypt() {
        let row = CredentialRow {
            id: "c-tok".to_string(),
            trigger_id: "t1".to_string(),
            org_id: "acme".to_string(),
            kind: CredentialKind::Token.as_str().to_string(),
            display_prefix: "o2wh_abcd…wxyz".to_string(),
            token_sha256: Some("ab".repeat(32)),
            secret_ref: Some("unresolvable-ref".to_string()),
            state: CredentialState::Active.as_str().to_string(),
            expires_at: None,
            revoked_at: None,
            created_by: "a@acme.io".to_string(),
            created_at: 1,
            updated_at: 1,
            last_used_at: None,
        };
        let live = live_credential(&trigger_row("t1"), row, 10)
            .await
            .expect("a live token stays usable without its secret");
        assert_eq!(live.signing_key, None);
        assert_eq!(live.token_sha256, Some("ab".repeat(32)));
    }

    #[test]
    fn cached_trigger_debug_omits_signing_keys() {
        let printed = format!("{:?}", cached("t1", Instant::now()));
        assert!(!printed.contains("key-material"));
        assert!(!printed.contains("107, 101, 121"));
        assert!(printed.contains("t1"));
    }
}
