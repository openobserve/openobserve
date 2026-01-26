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

    log::debug!(
        "[incidents] Alert {} result_row labels: {:?}",
        alert.name,
        labels
    );

    // Query Service Discovery for pre-computed correlation_key hash using correlation API
    let stream_type_str = alert.stream_type.to_string();
    let service_discovery_result =
        query_service_discovery_key(&alert.org_id, &alert.stream_name, &stream_type_str, &labels)
            .await;

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
        // Fallback 1: Check if service_name is directly in the alert result labels
        if let Some(svc) = labels.get("service_name") {
            svc.clone()
        } else if let Some(svc) = labels.get("service") {
            svc.clone()
        } else {
            // Fallback 2: Extract from stable_dimensions using FQN priority
            let fqn_priority =
                crate::service::db::system_settings::get_fqn_priority_dimensions(&alert.org_id)
                    .await;
            extract_service_name_from_dimensions(
                &correlation_result.stable_dimensions,
                &fqn_priority,
            )
        }
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
    alert_stream_type: &str,
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
            alert_stream_type,
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

        // Add alert to junction table (this also increments alert_count and updates last_alert_at)
        let alert_id = alert.get_unique_key();
        infra::table::alert_incidents::add_alert_to_incident(
            &existing.id,
            &alert_id,
            &alert.name,
            triggered_at,
            correlation_reason,
        )
        .await?;

        // Update dimensions if changed
        if dimensions_changed {
            // Get the updated count after add_alert_to_incident
            let updated = infra::table::alert_incidents::get(org_id, &existing.id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("Incident not found after update"))?;

            infra::table::alert_incidents::update_incident_metadata(
                org_id,
                &existing.id,
                updated.alert_count,
                updated.last_alert_at,
                Some(serde_json::to_value(&current_dims)?),
            )
            .await?;
        }

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

        // Trigger topology enrichment for this alert
        let org_id_clone = org_id.to_string();
        let incident_id_clone = existing.id.clone();
        let service_name_clone = service_name.to_string();
        let alert_id_clone = alert.get_unique_key();
        let alert_name_clone = alert.name.clone();

        tokio::spawn(async move {
            if let Err(e) = enrich_with_topology(
                &org_id_clone,
                &incident_id_clone,
                &service_name_clone,
                &alert_id_clone,
                &alert_name_clone,
                triggered_at,
            )
            .await
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

    // Trigger async topology enrichment for new incident
    let org_id_clone = org_id.to_string();
    let incident_id_clone = incident.id.clone();
    let service_name_clone = service_name.to_string();
    let alert_id_clone = alert.get_unique_key();
    let alert_name_clone = alert.name.clone();

    tokio::spawn(async move {
        if let Err(e) = enrich_with_topology(
            &org_id_clone,
            &incident_id_clone,
            &service_name_clone,
            &alert_id_clone,
            &alert_name_clone,
            triggered_at,
        )
        .await
        {
            log::debug!(
                "[incidents] Topology enrichment failed for incident {incident_id_clone}: {e}"
            );
        }
    });

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
    use config::meta::alerts::incidents::{AlertEdge, AlertNode, EdgeType};

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

    // Build temporal edges only for NEW nodes (based on node's first_fired_at, not current alert
    // time)
    if is_new_node {
        let current_node_first_fired = topology.nodes[current_node_index].first_fired_at;

        for (idx, node) in topology.nodes.iter().enumerate() {
            if idx == current_node_index {
                continue; // Skip self
            }

            // Only connect nodes from same service
            if node.service_name == service_name && node.first_fired_at < current_node_first_fired {
                // Check if edge already exists
                let edge_exists = topology.edges.iter().any(|e| {
                    e.from_node_index == idx
                        && e.to_node_index == current_node_index
                        && matches!(e.edge_type, EdgeType::Temporal)
                });

                if !edge_exists {
                    topology.edges.push(AlertEdge {
                        from_node_index: idx,
                        to_node_index: current_node_index,
                        edge_type: EdgeType::Temporal,
                    });
                    log::debug!(
                        "[incidents] Added temporal edge: {} -> {} (same service)",
                        idx,
                        current_node_index
                    );
                }
            }
        }
    }

    // Build service dependency edges (different services, from Service Graph)
    let sg_edges = match service_graph::query_edges_from_stream_internal(org_id, None).await {
        Ok(e) => e,
        Err(e) => {
            log::debug!(
                "[incidents] Service graph query failed: {e}, will use temporal edges for cross-service correlation"
            );
            vec![] // Empty vec to continue with temporal edges
        }
    };

    // Build Service Graph topology (even if empty, we need to create temporal edges)
    let (_sg_nodes, sg_edges, _) = if !sg_edges.is_empty() {
        o2_enterprise::enterprise::service_graph::build_topology(sg_edges)
    } else {
        log::debug!(
            "[incidents] Service graph has no edges, will use temporal edges for cross-service correlation"
        );
        (vec![], vec![], vec![])
    };

    // Create service-to-node mapping for quick lookup
    let mut service_nodes: HashMap<&str, Vec<usize>> = HashMap::new();
    for (idx, node) in topology.nodes.iter().enumerate() {
        service_nodes
            .entry(&node.service_name)
            .or_default()
            .push(idx);
    }

    // For each pair of services in the graph, check if there's a Service Graph edge
    for (from_service, from_indices) in &service_nodes {
        for (to_service, to_indices) in &service_nodes {
            if from_service == to_service {
                continue; // Skip same service (handled by temporal edges)
            }

            // Check if Service Graph has edge from_service -> to_service
            let has_sg_edge = sg_edges
                .iter()
                .any(|e| &e.from == from_service && &e.to == to_service);

            // Add edge from each node in from_service to each node in to_service
            // that occurred chronologically after
            for &from_idx in from_indices {
                for &to_idx in to_indices {
                    let from_node = &topology.nodes[from_idx];
                    let to_node = &topology.nodes[to_idx];

                    // Only add if from happened before to (chronological)
                    if from_node.first_fired_at < to_node.first_fired_at {
                        // Determine edge type: ServiceDependency if SG edge exists, otherwise
                        // Temporal
                        let edge_type = if has_sg_edge {
                            EdgeType::ServiceDependency
                        } else {
                            EdgeType::Temporal
                        };

                        // Check if edge already exists
                        let edge_exists = topology.edges.iter().any(|e| {
                            e.from_node_index == from_idx
                                && e.to_node_index == to_idx
                                && matches!(
                                    (&e.edge_type, &edge_type),
                                    (EdgeType::ServiceDependency, EdgeType::ServiceDependency)
                                        | (EdgeType::Temporal, EdgeType::Temporal)
                                )
                        });

                        if !edge_exists {
                            topology.edges.push(AlertEdge {
                                from_node_index: from_idx,
                                to_node_index: to_idx,
                                edge_type,
                            });
                            log::debug!(
                                "[incidents] Added {:?} edge: {} ({}) -> {} ({})",
                                edge_type,
                                from_idx,
                                from_service,
                                to_idx,
                                to_service
                            );
                        }
                    }
                }
            }
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

/// Get alert flow graph for an incident
///
/// Returns the pre-built alert flow graph showing how alerts cascaded
/// across services over time. Graph is built incrementally as alerts fire.
pub async fn get_service_graph(
    org_id: &str,
    incident_id: &str,
) -> Result<Option<config::meta::alerts::incidents::IncidentServiceGraph>, anyhow::Error> {
    use config::meta::alerts::incidents::IncidentGraphStats;

    // Check if incident exists
    if infra::table::alert_incidents::get(org_id, incident_id)
        .await?
        .is_none()
    {
        return Ok(None);
    }

    // Get topology from DB
    let topology = infra::table::alert_incidents::get_topology(org_id, incident_id).await?;

    // If no topology, return empty graph
    let topology = match topology {
        Some(t) => t,
        None => {
            return Ok(Some(
                config::meta::alerts::incidents::IncidentServiceGraph {
                    nodes: vec![],
                    edges: vec![],
                    stats: IncidentGraphStats {
                        total_services: 0,
                        total_alerts: 0,
                        services_with_alerts: 0,
                    },
                },
            ));
        }
    };

    // Calculate stats from nodes before moving topology
    let total_services = topology
        .nodes
        .iter()
        .map(|n| &n.service_name)
        .collect::<HashSet<_>>()
        .len();
    let total_alerts: u32 = topology.nodes.iter().map(|n| n.alert_count).sum();
    let services_with_alerts = topology
        .nodes
        .iter()
        .map(|n| &n.service_name)
        .collect::<HashSet<_>>()
        .len();

    // Return topology directly
    Ok(Some(
        config::meta::alerts::incidents::IncidentServiceGraph {
            nodes: topology.nodes,
            edges: topology.edges,
            stats: IncidentGraphStats {
                total_services,
                total_alerts,
                services_with_alerts,
            },
        },
    ))
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
