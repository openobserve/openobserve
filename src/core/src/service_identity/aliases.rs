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

//! Name review alias API: list, create, update, delete, bulk and undo.

#[cfg(feature = "enterprise")]
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    sync::{Arc, LazyLock},
};

#[cfg(feature = "enterprise")]
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use config::meta::service_identity::{AliasRow, WhereSummaryRecord, alias_key};
#[cfg(feature = "enterprise")]
use dashmap::DashMap;
#[cfg(feature = "enterprise")]
use infra::{
    db::get_orm_client_rw,
    table::{
        service_name_aliases::{self, AliasFilter},
        service_streams::{self, ServiceRecord},
        service_where_summary,
    },
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::service_identity::{
    aliases::AliasKind,
    display::{self, Collision, DisplayAlias, DisplayScope},
};
#[cfg(feature = "enterprise")]
use sea_orm::{ConnectionTrait, DatabaseTransaction, TransactionTrait};
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use serde_json::{Value, json};
use utoipa::ToSchema;

#[cfg(feature = "enterprise")]
use super::{
    access,
    api::{error, page, unavailable},
    display_feed,
};

/// One bulk call touches at most this many rows.
pub const MAX_BULK_ROWS: usize = 500;
#[cfg(feature = "enterprise")]
const UNDO_WINDOW_SECS: i64 = 86_400;
#[cfg(feature = "enterprise")]
const MAX_FIELD_BYTES: usize = 256;
#[cfg(feature = "enterprise")]
const KINDS: [&str; 3] = ["rename", "rum_service", "k8s_workload"];
#[cfg(feature = "enterprise")]
const STATUSES: [&str; 4] = ["proposed", "active", "rejected", "accepted"];
#[cfg(feature = "enterprise")]
const CONFIDENCES: [&str; 3] = ["high", "medium", "low"];

// Writers of one org queue here before taking a pooled connection to wait on the database lock.
#[cfg(feature = "enterprise")]
static WRITERS: LazyLock<DashMap<String, Arc<tokio::sync::Mutex<()>>>> =
    LazyLock::new(DashMap::new);

/// POST `/service_identity/aliases`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AliasCreate {
    pub kind: String,
    #[serde(default)]
    pub scope: String,
    pub alias: String,
    pub canonical: String,
    #[serde(default)]
    pub allow_collisions: bool,
}

/// PUT `/service_identity/aliases/{alias_key}`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AliasUpdate {
    pub status: String,
    #[serde(default)]
    pub canonical: Option<String>,
    #[serde(default)]
    pub allow_collisions: bool,
}

/// POST `/service_identity/aliases/_bulk`; exactly one of `alias_keys` and `filter`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AliasBulk {
    pub action: String,
    #[serde(default)]
    pub alias_keys: Option<Vec<String>>,
    #[serde(default)]
    pub filter: Option<AliasBulkFilter>,
    #[serde(default)]
    pub allow_collisions: bool,
}

#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct AliasBulkFilter {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub confidence: Option<String>,
}

/// POST `/service_identity/aliases/_undo`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct AliasUndo {
    pub batch_id: String,
}

/// The persisted inputs a collision check reads under the writer lock.
#[cfg(feature = "enterprise")]
pub struct Committed {
    pub summaries: Vec<WhereSummaryRecord>,
    pub aliases: Vec<AliasRow>,
    pub identities: Vec<ServiceRecord>,
}

/// GET `/service_identity/aliases`.
#[cfg(feature = "enterprise")]
pub async fn list(
    org: &str,
    user: &str,
    params: &BTreeMap<String, String>,
) -> Result<Value, Response> {
    if !access::endpoint(org, user, "GET").await {
        return Err(error(StatusCode::FORBIDDEN, "Unauthorized Access"));
    }
    list_with(get_orm_client_rw().await, org, params).await
}

#[cfg(feature = "enterprise")]
pub async fn list_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    params: &BTreeMap<String, String>,
) -> Result<Value, Response> {
    let filter = parse_filter(params)?;
    let (limit, offset) = page(params, 50)?;
    refresh_conflicts(conn, org).await?;
    let (rows, total) =
        service_name_aliases::list_page(conn, org, &filter, limit as u64, offset as u64)
            .await
            .map_err(unavailable)?;
    Ok(json!({"aliases": rows.iter().map(alias_json).collect::<Vec<_>>(), "total": total}))
}

/// POST `/service_identity/aliases`; 201 with the stored alias.
#[cfg(feature = "enterprise")]
pub async fn create(org: &str, user: &str, request: AliasCreate) -> Result<Value, Response> {
    writer_inputs(org, user).await?;
    let row = create_with(
        get_orm_client_rw().await,
        org,
        user,
        request,
        config::utils::time::now_micros(),
    )
    .await?;
    notify(org).await;
    Ok(alias_json(&row))
}

#[cfg(feature = "enterprise")]
pub async fn create_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    user: &str,
    request: AliasCreate,
    at: i64,
) -> Result<AliasRow, Response> {
    let _writer = writer(org).lock_owned().await;
    let tx = begin_locked(conn, org).await?;
    let (row, changed) = create_locked(&tx, org, user, request, at).await?;
    commit_and_publish(conn, org, tx, changed).await?;
    Ok(row)
}

/// PUT `/service_identity/aliases/{alias_key}`.
#[cfg(feature = "enterprise")]
pub async fn update(
    org: &str,
    user: &str,
    key: &str,
    request: AliasUpdate,
) -> Result<Value, Response> {
    writer_inputs(org, user).await?;
    let row = update_with(
        get_orm_client_rw().await,
        org,
        user,
        key,
        request,
        config::utils::time::now_micros(),
    )
    .await?;
    notify(org).await;
    Ok(alias_json(&row))
}

#[cfg(feature = "enterprise")]
pub async fn update_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    user: &str,
    key: &str,
    request: AliasUpdate,
    at: i64,
) -> Result<AliasRow, Response> {
    let _writer = writer(org).lock_owned().await;
    let tx = begin_locked(conn, org).await?;
    let (row, changed) = update_locked(&tx, org, user, key, request, at).await?;
    commit_and_publish(conn, org, tx, changed).await?;
    Ok(row)
}
/// DELETE `/service_identity/aliases/{alias_key}`: a tombstone plus `AliasDelete`.
#[cfg(feature = "enterprise")]
pub async fn delete(org: &str, user: &str, key: &str) -> Result<(), Response> {
    if !access::endpoint(org, user, "PUT").await {
        return Err(error(StatusCode::FORBIDDEN, "Unauthorized Access"));
    }
    delete_with(
        get_orm_client_rw().await,
        org,
        key,
        config::utils::time::now_micros(),
    )
    .await?;
    notify(org).await;
    Ok(())
}

#[cfg(feature = "enterprise")]
pub async fn delete_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    key: &str,
    at: i64,
) -> Result<(), Response> {
    let stored = live(conn, org, key).await?;
    db::service_identity::delete_alias_with(
        conn,
        org,
        key,
        newer(at, Some(&stored)),
        &config::get_cluster_name(),
    )
    .await
    .map_err(unavailable)?;
    Ok(())
}

/// POST `/service_identity/aliases/_bulk`.
#[cfg(feature = "enterprise")]
pub async fn bulk(org: &str, user: &str, request: AliasBulk) -> Result<Value, Response> {
    writer_inputs(org, user).await?;
    let out = bulk_with(
        get_orm_client_rw().await,
        org,
        user,
        request,
        config::utils::time::now_micros(),
    )
    .await?;
    notify(org).await;
    Ok(out)
}

#[cfg(feature = "enterprise")]
pub async fn bulk_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    user: &str,
    request: AliasBulk,
    at: i64,
) -> Result<Value, Response> {
    let _writer = writer(org).lock_owned().await;
    let tx = begin_locked(conn, org).await?;
    let (out, changed) = bulk_locked(&tx, org, user, request, at).await?;
    commit_and_publish(conn, org, tx, changed).await?;
    Ok(out)
}
/// POST `/service_identity/aliases/_undo`; an unknown or expired batch restores nothing.
#[cfg(feature = "enterprise")]
pub async fn undo(org: &str, user: &str, request: AliasUndo) -> Result<Value, Response> {
    if !access::endpoint(org, user, "PUT").await {
        return Err(error(StatusCode::FORBIDDEN, "Unauthorized Access"));
    }
    let restored = undo_with(
        get_orm_client_rw().await,
        org,
        &request.batch_id,
        config::utils::time::now_micros(),
    )
    .await?;
    if restored > 0 {
        notify(org).await;
    }
    Ok(json!({"restored": restored}))
}

#[cfg(feature = "enterprise")]
pub async fn undo_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    batch_id: &str,
    at: i64,
) -> Result<usize, Response> {
    if !batch_is_fresh(batch_id, at) {
        return Ok(0);
    }
    let _writer = writer(org).lock_owned().await;
    let tx = begin_locked(conn, org).await?;
    let restored =
        service_name_aliases::undo_batch(&tx, org, batch_id, at, &config::get_cluster_name())
            .await
            .map_err(unavailable)?;
    let count = restored.len();
    commit_and_publish(conn, org, tx, restored).await?;
    Ok(count)
}

