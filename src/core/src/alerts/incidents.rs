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

//! Alert Incident Correlation Service
//!
//! Correlates fired alerts into unified incidents to reduce alert fatigue.

use std::{
    collections::HashMap,
    hash::{DefaultHasher, Hash, Hasher},
    sync::LazyLock,
};

use config::{
    meta::{
        alerts::{
            alert::Alert,
            incidents::{
                AlertEdge, AlertKind, AlertNode, CompositeAlertSummary, CorrelationReason,
                EdgeType, Incident, IncidentAlert, IncidentCorrelationOutcome, IncidentEvent,
                IncidentTopology, IncidentWithAlerts,
            },
        },
        correlation::{FieldAlias, ServiceIdentityConfig},
    },
    utils::json::{Map, Value},
};

/// What `extract_service_name` returns when it finds no service.
///
/// Named because it is a sentinel and not a name. Routing must refuse it: an
/// alert nobody can identify belongs in the unrouted queue, not on the pager of
/// whichever team happens to own this string.
const UNKNOWN_SERVICE: &str = "unknown";
/// The `incident_event` of the first notification after a manual reopen.
const FIRED_AFTER_REOPEN_EVENT: &str = "alert_fired_after_reopen";
/// Window behind the alert in which a service-graph edge counts as a dependency.
const INCIDENT_EDGE_RANGE_SECS: i64 = 3600;
/// How many of an alert's latest firings a Firing run after a window looks through for open pages.
const MUTED_RESOLVES_SCANNED: u64 = 10;
/// Pause between two attempts of one incident notification.
#[cfg(feature = "enterprise")]
const INCIDENT_NOTIFY_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(2);
/// Per-entity case lock, so detections firing in one tick join one case; striped to stay bounded.
static SIEM_CASE_LOCKS: LazyLock<Vec<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| (0..64).map(|_| tokio::sync::Mutex::new(())).collect());
/// The newest finding incidents a cohort's next id is drawn from; racers read the same ones.
#[cfg(feature = "enterprise")]
const COHORT_IDS_SCANNED: u64 = 64;
/// The group values of a finding's incident: which finding, on which stream.
pub const FINDING_KIND_DIMENSION: &str = "autoobserve_finding";
pub const FINDING_STREAM_TYPE_DIMENSION: &str = "stream_type";
pub const FINDING_STREAM_NAME_DIMENSION: &str = "stream_name";
/// Stored in `rca_off_reason` when `O2_INCIDENTS_RCA_ENABLED` (or incidents) is off.
pub const RCA_OFF_DISABLED: &str = "rca_disabled";
/// Stored when AI is off, no agent is set or the licence lacks AI (`rca_agent_available`).
pub const RCA_OFF_AI_UNAVAILABLE: &str = "ai_unavailable";
/// Stored when the org's AI quota refused the run (`trial_quota::precheck_ai_usage`).
pub const RCA_OFF_QUOTA: &str = "quota_exceeded";
/// Stored when the last run is too recent for another (`StartOutcome::CoolingDown`).
pub const RCA_OFF_COOLING_DOWN: &str = "cooling_down";
/// Stored when `start_run`, or the incident read before it, failed.
pub const RCA_OFF_START_FAILED: &str = "start_failed";
/// Turn locks for findings' incident work on a node; one finding always maps to one lock.
#[cfg(feature = "enterprise")]
const FINDING_TURNS: usize = 64;
#[cfg(feature = "enterprise")]
static FINDING_TURN_LOCKS: std::sync::LazyLock<Vec<std::sync::Arc<tokio::sync::Mutex<()>>>> =
    std::sync::LazyLock::new(|| {
        (0..FINDING_TURNS)
            .map(|_| std::sync::Arc::new(tokio::sync::Mutex::new(())))
            .collect()
    });
/// Status turn locks for incidents on a node, as many as the finding turns for the same spread.
const INCIDENT_TURNS: usize = 64;
static INCIDENT_TURN_LOCKS: std::sync::LazyLock<Vec<std::sync::Arc<tokio::sync::Mutex<()>>>> =
    std::sync::LazyLock::new(|| {
        (0..INCIDENT_TURNS)
            .map(|_| std::sync::Arc::new(tokio::sync::Mutex::new(())))
            .collect()
    });

/// Service Discovery correlation result
struct ServiceDiscoveryResult {
    group_values: HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
    service_name: String,
    /// `service_name` is the name of the stream this service was discovered in,
    /// not anything about the service. Fine to show; never route on it.
    service_name_from_stream: bool,
}

/// Result from filtered semantic extraction using distinguish_by groups
struct FilteredSemanticResult {
    group_values: HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
}

/// One rendering of an incident notification and the destinations it goes to.
#[cfg(feature = "enterprise")]
struct IncidentSend<'a> {
    ctx: crate::alerts::notifications::NotificationContext,
    dest_names: Vec<String>,
    alert_template: Option<&'a config::meta::destinations::Template>,
}

/// Identity being correlated into an incident.
///
/// Decouples correlation/incident-creation from the concrete `Alert` type so that
/// non-alert identities (e.g. external alert sources) can be correlated using the
/// same machinery. For the internal alert path this is built from an `Alert`.
#[derive(Debug, Clone)]
pub struct CorrelationSubject<'a> {
    /// internal: `alert.get_unique_key()`; external: `external_alerts.id`
    pub id: String,
    pub name: String,
    pub org_id: String,
    pub kind: config::meta::alerts::incidents::AlertKind,
    pub base_destinations: Vec<String>,
    /// Pre-mapped severity: external events carry their own; internal alerts
    /// carry `alert.priority` mapped through `determine_severity`, when set.
    /// `None` → eval_level default (Critical→P2, Warning→P3).
    pub severity: Option<config::meta::alerts::incidents::IncidentSeverity>,
    pub title_inputs: Option<super::incident_title::TitleInputs<'a>>,
    /// Title for a new incident when no template renders one.
    pub case_title: Option<String>,
    /// Case window (µs): join a recent open case with exactly these values, never an ops incident.
    pub siem_case_window: Option<i64>,
    /// A SIEM detection: the incident it opens or joins is marked a security case.
    pub security_case: bool,
    /// A SIEM backfill firing whose evidence all predates its run's own window.
    pub historical: bool,
    /// Security case only: the firing's evidence span, the case's first and last seen.
    pub case_activity: Option<infra::table::alert_incidents::CaseActivity>,
    /// Security case only: the entity a case growing to several detections is retitled on.
    pub case_entity: Option<o2_enterprise::enterprise::security::cases::Entity>,
    /// A fixed id for a new incident, so two attempts at one finding cannot both open one.
    pub incident_id: Option<String>,
    /// Awaited before each correlation step; the finding path stops there off its turn.
    pub(crate) fence: Option<std::sync::Arc<dyn TurnFence>>,
}

impl CorrelationSubject<'_> {
    /// A finding's: its firing lands in one incident only, placed under its alert's row locks.
    fn places_once(&self) -> bool {
        self.incident_id.is_some()
    }

    async fn fence_at(&self, step: FenceStep) -> anyhow::Result<()> {
        match &self.fence {
            Some(fence) => fence.before(step).await,
            None => Ok(()),
        }
    }
}

/// A check a caller runs before each correlation step that decides or writes.
#[async_trait::async_trait]
pub(crate) trait TurnFence: Send + Sync + std::fmt::Debug {
    async fn before(&self, step: FenceStep) -> anyhow::Result<()>;
}

/// The steps a [TurnFence] runs before: correlation's, then a status change's follow-ups.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FenceStep {
    Lookup,
    Join,
    Open,
    OncallRecovery,
    StatusEvent,
    Analysis,
    StatusPublish,
}

impl FenceStep {
    fn doing(self) -> &'static str {
        match self {
            Self::Lookup => "looking up the open incident",
            Self::Join => "joining the incident",
            Self::Open => "opening the incident",
            Self::OncallRecovery => "recovering on-call",
            Self::StatusEvent => "recording the status event",
            Self::Analysis => "stopping or starting the analysis",
            Self::StatusPublish => "publishing the status",
        }
    }
}

/// One event an analyst opens a security case from.
#[derive(Debug, Clone)]
pub struct CaseEvent {
    pub stream: String,
    /// The event's `_timestamp`, in microseconds.
    pub at: i64,
    /// The event's fields; they name the case's host, user or address.
    pub fields: Map<String, Value>,
}

/// An alert's incident correlation, and why its incident notification missed a destination.
#[derive(Debug, Clone)]
pub struct CorrelatedIncident {
    pub outcome: IncidentCorrelationOutcome,
    /// `None` when every destination was notified, or no notification was due.
    pub notify_error: Option<String>,
    /// Whether a notification was due and had a destination to go to.
    pub notify_attempted: bool,
}

/// A finding to open or join an incident for, as the AutoObserve investigation port hands it over.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingIncident {
    pub org_id: String,
    /// The trigger's `alert_id`: one per finding, so its open incident is joined, not copied.
    pub subject_id: String,
    pub title: String,
    pub dimensions: HashMap<String, String>,
    pub triggered_at: i64,
    /// The streams its page routes on, as (type, name): itself first, then its scope's peers.
    pub streams: Vec<(String, String)>,
    /// What its page says: the cohort's size when peers were dispatched with it.
    pub page_title: String,
    /// R6: joins the open stop incident of its kind and scope instead of opening its own.
    pub cohort: bool,
    /// The one service its stream has in the org's catalogue; None groups it org-wide.
    pub scope: Option<String>,
}

/// What on-call routing did for a new incident: the record that paged, and what failed.
#[cfg(feature = "enterprise")]
pub(crate) struct RoutedIncident {
    pub record: Option<config::meta::oncall::Response>,
    /// Paging or linking the record failed; a record that paged is kept beside the error.
    pub error: Option<anyhow::Error>,
}

/// How a finding's incident reaches on-call, behind a seam so routing failures can be tested.
#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
pub(crate) trait FindingPager: Send + Sync {
    /// The incident's on-call record, open or closed, if one was ever opened.
    async fn record(
        &self,
        org_id: &str,
        incident_id: &str,
    ) -> anyhow::Result<Option<config::meta::oncall::Response>>;
    async fn route(
        &self,
        org_id: &str,
        incident_id: &str,
        title: &str,
        streams: &[(String, String)],
    ) -> RoutedIncident;
    async fn attach(&self, org_id: &str, record_id: &str, incident_id: &str) -> anyhow::Result<()>;
}

/// The production [FindingPager]: on-call routing on the streams' catalogued services, at P2.
#[cfg(feature = "enterprise")]
pub(crate) struct OncallPager;

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl FindingPager for OncallPager {
    async fn record(
        &self,
        org_id: &str,
        incident_id: &str,
    ) -> anyhow::Result<Option<config::meta::oncall::Response>> {
        let latest = infra::table::oncall_responses::history_for_source(
            org_id,
            config::meta::oncall::SubjectType::Incident,
            incident_id,
            1,
        )
        .await?;
        Ok(latest.into_iter().next())
    }

    async fn route(
        &self,
        org_id: &str,
        incident_id: &str,
        title: &str,
        streams: &[(String, String)],
    ) -> RoutedIncident {
        let dimensions = o2_enterprise::enterprise::autoobserve::page_routing::cohort_dimensions(
            org_id, streams,
        )
        .await;
        // Firing 1 only: a holder that lost its lease mid-route meets the subject's unique index.
        let started = o2_enterprise::enterprise::oncall::escalation::start_once_for_incident(
            org_id,
            incident_id,
            title,
            config::meta::oncall::DEFAULT_PAGING_PRIORITY,
            None,
            &dimensions,
        )
        .await;
        routed_from(org_id, incident_id, &dimensions, started).await
    }

    async fn attach(&self, org_id: &str, record_id: &str, incident_id: &str) -> anyhow::Result<()> {
        infra::table::oncall_responses::attach_incident(org_id, record_id, incident_id).await?;
        Ok(())
    }
}

/// Where a finding's incident work takes turns, behind a seam so two nodes can be tested.
#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
pub(crate) trait FindingTurns: Send + Sync {
    async fn take(&self, org_id: &str, subject_id: &str) -> anyhow::Result<FindingTurn>;
}

/// The production [FindingTurns]: the node's stripe, then the cluster lock (none in local mode).
#[cfg(feature = "enterprise")]
pub(crate) struct ClusterTurns;

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl FindingTurns for ClusterTurns {
    async fn take(&self, org_id: &str, subject_id: &str) -> anyhow::Result<FindingTurn> {
        let stripe = finding_turn(subject_id).clone().lock_owned().await;
        let key = finding_lock_key(org_id, subject_id);
        let cluster = infra::dist_lock::lock(&key, 0).await?;
        let lease = LeaseWatch {
            key,
            lost: cluster.as_ref().map(infra::dist_lock::Locker::lost),
        };
        Ok(FindingTurn {
            held: vec![Box::new(stripe) as Box<dyn Send + Sync>],
            cluster,
            fence: std::sync::Arc::new(lease.clone()),
            lease,
        })
    }
}

/// A finding's turn while held: the local locks, and the cluster lock when there is one.
#[cfg(feature = "enterprise")]
pub(crate) struct FindingTurn {
    held: Vec<Box<dyn Send + Sync>>,
    cluster: Option<infra::dist_lock::Locker>,
    lease: LeaseWatch,
    /// Run before each correlation step; the DB fences, not this check, keep the incident single.
    fence: std::sync::Arc<dyn TurnFence>,
}

#[cfg(feature = "enterprise")]
impl FindingTurn {
    /// Fails once the lease is lost, so a step about to page, link or analyse goes no further.
    fn held(&self, step: &str) -> anyhow::Result<()> {
        self.lease.held(step)
    }

    /// A failed release only logs: its keep-alive has stopped, so the cluster lock expires.
    async fn end(self) {
        if let Err(e) = infra::dist_lock::unlock(&self.cluster).await {
            log::error!(
                "[incidents] releasing the finding lock {} failed: {e}",
                self.lease.key
            );
        }
        drop(self.held);
    }
}

/// A turn's cluster lease as any step reads it.
#[derive(Clone, Debug)]
pub(crate) struct LeaseWatch {
    key: String,
    /// Turns `true` once the cluster lock lapsed and another node may hold this turn.
    lost: Option<tokio::sync::watch::Receiver<bool>>,
}

impl LeaseWatch {
    fn held(&self, step: &str) -> anyhow::Result<()> {
        if self.lost.as_ref().is_some_and(|lost| *lost.borrow()) {
            anyhow::bail!(
                "lost the lock {} before {step}; the act retries under a new one",
                self.key
            );
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl TurnFence for LeaseWatch {
    async fn before(&self, step: FenceStep) -> anyhow::Result<()> {
        self.held(step.doing())
    }
}

/// Where an incident's status changes take turns, behind a seam so a reopen can be raced in tests.
#[async_trait::async_trait]
pub(crate) trait IncidentTurns: Send + Sync {
    async fn take(&self, org_id: &str, incident_id: &str) -> anyhow::Result<IncidentTurn>;
}

/// The production [IncidentTurns]: the node's stripe, then the cluster lock (none in local mode).
pub(crate) struct ClusterIncidentTurns;

#[async_trait::async_trait]
impl IncidentTurns for ClusterIncidentTurns {
    async fn take(&self, org_id: &str, incident_id: &str) -> anyhow::Result<IncidentTurn> {
        let stripe = incident_turn(incident_id).clone().lock_owned().await;
        let key = format!("/incidents/status/{org_id}/{incident_id}");
        let cluster = infra::dist_lock::lock(&key, 0).await?;
        let lease = LeaseWatch {
            key,
            lost: cluster.as_ref().map(infra::dist_lock::Locker::lost),
        };
        Ok(IncidentTurn {
            stripe,
            cluster,
            fence: std::sync::Arc::new(lease),
        })
    }
}

/// An incident's status turn: a status write and its follow-up steps run inside one.
pub(crate) struct IncidentTurn {
    stripe: tokio::sync::OwnedMutexGuard<()>,
    cluster: Option<infra::dist_lock::Locker>,
    /// Run before each follow-up step; a step after a lost lease is left for a retry.
    fence: std::sync::Arc<dyn TurnFence>,
}

impl IncidentTurn {
    /// A failed release only logs: its keep-alive has stopped, so the cluster lock expires.
    async fn end(self) {
        if let Err(e) = infra::dist_lock::unlock(&self.cluster).await {
            log::error!("[incidents] releasing an incident status lock failed: {e}");
        }
        drop(self.stripe);
    }
}

/// Combined correlation result from both Service Discovery and semantic extraction
struct ParallelCorrelationResult {
    service_discovery: Option<ServiceDiscoveryResult>,
    semantic_extraction: Option<FilteredSemanticResult>,
    final_group_values: HashMap<String, String>,
    final_key_type: config::meta::alerts::incidents::KeyType,
    correlation_reason: String,
}

/// What a firing does to the downtime mute of the incident it joins.
#[derive(Debug, PartialEq)]
enum MuteChange<'a> {
    Keep,
    Unmute(&'a str),
    Retarget { from: &'a str, to: &'a str },
}

/// Extract semantic dimensions using configured distinguish_by groups only
/// This replaces the current fallback that uses ALL labels
#[cfg(feature = "enterprise")]
async fn extract_filtered_semantic_dimensions(
    org_id: &str,
    labels: &HashMap<String, String>,
    identity_config: &ServiceIdentityConfig,
    semantic_groups: &[FieldAlias],
) -> Option<FilteredSemanticResult> {
    use config::meta::alerts::incidents::KeyType;

    // No identity sets configured AND service is opted out — nothing to extract.
    // Otherwise fall through: "service" alone is a viable dimension even with zero sets.
    if identity_config.sets.is_empty() && identity_config.service_optional {
        log::debug!(
            "[incidents] ServiceIdentityConfig for org {} has no identity sets and service is optional, semantic extraction skipped",
            org_id
        );
        return None;
    }

    // Collect all distinguish_by group IDs from ALL identity sets (flattened)
    // Don't require a specific set to "match" - extract whatever we can
    let mut all_distinguish_by: Vec<String> = Vec::new();
    for set in &identity_config.sets {
        all_distinguish_by.extend(set.distinguish_by.iter().cloned());
    }
    // "service" is always a correlation dimension unless the org has explicitly
    // opted out via service_optional (same toggle Service Discovery uses to match
    // streams without requiring the service attribute).
    if !identity_config.service_optional {
        all_distinguish_by.push("service".to_string());
    }
    // Remove duplicates and sort for deterministic processing
    all_distinguish_by.sort();
    all_distinguish_by.dedup();

    if all_distinguish_by.is_empty() {
        log::warn!(
            "[incidents] No distinguish_by fields found in any identity sets for org {}",
            org_id
        );
        return None;
    }

    // Extract dimensions by resolving field names through semantic groups
    let mut group_values = HashMap::new();
    for group_id in &all_distinguish_by {
        if let Some(alias_group) = semantic_groups.iter().find(|g| g.id == *group_id) {
            // Find first matching field from this semantic group's aliases
            for field_name in &alias_group.fields {
                if let Some(value) = labels.get(field_name)
                    && !value.is_empty()
                {
                    // Store using the group ID (canonical name), not the original field name
                    group_values.insert(group_id.clone(), value.clone());
                    break; // Take first match from this group
                }
            }
        }
    }

    if group_values.is_empty() {
        log::debug!(
            "[incidents] No dimensions extracted from configured distinguish_by groups for org {}",
            org_id
        );
        return None;
    }

    // Use Secondary key type for semantic extraction (lower priority than Service Discovery)
    let key_type = KeyType::Secondary;

    Some(FilteredSemanticResult {
        group_values,
        key_type,
    })
}

#[cfg(not(feature = "enterprise"))]
async fn extract_filtered_semantic_dimensions(
    _org_id: &str,
    _labels: &HashMap<String, String>,
    _identity_config: &ServiceIdentityConfig,
    _semantic_groups: &[FieldAlias],
) -> Option<FilteredSemanticResult> {
    None
}

/// Execute Service Discovery and semantic extraction in parallel
async fn correlate_parallel(
    org_id: &str,
    labels: &HashMap<String, String>,
    semantic_groups: &[FieldAlias],
) -> ParallelCorrelationResult {
    let identity_config = crate::db::system_settings::get_service_identity_config(org_id).await;
    // Execute both approaches in parallel
    let (sd_result, semantic_result) = tokio::join!(
        query_service_discovery_key(org_id, labels, &identity_config, semantic_groups),
        extract_filtered_semantic_dimensions(org_id, labels, &identity_config, semantic_groups)
    );

    log::debug!(
        "[incidents] Parallel correlation results: service_discovery_success={}, semantic_extraction_success={}",
        sd_result.is_some(),
        semantic_result.is_some()
    );

    // Merge results using priority system
    let (final_group_values, final_key_type, correlation_reason) =
        merge_correlation_results(&sd_result, &semantic_result);

    ParallelCorrelationResult {
        service_discovery: sd_result,
        semantic_extraction: semantic_result,
        final_group_values,
        final_key_type,
        correlation_reason,
    }
}

/// Merge correlation results from Service Discovery and semantic extraction using priority system
fn merge_correlation_results(
    sd_result: &Option<ServiceDiscoveryResult>,
    semantic_result: &Option<FilteredSemanticResult>,
) -> (
    HashMap<String, String>,
    config::meta::alerts::incidents::KeyType,
    String,
) {
    use config::meta::alerts::incidents::KeyType;

    match (sd_result, semantic_result) {
        // Service Discovery success - highest priority
        (Some(sd), _) => {
            log::debug!(
                "[incidents] Using Service Discovery result: service='{}', dimensions={:?}",
                sd.service_name,
                sd.group_values
            );
            (
                sd.group_values.clone(),
                sd.key_type,
                "service_discovery".to_string(),
            )
        }
        // Semantic extraction success - medium priority
        (None, Some(sem)) => {
            log::debug!(
                "[incidents] Using filtered semantic extraction result: dimensions={:?}",
                sem.group_values
            );
            (
                sem.group_values.clone(),
                sem.key_type,
                "semantic_extraction".to_string(),
            )
        }
        // Both failed - fallback to AlertId isolation
        (None, None) => {
            log::debug!(
                "[incidents] Both Service Discovery and semantic extraction failed, using AlertId fallback"
            );
            (
                HashMap::new(),
                KeyType::AlertId,
                "alert_id_fallback".to_string(),
            )
        }
    }
}

/// Extract service name from both parallel correlation results
fn extract_service_name_parallel(
    labels: &HashMap<String, String>,
    sd_result: &Option<ServiceDiscoveryResult>,
) -> String {
    // Priority 1: Service Discovery result
    if let Some(sd) = sd_result {
        return sd.service_name.clone();
    }

    // Priority 2: Extract from labels using standard service field names
    for field in ["service", "service_name", "svc", "app"] {
        if let Some(service) = labels.get(field)
            && !service.is_empty()
        {
            log::debug!(
                "[incidents] Extracted service name from field '{}': '{}'",
                field,
                service
            );
            return service.clone();
        }
    }

    // Priority 3: Default fallback
    log::debug!("[incidents] No service name found in labels, using '{UNKNOWN_SERVICE}'");
    UNKNOWN_SERVICE.to_string()
}

/// Collect the union of notification destinations from all alerts correlated to an incident.
///
/// `base_destinations` (the current alert's destinations) are always included.
/// Any additional destinations from other alerts in the incident are appended,
/// deduplicated by name.
#[cfg(feature = "enterprise")]
async fn collect_incident_destinations(
    org_id: &str,
    incident_id: &str,
    base_destinations: &[String],
) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = base_destinations.iter().cloned().collect();
    let mut destinations: Vec<String> = base_destinations.to_vec();

    let incident_alerts = match infra::table::alert_incidents::get_incident_alerts(incident_id)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "[incidents] Failed to fetch alert list for destination merge (incident {org_id}/{incident_id}): {e}"
            );
            return destinations;
        }
    };

    for ia in &incident_alerts {
        if let Some((_folder, other_alert)) =
            crate::db::alerts::alert::get_alert_from_cache(org_id, &ia.alert_id).await
        {
            for dest in &other_alert.destinations {
                if seen.insert(dest.clone()) {
                    destinations.push(dest.clone());
                }
            }
        }
    }

    destinations
}

/// Send an incident notification: `alert`'s own destinations get its rows and template, merged-in
/// ones a rowless context and their own template.
#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
async fn send_incident_notifications(
    alert: &Alert,
    notify_rows: &[Map<String, Value>],
    level: Option<config::meta::alerts::level::AlertLevel>,
    actual_value: Option<f64>,
    incident_id: &str,
    event: &str,
    triggered_at: i64,
    dest_names: &[String],
) -> Option<String> {
    if dest_names.is_empty() {
        return None;
    }
    // The rows are this alert's data; destinations merged in from other alerts never received it.
    let (own, others): (Vec<String>, Vec<String>) = dest_names
        .iter()
        .cloned()
        .partition(|name| alert.destinations.contains(name));
    let alert_template = match alert.template.as_ref().filter(|n| !n.is_empty()) {
        Some(name) => crate::db::alerts::templates::get(&alert.org_id, name)
            .await
            .ok(),
        None => None,
    };

    let mut sends = Vec::with_capacity(2);
    if !own.is_empty() {
        let ctx = crate::alerts::alert::build_send_context(
            alert,
            notify_rows,
            triggered_at,
            None,
            triggered_at,
            level,
            actual_value,
            None,
            None,
            false,
        )
        .await;
        sends.push(IncidentSend {
            ctx,
            dest_names: own,
            alert_template: alert_template.as_ref(),
        });
    }
    if !others.is_empty() {
        let ctx = crate::alerts::alert::build_send_context(
            alert,
            &[],
            triggered_at,
            None,
            triggered_at,
            level,
            None,
            None,
            None,
            false,
        )
        .await;
        sends.push(IncidentSend {
            ctx,
            dest_names: others,
            alert_template: None,
        });
    }
    send_incident_notifications_inner(&alert.org_id, incident_id, event, sends).await
}

/// Render the incident into each send's context and deliver it through each destination's template.
#[cfg(feature = "enterprise")]
async fn send_incident_notifications_inner(
    org_id: &str,
    incident_id: &str,
    event: &str,
    sends: Vec<IncidentSend<'_>>,
) -> Option<String> {
    if sends.iter().all(|send| send.dest_names.is_empty()) {
        return None;
    }

    // Load incident to get severity, title and service_name.
    let (severity, title, service_name) =
        match infra::table::alert_incidents::get(org_id, incident_id).await {
            Ok(Some(model)) => {
                let gv: std::collections::HashMap<String, String> =
                    serde_json::from_value(model.group_values).unwrap_or_default();
                let svc = gv
                    .get("service_name")
                    .or_else(|| gv.get("service"))
                    .cloned()
                    .unwrap_or_default();
                let title_str = model.title.unwrap_or_default();
                (model.severity, title_str, svc)
            }
            _ => ("P3".to_string(), String::new(), String::new()),
        };

    let cfg = config::get_config();
    let incident_url = format!(
        "{}/web/alerts/incidents/{incident_id}?org_identifier={org_id}",
        cfg.common.web_url
    );
    let subject = format!("[{event}] {title}");

    let mut success_parts: Vec<String> = Vec::new();
    let mut err_parts: Vec<String> = Vec::new();

    for mut send in sends {
        apply_incident_to_context(
            &mut send.ctx,
            incident_id,
            event,
            &title,
            &severity,
            &service_name,
            &incident_url,
        );
        let explicit: Vec<_> = send.alert_template.into_iter().cloned().collect();
        for dest_name in &send.dest_names {
            match notify_incident_destination(org_id, dest_name, &explicit, &subject, &mut send.ctx)
                .await
            {
                Ok(sent) => success_parts.push(format!("{dest_name}: {}", sent.response)),
                Err(e) => {
                    log::error!(
                        "[incidents] Failed to notify {dest_name} for incident {org_id}/{incident_id}: {e}"
                    );
                    err_parts.push(format!("{dest_name}: {e}"));
                }
            }
        }
    }

    if err_parts.is_empty() {
        log::info!(
            "[incidents] Notification sent for incident {incident_id} ({event}): {}",
            success_parts.join("; ")
        );
        None
    } else {
        let error = err_parts.join("; ");
        log::error!(
            "[incidents] Notification partially failed for incident {org_id}/{incident_id} ({event}): {error}"
        );
        Some(error)
    }
}

/// Retries a temporary failure in place: later firings join as repeats and never re-send it.
#[cfg(feature = "enterprise")]
async fn notify_incident_destination(
    org_id: &str,
    dest_name: &str,
    explicit: &[config::meta::destinations::Template],
    subject: &str,
    ctx: &mut crate::alerts::notifications::NotificationContext,
) -> Result<
    crate::alerts::notifications::notify::SendOutcome,
    crate::alerts::notifications::notify::NotifyError,
> {
    let attempts = infra::scheduler::get_scheduler_max_retries();
    let mut attempt = 1;
    loop {
        match crate::alerts::notifications::notify::notify(
            org_id,
            dest_name,
            explicit,
            Some(subject),
            ctx,
        )
        .await
        {
            Err(error) if retries_incident_notify(&error, attempt, attempts) => {
                log::warn!(
                    "[incidents] notify {dest_name} failed for {org_id}, attempt {attempt}/{attempts}: {error}"
                );
                attempt += 1;
                tokio::time::sleep(INCIDENT_NOTIFY_RETRY_DELAY).await;
            }
            result => return result,
        }
    }
}

/// Whether a failed incident send is tried again; a refusal that cannot pass is not.
#[cfg(feature = "enterprise")]
fn retries_incident_notify(
    error: &crate::alerts::notifications::notify::NotifyError,
    attempt: i32,
    attempts: i32,
) -> bool {
    error.is_retryable() && attempt < attempts
}

/// Point `ctx` at the incident: its link, and the `incident_*` template variables.
#[cfg(feature = "enterprise")]
fn apply_incident_to_context(
    ctx: &mut crate::alerts::notifications::NotificationContext,
    incident_id: &str,
    event: &str,
    title: &str,
    severity: &str,
    service_name: &str,
    incident_url: &str,
) {
    // The alert's own link points at its search; an incident notification must open the incident.
    ctx.alert_url = incident_url.to_string();
    ctx.incident_id = incident_id.to_string();
    ctx.kind = config::meta::alerts::notification_kind::NotificationKind::Incident;
    ctx.event = config::meta::alerts::notification_kind::NotificationEvent::Firing;
    ctx.episode_id = Some(incident_id.to_string());
    // Level, the dot and show_when follow the incident severity, as an on-call priority does.
    ctx.alert_level = severity.to_string();
    // P4 is informational, so it gets no level rather than a warning dot.
    ctx.level = match severity {
        "P1" | "P2" => Some(config::meta::alerts::level::AlertLevel::Critical),
        "P3" => Some(config::meta::alerts::level::AlertLevel::Warning),
        _ => None,
    };
    ctx.context_attributes.extend(
        [
            ("incident_id", incident_id),
            ("incident_title", title),
            ("incident_event", event),
            ("incident_severity", severity),
            ("incident_service", service_name),
            ("incident_url", incident_url),
        ]
        .map(|(key, value)| (key.to_string(), value.to_string())),
    );
}

/// Notification context for an incident subject with no alert behind it.
#[cfg(feature = "enterprise")]
async fn subject_notification_context(
    org_id: &str,
    subject_name: &str,
    triggered_at: i64,
) -> crate::alerts::notifications::NotificationContext {
    crate::alerts::notifications::NotificationContext {
        org_name: org_display_name(org_id).await,
        alert_name: subject_name.to_string(),
        alert_status: crate::alerts::notifications::STATUS_FIRING.to_string(),
        alert_start_time: String::from("N/A"),
        alert_end_time: String::from("N/A"),
        alert_start_time_millis: String::from("N/A"),
        alert_end_time_millis: String::from("N/A"),
        alert_trigger_time: triggered_at,
        alert_trigger_time_str: crate::alerts::alert::format_alert_time(triggered_at),
        ..Default::default()
    }
}

#[cfg(feature = "enterprise")]
async fn org_display_name(org_id: &str) -> String {
    crate::common::infra::config::ORGANIZATIONS
        .read()
        .await
        .get(org_id)
        .map_or_else(|| org_id.to_string(), |org| org.name.clone())
}

/// Send a notification for an incident severity change to all correlated alert destinations.
#[cfg(feature = "enterprise")]
async fn send_incident_severity_notification(org_id: &str, incident_id: &str) {
    let incident_alerts = match infra::table::alert_incidents::get_incident_alerts(incident_id)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "[incidents] Failed to load alerts for severity notification (incident {org_id}/{incident_id}): {e}"
            );
            return;
        }
    };

    let first_alert_id = match incident_alerts.first() {
        Some(ia) => ia.alert_id.as_str(),
        None => {
            log::debug!(
                "[incidents] No alerts in incident {incident_id}, skipping severity notification"
            );
            return;
        }
    };

    let Some((_folder, first_alert)) =
        crate::db::alerts::alert::get_alert_from_cache(org_id, first_alert_id).await
    else {
        log::debug!(
            "[incidents] Alert {first_alert_id} not in cache, skipping severity notification for {incident_id}"
        );
        return;
    };

    let merged_destinations =
        collect_incident_destinations(org_id, incident_id, &first_alert.destinations).await;

    send_incident_notifications(
        &first_alert,
        &[],
        None,
        None,
        incident_id,
        "severity_changed",
        chrono::Utc::now().timestamp_micros(),
        &merged_destinations,
    )
    .await;
}

/// Whether the operator switched incident correlation on and the license grants it.
#[cfg(feature = "enterprise")]
pub fn incidents_enabled() -> bool {
    o2_enterprise::enterprise::common::config::get_config()
        .incidents
        .enabled
        && o2_enterprise::enterprise::license::check_features(&[
            config::meta::feature::Feature::Incidents,
        ])
}

/// Whether O2's agent may answer an analysis: operator switch, agent target and assistant license.
#[cfg(feature = "enterprise")]
pub fn rca_agent_available() -> bool {
    let cfg = o2_enterprise::enterprise::common::config::get_config();
    cfg.ai.enabled
        && cfg.ai.has_agent_target()
        && o2_enterprise::enterprise::license::check_features(&[
            config::meta::feature::Feature::AiAssistant,
        ])
}

/// Correlate an alert to an incident, and send a notification if appropriate.
///
/// This is the main entry point for incident correlation in the alert execution flow.
/// Called instead of direct notification for `creates_incident=true` alerts.
///
/// Notification behaviour:
/// - `NewIncidentCreated` → sends incident notification to merged destinations of all correlated
///   alerts.
/// - `NewAlertTypeJoined` → same as above (new alert type joining is an escalation signal).
/// - `ExistingAlertRepeated` → notification suppressed (same alert type already in incident).
/// - `FiredAfterReopen` → sends once: the first repeat after a manual reopen.
/// - A failed send is returned in `CorrelatedIncident::notify_error` for the caller to record.
///
/// When `notify_rows` is empty the function still correlates but sends no notification.
/// Pass an empty slice from manual test-trigger paths that send their own notification.
///
/// Correlation priority:
/// 1. Service Discovery — uses labels matched by service_streams to identify service
/// 2. Manual extraction — extracts semantic dimensions from alert labels
#[allow(clippy::too_many_arguments)]
pub async fn correlate_alert_to_incident(
    alert: &Alert,
    result_row: &Map<String, Value>,
    notify_rows: &[Map<String, Value>],
    triggered_at: i64,
    // T-8: the evaluated level drives new-incident severity (Critical → P2,
    // Warning → P3). None (manual triggers, single-level alerts) keeps the
    // enterprise default.
    eval_level: Option<config::meta::alerts::level::AlertLevel>,
    // The exact evaluated observation, so `{alert_count}` is not capped at the sampled rows.
    actual_value: Option<f64>,
    downtime: Option<&config::meta::downtimes::ActiveDowntime>,
    // Where a backfill run's own window starts; `None` outside a backfill.
    history_before: Option<i64>,
) -> Result<Option<CorrelatedIncident>, anyhow::Error> {
    use o2_enterprise::enterprise::security::{cases, detection};

    let siem = detection::is_siem(alert.context_attributes.as_ref());
    if !siem || notify_rows.is_empty() {
        let historical = siem
            && history_before.is_some_and(|cutoff| {
                detection::predates(std::slice::from_ref(result_row), cutoff)
            });
        return correlate_rows(
            alert,
            result_row,
            notify_rows,
            siem.then(|| cases::entity_of(result_row)).flatten(),
            triggered_at,
            eval_level,
            actual_value,
            downtime,
            historical,
        )
        .await;
    }
    let group_window = db::organization::read_org_setting(&alert.org_id, |s| s.security_cases)
        .await
        .unwrap_or_default()
        .group_window_micros();
    // One case per entity and window, so old and current evidence never share a case.
    let mut merged: Option<CorrelatedIncident> = None;
    for part in cases::case_partitions(notify_rows, group_window, history_before) {
        let Some(first_row) = part.rows.first() else {
            continue;
        };
        let correlated = correlate_rows(
            alert,
            first_row,
            &part.rows,
            part.entity,
            triggered_at,
            eval_level,
            actual_value,
            downtime,
            part.historical,
        )
        .await?;
        merged = merge_correlations(merged, correlated);
    }
    Ok(merged)
}

/// The first partition's incident, with every partition's notification outcome.
fn merge_correlations(
    merged: Option<CorrelatedIncident>,
    next: Option<CorrelatedIncident>,
) -> Option<CorrelatedIncident> {
    match (merged, next) {
        (Some(first), Some(next)) => Some(CorrelatedIncident {
            notify_error: match (first.notify_error, next.notify_error) {
                (Some(a), Some(b)) => Some(format!("{a}; {b}")),
                (a, b) => a.or(b),
            },
            notify_attempted: first.notify_attempted || next.notify_attempted,
            outcome: first.outcome,
        }),
        (first, next) => first.or(next),
    }
}

/// `entity` is the security case's grouping entity; the overflow partition passes `None`.
#[allow(clippy::too_many_arguments)]
async fn correlate_rows(
    alert: &Alert,
    result_row: &Map<String, Value>,
    notify_rows: &[Map<String, Value>],
    entity: Option<o2_enterprise::enterprise::security::cases::Entity>,
    triggered_at: i64,
    eval_level: Option<config::meta::alerts::level::AlertLevel>,
    actual_value: Option<f64>,
    downtime: Option<&config::meta::downtimes::ActiveDowntime>,
    historical: bool,
) -> Result<Option<CorrelatedIncident>, anyhow::Error> {
    let mut labels = labels_from_row(result_row);
    let semantic_groups =
        crate::db::system_settings::get_semantic_field_groups(&alert.org_id).await;

    // Enrich with alert condition dimensions (deterministic baseline)
    // Handles SQL WHERE, GUI conditions, and PromQL label matchers
    #[cfg(feature = "enterprise")]
    {
        let condition_dims =
            o2_enterprise::enterprise::alerts::sql_parser::extract_dimensions_from_alert_conditions(
                &alert.query_condition,
                &semantic_groups,
            );

        if !condition_dims.is_empty() {
            let before_count = labels.len();
            for (field_name, value) in condition_dims {
                labels.entry(field_name).or_insert(value);
            }
            let after_count = labels.len();

            if after_count > before_count {
                log::info!(
                    "[incidents] Enriched alert '{}' with {} dimensions from alert conditions",
                    alert.name,
                    after_count - before_count
                );
            }
        }
    }

    log::debug!(
        "[incidents] Alert {} labels after condition enrichment: {:?}",
        alert.name,
        labels
    );

    // Execute Service Discovery and semantic extraction in parallel (non-blocking)
    let parallel_result = correlate_parallel(&alert.org_id, &labels, &semantic_groups).await;

    let mut group_values = parallel_result.final_group_values;
    let mut key_type = parallel_result.final_key_type;
    let mut correlation_reason = parallel_result.correlation_reason;
    let siem =
        o2_enterprise::enterprise::security::detection::is_siem(alert.context_attributes.as_ref());
    let mut siem_case_window = None;
    let mut case_title = None;
    let mut case_activity = None;
    let mut case_entity = None;
    if siem {
        use o2_enterprise::enterprise::security::cases;
        let settings = db::organization::read_org_setting(&alert.org_id, |s| s.security_cases)
            .await
            .unwrap_or_default();
        let entity = settings.group_window_micros().and(entity);
        let rule_title = alert
            .context_attributes
            .as_ref()
            .and_then(|attrs| attrs.get("sigma_title"))
            .filter(|t| !t.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| alert.name.clone());
        case_title = Some(cases::case_title(&rule_title, entity.as_ref()));
        // Ops dimensions never reach a security case: it groups only on its own entity key.
        group_values = entity
            .as_ref()
            .map(cases::Entity::group_values)
            .unwrap_or_default();
        if entity.is_some() {
            key_type = config::meta::alerts::incidents::KeyType::Primary;
            correlation_reason = cases::ENTITY_REASON.to_string();
        }
        siem_case_window = settings.group_window_micros();
        let evidence = if notify_rows.is_empty() {
            std::slice::from_ref(result_row)
        } else {
            notify_rows
        };
        let (first_event_at, last_event_at) =
            cases::event_span(evidence).unwrap_or((triggered_at, triggered_at));
        case_activity = Some(infra::table::alert_incidents::CaseActivity {
            first_event_at,
            last_event_at,
            historical,
        });
        case_entity = entity;
    }

    // Extract service name using both results
    let service_name = extract_service_name_parallel(&labels, &parallel_result.service_discovery);

    // If group_values is empty, isolate by alert_id to prevent incorrect grouping
    use config::meta::alerts::incidents::KeyType;
    if group_values.is_empty() {
        key_type = KeyType::AlertId;
        log::warn!(
            "[incidents] Alert {}/{} has no group_values - isolated by alert_id",
            alert.org_id,
            alert.name
        );
    }

    // Enhanced logging for correlation decisions
    log::info!(
        "[incidents] Alert '{}' correlation result: reason={}, key_type={:?}, dimensions={:?}, service_discovery_success={}, semantic_extraction_success={}",
        alert.name,
        correlation_reason,
        key_type,
        group_values,
        parallel_result.service_discovery.is_some(),
        parallel_result.semantic_extraction.is_some()
    );

    if let Some(sem_result) = &parallel_result.semantic_extraction {
        log::debug!(
            "[incidents] Semantic extraction for alert '{}': dimensions={:?}",
            alert.name,
            sem_result.group_values
        );
    }
    // B-29: a P1 alert must open a P1 incident, not the eval_level default.
    // `alert.priority` is the operator's stated urgency, so when it's set it
    // wins over the Critical/Warning->P2/P3 fallback in `create_new_incident`
    // — otherwise the incident dashboard's severity tiles silently undercount
    // P1s for every alert that only defines a Critical tier.
    let severity = alert
        .priority
        .and_then(|p| {
            o2_enterprise::enterprise::alerts::incidents::determine_severity(Some(p.as_str()))
                .parse()
                .ok()
        })
        .or_else(|| {
            siem.then(|| alert.context_attributes.as_ref()?.get("sigma_level"))
                .flatten()
                .and_then(|level| o2_enterprise::enterprise::security::cases::sigma_severity(level))
        });

    // Build the correlation subject for the internal alert path.
    let subject = CorrelationSubject {
        id: alert.get_unique_key(),
        name: alert.name.clone(),
        org_id: alert.org_id.to_string(),
        kind: AlertKind::Internal,
        base_destinations: alert.destinations.clone(),
        severity,
        title_inputs: Some(super::incident_title::TitleInputs {
            alert,
            result_row,
            notify_rows,
            labels: &labels,
        }),
        case_title,
        siem_case_window,
        security_case: siem,
        historical: siem && historical,
        case_activity,
        case_entity,
        incident_id: None,
        fence: None,
    };

    let _case_guard = match subject.siem_case_window {
        Some(_) => Some(siem_case_lock(&alert.org_id, &group_values).lock().await),
        None => None,
    };
    let correlation = find_or_create_incident(
        &alert.org_id,
        &group_values,
        key_type,
        &subject,
        triggered_at,
        &correlation_reason,
        &service_name,
        eval_level,
        downtime.map(|d| d.id.as_str()),
    )
    .await?;
    let outcome = correlation.outcome;
    if siem
        && !matches!(
            outcome,
            IncidentCorrelationOutcome::NewIncidentCreated { .. }
        )
        && let Err(e) =
            infra::table::alert_incidents::mark_security_case(&alert.org_id, outcome.incident_id())
                .await
    {
        log::error!(
            "[incidents] could not mark {}/{} a security case: {e}",
            alert.org_id,
            outcome.incident_id()
        );
    }
    // D23: a firing joining an acknowledged incident is acknowledged too, so nobody is re-paged.
    if !matches!(
        outcome,
        IncidentCorrelationOutcome::NewIncidentCreated { .. }
    ) && let Some(alert_id) = alert.id.map(|id| id.to_string())
    {
        crate::alerts::ack::join_acked_incident(&alert.org_id, outcome.incident_id(), &alert_id)
            .await;
    }

    // The on-call record routing opened; its team decides L0 for the incident.
    #[cfg(feature = "enterprise")]
    let mut routed_origin: Option<config::meta::oncall::Response> = None;
    // Only on creation: an alert joining an existing incident must not open a second record.
    #[cfg(feature = "enterprise")]
    if let IncidentCorrelationOutcome::NewIncidentCreated {
        incident_id,
        service_name,
    } = &outcome
        && downtime.is_none()
        && o2_enterprise::enterprise::oncall::is_enabled()
    {
        // Single-sourced with `scheduler::handlers`: the row, then the alert's own conditions.
        let mut dimensions = o2_enterprise::enterprise::oncall::routing::dimensions_for_alert(
            &semantic_groups,
            &alert.query_condition,
            result_row,
        );
        // `is_some_and`, not `is_none_or`, or every unidentifiable alert routes on `unknown`.
        let names_a_service = parallel_result
            .service_discovery
            .as_ref()
            .is_some_and(|sd| !sd.service_name_from_stream);
        // Belt and braces: the not-found value is a plain `String` that could reach routing.
        if dimensions.is_empty()
            && names_a_service
            && !service_name.trim().is_empty()
            && service_name != UNKNOWN_SERVICE
        {
            dimensions.insert(
                config::meta::oncall::SERVICE_DIMENSION.to_string(),
                service_name.clone(),
            );
            log::debug!(
                "[incidents] {}/{}: no identity fields in the result row; routing on the \
                 correlated service `{service_name}`",
                alert.org_id,
                alert.name,
            );
        }
        // Single-sourced with the alert path, or `creates_incident` changes how loudly it pages.
        let priority = alert
            .priority
            .unwrap_or(config::meta::oncall::DEFAULT_PAGING_PRIORITY);
        // The stored title, so a templated or reopened incident pages under the name it shows.
        let title = match infra::table::alert_incidents::get(&alert.org_id, incident_id).await {
            Ok(Some(incident)) => incident.title.unwrap_or_else(|| alert.name.clone()),
            _ => alert.name.clone(),
        };
        let routed = route_new_incident(
            &alert.org_id,
            incident_id,
            &title,
            priority,
            alert.oncall_team.as_deref(),
            &dimensions,
        )
        .await;
        if let Some(e) = routed.error {
            log::error!("[incidents] {e:#}");
        }
        routed_origin = routed.record;
    }

    // A new alert is new evidence, so a page whose ladder ran out may page again.
    #[cfg(feature = "enterprise")]
    if let Some(incident_id) = outcome.joined_by_new_alert()
        && downtime.is_none()
        && o2_enterprise::enterprise::oncall::is_enabled()
    {
        page_again_after_new_alert(&alert.org_id, incident_id).await;
    }

    // Starts after routing decides L0; an un-mute keeps an already stored off decision.
    #[cfg(feature = "enterprise")]
    if let IncidentCorrelationOutcome::NewIncidentCreated { incident_id, .. } = &outcome
        && downtime.is_none()
    {
        if correlation.created {
            if let Err(e) =
                start_new_incident_rca(&alert.org_id, incident_id, routed_origin.as_ref()).await
            {
                log::error!("[INCIDENTS::RCA] {e:#}");
            }
        } else {
            start_unmuted_incident_rca(&alert.org_id, incident_id, routed_origin.as_ref()).await;
        }
    }

    // No notification for the manual-trigger path (no rows), a suppressed firing, or a repeat.
    let mut notify_error = None;
    let mut notify_attempted = false;
    if !notify_rows.is_empty() && downtime.is_none() {
        match &outcome {
            IncidentCorrelationOutcome::NewIncidentCreated { incident_id, .. }
            | IncidentCorrelationOutcome::NewAlertTypeJoined { incident_id, .. }
            | IncidentCorrelationOutcome::SeverityEscalated { incident_id, .. }
            | IncidentCorrelationOutcome::FiredAfterReopen { incident_id, .. } => {
                let event = match &outcome {
                    IncidentCorrelationOutcome::NewIncidentCreated { .. } => "new_incident_created",
                    IncidentCorrelationOutcome::SeverityEscalated { .. } => "severity_escalated",
                    IncidentCorrelationOutcome::FiredAfterReopen { .. } => FIRED_AFTER_REOPEN_EVENT,
                    _ => "new_alert_correlated",
                };
                let merged_destinations =
                    collect_incident_destinations(&alert.org_id, incident_id, &alert.destinations)
                        .await;
                notify_attempted = !merged_destinations.is_empty();
                notify_error = send_incident_notifications(
                    alert,
                    notify_rows,
                    eval_level,
                    actual_value,
                    incident_id,
                    event,
                    triggered_at,
                    &merged_destinations,
                )
                .await;
            }
            IncidentCorrelationOutcome::ExistingAlertRepeated { incident_id, .. } => {
                log::debug!(
                    "[incidents] Suppressing notification for repeated alert type in incident {incident_id}"
                );
            }
        }
    }

    Ok(Some(CorrelatedIncident {
        outcome,
        notify_error,
        notify_attempted,
    }))
}

#[cfg(feature = "enterprise")]
pub async fn open_manual_incident(
    org: &str,
    user: &str,
    request: &config::meta::alerts::incidents::ManualIncidentRequest,
) -> anyhow::Result<(String, bool)> {
    use config::meta::alerts::incidents::{IncidentSeverity, KeyType};
    let service = request.service.trim().to_lowercase();
    let labels = HashMap::from([
        ("service".to_string(), service.clone()),
        ("where".to_string(), request.where_key.clone()),
    ]);
    let semantic_groups = crate::db::system_settings::get_semantic_field_groups(org).await;
    let parallel = correlate_parallel(org, &labels, &semantic_groups).await;
    let service = parallel
        .service_discovery
        .as_ref()
        .map(|result| result.service_name.clone())
        .unwrap_or(service);
    let mut groups = parallel.final_group_values;
    groups.insert("service".into(), service.clone());
    groups.insert("where".into(), request.where_key.clone());
    let subject = CorrelationSubject {
        id: config::meta::service_identity::version_key(
            org,
            &service,
            &request.where_key,
            &request.verdict_key,
        ),
        name: request.title.clone(),
        org_id: org.into(),
        kind: AlertKind::Internal,
        base_destinations: Vec::new(),
        severity: Some(
            request
                .severity
                .parse::<IncidentSeverity>()
                .map_err(anyhow::Error::msg)?,
        ),
        title_inputs: None,
        case_title: None,
        siem_case_window: None,
        security_case: false,
        historical: false,
        case_activity: None,
        case_entity: None,
        incident_id: None,
        fence: None,
    };
    let now = config::utils::time::now_micros();
    let Correlation { outcome, .. } = find_or_create_incident(
        org,
        &groups,
        KeyType::Primary,
        &subject,
        now,
        "manual_service_verdict",
        &service,
        None,
        None,
    )
    .await?;
    let id = outcome.incident_id().to_string();
    let created = matches!(
        outcome,
        IncidentCorrelationOutcome::NewIncidentCreated { .. }
    );
    if created {
        infra::table::alert_incidents::update_title(org, &id, &request.title).await?;
    }
    let baseline = if request.baseline_version.is_empty() {
        String::new()
    } else {
        format!(" vs {}", request.baseline_version)
    };
    let body = format!(
        "{}\n\n{} {} in {} ({}){baseline}\n{}",
        request.summary, service, request.version, request.where_key, request.env, request.link
    );
    crate::incidents::append_event(org, &id, IncidentEvent::comment(user, body)).await?;
    if !matches!(
        outcome,
        IncidentCorrelationOutcome::ExistingAlertRepeated { .. }
    ) {
        let destinations = collect_incident_destinations(org, &id, &[]).await;
        let send = IncidentSend {
            ctx: subject_notification_context(org, &request.title, now).await,
            dest_names: destinations,
            alert_template: None,
        };
        send_incident_notifications_inner(
            org,
            &id,
            if created {
                "new_incident_created"
            } else {
                "new_alert_correlated"
            },
            vec![send],
        )
        .await;
    }
    Ok((id, created))
}

/// External-event twin of [`correlate_alert_to_incident`].
///
/// Feeds an externally-ingested alert (from the External Alert Sources feature)
/// through the same incident-correlation machinery as internal alerts. Labels are
/// taken verbatim from the external record — there is no `query_condition` to
/// enrich from, so the condition-dimension enrichment step is skipped.
///
/// `base_destinations` are the integration's configured destinations (for the org
/// default, the default integration's config). Severity is parsed from the
/// external record (falling back to `P3`) rather than resolved by the enterprise
/// default used on the internal path.
///
/// Notification behaviour mirrors the internal path:
/// - `NewIncidentCreated` / `NewAlertTypeJoined` → notify merged destinations.
/// - `ExistingAlertRepeated` → notification suppressed (same subject already in incident).
///
/// The `#[cfg(feature = "cloud")]` AI-credit deduction from the internal path is
/// intentionally NOT replicated here: it is structurally coupled to `&Alert` and
/// P1 external events do not consume incident credits.
pub async fn correlate_external_event(
    org_id: &str,
    external: &infra::table::external_alerts::ExternalAlertRecord,
    base_destinations: Vec<String>,
) -> Result<Option<IncidentCorrelationOutcome>, anyhow::Error> {
    use config::meta::alerts::incidents::{IncidentSeverity, KeyType};

    // Labels come straight from the external record (no query-condition enrichment).
    let labels: HashMap<String, String> =
        serde_json::from_value(external.labels.clone()).unwrap_or_default();

    log::debug!(
        "[incidents] External event '{}' labels: {:?}",
        external.title,
        labels
    );

    // Same parallel correlation the internal path uses.
    let semantic_groups = crate::db::system_settings::get_semantic_field_groups(org_id).await;
    let parallel_result = correlate_parallel(org_id, &labels, &semantic_groups).await;

    let group_values = parallel_result.final_group_values;
    let mut key_type = parallel_result.final_key_type;
    let correlation_reason = parallel_result.correlation_reason;

    // Extract service name using both results.
    let service_name = extract_service_name_parallel(&labels, &parallel_result.service_discovery);

    // If group_values is empty, isolate by subject id to prevent incorrect grouping.
    if group_values.is_empty() {
        key_type = KeyType::AlertId;
        log::warn!(
            "[incidents] External event '{}' has no group_values - isolated by alert_id, org_id: {org_id}",
            external.title
        );
    }

    log::info!(
        "[incidents] External event '{}' correlation result: reason={}, key_type={:?}, dimensions={:?}, service_discovery_success={}, semantic_extraction_success={}",
        external.title,
        correlation_reason,
        key_type,
        group_values,
        parallel_result.service_discovery.is_some(),
        parallel_result.semantic_extraction.is_some()
    );

    // Build the correlation subject for the external path.
    let subject = CorrelationSubject {
        id: external.id.clone(),
        name: external.title.clone(),
        org_id: org_id.to_string(),
        kind: AlertKind::External,
        base_destinations,
        severity: Some(external.severity.parse().unwrap_or(IncidentSeverity::P3)),
        title_inputs: None,
        case_title: None,
        siem_case_window: None,
        security_case: false,
        historical: false,
        case_activity: None,
        case_entity: None,
        incident_id: None,
        fence: None,
    };

    let triggered_at = external.last_seen_at;

    // Find or create incident.
    // An un-mute starts the same way; `rca_off_reason` stays as creation stored it.
    let Correlation { outcome, .. } = find_or_create_incident(
        org_id,
        &group_values,
        key_type,
        &subject,
        triggered_at,
        &correlation_reason,
        &service_name,
        None, // external events carry no evaluated alert level
        None,
    )
    .await?;

    // A new external alert is new evidence too, so an unanswered page may page again.
    #[cfg(feature = "enterprise")]
    if let Some(incident_id) = outcome.joined_by_new_alert()
        && o2_enterprise::enterprise::oncall::is_enabled()
    {
        page_again_after_new_alert(org_id, incident_id).await;
    }

    // No on-call routing on this path, so nothing decides L0 and the run starts.
    #[cfg(feature = "enterprise")]
    if let IncidentCorrelationOutcome::NewIncidentCreated { incident_id, .. } = &outcome {
        start_automatic_rca(
            org_id,
            incident_id,
            config::meta::alerts::rca_runs::RunTrigger::AutoNewIncident,
        )
        .await;
    }

    // Send incident notification unless the outcome is a repeated alert (suppressed
    // by design). External events always carry a single occurrence, so there is no
    // empty-`notify_rows` manual-trigger case to guard against here.
    match &outcome {
        IncidentCorrelationOutcome::NewIncidentCreated { incident_id, .. }
        | IncidentCorrelationOutcome::NewAlertTypeJoined { incident_id, .. }
        | IncidentCorrelationOutcome::SeverityEscalated { incident_id, .. }
        | IncidentCorrelationOutcome::FiredAfterReopen { incident_id, .. } => {
            let event = match &outcome {
                IncidentCorrelationOutcome::NewIncidentCreated { .. } => "new_incident_created",
                IncidentCorrelationOutcome::SeverityEscalated { .. } => "severity_escalated",
                IncidentCorrelationOutcome::FiredAfterReopen { .. } => FIRED_AFTER_REOPEN_EVENT,
                _ => "new_alert_correlated",
            };
            let merged_destinations =
                collect_incident_destinations(org_id, incident_id, &subject.base_destinations)
                    .await;
            let send = IncidentSend {
                ctx: subject_notification_context(org_id, &subject.name, triggered_at).await,
                dest_names: merged_destinations,
                alert_template: None,
            };
            send_incident_notifications_inner(org_id, incident_id, event, vec![send]).await;
        }
        IncidentCorrelationOutcome::ExistingAlertRepeated { incident_id, .. } => {
            log::debug!(
                "[incidents] Suppressing notification for repeated external event in incident {incident_id}"
            );
        }
    }

    Ok(Some(outcome))
}

/// Opens or joins a finding's incident, then makes sure it is paged and its analysis decided.
#[cfg(feature = "enterprise")]
pub async fn open_finding_incident(
    f: &FindingIncident,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    open_finding_incident_with(f, &OncallPager, &ClusterTurns).await
}

/// Never empty: an open incident with no group values is joined by any later dimensional alert.
pub fn finding_dimensions(
    decision_kind: &str,
    stream_type: &str,
    stream_name: &str,
) -> HashMap<String, String> {
    HashMap::from([
        (
            FINDING_KIND_DIMENSION.to_string(),
            decision_kind.to_string(),
        ),
        (
            FINDING_STREAM_TYPE_DIMENSION.to_string(),
            stream_type.to_string(),
        ),
        (
            FINDING_STREAM_NAME_DIMENSION.to_string(),
            stream_name.to_string(),
        ),
    ])
}

/// One member recovering doesn't end it; acknowledged, assigned and security cases close by hand.
pub async fn resolve_alert_firing(
    event: &config::meta::alerts::recovery::RecoveryEvent,
    muted: bool,
) -> Result<(), anyhow::Error> {
    let Some(incident_id) = event.incident_id.as_deref() else {
        return Ok(());
    };
    let (org_id, alert_id, turns) = (&event.org_id, &event.alert_id, &ClusterIncidentTurns);
    let at = event.recovered_at;
    resolve_firing(org_id, incident_id, alert_id, at, muted, None, turns).await?;
    Ok(())
}

/// The finding's firing at `triggered_at` recovered; true only if this call resolved it.
#[cfg(feature = "enterprise")]
pub async fn resolve_finding_firing(
    org_id: &str,
    subject_id: &str,
    triggered_at: i64,
    recovered_at: i64,
) -> Result<bool, anyhow::Error> {
    let turns = &ClusterIncidentTurns;
    let (resolved, repairs) =
        recover_finding_firing(org_id, subject_id, triggered_at, recovered_at, turns).await?;
    finished(resolved, repairs.as_ref())
}

/// The on-call recovery a muted [resolve_alert_firing] skipped, over the recent resolved incidents.
pub async fn recover_muted_resolves(org_id: &str, alert_id: &str) -> Result<(), anyhow::Error> {
    if !o2_enterprise::enterprise::oncall::is_enabled() {
        return Ok(());
    }
    let resolved = infra::table::alert_incidents::resolved_incidents_for_alert(
        org_id,
        alert_id,
        MUTED_RESOLVES_SCANNED,
    )
    .await?;
    let mut records = HashMap::with_capacity(resolved.len());
    for incident_id in &resolved {
        let held = infra::table::oncall_responses::list_for_incident(org_id, incident_id).await?;
        records.insert(incident_id.clone(), held);
    }
    for incident_id in left_open(&resolved, &records) {
        o2_enterprise::enterprise::oncall::escalation::recover_for_incident(org_id, incident_id)
            .await?;
    }
    Ok(())
}

/// Auto-resolve the open incident containing `external.id`, but only once every
/// other `External`-kind alert already linked to that incident is also resolved
/// in `external_alerts` — a single source clearing shouldn't close an incident
/// that other still-firing sources are correlated into.
pub async fn try_auto_resolve_incident_for_external_alert(
    org_id: &str,
    external_alert_id: &str,
) -> Result<(), anyhow::Error> {
    let Some(incident) = infra::table::alert_incidents::find_open_incident_containing_alert(
        org_id,
        external_alert_id,
    )
    .await?
    else {
        return Ok(());
    };

    let links = infra::table::alert_incidents::get_incident_alerts(&incident.id).await?;
    let external_alert_ids: Vec<String> = links
        .into_iter()
        .filter(|l| l.alert_kind == "external")
        .map(|l| l.alert_id)
        .collect();

    if external_alert_ids.is_empty() {
        return Ok(());
    }

    let records = infra::table::external_alerts::get_by_ids(org_id, &external_alert_ids).await?;
    let all_resolved = records.iter().all(|r| r.state == "resolved");

    if all_resolved {
        update_status(org_id, &incident.id, "resolved", "system@openobserve.ai").await?;
        log::info!(
            "[incidents] Auto-resolved incident {} — all {} contributing external alert(s) resolved",
            incident.id,
            external_alert_ids.len()
        );
    }

    Ok(())
}

/// The lock stripe for one org's security case on `group_values`.
fn siem_case_lock(
    org_id: &str,
    group_values: &HashMap<String, String>,
) -> &'static tokio::sync::Mutex<()> {
    let mut dims: Vec<(&String, &String)> = group_values.iter().collect();
    dims.sort();
    let mut hasher = DefaultHasher::new();
    org_id.hash(&mut hasher);
    dims.hash(&mut hasher);
    &SIEM_CASE_LOCKS[(hasher.finish() % SIEM_CASE_LOCKS.len() as u64) as usize]
}

/// The open security case with exactly `group_values` active within `window` of `span`.
async fn find_open_siem_case(
    org_id: &str,
    group_values: &HashMap<String, String>,
    span: (i64, i64),
    window: i64,
) -> Result<Option<infra::table::entity::alert_incidents::Model>, anyhow::Error> {
    let client = infra::db::get_orm_client_ro().await;
    let mut open = Vec::new();
    for candidate in infra::table::alert_incidents::find_correlation_candidates(org_id).await? {
        // Only the exact entity can be this case, so every other candidate stays unread.
        let same_entity = serde_json::from_value::<HashMap<String, String>>(candidate.group_values)
            .is_ok_and(|dims| &dims == group_values);
        if same_entity
            && let Some(incident) =
                infra::table::alert_incidents::get_with(client, org_id, &candidate.id).await?
            && incident.status != "resolved"
        {
            open.push(incident);
        }
    }
    Ok(o2_enterprise::enterprise::security::cases::pick_open_case(
        open,
        group_values,
        span,
        window,
    ))
}

/// The open case a detection naming no entity fired into, active within `window` of `span`.
async fn find_open_detection_case(
    org_id: &str,
    alert_id: &str,
    span: (i64, i64),
    window: i64,
) -> Result<Option<infra::table::entity::alert_incidents::Model>, anyhow::Error> {
    let open =
        infra::table::alert_incidents::find_open_incidents_by_alert_id(org_id, alert_id).await?;
    Ok(o2_enterprise::enterprise::security::cases::pick_open_case(
        open,
        &HashMap::new(),
        span,
        window,
    ))
}

/// Links a firing; a security case's span widens to the firing's evidence, not its run time.
async fn link_firing(
    incident_id: &str,
    subject: &CorrelationSubject<'_>,
    triggered_at: i64,
    correlation_reason: &str,
) -> Result<bool, infra::errors::Error> {
    match subject.case_activity {
        Some(activity) => {
            infra::table::alert_incidents::add_firing_to_case(
                incident_id,
                &subject.id,
                &subject.name,
                subject.kind.as_str(),
                triggered_at,
                correlation_reason,
                activity,
            )
            .await
        }
        None => {
            infra::table::alert_incidents::add_alert_to_incident(
                incident_id,
                &subject.id,
                &subject.name,
                subject.kind.as_str(),
                triggered_at,
                correlation_reason,
            )
            .await
        }
    }
}

/// Renames a case a second detection joined, unless an analyst already renamed it.
async fn retitle_growing_case(
    org_id: &str,
    incident: &infra::table::entity::alert_incidents::Model,
    entity: &o2_enterprise::enterprise::security::cases::Entity,
) {
    let detections =
        match infra::table::alert_incidents::get_alert_counts(std::slice::from_ref(&incident.id))
            .await
        {
            Ok(counts) => counts.get(&incident.id).map_or(0, |c| c.groups.len()),
            Err(e) => {
                log::error!(
                    "[incidents] could not count detections of case {org_id}/{}: {e}",
                    incident.id
                );
                return;
            }
        };
    let Some(title) = o2_enterprise::enterprise::security::cases::grown_case_title(
        incident.title.as_deref(),
        detections,
        entity,
    ) else {
        return;
    };
    if let Err(e) = infra::table::alert_incidents::update_title(org_id, &incident.id, &title).await
    {
        log::error!(
            "[incidents] could not retitle case {org_id}/{}: {e}",
            incident.id
        );
        return;
    }
    let from = incident.title.clone().unwrap_or_default();
    if let Err(e) = infra::table::incident_events::append(
        org_id,
        &incident.id,
        IncidentEvent::title_changed(from, title, "system@openobserve.ai"),
    )
    .await
    {
        log::error!(
            "[incidents] could not record the retitle of case {org_id}/{}: {e}",
            incident.id
        );
    }
}

/// The scalar columns of a result row, as the labels correlation matches on.
fn labels_from_row(row: &Map<String, Value>) -> HashMap<String, String> {
    row.iter()
        .filter_map(|(k, v)| {
            let value_str = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => return None,
            };
            Some((k.clone(), value_str))
        })
        .collect()
}

/// The service the registry identifies this row as, when it identifies a real
/// service.
///
/// For the alert path, which has no correlation of its own: an alert used to
/// route differently depending on a checkbox about incidents, because only the
/// incident path could reach the registry. `None` when the registry has nothing,
/// or when the name it has is the stream a record arrived in — routing on that
/// is routing on a table name.
#[cfg(feature = "enterprise")]
pub(crate) async fn correlated_service_for_routing(
    org_id: &str,
    row: &Map<String, Value>,
) -> Option<String> {
    let identity_config = crate::db::system_settings::get_service_identity_config(org_id).await;
    let semantic_groups = crate::db::system_settings::get_semantic_field_groups(org_id).await;
    let found = query_service_discovery_key(
        org_id,
        &labels_from_row(row),
        &identity_config,
        &semantic_groups,
    )
    .await?;
    if found.service_name_from_stream || found.service_name.trim().is_empty() {
        return None;
    }
    Some(found.service_name)
}

/// Query Service Discovery for group_values using the correlation API
///
/// Uses ServiceStorage::correlate() for proper dimension matching
/// Returns full result including service_name for topology enrichment
async fn query_service_discovery_key(
    org_id: &str,
    labels: &HashMap<String, String>,
    identity_config: &ServiceIdentityConfig,
    semantic_groups: &[FieldAlias],
) -> Option<ServiceDiscoveryResult> {
    #[cfg(feature = "enterprise")]
    {
        match o2_enterprise::enterprise::service_streams::storage::correlate(
            org_id,
            labels,
            identity_config,
            semantic_groups,
        )
        .await
        {
            Ok(Some(response)) => {
                log::debug!(
                    "[incidents] Found service via correlation API: {}, group_values: {:?}",
                    response.service_name,
                    response.matched_dimensions
                );

                // Use only the matched (distinguish_by) dimensions as group_values so that
                // alerts for the same service but differing on unrelated labels (e.g. severity)
                // are still merged into the same incident.
                Some(ServiceDiscoveryResult {
                    group_values: response.matched_dimensions.clone(),
                    key_type: config::meta::alerts::incidents::KeyType::Primary,
                    service_name: response.service_name,
                    service_name_from_stream: response.service_name_from_stream,
                })
            }
            Ok(None) => {
                log::debug!("[incidents] No service found via correlation API");
                None
            }
            Err(e) => {
                log::debug!("[incidents] Correlation API failed: {e}");
                None
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        None
    }
}

fn merge_dimensions(
    existing: &mut HashMap<String, String>,
    new: &HashMap<String, String>,
    incident_id: &str,
) -> bool {
    let initial_count = existing.len();
    for (key, new_value) in new {
        use std::collections::hash_map::Entry;
        match existing.entry(key.clone()) {
            Entry::Vacant(e) => {
                e.insert(new_value.clone());
            }
            Entry::Occupied(e) if e.get() != new_value => {
                log::warn!(
                    "[incidents] Dimension conflict in incident {}: {}='{}' vs '{}' - keeping existing",
                    incident_id,
                    key,
                    new_value,
                    e.get()
                );
            }
            _ => {}
        }
    }
    existing.len() > initial_count
}

fn spawn_topology_enrichment(
    org_id: &str,
    incident_id: &str,
    service_name: &str,
    alert_id: &str,
    alert_name: &str,
    triggered_at: i64,
) {
    let (org_id, incident_id, service_name, alert_id, alert_name) = (
        org_id.to_string(),
        incident_id.to_string(),
        service_name.to_string(),
        alert_id.to_string(),
        alert_name.to_string(),
    );

    tokio::spawn(async move {
        if let Err(e) = enrich_with_topology(
            &org_id,
            &incident_id,
            &service_name,
            &alert_id,
            &alert_name,
            triggered_at,
        )
        .await
        {
            log::debug!("[incidents] Topology enrichment failed for {incident_id}: {e}");
        }
    });
}

/// Runs the incident-created workflows; an error must not block the incident flow.
async fn trigger_created_workflows(org_id: &str, incident_id: &str) {
    if let Err(e) =
        crate::incidents::send_incident_event_trigger(org_id, incident_id, IncidentEvent::created())
            .await
    {
        log::error!(
            "error triggering workflow for incident created for {org_id} incident id {incident_id} : {e}"
        );
    }
}

/// Clears a downtime mute; `true` only for the compare-and-set winner, so "opened" goes once.
async fn unmute_for_firing(
    org_id: &str,
    incident: &infra::table::entity::alert_incidents::Model,
    muted_by: Option<&str>,
) -> bool {
    let downtime_id = match mute_change(muted_by, incident.muted_by_downtime_id.as_deref()) {
        MuteChange::Keep => return false,
        MuteChange::Retarget { from, to } => {
            retarget_mute(org_id, &incident.id, from, to).await;
            return false;
        }
        MuteChange::Unmute(downtime_id) => downtime_id,
    };
    match infra::table::alert_incidents::clear_muted_by_downtime_id(
        org_id,
        &incident.id,
        downtime_id,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => return false,
        Err(e) => {
            log::error!(
                "[incidents] could not un-mute incident {}: {e}",
                incident.id
            );
            return false;
        }
    }
    #[cfg(feature = "enterprise")]
    if db::downtimes::replicates()
        && let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::incidents_unmute(org_id, &incident.id)
                .await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish incident unmute: {e}");
    }
    log::info!(
        "[incidents] Incident {} un-muted by a firing after downtime {downtime_id}",
        incident.id
    );
    true
}

/// A firing outside every window un-mutes; one muted by another downtime moves the mute to it.
fn mute_change<'a>(muted_by: Option<&'a str>, recorded: Option<&'a str>) -> MuteChange<'a> {
    match (muted_by, recorded) {
        (None, Some(recorded)) => MuteChange::Unmute(recorded),
        (Some(current), Some(recorded)) if current != recorded => MuteChange::Retarget {
            from: recorded,
            to: current,
        },
        _ => MuteChange::Keep,
    }
}

/// Joins first, so a failed join leaves the mute for the next firing to clear and reopen.
async fn join_then_unmute<T>(
    join: impl std::future::Future<Output = Result<T, infra::errors::Error>>,
    unmute: impl AsyncFnOnce() -> bool,
) -> Result<(T, bool), infra::errors::Error> {
    let joined = join.await?;
    Ok((joined, unmute().await))
}

/// The chip and the resolved comment name the downtime that mutes the incident now.
async fn retarget_mute(org_id: &str, incident_id: &str, from: &str, to: &str) {
    match infra::table::alert_incidents::retarget_muted_by_downtime_id(
        org_id,
        incident_id,
        from,
        to,
    )
    .await
    {
        Ok(true) => log::info!(
            "[incidents] Incident {incident_id} now muted by downtime {to} instead of {from}"
        ),
        Ok(false) => {}
        Err(e) => log::error!("[incidents] could not re-mute incident {incident_id} by {to}: {e}"),
    }
}

/// An un-muted incident runs as a fresh one; its analysis starts in the correlation caller.
async fn reopened_after_mute(
    org_id: &str,
    incident_id: String,
    service_name: &str,
) -> IncidentCorrelationOutcome {
    trigger_created_workflows(org_id, &incident_id).await;
    IncidentCorrelationOutcome::NewIncidentCreated {
        incident_id,
        service_name: service_name.to_string(),
    }
}

/// The un-mute already won, so a failed severity raise is logged and the "opened" page still goes.
async fn escalate_then_reopen(
    org_id: &str,
    incident_id: &str,
    escalate: impl std::future::Future<Output = Result<bool, anyhow::Error>>,
    reopen: impl std::future::Future<Output = IncidentCorrelationOutcome>,
) -> IncidentCorrelationOutcome {
    if let Err(e) = escalate.await {
        log::error!(
            "[incidents] severity of reopened incident {org_id}/{incident_id} not raised: {e}"
        );
    }
    reopen.await
}

/// Create a brand new incident and set up its initial state.
#[allow(clippy::too_many_arguments)]
async fn create_new_incident(
    org_id: &str,
    group_values: &HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
    subject: &CorrelationSubject<'_>,
    triggered_at: i64,
    correlation_reason: &str,
    service_name: &str,
    eval_level: Option<config::meta::alerts::level::AlertLevel>,
    muted_by: Option<&str>,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    // Pre-mapped severity from the subject (external events) wins; otherwise
    // T-8's evaluated level maps to incident severity — Critical opens a P2,
    // Warning a P3. Without either (manual trigger, single-level alert) the
    // enterprise default stands.
    let severity = match (subject.severity, eval_level) {
        (Some(s), _) => s.to_string(),
        (None, Some(config::meta::alerts::level::AlertLevel::Critical)) => "P2".to_string(),
        (None, Some(config::meta::alerts::level::AlertLevel::Warning)) => "P3".to_string(),
        (None, _) => {
            o2_enterprise::enterprise::alerts::incidents::determine_severity(None).to_string()
        }
    };

    // Rendered once here, so later firings that join the incident never retitle it.
    let custom_title = match subject
        .title_inputs
        .as_ref()
        .filter(|i| i.alert.incident_title_template.is_some())
    {
        Some(inputs) => super::incident_title::render(
            inputs,
            &org_display_name(org_id).await,
            group_values,
            triggered_at,
        ),
        None => None,
    };
    let title = match custom_title.or_else(|| subject.case_title.clone()) {
        Some(title) => title,
        None => {
            // The stored title names the service by display; `group_values` keep the key.
            crate::service_identity::display_feed::ensure(org_id).await;
            let identities = crate::service_identity::display_feed::identities(org_id).await;
            o2_enterprise::enterprise::alerts::incidents::generate_title(
                &subject.name,
                &crate::service_identity::display_feed::title_dimensions(
                    org_id,
                    group_values,
                    &identities,
                ),
            )
        }
    };

    subject.fence_at(FenceStep::Open).await?;
    let incident = if subject.security_case {
        let dims = serde_json::to_value(group_values)?;
        let key = key_type.to_string();
        infra::table::alert_incidents::create_security_case(
            org_id,
            &severity,
            dims,
            &key,
            subject
                .case_activity
                .unwrap_or(infra::table::alert_incidents::CaseActivity {
                    first_event_at: triggered_at,
                    last_event_at: triggered_at,
                    historical: subject.historical,
                }),
            Some(title.clone()),
            muted_by.map(str::to_string),
        )
        .await?
    } else {
        // One transaction with its first firing: an incident without it no later lookup could find.
        let opening = infra::table::alert_incidents::create_with_first_alert(
            subject.incident_id.as_deref(),
            org_id,
            &severity,
            serde_json::to_value(group_values)?,
            &key_type.to_string(),
            triggered_at,
            Some(title.clone()),
            muted_by.map(str::to_string),
            &infra::table::alert_incidents::FirstAlert {
                alert_id: &subject.id,
                alert_name: &subject.name,
                alert_kind: subject.kind.as_str(),
                correlation_reason,
            },
        )
        .await?;
        match opening {
            infra::table::alert_incidents::Opening::Opened(incident) => *incident,
            infra::table::alert_incidents::Opening::Held(incident_id) => {
                return Ok(IncidentCorrelationOutcome::ExistingAlertRepeated {
                    incident_id,
                    service_name: service_name.to_string(),
                });
            }
            infra::table::alert_incidents::Opening::IdTaken => {
                let incident_id = subject
                    .incident_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("a generated incident id was already taken"))?;
                return join_taken_incident(
                    org_id,
                    incident_id,
                    subject,
                    triggered_at,
                    correlation_reason,
                    service_name,
                    muted_by,
                )
                .await;
            }
        }
    };

    // Initialize event timeline for new incident
    if let Err(e) = infra::table::incident_events::init(org_id, &incident.id).await {
        log::error!(
            "[Incidents] Failed to init events for incident {org_id}/{}: {e}",
            incident.id
        );
    }

    if muted_by.is_none() {
        trigger_created_workflows(org_id, &incident.id).await;
    }

    if subject.security_case {
        link_firing(&incident.id, subject, triggered_at, correlation_reason).await?;
    }

    // Record alert event
    if let Err(e) = infra::table::incident_events::record_alert(
        org_id,
        &incident.id,
        &subject.id,
        &subject.name,
        triggered_at,
    )
    .await
    {
        log::error!(
            "[Incidents] Failed to record alert event for incident {org_id}/{}: {e}",
            incident.id
        );
    }

    log::info!(
        "[incidents] Created new incident {} for alert '{}' (key_type: {:?}, severity: {})",
        incident.id,
        subject.name,
        key_type,
        severity
    );

    // Report incident creation to the usage stream
    usage_reporting::report_request_usage_stats(
        config::meta::self_reporting::usage::RequestStats {
            records: 1,
            request_body: Some(serde_json::json!({"incident_id": incident.id}).to_string()),
            ..Default::default()
        },
        org_id,
        "",
        config::meta::stream::StreamType::Metadata,
        config::meta::self_reporting::usage::UsageType::NewIncident,
        0,
        triggered_at,
    )
    .await;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::incidents_create_with_mute(
            org_id,
            &key_type.to_string(),
            &severity,
            serde_json::to_value(group_values)?,
            triggered_at,
            Some(title),
            // Without replication the other region never gets the un-mute, so it gets no mute.
            muted_by
                .filter(|_| db::downtimes::replicates())
                .map(str::to_string),
        )
        .await
    {
        log::error!(
            "[SUPER_CLUSTER] Failed to publish incident create: org_id: {org_id}, error: {e}"
        );
    }

    spawn_topology_enrichment(
        org_id,
        &incident.id,
        service_name,
        &subject.id,
        &subject.name,
        triggered_at,
    );

    // The analysis starts after on-call routing, in the correlation caller.

    Ok(IncidentCorrelationOutcome::NewIncidentCreated {
        incident_id: incident.id,
        service_name: service_name.to_string(),
    })
}

/// Another creator took this id first and did the creation work; the firing joins it as it is.
async fn join_taken_incident(
    org_id: &str,
    incident_id: &str,
    subject: &CorrelationSubject<'_>,
    triggered_at: i64,
    correlation_reason: &str,
    service_name: &str,
    muted_by: Option<&str>,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    let joined = |incident_id: String| IncidentCorrelationOutcome::ExistingAlertRepeated {
        incident_id,
        service_name: service_name.to_string(),
    };
    let alert = infra::table::alert_incidents::FirstAlert {
        alert_id: &subject.id,
        alert_name: &subject.name,
        alert_kind: subject.kind.as_str(),
        correlation_reason,
    };
    if let infra::table::alert_incidents::Joining::Held(holder) =
        infra::table::alert_incidents::add_firing_once(org_id, incident_id, &alert, triggered_at)
            .await?
    {
        return Ok(joined(holder));
    }
    let incident = infra::table::alert_incidents::get_rw(org_id, incident_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("incident {org_id}/{incident_id} is gone"))?;
    if let Err(e) = infra::table::incident_events::record_alert(
        org_id,
        incident_id,
        &subject.id,
        &subject.name,
        triggered_at,
    )
    .await
    {
        log::error!(
            "[Incidents] Failed to record alert event for incident {org_id}/{incident_id}: {e}"
        );
    }
    if muted_by.is_none()
        && incident.status != "resolved"
        && let Err(e) = crate::incidents::send_incident_event_trigger(
            org_id,
            incident_id,
            IncidentEvent::alert(&subject.id, &subject.name, triggered_at),
        )
        .await
    {
        log::error!(
            "error triggering workflow for alert added for {org_id} incident id {incident_id} : {e}"
        );
    }
    Ok(joined(incident_id.to_string()))
}

/// Joins the open incident an alert id matched; a finding's firing goes in once, under its locks.
async fn join_alert_id_incident(
    org_id: &str,
    incident: &infra::table::entity::alert_incidents::Model,
    subject: &CorrelationSubject<'_>,
    triggered_at: i64,
    correlation_reason: &str,
    muted_by: Option<&str>,
) -> Result<AlertIdJoin, anyhow::Error> {
    if !subject.places_once() {
        let (new_alert_type, reopened) = join_then_unmute(
            link_firing(&incident.id, subject, triggered_at, correlation_reason),
            async || unmute_for_firing(org_id, incident, muted_by).await,
        )
        .await?;
        return Ok(AlertIdJoin::Joined {
            new_alert_type,
            reopened,
        });
    }
    subject.fence_at(FenceStep::Join).await?;
    let alert = infra::table::alert_incidents::FirstAlert {
        alert_id: &subject.id,
        alert_name: &subject.name,
        alert_kind: subject.kind.as_str(),
        correlation_reason,
    };
    match infra::table::alert_incidents::add_firing_once(org_id, &incident.id, &alert, triggered_at)
        .await?
    {
        infra::table::alert_incidents::Joining::Held(holder) => Ok(AlertIdJoin::HeldBy(holder)),
        infra::table::alert_incidents::Joining::Joined { new_alert_type } => {
            Ok(AlertIdJoin::Joined {
                new_alert_type,
                reopened: unmute_for_firing(org_id, incident, muted_by).await,
            })
        }
    }
}

/// A repeat at a more urgent level raises the severity; the alert's own priority beats the level.
async fn escalate_severity(
    org_id: &str,
    incident: &infra::table::entity::alert_incidents::Model,
    subject: &CorrelationSubject<'_>,
    eval_level: Option<config::meta::alerts::level::AlertLevel>,
) -> Result<bool, anyhow::Error> {
    let Some((current_severity, new_severity)) =
        escalated_severity(&incident.severity, subject.severity, eval_level)
    else {
        return Ok(false);
    };
    infra::table::alert_incidents::update_severity(org_id, &incident.id, &new_severity.to_string())
        .await?;
    if let Err(e) = infra::table::incident_events::append(
        org_id,
        &incident.id,
        IncidentEvent::severity_upgrade(
            current_severity,
            new_severity,
            format!("alert '{}' escalated to {}", subject.name, new_severity),
        ),
    )
    .await
    {
        log::error!(
            "[Incidents] Failed to record severity-upgrade event for incident {org_id}/{}: {e}",
            incident.id
        );
    }
    log::info!(
        "[Incidents] Incident {} escalated {current_severity} -> {new_severity} by alert '{}'",
        incident.id,
        subject.name
    );
    Ok(true)
}

/// The current and the raised severity when the firing's level is more urgent than the incident.
fn escalated_severity(
    current: &str,
    subject_severity: Option<config::meta::alerts::incidents::IncidentSeverity>,
    eval_level: Option<config::meta::alerts::level::AlertLevel>,
) -> Option<(
    config::meta::alerts::incidents::IncidentSeverity,
    config::meta::alerts::incidents::IncidentSeverity,
)> {
    use config::meta::alerts::incidents::IncidentSeverity;
    let level_severity = subject_severity.or_else(|| {
        eval_level.and_then(|l| match l {
            config::meta::alerts::level::AlertLevel::Critical => Some(IncidentSeverity::P2),
            config::meta::alerts::level::AlertLevel::Warning => Some(IncidentSeverity::P3),
            _ => None,
        })
    });
    // P1 is most urgent; higher urgency = escalation.
    let urgency = |s: IncidentSeverity| match s {
        IncidentSeverity::P1 => 4u8,
        IncidentSeverity::P2 => 3,
        IncidentSeverity::P3 => 2,
        IncidentSeverity::P4 => 1,
    };
    let new_severity = level_severity?;
    let current_severity = current.parse::<IncidentSeverity>().ok()?;
    (urgency(new_severity) > urgency(current_severity)).then_some((current_severity, new_severity))
}

/// A suppressed firing, or one that joins a still-muted incident, starts no workflow and no page.
fn firing_is_muted(
    muted_by: Option<&str>,
    incident: &infra::table::entity::alert_incidents::Model,
    reopened: bool,
) -> bool {
    muted_by.is_some() || (incident.muted_by_downtime_id.is_some() && !reopened)
}

/// What correlation did; `created` tells a true creation from an un-mute, which keeps a stored L0
/// decision.
struct Correlation {
    outcome: IncidentCorrelationOutcome,
    #[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
    created: bool,
}

impl Correlation {
    /// An incident that already existed, un-muted or not.
    fn existing(outcome: IncidentCorrelationOutcome) -> Self {
        Self {
            outcome,
            created: false,
        }
    }
}

fn candidate_can_join(stored: &serde_json::Value, incoming: &HashMap<String, String>) -> bool {
    use config::meta::alerts::incidents::DimensionRelationship;

    let dimensions = serde_json::from_value(stored.clone()).unwrap_or_default();
    matches!(
        DimensionRelationship::check(&dimensions, incoming),
        DimensionRelationship::Equal
            | DimensionRelationship::NewIsSubset
            | DimensionRelationship::NewIsSuperset
    )
}

async fn select_correlation_candidate<C: sea_orm::ConnectionTrait>(
    client: &C,
    org_id: &str,
    incoming: &HashMap<String, String>,
    candidates: Vec<infra::table::alert_incidents::CorrelationCandidate>,
) -> Result<Option<infra::table::entity::alert_incidents::Model>, infra::errors::Error> {
    for candidate in candidates {
        if !candidate_can_join(&candidate.group_values, incoming) {
            continue;
        }
        let Some(incident) =
            infra::table::alert_incidents::get_with(client, org_id, &candidate.id).await?
        else {
            continue;
        };
        if incident.status != "resolved" && candidate_can_join(&incident.group_values, incoming) {
            return Ok(Some(incident));
        }
    }
    Ok(None)
}

/// What joining the open incident an alert id matched did.
enum AlertIdJoin {
    /// Linked; `new_alert_type` when the alert had no firing there before, `reopened` when the
    /// firing cleared a downtime mute.
    Joined {
        new_alert_type: bool,
        reopened: bool,
    },
    /// A finding's firing another write already placed, in this incident.
    HeldBy(String),
}

/// What [resolve_firing] did with one recovered firing.
#[derive(Debug, Default)]
struct FiringResolve {
    /// The link's cross-region publish failed, so another region still holds it open.
    unpublished: bool,
    incident: IncidentAfter,
}

/// The incident after one of its firings recovered.
#[derive(Debug, Default)]
enum IncidentAfter {
    /// Missing, or kept open for another firing or a human.
    #[default]
    Kept,
    /// Resolved before this call; with what its follow-up steps did when the caller repairs.
    AlreadyResolved(Option<Repairs>),
    /// Resolved by this call.
    Resolved(Repairs),
}

/// What a status change's follow-up steps did; a re-sent Resolve runs a failed one again.
#[derive(Debug, Default, PartialEq, Eq)]
struct Repairs {
    oncall: OncallRecovery,
    /// The other follow-up steps that failed.
    failed: Vec<&'static str>,
}

impl Repairs {
    /// The steps a re-sent Resolve would still have to do.
    fn unfinished(&self) -> Vec<&'static str> {
        let oncall = (self.oncall == OncallRecovery::Failed).then_some("on-call recovery");
        oncall
            .into_iter()
            .chain(self.failed.iter().copied())
            .collect()
    }
}

/// The on-call recovery a status change ran or skipped.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum OncallRecovery {
    /// Not a resolve.
    #[default]
    None,
    Muted,
    /// On-call is off or unlicensed.
    Off,
    Ran,
    Failed,
}

/// [resolve_alert_firing]'s rules for any firing; a finding's `onset` keeps its later firings open.
async fn resolve_firing(
    org_id: &str,
    incident_id: &str,
    alert_id: &str,
    recovered_at: i64,
    muted: bool,
    onset: Option<i64>,
    turns: &dyn IncidentTurns,
) -> Result<FiringResolve, anyhow::Error> {
    // A retried recovery must not close a firing that started after the onset it is about.
    let (id, at) = (incident_id, recovered_at);
    infra::table::alert_incidents::resolve_firings_fired_by(id, alert_id, onset, at).await?;
    let mut done = FiringResolve::default();

    // Published even when no row here changed: the receiver's replica may still be behind.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::incidents_resolve_alert(
            org_id,
            incident_id,
            alert_id,
            recovered_at,
            onset,
        )
        .await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish incident resolve_alert: {e}");
        done.unpublished = true;
    }

    if fired_by_detection(org_id, incident_id).await? {
        return Ok(done);
    }

    // The follow-up steps run inside the turn, so a reopen cannot land before or between them.
    let turn = turns.take(org_id, incident_id).await?;
    let fence = turn.fence.as_ref();
    let repair = onset.is_some();
    let settled = settle_resolution(org_id, incident_id, muted, repair, fence).await;
    turn.end().await;
    done.incident = settled?;
    Ok(done)
}

/// A detection's incident is an analyst's to close, even one opened before cases were marked.
async fn fired_by_detection(org_id: &str, incident_id: &str) -> Result<bool, anyhow::Error> {
    let links = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;
    Ok(db::alerts::alert::any_siem_alert(org_id, links.iter().map(|l| l.alert_id.as_str())).await)
}

/// Resolves a recovered incident and runs its follow-up steps; `repair` re-runs them if resolved.
async fn settle_resolution(
    org_id: &str,
    incident_id: &str,
    muted: bool,
    repair: bool,
    fence: &dyn TurnFence,
) -> Result<IncidentAfter, anyhow::Error> {
    use infra::table::alert_incidents::AutomaticResolution;

    Ok(
        match infra::table::alert_incidents::resolve_if_recovered(org_id, incident_id).await? {
            AutomaticResolution::Kept => IncidentAfter::Kept,
            AutomaticResolution::AlreadyResolved(_) if !repair => {
                IncidentAfter::AlreadyResolved(None)
            }
            // A cut-short attempt may have committed the status but not its follow-up steps.
            AutomaticResolution::AlreadyResolved(snapshot) => {
                let user = SYSTEM_USER_EMAIL;
                let resent =
                    finish_status_change(org_id, incident_id, user, false, *snapshot, fence);
                IncidentAfter::AlreadyResolved(Some(resent.await?.1))
            }
            AutomaticResolution::Resolved { before, after } => {
                let muted_before = before.muted_by_downtime_id.is_some()
                    && o2_enterprise::enterprise::common::config::get_config()
                        .downtimes
                        .enabled;
                let quiet = muted || muted_before;
                let user = SYSTEM_USER_EMAIL;
                let finished =
                    finish_status_change(org_id, incident_id, user, quiet, *after, fence);
                IncidentAfter::Resolved(finished.await?.1)
            }
        },
    )
}

/// [resolve_finding_firing] with what the resolve's follow-up steps did, when it reached them.
#[cfg(feature = "enterprise")]
async fn recover_finding_firing(
    org_id: &str,
    subject_id: &str,
    triggered_at: i64,
    recovered_at: i64,
    turns: &dyn IncidentTurns,
) -> Result<(bool, Option<Repairs>), anyhow::Error> {
    let held =
        infra::table::alert_incidents::find_incident_with_firing(org_id, subject_id, triggered_at)
            .await?;
    let Some(incident) = held else {
        return Ok((false, None));
    };
    let (id, at) = (&incident.id, recovered_at);
    let onset = Some(triggered_at);
    let done = resolve_firing(org_id, id, subject_id, at, false, onset, turns).await?;
    let (resolved, mut repairs) = match done.incident {
        IncidentAfter::Kept => (false, None),
        IncidentAfter::Resolved(r) => (true, Some(r)),
        IncidentAfter::AlreadyResolved(r) => (false, r),
    };
    if done.unpublished {
        repairs.get_or_insert_default().failed.push("link publish");
    }
    Ok((resolved, repairs))
}

/// Ok only when nothing is left for a retry, so the engine tells a recovery once it is whole.
#[cfg(feature = "enterprise")]
fn finished(resolved: bool, repairs: Option<&Repairs>) -> Result<bool, anyhow::Error> {
    let unfinished = repairs.map(Repairs::unfinished).unwrap_or_default();
    if !unfinished.is_empty() {
        anyhow::bail!("recovery left unfinished: {}", unfinished.join(", "));
    }
    Ok(resolved)
}

/// [open_finding_incident] with its seams; attempts at one finding take turns across the cluster.
#[cfg(feature = "enterprise")]
async fn open_finding_incident_with(
    f: &FindingIncident,
    pager: &dyn FindingPager,
    turns: &dyn FindingTurns,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    // A detached attempt outlives its act and claim, so a retry on another node can overlap it.
    let turn = turns.take(&f.org_id, &finding_turn_key(f)).await?;
    let outcome = settle_finding(f, pager, &turn).await;
    turn.end().await;
    outcome
}

/// Opens or joins the firing's incident, then pages it and decides its analysis.
#[cfg(feature = "enterprise")]
async fn settle_finding(
    f: &FindingIncident,
    pager: &dyn FindingPager,
    turn: &FindingTurn,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    // By the firing itself, on the primary: a resolved or re-keyed incident still holds it.
    let held = infra::table::alert_incidents::find_incident_with_firing(
        &f.org_id,
        &f.subject_id,
        f.triggered_at,
    )
    .await?;
    let outcome = match held {
        Some(incident) => IncidentCorrelationOutcome::ExistingAlertRepeated {
            incident_id: incident.id,
            service_name: UNKNOWN_SERVICE.to_string(),
        },
        None => {
            turn.held("correlating")?;
            correlate_finding(f, turn).await?
        }
    };
    if f.cohort {
        retitle_cohort(&f.org_id, outcome.incident_id()).await;
    }
    finish_finding_incident(f, outcome.incident_id(), pager, turn).await?;
    Ok(outcome)
}

/// Joins a cohort incident inside R6's bounds or opens one; a non-cohort finding rejoins its own.
#[cfg(feature = "enterprise")]
async fn correlate_finding(
    f: &FindingIncident,
    turn: &FindingTurn,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    use config::meta::alerts::incidents::{CorrelationReason, IncidentSeverity, KeyType};

    let reason = CorrelationReason::AlertId.to_string();
    let mut subject = CorrelationSubject {
        id: f.subject_id.clone(),
        name: f.title.clone(),
        org_id: f.org_id.clone(),
        kind: AlertKind::AutoObserve,
        base_destinations: Vec::new(),
        severity: Some(IncidentSeverity::P2),
        title_inputs: None,
        case_title: None,
        siem_case_window: None,
        security_case: false,
        historical: false,
        case_activity: None,
        case_entity: None,
        incident_id: None,
        fence: Some(turn.fence.clone()),
    };
    if !f.cohort {
        // Before the open-incident lookup: creators that saw the same incidents name the same id.
        let known =
            infra::table::alert_incidents::incident_ids_for_alert(&f.org_id, &f.subject_id).await?;
        subject.incident_id = Some(finding_incident_id(f, &known));
        let Correlation { outcome, .. } = find_or_create_incident(
            &f.org_id,
            &f.dimensions,
            KeyType::AlertId,
            &subject,
            f.triggered_at,
            &reason,
            UNKNOWN_SERVICE,
            None,
            None,
        )
        .await?;
        return Ok(outcome);
    }
    // No AlertId lookup: a member's own open incident takes it back only inside the bounds.
    subject.fence_at(FenceStep::Lookup).await?;
    let cohort = cohort_of(f, config::utils::time::now_micros()).await?;
    subject.incident_id = cohort.next_id;
    if let Some(incident) = cohort.open {
        return join_cohort(f, &incident, &subject).await;
    }
    create_new_incident(
        &f.org_id,
        &f.dimensions,
        KeyType::AlertId,
        &subject,
        f.triggered_at,
        &reason,
        UNKNOWN_SERVICE,
        None,
        None,
    )
    .await
}

/// Pages an incident never paged and decides an analysis never decided; a resolved one rests.
#[cfg(feature = "enterprise")]
async fn finish_finding_incident(
    f: &FindingIncident,
    incident_id: &str,
    pager: &dyn FindingPager,
    turn: &FindingTurn,
) -> Result<(), anyhow::Error> {
    let incident = infra::table::alert_incidents::get_rw(&f.org_id, incident_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("incident {}/{incident_id} is gone", f.org_id))?;
    if incident.status == "resolved" {
        return Ok(());
    }
    let record = match pager.record(&f.org_id, incident_id).await? {
        Some(record) => {
            if record.incident_id.is_none() {
                turn.held("linking the on-call record")?;
                pager.attach(&f.org_id, &record.id, incident_id).await?;
            }
            Some(record)
        }
        None => {
            turn.held("paging")?;
            let routed = pager
                .route(&f.org_id, incident_id, &f.page_title, &f.streams)
                .await;
            if let Some(e) = routed.error {
                return Err(e);
            }
            routed.record
        }
    };
    if incident.rca_run_id.is_some() || incident.rca_off_reason.is_some() {
        return Ok(());
    }
    turn.held("deciding the analysis")?;
    if let Some(reason) = start_new_incident_rca(&f.org_id, incident_id, record.as_ref()).await? {
        infra::table::alert_incidents::set_rca_off_reason(&f.org_id, incident_id, Some(reason))
            .await?;
    }
    Ok(())
}

/// The finding's next incident id: a digest of org, finding and the incidents it already has.
#[cfg(feature = "enterprise")]
fn finding_incident_id(f: &FindingIncident, known: &[String]) -> String {
    use sha2::{Digest, Sha256};
    use svix_ksuid::KsuidLike;

    // No onset in it: every onset that saw the same incidents names the same id under the PK.
    let digest = Sha256::digest(format!(
        "{}\n{}\n{}",
        f.org_id,
        f.subject_id,
        known.join("\n")
    ));
    let mut bytes = [0u8; 20];
    bytes.copy_from_slice(&digest[..20]);
    svix_ksuid::Ksuid::from_bytes(bytes).to_string()
}

/// A cohort's next id: org, kind, scope and the newest incident of that kind and scope.
#[cfg(feature = "enterprise")]
fn cohort_incident_id(f: &FindingIncident, latest: Option<&str>) -> String {
    use sha2::{Digest, Sha256};
    use svix_ksuid::KsuidLike;

    // No onset and no stream in it: two members racing past the lookup name one id under the PK.
    let kind = f
        .dimensions
        .get(FINDING_KIND_DIMENSION)
        .map_or("", String::as_str);
    let digest = Sha256::digest(format!(
        "{}\ncohort\n{kind}\n{}\n{}",
        f.org_id,
        f.scope.as_deref().unwrap_or(""),
        latest.unwrap_or("")
    ));
    let mut bytes = [0u8; 20];
    bytes.copy_from_slice(&digest[..20]);
    svix_ksuid::Ksuid::from_bytes(bytes).to_string()
}

/// One cluster turn per org and finding kind for cohort findings, so members never race to open.
#[cfg(feature = "enterprise")]
fn finding_turn_key(f: &FindingIncident) -> String {
    match (f.cohort, f.dimensions.get(FINDING_KIND_DIMENSION)) {
        (true, Some(kind)) => format!("cohort:{kind}"),
        _ => f.subject_id.clone(),
    }
}

#[cfg(feature = "enterprise")]
struct CohortLookup {
    open: Option<infra::table::entity::alert_incidents::Model>,
    next_id: Option<String>,
}

/// R6: the open incident of the finding's kind and scope whose last member arrived within the gap.
#[cfg(feature = "enterprise")]
async fn cohort_of(f: &FindingIncident, now: i64) -> Result<CohortLookup, anyhow::Error> {
    use o2_enterprise::enterprise::autoobserve::{
        page_routing::{catalogue, stream_service},
        plugins::stream::{PAGE_COHORT_GAP_US, PAGE_COHORT_MAX_AGE_US},
    };

    let kind = AlertKind::AutoObserve.as_str();
    let records = catalogue(&f.org_id).await;
    let same = |i: &infra::table::entity::alert_incidents::Model| {
        let dim = |k: &str| i.group_values.get(k).and_then(|v| v.as_str());
        let (Some(t), Some(n)) = (
            dim(FINDING_STREAM_TYPE_DIMENSION),
            dim(FINDING_STREAM_NAME_DIMENSION),
        ) else {
            return false;
        };
        dim(FINDING_KIND_DIMENSION) == f.dimensions.get(FINDING_KIND_DIMENSION).map(String::as_str)
            && stream_service(&records, t, n) == f.scope
    };
    let newest =
        infra::table::alert_incidents::newest_with_alert_kind(&f.org_id, kind, COHORT_IDS_SCANNED)
            .await?;
    let latest = newest.iter().find(|i| same(i)).map(|i| i.id.clone());
    // Named before the open lookup, so a sibling created in between is joined, never skipped.
    let next_id = free_cohort_id(f, latest).await?;
    let open: Vec<_> = infra::table::alert_incidents::open_with_alert_kind_since(
        &f.org_id,
        kind,
        now - PAGE_COHORT_MAX_AGE_US,
    )
    .await?
    .into_iter()
    .filter(|i| same(i))
    .collect();
    let ids: Vec<String> = open.iter().map(|i| i.id.clone()).collect();
    let linked = infra::table::alert_incidents::last_linked_at(&ids, kind).await?;
    let open = open
        .into_iter()
        .filter_map(|i| linked.get(&i.id).map(|at| (*at, i)))
        .filter(|(at, _)| now - at <= PAGE_COHORT_GAP_US)
        .max_by(|(a, x), (b, y)| a.cmp(b).then_with(|| y.id.cmp(&x.id)))
        .map(|(_, i)| i);
    Ok(CohortLookup { open, next_id })
}

/// The cohort chain's first unused id, else a generated one: a taken id would join that incident.
#[cfg(feature = "enterprise")]
async fn free_cohort_id(
    f: &FindingIncident,
    latest: Option<String>,
) -> Result<Option<String>, anyhow::Error> {
    let mut id = cohort_incident_id(f, latest.as_deref());
    for _ in 0..COHORT_IDS_SCANNED {
        if infra::table::alert_incidents::get_rw(&f.org_id, &id)
            .await?
            .is_none()
        {
            return Ok(Some(id));
        }
        id = cohort_incident_id(f, Some(&id));
    }
    Ok(None)
}

/// Joins a cohort's open incident under the firing's locks; its page and analysis already ran.
#[cfg(feature = "enterprise")]
async fn join_cohort(
    f: &FindingIncident,
    incident: &infra::table::entity::alert_incidents::Model,
    subject: &CorrelationSubject<'_>,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    let reason = config::meta::alerts::incidents::CorrelationReason::AlertId.to_string();
    let joined =
        join_alert_id_incident(&f.org_id, incident, subject, f.triggered_at, &reason, None).await?;
    let incident_id = match joined {
        AlertIdJoin::HeldBy(holder) => holder,
        AlertIdJoin::Joined { .. } => {
            if let Err(e) = infra::table::incident_events::record_alert(
                &f.org_id,
                &incident.id,
                &f.subject_id,
                &f.title,
                f.triggered_at,
            )
            .await
            {
                log::error!(
                    "[Incidents] Failed to record alert event for incident {}/{}: {e}",
                    f.org_id,
                    incident.id
                );
            }
            incident.id.clone()
        }
    };
    Ok(IncidentCorrelationOutcome::ExistingAlertRepeated {
        incident_id,
        service_name: UNKNOWN_SERVICE.to_string(),
    })
}

/// A cohort's title counts its member streams; a failure only logs, the title is not the page.
#[cfg(feature = "enterprise")]
async fn retitle_cohort(org_id: &str, incident_id: &str) {
    let read = async {
        let incident = infra::table::alert_incidents::get_rw(org_id, incident_id).await?;
        let links = infra::table::alert_incidents::get_incident_alerts_rw(incident_id).await?;
        Ok::<_, infra::errors::Error>(incident.map(|i| (i, links)))
    };
    let (incident, links) = match read.await {
        Ok(Some(found)) => found,
        Ok(None) => return,
        Err(e) => {
            log::warn!("[incidents] reading cohort {org_id}/{incident_id} to retitle: {e}");
            return;
        }
    };
    let Some(title) = cohort_title_of(&incident, &links) else {
        return;
    };
    if incident.title.as_deref() == Some(title.as_str()) {
        return;
    }
    if let Err(e) = infra::table::alert_incidents::update_title(org_id, incident_id, &title).await {
        log::warn!("[incidents] retitling cohort {org_id}/{incident_id}: {e}");
    }
}

/// None for a lone member, whose title is already its own page title.
#[cfg(feature = "enterprise")]
fn cohort_title_of(
    incident: &infra::table::entity::alert_incidents::Model,
    links: &[infra::table::entity::alert_incident_alerts::Model],
) -> Option<String> {
    let members: std::collections::BTreeSet<&str> = links
        .iter()
        .filter(|l| l.alert_kind == AlertKind::AutoObserve.as_str())
        .map(|l| l.alert_id.as_str())
        .collect();
    if members.len() < 2 {
        return None;
    }
    let dim = |k: &str| incident.group_values.get(k).and_then(|v| v.as_str());
    Some(
        o2_enterprise::enterprise::autoobserve::plugins::stream::cohort_title(
            dim(FINDING_KIND_DIMENSION)?,
            dim(FINDING_STREAM_TYPE_DIMENSION)?,
            dim(FINDING_STREAM_NAME_DIMENSION)?,
            members.len(),
        ),
    )
}

/// The turn an incident's status changes wait on; one incident always maps to one lock.
fn incident_turn(incident_id: &str) -> &'static std::sync::Arc<tokio::sync::Mutex<()>> {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    incident_id.hash(&mut hasher);
    let turn = usize::try_from(hasher.finish() % INCIDENT_TURNS as u64).unwrap_or_default();
    &INCIDENT_TURN_LOCKS[turn]
}

/// The turn a finding's incident work waits on, so a detached attempt and its retry never overlap.
#[cfg(feature = "enterprise")]
fn finding_turn(subject_id: &str) -> &'static std::sync::Arc<tokio::sync::Mutex<()>> {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    subject_id.hash(&mut hasher);
    let turn = usize::try_from(hasher.finish() % FINDING_TURNS as u64).unwrap_or_default();
    &FINDING_TURN_LOCKS[turn]
}

/// One cluster lock per finding in an org, so every onset of it waits on the same turn.
#[cfg(feature = "enterprise")]
fn finding_lock_key(org_id: &str, subject_id: &str) -> String {
    format!("/autoobserve/finding/{org_id}/{subject_id}")
}

/// A muted firing never sends, and an acknowledged incident already has a person on it.
fn reopen_can_send(
    incident: &infra::table::entity::alert_incidents::Model,
    muted_by: Option<&str>,
) -> bool {
    muted_by.is_none()
        && incident.muted_by_downtime_id.is_none()
        && incident.status != "acknowledged"
}

/// Find an existing open incident or create a new one
#[allow(clippy::too_many_arguments)]
async fn find_or_create_incident(
    org_id: &str,
    group_values: &HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
    subject: &CorrelationSubject<'_>,
    triggered_at: i64,
    correlation_reason: &str,
    service_name: &str,
    eval_level: Option<config::meta::alerts::level::AlertLevel>,
    muted_by: Option<&str>,
) -> Result<Correlation, anyhow::Error> {
    use config::meta::alerts::incidents::{DimensionRelationship, KeyType};

    // STEP 1: AlertId exact match, or a security case for the same entity within its window
    if key_type == KeyType::AlertId {
        subject.fence_at(FenceStep::Lookup).await?;
    }
    let span = subject
        .case_activity
        .map_or((triggered_at, triggered_at), |a| {
            (a.first_event_at, a.last_event_at)
        });
    let exact = match (key_type, subject.siem_case_window) {
        (KeyType::AlertId, Some(window)) => {
            find_open_detection_case(org_id, &subject.id, span, window).await?
        }
        (KeyType::AlertId, None) => {
            infra::table::alert_incidents::find_open_incident_by_alert_id(org_id, &subject.id)
                .await?
        }
        (_, Some(window)) => find_open_siem_case(org_id, group_values, span, window).await?,
        _ => None,
    };
    {
        if let Some(incident) = exact {
            let alert_id = subject.id.clone();
            let (is_new_alert_type, reopened) = match join_alert_id_incident(
                org_id,
                &incident,
                subject,
                triggered_at,
                correlation_reason,
                muted_by,
            )
            .await?
            {
                AlertIdJoin::Joined {
                    new_alert_type,
                    reopened,
                } => (new_alert_type, reopened),
                AlertIdJoin::HeldBy(incident_id) => {
                    return Ok(Correlation::existing(
                        IncidentCorrelationOutcome::ExistingAlertRepeated {
                            incident_id,
                            service_name: service_name.to_string(),
                        },
                    ));
                }
            };
            if is_new_alert_type && let Some(entity) = subject.case_entity.as_ref() {
                retitle_growing_case(org_id, &incident, entity).await;
            }

            // The write decides under its row lock, so two firings cannot both take the reopen.
            let after_reopen = match infra::table::incident_events::record_alert(
                org_id,
                &incident.id,
                &alert_id,
                &subject.name,
                triggered_at,
            )
            .await
            {
                Ok(waited) => waited && reopen_can_send(&incident, muted_by),
                Err(e) => {
                    log::error!(
                        "[Incidents] Failed to record alert event for incident {org_id}/{}: {e}",
                        incident.id
                    );
                    false
                }
            };

            if muted_by.is_none()
                && !reopened
                && let Err(e) = crate::incidents::send_incident_event_trigger(
                    org_id,
                    &incident.id,
                    IncidentEvent::alert(&alert_id, &subject.name, triggered_at),
                )
                .await
            {
                log::error!(
                    "error triggering workflow for alert added for {org_id} incident id {} : {e}",
                    incident.id
                );
            }

            spawn_topology_enrichment(
                org_id,
                &incident.id,
                service_name,
                &alert_id,
                &subject.name,
                triggered_at,
            );
            if reopened {
                // Recomputed from the un-muting firing, so "opened" carries the right level.
                return Ok(Correlation::existing(
                    escalate_then_reopen(
                        org_id,
                        &incident.id,
                        escalate_severity(org_id, &incident, subject, eval_level),
                        reopened_after_mute(org_id, incident.id.clone(), service_name),
                    )
                    .await,
                ));
            }

            // A muted firing must not raise the severity silently; the un-muting firing does it.
            if !firing_is_muted(muted_by, &incident, reopened)
                && escalate_severity(org_id, &incident, subject, eval_level).await?
            {
                return Ok(Correlation::existing(
                    IncidentCorrelationOutcome::SeverityEscalated {
                        incident_id: incident.id,
                        service_name: service_name.to_string(),
                    },
                ));
            }

            if is_new_alert_type {
                return Ok(Correlation::existing(
                    IncidentCorrelationOutcome::NewAlertTypeJoined {
                        incident_id: incident.id,
                        service_name: service_name.to_string(),
                    },
                ));
            }
            return Ok(Correlation::existing(IncidentCorrelationOutcome::repeated(
                incident.id,
                service_name.to_string(),
                after_reopen,
            )));
        }
    }

    // STEP 2: Venn diagram match against open incidents (for Primary/Secondary key types)
    //
    // Equal or NewIsSubset → join incident; NewIsSuperset → upgrade and join.
    // PartialOverlap or Incompatible → skip (create new incident).
    if key_type != KeyType::AlertId && subject.siem_case_window.is_none() {
        let candidates = infra::table::alert_incidents::find_correlation_candidates(org_id).await?;
        if let Some(existing) = select_correlation_candidate(
            infra::db::get_orm_client_ro().await,
            org_id,
            group_values,
            candidates,
        )
        .await?
        {
            let existing_key_type = KeyType::from_stored(&existing.key_type);

            let existing_dims: HashMap<String, String> =
                serde_json::from_value(existing.group_values.clone()).unwrap_or_default();

            let relationship = DimensionRelationship::check(&existing_dims, group_values);

            let mut merged_dims = existing_dims.clone();
            let dimensions_changed = merge_dimensions(&mut merged_dims, group_values, &existing.id);

            let (is_new_alert_type, reopened) = join_then_unmute(
                infra::table::alert_incidents::add_alert_to_incident(
                    &existing.id,
                    &subject.id,
                    &subject.name,
                    subject.kind.as_str(),
                    triggered_at,
                    correlation_reason,
                ),
                async || unmute_for_firing(org_id, &existing, muted_by).await,
            )
            .await?;

            // The write decides under its row lock, so two firings cannot both take the reopen.
            let after_reopen = match infra::table::incident_events::record_alert(
                org_id,
                &existing.id,
                &subject.id,
                &subject.name,
                triggered_at,
            )
            .await
            {
                Ok(waited) => waited && reopen_can_send(&existing, muted_by),
                Err(e) => {
                    log::error!(
                        "[Incidents] Failed to record alert event for incident {org_id}/{}: {e}",
                        existing.id
                    );
                    false
                }
            };

            if !is_new_alert_type
                && muted_by.is_none()
                && !reopened
                && let Err(e) = crate::incidents::send_incident_event_trigger(
                    org_id,
                    &existing.id,
                    IncidentEvent::alert(&subject.id, &subject.name, triggered_at),
                )
                .await
            {
                log::error!(
                    "error triggering workflow for incident created for {org_id} incident id {} : {e}",
                    existing.id
                );
            }

            let updated = infra::table::alert_incidents::get(org_id, &existing.id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Incident not found"))?;

            if matches!(relationship, DimensionRelationship::NewIsSuperset)
                && existing_key_type.can_upgrade_to(key_type)
            {
                // Upgrade group_values AND key_type
                let old_key_type_str = existing.key_type.clone();
                let new_key_type_str = key_type.to_string();
                infra::table::alert_incidents::upgrade_incident_group_values(
                    org_id,
                    &existing.id,
                    serde_json::to_value(&merged_dims)?,
                    &new_key_type_str,
                    updated.alert_count,
                    updated.last_alert_at,
                )
                .await?;

                if let Err(e) = append_event_unless_muted(
                    org_id,
                    &existing.id,
                    config::meta::alerts::incidents::IncidentEvent::dimensions_upgraded(
                        old_key_type_str,
                        new_key_type_str,
                    ),
                    firing_is_muted(muted_by, &existing, reopened),
                )
                .await
                {
                    log::error!(
                        "[Incidents] Failed to record dimensions upgrade event: org_id: {org_id}, error: {e}"
                    );
                }
            } else if dimensions_changed {
                infra::table::alert_incidents::update_incident_metadata(
                    org_id,
                    &existing.id,
                    updated.alert_count,
                    updated.last_alert_at,
                    Some(serde_json::to_value(&merged_dims)?),
                    None,
                )
                .await?;
            }

            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
                && !config::get_config().common.local_mode
                && let Err(e) =
                    o2_enterprise::enterprise::super_cluster::queue::incidents_add_alert(
                        org_id,
                        &existing.id,
                        &subject.id,
                        &subject.name,
                        triggered_at,
                        correlation_reason,
                    )
                    .await
            {
                log::error!(
                    "[SUPER_CLUSTER] Failed to publish incident add_alert: org_id: {org_id}, error: {e}"
                );
            }

            spawn_topology_enrichment(
                org_id,
                &existing.id,
                service_name,
                &subject.id,
                &subject.name,
                triggered_at,
            );
            if reopened {
                return Ok(Correlation::existing(
                    escalate_then_reopen(
                        org_id,
                        &existing.id,
                        escalate_severity(org_id, &existing, subject, eval_level),
                        reopened_after_mute(org_id, existing.id.clone(), service_name),
                    )
                    .await,
                ));
            }

            if is_new_alert_type {
                // A new alert type changes the picture: a fresh automatic run.
                #[cfg(feature = "enterprise")]
                if muted_by.is_none() {
                    start_automatic_rca(
                        org_id,
                        &existing.id,
                        config::meta::alerts::rca_runs::RunTrigger::AutoNewAlertType,
                    )
                    .await;
                }
                return Ok(Correlation::existing(
                    IncidentCorrelationOutcome::NewAlertTypeJoined {
                        incident_id: existing.id,
                        service_name: service_name.to_string(),
                    },
                ));
            } else {
                return Ok(Correlation::existing(IncidentCorrelationOutcome::repeated(
                    existing.id,
                    service_name.to_string(),
                    after_reopen,
                )));
            }
        }
    }

    let outcome = create_new_incident(
        org_id,
        group_values,
        key_type,
        subject,
        triggered_at,
        correlation_reason,
        service_name,
        eval_level,
        muted_by,
    )
    .await?;
    let created = matches!(
        outcome,
        IncidentCorrelationOutcome::NewIncidentCreated { .. }
    );
    Ok(Correlation { outcome, created })
}

/// The detail view: the incident, its RCA runs and the alert definitions `user_id` may read.
pub async fn get_incident_with_alerts(
    org_id: &str,
    incident_id: &str,
    user_id: &str,
) -> Result<Option<IncidentWithAlerts>, anyhow::Error> {
    let mut found = incident_with_alerts(
        org_id,
        incident_id,
        true,
        |alert_id: String, folder_id: String| async move {
            can_read_alert(org_id, user_id, &alert_id, &folder_id).await
        },
    )
    .await?;
    if let Some(found) = found.as_mut() {
        crate::service_identity::display_feed::ensure(org_id).await;
        let identities = crate::service_identity::display_feed::identities(org_id).await;
        crate::service_identity::display_feed::decorate_incident(
            org_id,
            &mut found.incident,
            &identities,
        );
    }
    Ok(found)
}

/// [get_incident_with_alerts] without the RCA runs, for callers that never read them.
pub async fn get_incident_with_triggers(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<IncidentWithAlerts>, anyhow::Error> {
    incident_with_alerts(org_id, incident_id, false, |_, _| std::future::ready(true)).await
}

/// Whether `user_id` may GET the alert, checked as the `GET /v2/{org}/alerts/{id}` route checks it.
#[cfg(feature = "enterprise")]
async fn can_read_alert(org_id: &str, user_id: &str, alert_id: &str, folder_id: &str) -> bool {
    !o2_openfga::config::get_config().enabled
        || crate::auth::check_permissions(
            alert_id,
            org_id,
            user_id,
            "alerts",
            "GET",
            Some(folder_id),
            false,
            true,
            false,
        )
        .await
}

#[cfg(not(feature = "enterprise"))]
async fn can_read_alert(_org_id: &str, _user_id: &str, _alert_id: &str, _folder_id: &str) -> bool {
    true
}

/// The alerts, given as `(alert_id, folder_id, alert)`, and composites that `can_read` allows.
async fn readable_definitions<F>(
    alerts: Vec<(String, String, Alert)>,
    composites: Vec<CompositeAlertSummary>,
    can_read: impl Fn(String, String) -> F,
) -> (Vec<Alert>, Vec<CompositeAlertSummary>)
where
    F: Future<Output = bool>,
{
    let mut readable_alerts = Vec::with_capacity(alerts.len());
    for (alert_id, folder_id, alert) in alerts {
        if can_read(alert_id, folder_id).await {
            readable_alerts.push(alert);
        }
    }
    let mut readable_composites = Vec::with_capacity(composites.len());
    for composite in composites {
        if can_read(composite.id.clone(), composite.folder_id.clone()).await {
            readable_composites.push(composite);
        }
    }
    (readable_alerts, readable_composites)
}

async fn incident_with_alerts<F>(
    org_id: &str,
    incident_id: &str,
    with_rca_runs: bool,
    can_read: impl Fn(String, String) -> F,
) -> Result<Option<IncidentWithAlerts>, anyhow::Error>
where
    F: Future<Output = bool>,
{
    let incident = match infra::table::alert_incidents::get(org_id, incident_id).await? {
        Some(i) => i,
        None => return Ok(None),
    };

    let incident_alerts = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;

    // Store org_id before moving incident
    let incident_org_id = incident.org_id.clone();

    // Without the runs the detail still carries the run summary.
    let rca = if with_rca_runs {
        match super::rca_runs::rca_detail(org_id, &incident).await {
            Ok(rca) => Some(rca),
            Err(e) => {
                log::warn!("[incidents] Failed to read RCA runs for {org_id}/{incident_id}: {e}");
                None
            }
        }
    } else {
        None
    };

    // Convert to config types
    let mut incident_data = model_to_incident(incident).await?;
    if let Some(rca) = rca {
        incident_data.rca = rca;
    }

    // Fix alert_count from actual triggers (source of truth)
    // This heals any inconsistencies from race conditions or historical bugs
    let actual_count = incident_alerts.len() as i32;
    if incident_data.alert_count != actual_count {
        log::warn!(
            "[incidents] Incident {}/{} alert_count mismatch: stored={}, actual={}. Using actual count.",
            org_id,
            incident_id,
            incident_data.alert_count,
            actual_count
        );
        incident_data.alert_count = actual_count;
    }

    // Convert incident_alerts to triggers
    let mut triggers: Vec<IncidentAlert> = incident_alerts
        .iter()
        .map(|a| IncidentAlert {
            incident_id: a.incident_id.clone(),
            alert_id: a.alert_id.clone(),
            alert_name: a.alert_name.clone(),
            alert_kind: AlertKind::from_stored(&a.alert_kind),
            alert_fired_at: a.alert_fired_at,
            correlation_reason: a
                .correlation_reason
                .as_ref()
                .and_then(|r| r.parse::<CorrelationReason>().ok())
                .unwrap_or(CorrelationReason::AlertId),
            created_at: a.created_at,
            source_url: None,
            labels: None,
            annotations: None,
            detected_source: None,
        })
        .collect();

    // Enrich external-kind triggers with data from the external_alerts table.
    // Internal alerts are left untouched (their details are hydrated below via
    // the live-fetch path).
    let external_ids: Vec<String> = triggers
        .iter()
        .filter(|t| t.alert_kind == AlertKind::External)
        .map(|t| t.alert_id.clone())
        .collect();

    if !external_ids.is_empty() {
        match infra::table::external_alerts::get_by_ids(&incident_org_id, &external_ids).await {
            Ok(records) => {
                let records_by_id: std::collections::HashMap<_, _> =
                    records.into_iter().map(|r| (r.id.clone(), r)).collect();

                for trigger in triggers
                    .iter_mut()
                    .filter(|t| t.alert_kind == AlertKind::External)
                {
                    if let Some(record) = records_by_id.get(&trigger.alert_id) {
                        trigger.source_url = record.source_url.clone();
                        trigger.labels = serde_json::from_value(record.labels.clone()).ok();
                        trigger.annotations = record
                            .last_payload
                            .get("annotations")
                            .and_then(|a| serde_json::from_value(a.clone()).ok());
                        trigger.detected_source = Some(record.detected_source.clone());
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "[incidents] Failed to fetch external alert details for incident {}/{}: {}",
                    incident_org_id,
                    incident_id,
                    e
                );
            }
        }
    }

    // Get unique alert names from triggers
    let unique_alert_names: std::collections::HashSet<String> = incident_alerts
        .iter()
        .map(|a| a.alert_name.clone())
        .collect();

    // Fetch full alert details for each unique alert name
    let mut alerts = Vec::new();
    let mut composite_alerts = Vec::new();
    for alert_name in unique_alert_names {
        // We need to fetch by name, but we don't have stream_type and stream_name
        // We'll need to get these from the alert record itself
        // For now, let's try to get the alert by ID from the first matching trigger
        if let Some(trigger) = incident_alerts.iter().find(|a| a.alert_name == alert_name) {
            // Parse alert_id as Ksuid
            if let Ok(alert_ksuid) = trigger.alert_id.parse() {
                match super::alert::get_by_id(
                    infra::db::get_orm_client_ro().await,
                    &incident_org_id,
                    alert_ksuid,
                )
                .await
                {
                    Ok((folder, alert)) => {
                        alerts.push((trigger.alert_id.clone(), folder.folder_id, alert))
                    }
                    Err(e) => {
                        // Not an ordinary alert — a composite has no `alerts`
                        // row, so fall back to the composite graph (§9.6).
                        match super::composite::get_composite(&incident_org_id, &trigger.alert_id)
                            .await
                        {
                            Ok(Some(composite)) => {
                                composite_alerts.push(CompositeAlertSummary {
                                    id: composite.definition.id,
                                    name: composite.definition.name,
                                    alert_type: "composite".to_string(),
                                    enabled: composite.definition.enabled,
                                    folder_id: composite.definition.folder_id,
                                });
                            }
                            Ok(None) => {
                                log::warn!(
                                    "Failed to fetch alert details for {}/{}: {}",
                                    incident_org_id,
                                    trigger.alert_id,
                                    e
                                );
                            }
                            Err(composite_error) => {
                                log::warn!(
                                    "Failed to fetch composite details for {}/{}: {}",
                                    incident_org_id,
                                    trigger.alert_id,
                                    composite_error
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    let (alerts, composite_alerts) = readable_definitions(alerts, composite_alerts, can_read).await;

    Ok(Some(IncidentWithAlerts {
        incident: incident_data,
        triggers,
        alerts,
        composite_alerts,
    }))
}

/// List incidents for an organization
pub async fn list_incidents(
    org_id: &str,
    status: Option<&str>,
    limit: u64,
    offset: u64,
) -> Result<(Vec<Incident>, u64), anyhow::Error> {
    list_incidents_filtered(
        org_id,
        status,
        infra::table::alert_incidents::CaseFilter::All,
        limit,
        offset,
    )
    .await
}

/// List incidents, keeping only the security cases `cases` allows.
pub async fn list_incidents_filtered(
    org_id: &str,
    status: Option<&str>,
    cases: infra::table::alert_incidents::CaseFilter,
    limit: u64,
    offset: u64,
) -> Result<(Vec<Incident>, u64), anyhow::Error> {
    // Get total count before pagination
    let total = infra::table::alert_incidents::count_filtered(org_id, status, cases).await?;

    let incidents =
        infra::table::alert_incidents::list_filtered(org_id, status, cases, limit, offset).await?;

    // Get actual alert counts from junction table (source of truth)
    let incident_ids: Vec<String> = incidents.iter().map(|i| i.id.clone()).collect();
    let mut actual_counts = infra::table::alert_incidents::get_alert_counts(&incident_ids).await?;

    let incidents_list: Vec<Incident> = incidents
        .into_iter()
        .map(|i| {
            let counts = actual_counts.remove(&i.id);
            let mut incident = model_to_incident_with_topology(i, None);
            let Some(counts) = counts else {
                incident.alert_groups = Some(Vec::new());
                return incident;
            };

            // Fix alert_count from actual triggers (self-healing for corrupted data)
            if incident.alert_count != counts.total {
                log::debug!(
                    "[incidents] List: Incident {} alert_count mismatch: stored={}, actual={}",
                    incident.id,
                    incident.alert_count,
                    counts.total
                );
                incident.alert_count = counts.total;
            }
            incident.alert_groups = Some(counts.groups);

            incident
        })
        .collect::<Vec<_>>();

    crate::service_identity::display_feed::ensure(org_id).await;
    let identities = crate::service_identity::display_feed::identities(org_id).await;
    let mut incidents_list = incidents_list;
    for incident in &mut incidents_list {
        crate::service_identity::display_feed::decorate_incident(org_id, incident, &identities);
    }
    Ok((incidents_list, total))
}

/// Enrich incident with alert flow graph
///
/// Called asynchronously when an alert is added to an incident.
/// Builds a graph showing how alerts cascade across services over time.
pub async fn enrich_with_topology(
    org_id: &str,
    incident_id: &str,
    service_name: &str,
    alert_id: &str,
    alert_name: &str,
    alert_fired_at: i64,
) -> Result<(), anyhow::Error> {
    use AlertEdge;
    use AlertNode;
    use EdgeType;

    // Get current topology or create new
    let mut topology = infra::table::alert_incidents::get_topology(org_id, incident_id)
        .await?
        .unwrap_or_default();

    // Find or create node for this (service, alert) pair
    let node_index = topology
        .nodes
        .iter()
        .position(|n| n.service_name == service_name && n.alert_id == alert_id);

    let (current_node_index, is_new_node) = if let Some(idx) = node_index {
        // Update existing node
        let node = &mut topology.nodes[idx];
        node.alert_count += 1;
        node.last_fired_at = node.last_fired_at.max(alert_fired_at);
        log::debug!(
            "[incidents] Updated node for alert {} in incident {}: count={}, last_fired={}",
            alert_id,
            incident_id,
            node.alert_count,
            node.last_fired_at
        );
        (idx, false)
    } else {
        // Create new node
        let new_node = AlertNode {
            alert_id: alert_id.to_string(),
            alert_name: alert_name.to_string(),
            service_name: service_name.to_string(),
            alert_count: 1,
            first_fired_at: alert_fired_at,
            last_fired_at: alert_fired_at,
            display_name: None,
        };
        topology.nodes.push(new_node);
        let idx = topology.nodes.len() - 1;
        log::debug!(
            "[incidents] Created new node for alert {} in incident {}: service={}, fired_at={}",
            alert_id,
            incident_id,
            service_name,
            alert_fired_at
        );
        (idx, true)
    };

    // Build exactly one edge for each NEW node: connect to its immediate predecessor in the
    // global timeline. This guarantees the graph is a minimal DAG (no transitive edges).
    if is_new_node {
        let current_node_first_fired = topology.nodes[current_node_index].first_fired_at;

        // Find the single immediate predecessor across ALL nodes (any service)
        // Use node index as tiebreaker when timestamps are equal (handles simultaneous alerts)
        let predecessor_idx = topology
            .nodes
            .iter()
            .enumerate()
            .filter(|(idx, node)| {
                *idx != current_node_index
                    && (node.first_fired_at < current_node_first_fired
                        || (node.first_fired_at == current_node_first_fired
                            && *idx < current_node_index))
            })
            .max_by_key(|(idx, node)| (node.first_fired_at, *idx))
            .map(|(idx, _)| idx);

        if let Some(prev_idx) = predecessor_idx {
            let is_same_service = topology.nodes[prev_idx].service_name
                == topology.nodes[current_node_index].service_name;

            // Determine edge type: ServiceDependency if service graph confirms the
            // relationship, otherwise Temporal
            let edge_type = if is_same_service {
                EdgeType::Temporal
            } else {
                dependency_edge_type(
                    org_id,
                    &topology.nodes[prev_idx].service_name,
                    &topology.nodes[current_node_index].service_name,
                    alert_fired_at,
                )
                .await
            };

            topology.edges.push(AlertEdge {
                from_node_index: prev_idx,
                to_node_index: current_node_index,
                edge_type,
            });
            log::debug!(
                "[incidents] Added {edge_type:?} edge: {prev_idx} ({}) -> {current_node_index} ({})",
                topology.nodes[prev_idx].service_name,
                topology.nodes[current_node_index].service_name
            );
        }
    }

    // Update incident with enriched topology
    infra::table::alert_incidents::update_topology(org_id, incident_id, &topology).await?;

    log::info!(
        "[incidents] Enriched incident {} with {} nodes, {} edges",
        incident_id,
        topology.nodes.len(),
        topology.edges.len()
    );

    Ok(())
}

/// Whether the service graph saw `from -> to` near `at`; an unquotable name is no dependency.
async fn dependency_edge_type(org_id: &str, from: &str, to: &str, at: i64) -> EdgeType {
    use crate::traces::service_graph::v4::read::{
        edge_type_from, instant, q_edge_exists, scalar_sum,
    };

    let Ok(forward) = q_edge_exists(from, to, INCIDENT_EDGE_RANGE_SECS) else {
        return EdgeType::Temporal;
    };
    match instant(org_id, &forward, at).await {
        Ok(rows) => edge_type_from(scalar_sum(&rows)),
        Err(e) => {
            log::debug!("[incidents] Service graph query failed: {e}, defaulting to temporal edge");
            EdgeType::Temporal
        }
    }
}

/// Whether the deployment can run an analysis at all.
#[cfg(feature = "enterprise")]
pub async fn rca_will_run(org_id: &str, incident_id: &str) -> bool {
    let off = rca_not_run_reason();
    if off.is_some() {
        o2_enterprise::enterprise::alerts::rca_service::skip_analysis_for_incident(
            org_id,
            incident_id,
        )
        .await;
    }
    off.is_none()
}

/// Why the deployment cannot run an analysis, or `None` when it can.
#[cfg(feature = "enterprise")]
pub fn rca_not_run_reason() -> Option<&'static str> {
    let cfg = o2_enterprise::enterprise::common::config::get_config();
    rca_off_reason_for(
        incidents_enabled() && cfg.incidents.rca_enabled,
        rca_agent_available(),
    )
}

/// The pure half of [rca_not_run_reason].
pub fn rca_off_reason_for(analysis_on: bool, agent_available: bool) -> Option<&'static str> {
    if !analysis_on {
        Some(RCA_OFF_DISABLED)
    } else if !agent_available {
        Some(RCA_OFF_AI_UNAVAILABLE)
    } else {
        None
    }
}

/// The user that automatic runs act and are metered as.
#[cfg(feature = "enterprise")]
const SYSTEM_USER_EMAIL: &str = "system@openobserve.ai";

/// The one start path of automatic runs; returns why none started, `None` when one did or runs.
#[cfg(feature = "enterprise")]
async fn start_automatic_rca(
    org_id: &str,
    incident_id: &str,
    trigger: config::meta::alerts::rca_runs::RunTrigger,
) -> Option<&'static str> {
    use config::meta::alerts::rca_runs::{RunMode, RunTrigger};
    use o2_enterprise::enterprise::alerts::rca_service;

    use super::rca_runs::{RunSubject, StartOutcome, StartRun};

    if !rca_will_run(org_id, incident_id).await {
        return rca_not_run_reason();
    }
    match infra::table::alert_incidents::get(org_id, incident_id).await {
        Ok(Some(incident)) if incident.rca_off_reason.is_some() => {
            log::debug!(
                "[INCIDENTS::RCA] Automatic analysis is off for {incident_id}, skipping {}",
                trigger.as_str()
            );
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            // Already recorded, so there is nothing new to say.
            return None;
        }
        Ok(_) => {}
        Err(e) => {
            log::error!("[INCIDENTS::RCA] Could not read incident {org_id}/{incident_id}: {e}");
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            return Some(RCA_OFF_START_FAILED);
        }
    }

    // A refusal starts nothing and charges nothing; the meter runs after the start.
    #[cfg(feature = "cloud")]
    let usage_feature = if trigger == RunTrigger::AutoNewIncident {
        crate::trial_quota::TrialQuotaFeature::NewIncident
    } else {
        crate::trial_quota::TrialQuotaFeature::IncidentReAnalysis
    };
    #[cfg(feature = "cloud")]
    if let Err(error) =
        crate::trial_quota::precheck_ai_usage(org_id, usage_feature, SYSTEM_USER_EMAIL).await
    {
        log::info!(
            "[INCIDENTS::RCA] Incident {incident_id} retained without {} analysis: {error}",
            trigger.as_str()
        );
        // No verdict is coming, so nothing may go on holding a page for one.
        rca_service::skip_analysis_for_incident(org_id, incident_id).await;
        return Some(RCA_OFF_QUOTA);
    }

    let outcome = super::rca_runs::start_run(StartRun {
        org_id: org_id.to_string(),
        subject: RunSubject::Incident(incident_id.to_string()),
        trigger,
        mode: RunMode::Fresh,
        started_by: "system".to_string(),
        guidance: None,
        skip_cooldown: trigger == RunTrigger::AutoNewIncident,
        oncall_subjects: None,
        context_used: None,
    })
    .await;
    let run_id = match outcome {
        Ok(StartOutcome::Started { run_id }) => run_id,
        Ok(StartOutcome::InFlight) => {
            log::debug!(
                "[INCIDENTS::RCA] Analysis already in-flight for {incident_id}, skipping {} trigger",
                trigger.as_str()
            );
            return None;
        }
        Ok(StartOutcome::CoolingDown) => {
            log::debug!(
                "[INCIDENTS::RCA] Cooldown not elapsed for {incident_id}, skipping {} trigger",
                trigger.as_str()
            );
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            return Some(RCA_OFF_COOLING_DOWN);
        }
        Err(e) => {
            log::error!("[INCIDENTS::RCA] Could not start a run for {org_id}/{incident_id}: {e}");
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            return Some(RCA_OFF_START_FAILED);
        }
    };

    // The turn's finalizer ends the run; this task only starts it.
    let org_id_rca = org_id.to_string();
    let incident_id_rca = incident_id.to_string();
    tokio::spawn(async move {
        // Every failure has already ended the run and released the hold.
        if let Err(e) = trigger_rca_for_incident(
            org_id_rca,
            incident_id_rca.clone(),
            run_id.clone(),
            RcaLaunch {
                trigger,
                user_email: SYSTEM_USER_EMAIL.to_string(),
                // Automatic runs stand on their own.
                build_on_previous: false,
                // Metered inside, right before the turn starts.
                usage_permit: None,
                // Automatic runs carry no guidance.
                guidance: None,
                // Automatic runs start fresh.
                resume: None,
            },
        )
        .await
        {
            log::debug!(
                "[INCIDENTS::RCA] {} run {run_id} for {incident_id_rca} did not start: {}",
                trigger.as_str(),
                e.error_code()
            );
        }
    });
    None
}

/// Pages a new incident's on-call record and blast radius; the record decides L0.
#[cfg(feature = "enterprise")]
async fn route_new_incident(
    org_id: &str,
    incident_id: &str,
    title: &str,
    priority: config::meta::alerts::priority::AlertPriority,
    team: Option<&str>,
    dimensions: &HashMap<String, String>,
) -> RoutedIncident {
    let started = o2_enterprise::enterprise::oncall::escalation::start_for_incident(
        org_id,
        incident_id,
        title,
        priority,
        team,
        dimensions,
    )
    .await;
    routed_from(org_id, incident_id, dimensions, started).await
}

/// Links the record a start opened and pages its blast radius; a failed start is the error.
#[cfg(feature = "enterprise")]
async fn routed_from(
    org_id: &str,
    incident_id: &str,
    dimensions: &HashMap<String, String>,
    started: anyhow::Result<Option<config::meta::oncall::Response>>,
) -> RoutedIncident {
    let origin = match started {
        Ok(Some(origin)) => origin,
        Ok(None) => {
            return RoutedIncident {
                record: None,
                error: None,
            };
        }
        Err(e) => {
            return RoutedIncident {
                record: None,
                error: Some(e.context(format!("on-call paging failed for {org_id}/{incident_id}"))),
            };
        }
    };
    // Without this, nothing can get from an incident to the record that paged.
    let error = infra::table::oncall_responses::attach_incident(org_id, &origin.id, incident_id)
        .await
        .err()
        .map(|e| anyhow::anyhow!("could not link on-call record for {org_id}/{incident_id}: {e}"));
    // The blast radius hangs off whichever record actually paged, which here is this one.
    if let Err(e) =
        crate::alerts::scheduler::handlers::page_blast_radius(org_id, &origin, dimensions).await
    {
        log::error!("[incidents] impacted paging failed for {org_id}/{incident_id}: {e}");
    }
    RoutedIncident {
        record: Some(origin),
        error,
    }
}

/// A new incident's first analysis, decided after on-call routing; returns why none started.
#[cfg(feature = "enterprise")]
async fn start_new_incident_rca(
    org_id: &str,
    incident_id: &str,
    routed: Option<&config::meta::oncall::Response>,
) -> Result<Option<&'static str>, anyhow::Error> {
    if let Some(record) = routed
        && o2_enterprise::enterprise::alerts::rca_service::l0_off_for_record(org_id, record).await
    {
        let stored =
            infra::table::alert_incidents::set_rca_off_reason(org_id, incident_id, Some("l0_off"))
                .await;
        // No verdict is coming, so nothing may go on holding a page for one.
        o2_enterprise::enterprise::alerts::rca_service::skip_analysis_for_incident(
            org_id,
            incident_id,
        )
        .await;
        stored.map_err(|e| {
            anyhow::anyhow!("Could not record that L0 is off for {org_id}/{incident_id}: {e}")
        })?;
        return Ok(None);
    }
    Ok(start_automatic_rca(
        org_id,
        incident_id,
        config::meta::alerts::rca_runs::RunTrigger::AutoNewIncident,
    )
    .await)
}

/// An un-muted incident's analysis.
#[cfg(feature = "enterprise")]
async fn start_unmuted_incident_rca(
    org_id: &str,
    incident_id: &str,
    routed: Option<&config::meta::oncall::Response>,
) {
    // The primary: the un-mute just committed, and a replica may not show it yet.
    let undecided = match infra::table::alert_incidents::get_rw(org_id, incident_id).await {
        Ok(Some(incident)) => l0_undecided(&incident),
        Ok(None) => false,
        Err(e) => {
            log::error!("[INCIDENTS::RCA] Could not read incident {org_id}/{incident_id}: {e}");
            false
        }
    };
    if undecided {
        if let Err(e) = start_new_incident_rca(org_id, incident_id, routed).await {
            log::error!("[INCIDENTS::RCA] {e:#}");
        }
    } else {
        start_automatic_rca(
            org_id,
            incident_id,
            config::meta::alerts::rca_runs::RunTrigger::AutoNewIncident,
        )
        .await;
    }
}

/// Tells each of the incident's pages that a new alert joined, re-running a ladder that ran out.
#[cfg(feature = "enterprise")]
async fn page_again_after_new_alert(org_id: &str, incident_id: &str) {
    use config::meta::oncall::NewAlertEffect;
    use o2_enterprise::enterprise::oncall::{escalation::ENGINE_ACTOR, replicate};

    let now = config::utils::time::now_micros();
    let pages = match infra::table::oncall_responses::list_for_incident(org_id, incident_id).await {
        Ok(pages) => pages,
        Err(e) => {
            log::error!("[incidents] on-call pages of {org_id}/{incident_id}: {e}");
            return;
        }
    };
    for page in pages {
        let repaged = match page.on_new_alert(now) {
            NewAlertEffect::Nothing => continue,
            NewAlertEffect::NoteOnly => false,
            // Ok(false): acked, snoozed or re-run since the read, so this alert only gets the note.
            NewAlertEffect::PageAgain => match restart_exhausted_ladder(org_id, &page, now).await {
                Ok(repaged) => repaged,
                Err(e) => {
                    log::error!("[incidents] could not page {org_id}/{} again: {e}", page.id);
                    continue;
                }
            },
        };
        let event = page.new_alert_note(repaged, ENGINE_ACTOR, now);
        if let Err(e) = replicate::add_event(org_id, &page.id, &event).await {
            log::error!("[incidents] timeline of {org_id}/{}: {e}", page.id);
        }
    }
}

/// Re-runs an exhausted page's ladder if nobody touched it since `seen`, then re-arms its timer.
#[cfg(feature = "enterprise")]
async fn restart_exhausted_ladder(
    org_id: &str,
    seen: &config::meta::oncall::Response,
    now: i64,
) -> Result<bool, anyhow::Error> {
    use config::meta::triggers::{Trigger, TriggerModule};
    use o2_enterprise::enterprise::oncall::replicate;

    let Some(updated) =
        infra::table::oncall_responses::restart_exhausted(org_id, seen, now).await?
    else {
        return Ok(false);
    };
    // Upsert keeps the row's data; a racing tick may delete it, and the reconcile sweep re-arms it.
    infra::scheduler::arm_with(
        infra::db::get_orm_client_rw().await,
        &Trigger {
            org: org_id.to_string(),
            module: TriggerModule::OncallEscalation,
            module_key: updated.id.clone(),
            next_run_at: now,
            ..Default::default()
        },
    )
    .await?;
    replicate::response(&updated).await;
    Ok(true)
}

/// A manual run does not decide L0, so only a stored off reason skips the un-mute decision.
#[cfg(feature = "enterprise")]
fn l0_undecided(incident: &infra::table::entity::alert_incidents::Model) -> bool {
    incident.rca_off_reason.is_none()
}

/// The run's `error.reason` and `error.details` for a turn that could not start.
#[cfg(feature = "enterprise")]
pub(crate) fn rca_turn_failure(
    error: &super::rca_turn::RcaTurnError,
) -> (&'static str, Option<String>) {
    use super::{rca_runs, rca_turn::RcaTurnError};

    match error {
        RcaTurnError::TurnLimit => (TURN_LIMIT_REASON, None),
        RcaTurnError::Credentials(details) => (rca_runs::CREDENTIALS_REASON, Some(details.clone())),
        RcaTurnError::AgentUnavailable(details) => {
            (rca_runs::AGENT_UNAVAILABLE_REASON, Some(details.clone()))
        }
        RcaTurnError::Busy => (TURN_BUSY_REASON, None),
        RcaTurnError::Other(details) => (rca_runs::AGENT_ERROR_REASON, Some(details.clone())),
    }
}

/// `error.reason` of a run refused by the active-turn cap.
#[cfg(feature = "enterprise")]
const TURN_LIMIT_REASON: &str = "Too many analyses running";
/// `error.reason` of a run whose session already had a turn running.
#[cfg(feature = "enterprise")]
const TURN_BUSY_REASON: &str = "The analysis session is busy";

/// How a started run's first turn is launched.
#[cfg(feature = "enterprise")]
pub struct RcaLaunch {
    pub trigger: config::meta::alerts::rca_runs::RunTrigger,
    /// Email of the user who triggered the analysis, used for AI usage tracking.
    pub user_email: String,
    /// When true, the newest completed report is sent so the agent extends it.
    pub build_on_previous: bool,
    /// None authorizes immediately before first-turn launch.
    pub usage_permit: Option<crate::AiUsagePermit>,
    pub guidance: Option<String>,
    /// A resume uses its copied steps instead of a previous report.
    pub resume: Option<super::rca_resume::ResumeSeed>,
}

/// Return after spawning; every launch error must terminate the admitted run.
#[cfg(feature = "enterprise")]
pub async fn trigger_rca_for_incident(
    org_id: String,
    incident_id: String,
    run_id: String,
    launch: RcaLaunch,
) -> Result<(), super::rca_turn::RcaTurnError> {
    #[cfg_attr(not(feature = "cloud"), allow(unused_variables))]
    let RcaLaunch {
        trigger,
        user_email,
        build_on_previous,
        usage_permit,
        guidance,
        resume,
    } = launch;
    use config::meta::alerts::rca_runs::RunMode;
    use o2_enterprise::enterprise::{
        alerts::rca_service, common::config::get_config as get_o2_config,
    };

    use super::{
        rca_runs::{
            AGENT_NOT_CONFIGURED_REASON, ERROR_AGENT_NOT_CONFIGURED, ERROR_L0_OFF,
            ERROR_RCA_DISABLED, ERROR_RESUME_FAILED, L0_OFF_REASON, RCA_DISABLED_REASON,
            RESUME_FAILED_REASON, RunSubject, fail_run, newest_completed_report,
        },
        rca_turn::{
            RcaPrompt, RcaPromptSubject, RcaTurnError, RcaTurnRun, start_forked_rca_turn,
            start_rca_turn,
        },
    };

    // Ends the run as failed and releases any triage hold: no verdict is coming.
    let has_guidance = guidance.is_some();
    let end_failed = async |code: &str, reason: &str, details: Option<String>| {
        if let Err(e) = fail_run(&org_id, &run_id, trigger, code, reason, details).await {
            log::error!("[INCIDENTS::RCA] Could not end run {run_id} as failed: {e}");
        }
        // The guidance no turn read ends `not_read`.
        if has_guidance {
            super::rca_steering::close_unread(
                &org_id,
                &run_id,
                config::meta::alerts::rca_runs::RunState::Failed,
            )
            .await;
        }
        rca_service::skip_analysis_for_incident(&org_id, &incident_id).await;
    };
    let end_turn_failed = async |e: RcaTurnError| {
        let (reason, details) = rca_turn_failure(&e);
        log::warn!(
            "[INCIDENTS::RCA] Run {run_id} for {org_id}/{incident_id} could not start its turn: {}",
            e.error_code()
        );
        end_failed(e.error_code(), reason, details).await;
        Err(e)
    };

    let config = get_o2_config();

    if !incidents_enabled() || !config.incidents.rca_enabled {
        log::debug!("[INCIDENTS::RCA] RCA not enabled, ending run {run_id}");
        end_failed(ERROR_RCA_DISABLED, RCA_DISABLED_REASON, None).await;
        return Ok(());
    }

    if !config.ai.has_agent_target() {
        log::debug!("[INCIDENTS::RCA] RCA agent URL not set, ending run {run_id}");
        end_failed(
            ERROR_AGENT_NOT_CONFIGURED,
            AGENT_NOT_CONFIGURED_REASON,
            None,
        )
        .await;
        return Ok(());
    }

    // The run must be refused before the billable turn.
    if !trigger.is_user_started() && rca_service::l0_off_for_incident(&org_id, &incident_id).await {
        log::debug!("[INCIDENTS::RCA] L0 is off for {incident_id}'s priority, ending run {run_id}");
        end_failed(ERROR_L0_OFF, L0_OFF_REASON, None).await;
        return Ok(());
    }

    // The primary, since the run just started.
    let incident = match infra::table::alert_incidents::get_rw(&org_id, &incident_id).await {
        Ok(Some(incident)) => incident,
        Ok(None) => {
            return end_turn_failed(RcaTurnError::Other(format!(
                "incident {incident_id} not found"
            )))
            .await;
        }
        Err(e) => return end_turn_failed(RcaTurnError::Other(format!("{e:#}"))).await,
    };

    log::info!(
        "[INCIDENTS::RCA] Running RCA {run_id} for incident {incident_id} (trigger={})",
        trigger.as_str()
    );

    let previous_analysis = if build_on_previous && resume.is_none() {
        newest_completed_report(&org_id, &incident_id)
            .await
            .unwrap_or_else(|e| {
                log::warn!(
                    "[INCIDENTS::RCA] Could not read the previous report of {incident_id}: {e}"
                );
                None
            })
    } else {
        None
    };
    let context =
        rca_service::build_incident_context(&org_id, &incident_id, previous_analysis).await;
    let context = rca_service::rca_context_json(&context);

    #[cfg(feature = "cloud")]
    {
        use config::meta::alerts::rca_runs::RunTrigger;

        let feature = match trigger {
            RunTrigger::AutoNewIncident | RunTrigger::Manual => {
                crate::trial_quota::TrialQuotaFeature::NewIncident
            }
            _ => crate::trial_quota::TrialQuotaFeature::IncidentReAnalysis,
        };
        let usage_permit = match usage_permit {
            Some(permit) => permit,
            None => {
                let usage_context = crate::trial_quota::AiUsageContext {
                    user_email: user_email.clone(),
                    incident_id: Some(incident_id.clone()),
                    ..Default::default()
                };
                match crate::trial_quota::authorize_ai_usage(&org_id, feature, &usage_context).await
                {
                    Ok(permit) => permit,
                    Err(error) => {
                        log::info!(
                            "[INCIDENTS::RCA] Run {run_id} for {incident_id} ended without analysis: {error}"
                        );
                        end_failed(
                            super::rca_runs::ERROR_USAGE_DENIED,
                            super::rca_runs::USAGE_DENIED_REASON,
                            Some(error.to_string()),
                        )
                        .await;
                        return Ok(());
                    }
                }
            }
        };
        debug_assert_eq!(usage_permit.feature(), feature);
    }

    let (mode, fork) = match resume {
        Some(seed) => {
            let source_run_id = seed.source_run_id.clone();
            match fork_for_resume(
                &org_id,
                &run_id,
                seed,
                crate::ai_chat::fork::fork_run_session,
            )
            .await
            {
                Ok((mode, fork)) => (mode, Some(fork)),
                Err(e) => {
                    log::warn!(
                        "[INCIDENTS::RCA] Run {run_id} could not copy the session of run \
                         {source_run_id}: {e:#}"
                    );
                    end_failed(
                        ERROR_RESUME_FAILED,
                        RESUME_FAILED_REASON,
                        Some(format!("{e:#}")),
                    )
                    .await;
                    return Ok(());
                }
            }
        }
        None if build_on_previous => (RunMode::BuildOnPrevious, None),
        None => (RunMode::Fresh, None),
    };

    // The guidance goes after the initial prompt, with its header.
    let guidance_row = if has_guidance {
        let row = super::rca_steering::queued_guidance(&org_id, &run_id).await;
        if row.is_none() {
            log::error!(
                "[INCIDENTS::RCA] Run {run_id} was started with guidance but has no guidance row"
            );
        }
        row
    } else {
        None
    };
    let run = RcaTurnRun {
        org_id: org_id.clone(),
        run_id: run_id.clone(),
        subject: RunSubject::Incident(incident_id.clone()),
        trigger,
        mode,
        context,
        session_id: None,
    };
    let started = match fork {
        Some(fork) => start_forked_rca_turn(run, fork).await,
        None => {
            let prompt = RcaPrompt::Initial {
                trigger,
                subject: RcaPromptSubject::Incident {
                    id: incident_id.clone(),
                    title: incident
                        .title
                        .clone()
                        .unwrap_or_else(|| incident_id.clone()),
                    alerts: u32::try_from(incident.alert_count).unwrap_or(0),
                    severity: incident.severity.clone(),
                },
                guidance: guidance_row.as_ref().map(super::rca_steering::render_row),
            };
            start_rca_turn(run, prompt).await
        }
    };
    match started {
        Ok(started) => {
            log::info!(
                "[INCIDENTS::RCA] Run {run_id} for {incident_id} started turn {} in session {}",
                started.turn_id,
                started.session_id
            );
            // The guidance row is delivered once the turn is admitted.
            if let Some(row) = guidance_row {
                super::rca_steering::guidance_admitted(row).await;
            }
            Ok(())
        }
        Err(e) => end_turn_failed(e).await,
    }
}

#[cfg(feature = "enterprise")]
async fn fork_for_resume<F>(
    org_id: &str,
    run_id: &str,
    seed: super::rca_resume::ResumeSeed,
    fork: F,
) -> anyhow::Result<(
    config::meta::alerts::rca_runs::RunMode,
    super::rca_turn::ForkedSession,
)>
where
    F: AsyncFnOnce(
        &str,
        &infra::table::ai_chat_sessions::Model,
        Vec<o2_enterprise::enterprise::ai::chat::batcher::DurableEvent>,
        &str,
    ) -> anyhow::Result<crate::ai_chat::fork::RunFork>,
{
    // The same lineage the route wrote on the run before the launch.
    let resumed_from = seed.resumed_from();
    let reused = crate::ai_chat::rca_thread::project_rca_thread(&seed.prefix, &[], false, false);
    let stage = reused.steps.last().and_then(|step| step.stage.clone());
    let fork = fork(
        org_id,
        &seed.source_session,
        seed.prefix,
        &seed.source_run_id,
    )
    .await?;
    log::info!(
        "[INCIDENTS::RCA] Run {run_id} resumes run {} after {} steps, on session {} (seq 0..={} \
         copied)",
        seed.source_run_id,
        seed.reused_steps,
        fork.session_id,
        fork.last_seq
    );
    let fork = super::rca_turn::ForkedSession {
        session_id: fork.session_id,
        resumed_from,
        reused: reused.stats,
        stage,
    };
    Ok((seed.mode, fork))
}

/// Convert database model to domain model
async fn model_to_incident(
    db_model: infra::table::entity::alert_incidents::Model,
) -> Result<Incident, anyhow::Error> {
    // Load topology context (including RCA analysis) from database
    let topology = infra::table::alert_incidents::get_topology(&db_model.org_id, &db_model.id)
        .await
        .ok()
        .flatten();

    Ok(model_to_incident_with_topology(db_model, topology))
}

/// The resolved incidents whose on-call record a muted resolve left open, in scan order.
fn left_open<'a>(
    resolved: &'a [String],
    records: &HashMap<String, Vec<config::meta::oncall::Response>>,
) -> Vec<&'a str> {
    resolved
        .iter()
        .filter(|id| records.get(*id).is_some_and(|held| holds_open_record(held)))
        .map(String::as_str)
        .collect()
}

/// A record still open on a resolved incident is the page a muted resolve left escalating.
fn holds_open_record(records: &[config::meta::oncall::Response]) -> bool {
    records.iter().any(|record| !record.state.is_terminal())
}

/// Only a resolve can clear a mute, and only an org with downtimes can have one.
fn reads_mute_before(status: &str, downtimes_enabled: bool) -> bool {
    downtimes_enabled && status == "resolved"
}

/// A quiet change or a muted incident pages nobody and starts no workflow.
fn status_change_is_muted(quiet: bool, muted_by_downtime_id: Option<&str>) -> bool {
    quiet || muted_by_downtime_id.is_some()
}

/// Convert database model to domain model with pre-fetched topology
/// A muted incident keeps its timeline but starts no workflow (D3).
async fn append_event_unless_muted(
    org_id: &str,
    incident_id: &str,
    event: IncidentEvent,
    muted: bool,
) -> Result<(), anyhow::Error> {
    if muted {
        infra::table::incident_events::append(org_id, incident_id, event).await?;
        return Ok(());
    }
    crate::incidents::append_event(org_id, incident_id, event).await
}

fn model_to_incident_with_topology(
    db_model: infra::table::entity::alert_incidents::Model,
    topology_context: Option<IncidentTopology>,
) -> Incident {
    // The run summary columns only; the detail view adds the runs.
    let rca = infra::table::rca_runs::summary_from_incident(
        &db_model,
        config::utils::time::now_micros(),
        o2_enterprise::enterprise::common::config::get_config()
            .incidents
            .rca_timeout_secs,
    );
    Incident {
        id: db_model.id,
        org_id: db_model.org_id,
        status: db_model.status.parse().unwrap_or_default(),
        severity: db_model.severity.parse().unwrap_or_default(),
        first_alert_at: db_model.first_alert_at,
        last_alert_at: db_model.last_alert_at,
        resolved_at: db_model.resolved_at,
        alert_count: db_model.alert_count,
        title: db_model.title,
        assigned_to: db_model.assigned_to,
        acknowledged_by: db_model.acknowledged_by,
        acknowledged_at: db_model.acknowledged_at,
        created_at: db_model.created_at,
        updated_at: db_model.updated_at,
        group_values: db_model.group_values,
        key_type: config::meta::alerts::incidents::KeyType::from_stored(&db_model.key_type),
        topology_context,
        muted_by_downtime_id: db_model.muted_by_downtime_id,
        rca,
        rca_off_reason: db_model.rca_off_reason,
        alert_groups: None,
        historical: db_model.historical,
        group_values_display: None,
    }
}

/// Clears the mute before the events, so a failed append cannot leave it muted.
async fn record_muted_auto_resolve<C: sea_orm::ConnectionTrait + sea_orm::TransactionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
    downtime_id: &str,
) -> Result<(), anyhow::Error> {
    infra::table::alert_incidents::clear_muted_by_downtime_id_with(
        conn,
        org_id,
        incident_id,
        downtime_id,
    )
    .await?;
    let resolved = IncidentEvent::resolved(None);
    infra::table::incident_events::append_with(conn, org_id, incident_id, resolved).await?;
    let name = infra::table::downtimes::get_with(conn, org_id, downtime_id)
        .await
        .ok()
        .flatten()
        .map_or_else(|| downtime_id.to_string(), |d| d.name);
    let comment = IncidentEvent::comment("system", format!("Resolved while muted by {name}"));
    infra::table::incident_events::append_with(conn, org_id, incident_id, comment).await?;
    Ok(())
}

/// The event and the super-cluster status of an ack change the one ack wrote.
/// [weak: a lost event or publish is logged; the row change stands]
pub async fn record_ack_change(
    org_id: &str,
    incident_id: &str,
    status: config::meta::alerts::incidents::IncidentStatus,
    event: IncidentEvent,
) {
    let muted = match infra::table::alert_incidents::get(org_id, incident_id).await {
        Ok(m) => m.is_some_and(|m| m.muted_by_downtime_id.is_some()),
        Err(e) => {
            log::error!("[incidents] could not read {org_id}/{incident_id} after an ack: {e}");
            false
        }
    };
    if let Err(e) = append_event_unless_muted(org_id, incident_id, event, muted).await {
        log::error!("[incidents] could not record the ack of {org_id}/{incident_id}: {e}");
    }
    publish_status(org_id, incident_id, &status.to_string()).await;
}

/// Update incident status
pub async fn update_status(
    org_id: &str,
    incident_id: &str,
    status: &str,
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    update_status_as(org_id, incident_id, status, user_id, false).await
}

/// [update_status]; `quiet` treats the incident as muted for this change only.
pub async fn update_status_as(
    org_id: &str,
    incident_id: &str,
    status: &str,
    user_id: &str,
    quiet: bool,
) -> Result<Incident, anyhow::Error> {
    Ok(
        change_status_as(org_id, incident_id, status, user_id, quiet)
            .await?
            .0,
    )
}

/// Runs the one rule when the status change is the one ack's (AK-2, D20). [strong] (reads)
pub async fn authorize_status(
    org_id: &str,
    incident_id: &str,
    status: &str,
    user_id: &str,
) -> Result<(), crate::alerts::ack::AckError> {
    use crate::alerts::ack::{self, AckError, Act, Problem};

    if !is_the_one_ack(org_id, incident_id, status)
        .await
        .map_err(|e| AckError::Internal(e.to_string()))?
    {
        return Ok(());
    }
    let problem = Problem::Incident {
        org_id: org_id.to_string(),
        incident_id: incident_id.to_string(),
    };
    ack::authorize_problem(&problem, user_id, Act::Ack)
        .await
        .map(|_| ())
}

/// Acknowledging, and reopening an acknowledged incident, are the one ack's (AK-2).
async fn is_the_one_ack(
    org_id: &str,
    incident_id: &str,
    status: &str,
) -> Result<bool, anyhow::Error> {
    Ok(match status {
        "acknowledged" => true,
        "open" => infra::table::alert_incidents::get(org_id, incident_id)
            .await?
            .is_some_and(|m| m.status == "acknowledged"),
        _ => false,
    })
}

async fn through_the_one_ack(
    org_id: &str,
    incident_id: &str,
    status: &str,
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    use crate::alerts::ack::{self, AckError, Problem};

    let problem = Problem::Incident {
        org_id: org_id.to_string(),
        incident_id: incident_id.to_string(),
    };
    let source = config::meta::alerts::ack::AckSource::Incident;
    let done = if status == "acknowledged" {
        ack::acknowledge(&problem, user_id, source)
            .await
            .map(|_| ())
    } else {
        ack::unack(&problem, user_id, source).await.map(|_| ())
    };
    match done {
        // A resolved incident has nothing to acknowledge; the answer is the incident as it stands.
        Ok(()) | Err(AckError::Conflict(_)) => {}
        Err(AckError::NotFound) => anyhow::bail!("Incident not found"),
        Err(e) => anyhow::bail!("could not change the ack of {incident_id}: {e:?}"),
    }
    let model = infra::table::alert_incidents::get(org_id, incident_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Incident not found"))?;
    model_to_incident(model).await
}

/// [update_status_as] with what its follow-up steps did.
async fn change_status_as(
    org_id: &str,
    incident_id: &str,
    status: &str,
    user_id: &str,
    quiet: bool,
) -> Result<(Incident, Repairs), anyhow::Error> {
    if is_the_one_ack(org_id, incident_id, status).await? {
        let incident = through_the_one_ack(org_id, incident_id, status, user_id).await?;
        return Ok((incident, Repairs::default()));
    }
    // A reopen waits out a resolve's follow-up steps, so none of them acts on the reopened one.
    let turn = ClusterIncidentTurns.take(org_id, incident_id).await?;
    let changed = change_status_in(org_id, incident_id, status, user_id, quiet, &turn).await;
    turn.end().await;
    changed
}

/// [change_status_as]'s write and follow-up steps, inside the incident's status turn.
async fn change_status_in(
    org_id: &str,
    incident_id: &str,
    status: &str,
    user_id: &str,
    quiet: bool,
    turn: &IncidentTurn,
) -> Result<(Incident, Repairs), anyhow::Error> {
    // Read before the resolve clears it, so resolving a muted incident still notifies nobody.
    let before = infra::table::alert_incidents::get_rw(org_id, incident_id).await?;
    let muted_before = reads_mute_before(
        status,
        o2_enterprise::enterprise::common::config::get_config()
            .downtimes
            .enabled,
    ) && before
        .as_ref()
        .is_some_and(|m| m.muted_by_downtime_id.is_some());
    // A retry must preserve the resolution timestamp used to deduplicate its event.
    let again = status == "resolved" && before.as_ref().is_some_and(|m| m.status == "resolved");
    let updated = match before {
        Some(m) if again => m,
        _ => infra::table::alert_incidents::update_status(org_id, incident_id, status).await?,
    };

    let quiet = quiet || muted_before;
    let fence = turn.fence.as_ref();
    finish_status_change(org_id, incident_id, user_id, quiet, updated, fence).await
}

async fn finish_status_change(
    org_id: &str,
    incident_id: &str,
    user_id: &str,
    quiet: bool,
    updated: infra::table::entity::alert_incidents::Model,
    fence: &dyn TurnFence,
) -> Result<(Incident, Repairs), anyhow::Error> {
    let status = updated.status.as_str();
    let muted = status_change_is_muted(quiet, updated.muted_by_downtime_id.as_deref());
    // A step in flight when the turn's lease is lost still writes only inside this episode.
    let episode = infra::table::alert_incidents::Episode::of(&updated);
    let mut repairs = Repairs::default();
    if status == "resolved" {
        repairs = resolve_follow_ups(org_id, incident_id, user_id, muted, &episode, fence).await?;
    } else if status == "open" {
        reopen_follow_ups(org_id, incident_id, user_id, muted, fence).await;
    }
    if !(turn_held(fence, FenceStep::StatusPublish).await
        && publish_episode(org_id, incident_id, &episode).await)
    {
        repairs.failed.push("status publish");
    }
    Ok((model_to_incident(updated).await?, repairs))
}

/// A resolve's follow-up steps, each only while `fence` still holds the incident's turn.
async fn resolve_follow_ups(
    org_id: &str,
    incident_id: &str,
    user_id: &str,
    muted: bool,
    episode: &infra::table::alert_incidents::Episode,
    fence: &dyn TurnFence,
) -> Result<Repairs, anyhow::Error> {
    // Every resolution path lands here, so closing the record once covers all of them.
    let oncall = if turn_held(fence, FenceStep::OncallRecovery).await {
        recover_oncall(org_id, incident_id, muted, episode).await
    } else {
        OncallRecovery::Failed
    };
    let mut repairs = Repairs {
        oncall,
        ..Repairs::default()
    };

    if !muted {
        let resolved_at = episode
            .resolved_at
            .ok_or_else(|| anyhow::anyhow!("resolved incident has no resolution timestamp"))?;
        let recorded = turn_held(fence, FenceStep::StatusEvent).await
            && infra::table::incident_events::ensure_resolved(
                org_id,
                incident_id,
                resolved_at,
                user_id,
            )
            .await
            .inspect_err(|e| log::error!("[Incidents] Failed to record resolution event: {e}"))
            .is_ok();
        if !recorded {
            repairs.failed.push("resolution event");
        }
    }

    // A resolve cancels a run that waits for an answer; a working run finishes.
    #[cfg(feature = "enterprise")]
    if !turn_held(fence, FenceStep::Analysis).await {
        repairs.failed.push("analysis stop");
    } else if let Err(e) =
        super::rca_steering::cancel_waiting_on_resolve(org_id, incident_id, user_id, episode).await
    {
        log::error!(
            "[INCIDENTS::RCA] Could not stop the paused run of {org_id}/{incident_id}: {e}"
        );
        repairs.failed.push("analysis stop");
    }
    Ok(repairs)
}

/// A reopen's follow-up steps, each only while `fence` still holds the incident's turn.
async fn reopen_follow_ups(
    org_id: &str,
    incident_id: &str,
    user_id: &str,
    muted: bool,
    fence: &dyn TurnFence,
) {
    if turn_held(fence, FenceStep::StatusEvent).await
        && let Err(e) = append_event_unless_muted(
            org_id,
            incident_id,
            IncidentEvent::manually_reopened(user_id),
            muted,
        )
        .await
    {
        log::error!("[Incidents] Failed to record status event: {e}");
    }

    // A reopened incident gets a fresh automatic run.
    #[cfg(feature = "enterprise")]
    if !muted && turn_held(fence, FenceStep::Analysis).await {
        start_automatic_rca(
            org_id,
            incident_id,
            config::meta::alerts::rca_runs::RunTrigger::AutoReopen,
        )
        .await;
    }
}

/// False, logged, once the incident's turn is lost before `step`; a retry runs it.
async fn turn_held(fence: &dyn TurnFence, step: FenceStep) -> bool {
    match fence.before(step).await {
        Ok(()) => true,
        Err(e) => {
            log::error!("[incidents] {e}");
            false
        }
    }
}

/// The on-call recovery a resolve runs; a muted one notifies nobody.
async fn recover_oncall(
    org_id: &str,
    incident_id: &str,
    muted: bool,
    episode: &infra::table::alert_incidents::Episode,
) -> OncallRecovery {
    use o2_enterprise::enterprise::oncall::escalation::recover_for_resolution;

    if muted {
        return OncallRecovery::Muted;
    }
    if !o2_enterprise::enterprise::oncall::is_enabled() {
        return OncallRecovery::Off;
    }
    match recover_for_resolution(org_id, incident_id, episode).await {
        Ok(_) => OncallRecovery::Ran,
        Err(e) => {
            log::error!("[incidents] on-call recovery failed for {org_id}/{incident_id}: {e}");
            OncallRecovery::Failed
        }
    }
}

/// [publish_status] of `episode`, sent only while the incident is still in it.
async fn publish_episode(
    org_id: &str,
    incident_id: &str,
    episode: &infra::table::alert_incidents::Episode,
) -> bool {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        || config::get_config().common.local_mode
    {
        return true;
    }
    let publish = publish_status(org_id, incident_id, &episode.status);
    publish_in_episode(org_id, incident_id, episode, publish).await
}

/// False when `publish` failed or the incident could not be held; a stale one is dropped unsent.
async fn publish_in_episode(
    org_id: &str,
    incident_id: &str,
    episode: &infra::table::alert_incidents::Episode,
    publish: impl std::future::Future<Output = bool>,
) -> bool {
    use infra::table::alert_incidents::while_in_episode;

    match while_in_episode(org_id, incident_id, episode, publish).await {
        Ok(Some(sent)) => sent,
        // The status write that ended the episode publishes its own status.
        Ok(None) => true,
        Err(e) => {
            log::error!("[incidents] could not hold {org_id}/{incident_id} to publish it: {e}");
            false
        }
    }
}

/// False when the cross-region publish failed.
async fn publish_status(org_id: &str, incident_id: &str, status: &str) -> bool {
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::incidents_update_status(
            org_id,
            incident_id,
            status,
        )
        .await
    {
        log::error!(
            "[SUPER_CLUSTER] Failed to publish incident update_status: org_id: {org_id}, error: {e}"
        );
        return false;
    }
    true
}

/// Records the resolved event of the auto-resolve job; a muted incident notifies nobody (D3).
pub async fn record_auto_resolved(
    org_id: &str,
    incident_id: &str,
    muted_by_downtime_id: Option<&str>,
) -> Result<(), anyhow::Error> {
    let Some(downtime_id) = muted_by_downtime_id else {
        return crate::incidents::append_event(org_id, incident_id, IncidentEvent::resolved(None))
            .await;
    };
    let conn = infra::db::get_orm_client_rw().await;
    record_muted_auto_resolve(conn, org_id, incident_id, downtime_id).await
}

/// Update incident title
pub async fn update_title(
    org_id: &str,
    incident_id: &str,
    title: &str,
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    let current = infra::table::alert_incidents::get(org_id, incident_id).await?;
    let from_title = current
        .as_ref()
        .and_then(|i| i.title.clone())
        .unwrap_or_default();

    let updated = infra::table::alert_incidents::update_title(org_id, incident_id, title).await?;

    if from_title != title
        && let Err(e) = crate::incidents::append_event(
            org_id,
            incident_id,
            config::meta::alerts::incidents::IncidentEvent::title_changed(
                from_title, title, user_id,
            ),
        )
        .await
    {
        log::error!(
            "[Incidents] Failed to record title change event: org_id: {org_id}, error: {e}"
        );
    }

    model_to_incident(updated).await
}

/// Sets or clears the incident's assignee and records who changed it.
pub async fn update_assignee(
    org_id: &str,
    incident_id: &str,
    assigned_to: Option<&str>,
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    let current = infra::table::alert_incidents::get_rw(org_id, incident_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Incident not found"))?;
    if current.assigned_to.as_deref() == assigned_to {
        return model_to_incident(current).await;
    }
    let updated =
        infra::table::alert_incidents::update_assigned_to(org_id, incident_id, assigned_to).await?;
    if let Err(e) = crate::incidents::append_event(
        org_id,
        incident_id,
        IncidentEvent::assignment_changed(
            current.assigned_to,
            assigned_to.map(str::to_string),
            user_id,
        ),
    )
    .await
    {
        log::error!("[Incidents] Failed to record assignment event: org_id: {org_id}, error: {e}");
    }
    model_to_incident(updated).await
}

/// A more severe attached firing raises the case's priority; the timeline records who attached.
pub async fn attach_firings_to_case(
    org_id: &str,
    case_id: Option<&str>,
    title: &str,
    severity: config::meta::alerts::incidents::IncidentSeverity,
    firings: &[o2_enterprise::enterprise::security::cases::AttachedFiring],
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    let key_type = config::meta::alerts::incidents::KeyType::AlertId.to_string();
    let (case, opened_at) = match case_id {
        Some(id) => (
            infra::table::alert_incidents::get_rw(org_id, id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Incident not found"))?,
            None,
        ),
        None => {
            let first = firings
                .iter()
                .map(|f| f.fired_at)
                .min()
                .unwrap_or_else(config::utils::time::now_micros);
            let case = infra::table::alert_incidents::create_security_case(
                org_id,
                &severity.to_string(),
                serde_json::json!({}),
                &key_type,
                infra::table::alert_incidents::CaseActivity {
                    first_event_at: first,
                    last_event_at: first,
                    historical: false,
                },
                Some(title.to_string()),
                None,
            )
            .await?;
            if let Err(e) = infra::table::incident_events::init(org_id, &case.id).await {
                log::error!(
                    "[Incidents] Failed to init events for case {org_id}/{}: {e}",
                    case.id
                );
            }
            (case, Some(first))
        }
    };
    if opened_at.is_none() {
        infra::table::alert_incidents::mark_security_case(org_id, &case.id).await?;
    }
    if let Some(first) = opened_at
        && let Err(e) = publish_case_create(org_id, &key_type, severity, first, title).await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish case create: org_id: {org_id}, error: {e}");
    }

    let linked: std::collections::HashSet<(String, i64)> =
        infra::table::alert_incidents::get_incident_alerts(&case.id)
            .await?
            .into_iter()
            .map(|l| (l.alert_id, l.alert_fired_at))
            .collect();
    let mut alert_ids = Vec::new();
    let mut alert_names = Vec::new();
    for firing in firings {
        if linked.contains(&(firing.alert_id.clone(), firing.fired_at)) {
            continue;
        }
        infra::table::alert_incidents::add_alert_to_incident(
            &case.id,
            &firing.alert_id,
            &firing.alert_name,
            AlertKind::Internal.as_str(),
            firing.fired_at,
            "manual",
        )
        .await?;
        if let Err(e) = publish_case_add_alert(org_id, &case.id, firing).await {
            log::error!(
                "[SUPER_CLUSTER] Failed to publish case add_alert: org_id: {org_id}, error: {e}"
            );
        }
        if let Err(e) = infra::table::incident_events::record_alert(
            org_id,
            &case.id,
            &firing.alert_id,
            &firing.alert_name,
            firing.fired_at,
        )
        .await
        {
            log::error!(
                "[Incidents] Failed to record alert event for case {org_id}/{}: {e}",
                case.id
            );
        }
        alert_ids.push(firing.alert_id.clone());
        alert_names.push(firing.alert_name.clone());
    }
    if !alert_ids.is_empty()
        && let Err(e) = crate::incidents::append_event(
            org_id,
            &case.id,
            IncidentEvent::alerts_attached(user_id, alert_ids, alert_names),
        )
        .await
    {
        log::error!("[Incidents] Failed to record attach event: org_id: {org_id}, error: {e}");
    }
    if let Some((from, to)) = escalated_severity(&case.severity, Some(severity), None) {
        infra::table::alert_incidents::update_severity(org_id, &case.id, &to.to_string()).await?;
        if let Err(e) = crate::incidents::append_event(
            org_id,
            &case.id,
            IncidentEvent::severity_upgrade(from, to, format!("{user_id} attached a {to} firing")),
        )
        .await
        {
            log::error!(
                "[Incidents] Failed to record severity event: org_id: {org_id}, error: {e}"
            );
        }
    }

    let case = infra::table::alert_incidents::get_rw(org_id, &case.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Incident not found"))?;
    model_to_incident(case).await
}

/// Opens a case from one event, or adds it to `case_id`; the case spans the event's time.
pub async fn attach_event_to_case(
    org_id: &str,
    case_id: Option<&str>,
    title: Option<&str>,
    event: &CaseEvent,
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    use o2_enterprise::enterprise::security::cases;
    let case = match case_id {
        Some(id) => {
            infra::table::alert_incidents::widen_case_span(org_id, id, event.at, event.at).await?;
            infra::table::alert_incidents::mark_security_case(org_id, id).await?;
            id.to_string()
        }
        None => {
            let entity = cases::entity_of(&event.fields);
            let title = title
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| cases::event_case_title(&event.stream, entity.as_ref()));
            let key_type = match entity {
                Some(_) => config::meta::alerts::incidents::KeyType::Primary,
                None => config::meta::alerts::incidents::KeyType::AlertId,
            }
            .to_string();
            let dims = serde_json::to_value(
                entity
                    .as_ref()
                    .map(cases::Entity::group_values)
                    .unwrap_or_default(),
            )?;
            let severity = config::meta::alerts::incidents::IncidentSeverity::default();
            let case = infra::table::alert_incidents::create_security_case(
                org_id,
                &severity.to_string(),
                dims,
                &key_type,
                infra::table::alert_incidents::CaseActivity {
                    first_event_at: event.at,
                    last_event_at: event.at,
                    historical: false,
                },
                Some(title.clone()),
                None,
            )
            .await?;
            if let Err(e) = infra::table::incident_events::init(org_id, &case.id).await {
                log::error!(
                    "[Incidents] Failed to init events for case {org_id}/{}: {e}",
                    case.id
                );
            }
            if let Err(e) = publish_case_create(org_id, &key_type, severity, event.at, &title).await
            {
                log::error!(
                    "[SUPER_CLUSTER] Failed to publish case create: org_id: {org_id}, error: {e}"
                );
            }
            case.id
        }
    };
    if let Err(e) = crate::incidents::append_event(
        org_id,
        &case,
        IncidentEvent::event_attached(user_id, &event.stream, event.at),
    )
    .await
    {
        log::error!("[Incidents] Failed to record event attach: org_id: {org_id}, error: {e}");
    }
    let case = infra::table::alert_incidents::get_rw(org_id, &case)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Incident not found"))?;
    model_to_incident(case).await
}

/// Whether incident writes are published to the other regions of a super-cluster.
fn replicates_incidents() -> bool {
    o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
}

/// Replicates a manually opened case, as correlation does for one a firing opens.
async fn publish_case_create(
    org_id: &str,
    key_type: &str,
    severity: config::meta::alerts::incidents::IncidentSeverity,
    first: i64,
    title: &str,
) -> Result<(), anyhow::Error> {
    if !replicates_incidents() {
        return Ok(());
    }
    o2_enterprise::enterprise::super_cluster::queue::incidents_create_with_mute(
        org_id,
        key_type,
        &severity.to_string(),
        serde_json::json!({}),
        first,
        Some(title.to_string()),
        None,
    )
    .await
}

/// Replicates one firing attached to a case by hand.
async fn publish_case_add_alert(
    org_id: &str,
    case_id: &str,
    firing: &o2_enterprise::enterprise::security::cases::AttachedFiring,
) -> Result<(), anyhow::Error> {
    if !replicates_incidents() {
        return Ok(());
    }
    o2_enterprise::enterprise::super_cluster::queue::incidents_add_alert(
        org_id,
        case_id,
        &firing.alert_id,
        &firing.alert_name,
        firing.fired_at,
        "manual",
    )
    .await
}

/// Update incident severity
pub async fn update_severity(
    org_id: &str,
    incident_id: &str,
    severity: &str,
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    // Get current severity before update
    let current = infra::table::alert_incidents::get(org_id, incident_id).await?;
    let from_severity: config::meta::alerts::incidents::IncidentSeverity = current
        .map(|i| i.severity.parse().unwrap_or_default())
        .unwrap_or_default();
    let to_severity: config::meta::alerts::incidents::IncidentSeverity =
        severity.parse().unwrap_or_default();

    let updated =
        infra::table::alert_incidents::update_severity(org_id, incident_id, severity).await?;

    // Emit severity override event and notify only when the severity actually changed
    let muted = updated.muted_by_downtime_id.is_some();
    if from_severity != to_severity {
        if let Err(e) = append_event_unless_muted(
            org_id,
            incident_id,
            config::meta::alerts::incidents::IncidentEvent::severity_override(
                from_severity,
                to_severity,
                user_id,
            ),
            muted,
        )
        .await
        {
            log::error!(
                "[Incidents] Failed to record severity event: org_id: {org_id}, error: {e}"
            );
        }
        if !muted {
            send_incident_severity_notification(org_id, incident_id).await;
        }
    }

    model_to_incident(updated).await
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    mod findings {
        use std::{
            collections::HashMap,
            sync::{
                Arc, Mutex,
                atomic::{AtomicU64, AtomicUsize, Ordering},
            },
        };

        use infra::table::entity::alert_incidents as incident_rows;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};

        use super::super::*;

        const TITLE: &str = "checkout (logs) stopped sending data";
        const ONSET: i64 = 1_793_784_600_000_000;
        const QUARTER_HOUR: i64 = 900_000_000;
        const BACK: i64 = ONSET + 4 * QUARTER_HOUR;
        /// Ample for an unblocked write to land on SQLite or a local Postgres.
        const WAIT: std::time::Duration = std::time::Duration::from_millis(500);
        const PERSON: &str = "someone@example.com";

        /// Stands in for on-call: counts pages and links, and refuses either on demand.
        #[derive(Default)]
        struct Pager {
            state: Mutex<Paged>,
            /// Record lookups wait briefly for a second one, so racing attempts both pass it.
            meet: bool,
            lookups: AtomicUsize,
            /// The first route waits inside, as a holder whose lease lapses mid-route does.
            stall: bool,
            routing: tokio::sync::Notify,
            resume: tokio::sync::Notify,
            stalls: AtomicUsize,
        }

        impl Pager {
            fn meeting() -> Self {
                Self {
                    meet: true,
                    ..Self::default()
                }
            }

            fn stalling() -> Self {
                Self {
                    stall: true,
                    ..Self::default()
                }
            }

            fn pages(&self) -> usize {
                self.state.lock().unwrap().pages
            }

            fn for_team(team_id: &str) -> Self {
                let pager = Self::default();
                pager.state.lock().unwrap().team_id = Some(team_id.to_string());
                pager
            }

            fn refusing(route: bool, attach: bool) -> Self {
                let pager = Self::default();
                {
                    let mut s = pager.state.lock().unwrap();
                    s.refuse_route = route;
                    s.refuse_attach = attach;
                }
                pager
            }

            fn heal(&self) {
                let mut s = self.state.lock().unwrap();
                s.refuse_route = false;
                s.refuse_attach = false;
            }

            fn counts(&self) -> (usize, usize) {
                let s = self.state.lock().unwrap();
                (s.routes, s.attaches)
            }

            /// The incident the only on-call record is linked to.
            fn linked_to(&self) -> Option<String> {
                let s = self.state.lock().unwrap();
                match s.records.len() {
                    1 => s
                        .records
                        .values()
                        .next()
                        .and_then(|r| r.incident_id.clone()),
                    _ => None,
                }
            }
        }

        #[async_trait::async_trait]
        impl FindingPager for Pager {
            async fn record(
                &self,
                _org_id: &str,
                incident_id: &str,
            ) -> anyhow::Result<Option<config::meta::oncall::Response>> {
                let record = self.state.lock().unwrap().records.get(incident_id).cloned();
                if self.meet {
                    self.lookups.fetch_add(1, Ordering::SeqCst);
                    for _ in 0..50 {
                        if self.lookups.load(Ordering::SeqCst) >= 2 {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                    }
                }
                Ok(record)
            }

            async fn route(
                &self,
                org_id: &str,
                incident_id: &str,
                title: &str,
                streams: &[(String, String)],
            ) -> RoutedIncident {
                self.state
                    .lock()
                    .unwrap()
                    .routed
                    .push((title.to_string(), streams.to_vec()));
                if self.stall && self.stalls.fetch_add(1, Ordering::SeqCst) == 0 {
                    self.routing.notify_one();
                    self.resume.notified().await;
                }
                let mut s = self.state.lock().unwrap();
                s.routes += 1;
                // Opens firing 1 once, like the unique index under start_once_for_incident.
                if let Some(record) = s.records.get(incident_id).cloned() {
                    return RoutedIncident {
                        record: Some(record),
                        error: None,
                    };
                }
                if s.refuse_route {
                    return RoutedIncident {
                        record: None,
                        error: Some(anyhow::anyhow!("paging refused")),
                    };
                }
                let mut record = page_record(org_id, incident_id, title);
                record.team_id = s.team_id.clone();
                s.pages += 1;
                if s.refuse_attach {
                    s.records.insert(incident_id.to_string(), record.clone());
                    return RoutedIncident {
                        record: Some(record),
                        error: Some(anyhow::anyhow!("link refused")),
                    };
                }
                record.incident_id = Some(incident_id.to_string());
                s.records.insert(incident_id.to_string(), record.clone());
                RoutedIncident {
                    record: Some(record),
                    error: None,
                }
            }

            async fn attach(
                &self,
                _org_id: &str,
                record_id: &str,
                incident_id: &str,
            ) -> anyhow::Result<()> {
                let mut s = self.state.lock().unwrap();
                s.attaches += 1;
                if s.refuse_attach {
                    anyhow::bail!("link refused");
                }
                if let Some(record) = s.records.values_mut().find(|r| r.id == record_id) {
                    record.incident_id = Some(incident_id.to_string());
                }
                Ok(())
            }
        }

        #[derive(Default)]
        struct Paged {
            /// On-call records by incident, one each, as the subject's unique index allows.
            records: HashMap<String, config::meta::oncall::Response>,
            routes: usize,
            pages: usize,
            attaches: usize,
            refuse_route: bool,
            refuse_attach: bool,
            team_id: Option<String>,
            routed: Vec<(String, Vec<(String, String)>)>,
        }

        fn page_record(
            org_id: &str,
            incident_id: &str,
            title: &str,
        ) -> config::meta::oncall::Response {
            serde_json::from_value(serde_json::json!({
                "id": format!("page-{incident_id}"),
                "org_id": org_id,
                "subject": {"subject_type": "incident", "source_id": incident_id, "firing": 1},
                "team_id": null,
                "title": title,
                "priority": 2,
                "responder_role": "owner",
                "state": "triggered",
                "opened_at": 1,
                "incident_id": null,
                "updated_at": 1
            }))
            .unwrap()
        }

        fn finding(org_id: &str, at: i64) -> FindingIncident {
            FindingIncident {
                org_id: org_id.to_string(),
                subject_id: "autoobserve:finding-a".to_string(),
                title: TITLE.to_string(),
                dimensions: finding_dimensions("stream_silence", "logs", "checkout"),
                triggered_at: at,
                streams: vec![("logs".to_string(), "checkout".to_string())],
                page_title: TITLE.to_string(),
                cohort: true,
                scope: None,
            }
        }

        fn member(org_id: &str, kind: &str, i: usize, at: i64) -> FindingIncident {
            let name = format!("s{i}");
            let title = o2_enterprise::enterprise::autoobserve::plugins::stream::page_title(
                kind, "logs", &name,
            );
            FindingIncident {
                org_id: org_id.to_string(),
                subject_id: format!("autoobserve:{kind}-{name}"),
                title: title.clone(),
                dimensions: finding_dimensions(kind, "logs", &name),
                triggered_at: at,
                streams: vec![("logs".to_string(), name)],
                page_title: title,
                cohort: true,
                scope: None,
            }
        }

        fn stop(org_id: &str, i: usize) -> FindingIncident {
            member(org_id, "stream_silence", i, ONSET + i as i64 * QUARTER_HOUR)
        }

        async fn age(id: &str, links_by: i64, incident_by: i64) {
            use infra::table::entity::alert_incident_alerts as links;

            let conn = infra::db::get_orm_client_rw().await;
            links::Entity::update_many()
                .col_expr(
                    links::Column::CreatedAt,
                    Expr::col(links::Column::CreatedAt).sub(links_by),
                )
                .filter(links::Column::IncidentId.eq(id))
                .exec(conn)
                .await
                .unwrap();
            incident_rows::Entity::update_many()
                .col_expr(
                    incident_rows::Column::CreatedAt,
                    Expr::col(incident_rows::Column::CreatedAt).sub(incident_by),
                )
                .filter(incident_rows::Column::Id.eq(id))
                .exec(conn)
                .await
                .unwrap();
        }

        async fn title_of(org_id: &str, id: &str) -> String {
            infra::table::alert_incidents::get_rw(org_id, id)
                .await
                .unwrap()
                .unwrap()
                .title
                .unwrap_or_default()
        }

        #[tokio::test]
        async fn one_three_and_forty_streams_stopping_together_open_one_incident_and_page_once() {
            let _db = store().await;
            for n in [1, 3, 40] {
                let (org, pager) = (new_org(), Pager::default());
                let mut ids = Vec::new();
                for i in 0..n {
                    ids.push(open(&stop(&org, i), &pager).await.unwrap());
                }
                assert!(ids.iter().all(|id| *id == ids[0]), "{n}: {ids:?}");
                assert_eq!(incidents_of(&org).await.len(), 1, "{n}");
                assert_eq!(pager.pages(), 1, "{n} streams, one page");
                let links = infra::table::alert_incidents::get_incident_alerts(&ids[0])
                    .await
                    .unwrap();
                assert_eq!(links.len(), n, "every member is linked");
                let want = match n {
                    1 => "s0 (logs) stopped sending data".to_string(),
                    _ => format!("{n} streams stopped sending data, including s0 (logs)"),
                };
                assert_eq!(title_of(&org, &ids[0]).await, want);
            }
        }

        #[tokio::test]
        async fn a_stop_after_the_gap_or_into_a_day_old_incident_opens_its_own() {
            use o2_enterprise::enterprise::autoobserve::{
                INTERVAL_SECS, plugins::stream::PAGE_COHORT_MAX_AGE_US,
            };

            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let tick = INTERVAL_SECS * 1_000_000;
            let first = open(&stop(&org, 0), &pager).await.unwrap();
            age(&first, tick + 30_000_000, 0).await;
            let inside = open(&stop(&org, 1), &pager).await.unwrap();
            assert_eq!(
                inside, first,
                "one detection tick plus jitter later still joins"
            );
            age(&first, 3 * tick, 0).await;
            let after = open(&stop(&org, 2), &pager).await.unwrap();
            assert_ne!(after, first, "the gap closed the cohort");
            age(&after, 0, PAGE_COHORT_MAX_AGE_US + 60_000_000).await;
            let old = open(&stop(&org, 3), &pager).await.unwrap();
            assert_ne!(old, after, "a day-old incident takes no new member");
            assert_eq!(incidents_of(&org).await.len(), 3);
            assert_eq!(pager.pages(), 3, "one page per incident");
        }

        #[tokio::test]
        async fn a_member_that_stops_again_past_the_gap_or_the_day_opens_and_pages_its_own() {
            use o2_enterprise::enterprise::autoobserve::{
                INTERVAL_SECS, plugins::stream::PAGE_COHORT_MAX_AGE_US,
            };

            let _db = store().await;
            let tick = INTERVAL_SECS * 1_000_000;
            for (links_by, incident_by) in [(3 * tick, 0), (0, PAGE_COHORT_MAX_AGE_US + 60_000_000)]
            {
                let (org, pager) = (new_org(), Pager::default());
                let (a, b) = (stop(&org, 0), stop(&org, 1));
                let first = open(&a, &pager).await.unwrap();
                assert_eq!(open(&b, &pager).await.unwrap(), first);
                let resolved = resolve_finding_firing(&org, &a.subject_id, a.triggered_at, BACK)
                    .await
                    .unwrap();
                assert!(!resolved, "the other member is still stopped");
                infra::table::alert_incidents::acknowledge(&org, &first, PERSON)
                    .await
                    .unwrap();
                age(&first, links_by, incident_by).await;
                let again = member(&org, "stream_silence", 0, BACK + QUARTER_HOUR);
                let second = open(&again, &pager).await.unwrap();
                assert_ne!(second, first, "{links_by}/{incident_by}: a new outage");
                assert_eq!(pager.pages(), 2, "and its own page");
                assert_eq!(status(&org, &first).await, "acknowledged");
                let replay = open(&again, &pager).await.unwrap();
                assert_eq!(replay, second, "a replay of the firing keeps its incident");
                assert_eq!(pager.pages(), 2);
            }
        }

        #[tokio::test]
        async fn each_incident_says_who_it_paged_or_why_nobody_was() {
            use config::meta::oncall::{ResponderRole, SubjectRef, SubjectType};

            use crate::autoobserve::incidents::{PAGE_PENDING_US, PageOutcome, PageView};

            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let team = infra::table::oncall_teams::create(&org, "shop", "UTC", None)
                .await
                .unwrap();
            infra::table::oncall_routing_config::set_default_team(&org, Some(&team.id))
                .await
                .unwrap();
            age_teams(&org, 2 * PAGE_PENDING_US).await;
            let mut ids = Vec::new();
            for i in 0..4 {
                let mut own = stop(&org, i);
                own.cohort = false;
                ids.push(open(&own, &pager).await.unwrap());
            }
            let paged = SubjectRef::new(SubjectType::Incident, ids[0].clone(), 1);
            infra::table::oncall_responses::open(
                &org,
                &paged,
                Some(&team.id),
                2,
                Some(TITLE),
                ResponderRole::Owner,
                None,
            )
            .await
            .unwrap();
            let sample = Some((SubjectType::Incident, ids[1].as_str(), Some(TITLE), 2));
            let now = config::utils::time::now_micros();
            infra::table::oncall_ownership::record_unrouted(
                &org,
                &HashMap::new(),
                sample,
                None,
                now,
            )
            .await
            .unwrap();
            age(&ids[3], 0, PAGE_PENDING_US + 60_000_000).await;
            let pages = pages_of(&org, true).await;
            assert_eq!(
                serde_json::to_value(&pages[&ids[0]]).unwrap(),
                serde_json::json!({"outcome": "paged", "team_id": team.id, "team_name": "shop"})
            );
            let nobody = |outcome| PageView {
                outcome,
                team_id: None,
                team_name: None,
            };
            assert_eq!(
                pages[&ids[1]],
                nobody(PageOutcome::Unrouted),
                "its queue sample"
            );
            assert_eq!(pages[&ids[2]], nobody(PageOutcome::Pending), "just opened");
            assert_eq!(
                pages[&ids[3]],
                nobody(PageOutcome::Failed),
                "the default team would take it"
            );
            assert_eq!(
                serde_json::to_value(&pages[&ids[3]]).unwrap(),
                serde_json::json!({"outcome": "failed", "team_id": null, "team_name": null})
            );
        }

        #[tokio::test]
        async fn a_page_nobody_could_take_reads_unrouted_without_its_queue_sample() {
            use crate::autoobserve::incidents::{PAGE_PENDING_US, PageOutcome};

            let _db = store().await;
            let pager = Pager::default();
            let (ruleless, teamless) = (new_org(), new_org());
            let _team = infra::table::oncall_teams::create(&ruleless, "core", "UTC", None)
                .await
                .unwrap();
            age_teams(&ruleless, 2 * PAGE_PENDING_US).await;
            let old = open(&stop(&ruleless, 0), &pager).await.unwrap();
            age(&old, 0, PAGE_PENDING_US + 60_000_000).await;
            let fresh = open(&stop(&teamless, 0), &pager).await.unwrap();
            assert_eq!(
                pages_of(&ruleless, true).await[&old].outcome,
                PageOutcome::Unrouted,
                "no rule and no default team"
            );
            assert_eq!(
                pages_of(&teamless, true).await[&fresh].outcome,
                PageOutcome::Unrouted,
                "an org with no on-call team, not pending"
            );
            assert_eq!(
                pages_of(&ruleless, false).await[&old].outcome,
                PageOutcome::Unrouted,
                "on-call off"
            );
        }

        #[tokio::test]
        async fn a_teamless_record_from_on_calls_unrouted_path_reads_unrouted() {
            use crate::autoobserve::incidents::PageOutcome;

            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let _team = infra::table::oncall_teams::create(&org, "core", "UTC", None)
                .await
                .unwrap();
            let f = stop(&org, 0);
            let id = open(&f, &pager).await.unwrap();
            let routed = OncallPager
                .route(&org, &id, &f.page_title, &f.streams)
                .await;
            assert!(routed.error.is_none(), "{:?}", routed.error);
            let record = routed.record.expect("on-call keeps a teamless record");
            assert_eq!(record.team_id, None, "no rule and no default team");
            let pages = pages_of(&org, true).await;
            assert_eq!(pages[&id].outcome, PageOutcome::Unrouted);
            assert_eq!(pages[&id].team_id, None);
            assert_eq!(pages[&id].team_name, None);
        }

        #[tokio::test]
        async fn a_stop_that_opened_with_no_team_stays_unrouted_after_a_default_team_is_added() {
            use crate::autoobserve::incidents::{PAGE_PENDING_US, PageOutcome};

            let _db = store().await;
            let org = new_org();
            let id = open_finding_incident_with(&stop(&org, 0), &OncallPager, &ClusterTurns)
                .await
                .unwrap()
                .incident_id()
                .to_string();
            let record = OncallPager.record(&org, &id).await.unwrap();
            assert!(record.is_none(), "an org with no team pages nobody");
            assert_eq!(
                pages_of(&org, true).await[&id].outcome,
                PageOutcome::Unrouted
            );
            let team = infra::table::oncall_teams::create(&org, "shop", "UTC", None)
                .await
                .unwrap();
            infra::table::oncall_routing_config::set_default_team(&org, Some(&team.id))
                .await
                .unwrap();
            assert_eq!(
                pages_of(&org, true).await[&id].outcome,
                PageOutcome::Unrouted,
                "no page is queued, so not pending"
            );
            age(&id, 0, PAGE_PENDING_US + 60_000_000).await;
            assert_eq!(
                pages_of(&org, true).await[&id].outcome,
                PageOutcome::Unrouted,
                "no page was attempted, so not failed"
            );
        }

        #[tokio::test]
        async fn a_page_the_on_call_service_refused_reads_pending_then_failed() {
            use crate::autoobserve::incidents::{PAGE_PENDING_US, PageOutcome};

            let _db = store().await;
            let org = new_org();
            let team = infra::table::oncall_teams::create(&org, "shop", "UTC", None)
                .await
                .unwrap();
            infra::table::oncall_routing_config::set_default_team(&org, Some(&team.id))
                .await
                .unwrap();
            age_teams(&org, 2 * PAGE_PENDING_US).await;
            let refused = open(&stop(&org, 0), &Pager::refusing(true, false)).await;
            assert!(refused.is_err(), "the route errored");
            let id = incidents_of(&org).await.remove(0).id;
            assert_eq!(
                pages_of(&org, true).await[&id].outcome,
                PageOutcome::Pending
            );
            age(&id, 0, PAGE_PENDING_US + 60_000_000).await;
            assert_eq!(pages_of(&org, true).await[&id].outcome, PageOutcome::Failed);
        }

        #[tokio::test]
        async fn a_fresh_stop_routed_to_the_default_team_reads_paged() {
            use config::meta::oncall::{ResponderRole, SubjectRef, SubjectType};

            use crate::autoobserve::incidents::PageOutcome;

            let _db = store().await;
            let org = new_org();
            let team = infra::table::oncall_teams::create(&org, "shop", "UTC", None)
                .await
                .unwrap();
            infra::table::oncall_routing_config::set_default_team(&org, Some(&team.id))
                .await
                .unwrap();
            let id = open(&stop(&org, 0), &Pager::for_team(&team.id))
                .await
                .unwrap();
            let paged = SubjectRef::new(SubjectType::Incident, id.clone(), 1);
            infra::table::oncall_responses::open(
                &org,
                &paged,
                Some(&team.id),
                2,
                Some(TITLE),
                ResponderRole::Owner,
                None,
            )
            .await
            .unwrap();
            let page = &pages_of(&org, true).await[&id];
            assert_eq!(page.outcome, PageOutcome::Paged);
            assert_eq!(page.team_id.as_deref(), Some(team.id.as_str()));
            assert_eq!(page.team_name.as_deref(), Some("shop"));
        }

        async fn pages_of(
            org: &str,
            oncall_on: bool,
        ) -> HashMap<String, crate::autoobserve::incidents::PageView> {
            let page = o2_enterprise::enterprise::autoobserve::api::Page {
                limit: 50,
                offset: 0,
            };
            let now = config::utils::time::now_micros();
            crate::autoobserve::incidents::list_with(org, page, oncall_on, now)
                .await
                .unwrap()
                .items
                .into_iter()
                .map(|i| (i.incident.id, i.page.expect("every item says its page")))
                .collect()
        }

        /// Moves the org's teams back, so an incident aged into the past still opened after them.
        async fn age_teams(org: &str, by: i64) {
            use infra::table::entity::oncall_teams as teams;

            teams::Entity::update_many()
                .col_expr(
                    teams::Column::CreatedAt,
                    Expr::col(teams::Column::CreatedAt).sub(by),
                )
                .filter(teams::Column::OrgId.eq(org))
                .exec(infra::db::get_orm_client_rw().await)
                .await
                .unwrap();
        }

        #[tokio::test]
        async fn a_stop_whose_last_cohort_left_the_scan_still_opens_and_pages_its_own() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let first = open(&stop(&org, 0), &pager).await.unwrap();
            age(&first, 3 * QUARTER_HOUR, 0).await;
            for i in 0..COHORT_IDS_SCANNED as usize {
                let mut other = member(&org, "stream_drop", i, ONSET);
                other.cohort = false;
                let _opened = open(&other, &pager).await.unwrap();
            }
            let next = open(&stop(&org, 1), &pager).await.unwrap();
            assert_ne!(next, first, "never the first cohort's id, out of the scan");
            assert_eq!(
                pager.pages(),
                COHORT_IDS_SCANNED as usize + 2,
                "the stop paged"
            );
            let links = infra::table::alert_incidents::get_incident_alerts(&next)
                .await
                .unwrap();
            assert_eq!(links.len(), 1, "a fresh incident");
        }

        #[tokio::test]
        async fn another_kind_or_another_service_opens_its_own_incident() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            for (stream, service) in [("s0", "checkout"), ("s1", "payments"), ("s2", "checkout")] {
                let record = infra::table::service_streams::ServiceRecord {
                    id: config::ider::generate(),
                    org_id: org.clone(),
                    service_name: service.to_string(),
                    set_id: "default".to_string(),
                    disambiguation: serde_json::json!({}),
                    all_dimensions: serde_json::json!({}),
                    logs_streams: serde_json::json!([stream]),
                    traces_streams: serde_json::json!([]),
                    metrics_streams: serde_json::json!([]),
                    profiles_streams: serde_json::json!([]),
                    field_name_mapping: None,
                    last_seen: 1,
                };
                let _stored = infra::table::service_streams::put(&org, record, 100)
                    .await
                    .unwrap();
            }
            let scoped = |i: usize, service: &str| FindingIncident {
                scope: Some(service.to_string()),
                ..stop(&org, i)
            };
            let checkout = open(&scoped(0, "checkout"), &pager).await.unwrap();
            let payments = open(&scoped(1, "payments"), &pager).await.unwrap();
            assert_ne!(
                payments, checkout,
                "per service when the catalogue knows one"
            );
            let joined = open(&scoped(2, "checkout"), &pager).await.unwrap();
            assert_eq!(joined, checkout);
            let unscoped = open(&stop(&org, 3), &pager).await.unwrap();
            assert!(![checkout.as_str(), payments.as_str()].contains(&unscoped.as_str()));
            let drop = open(&member(&org, "stream_drop", 4, ONSET), &pager)
                .await
                .unwrap();
            assert_ne!(drop, unscoped, "another kind");
            assert_eq!(incidents_of(&org).await.len(), 4);
            assert_eq!(pager.pages(), 4);
        }

        #[tokio::test]
        async fn a_cohort_resolves_only_when_its_last_member_recovers() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let members: Vec<FindingIncident> = (0..3).map(|i| stop(&org, i)).collect();
            let mut id = String::new();
            for m in &members {
                id = open(m, &pager).await.unwrap();
            }
            for (i, m) in members.iter().enumerate() {
                let resolved =
                    resolve_finding_firing(&org, &m.subject_id, m.triggered_at, BACK + 10)
                        .await
                        .unwrap();
                let last = i == members.len() - 1;
                assert_eq!(resolved, last, "member {i}");
                let want = if last { "resolved" } else { "open" };
                assert_eq!(status(&org, &id).await, want, "after member {i}");
            }
        }

        #[tokio::test]
        async fn an_acknowledged_cohort_takes_new_members_unpaged_and_is_never_auto_resolved() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let id = open(&stop(&org, 0), &pager).await.unwrap();
            infra::table::alert_incidents::acknowledge(&org, &id, PERSON)
                .await
                .unwrap();
            assert_eq!(open(&stop(&org, 1), &pager).await.unwrap(), id);
            assert_eq!(pager.pages(), 1);
            for i in 0..2 {
                let m = stop(&org, i);
                let resolved = resolve_finding_firing(&org, &m.subject_id, m.triggered_at, BACK)
                    .await
                    .unwrap();
                assert!(!resolved, "a human's to close");
            }
            assert_eq!(status(&org, &id).await, "acknowledged");
        }

        #[tokio::test]
        async fn the_page_routes_on_every_member_dispatched_with_the_first() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let streams: Vec<(String, String)> = (0..3)
                .map(|i| ("logs".to_string(), format!("s{i}")))
                .collect();
            let first = FindingIncident {
                streams: streams.clone(),
                page_title: "3 streams stopped sending data, including s0 (logs)".to_string(),
                ..stop(&org, 0)
            };
            let id = open(&first, &pager).await.unwrap();
            for i in 1..3 {
                assert_eq!(open(&stop(&org, i), &pager).await.unwrap(), id);
            }
            let routed = pager.state.lock().unwrap().routed.clone();
            assert_eq!(
                routed,
                [(first.page_title.clone(), streams)],
                "one route, on all three streams"
            );
        }

        #[tokio::test]
        async fn two_nodes_acting_on_two_members_at_once_open_one_incident_and_page_once() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::meeting());
            let cluster = Arc::default();
            let (a, b) = (Node::of(&cluster), Node::of(&cluster));
            let (m0, m1) = (stop(&org, 0), stop(&org, 1));
            let (x, y) = tokio::join!(
                open_finding_incident_with(&m0, &pager, &a),
                open_finding_incident_with(&m1, &pager, &b)
            );
            assert_eq!(x.unwrap().incident_id(), y.unwrap().incident_id());
            assert_eq!(incidents_of(&org).await.len(), 1);
            assert_eq!(pager.pages(), 1);
        }

        #[tokio::test]
        async fn a_member_stalled_past_its_lease_joins_the_cohort_the_next_holder_opened() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let cluster = Arc::default();
            let gate = Gate::at(FenceStep::Open, true);
            let (a, b) = (Node::gated(&cluster, &gate), Node::of(&cluster));
            let (m0, m1) = (stop(&org, 0), stop(&org, 1));
            let (old, new) = tokio::join!(
                open_finding_incident_with(&m0, &pager, &a),
                take_over(&cluster, &gate, &m1, &pager, &b)
            );
            let id = new.unwrap().incident_id().to_string();
            assert_eq!(
                old.unwrap().incident_id(),
                id,
                "the stalled member joined it"
            );
            assert_eq!(incidents_of(&org).await.len(), 1);
            assert_eq!(pager.pages(), 1, "paged once");
            let links = infra::table::alert_incidents::get_incident_alerts(&id)
                .await
                .unwrap();
            assert_eq!(links.len(), 2, "both members");
        }

        fn new_org() -> String {
            format!("ao_{}", config::ider::generate().to_lowercase())
        }

        async fn open(f: &FindingIncident, pager: &Pager) -> anyhow::Result<String> {
            open_finding_incident_with(f, pager, &ClusterTurns)
                .await
                .map(|o| o.incident_id().to_string())
        }

        /// One node of a test cluster: its own stripe, then the lease its cluster shares.
        struct Node {
            stripe: Arc<tokio::sync::Mutex<()>>,
            cluster: Arc<Lease>,
            gate: Option<Arc<Gate>>,
        }

        impl Node {
            fn of(cluster: &Arc<Lease>) -> Self {
                Self {
                    stripe: Arc::default(),
                    cluster: cluster.clone(),
                    gate: None,
                }
            }

            fn gated(cluster: &Arc<Lease>, gate: &Arc<Gate>) -> Self {
                Self {
                    gate: Some(gate.clone()),
                    ..Self::of(cluster)
                }
            }
        }

        #[async_trait::async_trait]
        impl FindingTurns for Node {
            async fn take(&self, org_id: &str, subject_id: &str) -> anyhow::Result<FindingTurn> {
                let stripe = self.stripe.clone().lock_owned().await;
                let (held, lost) = self.cluster.take().await;
                let lease = LeaseWatch {
                    key: finding_lock_key(org_id, subject_id),
                    lost: Some(lost),
                };
                let fence: Arc<dyn TurnFence> = match &self.gate {
                    Some(gate) => Arc::new(Gated {
                        lease: lease.clone(),
                        gate: gate.clone(),
                    }),
                    None => Arc::new(lease.clone()),
                };
                Ok(FindingTurn {
                    held: vec![Box::new(stripe) as Box<dyn Send + Sync>, Box::new(held)],
                    cluster: None,
                    lease,
                    fence,
                })
            }
        }

        /// Holds a node once, right before one step, on either side of its lease check.
        #[derive(Debug)]
        struct Gate {
            step: FenceStep,
            checked_first: bool,
            reached: tokio::sync::Notify,
            resume: tokio::sync::Notify,
            passes: AtomicUsize,
        }

        impl Gate {
            fn at(step: FenceStep, checked_first: bool) -> Arc<Self> {
                Arc::new(Self {
                    step,
                    checked_first,
                    reached: tokio::sync::Notify::new(),
                    resume: tokio::sync::Notify::new(),
                    passes: AtomicUsize::new(0),
                })
            }

            /// Fails instead of hanging when the gated node never gets there.
            async fn arrived(&self) {
                tokio::time::timeout(std::time::Duration::from_secs(10), self.reached.notified())
                    .await
                    .expect("the gated node reaches its step");
            }
        }

        /// A node's fence with its [Gate] around one step.
        #[derive(Debug)]
        struct Gated {
            lease: LeaseWatch,
            gate: Arc<Gate>,
        }

        #[async_trait::async_trait]
        impl TurnFence for Gated {
            async fn before(&self, step: FenceStep) -> anyhow::Result<()> {
                if step != self.gate.step {
                    return self.lease.before(step).await;
                }
                if self.gate.checked_first {
                    self.lease.before(step).await?;
                }
                if self.gate.passes.fetch_add(1, Ordering::SeqCst) == 0 {
                    self.gate.reached.notify_one();
                    self.gate.resume.notified().await;
                }
                if self.gate.checked_first {
                    return Ok(());
                }
                self.lease.before(step).await
            }
        }

        /// A cluster lock with a lease: one holder at a time, and the test can let it lapse.
        #[derive(Default)]
        struct Lease {
            holder: Mutex<Option<(u64, tokio::sync::watch::Sender<bool>)>>,
            takes: AtomicU64,
            freed: tokio::sync::Notify,
        }

        impl Lease {
            async fn take(self: &Arc<Self>) -> (LeaseHeld, tokio::sync::watch::Receiver<bool>) {
                loop {
                    {
                        let mut holder = self.holder.lock().unwrap();
                        if holder.is_none() {
                            let id = self.takes.fetch_add(1, Ordering::SeqCst);
                            let (lost, lease) = tokio::sync::watch::channel(false);
                            *holder = Some((id, lost));
                            let held = LeaseHeld {
                                lease: self.clone(),
                                id,
                            };
                            return (held, lease);
                        }
                    }
                    self.freed.notified().await;
                }
            }

            /// As an unrenewed NATS lock: its holder learns it is lost; the next taker gets it.
            fn lapse(&self) {
                if let Some((_, lost)) = self.holder.lock().unwrap().take() {
                    lost.send_replace(true);
                }
                self.freed.notify_one();
            }
        }

        /// One take of a [Lease]; dropping it frees the lease only if it still holds it.
        struct LeaseHeld {
            lease: Arc<Lease>,
            id: u64,
        }

        impl Drop for LeaseHeld {
            fn drop(&mut self) {
                let mut holder = self.lease.holder.lock().unwrap();
                if holder.as_ref().is_some_and(|(id, _)| *id == self.id) {
                    *holder = None;
                    drop(holder);
                    self.lease.freed.notify_one();
                }
            }
        }

        /// A team whose L0 policy is off at P2, the priority a finding pages at.
        async fn l0_off_team(org_id: &str) -> String {
            use infra::table::entity::oncall_policies;
            use sea_orm::{ActiveModelTrait, ConnectionTrait, Schema, Set};

            let conn = infra::db::get_orm_client_rw().await;
            let backend = conn.get_database_backend();
            let mut table = Schema::new(backend).create_table_from_entity(oncall_policies::Entity);
            conn.execute(backend.build(table.if_not_exists()))
                .await
                .unwrap();
            let mut l0 = config::meta::oncall::L0Policy::defaults();
            l0.mode.p2 = config::meta::oncall::L0Mode::Off;
            let team_id = format!("team-{org_id}");
            oncall_policies::ActiveModel {
                id: Set(config::ider::uuid()),
                org_id: Set(org_id.to_string()),
                team_id: Set(team_id.clone()),
                rungs: Set("[]".to_string()),
                destinations: Set("[]".to_string()),
                l0_json: Set(serde_json::to_string(&l0).unwrap()),
                template: Set(None),
                created_at: Set(1),
                updated_at: Set(1),
            }
            .insert(conn)
            .await
            .unwrap();
            team_id
        }

        async fn incidents_of(org_id: &str) -> Vec<incident_rows::Model> {
            incident_rows::Entity::find()
                .filter(incident_rows::Column::OrgId.eq(org_id))
                .all(infra::db::get_orm_client_rw().await)
                .await
                .unwrap()
        }

        async fn off_reason(org_id: &str, incident_id: &str) -> Option<String> {
            infra::table::alert_incidents::get_rw(org_id, incident_id)
                .await
                .unwrap()
                .unwrap()
                .rca_off_reason
        }

        /// Lapses the gated node's lease at its gate, runs `f` on `node`, then lets it resume.
        async fn take_over(
            cluster: &Lease,
            gate: &Gate,
            f: &FindingIncident,
            pager: &Pager,
            node: &Node,
        ) -> anyhow::Result<IncidentCorrelationOutcome> {
            gate.arrived().await;
            cluster.lapse();
            let taken = open_finding_incident_with(f, pager, node).await;
            gate.resume.notify_one();
            taken
        }

        /// One incident for the finding, paged once and linked, holding both onsets.
        async fn assert_one_paged_incident(org_id: &str, id: &str, pager: &Pager) {
            let opened: Vec<String> = incidents_of(org_id)
                .await
                .into_iter()
                .map(|i| i.id)
                .collect();
            assert_eq!(opened, [id], "one incident");
            assert_eq!(pager.pages(), 1, "paged once");
            assert_eq!(pager.linked_to().as_deref(), Some(id));
            let links = infra::table::alert_incidents::get_incident_alerts(id)
                .await
                .unwrap();
            let onsets: Vec<i64> = links.iter().map(|l| l.alert_fired_at).collect();
            assert_eq!(onsets, [ONSET + QUARTER_HOUR, ONSET], "both onsets");
        }

        #[tokio::test]
        async fn a_replay_of_a_resolved_or_rekeyed_firing_opens_nothing_new() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            let id = open(&f, &pager).await.unwrap();
            infra::table::alert_incidents::update_status(&org, &id, "resolved")
                .await
                .unwrap();
            assert_eq!(open(&f, &pager).await.unwrap(), id, "a resolved incident");
            incident_rows::Entity::update_many()
                .col_expr(incident_rows::Column::KeyType, Expr::value("Primary"))
                .filter(incident_rows::Column::Id.eq(&id))
                .exec(infra::db::get_orm_client_rw().await)
                .await
                .unwrap();
            assert_eq!(open(&f, &pager).await.unwrap(), id, "a re-keyed incident");
            assert_eq!(incidents_of(&org).await.len(), 1);
            assert_eq!(pager.counts(), (1, 0), "paged once");
        }

        #[tokio::test]
        async fn overlapping_attempts_open_one_incident_and_page_once() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            let ids = futures::future::join_all((0..4).map(|_| open(&f, &pager))).await;
            let ids: Vec<String> = ids.into_iter().map(Result::unwrap).collect();
            assert!(ids.iter().all(|id| *id == ids[0]), "{ids:?}");
            assert_eq!(incidents_of(&org).await.len(), 1);
            let links = infra::table::alert_incidents::get_incident_alerts(&ids[0])
                .await
                .unwrap();
            assert_eq!(links.len(), 1, "{links:?}");
            assert_eq!(pager.counts(), (1, 0));
        }

        #[tokio::test]
        async fn a_new_onset_joins_the_open_incident_and_pages_nothing_more() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let (org, pager) = (new_org(), Pager::default());
            let id = open(&finding(&org, ONSET), &pager).await.unwrap();
            let later = open(&finding(&org, ONSET + QUARTER_HOUR), &pager)
                .await
                .unwrap();
            assert_eq!(later, id);
            assert_eq!(incidents_of(&org).await.len(), 1);
            let links = infra::table::alert_incidents::get_incident_alerts(&id)
                .await
                .unwrap();
            assert_eq!(links.len(), 2);
            assert_eq!(pager.counts(), (1, 0));
        }

        #[tokio::test]
        async fn a_routing_failure_fails_the_act_and_the_replay_pages_once() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            crate::alerts::rca_runs::tests::rca_off();
            let org = new_org();
            let pager = Pager::refusing(true, false);
            let f = finding(&org, ONSET);
            assert!(open(&f, &pager).await.is_err(), "the act sees the failure");
            let opened = incidents_of(&org).await;
            assert_eq!(opened.len(), 1);
            assert_eq!(
                opened[0].rca_off_reason, None,
                "nothing is decided before the page"
            );
            pager.heal();
            let id = open(&f, &pager).await.unwrap();
            assert_eq!(id, opened[0].id);
            assert_eq!(pager.counts(), (2, 0), "one refused page, one page");
            assert_eq!(pager.linked_to(), Some(id.clone()));
            assert_eq!(
                off_reason(&org, &id).await.as_deref(),
                Some(RCA_OFF_DISABLED)
            );
        }

        #[tokio::test]
        async fn a_link_failure_after_the_page_fails_the_act_and_the_replay_only_links() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let org = new_org();
            let pager = Pager::refusing(false, true);
            let f = finding(&org, ONSET);
            assert!(open(&f, &pager).await.is_err(), "the act sees the failure");
            pager.heal();
            let id = open(&f, &pager).await.unwrap();
            assert_eq!(pager.counts(), (1, 1), "paged once, linked on the replay");
            assert_eq!(pager.linked_to(), Some(id));
        }

        #[tokio::test]
        async fn a_replay_after_the_link_finishes_the_page_and_the_analysis() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            crate::alerts::rca_runs::tests::rca_off();
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            // The state a process exit right after the link commit leaves behind.
            let incident = infra::table::alert_incidents::create(
                &org,
                "P2",
                serde_json::to_value(&f.dimensions).unwrap(),
                "AlertId",
                ONSET,
                Some(TITLE.to_string()),
            )
            .await
            .unwrap();
            infra::table::alert_incidents::add_alert_to_incident(
                &incident.id,
                &f.subject_id,
                TITLE,
                AlertKind::AutoObserve.as_str(),
                ONSET,
                "alert_id",
            )
            .await
            .unwrap();
            assert_eq!(open(&f, &pager).await.unwrap(), incident.id);
            assert_eq!(pager.counts(), (1, 0), "the replay pages");
            assert_eq!(
                off_reason(&org, &incident.id).await.as_deref(),
                Some(RCA_OFF_DISABLED),
                "and decides the analysis"
            );
        }

        #[tokio::test]
        async fn two_nodes_racing_past_the_record_lookup_page_once() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let (org, pager) = (new_org(), Pager::meeting());
            let f = finding(&org, ONSET);
            let cluster = Arc::default();
            let (a, b) = (Node::of(&cluster), Node::of(&cluster));
            let (x, y) = tokio::join!(
                open_finding_incident_with(&f, &pager, &a),
                open_finding_incident_with(&f, &pager, &b)
            );
            assert_eq!(x.unwrap().incident_id(), y.unwrap().incident_id());
            assert_eq!(incidents_of(&org).await.len(), 1);
            assert_eq!(pager.counts(), (1, 0), "one on-call record, paged once");
        }

        #[tokio::test]
        async fn a_node_that_loses_its_lease_mid_route_stops_and_the_next_holder_pages_once() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            crate::alerts::rca_runs::tests::rca_off();
            let (org, pager) = (new_org(), Pager::stalling());
            let f = finding(&org, ONSET);
            let cluster = Arc::default();
            let (a, b) = (Node::of(&cluster), Node::of(&cluster));
            let takeover = async {
                pager.routing.notified().await;
                cluster.lapse();
                let taken = open_finding_incident_with(&f, &pager, &b).await;
                pager.resume.notify_one();
                taken
            };
            let (old, new) = tokio::join!(open_finding_incident_with(&f, &pager, &a), takeover);
            let lost = old.expect_err("the old holder's act fails");
            assert!(lost.to_string().contains("lost the lock"), "{lost}");
            let id = new.unwrap().incident_id().to_string();
            assert_eq!(incidents_of(&org).await.len(), 1);
            assert_eq!(pager.pages(), 1, "one on-call record, paged once");
            assert_eq!(
                pager.counts(),
                (2, 0),
                "both routed; the second met the first's record"
            );
            assert_eq!(pager.linked_to(), Some(id.clone()));
            assert_eq!(
                off_reason(&org, &id).await.as_deref(),
                Some(RCA_OFF_DISABLED)
            );
        }

        #[tokio::test]
        async fn a_node_stalled_past_its_lease_check_joins_the_incident_the_next_holder_opened() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let (org, pager) = (new_org(), Pager::default());
            let (old_onset, new_onset) =
                (finding(&org, ONSET), finding(&org, ONSET + QUARTER_HOUR));
            let cluster = Arc::default();
            let gate = Gate::at(FenceStep::Open, true);
            let (a, b) = (Node::gated(&cluster, &gate), Node::of(&cluster));
            let (old, new) = tokio::join!(
                open_finding_incident_with(&old_onset, &pager, &a),
                take_over(&cluster, &gate, &new_onset, &pager, &b)
            );
            let id = new.unwrap().incident_id().to_string();
            let replay = open_finding_incident_with(&old_onset, &pager, &a).await;
            assert_one_paged_incident(&org, &id, &pager).await;
            assert_eq!(old.unwrap().incident_id(), id, "the old holder joined it");
            assert_eq!(replay.unwrap().incident_id(), id, "and so does its replay");
            assert_eq!(pager.counts(), (1, 0));
        }

        #[tokio::test]
        async fn a_node_whose_lease_lapses_before_its_insert_opens_nothing() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let (org, pager) = (new_org(), Pager::default());
            let (old_onset, new_onset) =
                (finding(&org, ONSET), finding(&org, ONSET + QUARTER_HOUR));
            let cluster = Arc::default();
            let gate = Gate::at(FenceStep::Open, false);
            let (a, b) = (Node::gated(&cluster, &gate), Node::of(&cluster));
            let (old, new) = tokio::join!(
                open_finding_incident_with(&old_onset, &pager, &a),
                take_over(&cluster, &gate, &new_onset, &pager, &b)
            );
            let lost = old.expect_err("the old holder stops at its insert");
            assert!(
                lost.to_string().contains("before opening the incident"),
                "{lost}"
            );
            let id = new.unwrap().incident_id().to_string();
            let replay = open_finding_incident_with(&old_onset, &pager, &a).await;
            assert_eq!(replay.unwrap().incident_id(), id, "the replay joins it");
            assert_one_paged_incident(&org, &id, &pager).await;
            assert_eq!(pager.counts(), (1, 0));
        }

        #[tokio::test]
        async fn a_stale_join_that_lands_after_a_takeover_keeps_its_onset_in_one_incident() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            let (org, pager) = (new_org(), Pager::default());
            let x = open(&finding(&org, ONSET), &pager).await.unwrap();
            let f = finding(&org, ONSET + QUARTER_HOUR);
            let cluster = Arc::default();
            let (a_gate, b_gate) = (
                Gate::at(FenceStep::Join, true),
                Gate::at(FenceStep::Lookup, true),
            );
            let (a, b) = (
                Node::gated(&cluster, &a_gate),
                Node::gated(&cluster, &b_gate),
            );
            let a_done = tokio::sync::Notify::new();
            let stale = async {
                let joined = open_finding_incident_with(&f, &pager, &a).await;
                a_done.notify_one();
                joined
            };
            let takeover = async {
                a_gate.arrived().await;
                cluster.lapse();
                open_finding_incident_with(&f, &pager, &b).await
            };
            let script = async {
                b_gate.arrived().await;
                a_gate.resume.notify_one();
                tokio::time::timeout(std::time::Duration::from_secs(10), a_done.notified())
                    .await
                    .expect("the stale join lands");
                infra::table::alert_incidents::update_status(&org, &x, "resolved")
                    .await
                    .unwrap();
                b_gate.resume.notify_one();
            };
            let (old, new, ()) = tokio::join!(stale, takeover, script);
            let opened: Vec<String> = incidents_of(&org).await.into_iter().map(|i| i.id).collect();
            assert_eq!(opened, std::slice::from_ref(&x), "one incident");
            let holder = infra::table::alert_incidents::find_incident_with_firing(
                &org,
                &f.subject_id,
                f.triggered_at,
            )
            .await
            .unwrap();
            assert_eq!(holder.map(|i| i.id), Some(x.clone()), "it holds the onset");
            assert_eq!(pager.pages(), 1, "paged once");
            assert_eq!(old.unwrap().incident_id(), x, "the stale join landed in X");
            assert_eq!(
                new.unwrap().incident_id(),
                x,
                "the takeover found the onset in X"
            );
            let replay = open_finding_incident_with(&f, &pager, &b).await.unwrap();
            assert_eq!(replay.incident_id(), x);
            assert_eq!(pager.pages(), 1, "and its replay pages nothing");
        }

        #[tokio::test]
        async fn a_refused_l0_off_write_fails_the_act_and_the_replay_stores_it() {
            use sea_orm::ConnectionTrait;

            let _db = crate::alerts::rca_runs::tests::db().await;
            let org = new_org();
            let pager = Pager::for_team(&l0_off_team(&org).await);
            let f = finding(&org, ONSET);
            let conn = infra::db::get_orm_client_rw().await;
            conn.execute_unprepared(&format!(
                "CREATE TRIGGER refuse_off_reason BEFORE UPDATE OF rca_off_reason ON alert_incidents \
                 WHEN NEW.org_id = '{org}' BEGIN SELECT RAISE(ABORT, 'the test refused this write'); END"
            ))
            .await
            .unwrap();
            let refused = open(&f, &pager).await;
            conn.execute_unprepared("DROP TRIGGER refuse_off_reason")
                .await
                .unwrap();
            assert!(refused.is_err(), "the act sees the failed write");
            let id = open(&f, &pager).await.unwrap();
            assert_eq!(off_reason(&org, &id).await.as_deref(), Some("l0_off"));
            assert_eq!(pager.counts(), (1, 0), "paged once");
        }

        #[tokio::test]
        async fn a_finding_incident_with_analysis_off_says_why() {
            let _db = crate::alerts::rca_runs::tests::db().await;
            crate::alerts::rca_runs::tests::rca_off();
            let (org, pager) = (new_org(), Pager::default());
            let id = open(&finding(&org, ONSET), &pager).await.unwrap();
            let row = infra::table::alert_incidents::get_rw(&org, &id)
                .await
                .unwrap()
                .unwrap();
            let links = infra::table::alert_incidents::get_incident_alerts(&id)
                .await
                .unwrap();
            let item = crate::autoobserve::incidents::item_of(&row, &links[0]);
            assert_eq!(
                item.investigation.not_run_reason.as_deref(),
                Some(RCA_OFF_DISABLED)
            );
            assert_eq!(item.investigation.run_id, None);
        }

        /// The configured meta store: SQLite through the run tests' helper, or an o2-svc Postgres.
        async fn store() -> tokio::sync::MutexGuard<'static, ()> {
            if config::get_config().common.meta_store != "postgres" {
                let guard = crate::alerts::rca_runs::tests::db().await;
                static CATALOGUE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
                CATALOGUE
                    .get_or_init(|| async {
                        use infra::table::entity::{
                            oncall_ownership_rules, oncall_response_events, oncall_routing_config,
                            oncall_teams, oncall_unrouted_signals,
                        };
                        use sea_orm::{ConnectionTrait, Schema};

                        let conn = infra::db::get_orm_client_rw().await;
                        let backend = conn.get_database_backend();
                        let schema = Schema::new(backend);
                        for mut table in [
                            schema.create_table_from_entity(infra::table::service_streams::Entity),
                            schema.create_table_from_entity(oncall_teams::Entity),
                            schema.create_table_from_entity(oncall_unrouted_signals::Entity),
                            schema.create_table_from_entity(oncall_routing_config::Entity),
                            schema.create_table_from_entity(oncall_ownership_rules::Entity),
                            schema.create_table_from_entity(oncall_response_events::Entity),
                        ] {
                            conn.execute(backend.build(table.if_not_exists()))
                                .await
                                .unwrap();
                        }
                    })
                    .await;
                return guard;
            }
            static TABLES: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
            static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
            TABLES
                .get_or_init(|| async {
                    use infra::table::entity::{
                        alert_incident_alerts, incident_events, oncall_ownership_rules,
                        oncall_response_events, oncall_responses, oncall_routing_config,
                        oncall_teams, oncall_unrouted_signals, rca_runs, rca_steering,
                    };
                    use sea_orm::{ConnectionTrait, Schema};

                    let conn = infra::db::get_orm_client_rw().await;
                    let backend = conn.get_database_backend();
                    let schema = Schema::new(backend);
                    for mut table in [
                        schema.create_table_from_entity(incident_rows::Entity),
                        schema.create_table_from_entity(alert_incident_alerts::Entity),
                        schema.create_table_from_entity(incident_events::Entity),
                        schema.create_table_from_entity(rca_runs::Entity),
                        schema.create_table_from_entity(rca_steering::Entity),
                        schema.create_table_from_entity(oncall_responses::Entity),
                        schema.create_table_from_entity(infra::table::service_streams::Entity),
                        schema.create_table_from_entity(oncall_teams::Entity),
                        schema.create_table_from_entity(oncall_unrouted_signals::Entity),
                        schema.create_table_from_entity(oncall_routing_config::Entity),
                        schema.create_table_from_entity(oncall_ownership_rules::Entity),
                        schema.create_table_from_entity(oncall_response_events::Entity),
                    ] {
                        conn.execute(backend.build(table.if_not_exists()))
                            .await
                            .unwrap();
                    }
                    // The migration makes these jsonb; as json, `service_streams::put`'s lookup fails.
                    for column in [
                        "disambiguation",
                        "all_dimensions",
                        "logs_streams",
                        "traces_streams",
                        "metrics_streams",
                        "profiles_streams",
                        "field_name_mapping",
                    ] {
                        conn.execute_unprepared(&format!(
                            "ALTER TABLE service_streams ALTER COLUMN {column} TYPE jsonb USING {column}::jsonb"
                        ))
                        .await
                        .unwrap();
                    }
                    infra::scheduler::init().await.unwrap();
                })
                .await;
            eprintln!("meta store: postgres");
            LOCK.lock().await
        }

        async fn status(org_id: &str, id: &str) -> String {
            infra::table::alert_incidents::get_rw(org_id, id)
                .await
                .unwrap()
                .unwrap()
                .status
        }

        async fn links_resolved_at(id: &str) -> Vec<Option<i64>> {
            infra::table::alert_incidents::get_incident_alerts(id)
                .await
                .unwrap()
                .iter()
                .map(|l| l.resolved_at)
                .collect()
        }

        /// The follow-up steps of an unmuted resolve where on-call is unlicensed, as in unit tests.
        fn off() -> Repairs {
            Repairs {
                oncall: OncallRecovery::Off,
                failed: Vec::new(),
            }
        }

        /// An unmuted resolve's follow-up steps; on-call recovery runs wherever on-call is on.
        fn unmuted() -> Repairs {
            Repairs {
                oncall: if o2_enterprise::enterprise::oncall::is_enabled() {
                    OncallRecovery::Ran
                } else {
                    OncallRecovery::Off
                },
                failed: Vec::new(),
            }
        }

        async fn resolved_by_system(org_id: &str, id: &str) -> bool {
            use config::meta::alerts::incidents::IncidentEventType;

            infra::table::incident_events::get(org_id, id)
                .await
                .unwrap()
                .iter()
                .any(|e| {
                    matches!(&e.event_type, IncidentEventType::Resolved { user_id: Some(u) }
                        if u == "system@openobserve.ai")
                })
        }

        #[tokio::test]
        async fn a_recovered_finding_resolves_its_unacknowledged_incident_unmuted() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            let id = open(&f, &pager).await.unwrap();
            assert_ne!(status(&org, &id).await, "resolved");
            let resolved =
                recover_finding_firing(&org, &f.subject_id, ONSET, BACK, &ClusterIncidentTurns)
                    .await;
            assert_eq!(
                resolved.unwrap(),
                (true, Some(unmuted())),
                "resolved here, unmuted"
            );
            assert_eq!(status(&org, &id).await, "resolved");
            assert_eq!(links_resolved_at(&id).await, [Some(BACK)]);
            assert!(resolved_by_system(&org, &id).await);
            let again = resolve_finding_firing(&org, &f.subject_id, ONSET, BACK + QUARTER_HOUR);
            assert!(!again.await.unwrap(), "already resolved");
            assert_eq!(
                links_resolved_at(&id).await,
                [Some(BACK)],
                "first value kept"
            );
        }

        #[tokio::test]
        async fn a_retry_after_a_cut_short_resolve_runs_its_follow_up_steps_again() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            let id = open(&f, &pager).await.unwrap();
            infra::table::alert_incidents::update_status(&org, &id, "resolved")
                .await
                .unwrap();
            assert!(!resolved_by_system(&org, &id).await);
            let again =
                recover_finding_firing(&org, &f.subject_id, ONSET, BACK, &ClusterIncidentTurns)
                    .await;
            assert_eq!(again.unwrap(), (false, Some(unmuted())));
            assert_eq!(links_resolved_at(&id).await, [Some(BACK)]);
            let told = resolve_finding_firing(&org, &f.subject_id, ONSET, BACK).await;
            assert!(!told.unwrap(), "resolved before this call");
            let events = infra::table::incident_events::get(&org, &id).await.unwrap();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(
                        event.event_type,
                        config::meta::alerts::incidents::IncidentEventType::Resolved { .. }
                    ))
                    .count(),
                1,
                "interrupted resolution is repaired exactly once"
            );
        }

        /// The production incident turn, held once before one follow-up step.
        struct Paused(Arc<Gate>);

        #[async_trait::async_trait]
        impl IncidentTurns for Paused {
            async fn take(&self, org_id: &str, incident_id: &str) -> anyhow::Result<IncidentTurn> {
                let mut turn = ClusterIncidentTurns.take(org_id, incident_id).await?;
                let lease = LeaseWatch {
                    key: incident_id.to_string(),
                    lost: None,
                };
                let gate = self.0.clone();
                turn.fence = Arc::new(Gated { lease, gate });
                Ok(turn)
            }
        }

        /// The incident's resolves and reopens, oldest first.
        async fn status_events(org_id: &str, id: &str) -> Vec<&'static str> {
            use config::meta::alerts::incidents::IncidentEventType;

            let events = infra::table::incident_events::get(org_id, id)
                .await
                .unwrap();
            let named = events.iter().filter_map(|e| match &e.event_type {
                IncidentEventType::Resolved { .. } => Some("resolved"),
                IncidentEventType::Reopened { .. } => Some("reopened"),
                _ => None,
            });
            named.collect()
        }

        #[tokio::test]
        async fn a_reopen_waits_for_every_follow_up_step_of_a_resolve_and_of_its_repair() {
            let _db = store().await;
            let steps = [
                FenceStep::OncallRecovery,
                FenceStep::StatusEvent,
                FenceStep::Analysis,
                FenceStep::StatusPublish,
            ];
            for (repair, step) in [false, true]
                .into_iter()
                .flat_map(|r| steps.map(|s| (r, s)))
            {
                let case = format!("repair {repair}, paused before {step:?}");
                let (org, pager) = (new_org(), Pager::default());
                let f = finding(&org, ONSET);
                let id = open(&f, &pager).await.unwrap();
                if repair {
                    infra::table::alert_incidents::update_status(&org, &id, "resolved")
                        .await
                        .unwrap();
                }
                let gate = Gate::at(step, true);
                let paused = Paused(gate.clone());
                let recovery = recover_finding_firing(&org, &f.subject_id, ONSET, BACK, &paused);
                let person = async {
                    gate.arrived().await;
                    let reopen = update_status(&org, &id, "open", PERSON);
                    tokio::pin!(reopen);
                    let early = tokio::time::timeout(WAIT, &mut reopen).await;
                    assert!(early.is_err(), "{case}: the reopen waits for the turn");
                    assert_eq!(status(&org, &id).await, "resolved", "{case}");
                    gate.resume.notify_one();
                    reopen.await
                };
                let (recovered, reopened) = tokio::join!(recovery, person);
                assert_eq!(recovered.unwrap(), (!repair, Some(unmuted())), "{case}");
                assert_eq!(reopened.unwrap().status.to_string(), "open", "{case}");
                assert_eq!(status(&org, &id).await, "open", "{case}");
                assert_eq!(
                    status_events(&org, &id).await,
                    ["resolved", "reopened"],
                    "{case}: every resolve step landed before the reopen"
                );
            }
        }

        #[tokio::test]
        async fn a_findings_first_onset_after_a_manual_reopen_takes_the_reopen_once() {
            use config::meta::alerts::incidents::IncidentCorrelationOutcome as Outcome;

            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let own = |at| FindingIncident {
                cohort: false,
                ..finding(&org, at)
            };
            let id = open(&own(ONSET), &pager).await.unwrap();
            infra::table::alert_incidents::update_status(&org, &id, "resolved")
                .await
                .unwrap();
            update_status(&org, &id, "open", PERSON).await.unwrap();
            let mut taken = Vec::new();
            for at in [ONSET + QUARTER_HOUR, ONSET + 2 * QUARTER_HOUR] {
                let outcome = open_finding_incident_with(&own(at), &pager, &ClusterTurns).await;
                taken.push(outcome.unwrap());
            }
            let service_name = UNKNOWN_SERVICE.to_string();
            assert_eq!(
                taken,
                [
                    Outcome::FiredAfterReopen {
                        incident_id: id.clone(),
                        service_name: service_name.clone(),
                    },
                    Outcome::ExistingAlertRepeated {
                        incident_id: id,
                        service_name,
                    },
                ],
                "the fenced manual reopen waits for one firing, as an alert's does"
            );
        }

        #[tokio::test]
        async fn a_recovery_waits_for_a_status_change_in_progress_but_on_calls_close_does_not() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            let id = open(&f, &pager).await.unwrap();
            let turn = ClusterIncidentTurns.take(&org, &id).await.unwrap();
            let recovery = resolve_finding_firing(&org, &f.subject_id, ONSET, BACK);
            tokio::pin!(recovery);
            let early = tokio::time::timeout(WAIT, &mut recovery).await;
            assert!(early.is_err(), "the recovery waits for the turn");
            assert_eq!(status(&org, &id).await, "open");
            // The write on-call's promoted-incident close makes from inside an on-call step.
            let close = infra::table::alert_incidents::update_status(&org, &id, "resolved");
            let closed = tokio::time::timeout(WAIT, close).await;
            let closed = closed.expect("on-call's close takes no turn, so it cannot deadlock");
            assert_eq!(closed.unwrap().status, "resolved");
            turn.end().await;
            assert!(!recovery.await.unwrap(), "on-call resolved it first");
            assert_eq!(
                status_events(&org, &id).await,
                ["resolved"],
                "repaired once"
            );
        }

        #[tokio::test]
        async fn a_recovery_retried_after_a_reopen_keeps_what_people_and_new_firings_did() {
            let _db = store().await;
            for case in ["acknowledged", "assigned", "new firing"] {
                let (org, pager) = (new_org(), Pager::default());
                let f = finding(&org, ONSET);
                let id = open(&f, &pager).await.unwrap();
                infra::table::alert_incidents::update_status(&org, &id, "resolved")
                    .await
                    .unwrap();
                update_status(&org, &id, "open", PERSON).await.unwrap();
                match case {
                    "acknowledged" => {
                        let acked = infra::table::alert_incidents::acknowledge(&org, &id, PERSON);
                        assert!(acked.await.unwrap().is_some(), "{case}");
                    }
                    "assigned" => {
                        incident_rows::Entity::update_many()
                            .col_expr(incident_rows::Column::AssignedTo, Expr::value(PERSON))
                            .filter(incident_rows::Column::Id.eq(&id))
                            .exec(infra::db::get_orm_client_rw().await)
                            .await
                            .unwrap();
                    }
                    _ => {
                        let later = finding(&org, ONSET + QUARTER_HOUR);
                        assert_eq!(open(&later, &pager).await.unwrap(), id, "{case}");
                    }
                }
                let turns = &ClusterIncidentTurns;
                let again = recover_finding_firing(&org, &f.subject_id, ONSET, BACK, turns).await;
                assert_eq!(
                    again.unwrap(),
                    (false, None),
                    "{case}: no follow-up step ran"
                );
                let row = infra::table::alert_incidents::get_rw(&org, &id)
                    .await
                    .unwrap();
                let row = row.unwrap();
                assert_ne!(row.status, "resolved", "{case}");
                assert_eq!(row.resolved_at, None, "{case}");
                assert_eq!(status_events(&org, &id).await, ["reopened"], "{case}");
            }
        }

        #[tokio::test]
        async fn a_status_publish_in_flight_holds_off_a_reopen_and_a_late_one_sends_nothing() {
            use infra::table::alert_incidents::{Episode, update_status};

            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let id = open(&finding(&org, ONSET), &pager).await.unwrap();
            let resolved = Episode::of(&update_status(&org, &id, "resolved").await.unwrap());
            let sent = Arc::new(Mutex::new(Vec::new()));
            let (started, sending) = tokio::sync::oneshot::channel::<()>();
            let (release, released) = tokio::sync::oneshot::channel::<()>();
            let log = sent.clone();
            let publish = async move {
                started.send(()).unwrap();
                released.await.unwrap();
                log.lock().unwrap().push("resolved");
                true
            };
            let (o, i, e) = (org.clone(), id.clone(), resolved.clone());
            let in_flight =
                tokio::spawn(async move { publish_in_episode(&o, &i, &e, publish).await });
            sending.await.unwrap();

            // A reopen on the node that took the turn after this one lost its lease.
            let reopen = update_status(&org, &id, "open");
            tokio::pin!(reopen);
            let early = tokio::time::timeout(WAIT, &mut reopen).await;
            assert!(early.is_err(), "the reopen waits for the publish in flight");
            release.send(()).unwrap();
            assert!(in_flight.await.unwrap(), "the publish in flight completes");
            assert_eq!(reopen.await.unwrap().status, "open");

            let log = sent.clone();
            let late = async move {
                log.lock().unwrap().push("stale resolved");
                true
            };
            assert!(
                publish_in_episode(&org, &id, &resolved, late).await,
                "a dropped stale publish leaves nothing to retry"
            );
            assert_eq!(
                *sent.lock().unwrap(),
                ["resolved"],
                "no stale status after the reopen"
            );
        }

        /// [resolved_by_system] read on the primary, for a test whose replica is another database.
        async fn primary_resolved_by_system(org_id: &str, id: &str) -> bool {
            use infra::table::entity::incident_events;

            let row = incident_events::Entity::find()
                .filter(incident_events::Column::OrgId.eq(org_id))
                .filter(incident_events::Column::IncidentId.eq(id))
                .one(infra::db::get_orm_client_rw().await)
                .await
                .unwrap();
            let events = row.map(|r| r.events).unwrap_or_default();
            let events = events.as_array().cloned().unwrap_or_default();
            events.iter().any(|e| {
                let e = e.to_string();
                e.contains("esolved") && e.contains(SYSTEM_USER_EMAIL)
            })
        }

        #[tokio::test]
        #[ignore = "needs ZO_META_STORE=postgres and ZO_META_POSTGRES_RO_DSN on another database"]
        async fn a_stale_replica_never_decides_a_resolve_or_its_mute() {
            use sea_orm::{ActiveModelTrait, ConnectionTrait, IntoActiveModel, Schema, Set};

            let _db = store().await;
            let cfg = config::get_config();
            let (rw, ro) = (
                &cfg.common.meta_postgres_dsn,
                &cfg.common.meta_postgres_ro_dsn,
            );
            assert_eq!(cfg.common.meta_store, "postgres");
            assert!(
                !ro.is_empty() && ro != rw,
                "the replica must be its own database"
            );
            let replica = infra::db::get_orm_client_ro().await;
            let backend = replica.get_database_backend();
            for mut table in [
                Schema::new(backend).create_table_from_entity(incident_rows::Entity),
                Schema::new(backend)
                    .create_table_from_entity(infra::table::entity::alert_incident_alerts::Entity),
            ] {
                replica
                    .execute(backend.build(table.if_not_exists()))
                    .await
                    .unwrap();
            }
            for primary_resolved in [true, false] {
                let (org, pager) = (new_org(), Pager::default());
                let f = finding(&org, ONSET);
                let id = open(&f, &pager).await.unwrap();
                if primary_resolved {
                    infra::table::alert_incidents::update_status(&org, &id, "resolved")
                        .await
                        .unwrap();
                } else {
                    incident_rows::Entity::update_many()
                        .col_expr(
                            incident_rows::Column::MutedByDowntimeId,
                            Expr::value("dt-1"),
                        )
                        .filter(incident_rows::Column::Id.eq(&id))
                        .exec(infra::db::get_orm_client_rw().await)
                        .await
                        .unwrap();
                }
                let primary = infra::table::alert_incidents::get_rw(&org, &id)
                    .await
                    .unwrap();
                let mut stale = primary.unwrap().into_active_model();
                stale.status = Set(if primary_resolved { "open" } else { "resolved" }.into());
                stale.muted_by_downtime_id = Set(primary_resolved.then(|| "dt-stale".to_string()));
                stale.reset_all().insert(replica).await.unwrap();
                let turns = &ClusterIncidentTurns;
                let told = recover_finding_firing(&org, &f.subject_id, ONSET, BACK, turns).await;
                let case = format!("primary resolved {primary_resolved}");
                if primary_resolved {
                    assert_eq!(
                        told.unwrap(),
                        (false, Some(off())),
                        "{case}: repaired unmuted"
                    );
                    assert!(primary_resolved_by_system(&org, &id).await, "{case}");
                } else {
                    let muted = Repairs {
                        oncall: OncallRecovery::Muted,
                        failed: Vec::new(),
                    };
                    assert_eq!(told.unwrap(), (true, Some(muted)), "{case}: resolved muted");
                    assert!(!primary_resolved_by_system(&org, &id).await, "{case}");
                }
                assert_eq!(status(&org, &id).await, "resolved", "{case}");
            }
            eprintln!("stale replica arm ran");
        }

        #[test]
        fn an_unfinished_follow_up_step_fails_the_recovery_so_the_engine_retries() {
            let repairs = |oncall, failed: &[&'static str]| Repairs {
                oncall,
                failed: failed.to_vec(),
            };
            let err = finished(true, Some(&repairs(OncallRecovery::Failed, &[]))).unwrap_err();
            assert!(err.to_string().contains("on-call recovery"), "{err}");
            for step in [
                "link publish",
                "analysis stop",
                "status publish",
                "resolution event",
            ] {
                let err = finished(true, Some(&repairs(OncallRecovery::Ran, &[step]))).unwrap_err();
                assert!(err.to_string().contains(step), "{err}");
            }
            assert!(finished(true, Some(&off())).unwrap());
            assert!(!finished(false, Some(&repairs(OncallRecovery::Muted, &[]))).unwrap());
            assert!(!finished(false, None).unwrap());
        }

        #[tokio::test]
        async fn an_acknowledged_or_assigned_incident_gets_its_link_resolved_and_stays_open() {
            let _db = store().await;
            for column in [
                incident_rows::Column::AcknowledgedBy,
                incident_rows::Column::AssignedTo,
            ] {
                let (org, pager) = (new_org(), Pager::default());
                let f = finding(&org, ONSET);
                let id = open(&f, &pager).await.unwrap();
                incident_rows::Entity::update_many()
                    .col_expr(column, Expr::value("someone@example.com"))
                    .filter(incident_rows::Column::Id.eq(&id))
                    .exec(infra::db::get_orm_client_rw().await)
                    .await
                    .unwrap();
                let resolved = resolve_finding_firing(&org, &f.subject_id, ONSET, BACK).await;
                assert!(!resolved.unwrap(), "{column:?}");
                assert_ne!(status(&org, &id).await, "resolved", "{column:?}");
                assert_eq!(links_resolved_at(&id).await, [Some(BACK)], "{column:?}");
                assert!(!resolved_by_system(&org, &id).await, "{column:?}");
            }
        }

        #[tokio::test]
        async fn an_incident_a_security_detection_fired_into_gets_its_link_resolved_and_stays_open()
        {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            let id = open(&f, &pager).await.unwrap();
            let mut detection = config::meta::alerts::alert::Alert::default();
            detection.org_id.clone_from(&org);
            detection.context_attributes = Some(
                [(
                    config::meta::alerts::alert::SIEM_ATTRIBUTE.to_string(),
                    "true".to_string(),
                )]
                .into_iter()
                .collect(),
            );
            common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key(&org, "siem-detection"),
                (Default::default(), detection),
            );
            infra::table::alert_incidents::add_alert_to_incident(
                &id,
                "siem-detection",
                "brute force",
                AlertKind::Internal.as_str(),
                ONSET,
                "alert_id",
            )
            .await
            .unwrap();
            infra::table::alert_incidents::resolve_alert_firings(&id, "siem-detection", BACK)
                .await
                .unwrap();
            let resolved = resolve_finding_firing(&org, &f.subject_id, ONSET, BACK).await;
            assert!(
                !resolved.unwrap(),
                "a detection's incident is an analyst's to close"
            );
            assert_eq!(links_resolved_at(&id).await, [Some(BACK), Some(BACK)]);
            assert_ne!(status(&org, &id).await, "resolved");
            assert!(!resolved_by_system(&org, &id).await);
        }

        #[tokio::test]
        async fn no_incident_holding_the_firing_resolves_nothing_and_writes_nothing() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let f = finding(&org, ONSET);
            let id = open(&f, &pager).await.unwrap();
            let other = new_org();
            for (org_id, subject, at) in [
                (org.as_str(), f.subject_id.as_str(), ONSET + QUARTER_HOUR),
                (org.as_str(), "autoobserve:finding-b", ONSET),
                (other.as_str(), f.subject_id.as_str(), ONSET),
            ] {
                let resolved = resolve_finding_firing(org_id, subject, at, BACK).await;
                assert!(!resolved.unwrap(), "{org_id} {subject} {at}");
            }
            assert_eq!(links_resolved_at(&id).await, [None]);
            assert_ne!(status(&org, &id).await, "resolved");
            assert!(!resolved_by_system(&org, &id).await);
        }

        #[tokio::test]
        async fn two_firings_of_one_finding_in_one_incident_both_resolve_then_the_incident() {
            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let id = open(&finding(&org, ONSET), &pager).await.unwrap();
            let later = finding(&org, ONSET + QUARTER_HOUR);
            assert_eq!(open(&later, &pager).await.unwrap(), id);
            let resolved =
                resolve_finding_firing(&org, &later.subject_id, later.triggered_at, BACK).await;
            assert!(resolved.unwrap());
            assert_eq!(links_resolved_at(&id).await, [Some(BACK), Some(BACK)]);
            assert_eq!(status(&org, &id).await, "resolved");
        }

        #[tokio::test]
        async fn a_recovery_resolves_the_incident_its_page_opened() {
            use o2_enterprise::enterprise::autoobserve::{
                contract::{ActionKind, ActionRequest},
                names::{decision_kinds, kinds},
                plugins::stream::page_subject,
                ports::Recovery,
            };

            use crate::autoobserve::incidents::{finding_incident, recovery_subject};

            let _db = store().await;
            let (org, pager) = (new_org(), Pager::default());
            let request = ActionRequest {
                org: org.clone(),
                entity_type: kinds::STREAM.into(),
                entity_id: "logs/checkout".into(),
                decision_kind: decision_kinds::STREAM_SILENCE.into(),
                group_key: String::new(),
                action: ActionKind::Investigate,
                signal_at: ONSET,
                peers: Vec::new(),
            };
            let f = finding_incident(&page_subject(&request).unwrap(), &org, &[]);
            let id = open(&f, &pager).await.unwrap();
            let recovery = Recovery {
                org: org.clone(),
                decision_kind: request.decision_kind.clone(),
                entity_id: request.entity_id.clone(),
                signal_at: ONSET,
                recovered_at: BACK,
            };
            let subject = recovery_subject(&recovery);
            let resolved = resolve_finding_firing(&org, &subject, ONSET, BACK).await;
            assert!(resolved.unwrap());
            assert_eq!(status(&org, &id).await, "resolved");
        }
    }

    use super::*;

    async fn correlation_db() -> sea_orm::DatabaseConnection {
        use infra::table::entity::alert_incidents;
        use sea_orm::{ConnectionTrait, Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(alert_incidents::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        db
    }

    async fn store_correlation_incident(
        db: &sea_orm::DatabaseConnection,
        id: &str,
        created_at: i64,
        group_values: serde_json::Value,
    ) -> infra::table::entity::alert_incidents::Model {
        use infra::table::entity::alert_incidents;
        use sea_orm::ActiveModelTrait;

        let mut row = incident(None);
        row.id = id.to_string();
        row.created_at = created_at;
        row.group_values = group_values;
        let active: alert_incidents::ActiveModel = row.into();
        active.reset_all().insert(db).await.unwrap()
    }

    #[tokio::test]
    async fn correlation_selection_preserves_matching_and_legacy_fallbacks() {
        use sea_orm::ConnectionTrait;

        let incoming = HashMap::from([
            ("ns".to_string(), "prod".to_string()),
            ("cluster".to_string(), "a".to_string()),
        ]);
        let cases = [
            Some(serde_json::json!({"ns": "prod", "cluster": "a"})),
            Some(serde_json::json!({"ns": "prod"})),
            Some(serde_json::json!({"ns": "prod", "cluster": "a", "pod": "p1"})),
            Some(serde_json::json!({})),
            Some(serde_json::json!({"ns": 1})),
            Some(serde_json::Value::Null),
            Some(serde_json::json!(["legacy"])),
            None,
        ];
        for dimensions in cases {
            let db = correlation_db().await;
            if let Some(dimensions) = &dimensions {
                store_correlation_incident(&db, "older", 1, dimensions.clone()).await;
                store_correlation_incident(&db, "selected", 2, dimensions.clone()).await;
            }
            store_correlation_incident(&db, "conflicting", 3, serde_json::json!({"ns": "dev"}))
                .await;
            store_correlation_incident(
                &db,
                "partial",
                4,
                serde_json::json!({"ns": "prod", "db": "redis"}),
            )
            .await;
            db.execute_unprepared(
                "UPDATE alert_incidents SET topology_context = 'invalid JSON' WHERE id IN ('conflicting', 'partial')",
            )
            .await
            .unwrap();
            let candidates =
                infra::table::alert_incidents::find_correlation_candidates_with(&db, "default")
                    .await
                    .unwrap();
            let found = select_correlation_candidate(&db, "default", &incoming, candidates)
                .await
                .unwrap();
            assert_eq!(
                found.as_ref().map(|row| row.id.as_str()),
                dimensions.as_ref().map(|_| "selected"),
                "stored dimensions: {dimensions:?}"
            );
        }
    }

    #[tokio::test]
    async fn correlation_selection_continues_after_stale_projected_matches() {
        use infra::table::entity::alert_incidents;
        use sea_orm::{ActiveModelTrait, EntityTrait, Set};

        let same = serde_json::json!({"ns": "prod", "cluster": "a"});
        let incoming = serde_json::from_value(same.clone()).unwrap();
        let changes = [
            None,
            Some(("default", "resolved", same.clone())),
            Some(("other", "open", same.clone())),
            Some(("default", "open", serde_json::json!({"ns": "dev"}))),
            Some((
                "default",
                "open",
                serde_json::json!({"ns": "prod", "db": "redis"}),
            )),
        ];
        for change in changes {
            let db = correlation_db().await;
            store_correlation_incident(&db, "older", 1, same.clone()).await;
            let newest = store_correlation_incident(&db, "newest", 2, same.clone()).await;
            let candidates =
                infra::table::alert_incidents::find_correlation_candidates_with(&db, "default")
                    .await
                    .unwrap();
            if let Some((org, status, dimensions)) = change {
                let mut active: alert_incidents::ActiveModel = newest.into();
                active.org_id = Set(org.to_string());
                active.status = Set(status.to_string());
                active.group_values = Set(dimensions);
                active.update(&db).await.unwrap();
            } else {
                alert_incidents::Entity::delete_by_id("newest")
                    .exec(&db)
                    .await
                    .unwrap();
            }
            let found = select_correlation_candidate(&db, "default", &incoming, candidates)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(found.id, "older");
        }
    }

    #[tokio::test]
    async fn correlation_selection_returns_current_compatible_dimensions() {
        use infra::table::entity::alert_incidents;
        use sea_orm::{ActiveModelTrait, Set};

        let db = correlation_db().await;
        let original = serde_json::json!({"ns": "prod", "cluster": "a", "pod": "p1"});
        let current = serde_json::json!({"ns": "prod"});
        let row = store_correlation_incident(&db, "newest", 1, original).await;
        let candidates =
            infra::table::alert_incidents::find_correlation_candidates_with(&db, "default")
                .await
                .unwrap();
        let mut active: alert_incidents::ActiveModel = row.into();
        active.group_values = Set(current.clone());
        active.update(&db).await.unwrap();
        let incoming = HashMap::from([
            ("ns".to_string(), "prod".to_string()),
            ("cluster".to_string(), "a".to_string()),
        ]);
        let found = select_correlation_candidate(&db, "default", &incoming, candidates)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found.group_values, current);
    }

    #[tokio::test]
    async fn correlation_selection_propagates_selected_lookup_errors() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let incoming = HashMap::from([("ns".to_string(), "prod".to_string())]);
        let candidates = vec![infra::table::alert_incidents::CorrelationCandidate {
            id: "selected".to_string(),
            group_values: serde_json::json!({"ns": "prod"}),
        }];
        assert!(matches!(
            select_correlation_candidate(&db, "default", &incoming, candidates).await,
            Err(infra::errors::Error::DbError(
                infra::errors::DbError::SeaORMError(_)
            ))
        ));
        assert!(
            select_correlation_candidate(&db, "default", &incoming, Vec::new())
                .await
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn firings_on_one_entity_share_a_case_lock() {
        let dims = |pairs: &[(&str, &str)]| -> HashMap<String, String> {
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        };
        let a = siem_case_lock("org", &dims(&[("security_host", "win-1")]));
        let b = siem_case_lock("org", &dims(&[("security_host", "win-1")]));
        assert!(std::ptr::eq(a, b));
        let both = siem_case_lock("org", &dims(&[("a", "1"), ("b", "2")]));
        let swapped = siem_case_lock("org", &dims(&[("b", "2"), ("a", "1")]));
        assert!(std::ptr::eq(both, swapped));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_incident_send_is_keyed_by_the_incident_id() {
        use config::meta::alerts::notification_kind::{NotificationEvent, NotificationKind};
        let mut ctx = crate::alerts::notifications::NotificationContext {
            episode_id: Some("alert-episode".into()),
            ..Default::default()
        };
        apply_incident_to_context(
            &mut ctx,
            "inc_1",
            "severity_escalated",
            "High error rate",
            "P1",
            "checkout",
            "https://o2/web/alerts/incidents/inc_1",
        );
        assert_eq!(ctx.kind, NotificationKind::Incident);
        assert_eq!(ctx.event, NotificationEvent::Firing);
        assert_eq!(ctx.episode_id.as_deref(), Some("inc_1"));
        assert_eq!(ctx.alert_url, "https://o2/web/alerts/incidents/inc_1");
        let route =
            crate::alerts::notifications::notify::route(&pagerduty_resolved(), &ctx).unwrap();
        assert_eq!(route, crate::alerts::notifications::notify::Route::Render);
        // Strict D8: an incident sends no recovery today, so a platform hears nothing on resolve.
        ctx.event = NotificationEvent::Resolved;
        assert!(matches!(
            crate::alerts::notifications::notify::route(&pagerduty_resolved(), &ctx),
            Err(crate::alerts::notifications::notify::NotifyError::Skipped(
                _
            ))
        ));
    }

    #[cfg(feature = "enterprise")]
    fn pagerduty_resolved() -> crate::alerts::notifications::notify::Resolved {
        use crate::alerts::notifications::org_default::{
            EffectiveTemplate, TemplateSource, compiled_fallback,
        };
        let dest_type = config::meta::destinations::DestinationType::Http(
            config::meta::destinations::Endpoint {
                destination_type: Some("pagerduty".into()),
                url: "https://events.pagerduty.com/v2/enqueue".into(),
                ..Default::default()
            },
        );
        crate::alerts::notifications::notify::Resolved {
            destination: Default::default(),
            channel: crate::alerts::notifications::derive_channel_format(&dest_type),
            destination_type: dest_type,
            effective: EffectiveTemplate {
                template: compiled_fallback("org"),
                source: TemplateSource::Compiled,
                skipped: vec![],
            },
        }
    }

    /// The incident path and the alert path page the same person about the same
    /// alert, so an unset priority has to mean the same thing on both. They used
    /// to differ — P2 here, P3 in `scheduler::handlers` — which made
    /// `creates_incident` a hidden severity switch.
    #[test]
    fn a_resolve_caused_by_a_muted_recovery_is_quiet() {
        assert!(
            status_change_is_muted(true, None),
            "an incident opened before the window"
        );
        assert!(status_change_is_muted(false, Some("dt-1")));
        assert!(!status_change_is_muted(false, None));
    }

    #[test]
    fn finding_dims_never_absorb_or_are_absorbed_by_an_alert() {
        use config::meta::alerts::incidents::DimensionRelationship;

        let ours = finding_dimensions("stream_silence", "logs", "checkout");
        assert_eq!(ours.len(), 3);
        assert_eq!(ours[FINDING_KIND_DIMENSION], "stream_silence");
        assert_eq!(ours[FINDING_STREAM_TYPE_DIMENSION], "logs");
        assert_eq!(ours[FINDING_STREAM_NAME_DIMENSION], "checkout");
        let alert = HashMap::from([("service".to_string(), "api".to_string())]);
        assert_eq!(
            DimensionRelationship::check(&ours, &alert),
            DimensionRelationship::PartialOverlap
        );
        assert_eq!(
            DimensionRelationship::check(&ours, &HashMap::new()),
            DimensionRelationship::PartialOverlap
        );
    }

    #[test]
    fn the_not_run_reason_names_what_is_off() {
        assert_eq!(rca_off_reason_for(false, true), Some(RCA_OFF_DISABLED));
        assert_eq!(rca_off_reason_for(false, false), Some(RCA_OFF_DISABLED));
        assert_eq!(
            rca_off_reason_for(true, false),
            Some(RCA_OFF_AI_UNAVAILABLE)
        );
        assert_eq!(rca_off_reason_for(true, true), None);
        let codes = [
            RCA_OFF_DISABLED,
            RCA_OFF_AI_UNAVAILABLE,
            RCA_OFF_QUOTA,
            RCA_OFF_COOLING_DOWN,
            RCA_OFF_START_FAILED,
        ];
        let distinct: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(distinct.len(), codes.len());
        assert!(
            !codes.contains(&"l0_off"),
            "the team's L0 reason keeps its meaning"
        );
    }

    #[test]
    fn test_the_incident_path_uses_the_shared_default_priority() {
        assert_eq!(
            config::meta::oncall::DEFAULT_PAGING_PRIORITY,
            config::meta::alerts::priority::AlertPriority::P2,
            "the shared default must stay the louder of the two"
        );
    }

    /// B-29: a P1 alert must map to a P1 incident severity, not the eval_level
    /// default. This is the exact mapping `correlate_alert_to_incident` uses to
    /// pre-populate `CorrelationSubject.severity` for the internal alert path.
    #[test]
    fn test_alert_priority_maps_to_incident_severity() {
        use config::meta::alerts::{incidents::IncidentSeverity, priority::AlertPriority};

        let map = |p: AlertPriority| -> Option<IncidentSeverity> {
            o2_enterprise::enterprise::alerts::incidents::determine_severity(Some(p.as_str()))
                .parse()
                .ok()
        };

        assert_eq!(map(AlertPriority::P1), Some(IncidentSeverity::P1));
        assert_eq!(map(AlertPriority::P2), Some(IncidentSeverity::P2));
        assert_eq!(map(AlertPriority::P4), Some(IncidentSeverity::P4));

        // The two that reach the mapping's default arm, and so were the two it
        // could get wrong unnoticed. P5 mapped to P3 until 2026-08-24 — the
        // least urgent priority opening a more severe incident than P4 does.
        assert_eq!(map(AlertPriority::P3), Some(IncidentSeverity::P3));
        assert_eq!(map(AlertPriority::P5), Some(IncidentSeverity::P4));

        // Five priorities into four severities, and the ordering has to survive
        // the join: a less urgent alert must never open a more severe incident.
        let rank = |s: IncidentSeverity| match s {
            IncidentSeverity::P1 => 4,
            IncidentSeverity::P2 => 3,
            IncidentSeverity::P3 => 2,
            IncidentSeverity::P4 => 1,
        };
        let ranks: Vec<i32> = [
            AlertPriority::P1,
            AlertPriority::P2,
            AlertPriority::P3,
            AlertPriority::P4,
            AlertPriority::P5,
        ]
        .into_iter()
        .map(|p| rank(map(p).expect("every priority maps")))
        .collect();
        assert!(
            ranks.windows(2).all(|w| w[0] >= w[1]),
            "severity must not increase as priority falls: {ranks:?}"
        );
    }

    #[test]
    fn test_merge_dimensions_adds_new_keys() {
        let mut existing = HashMap::from([("ns".to_string(), "prod".to_string())]);
        let new = HashMap::from([("cluster".to_string(), "us-east".to_string())]);
        let changed = merge_dimensions(&mut existing, &new, "inc-1");
        assert!(changed);
        assert_eq!(existing["cluster"], "us-east");
    }

    #[test]
    fn test_merge_dimensions_no_change_same_values() {
        let mut existing = HashMap::from([("ns".to_string(), "prod".to_string())]);
        let new = HashMap::from([("ns".to_string(), "prod".to_string())]);
        let changed = merge_dimensions(&mut existing, &new, "inc-2");
        assert!(!changed);
        assert_eq!(existing.len(), 1);
    }

    #[test]
    fn test_merge_dimensions_conflict_keeps_existing() {
        let mut existing = HashMap::from([("region".to_string(), "us-east".to_string())]);
        let new = HashMap::from([("region".to_string(), "us-west".to_string())]);
        let changed = merge_dimensions(&mut existing, &new, "inc-3");
        assert!(!changed);
        assert_eq!(existing["region"], "us-east");
    }

    #[test]
    fn test_merge_dimensions_empty_new() {
        let mut existing = HashMap::from([("ns".to_string(), "prod".to_string())]);
        let changed = merge_dimensions(&mut existing, &HashMap::new(), "inc-4");
        assert!(!changed);
        assert_eq!(existing.len(), 1);
    }

    #[test]
    fn test_merge_correlation_results_sd_wins_over_semantic() {
        use config::meta::alerts::incidents::KeyType;
        let sd = ServiceDiscoveryResult {
            group_values: [("ns".to_string(), "prod".to_string())].into(),
            key_type: KeyType::Primary,
            service_name: "svc-a".to_string(),
            service_name_from_stream: false,
        };
        let sem = FilteredSemanticResult {
            group_values: [("region".to_string(), "us-east".to_string())].into(),
            key_type: KeyType::Secondary,
        };
        let (dims, key_type, reason) = merge_correlation_results(&Some(sd), &Some(sem));
        assert_eq!(dims.get("ns").map(|s| s.as_str()), Some("prod"));
        assert!(matches!(key_type, KeyType::Primary));
        assert_eq!(reason, "service_discovery");
    }

    #[test]
    fn test_merge_correlation_results_semantic_when_no_sd() {
        use config::meta::alerts::incidents::KeyType;
        let sem = FilteredSemanticResult {
            group_values: [("cluster".to_string(), "us-west".to_string())].into(),
            key_type: KeyType::Secondary,
        };
        let (dims, key_type, reason) = merge_correlation_results(&None, &Some(sem));
        assert_eq!(dims.get("cluster").map(|s| s.as_str()), Some("us-west"));
        assert!(matches!(key_type, KeyType::Secondary));
        assert_eq!(reason, "semantic_extraction");
    }

    #[test]
    fn test_merge_correlation_results_fallback_when_both_none() {
        use config::meta::alerts::incidents::KeyType;
        let (dims, key_type, reason) = merge_correlation_results(&None, &None);
        assert!(dims.is_empty());
        assert!(matches!(key_type, KeyType::AlertId));
        assert_eq!(reason, "alert_id_fallback");
    }

    #[tokio::test]
    async fn semantic_extraction_uses_the_settings_it_is_given() {
        use config::meta::correlation::IdentitySet;
        let identity = ServiceIdentityConfig {
            sets: vec![IdentitySet {
                id: "k8s".to_string(),
                label: "Kubernetes".to_string(),
                distinguish_by: vec!["k8s-namespace".to_string()],
            }],
            ..Default::default()
        };
        let groups = vec![
            FieldAlias::new("k8s-namespace", "Namespace", &["k8s_namespace_name"]),
            FieldAlias::new("service", "Service", &["service_name"]),
        ];
        let labels: HashMap<String, String> = [
            ("k8s_namespace_name".to_string(), "prod".to_string()),
            ("service_name".to_string(), "checkout".to_string()),
            ("host".to_string(), "node-1".to_string()),
        ]
        .into();

        let found = extract_filtered_semantic_dimensions("org-16560", &labels, &identity, &groups)
            .await
            .expect("the configured groups resolve");
        assert_eq!(
            found.group_values,
            HashMap::from([
                ("k8s-namespace".to_string(), "prod".to_string()),
                ("service".to_string(), "checkout".to_string()),
            ])
        );

        let opted_out = ServiceIdentityConfig {
            service_optional: true,
            ..Default::default()
        };
        assert!(
            extract_filtered_semantic_dimensions("org-16560", &labels, &opted_out, &groups)
                .await
                .is_none()
        );
    }

    #[test]
    fn test_extract_service_name_from_sd_result() {
        use config::meta::alerts::incidents::KeyType;
        let sd = ServiceDiscoveryResult {
            group_values: HashMap::new(),
            key_type: KeyType::Primary,
            service_name: "payment-service".to_string(),
            service_name_from_stream: false,
        };
        let labels = HashMap::new();
        let name = extract_service_name_parallel(&labels, &Some(sd));
        assert_eq!(name, "payment-service");
    }

    #[test]
    fn test_extract_service_name_from_labels_fallback() {
        let mut labels = HashMap::new();
        labels.insert("service".to_string(), "billing".to_string());
        let name = extract_service_name_parallel(&labels, &None);
        assert_eq!(name, "billing");
    }

    #[test]
    fn test_extract_service_name_defaults_to_unknown() {
        let name = extract_service_name_parallel(&HashMap::new(), &None);
        assert_eq!(name, UNKNOWN_SERVICE);
    }

    /// The not-found value is a sentinel, and routing must never treat it as a
    /// service. It used to: an org whose registry answered nothing routed every
    /// unidentifiable alert on this literal, so all of them landed on whichever
    /// team owned the phantom name `unknown`.
    ///
    /// Two halves to the guard: `names_a_service` asks `is_some_and`, so no
    /// discovery answer means no service, and the comparison against
    /// `UNKNOWN_SERVICE` catches discovery answering and still finding nothing.
    #[test]
    fn test_the_not_found_service_never_becomes_a_routing_dimension() {
        let absent: Option<ServiceDiscoveryResult> = None;
        assert!(
            !absent
                .as_ref()
                .is_some_and(|sd| !sd.service_name_from_stream),
            "no discovery answer must not read as naming a service"
        );

        let from_stream = Some(ServiceDiscoveryResult {
            group_values: HashMap::new(),
            key_type: config::meta::alerts::incidents::KeyType::Primary,
            service_name: "app_logs".to_string(),
            service_name_from_stream: true,
        });
        assert!(
            !from_stream
                .as_ref()
                .is_some_and(|sd| !sd.service_name_from_stream),
            "a stream name is a table name, not a service"
        );

        assert_eq!(
            extract_service_name_parallel(&HashMap::new(), &None),
            UNKNOWN_SERVICE,
            "the guard compares against this exact value, so the two must agree"
        );
    }

    fn incident(muted_by: Option<&str>) -> infra::table::entity::alert_incidents::Model {
        infra::table::entity::alert_incidents::Model {
            id: "inc-1".to_string(),
            org_id: "default".to_string(),
            status: "open".to_string(),
            severity: "P2".to_string(),
            group_values: serde_json::json!({}),
            key_type: "alert_id".to_string(),
            topology_context: None,
            first_alert_at: 1,
            last_alert_at: 1,
            resolved_at: None,
            alert_count: 1,
            title: None,
            assigned_to: None,
            acknowledged_by: None,
            acknowledged_at: None,
            created_at: 1,
            updated_at: 1,
            muted_by_downtime_id: muted_by.map(str::to_string),
            rca_run_id: None,
            rca_state: None,
            rca_started_at: None,
            rca_updated_at: None,
            rca_outcome: None,
            rca_confidence: None,
            rca_summary: None,
            rca_off_reason: None,
            security_case: false,
            historical: false,
        }
    }

    #[test]
    fn a_muted_firing_escalates_nothing_and_the_unmuting_firing_does() {
        use config::meta::alerts::{incidents::IncidentSeverity, level::AlertLevel};
        let mut opened_at_p3 = incident(Some("dt-1"));
        opened_at_p3.severity = "P3".to_string();
        assert!(firing_is_muted(Some("dt-1"), &opened_at_p3, false));
        assert!(firing_is_muted(None, &opened_at_p3, false));
        assert!(!firing_is_muted(None, &opened_at_p3, true));
        assert!(firing_is_muted(Some("dt-1"), &incident(None), false));
        assert!(!firing_is_muted(None, &incident(None), false));
        assert_eq!(
            escalated_severity(&opened_at_p3.severity, None, Some(AlertLevel::Critical)),
            Some((IncidentSeverity::P3, IncidentSeverity::P2)),
            "the opened message after the window carries P2"
        );
        assert_eq!(
            escalated_severity("P3", None, Some(AlertLevel::Warning)),
            None
        );
        assert_eq!(
            escalated_severity("P2", Some(IncidentSeverity::P1), Some(AlertLevel::Warning)),
            Some((IncidentSeverity::P2, IncidentSeverity::P1))
        );
        assert_eq!(escalated_severity("P2", None, None), None);
    }

    #[test]
    fn a_suppressed_firing_never_unmutes_and_names_the_downtime_that_mutes_it_now() {
        assert_eq!(
            mute_change(Some("dt-2"), Some("dt-1")),
            MuteChange::Retarget {
                from: "dt-1",
                to: "dt-2"
            }
        );
        assert_eq!(mute_change(Some("dt-1"), Some("dt-1")), MuteChange::Keep);
        assert_eq!(mute_change(Some("dt-1"), None), MuteChange::Keep);
        assert_eq!(mute_change(None, Some("dt-1")), MuteChange::Unmute("dt-1"));
        assert_eq!(mute_change(None, None), MuteChange::Keep);
    }

    fn oncall_record(
        incident_id: &str,
        state: config::meta::oncall::ResponseState,
    ) -> config::meta::oncall::Response {
        use config::meta::oncall::{ResponderRole, Response, SubjectRef, SubjectType};
        Response {
            id: format!("resp_{incident_id}"),
            org_id: "acme".into(),
            subject: SubjectRef::new(SubjectType::Alert, "al_1", 1),
            team_id: Some("team_1".into()),
            title: None,
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: None,
            ladder_run: None,
            priority: 2,
            responder_role: ResponderRole::Owner,
            exhausted_at: None,
            origin_response_id: None,
            state,
            opened_at: 0,
            acked_by: None,
            acked_at: None,
            closed_at: None,
            incident_id: Some(incident_id.into()),
            updated_at: 0,
        }
    }

    #[test]
    fn only_a_resolved_incident_with_an_open_record_is_recovered_after_the_window() {
        use config::meta::oncall::ResponseState;
        let record = |state| oncall_record("inc_1", state);
        assert!(holds_open_record(&[record(ResponseState::Triggered)]));
        assert!(holds_open_record(&[
            record(ResponseState::Resolved),
            record(ResponseState::Acknowledged)
        ]));
        assert!(!holds_open_record(&[record(ResponseState::Resolved)]));
        assert!(!holds_open_record(&[]));
    }

    #[test]
    fn a_resolve_reads_the_mute_only_with_downtimes_on() {
        assert!(reads_mute_before("resolved", true));
        assert!(
            !reads_mute_before("resolved", false),
            "no extra get with the flag off"
        );
        assert!(!reads_mute_before("acknowledged", true));
        assert!(!reads_mute_before("open", true));
    }

    #[tokio::test]
    async fn a_failed_join_leaves_the_mute_so_the_next_firing_still_reopens() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let muted = AtomicBool::new(true);
        let failed = join_then_unmute(
            async { Err::<bool, _>(infra::errors::Error::Message("db down".to_string())) },
            async || muted.swap(false, Ordering::SeqCst),
        )
        .await;
        assert!(failed.is_err());
        assert!(
            muted.load(Ordering::SeqCst),
            "the mute stays for the next firing"
        );
        let (_, reopened) = join_then_unmute(async { Ok(false) }, async || {
            muted.swap(false, Ordering::SeqCst)
        })
        .await
        .unwrap();
        assert!(
            reopened,
            "the next firing reopens, so it yields NewIncidentCreated"
        );
        assert!(!muted.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn an_incident_that_is_not_muted_has_nothing_to_unmute() {
        assert!(!unmute_for_firing("default", &incident(None), None).await);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn an_unmuted_incident_with_a_manual_run_still_decides_l0() {
        let mut manual = incident(None);
        manual.rca_run_id = Some("run_manual".to_string());
        assert!(l0_undecided(&manual));
        manual.rca_off_reason = Some("l0_off".to_string());
        assert!(!l0_undecided(&manual));
    }

    #[tokio::test]
    async fn a_muted_auto_resolve_whose_event_append_fails_still_clears_the_mute() {
        use infra::table::entity::alert_incidents;
        use sea_orm::{ActiveModelTrait, ConnectionTrait, Database, EntityTrait, Schema};

        // Only the incidents table exists, so both event appends fail.
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(alert_incidents::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        let row: alert_incidents::ActiveModel = incident(Some("dt-1")).into();
        alert_incidents::Entity::insert(row.reset_all())
            .exec(&db)
            .await
            .unwrap();

        let recorded = record_muted_auto_resolve(&db, "default", "inc-1", "dt-1").await;
        assert!(recorded.is_err());
        let stored = alert_incidents::Entity::find_by_id("inc-1".to_string())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.muted_by_downtime_id, None);
    }

    #[tokio::test]
    async fn a_newer_open_incident_does_not_hide_the_page_a_muted_resolve_left_open() {
        use config::meta::oncall::ResponseState;
        use infra::table::entity::{alert_incident_alerts, alert_incidents};
        use sea_orm::{ActiveModelTrait, ConnectionTrait, Database, EntityTrait, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(alert_incidents::Entity),
            schema.create_table_from_entity(alert_incident_alerts::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        // I1 resolved quietly under the ended window; the Firing run after it opened I2.
        for (id, status, fired_at) in [("i1", "resolved", 1), ("i2", "open", 2)] {
            let mut model = incident(None);
            model.id = id.to_string();
            model.status = status.to_string();
            let row: alert_incidents::ActiveModel = model.into();
            alert_incidents::Entity::insert(row.reset_all())
                .exec(&db)
                .await
                .unwrap();
            let link = alert_incident_alerts::Model {
                incident_id: id.to_string(),
                alert_id: "a1".to_string(),
                alert_fired_at: fired_at,
                alert_name: "a1".to_string(),
                alert_kind: "alert".to_string(),
                correlation_reason: None,
                created_at: fired_at,
                resolved_at: None,
            };
            let link: alert_incident_alerts::ActiveModel = link.into();
            alert_incident_alerts::Entity::insert(link.reset_all())
                .exec(&db)
                .await
                .unwrap();
        }
        let resolved = infra::table::alert_incidents::resolved_incidents_for_alert_with(
            &db,
            "default",
            "a1",
            MUTED_RESOLVES_SCANNED,
        )
        .await
        .unwrap();
        assert_eq!(resolved, ["i1"]);

        let records = HashMap::from([
            (
                "i1".to_string(),
                vec![oncall_record("i1", ResponseState::Triggered)],
            ),
            (
                "i2".to_string(),
                vec![oncall_record("i2", ResponseState::Triggered)],
            ),
        ]);
        assert_eq!(
            left_open(&resolved, &records),
            ["i1"],
            "I1's page is closed; the live I2 keeps its own"
        );
        let closed = HashMap::from([(
            "i1".to_string(),
            vec![oncall_record("i1", ResponseState::Resolved)],
        )]);
        assert!(left_open(&resolved, &closed).is_empty());
    }

    #[tokio::test]
    async fn a_failed_severity_raise_after_the_unmute_still_sends_the_opened_page() {
        let mut paged = 0;
        let outcome = escalate_then_reopen(
            "default",
            "inc-1",
            async { Err(anyhow::anyhow!("db down")) },
            async {
                paged += 1;
                IncidentCorrelationOutcome::NewIncidentCreated {
                    incident_id: "inc-1".to_string(),
                    service_name: "payments".to_string(),
                }
            },
        )
        .await;
        assert!(matches!(
            outcome,
            IncidentCorrelationOutcome::NewIncidentCreated { ref incident_id, .. }
                if incident_id == "inc-1"
        ));
        assert_eq!(paged, 1, "the delayed opened message goes out once");
    }

    /// A run whose RCA setting went off after the start ends `failed`, not `running`.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_run_started_while_rca_is_off_ends_rca_disabled() {
        use config::meta::alerts::rca_runs::{RunState, RunTrigger};

        use crate::alerts::rca_runs::tests::{
            db, failures, new_incident, rca_off, start, stored, timeline,
        };

        let _db = db().await;
        rca_off();
        let cfg = o2_enterprise::enterprise::common::config::get_config();
        assert!(
            !(cfg.incidents.enabled && cfg.incidents.rca_enabled),
            "rca_off() turned RCA off"
        );
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;

        trigger_rca_for_incident(
            org.clone(),
            inc.clone(),
            run_id.clone(),
            RcaLaunch {
                trigger: RunTrigger::Manual,
                user_email: "a.rao@acme.io".to_string(),
                build_on_previous: false,
                usage_permit: None,
                guidance: None,
                resume: None,
            },
        )
        .await
        .unwrap();

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, "rca_disabled");
        assert_eq!(failures(&timeline(&org, &inc).await).len(), 1);
    }

    /// A seed of `source_run` over `three_steps`, as `prepare_resume` makes it.
    #[cfg(feature = "enterprise")]
    fn resume_seed(org_id: &str, source_run: &str) -> super::super::rca_resume::ResumeSeed {
        use config::meta::alerts::rca_runs::RunMode;
        use infra::table::ai_chat_sessions::STATUS_ACTIVE;

        use crate::{
            ai_chat::fork::{plan_resume, tests::three_steps},
            alerts::rca_resume::{ResumeSeed, ResumeStep, tests::session_row},
        };

        let events = three_steps();
        let plan = plan_resume(&events).unwrap();
        ResumeSeed {
            source_run_id: source_run.to_string(),
            source_session: session_row(org_id, &format!("ses-{source_run}"), 17, STATUS_ACTIVE),
            prefix: events[..=plan.cut_seq as usize].to_vec(),
            cut_seq: plan.cut_seq,
            reused_steps: plan.reused_steps,
            from_step: ResumeStep {
                index: plan.from_step.index,
                stage: plan.from_step.stage.unwrap_or_default().to_string(),
                title: plan.from_step.title,
            },
            mode: RunMode::BuildOnPrevious,
            latest_run_id: source_run.to_string(),
        }
    }

    /// A resumed run copies the source's session, and the run and its continuation stay on the
    /// fork.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_resumed_run_goes_on_from_the_fork_with_the_copied_counts() {
        use std::time::Duration;

        use config::meta::alerts::rca_runs::{RunMode, RunState, RunTrigger};
        use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;
        use serde_json::json;

        use crate::{
            ai_chat::{fork::RunFork, rca_thread::project_rca_thread},
            alerts::{
                rca_runs::{
                    RunSubject, StartOutcome, StartRun, start_run,
                    tests::{db, incident_start, new_incident, start, stored},
                },
                rca_turn::{RcaTurnRun, start_forked_rca_turn, turn_run_of},
            },
        };

        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let source_run = start(&org, &inc, RunTrigger::Manual).await;
        crate::alerts::rca_runs::fail_run(
            &org,
            &source_run,
            RunTrigger::Manual,
            "timeout",
            "stopped",
            None,
        )
        .await
        .unwrap();
        let seed = resume_seed(&org, &source_run);
        let start_resume = StartRun {
            mode: seed.mode,
            context_used: Some(json!({ "resumed_from": seed.resumed_from() })),
            ..incident_start(&org, &inc, RunTrigger::Resume)
        };
        let StartOutcome::Started { run_id } = start_run(start_resume).await.unwrap() else {
            panic!("the resume did not start");
        };

        // A copy that fails is the launch's error and changes nothing on the run.
        let failed = fork_for_resume(
            &org,
            &run_id,
            seed.clone(),
            async |_: &str,
                   _: &infra::table::ai_chat_sessions::Model,
                   _: Vec<DurableEvent>,
                   _: &str| {
                Err::<RunFork, _>(anyhow::anyhow!("the stream refused the batch"))
            },
        )
        .await;
        assert!(failed.is_err());
        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Running);
        assert_eq!(run.session_id, None);
        assert_eq!(
            run.context_used,
            Some(json!({"resumed_from": seed.resumed_from()}))
        );

        let fork_session = "0195a1b2-c3d4-7e5f-8a9b-f0e4ed000001".to_string();
        let copied = seed.prefix.clone();
        let (mode, fork) = fork_for_resume(
            &org,
            &run_id,
            seed.clone(),
            async |org_id: &str,
                   source: &infra::table::ai_chat_sessions::Model,
                   prefix: Vec<DurableEvent>,
                   from_run: &str| {
                assert_eq!(org_id, org);
                assert_eq!(source.session_id, format!("ses-{source_run}"));
                assert_eq!(prefix, copied);
                assert_eq!(from_run, source_run);
                Ok(RunFork {
                    session_id: fork_session.clone(),
                    last_seq: seed.cut_seq,
                })
            },
        )
        .await
        .unwrap();
        assert_eq!(mode, RunMode::BuildOnPrevious);
        assert_eq!(fork.session_id, fork_session);

        // No agent here: the turn stops at its credentials; its earlier run writes are under test.
        let turn = RcaTurnRun {
            org_id: org.clone(),
            run_id: run_id.clone(),
            subject: RunSubject::Incident(inc.clone()),
            trigger: RunTrigger::Resume,
            mode,
            context: json!({}),
            session_id: None,
        };
        let started =
            tokio::time::timeout(Duration::from_secs(60), start_forked_rca_turn(turn, fork))
                .await
                .expect("the start ends");
        assert!(started.is_err());

        let run = stored(&org, &run_id).await;
        assert_eq!(run.session_id.as_deref(), Some(fork_session.as_str()));
        assert_eq!(run.mode, RunMode::BuildOnPrevious);
        let used = run.context_used.unwrap();
        assert_eq!(used["resumed_from"], seed.resumed_from());
        assert!(
            used.get("toolsets").is_some(),
            "the first turn's context_used, the lineage kept in it: {used}"
        );
        let reused = project_rca_thread(&seed.prefix, &[], false, false).stats;
        assert_eq!(reused.steps, 2);
        let stats = run.stats.unwrap();
        assert_eq!(
            (stats.steps, stats.tool_calls),
            (Some(reused.steps), Some(reused.tool_calls)),
            "the live counts start from the copied steps"
        );
        assert_eq!(
            stats.tokens,
            Some(json!({"input": 3_000, "output": 600, "reasoning": 50, "cache_read": 400}))
        );
        assert_eq!(run.stage.as_deref(), Some("metrics"));
        assert_eq!(run.stage_index, Some(6));

        let row = infra::table::rca_runs::get_rw(&org, &run_id)
            .await
            .unwrap()
            .unwrap();
        let next = turn_run_of(&row).await.unwrap();
        assert_eq!(next.session_id.as_deref(), Some(fork_session.as_str()));
        assert_eq!(
            (next.trigger, next.mode),
            (RunTrigger::Resume, RunMode::BuildOnPrevious)
        );
    }

    /// A resume launch ends on the same guards as any run, before anything is copied.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_resume_refused_by_a_guard_copies_nothing() {
        use std::time::Duration;

        use config::meta::alerts::rca_runs::{RunState, RunTrigger};
        use infra::table::entity::ai_chat_sessions as session_rows;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

        use crate::alerts::rca_runs::{
            StartOutcome, StartRun, start_run,
            tests::{db, incident_start, new_incident, rca_off, start, stored},
        };

        let _db = db().await;
        rca_off();
        let (org, inc) = new_incident(None).await;
        let source_run = start(&org, &inc, RunTrigger::Manual).await;
        crate::alerts::rca_runs::fail_run(
            &org,
            &source_run,
            RunTrigger::Manual,
            "timeout",
            "stopped",
            None,
        )
        .await
        .unwrap();
        let seed = resume_seed(&org, &source_run);
        let start_resume = StartRun {
            context_used: Some(serde_json::json!({ "resumed_from": seed.resumed_from() })),
            ..incident_start(&org, &inc, RunTrigger::Resume)
        };
        let StartOutcome::Started { run_id } = start_run(start_resume).await.unwrap() else {
            panic!("the resume did not start");
        };

        tokio::time::timeout(
            Duration::from_secs(60),
            trigger_rca_for_incident(
                org.clone(),
                inc.clone(),
                run_id.clone(),
                RcaLaunch {
                    trigger: RunTrigger::Resume,
                    user_email: "a.rao@acme.io".to_string(),
                    build_on_previous: false,
                    usage_permit: None,
                    guidance: None,
                    resume: Some(seed.clone()),
                },
            ),
        )
        .await
        .expect("the launch ends")
        .unwrap();

        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Failed);
        assert_eq!(run.error.unwrap().code, "rca_disabled");
        assert_eq!(run.session_id, None);
        assert_eq!(
            run.context_used.unwrap()["resumed_from"],
            seed.resumed_from()
        );
        let sessions = session_rows::Entity::find()
            .filter(session_rows::Column::OrgId.eq(&org))
            .all(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        assert!(sessions.is_empty(), "no copy was made");
    }

    /// A stale live run can be cancelled; the user is recorded.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_stale_run_on_another_node_is_cancelled_by_the_user() {
        use config::meta::alerts::{
            incidents::IncidentEventType,
            rca_runs::{RunState, RunTrigger},
        };

        use crate::alerts::rca_runs::tests::{
            age, db, incident_row, new_incident, start, stored, timeline,
        };

        let _db = db().await;
        let timeout = o2_enterprise::enterprise::common::config::get_config()
            .incidents
            .rca_timeout_secs;
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        age(&org, &inc, &run_id, timeout as i64 + 121).await;

        let cancelled = crate::alerts::rca_turn::cancel_rca_run(&org, &inc, "a.rao@acme.io")
            .await
            .unwrap()
            .expect("a stale running run is cancellable");

        assert_eq!(cancelled, run_id);
        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Cancelled);
        assert_eq!(run.cancelled_by.as_deref(), Some("a.rao@acme.io"));
        let row = incident_row(&org, &inc).await;
        assert_eq!(row.rca_state.as_deref(), Some("cancelled"));
        assert_eq!(
            infra::table::rca_runs::decode::<serde_json::Value>(row.rca_summary.as_deref())
                .unwrap()["cancelled_by"]
                .as_str(),
            Some("a.rao@acme.io")
        );
        let cancels: Vec<_> = timeline(&org, &inc)
            .await
            .into_iter()
            .filter_map(|e| match e {
                IncidentEventType::AIAnalysisCancelled { user_id } => Some(user_id),
                _ => None,
            })
            .collect();
        assert_eq!(cancels, [Some("a.rao@acme.io".to_string())]);
    }

    /// With no live run there is nothing to cancel.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_cancel_of_an_ended_or_absent_run_returns_none() {
        use config::meta::alerts::rca_runs::{RunState, RunTrigger};
        use infra::table::rca_runs::RunUpdate;

        use crate::alerts::{
            rca_runs::{
                complete_run,
                tests::{db, new_incident, start, stored},
            },
            rca_turn::cancel_rca_run,
        };

        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        assert_eq!(
            cancel_rca_run(&org, &inc, "a.rao@acme.io").await.unwrap(),
            None
        );
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        assert!(
            complete_run(&org, &run_id, "report", RunUpdate::default())
                .await
                .unwrap()
        );

        assert_eq!(
            cancel_rca_run(&org, &inc, "a.rao@acme.io").await.unwrap(),
            None
        );
        let run = stored(&org, &run_id).await;
        assert_eq!(run.state, RunState::Completed);
        assert_eq!(run.cancelled_by, None);
    }

    /// Each listed incident carries its run summary, or `rca: null` when never analyzed.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_list_carries_each_incidents_run_summary() {
        use config::meta::alerts::rca_runs::{ReportFormat, RunState, RunTrigger};

        use crate::alerts::rca_runs::{
            rca_detail,
            tests::{
                add_incident, completed_at, db, incident_row, new_incident, pre_run_topology, start,
            },
        };

        let _db = db().await;
        let (org, analyzed) = new_incident(None).await;
        let run_id = start(&org, &analyzed, RunTrigger::AutoNewIncident).await;
        let never = add_incident(&org, None).await;
        // Reports from before runs existed: dated by the archive, else by the Complete event.
        let archived = add_incident(&org, Some(pre_run_topology())).await;
        let single = add_incident(
            &org,
            Some(serde_json::json!({"nodes": [], "edges": [], "suggested_root_cause": "r"})),
        )
        .await;
        completed_at(&org, &single, 150).await;
        let rerun = add_incident(&org, Some(pre_run_topology())).await;
        let rerun_id = start(&org, &rerun, RunTrigger::Manual).await;
        infra::table::rca_runs::backfill_v1_pointers_for_tests()
            .await
            .unwrap();

        let (incidents, total) = list_incidents(&org, None, 50, 0).await.unwrap();

        assert_eq!(total, 5);
        let by_id = |id: &str| incidents.iter().find(|i| i.id == id).unwrap();
        let rca = by_id(&analyzed).rca.as_ref().unwrap();
        assert_eq!(rca.run_id, run_id);
        assert_eq!(rca.state, RunState::Running);
        assert!(!rca.stale);
        assert!(rca.detail.is_none(), "the list adds no join");
        assert!(by_id(&never).rca.is_none());
        let v1 = |id: &str| {
            let rca = by_id(id).rca.as_ref().expect("a pre-run report shows");
            (
                rca.run_id.as_str(),
                rca.report_format,
                rca.state,
                rca.outcome.as_deref(),
                rca.updated_at,
            )
        };
        let (format, state) = (ReportFormat::V1, RunState::Completed);
        assert_eq!(v1(&archived), ("v1-0", format, state, None, 200));
        assert_eq!(v1(&single), ("v1-0", format, state, None, 150));
        let rca = by_id(&rerun).rca.as_ref().unwrap();
        assert_eq!(
            (rca.run_id.as_str(), rca.report_format),
            (rerun_id.as_str(), ReportFormat::V2),
            "a run replaces the pre-run report"
        );
        for id in [&archived, &single] {
            let listed = by_id(id).rca.as_ref().unwrap();
            let mut detail = rca_detail(&org, &incident_row(&org, id).await)
                .await
                .unwrap()
                .unwrap();
            let fields = detail.detail.take().unwrap();
            assert_eq!(&detail, listed, "the detail summary is the list summary");
            assert_eq!(fields.history[0].started_at, listed.updated_at);
        }

        let json = serde_json::to_value(&incidents).unwrap();
        let json_of = |id: &str| {
            json.as_array()
                .unwrap()
                .iter()
                .find(|i| i["id"] == id)
                .unwrap()
                .clone()
        };
        assert_eq!(json_of(&analyzed)["rca"]["state"], "running");
        assert!(json_of(&analyzed)["rca"].get("current_run").is_none());
        assert!(json_of(&never)["rca"].is_null());
        assert!(json_of(&never).as_object().unwrap().contains_key("rca"));
        assert_eq!(json_of(&archived)["rca"]["report_format"], "v1");
    }

    /// A case spans its evidence, stays historical while every firing is, and an event widens it.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_security_case_spans_event_time_and_tracks_backfill_only_firings() {
        use infra::table::alert_incidents::{
            CaseActivity, add_firing_to_case, create_security_case, get_rw,
        };

        use crate::alerts::rca_runs::tests::db;

        const HOUR: i64 = 3_600_000_000;
        let _db = db().await;
        let org = format!("case_span_{}", config::ider::uuid());
        let span = |first, last, historical| CaseActivity {
            first_event_at: first,
            last_event_at: last,
            historical,
        };
        let case = create_security_case(
            &org,
            "P2",
            serde_json::json!({}),
            "AlertId",
            span(10 * HOUR, 11 * HOUR, true),
            Some("Kerberoasting on DC-02".to_string()),
            None,
        )
        .await
        .unwrap();
        add_firing_to_case(
            &case.id,
            "det-1",
            "d",
            "internal",
            30 * HOUR,
            "entity",
            span(10 * HOUR, 11 * HOUR, true),
        )
        .await
        .unwrap();
        let stored = get_rw(&org, &case.id).await.unwrap().unwrap();
        assert_eq!(
            (stored.first_alert_at, stored.last_alert_at),
            (10 * HOUR, 11 * HOUR)
        );
        assert!(stored.historical, "the run time never becomes last seen");

        let open = infra::table::alert_incidents::find_open_incidents_by_alert_id(&org, "det-1")
            .await
            .unwrap();
        assert_eq!(open.len(), 1);
        assert!(
            find_open_detection_case(&org, "det-1", (40 * HOUR, 40 * HOUR), 2 * HOUR)
                .await
                .unwrap()
                .is_none(),
            "a firing a day later opens its own case"
        );
        assert!(
            find_open_detection_case(&org, "det-1", (12 * HOUR, 12 * HOUR), 2 * HOUR)
                .await
                .unwrap()
                .is_some()
        );

        add_firing_to_case(
            &case.id,
            "det-2",
            "d2",
            "internal",
            31 * HOUR,
            "entity",
            span(9 * HOUR, 12 * HOUR, false),
        )
        .await
        .unwrap();
        let stored = get_rw(&org, &case.id).await.unwrap().unwrap();
        assert_eq!(
            (stored.first_alert_at, stored.last_alert_at),
            (9 * HOUR, 12 * HOUR)
        );
        assert!(
            !stored.historical,
            "a current firing makes the case current"
        );

        let event = CaseEvent {
            stream: "okta_auth".to_string(),
            at: 13 * HOUR,
            fields: serde_json::json!({"actor_alternateid": "bob@acme.io"})
                .as_object()
                .unwrap()
                .clone(),
        };
        let widened = attach_event_to_case(&org, Some(&case.id), None, &event, "a@acme.io")
            .await
            .unwrap();
        assert_eq!(widened.last_alert_at, 13 * HOUR);
        let opened = attach_event_to_case(&org, None, None, &event, "a@acme.io")
            .await
            .unwrap();
        assert_eq!(
            opened.title.as_deref(),
            Some("Event from okta_auth on bob@acme.io")
        );
        assert_eq!(
            opened.group_values,
            serde_json::json!({"security_user": "bob@acme.io"})
        );
        assert_eq!(
            (opened.first_alert_at, opened.last_alert_at),
            (13 * HOUR, 13 * HOUR)
        );
    }

    /// AutoObserve's alerts may lack a destination and a service, yet a firing still opens one.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_incident_alert_with_no_destination_and_no_service_still_opens_an_incident() {
        use config::meta::alerts::{QueryCondition, QueryType};
        use infra::table::alert_incidents::CaseFilter;
        use svix_ksuid::{Ksuid, KsuidLike};

        use crate::alerts::rca_runs::tests::db;

        const HOUR: i64 = 3_600_000_000;
        let _db = db().await;
        let org = format!("ao_dest_{}", config::ider::uuid());
        let mut alert = Alert::default();
        alert.id = Some(Ksuid::new(None, None));
        alert.org_id = org.clone();
        alert.name = "autoobserve_errors".to_string();
        alert.creates_incident = true;
        alert.destinations.clear();
        alert.query_condition = QueryCondition {
            query_type: QueryType::SQL,
            sql: Some(
                "SELECT count(*) AS errors FROM \"app_traces\" HAVING count(*) > 3".to_string(),
            ),
            ..Default::default()
        };
        let rows: Vec<Map<String, Value>> = vec![
            serde_json::json!({"errors": 5})
                .as_object()
                .unwrap()
                .clone(),
        ];

        let correlated =
            correlate_alert_to_incident(&alert, &rows[0], &rows, 2 * HOUR, None, None, None, None)
                .await
                .unwrap();

        assert!(correlated.is_some(), "no service still opens an incident");
        let (incidents, total) = list_incidents_filtered(&org, None, CaseFilter::All, 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(incidents[0].alert_count, 1);
    }

    /// Hosts past the partition cap join the detection's entity-less case, not the first of them.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn rows_past_the_entity_cap_never_file_under_an_overflow_host() {
        use infra::table::alert_incidents::CaseFilter;
        use o2_enterprise::enterprise::security::cases::MAX_ENTITY_PARTITIONS;
        use svix_ksuid::{Ksuid, KsuidLike};

        use crate::alerts::rca_runs::tests::db;

        const HOUR: i64 = 3_600_000_000;
        let _db = db().await;
        let org = format!("case_cap_{}", config::ider::uuid());
        let mut alert = Alert::default();
        alert.id = Some(Ksuid::new(None, None));
        alert.org_id = org.clone();
        alert.name = "brute_force".to_string();
        alert.context_attributes = Some(
            [
                ("siem".to_string(), "true".to_string()),
                ("sigma_title".to_string(), "Brute force".to_string()),
            ]
            .into_iter()
            .collect(),
        );
        let rows: Vec<Map<String, Value>> = (0..60)
            .map(|i| {
                serde_json::json!({"hostname": format!("host-{i:02}"), "_timestamp": HOUR})
                    .as_object()
                    .unwrap()
                    .clone()
            })
            .collect();

        correlate_alert_to_incident(&alert, &rows[0], &rows, 2 * HOUR, None, None, None, None)
            .await
            .unwrap();

        let (cases, total) = list_incidents_filtered(&org, None, CaseFilter::OnlyCases, 100, 0)
            .await
            .unwrap();
        assert_eq!(total as usize, MAX_ENTITY_PARTITIONS + 1);
        let mut titles: Vec<String> = cases.iter().filter_map(|c| c.title.clone()).collect();
        titles.sort();
        assert_eq!(titles.first().map(String::as_str), Some("Brute force"));
        assert!(
            !titles.iter().any(|t| t == "Brute force on host-50"),
            "the first overflow host gets no case of its own"
        );
        let overflow = cases
            .iter()
            .find(|c| c.title.as_deref() == Some("Brute force"))
            .unwrap();
        assert_eq!(overflow.group_values, serde_json::json!({}));
        assert_eq!(overflow.alert_count, 1);
    }

    /// A backfill firing with old and current rows on one host files each into its own case.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_backfill_keeps_old_evidence_out_of_the_current_case() {
        use infra::table::alert_incidents::CaseFilter;
        use svix_ksuid::{Ksuid, KsuidLike};

        use crate::alerts::rca_runs::tests::db;

        const HOUR: i64 = 3_600_000_000;
        let _db = db().await;
        let org = format!("case_backfill_{}", config::ider::uuid());
        let mut alert = Alert::default();
        alert.id = Some(Ksuid::new(None, None));
        alert.org_id = org.clone();
        alert.name = "uid0".to_string();
        alert.context_attributes = Some(
            [
                ("siem".to_string(), "true".to_string()),
                (
                    "sigma_title".to_string(),
                    "Linux Account Created With UID 0".to_string(),
                ),
            ]
            .into_iter()
            .collect(),
        );
        let now = 48 * HOUR;
        let rows: Vec<Map<String, Value>> = [now - 6 * HOUR, now - 60_000_000]
            .iter()
            .map(|at| {
                serde_json::json!({"host": "web-01", "_timestamp": at})
                    .as_object()
                    .unwrap()
                    .clone()
            })
            .collect();

        correlate_alert_to_incident(
            &alert,
            &rows[0],
            &rows,
            now,
            None,
            None,
            None,
            Some(now - HOUR),
        )
        .await
        .unwrap();

        let (cases, total) = list_incidents_filtered(&org, None, CaseFilter::OnlyCases, 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 2, "one case per window of evidence");
        let mut shape: Vec<(i64, i64, bool)> = cases
            .iter()
            .map(|c| (c.first_alert_at, c.last_alert_at, c.historical))
            .collect();
        shape.sort();
        assert_eq!(
            shape,
            [
                (now - 6 * HOUR, now - 6 * HOUR, true),
                (now - 60_000_000, now - 60_000_000, false),
            ]
        );
    }

    /// Each listed incident names the alerts that fired into it and how often; an incident
    /// with no links lists none, and `alert_count` heals to the junction's firing total.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_list_carries_each_incidents_alert_groups() {
        use config::meta::alerts::incidents::IncidentAlertGroup;
        use infra::table::alert_incidents::add_alert_to_incident;

        use crate::alerts::rca_runs::tests::{add_incident, db, new_incident};

        let _db = db().await;
        let (org, repeat) = new_incident(None).await;
        let unlinked = add_incident(&org, None).await;
        for (alert, fired_at, new_type) in [
            ("a", 1, true),
            ("b", 2, true),
            ("a", 3, false),
            ("a", 4, false),
        ] {
            let joined = add_alert_to_incident(
                &repeat,
                alert,
                &format!("{alert}-name"),
                "alert",
                fired_at,
                "manual",
            )
            .await
            .unwrap();
            assert_eq!(joined, new_type, "{alert} at {fired_at}");
        }

        let (incidents, _) = list_incidents(&org, None, 50, 0).await.unwrap();

        let by_id = |id: &str| incidents.iter().find(|i| i.id == id).unwrap();
        let group = |id: &str, count| IncidentAlertGroup {
            alert_id: id.to_string(),
            alert_name: format!("{id}-name"),
            count,
        };
        let listed = by_id(&repeat);
        assert_eq!(
            listed.alert_groups.as_deref(),
            Some(&[group("a", 3), group("b", 1)][..])
        );
        // Seeded at 1 and incremented per link, so stored is 5: the list heals it to 4.
        assert_eq!(listed.alert_count, 4);
        let none = by_id(&unlinked);
        assert_eq!(none.alert_groups.as_deref(), Some(&[][..]));

        let json = serde_json::to_value(listed).unwrap();
        assert_eq!(json["alert_groups"][0]["count"], 3);
    }

    /// A turn that could not start fails its run with the turn's code and an actionable reason.
    #[cfg(feature = "enterprise")]
    #[test]
    fn a_turn_that_could_not_start_names_its_code_and_reason() {
        use crate::alerts::{rca_runs, rca_turn::RcaTurnError};

        for (error, code, reason, details) in [
            (
                RcaTurnError::TurnLimit,
                "turn_limit",
                TURN_LIMIT_REASON,
                None,
            ),
            (
                RcaTurnError::Credentials("no SA".to_string()),
                "credentials",
                rca_runs::CREDENTIALS_REASON,
                Some("no SA"),
            ),
            (
                RcaTurnError::AgentUnavailable("down".to_string()),
                "agent_unavailable",
                rca_runs::AGENT_UNAVAILABLE_REASON,
                Some("down"),
            ),
            (RcaTurnError::Busy, "busy", TURN_BUSY_REASON, None),
            (
                RcaTurnError::Other("boom".to_string()),
                "agent_error",
                rca_runs::AGENT_ERROR_REASON,
                Some("boom"),
            ),
        ] {
            assert_eq!(error.error_code(), code);
            let (got_reason, got_details) = rca_turn_failure(&error);
            assert_eq!(got_reason, reason, "{error:?}");
            assert_eq!(got_details.as_deref(), details, "{error:?}");
        }
    }

    /// The cap, a busy session and a missing SysRcaAgent user get their own codes; the rest are
    /// agent errors.
    #[cfg(feature = "enterprise")]
    #[test]
    fn an_admission_refusal_maps_to_a_turn_error() {
        use crate::{ai_chat::admission::AdmitError, alerts::rca_turn::RcaTurnError};

        assert_eq!(
            RcaTurnError::from(AdmitError::TurnLimit("user")),
            RcaTurnError::TurnLimit
        );
        assert_eq!(RcaTurnError::from(AdmitError::Busy), RcaTurnError::Busy);
        assert!(matches!(
            RcaTurnError::from(AdmitError::NotRegistered),
            RcaTurnError::Credentials(_)
        ));
        for other in [
            AdmitError::InvalidSession("bad"),
            AdmitError::NotFound("gone"),
            AdmitError::AlreadySubmitted,
            AdmitError::Unavailable("down"),
        ] {
            assert_eq!(RcaTurnError::from(other).error_code(), "agent_error");
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn incident_notification_renders_through_slack_and_custom_templates() {
        use crate::alerts::notifications::{
            ChannelFormat, NotificationContext, RenderedMessage, apply_custom_template,
            default_template::compiled_default_content, render, resolve_content,
        };

        let incident_url = "https://o2.example/web/alerts/incidents/inc-1?org_identifier=default";
        let mut ctx = NotificationContext {
            alert_name: "go_gc_rate_high".into(),
            stream_name: "go_gc_duration_seconds".into(),
            alert_status: "firing".into(),
            alert_url: "https://o2.example/short/alert".into(),
            alert_level: "critical".into(),
            ..Default::default()
        };
        super::apply_incident_to_context(
            &mut ctx,
            "inc-1",
            "new_incident_created",
            "go_gc_rate_high on coredns",
            "P2",
            "coredns",
            incident_url,
        );
        assert_eq!(ctx.alert_url, incident_url);
        assert_eq!(ctx.incident_id, "inc-1");
        assert_eq!(ctx.alert_level, "P2");
        assert_eq!(
            ctx.level,
            Some(config::meta::alerts::level::AlertLevel::Critical)
        );
        for (severity, level) in [
            (
                "P1",
                Some(config::meta::alerts::level::AlertLevel::Critical),
            ),
            ("P3", Some(config::meta::alerts::level::AlertLevel::Warning)),
            ("P4", None),
            ("", None),
        ] {
            let mut other = NotificationContext::default();
            super::apply_incident_to_context(&mut other, "inc-2", "e", "t", severity, "s", "u");
            assert_eq!(other.level, level, "{severity}");
        }

        let content = resolve_content(
            &compiled_default_content(),
            &ctx,
            ChannelFormat::Slack.channel_family(),
        );
        let Ok(RenderedMessage::Http { body }) = render(ChannelFormat::Slack, &content, &ctx)
        else {
            panic!("slack renders an http body");
        };
        let slack: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(slack.get("incident").is_none(), "{body}");
        assert!(slack["blocks"].is_array(), "{body}");
        assert!(body.contains("incidents/inc-1"), "{body}");

        let custom = apply_custom_template(
            r#"{"text":"{incident_title} [{incident_severity}] {incident_event} {incident_url}"}"#,
            &ctx,
            false,
        );
        assert_eq!(
            custom,
            format!(
                r#"{{"text":"go_gc_rate_high on coredns [P2] new_incident_created {incident_url}"}}"#
            )
        );
    }

    #[tokio::test]
    async fn incident_details_keep_only_the_alert_definitions_the_caller_may_read() {
        let alert = |name: &str| {
            let mut alert = Alert::default();
            alert.name = name.to_string();
            alert
        };
        let composite = |id: &str, folder_id: &str| CompositeAlertSummary {
            id: id.to_string(),
            name: id.to_string(),
            alert_type: "composite".to_string(),
            enabled: true,
            folder_id: folder_id.to_string(),
        };
        let alerts = vec![
            ("allowed".to_string(), "open".to_string(), alert("allowed")),
            ("denied".to_string(), "open".to_string(), alert("denied")),
            (
                "in_closed".to_string(),
                "closed".to_string(),
                alert("in_closed"),
            ),
        ];
        let composites = vec![
            composite("c_allowed", "open"),
            composite("c_closed", "closed"),
        ];

        let (alerts, composites) = readable_definitions(alerts, composites, |id, folder| {
            std::future::ready(id != "denied" && folder != "closed")
        })
        .await;

        let names: Vec<_> = alerts.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, ["allowed"]);
        let ids: Vec<_> = composites.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["c_allowed"]);
    }

    #[test]
    fn a_higher_sigma_firing_raises_the_case_priority() {
        use config::meta::alerts::incidents::IncidentSeverity;
        use o2_enterprise::enterprise::security::cases;
        assert_eq!(
            escalated_severity("P3", cases::sigma_severity("critical"), None),
            Some((IncidentSeverity::P3, IncidentSeverity::P1))
        );
        assert_eq!(
            escalated_severity("P1", cases::sigma_severity("low"), None),
            None
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_an_incident_notification_retries_only_a_temporary_failure() {
        use crate::alerts::notifications::notify::NotifyError;
        let rejected = |status| NotifyError::Rejected {
            status,
            body: String::new(),
        };
        assert!(retries_incident_notify(&rejected(500), 1, 3));
        assert!(retries_incident_notify(&rejected(429), 2, 3));
        assert!(!retries_incident_notify(&rejected(500), 3, 3));
        assert!(!retries_incident_notify(&rejected(400), 1, 3));
        assert!(!retries_incident_notify(
            &NotifyError::DestinationNotFound("slack".to_string()),
            1,
            3
        ));
        assert!(!retries_incident_notify(&rejected(500), 1, 0));
    }
}
