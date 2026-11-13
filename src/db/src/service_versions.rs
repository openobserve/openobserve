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

//! The registry flush: ENT queues observations, OSS writes them and builds summaries.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    sync::{
        Arc, LazyLock, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};

use config::{
    meta::service_identity::{
        EnvSource, SIGNAL_RUM, SIGNAL_TRACES, ServiceIdentityMessage, ServiceVersionObservation,
        ServiceVersionRecord, WhereSummaryRecord,
    },
    metrics,
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    errors,
    table::{service_versions, service_where_summary},
};
use o2_enterprise::enterprise::service_identity::{
    display,
    registry::{self, QueueOutcome},
};
use sea_orm::ConnectionTrait;

const MICROS_PER_DAY: i64 = 86_400_000_000;
// ENT `KNOWN_KEY_TTL_DAYS`: a key silent longer may be purged, so the seed skips it.
const SEED_WINDOW_DAYS: i64 = 14;
// A remote region's `last_seen` may lag by one 5-minute rollup window.
const PUBLISH_STEP_MICROS: i64 = 300_000_000;
// A held lookup never outlives two UTC day boundaries, so neither may its summary input.
const SUMMARY_TTL_DAYS: i64 = 2;
const DROP_REASON_DAILY_NEW_KEYS: &str = "daily_new_keys";
const DROP_REASON_OVERSIZED: &str = "oversized";

static HELD_ORGS: LazyLock<Mutex<BTreeSet<String>>> = LazyLock::new(Default::default);
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static FLUSHING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static SUMMARY_INPUTS: LazyLock<Mutex<HashMap<String, Arc<Mutex<SummaryInputs>>>>> =
    LazyLock::new(Default::default);
static LAST_SENT: LazyLock<Mutex<HashMap<String, SentRows>>> = LazyLock::new(Default::default);
#[cfg(test)]
static RETENTION_SCANS: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(Default::default);
#[cfg(test)]
static RELEASES: Mutex<Vec<(String, u64, Vec<String>)>> = Mutex::new(Vec::new());

/// Per org: version key → (source stream, env) → the requests' observation, for the summary rows.
#[derive(Default)]
struct SummaryInputs {
    rows: HashMap<String, BTreeMap<String, PendingSummary>>,
    count: usize,
    in_flight: HashSet<String>,
}
/// Per org: version key → what was last sent and the UTC day it was last flushed.
type SentRows = HashMap<String, (SentState, i64)>;

struct PendingSummary {
    observation: ServiceVersionObservation,
}

/// What a remote region last received for one row, to send only what changed.
#[derive(Clone, Debug, PartialEq, Eq)]
struct SentState {
    first_seen: i64,
    last_seen_step: i64,
    env: String,
    env_source: EnvSource,
    version_source: String,
}

impl SentState {
    fn of(row: &ServiceVersionRecord) -> Self {
        Self {
            first_seen: row.first_seen,
            last_seen_step: row.last_seen.div_euclid(PUBLISH_STEP_MICROS),
            env: row.env.clone(),
            env_source: row.env_source,
            version_source: row.version_source.clone(),
        }
    }
}

/// Releases a held lookup with no confirmed keys unless `release` ran first.
struct HeldRelease {
    org_id: String,
    lookup: u64,
    released: bool,
}

impl HeldRelease {
    fn new(org_id: &str, lookup: u64) -> Self {
        Self {
            org_id: org_id.to_string(),
            lookup,
            released: false,
        }
    }

    fn release(mut self, known: Vec<String>) {
        self.released = true;
        release_held(&self.org_id, self.lookup, known);
    }
}

impl Drop for HeldRelease {
    fn drop(&mut self) {
        if !self.released {
            release_held(&self.org_id, self.lookup, Vec::new());
        }
    }
}

/// Clears the org's in-flight mark however the flush ends.
struct FlushingGuard(String);

impl Drop for FlushingGuard {
    fn drop(&mut self) {
        lock(&FLUSHING).remove(&self.0);
    }
}

struct DrainGuard {
    org_id: String,
    records: Vec<ServiceVersionRecord>,
    inputs: HashMap<String, Vec<ServiceVersionObservation>>,
}

impl Drop for DrainGuard {
    fn drop(&mut self) {
        if !self.records.is_empty() {
            registry::requeue(&self.org_id, std::mem::take(&mut self.records));
            restore_summary_inputs(&self.org_id, std::mem::take(&mut self.inputs));
        }
        let summary = summary_inputs(&self.org_id);
        let mut inputs = lock(&summary);
        inputs.in_flight.clear();
        prune_summary_inputs(&self.org_id, &mut inputs);
    }
}

/// Queues one request's observations after its write succeeded; keys are (stream, version key).
pub fn queue_observations(
    org_id: &str,
    obs: BTreeMap<String, ServiceVersionObservation>,
) -> QueueOutcome {
    queue_observations_with(org_id, obs, |org| {
        tokio::spawn(async move {
            if let Err(e) = flush_org(&org).await {
                log::error!("[SERVICE_VERSIONS] threshold flush failed for org {org}: {e}");
            }
        });
    })
}

/// Counts a written request's keys whose value is too long for its registry column.
pub fn count_oversized(org_id: &str, keys: usize) {
    if keys > 0 {
        metrics::SERVICE_VERSIONS_DROPPED_TOTAL
            .with_label_values(&[org_id, DROP_REASON_OVERSIZED])
            .inc_by(keys as u64);
    }
}

/// Flushes one org on the meta database; one flush per org runs at a time on a node.
pub async fn flush_org(org_id: &str) -> Result<(), errors::Error> {
    let Some(_guard) = start_flush(org_id) else {
        return Ok(());
    };
    flush_org_with(get_orm_client_rw().await, org_id).await
}

