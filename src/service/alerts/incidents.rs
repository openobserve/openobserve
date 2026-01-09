// Copyright 2025 OpenObserve Inc.
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

//! Alert Incident Correlation Service (Enterprise only)
//!
//! Correlates fired alerts into unified incidents to reduce alert fatigue.

use std::collections::{HashMap, HashSet};

use config::{
    meta::alerts::{alert::Alert, deduplication::GlobalDeduplicationConfig},
    utils::json::{Map, Value},
};

/// Service Discovery correlation result
struct ServiceDiscoveryResult {
    correlation_key: String,
    service_name: String,
    matched_dimensions: HashMap<String, String>,
}

/// Extract service name from dimensions using FQN priority
/// Guarantees a service name is always returned (fallback to "unknown")
fn extract_service_name_from_dimensions(
    dimensions: &HashMap<String, String>,
    fqn_priority: &[String],
) -> String {
    // Try each FQN priority dimension in order
    for dim_key in fqn_priority {
        if let Some(value) = dimensions.get(dim_key)
            && !value.is_empty()
        {
            return value.clone();
        }
    }

    // Final fallback: check "service" directly
    dimensions
        .get("service")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string())
}

/// Extract all service names from stable_dimensions using FQN priority
fn extract_all_services(
    dimensions: &HashMap<String, String>,
    fqn_priority: &[String],
) -> Vec<String> {
    let mut services = Vec::new();

    // Check each FQN dimension (k8s-deployment, k8s-statefulset, etc.)
    for fqn_key in fqn_priority {
        if let Some(service) = dimensions.get(fqn_key)
            && !service.is_empty()
            && !services.contains(service)
        {
            services.push(service.clone());
        }
    }

    // Fallback: check "service" dimension
    if services.is_empty()
        && let Some(service) = dimensions.get("service")
    {
        services.push(service.clone());
    }

    services
}

/// Get primary service (first from FQN priority or first discovered)
fn get_primary_service(all_services: &[String]) -> String {
    all_services
        .first()
        .cloned()
        .unwrap_or_else(|| "unknown".to_string())
}

/// Extract service name from an alert using multiple strategies
///
/// Tries in order:
/// 1. Query service discovery using alert's stream and stream_type
/// 2. Extract from alert labels/dimensions using FQN priority
/// 3. Parse from alert_name
/// 4. Fallback to "unknown"
///
/// NOTE: Currently unused but ready for optimization when we add service_name to junction table
#[allow(dead_code)]
async fn extract_service_from_alert(
    org_id: &str,
    alert_name: &str,
    alert_stream: &str,
    alert_stream_type: &str,
    labels: &HashMap<String, String>,
) -> String {
    // Strategy 1: Query service discovery
    #[cfg(feature = "enterprise")]
    {
        let fqn_priority =
            crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;
        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(org_id).await;

        if let Ok(Some(response)) =
            o2_enterprise::enterprise::service_streams::storage::ServiceStorage::correlate(
                org_id,
                alert_stream,
                alert_stream_type,
                labels,
                &fqn_priority,
                &semantic_groups,
            )
            .await
        {
            return response.service_name;
        }
    }

    // Strategy 2: Extract from labels using FQN priority
    let fqn_priority =
        crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;
    let service_from_fqn = extract_service_name_from_dimensions(labels, &fqn_priority);
    if service_from_fqn != "unknown" {
        return service_from_fqn;
    }

    // Strategy 3: Parse from alert_name
    // Alert names often include service name, e.g. "api-gateway-high-cpu"
    if let Some(service) = parse_service_from_alert_name(alert_name) {
        return service;
    }

    // Strategy 4: Fallback
    "unknown".to_string()
}

/// Parse service name from alert name patterns
fn parse_service_from_alert_name(alert_name: &str) -> Option<String> {
    // Common patterns:
    // - "service-name-metric-name" -> "service-name"
    // - "ServiceName_MetricName" -> "ServiceName"
    // - "[service-name] alert description" -> "service-name"

    // Try bracketed pattern first: [service-name]
    if let Some(start) = alert_name.find('[') {
        if let Some(end) = alert_name[start..].find(']') {
            let service = &alert_name[start + 1..start + end];
            if !service.is_empty() {
                return Some(service.to_string());
            }
        }
    }

    // Try first component before common separators
    let separators = [
        "-high-",
        "-low-",
        "-error-",
        "-latency-",
        "_alert",
        "_warning",
    ];
    for sep in &separators {
        if let Some(pos) = alert_name.find(sep) {
            let service = &alert_name[..pos];
            if !service.is_empty() {
                return Some(service.to_string());
            }
        }
    }

    None
}

