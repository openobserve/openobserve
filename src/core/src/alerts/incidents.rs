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

use std::collections::HashMap;

use config::{
    meta::alerts::{
        alert::Alert,
        incidents::{
            AlertEdge, AlertKind, AlertNode, CompositeAlertSummary, CorrelationReason, EdgeType,
            Incident, IncidentAlert, IncidentCorrelationOutcome, IncidentEvent, IncidentTopology,
            IncidentWithAlerts,
        },
    },
    utils::json::{Map, Value},
};

/// What `extract_service_name` returns when it finds no service.
///
/// Named because it is a sentinel and not a name. Routing must refuse it: an
/// alert nobody can identify belongs in the unrouted queue, not on the pager of
/// whichever team happens to own this string.
const UNKNOWN_SERVICE: &str = "unknown";
/// Window behind the alert in which a service-graph edge counts as a dependency.
const INCIDENT_EDGE_RANGE_SECS: i64 = 3600;
/// How many of an alert's latest firings a Firing run after a window looks through for open pages.
const MUTED_RESOLVES_SCANNED: u64 = 10;
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

/// The correlation steps a [TurnFence] runs before.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FenceStep {
    Lookup,
    Join,
    Open,
}

impl FenceStep {
    fn doing(self) -> &'static str {
        match self {
            Self::Lookup => "looking up the open incident",
            Self::Join => "joining the incident",
            Self::Open => "opening the incident",
        }
    }
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
    async fn route(&self, org_id: &str, incident_id: &str, title: &str) -> RoutedIncident;
    async fn attach(&self, org_id: &str, record_id: &str, incident_id: &str) -> anyhow::Result<()>;
}

