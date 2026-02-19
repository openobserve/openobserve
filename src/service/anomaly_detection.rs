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

use anyhow::Result;
use chrono::Utc;
use infra::{db::ORM_CLIENT, table::entity::anomaly_detection_config};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait, QueryFilter,
    QueryOrder, Set,
};
use svix_ksuid::KsuidLike;

use crate::handler::http::request::anomaly_detection::{
    CreateAnomalyConfigRequest, UpdateAnomalyConfigRequest,
};

/// List all anomaly detection configurations for an organization
pub async fn list_configs(org_id: &str) -> Result<Vec<serde_json::Value>> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let configs = anomaly_detection_config::Entity::find()
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .order_by_desc(anomaly_detection_config::Column::CreatedAt)
        .all(db)
        .await?;

    let result: Vec<serde_json::Value> = configs
        .into_iter()
        .map(|model| serde_json::to_value(model).unwrap_or_default())
        .collect();

    Ok(result)
}

/// Get a specific anomaly detection configuration
pub async fn get_config(org_id: &str, config_id: &str) -> Result<Option<serde_json::Value>> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let config = anomaly_detection_config::Entity::find_by_id(config_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?;

    Ok(config.map(|model| serde_json::to_value(model).unwrap_or_default()))
}

/// Create a new anomaly detection configuration
pub async fn create_config(
    org_id: &str,
    req: CreateAnomalyConfigRequest,
) -> Result<serde_json::Value> {
    // Validate request
    validate_config_request(&req)?;

    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let config_id = svix_ksuid::Ksuid::new(None, None).to_string();
    let now = Utc::now().naive_utc();

    // Calculate next_run_at based on detection_interval
    let interval_secs = parse_interval(&req.detection_interval)?;
    let next_run_at = Utc::now().timestamp() + interval_secs;

    let new_config = anomaly_detection_config::ActiveModel {
        config_id: Set(config_id.clone()),
        org_id: Set(org_id.to_string()),
        stream_name: Set(req.stream_name.clone()),
        stream_type: Set(req.stream_type.clone()),
        enabled: Set(req.enabled.unwrap_or(true)),
        name: Set(req.name.clone()),
        description: Set(req.description.clone()),
        query_mode: Set(req.query_mode.clone()),
        filters: Set(req.filters.clone()),
        custom_sql: Set(req.custom_sql.clone()),
        detection_function: Set(req.detection_function.clone()),
        detection_interval: Set(req.detection_interval.clone()),
        training_window_days: Set(req.training_window_days.unwrap_or(7)),
        sensitivity: Set(req.sensitivity.unwrap_or(5)),
        is_trained: Set(false),
        training_started_at: Set(None),
        training_completed_at: Set(None),
        last_processed_timestamp: Set(None),
        last_detection_run: Set(None),
        next_run_at: Set(next_run_at),
        current_model_version: Set(0),
        rcf_num_trees: Set(req.rcf_num_trees.unwrap_or(100)),
        rcf_tree_size: Set(req.rcf_tree_size.unwrap_or(256)),
        rcf_shingle_size: Set(req.rcf_shingle_size.unwrap_or(1)),
        alert_enabled: Set(req.alert_enabled.unwrap_or(true)),
        alert_destination_id: Set(req.alert_destination_id.clone()),
        status: Set("waiting".to_string()),
        retries: Set(0),
        last_updated: Set(now),
        processing_node: Set(None),
        created_by: Set(req.created_by.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let result = new_config.insert(db).await?;

    Ok(serde_json::to_value(result)?)
}

/// Update an existing anomaly detection configuration
pub async fn update_config(
    org_id: &str,
    config_id: &str,
    req: UpdateAnomalyConfigRequest,
) -> Result<serde_json::Value> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    // Fetch existing config
    let existing = anomaly_detection_config::Entity::find_by_id(config_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    let mut active_model: anomaly_detection_config::ActiveModel = existing.into_active_model();

    // Update only provided fields
    if let Some(enabled) = req.enabled {
        active_model.enabled = Set(enabled);
    }
    if let Some(name) = req.name {
        active_model.name = Set(name);
    }
    if let Some(description) = req.description {
        active_model.description = Set(Some(description));
    }
    if let Some(detection_function) = req.detection_function {
        active_model.detection_function = Set(detection_function);
    }
    if let Some(detection_interval) = req.detection_interval {
        active_model.detection_interval = Set(detection_interval);
    }
    if let Some(sensitivity) = req.sensitivity {
        active_model.sensitivity = Set(sensitivity);
    }
    if let Some(alert_enabled) = req.alert_enabled {
        active_model.alert_enabled = Set(alert_enabled);
    }
    if let Some(alert_destination_id) = req.alert_destination_id {
        active_model.alert_destination_id = Set(Some(alert_destination_id));
    }

    active_model.updated_at = Set(Utc::now().naive_utc());

    let updated = active_model.update(db).await?;

    Ok(serde_json::to_value(updated)?)
}

/// Delete an anomaly detection configuration
pub async fn delete_config(org_id: &str, config_id: &str) -> Result<()> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let config = anomaly_detection_config::Entity::find_by_id(config_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    config.delete(db).await?;

    Ok(())
}

/// Train a model for a configuration
pub async fn train_model(org_id: &str, config_id: &str) -> Result<serde_json::Value> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    // Fetch config
    let config = anomaly_detection_config::Entity::find_by_id(config_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::anomaly_detection::{Trainer, query_builder};

        // Convert to training config
        let anomaly_config = config_to_training_config(&config)?;

        // Build training query
        let training_query = query_builder::build_training_query(&anomaly_config)?;

        // Initialize trainer
        let trainer = Trainer::new(anomaly_config.clone()).await?;

        // Run training with data fetching (in background)
        let config_id_owned = config_id.to_string();
        let org_id_owned = org_id.to_string();
        tokio::spawn(async move {
            // Fetch training data via OSS search service
            match execute_anomaly_query(&org_id_owned, &training_query).await {
                Ok(data_points) => {
                    // Train with fetched data
                    let start_time = std::time::Instant::now();
                    match trainer.train_with_data(&data_points, start_time).await {
                        Ok(result) => {
                            log::info!(
                                "Training completed for config {}: {} data points trained",
                                config_id_owned,
                                result.data_points_trained
                            );
                        }
                        Err(e) => {
                            log::error!("Training failed for config {}: {}", config_id_owned, e);
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "Failed to fetch training data for config {}: {}",
                        config_id_owned,
                        e
                    );
                }
            }
        });

        Ok(serde_json::json!({
            "message": "Training started",
            "config_id": config_id,
            "status": "in_progress"
        }))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        anyhow::bail!("Anomaly detection is an enterprise feature")
    }
}

/// Run detection for a configuration
pub async fn detect_anomalies(org_id: &str, config_id: &str) -> Result<serde_json::Value> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    // Fetch config
    let config = anomaly_detection_config::Entity::find_by_id(config_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    // Check if trained
    if !config.is_trained {
        anyhow::bail!("Model must be trained before running detection");
    }

    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::anomaly_detection::{Detector, query_builder};

        // Convert to detection config
        let anomaly_config = config_to_training_config(&config)?;

        // Build detection query
        let detection_query = query_builder::build_detection_query(&anomaly_config)?;

        // Fetch detection data via OSS search service
        let data_points = execute_anomaly_query(org_id, &detection_query).await?;

        // Initialize detector
        let detector = Detector::new(anomaly_config.clone()).await?;

        // Run detection with fetched data
        let start_time = std::time::Instant::now();
        let result = detector.detect_with_data(&data_points, start_time).await?;

        // Write anomalies to stream
        if !result.anomalies.is_empty() {
            let anomaly_records: Vec<serde_json::Value> = result
                .anomalies
                .iter()
                .map(|a| serde_json::to_value(a))
                .collect::<Result<Vec<_>, _>>()?;

            write_anomalies_to_stream(org_id, anomaly_records).await?;
        }

        Ok(serde_json::json!({
            "message": "Detection completed",
            "config_id": config_id,
            "anomalies_found": result.anomaly_count,
            "points_scored": result.data_points_processed,
            "anomalies": result.anomalies
        }))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        anyhow::bail!("Anomaly detection is an enterprise feature")
    }
}

/// Get detection history (placeholder - would query from _anomalies stream)
pub async fn get_detection_history(
    _org_id: &str,
    _config_id: &str,
    _limit: i64,
) -> Result<Vec<DetectionHistoryItem>> {
    // TODO: Query _anomalies stream for historical detections
    // This would use the standard query service to query the generated _anomalies stream
    Ok(Vec::new())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DetectionHistoryItem {
    pub timestamp: i64,
    pub anomalies_detected: usize,
    pub points_scored: usize,
}

/// Validate configuration request
fn validate_config_request(req: &CreateAnomalyConfigRequest) -> Result<()> {
    // Validate query_mode
    if req.query_mode != "filters" && req.query_mode != "custom_sql" {
        anyhow::bail!("query_mode must be 'filters' or 'custom_sql'");
    }

    // Validate filters mode
    if req.query_mode == "filters" && req.filters.is_none() {
        anyhow::bail!("filters required when query_mode is 'filters'");
    }

    // Validate custom_sql mode
    if req.query_mode == "custom_sql" && req.custom_sql.is_none() {
        anyhow::bail!("custom_sql required when query_mode is 'custom_sql'");
    }

    // Validate detection_interval
    parse_interval(&req.detection_interval)?;

    Ok(())
}

/// Parse interval string like "1h", "30m" into seconds
fn parse_interval(interval: &str) -> Result<i64> {
    if interval.ends_with('h') {
        let hours: i64 = interval[..interval.len() - 1].parse()?;
        Ok(hours * 3600)
    } else if interval.ends_with('m') {
        let minutes: i64 = interval[..interval.len() - 1].parse()?;
        Ok(minutes * 60)
    } else {
        anyhow::bail!("Invalid interval format. Use '1h' or '30m'");
    }
}

#[cfg(feature = "enterprise")]
pub fn config_to_training_config(
    config: &anomaly_detection_config::Model,
) -> Result<o2_enterprise::enterprise::anomaly_detection::types::AnomalyConfig> {
    use o2_enterprise::enterprise::anomaly_detection::types::AnomalyConfig;

    // Parse filters if present
    let filters = if let Some(filters_json) = &config.filters {
        serde_json::from_value(filters_json.clone())?
    } else {
        Vec::new()
    };

    Ok(AnomalyConfig {
        config_id: config.config_id.clone(),
        org_id: config.org_id.clone(),
        stream_name: config.stream_name.clone(),
        stream_type: serde_json::from_str(&format!("\"{}\"", config.stream_type))?,
        enabled: config.enabled,
        name: config.name.clone(),
        description: config.description.clone(),
        query_mode: serde_json::from_str(&format!("\"{}\"", config.query_mode))?,
        filters,
        custom_sql: config.custom_sql.clone(),
        detection_function: serde_json::from_str(&format!("\"{}\"", config.detection_function))?,
        detection_interval: config.detection_interval.clone(),
        training_window_days: config.training_window_days as usize,
        sensitivity: config.sensitivity,
        is_trained: config.is_trained,
        training_started_at: config
            .training_started_at
            .map(|dt| dt.and_utc().timestamp_micros()),
        training_completed_at: config
            .training_completed_at
            .map(|dt| dt.and_utc().timestamp_micros()),
        last_processed_timestamp: config.last_processed_timestamp,
        last_detection_run: config
            .last_detection_run
            .map(|dt| dt.and_utc().timestamp_micros()),
        next_run_at: Some(config.next_run_at),
        current_model_version: Some(config.current_model_version),
        rcf_num_trees: config.rcf_num_trees as usize,
        rcf_tree_size: config.rcf_tree_size as usize,
        rcf_shingle_size: config.rcf_shingle_size as usize,
        alert_enabled: config.alert_enabled,
        alert_destination_id: config.alert_destination_id.clone(),
        status: serde_json::from_str(&format!("\"{}\"", config.status))?,
        retries: config.retries,
        last_updated: config.last_updated.and_utc().timestamp_micros(),
        processing_node: config.processing_node.clone(),
        created_by: config.created_by.clone().unwrap_or_default(),
        created_at: config.created_at.and_utc().timestamp_micros(),
        updated_at: config.updated_at.and_utc().timestamp_micros(),
    })
}

/// Execute a SQL query for anomaly detection and return time-series data points
///
/// This is called by enterprise query_executor to fetch training/detection data
#[cfg(feature = "enterprise")]
pub async fn execute_anomaly_query(org_id: &str, query_sql: &str) -> Result<Vec<(i64, f64)>> {
    use config::meta::stream::StreamType;

    use crate::service::search;

    // Build search request with the SQL query
    let search_req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql.to_string(),
            from: 0,
            size: 10000, // Get up to 10k data points
            start_time: 0,
            end_time: 0,
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: None,
    };

    // Execute the search
    let trace_id = config::ider::generate_trace_id();
    let search_result = search::search(&trace_id, org_id, StreamType::Logs, None, &search_req)
        .await
        .map_err(|e| anyhow::anyhow!("Search failed: {}", e))?;

    // Parse the results into (timestamp, value) tuples
    let data_points = parse_search_results_to_timeseries(&search_result)?;

    Ok(data_points)
}

/// Parse search results into time-series data points
///
/// Expected format from histogram/aggregation queries:
/// - Each hit should have a timestamp field and a value/count field
#[cfg(feature = "enterprise")]
fn parse_search_results_to_timeseries(
    results: &config::meta::search::Response,
) -> Result<Vec<(i64, f64)>> {
    let mut data_points = Vec::new();

    // Iterate through hits
    for hit in &results.hits {
        // Try to extract timestamp and value from the hit
        // The exact field names depend on the query, but common patterns are:
        // - "_timestamp" or "timestamp" for time
        // - "value", "count", or the aggregation name for the metric

        let timestamp = extract_timestamp_from_hit(hit)?;
        let value = extract_value_from_hit(hit)?;

        data_points.push((timestamp, value));
    }

    // Sort by timestamp
    data_points.sort_by_key(|&(ts, _)| ts);

    Ok(data_points)
}

/// Extract timestamp from a search hit
#[cfg(feature = "enterprise")]
fn extract_timestamp_from_hit(hit: &serde_json::Value) -> Result<i64> {
    // Try different timestamp field names
    for field_name in &["_timestamp", "timestamp", "time", "time_bucket"] {
        if let Some(ts_value) = hit.get(field_name) {
            // Handle different timestamp formats
            if let Some(ts_num) = ts_value.as_i64() {
                return Ok(ts_num);
            }
            if let Some(ts_str) = ts_value.as_str() {
                // Parse ISO8601 timestamp
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                    return Ok(dt.timestamp_micros());
                }
            }
        }
    }

    anyhow::bail!("No timestamp field found in search result")
}