/// Correlate an alert to an incident
///
/// This is the main entry point for incident correlation in the alert execution flow.
/// Called after deduplication, before notification.
///
/// Correlation priority:
/// 1. trace_id (if present) - groups all alerts from same distributed trace
/// 2. Service Discovery hash - uses pre-computed correlation_key from service_streams table
/// 3. Manual extraction - computes blake3 hash from stable dimensions
///
/// Returns the incident ID if the alert was correlated to an existing or new incident.
pub async fn correlate_alert_to_incident(
    alert: &Alert,
    result_row: &Map<String, Value>,
    triggered_at: i64,
    _service_name_hint: Option<&str>,
    trace_id: Option<&str>,
) -> Result<Option<(String, String)>, anyhow::Error> {
    // Get org-level deduplication config for semantic groups
    let org_config = match super::org_config::get_deduplication_config(&alert.org_id).await {
        Ok(Some(config)) if config.enabled => config,
        Ok(Some(_)) | Ok(None) => {
            // No org config or disabled - use default semantic groups
            GlobalDeduplicationConfig::default()
        }
        Err(e) => {
            log::warn!(
                "Failed to fetch org config for incident correlation: {}, using defaults",
                e
            );
            GlobalDeduplicationConfig::default()
        }
    };

    // Extract labels from result row as HashMap
    let labels: HashMap<String, String> = result_row
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

    // Query Service Discovery for pre-computed correlation_key hash using correlation API
    let service_discovery_result =
        query_service_discovery_key(&alert.org_id, &alert.stream_name, &labels).await;

    // Use enterprise correlation engine with actual hash (or None for fallback)
    let correlation_result = o2_enterprise::enterprise::alerts::incidents::correlate_alert(
        &labels,
        service_discovery_result
            .as_ref()
            .map(|r| r.correlation_key.as_str()),
        trace_id,
        &org_config,
    );

    // Guarantee service_name extraction
    let service_name = if let Some(ref sd_result) = service_discovery_result {
        sd_result.service_name.clone()
    } else {
        // Fallback: Extract from stable_dimensions using FQN priority
        let fqn_priority =
            crate::service::db::system_settings::get_fqn_priority_dimensions(&alert.org_id).await;
        extract_service_name_from_dimensions(&correlation_result.stable_dimensions, &fqn_priority)
    };

    // Merge service discovery matched_dimensions with correlation stable_dimensions
    // This enriches the incident with FQN fields (k8s-deployment, k8s-namespace, service, etc.)
    let enriched_dimensions = if let Some(ref sd) = service_discovery_result {
        let mut merged = correlation_result.stable_dimensions.clone();

        // Add all matched dimensions from service discovery
        // These include FQN fields needed for topology extraction
        for (key, value) in &sd.matched_dimensions {
            merged.insert(key.clone(), value.clone());
        }

        merged
    } else {
        // No service discovery match, use correlation dimensions only
        correlation_result.stable_dimensions.clone()
    };

    log::info!(
        "[incidents] Alert {} correlation - service: {}, correlation_key: {}, dimensions: {} (service_discovery: {})",
        alert.name,
        service_name,
        correlation_result.correlation_key,
        enriched_dimensions.len(),
        service_discovery_result.is_some()
    );

    // Find or create incident with enriched dimensions
    let incident_id = find_or_create_incident(
        &alert.org_id,
        &correlation_result.correlation_key,
        &enriched_dimensions,
        alert,
        triggered_at,
        &correlation_result.reason.to_string(),
        &service_name,
    )
    .await?;

    Ok(Some((incident_id, service_name)))
}