/// The production [FindingPager]: the org's default team at the default paging priority.
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

    async fn route(&self, org_id: &str, incident_id: &str, title: &str) -> RoutedIncident {
        // No team and no routing dimensions: the page goes to the org's default team.
        let dimensions = HashMap::new();
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
#[cfg(feature = "enterprise")]
#[derive(Clone, Debug)]
pub(crate) struct LeaseWatch {
    key: String,
    /// Turns `true` once the cluster lock lapsed and another node may hold this turn.
    lost: Option<tokio::sync::watch::Receiver<bool>>,
}

#[cfg(feature = "enterprise")]
impl LeaseWatch {
    fn held(&self, step: &str) -> anyhow::Result<()> {
        if self.lost.as_ref().is_some_and(|lost| *lost.borrow()) {
            anyhow::bail!(
                "lost the finding lock {} before {step}; the act retries under a new one",
                self.key
            );
        }
        Ok(())
    }
}

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl TurnFence for LeaseWatch {
    async fn before(&self, step: FenceStep) -> anyhow::Result<()> {
        self.held(step.doing())
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
) -> Option<FilteredSemanticResult> {
    use config::meta::alerts::incidents::KeyType;

    // Load ServiceIdentityConfig with auto-configuration applied
    let identity_config = crate::db::system_settings::get_service_identity_config(org_id).await;

    // No identity sets configured AND service is opted out — nothing to extract.
    // Otherwise fall through: "service" alone is a viable dimension even with zero sets.
    if identity_config.sets.is_empty() && identity_config.service_optional {
        log::debug!(
            "[incidents] ServiceIdentityConfig for org {} has no identity sets and service is optional, semantic extraction skipped",
            org_id
        );
        return None;
    }

    // Load semantic groups for field mapping
    let semantic_groups = crate::db::system_settings::get_semantic_field_groups(org_id).await;

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
) -> Option<FilteredSemanticResult> {
    None
}

/// Execute Service Discovery and semantic extraction in parallel
async fn correlate_parallel(
    org_id: &str,
    labels: &HashMap<String, String>,
) -> ParallelCorrelationResult {
    // Execute both approaches in parallel
    let (sd_result, semantic_result) = tokio::join!(
        query_service_discovery_key(org_id, labels),
        extract_filtered_semantic_dimensions(org_id, labels)
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
            match crate::alerts::notifications::notify::notify(
                org_id,
                dest_name,
                &explicit,
                Some(&subject),
                &mut send.ctx,
            )
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
/// - A failed send is returned in `CorrelatedIncident::notify_error` for the caller to record.
///
/// When `notify_rows` is empty the function still correlates but sends no notification.
/// Pass an empty slice from manual test-trigger paths that send their own notification.
///
/// Correlation priority:
/// 1. Service Discovery — uses labels matched by service_streams to identify service
/// 2. Manual extraction — extracts semantic dimensions from alert labels
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
) -> Result<Option<CorrelatedIncident>, anyhow::Error> {
    let mut labels = labels_from_row(result_row);

    // Enrich with alert condition dimensions (deterministic baseline)
    // Handles SQL WHERE, GUI conditions, and PromQL label matchers
    #[cfg(feature = "enterprise")]
    {
        let semantic_groups =
            crate::db::system_settings::get_semantic_field_groups(&alert.org_id).await;
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
    let parallel_result = correlate_parallel(&alert.org_id, &labels).await;

    let group_values = parallel_result.final_group_values;
    let mut key_type = parallel_result.final_key_type;
    let correlation_reason = parallel_result.correlation_reason;

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
    let severity = alert.priority.and_then(|p| {
        o2_enterprise::enterprise::alerts::incidents::determine_severity(Some(p.as_str()))
            .parse()
            .ok()
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
        incident_id: None,
        fence: None,
    };

    // Find or create incident
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
            &crate::db::system_settings::get_semantic_field_groups(&alert.org_id).await,
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
            | IncidentCorrelationOutcome::SeverityEscalated { incident_id, .. } => {
                let event = match &outcome {
                    IncidentCorrelationOutcome::NewIncidentCreated { .. } => "new_incident_created",
                    IncidentCorrelationOutcome::SeverityEscalated { .. } => "severity_escalated",
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
    let parallel_result = correlate_parallel(org_id, &labels).await;

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
        | IncidentCorrelationOutcome::SeverityEscalated { incident_id, .. } => {
            let event = match &outcome {
                IncidentCorrelationOutcome::NewIncidentCreated { .. } => "new_incident_created",
                IncidentCorrelationOutcome::SeverityEscalated { .. } => "severity_escalated",
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

/// Narrow on purpose: one member recovering is not the incident being over, and an acknowledged or
/// assigned incident is a human's to close. `auto_resolve_after_minutes` stays as the backstop.
pub async fn resolve_alert_firing(
    event: &config::meta::alerts::recovery::RecoveryEvent,
    muted: bool,
) -> Result<(), anyhow::Error> {
    let Some(incident_id) = event.incident_id.as_deref() else {
        return Ok(());
    };
    infra::table::alert_incidents::resolve_alert_firings(
        incident_id,
        &event.alert_id,
        event.recovered_at,
    )
    .await?;

    // Published even when this region updated no rows: the receiver runs the same idempotent update
    // against its own replica, which may still be behind.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::incidents_resolve_alert(
            &event.org_id,
            incident_id,
            &event.alert_id,
            event.recovered_at,
        )
        .await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish incident resolve_alert: {e}");
    }

    let Some(incident) = infra::table::alert_incidents::get(&event.org_id, incident_id).await?
    else {
        return Ok(());
    };
    if incident.status == "resolved" {
        return Ok(());
    }
    if incident.acknowledged_by.is_some() || incident.assigned_to.is_some() {
        return Ok(());
    }

    let links = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;
    if links.is_empty() || links.iter().any(|l| l.resolved_at.is_none()) {
        return Ok(());
    }

    update_status_as(
        &event.org_id,
        incident_id,
        "resolved",
        "system@openobserve.ai",
        muted,
    )
    .await?;
    log::info!(
        "[incidents] Auto-resolved incident {incident_id} — all {} contributing alert(s) recovered",
        links.len()
    );
    Ok(())
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
    let found = query_service_discovery_key(org_id, &labels_from_row(row)).await?;
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
) -> Option<ServiceDiscoveryResult> {
    #[cfg(feature = "enterprise")]
    {
        let identity_config = crate::db::system_settings::get_service_identity_config(org_id).await;

        let semantic_groups = crate::db::system_settings::get_semantic_field_groups(org_id).await;

        match o2_enterprise::enterprise::service_streams::storage::correlate(
            org_id,
            labels,
            &identity_config,
            &semantic_groups,
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
    let title = custom_title.unwrap_or_else(|| {
        o2_enterprise::enterprise::alerts::incidents::generate_title(&subject.name, group_values)
    });

    subject.fence_at(FenceStep::Open).await?;
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
    let incident = match opening {
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
        let (_, reopened) = join_then_unmute(
            infra::table::alert_incidents::add_alert_to_incident(
                &incident.id,
                &subject.id,
                &subject.name,
                subject.kind.as_str(),
                triggered_at,
                correlation_reason,
            ),
            async || unmute_for_firing(org_id, incident, muted_by).await,
        )
        .await?;
        return Ok(AlertIdJoin::Joined { reopened });
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
        infra::table::alert_incidents::Joining::Joined { .. } => Ok(AlertIdJoin::Joined {
            reopened: unmute_for_firing(org_id, incident, muted_by).await,
        }),
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

/// What joining the open incident an alert id matched did.
enum AlertIdJoin {
    /// Linked; `reopened` when the firing cleared a downtime mute.
    Joined { reopened: bool },
    /// A finding's firing another write already placed, in this incident.
    HeldBy(String),
}

/// [open_finding_incident] with its seams; attempts at one finding take turns across the cluster.
#[cfg(feature = "enterprise")]
async fn open_finding_incident_with(
    f: &FindingIncident,
    pager: &dyn FindingPager,
    turns: &dyn FindingTurns,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    // A detached attempt outlives its act and claim, so a retry on another node can overlap it.
    let turn = turns.take(&f.org_id, &f.subject_id).await?;
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
    finish_finding_incident(f, outcome.incident_id(), pager, turn).await?;
    Ok(outcome)
}

/// Joins the finding's open incident, or opens one under the firing's own id.
#[cfg(feature = "enterprise")]
async fn correlate_finding(
    f: &FindingIncident,
    turn: &FindingTurn,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    use config::meta::alerts::incidents::{IncidentSeverity, KeyType};

    // Before the open-incident lookup: creators that saw the same incidents name the same id.
    let known =
        infra::table::alert_incidents::incident_ids_for_alert(&f.org_id, &f.subject_id).await?;
    let subject = CorrelationSubject {
        id: f.subject_id.clone(),
        name: f.title.clone(),
        org_id: f.org_id.clone(),
        kind: AlertKind::AutoObserve,
        base_destinations: Vec::new(),
        severity: Some(IncidentSeverity::P2),
        title_inputs: None,
        incident_id: Some(finding_incident_id(f, &known)),
        fence: Some(turn.fence.clone()),
    };
    let Correlation { outcome, .. } = find_or_create_incident(
        &f.org_id,
        &f.dimensions,
        KeyType::AlertId,
        &subject,
        f.triggered_at,
        &config::meta::alerts::incidents::CorrelationReason::AlertId.to_string(),
        UNKNOWN_SERVICE,
        None,
        None,
    )
    .await?;
    Ok(outcome)
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
            let routed = pager.route(&f.org_id, incident_id, &f.title).await;
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

    // STEP 1: AlertId exact match - check for existing incident with same alert_id
    if key_type == KeyType::AlertId {
        let alert_id = subject.id.clone();

        subject.fence_at(FenceStep::Lookup).await?;
        // Use the dedicated DB query: junction table lookup + incident fetch
        if let Some(incident) =
            infra::table::alert_incidents::find_open_incident_by_alert_id(org_id, &alert_id).await?
        {
            // Found existing AlertId incident for this alert - join it
            let reopened = match join_alert_id_incident(
                org_id,
                &incident,
                subject,
                triggered_at,
                correlation_reason,
                muted_by,
            )
            .await?
            {
                AlertIdJoin::Joined { reopened } => reopened,
                AlertIdJoin::HeldBy(incident_id) => {
                    return Ok(Correlation::existing(
                        IncidentCorrelationOutcome::ExistingAlertRepeated {
                            incident_id,
                            service_name: service_name.to_string(),
                        },
                    ));
                }
            };

            if let Err(e) = infra::table::incident_events::record_alert(
                org_id,
                &incident.id,
                &alert_id,
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

            return Ok(Correlation::existing(
                IncidentCorrelationOutcome::ExistingAlertRepeated {
                    incident_id: incident.id,
                    service_name: service_name.to_string(),
                },
            ));
        }
    }

    // STEP 2: Venn diagram match against all open incidents (for Primary/Secondary key types)
    //
    // Load all open incidents and check for dimension compatibility.
    // Equal or NewIsSubset → join incident; NewIsSuperset → upgrade and join.
    // PartialOverlap or Incompatible → skip (create new incident).
    if key_type != KeyType::AlertId {
        let open_incidents =
            infra::table::alert_incidents::find_open_incidents_filtered(org_id, None, None).await?;

        for existing in open_incidents {
            let existing_key_type = KeyType::from_stored(&existing.key_type);

            let existing_dims: HashMap<String, String> =
                serde_json::from_value(existing.group_values.clone()).unwrap_or_default();

            let relationship = DimensionRelationship::check(&existing_dims, group_values);

            let join_incident = matches!(
                relationship,
                DimensionRelationship::Equal
                    | DimensionRelationship::NewIsSubset
                    | DimensionRelationship::NewIsSuperset
            );

            if !join_incident {
                continue;
            }

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

            if let Err(e) = infra::table::incident_events::record_alert(
                org_id,
                &existing.id,
                &subject.id,
                &subject.name,
                triggered_at,
            )
            .await
            {
                log::error!(
                    "[Incidents] Failed to record alert event for incident {org_id}/{}: {e}",
                    existing.id
                );
            }

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
                return Ok(Correlation::existing(
                    IncidentCorrelationOutcome::ExistingAlertRepeated {
                        incident_id: existing.id,
                        service_name: service_name.to_string(),
                    },
                ));
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

/// Get incident with its alerts and RCA runs for the detail view.
pub async fn get_incident_with_alerts(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<IncidentWithAlerts>, anyhow::Error> {
    incident_with_alerts(org_id, incident_id, true).await
}

/// [get_incident_with_alerts] without the RCA runs, for callers that never read them.
pub async fn get_incident_with_triggers(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<IncidentWithAlerts>, anyhow::Error> {
    incident_with_alerts(org_id, incident_id, false).await
}

async fn incident_with_alerts(
    org_id: &str,
    incident_id: &str,
    with_rca_runs: bool,
) -> Result<Option<IncidentWithAlerts>, anyhow::Error> {
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
                match super::alert::get_by_id_db(&incident_org_id, alert_ksuid).await {
                    Ok(alert) => alerts.push(alert),
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
    // Get total count before pagination
    let total = infra::table::alert_incidents::count(org_id, status).await?;

    let incidents = infra::table::alert_incidents::list(org_id, status, limit, offset).await?;

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
        .collect();

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
    if is_the_one_ack(org_id, incident_id, status).await? {
        return through_the_one_ack(org_id, incident_id, status, user_id).await;
    }
    // Read before the resolve clears it, so resolving a muted incident still notifies nobody.
    let before = infra::table::alert_incidents::get(org_id, incident_id).await?;
    let muted_before = reads_mute_before(
        status,
        o2_enterprise::enterprise::common::config::get_config()
            .downtimes
            .enabled,
    ) && before
        .as_ref()
        .is_some_and(|m| m.muted_by_downtime_id.is_some());
    // A re-sent Resolve re-runs the idempotent repairs but keeps the first row and event.
    let again = status == "resolved" && before.as_ref().is_some_and(|m| m.status == "resolved");
    let updated = match before {
        Some(m) if again => m,
        _ => infra::table::alert_incidents::update_status(org_id, incident_id, status).await?,
    };

    let muted = status_change_is_muted(
        quiet || muted_before,
        updated.muted_by_downtime_id.as_deref(),
    );
    // Every resolution path lands here, so closing the record once covers all of them.
    #[cfg(feature = "enterprise")]
    if status == "resolved"
        && !muted
        && o2_enterprise::enterprise::oncall::is_enabled()
        && let Err(e) =
            o2_enterprise::enterprise::oncall::escalation::recover_for_incident(org_id, incident_id)
                .await
    {
        log::error!("[incidents] on-call recovery failed for {org_id}/{incident_id}: {e}");
    }

    // Emit status change event
    use config::meta::alerts::incidents::IncidentEvent;
    let event = match status {
        "resolved" => Some(IncidentEvent::resolved(Some(user_id.to_string()))),
        "open" => Some(IncidentEvent::reopened(user_id, "Manually reopened")),
        _ => None,
    };
    if let Some(evt) = event.filter(|_| !again)
        && let Err(e) = append_event_unless_muted(org_id, incident_id, evt, muted).await
    {
        log::error!("[Incidents] Failed to record status event: org_id: {org_id}, error: {e}");
    }

    // A resolve cancels a run that waits for an answer; a working run finishes.
    #[cfg(feature = "enterprise")]
    if status == "resolved"
        && let Err(e) =
            super::rca_steering::cancel_waiting_on_resolve(org_id, incident_id, user_id).await
    {
        log::error!(
            "[INCIDENTS::RCA] Could not stop the paused run of {org_id}/{incident_id}: {e}"
        );
    }

    // A reopened incident gets a fresh automatic run.
    #[cfg(feature = "enterprise")]
    if status == "open" && !muted {
        start_automatic_rca(
            org_id,
            incident_id,
            config::meta::alerts::rca_runs::RunTrigger::AutoReopen,
        )
        .await;
    }

    publish_status(org_id, incident_id, status).await;
    model_to_incident(updated).await
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

async fn publish_status(org_id: &str, incident_id: &str, status: &str) {
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
    }
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

            async fn route(&self, org_id: &str, incident_id: &str, title: &str) -> RoutedIncident {
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
            }
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
            assert!(lost.to_string().contains("lost the finding lock"), "{lost}");
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
            assert_eq!(opened, [x.clone()], "one incident");
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
    }

    use super::*;

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

        use crate::alerts::rca_runs::tests::{db, failures, new_incident, start, stored, timeline};

        let cfg = o2_enterprise::enterprise::common::config::get_config();
        assert!(
            !(cfg.incidents.enabled && cfg.incidents.rca_enabled),
            "the test relies on the default: RCA off"
        );
        let _db = db().await;
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
            tests::{db, incident_start, new_incident, start, stored},
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
        for (alert, fired_at) in [("a", 1), ("b", 2), ("a", 3), ("a", 4)] {
            add_alert_to_incident(
                &repeat,
                alert,
                &format!("{alert}-name"),
                "alert",
                fired_at,
                "manual",
            )
            .await
            .unwrap();
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
}