/// The alias as the API returns it: internal columns removed, `evidence` parsed or null.
#[cfg(feature = "enterprise")]
pub fn alias_json(row: &AliasRow) -> Value {
    let mut value = serde_json::to_value(row).expect("alias serialization");
    if let Some(map) = value.as_object_mut() {
        map.remove("fencing_token");
        map.remove("allow_collisions");
        if row.conflicted {
            map.insert("status".into(), json!("proposed"));
            map.insert("accepted_by".into(), Value::Null);
            map.insert("accepted_at".into(), Value::Null);
        }
        let evidence = row
            .evidence
            .as_deref()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .unwrap_or(Value::Null);
        map.insert("evidence".into(), evidence);
    }
    value
}

/// Collisions that accepting these rows would cause, each row judged in every place it is detected.
#[cfg(feature = "enterprise")]
pub fn collisions_of(rows: &[AliasRow], committed: &Committed) -> Vec<Collision> {
    collisions_in(
        rows,
        &committed.summaries,
        &committed.aliases,
        &committed.identities,
    )
}

/// Live alias keys the collision rule keeps inactive: a row loses only to an accepted earlier row.
#[cfg(feature = "enterprise")]
pub fn conflicted_aliases(
    summaries: &[WhereSummaryRecord],
    aliases: &[AliasRow],
    identities: &[ServiceRecord],
) -> Vec<String> {
    let mut live: Vec<&AliasRow> = aliases
        .iter()
        .filter(|row| row.status == "active" && row.deleted_at.is_none())
        .collect();
    live.sort_by(|a, b| {
        (a.updated_at, &a.writer_cluster, &a.alias_key).cmp(&(
            b.updated_at,
            &b.writer_cluster,
            &b.alias_key,
        ))
    });
    let pairs = collision_pairs(&live, summaries, identities);
    let mut accepted: HashSet<&str> = HashSet::new();
    let mut conflicted = Vec::new();
    for row in live {
        let beaten = pairs
            .get(&row.alias_key)
            .is_some_and(|others| others.iter().any(|other| accepted.contains(other.as_str())));
        if beaten && !row.allow_collisions {
            conflicted.push(row.alias_key.clone());
        } else {
            accepted.insert(&row.alias_key);
        }
    }
    conflicted
}

#[cfg(feature = "enterprise")]
fn collisions_in(
    rows: &[AliasRow],
    summaries: &[WhereSummaryRecord],
    aliases: &[AliasRow],
    identities: &[ServiceRecord],
) -> Vec<Collision> {
    // A flush can add trace names to the shared index mid-check, so judge on a private one.
    let found = display::collisions_with(
        &display_feed::trace_scopes(summaries),
        &display_feed::placed_aliases(aliases, summaries, identities),
        &accepting(rows, summaries, identities),
    );
    let mut merged: Vec<Collision> = Vec::new();
    for collision in found {
        match merged
            .iter_mut()
            .find(|c| c.alias_key == collision.alias_key)
        {
            Some(seen) => {
                seen.existing.extend(collision.existing);
                seen.existing.sort();
                seen.existing.dedup();
                seen.suggested_qualifier = seen
                    .suggested_qualifier
                    .take()
                    .or(collision.suggested_qualifier);
            }
            None => merged.push(collision),
        }
    }
    merged
}

#[cfg(feature = "enterprise")]
fn accepting<'r>(
    rows: impl IntoIterator<Item = &'r AliasRow>,
    summaries: &[WhereSummaryRecord],
    identities: &[ServiceRecord],
) -> Vec<(String, DisplayAlias, DisplayScope)> {
    rows.into_iter()
        .filter_map(|row| Some((row, display_feed::display_alias(row)?)))
        .flat_map(|(row, alias)| {
            let mut places = display_feed::alias_places(row, summaries, identities);
            if places.is_empty() {
                places.push(DisplayScope {
                    service: row.alias.clone(),
                    ..Default::default()
                });
            }
            places
                .into_iter()
                .map(move |scope| (row.alias_key.clone(), alias.clone(), scope))
        })
        .collect()
}

// One private index holds every live row, so a message costs one index build, never one per pair.
#[cfg(feature = "enterprise")]
fn collision_pairs(
    live: &[&AliasRow],
    summaries: &[WhereSummaryRecord],
    identities: &[ServiceRecord],
) -> HashMap<String, BTreeSet<String>> {
    let mut placed = Vec::new();
    let mut owners: HashMap<(String, String), BTreeSet<&str>> = HashMap::new();
    for row in live {
        // The stored flag is this rule's own output, so it must not hide the row from the rule.
        let unflagged = AliasRow {
            conflicted: false,
            ..(*row).clone()
        };
        for alias in display_feed::placed_aliases(&[unflagged], summaries, identities) {
            for namespace in displayer_namespaces(&alias) {
                owners
                    .entry((
                        config::meta::service_identity::service_key(&alias.alias),
                        namespace,
                    ))
                    .or_default()
                    .insert(row.alias_key.as_str());
            }
            placed.push(alias);
        }
    }
    #[cfg(test)]
    tests::INDEX_BUILDS.with(|builds| builds.set(builds.get() + 1));
    let found = display::collisions_with(
        &display_feed::trace_scopes(summaries),
        &placed,
        &accepting(live.iter().copied(), summaries, identities),
    );
    let mut pairs: HashMap<String, BTreeSet<String>> = HashMap::new();
    for collision in found {
        let others: BTreeSet<String> = collision
            .existing
            .iter()
            .filter_map(|scope| {
                owners.get(&(scope.service_key.clone(), scope.scope.trim().to_lowercase()))
            })
            .flatten()
            .filter(|key| **key != collision.alias_key)
            .map(|key| key.to_string())
            .collect();
        pairs.entry(collision.alias_key).or_default().extend(others);
    }
    pairs
}

// The namespaces the display index files an alias under, by its displayers' per-place rule.
#[cfg(feature = "enterprise")]
fn displayer_namespaces(alias: &DisplayAlias) -> Vec<String> {
    let fallback = match alias.kind {
        AliasKind::RumService => "",
        _ => alias.scope.trim(),
    };
    if alias.places.is_empty() {
        return vec![fallback.to_lowercase()];
    }
    alias
        .places
        .iter()
        .map(|place| match place.k8s_namespace.trim() {
            "" => fallback.to_lowercase(),
            namespace => namespace.to_lowercase(),
        })
        .collect()
}

#[cfg(feature = "enterprise")]
async fn create_locked<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    user: &str,
    request: AliasCreate,
    at: i64,
) -> Result<(AliasRow, HashSet<String>), Response> {
    validate(
        &request.kind,
        &request.scope,
        &request.alias,
        &request.canonical,
    )?;
    let key = alias_key(org, &request.kind, &request.scope, &request.alias);
    let stored = service_name_aliases::get(conn, org, &key)
        .await
        .map_err(unavailable)?;
    let row = AliasRow {
        alias_key: key,
        org_id: org.to_string(),
        kind: request.kind,
        scope: request.scope,
        alias: request.alias,
        canonical: request.canonical,
        status: "active".into(),
        origin: "manual".into(),
        confidence: "high".into(),
        accepted_by: Some(user.to_string()),
        accepted_at: Some(at),
        created_by: user.to_string(),
        created_at: at,
        updated_at: newer(at, stored.as_ref()),
        writer_cluster: config::get_cluster_name(),
        fencing_token: stored.as_ref().map_or(0, |row| row.fencing_token),
        first_seen: stored.as_ref().and_then(|row| row.first_seen),
        last_seen: stored.as_ref().and_then(|row| row.last_seen),
        evidence: stored.as_ref().and_then(|row| row.evidence.clone()),
        allow_collisions: request.allow_collisions,
        ..Default::default()
    };
    if !request.allow_collisions {
        let committed = committed(conn, org).await?;
        reject_collisions(std::slice::from_ref(&row), &committed)?;
    }
    written(conn, org, row).await
}

#[cfg(feature = "enterprise")]
async fn update_locked<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    user: &str,
    key: &str,
    request: AliasUpdate,
    at: i64,
) -> Result<(AliasRow, HashSet<String>), Response> {
    let stored = live(conn, org, key).await?;
    let accept = match request.status.as_str() {
        "active" => true,
        "rejected" => false,
        _ => return Err(error(StatusCode::BAD_REQUEST, "invalid alias")),
    };
    let mut row = stored.clone();
    if let Some(canonical) = request.canonical {
        // Kind, scope and alias are the stored identity; only the new name is checked.
        if !sized(&canonical) {
            return Err(error(StatusCode::BAD_REQUEST, "invalid alias"));
        }
        row.canonical = canonical;
    }
    row.status = request.status;
    row.origin = "manual".into();
    row.accepted_by = accept.then(|| user.to_string());
    row.accepted_at = accept.then_some(at);
    row.prev_status = None;
    row.batch_id = None;
    row.updated_at = newer(at, Some(&stored));
    row.writer_cluster = config::get_cluster_name();
    // A reject keeps the stored allowance: the row is inactive and every accept sets it again.
    if accept {
        row.allow_collisions = request.allow_collisions;
    }
    if accept && !request.allow_collisions {
        let committed = committed(conn, org).await?;
        reject_collisions(std::slice::from_ref(&row), &committed)?;
    }
    written(conn, org, row).await
}

