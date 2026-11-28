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

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use config::{
    get_config,
    meta::{
        cluster::{Node, NodeStatus},
        secret_store::{
            GateState, SecretErrorCode, StoreGate, StoreMode,
            api::{AllowedConsumer, PinMode, PrivateLocations},
            grammar::parse_pins,
        },
    },
    utils::time::now_micros,
};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use tokio::time::{MissedTickBehavior, interval};

use super::{
    capability::{
        CapabilityRecord, FgaMode, LEASE_US, LEVEL_STORE, STORE_FLOOR_VERSION, coordinator,
        is_fresh, list_records_in, meets_release_floor,
    },
    mode,
};
use crate::{cluster::get_cached_nodes, db::Db, errors::Error};

const GATE_KEY: &str = "/secret_store/sys/gate";
const STALE_GRACE_US: i64 = 300_000_000;
static SNAPSHOT: RwLock<Option<Snapshot>> = RwLock::new(None);
// Concurrent local scans must publish membership and zombie observations in scan order.
static EVALUATOR: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[cfg(any(test, feature = "test-utils"))]
static TEST_STATE: RwLock<Option<GateView>> = RwLock::new(None);
#[cfg(test)]
static EVALUATIONS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GateView {
    pub state: GateState,
    pub suspended: bool,
}

impl GateView {
    pub fn effective(&self) -> GateState {
        if self.suspended {
            self.state.min(GateState::Writable)
        } else {
            self.state
        }
    }
}

pub struct ClusterGate;

impl StoreGate for ClusterGate {
    fn state(&self) -> Result<GateState, SecretErrorCode> {
        Ok(current().effective())
    }

