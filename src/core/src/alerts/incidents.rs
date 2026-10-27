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
pub struct CorrelationSubject {
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
        for dest_name in &send.dest_names {
            match crate::alerts::alert::send_templated_to_destination(
                org_id,
                &subject,
                dest_name,
                send.alert_template,
                &mut send.ctx,
            )
            .await
            {
                Ok(resp) => success_parts.push(format!("{dest_name}: {resp}")),
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
    use chrono::TimeZone;

    let org_name = match crate::common::infra::config::ORGANIZATIONS
        .read()
        .await
        .get(org_id)
    {
        Some(org) => org.name.clone(),
        None => org_id.to_string(),
    };
    let trigger_time_str = if triggered_at > 0 {
        chrono::Local
            .timestamp_nanos(triggered_at * 1000)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    } else {
        String::from("N/A")
    };
    crate::alerts::notifications::NotificationContext {
        org_name,
        alert_name: subject_name.to_string(),
        alert_status: crate::alerts::notifications::STATUS_FIRING.to_string(),
        alert_start_time: String::from("N/A"),
        alert_end_time: String::from("N/A"),
        alert_start_time_millis: String::from("N/A"),
        alert_end_time_millis: String::from("N/A"),
        alert_trigger_time: triggered_at,
        alert_trigger_time_str: trigger_time_str,
        ..Default::default()
    }
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

/// Correlate an alert to an incident, and send a notification if appropriate.
///
/// This is the main entry point for incident correlation in the alert execution flow.
/// Called after deduplication, instead of direct notification for `creates_incident=true` alerts.
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
        let title = alert.name.clone();
        match o2_enterprise::enterprise::oncall::escalation::start_for_incident(
            &alert.org_id,
            &incident_id.to_string(),
            &title,
            priority,
            alert.oncall_team.as_deref(),
            &dimensions,
        )
        .await
        {
            // The blast radius hangs off whichever record actually paged, which here is this one.
            Ok(Some(origin)) => {
                // Without this, nothing can get from an incident to the record that paged.
                if let Err(e) = infra::table::oncall_responses::attach_incident(
                    &alert.org_id,
                    &origin.id,
                    &incident_id.to_string(),
                )
                .await
                {
                    log::error!(
                        "[incidents] could not link on-call record for {}/{incident_id}: {e}",
                        alert.org_id
                    );
                }

                if let Err(e) = crate::alerts::scheduler::handlers::page_blast_radius(
                    &alert.org_id,
                    &origin,
                    &dimensions,
                )
                .await
                {
                    log::error!(
                        "[incidents] impacted paging failed for {}/{incident_id}: {e}",
                        alert.org_id
                    );
                }
                routed_origin = Some(origin);
            }
            Ok(None) => {}
            Err(e) => log::error!(
                "[incidents] on-call paging failed for {}/{incident_id}: {e}",
                alert.org_id
            ),
        }
    }

    // Starts after routing decides L0; an un-mute keeps an already stored off decision.
    #[cfg(feature = "enterprise")]
    if let IncidentCorrelationOutcome::NewIncidentCreated { incident_id, .. } = &outcome
        && downtime.is_none()
    {
        if correlation.created {
            start_new_incident_rca(&alert.org_id, incident_id, routed_origin.as_ref()).await;
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
    subject: &CorrelationSubject,
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

    let title =
        o2_enterprise::enterprise::alerts::incidents::generate_title(&subject.name, group_values);

    let incident = infra::table::alert_incidents::create_with_mute(
        org_id,
        &severity,
        serde_json::to_value(group_values)?,
        &key_type.to_string(),
        triggered_at,
        Some(title.clone()),
        muted_by.map(str::to_string),
    )
    .await?;

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

    // Add the first alert to the incident
    infra::table::alert_incidents::add_alert_to_incident(
        &incident.id,
        &subject.id,
        &subject.name,
        subject.kind.as_str(),
        triggered_at,
        correlation_reason,
    )
    .await?;

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

/// A repeat at a more urgent level raises the severity; the alert's own priority beats the level.
async fn escalate_severity(
    org_id: &str,
    incident: &infra::table::entity::alert_incidents::Model,
    subject: &CorrelationSubject,
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

/// Find an existing open incident or create a new one
#[allow(clippy::too_many_arguments)]
async fn find_or_create_incident(
    org_id: &str,
    group_values: &HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
    subject: &CorrelationSubject,
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

        // Use the dedicated DB query: junction table lookup + incident fetch
        if let Some(incident) =
            infra::table::alert_incidents::find_open_incident_by_alert_id(org_id, &alert_id).await?
        {
            // Found existing AlertId incident for this alert - join it
            let (_, reopened) = join_then_unmute(
                infra::table::alert_incidents::add_alert_to_incident(
                    &incident.id,
                    &alert_id,
                    &subject.name,
                    subject.kind.as_str(),
                    triggered_at,
                    correlation_reason,
                ),
                async || unmute_for_firing(org_id, &incident, muted_by).await,
            )
            .await?;

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
    Ok(Correlation {
        outcome,
        created: true,
    })
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
    let actual_counts = infra::table::alert_incidents::get_alert_counts(&incident_ids).await?;

    let incidents_list: Vec<Incident> = incidents
        .into_iter()
        .map(|i| {
            let mut incident = model_to_incident_with_topology(i.clone(), None);

            // Fix alert_count from actual triggers (self-healing for corrupted data)
            if let Some(&actual_count) = actual_counts.get(&i.id)
                && incident.alert_count != actual_count
            {
                log::debug!(
                    "[incidents] List: Incident {} alert_count mismatch: stored={}, actual={}",
                    i.id,
                    incident.alert_count,
                    actual_count
                );
                incident.alert_count = actual_count;
            }

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
    use o2_enterprise::enterprise::{alerts::rca_service, common::config::get_config};

    let cfg = get_config();
    let will_run = cfg.incidents.enabled && cfg.incidents.rca_enabled && cfg.ai.has_agent_target();
    if !will_run {
        rca_service::skip_analysis_for_incident(org_id, incident_id).await;
    }
    will_run
}

/// The user that automatic runs act and are metered as.
#[cfg(feature = "enterprise")]
const SYSTEM_USER_EMAIL: &str = "system@openobserve.ai";

/// The one start path of automatic runs.
#[cfg(feature = "enterprise")]
async fn start_automatic_rca(
    org_id: &str,
    incident_id: &str,
    trigger: config::meta::alerts::rca_runs::RunTrigger,
) {
    use config::meta::alerts::rca_runs::{RunMode, RunTrigger};
    use o2_enterprise::enterprise::alerts::rca_service;

    use super::rca_runs::{RunSubject, StartOutcome, StartRun};

    if !rca_will_run(org_id, incident_id).await {
        return;
    }
    match infra::table::alert_incidents::get(org_id, incident_id).await {
        Ok(Some(incident)) if incident.rca_off_reason.is_some() => {
            log::debug!(
                "[INCIDENTS::RCA] Automatic analysis is off for {incident_id}, skipping {}",
                trigger.as_str()
            );
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            return;
        }
        Ok(_) => {}
        Err(e) => {
            log::error!("[INCIDENTS::RCA] Could not read incident {org_id}/{incident_id}: {e}");
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            return;
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
        return;
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
            return;
        }
        Ok(StartOutcome::CoolingDown) => {
            log::debug!(
                "[INCIDENTS::RCA] Cooldown not elapsed for {incident_id}, skipping {} trigger",
                trigger.as_str()
            );
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            return;
        }
        Err(e) => {
            log::error!("[INCIDENTS::RCA] Could not start a run for {org_id}/{incident_id}: {e}");
            rca_service::skip_analysis_for_incident(org_id, incident_id).await;
            return;
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
}

/// A new incident's first analysis, decided after on-call routing.
#[cfg(feature = "enterprise")]
async fn start_new_incident_rca(
    org_id: &str,
    incident_id: &str,
    routed: Option<&config::meta::oncall::Response>,
) {
    if let Some(record) = routed
        && o2_enterprise::enterprise::alerts::rca_service::l0_off_for_record(org_id, record).await
    {
        if let Err(e) =
            infra::table::alert_incidents::set_rca_off_reason(org_id, incident_id, Some("l0_off"))
                .await
        {
            log::error!(
                "[INCIDENTS::RCA] Could not record that L0 is off for {org_id}/{incident_id}: {e}"
            );
        }
        // No verdict is coming, so nothing may go on holding a page for one.
        o2_enterprise::enterprise::alerts::rca_service::skip_analysis_for_incident(
            org_id,
            incident_id,
        )
        .await;
        return;
    }
    start_automatic_rca(
        org_id,
        incident_id,
        config::meta::alerts::rca_runs::RunTrigger::AutoNewIncident,
    )
    .await;
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
        start_new_incident_rca(org_id, incident_id, routed).await;
    } else {
        start_automatic_rca(
            org_id,
            incident_id,
            config::meta::alerts::rca_runs::RunTrigger::AutoNewIncident,
        )
        .await;
    }
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

    if !config.incidents.enabled || !config.incidents.rca_enabled {
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
    // Acknowledging goes through a dedicated atomic path so the actor and
    // timestamp land on the row itself (not just the event log) and a
    // second/concurrent acknowledge can't silently overwrite the first
    // acknowledger — see `infra::table::alert_incidents::acknowledge`.
    // Read before the resolve clears it, so resolving a muted incident still notifies nobody.
    let muted_before = reads_mute_before(
        status,
        o2_enterprise::enterprise::common::config::get_config()
            .downtimes
            .enabled,
    ) && infra::table::alert_incidents::get(org_id, incident_id)
        .await?
        .is_some_and(|m| m.muted_by_downtime_id.is_some());
    let updated = if status == "acknowledged" {
        infra::table::alert_incidents::acknowledge(org_id, incident_id, user_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Incident not found"))?
    } else {
        infra::table::alert_incidents::update_status(org_id, incident_id, status).await?
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
        "acknowledged" => Some(IncidentEvent::acknowledged(user_id)),
        "resolved" => Some(IncidentEvent::resolved(Some(user_id.to_string()))),
        "open" => Some(IncidentEvent::reopened(user_id, "Manually reopened")),
        _ => None,
    };
    if let Some(evt) = event
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

    #[cfg(feature = "enterprise")]
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

    model_to_incident(updated).await
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
    use super::*;

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
        use config::meta::alerts::rca_runs::{RunState, RunTrigger};

        use crate::alerts::rca_runs::tests::{add_incident, db, new_incident, start};

        let _db = db().await;
        let (org, analyzed) = new_incident(None).await;
        let run_id = start(&org, &analyzed, RunTrigger::AutoNewIncident).await;
        let never = add_incident(&org, None).await;

        let (incidents, total) = list_incidents(&org, None, 50, 0).await.unwrap();

        assert_eq!(total, 2);
        let by_id = |id: &str| incidents.iter().find(|i| i.id == id).unwrap();
        let rca = by_id(&analyzed).rca.as_ref().unwrap();
        assert_eq!(rca.run_id, run_id);
        assert_eq!(rca.state, RunState::Running);
        assert!(!rca.stale);
        assert!(rca.detail.is_none(), "the list adds no join");
        assert!(by_id(&never).rca.is_none());

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
        assert!(slack["attachments"].is_array(), "{body}");
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