#[cfg(feature = "enterprise")]
async fn bulk_locked<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    user: &str,
    request: AliasBulk,
    at: i64,
) -> Result<(Value, HashSet<String>), Response> {
    let accept = match request.action.as_str() {
        "accept" => true,
        "reject" => false,
        _ => return Err(error(StatusCode::BAD_REQUEST, "invalid bulk request")),
    };
    let (rows, truncated) = match (&request.alias_keys, &request.filter) {
        (Some(keys), None) => by_keys(conn, org, keys).await?,
        (None, Some(filter)) => by_filter(conn, org, filter).await?,
        _ => return Err(error(StatusCode::BAD_REQUEST, "invalid bulk request")),
    };
    let batch_id = config::ider::uuid();
    let cluster = config::get_cluster_name();
    let mut next: Vec<AliasRow> = rows
        .iter()
        .filter(|row| changes(row, accept))
        .map(|row| {
            let mut next =
                service_name_aliases::bulk_transition(row, accept, user, &batch_id, at, &cluster);
            if accept {
                next.allow_collisions = request.allow_collisions;
            }
            next
        })
        .collect();
    let collisions = if accept && !request.allow_collisions {
        collisions_of(&next, &committed(conn, org).await?)
    } else {
        Vec::new()
    };
    let colliding: BTreeSet<&str> = collisions.iter().map(|c| c.alias_key.as_str()).collect();
    next.retain(|row| !colliding.contains(row.alias_key.as_str()));
    let changed = write(conn, org, &next).await?;
    let out = json!({
        "changed": next.len(),
        "batch_id": batch_id,
        "skipped_collisions": colliding.len(),
        "collisions": collisions,
        "env_separation": accept,
        "truncated": truncated,
    });
    Ok((out, changed))
}

#[cfg(feature = "enterprise")]
async fn writer_inputs(org: &str, user: &str) -> Result<(), Response> {
    if !access::endpoint(org, user, "PUT").await {
        return Err(error(StatusCode::FORBIDDEN, "Unauthorized Access"));
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn notify(org: &str) {
    if let Err(e) = infra::coordinator::service_identity::emit_reload_event(org).await {
        log::error!("[SERVICE_IDENTITY] alias reload event for org {org} failed: {e}");
    }
    db::service_identity::on_event_with(
        get_orm_client_rw().await,
        &format!("/service_identity/{org}"),
    )
    .await;
}

#[cfg(feature = "enterprise")]
fn writer(org: &str) -> Arc<tokio::sync::Mutex<()>> {
    WRITERS.entry(org.to_string()).or_default().clone()
}

// The database lock lives until commit or rollback, so no lease can lapse between check and write.
#[cfg(feature = "enterprise")]
async fn begin_locked<C: TransactionTrait>(
    conn: &C,
    org: &str,
) -> Result<DatabaseTransaction, Response> {
    let tx = conn.begin().await.map_err(unavailable)?;
    service_name_aliases::lock_org(&tx, org)
        .await
        .map_err(unavailable)?;
    Ok(tx)
}

#[cfg(feature = "enterprise")]
async fn commit_and_publish<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    tx: DatabaseTransaction,
    changed: HashSet<String>,
) -> Result<(), Response> {
    tx.commit().await.map_err(unavailable)?;
    db::service_identity::publish_alias_changes(conn, org, changed)
        .await
        .map_err(unavailable)
}

#[cfg(feature = "enterprise")]
async fn committed<C: ConnectionTrait>(conn: &C, org: &str) -> Result<Committed, Response> {
    let summaries = service_where_summary::list_by_org(conn, org)
        .await
        .map_err(unavailable)?;
    let aliases = service_name_aliases::list(conn, org)
        .await
        .map_err(unavailable)?;
    let identities = service_streams::list_with(conn, org)
        .await
        .map_err(unavailable)?;
    Ok(Committed {
        summaries,
        aliases,
        identities,
    })
}

// Places can change after the last alias write, so a read re-derives the flags it filters on.
#[cfg(feature = "enterprise")]
async fn refresh_conflicts<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
) -> Result<(), Response> {
    let _writer = writer(org).lock_owned().await;
    let tx = begin_locked(conn, org).await?;
    service_name_aliases::recompute_conflicts(&tx, org)
        .await
        .map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)
}

#[cfg(feature = "enterprise")]
async fn write<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    rows: &[AliasRow],
) -> Result<HashSet<String>, Response> {
    if rows.is_empty() {
        return Ok(HashSet::new());
    }
    service_name_aliases::put_manual_batch(conn, org, rows)
        .await
        .map_err(unavailable)
}

// The write re-derives every conflicted flag, so only the stored row says what was committed.
#[cfg(feature = "enterprise")]
async fn written<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    row: AliasRow,
) -> Result<(AliasRow, HashSet<String>), Response> {
    let changed = write(conn, org, std::slice::from_ref(&row)).await?;
    Ok((live(conn, org, &row.alias_key).await?, changed))
}

#[cfg(feature = "enterprise")]
async fn live<C: ConnectionTrait>(conn: &C, org: &str, key: &str) -> Result<AliasRow, Response> {
    service_name_aliases::get(conn, org, key)
        .await
        .map_err(unavailable)?
        .filter(|row| row.deleted_at.is_none())
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "Alias not found"))
}

#[cfg(feature = "enterprise")]
async fn by_keys<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    keys: &[String],
) -> Result<(Vec<AliasRow>, bool), Response> {
    let mut rows = Vec::new();
    for key in keys.iter().collect::<BTreeSet<_>>() {
        if let Some(row) = service_name_aliases::get(conn, org, key)
            .await
            .map_err(unavailable)?
            .filter(|row| row.deleted_at.is_none())
        {
            rows.push(row);
        }
    }
    rows.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.alias_key.cmp(&b.alias_key))
    });
    let truncated = rows.len() > MAX_BULK_ROWS;
    rows.truncate(MAX_BULK_ROWS);
    Ok((rows, truncated))
}

#[cfg(feature = "enterprise")]
async fn by_filter<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    filter: &AliasBulkFilter,
) -> Result<(Vec<AliasRow>, bool), Response> {
    let mut params = BTreeMap::new();
    params.insert(
        "status".to_string(),
        filter.status.clone().unwrap_or_else(|| "proposed".into()),
    );
    if let Some(confidence) = &filter.confidence {
        params.insert("confidence".to_string(), confidence.clone());
    }
    let filter = parse_filter(&params)?;
    let (mut rows, _) =
        service_name_aliases::list_page(conn, org, &filter, MAX_BULK_ROWS as u64 + 1, 0)
            .await
            .map_err(unavailable)?;
    let truncated = rows.len() > MAX_BULK_ROWS;
    rows.truncate(MAX_BULK_ROWS);
    Ok((rows, truncated))
}

#[cfg(feature = "enterprise")]
fn parse_filter(params: &BTreeMap<String, String>) -> Result<AliasFilter, Response> {
    let pick = |name: &str, allowed: &[&str]| -> Result<Option<String>, Response> {
        match params.get(name) {
            None => Ok(None),
            Some(value) if allowed.contains(&value.as_str()) => Ok(Some(value.clone())),
            Some(_) => Err(error(StatusCode::BAD_REQUEST, "invalid filter")),
        }
    };
    Ok(AliasFilter {
        kind: pick("kind", &KINDS)?,
        status: pick("status", &STATUSES)?,
        confidence: pick("confidence", &CONFIDENCES)?,
        q: params.get("q").filter(|q| !q.trim().is_empty()).cloned(),
    })
}

#[cfg(feature = "enterprise")]
fn validate(kind: &str, scope: &str, alias: &str, canonical: &str) -> Result<(), Response> {
    let scope_ok = if kind == "k8s_workload" {
        sized(scope)
    } else {
        scope.is_empty()
    };
    if KINDS.contains(&kind) && scope_ok && sized(alias) && sized(canonical) {
        Ok(())
    } else {
        Err(error(StatusCode::BAD_REQUEST, "invalid alias"))
    }
}

#[cfg(feature = "enterprise")]
fn sized(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_FIELD_BYTES
}

#[cfg(feature = "enterprise")]
fn reject_collisions(rows: &[AliasRow], committed: &Committed) -> Result<(), Response> {
    let collisions = collisions_of(rows, committed);
    if collisions.is_empty() {
        return Ok(());
    }
    Err((
        StatusCode::CONFLICT,
        axum::Json(json!({"error": "alias_collision", "collisions": collisions})),
    )
        .into_response())
}

#[cfg(feature = "enterprise")]
fn changes(row: &AliasRow, accept: bool) -> bool {
    if accept {
        row.status != "active" || row.accepted_by.is_none() || row.conflicted
    } else {
        row.status != "rejected"
    }
}

/// A write always outranks the stored row in last-writer-wins, whatever the clocks say.
#[cfg(feature = "enterprise")]
fn newer(at: i64, stored: Option<&AliasRow>) -> i64 {
    stored.map_or(at, |row| at.max(row.updated_at + 1))
}

