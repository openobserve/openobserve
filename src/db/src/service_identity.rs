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

//! Per-org env overrides for ingest-time resolution, reloaded by coordinator events.

use std::{
    sync::{Arc, LazyLock, OnceLock},
    time::{Duration, Instant},
};

use config::meta::service_identity::OrgIdentity;
use dashmap::DashMap;
use infra::{
    coordinator::service_identity::{SERVICE_IDENTITY_WATCH_PREFIX, org_from_key},
    db::get_orm_client_rw,
    table::service_identity_rules,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::service_identity::fields::IdentityFields;
use sea_orm::{ConnectionTrait, TransactionTrait};

// A failed load is retried no sooner than this, so a down database is not read on every request.
const RETRY_AFTER: Duration = Duration::from_secs(60);

static IDENTITY_OVERRIDES: LazyLock<DashMap<String, Cached>> = LazyLock::new(DashMap::new);
static LOAD_LOCKS: LazyLock<DashMap<String, Arc<tokio::sync::Mutex<()>>>> =
    LazyLock::new(DashMap::new);
static EMPTY: LazyLock<Arc<OrgIdentity>> = LazyLock::new(Default::default);
#[cfg(feature = "enterprise")]
static IDENTITY_FIELDS: LazyLock<DashMap<String, Arc<IdentityFields>>> =
    LazyLock::new(DashMap::new);
// Core registers the display-index rebuild here, since db cannot depend on core.
static DISPLAY_REBUILD: OnceLock<DisplayRebuild> = OnceLock::new();

#[cfg(test)]
static ALIAS_LOAD_COUNTS: LazyLock<DashMap<String, usize>> = LazyLock::new(DashMap::new);

static SUMMARY_LOCKS: LazyLock<DashMap<String, Arc<tokio::sync::Mutex<()>>>> =
    LazyLock::new(DashMap::new);
static SUMMARIES: LazyLock<DashMap<String, CachedSummaries>> = LazyLock::new(DashMap::new);

struct CachedSummaries {
    rows: Arc<Vec<config::meta::service_identity::WhereSummaryRecord>>,
    expires: Instant,
}

static ALIASES: LazyLock<DashMap<String, CachedAliases>> = LazyLock::new(DashMap::new);
static ALIAS_LOCKS: LazyLock<DashMap<String, Arc<tokio::sync::Mutex<()>>>> =
    LazyLock::new(DashMap::new);

static SCOPE_VERSIONS: LazyLock<DashMap<String, CachedScopeVersions>> = LazyLock::new(DashMap::new);
static SCOPE_VERSION_LOCKS: LazyLock<DashMap<String, Arc<tokio::sync::Mutex<()>>>> =
    LazyLock::new(DashMap::new);

struct CachedScopeVersions {
    counts: Arc<std::collections::BTreeMap<String, u64>>,
    expires: Instant,
}

struct CachedAliases {
    rows: Arc<Vec<config::meta::service_identity::AliasRow>>,
    expires: Instant,
}

struct Cached {
    identity: Arc<OrgIdentity>,
    retry_at: Option<Instant>,
}

/// Rebuilds one org's display index after its aliases or summaries changed.
pub type DisplayRebuild =
    fn(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>;

/// The org's live overrides from memory; an org without any shares one empty value.
pub async fn get_cached_overrides(org_id: &str) -> Arc<OrgIdentity> {
    if let Some(hit) = IDENTITY_OVERRIDES.get(org_id)
        && hit.retry_at.is_none_or(|at| Instant::now() < at)
    {
        return hit.identity.clone();
    }
    reload_with_mode(org_id, false, || async {
        service_identity_rules::list(get_orm_client_rw().await, org_id).await
    })
    .await
}

/// The org's semantic field groups as the resolver reads them, parsed once per org.
#[cfg(feature = "enterprise")]
pub async fn get_cached_fields(org_id: &str) -> Arc<IdentityFields> {
    if let Some(hit) = IDENTITY_FIELDS.get(org_id) {
        return hit.clone();
    }
    build_fields(org_id).await
}

/// Rebuilds a cached org's fields after its semantic groups changed; an uncached org waits.
#[cfg(feature = "enterprise")]
pub async fn refresh_fields(org_id: &str) {
    if IDENTITY_FIELDS.contains_key(org_id) {
        build_fields(org_id).await;
    }
}

/// Reads one org's overrides into the cache; a failed read keeps what the cache held.
pub async fn reload_org_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Arc<OrgIdentity> {
    reload_with(org_id, || service_identity_rules::list(conn, org_id)).await
}

/// Reloads only the org an event key names.
pub async fn on_event_with<C: ConnectionTrait>(conn: &C, key: &str) -> Option<Arc<OrgIdentity>> {
    let org_id = org_from_key(key)?;
    invalidate_aliases(org_id).await;
    invalidate_summaries(org_id).await;
    invalidate_scope_versions(org_id).await;
    let identity = reload_org_with(conn, org_id).await;
    if let Some(rebuild) = DISPLAY_REBUILD.get() {
        rebuild(org_id.to_string()).await;
    }
    Some(identity)
}

/// Installs the display-index rebuild that every coordinator event runs; the first call wins.
pub fn set_display_rebuild(rebuild: DisplayRebuild) {
    let _ = DISPLAY_REBUILD.set(rebuild);
}

/// Keeps every node's cache in step with override writes made anywhere in the cluster.
pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = super::get_coordinator().await;
    loop {
        let mut events = match cluster_coordinator
            .watch(SERVICE_IDENTITY_WATCH_PREFIX)
            .await
        {
            Ok(events) => events,
            Err(e) => {
                log::error!("[SERVICE_IDENTITY] watch registration failed: {e}");
                tokio::time::sleep(RETRY_AFTER).await;
                continue;
            }
        };
        let events = Arc::get_mut(&mut events).unwrap();
        log::info!("[SERVICE_IDENTITY] start watching overrides");
        loop {
            let key = match events.recv().await {
                Some(super::Event::Put(ev)) => ev.key,
                Some(super::Event::Delete(ev)) => ev.key,
                Some(super::Event::Empty) => continue,
                None => {
                    log::error!("[SERVICE_IDENTITY] watch: event channel closed");
                    break;
                }
            };
            on_event_with(get_orm_client_rw().await, &key).await;
        }
        tokio::time::sleep(RETRY_AFTER).await;
    }
}

pub async fn get_cached_summaries(
    org_id: &str,
) -> Result<Arc<Vec<config::meta::service_identity::WhereSummaryRecord>>, infra::errors::Error> {
    let lock = SUMMARY_LOCKS.entry(org_id.to_string()).or_default().clone();
    let _guard = lock.lock().await;
    if let Some(hit) = SUMMARIES.get(org_id)
        && hit.expires > Instant::now()
    {
        return Ok(hit.rows.clone());
    }
    let rows = Arc::new(
        infra::table::service_where_summary::list_by_org(get_orm_client_rw().await, org_id).await?,
    );
    SUMMARIES.insert(
        org_id.to_string(),
        CachedSummaries {
            rows: rows.clone(),
            expires: Instant::now() + RETRY_AFTER,
        },
    );
    Ok(rows)
}

pub async fn invalidate_summaries(org_id: &str) {
    let lock = SUMMARY_LOCKS.entry(org_id.to_string()).or_default().clone();
    let _guard = lock.lock().await;
    SUMMARIES.remove(org_id);
}

/// Live versions per scope key, cached like the summaries so a popover open costs no registry scan.
pub async fn get_cached_scope_versions(
    org_id: &str,
) -> Result<Arc<std::collections::BTreeMap<String, u64>>, infra::errors::Error> {
    let lock = SCOPE_VERSION_LOCKS
        .entry(org_id.to_string())
        .or_default()
        .clone();
    let _guard = lock.lock().await;
    if let Some(hit) = SCOPE_VERSIONS.get(org_id)
        && hit.expires > Instant::now()
    {
        return Ok(hit.counts.clone());
    }
    let counts = Arc::new(
        infra::table::service_versions::versions_by_scope(get_orm_client_rw().await, org_id)
            .await?,
    );
    SCOPE_VERSIONS.insert(
        org_id.to_string(),
        CachedScopeVersions {
            counts: counts.clone(),
            expires: Instant::now() + RETRY_AFTER,
        },
    );
    Ok(counts)
}

pub async fn invalidate_scope_versions(org_id: &str) {
    let lock = SCOPE_VERSION_LOCKS
        .entry(org_id.to_string())
        .or_default()
        .clone();
    let _guard = lock.lock().await;
    SCOPE_VERSIONS.remove(org_id);
}

pub async fn get_cached_aliases(
    org_id: &str,
) -> Result<Arc<Vec<config::meta::service_identity::AliasRow>>, infra::errors::Error> {
    let lock = ALIAS_LOCKS.entry(org_id.to_string()).or_default().clone();
    let _guard = lock.lock().await;
    if let Some(hit) = ALIASES.get(org_id)
        && hit.expires > Instant::now()
    {
        return Ok(hit.rows.clone());
    }
    let rows = Arc::new(
        infra::table::service_name_aliases::list(get_orm_client_rw().await, org_id).await?,
    );
    ALIASES.insert(
        org_id.to_string(),
        CachedAliases {
            rows: rows.clone(),
            expires: Instant::now() + RETRY_AFTER,
        },
    );
    Ok(rows)
}

pub async fn invalidate_aliases(org_id: &str) {
    let lock = ALIAS_LOCKS.entry(org_id.to_string()).or_default().clone();
    let _guard = lock.lock().await;
    ALIASES.remove(org_id);
}

pub async fn put_aliases_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    rows: Vec<config::meta::service_identity::AliasRow>,
    learned: bool,
) -> Result<(), infra::errors::Error> {
    let mut changed = std::collections::HashSet::new();
    let mut failure = None;
    for row in rows.iter().filter(|row| row.org_id == org_id) {
        let applied = if learned {
            infra::table::service_name_aliases::upsert_learned(conn, row).await
        } else {
            infra::table::service_name_aliases::upsert(conn, row).await
        };
        match applied {
            Ok(true) => {
                changed.insert(row.alias_key.clone());
            }
            Ok(false) => (),
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
    }
    infra::table::service_name_aliases::recompute_conflicts(conn, org_id).await?;
    publish_alias_changes(conn, org_id, changed).await?;
    failure.map_or(Ok(()), Err)
}

/// Admin alias writes: one transaction, then `AliasPut` for every changed row.
pub async fn put_manual_aliases_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    rows: &[config::meta::service_identity::AliasRow],
) -> Result<std::collections::HashSet<String>, infra::errors::Error> {
    let changed = infra::table::service_name_aliases::put_manual_batch(conn, org_id, rows).await?;
    publish_alias_changes(conn, org_id, changed.clone()).await?;
    Ok(changed)
}