/// Query Service Discovery for correlation_key using the correlation API
///
/// Uses ServiceStorage::correlate() from PR #9513 for proper dimension matching
/// Returns full result including service_name for topology enrichment
async fn query_service_discovery_key(
    org_id: &str,
    alert_stream: &str,
    labels: &HashMap<String, String>,
) -> Option<ServiceDiscoveryResult> {
    #[cfg(feature = "enterprise")]
    {
        // Get FQN priority and semantic groups (org-level or system defaults)
        let fqn_priority =
            crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;

        let semantic_groups =
            crate::service::db::system_settings::get_semantic_field_groups(org_id).await;

        // Use the existing ServiceStorage::correlate API for proper dimension matching
        match o2_enterprise::enterprise::service_streams::storage::ServiceStorage::correlate(
            org_id,
            alert_stream,
            "logs", // Most alerts come from logs, could use alert.stream_type
            labels,
            &fqn_priority,
            &semantic_groups,
        )
        .await
        {
            Ok(Some(response)) => {
                // Compute correlation_key from the matched dimensions
                let correlation_key =
                    o2_enterprise::enterprise::alerts::incidents::compute_correlation_key(
                        &response.matched_dimensions,
                        &semantic_groups,
                    );

                log::debug!(
                    "[incidents] Found service via correlation API: {} (correlation_key: {})",
                    response.service_name,
                    correlation_key
                );

                // Return full result including service_name
                Some(ServiceDiscoveryResult {
                    correlation_key,
                    service_name: response.service_name,
                    matched_dimensions: response.matched_dimensions,
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

/// Find an existing open incident or create a new one
async fn find_or_create_incident(
    org_id: &str,
    correlation_key: &str,
    stable_dimensions: &HashMap<String, String>,
    alert: &Alert,
    triggered_at: i64,
    correlation_reason: &str,
    service_name: &str,
) -> Result<String, anyhow::Error> {
    // Note: trace_id is already in stable_dimensions when trace correlation is used

    // Try to find existing open incident
    if let Some(existing) =
        infra::table::alert_incidents::find_open_by_correlation_key(org_id, correlation_key).await?
    {
        // Deserialize current dimensions
        let mut current_dims: HashMap<String, String> =
            serde_json::from_value(existing.stable_dimensions.clone()).unwrap_or_default();

        // Merge: add new dimensions if key doesn't exist
        let initial_count = current_dims.len();
        for (key, new_value) in stable_dimensions {
            use std::collections::hash_map::Entry;
            match current_dims.entry(key.clone()) {
                Entry::Vacant(e) => {
                    // New dimension - add it
                    e.insert(new_value.clone());
                }
                Entry::Occupied(e) => {
                    // Dimension exists - check for conflict
                    if e.get() != new_value {
                        log::warn!(
                            "[incidents] Dimension conflict in incident {}: {}='{}' (incoming) vs '{}' (existing) - keeping existing",
                            existing.id,
                            key,
                            new_value,
                            e.get()
                        );
                        // Keep existing value (first-seen wins)
                    }
                }
            }
        }

        let dimensions_changed = current_dims.len() > initial_count;

        if dimensions_changed {
            log::info!(
                "[incidents] Incident {} dimensions expanded: {} → {} dimensions",
                existing.id,
                initial_count,
                current_dims.len()
            );
        }

        // Update incident metadata
        let new_alert_count = existing.alert_count + 1;
        infra::table::alert_incidents::update_incident_metadata(
            org_id,
            &existing.id,
            new_alert_count,
            triggered_at,
            if dimensions_changed {
                Some(serde_json::to_value(&current_dims)?)
            } else {
                None
            },
        )
        .await?;

        // Add alert to junction table
        let alert_id = alert.get_unique_key();
        infra::table::alert_incidents::add_alert_to_incident(
            &existing.id,
            &alert_id,
            &alert.name,
            triggered_at,
            correlation_reason,
        )
        .await?;

        log::debug!(
            "[incidents] Added alert '{}' to existing incident {} (correlation_key: {}, dimensions_changed: {})",
            alert.name,
            existing.id,
            correlation_key,
            dimensions_changed
        );

        #[cfg(feature = "enterprise")]
        if o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
            && !config::get_config().common.local_mode
            && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::incidents_add_alert(
                org_id,
                &existing.id,
                &alert_id,
                &alert.name,
                triggered_at,
                correlation_reason,
            )
            .await
        {
            log::error!("[SUPER_CLUSTER] Failed to publish incident add_alert: {e}");
        }

        // Always trigger topology re-enrichment when new alert is added
        // This ensures the graph includes all services from all alerts
        let org_id_clone = org_id.to_string();
        let incident_id_clone = existing.id.clone();
        let service_name_clone = service_name.to_string();

        tokio::spawn(async move {
            if let Err(e) =
                enrich_with_topology(&org_id_clone, &incident_id_clone, &service_name_clone).await
            {
                log::debug!(
                    "[incidents] Topology enrichment failed for incident {incident_id_clone}: {e}"
                );
            }
        });

        return Ok(existing.id);
    }

    // Create new incident
    let severity = o2_enterprise::enterprise::alerts::incidents::determine_severity(None);

    let title = o2_enterprise::enterprise::alerts::incidents::generate_title(
        &alert.name,
        stable_dimensions,
    );

    let incident = infra::table::alert_incidents::create(
        org_id,
        correlation_key,
        severity,
        serde_json::to_value(stable_dimensions)?,
        triggered_at,
        Some(title.clone()),
    )
    .await?;

    // Add the first alert to the incident
    infra::table::alert_incidents::add_alert_to_incident(
        &incident.id,
        &alert.get_unique_key(),
        &alert.name,
        triggered_at,
        correlation_reason,
    )
    .await?;

    log::info!(
        "[incidents] Created new incident {} for alert '{}' (correlation_key: {}, severity: {})",
        incident.id,
        alert.name,
        correlation_key,
        severity
    );

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::incidents_create(
            org_id,
            correlation_key,
            severity,
            serde_json::to_value(stable_dimensions)?,
            triggered_at,
            Some(title),
        )
        .await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish incident create: {e}");
    }

    Ok(incident.id)
}

/// Get incident with its alerts for detail view
pub async fn get_incident_with_alerts(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<config::meta::alerts::incidents::IncidentWithAlerts>, anyhow::Error> {
    let incident = match infra::table::alert_incidents::get(org_id, incident_id).await? {
        Some(i) => i,
        None => return Ok(None),
    };

    let incident_alerts = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;

    // Convert to config types
    let incident_data = config::meta::alerts::incidents::Incident {
        id: incident.id,
        org_id: incident.org_id.clone(),
        correlation_key: incident.correlation_key,
        status: incident.status.parse().unwrap_or_default(),
        severity: incident.severity.parse().unwrap_or_default(),
        stable_dimensions: serde_json::from_value(incident.stable_dimensions).unwrap_or_default(),
        topology_context: incident
            .topology_context
            .and_then(|v| serde_json::from_value(v).ok()),
        first_alert_at: incident.first_alert_at,
        last_alert_at: incident.last_alert_at,
        resolved_at: incident.resolved_at,
        alert_count: incident.alert_count,
        title: incident.title,
        assigned_to: incident.assigned_to,
        created_at: incident.created_at,
        updated_at: incident.updated_at,
    };

    // Convert incident_alerts to triggers
    let triggers: Vec<config::meta::alerts::incidents::IncidentAlert> = incident_alerts
        .iter()
        .map(|a| config::meta::alerts::incidents::IncidentAlert {
            incident_id: a.incident_id.clone(),
            alert_id: a.alert_id.clone(),
            alert_name: a.alert_name.clone(),
            alert_fired_at: a.alert_fired_at,
            correlation_reason: a
                .correlation_reason
                .as_ref()
                .and_then(|r| match r.as_str() {
                    "service_discovery" => {
                        Some(config::meta::alerts::incidents::CorrelationReason::ServiceDiscovery)
                    }
                    "temporal" => {
                        Some(config::meta::alerts::incidents::CorrelationReason::Temporal)
                    }
                    "manual_extraction" => {
                        Some(config::meta::alerts::incidents::CorrelationReason::ManualExtraction)
                    }
                    _ => None,
                })
                .unwrap_or(config::meta::alerts::incidents::CorrelationReason::ManualExtraction),
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
                match super::alert::get_by_id_db(&incident.org_id, alert_ksuid).await {
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

    Ok(Some(config::meta::alerts::incidents::IncidentWithAlerts {
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
) -> Result<(Vec<config::meta::alerts::incidents::Incident>, u64), anyhow::Error> {
    // Get total count before pagination
    let total = infra::table::alert_incidents::count(org_id, status).await?;

    let incidents = infra::table::alert_incidents::list(org_id, status, limit, offset).await?;

    let incidents_list = incidents
        .into_iter()
        .map(|i| config::meta::alerts::incidents::Incident {
            id: i.id,
            org_id: i.org_id,
            correlation_key: i.correlation_key,
            status: i.status.parse().unwrap_or_default(),
            severity: i.severity.parse().unwrap_or_default(),
            stable_dimensions: serde_json::from_value(i.stable_dimensions).unwrap_or_default(),
            topology_context: i
                .topology_context
                .and_then(|v| serde_json::from_value(v).ok()),
            first_alert_at: i.first_alert_at,
            last_alert_at: i.last_alert_at,
            resolved_at: i.resolved_at,
            alert_count: i.alert_count,
            title: i.title,
            assigned_to: i.assigned_to,
            created_at: i.created_at,
            updated_at: i.updated_at,
        })
        .collect();

    Ok((incidents_list, total))
}

/// Query incident-specific service graph subgraph with N-hop expansion
///
/// Queries the _o2_service_graph stream filtered by:
/// - Time range: incident timeframe with buffer
/// - Services: Only edges involving seed services (with N-hop expansion)
///
/// Returns edges that can be used to build the incident topology
#[cfg(feature = "enterprise")]
async fn query_incident_subgraph(
    org_id: &str,
    seed_services: &HashSet<String>,
    start_time: i64,
    end_time: i64,
    _max_hops: usize, // Reserved for future N-hop expansion
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    use config::meta::stream::StreamType;

    let stream_name = "_o2_service_graph";

    // Add 5-minute buffer before and after incident
    let buffer_us = 5 * 60 * 1_000_000; // 5 minutes in microseconds
    let query_start = start_time.saturating_sub(buffer_us);
    let query_end = end_time + buffer_us;

    // Build service filter for SQL IN clause
    let service_list_sql = seed_services
        .iter()
        .map(|s| format!("'{}'", s.replace('\'', "''"))) // Escape single quotes
        .collect::<Vec<_>>()
        .join(",");

    // Query edges involving seed services (this gets 1-hop)
    let sql = format!(
        "SELECT client_service, server_service, \
         SUM(total_requests) as total_requests, \
         AVG(error_rate) as error_rate, \
         AVG(p95_latency_ns) as p95_latency_ns \
         FROM \"{}\" \
         WHERE _timestamp >= {} \
         AND _timestamp <= {} \
         AND org_id = '{}' \
         AND (client_service IN ({}) OR server_service IN ({})) \
         GROUP BY client_service, server_service \
         LIMIT 10000",
        stream_name,
        query_start,
        query_end,
        org_id.replace('\'', "''"),
        service_list_sql,
        service_list_sql
    );

    // Build search request
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 100000,
            start_time: query_start,
            end_time: query_end,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            action_id: None,
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 30,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
    };

    // Check if stream exists
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await;
    if schema.is_err() {
        log::debug!(
            "[incidents] Service graph stream '{stream_name}' does not exist yet for org '{org_id}'"
        );
        return Ok(Vec::new());
    }

    // Execute search
    let resp = crate::service::search::search("", org_id, StreamType::Logs, None, &req)
        .await
        .map_err(|e| anyhow::anyhow!("Service graph query failed: {}", e))?;

    Ok(resp.hits)
}

/// Enrich incident with Service Graph topology context
///
/// Called asynchronously after incident creation and when new alerts are added.
/// Builds complete N-hop service graph from all alerts in the incident.
pub async fn enrich_with_topology(
    org_id: &str,
    incident_id: &str,
    primary_service_name: &str,
) -> Result<(), anyhow::Error> {
    // Get current incident
    let incident = match infra::table::alert_incidents::get(org_id, incident_id).await? {
        Some(i) => i,
        None => return Ok(()),
    };

    // Get all alerts for this incident
    let incident_alerts = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;

    // Extract service from each alert to build seed services
    let mut seed_services = HashSet::new();
    seed_services.insert(primary_service_name.to_string());

    for alert in &incident_alerts {
        // Try to extract service from alert_name
        if let Some(service) = parse_service_from_alert_name(&alert.alert_name) {
            seed_services.insert(service);
        }
    }

    // Also extract services from stable_dimensions (now enriched with FQN fields from Fix #1)
    let stable_dimensions: HashMap<String, String> =
        serde_json::from_value(incident.stable_dimensions).unwrap_or_default();

    let fqn_priority =
        crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;

    for fqn_key in &fqn_priority {
        if let Some(service) = stable_dimensions.get(fqn_key)
            && !service.is_empty()
        {
            seed_services.insert(service.clone());
        }
    }

    log::debug!(
        "[incidents] Building topology for incident {} with {} seed services: {:?}",
        incident_id,
        seed_services.len(),
        seed_services
    );

    // Query incident-specific service graph with time filtering
    #[cfg(feature = "enterprise")]
    let edges = match query_incident_subgraph(
        org_id,
        &seed_services,
        incident.first_alert_at,
        incident.last_alert_at,
        2, // max_hops (default: 2)
    )
    .await
    {
        Ok(e) => e,
        Err(e) => {
            log::debug!("[incidents] Service graph query failed: {e}");
            return Ok(()); // Not fatal - service graph may not be set up
        }
    };

    #[cfg(not(feature = "enterprise"))]
    let edges: Vec<serde_json::Value> = Vec::new();

    if edges.is_empty() {
        log::debug!(
            "[incidents] No service graph edges found for incident {}",
            incident_id
        );
        return Ok(());
    }

    // Build full topology from edges
    let (graph_nodes, graph_edges, _) =
        o2_enterprise::enterprise::service_graph::build_topology(edges);

    // Extract all services from the graph
    // graph_nodes is Vec<ServiceNode> where ServiceNode has an `id` field
    let mut all_services = HashSet::new();
    for node in &graph_nodes {
        all_services.insert(node.id.clone());
    }

    // Build topology nodes
    let topology_nodes: Vec<config::meta::alerts::incidents::TopologyNode> = all_services
        .iter()
        .map(|service| config::meta::alerts::incidents::TopologyNode {
            service_name: service.clone(),
        })
        .collect();

    // Build topology edges
    // graph_edges is Vec<ServiceEdge> where ServiceEdge has `from` and `to` fields
    let topology_edges: Vec<config::meta::alerts::incidents::TopologyEdge> = graph_edges
        .iter()
        .map(|edge| config::meta::alerts::incidents::TopologyEdge {
            from: edge.from.clone(),
            to: edge.to.clone(),
        })
        .collect();

    let enriched_topology = config::meta::alerts::incidents::IncidentTopology {
        primary_service: primary_service_name.to_string(),
        nodes: topology_nodes,
        edges: topology_edges,
        related_incident_ids: vec![],
        suggested_root_cause: None, // Preserved for RCA markdown storage
    };

    // Update incident with topology context
    infra::table::alert_incidents::update_topology(
        org_id,
        incident_id,
        serde_json::to_value(&enriched_topology)?,
    )
    .await?;

    log::info!(
        "[incidents] Enriched incident {} with {} nodes, {} edges (from {} seed services)",
        incident_id,
        enriched_topology.nodes.len(),
        enriched_topology.edges.len(),
        seed_services.len()
    );

    Ok(())
}

/// Get service graph data for an incident
///
/// Builds a graph showing all services involved in the incident with their
/// dependencies and alert counts. Uses topology_context from the incident
/// record and counts alerts per service from the junction table.
pub async fn get_service_graph(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<config::meta::alerts::incidents::IncidentServiceGraph>, anyhow::Error> {
    use config::meta::alerts::incidents::{
        IncidentGraphStats, IncidentServiceEdge, IncidentServiceGraph, IncidentServiceNode,
    };

    // Get incident with its alerts
    let incident = match infra::table::alert_incidents::get(org_id, incident_id).await? {
        Some(i) => i,
        None => return Ok(None),
    };

    // Get stable dimensions
    let stable_dimensions: HashMap<String, String> =
        match serde_json::from_value(incident.stable_dimensions) {
            Ok(map) => map,
            Err(e) => {
                log::warn!(
                    "Failed to parse stable_dimensions JSON for incident {incident_id}: {e}"
                );
                HashMap::new()
            }
        };

    // Extract ALL services from stable_dimensions using FQN priority
    let fqn_priority =
        crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;
    let all_services = extract_all_services(&stable_dimensions, &fqn_priority);

    if all_services.is_empty() {
        // No service dimensions found - return empty graph
        return Ok(Some(IncidentServiceGraph {
            incident_service: String::new(),
            nodes: vec![],
            edges: vec![],
            stats: IncidentGraphStats {
                total_services: 0,
                total_alerts: 0,
                services_with_alerts: 0,
            },
        }));
    }

    // Primary service is first from FQN priority
    let incident_service = get_primary_service(&all_services);

    // Get topology context if available
    let topology: Option<config::meta::alerts::incidents::IncidentTopology> = incident
        .topology_context
        .and_then(|v| serde_json::from_value(v).ok());

    // Get all alerts for this incident to count by service
    let incident_alerts = infra::table::alert_incidents::get_incident_alerts(incident_id).await?;

    // Count alerts by service
    // Extract service from each alert using alert_name parsing
    // TODO: Optimize by storing service_name in junction table or caching alert definitions
    let mut service_alert_counts: HashMap<String, u32> = HashMap::new();

    for alert in &incident_alerts {
        // Try to extract service from alert_name
        let service = if let Some(parsed_service) = parse_service_from_alert_name(&alert.alert_name)
        {
            parsed_service
        } else {
            // Fallback to primary service if can't parse
            incident_service.clone()
        };

        *service_alert_counts.entry(service).or_insert(0) += 1;
    }

    // Use topology from stored context if available
    let (nodes, edges) = if let Some(ref topo) = topology {
        // Read nodes and edges from stored topology
        let mut nodes_with_counts = Vec::new();

        for node in &topo.nodes {
            let alert_count = *service_alert_counts.get(&node.service_name).unwrap_or(&0);
            nodes_with_counts.push(IncidentServiceNode {
                service_name: node.service_name.clone(),
                alert_count,
            });
        }

        let edges_converted = topo
            .edges
            .iter()
            .map(|e| IncidentServiceEdge {
                from: e.from.clone(),
                to: e.to.clone(),
            })
            .collect();

        (nodes_with_counts, edges_converted)
    } else {
        // Fallback: Build nodes from stable_dimensions (old behavior)
        let mut all_services: HashSet<String> = all_services.into_iter().collect();
        all_services.insert(incident_service.clone());

        let nodes: Vec<_> = all_services
            .iter()
            .map(|service| {
                let alert_count = *service_alert_counts.get(service).unwrap_or(&0);
                IncidentServiceNode {
                    service_name: service.clone(),
                    alert_count,
                }
            })
            .collect();

        (nodes, vec![])
    };

    // Calculate stats before moving nodes
    let total_services = nodes.len();
    let total_alerts: u32 = service_alert_counts.values().sum();
    let services_with_alerts = service_alert_counts
        .values()
        .filter(|&&count| count > 0)
        .count();

    Ok(Some(IncidentServiceGraph {
        incident_service,
        nodes,
        edges,
        stats: IncidentGraphStats {
            total_services,
            total_alerts,
            services_with_alerts,
        },
    }))
}

/// Update incident status
pub async fn update_status(
    org_id: &str,
    incident_id: &str,
    status: &str,
) -> Result<config::meta::alerts::incidents::Incident, anyhow::Error> {
    let updated = infra::table::alert_incidents::update_status(org_id, incident_id, status).await?;

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

    Ok(config::meta::alerts::incidents::Incident {
        id: updated.id,
        org_id: updated.org_id,
        correlation_key: updated.correlation_key,
        status: updated.status.parse().unwrap_or_default(),
        severity: updated.severity.parse().unwrap_or_default(),
        stable_dimensions: serde_json::from_value(updated.stable_dimensions).unwrap_or_default(),
        topology_context: updated
            .topology_context
            .and_then(|v| serde_json::from_value(v).ok()),
        first_alert_at: updated.first_alert_at,
        last_alert_at: updated.last_alert_at,
        resolved_at: updated.resolved_at,
        alert_count: updated.alert_count,
        title: updated.title,
        assigned_to: updated.assigned_to,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
    })
}
