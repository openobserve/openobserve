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
    #[allow(dead_code)]
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

    log::info!(
        "[incidents] Alert {} correlation - service: {}, correlation_key: {}",
        alert.name,
        service_name,
        correlation_result.correlation_key
    );

    // Find or create incident
    let incident_id = find_or_create_incident(
        &alert.org_id,
        &correlation_result.correlation_key,
        &correlation_result.stable_dimensions,
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

        // Trigger re-enrichment if dimensions changed or topology missing
        if dimensions_changed || existing.topology_context.is_none() {
            let org_id_clone = org_id.to_string();
            let incident_id_clone = existing.id.clone();
            let service_name_clone = service_name.to_string();

            tokio::spawn(async move {
                if let Err(e) =
                    enrich_with_topology(&org_id_clone, &incident_id_clone, &service_name_clone)
                        .await
                {
                    log::debug!(
                        "[incidents] Topology re-enrichment failed for incident {incident_id_clone}: {e}"
                    );
                }
            });
        }

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

/// Enrich incident with Service Graph topology context
///
/// Called asynchronously after incident creation to add topology information.
/// Supports multi-service incidents by extracting ALL services from stable_dimensions.
pub async fn enrich_with_topology(
    org_id: &str,
    incident_id: &str,
    primary_service_name: &str,
) -> Result<(), anyhow::Error> {
    use crate::service::traces::service_graph;

    // Get current incident with full dimensions
    let incident = match infra::table::alert_incidents::get(org_id, incident_id).await? {
        Some(i) => i,
        None => return Ok(()),
    };

    let stable_dimensions: HashMap<String, String> =
        serde_json::from_value(incident.stable_dimensions).unwrap_or_default();

    // Extract ALL service names from FQN priority dimensions
    let fqn_priority =
        crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;
    let mut all_services = HashSet::new();
    all_services.insert(primary_service_name.to_string());

    for fqn_key in &fqn_priority {
        if let Some(service) = stable_dimensions.get(fqn_key)
            && !service.is_empty()
        {
            all_services.insert(service.clone());
        }
    }

    // Query current topology
    let edges = match service_graph::query_edges_from_stream_internal(org_id, None).await {
        Ok(e) => e,
        Err(e) => {
            log::debug!("[incidents] Service graph not available for topology enrichment: {e}");
            return Ok(()); // Not an error - Service Graph may not be set up
        }
    };

    if edges.is_empty() {
        return Ok(());
    }

    // Build topology using enterprise logic
    let (nodes, edges, _) = o2_enterprise::enterprise::service_graph::build_topology(edges);

    // Build aggregate topology from ALL services in incident
    let mut upstream_services = HashSet::new();
    let mut downstream_services = HashSet::new();

    for service in &all_services {
        let topology = o2_enterprise::enterprise::alerts::incidents::extract_topology_context(
            service, &nodes, &edges,
        );
        upstream_services.extend(topology.upstream_services);
        downstream_services.extend(topology.downstream_services);
    }

    let enriched_topology = config::meta::alerts::incidents::IncidentTopology {
        service: primary_service_name.to_string(),
        upstream_services: upstream_services.into_iter().collect(),
        downstream_services: downstream_services.into_iter().collect(),
        related_incident_ids: vec![],
        suggested_root_cause: None,
    };

    // Update incident with topology context
    infra::table::alert_incidents::update_topology(
        org_id,
        incident_id,
        serde_json::to_value(&enriched_topology)?,
    )
    .await?;

    log::info!(
        "[incidents] Enriched incident {} with {} services, {} upstream, {} downstream",
        incident_id,
        all_services.len(),
        enriched_topology.upstream_services.len(),
        enriched_topology.downstream_services.len()
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
            root_cause_service: None,
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
    // We need to get service info from alerts - for now, count all alerts under primary service
    // In a more complete implementation, we'd look up each alert's labels
    let mut service_alert_counts: HashMap<String, u32> = HashMap::new();

    // For each alert, try to extract service name
    // The alert_name often contains service info, or we can look up the alert
    for _alert in &incident_alerts {
        // For now, attribute all alerts to the primary service
        // A more complete implementation would look up each alert's labels
        *service_alert_counts
            .entry(incident_service.clone())
            .or_insert(0) += 1;
    }

    // Build nodes and edges based on topology
    let root_cause_service = topology
        .as_ref()
        .and_then(|t| t.suggested_root_cause.clone());

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut all_services: HashSet<String> = all_services.into_iter().collect();

    // Add primary service
    all_services.insert(incident_service.clone());

    if let Some(ref topo) = topology {
        // Add upstream services
        for upstream in &topo.upstream_services {
            all_services.insert(upstream.clone());
        }

        // Add downstream services
        for downstream in &topo.downstream_services {
            all_services.insert(downstream.clone());
        }

        // Build edges: upstream -> primary
        for upstream in &topo.upstream_services {
            edges.push(IncidentServiceEdge {
                from: upstream.clone(),
                to: incident_service.clone(),
            });
        }

        // Build edges: primary -> downstream
        for downstream in &topo.downstream_services {
            edges.push(IncidentServiceEdge {
                from: incident_service.clone(),
                to: downstream.clone(),
            });
        }
    }

    // Build nodes for all services
    for service in &all_services {
        let alert_count = *service_alert_counts.get(service).unwrap_or(&0);
        let is_root_cause = root_cause_service
            .as_ref()
            .map(|r| r == service)
            .unwrap_or(false);
        let is_primary = service == &incident_service;

        nodes.push(IncidentServiceNode {
            service_name: service.clone(),
            alert_count,
            is_root_cause,
            is_primary,
        });
    }

    // Calculate stats
    let total_alerts: u32 = service_alert_counts.values().sum();
    let services_with_alerts = service_alert_counts
        .values()
        .filter(|&&count| count > 0)
        .count();

    Ok(Some(IncidentServiceGraph {
        incident_service,
        root_cause_service,
        nodes,
        edges,
        stats: IncidentGraphStats {
            total_services: all_services.len(),
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
