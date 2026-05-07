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
            AlertEdge, AlertNode, CorrelationReason, EdgeType, Incident, IncidentAlert,
            IncidentCorrelationOutcome, IncidentTopology, IncidentWithAlerts,
        },
    },
    utils::json::{Map, Value},
};

/// Service Discovery correlation result
struct ServiceDiscoveryResult {
    group_values: HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
    service_name: String,
}

/// Result from filtered semantic extraction using distinguish_by groups
struct FilteredSemanticResult {
    group_values: HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
}

/// Combined correlation result from both Service Discovery and semantic extraction
struct ParallelCorrelationResult {
    service_discovery: Option<ServiceDiscoveryResult>,
    semantic_extraction: Option<FilteredSemanticResult>,
    final_group_values: HashMap<String, String>,
    final_key_type: config::meta::alerts::incidents::KeyType,
    correlation_reason: String,
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
    let identity_config =
        crate::service::db::system_settings::get_service_identity_config(org_id).await;

    // Validate config has at least one set
    if identity_config.sets.is_empty() {
        log::debug!(
            "[incidents] ServiceIdentityConfig for org {} has no identity sets, semantic extraction skipped",
            org_id
        );
        return None;
    }

    // Load semantic groups for field mapping
    let semantic_groups =
        crate::service::db::system_settings::get_semantic_field_groups(org_id).await;

