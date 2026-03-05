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

    // Calculate next_run_at in microseconds (matching the enterprise scheduler convention)
    let interval_secs = parse_interval(&req.detection_interval)?;
    let next_run_at = Utc::now().timestamp_micros() + (interval_secs * 1_000_000);

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
        // Store percentile as i32 (e.g. 97.0 → 97). Whole-number percentiles are
        // sufficient; the valid range is 50–99 and we clamp at the model level.
        sensitivity: Set(req.percentile.unwrap_or(97.0).clamp(50.0, 99.9) as i32),
        is_trained: Set(false),
        training_started_at: Set(None),
        training_completed_at: Set(None),
        last_processed_timestamp: Set(None),
        last_detection_run: Set(None),
        next_run_at: Set(next_run_at),
        current_model_version: Set(0),
        rcf_num_trees: Set(req.rcf_num_trees.unwrap_or(
            o2_enterprise::enterprise::common::config::get_config()
                .anomaly_detection
                .rcf_num_trees as i32,
        )),
        rcf_tree_size: Set(req.rcf_tree_size.unwrap_or(
            o2_enterprise::enterprise::common::config::get_config()
                .anomaly_detection
                .rcf_tree_size as i32,
        )),
        // shingle_size default comes from O2_ANOMALY_RCF_SHINGLE_SIZE env var (default=4).
        // 4 consecutive time-buckets gives the RCF model enough temporal context.
        rcf_shingle_size: Set(req.rcf_shingle_size.unwrap_or(
            o2_enterprise::enterprise::common::config::get_config()
                .anomaly_detection
                .rcf_shingle_size as i32,
        )),
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

    // Register a detection trigger in the shared scheduler so it is driven by the
    // same infrastructure as alerts.  The handler will check `is_trained` and skip
    // until training is complete.
    {
        use config::{meta::triggers::TriggerModule, utils::time::now_micros};
        let trigger = crate::service::db::scheduler::Trigger {
            org: org_id.to_string(),
            module: TriggerModule::AnomalyDetection,
            module_key: config_id.clone(),
            next_run_at: now_micros(),
            is_realtime: false,
            is_silenced: false,
            ..Default::default()
        };
        if let Err(e) = crate::service::db::scheduler::push(trigger).await {
            log::warn!("[anomaly_detection {config_id}] failed to push detection trigger: {e}");
        }
    }

    // Immediately kick off training in the background rather than waiting up to
    // `training_check_interval_seconds` (default 1h) for the scheduler tick.
    #[cfg(feature = "enterprise")]
    {
        let config_id_for_training = config_id.clone();
        tokio::spawn(async move {
            if let Err(e) =
                o2_enterprise::enterprise::anomaly_detection::scheduler::trigger_training(
                    &config_id_for_training,
                )
                .await
            {
                log::error!(
                    "[anomaly_detection {}] failed to trigger initial training on create: {}",
                    config_id_for_training,
                    e
                );
            }
        });
    }

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
    if let Some(percentile) = req.percentile {
        active_model.sensitivity = Set(percentile.clamp(50.0, 99.9) as i32);
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

    // Remove the detection trigger from the shared scheduler.
    {
        use config::meta::triggers::TriggerModule;
        if let Err(e) = crate::service::db::scheduler::delete(
            org_id,
            TriggerModule::AnomalyDetection,
            config_id,
        )
        .await
        {
            log::warn!("[anomaly_detection {config_id}] failed to delete detection trigger: {e}");
        }
    }

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
        // Training window: now - training_window_days .. now (microseconds)
        let end_time_us = Utc::now().timestamp_micros();
        let start_time_us =
            end_time_us - (anomaly_config.training_window_days as i64 * 86_400 * 1_000_000);

        log::info!(
            "[anomaly_detection {}] training started: window={} days, start_time_us={}, end_time_us={}, query={}",
            config_id,
            anomaly_config.training_window_days,
            start_time_us,
            end_time_us,
            training_query
        );

        tokio::spawn(async move {
            log::info!(
                "[anomaly_detection {}] background training task spawned",
                config_id_owned
            );

            match execute_anomaly_query(
                &org_id_owned,
                &training_query,
                start_time_us,
                end_time_us,
                &config_id_owned,
            )
            .await
            {
                Ok(data_points) => {
                    log::info!(
                        "[anomaly_detection {}] fetched {} data points for training",
                        config_id_owned,
                        data_points.len(),
                    );
                    let start_time = std::time::Instant::now();
                    match trainer.train_with_data(&data_points, start_time).await {
                        Ok(result) => {
                            log::info!(
                                "[anomaly_detection {}] training complete: data_points={}, model_version={}, success={}",
                                config_id_owned,
                                result.data_points_trained,
                                result.model_version,
                                result.success,
                            );
                            if !result.success {
                                log::warn!(
                                    "[anomaly_detection {}] training reported failure: {}",
                                    config_id_owned,
                                    result.message,
                                );
                            }
                            // Update status and is_trained flag after training
                            if result.success {
                                if let Some(db) = infra::db::ORM_CLIENT.get() {
                                    use infra::table::entity::anomaly_detection_config;
                                    use sea_orm::{EntityTrait, IntoActiveModel};
                                    if let Ok(Some(cfg)) =
                                        anomaly_detection_config::Entity::find_by_id(
                                            &config_id_owned,
                                        )
                                        .one(db)
                                        .await
                                    {
                                        let mut active = cfg.into_active_model();
                                        active.status = sea_orm::Set("active".to_string());
                                        active.is_trained = sea_orm::Set(true);
                                        active.training_completed_at =
                                            sea_orm::Set(Some(chrono::Utc::now().naive_utc()));
                                        let _ = sea_orm::ActiveModelTrait::update(active, db).await;
                                        log::info!(
                                            "[anomaly_detection {}] status updated to active, is_trained=true",
                                            config_id_owned
                                        );
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!(
                                "[anomaly_detection {}] training error: {}",
                                config_id_owned,
                                e
                            );
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "[anomaly_detection {}] failed to fetch training data: {}",
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

        // Detection window: always look back training_window_days from now.
        // We do NOT use last_processed_timestamp here because this is the
        // on-demand /detect endpoint — it should always score the full
        // recent window so repeated calls are useful for testing.
        // The scheduler's incremental detection uses last_processed_timestamp
        // separately to avoid re-scoring already-processed data.
        let end_time_us = Utc::now().timestamp_micros();
        let lookback_us = anomaly_config.training_window_days as i64 * 86_400 * 1_000_000;
        let start_time_us = end_time_us - lookback_us;

        log::info!(
            "[anomaly_detection {}] detection started: start_time_us={}, end_time_us={}, query={}",
            config_id,
            start_time_us,
            end_time_us,
            detection_query
        );

        // Fetch detection data via OSS search service
        let data_points = execute_anomaly_query(
            org_id,
            &detection_query,
            start_time_us,
            end_time_us,
            config_id,
        )
        .await?;

        log::info!(
            "[anomaly_detection {}] fetched {} data points for detection",
            config_id,
            data_points.len()
        );

        // Initialize detector
        let detector = Detector::new(anomaly_config.clone()).await?;

        // Run detection with fetched data
        let start_time = std::time::Instant::now();
        let result = detector.detect_with_data(&data_points, start_time).await?;

        log::info!(
            "[anomaly_detection {}] detection complete: points_scored={}, anomalies_found={}",
            config_id,
            result.data_points_processed,
            result.anomaly_count
        );

        // Write all scored points to the _anomalies stream (not just anomalous ones).
        // This gives the frontend a continuous score timeline so it can plot every bucket
        // with its score and the threshold line, regardless of whether it was anomalous.
        if !result.scored_points.is_empty() {
            log::info!(
                "[anomaly_detection {}] writing {} scored points ({} anomalies) to _anomalies stream",
                config_id,
                result.scored_points.len(),
                result.anomaly_count,
            );
            let records: Vec<serde_json::Value> = result
                .scored_points
                .iter()
                .map(|p| serde_json::to_value(p))
                .collect::<Result<Vec<_>, _>>()?;

            write_anomalies_to_stream(org_id, records).await?;
        }

        // Send alert if anomalies found and alert is configured
        if result.anomaly_count > 0 && config.alert_enabled {
            if let Some(ref dest_id) = config.alert_destination_id {
                if let Err(e) = send_anomaly_alert(
                    org_id.to_string(),
                    dest_id.clone(),
                    config.name.clone(),
                    config_id.to_string(),
                    result.anomaly_count,
                    config.stream_name.clone(),
                )
                .await
                {
                    log::warn!(
                        "[anomaly_detection {}] failed to send alert to '{}': {}",
                        config_id,
                        dest_id,
                        e
                    );
                }
            }
        }

        // Return only the anomalous points in the API response to keep it concise.
        let anomaly_points: Vec<_> = result
            .scored_points
            .iter()
            .filter(|p| p.is_anomaly)
            .collect();

        Ok(serde_json::json!({
            "message": "Detection completed",
            "config_id": config_id,
            "anomalies_found": result.anomaly_count,
            "points_scored": result.data_points_processed,
            "anomalies": anomaly_points
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
/// `start_time` and `end_time` are microseconds since epoch. The search service uses
/// these for partition pruning — the SQL itself does not need a WHERE _timestamp clause.
#[cfg(feature = "enterprise")]
pub async fn execute_anomaly_query(
    org_id: &str,
    query_sql: &str,
    start_time: i64,
    end_time: i64,
    config_id: &str,
) -> Result<Vec<(i64, f64)>> {
    use config::meta::stream::StreamType;

    use crate::service::search;

    log::info!(
        "[anomaly_detection {}] executing query: sql={}, start_time_us={}, end_time_us={}",
        config_id,
        query_sql,
        start_time,
        end_time
    );

    let search_req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: query_sql.to_string(),
            from: 0,
            size: 10000,
            start_time,
            end_time,
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

    let trace_id = config::ider::generate_trace_id();
    let search_result = search::search(&trace_id, org_id, StreamType::Logs, None, &search_req)
        .await
        .map_err(|e| anyhow::anyhow!("[anomaly_detection {}] search failed: {}", config_id, e))?;

    log::info!(
        "[anomaly_detection {}] search returned {} hits (total={})",
        config_id,
        search_result.hits.len(),
        search_result.total
    );

    let data_points = parse_search_results_to_timeseries(&search_result, config_id)?;

    Ok(data_points)
}

/// Parse search results into time-series data points
///
/// Expected format from histogram/aggregation queries:
/// - Each hit should have a timestamp field and a value/count field
#[cfg(feature = "enterprise")]
fn parse_search_results_to_timeseries(
    results: &config::meta::search::Response,
    config_id: &str,
) -> Result<Vec<(i64, f64)>> {
    let mut data_points = Vec::new();
    let mut skipped = 0usize;

    // Log the first hit so we can see the actual field names returned
    if let Some(first) = results.hits.first() {
        if let Some(obj) = first.as_object() {
            let keys: Vec<&str> = obj.keys().map(|s| s.as_str()).collect();
            log::info!(
                "[anomaly_detection {}] result fields: {:?}",
                config_id,
                keys
            );
            log::info!("[anomaly_detection {}] first hit: {}", config_id, first);
        }
    }

    for hit in &results.hits {
        let timestamp = match extract_timestamp_from_hit(hit) {
            Ok(ts) => ts,
            Err(e) => {
                log::warn!(
                    "[anomaly_detection {}] skipping hit — timestamp parse failed: {} | hit={}",
                    config_id,
                    e,
                    hit
                );
                skipped += 1;
                continue;
            }
        };
        let value = match extract_value_from_hit(hit) {
            Ok(v) => v,
            Err(e) => {
                log::warn!(
                    "[anomaly_detection {}] skipping hit — value parse failed: {} | hit={}",
                    config_id,
                    e,
                    hit
                );
                skipped += 1;
                continue;
            }
        };
        data_points.push((timestamp, value));
    }

    if skipped > 0 {
        log::warn!(
            "[anomaly_detection {}] parsed {}/{} hits ({} skipped — missing timestamp or value field)",
            config_id,
            data_points.len(),
            results.hits.len(),
            skipped
        );
    }

    data_points.sort_by_key(|&(ts, _)| ts);

    Ok(data_points)
}

/// Extract timestamp from a search hit
#[cfg(feature = "enterprise")]
fn extract_timestamp_from_hit(hit: &serde_json::Value) -> Result<i64> {
    // Try different timestamp field names
    for field_name in &["_timestamp", "timestamp", "time", "time_bucket"] {
        if let Some(ts_value) = hit.get(field_name) {
            // Numeric microseconds
            if let Some(ts_num) = ts_value.as_i64() {
                return Ok(ts_num);
            }
            if let Some(ts_str) = ts_value.as_str() {
                // RFC3339 with timezone: "2026-02-20T13:15:00Z" or "2026-02-20T13:15:00+00:00"
                if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                    return Ok(dt.timestamp_micros());
                }
                // Naive datetime without timezone (OpenObserve histogram output):
                // "2026-02-20T13:15:00" — treat as UTC.
                //
                // TODO(timezone): OpenObserve histogram() always outputs UTC (origin
                // hardcoded to "2001-01-01T00:00:00", no timezone field in SearchQuery
                // proto). Arrow JSON serializer emits Timestamp(Microsecond, None) as
                // ISO 8601 strings without a "Z" or "+00:00" suffix, so we parse as
                // NaiveDateTime and attach UTC. If OpenObserve ever adds per-query
                // timezone support, update this to use the configured timezone.
                if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S")
                {
                    return Ok(ndt.and_utc().timestamp_micros());
                }
                // With fractional seconds: "2026-02-20T13:15:00.000"
                if let Ok(ndt) =
                    chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S%.f")
                {
                    return Ok(ndt.and_utc().timestamp_micros());
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

/// Send an anomaly alert to the configured destination.
///
/// Called by the enterprise scheduler when anomalies are detected and alert_enabled=true.
/// Looks up the destination by name and POSTs a JSON payload to its webhook URL.
#[cfg(feature = "enterprise")]
pub async fn send_anomaly_alert(
    org_id: String,
    destination_id: String,
    config_name: String,
    config_id: String,
    anomaly_count: i32,
    stream_name: String,
) -> anyhow::Result<()> {
    use config::meta::destinations::{DestinationType, Module};

    use crate::service::alerts::destinations;

    let dest = match destinations::get(&org_id, &destination_id).await {
        Ok(d) => d,
        Err(e) => {
            log::warn!(
                "[anomaly_detection {}] destination '{}' not found: {}",
                config_id,
                destination_id,
                e
            );
            return Ok(());
        }
    };

    let endpoint = match &dest.module {
        Module::Alert {
            destination_type: DestinationType::Http(ep),
            ..
        } => ep.clone(),
        _ => {
            log::warn!(
                "[anomaly_detection {}] destination '{}' is not an HTTP destination — skipping",
                config_id,
                destination_id
            );
            return Ok(());
        }
    };

    let message = format!(
        "Anomaly detected: {} anomalies found in stream '{}' by config '{}'",
        anomaly_count, stream_name, config_name
    );
    // Use Slack-compatible format (text field) so the same payload works for
    // Slack incoming webhooks. Other webhook receivers can still use the fields.
    let payload = serde_json::json!({
        "text": message,
        "alert_type": "anomaly_detection",
        "config_id": config_id,
        "config_name": config_name,
        "org_id": org_id,
        "stream_name": stream_name,
        "anomaly_count": anomaly_count,
        "message": message,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    let client = if endpoint.skip_tls_verify {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()?
    } else {
        reqwest::Client::new()
    };

    let mut req = client.post(&endpoint.url);

    if let Some(headers) = &endpoint.headers {
        for (key, value) in headers.iter() {
            if !key.is_empty() && !value.is_empty() {
                req = req.header(key, value);
            }
        }
    }

    let resp = req
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .await?;

    let status = resp.status();
    log::info!(
        "[anomaly_detection {}] alert sent to '{}': status={}",
        config_id,
        destination_id,
        status
    );

    Ok(())
}
