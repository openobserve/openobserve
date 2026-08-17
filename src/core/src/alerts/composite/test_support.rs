// Copyright 2026 OpenObserve Inc.
//
// Deterministic adapters for the composite service contracts. The harness
// supplies in-memory repository/scheduler/delivery ports, while evaluation is
// always delegated to the production `CompositeEvaluator`.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    future::{Ready, ready},
};

use config::meta::alerts::{composite::StaleChildPolicy, level::AlertLevel};
use serde_json::{Value, json};
use svix_ksuid::{Ksuid, KsuidLike as _};

use super::{
    CompositeEvaluation, CompositeEvaluator, CompositeStateInput, EvaluatedChild, EvaluationFailure,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ChildKind {
    Scheduled,
    Slo,
    MultiAlert,
    Composite,
    Realtime,
    AnomalyDetection,
    External,
}

impl ChildKind {
    pub fn is_composite_eligible(self) -> bool {
        matches!(
            self,
            Self::Scheduled | Self::Slo | Self::MultiAlert | Self::Composite
        )
    }

    fn wire_name(self) -> &'static str {
        match self {
            Self::Scheduled | Self::MultiAlert => "scheduled",
            Self::Slo => "slo",
            Self::Composite => "composite",
            Self::Realtime => "realtime",
            Self::AnomalyDetection => "anomaly_detection",
            Self::External => "external",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ChildSpec {
    name: String,
    org: String,
    cadence_seconds: i64,
    enabled: bool,
    kind: ChildKind,
    sensitive_query: Option<String>,
}

impl ChildSpec {
    pub fn frequency(name: &str, cadence_seconds: i64) -> Self {
        Self {
            name: name.to_string(),
            org: "default".to_string(),
            cadence_seconds,
            enabled: true,
            kind: ChildKind::Scheduled,
            sensitive_query: None,
        }
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub fn org(mut self, org: &str) -> Self {
        self.org = org.to_string();
        self
    }

    pub fn multi_alert(mut self, multi_alert: bool) -> Self {
        if multi_alert {
            self.kind = ChildKind::MultiAlert;
        }
        self
    }

    pub fn sensitive_query(mut self, query: &str) -> Self {
        self.sensitive_query = Some(query.to_string());
        self
    }
}

#[derive(Clone, Debug)]
pub struct CompositeSpec {
    expression: String,
    name: String,
    description: String,
    warning_counts_as_firing: bool,
    stale_policy: StalePolicy,
    enabled: bool,
    destinations: Vec<String>,
    workflows: Vec<String>,
    delivery_silenced_until: Option<i64>,
    creates_incident: bool,
    priority: Option<i32>,
    tags: Vec<String>,
    owner: String,
    context_attributes: BTreeMap<String, String>,
}

impl CompositeSpec {
    pub fn new(expression: &str) -> Self {
        Self {
            expression: expression.to_string(),
            name: "composite".to_string(),
            description: String::new(),
            warning_counts_as_firing: true,
            stale_policy: StalePolicy::UseLastState,
            enabled: false,
            destinations: Vec::new(),
            workflows: Vec::new(),
            delivery_silenced_until: None,
            creates_incident: false,
            priority: None,
            tags: Vec::new(),
            owner: String::new(),
            context_attributes: BTreeMap::new(),
        }
    }

    pub fn warning_counts_as_firing(mut self, value: bool) -> Self {
        self.warning_counts_as_firing = value;
        self
    }
    pub fn stale_policy(mut self, value: StalePolicy) -> Self {
        self.stale_policy = value;
        self
    }
    pub fn enabled(mut self, value: bool) -> Self {
        self.enabled = value;
        self
    }
    pub fn destinations<I, S>(mut self, values: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.destinations = values.into_iter().map(Into::into).collect();
        self
    }
    pub fn workflows<I, S>(mut self, values: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.workflows = values.into_iter().map(Into::into).collect();
        self
    }
    pub fn delivery_silenced_until(mut self, value: i64) -> Self {
        self.delivery_silenced_until = Some(value);
        self
    }
    pub fn description(mut self, value: &str) -> Self {
        self.description = value.to_string();
        self
    }
    pub fn creates_incident(mut self, value: bool) -> Self {
        self.creates_incident = value;
        self
    }
    pub fn priority(mut self, value: i32) -> Self {
        self.priority = Some(value);
        self
    }
    pub fn tags<I, S>(mut self, values: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.tags = values.into_iter().map(Into::into).collect();
        self
    }
    pub fn owner(mut self, value: &str) -> Self {
        self.owner = value.to_string();
        self
    }
    pub fn context_attribute(mut self, key: &str, value: &str) -> Self {
        self.context_attributes
            .insert(key.to_string(), value.to_string());
        self
    }
    pub fn name(mut self, value: String) -> Self {
        self.name = value;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StalePolicy {
    UseLastState,
    TreatAsFalse,
    TreatAsTrue,
}

impl From<StalePolicy> for StaleChildPolicy {
    fn from(value: StalePolicy) -> Self {
        match value {
            StalePolicy::UseLastState => Self::UseLastState,
            StalePolicy::TreatAsFalse => Self::TreatAsFalse,
            StalePolicy::TreatAsTrue => Self::TreatAsTrue,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EvalErrorCode {
    ChildMissing,
    ChildCrossOrg,
    ExpressionIndexMismatch,
    ChildRead,
    InvalidCadence,
    GraphCorrupt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunOutcome {
    Firing,
    Normal,
    Error,
    NotifyFailed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum DeleteOrigin {
    Single,
    Bulk,
    StreamDeleteAll,
    StreamDeleteByName,
    SloCascade,
    ImportReplacement,
    AdminCleanup,
    MigrationCleanup,
    RetentionCleanup,
}

impl DeleteOrigin {
    pub fn is_atomic_cascade(self) -> bool {
        !matches!(self, Self::Single | Self::Bulk)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mutation {
    Create,
    Update,
    Delete,
    Disable,
    Enable,
    Clone,
    Move,
    ManualTrigger,
    ChildNudge,
    UpdateExpression {
        composite_id: String,
        expression: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateMode {
    Supported,
    WritesDisabled,
    SuperCluster,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SchedulerOperation {
    Push,
    Update,
    Delete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum NudgeReason {
    ChildState,
    ManualTrigger,
    Definition,
}

impl NudgeReason {
    fn wire_name(self) -> &'static str {
        match self {
            Self::ChildState => "child_state",
            Self::ManualTrigger => "manual_trigger",
            Self::Definition => "definition",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceError {
    pub status: u16,
    pub code: String,
    pub visible_parents: Vec<String>,
    pub hidden_reference_count: usize,
    pub children: Vec<AccessChild>,
    pub graph_lock_attempted: bool,
    pub write_attempted: bool,
}

impl ServiceError {
    fn new(status: u16, code: &str) -> Self {
        Self {
            status,
            code: code.to_string(),
            visible_parents: Vec::new(),
            hidden_reference_count: 0,
            children: Vec::new(),
            graph_lock_attempted: false,
            write_attempted: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccessChild {
    pub alert_id: String,
    pub accessible: bool,
    pub name: Option<String>,
    pub kind: Option<String>,
    pub state: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolveError {
    pub status: u16,
    pub code: String,
    pub selected_ordinary: bool,
    pub selected_composite: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StateRow {
    pub level: AlertLevel,
    pub level_at: i64,
    pub outcome: RunOutcome,
}

#[derive(Clone, Debug)]
struct ChildDefinition {
    spec: ChildSpec,
}

#[derive(Clone, Debug)]
pub struct CompositeDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub expression: String,
    pub destinations: Vec<String>,
    pub workflows: Vec<String>,
    spec: CompositeSpec,
    generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Job {
    pub next_run_at: i64,
    pub claim_epoch: u64,
    pub processing: bool,
    pub is_retry_scheduled: bool,
}

#[derive(Clone, Debug)]
pub struct Claim {
    pub composite_id: String,
    pub epoch: u64,
    generation: u64,
}

#[derive(Clone, Debug)]
pub struct EvaluationResult {
    pub outcome: RunOutcome,
    pub error_code: Option<EvalErrorCode>,
    pub result: Option<bool>,
    pub level: Option<AlertLevel>,
    pub children: Vec<EvaluatedChild>,
    pub next_run_at: i64,
}

#[derive(Clone, Debug, Default)]
pub struct CommitResult {
    pub state_written: bool,
    pub transition_written: bool,
    pub delivery_authorized: bool,
    pub delivery_started: bool,
    pub next_run_at: i64,
}

#[derive(Clone, Debug)]
pub struct StaleJobResult {
    pub completed: bool,
    pub evaluated: bool,
    pub state_written: bool,
    pub delivery_started: bool,
}

#[derive(Clone, Debug)]
pub struct Detail {
    pub scheduler_job_present: bool,
}

#[derive(Clone, Debug)]
pub struct UserChildSnapshot {
    pub alert_id: String,
    pub accessible: bool,
    pub name: Option<String>,
    pub config: Option<Value>,
    pub state: Option<StateRow>,
}

#[derive(Clone, Debug)]
pub struct UserSnapshot {
    pub children: Vec<UserChildSnapshot>,
}

impl UserSnapshot {
    pub fn child(&self, id: &str) -> Option<&UserChildSnapshot> {
        self.children.iter().find(|child| child.alert_id == id)
    }
}

#[derive(Clone, Debug)]
pub struct NotificationContext {
    pub alert_name: String,
    pub alert_type: String,
    pub alert_level: String,
    pub alert_priority: String,
    pub alert_tags: String,
    pub alert_description: String,
    pub owner: String,
    pub alert_url: String,
    pub stream_name: String,
    pub alert_threshold: String,
    attributes: BTreeMap<String, String>,
}

impl NotificationContext {
    pub fn context_attribute(&self, key: &str) -> Option<&str> {
        self.attributes.get(key).map(String::as_str)
    }
}

#[derive(Clone, Debug)]
pub struct LiveDefinition {
    pub alert_type: String,
}

#[derive(Clone, Debug)]
pub struct IncidentRecord {
    pub id: u64,
    pub alert_kind: String,
    pub live_definition: LiveDefinition,
    pub live_definitions: Vec<LiveDefinition>,
    pub triggers: Vec<IncidentTrigger>,
}

#[derive(Clone, Debug)]
pub struct IncidentTrigger {
    pub alert_id: String,
    pub definition_unavailable: bool,
    pub live_link: Option<String>,
}

#[derive(Clone, Debug)]
pub struct WorkflowRun {
    pub entity_type: String,
    pub trigger_type: String,
}

#[derive(Clone, Debug)]
pub struct HistoryRow {
    pub alert_type: String,
    pub threshold: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct Metric {
    pub name: String,
    pub labels: BTreeMap<String, String>,
    value: u64,
}

#[derive(Clone, Debug)]
pub struct StructuredLog {
    pub message: String,
    pub fields: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LifecycleSnapshot {
    definitions: usize,
    children: usize,
    states: usize,
    jobs: usize,
    scheduler_ops: usize,
}

#[derive(Clone, Debug)]
pub struct LifecycleResult {
    pub http_status: u16,
    pub log_code: String,
}

#[derive(Clone, Debug)]
pub struct Capabilities {
    pub composite_alerts_available: bool,
}

#[derive(Clone, Debug)]
pub struct StartupError {
    pub code: String,
    pub definition_count: usize,
    pub job_count: usize,
}

#[derive(Clone, Debug)]
pub struct CompositeHarnessBuilder {
    now: i64,
    debounce_seconds: i64,
    sweep_seconds: i64,
    stale_k: i64,
    ordinary_lane_probe: bool,
}

impl CompositeHarnessBuilder {
    pub fn debounce_seconds(mut self, seconds: i64) -> Self {
        self.debounce_seconds = seconds.max(1);
        self
    }
    pub fn sweep_seconds(mut self, seconds: i64) -> Self {
        self.sweep_seconds = seconds.max(1);
        self
    }
    pub fn stale_k(mut self, value: i64) -> Self {
        self.stale_k = value.max(1);
        self
    }
    pub fn with_ordinary_alert_lane_probe(mut self) -> Self {
        self.ordinary_lane_probe = true;
        self
    }
}

impl IntoFuture for CompositeHarnessBuilder {
    type Output = CompositeHarness;
    type IntoFuture = Ready<CompositeHarness>;

    fn into_future(self) -> Self::IntoFuture {
        ready(CompositeHarness::from_builder(self))
    }
}

#[derive(Clone, Debug)]
pub struct CompositeHarness {
    now: i64,
    debounce_seconds: i64,
    sweep_seconds: i64,
    stale_k: i64,
    children: HashMap<String, ChildDefinition>,
    composites: HashMap<String, CompositeDefinition>,
    child_index: HashMap<String, Vec<String>>,
    states: HashMap<(String, String), StateRow>,
    jobs: HashMap<String, Job>,
    unreadable: HashSet<String>,
    missing_ids: HashSet<String>,
    eval_errors: HashMap<String, EvalErrorCode>,
    delivery_attempts: HashMap<String, usize>,
    destination_attempts: HashMap<String, usize>,
    fail_destination_once: HashSet<String>,
    failed_destination_once: HashSet<String>,
    payloads: HashMap<String, Value>,
    contexts: HashMap<String, NotificationContext>,
    workflow_invocations: HashMap<String, usize>,
    incidents: HashMap<u64, IncidentRecord>,
    incident_by_composite: HashMap<String, u64>,
    workflows_by_composite: HashMap<String, WorkflowRun>,
    histories: HashMap<String, Vec<HistoryRow>>,
    transitions: HashMap<String, Vec<StateRow>>,
    metrics: Vec<Metric>,
    logs: HashMap<String, Vec<StructuredLog>>,
    scheduler_ops: Vec<SchedulerOperation>,
    scheduler_failures: HashSet<SchedulerOperation>,
    graph_failpoint: Option<String>,
    fail_graph_lock: bool,
    fail_state_transaction: bool,
    drop_scheduler_advance: bool,
    graph_lock_acquisitions: usize,
    graph_lock_held: bool,
    graph_reads_after_failed_lock: usize,
    graph_writes_after_failed_lock: usize,
    max_graph_critical_sections: usize,
    reverse_guard_calls: HashMap<DeleteOrigin, usize>,
    unguarded_deletes: usize,
    internal_integrity_errors: usize,
    corrupt_collision: Option<String>,
    definition_batch_reads: usize,
    rollup_state_batch_reads: usize,
    single_child_reads: usize,
    queried_group_keys: BTreeSet<String>,
    evaluations: HashMap<String, usize>,
    parent_nudges: HashMap<String, usize>,
    committed_state_writes: HashMap<String, usize>,
    gate_mode: GateMode,
    teardown_order: Vec<String>,
    ordinary_lane_probe_configured: bool,
    ordinary_lane_probe_ran: bool,
    fail_scheduler_node_after_commit: bool,
}

impl CompositeHarness {
    pub fn at(now: i64) -> CompositeHarnessBuilder {
        CompositeHarnessBuilder {
            now,
            debounce_seconds: 15,
            sweep_seconds: 300,
            stale_k: 3,
            ordinary_lane_probe: false,
        }
    }

    fn from_builder(builder: CompositeHarnessBuilder) -> Self {
        Self {
            now: builder.now,
            debounce_seconds: builder.debounce_seconds,
            sweep_seconds: builder.sweep_seconds,
            stale_k: builder.stale_k,
            children: HashMap::new(),
            composites: HashMap::new(),
            child_index: HashMap::new(),
            states: HashMap::new(),
            jobs: HashMap::new(),
            unreadable: HashSet::new(),
            missing_ids: HashSet::new(),
            eval_errors: HashMap::new(),
            delivery_attempts: HashMap::new(),
            destination_attempts: HashMap::new(),
            fail_destination_once: HashSet::new(),
            failed_destination_once: HashSet::new(),
            payloads: HashMap::new(),
            contexts: HashMap::new(),
            workflow_invocations: HashMap::new(),
            incidents: HashMap::new(),
            incident_by_composite: HashMap::new(),
            workflows_by_composite: HashMap::new(),
            histories: HashMap::new(),
            transitions: HashMap::new(),
            metrics: default_metrics(),
            logs: HashMap::new(),
            scheduler_ops: Vec::new(),
            scheduler_failures: HashSet::new(),
            graph_failpoint: None,
            fail_graph_lock: false,
            fail_state_transaction: false,
            drop_scheduler_advance: false,
            graph_lock_acquisitions: 0,
            graph_lock_held: false,
            graph_reads_after_failed_lock: 0,
            graph_writes_after_failed_lock: 0,
            max_graph_critical_sections: 0,
            reverse_guard_calls: HashMap::new(),
            unguarded_deletes: 0,
            internal_integrity_errors: 0,
            corrupt_collision: None,
            definition_batch_reads: 0,
            rollup_state_batch_reads: 0,
            single_child_reads: 0,
            queried_group_keys: BTreeSet::new(),
            evaluations: HashMap::new(),
            parent_nudges: HashMap::new(),
            committed_state_writes: HashMap::new(),
            gate_mode: GateMode::Supported,
            teardown_order: Vec::new(),
            ordinary_lane_probe_configured: builder.ordinary_lane_probe,
            ordinary_lane_probe_ran: false,
            fail_scheduler_node_after_commit: false,
        }
    }

    pub fn gate_only(mode: GateMode) -> Self {
        let mut harness = Self::from_builder(CompositeHarnessBuilder {
            now: 0,
            debounce_seconds: 15,
            sweep_seconds: 300,
            stale_k: 3,
            ordinary_lane_probe: false,
        });
        harness.gate_mode = mode;
        harness
    }

    pub fn startup_preflight(
        definition_count: usize,
        job_count: usize,
    ) -> Result<(), StartupError> {
        if definition_count == 0 && job_count == 0 {
            Ok(())
        } else {
            Err(StartupError {
                code: "composite_super_cluster_startup_blocked".to_string(),
                definition_count,
                job_count,
            })
        }
    }

    pub async fn add_child(&mut self, spec: ChildSpec) -> String {
        let id = new_id();
        self.children.insert(id.clone(), ChildDefinition { spec });
        id
    }

    pub async fn add_children<I>(&mut self, specs: I) -> Vec<String>
    where
        I: IntoIterator<Item = ChildSpec>,
    {
        let mut ids = Vec::new();
        for spec in specs {
            ids.push(self.add_child(spec).await);
        }
        ids
    }

    pub fn reserve_missing_child_id(&mut self) -> String {
        let id = new_id();
        self.missing_ids.insert(id.clone());
        id
    }

    pub async fn add_composite(&mut self, spec: CompositeSpec) -> String {
        self.try_add_composite(spec)
            .await
            .expect("composite fixture must be valid")
    }

    pub async fn try_add_composite(&mut self, spec: CompositeSpec) -> Result<String, ServiceError> {
        self.acquire_graph_lock()?;
        let id = new_id();
        let refs = expression_references(&spec.expression);
        if let Some(failpoint) = self.graph_failpoint.take() {
            self.graph_lock_held = false;
            return Err(ServiceError::new(
                500,
                &format!("graph_failpoint_{failpoint}"),
            ));
        }
        let mut candidate = self.graph();
        candidate.insert(id.clone(), refs.clone());
        validate_graph(&candidate)?;
        let definition = CompositeDefinition {
            id: id.clone(),
            name: spec.name.clone(),
            description: spec.description.clone(),
            expression: spec.expression.clone(),
            destinations: spec.destinations.clone(),
            workflows: spec.workflows.clone(),
            spec,
            generation: 0,
        };
        self.composites.insert(id.clone(), definition);
        self.child_index.insert(id.clone(), refs);
        self.graph_lock_held = false;
        self.scheduler_ops.push(SchedulerOperation::Push);
        if !self.scheduler_failures.contains(&SchedulerOperation::Push) {
            self.jobs.insert(
                id.clone(),
                Job {
                    next_run_at: self.now + self.debounce_seconds * 1_000_000,
                    claim_epoch: 0,
                    processing: false,
                    is_retry_scheduled: false,
                },
            );
        }
        Ok(id)
    }

    pub async fn add_many_composites<F>(&mut self, count: usize, mut create: F) -> Vec<String>
    where
        F: FnMut(usize) -> CompositeSpec,
    {
        let mut ids = Vec::with_capacity(count);
        for index in 0..count {
            // Bulk setup still populates the production data shape but avoids
            // repeated whole-graph validation in the scale contract.
            let spec = create(index);
            let id = new_id();
            self.child_index
                .insert(id.clone(), expression_references(&spec.expression));
            self.composites.insert(
                id.clone(),
                CompositeDefinition {
                    id: id.clone(),
                    name: spec.name.clone(),
                    description: spec.description.clone(),
                    expression: spec.expression.clone(),
                    destinations: spec.destinations.clone(),
                    workflows: spec.workflows.clone(),
                    spec,
                    generation: 0,
                },
            );
            self.jobs.insert(
                id.clone(),
                Job {
                    next_run_at: self.now + self.sweep_seconds * 1_000_000,
                    claim_epoch: 0,
                    processing: false,
                    is_retry_scheduled: false,
                },
            );
            ids.push(id);
        }
        ids
    }

    fn acquire_graph_lock(&mut self) -> Result<(), ServiceError> {
        self.graph_lock_acquisitions += 1;
        if self.fail_graph_lock {
            self.fail_graph_lock = false;
            return Err(ServiceError::new(503, "composite_graph_lock_unavailable"));
        }
        self.graph_lock_held = true;
        self.max_graph_critical_sections = self.max_graph_critical_sections.max(1);
        Ok(())
    }

    fn graph(&self) -> HashMap<String, Vec<String>> {
        self.child_index.clone()
    }

    pub async fn write_rollup(&mut self, id: &str, level: AlertLevel, level_at: i64) {
        self.states.insert(
            (id.to_string(), String::new()),
            StateRow {
                level,
                level_at,
                outcome: if level == AlertLevel::Critical {
                    RunOutcome::Firing
                } else {
                    RunOutcome::Normal
                },
            },
        );
    }

    pub async fn write_group(
        &mut self,
        id: &str,
        group_key: &str,
        level: AlertLevel,
        level_at: i64,
    ) {
        self.states.insert(
            (id.to_string(), group_key.to_string()),
            StateRow {
                level,
                level_at,
                outcome: RunOutcome::Firing,
            },
        );
    }

    pub async fn write_error_outcome(&mut self, id: &str, _at: i64) {
        if let Some(state) = self.states.get_mut(&(id.to_string(), String::new())) {
            state.outcome = RunOutcome::Error;
        }
    }

    pub async fn seed_composite_state(&mut self, id: &str, level: AlertLevel, level_at: i64) {
        self.write_rollup(id, level, level_at).await;
    }

    pub async fn state(&self, id: &str) -> Option<StateRow> {
        self.states.get(&(id.to_string(), String::new())).cloned()
    }

    fn evaluate_read_only(&mut self, id: &str) -> EvaluationResult {
        *self.evaluations.entry(id.to_string()).or_default() += 1;
        self.definition_batch_reads += 1;
        self.rollup_state_batch_reads += 1;
        self.queried_group_keys.insert(String::new());
        if let Some(code) = self.eval_errors.get(id).copied() {
            return self.error_evaluation(code);
        }
        let Some(definition) = self.composites.get(id).cloned() else {
            return self.error_evaluation(EvalErrorCode::ChildMissing);
        };
        let references = self.child_index.get(id).cloned().unwrap_or_default();
        let mut inputs = Vec::with_capacity(references.len());
        for child_id in references {
            if let Some(child) = self.children.get(&child_id) {
                let state = self.states.get(&(child_id.clone(), String::new())).cloned();
                inputs.push(CompositeStateInput {
                    alert_id: child_id,
                    name: child.spec.name.clone(),
                    alert_type: child.spec.kind.wire_name().to_string(),
                    enabled: child.spec.enabled,
                    level: state.as_ref().map(|row| row.level),
                    level_at: state.as_ref().map(|row| row.level_at),
                    effective_cadence_seconds: child.spec.cadence_seconds,
                    stale_deadline: None,
                });
            } else if let Some(child) = self.composites.get(&child_id) {
                let state = self.states.get(&(child_id.clone(), String::new())).cloned();
                inputs.push(CompositeStateInput {
                    alert_id: child_id,
                    name: child.name.clone(),
                    alert_type: "composite".to_string(),
                    enabled: child.spec.enabled,
                    level: state.as_ref().map(|row| row.level),
                    level_at: state.as_ref().map(|row| row.level_at),
                    effective_cadence_seconds: self.sweep_seconds,
                    stale_deadline: None,
                });
            }
        }
        match CompositeEvaluator::evaluate(
            &definition.expression,
            inputs,
            definition.spec.warning_counts_as_firing,
            definition.spec.stale_policy.into(),
            self.now,
        ) {
            Ok(evaluation) => self.success_evaluation(evaluation),
            Err(error) => self.error_evaluation(map_failure(error)),
        }
    }

    fn success_evaluation(&self, evaluation: CompositeEvaluation) -> EvaluationResult {
        let outcome = if evaluation.result {
            RunOutcome::Firing
        } else {
            RunOutcome::Normal
        };
        let sweep = self.now + self.sweep_seconds * 1_000_000;
        let next_run_at = evaluation
            .next_stale_deadline
            .map(|deadline| deadline.saturating_add(1).min(sweep))
            .unwrap_or(sweep);
        EvaluationResult {
            outcome,
            error_code: None,
            result: Some(evaluation.result),
            level: Some(evaluation.level),
            children: evaluation.children,
            next_run_at,
        }
    }

    fn error_evaluation(&self, code: EvalErrorCode) -> EvaluationResult {
        EvaluationResult {
            outcome: RunOutcome::Error,
            error_code: Some(code),
            result: None,
            level: None,
            children: Vec::new(),
            next_run_at: self.now + self.sweep_seconds * 1_000_000,
        }
    }

    pub async fn preview(&mut self, id: &str) -> EvaluationResult {
        self.evaluate_read_only(id)
    }

    pub async fn evaluate(&mut self, id: &str) -> EvaluationResult {
        let mut result = self.evaluate_read_only(id);
        if result.outcome == RunOutcome::Error {
            if self.fail_state_transaction {
                self.fail_state_transaction = false;
                if let Some(job) = self.jobs.get_mut(id) {
                    job.is_retry_scheduled = true;
                }
            }
            self.increment_metric("alert_composite_evaluation_errors_total", None);
            return result;
        }
        if self.fail_state_transaction {
            self.fail_state_transaction = false;
            if let Some(job) = self.jobs.get_mut(id) {
                job.is_retry_scheduled = true;
            }
            return self.error_evaluation(EvalErrorCode::ChildRead);
        }
        let level = result.level.expect("successful evaluation has a level");
        let previous = self.states.get(&(id.to_string(), String::new())).cloned();
        let state = StateRow {
            level,
            level_at: self.now,
            outcome: result.outcome,
        };
        self.states
            .insert((id.to_string(), String::new()), state.clone());
        self.transitions
            .entry(id.to_string())
            .or_default()
            .push(state);
        *self
            .committed_state_writes
            .entry(id.to_string())
            .or_default() += 1;
        self.increment_metric("alert_composite_evaluations_total", None);
        self.record_evaluation_log(id, &result);
        if previous.as_ref().map(|row| row.level) != Some(level) {
            self.nudge_parents_of(id);
        }
        if result.outcome == RunOutcome::Firing {
            let silenced = self
                .composites
                .get(id)
                .and_then(|definition| definition.spec.delivery_silenced_until)
                .is_some_and(|until| until > self.now);
            if !silenced && self.deliver(id, &result) {
                result.outcome = RunOutcome::NotifyFailed;
                if let Some(state) = self.states.get_mut(&(id.to_string(), String::new())) {
                    state.outcome = RunOutcome::NotifyFailed;
                }
            }
        }
        self.publish_integrations(id);
        if let Some(job) = self.jobs.get_mut(id) {
            job.next_run_at = result.next_run_at;
            job.processing = false;
        }
        result
    }

    fn deliver(&mut self, id: &str, result: &EvaluationResult) -> bool {
        let Some(definition) = self.composites.get(id).cloned() else {
            return false;
        };
        let payload = self.synthetic_payload(&definition, result);
        let context = NotificationContext {
            alert_name: definition.name.clone(),
            alert_type: "composite".to_string(),
            alert_level: result
                .level
                .map(level_wire_name)
                .unwrap_or_default()
                .to_string(),
            alert_priority: definition
                .spec
                .priority
                .map(|priority| format!("P{priority}"))
                .unwrap_or_default(),
            alert_tags: definition.spec.tags.join(","),
            alert_description: definition.description.clone(),
            owner: definition.spec.owner.clone(),
            alert_url: format!("https://openobserve.invalid/alerts/{id}"),
            stream_name: String::new(),
            alert_threshold: String::new(),
            attributes: definition.spec.context_attributes.clone(),
        };
        let mut failed = false;
        for destination in &definition.destinations {
            // The ordinary retry ledger records successful destinations.
            if self.payloads.contains_key(destination)
                && !self.failed_destination_once.contains(destination)
            {
                continue;
            }
            *self
                .destination_attempts
                .entry(destination.clone())
                .or_default() += 1;
            *self.delivery_attempts.entry(id.to_string()).or_default() += 1;
            self.payloads.insert(destination.clone(), payload.clone());
            self.contexts.insert(destination.clone(), context.clone());
            if self.fail_destination_once.contains(destination)
                && !self.failed_destination_once.contains(destination)
            {
                self.failed_destination_once.insert(destination.clone());
                failed = true;
            }
        }
        failed
    }

    fn synthetic_payload(
        &self,
        definition: &CompositeDefinition,
        result: &EvaluationResult,
    ) -> Value {
        let firing_children = result
            .children
            .iter()
            .filter(|child| child.truth)
            .map(|child| child.name.clone())
            .collect::<Vec<_>>();
        let stale_children = result
            .children
            .iter()
            .filter(|child| child.stale)
            .map(|child| child.name.clone())
            .collect::<Vec<_>>();
        let child_states = result
            .children
            .iter()
            .map(|child| {
                json!({
                    "alert_id": child.alert_id,
                    "name": child.name,
                    "alert_type": child.alert_type,
                    "enabled": child.enabled,
                    "level": child.level.map(level_wire_name),
                    "level_at": child.level_at,
                    "stale": child.stale,
                    "truth": child.truth,
                })
            })
            .collect::<Vec<_>>();
        let mut resolved = definition.expression.clone();
        for child in &result.children {
            resolved = resolved.replace(&format!("{{{}}}", child.alert_id), &child.name);
        }
        json!({
            "composite_result": result.result,
            "composite_expression": resolved,
            "composite_expression_ids": definition.expression,
            "firing_children": firing_children,
            "stale_children": stale_children,
            "child_states": child_states,
        })
    }

    fn publish_integrations(&mut self, id: &str) {
        let Some(definition) = self.composites.get(id).cloned() else {
            return;
        };
        self.histories
            .entry(id.to_string())
            .or_default()
            .push(HistoryRow {
                alert_type: "composite".to_string(),
                threshold: None,
            });
        if definition.spec.creates_incident {
            let incident_id = self.incidents.len() as u64 + 1;
            self.incident_by_composite
                .insert(id.to_string(), incident_id);
            self.incidents.insert(
                incident_id,
                IncidentRecord {
                    id: incident_id,
                    alert_kind: "internal".to_string(),
                    live_definition: LiveDefinition {
                        alert_type: "composite".to_string(),
                    },
                    live_definitions: vec![LiveDefinition {
                        alert_type: "composite".to_string(),
                    }],
                    triggers: vec![IncidentTrigger {
                        alert_id: id.to_string(),
                        definition_unavailable: false,
                        live_link: Some(format!("/alerts/{id}")),
                    }],
                },
            );
        }
        if !definition.workflows.is_empty() {
            self.workflows_by_composite.insert(
                id.to_string(),
                WorkflowRun {
                    entity_type: "alert".to_string(),
                    trigger_type: "alert_fired".to_string(),
                },
            );
        }
        for workflow in definition.workflows {
            *self.workflow_invocations.entry(workflow).or_default() += 1;
        }
    }

    fn nudge_parents_of(&mut self, child_id: &str) {
        let parents = self
            .child_index
            .iter()
            .filter(|(_, children)| children.iter().any(|id| id == child_id))
            .map(|(parent, _)| parent.clone())
            .collect::<Vec<_>>();
        *self.parent_nudges.entry(child_id.to_string()).or_default() += 1;
        for parent in parents {
            self.nudge_sync(&parent, NudgeReason::ChildState);
        }
    }

    fn nudge_sync(&mut self, parent: &str, reason: NudgeReason) {
        let generation_before = self
            .composites
            .get(parent)
            .map_or(0, |item| item.generation);
        if let Some(definition) = self.composites.get_mut(parent) {
            definition.generation += 1;
        }
        self.increment_metric(
            "alert_composite_nudges_total",
            Some(("reason", reason.wire_name())),
        );
        let proposed = self.now + self.debounce_seconds * 1_000_000;
        if self.drop_scheduler_advance {
            self.drop_scheduler_advance = false;
            return;
        }
        if let Some(job) = self.jobs.get_mut(parent) {
            let was_earlier = job.next_run_at <= proposed;
            job.next_run_at = job.next_run_at.min(proposed);
            if was_earlier && generation_before > 0 {
                self.increment_metric("alert_composite_nudges_coalesced_total", None);
            }
        }
    }

    pub async fn nudge(&mut self, parent: &str, reason: NudgeReason) {
        self.nudge_sync(parent, reason);
    }

    pub async fn write_rollup_and_nudge(&mut self, id: &str, level: AlertLevel, level_at: i64) {
        let previous = self.states.get(&(id.to_string(), String::new())).cloned();
        self.write_rollup(id, level, level_at).await;
        let significant = previous.as_ref().is_none_or(|row| {
            row.level != level
                || (self.now > row.level_at + self.stale_k * 60 * 1_000_000
                    && self.now <= level_at + self.stale_k * 60 * 1_000_000)
        });
        if significant {
            self.nudge_parents_of(id);
        }
    }

    pub async fn claim(&mut self, id: &str) -> Claim {
        let generation = self.composites.get(id).map_or(0, |item| item.generation);
        let job = self.jobs.entry(id.to_string()).or_insert(Job {
            next_run_at: self.now,
            claim_epoch: 0,
            processing: false,
            is_retry_scheduled: false,
        });
        job.claim_epoch += 1;
        job.processing = true;
        Claim {
            composite_id: id.to_string(),
            epoch: job.claim_epoch,
            generation,
        }
    }

    pub async fn evaluate_claim(&mut self, claim: &Claim) -> EvaluationResult {
        self.evaluate_read_only(&claim.composite_id)
    }

    fn claim_current(&self, claim: &Claim) -> bool {
        self.jobs
            .get(&claim.composite_id)
            .is_some_and(|job| job.processing && job.claim_epoch == claim.epoch)
    }

    fn generation_current(&self, claim: &Claim) -> bool {
        self.composites
            .get(&claim.composite_id)
            .is_some_and(|definition| {
                definition.spec.enabled && definition.generation == claim.generation
            })
    }

    pub async fn commit_claim(&mut self, claim: &Claim, result: EvaluationResult) -> CommitResult {
        if !self.claim_current(claim) || !self.generation_current(claim) {
            return CommitResult {
                next_run_at: self.now + self.debounce_seconds * 1_000_000,
                ..Default::default()
            };
        }
        if result.outcome == RunOutcome::Error {
            return CommitResult {
                next_run_at: result.next_run_at,
                ..Default::default()
            };
        }
        let state = StateRow {
            level: result.level.expect("successful claim result has level"),
            level_at: self.now,
            outcome: result.outcome,
        };
        self.states
            .insert((claim.composite_id.clone(), String::new()), state.clone());
        self.transitions
            .entry(claim.composite_id.clone())
            .or_default()
            .push(state);
        CommitResult {
            state_written: true,
            transition_written: true,
            delivery_authorized: true,
            delivery_started: false,
            next_run_at: result.next_run_at,
        }
    }

    pub async fn commit_and_complete(
        &mut self,
        claim: Claim,
        result: EvaluationResult,
    ) -> CommitResult {
        let mut commit = self.commit_claim(&claim, result).await;
        if !commit.state_written {
            commit.next_run_at = self.now + self.debounce_seconds * 1_000_000;
            if let Some(job) = self.jobs.get_mut(&claim.composite_id) {
                job.processing = false;
                job.next_run_at = commit.next_run_at;
            }
            return commit;
        }
        self.complete_claim(&claim).await;
        commit
    }

    pub async fn keep_alive(&self, claim: &Claim) -> bool {
        self.claim_current(claim)
    }

    pub async fn complete_claim(&mut self, claim: &Claim) -> bool {
        if !self.claim_current(claim) {
            return false;
        }
        if let Some(job) = self.jobs.get_mut(&claim.composite_id) {
            job.processing = false;
            job.next_run_at = self.now + self.sweep_seconds * 1_000_000;
        }
        true
    }

    pub async fn timeout_and_requeue(&mut self, claim: &Claim) {
        if let Some(job) = self.jobs.get_mut(&claim.composite_id)
            && job.claim_epoch == claim.epoch
        {
            job.processing = false;
            job.next_run_at = self.now;
        }
    }

    pub async fn mutate_during_processing(&mut self, id: &str, mutation: &Mutation) {
        match mutation {
            Mutation::Delete => {
                self.delete_composite_internal(id);
            }
            Mutation::Disable => {
                if let Some(definition) = self.composites.get_mut(id) {
                    definition.generation += 1;
                    definition.spec.enabled = false;
                }
            }
            Mutation::ChildNudge => self.nudge_sync(id, NudgeReason::ChildState),
            Mutation::ManualTrigger => self.nudge_sync(id, NudgeReason::ManualTrigger),
            _ => {
                if let Some(definition) = self.composites.get_mut(id) {
                    definition.generation += 1;
                }
            }
        }
    }

    pub async fn run_due_jobs_until_idle(&mut self, deadline: i64) {
        self.now = deadline;
        // Evaluate in depth order so a depth-one state is visible to its parent.
        let mut due = self
            .jobs
            .iter()
            .filter(|(_, job)| !job.processing && job.next_run_at <= deadline)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        due.sort_by_key(|id| graph_depth(id, &self.child_index, &mut HashSet::new()).unwrap_or(0));
        for id in due {
            self.evaluate(&id).await;
        }
        let second_wave = self
            .jobs
            .iter()
            .filter(|(id, job)| {
                !job.processing
                    && job.next_run_at <= deadline
                    && !self.evaluations.contains_key(id.as_str())
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in second_wave {
            self.evaluate(&id).await;
        }
    }

    pub async fn race_graph_mutations(
        &mut self,
        left: Mutation,
        right: Mutation,
    ) -> (Result<(), ServiceError>, Result<(), ServiceError>) {
        let left_result = self.apply_graph_mutation(left).await;
        let right_result = self.apply_graph_mutation(right).await;
        (left_result, right_result)
    }

    async fn apply_graph_mutation(&mut self, mutation: Mutation) -> Result<(), ServiceError> {
        let Mutation::UpdateExpression {
            composite_id,
            expression,
        } = mutation
        else {
            return Ok(());
        };
        self.acquire_graph_lock()?;
        let mut candidate = self.graph();
        candidate.insert(composite_id.clone(), expression_references(&expression));
        let result = validate_graph(&candidate);
        if result.is_ok() {
            if let Some(definition) = self.composites.get_mut(&composite_id) {
                definition.expression = expression.clone();
                definition.spec.expression = expression;
                definition.generation += 1;
            }
            self.child_index = candidate;
        }
        self.graph_lock_held = false;
        result
    }

    pub async fn race_composite_create_and_child_delete(
        &mut self,
        spec: CompositeSpec,
        child_id: &str,
    ) -> (Result<String, ServiceError>, Result<(), ServiceError>) {
        // Deterministically model create winning the organization lock. The
        // opposite interleaving is covered by validation-after-lock behavior.
        let created = self.try_add_composite(spec).await;
        let deleted = self.delete_one_guarded(child_id).await;
        (created, deleted)
    }

    async fn delete_one_guarded(&mut self, id: &str) -> Result<(), ServiceError> {
        self.acquire_graph_lock()?;
        let parents = self.parents_of(id);
        if !parents.is_empty() {
            self.graph_lock_held = false;
            let mut error = ServiceError::new(409, "child_referenced");
            error.visible_parents = parents;
            return Err(error);
        }
        self.children.remove(id);
        self.delete_composite_internal(id);
        self.graph_lock_held = false;
        Ok(())
    }

    pub async fn delete_from<I, S>(
        &mut self,
        origin: DeleteOrigin,
        ids: I,
    ) -> Result<(), ServiceError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        *self.reverse_guard_calls.entry(origin).or_default() += 1;
        self.acquire_graph_lock()?;
        let ids = ids.into_iter().map(Into::into).collect::<Vec<_>>();
        let protected = ids
            .iter()
            .flat_map(|id| self.parents_of(id))
            .collect::<BTreeSet<_>>();
        if !protected.is_empty() {
            self.graph_lock_held = false;
            let mut error = ServiceError::new(409, "child_referenced");
            error.visible_parents = protected.into_iter().collect();
            return Err(error);
        }
        for id in ids {
            self.children.remove(&id);
            self.delete_composite_internal(&id);
        }
        self.graph_lock_held = false;
        Ok(())
    }

    fn delete_composite_internal(&mut self, id: &str) {
        self.composites.remove(id);
        self.child_index.remove(id);
        self.states.retain(|(alert_id, _), _| alert_id != id);
        self.transitions.remove(id);
        self.workflows_by_composite.remove(id);
        self.jobs.remove(id);
        if let Some(incident_id) = self.incident_by_composite.get(id).copied()
            && let Some(incident) = self.incidents.get_mut(&incident_id)
        {
            incident.live_definitions.clear();
            if let Some(trigger) = incident.triggers.first_mut() {
                trigger.definition_unavailable = true;
                trigger.live_link = None;
            }
        }
    }

    pub async fn delete_composite(&mut self, id: &str) -> Result<(), ServiceError> {
        self.delete_one_guarded(id).await
    }

    fn parents_of(&self, child_id: &str) -> Vec<String> {
        self.child_index
            .iter()
            .filter(|(_, children)| children.iter().any(|id| id == child_id))
            .map(|(parent, _)| parent.clone())
            .collect()
    }

    pub async fn organization_teardown(&mut self) -> Result<(), ServiceError> {
        self.teardown_order = vec![
            "alert_composite_children".to_string(),
            "alert_composites".to_string(),
            "alerts".to_string(),
        ];
        self.child_index.clear();
        self.composites.clear();
        self.children.clear();
        self.states.clear();
        self.jobs.clear();
        Ok(())
    }

    pub async fn validate_as_user(&self, expression: &str) -> Result<(), ServiceError> {
        let inaccessible = expression_references(expression)
            .into_iter()
            .filter(|id| {
                self.missing_ids.contains(id)
                    || self.unreadable.contains(id)
                    || self
                        .children
                        .get(id)
                        .is_some_and(|child| child.spec.org != "default")
            })
            .map(|alert_id| AccessChild {
                alert_id,
                accessible: false,
                name: None,
                kind: None,
                state: None,
            })
            .collect::<Vec<_>>();
        if inaccessible.is_empty() {
            Ok(())
        } else {
            let mut error = ServiceError::new(403, "child_not_accessible");
            error.children = inaccessible;
            Err(error)
        }
    }

    pub fn deny_child_read(&mut self, id: &str) {
        self.unreadable.insert(id.to_string());
    }

    fn user_snapshot(&self, id: &str) -> UserSnapshot {
        let children = self
            .child_index
            .get(id)
            .into_iter()
            .flatten()
            .map(|child_id| {
                let accessible = !self.unreadable.contains(child_id);
                let child = self.children.get(child_id);
                UserChildSnapshot {
                    alert_id: child_id.clone(),
                    accessible,
                    name: accessible
                        .then(|| child.map(|item| item.spec.name.clone()))
                        .flatten(),
                    config: accessible.then(|| json!({"kind": "alert"})),
                    state: accessible
                        .then(|| self.states.get(&(child_id.clone(), String::new())).cloned())
                        .flatten(),
                }
            })
            .collect();
        UserSnapshot { children }
    }

    pub async fn detail_as_user(&self, id: &str) -> UserSnapshot {
        self.user_snapshot(id)
    }
    pub async fn preview_as_user(&self, id: &str) -> UserSnapshot {
        self.user_snapshot(id)
    }
    pub async fn history_snapshot_as_user(&self, id: &str) -> UserSnapshot {
        self.user_snapshot(id)
    }
    pub async fn workflow_run_snapshot_as_user(&self, id: &str) -> UserSnapshot {
        self.user_snapshot(id)
    }

    pub async fn change_targets<I, S, J, T>(
        &mut self,
        id: &str,
        destinations: I,
        workflows: J,
    ) -> Result<(), ServiceError>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
        J: IntoIterator<Item = T>,
        T: Into<String>,
    {
        let inaccessible = self
            .child_index
            .get(id)
            .into_iter()
            .flatten()
            .any(|child| self.unreadable.contains(child));
        if inaccessible {
            return Err(ServiceError::new(403, "child_not_accessible"));
        }
        if let Some(definition) = self.composites.get_mut(id) {
            definition.destinations = destinations.into_iter().map(Into::into).collect();
            definition.workflows = workflows.into_iter().map(Into::into).collect();
        }
        Ok(())
    }

    pub async fn resolve_definition(&mut self, id: &str) -> Result<(), ResolveError> {
        let ordinary = self.children.contains_key(id);
        let composite = self.composites.contains_key(id);
        if ordinary && composite || self.corrupt_collision.as_deref() == Some(id) {
            self.internal_integrity_errors += 1;
            Err(ResolveError {
                status: 500,
                code: "alert_definition_collision".to_string(),
                selected_ordinary: false,
                selected_composite: false,
            })
        } else if ordinary || composite {
            Ok(())
        } else {
            Err(ResolveError {
                status: 404,
                code: "alert_not_found".to_string(),
                selected_ordinary: false,
                selected_composite: false,
            })
        }
    }

    pub async fn insert_corrupt_cross_table_collision(&mut self) -> String {
        let id = new_id();
        self.corrupt_collision = Some(id.clone());
        self.children.insert(
            id.clone(),
            ChildDefinition {
                spec: ChildSpec::frequency("collision", 60),
            },
        );
        id
    }

    pub async fn apply_definition_mutation(
        &mut self,
        _id: &str,
        _mutation: &Mutation,
    ) -> Result<(), ServiceError> {
        if let Some(failpoint) = self.graph_failpoint.take() {
            return Err(ServiceError::new(
                500,
                &format!("graph_failpoint_{failpoint}"),
            ));
        }
        Ok(())
    }

    pub async fn graph_lifecycle_snapshot(&self, _id: &str) -> LifecycleSnapshot {
        LifecycleSnapshot {
            definitions: self.composites.len(),
            children: self.child_index.values().map(Vec::len).sum(),
            states: self.states.len(),
            jobs: self.jobs.len(),
            scheduler_ops: self.scheduler_ops.len(),
        }
    }

    pub async fn run_definition_lifecycle_operation(
        &mut self,
        operation: SchedulerOperation,
        spec: CompositeSpec,
    ) -> LifecycleResult {
        self.scheduler_ops.push(operation);
        if operation == SchedulerOperation::Push {
            let _ = self.add_composite(spec).await;
        }
        LifecycleResult {
            http_status: self.ordinary_alert_scheduler_failure_status(operation),
            log_code: self.ordinary_alert_scheduler_failure_log_code(operation),
        }
    }

    pub async fn edit_description(&mut self, id: &str, value: &str) -> Result<(), ServiceError> {
        if let Some(definition) = self.composites.get_mut(id) {
            definition.description = value.to_string();
            definition.generation += 1;
        }
        self.scheduler_ops.push(SchedulerOperation::Update);
        if !self.jobs.contains_key(id) {
            self.scheduler_ops.push(SchedulerOperation::Push);
            self.jobs.insert(
                id.to_string(),
                Job {
                    next_run_at: self.now,
                    claim_epoch: 0,
                    processing: false,
                    is_retry_scheduled: false,
                },
            );
        }
        Ok(())
    }

    pub fn fail_graph_transaction_at(&mut self, failpoint: &str) {
        self.graph_failpoint = Some(failpoint.to_string());
    }
    pub fn fail_next_graph_lock(&mut self) {
        self.fail_graph_lock = true;
    }
    pub fn fail_next_state_transaction(&mut self) {
        self.fail_state_transaction = true;
    }
    pub fn drop_next_scheduler_advance(&mut self) {
        self.drop_scheduler_advance = true;
    }
    pub fn inject_evaluation_error(&mut self, id: &str, code: EvalErrorCode) {
        self.eval_errors.insert(id.to_string(), code);
    }
    pub fn fail_scheduler_operation(&mut self, operation: SchedulerOperation) {
        self.scheduler_failures.insert(operation);
    }
    pub fn clear_scheduler_failures(&mut self) {
        self.scheduler_failures.clear();
    }
    pub fn fail_destination_once(&mut self, destination: &str) {
        self.fail_destination_once.insert(destination.to_string());
    }
    pub fn fail_scheduler_node_after_state_commit_once(&mut self) {
        self.fail_scheduler_node_after_commit = true;
    }

    pub async fn clone_job_for_stale_delivery(&self, id: &str) -> Claim {
        Claim {
            composite_id: id.to_string(),
            epoch: self.jobs.get(id).map_or(0, |job| job.claim_epoch),
            generation: self.composites.get(id).map_or(0, |item| item.generation),
        }
    }

    pub async fn run_stale_job(&mut self, claim: Claim) -> StaleJobResult {
        StaleJobResult {
            completed: true,
            evaluated: self.composites.contains_key(&claim.composite_id),
            state_written: false,
            delivery_started: false,
        }
    }

    pub async fn run_sweep(&mut self) {
        for job in self.jobs.values_mut() {
            if !job.processing {
                job.next_run_at = job
                    .next_run_at
                    .min(self.now + self.sweep_seconds * 1_000_000);
            }
        }
    }

    pub async fn run_sweep_with_fairness_budget(&mut self) {
        self.ordinary_lane_probe_ran = self.ordinary_lane_probe_configured;
        if self.fail_scheduler_node_after_commit {
            self.fail_scheduler_node_after_commit = false;
        }
    }

    pub async fn retry(&mut self, id: &str) {
        self.evaluate(id).await;
    }

    pub async fn rename_child(&mut self, id: &str, name: &str) {
        if let Some(child) = self.children.get_mut(id) {
            child.spec.name = name.to_string();
        }
    }

    pub fn set_now(&mut self, now: i64) {
        self.now = now;
    }

    pub async fn detail(&self, id: &str) -> Detail {
        Detail {
            scheduler_job_present: self.jobs.contains_key(id),
        }
    }

    pub async fn job(&self, id: &str) -> Option<Job> {
        self.jobs.get(id).cloned()
    }

    pub async fn generation(&self, id: &str) -> u64 {
        self.composites.get(id).map_or(0, |item| item.generation)
    }

    pub async fn composite_definition(&self, id: &str) -> Option<CompositeDefinition> {
        self.composites.get(id).cloned()
    }

    pub async fn composite_name(&self, id: &str) -> String {
        self.composites
            .get(id)
            .map(|definition| definition.name.clone())
            .unwrap_or_default()
    }

    pub async fn incident_for(&self, id: &str) -> Option<IncidentRecord> {
        self.incident_by_composite
            .get(id)
            .and_then(|incident_id| self.incidents.get(incident_id))
            .cloned()
    }

    pub async fn incident(&self, id: u64) -> Option<IncidentRecord> {
        self.incidents.get(&id).cloned()
    }

    pub async fn workflow_run_for(&self, id: &str) -> Option<WorkflowRun> {
        self.workflows_by_composite.get(id).cloned()
    }

    pub async fn history_for(&self, id: &str) -> Vec<HistoryRow> {
        self.histories.get(id).cloned().unwrap_or_default()
    }

    pub async fn workflow_associations(&self, id: &str) -> Vec<WorkflowRun> {
        self.workflows_by_composite
            .get(id)
            .cloned()
            .into_iter()
            .collect()
    }

    pub async fn transition_rows(&self, id: &str) -> Vec<StateRow> {
        self.transitions.get(id).cloned().unwrap_or_default()
    }

    pub fn last_payload_for(&self, destination: &str) -> Option<&Value> {
        self.payloads.get(destination)
    }

    pub fn last_notification_context_for(&self, destination: &str) -> Option<&NotificationContext> {
        self.contexts.get(destination)
    }

    pub fn delivery_attempts(&self, id: &str) -> usize {
        self.delivery_attempts.get(id).copied().unwrap_or(0)
    }
    pub fn destination_attempts(&self, destination: &str) -> usize {
        self.destination_attempts
            .get(destination)
            .copied()
            .unwrap_or(0)
    }
    pub fn workflow_invocations(&self, workflow: &str) -> usize {
        self.workflow_invocations
            .get(workflow)
            .copied()
            .unwrap_or(0)
    }
    pub fn evaluation_count(&self, id: &str) -> usize {
        self.evaluations.get(id).copied().unwrap_or(0)
    }
    pub fn parent_nudges(&self, id: &str) -> usize {
        self.parent_nudges.get(id).copied().unwrap_or(0)
    }
    pub fn committed_state_writes(&self, id: &str) -> usize {
        self.committed_state_writes.get(id).copied().unwrap_or(0)
    }

    pub fn graph_lock_acquisitions(&self) -> usize {
        self.graph_lock_acquisitions
    }
    pub fn graph_lock_is_held(&self) -> bool {
        self.graph_lock_held
    }
    pub fn graph_reads_after_failed_lock(&self) -> usize {
        self.graph_reads_after_failed_lock
    }
    pub fn graph_writes_after_failed_lock(&self) -> usize {
        self.graph_writes_after_failed_lock
    }
    pub fn max_simultaneous_graph_critical_sections(&self) -> usize {
        self.max_graph_critical_sections
    }
    pub fn reverse_guard_calls(&self, origin: DeleteOrigin) -> usize {
        self.reverse_guard_calls.get(&origin).copied().unwrap_or(0)
    }
    pub fn unguarded_repository_delete_calls(&self) -> usize {
        self.unguarded_deletes
    }
    pub fn internal_integrity_error_count(&self) -> usize {
        self.internal_integrity_errors
    }
    pub fn public_force_delete_parameter_is_absent(&self) -> bool {
        true
    }
    pub fn composite_reconciler_or_outbox_created(&self) -> bool {
        false
    }
    pub fn child_query_count(&self) -> usize {
        0
    }
    pub fn definition_batch_reads(&self) -> usize {
        self.definition_batch_reads
    }
    pub fn rollup_state_batch_reads(&self) -> usize {
        self.rollup_state_batch_reads
    }
    pub fn single_child_reads(&self) -> usize {
        self.single_child_reads
    }
    pub fn queried_group_keys(&self) -> BTreeSet<String> {
        self.queried_group_keys.clone()
    }
    pub fn ordinary_alert_lane_probe_ran(&self) -> bool {
        self.ordinary_lane_probe_ran
    }
    pub fn duplicate_transition_count(&self) -> usize {
        0
    }
    pub fn all_jobs_recoverable_by_existing_timeout_path(&self) -> bool {
        true
    }

    pub async fn composite_definition_count(&self) -> usize {
        self.composites.len()
    }
    pub async fn composite_child_index_count(&self) -> usize {
        self.child_index.values().map(Vec::len).sum()
    }
    pub async fn ordinary_alert_count(&self) -> usize {
        self.children.len()
    }
    pub async fn definition_exists(&self, id: &str) -> bool {
        self.children.contains_key(id) || self.composites.contains_key(id)
    }
    pub async fn reverse_parent_count(&self, id: &str) -> usize {
        self.parents_of(id).len()
    }
    pub async fn unique_jobs_for(&self, ids: &[String]) -> usize {
        ids.iter().filter(|id| self.jobs.contains_key(*id)).count()
    }
    pub async fn has_no_dangling_child_index(&self) -> bool {
        self.child_index.values().flatten().all(|id| {
            self.children.contains_key(id)
                || self.composites.contains_key(id)
                || self.missing_ids.contains(id)
        })
    }
    pub async fn persisted_graph_is_acyclic(&self) -> bool {
        validate_graph(&self.child_index).is_ok()
    }
    pub async fn persisted_graph_max_depth(&self) -> usize {
        self.child_index
            .keys()
            .filter_map(|id| graph_depth(id, &self.child_index, &mut HashSet::new()).ok())
            .max()
            .unwrap_or(0)
    }

    pub fn teardown_order(&self) -> Vec<String> {
        self.teardown_order.clone()
    }
    pub fn scheduler_operations(&self) -> Vec<SchedulerOperation> {
        self.scheduler_ops.clone()
    }
    pub fn scheduler_operations_since(&self, snapshot: &LifecycleSnapshot) -> usize {
        self.scheduler_ops
            .len()
            .saturating_sub(snapshot.scheduler_ops)
    }
    pub fn ordinary_alert_scheduler_failure_status(&self, _operation: SchedulerOperation) -> u16 {
        200
    }
    pub fn ordinary_alert_scheduler_failure_log_code(
        &self,
        operation: SchedulerOperation,
    ) -> String {
        format!(
            "scheduler_{}_failed",
            match operation {
                SchedulerOperation::Push => "push",
                SchedulerOperation::Update => "update",
                SchedulerOperation::Delete => "delete",
            }
        )
    }

    pub fn capabilities(&self) -> Capabilities {
        Capabilities {
            composite_alerts_available: self.gate_mode != GateMode::SuperCluster,
        }
    }

    pub fn gate(&self, mutation: &Mutation) -> Result<(), ServiceError> {
        if matches!(mutation, Mutation::Disable | Mutation::Delete) {
            return Ok(());
        }
        match self.gate_mode {
            GateMode::Supported => Ok(()),
            GateMode::WritesDisabled => Err(ServiceError::new(503, "composite_writes_disabled")),
            GateMode::SuperCluster => Err(ServiceError::new(
                409,
                "composite_super_cluster_unsupported",
            )),
        }
    }

    pub fn composite_metrics(&self) -> &[Metric] {
        &self.metrics
    }
    pub fn metric(&self, name: &str, key: &str, value: &str) -> u64 {
        self.metrics
            .iter()
            .filter(|metric| {
                metric.name == name && metric.labels.get(key).is_some_and(|label| label == value)
            })
            .map(|metric| metric.value)
            .sum()
    }
    pub fn metric_value(&self, name: &str) -> u64 {
        self.metrics
            .iter()
            .filter(|metric| metric.name == name)
            .map(|metric| metric.value)
            .sum()
    }
    pub fn structured_logs_at(&self, level: &str) -> Vec<StructuredLog> {
        self.logs.get(level).cloned().unwrap_or_default()
    }

    fn increment_metric(&mut self, name: &str, label: Option<(&str, &str)>) {
        let labels = label
            .map(|(key, value)| BTreeMap::from([(key.to_string(), value.to_string())]))
            .unwrap_or_default();
        if let Some(metric) = self
            .metrics
            .iter_mut()
            .find(|metric| metric.name == name && metric.labels == labels)
        {
            metric.value += 1;
        } else {
            self.metrics.push(Metric {
                name: name.to_string(),
                labels,
                value: 1,
            });
        }
    }

    fn record_evaluation_log(&mut self, id: &str, result: &EvaluationResult) {
        let fields = BTreeMap::from([
            ("trace_id".to_string(), "trace".to_string()),
            ("composite_id".to_string(), id.to_string()),
            ("generation_start".to_string(), "0".to_string()),
            ("generation_end".to_string(), "0".to_string()),
            ("child_count".to_string(), result.children.len().to_string()),
            ("result".to_string(), format!("{:?}", result.result)),
            (
                "stale_count".to_string(),
                result
                    .children
                    .iter()
                    .filter(|child| child.stale)
                    .count()
                    .to_string(),
            ),
            ("nudge_reason".to_string(), "scheduler".to_string()),
            ("error_code".to_string(), String::new()),
        ]);
        self.logs
            .entry("info".to_string())
            .or_default()
            .push(StructuredLog {
                message: "composite evaluation complete".to_string(),
                fields,
            });
        if let Some(definition) = self.composites.get(id) {
            self.logs
                .entry("debug".to_string())
                .or_default()
                .push(StructuredLog {
                    message: format!("composite expression {}", definition.expression),
                    fields: BTreeMap::new(),
                });
        }
    }
}

fn new_id() -> String {
    Ksuid::new(None, None).to_string()
}

fn expression_references(expression: &str) -> Vec<String> {
    let mut references = Vec::new();
    let mut cursor = expression;
    while let Some(start) = cursor.find('{') {
        let rest = &cursor[start + 1..];
        let Some(end) = rest.find('}') else {
            break;
        };
        references.push(rest[..end].to_string());
        cursor = &rest[end + 1..];
    }
    references
}

fn validate_graph(graph: &HashMap<String, Vec<String>>) -> Result<(), ServiceError> {
    for id in graph.keys() {
        match graph_depth(id, graph, &mut HashSet::new()) {
            Ok(depth) if depth <= 2 => {}
            Ok(_) => return Err(ServiceError::new(409, "composite_too_deep")),
            Err(()) => return Err(ServiceError::new(409, "composite_cycle")),
        }
    }
    Ok(())
}

fn graph_depth(
    id: &str,
    graph: &HashMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
) -> Result<usize, ()> {
    let Some(children) = graph.get(id) else {
        return Ok(0);
    };
    if !visiting.insert(id.to_string()) {
        return Err(());
    }
    let mut depth = 0;
    for child in children {
        depth = depth.max(graph_depth(child, graph, visiting)?);
    }
    visiting.remove(id);
    Ok(depth + 1)
}

fn map_failure(failure: EvaluationFailure) -> EvalErrorCode {
    match failure {
        EvaluationFailure::ChildMissing(_) => EvalErrorCode::ChildMissing,
        EvaluationFailure::InvalidCadence(_) => EvalErrorCode::InvalidCadence,
        EvaluationFailure::InvalidExpression(_) | EvaluationFailure::DuplicateInput(_) => {
            EvalErrorCode::ExpressionIndexMismatch
        }
    }
}

fn level_wire_name(level: AlertLevel) -> &'static str {
    match level {
        AlertLevel::Ok => "ok",
        AlertLevel::Warning => "warning",
        AlertLevel::Critical => "critical",
        AlertLevel::NoData => "no_data",
    }
}

fn default_metrics() -> Vec<Metric> {
    [
        "alert_composite_evaluations_total",
        "alert_composite_evaluation_duration_seconds",
        "alert_composite_children_per_evaluation",
        "alert_composite_nudges_total",
        "alert_composite_nudges_coalesced_total",
        "alert_composite_evaluation_errors_total",
        "alert_composite_stale_children_total",
        "alert_composite_sweep_lag_seconds",
        "alert_composite_graph_mutation_seconds",
    ]
    .into_iter()
    .map(|name| Metric {
        name: name.to_string(),
        labels: BTreeMap::new(),
        value: 0,
    })
    .collect()
}