    // Collect all distinguish_by group IDs from ALL identity sets (flattened)
    // Don't require a specific set to "match" - extract whatever we can
    let mut all_distinguish_by: Vec<String> = Vec::new();
    for set in &identity_config.sets {
        all_distinguish_by.extend(set.distinguish_by.iter().cloned());
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
    log::debug!("[incidents] No service name found in labels, using 'unknown'");
    "unknown".to_string()
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
                "[incidents] Failed to fetch alert list for destination merge (incident {incident_id}): {e}"
            );
            return destinations;
        }
    };

    for ia in &incident_alerts {
        if let Some((_folder, other_alert)) =
            crate::service::db::alerts::alert::get_alert_from_cache(org_id, &ia.alert_id).await
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

/// Build an incident-specific notification payload and send to all given destinations.
///
/// Loads severity, title, and service from the incident record. Constructs an
/// incident-centric JSON body (not the alert row template) and dispatches to each
/// destination using the raw transport (HTTP/email/SNS).
#[cfg(feature = "enterprise")]
async fn send_incident_notifications(
    alert: &Alert,
    incident_id: &str,
    event: &str,
    triggered_at: i64,
    dest_names: &[String],
) {
    if dest_names.is_empty() {
        return;
    }

    let org_id = alert.org_id.as_str();

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
    let time_str = chrono::DateTime::from_timestamp_micros(triggered_at)
        .map(|dt: chrono::DateTime<chrono::Utc>| dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default();

    let payload = config::utils::json::json!({
        "incident": {
            "id": incident_id,
            "title": title,
            "event": event,
            "service": service_name,
            "severity": severity,
            "alert": {
                "name": alert.name,
                "stream": {
                    "name": alert.stream_name,
                    "type": alert.stream_type.to_string(),
                }
            },
            "time": time_str,
            "url": incident_url,
        }
    });
    let msg = match serde_json::to_string(&payload) {
        Ok(s) => s,
        Err(e) => {
            log::error!(
                "[incidents] Failed to serialize notification payload for {incident_id}: {e}"
            );
            return;
        }
    };

    let subject = format!("[{event}] {title}");
    let mut success_parts: Vec<String> = Vec::new();
    let mut err_parts: Vec<String> = Vec::new();

    for dest_name in dest_names {
        match crate::service::db::alerts::destinations::get(org_id, dest_name).await {
            Ok(dest) => {
                use config::meta::destinations::Module;
                let Module::Alert {
                    destination_type, ..
                } = dest.module
                else {
                    err_parts.push(format!("{dest_name}: not an alert destination"));
                    continue;
                };
                match crate::service::alerts::alert::dispatch_notification(
                    &destination_type,
                    &subject,
                    msg.clone(),
                )
                .await
                {
                    Ok(resp) => success_parts.push(format!("{dest_name}: {resp}")),
                    Err(e) => {
                        log::error!(
                            "[incidents] Failed to notify {dest_name} for incident {incident_id}: {e}"
                        );
                        err_parts.push(format!("{dest_name}: {e}"));
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "[incidents] Destination {dest_name} not found for incident {incident_id}: {e}"
                );
                err_parts.push(format!("{dest_name}: {e}"));
            }
        }
    }

    if err_parts.is_empty() {
        log::info!(
            "[incidents] Notification sent for incident {incident_id} ({event}): {}",
            success_parts.join("; ")
        );
    } else {
        log::error!(
            "[incidents] Notification partially failed for incident {incident_id} ({event}): {}",
            err_parts.join("; ")
        );
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
                "[incidents] Failed to load alerts for severity notification (incident {incident_id}): {e}"
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
        crate::service::db::alerts::alert::get_alert_from_cache(org_id, first_alert_id).await
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
) -> Result<Option<IncidentCorrelationOutcome>, anyhow::Error> {
    // Extract labels from result row as HashMap
    let mut labels: HashMap<String, String> = result_row
        .iter()
        .filter_map(|(k, v)| {
            let value_str = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => return None,
            };
            Some((k.clone(), value_str))
        })
        .collect();

    // Enrich with alert condition dimensions (deterministic baseline)
    // Handles SQL WHERE, GUI conditions, and PromQL label matchers
    #[cfg(feature = "enterprise")]
    {
        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(&alert.org_id).await;
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
            "[incidents] Alert {} has no group_values - isolated by alert_id",
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
    // Find or create incident
    let outcome = find_or_create_incident(
        &alert.org_id,
        &group_values,
        key_type,
        alert,
        triggered_at,
        &correlation_reason,
        &service_name,
    )
    .await?;

    // AI credit deduction for incident creation (cloud only).
    // Only deduct when a NEW incident is created — alerts joining an existing
    // incident or repeated firings must not consume credits or post usage events.
    #[cfg(feature = "cloud")]
    if matches!(
        outcome,
        IncidentCorrelationOutcome::NewIncidentCreated { .. }
    ) {
        let deduction = crate::service::trial_quota::try_deduct(
            &alert.org_id,
            crate::service::trial_quota::TrialQuotaFeature::NewIncident,
        )
        .await;

        let usage_ctx = crate::service::trial_quota::AiUsageContext {
            user_email: "system@openobserve.ai".to_string(),
            incident_id: Some(outcome.incident_id().to_string()),
            ..Default::default()
        };
        match &deduction {
            Ok(_) => {
                crate::service::trial_quota::record_free_ai_usage(
                    &alert.org_id,
                    &usage_ctx,
                    crate::service::trial_quota::TrialQuotaFeature::NewIncident,
                );
            }
            Err(_) => {
                if crate::service::trial_quota::org_has_active_subscription(&alert.org_id).await {
                    crate::service::trial_quota::record_billable_ai_usage(
                        &alert.org_id,
                        &usage_ctx,
                        crate::service::trial_quota::TrialQuotaFeature::NewIncident,
                    );
                }
                // Note: incident is already created at this point — we don't roll it
                // back on quota exhaustion. The deduction failure is logged by try_deduct.
            }
        }
    }

    // Send incident notification unless rows are empty (manual trigger path)
    // or the outcome is a repeated alert (suppressed by design).
    if !notify_rows.is_empty() {
        match &outcome {
            IncidentCorrelationOutcome::NewIncidentCreated { incident_id, .. }
            | IncidentCorrelationOutcome::NewAlertTypeJoined { incident_id, .. } => {
                let event = match &outcome {
                    IncidentCorrelationOutcome::NewIncidentCreated { .. } => "new_incident_created",
                    _ => "new_alert_correlated",
                };
                let merged_destinations =
                    collect_incident_destinations(&alert.org_id, incident_id, &alert.destinations)
                        .await;
                send_incident_notifications(
                    alert,
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

    Ok(Some(outcome))
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
        let identity_config =
            crate::service::db::system_settings::get_service_identity_config(org_id).await;

        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(org_id).await;

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

/// Create a brand new incident and set up its initial state.
#[allow(clippy::too_many_arguments)]
async fn create_new_incident(
    org_id: &str,
    group_values: &HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
    alert: &Alert,
    triggered_at: i64,
    correlation_reason: &str,
    service_name: &str,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    let severity = o2_enterprise::enterprise::alerts::incidents::determine_severity(None);

    let title =
        o2_enterprise::enterprise::alerts::incidents::generate_title(&alert.name, group_values);

    let incident = infra::table::alert_incidents::create(
        org_id,
        severity,
        serde_json::to_value(group_values)?,
        &key_type.to_string(),
        triggered_at,
        Some(title.clone()),
    )
    .await?;

    // Initialize event timeline for new incident
    if let Err(e) = infra::table::incident_events::init(org_id, &incident.id).await {
        log::error!(
            "[Incidents] Failed to init events for incident {}: {e}",
            incident.id
        );
    }

    // Add the first alert to the incident
    infra::table::alert_incidents::add_alert_to_incident(
        &incident.id,
        &alert.get_unique_key(),
        &alert.name,
        triggered_at,
        correlation_reason,
    )
    .await?;

    // Record alert event
    if let Err(e) = infra::table::incident_events::record_alert(
        org_id,
        &incident.id,
        &alert.get_unique_key(),
        &alert.name,
        triggered_at,
    )
    .await
    {
        log::error!(
            "[Incidents] Failed to record alert event for incident {}: {e}",
            incident.id
        );
    }

    log::info!(
        "[incidents] Created new incident {} for alert '{}' (key_type: {:?}, severity: {})",
        incident.id,
        alert.name,
        key_type,
        severity
    );

    // Report incident creation to the usage stream
    crate::service::self_reporting::report_request_usage_stats(
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
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::incidents_create(
            org_id,
            &key_type.to_string(),
            severity,
            serde_json::to_value(group_values)?,
            triggered_at,
            Some(title),
        )
        .await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish incident create: {e}");
    }

    spawn_topology_enrichment(
        org_id,
        &incident.id,
        service_name,
        &alert.get_unique_key(),
        &alert.name,
        triggered_at,
    );

    // Trigger immediate RCA for new incident.
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
        let o2_cfg = get_o2_config();

        if o2_cfg.incidents.enabled
            && o2_cfg.incidents.rca_enabled
            && !o2_cfg.ai.agent_url.is_empty()
        {
            if let Err(e) = infra::table::incident_events::append(
                org_id,
                &incident.id,
                config::meta::alerts::incidents::IncidentEvent::ai_analysis_begin(),
            )
            .await
            {
                log::error!(
                    "[INCIDENTS::RCA] Failed to emit AIAnalysisBegin for {}: {e}",
                    incident.id
                );
            }

            let org_id_rca = org_id.to_string();
            let incident_id_rca = incident.id.clone();
            tokio::spawn(async move {
                if let Err(e) = trigger_rca_for_incident(
                    org_id_rca.clone(),
                    incident_id_rca.clone(),
                    false,
                    true,
                    "system@openobserve.ai".to_string(),
                )
                .await
                {
                    log::debug!(
                        "[INCIDENTS::RCA] Immediate trigger failed for incident {incident_id_rca}: {e}"
                    );

                    emit_analysis_failure(
                        &org_id_rca,
                        &incident_id_rca,
                        config::meta::alerts::incidents::AnalysisTriggerType::AutomaticNewIncident,
                        "Background spawn failed",
                        Some(&e),
                    )
                    .await;
                }
            });
        }
    }

    Ok(IncidentCorrelationOutcome::NewIncidentCreated {
        incident_id: incident.id,
        service_name: service_name.to_string(),
    })
}

/// Find an existing open incident or create a new one
#[allow(clippy::too_many_arguments)]
async fn find_or_create_incident(
    org_id: &str,
    group_values: &HashMap<String, String>,
    key_type: config::meta::alerts::incidents::KeyType,
    alert: &Alert,
    triggered_at: i64,
    correlation_reason: &str,
    service_name: &str,
) -> Result<IncidentCorrelationOutcome, anyhow::Error> {
    use config::meta::alerts::incidents::{DimensionRelationship, KeyType};

    // STEP 1: AlertId exact match - check for existing incident with same alert_id
    if key_type == KeyType::AlertId {
        let alert_id = alert.get_unique_key();

        // Use the dedicated DB query: junction table lookup + incident fetch
        if let Some(incident) =
            infra::table::alert_incidents::find_open_incident_by_alert_id(org_id, &alert_id).await?
        {
            // Found existing AlertId incident for this alert - join it
            let _ = infra::table::alert_incidents::add_alert_to_incident(
                &incident.id,
                &alert_id,
                &alert.name,
                triggered_at,
                correlation_reason,
            )
            .await?;

            if let Err(e) = infra::table::incident_events::record_alert(
                org_id,
                &incident.id,
                &alert_id,
                &alert.name,
                triggered_at,
            )
            .await
            {
                log::error!(
                    "[Incidents] Failed to record alert event for incident {}: {e}",
                    incident.id
                );
            }

            spawn_topology_enrichment(
                org_id,
                &incident.id,
                service_name,
                &alert_id,
                &alert.name,
                triggered_at,
            );

            return Ok(IncidentCorrelationOutcome::ExistingAlertRepeated {
                incident_id: incident.id,
                service_name: service_name.to_string(),
            });
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

            let is_new_alert_type = infra::table::alert_incidents::add_alert_to_incident(
                &existing.id,
                &alert.get_unique_key(),
                &alert.name,
                triggered_at,
                correlation_reason,
            )
            .await?;

            if let Err(e) = infra::table::incident_events::record_alert(
                org_id,
                &existing.id,
                &alert.get_unique_key(),
                &alert.name,
                triggered_at,
            )
            .await
            {
                log::error!(
                    "[Incidents] Failed to record alert event for incident {}: {e}",
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

                if let Err(e) = infra::table::incident_events::append(
                    org_id,
                    &existing.id,
                    config::meta::alerts::incidents::IncidentEvent::dimensions_upgraded(
                        old_key_type_str,
                        new_key_type_str,
                    ),
                )
                .await
                {
                    log::error!("[Incidents] Failed to record dimensions upgrade event: {e}");
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
                        &alert.get_unique_key(),
                        &alert.name,
                        triggered_at,
                        correlation_reason,
                    )
                    .await
            {
                log::error!("[SUPER_CLUSTER] Failed to publish incident add_alert: {e}");
            }

            spawn_topology_enrichment(
                org_id,
                &existing.id,
                service_name,
                &alert.get_unique_key(),
                &alert.name,
                triggered_at,
            );

            if is_new_alert_type {
                #[cfg(feature = "enterprise")]
                {
                    let org_id_rca = org_id.to_string();
                    let incident_id_rca = existing.id.clone();
                    let cooldown = o2_enterprise::enterprise::common::config::get_config()
                        .incidents
                        .reanalysis_cooldown_minutes;
                    let events = infra::table::incident_events::get(&org_id_rca, &incident_id_rca)
                        .await
                        .unwrap_or_default();
                    if !is_analysis_in_flight(&events, cooldown * 2) {
                        let _ = infra::table::incident_events::append(
                            &org_id_rca,
                            &incident_id_rca,
                            config::meta::alerts::incidents::IncidentEvent::ai_analysis_begin(),
                        )
                        .await;
                        tokio::spawn(async move {
                            if let Err(e) = trigger_rca_for_incident(
                                org_id_rca.clone(),
                                incident_id_rca.clone(),
                                true,
                                true,
                                "system@openobserve.ai".to_string(),
                            )
                            .await
                            {
                                log::debug!(
                                    "[INCIDENTS::RCA] Reanalysis trigger failed for {incident_id_rca}: {e}"
                                );

                                emit_analysis_failure(
                                    &org_id_rca,
                                    &incident_id_rca,
                                    config::meta::alerts::incidents::AnalysisTriggerType::AutomaticReanalysis,
                                    "Reanalysis trigger failed",
                                    Some(&e),
                                ).await;
                            }
                        });
                    } else {
                        log::debug!(
                            "[INCIDENTS::RCA] Analysis already in-flight for {incident_id_rca}, skipping NewAlertTypeJoined trigger"
                        );
                    }
                }
                return Ok(IncidentCorrelationOutcome::NewAlertTypeJoined {
                    incident_id: existing.id,
                    service_name: service_name.to_string(),
                });
            } else {
                return Ok(IncidentCorrelationOutcome::ExistingAlertRepeated {
                    incident_id: existing.id,
                    service_name: service_name.to_string(),
                });
            }
        }
    }

    create_new_incident(
        org_id,
        group_values,
        key_type,
        alert,
        triggered_at,
        correlation_reason,
        service_name,
    )
    .await
}

/// Get incident with its alerts for detail view
pub async fn get_incident_with_alerts(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<IncidentWithAlerts>, anyhow::Error> {
    let incident = match infra::table::alert_incidents::get(org_id, incident_id).await? {
        Some(i) => i,
        None => return Ok(None),
    };

    let incident_alerts = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;

    // Store org_id before moving incident
    let incident_org_id = incident.org_id.clone();

    // Convert to config types
    let mut incident_data = model_to_incident(incident).await?;

    // Fix alert_count from actual triggers (source of truth)
    // This heals any inconsistencies from race conditions or historical bugs
    let actual_count = incident_alerts.len() as i32;
    if incident_data.alert_count != actual_count {
        log::warn!(
            "[incidents] Incident {} alert_count mismatch: stored={}, actual={}. Using actual count.",
            incident_id,
            incident_data.alert_count,
            actual_count
        );
        incident_data.alert_count = actual_count;
    }

    // Convert incident_alerts to triggers
    let triggers: Vec<IncidentAlert> = incident_alerts
        .iter()
        .map(|a| IncidentAlert {
            incident_id: a.incident_id.clone(),
            alert_id: a.alert_id.clone(),
            alert_name: a.alert_name.clone(),
            alert_fired_at: a.alert_fired_at,
            correlation_reason: a
                .correlation_reason
                .as_ref()
                .and_then(|r| CorrelationReason::try_from(r.as_str()).ok())
                .unwrap_or(CorrelationReason::AlertId),
            created_at: a.created_at,
        })
        .collect();

    // Get unique alert names from triggers
    let unique_alert_names: std::collections::HashSet<String> = incident_alerts
        .iter()
        .map(|a| a.alert_name.clone())
        .collect();

    // Fetch full alert details for each unique alert name
    let mut alerts = Vec::new();
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
                        log::warn!(
                            "Failed to fetch alert details for {}: {}",
                            trigger.alert_id,
                            e
                        );
                    }
                }
            }
        }
    }

    Ok(Some(IncidentWithAlerts {
        incident: incident_data,
        triggers,
        alerts,
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

    use crate::service::traces::service_graph;

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
                // Query service graph to check for a known dependency
                let raw_sg_edges = match service_graph::query_edges_from_stream_internal(
                    org_id, None, None, None,
                )
                .await
                {
                    Ok(e) => e,
                    Err(e) => {
                        log::debug!(
                            "[incidents] Service graph query failed: {e}, defaulting to temporal edge"
                        );
                        vec![]
                    }
                };

                let (_, sg_topo_edges) = if !raw_sg_edges.is_empty() {
                    o2_enterprise::enterprise::service_graph::build_topology(
                        raw_sg_edges,
                        std::collections::HashMap::new(),
                    )
                } else {
                    (vec![], vec![])
                };

                let has_sg_edge = sg_topo_edges.iter().any(|e| {
                    e.from.as_deref() == Some(&*topology.nodes[prev_idx].service_name)
                        && e.to == topology.nodes[current_node_index].service_name
                });

                if has_sg_edge {
                    EdgeType::ServiceDependency
                } else {
                    EdgeType::Temporal
                }
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

/// Trigger RCA for a single incident immediately after creation
///
/// Called asynchronously via tokio::spawn to avoid blocking incident creation.
/// Reuses RcaAgentClient configuration from enterprise crate.
///
/// # Arguments
/// * `org_id` - Organization ID
/// * `incident_id` - Incident ID
///
/// # Returns
/// * `Ok(())` if RCA successfully triggered and saved
/// * `Err(_)` if configuration invalid, agent unavailable, or analysis failed
///
/// # Note
/// Errors are logged but not propagated to caller.
///
/// Returns true if an analysis is currently in-flight (started but not yet completed).
///
/// An in-flight analysis is detected by finding an `AIAnalysisBegin` event with no
/// subsequent `AIAnalysisComplete`. Begins older than `stale_threshold_minutes` are
/// treated as stale (the run died) and do not block new runs.
#[cfg(feature = "enterprise")]
pub(crate) fn is_analysis_in_flight(
    events: &[config::meta::alerts::incidents::IncidentEvent],
    stale_threshold_minutes: u64,
) -> bool {
    use config::meta::alerts::incidents::IncidentEventType;

    let stale_cutoff =
        chrono::Utc::now().timestamp_micros() - (stale_threshold_minutes as i64 * 60 * 1_000_000);

    // Walk backwards: find last AIAnalysisComplete, then check if a
    // non-stale AIAnalysisBegin comes after it.
    let last_complete_pos = events
        .iter()
        .rposition(|e| matches!(e.event_type, IncidentEventType::AIAnalysisComplete));

    let search_from = last_complete_pos.map(|p| p + 1).unwrap_or(0);

    events[search_from..].iter().any(|e| {
        matches!(e.event_type, IncidentEventType::AIAnalysisBegin) && e.timestamp > stale_cutoff
    })
}

/// Returns true if enough time has passed since the last completed analysis.
///
/// If no analysis has ever completed, returns `true` (proceed freely).
#[cfg(feature = "enterprise")]
fn cooldown_elapsed(
    events: &[config::meta::alerts::incidents::IncidentEvent],
    cooldown_minutes: u64,
) -> bool {
    use config::meta::alerts::incidents::IncidentEventType;

    let cooldown_micros = cooldown_minutes as i64 * 60 * 1_000_000;
    let now = chrono::Utc::now().timestamp_micros();

    let last_complete = events
        .iter()
        .rposition(|e| matches!(e.event_type, IncidentEventType::AIAnalysisComplete))
        .map(|pos| events[pos].timestamp);

    match last_complete {
        None => true, // never analyzed (or all prior runs failed) — proceed
        Some(ts) => now - ts >= cooldown_micros,
    }
}

/// Emit an AI analysis failure event for the specified incident
#[cfg(feature = "enterprise")]
async fn emit_analysis_failure(
    org_id: &str,
    incident_id: &str,
    trigger_type: config::meta::alerts::incidents::AnalysisTriggerType,
    reason: &str,
    error: Option<&anyhow::Error>,
) {
    use config::meta::alerts::incidents::IncidentEvent;

    let error_details = error.map(|e| format!("{:#}", e).chars().take(500).collect::<String>());

    if let Err(e) = infra::table::incident_events::append(
        org_id,
        incident_id,
        IncidentEvent::ai_analysis_failed(reason, trigger_type, error_details),
    )
    .await
    {
        log::error!(
            "[INCIDENTS::RCA] Failed to emit AIAnalysisFailed event for {incident_id}: {e}"
        );
    }
}

#[cfg(feature = "enterprise")]
pub async fn trigger_rca_for_incident(
    org_id: String,
    incident_id: String,
    reanalysis: bool,
    // When `true`, the caller has already:
    //  - verified RCA is enabled and the agent URL is set
    //  - checked cooldown / in-flight guards
    //  - emitted `AIAnalysisBegin` synchronously (same DB context as `init`)
    // The function skips those steps and goes straight to the agent call.
    begin_already_emitted: bool,
    // Email of the user who triggered the analysis, used for AI usage tracking.
    // For automated/system-initiated calls, use "system@openobserve.ai".
    _user_email: String,
) -> Result<(), anyhow::Error> {
    use config::meta::alerts::incidents::IncidentTopology;
    use o2_enterprise::enterprise::{
        ai::client::get_agent_client, common::config::get_config as get_o2_config,
    };

    let config = get_o2_config();

    // Check if RCA is enabled and configured
    if !config.incidents.enabled || !config.incidents.rca_enabled {
        log::debug!("[INCIDENTS::RCA] RCA not enabled, skipping immediate trigger");
        return Ok(()); // Not an error - just not configured
    }

    if config.ai.agent_url.is_empty() {
        log::debug!("[INCIDENTS::RCA] RCA agent URL not set, skipping immediate trigger");
        return Ok(());
    }

    // When the caller already emitted Begin synchronously, skip the guards and Begin emission
    // to avoid a DB race where the spawned task can't yet see the freshly-init'd events row.
    if !begin_already_emitted {
        let cooldown = config.incidents.reanalysis_cooldown_minutes;
        // Use 2× cooldown as the stale-begin threshold
        let stale_threshold = cooldown * 2;

        let events = infra::table::incident_events::get(&org_id, &incident_id)
            .await
            .unwrap_or_default();

        // In-flight guard: always enforced, even for user-initiated reanalysis
        if is_analysis_in_flight(&events, stale_threshold) {
            log::debug!("[INCIDENTS::RCA] Analysis already in-flight for {incident_id}, skipping");
            return Ok(());
        }

        // Cooldown gate: skip for user-initiated reanalysis (reanalysis=true bypasses it)
        if !reanalysis && !cooldown_elapsed(&events, cooldown) {
            log::debug!("[INCIDENTS::RCA] Cooldown not elapsed for {incident_id}, skipping");
            return Ok(());
        }
    }

    // Get incident from database
    let incident = match infra::table::alert_incidents::get(&org_id, &incident_id).await? {
        Some(inc) => inc,
        None => {
            log::warn!("[INCIDENTS::RCA] Incident {incident_id} not found");
            return Err(anyhow::anyhow!("Incident not found"));
        }
    };

    log::info!(
        "[INCIDENTS::RCA] Triggering RCA for incident {incident_id} (reanalysis={reanalysis})"
    );

    // Emit AIAnalysisBegin only when the caller hasn't already done so
    if !begin_already_emitted
        && let Err(e) = infra::table::incident_events::append(
            &org_id,
            &incident_id,
            config::meta::alerts::incidents::IncidentEvent::ai_analysis_begin(),
        )
        .await
    {
        log::error!("[INCIDENTS::RCA] Failed to emit AIAnalysisBegin for {incident_id}: {e}");
    }

    // AI credit check for reanalysis (cloud only)
    #[cfg(feature = "cloud")]
    if reanalysis {
        let deduction = crate::service::trial_quota::try_deduct(
            &org_id,
            crate::service::trial_quota::TrialQuotaFeature::IncidentReAnalysis,
        )
        .await;

        let usage_ctx = crate::service::trial_quota::AiUsageContext {
            user_email: _user_email.clone(),
            incident_id: Some(incident_id.clone()),
            ..Default::default()
        };
        match &deduction {
            Ok(_) => {
                crate::service::trial_quota::record_free_ai_usage(
                    &org_id,
                    &usage_ctx,
                    crate::service::trial_quota::TrialQuotaFeature::IncidentReAnalysis,
                );
            }
            Err(e) => {
                if crate::service::trial_quota::org_has_active_subscription(&org_id).await {
                    crate::service::trial_quota::record_billable_ai_usage(
                        &org_id,
                        &usage_ctx,
                        crate::service::trial_quota::TrialQuotaFeature::IncidentReAnalysis,
                    );
                } else {
                    log::info!("[INCIDENTS::RCA] Skipping reanalysis for org {org_id}: {e}");
                    return Ok(());
                }
            }
        }
    }

    // Create RCA agent client with SA credentials
    let (email, token) = crate::service::organization::get_sre_agent_credentials(&org_id).await?;
    let auth_header = crate::common::utils::auth::build_basic_auth_header(&email, &token);

    let client =
        get_agent_client().ok_or_else(|| anyhow::anyhow!("RCA agent client not initialized"))?;

    // Quick health check
    if let Err(e) = client.health(&auth_header).await {
        log::debug!("[INCIDENTS::RCA] Agent health check failed for immediate trigger: {e}");
        return Err(anyhow::anyhow!("RCA agent not available: {}", e));
    }

    // Analyze incident
    match client.analyze_incident(&incident, &auth_header).await {
        Ok(rca_result) => {
            log::info!(
                "[INCIDENTS::RCA] RCA completed for {incident_id}: {} chars",
                rca_result.len()
            );

            // Update topology_context with suggested_root_cause
            let mut topology = incident
                .topology_context
                .and_then(|ctx| serde_json::from_value::<IncidentTopology>(ctx).ok())
                .unwrap_or_default();

            topology.suggested_root_cause = Some(rca_result);

            if let Err(e) =
                infra::table::alert_incidents::update_topology(&org_id, &incident_id, &topology)
                    .await
            {
                log::error!("[INCIDENTS::RCA] Failed to save RCA result for {incident_id}: {e}");
                return Err(e.into());
            }

            // Emit AIAnalysisComplete on success
            if let Err(e) = infra::table::incident_events::append(
                &org_id,
                &incident_id,
                config::meta::alerts::incidents::IncidentEvent::ai_analysis_complete(),
            )
            .await
            {
                log::error!(
                    "[INCIDENTS::RCA] Failed to emit AIAnalysisComplete for {incident_id}: {e}"
                );
            }

            // Reanalysis usage reporting is handled by the try_deduct
            // quota block earlier in this function (paid orgs only).

            Ok(())
        }
        Err(e) => {
            log::warn!("[INCIDENTS::RCA] RCA failed for {incident_id}: {e}");

            // Determine trigger type based on function context
            let trigger_type = if reanalysis {
                if _user_email == "system@openobserve.ai" {
                    config::meta::alerts::incidents::AnalysisTriggerType::AutomaticReanalysis
                } else {
                    config::meta::alerts::incidents::AnalysisTriggerType::Manual
                }
            } else {
                config::meta::alerts::incidents::AnalysisTriggerType::AutomaticNewIncident
            };

            emit_analysis_failure(
                &org_id,
                &incident_id,
                trigger_type,
                "RCA service call failed",
                Some(&e),
            )
            .await;

            Err(e)
        }
    }
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

/// Convert database model to domain model with pre-fetched topology
fn model_to_incident_with_topology(
    db_model: infra::table::entity::alert_incidents::Model,
    topology_context: Option<IncidentTopology>,
) -> Incident {
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
        created_at: db_model.created_at,
        updated_at: db_model.updated_at,
        group_values: db_model.group_values,
        key_type: config::meta::alerts::incidents::KeyType::from_stored(&db_model.key_type),
        topology_context,
    }
}

/// Update incident status
pub async fn update_status(
    org_id: &str,
    incident_id: &str,
    status: &str,
    user_id: &str,
) -> Result<Incident, anyhow::Error> {
    let updated = infra::table::alert_incidents::update_status(org_id, incident_id, status).await?;

    // Emit status change event
    use config::meta::alerts::incidents::IncidentEvent;
    let event = match status {
        "acknowledged" => Some(IncidentEvent::acknowledged(user_id)),
        "resolved" => Some(IncidentEvent::resolved(Some(user_id.to_string()))),
        "open" => Some(IncidentEvent::reopened(user_id, "Manually reopened")),
        _ => None,
    };
    if let Some(evt) = event
        && let Err(e) = infra::table::incident_events::append(org_id, incident_id, evt).await
    {
        log::error!("[Incidents] Failed to record status event: {e}");
    }

    // Trigger RCA reanalysis when incident is reopened — context is fresh,
    // cooldown is bypassed, but in-flight guard still applies.
    #[cfg(feature = "enterprise")]
    if status == "open" {
        let org_id_rca = org_id.to_string();
        let incident_id_rca = incident_id.to_string();
        let cooldown = o2_enterprise::enterprise::common::config::get_config()
            .incidents
            .reanalysis_cooldown_minutes;
        let events = infra::table::incident_events::get(&org_id_rca, &incident_id_rca)
            .await
            .unwrap_or_default();
        if !is_analysis_in_flight(&events, cooldown * 2) {
            // Emit Begin synchronously so the frontend sees it on the next poll
            let _ = infra::table::incident_events::append(
                &org_id_rca,
                &incident_id_rca,
                config::meta::alerts::incidents::IncidentEvent::ai_analysis_begin(),
            )
            .await;
            tokio::spawn(async move {
                // reanalysis on reopen: deduct credits and report usage;
                // begin_already_emitted=true skips cooldown/in-flight guards
                if let Err(e) = trigger_rca_for_incident(
                    org_id_rca.clone(),
                    incident_id_rca.clone(),
                    true, // reanalysis — deduct credits and report usage
                    true, // begin already emitted above
                    "system@openobserve.ai".to_string(),
                )
                .await
                {
                    log::debug!("[INCIDENTS::RCA] Reanalysis trigger failed after Reopened: {e}");

                    emit_analysis_failure(
                        &org_id_rca,
                        &incident_id_rca,
                        config::meta::alerts::incidents::AnalysisTriggerType::AutomaticReopened,
                        "Reanalysis after reopen failed",
                        Some(&e),
                    )
                    .await;
                }
            });
        } else {
            log::debug!(
                "[INCIDENTS::RCA] Analysis already in-flight for {incident_id_rca}, skipping Reopened trigger"
            );
        }
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
        log::error!("[SUPER_CLUSTER] Failed to publish incident update_status: {e}");
    }

    model_to_incident(updated).await
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
        && let Err(e) = infra::table::incident_events::append(
            org_id,
            incident_id,
            config::meta::alerts::incidents::IncidentEvent::title_changed(
                from_title, title, user_id,
            ),
        )
        .await
    {
        log::error!("[Incidents] Failed to record title change event: {e}");
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
    if from_severity != to_severity {
        if let Err(e) = infra::table::incident_events::append(
            org_id,
            incident_id,
            config::meta::alerts::incidents::IncidentEvent::severity_override(
                from_severity,
                to_severity,
                user_id,
            ),
        )
        .await
        {
            log::error!("[Incidents] Failed to record severity event: {e}");
        }
        send_incident_severity_notification(org_id, incident_id).await;
    }

    model_to_incident(updated).await
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_cooldown_elapsed_no_events_returns_true() {
        assert!(cooldown_elapsed(&[], 5));
    }

    #[test]
    fn test_cooldown_elapsed_no_ai_complete_event_returns_true() {
        use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
        let events = vec![IncidentEvent {
            timestamp: chrono::Utc::now().timestamp_micros(),
            event_type: IncidentEventType::Created,
        }];
        assert!(cooldown_elapsed(&events, 5));
    }

    #[test]
    fn test_cooldown_elapsed_recent_ai_complete_returns_false() {
        use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
        // Timestamp = now - 30 seconds; cooldown = 5 minutes → not elapsed
        let recent_ts = chrono::Utc::now().timestamp_micros() - 30 * 1_000_000;
        let events = vec![IncidentEvent {
            timestamp: recent_ts,
            event_type: IncidentEventType::AIAnalysisComplete,
        }];
        assert!(!cooldown_elapsed(&events, 5));
    }

    #[test]
    fn test_cooldown_elapsed_old_ai_complete_returns_true() {
        use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
        // Timestamp = epoch (very old); cooldown = 1 minute → elapsed
        let events = vec![IncidentEvent {
            timestamp: 1_000_000, // 1 second after epoch
            event_type: IncidentEventType::AIAnalysisComplete,
        }];
        assert!(cooldown_elapsed(&events, 1));
    }

    #[test]
    fn test_cooldown_elapsed_uses_last_ai_complete() {
        use config::meta::alerts::incidents::{IncidentEvent, IncidentEventType};
        // Two AIAnalysisComplete events: old one and recent one
        // Should use the last (most recent) one → not elapsed
        let old_ts = 1_000_000i64;
        let recent_ts = chrono::Utc::now().timestamp_micros() - 30 * 1_000_000;
        let events = vec![
            IncidentEvent {
                timestamp: old_ts,
                event_type: IncidentEventType::AIAnalysisComplete,
            },
            IncidentEvent {
                timestamp: chrono::Utc::now().timestamp_micros(),
                event_type: IncidentEventType::Created,
            },
            IncidentEvent {
                timestamp: recent_ts,
                event_type: IncidentEventType::AIAnalysisComplete,
            },
        ];
        // last AIAnalysisComplete is at recent_ts (30 seconds ago), cooldown = 5 minutes
        assert!(!cooldown_elapsed(&events, 5));
    }

    #[test]
    fn test_merge_correlation_results_sd_wins_over_semantic() {
        use config::meta::alerts::incidents::KeyType;
        let sd = ServiceDiscoveryResult {
            group_values: [("ns".to_string(), "prod".to_string())].into(),
            key_type: KeyType::Primary,
            service_name: "svc-a".to_string(),
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
        assert_eq!(name, "unknown");
    }
}