/// Seed, held-key lookup, drain, registry upsert, summary upsert, publish; requeue on DB error.
pub async fn flush_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<(), errors::Error> {
    let summary = summary_inputs(org_id);
    prune_summary_inputs(org_id, &mut lock(&summary));
    if !registry::is_seeded(org_id) {
        seed(conn, org_id).await?;
    }
    look_up_held(conn, org_id).await;
    let records = {
        let summary = summary_inputs(org_id);
        let mut inputs = lock(&summary);
        prune_summary_inputs(org_id, &mut inputs);
        let records = registry::drain(org_id);
        remove_discarded_inputs(&mut inputs, &registry::take_discarded(org_id));
        inputs.in_flight = records.iter().map(|r| r.version_key.clone()).collect();
        records
    };
    if records.is_empty() {
        lock(&summary).in_flight.clear();
        return Ok(());
    }
    flush_records_with(conn, org_id, records).await
}

/// Every org with pending or held rows, flushed one after another.
pub async fn flush_all() -> Result<(), errors::Error> {
    let mut result = Ok(());
    for org_id in orgs_to_flush() {
        if let Err(e) = flush_org(&org_id).await {
            log::error!("[SERVICE_VERSIONS] flush failed for org {org_id}: {e}");
            result = Err(e);
        }
    }
    result
}

pub fn begin_shutdown() {
    let _active = lock(&FLUSHING);
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
}

pub async fn wait_for_active_flushes() {
    while !lock(&FLUSHING).is_empty() {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

pub async fn shutdown() -> Result<(), errors::Error> {
    begin_shutdown();
    complete_shutdown_with(get_orm_client_rw().await, orgs_to_flush).await
}

/// `pending_orgs` omits orgs whose rows are all held, so the held set joins it.
pub fn orgs_to_flush() -> Vec<String> {
    let mut orgs: BTreeSet<String> = registry::pending_orgs().into_iter().collect();
    orgs.extend(lock(&HELD_ORGS).iter().cloned());
    orgs.into_iter().collect()
}

async fn complete_shutdown_with<C: ConnectionTrait>(
    conn: &C,
    orgs: impl FnOnce() -> Vec<String>,
) -> Result<(), errors::Error> {
    wait_for_active_flushes().await;
    let mut result = Ok(());
    for org in orgs() {
        if let Err(e) = flush_org_with(conn, &org).await {
            result = Err(e);
        }
    }
    result
}

fn queue_observations_with(
    org_id: &str,
    obs: BTreeMap<String, ServiceVersionObservation>,
    spawn_flush: impl FnOnce(String),
) -> QueueOutcome {
    if obs.is_empty() {
        return QueueOutcome::default();
    }
    let outcome = {
        let summary = summary_inputs(org_id);
        let mut inputs = lock(&summary);
        let observations: Vec<_> = obs.values().cloned().collect();
        let outcome = registry::queue_observations(org_id, obs);
        remove_discarded_inputs(&mut inputs, &outcome.discarded);
        let discarded: HashSet<_> = outcome.discarded.iter().collect();
        remember_retained_inputs(
            org_id,
            &mut inputs,
            observations
                .iter()
                .filter(|observation| !discarded.contains(&observation.version_key(org_id))),
        );
        outcome
    };
    if outcome.dropped > 0 {
        metrics::SERVICE_VERSIONS_DROPPED_TOTAL
            .with_label_values(&[org_id, DROP_REASON_DAILY_NEW_KEYS])
            .inc_by(outcome.dropped);
    }
    if !outcome.held.is_empty() {
        lock(&HELD_ORGS).insert(org_id.to_string());
    }
    if outcome.should_flush && !lock(&FLUSHING).contains(org_id) {
        spawn_flush(org_id.to_string());
    }
    outcome
}

fn start_flush(org_id: &str) -> Option<FlushingGuard> {
    let mut active = lock(&FLUSHING);
    if SHUTTING_DOWN.load(Ordering::SeqCst) {
        return None;
    }
    active
        .insert(org_id.to_string())
        .then(|| FlushingGuard(org_id.to_string()))
}

/// Keys already in the table are known before the daily guard counts anything as new.
async fn seed<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<(), errors::Error> {
    let since = now_micros() - SEED_WINDOW_DAYS * MICROS_PER_DAY;
    match service_versions::version_keys_seen_since(conn, org_id, since).await {
        Ok(keys) => {
            registry::mark_known(org_id, keys);
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[SERVICE_VERSIONS] seed failed for org {org_id}, retrying next flush: {e}"
            );
            Err(e)
        }
    }
}

/// Held keys found in the table are rollbacks, never new; every lookup is released.
async fn look_up_held<C: ConnectionTrait>(conn: &C, org_id: &str) {
    let lookup = {
        // Held while taking: a request that holds a key after this lookup re-adds the org after us.
        let mut held_orgs = lock(&HELD_ORGS);
        let lookup = registry::take_held(org_id);
        if lookup.id == 0 {
            held_orgs.remove(org_id);
        } else {
            held_orgs.insert(org_id.to_string());
        }
        lookup
    };
    if lookup.id == 0 {
        return;
    }
    let release = HeldRelease::new(org_id, lookup.id);
    let keys: Vec<String> = lookup.rows.into_iter().map(|r| r.version_key).collect();
    match service_versions::get_by_keys(conn, org_id, &keys).await {
        Ok(rows) => release.release(rows.into_iter().map(|r| r.version_key).collect()),
        Err(e) => {
            log::error!("[SERVICE_VERSIONS] held-key lookup failed for org {org_id}: {e}");
            release.release(Vec::new());
        }
    }
}

async fn flush_records_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    records: Vec<ServiceVersionRecord>,
) -> Result<(), errors::Error> {
    let mut drained = DrainGuard {
        org_id: org_id.to_string(),
        records,
        inputs: HashMap::new(),
    };
    let merged = service_versions::merge_upsert_many(conn, drained.records.clone()).await?;
    drained.inputs = take_summary_inputs(org_id, &merged);
    let summaries = summaries_for(org_id, &merged, &drained.inputs);
    service_where_summary::upsert_many(conn, summaries.clone()).await?;
    display::apply_names(org_id, &trace_names(&summaries));
    publish_changed(org_id, &merged).await;
    super::service_identity_sync::publish_chunked(
        summaries,
        o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MSG_MAX_BYTES,
        |rows| ServiceIdentityMessage::SummaryPut { rows },
    )
    .await;
    drained.records.clear();
    Ok(())
}