/// Tombstones one alias and publishes `AliasDelete`; false when nothing changed.
pub async fn delete_alias_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    key: &str,
    at: i64,
    cluster: &str,
) -> Result<bool, infra::errors::Error> {
    let tx = conn.begin().await?;
    infra::table::service_name_aliases::lock_org(&tx, org_id).await?;
    if !infra::table::service_name_aliases::tombstone(&tx, org_id, key, at, cluster).await? {
        tx.rollback().await?;
        return Ok(false);
    }
    infra::table::service_name_aliases::recompute_conflicts(&tx, org_id).await?;
    tx.commit().await?;
    invalidate_aliases(org_id).await;
    crate::service_identity_sync::publish(
        config::meta::service_identity::ServiceIdentityMessage::AliasDelete {
            org_id: org_id.to_string(),
            alias_key: key.to_string(),
            updated_at: at,
            writer_cluster: cluster.to_string(),
        },
    )
    .await;
    Ok(true)
}

/// Undoes a bulk batch and publishes `AliasPut` for exactly the rows it restored.
pub async fn undo_alias_batch_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    batch_id: &str,
    at: i64,
    cluster: &str,
) -> Result<std::collections::HashSet<String>, infra::errors::Error> {
    let restored =
        infra::table::service_name_aliases::undo_batch(conn, org_id, batch_id, at, cluster).await?;
    publish_alias_changes(conn, org_id, restored.clone()).await?;
    Ok(restored)
}