/// Extract value from a search hit
#[cfg(feature = "enterprise")]
fn extract_value_from_hit(hit: &serde_json::Value) -> Result<f64> {
    // Try different value field names
    for field_name in &["value", "count", "_count", "metric", "result"] {
        if let Some(value) = hit.get(field_name) {
            if let Some(val_num) = value.as_f64() {
                return Ok(val_num);
            }
            if let Some(val_int) = value.as_i64() {
                return Ok(val_int as f64);
            }
        }
    }

    anyhow::bail!("No value field found in search result")
}

/// Write anomaly events to the _anomalies stream
///
/// This is called by enterprise stream_writer to ingest detected anomalies
#[cfg(feature = "enterprise")]
pub async fn write_anomalies_to_stream(
    org_id: &str,
    anomalies: Vec<serde_json::Value>,
) -> Result<()> {
    use crate::common::meta::ingestion::{self, IngestUser, SystemJobType};

    if anomalies.is_empty() {
        return Ok(());
    }

    tracing::info!(
        org_id = %org_id,
        anomaly_count = anomalies.len(),
        "Writing anomalies to _anomalies stream"
    );

    // Convert to JSON bytes
    let json_str = serde_json::to_string(&anomalies)?;
    let bytes = bytes::Bytes::from(json_str);

    // Create ingestion request
    let ingest_req = ingestion::IngestionRequest::JSON(bytes);

    // Use system job user for ingestion
    let user = IngestUser::SystemJob(SystemJobType::AnomalyDetection);

    // Ingest to _anomalies stream
    let _response = crate::service::logs::ingest::ingest(
        0, // thread_id
        org_id,
        "_anomalies", // stream name
        ingest_req,
        user,
        None,  // extend_json
        false, // is_derived
    )
    .await
    .map_err(|e| anyhow::anyhow!("Failed to ingest anomalies: {}", e))?;

    tracing::info!(
        org_id = %org_id,
        "Successfully wrote anomalies to _anomalies stream"
    );

    Ok(())
}