/// A summary row comes only from a live row and an observation newer than its delete.
fn summaries_for(
    org_id: &str,
    merged: &[ServiceVersionRecord],
    inputs: &HashMap<String, Vec<ServiceVersionObservation>>,
) -> Vec<WhereSummaryRecord> {
    let now = now_micros();
    let mut summaries = Vec::new();
    for row in merged.iter().filter(|row| row.is_live()) {
        let post_delete = |last: i64| row.deleted_at.is_none_or(|deleted| last > deleted);
        for observation in inputs.get(&row.version_key).into_iter().flatten() {
            if !signal_last_seen(row, &observation.signal).is_some_and(post_delete)
                || !post_delete(observation.last_seen)
            {
                continue;
            }
            let mut observation = observation.clone();
            if let Some(deleted) = row.deleted_at {
                observation.first_seen = observation.first_seen.max(deleted);
            }
            summaries.push(observation.to_summary(org_id, row, now));
        }
    }
    summaries
}

fn trace_names(summaries: &[WhereSummaryRecord]) -> Vec<String> {
    summaries
        .iter()
        .filter(|row| row.signal == SIGNAL_TRACES)
        .map(|row| row.service_name.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn signal_last_seen(row: &ServiceVersionRecord, signal: &str) -> Option<i64> {
    if signal == SIGNAL_RUM {
        row.rum_last_seen
    } else {
        row.traces_last_seen
    }
}

fn summary_inputs(org_id: &str) -> Arc<Mutex<SummaryInputs>> {
    lock(&SUMMARY_INPUTS)
        .entry(org_id.to_string())
        .or_default()
        .clone()
}

fn remember_summary_inputs<'a>(
    org_id: &str,
    observations: impl Iterator<Item = &'a ServiceVersionObservation>,
) {
    let summary = summary_inputs(org_id);
    let mut inputs = lock(&summary);
    remember_retained_inputs(org_id, &mut inputs, observations);
}

fn registry_retained_keys(org_id: &str) -> HashSet<String> {
    #[cfg(test)]
    {
        *lock(&RETENTION_SCANS)
            .entry(org_id.to_string())
            .or_default() += 1;
    }
    registry::retained_keys(org_id)
}

fn remove_discarded_inputs(org: &mut SummaryInputs, discarded: &[String]) {
    for key in discarded {
        if !org.in_flight.contains(key)
            && let Some(streams) = org.rows.remove(key)
        {
            org.count -= streams.len();
        }
    }
}

fn prune_summary_inputs(org_id: &str, org: &mut SummaryInputs) {
    remove_discarded_inputs(org, &registry::take_discarded(org_id));
    let retained = registry_retained_keys(org_id);
    org.rows
        .retain(|key, _| retained.contains(key) || org.in_flight.contains(key));
    org.count = org.rows.values().map(BTreeMap::len).sum();
}

fn remember_retained_inputs<'a>(
    org_id: &str,
    org: &mut SummaryInputs,
    observations: impl Iterator<Item = &'a ServiceVersionObservation>,
) {
    let cap = o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_ORG_PER_DAY
        as usize;

    for observation in observations {
        let key = observation.version_key(org_id);
        let input = summary_input_key(observation);
        if !org
            .rows
            .get(&key)
            .is_some_and(|streams| streams.contains_key(&input))
            && org.count >= cap
        {
            continue;
        }
        let by_stream = org.rows.entry(key).or_default();
        match by_stream.get_mut(&input) {
            Some(pending) => merge_observation(&mut pending.observation, observation),
            None => {
                org.count += 1;
                by_stream.insert(
                    input,
                    PendingSummary {
                        observation: observation.clone(),
                    },
                );
            }
        }
    }
}

/// Takes the inputs of the merged keys; inputs of keys not flushed yet stay for a later flush.
fn take_summary_inputs(
    org_id: &str,
    merged: &[ServiceVersionRecord],
) -> HashMap<String, Vec<ServiceVersionObservation>> {
    let summary = summary_inputs(org_id);
    let mut inputs = lock(&summary);
    let org = &mut *inputs;
    merged
        .iter()
        .filter_map(|row| {
            let by_stream = org.rows.remove(&row.version_key)?;
            org.count -= by_stream.len();
            let observations = by_stream.into_values().map(|p| p.observation).collect();
            Some((row.version_key.clone(), observations))
        })
        .collect()
}

fn restore_summary_inputs(org_id: &str, inputs: HashMap<String, Vec<ServiceVersionObservation>>) {
    remember_summary_inputs(org_id, inputs.values().flatten());
}

// One input per (stream, env): merging two envs into one would drop one from the summary's env set.
fn summary_input_key(observation: &ServiceVersionObservation) -> String {
    format!("{}\u{1f}{}", observation.source_stream, observation.env)
}

/// Newest-wins on `last_seen` for the descriptive fields, min/max for the times.
fn merge_observation(into: &mut ServiceVersionObservation, incoming: &ServiceVersionObservation) {
    if incoming.last_seen >= into.last_seen {
        into.env = incoming.env.clone();
        into.env_source = incoming.env_source;
        into.env_source_value = incoming.env_source_value.clone();
        into.raw_version = incoming.raw_version.clone();
        into.version_source = incoming.version_source.clone();
    }
    into.first_seen = into.first_seen.min(incoming.first_seen);
    into.last_seen = into.last_seen.max(incoming.last_seen);
}

async fn publish_changed(org_id: &str, merged: &[ServiceVersionRecord]) {
    let changed = take_changed(org_id, merged);
    if changed.is_empty() {
        return;
    }
    let org = org_id.to_string();
    super::service_identity_sync::publish_chunked(
        changed,
        o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MSG_MAX_BYTES,
        |records| ServiceIdentityMessage::VersionsPut {
            org_id: org.clone(),
            records,
        },
    )
    .await;
}