#[cfg(feature = "enterprise")]
fn batch_is_fresh(batch_id: &str, at: i64) -> bool {
    use std::str::FromStr;

    use svix_ksuid::KsuidLike;
    svix_ksuid::Ksuid::from_str(batch_id)
        .is_ok_and(|id| at / 1_000_000 - id.timestamp_seconds() <= UNDO_WINDOW_SECS)
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use axum::body::to_bytes;
    use config::meta::service_identity::ServiceIdentityMessage;
    use infra::table::service_versions::{create_tables_for_tests, sqlite_and_postgres_for_tests};

    use super::*;

    thread_local! {
        pub(super) static INDEX_BUILDS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }

    const DAY_US: i64 = 86_400_000_000;

    fn fixture() -> Value {
        display_feed::tests::fixture()
    }

    fn seeded(org: &str) -> Vec<AliasRow> {
        let fixture = fixture();
        let rows = display_feed::tests::aliases(org, &fixture);
        display_feed::rebuild_from(
            org,
            &display_feed::tests::summaries(
                org,
                &fixture,
                config::meta::service_identity::SIGNAL_TRACES,
            ),
            &rows,
        );
        rows
    }

    async fn status_and_body(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }

    fn params(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn by_alias<'a>(rows: &'a [AliasRow], alias: &str) -> &'a AliasRow {
        rows.iter().find(|row| row.alias == alias).unwrap()
    }

    async fn stored(conn: &sea_orm::DatabaseConnection, org: &str, key: &str) -> AliasRow {
        service_name_aliases::get(conn, org, key)
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn undo_after_24h_or_unknown_restores_nothing() {
        let org = "alias_undo_expired";
        let rows = seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_undo_expired").await {
            seed_db(&conn, org).await;
            infra::table::service_name_aliases::put_manual_batch(&conn, org, &rows)
                .await
                .unwrap();
            let at = config::utils::time::now_micros();
            let request = AliasBulk {
                action: "reject".into(),
                alias_keys: Some(vec![by_alias(&rows, "worker").alias_key.clone()]),
                filter: None,
                allow_collisions: false,
            };
            let out = bulk_with(&conn, org, "admin@example.com", request, at)
                .await
                .unwrap();
            assert_eq!(out["changed"], 1);
            let batch = out["batch_id"].as_str().unwrap();
            assert_eq!(
                undo_with(&conn, org, batch, at + DAY_US + 2_000_000)
                    .await
                    .unwrap(),
                0
            );
            assert_eq!(undo_with(&conn, org, "not-a-ksuid", at).await.unwrap(), 0);
            let stored = infra::table::service_name_aliases::list(&conn, org)
                .await
                .unwrap();
            assert_eq!(by_alias(&stored, "worker").status, "rejected");
        }
    }

    #[tokio::test]
    async fn bulk_needs_exactly_one_selector_and_caps_at_500() {
        let org = "alias_bulk_shape";
        seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_bulk_shape").await {
            seed_db(&conn, org).await;
            for (keys, filter) in [
                (None, None),
                (Some(vec![]), Some(AliasBulkFilter::default())),
            ] {
                let request = AliasBulk {
                    action: "accept".into(),
                    alias_keys: keys,
                    filter,
                    allow_collisions: false,
                };
                let error = bulk_with(&conn, org, "a", request, 1).await.unwrap_err();
                assert_eq!(status_and_body(error).await.0, StatusCode::BAD_REQUEST);
            }
            let many: Vec<AliasRow> = (0..MAX_BULK_ROWS + 1)
                .map(|i| AliasRow {
                    alias_key: alias_key(org, "rename", "", &format!("old-{i}")),
                    org_id: org.into(),
                    kind: "rename".into(),
                    alias: format!("old-{i}"),
                    canonical: format!("new-{i}"),
                    status: "proposed".into(),
                    origin: "learned".into(),
                    confidence: "low".into(),
                    updated_at: 5,
                    ..Default::default()
                })
                .collect();
            infra::table::service_name_aliases::put_manual_batch(&conn, org, &many)
                .await
                .unwrap();
            let request = AliasBulk {
                action: "reject".into(),
                alias_keys: None,
                filter: Some(AliasBulkFilter {
                    status: Some("proposed".into()),
                    confidence: Some("low".into()),
                }),
                allow_collisions: false,
            };
            let out = bulk_with(&conn, org, "a", request, 10).await.unwrap();
            assert_eq!(
                (out["changed"].as_u64(), out["truncated"].as_bool()),
                (Some(500), Some(true))
            );
        }
    }

    #[tokio::test]
    async fn accepted_filter_lists_admin_accepts_and_hides_internal_columns() {
        let org = "alias_accepted_filter";
        let rows = seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_accepted_filter").await {
            seed_db(&conn, org).await;
            let mut with_evidence = rows.clone();
            with_evidence[0].evidence = Some(r#"{"services":["a","b"]}"#.into());
            with_evidence[0].fencing_token = 7;
            infra::table::service_name_aliases::put_manual_batch(&conn, org, &with_evidence)
                .await
                .unwrap();
            let target = by_alias(&rows, "worker").alias_key.clone();
            let update = AliasUpdate {
                status: "active".into(),
                canonical: None,
                allow_collisions: false,
            };
            update_with(&conn, org, "admin@example.com", &target, update, 20)
                .await
                .unwrap();
            let listed = list_with(&conn, org, &params(&[("status", "accepted")]))
                .await
                .unwrap();
            assert_eq!(listed["total"], 1);
            assert_eq!(listed["aliases"][0]["alias_key"], target);
            let all = list_with(&conn, org, &params(&[("limit", "500")]))
                .await
                .unwrap();
            for alias in all["aliases"].as_array().unwrap() {
                assert!(alias.get("fencing_token").is_none());
                assert!(alias.get("allow_collisions").is_none());
                assert!(alias["evidence"].is_null() || alias["evidence"].is_object());
            }
            assert!(
                all["aliases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|a| a["evidence"]["services"][1] == "b")
            );
            for bad in [
                ("status", "accepted_maybe"),
                ("kind", "pod"),
                ("confidence", "certain"),
            ] {
                let error = list_with(&conn, org, &params(&[bad])).await.unwrap_err();
                assert_eq!(
                    status_and_body(error).await,
                    (
                        StatusCode::BAD_REQUEST,
                        serde_json::json!({"error": "invalid filter"})
                    )
                );
            }
        }
    }

    #[tokio::test]
    async fn admin_put_sets_origin_manual_and_the_learner_leaves_it() {
        let org = "alias_admin_put";
        let rows = seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_admin_put").await {
            seed_db(&conn, org).await;
            infra::table::service_name_aliases::put_manual_batch(&conn, org, &rows)
                .await
                .unwrap();
            let target = by_alias(&rows, "worker").clone();
            let update = AliasUpdate {
                status: "active".into(),
                canonical: Some("report-worker".into()),
                allow_collisions: false,
            };
            let put = update_with(
                &conn,
                org,
                "admin@example.com",
                &target.alias_key,
                update,
                50,
            )
            .await
            .unwrap();
            assert_eq!(
                (put.origin.as_str(), put.canonical.as_str()),
                ("manual", "report-worker")
            );
            let learned = AliasRow {
                canonical: "billing-worker".into(),
                status: "proposed".into(),
                origin: "learned".into(),
                last_seen: Some(900),
                updated_at: 900,
                fencing_token: 99,
                ..target.clone()
            };
            infra::table::service_name_aliases::upsert_learned(&conn, &learned)
                .await
                .unwrap();
            let stored = infra::table::service_name_aliases::get(&conn, org, &target.alias_key)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                (
                    stored.status.as_str(),
                    stored.canonical.as_str(),
                    stored.origin.as_str()
                ),
                ("active", "report-worker", "manual")
            );
            assert_eq!(stored.last_seen, Some(900));
        }
    }

    #[tokio::test]
    async fn create_validates_rejects_collisions_unless_allowed_and_delete_tombstones() {
        let org = "alias_create_flow";
        seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_create_flow").await {
            seed_db(&conn, org).await;
            let create =
                |kind: &str, scope: &str, alias: &str, canonical: &str, allow| AliasCreate {
                    kind: kind.into(),
                    scope: scope.into(),
                    alias: alias.into(),
                    canonical: canonical.into(),
                    allow_collisions: allow,
                };
            let long = "x".repeat(257);
            for bad in [
                create("pod", "", "a", "b", false),
                create("rename", "shop", "a", "b", false),
                create("k8s_workload", "", "a", "b", false),
                create("rename", "", "", "b", false),
                create("rename", "", "a", &long, false),
            ] {
                let error = create_with(&conn, org, "a", bad, 1).await.unwrap_err();
                assert_eq!(
                    status_and_body(error).await,
                    (
                        StatusCode::BAD_REQUEST,
                        serde_json::json!({"error": "invalid alias"})
                    )
                );
            }
            let collide = create("k8s_workload", "pentest", "alertquerier", "querier", false);
            let error = create_with(&conn, org, "a", collide, 2).await.unwrap_err();
            let (status, body) = status_and_body(error).await;
            assert_eq!(status, StatusCode::CONFLICT);
            assert_eq!(body["error"], "alias_collision");
            assert_eq!(body["collisions"][0]["suggested_qualifier"], "pentest");
            let allowed = create("k8s_workload", "pentest", "alertquerier", "querier", true);
            let row = create_with(&conn, org, "admin@example.com", allowed, 3)
                .await
                .unwrap();
            assert_eq!(
                (
                    row.origin.as_str(),
                    row.status.as_str(),
                    row.confidence.as_str()
                ),
                ("manual", "active", "high")
            );
            assert_eq!(row.accepted_by.as_deref(), Some("admin@example.com"));
            delete_with(&conn, org, &row.alias_key, 4).await.unwrap();
            let error = delete_with(&conn, org, &row.alias_key, 5)
                .await
                .unwrap_err();
            assert_eq!(status_and_body(error).await.0, StatusCode::NOT_FOUND);
        }
    }

    async fn seed_db(conn: &sea_orm::DatabaseConnection, org: &str) {
        create_tables_for_tests(conn).await.unwrap();
        service_streams::create_table_for_tests(conn).await.unwrap();
        let fixture = fixture();
        let mut rows = display_feed::tests::summaries(
            org,
            &fixture,
            config::meta::service_identity::SIGNAL_TRACES,
        );
        for (i, row) in rows.iter_mut().enumerate() {
            row.summary_key = format!("s{i}");
        }
        service_where_summary::upsert_many(conn, rows)
            .await
            .unwrap();
        service_streams::insert_for_tests(conn, &display_feed::tests::records(org, &fixture))
            .await
            .unwrap();
    }

    async fn add_identity(
        conn: &sea_orm::DatabaseConnection,
        org: &str,
        service: &str,
        namespace: &str,
        workload: Option<&str>,
        env: Option<&str>,
    ) {
        let mut dims = serde_json::json!({"k8s-cluster": "stage8", "k8s-namespace": namespace});
        if let Some(workload) = workload {
            dims["k8s-deployment"] = serde_json::json!(workload);
        }
        let row = serde_json::json!({"service_name": service, "disambiguation": dims, "all_dimensions": dims});
        let record = display_feed::tests::record(org, &format!("id-{service}"), &row);
        service_streams::insert_for_tests(conn, &[record])
            .await
            .unwrap();
        if let Some(env) = env {
            let scopes = serde_json::json!({"trace_scopes": [{"service": service, "env": env, "k8s_namespace": namespace}]});
            let mut rows = display_feed::tests::summaries(org, &scopes, "rum");
            rows[0].summary_key = format!("rum-{service}");
            service_where_summary::upsert_many(conn, rows)
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn undo_restores_only_rows_still_holding_the_batch_revision() {
        let org = "alias_undo_interleaved";
        let rows = seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_undo_interleaved").await {
            seed_db(&conn, org).await;
            service_name_aliases::put_manual_batch(&conn, org, &rows)
                .await
                .unwrap();
            let key = |alias: &str| by_alias(&rows, alias).alias_key.clone();
            let at = config::utils::time::now_micros();
            let names = ["cart", "checkout", "inventory", "payments", "ingester"];
            let reject = AliasBulk {
                action: "reject".into(),
                alias_keys: Some(names.iter().map(|n| key(n)).collect()),
                filter: None,
                allow_collisions: false,
            };
            let first = bulk_with(&conn, org, "admin@example.com", reject, at)
                .await
                .unwrap();
            assert_eq!(first["changed"], 5);
            let batch = first["batch_id"].as_str().unwrap().to_string();
            // Read before the later writes commit; undoing this snapshot must keep them.
            let stale = service_name_aliases::list_batch(&conn, org, &batch)
                .await
                .unwrap();
            assert_eq!(stale.len(), 5);
            let edit = AliasUpdate {
                status: "active".into(),
                canonical: Some("CartServiceRenamed".into()),
                allow_collisions: true,
            };
            update_with(
                &conn,
                org,
                "editor@example.com",
                &key("cart"),
                edit,
                at + 10,
            )
            .await
            .unwrap();
            let rebatch = AliasBulk {
                action: "accept".into(),
                alias_keys: Some(vec![key("checkout")]),
                filter: None,
                allow_collisions: true,
            };
            let second = bulk_with(&conn, org, "admin@example.com", rebatch, at + 20)
                .await
                .unwrap();
            delete_with(&conn, org, &key("inventory"), at + 30)
                .await
                .unwrap();
            let current = service_name_aliases::list(&conn, org).await.unwrap();
            let mut remote = by_alias(&current, "ingester").clone();
            remote.canonical = "ingester-remote".into();
            remote.batch_id = None;
            remote.prev_status = None;
            remote.updated_at = at + 1_000_000;
            remote.writer_cluster = "other-region".into();
            db::service_identity::put_aliases_with(&conn, org, vec![remote], false)
                .await
                .unwrap();
            let mut seen = by_alias(&current, "payments").clone();
            seen.last_seen = Some(at + 40);
            seen.fencing_token += 1;
            db::service_identity::put_aliases_with(&conn, org, vec![seen], true)
                .await
                .unwrap();
            let restored =
                service_name_aliases::restore_batch(&conn, org, &batch, &stale, at + 50, "local")
                    .await
                    .unwrap();
            assert_eq!(restored, std::collections::HashSet::from([key("payments")]));
            let after = service_name_aliases::list(&conn, org).await.unwrap();
            let cart = by_alias(&after, "cart");
            assert_eq!(
                (cart.status.as_str(), cart.canonical.as_str()),
                ("active", "CartServiceRenamed")
            );
            assert_eq!(cart.accepted_by.as_deref(), Some("editor@example.com"));
            let checkout = by_alias(&after, "checkout");
            assert_eq!(checkout.status, "active");
            assert_eq!(checkout.batch_id.as_deref(), second["batch_id"].as_str());
            assert!(by_alias(&after, "inventory").deleted_at.is_some());
            let ingester = by_alias(&after, "ingester");
            assert_eq!(
                (ingester.canonical.as_str(), ingester.status.as_str()),
                ("ingester-remote", "rejected")
            );
            let payments = by_alias(&after, "payments");
            assert_eq!(
                (payments.status.as_str(), payments.batch_id.as_deref()),
                ("active", None)
            );
            assert_eq!(payments.last_seen, Some(at + 40));
            assert_eq!(undo_with(&conn, org, &batch, at + 60).await.unwrap(), 0);
        }
    }

    #[tokio::test]
    async fn editing_a_learned_scoped_rename_keeps_its_identity() {
        let org = "alias_edit_scoped_rename";
        let rows = seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_edit_scoped_rename").await {
            seed_db(&conn, org).await;
            service_name_aliases::put_manual_batch(&conn, org, &rows)
                .await
                .unwrap();
            let learned = by_alias(&rows, "stock-svc");
            assert_eq!(
                (learned.kind.as_str(), learned.scope.as_str()),
                ("rename", "shop")
            );
            let edit = |canonical: &str| AliasUpdate {
                status: "active".into(),
                canonical: Some(canonical.into()),
                allow_collisions: false,
            };
            let row = update_with(&conn, org, "a", &learned.alias_key, edit("Warehouse"), 20)
                .await
                .unwrap();
            assert_eq!(
                (
                    row.kind.as_str(),
                    row.scope.as_str(),
                    row.canonical.as_str()
                ),
                ("rename", "shop", "Warehouse")
            );
            let error = update_with(&conn, org, "a", &learned.alias_key, edit(" "), 21)
                .await
                .unwrap_err();
            assert_eq!(status_and_body(error).await.0, StatusCode::BAD_REQUEST);
        }
    }

    #[tokio::test]
    async fn collisions_use_the_detected_identity_place() {
        let org = "alias_detected_place";
        seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_detected_place").await {
            seed_db(&conn, org).await;
            add_identity(&conn, org, "legacy-api", "pentest", None, None).await;
            add_identity(
                &conn,
                org,
                "checkout-canary",
                "shop",
                Some("canary"),
                Some("staging"),
            )
            .await;
            let post = |kind: &str, scope: &str, alias: &str, canonical: &str, allow| AliasCreate {
                kind: kind.into(),
                scope: scope.into(),
                alias: alias.into(),
                canonical: canonical.into(),
                allow_collisions: allow,
            };
            let rename = post("rename", "", "legacy-api", "CartService", false);
            let (status, body) =
                status_and_body(create_with(&conn, org, "a", rename, 1).await.unwrap_err()).await;
            assert_eq!(status, StatusCode::CONFLICT);
            assert_eq!(body["collisions"][0]["suggested_qualifier"], "pentest");
            let canary = post("k8s_workload", "shop", "canary", "CheckoutService", false);
            let (status, body) =
                status_and_body(create_with(&conn, org, "a", canary, 2).await.unwrap_err()).await;
            assert_eq!(status, StatusCode::CONFLICT);
            assert_eq!(body["collisions"][0]["suggested_qualifier"], "staging");
            let proposed = AliasRow {
                alias_key: alias_key(org, "rename", "", "legacy-api"),
                org_id: org.into(),
                kind: "rename".into(),
                alias: "legacy-api".into(),
                canonical: "CartService".into(),
                status: "proposed".into(),
                origin: "learned".into(),
                confidence: "high".into(),
                created_by: "system".into(),
                writer_cluster: "fixture-region".into(),
                updated_at: 1,
                ..Default::default()
            };
            service_name_aliases::put_manual_batch(&conn, org, std::slice::from_ref(&proposed))
                .await
                .unwrap();
            let activate = AliasUpdate {
                status: "active".into(),
                canonical: None,
                allow_collisions: false,
            };
            let error = update_with(&conn, org, "a", &proposed.alias_key, activate, 3)
                .await
                .unwrap_err();
            assert_eq!(status_and_body(error).await.0, StatusCode::CONFLICT);
            let accept = AliasBulk {
                action: "accept".into(),
                alias_keys: Some(vec![proposed.alias_key.clone()]),
                filter: None,
                allow_collisions: false,
            };
            let out = bulk_with(&conn, org, "a", accept, 4).await.unwrap();
            assert_eq!(out["skipped_collisions"], 1);
            let anyway = post("rename", "", "legacy-api", "CartService", true);
            create_with(&conn, org, "a", anyway, 5).await.unwrap();
            add_identity(&conn, org, "web-frontend", "", None, Some("staging")).await;
            let rum = post("rum_service", "", "web-frontend", "InventoryService", false);
            let (status, body) =
                status_and_body(create_with(&conn, org, "a", rum, 6).await.unwrap_err()).await;
            assert_eq!(status, StatusCode::CONFLICT);
            assert_eq!(body["collisions"][0]["suggested_qualifier"], "staging");
            for (kind, scope, alias, canonical, at) in [
                ("k8s_workload", "shop", "canary", "CheckoutService", 7),
                ("rum_service", "", "web-frontend", "InventoryService", 8),
            ] {
                create_with(
                    &conn,
                    org,
                    "a",
                    post(kind, scope, alias, canonical, true),
                    at,
                )
                .await
                .unwrap();
            }
            let snapshot = committed(&conn, org).await.unwrap();
            display_feed::rebuild_placed(
                org,
                &snapshot.summaries,
                &snapshot.aliases,
                &snapshot.identities,
            );
            let shown =
                |key: &str, place: Value| display_feed::display_of(org, key, &place, &place);
            let pentest = shown(
                "legacy-api",
                serde_json::json!({"k8s-cluster": "stage8", "k8s-namespace": "pentest"}),
            );
            assert_eq!(pentest.display_name.as_deref(), Some("CartService"));
            assert_eq!(pentest.display_qualifier.as_deref(), Some("pentest"));
            let shop = serde_json::json!({"k8s-cluster": "stage8", "k8s-namespace": "shop"});
            let mut canary_place = shop.clone();
            canary_place["k8s-deployment"] = serde_json::json!("canary");
            let canary = shown("checkout-canary", canary_place);
            assert_eq!(canary.display_name.as_deref(), Some("CheckoutService"));
            assert_eq!(canary.display_qualifier.as_deref(), Some("staging"));
            let trace = shown("CheckoutService", shop.clone());
            assert_eq!(trace.display_qualifier.as_deref(), Some("prod"));
            let web = shown("web-frontend", serde_json::json!({}));
            assert_eq!(web.display_name.as_deref(), Some("InventoryService"));
            assert_eq!(web.display_qualifier.as_deref(), Some("staging"));
            let inventory = shown("InventoryService", shop);
            assert_eq!(inventory.display_qualifier.as_deref(), Some("prod"));
        }
    }

    #[tokio::test]
    async fn collision_checks_read_committed_aliases_and_fail_closed() {
        let org = "alias_committed_collisions";
        seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_committed_collisions").await {
            seed_db(&conn, org).await;
            for team in ["a", "b", "c"] {
                let (service, ns, workload) = (
                    format!("svc-{team}"),
                    format!("team-{team}"),
                    format!("api-{team}"),
                );
                add_identity(&conn, org, &service, &ns, Some(&workload), None).await;
            }
            let post = |team: &str, canonical: &str| AliasCreate {
                kind: "k8s_workload".into(),
                scope: format!("team-{team}"),
                alias: format!("api-{team}"),
                canonical: canonical.into(),
                allow_collisions: false,
            };
            create_with(&conn, org, "a", post("a", "LedgerService"), 1)
                .await
                .unwrap();
            // No index refresh runs between the two writes.
            let error = create_with(&conn, org, "a", post("b", "LedgerService"), 2)
                .await
                .unwrap_err();
            assert_eq!(status_and_body(error).await.0, StatusCode::CONFLICT);
            let (b, c) = tokio::join!(
                create_with(&conn, org, "a", post("b", "AuditService"), 3),
                create_with(&conn, org, "a", post("c", "AuditService"), 4),
            );
            assert_eq!([b.is_ok(), c.is_ok()].iter().filter(|ok| **ok).count(), 1);
        }
        for conn in sqlite_and_postgres_for_tests("alias_committed_snapshot").await {
            seed_db(&conn, org).await;
            let row = |team: &str| AliasRow {
                alias_key: alias_key(
                    org,
                    "k8s_workload",
                    &format!("team-{team}"),
                    &format!("api-{team}"),
                ),
                org_id: org.into(),
                kind: "k8s_workload".into(),
                scope: format!("team-{team}"),
                alias: format!("api-{team}"),
                canonical: "LedgerService".into(),
                status: "active".into(),
                origin: "manual".into(),
                updated_at: 1,
                ..Default::default()
            };
            for team in ["a", "d"] {
                let (service, ns, workload) = (
                    format!("svc-{team}"),
                    format!("team-{team}"),
                    format!("api-{team}"),
                );
                add_identity(&conn, org, &service, &ns, Some(&workload), None).await;
            }
            service_name_aliases::put_manual_batch(&conn, org, &[row("a")])
                .await
                .unwrap();
            let snapshot = committed(&conn, org).await.unwrap();
            let accepting = row("d");
            let older = std::thread::spawn(move || {
                for _ in 0..200 {
                    display_feed::rebuild_from(org, &[], &[]);
                }
            });
            for _ in 0..200 {
                let found = collisions_of(std::slice::from_ref(&accepting), &snapshot);
                assert_eq!(found.len(), 1);
            }
            older.join().unwrap();
        }
        for conn in sqlite_and_postgres_for_tests("alias_committed_bare").await {
            create_tables_for_tests(&conn).await.unwrap();
            let request = AliasCreate {
                kind: "k8s_workload".into(),
                scope: "team-z".into(),
                alias: "api-z".into(),
                canonical: "LedgerService".into(),
                allow_collisions: false,
            };
            let error = create_with(&conn, org, "a", request, 5).await.unwrap_err();
            assert_eq!(
                status_and_body(error).await.0,
                StatusCode::SERVICE_UNAVAILABLE
            );
        }
    }

    #[tokio::test]
    async fn a_trace_name_flushed_before_the_check_cannot_hide_a_collision() {
        let org = "alias_flush_interleaving";
        seeded(org);
        let flush = || display::apply_names(org, &["Api".to_string()]);
        for conn in sqlite_and_postgres_for_tests("alias_flush_interleaving").await {
            seed_db(&conn, org).await;
            add_identity(&conn, org, "api-a", "team-a", None, None).await;
            add_identity(&conn, org, "api-b", "team-b", None, None).await;
            let post = |alias: &str| AliasCreate {
                kind: "rename".into(),
                scope: String::new(),
                alias: alias.into(),
                canonical: "Api.service".into(),
                allow_collisions: false,
            };
            create_with(&conn, org, "a", post("api-a"), 1)
                .await
                .unwrap();
            let snapshot = committed(&conn, org).await.unwrap();
            display_feed::rebuild_placed(
                org,
                &snapshot.summaries,
                &snapshot.aliases,
                &snapshot.identities,
            );
            flush();
            let error = create_with(&conn, org, "a", post("api-b"), 2)
                .await
                .unwrap_err();
            let (status, body) = status_and_body(error).await;
            assert_eq!(status, StatusCode::CONFLICT);
            assert_eq!(body["collisions"][0]["existing"][0]["service_key"], "api-a");
            assert_eq!(body["collisions"][0]["existing"][0]["scope"], "team-a");
            let proposed = AliasRow {
                alias_key: alias_key(org, "rename", "", "api-b"),
                org_id: org.into(),
                kind: "rename".into(),
                alias: "api-b".into(),
                canonical: "Api.service".into(),
                status: "proposed".into(),
                origin: "learned".into(),
                confidence: "high".into(),
                created_by: "system".into(),
                writer_cluster: "fixture-region".into(),
                updated_at: 3,
                ..Default::default()
            };
            service_name_aliases::put_manual_batch(&conn, org, std::slice::from_ref(&proposed))
                .await
                .unwrap();
            flush();
            let activate = AliasUpdate {
                status: "active".into(),
                canonical: None,
                allow_collisions: false,
            };
            let error = update_with(&conn, org, "a", &proposed.alias_key, activate, 4)
                .await
                .unwrap_err();
            assert_eq!(status_and_body(error).await.0, StatusCode::CONFLICT);
            flush();
            let accept = AliasBulk {
                action: "accept".into(),
                alias_keys: Some(vec![proposed.alias_key.clone()]),
                filter: None,
                allow_collisions: false,
            };
            let out = bulk_with(&conn, org, "a", accept, 5).await.unwrap();
            assert_eq!(out["skipped_collisions"], 1);
            assert_eq!(out["changed"], 0);
        }
    }

    #[tokio::test]
    async fn accepting_with_collisions_allowed_stores_it_and_a_plain_accept_clears_it() {
        let org = "alias_allow_stored";
        seeded(org);
        for conn in sqlite_and_postgres_for_tests("alias_allow_stored").await {
            seed_db(&conn, org).await;
            let create = AliasCreate {
                kind: "rename".into(),
                scope: String::new(),
                alias: "solo-legacy".into(),
                canonical: "SoloService".into(),
                allow_collisions: true,
            };
            let row = create_with(&conn, org, "admin", create, 1).await.unwrap();
            let key = row.alias_key.clone();
            assert!(row.allow_collisions);
            assert!(stored(&conn, org, &key).await.allow_collisions);
            let put = |status: &str, canonical: Option<&str>, allow| AliasUpdate {
                status: status.into(),
                canonical: canonical.map(Into::into),
                allow_collisions: allow,
            };
            let edit = put("active", Some("SoloRenamedService"), false);
            update_with(&conn, org, "admin", &key, edit, 2)
                .await
                .unwrap();
            assert!(!stored(&conn, org, &key).await.allow_collisions);
            update_with(&conn, org, "admin", &key, put("active", None, true), 3)
                .await
                .unwrap();
            assert!(stored(&conn, org, &key).await.allow_collisions);
            update_with(&conn, org, "admin", &key, put("rejected", None, false), 4)
                .await
                .unwrap();
            let rejected = stored(&conn, org, &key).await;
            assert_eq!(
                (rejected.status.as_str(), rejected.allow_collisions),
                ("rejected", true)
            );
            let bulk = |allow| AliasBulk {
                action: "accept".into(),
                alias_keys: Some(vec![key.clone()]),
                filter: None,
                allow_collisions: allow,
            };
            let out = bulk_with(&conn, org, "admin", bulk(false), 5)
                .await
                .unwrap();
            assert_eq!(out["changed"], 1);
            assert!(!stored(&conn, org, &key).await.allow_collisions);
            let learned = AliasRow {
                alias_key: alias_key(org, "rename", "", "solo-learned"),
                org_id: org.into(),
                kind: "rename".into(),
                alias: "solo-learned".into(),
                canonical: "SoloLearnedService".into(),
                status: "proposed".into(),
                origin: "learned".into(),
                confidence: "high".into(),
                updated_at: 1,
                writer_cluster: "region-a".into(),
                ..Default::default()
            };
            service_name_aliases::put_manual_batch(&conn, org, std::slice::from_ref(&learned))
                .await
                .unwrap();
            let at = config::utils::time::now_micros();
            let accept = AliasBulk {
                alias_keys: Some(vec![learned.alias_key.clone()]),
                ..bulk(true)
            };
            let out = bulk_with(&conn, org, "admin", accept, at).await.unwrap();
            assert!(
                stored(&conn, org, &learned.alias_key)
                    .await
                    .allow_collisions
            );
            let batch = out["batch_id"].as_str().unwrap();
            assert_eq!(undo_with(&conn, org, batch, at + 1).await.unwrap(), 1);
            let undone = stored(&conn, org, &learned.alias_key).await;
            assert_eq!(
                (undone.status.as_str(), undone.allow_collisions),
                ("proposed", false)
            );
        }
    }

    #[tokio::test]
    async fn every_alias_writer_waits_for_the_org_lock_another_node_holds() {
        use sea_orm::TransactionTrait;
        let org = "alias_database_lock";
        seeded(org);
        let wait = std::time::Duration::from_millis(500);
        for conn in sqlite_and_postgres_for_tests("alias_database_lock").await {
            if conn.get_database_backend() != sea_orm::DatabaseBackend::Postgres {
                continue;
            }
            seed_db(&conn, org).await;
            for team in ["a", "b"] {
                let (service, ns, workload) = (
                    format!("svc-{team}"),
                    format!("team-{team}"),
                    format!("api-{team}"),
                );
                add_identity(&conn, org, &service, &ns, Some(&workload), None).await;
            }
            let holder = conn.begin().await.unwrap();
            service_name_aliases::lock_org(&holder, org).await.unwrap();
            let request = AliasCreate {
                kind: "k8s_workload".into(),
                scope: "team-b".into(),
                alias: "api-b".into(),
                canonical: "LedgerService".into(),
                allow_collisions: false,
            };
            let mut waiting = std::pin::pin!(create_with(&conn, org, "b", request, 2));
            let early = tokio::time::timeout(wait, &mut waiting).await;
            assert!(
                early.is_err(),
                "a writer waits while another holds the lock"
            );
            let theirs = AliasRow {
                alias_key: alias_key(org, "k8s_workload", "team-a", "api-a"),
                org_id: org.into(),
                kind: "k8s_workload".into(),
                scope: "team-a".into(),
                alias: "api-a".into(),
                canonical: "LedgerService".into(),
                status: "active".into(),
                origin: "manual".into(),
                updated_at: 1,
                ..Default::default()
            };
            service_name_aliases::put_manual_batch(&holder, org, std::slice::from_ref(&theirs))
                .await
                .unwrap();
            holder.commit().await.unwrap();
            let error = waiting.await.unwrap_err();
            assert_eq!(status_and_body(error).await.0, StatusCode::CONFLICT);

            let learned = [AliasRow {
                alias_key: alias_key(org, "k8s_workload", "team-b", "api-b"),
                origin: "learned".into(),
                status: "proposed".into(),
                scope: "team-b".into(),
                alias: "api-b".into(),
                updated_at: 3,
                ..theirs.clone()
            }];
            let message = config::meta::service_identity::ServiceIdentityMessage::AliasPut {
                org_id: org.into(),
                rows: vec![AliasRow {
                    updated_at: 4,
                    writer_cluster: "other-region".into(),
                    ..theirs.clone()
                }],
            };
            let holder = conn.begin().await.unwrap();
            service_name_aliases::lock_org(&holder, org).await.unwrap();
            let mut learner = std::pin::pin!(service_name_aliases::put_learned_batch(
                &conn, "zo1", 1, &learned
            ));
            let mut replica = std::pin::pin!(db::service_identity_sync::apply_remote_with(
                &conn, org, message
            ));
            assert!(tokio::time::timeout(wait, &mut learner).await.is_err());
            assert!(tokio::time::timeout(wait, &mut replica).await.is_err());
            holder.commit().await.unwrap();
            learner.await.unwrap();
            replica.await.unwrap();
        }
    }

    fn workload(org: &str, name: &str, ns: &str, at: i64, cluster: &str, allow: bool) -> AliasRow {
        AliasRow {
            alias_key: alias_key(org, "k8s_workload", ns, name),
            org_id: org.into(),
            kind: "k8s_workload".into(),
            scope: ns.into(),
            alias: name.into(),
            canonical: "LedgerService".into(),
            status: "active".into(),
            origin: "manual".into(),
            confidence: "high".into(),
            accepted_by: Some("admin".into()),
            accepted_at: Some(at),
            created_by: "admin".into(),
            updated_at: at,
            writer_cluster: cluster.into(),
            allow_collisions: allow,
            ..Default::default()
        }
    }

    fn permutations(n: usize) -> Vec<Vec<usize>> {
        if n == 0 {
            return vec![Vec::new()];
        }
        let mut out = Vec::new();
        for shorter in permutations(n - 1) {
            for at in 0..=shorter.len() {
                let mut next = shorter.clone();
                next.insert(at, n - 1);
                out.push(next);
            }
        }
        out
    }

    async fn listed_names(
        conn: &sea_orm::DatabaseConnection,
        org: &str,
        status: &str,
    ) -> BTreeSet<String> {
        let listed = list_with(conn, org, &params(&[("limit", "1000"), ("status", status)]))
            .await
            .unwrap();
        listed["aliases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|alias| alias["alias"].as_str().unwrap().to_string())
            .collect()
    }

    async fn apply_puts(conn: &sea_orm::DatabaseConnection, org: &str, rows: &[&AliasRow]) {
        for row in rows {
            let put = ServiceIdentityMessage::AliasPut {
                org_id: org.into(),
                rows: vec![(*row).clone()],
            };
            db::service_identity_sync::apply_remote_with(conn, org, put)
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn colliding_aliases_converge_on_the_greedy_set_in_every_arrival_order() {
        let org = "alias_greedy_converge";
        seeded(org);
        display_feed::init();
        let w = |name: &str, ns: &str, at: i64, cluster: &str, allow: bool| {
            workload(org, name, ns, at, cluster, allow)
        };
        let cases = [
            (
                "three",
                vec![
                    w("wa", "x", 10, "r1", false),
                    w("wb", "y", 20, "r2", false),
                    w("wc", "x", 30, "r3", false),
                ],
                vec!["wa", "wc"],
            ),
            (
                "four_tied",
                vec![
                    w("wa", "x", 10, "r1", false),
                    w("wb", "y", 20, "r2", false),
                    w("wc", "z", 20, "r3", false),
                    w("wd", "x", 30, "r4", false),
                ],
                vec!["wa", "wd"],
            ),
            (
                "four_allowed",
                vec![
                    w("wa", "x", 10, "r1", false),
                    w("wb", "y", 20, "r2", true),
                    w("wc", "z", 30, "r3", false),
                    w("wd", "x", 40, "r4", false),
                ],
                vec!["wa", "wb"],
            ),
        ];
        for conn in sqlite_and_postgres_for_tests(org).await {
            seed_db(&conn, org).await;
            for (name, ns) in [
                ("wa", "x"),
                ("wb", "y"),
                ("wc", "x"),
                ("wc", "z"),
                ("wd", "x"),
            ] {
                add_identity(
                    &conn,
                    org,
                    &format!("svc-{name}-{ns}"),
                    ns,
                    Some(name),
                    None,
                )
                .await;
            }
            for (label, rows, expected) in &cases {
                let expected: BTreeSet<String> = expected.iter().map(|s| s.to_string()).collect();
                let all: BTreeSet<String> = rows.iter().map(|row| row.alias.clone()).collect();
                for order in permutations(rows.len()) {
                    service_name_aliases::delete_by_org(&conn, org)
                        .await
                        .unwrap();
                    let arriving: Vec<&AliasRow> = order.iter().map(|i| &rows[*i]).collect();
                    apply_puts(&conn, org, &arriving).await;
                    assert_eq!(
                        listed_names(&conn, org, "active").await,
                        expected,
                        "{label} {order:?}"
                    );
                    assert_eq!(
                        listed_names(&conn, org, "proposed").await,
                        all.difference(&expected).cloned().collect::<BTreeSet<_>>(),
                        "{label} {order:?}"
                    );
                    for row in rows {
                        let kept = stored(&conn, org, &row.alias_key).await;
                        assert_eq!(
                            (kept.status.as_str(), kept.accepted_by.as_deref()),
                            ("active", Some("admin")),
                            "{label} {order:?}: intent of {}",
                            row.alias
                        );
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn a_demoted_alias_is_promoted_again_when_its_winner_goes_away() {
        let org = "alias_greedy_promote";
        seeded(org);
        display_feed::init();
        let rows = [
            workload(org, "wa", "x", 10, "r1", false),
            workload(org, "wb", "y", 20, "r2", false),
            workload(org, "wc", "x", 30, "r3", false),
        ];
        let names =
            |list: &[&str]| -> BTreeSet<String> { list.iter().map(|s| s.to_string()).collect() };
        for conn in sqlite_and_postgres_for_tests(org).await {
            seed_db(&conn, org).await;
            for (name, ns) in [("wa", "x"), ("wb", "y"), ("wc", "x")] {
                add_identity(&conn, org, &format!("svc-{name}"), ns, Some(name), None).await;
            }
            apply_puts(&conn, org, &[&rows[2], &rows[1], &rows[0]]).await;
            assert_eq!(
                listed_names(&conn, org, "active").await,
                names(&["wa", "wc"])
            );
            let delete = ServiceIdentityMessage::AliasDelete {
                org_id: org.into(),
                alias_key: rows[0].alias_key.clone(),
                updated_at: 50,
                writer_cluster: "r1".into(),
            };
            db::service_identity_sync::apply_remote_with(&conn, org, delete)
                .await
                .unwrap();
            assert_eq!(listed_names(&conn, org, "active").await, names(&["wb"]));
            assert_eq!(listed_names(&conn, org, "proposed").await, names(&["wc"]));

            service_name_aliases::delete_by_org(&conn, org)
                .await
                .unwrap();
            apply_puts(&conn, org, &[&rows[0], &rows[1], &rows[2]]).await;
            let reject = AliasUpdate {
                status: "rejected".into(),
                canonical: None,
                allow_collisions: false,
            };
            update_with(&conn, org, "admin", &rows[0].alias_key, reject, 60)
                .await
                .unwrap();
            assert_eq!(listed_names(&conn, org, "active").await, names(&["wb"]));
            assert_eq!(listed_names(&conn, org, "rejected").await, names(&["wa"]));
        }
    }

    #[tokio::test]
    async fn a_put_on_a_conflicted_alias_answers_what_a_read_shows() {
        let org = "alias_put_conflicted";
        seeded(org);
        display_feed::init();
        let rows = [
            workload(org, "wa", "x", 10, "r1", false),
            workload(org, "wb", "y", 20, "r2", false),
            workload(org, "wc", "x", 30, "r3", false),
        ];
        let key = rows[1].alias_key.clone();
        let put = |status: &str, allow_collisions: bool| AliasUpdate {
            status: status.into(),
            canonical: None,
            allow_collisions,
        };
        let cases = [
            (60, put("rejected", false), "rejected", None),
            (70, put("active", true), "active", Some("admin")),
        ];
        for conn in sqlite_and_postgres_for_tests(org).await {
            seed_db(&conn, org).await;
            for (name, ns) in [("wa", "x"), ("wb", "y"), ("wc", "x")] {
                add_identity(&conn, org, &format!("svc-{name}"), ns, Some(name), None).await;
            }
            for (at, request, status, accepted_by) in cases.clone() {
                service_name_aliases::delete_by_org(&conn, org)
                    .await
                    .unwrap();
                apply_puts(&conn, org, &[&rows[0], &rows[1], &rows[2]]).await;
                assert!(stored(&conn, org, &key).await.conflicted, "{status}");
                let row = update_with(&conn, org, "admin", &key, request, at)
                    .await
                    .unwrap();
                let shown = alias_json(&row);
                assert_eq!(
                    (
                        shown["status"].as_str(),
                        shown["accepted_by"].as_str(),
                        shown["accepted_at"].as_i64()
                    ),
                    (Some(status), accepted_by, accepted_by.map(|_| at)),
                );
                let listed = list_with(
                    &conn,
                    org,
                    &params(&[("limit", "1000"), ("status", status)]),
                )
                .await
                .unwrap();
                let read = listed["aliases"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|alias| alias["alias_key"] == key.as_str())
                    .cloned();
                assert_eq!(read, Some(shown), "{status}");
            }
        }
    }

    #[tokio::test]
    async fn a_500_row_alias_message_applies_in_bounded_time() {
        let org = "alias_batch_scale";
        seeded(org);
        display_feed::init();
        let scopes: Vec<Value> = (0..200)
            .map(|i| json!({"service": format!("trace-{i}"), "env": "prod", "k8s_namespace": format!("ns-{}", i % 7)}))
            .collect();
        let mut traces = display_feed::tests::summaries(
            org,
            &json!({"trace_scopes": scopes}),
            config::meta::service_identity::SIGNAL_TRACES,
        );
        for (i, row) in traces.iter_mut().enumerate() {
            row.summary_key = format!("scale-{i}");
        }
        let rows: Vec<AliasRow> = (0..MAX_BULK_ROWS)
            .map(|i| AliasRow {
                canonical: format!("Service{i}"),
                ..workload(
                    org,
                    &format!("w{i}"),
                    &format!("ns-{}", i % 7),
                    10 + i as i64,
                    "r1",
                    false,
                )
            })
            .collect();
        for conn in sqlite_and_postgres_for_tests(org).await {
            seed_db(&conn, org).await;
            service_where_summary::upsert_many(&conn, traces.clone())
                .await
                .unwrap();
            let put = ServiceIdentityMessage::AliasPut {
                org_id: org.into(),
                rows: rows.clone(),
            };
            let builds = INDEX_BUILDS.with(std::cell::Cell::get);
            let started = std::time::Instant::now();
            db::service_identity_sync::apply_remote_with(&conn, org, put)
                .await
                .unwrap();
            let elapsed = started.elapsed();
            assert_eq!(INDEX_BUILDS.with(std::cell::Cell::get) - builds, 1);
            eprintln!("500-row alias message applied in {elapsed:?}");
            assert_eq!(
                listed_names(&conn, org, "active").await.len(),
                MAX_BULK_ROWS
            );
            assert!(elapsed < std::time::Duration::from_secs(5), "{elapsed:?}");
        }
    }

    #[tokio::test]
    async fn a_read_re_derives_conflicts_when_only_the_places_changed() {
        let org = "alias_greedy_places";
        seeded(org);
        display_feed::init();
        let rows = [
            workload(org, "wa", "x", 10, "r1", false),
            workload(org, "wb", "x", 20, "r2", false),
        ];
        let names =
            |list: &[&str]| -> BTreeSet<String> { list.iter().map(|s| s.to_string()).collect() };
        for conn in sqlite_and_postgres_for_tests(org).await {
            seed_db(&conn, org).await;
            apply_puts(&conn, org, &[&rows[1], &rows[0]]).await;
            assert_eq!(
                listed_names(&conn, org, "active").await,
                names(&["wa", "wb"])
            );
            add_identity(&conn, org, "svc-wa", "x", Some("wa"), Some("prod")).await;
            add_identity(&conn, org, "svc-wb", "x", Some("wb"), Some("staging")).await;
            let snapshot = committed(&conn, org).await.unwrap();
            display_feed::rebuild_placed(
                org,
                &snapshot.summaries,
                &snapshot.aliases,
                &snapshot.identities,
            );
            let shown = |workload: &str| {
                let place = serde_json::json!({
                    "k8s-cluster": "stage8",
                    "k8s-namespace": "x",
                    "k8s-deployment": workload,
                });
                display_feed::display_of(org, &format!("svc-{workload}"), &place, &place)
            };
            assert_eq!(shown("wa").display_name.as_deref(), Some("LedgerService"));
            assert_ne!(shown("wb").display_name.as_deref(), Some("LedgerService"));
            assert_eq!(listed_names(&conn, org, "active").await, names(&["wa"]));
            assert_eq!(listed_names(&conn, org, "proposed").await, names(&["wb"]));
        }
    }
}