pub async fn put_learned_aliases(
    org_id: &str,
    region: &str,
    token: i64,
    rows: Vec<config::meta::service_identity::AliasRow>,
) -> Result<(), infra::errors::Error> {
    put_learned_aliases_with(
        get_orm_client_rw().await,
        org_id,
        region,
        token,
        rows,
        || infra::coordinator::service_identity::emit_reload_event(org_id),
    )
    .await
}

pub async fn put_aliases(
    org_id: &str,
    rows: Vec<config::meta::service_identity::AliasRow>,
    learned: bool,
) -> Result<(), infra::errors::Error> {
    put_aliases_and_reload(get_orm_client_rw().await, org_id, rows, learned, || {
        infra::coordinator::service_identity::emit_reload_event(org_id)
    })
    .await
}

pub async fn delete_alias(
    org_id: &str,
    key: &str,
    at: i64,
    cluster: &str,
) -> Result<(), infra::errors::Error> {
    if !delete_alias_with(get_orm_client_rw().await, org_id, key, at, cluster).await? {
        return Ok(());
    }
    infra::coordinator::service_identity::emit_reload_event(org_id).await
}

/// Drops the cached aliases and publishes `AliasPut` for the changed rows; call it after commit.
pub async fn publish_alias_changes<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    changed: std::collections::HashSet<String>,
) -> Result<(), infra::errors::Error> {
    invalidate_aliases(org_id).await;
    if !changed.is_empty() {
        #[cfg(test)]
        {
            *ALIAS_LOAD_COUNTS.entry(org_id.to_string()).or_default() += 1;
        }
        let persisted = infra::table::service_name_aliases::list(conn, org_id)
            .await?
            .into_iter()
            .filter(|row| changed.contains(&row.alias_key))
            .collect();
        crate::service_identity_sync::publish_chunked(
            persisted,
            alias_message_max_bytes(),
            |rows| config::meta::service_identity::ServiceIdentityMessage::AliasPut {
                org_id: org_id.to_string(),
                rows,
            },
        )
        .await;
    }
    Ok(())
}