    fn require(&self, min: GateState) -> Result<(), SecretErrorCode> {
        require(min)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LatchRecord {
    pub level: u32,
    pub latched_at: i64,
}

#[derive(Debug, Serialize)]
pub struct GateStatus {
    pub state: GateState,
    pub latched: bool,
    pub suspended: bool,
    pub reason: Option<String>,
    pub alert: bool,
    pub nodes: Vec<NodeCapability>,
}

#[derive(Debug, Serialize)]
pub struct NodeCapability {
    pub uuid: String,
    pub name: String,
    pub version: String,
    pub level: u32,
    pub refs_enabled: Option<bool>,
    pub fga_mode: Option<FgaMode>,
    pub fresh: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum GateReason {
    #[error("not_deployed")]
    NotDeployed,
    #[error("no_live_members")]
    NoLiveMembers,
    #[error("zombie:{0}")]
    Zombie(String),
    #[error("capability_missing:{0}")]
    CapabilityMissing(String),
    #[error("capability_stale:{0}")]
    CapabilityStale(String),
    #[error("refs_disabled:{0}")]
    RefsDisabled(String),
    #[error("fga_mode_mismatch")]
    FgaModeMismatch,
}

#[derive(Debug)]
pub struct Evaluation {
    pub view: GateView,
    pub reason: Option<GateReason>,
    pub alert: bool,
    pub latch_ready: bool,
    pub nodes: Vec<NodeCapability>,
}

impl Evaluation {
    fn not_deployed() -> Self {
        Self {
            view: GateView {
                state: GateState::Closed,
                suspended: false,
            },
            reason: Some(GateReason::NotDeployed),
            alert: false,
            latch_ready: false,
            nodes: Vec::new(),
        }
    }
}

struct GateInputs {
    members: Vec<Node>,
    records: HashMap<String, CapabilityRecord>,
    latched: bool,
    zombie_hold_us: i64,
}

impl GateInputs {
    fn new(
        mut members: Vec<Node>,
        records: HashMap<String, CapabilityRecord>,
        latched: bool,
        zombie_hold_us: i64,
    ) -> Self {
        members.retain(|node| node.status != NodeStatus::Offline);
        // Stable membership order keeps the reported reason stable across coordinator scans.
        members.sort_unstable_by(|a, b| a.uuid.cmp(&b.uuid));
        Self {
            members,
            records,
            latched,
            zombie_hold_us,
        }
    }

    fn fresh_record(&self, uuid: &str, now_us: i64) -> Option<&CapabilityRecord> {
        self.records
            .get(uuid)
            .filter(|record| is_fresh(record, now_us))
    }
}

struct Snapshot {
    inputs: GateInputs,
    memory: Memory,
    alert_reason: Option<GateReason>,
    view: Mutex<Option<CachedView>>,
}

impl Snapshot {
    /// The first instant after `now_us` at which a lease, grace or zombie hold can turn.
    fn view_turns_at(&self, now_us: i64) -> i64 {
        let leases = self
            .inputs
            .records
            .values()
            .map(|record| record.renewed_at.saturating_add(LEASE_US + 1));
        let graces = self
            .memory
            .last_fresh
            .values()
            .map(|record| record.renewed_at.saturating_add(STALE_GRACE_US + 1));
        let holds = self
            .memory
            .zombies
            .values()
            .map(|(_, seen)| seen.saturating_add(self.inputs.zombie_hold_us));
        leases
            .chain(graces)
            .chain(holds)
            .filter(|at| *at > now_us)
            .min()
            .unwrap_or(i64::MAX)
    }
}

#[derive(Clone, Copy)]
struct CachedView {
    view: GateView,
    from_us: i64,
    until_us: i64,
}

#[derive(Default)]
struct Memory {
    last_fresh: HashMap<String, CapabilityRecord>,
    zombies: HashMap<String, (String, i64)>,
}

impl Memory {
    fn observe(&mut self, inputs: &GateInputs, now_us: i64) {
        self.last_fresh
            .retain(|_, record| now_us.saturating_sub(record.renewed_at) <= STALE_GRACE_US);
        self.zombies
            .retain(|_, (_, seen)| now_us.saturating_sub(*seen) < inputs.zombie_hold_us);
        for node in &inputs.members {
            let record = inputs.fresh_record(&node.uuid, now_us);
            if let Some(record) = record {
                self.last_fresh.insert(node.uuid.clone(), record.clone());
            }
            if inputs.latched && is_zombie(node, record) {
                self.zombies
                    .insert(node.uuid.clone(), (node.name.clone(), now_us));
            }
        }
    }

    fn recent_record(&self, uuid: &str, now_us: i64) -> Option<&CapabilityRecord> {
        self.last_fresh
            .get(uuid)
            .filter(|record| now_us.saturating_sub(record.renewed_at) <= STALE_GRACE_US)
    }

    fn recent_zombie(&self, now_us: i64, hold_us: i64) -> Option<&str> {
        self.zombies
            .values()
            .filter(|(_, seen)| now_us.saturating_sub(*seen) < hold_us)
            .map(|(name, _)| name.as_str())
            .min()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PolicyChange {
    Narrowing,
    Widening,
}

pub struct PolicySnapshot {
    pub consumers: Vec<AllowedConsumer>,
    pub pin_mode: PinMode,
    pub hosts: Vec<String>,
    pub private_locations: PrivateLocations,
    pub grantees: Vec<String>,
}

pub fn current() -> GateView {
    configured_view().unwrap_or_else(|| cached_view(now_micros()))
}

pub fn require(min: GateState) -> Result<(), SecretErrorCode> {
    if current().effective() >= min {
        Ok(())
    } else {
        Err(SecretErrorCode::StoreGateClosed)
    }
}

/// Whether the store latch is on record. Unlike [`require`] it ignores this node's cached view, so
/// a stale or suspended node still applies write-only rules once any node latched.
pub async fn durably_latched() -> Result<bool, Error> {
    if mode::mode() != StoreMode::SingleCluster {
        return Ok(false);
    }
    durably_latched_in(coordinator().await?).await
}

pub async fn durably_latched_in(db: &dyn Db) -> Result<bool, Error> {
    Ok(read_latch(db).await?.is_some())
}

#[cfg(any(test, feature = "test-utils"))]
pub fn force_state_for_tests(state: Option<GateView>) {
    *TEST_STATE.write() = state;
}

#[cfg(any(test, feature = "test-utils"))]
pub fn reset_for_tests() {
    *SNAPSHOT.write() = None;
    force_state_for_tests(None);
}

pub fn status() -> GateStatus {
    let mut evaluation = cached_evaluation();
    if let Some(view) = configured_view() {
        evaluation.view = view;
        evaluation.reason = None;
        evaluation.alert = false;
    }
    GateStatus {
        state: evaluation.view.effective(),
        latched: evaluation.view.state == GateState::Latched,
        suspended: evaluation.view.suspended,
        reason: evaluation.reason.map(|reason| reason.to_string()),
        alert: evaluation.alert,
        nodes: evaluation.nodes,
    }
}

pub fn all_live_nodes_at_level(level: u32) -> bool {
    if mode::mode() != StoreMode::SingleCluster {
        return false;
    }
    let snapshot = SNAPSHOT.read();
    let Some(snapshot) = snapshot.as_ref() else {
        return false;
    };
    let inputs = &snapshot.inputs;
    let now_us = now_micros();
    !inputs.members.is_empty()
        && inputs.members.iter().all(|node| {
            meets_release_floor(&node.version, STORE_FLOOR_VERSION)
                && inputs
                    .fresh_record(&node.uuid, now_us)
                    .is_some_and(|record| record.level >= level)
        })
}

pub async fn evaluate_once_in(
    db: &dyn Db,
    members: Vec<Node>,
    now_us: i64,
) -> Result<Evaluation, Error> {
    let _guard = EVALUATOR.lock().await;
    if mode::mode() != StoreMode::SingleCluster {
        return Ok(Evaluation::not_deployed());
    }
    let records = list_records_in(db).await?;
    let latched = read_latch(db).await?.is_some();
    let hold_us = get_config()
        .limit
        .node_heartbeat_ttl
        .saturating_mul(2_000_000);
    let mut inputs = GateInputs::new(members, records, latched, hold_us);
    if !latched && evaluate(&inputs, &Memory::default(), now_us).latch_ready {
        let latch = LatchRecord {
            level: LEVEL_STORE,
            latched_at: now_us,
        };
        let value = serde_json::to_vec(&latch)?.into();
        if !db.put_if_revision(GATE_KEY, value, None).await? && read_latch(db).await?.is_none() {
            return Err(Error::Message(
                "secret store gate latch missing after CAS conflict".into(),
            ));
        }
        inputs.latched = true;
    }
    Ok(publish(inputs, now_us))
}

pub async fn run_evaluator() {
    let mut ticks = interval(Duration::from_secs(20));
    ticks.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        ticks.tick().await;
        if let Err(err) = evaluate_cluster().await {
            log::error!("failed to evaluate secret store gate: {err}");
        }
    }
}

pub fn classify_policy_change(old: &PolicySnapshot, new: &PolicySnapshot) -> PolicyChange {
    if (new.private_locations == PrivateLocations::On
        && old.private_locations != PrivateLocations::On)
        || !new.grantees.iter().all(|id| old.grantees.contains(id))
        || !new
            .consumers
            .iter()
            .all(|entry| consumer_covered(&old.consumers, entry))
        || !hosts_covered(old, new)
    {
        PolicyChange::Widening
    } else {
        PolicyChange::Narrowing
    }
}

fn configured_view() -> Option<GateView> {
    #[cfg(any(test, feature = "test-utils"))]
    {
        *TEST_STATE.read()
    }
    #[cfg(not(any(test, feature = "test-utils")))]
    {
        None
    }
}

/// The view only changes when the snapshot is replaced or a time threshold passes.
fn cached_view(now_us: i64) -> GateView {
    if mode::mode() != StoreMode::SingleCluster {
        return Evaluation::not_deployed().view;
    }
    let snapshot = SNAPSHOT.read();
    let Some(snapshot) = snapshot.as_ref() else {
        return Evaluation::not_deployed().view;
    };
    let mut cached = snapshot.view.lock();
    if let Some(hit) = *cached
        && (hit.from_us..hit.until_us).contains(&now_us)
    {
        return hit.view;
    }
    let view = evaluate(&snapshot.inputs, &snapshot.memory, now_us).view;
    *cached = Some(CachedView {
        view,
        from_us: now_us,
        until_us: snapshot.view_turns_at(now_us),
    });
    view
}

fn cached_evaluation() -> Evaluation {
    if mode::mode() != StoreMode::SingleCluster {
        return Evaluation::not_deployed();
    }
    SNAPSHOT
        .read()
        .as_ref()
        .map_or_else(Evaluation::not_deployed, |snapshot| {
            evaluate(&snapshot.inputs, &snapshot.memory, now_micros())
        })
}

async fn evaluate_cluster() -> Result<(), Error> {
    if mode::mode() != StoreMode::SingleCluster {
        return Ok(());
    }
    let db = coordinator().await?;
    let members = get_cached_nodes(|_| true).await.unwrap_or_default();
    evaluate_once_in(db, members, now_micros()).await?;
    Ok(())
}

async fn read_latch(db: &dyn Db) -> Result<Option<LatchRecord>, Error> {
    db.get_if_exists(GATE_KEY)
        .await?
        .map(|value| serde_json::from_slice(&value))
        .transpose()
        .map_err(Error::from)
}

fn publish(inputs: GateInputs, now_us: i64) -> Evaluation {
    let mut snapshot = SNAPSHOT.write();
    let (mut memory, previous_alert) = snapshot
        .take()
        .map(|previous| (previous.memory, previous.alert_reason))
        .unwrap_or_default();
    memory.observe(&inputs, now_us);
    let result = evaluate(&inputs, &memory, now_us);
    let alert_reason = result.reason.as_ref().filter(|_| result.alert);
    if let Some(reason) = alert_reason
        && Some(reason) != previous_alert.as_ref()
    {
        log::error!("[CRITICAL] secret store gate: {reason}");
    }
    *snapshot = Some(Snapshot {
        inputs,
        memory,
        alert_reason: alert_reason.cloned(),
        view: Mutex::default(),
    });
    result
}

fn evaluate(inputs: &GateInputs, memory: &Memory, now_us: i64) -> Evaluation {
    #[cfg(test)]
    EVALUATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nodes = inputs
        .members
        .iter()
        .map(|node| {
            let fresh = inputs.fresh_record(&node.uuid, now_us);
            let known = fresh.or_else(|| {
                memory
                    .recent_record(&node.uuid, now_us)
                    .filter(|_| inputs.latched)
            });
            NodeCapability {
                uuid: node.uuid.clone(),
                name: node.name.clone(),
                version: node.version.clone(),
                level: fresh
                    .filter(|_| meets_release_floor(&node.version, STORE_FLOOR_VERSION))
                    .map_or(0, |record| record.level),
                refs_enabled: known.map(|record| record.refs_enabled),
                fga_mode: known.map(|record| record.fga_mode),
                fresh: fresh.is_some(),
            }
        })
        .collect::<Vec<_>>();
    let reason = gate_reason(inputs, memory, &nodes, now_us);
    let suspended = inputs.latched
        && reason.is_some()
        && !matches!(reason, Some(GateReason::CapabilityStale(_)));
    let alert = suspended && !matches!(reason, Some(GateReason::RefsDisabled(_)));
    Evaluation {
        view: GateView {
            state: if inputs.latched {
                GateState::Latched
            } else {
                GateState::Writable
            },
            suspended,
        },
        latch_ready: !inputs.latched && reason.is_none(),
        nodes,
        reason,
        alert,
    }
}

fn gate_reason(
    inputs: &GateInputs,
    memory: &Memory,
    nodes: &[NodeCapability],
    now_us: i64,
) -> Option<GateReason> {
    if !inputs.latched && nodes.is_empty() {
        return Some(GateReason::NoLiveMembers);
    }
    if let Some(node) = inputs
        .members
        .iter()
        .find(|node| is_zombie(node, inputs.fresh_record(&node.uuid, now_us)))
    {
        return Some(GateReason::Zombie(node.name.clone()));
    }
    if inputs.latched
        && let Some(name) = memory.recent_zombie(now_us, inputs.zombie_hold_us)
    {
        return Some(GateReason::Zombie(name.to_owned()));
    }
    if let Some(node) = nodes.iter().find(|node| {
        !node.fresh && (!inputs.latched || memory.recent_record(&node.uuid, now_us).is_none())
    }) {
        return Some(GateReason::CapabilityMissing(node.name.clone()));
    }
    if let Some(node) = nodes
        .iter()
        .find(|node| node.fresh && node.refs_enabled == Some(false))
    {
        return Some(GateReason::RefsDisabled(node.name.clone()));
    }
    let mut modes = nodes
        .iter()
        .filter(|node| node.fresh)
        .filter_map(|node| node.fga_mode);
    if let Some(first) = modes.next()
        && modes.any(|mode| mode != first)
    {
        return Some(GateReason::FgaModeMismatch);
    }
    nodes
        .iter()
        .find(|node| !node.fresh)
        .map(|node| GateReason::CapabilityStale(node.name.clone()))
}

fn is_zombie(node: &Node, record: Option<&CapabilityRecord>) -> bool {
    !meets_release_floor(&node.version, STORE_FLOOR_VERSION)
        || record.is_some_and(|record| record.level < LEVEL_STORE)
}

fn consumer_covered(old: &[AllowedConsumer], new: &AllowedConsumer) -> bool {
    let mut matching = old
        .iter()
        .filter(|entry| entry.consumer_type == new.consumer_type)
        .peekable();
    if matching.peek().is_none() {
        return false;
    }
    let mut allowed_ids: HashSet<&String> = HashSet::new();
    for entry in matching {
        let Some(ids) = &entry.ids else { return true };
        allowed_ids.extend(ids.iter());
    }
    new.ids
        .as_ref()
        .is_some_and(|ids| ids.iter().all(|id| allowed_ids.contains(id)))
}

fn hosts_covered(old: &PolicySnapshot, new: &PolicySnapshot) -> bool {
    let (Ok(old_hosts), Ok(new_hosts)) = (parse_pins(&old.hosts), parse_pins(&new.hosts)) else {
        return false;
    };
    match (old.pin_mode, new.pin_mode) {
        // Clearing the last explicit pin needs the same authorization as widening the policy.
        (PinMode::Hosts, PinMode::None) => false,
        (PinMode::Hosts, PinMode::Hosts) if new_hosts.is_empty() => old_hosts.is_empty(),
        (PinMode::Hosts, PinMode::Hosts) => new_hosts
            .iter()
            .all(|new_pin| old_hosts.iter().any(|old_pin| old_pin.covers(new_pin))),
        (PinMode::Any | PinMode::Legacy, _) | (PinMode::None, PinMode::None) => true,
        (PinMode::None, PinMode::Hosts) => new_hosts.is_empty(),
        (PinMode::None | PinMode::Hosts, PinMode::Any | PinMode::Legacy) => false,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use config::{
        meta::secret_store::ConsumerType::{self, AlertDestination, PipelineDestination},
        utils::time::now_micros,
    };
    use parking_lot::Mutex;

    use super::*;
    use crate::{
        db::sqlite::SqliteDb,
        secret_store::capability::{LEVEL_P1_11, NODE_LEVEL, write_record_in},
        table::testing::{capture_error_logs, logged_errors_containing},
    };

    const SECOND: i64 = 1_000_000;
    const ZOMBIE_HOLD_US: i64 = 40 * SECOND;
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn gate_starts_closed_and_caps_suspended_state() {
        use GateState::{Closed, Latched, Writable};

        let _guard = TEST_LOCK.lock();
        reset_for_tests();
        assert_eq!(current().state, Closed);
        assert_eq!(status().reason.as_deref(), Some("not_deployed"));
        assert_eq!(require(Closed), Ok(()));
        for min in [Writable, Latched] {
            assert_eq!(require(min), Err(SecretErrorCode::StoreGateClosed));
        }
        let mut view = GateView {
            state: Latched,
            suspended: false,
        };
        force_state_for_tests(Some(view));
        assert_eq!(current(), view);
        for min in [Closed, Writable, Latched] {
            assert_eq!(require(min), Ok(()));
        }
        view.suspended = true;
        force_state_for_tests(Some(view));
        assert_eq!(require(Latched), Err(SecretErrorCode::StoreGateClosed));
        assert_eq!(require(Writable), Ok(()));
        force_state_for_tests(None);
        assert_eq!(current().state, Closed);
    }

    fn isolated_gate_test(name: &str, body: impl Future<Output = ()>) {
        isolated_store_test(&format!("secret_store::gate::tests::{name}"), body);
    }

    pub(crate) fn isolated_store_test(path: &str, body: impl Future<Output = ()>) {
        let _guard = TEST_LOCK.lock();
        if std::env::var("O2_SECRET_STORE_TEST").as_deref() == Ok(path) {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(body);
            return;
        }
        // Mode is process-wide and the latch must never be deleted from a configured database.
        let directory = tempfile::tempdir().unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        for (key, _) in
            std::env::vars_os().filter(|(key, _)| key.to_string_lossy().starts_with("ZO_"))
        {
            command.env_remove(key);
        }
        let output = command
            .args(["--exact", path, "--nocapture"])
            .current_dir(directory.path())
            .env("O2_SECRET_STORE_TEST", path)
            .env("ZO_LOCAL_MODE", "true")
            .env("ZO_META_STORE", "sqlite")
            .env("ZO_DATA_DIR", directory.path())
            .env("O2_SECRET_STORE_IGNORE_RELEASE_FLOOR", "false")
            .env(
                "ZO_META_POSTGRES_DSN",
                std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default(),
            )
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success() && stdout.contains("1 passed"),
            "{stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn member(name: &str) -> Node {
        Node {
            uuid: format!("uuid-{name}"),
            name: name.into(),
            version: STORE_FLOOR_VERSION.into(),
            status: NodeStatus::Prepare,
            ..Node::default()
        }
    }

    fn record(now: i64) -> CapabilityRecord {
        CapabilityRecord {
            level: NODE_LEVEL,
            binary_version: STORE_FLOOR_VERSION.into(),
            booted_at: now,
            refs_enabled: true,
            fga_mode: FgaMode::On,
            renewed_at: now,
        }
    }

    fn gate_inputs(names: &[&str], latched: bool, now: i64) -> GateInputs {
        let members: Vec<_> = names.iter().map(|name| member(name)).collect();
        let records = members
            .iter()
            .map(|node| (node.uuid.clone(), record(now)))
            .collect();
        GateInputs::new(members, records, latched, ZOMBIE_HOLD_US)
    }

    fn install_snapshot(inputs: GateInputs, memory: Memory) {
        *SNAPSHOT.write() = Some(Snapshot {
            inputs,
            memory,
            alert_reason: None,
            view: Mutex::default(),
        });
    }

    fn assert_decision(
        result: &Evaluation,
        effective: GateState,
        reason: Option<&str>,
        alert: bool,
    ) {
        assert_eq!(result.view.effective(), effective);
        assert_eq!(
            result.reason.as_ref().map(ToString::to_string).as_deref(),
            reason
        );
        assert_eq!(result.alert, alert);
    }

    #[test]
    fn d01_an_old_member_keeps_the_gate_writable() {
        isolated_gate_test("d01_an_old_member_keeps_the_gate_writable", async {
            let now = now_micros();
            let mut inputs = gate_inputs(&["a", "b", "old"], false, now);
            inputs
                .members
                .iter_mut()
                .find(|node| node.name == "old")
                .unwrap()
                .version = "v1.1.0".into();
            inputs.records.remove("uuid-old");
            let memory = Memory::default();
            let result = evaluate(&inputs, &memory, now);
            assert_decision(&result, GateState::Writable, Some("zombie:old"), false);
            assert!(!result.latch_ready);
            install_snapshot(inputs, memory);
            assert_eq!(
                require(GateState::Latched),
                Err(SecretErrorCode::StoreGateClosed)
            );
            assert_eq!(require(GateState::Writable), Ok(()));
        });
    }

    #[test]
    fn require_reuses_one_evaluation_until_a_lease_turns() {
        isolated_gate_test("require_reuses_one_evaluation_until_a_lease_turns", async {
            use std::sync::atomic::Ordering::Relaxed;

            let now = now_micros();
            install_snapshot(gate_inputs(&["a", "b"], true, now), Memory::default());
            let before = EVALUATIONS.load(Relaxed);
            for _ in 0..1_000 {
                assert_eq!(require(GateState::Latched), Ok(()));
            }
            assert!(
                EVALUATIONS.load(Relaxed) - before <= 1,
                "one evaluation per snapshot"
            );

            let before = EVALUATIONS.load(Relaxed);
            assert!(!cached_view(now + LEASE_US).suspended);
            assert!(
                cached_view(now + LEASE_US + 1).suspended,
                "an expired lease turns the view"
            );
            assert_eq!(EVALUATIONS.load(Relaxed) - before, 1);
            install_snapshot(gate_inputs(&["a"], true, now), Memory::default());
            assert!(
                !cached_view(now + 1).suspended,
                "a new snapshot drops the cached view"
            );
        });
    }

    #[test]
    fn d205_all_live_members_must_be_ready_to_latch() {
        let mut offline = member("offline");
        offline.status = NodeStatus::Offline;
        let now = 0;
        let empty = GateInputs::new(
            vec![offline.clone()],
            Default::default(),
            false,
            ZOMBIE_HOLD_US,
        );
        let memory = Memory::default();
        let result = evaluate(&empty, &memory, now);
        assert_decision(&result, GateState::Writable, Some("no_live_members"), false);
        assert!(!result.latch_ready);

        let healthy = gate_inputs(&["a", "b"], false, now);
        let mut members = healthy.members;
        members.push(offline);
        let mut inputs = GateInputs::new(members, healthy.records, false, ZOMBIE_HOLD_US);
        assert!(evaluate(&inputs, &memory, now).latch_ready);
        inputs.latched = true;
        let result = evaluate(&inputs, &memory, now);
        assert_decision(&result, GateState::Latched, None, false);
        assert_eq!(result.nodes.len(), 2);
    }

    #[test]
    fn d54_d147_d180_zombies_suspend_until_two_heartbeat_ttls_after_last_seen() {
        isolated_gate_test(
            "d54_d147_d180_zombies_suspend_until_two_heartbeat_ttls_after_last_seen",
            async {
                for old_version in [true, false] {
                    let now = now_micros();
                    let mut inputs = gate_inputs(&["peer", "z"], true, now);
                    if old_version {
                        inputs
                            .members
                            .iter_mut()
                            .find(|node| node.name == "z")
                            .unwrap()
                            .version = "v1.1.0".into();
                        inputs.records.remove("uuid-z");
                    } else {
                        inputs.records.get_mut("uuid-z").unwrap().level = 0;
                    }
                    let mut memory = Memory::default();
                    memory.observe(&inputs, now);
                    let result = evaluate(&inputs, &memory, now);
                    assert_decision(&result, GateState::Writable, Some("zombie:z"), true);
                    assert!(result.view.suspended);
                    inputs.members.retain(|node| node.name != "z");
                    inputs.records.remove("uuid-z");
                    let before = now + ZOMBIE_HOLD_US - SECOND;
                    memory.observe(&inputs, before);
                    assert_decision(
                        &evaluate(&inputs, &memory, before),
                        GateState::Writable,
                        Some("zombie:z"),
                        true,
                    );
                    assert_decision(
                        &evaluate(&inputs, &memory, before + 2 * SECOND),
                        GateState::Latched,
                        None,
                        false,
                    );
                    install_snapshot(inputs, memory);
                    assert_eq!(
                        require(GateState::Latched),
                        Err(SecretErrorCode::StoreGateClosed)
                    );
                    assert_eq!(require(GateState::Writable), Ok(()));
                }
            },
        );
    }

    #[test]
    fn d162_disabling_refs_suspends_without_alerting() {
        let mut inputs = gate_inputs(&["a", "b"], false, 0);
        inputs.records.get_mut("uuid-b").unwrap().refs_enabled = false;
        let memory = Memory::default();
        let before = evaluate(&inputs, &memory, 0);
        assert_decision(&before, GateState::Writable, Some("refs_disabled:b"), false);
        assert!(!before.latch_ready);
        inputs.latched = true;
        let after = evaluate(&inputs, &memory, 0);
        assert_decision(&after, GateState::Writable, Some("refs_disabled:b"), false);
        assert!(after.view.suspended);
        inputs.records.get_mut("uuid-b").unwrap().refs_enabled = true;
        assert_decision(
            &evaluate(&inputs, &memory, 0),
            GateState::Latched,
            None,
            false,
        );
    }

    #[test]
    fn mixed_fga_modes_alert_after_latching_and_uniform_modes_recover() {
        let mut inputs = gate_inputs(&["a", "b"], false, 0);
        inputs.records.get_mut("uuid-b").unwrap().fga_mode = FgaMode::Off;
        let memory = Memory::default();
        let before = evaluate(&inputs, &memory, 0);
        assert_decision(
            &before,
            GateState::Writable,
            Some("fga_mode_mismatch"),
            false,
        );
        assert!(!before.latch_ready);
        inputs.latched = true;
        let after = evaluate(&inputs, &memory, 0);
        assert_decision(&after, GateState::Writable, Some("fga_mode_mismatch"), true);
        assert!(after.view.suspended);
        inputs.records.get_mut("uuid-a").unwrap().fga_mode = FgaMode::Off;
        assert_decision(
            &evaluate(&inputs, &memory, 0),
            GateState::Latched,
            None,
            false,
        );
    }

    #[test]
    fn d297_a_lapsed_record_stays_latched_for_five_minutes() {
        isolated_gate_test(
            "d297_a_lapsed_record_stays_latched_for_five_minutes",
            async {
                let renewed = now_micros() - 301 * SECOND;
                let inputs = gate_inputs(&["a"], true, renewed);
                let mut memory = Memory::default();
                memory.observe(&inputs, renewed);
                let stale = evaluate(&inputs, &memory, renewed + 90 * SECOND);
                assert_decision(
                    &stale,
                    GateState::Latched,
                    Some("capability_stale:a"),
                    false,
                );
                assert!(!stale.nodes[0].fresh);

                let missing = evaluate(&inputs, &memory, renewed + 301 * SECOND);
                assert_decision(
                    &missing,
                    GateState::Writable,
                    Some("capability_missing:a"),
                    true,
                );
                install_snapshot(inputs, memory);
                assert_eq!(
                    require(GateState::Latched),
                    Err(SecretErrorCode::StoreGateClosed)
                );
                assert_eq!(status().reason.as_deref(), Some("capability_missing:a"));
                let now = now_micros();
                {
                    let mut stored = SNAPSHOT.write();
                    let snapshot = stored.as_mut().unwrap();
                    snapshot.inputs.records.insert("uuid-a".into(), record(now));
                    snapshot.memory.observe(&snapshot.inputs, now);
                    // Production only replaces the snapshot, which drops its cached view.
                    snapshot.view = Mutex::default();
                }
                assert_eq!(require(GateState::Latched), Ok(()));
                assert_eq!(status().reason, None);
            },
        );
    }

    #[test]
    fn a_member_never_seen_with_a_record_has_no_grace_period() {
        let mut inputs = gate_inputs(&["a"], false, 0);
        inputs.records.clear();
        let memory = Memory::default();
        let before = evaluate(&inputs, &memory, 0);
        assert_decision(
            &before,
            GateState::Writable,
            Some("capability_missing:a"),
            false,
        );
        assert!(!before.latch_ready);
        inputs.latched = true;
        assert_decision(
            &evaluate(&inputs, &memory, 0),
            GateState::Writable,
            Some("capability_missing:a"),
            true,
        );
    }

    #[test]
    fn all_live_nodes_must_claim_the_requested_level() {
        isolated_gate_test("all_live_nodes_must_claim_the_requested_level", async {
            assert!(!all_live_nodes_at_level(LEVEL_P1_11));
            let now = now_micros();
            for (level, expected) in [(LEVEL_STORE, false), (LEVEL_P1_11, true)] {
                let mut inputs = gate_inputs(&["a", "b"], true, now);
                inputs.records.get_mut("uuid-b").unwrap().level = level;
                install_snapshot(inputs, Memory::default());
                assert_eq!(all_live_nodes_at_level(LEVEL_P1_11), expected);
            }
        });
    }

    #[test]
    fn non_release_nodes_require_explicit_release_floor_override() {
        isolated_gate_test(
            "non_release_nodes_require_explicit_release_floor_override",
            async {
                crate::db::create_table().await.unwrap();
                let db = SqliteDb::default();
                let now = now_micros();
                let mut node = member("non-release");
                node.version = "v1.2.0-rc1".into();
                let mut capability = record(now);
                capability.binary_version = node.version.clone();
                write_record_in(&db, &node.uuid, &capability).await.unwrap();

                let blocked = evaluate_once_in(&db, vec![node.clone()], now)
                    .await
                    .unwrap();
                assert_decision(
                    &blocked,
                    GateState::Writable,
                    Some("zombie:non-release"),
                    false,
                );
                assert_eq!(blocked.nodes[0].level, 0);
                assert!(!all_live_nodes_at_level(LEVEL_P1_11));
                assert!(!durably_latched_in(&db).await.unwrap());

                let mut cfg = config::config::init();
                cfg.common.secret_store_ignore_release_floor = true;
                config::CONFIG.store(std::sync::Arc::new(cfg));
                let allowed = evaluate_once_in(&db, vec![node], now + 1).await.unwrap();
                assert_decision(&allowed, GateState::Latched, None, false);
                assert_eq!(allowed.nodes[0].level, NODE_LEVEL);
                assert!(all_live_nodes_at_level(LEVEL_P1_11));
                assert!(durably_latched_in(&db).await.unwrap());
            },
        );
    }

    #[test]
    fn concurrent_evaluators_create_the_latch_once() {
        isolated_gate_test("concurrent_evaluators_create_the_latch_once", async {
            crate::db::create_table().await.unwrap();
            let db = SqliteDb::default();
            let now = now_micros();
            let node = member(&format!("cas-{now}"));
            write_record_in(&db, &node.uuid, &record(now))
                .await
                .unwrap();
            assert!(!durably_latched_in(&db).await.unwrap());
            let (first, second) = tokio::join!(
                evaluate_once_in(&db, vec![node.clone()], now),
                evaluate_once_in(&db, vec![node.clone()], now + 1),
            );
            assert_decision(&first.unwrap(), GateState::Latched, None, false);
            assert_decision(&second.unwrap(), GateState::Latched, None, false);
            let latch = read_latch(&db).await.unwrap().unwrap();
            assert!([now, now + 1].contains(&latch.latched_at));
            assert_eq!(latch.level, LEVEL_STORE);
            let third = evaluate_once_in(&db, vec![node.clone()], now + 2)
                .await
                .unwrap();
            assert_decision(&third, GateState::Latched, None, false);
            assert_eq!(
                read_latch(&db).await.unwrap().unwrap().latched_at,
                latch.latched_at
            );

            capture_error_logs();
            let mut zombie = node.clone();
            zombie.version = "v1.1.0".into();
            for tick in [3, 4] {
                let suspended = evaluate_once_in(&db, vec![zombie.clone()], now + tick)
                    .await
                    .unwrap();
                assert!(suspended.alert);
            }
            assert_eq!(
                require(GateState::Latched),
                Err(SecretErrorCode::StoreGateClosed)
            );
            assert!(durably_latched_in(&db).await.unwrap());
            let message = format!("[CRITICAL] secret store gate: zombie:{}", node.name);
            assert_eq!(logged_errors_containing(&message).len(), 1);
        });
    }

    #[test]
    fn super_cluster_closes_a_latched_gate_and_accepts_capability_writes() {
        isolated_gate_test(
            "super_cluster_closes_a_latched_gate_and_accepts_capability_writes",
            async {
                crate::db::create_table().await.unwrap();
                let db = SqliteDb::default();
                let now = now_micros();
                let id = format!("sc-{now}");
                install_snapshot(gate_inputs(&["a"], true, now), Memory::default());
                assert_eq!(current().effective(), GateState::Latched);
                crate::secret_store::mode::set_super_cluster(true, "r");
                let write = write_record_in(&db, &id, &record(now)).await;
                let state = current().effective();
                let closed_reason = status().reason;
                crate::secret_store::mode::set_super_cluster(false, "r");
                write.unwrap();
                assert_eq!(state, GateState::Closed);
                assert_eq!(closed_reason.as_deref(), Some("not_deployed"));
            },
        );
    }

    fn snapshot() -> PolicySnapshot {
        PolicySnapshot {
            consumers: vec![],
            pin_mode: PinMode::None,
            hosts: vec![],
            private_locations: PrivateLocations::Off,
            grantees: vec![],
        }
    }

    #[test]
    fn host_policy_changes() {
        use PinMode::{Any, Hosts, Legacy, None};
        use PolicyChange::{Narrowing, Widening};

        let empty: &[&str] = &[];
        let one: &[&str] = &["a.example.com"];
        let two: &[&str] = &["a.example.com", "b.example.com"];
        let wildcard: &[&str] = &["*.example.com"];
        let invalid: &[&str] = &["http://example.com"];
        let pins = |pin_mode, hosts: &[&str]| PolicySnapshot {
            pin_mode,
            hosts: hosts.iter().map(|s| s.to_string()).collect(),
            ..snapshot()
        };
        for (old_mode, old, new_mode, new, expected) in [
            (None, empty, None, empty, Narrowing),
            (Hosts, one, Hosts, one, Narrowing),
            (None, empty, Hosts, one, Widening),
            (Hosts, one, Hosts, two, Widening),
            (Hosts, two, Hosts, one, Narrowing),
            (Hosts, one, None, empty, Widening),
            (Hosts, one, Hosts, empty, Widening),
            (Hosts, one, Any, empty, Widening),
            (Hosts, one, Legacy, empty, Widening),
            (Any, empty, Hosts, two, Narrowing),
            (Legacy, empty, Hosts, two, Narrowing),
            (Hosts, wildcard, Hosts, one, Narrowing),
            (Hosts, one, Hosts, wildcard, Widening),
            (Hosts, invalid, Hosts, one, Widening),
            (Any, empty, Hosts, invalid, Widening),
        ] {
            assert_eq!(
                classify_policy_change(&pins(old_mode, old), &pins(new_mode, new)),
                expected,
                "{old_mode:?} {old:?} to {new_mode:?} {new:?}"
            );
        }
    }

    #[test]
    fn consumer_policy_changes() {
        use PolicyChange::{Narrowing, Widening};

        let policy = |consumers| PolicySnapshot {
            consumers,
            ..snapshot()
        };
        let consumer = |consumer_type: ConsumerType, ids: Option<&[&str]>| AllowedConsumer {
            consumer_type,
            ids: ids.map(|ids| ids.iter().map(|s| s.to_string()).collect()),
        };
        let one = policy(vec![consumer(AlertDestination, Some(&["a"]))]);
        let two = policy(vec![consumer(AlertDestination, Some(&["a", "b"]))]);
        let all = policy(vec![consumer(AlertDestination, None)]);
        let extra_type = policy(vec![
            consumer(AlertDestination, None),
            consumer(PipelineDestination, None),
        ]);
        for (old, new, expected) in [
            (&one, &one, Narrowing),
            (&one, &two, Widening),
            (&two, &one, Narrowing),
            (&one, &all, Widening),
            (&all, &two, Narrowing),
            (&all, &extra_type, Widening),
            (&extra_type, &all, Narrowing),
        ] {
            assert_eq!(classify_policy_change(old, new), expected);
        }
    }

    #[test]
    fn grantees_and_private_location_changes() {
        use PolicyChange::{Narrowing, Widening};
        use PrivateLocations::{Legacy, Off, On};

        let old = snapshot();
        let mut new = snapshot();
        new.grantees.push("team".to_owned());
        assert_eq!(classify_policy_change(&old, &new), Widening);
        assert_eq!(classify_policy_change(&new, &old), Narrowing);

        let mut old = old;
        new.grantees.clear();
        for (before, after, expected) in [
            (Off, On, Widening),
            (Legacy, On, Widening),
            (On, Off, Narrowing),
            (On, Legacy, Narrowing),
            (Off, Legacy, Narrowing),
        ] {
            old.private_locations = before;
            new.private_locations = after;
            assert_eq!(classify_policy_change(&old, &new), expected);
        }
    }
}