/// Rows whose first_seen, 5-minute last_seen step, env or env/version source moved.
fn take_changed(org_id: &str, merged: &[ServiceVersionRecord]) -> Vec<ServiceVersionRecord> {
    let today = now_micros().div_euclid(MICROS_PER_DAY);
    let mut sent = lock(&LAST_SENT);
    let org = sent.entry(org_id.to_string()).or_default();
    let changed = merged
        .iter()
        .filter(|row| {
            let state = SentState::of(row);
            let unchanged = org
                .get(&row.version_key)
                .is_some_and(|(sent, _)| *sent == state);
            org.insert(row.version_key.clone(), (state, today));
            !unchanged
        })
        .cloned()
        .collect();
    // Forgetting a quiet row costs one resend later, never a missed change.
    org.retain(|_, (_, touched)| today - *touched <= SUMMARY_TTL_DAYS);
    changed
}

fn release_held(org_id: &str, lookup: u64, known: Vec<String>) {
    #[cfg(test)]
    lock(&RELEASES).push((org_id.to_string(), lookup, known.clone()));
    registry::release_held(org_id, lookup, known);
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::{EnvSource, SIGNAL_TRACES, WhereKind};
    use infra::table::service_versions::{create_tables_for_tests, sqlite_and_postgres_for_tests};
    use sea_orm::DatabaseConnection;

    use super::*;
    use crate::service_identity_sync::take_sent;

    const STREAM: &str = "default";
    const HOUR: i64 = 3_600_000_000;

    async fn dbs(label: &str) -> Vec<DatabaseConnection> {
        let dbs = sqlite_and_postgres_for_tests(label).await;
        for db in &dbs {
            create_tables_for_tests(db).await.unwrap();
        }
        dbs
    }

    /// A database with no tables: every statement on it fails.
    async fn broken_db() -> DatabaseConnection {
        sqlite_and_postgres_for_tests("sv_broken").await.remove(0)
    }

    fn obs(service: &str, version: &str, first: i64, last: i64) -> ServiceVersionObservation {
        ServiceVersionObservation {
            service_name: service.to_string(),
            where_key: "k8s:prod-eu/shop".to_string(),
            where_kind: WhereKind::K8s,
            k8s_cluster: "prod-eu".to_string(),
            k8s_namespace: "shop".to_string(),
            env: "production".to_string(),
            env_source: EnvSource::Cluster,
            env_source_value: "prod-eu".to_string(),
            version: version.to_string(),
            raw_version: Some(version.to_string()),
            version_source: "service.version".to_string(),
            image: None,
            image_ref: None,
            source_stream: STREAM.to_string(),
            signal: SIGNAL_TRACES.to_string(),
            first_seen: first,
            last_seen: last,
        }
    }

    fn batch(
        org: &str,
        list: Vec<ServiceVersionObservation>,
    ) -> BTreeMap<String, ServiceVersionObservation> {
        list.into_iter()
            .map(|o| {
                (
                    format!("{}\u{1f}{}", o.source_stream, o.version_key(org)),
                    o,
                )
            })
            .collect()
    }

    fn queue(org: &str, list: Vec<ServiceVersionObservation>) -> QueueOutcome {
        queue_observations_with(org, batch(org, list), |_| {})
    }

    async fn row(
        db: &DatabaseConnection,
        org: &str,
        o: &ServiceVersionObservation,
    ) -> Option<ServiceVersionRecord> {
        service_versions::get_by_keys(db, org, &[o.version_key(org)])
            .await
            .unwrap()
            .pop()
    }

    async fn summaries(db: &DatabaseConnection, org: &str) -> Vec<WhereSummaryRecord> {
        service_where_summary::list_by_org(db, org).await.unwrap()
    }

    fn releases(org: &str) -> Vec<(u64, Vec<String>)> {
        lock(&RELEASES)
            .iter()
            .filter(|(o, ..)| o == org)
            .map(|(_, id, known)| (*id, known.clone()))
            .collect()
    }

    /// Spends today's new-key budget of `service`'s scope on throwaway versions.
    async fn exhaust_scope(db: &DatabaseConnection, org: &str, service: &str, now: i64) {
        let budget =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_SCOPE_PER_DAY
                as usize;
        let fillers = (0..budget)
            .map(|i| obs(service, &format!("filler-{i}"), now, now))
            .collect();
        let outcome = queue(org, fillers);
        assert!(outcome.held.is_empty());
        flush_org_with(db, org).await.unwrap();
    }

    #[tokio::test]
    async fn over_budget_summary_inputs_are_bounded_without_pending_rows() {
        let org = "sv_bounded_summary";
        registry::mark_known(org, Vec::<String>::new());
        let scope_budget =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_SCOPE_PER_DAY
                as usize;
        let cap =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_ORG_PER_DAY
                as usize;
        queue(
            org,
            (0..scope_budget)
                .map(|i| obs("cart", &format!("accepted-{i}"), 1, 1))
                .collect(),
        );
        let drained = registry::drain(org);
        take_summary_inputs(org, &drained);
        for offset in (0..cap + 1000).step_by(1000) {
            queue(
                org,
                (offset..offset + 1000)
                    .map(|i| obs("cart", &format!("held-{i}"), 1, 1))
                    .collect(),
            );
        }
        assert!(!registry::pending_orgs().iter().any(|o| o == org));
        let retained = registry::retained_keys(org);
        let before = lock(&summary_inputs(org)).rows.len();
        assert!(before <= cap);
        assert!(
            lock(&summary_inputs(org))
                .rows
                .keys()
                .all(|key| retained.contains(key))
        );
        for i in 0..100 {
            queue(org, vec![obs("cart", &format!("rejected-{i}"), 2, 2)]);
        }
        assert_eq!(lock(&summary_inputs(org)).rows.len(), before);
        flush_org_with(&broken_db().await, org).await.unwrap();
        assert!(
            lock(&summary_inputs(org))
                .rows
                .keys()
                .all(|key| retained.contains(key))
        );
    }

    #[test]
    fn requests_do_not_scan_retained_keys() {
        let org = "sv_no_request_scan";
        registry::mark_known(org, Vec::<String>::new());
        let budget =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_SCOPE_PER_DAY
                as usize;
        let cap =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_ORG_PER_DAY
                as usize;
        queue(
            org,
            (0..cap)
                .map(|i| obs(&format!("svc-{}", i / budget), &format!("v{i}"), 1, 1))
                .collect(),
        );
        let drained = registry::drain(org);
        take_summary_inputs(org, &drained);
        queue(
            org,
            (0..cap)
                .map(|i| obs(&format!("svc-{}", i / budget), &format!("held{i}"), 1, 1))
                .collect(),
        );
        assert_eq!(registry::retained_keys(org).len(), cap);
        let before = lock(&RETENTION_SCANS).get(org).copied().unwrap_or_default();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                for i in 0..100 {
                    let outcome = queue(org, vec![obs("svc-0", &format!("rejected{i}"), 2, 2)]);
                    assert_eq!(outcome.dropped, 1);
                }
            });
            scope.spawn(|| {
                for _ in 0..100 {
                    queue("sv_other_request_scan", vec![obs("other", "v1", 2, 2)]);
                }
            });
        });
        assert_eq!(
            lock(&RETENTION_SCANS).get(org).copied().unwrap_or_default(),
            before
        );
        let summary = summary_inputs(org);
        let inputs = lock(&summary);
        assert_eq!(
            inputs.count,
            inputs.rows.values().map(BTreeMap::len).sum::<usize>()
        );
        assert!(inputs.count <= o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_ORG_PER_DAY as usize);
    }

    #[test]
    fn rollover_reclaims_inputs_before_admitting_observations() {
        let org = "sv_rollover_summary";
        registry::mark_known(org, Vec::<String>::new());
        let budget =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_SCOPE_PER_DAY
                as usize;
        let cap =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_ORG_PER_DAY
                as usize;
        queue(
            org,
            (0..cap)
                .map(|i| obs(&format!("svc-{}", i / budget), &format!("v{i}"), 1, 1))
                .collect(),
        );
        let drained = registry::drain(org);
        take_summary_inputs(org, &drained);
        queue(
            org,
            (0..cap)
                .map(|i| obs(&format!("svc-{}", i / budget), &format!("held{i}"), 1, 1))
                .collect(),
        );
        assert_eq!(lock(&summary_inputs(org)).count, cap);
        registry::force_rollover_for_tests(org);
        let observation = obs("new-service", "new-version", 2, 3);
        let key = observation.version_key(org);
        let outcome = queue(org, vec![observation]);
        assert!(outcome.held.is_empty());
        assert_eq!(outcome.discarded.len(), cap);
        let records = registry::drain(org);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].version_key, key);
        let inputs = take_summary_inputs(org, &records);
        assert_eq!(inputs[&key].len(), 1);
        let summaries = summaries_for(org, &records, &inputs);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].newest_version_key, key);
        assert_eq!(lock(&summary_inputs(org)).count, 0);
    }

    #[test]
    fn summary_stream_inputs_share_the_org_cap() {
        let org = "sv_summary_stream_cap";
        let observation = obs("cart", "v1", 1, 2);
        queue(org, vec![observation.clone()]);
        let cap =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_ORG_PER_DAY
                as usize;
        let observations: Vec<_> = (0..cap + 10)
            .map(|i| {
                let mut observation = observation.clone();
                observation.source_stream = format!("stream-{i}");
                observation
            })
            .collect();
        remember_summary_inputs(org, observations.iter());
        assert_eq!(
            lock(&summary_inputs(org))
                .rows
                .values()
                .map(BTreeMap::len)
                .sum::<usize>(),
            cap
        );
    }

    #[tokio::test]
    async fn seed_failure_prunes_unretained_summary_inputs() {
        let org = "sv_prune_seed_failure";
        let observation = obs("cart", "discarded", 1, 2);
        lock(&summary_inputs(org)).rows.insert(
            observation.version_key(org),
            BTreeMap::from([(STREAM.to_string(), PendingSummary { observation })]),
        );
        assert!(flush_org_with(&broken_db().await, org).await.is_err());
        assert!(lock(&summary_inputs(org)).rows.is_empty());
    }

    #[tokio::test]
    async fn cancelled_drain_requeues_records_and_summary_inputs() {
        for (i, db) in dbs("sv_cancel").await.into_iter().enumerate() {
            let org = format!("sv_cancel_{i}");
            let observation = obs("cart", "v1", 100, 200);
            queue(&org, vec![observation.clone()]);
            let records = registry::drain(&org);
            let inputs = take_summary_inputs(&org, &records);
            let guard = DrainGuard {
                org_id: org.clone(),
                records,
                inputs,
            };
            let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(async move {
                let _guard = guard;
                entered_tx.send(()).unwrap();
                std::future::pending::<()>().await;
            });
            entered_rx.await.unwrap();
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
            assert!(registry::pending_orgs().contains(&org));
            flush_org_with(&db, &org).await.unwrap();
            assert!(row(&db, &org, &observation).await.is_some());
            assert_eq!(summaries(&db, &org).await.len(), 1);
        }
    }

    #[tokio::test]
    async fn shutdown_waits_for_active_flush_and_drains_new_observations() {
        for (i, db) in dbs("sv_shutdown").await.into_iter().enumerate() {
            let org = format!("sv_shutdown_{i}");
            let guard = start_flush(&org).unwrap();
            let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
            let task = tokio::spawn(async move {
                let _guard = guard;
                resume_rx.await.unwrap();
            });
            queue(&org, vec![obs("cart", "queued-during-flush", 1, 2)]);
            let completion = complete_shutdown_with(&db, || vec![org.clone()]);
            tokio::pin!(completion);
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(20), &mut completion)
                    .await
                    .is_err()
            );
            resume_tx.send(()).unwrap();
            task.await.unwrap();
            let _ = completion.await;
            assert_eq!(summaries(&db, &org).await.len(), 1);
            assert!(!registry::pending_orgs().contains(&org));
        }
    }

    #[tokio::test]
    async fn two_nodes_flushing_same_keys_converge() {
        for (i, db) in dbs("sv_converge").await.into_iter().enumerate() {
            let a = obs("cart", "v1", 100, 500);
            let mut b = obs("cart", "v1", 50, 400);
            b.env = "staging".to_string();
            let mut c = obs("cart", "v1", 300, 900);
            c.signal = SIGNAL_RUM.to_string();
            c.source_stream = "_rumdata".to_string();
            let mut expected = a.to_record("x", 1);
            for o in [&b, &c] {
                expected.merge(&o.to_record("x", 1));
            }
            let mut finals = Vec::new();
            for (n, (node1, node2)) in [(vec![&a, &c], vec![&b]), (vec![&b], vec![&c, &a])]
                .into_iter()
                .enumerate()
            {
                let org = format!("sv_converge_{i}_{n}");
                let records = |list: Vec<&ServiceVersionObservation>| {
                    list.into_iter()
                        .map(|o| o.to_record(&org, 1))
                        .collect::<Vec<_>>()
                };
                let (r1, r2) = tokio::join!(
                    flush_records_with(&db, &org, records(node1)),
                    flush_records_with(&db, &org, records(node2)),
                );
                r1.unwrap();
                r2.unwrap();
                let stored = row(&db, &org, &a).await.unwrap();
                finals.push((
                    stored.first_seen,
                    stored.last_seen,
                    stored.traces_first_seen,
                    stored.traces_last_seen,
                    stored.rum_first_seen,
                    stored.rum_last_seen,
                    stored.env.clone(),
                ));
            }
            assert_eq!(finals[0], finals[1], "both orders end in the same row");
            assert_eq!(
                finals[0],
                (
                    expected.first_seen,
                    expected.last_seen,
                    expected.traces_first_seen,
                    expected.traces_last_seen,
                    expected.rum_first_seen,
                    expected.rum_last_seen,
                    expected.env.clone(),
                )
            );
        }
    }

    #[tokio::test]
    async fn flush_requeues_on_db_error_up_to_retries() {
        let broken = broken_db().await;
        let good = dbs("sv_requeue").await.remove(0);
        let org = "sv_requeue";
        registry::mark_known(org, Vec::<String>::new());
        let v1 = obs("cart", "v1", 100, 200);
        queue(org, vec![v1.clone()]);
        let retries = o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_FLUSH_RETRIES;
        for attempt in 0..retries {
            assert!(
                flush_org_with(&broken, org).await.is_err(),
                "attempt {attempt}"
            );
            assert!(
                orgs_to_flush().contains(&org.to_string()),
                "requeued after {attempt}"
            );
        }
        flush_org_with(&good, org).await.unwrap();
        assert_eq!(
            row(&good, org, &v1).await.unwrap().last_seen,
            200,
            "a retry within the cap lands"
        );

        let v2 = obs("cart", "v2", 300, 400);
        queue(org, vec![v2.clone()]);
        for _ in 0..=retries {
            assert!(flush_org_with(&broken, org).await.is_err());
        }
        assert!(
            !registry::pending_orgs().contains(&org.to_string()),
            "dropped past the cap"
        );
        assert!(
            !lock(&summary_inputs(org))
                .rows
                .contains_key(&v2.version_key(org))
        );
        flush_org_with(&good, org).await.unwrap();
        assert!(row(&good, org, &v2).await.is_none());
    }

    #[tokio::test]
    async fn threshold_flush_spawns_at_batch_max() {
        let org = "sv_threshold";
        let batch_max = o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_BATCH_MAX;
        let per_scope =
            o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_SCOPE_PER_DAY
                as usize;
        let list = |from: usize, to: usize| {
            (from..to)
                .map(|i| obs(&format!("svc-{}", i / per_scope), &format!("v{i}"), 1, 2))
                .collect::<Vec<_>>()
        };
        let mut spawned = Vec::new();
        let outcome =
            queue_observations_with(org, batch(org, list(0, batch_max - 1)), |o| spawned.push(o));
        assert!(!outcome.should_flush);
        assert!(spawned.is_empty());
        let outcome =
            queue_observations_with(org, batch(org, list(batch_max - 1, batch_max)), |o| {
                spawned.push(o)
            });
        assert!(outcome.should_flush);
        assert_eq!(spawned, vec![org.to_string()]);

        let _guard = start_flush(org).unwrap();
        let outcome =
            queue_observations_with(org, batch(org, list(batch_max, batch_max + 1)), |o| {
                spawned.push(o)
            });
        assert!(outcome.should_flush);
        assert_eq!(
            spawned.len(),
            1,
            "no second spawn while the org is flushing"
        );
        assert!(start_flush(org).is_none());
        registry::drain(org);
    }

    #[tokio::test]
    async fn restart_seeds_known_keys_before_first_flush() {
        for (i, db) in dbs("sv_seed").await.into_iter().enumerate() {
            let org = format!("sv_seed_{i}");
            let now = now_micros();
            let budget = o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_MAX_NEW_PER_SCOPE_PER_DAY as usize;
            let existing: Vec<_> = (0..budget + 50)
                .map(|n| obs("cart", &format!("v{n}"), now - 3 * HOUR, now - 2 * HOUR))
                .collect();
            service_versions::merge_upsert_many(
                &db,
                existing.iter().map(|o| o.to_record(&org, now)).collect(),
            )
            .await
            .unwrap();

            assert!(
                !registry::is_seeded(&org),
                "a fresh node has not seeded the org"
            );
            let seen: Vec<_> = existing
                .iter()
                .map(|o| {
                    let mut o = o.clone();
                    o.first_seen = now - HOUR;
                    o.last_seen = now;
                    o
                })
                .collect();
            let outcome = queue(&org, seen.clone());
            assert_eq!((outcome.dropped, outcome.held.len()), (0, 0));
            flush_org_with(&db, &org).await.unwrap();
            assert!(registry::is_seeded(&org));
            let outcome = queue(&org, seen.clone());
            assert_eq!(
                (outcome.dropped, outcome.held.len()),
                (0, 0),
                "existing keys over the daily budget are neither held nor dropped"
            );
            flush_org_with(&db, &org).await.unwrap();
            for o in &seen {
                assert_eq!(row(&db, &org, o).await.unwrap().last_seen, now);
            }
            let fresh: Vec<_> = (0..budget)
                .map(|n| obs("cart", &format!("new-{n}"), now, now))
                .collect();
            assert!(
                queue(&org, fresh).held.is_empty(),
                "the seed spent none of today's budget"
            );
            let over = queue(&org, vec![obs("cart", "one-too-many", now, now)]);
            assert_eq!(over.held.len(), 1);
            registry::drain(&org);
        }
    }

    #[tokio::test]
    async fn seed_error_skips_org_and_retries() {
        let broken = broken_db().await;
        let good = dbs("sv_seed_err").await.remove(0);
        let org = "sv_seed_err";
        let v1 = obs("cart", "v1", 100, 200);
        queue(org, vec![v1.clone()]);
        assert!(flush_org_with(&broken, org).await.is_err());
        assert!(!registry::is_seeded(org));
        assert!(
            registry::pending_orgs().contains(&org.to_string()),
            "no drain without a seed"
        );
        flush_org_with(&good, org).await.unwrap();
        assert!(registry::is_seeded(org));
        assert_eq!(row(&good, org, &v1).await.unwrap().last_seen, 200);
    }

    #[tokio::test]
    async fn held_rollback_key_found_in_table_is_flushed() {
        for (i, db) in dbs("sv_rollback").await.into_iter().enumerate() {
            let org = format!("sv_rollback_{i}");
            let now = now_micros();
            let old = obs("cart", "v1.0.0", now - 40 * 24 * HOUR, now - 30 * 24 * HOUR);
            service_versions::merge_upsert_many(&db, vec![old.to_record(&org, now)])
                .await
                .unwrap();
            flush_org_with(&db, &org).await.unwrap();
            exhaust_scope(&db, &org, "cart", now).await;

            let rollback = obs("cart", "v1.0.0", now, now);
            let outcome = queue(&org, vec![rollback.clone()]);
            assert_eq!(outcome.held, vec![rollback.version_key(&org)]);
            assert!(orgs_to_flush().contains(&org));
            flush_org_with(&db, &org).await.unwrap();
            let stored = row(&db, &org, &rollback).await.unwrap();
            assert_eq!(
                stored.last_seen, now,
                "the rollback is flushed, not dropped"
            );
            assert_eq!(stored.first_seen, old.first_seen);
            let released = releases(&org);
            assert_eq!(released.len(), 1);
            assert_eq!(released[0].1, vec![rollback.version_key(&org)]);
            assert!(
                !lock(&summary_inputs(&org))
                    .rows
                    .contains_key(&rollback.version_key(&org)),
                "the rollback's summary input went out with it"
            );
            flush_org_with(&db, &org).await.unwrap();
            assert!(
                !orgs_to_flush().contains(&org),
                "an empty lookup leaves the held set"
            );
        }
    }

    #[tokio::test]
    async fn held_lookup_error_releases_with_empty_known() {
        let good = dbs("sv_held_err").await.remove(0);
        let broken = broken_db().await;
        let org = "sv_held_err";
        let now = now_micros();
        flush_org_with(&good, org).await.unwrap();
        exhaust_scope(&good, org, "cart", now).await;
        let new_key = obs("cart", "v9", now, now);
        assert_eq!(queue(org, vec![new_key.clone()]).held.len(), 1);

        assert!(
            flush_org_with(&broken, org).await.is_ok(),
            "nothing pending to write"
        );
        let released = releases(org);
        assert_eq!(released.len(), 1, "exactly one release per lookup");
        assert!(released[0].1.is_empty(), "a failed lookup confirms nothing");
        assert!(!registry::pending_orgs().contains(&org.to_string()));
        assert!(orgs_to_flush().contains(&org.to_string()), "still held");

        let lookup = registry::take_held(org);
        assert_ne!(lookup.id, released[0].0, "the failed lookup was closed");
        {
            let _abandoned = HeldRelease::new(org, lookup.id);
        }
        let released = releases(org);
        assert_eq!(released.len(), 2);
        assert_eq!(
            released[1],
            (lookup.id, Vec::new()),
            "an early return still releases"
        );
        registry::drain(org);
    }

    #[tokio::test]
    async fn held_only_org_is_flushed() {
        let db = dbs("sv_held_only").await.remove(0);
        let org = "sv_held_only";
        let now = now_micros();
        let old = obs("cart", "v0.9", now - 40 * 24 * HOUR, now - 30 * 24 * HOUR);
        service_versions::merge_upsert_many(&db, vec![old.to_record(org, now)])
            .await
            .unwrap();
        flush_org_with(&db, org).await.unwrap();
        exhaust_scope(&db, org, "cart", now).await;
        let rollback = obs("cart", "v0.9", now, now);
        assert_eq!(queue(org, vec![rollback.clone()]).held.len(), 1);
        assert!(!registry::pending_orgs().contains(&org.to_string()));
        assert!(orgs_to_flush().contains(&org.to_string()));
        flush_org_with(&db, org).await.unwrap();
        assert_eq!(row(&db, org, &rollback).await.unwrap().last_seen, now);
    }

    #[tokio::test]
    async fn summary_skips_pre_delete_signal() {
        for (i, db) in dbs("sv_sum_delete").await.into_iter().enumerate() {
            let org = format!("sv_sum_delete_{i}");
            registry::mark_known(&org, Vec::<String>::new());
            let late = obs("cart", "v1", 500, 600);
            service_versions::merge_upsert_many(&db, vec![late.to_record(&org, 1)])
                .await
                .unwrap();
            service_versions::tombstone_many(&db, &org, &[late.version_key(&org)], 300, None)
                .await
                .unwrap();
            queue(&org, vec![late.clone()]);
            flush_org_with(&db, &org).await.unwrap();
            let rows = summaries(&db, &org).await;
            assert_eq!(rows.len(), 1, "500/600 is after the delete at 300");
            assert_eq!((rows[0].first_seen, rows[0].last_seen), (500, 600));

            let stale = obs("cart", "v2", 100, 200);
            service_versions::merge_upsert_many(&db, vec![stale.to_record(&org, 1)])
                .await
                .unwrap();
            service_versions::tombstone_many(&db, &org, &[stale.version_key(&org)], 300, None)
                .await
                .unwrap();
            let mut browser = obs("cart", "v2", 700, 800);
            browser.signal = SIGNAL_RUM.to_string();
            browser.source_stream = "_rumdata".to_string();
            queue(&org, vec![stale.clone(), browser]);
            flush_org_with(&db, &org).await.unwrap();
            let rows = summaries(&db, &org).await;
            let streams: Vec<&str> = rows.iter().map(|s| s.source_stream.as_str()).collect();
            assert!(
                streams.contains(&"_rumdata"),
                "the post-delete RUM signal is summarised"
            );
            let traces = rows.iter().find(|s| s.source_stream == STREAM).unwrap();
            assert_eq!(
                traces.newest_version, "v1",
                "the pre-delete traces signal of v2 never reaches the summary"
            );
        }
    }

    #[tokio::test]
    async fn summary_heals_after_late_history() {
        for (i, db) in dbs("sv_sum_heal").await.into_iter().enumerate() {
            let org = format!("sv_sum_heal_{i}");
            for o in [
                obs("cart", "v1", 300, 310),
                obs("cart", "v2", 200, 210),
                obs("cart", "v1", 100, 110),
                obs("cart", "v2", 500, 510),
            ] {
                queue(&org, vec![o]);
                flush_org_with(&db, &org).await.unwrap();
            }
            let rows = summaries(&db, &org).await;
            assert_eq!(rows.len(), 1);
            assert_eq!(
                (rows[0].newest_version.as_str(), rows[0].newest_first_seen),
                ("v2", 200),
                "healed: v1 first appeared at 100, v2 at 200"
            );
        }
    }

    #[tokio::test]
    async fn publish_sends_only_changed_rows() {
        let db = dbs("sv_publish").await.remove(0);
        let org = "sv_publish";
        let base = 1_000 * PUBLISH_STEP_MICROS;
        let sent_keys = || {
            take_sent(org)
                .into_iter()
                .flat_map(|msg| match msg {
                    ServiceIdentityMessage::VersionsPut { records, .. } => records,
                    ServiceIdentityMessage::SummaryPut { .. } => Vec::new(),
                    other => panic!("unexpected {other:?}"),
                })
                .map(|r| r.version)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
        };
        let flush = |list: Vec<ServiceVersionObservation>| {
            queue(org, list);
            flush_org_with(&db, org)
        };
        flush(vec![
            obs("cart", "v1", base, base + 10),
            obs("cart", "v2", base, base + 10),
        ])
        .await
        .unwrap();
        assert_eq!(sent_keys(), vec!["v1", "v2"], "new rows are sent");

        flush(vec![obs("cart", "v1", base + 20, base + 30)])
            .await
            .unwrap();
        assert!(
            sent_keys().is_empty(),
            "last_seen within the same 5-minute step"
        );

        flush(vec![obs("cart", "v1", base, base + PUBLISH_STEP_MICROS)])
            .await
            .unwrap();
        assert_eq!(sent_keys(), vec!["v1"], "last_seen crossed a step");

        flush(vec![obs("cart", "v2", base - 5, base)])
            .await
            .unwrap();
        assert_eq!(sent_keys(), vec!["v2"], "first_seen moved");

        let mut relabelled = obs("cart", "v2", base + 1, base + 2);
        relabelled.version_source = "container.image.tag".to_string();
        flush(vec![relabelled.clone()]).await.unwrap();
        assert!(
            sent_keys().is_empty(),
            "an older observation does not win newest-wins fields"
        );
        relabelled.first_seen = base + 40;
        relabelled.last_seen = base + 50;
        flush(vec![relabelled]).await.unwrap();
        assert_eq!(sent_keys(), vec!["v2"], "version_source changed");
    }

    #[tokio::test]
    async fn a_scope_seen_in_two_envs_keeps_its_first_env_and_lists_both() {
        for (i, db) in dbs("sv_two_envs").await.into_iter().enumerate() {
            let org = format!("sv_two_envs_{i}");
            registry::mark_known(&org, Vec::<String>::new());
            let seen = |env: &str, first: i64, last: i64| {
                let mut o = obs("cart", "v1", first, last);
                o.env = env.to_string();
                o.env_source = EnvSource::Attribute;
                o.env_source_value = "deployment.environment".to_string();
                o
            };
            let request = |list: Vec<ServiceVersionObservation>| {
                let keyed = list
                    .into_iter()
                    .map(|o| {
                        let key = format!(
                            "{}\u{1f}{}\u{1f}{}",
                            o.source_stream,
                            o.version_key(&org),
                            o.env
                        );
                        (key, o)
                    })
                    .collect();
                queue_observations_with(&org, keyed, |_| {});
            };
            request(vec![seen("prod", 100, 900)]);
            flush_org_with(&db, &org).await.unwrap();
            request(vec![seen("staging", 200, 1000), seen("prod", 950, 990)]);
            flush_org_with(&db, &org).await.unwrap();
            request(vec![seen("staging", 1100, 1200)]);
            flush_org_with(&db, &org).await.unwrap();
            let rows = summaries(&db, &org).await;
            assert_eq!(rows.len(), 1, "one identity per (service, where, stream)");
            assert_eq!(
                (rows[0].env.as_str(), rows[0].envs.clone()),
                ("prod", vec!["prod".to_string(), "staging".to_string()]),
                "the env seen first stays; the second env is recorded, not swapped in"
            );
        }
    }
}