fn alias_message_max_bytes() -> usize {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MSG_MAX_BYTES
    }
    #[cfg(not(feature = "enterprise"))]
    {
        512 * 1024
    }
}

async fn put_aliases_and_reload<C, F, Fut>(
    conn: &C,
    org_id: &str,
    rows: Vec<config::meta::service_identity::AliasRow>,
    learned: bool,
    reload: F,
) -> Result<(), infra::errors::Error>
where
    C: ConnectionTrait,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(), infra::errors::Error>>,
{
    let result = put_aliases_with(conn, org_id, rows, learned).await;
    reload().await?;
    result
}

// Every node reloads the org's identity on the event, so a batch that changed nothing sends none.
async fn put_learned_aliases_with<C, F, Fut>(
    conn: &C,
    org_id: &str,
    region: &str,
    token: i64,
    rows: Vec<config::meta::service_identity::AliasRow>,
    reload: F,
) -> Result<(), infra::errors::Error>
where
    C: ConnectionTrait + TransactionTrait,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(), infra::errors::Error>>,
{
    let rows: Vec<_> = rows
        .into_iter()
        .filter(|row| row.org_id == org_id)
        .collect();
    if rows.is_empty() {
        return Ok(());
    }
    let changed =
        infra::table::service_name_aliases::put_learned_batch(conn, region, token, &rows).await?;
    if changed.is_empty() {
        return Ok(());
    }
    publish_alias_changes(conn, org_id, changed).await?;
    reload().await
}

async fn reload_with<F, Fut>(org_id: &str, load: F) -> Arc<OrgIdentity>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<
            Output = Result<Vec<config::meta::service_identity::Override>, infra::errors::Error>,
        >,
{
    reload_with_mode(org_id, true, load).await
}

async fn reload_with_mode<F, Fut>(org_id: &str, force: bool, load: F) -> Arc<OrgIdentity>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<
            Output = Result<Vec<config::meta::service_identity::Override>, infra::errors::Error>,
        >,
{
    let gate = LOAD_LOCKS.entry(org_id.to_string()).or_default().clone();
    let _guard = gate.lock().await;
    if !force
        && let Some(hit) = IDENTITY_OVERRIDES.get(org_id)
        && hit.retry_at.is_none_or(|at| Instant::now() < at)
    {
        return hit.identity.clone();
    }
    let cached = match load().await {
        Ok(overrides) if overrides.is_empty() => Cached {
            identity: EMPTY.clone(),
            retry_at: Some(Instant::now() + RETRY_AFTER),
        },
        Ok(overrides) => Cached {
            identity: Arc::new(OrgIdentity { overrides }),
            retry_at: Some(Instant::now() + RETRY_AFTER),
        },
        Err(e) => {
            log::error!("[SERVICE_IDENTITY] failed to load overrides for org {org_id}: {e}");
            Cached {
                identity: IDENTITY_OVERRIDES
                    .get(org_id)
                    .map_or_else(|| EMPTY.clone(), |hit| hit.identity.clone()),
                retry_at: Some(Instant::now() + RETRY_AFTER),
            }
        }
    };
    let identity = cached.identity.clone();
    IDENTITY_OVERRIDES.insert(org_id.to_string(), cached);
    identity
}

