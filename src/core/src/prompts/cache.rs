// Copyright 2026 OpenObserve Inc.

use std::{
    num::NonZeroUsize,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use lru::LruCache;
use parking_lot::Mutex;

use super::{PromptStatus, ResolvedPrompt};

const CACHE_CAPACITY: usize = 10_000;
const LABEL_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum CacheKey {
    NameLabel {
        org_id: String,
        name: String,
        label: String,
    },
    Pinned {
        org_id: String,
        entity_id: String,
        version: i32,
    },
}

#[derive(Clone)]
struct CacheEntry {
    value: ResolvedPrompt,
    expires_at: Option<Instant>,
}

static CACHE: LazyLock<Mutex<LruCache<CacheKey, CacheEntry>>> = LazyLock::new(|| {
    Mutex::new(LruCache::new(
        NonZeroUsize::new(CACHE_CAPACITY).expect("prompt cache capacity is non-zero"),
    ))
});

pub(crate) fn get_name_label(org_id: &str, name: &str, label: &str) -> Option<ResolvedPrompt> {
    get(&CacheKey::NameLabel {
        org_id: org_id.to_string(),
        name: name.to_string(),
        label: label.to_string(),
    })
}

pub(crate) fn insert_name_label(org_id: &str, name: &str, label: &str, value: ResolvedPrompt) {
    CACHE.lock().put(
        CacheKey::NameLabel {
            org_id: org_id.to_string(),
            name: name.to_string(),
            label: label.to_string(),
        },
        CacheEntry {
            value,
            expires_at: Some(Instant::now() + LABEL_TTL),
        },
    );
}

pub(crate) fn get_pinned(org_id: &str, entity_id: &str, version: i32) -> Option<ResolvedPrompt> {
    get(&CacheKey::Pinned {
        org_id: org_id.to_string(),
        entity_id: entity_id.to_string(),
        version,
    })
}

pub(crate) fn insert_pinned(org_id: &str, entity_id: &str, version: i32, value: ResolvedPrompt) {
    CACHE.lock().put(
        CacheKey::Pinned {
            org_id: org_id.to_string(),
            entity_id: entity_id.to_string(),
            version,
        },
        CacheEntry {
            value,
            expires_at: None,
        },
    );
}

fn get(key: &CacheKey) -> Option<ResolvedPrompt> {
    let mut cache = CACHE.lock();
    let expired = cache
        .peek(key)
        .and_then(|entry| entry.expires_at)
        .is_some_and(|expires_at| expires_at <= Instant::now());
    if expired {
        cache.pop(key);
        return None;
    }
    cache.get(key).map(|entry| entry.value.clone())
}

pub(crate) fn invalidate_label(org_id: &str, entity_id: &str, label: &str) {
    remove_where(|key, entry| {
        matches!(
            key,
            CacheKey::NameLabel {
                org_id: cached_org,
                label: cached_label,
                ..
            } if cached_org == org_id
                && cached_label == label
                && entry.value.prompt.entity_id == entity_id
        )
    });
}

pub(crate) fn invalidate_version(org_id: &str, entity_id: &str, version: i32) {
    remove_where(|key, _| {
        matches!(
            key,
            CacheKey::Pinned {
                org_id: cached_org,
                entity_id: cached_entity,
                version: cached_version,
            } if cached_org == org_id
                && cached_entity == entity_id
                && *cached_version == version
        )
    });
}

pub(crate) fn invalidate_entity(org_id: &str, entity_id: &str) {
    remove_where(|key, entry| match key {
        CacheKey::NameLabel {
            org_id: cached_org, ..
        } => cached_org == org_id && entry.value.prompt.entity_id == entity_id,
        CacheKey::Pinned {
            org_id: cached_org,
            entity_id: cached_entity,
            ..
        } => cached_org == org_id && cached_entity == entity_id,
    });
}

fn remove_where(mut predicate: impl FnMut(&CacheKey, &CacheEntry) -> bool) {
    let mut cache = CACHE.lock();
    let keys = cache
        .iter()
        .filter(|(key, entry)| predicate(key, entry))
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    for key in keys {
        cache.pop(&key);
    }
}

pub(crate) fn enforce_new_reference(
    value: ResolvedPrompt,
) -> Result<ResolvedPrompt, super::PromptError> {
    if value.prompt.status == PromptStatus::Archived {
        Err(super::PromptError::ArchivedPrompt)
    } else {
        Ok(value)
    }
}

/// Watches coordinator events until the invalidation channel closes.
pub async fn watch_invalidation() -> Result<(), anyhow::Error> {
    let coordinator = infra::coordinator::get_coordinator().await;
    let mut events = coordinator
        .watch(infra::coordinator::prompts::PROMPTS_WATCH_PREFIX)
        .await?;
    let events = Arc::get_mut(&mut events).expect("prompt watcher owns its receiver");
    log::info!("[prompts] start watching resolve-cache invalidations");
    while let Some(event) = events.recv().await {
        let key = match event {
            infra::db::Event::Put(event) | infra::db::Event::Delete(event) => event.key,
            infra::db::Event::Empty => continue,
        };
        match infra::coordinator::prompts::parse_key(&key) {
            Some(infra::coordinator::prompts::Invalidation::Label {
                org_id,
                entity_id,
                label,
            }) => invalidate_label(&org_id, &entity_id, &label),
            Some(infra::coordinator::prompts::Invalidation::Version {
                org_id,
                entity_id,
                version,
            }) => invalidate_version(&org_id, &entity_id, version),
            Some(infra::coordinator::prompts::Invalidation::Head { org_id, entity_id }) => {
                invalidate_entity(&org_id, &entity_id)
            }
            None => log::warn!("[prompts] ignored malformed invalidation key: {key}"),
        }
    }
    log::error!("[prompts] resolve-cache invalidation channel closed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::prompts::{Prompt, PromptConfig, PromptSource, PromptType, PromptVersion};

    fn resolved(entity_id: &str, version: i32) -> ResolvedPrompt {
        ResolvedPrompt {
            prompt: Prompt {
                entity_id: entity_id.to_string(),
                name: "assistant".to_string(),
                folder_id: "default".to_string(),
                prompt_type: PromptType::Text,
                description: None,
                tags: vec![],
                status: PromptStatus::Active,
                latest_version: version,
                created_by: "test".to_string(),
                created_at: 1,
                updated_by: "test".to_string(),
                updated_at: 1,
                labels: vec![],
            },
            version: PromptVersion {
                id: format!("physical-{version}"),
                entity_id: entity_id.to_string(),
                version,
                payload: json!("hello"),
                config: PromptConfig::default(),
                commit_message: "test".to_string(),
                source: PromptSource::Ui,
                base_version: None,
                content_hash: "hash".to_string(),
                created_by: "test".to_string(),
                created_at: 1,
            },
            label: None,
            folder_assertion_mismatch: false,
        }
    }

    #[test]
    fn label_and_pinned_keys_do_not_collide_and_entity_invalidation_removes_both() {
        invalidate_entity("org", "entity");
        insert_name_label("org", "assistant", "production", resolved("entity", 1));
        insert_pinned("org", "entity", 1, resolved("entity", 1));
        assert!(get_name_label("org", "assistant", "production").is_some());
        assert!(get_pinned("org", "entity", 1).is_some());

        invalidate_entity("org", "entity");
        assert!(get_name_label("org", "assistant", "production").is_none());
        assert!(get_pinned("org", "entity", 1).is_none());
    }

    #[test]
    fn expired_label_entry_is_not_returned() {
        let key = CacheKey::NameLabel {
            org_id: "expiry-org".to_string(),
            name: "assistant".to_string(),
            label: "production".to_string(),
        };
        CACHE.lock().put(
            key,
            CacheEntry {
                value: resolved("expiry-entity", 1),
                expires_at: Some(Instant::now() - Duration::from_millis(1)),
            },
        );
        assert!(get_name_label("expiry-org", "assistant", "production").is_none());
    }
}