#[cfg(feature = "enterprise")]
async fn build_fields(org_id: &str) -> Arc<IdentityFields> {
    let groups = super::system_settings::get_semantic_field_groups(org_id).await;
    let defaults = super::system_settings::get_default_semantic_field_groups();
    let fields = Arc::new(IdentityFields::build(&groups, &defaults));
    IDENTITY_FIELDS.insert(org_id.to_string(), fields.clone());
    fields
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::{
        EnvSource, Override, OverrideScope, RULE_TYPE_ENV_OVERRIDE, rule_key,
    };
    use infra::table::service_versions::{create_tables_for_tests, sqlite_and_postgres_for_tests};

    use super::*;

    #[cfg(feature = "enterprise")]
    const RECORDED_PODS: &str = r#"[
        {"_timestamp": 1792774500000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-2.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774700000000, "min_ts": 1792774501000000, "service": "store", "source_stream": "default", "spans": 200, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565492884},
        {"_timestamp": 1792774500000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-1.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774700000000, "min_ts": 1792774501000000, "service": "store", "source_stream": "default", "spans": 200, "version": "1.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565492884},
        {"_timestamp": 1792774200000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-1.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774400000000, "min_ts": 1792774201000000, "service": "store", "source_stream": "default", "spans": 200, "version": "1.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565391829},
        {"_timestamp": 1792774200000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-2.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774400000000, "min_ts": 1792774201000000, "service": "store", "source_stream": "default", "spans": 200, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565391829},
        {"_timestamp": 1792773900000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-2.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774100000000, "min_ts": 1792773901000000, "service": "store", "source_stream": "default", "spans": 200, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565265023},
        {"_timestamp": 1792773900000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-1.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774100000000, "min_ts": 1792773901000000, "service": "store", "source_stream": "default", "spans": 200, "version": "1.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778265041214},
        {"_timestamp": 1792773900000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-1.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774100000000, "min_ts": 1792773901000000, "service": "store", "source_stream": "default", "spans": 200, "version": "1.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565265023},
        {"_timestamp": 1792773900000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-2.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774100000000, "min_ts": 1792773901000000, "service": "store", "source_stream": "default", "spans": 200, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778265041214}
    ]"#;

    const WHERE: &str = "k8s:obs-region/openobserve";

    fn env_override(org_id: &str, value: &str, updated_at: i64) -> Override {
        Override {
            rule_key: rule_key(
                org_id,
                OverrideScope::Where.as_str(),
                "obs-region",
                WHERE,
                "",
            ),
            org_id: org_id.to_string(),
            rule_type: RULE_TYPE_ENV_OVERRIDE.to_string(),
            scope: OverrideScope::Where,
            k8s_cluster: "obs-region".to_string(),
            where_key: WHERE.to_string(),
            service_name: String::new(),
            value: value.to_string(),
            inferred_value: "obs-region".to_string(),
            inferred_source: EnvSource::ClusterName,
            created_by: "alice@example.com".to_string(),
            updated_by: "alice@example.com".to_string(),
            created_at: updated_at,
            updated_at,
            deleted_at: None,
            writer_cluster: "c1".to_string(),
        }
    }

    fn cached(org_id: &str) -> Arc<OrgIdentity> {
        IDENTITY_OVERRIDES.get(org_id).unwrap().identity.clone()
    }

    #[tokio::test]
    async fn learned_alias_batch_loads_and_reloads_once() {
        use config::meta::service_identity::{AliasRow, alias_key};
        for conn in sqlite_and_postgres_for_tests("alias_batch").await {
            create_tables_for_tests(&conn).await.unwrap();
            let org = "alias_batch";
            ALIAS_LOAD_COUNTS.remove(org);
            let rows: Vec<_> = (0..8)
                .map(|n| AliasRow {
                    org_id: org.into(),
                    alias_key: alias_key(org, "k8s_workload", "ns", &n.to_string()),
                    canonical: format!("service-{n}"),
                    origin: "learned".into(),
                    status: "active".into(),
                    fencing_token: 10,
                    ..Default::default()
                })
                .collect();
            let mut old_events = 0;
            for row in &rows {
                let mut old = row.clone();
                old.org_id = "alias_batch_old".into();
                old.alias_key = alias_key(&old.org_id, "k8s_workload", "ns", &old.canonical);
                put_aliases_and_reload(&conn, "alias_batch_old", vec![old], true, || {
                    old_events += 1;
                    async { Ok(()) }
                })
                .await
                .unwrap();
            }
            assert_eq!(old_events, 8);
            assert_eq!(*ALIAS_LOAD_COUNTS.get("alias_batch_old").unwrap(), 8);
            ALIAS_LOAD_COUNTS.remove("alias_batch_old");
            let mut events = 0;
            put_aliases_and_reload(&conn, org, rows, true, || {
                events += 1;
                async { Ok(()) }
            })
            .await
            .unwrap();
            assert_eq!(events, 1);
            assert_eq!(*ALIAS_LOAD_COUNTS.get(org).unwrap(), 1);
            assert_eq!(
                infra::table::service_name_aliases::list(&conn, org)
                    .await
                    .unwrap()
                    .len(),
                8
            );
        }
    }

    #[tokio::test]
    async fn learned_aliases_reload_only_when_a_row_changed() {
        use config::meta::service_identity::{AliasRow, alias_key};
        for conn in sqlite_and_postgres_for_tests("alias_learn_unchanged").await {
            create_tables_for_tests(&conn).await.unwrap();
            let org = "alias_learn_unchanged";
            let row = AliasRow {
                org_id: org.into(),
                alias_key: alias_key(org, "k8s_workload", "ns", "checkout"),
                canonical: "checkout".into(),
                origin: "learned".into(),
                status: "active".into(),
                fencing_token: 10,
                updated_at: 100,
                writer_cluster: "c1".into(),
                ..Default::default()
            };
            let mut reloads = 0;
            for rows in [vec![row.clone()], vec![row.clone()], Vec::new()] {
                put_learned_aliases_with(&conn, org, "c1", 10, rows, || {
                    reloads += 1;
                    async { Ok(()) }
                })
                .await
                .unwrap();
            }
            assert_eq!(reloads, 1);
            assert_eq!(
                infra::table::service_name_aliases::list(&conn, org)
                    .await
                    .unwrap()
                    .len(),
                1
            );
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn learner_from_real_pod_rows_writes_and_publishes_alias_put() {
        use config::meta::service_identity::{AliasRow, ServiceIdentityMessage, alias_key};
        use o2_enterprise::enterprise::service_identity::{aliases, signals::mappers::PodRow};
        let pods: Vec<PodRow> = serde_json::from_str(RECORDED_PODS).unwrap();
        assert!(!pods.is_empty());
        let org = "recorded_pod_alias_publish";
        for conn in sqlite_and_postgres_for_tests("recorded_alias_publish").await {
            create_tables_for_tests(&conn).await.unwrap();
            let rows = aliases::learn(&pods, &[])
                .into_iter()
                .map(|row| AliasRow {
                    alias_key: alias_key(org, row.kind.as_str(), &row.scope, &row.alias),
                    org_id: org.into(),
                    kind: row.kind.as_str().into(),
                    scope: row.scope,
                    alias: row.alias,
                    canonical: row.canonical,
                    status: row.status.as_str().into(),
                    origin: row.origin.as_str().into(),
                    confidence: "high".into(),
                    evidence: row.evidence,
                    last_seen: Some(row.last_seen),
                    first_seen: Some(row.last_seen),
                    updated_at: row.last_seen,
                    writer_cluster: "fixture-region".into(),
                    ..Default::default()
                })
                .collect();
            put_aliases_with(&conn, org, rows, true).await.unwrap();
            let persisted = infra::table::service_name_aliases::list(&conn, org)
                .await
                .unwrap();
            assert!(
                persisted
                    .iter()
                    .any(|row| row.alias == "store-workload" && row.canonical == "store")
            );
            let published: Vec<_> = crate::service_identity_sync::take_sent(org)
                .into_iter()
                .flat_map(|message| match message {
                    ServiceIdentityMessage::AliasPut { rows, .. } => rows,
                    _ => Vec::new(),
                })
                .collect();
            assert_eq!(persisted, published);
        }
    }

    #[tokio::test]
    async fn override_event_reloads_cache_for_one_org() {
        for (i, db) in sqlite_and_postgres_for_tests("si_watch")
            .await
            .into_iter()
            .enumerate()
        {
            create_tables_for_tests(&db).await.unwrap();
            let (changed, other) = (format!("si_watch_a{i}"), format!("si_watch_b{i}"));
            reload_org_with(&db, &changed).await;
            reload_org_with(&db, &other).await;
            assert!(Arc::ptr_eq(&cached(&changed), &EMPTY));
            assert!(Arc::ptr_eq(&cached(&other), &EMPTY));

            for org in [&changed, &other] {
                service_identity_rules::upsert(&db, &env_override(org, "production", 10))
                    .await
                    .unwrap();
            }
            let reloaded = on_event_with(&db, &format!("{SERVICE_IDENTITY_WATCH_PREFIX}{changed}"))
                .await
                .unwrap();
            assert_eq!(reloaded.overrides.len(), 1);
            assert_eq!(reloaded.overrides[0].value, "production");
            assert!(Arc::ptr_eq(
                &get_cached_overrides(&changed).await,
                &reloaded
            ));
            assert!(
                Arc::ptr_eq(&cached(&other), &EMPTY),
                "an event for one org leaves the others as cached"
            );

            let rule = env_override(&changed, "", 0).rule_key;
            service_identity_rules::tombstone(&db, &changed, &rule, 20, "c1")
                .await
                .unwrap();
            on_event_with(&db, &format!("{SERVICE_IDENTITY_WATCH_PREFIX}{changed}"))
                .await
                .unwrap();
            assert!(
                Arc::ptr_eq(&cached(&changed), &EMPTY),
                "a tombstoned override is skipped"
            );
            assert!(
                on_event_with(&db, SERVICE_IDENTITY_WATCH_PREFIX)
                    .await
                    .is_none()
            );
        }
    }

    #[tokio::test]
    async fn overlapping_loads_install_in_read_order_and_expire() {
        let org = "si_overlap";
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
        let old = tokio::spawn(async move {
            reload_with(org, || async move {
                entered_tx.send(()).unwrap();
                resume_rx.await.unwrap();
                Ok(vec![env_override(org, "old", 1)])
            })
            .await
        });
        entered_rx.await.unwrap();
        let mut new = tokio::spawn(async move {
            reload_with(org, || async { Ok(vec![env_override(org, "new", 2)]) }).await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut new)
                .await
                .is_err()
        );
        resume_tx.send(()).unwrap();
        old.await.unwrap();
        new.await.unwrap();
        assert_eq!(cached(org).overrides[0].value, "new");
        let entry = IDENTITY_OVERRIDES.get(org).unwrap();
        assert!(
            entry
                .retry_at
                .is_some_and(|at| at <= Instant::now() + RETRY_AFTER)
        );
    }

    #[tokio::test]
    async fn concurrent_misses_share_success_and_failure_backoff() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        for fail in [false, true] {
            let org = format!("si_concurrent_{fail}");
            for expired in [false, true] {
                if expired {
                    IDENTITY_OVERRIDES.get_mut(&org).unwrap().retry_at = Some(Instant::now());
                }
                let gate = LOAD_LOCKS.entry(org.clone()).or_default().clone();
                let guard = gate.lock().await;
                let loads = Arc::new(AtomicUsize::new(0));
                let mut tasks = Vec::new();
                for _ in 0..16 {
                    let org = org.clone();
                    let loads = loads.clone();
                    tasks.push(tokio::spawn(async move {
                        reload_with_mode(&org, false, || async {
                            loads.fetch_add(1, Ordering::SeqCst);
                            if fail {
                                Err(sea_orm::DbErr::Custom("unavailable".into()).into())
                            } else {
                                Ok(vec![env_override(&org, "production", 1)])
                            }
                        })
                        .await
                    }));
                }
                tokio::task::yield_now().await;
                drop(guard);
                for task in tasks {
                    let identity = task.await.unwrap();
                    assert_eq!(identity.overrides.len(), usize::from(!fail));
                }
                assert_eq!(loads.load(Ordering::SeqCst), 1);
            }
        }
    }

    #[tokio::test]
    async fn failed_reload_keeps_the_cached_overrides() {
        let db = sqlite_and_postgres_for_tests("si_fail").await.remove(0);
        create_tables_for_tests(&db).await.unwrap();
        let org = "si_fail_org";
        service_identity_rules::upsert(&db, &env_override(org, "production", 10))
            .await
            .unwrap();
        let loaded = reload_org_with(&db, org).await;
        let broken = sqlite_and_postgres_for_tests("si_fail_broken")
            .await
            .remove(0);
        let kept = reload_org_with(&broken, org).await;
        assert!(Arc::ptr_eq(&kept, &loaded));
        assert!(IDENTITY_OVERRIDES.get(org).unwrap().retry_at.is_some());
    }

    fn admin_alias(
        org: &str,
        alias: &str,
        updated_at: i64,
    ) -> config::meta::service_identity::AliasRow {
        config::meta::service_identity::AliasRow {
            alias_key: config::meta::service_identity::alias_key(org, "rename", "", alias),
            org_id: org.into(),
            kind: "rename".into(),
            alias: alias.into(),
            canonical: "CheckoutService".into(),
            status: "active".into(),
            origin: "manual".into(),
            confidence: "high".into(),
            accepted_by: Some("admin@example.com".into()),
            accepted_at: Some(updated_at),
            created_by: "admin@example.com".into(),
            created_at: updated_at,
            updated_at,
            writer_cluster: "r1".into(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn manual_alias_write_is_one_transaction_and_publishes_alias_put() {
        use config::meta::service_identity::ServiceIdentityMessage;
        let org = "manual_alias_publish";
        for conn in sqlite_and_postgres_for_tests("manual_alias_publish").await {
            create_tables_for_tests(&conn).await.unwrap();
            let rows = vec![
                admin_alias(org, "checkout", 10),
                admin_alias(org, "checkout-svc", 10),
            ];
            let changed = put_manual_aliases_with(&conn, org, &rows).await.unwrap();
            assert_eq!(changed.len(), 2);
            let persisted = infra::table::service_name_aliases::list(&conn, org)
                .await
                .unwrap();
            let published: Vec<_> = crate::service_identity_sync::take_sent(org)
                .into_iter()
                .flat_map(|message| match message {
                    ServiceIdentityMessage::AliasPut { rows, .. } => rows,
                    _ => Vec::new(),
                })
                .collect();
            assert_eq!(persisted, published);
            assert!(
                put_manual_aliases_with(&conn, org, &rows)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(crate::service_identity_sync::take_sent(org).is_empty());
        }
    }

    #[tokio::test]
    async fn alias_delete_tombstones_and_publishes() {
        use config::meta::service_identity::ServiceIdentityMessage;
        let org = "alias_delete_publish";
        for conn in sqlite_and_postgres_for_tests("alias_delete_publish").await {
            create_tables_for_tests(&conn).await.unwrap();
            let row = admin_alias(org, "checkout", 10);
            put_manual_aliases_with(&conn, org, std::slice::from_ref(&row))
                .await
                .unwrap();
            crate::service_identity_sync::take_sent(org);
            assert!(
                delete_alias_with(&conn, org, &row.alias_key, 20, "r1")
                    .await
                    .unwrap()
            );
            let stored = infra::table::service_name_aliases::get(&conn, org, &row.alias_key)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(stored.deleted_at, Some(20));
            let (live, total) = infra::table::service_name_aliases::list_page(
                &conn,
                org,
                &Default::default(),
                50,
                0,
            )
            .await
            .unwrap();
            assert!(live.is_empty() && total == 0);
            let sent = crate::service_identity_sync::take_sent(org);
            assert!(matches!(
                sent.as_slice(),
                [ServiceIdentityMessage::AliasDelete { alias_key, updated_at: 20, .. }] if *alias_key == row.alias_key
            ));
            assert!(
                !delete_alias_with(&conn, org, &row.alias_key, 15, "r1")
                    .await
                    .unwrap()
            );
            assert!(crate::service_identity_sync::take_sent(org).is_empty());
        }
    }

    #[tokio::test]
    async fn coordinator_event_runs_the_display_rebuild_for_its_org() {
        static SEEN: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
        fn record(org: String) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
            Box::pin(async move { SEEN.lock().unwrap().push(org) })
        }
        set_display_rebuild(record);
        for conn in sqlite_and_postgres_for_tests("display_rebuild_event").await {
            create_tables_for_tests(&conn).await.unwrap();
            on_event_with(&conn, "/service_identity/display_event_org")
                .await
                .unwrap();
            assert!(
                on_event_with(&conn, "/service_streams/other")
                    .await
                    .is_none()
            );
        }
        let seen = SEEN.lock().unwrap().clone();
        let conns = sqlite_and_postgres_for_tests("display_rebuild_event_count")
            .await
            .len();
        assert_eq!(
            seen.iter()
                .filter(|org| *org == "display_event_org")
                .count(),
            conns
        );
        assert!(!seen.iter().any(|org| org == "other"));
    }
}
