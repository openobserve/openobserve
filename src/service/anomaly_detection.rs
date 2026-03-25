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
use config::{
    meta::{
        destinations::{DestinationType, Module},
        folder::{DEFAULT_FOLDER, Folder, FolderType},
        stream::StreamType,
        triggers::{ScheduledTriggerData, TriggerModule},
    },
    utils::time::now_micros,
};
use infra::{db::ORM_CLIENT, table::entity::anomaly_detection_config};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait, QueryFilter,
    QueryOrder, Set,
};
use svix_ksuid::KsuidLike;

use crate::{
    handler::http::request::anomaly_detection::{
        CreateAnomalyConfigRequest, UpdateAnomalyConfigRequest,
    },
    service::{alerts::destinations, search},
};

/// Resolve a folder name (e.g. "default") to the PK stored in `folders.id`.
///
/// Anomaly detection configs store the same FK as the alerts table — the KSUID primary
/// key of the folder row, NOT the human-readable name.  This helper performs that
/// lookup and is called whenever we write a folder_id value to the DB.
///
/// If the name is "default" and the folder does not yet exist it is auto-created,
/// matching the behaviour of `alert::create` which calls `create_default_alerts_folder`.
async fn resolve_folder_pk(org_id: &str, name: &str) -> Option<String> {
    let pk = infra::table::folders::get_pk_by_name(org_id, name, FolderType::Alerts)
        .await
        .ok()
        .flatten();

    if pk.is_some() {
        return pk;
    }

    // Auto-create the default Alerts folder on first use, same as alert::create does.
    if name == DEFAULT_FOLDER {
        let folder = Folder {
            folder_id: DEFAULT_FOLDER.to_owned(),
            name: "default".to_owned(),
            description: "default".to_owned(),
        };
        if crate::service::folders::save_folder(org_id, folder, FolderType::Alerts, true)
            .await
            .is_ok()
        {
            return infra::table::folders::get_pk_by_name(org_id, name, FolderType::Alerts)
                .await
                .ok()
                .flatten();
        }
    }

    None
}

/// Translate a stored folder PK back to the user-visible name for API responses.
/// Falls back to "default" if the PK cannot be resolved (e.g. folder was deleted).
async fn pk_to_name(pk: Option<&str>) -> String {
    match pk {
        None => "default".to_string(),
        Some(pk) => infra::table::folders::get_name_by_pk(pk)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "default".to_string()),
    }
}

/// Convert an integer status code to its human-readable string label.
/// This is applied when serializing configs to API responses so the UI
/// continues to receive "waiting"/"ready"/"training"/"failed"/"disabled".
fn status_label(status: i32) -> &'static str {
    o2_enterprise::enterprise::anomaly_detection::types::Status::label(status)
}

/// Enrich a raw serde_json model Value with a `status` string field mapped
/// from the integer `status` column.
fn model_to_api_json(mut val: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = val.as_object_mut()
        && let Some(s) = obj.get("status").and_then(|v| v.as_i64())
    {
        obj.insert(
            "status".to_string(),
            serde_json::Value::String(status_label(s as i32).to_string()),
        );
    }
    val
}

/// List all anomaly detection configurations for an organization.
///
/// Mirrors the alerts list pattern: enriches each config with live trigger state
/// from `scheduled_jobs` so the UI gets accurate timestamps without relying on
/// the config table columns that may lag behind:
///   - `last_detection_run`  ← `trigger.start_time` (set by OSS scheduler pull SQL at the moment
///     Waiting→Processing, i.e. the actual trigger-fired wall-clock time)
///   - `last_anomaly_detected_at` ← `ScheduledTriggerData.last_satisfied_at` stored in
///     `trigger.data` JSON by the handler when `anomaly_count > 0`
pub async fn list_configs(
    org_id: &str,
    folder_name: Option<&str>,
    name_substring: Option<&str>,
) -> Result<Vec<serde_json::Value>> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let configs = anomaly_detection_config::Entity::find()
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .order_by_desc(anomaly_detection_config::Column::CreatedAt)
        .all(db)
        .await?;

    // Build a map of anomaly_id → trigger for O(1) lookups.
    let trigger_map: std::collections::HashMap<String, _> =
        crate::service::db::scheduler::list_by_org(org_id, Some(TriggerModule::AnomalyDetection))
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|t| (t.module_key.clone(), t))
            .collect();

    // Resolve the folder name filter to a PK so we can filter the in-memory list.
    // (Storing PKs in the DB means we must compare against the PK, not the name.)
    let folder_pk_filter: Option<String> = if let Some(name) = folder_name {
        infra::table::folders::get_pk_by_name(
            org_id,
            name,
            config::meta::folder::FolderType::Alerts,
        )
        .await
        .ok()
        .flatten()
    } else {
        None
    };

    // Filter by folder if a name was provided. When the PK lookup returns None
    // (folder not found), no configs should match — return empty.
    let configs: Vec<_> = if folder_name.is_some() {
        match &folder_pk_filter {
            Some(pk) => configs.into_iter().filter(|m| m.folder_id == *pk).collect(),
            None => vec![],
        }
    } else {
        configs
    };

    // Filter by name substring (case-insensitive) when provided.
    let configs: Vec<_> = if let Some(substr) = name_substring.filter(|s| !s.is_empty()) {
        let lower = substr.to_lowercase();
        configs
            .into_iter()
            .filter(|m| m.name.to_lowercase().contains(&lower))
            .collect()
    } else {
        configs
    };

    // Collect unique folder PKs so we can batch-resolve them to name + display name.
    let unique_pks: std::collections::HashSet<String> =
        configs.iter().map(|m| m.folder_id.clone()).collect();
    // pk → (name, display_name)
    let mut pk_to_folder_map: std::collections::HashMap<String, (String, String)> =
        std::collections::HashMap::new();
    for pk in unique_pks {
        if let Ok(Some(info)) = infra::table::folders::get_name_and_display_name_by_pk(&pk).await {
            pk_to_folder_map.insert(pk, info);
        }
    }

    let result: Vec<serde_json::Value> = configs
        .into_iter()
        .map(|model| {
            let anomaly_id = model.anomaly_id.clone();
            let (folder_name, folder_display_name) = pk_to_folder_map
                .get(&model.folder_id)
                .cloned()
                .unwrap_or_else(|| ("default".to_string(), String::new()));
            let mut val = model_to_api_json(serde_json::to_value(model).unwrap_or_default());
            // Replace stored PK with the user-visible name and add display name.
            if let Some(obj) = val.as_object_mut() {
                obj.insert(
                    "folder_id".to_string(),
                    serde_json::Value::String(folder_name),
                );
                obj.insert(
                    "folder_name".to_string(),
                    serde_json::Value::String(folder_display_name),
                );
            }
            if let Some(obj) = val.as_object_mut()
                && let Some(trigger) = trigger_map.get(&anomaly_id)
            {
                // last_detection_run: use trigger.start_time (last time trigger fired)
                // falling back to whatever is already in the config column.
                if let Some(start_time) = trigger.start_time {
                    obj.insert(
                        "last_detection_run".to_string(),
                        serde_json::Value::Number(start_time.into()),
                    );
                }
                // last_anomaly_detected_at: from trigger.data JSON
                if let Ok(td) = ScheduledTriggerData::from_json_string(&trigger.data)
                    && let Some(sat) = td.last_satisfied_at
                {
                    obj.insert(
                        "last_anomaly_detected_at".to_string(),
                        serde_json::Value::Number(sat.into()),
                    );
                }
            }
            val
        })
        .collect();

    Ok(result)
}

/// Get a specific anomaly detection configuration
pub async fn get_config(org_id: &str, anomaly_id: &str) -> Result<Option<serde_json::Value>> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let config = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?;

    match config {
        None => Ok(None),
        Some(model) => {
            let name = pk_to_name(Some(&model.folder_id)).await;
            let mut val = model_to_api_json(serde_json::to_value(model).unwrap_or_default());
            if let Some(obj) = val.as_object_mut() {
                obj.insert("folder_id".to_string(), serde_json::Value::String(name));
            }
            Ok(Some(val))
        }
    }
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

    let anomaly_id = svix_ksuid::Ksuid::new(None, None).to_string();
    let now_us = Utc::now().timestamp_micros();

    // Resolve the folder name to the FK (folders.id PK), consistent with the alerts table.
    let folder_name = req
        .folder_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("default");
    let folder_pk = resolve_folder_pk(org_id, folder_name)
        .await
        .ok_or_else(|| anyhow::anyhow!("Folder '{}' not found", folder_name))?;

    let new_config = anomaly_detection_config::ActiveModel {
        anomaly_id: Set(anomaly_id.clone()),
        org_id: Set(org_id.to_string()),
        stream_name: Set(req.stream_name.clone()),
        stream_type: Set(req.stream_type.clone()),
        enabled: Set(req.enabled.unwrap_or(true)),
        name: Set(req.name.clone()),
        description: Set(req.description.clone()),
        query_mode: Set(req.query_mode.clone()),
        filters: Set(req.filters.clone()),
        custom_sql: Set(req.custom_sql.clone()),
        detection_function: Set(combine_detection_fn(
            &req.detection_function,
            req.detection_function_field.as_deref(),
        )),
        histogram_interval: Set(req.histogram_interval.clone()),
        schedule_interval: Set(req.schedule_interval.clone()),
        detection_window_seconds: Set(req.detection_window_seconds),
        training_window_days: Set(req.training_window_days.unwrap_or(7)),
        retrain_interval_days: Set(req.retrain_interval_days.unwrap_or(7)),
        // Store percentile as i32 (e.g. 97.0 → 97). Whole-number percentiles are
        // sufficient; the valid range is 50–99 and we clamp at the model level.
        threshold: Set(req.percentile.unwrap_or(97.0).clamp(50.0, 99.9) as i32),
        is_trained: Set(false),
        training_started_at: Set(None),
        training_completed_at: Set(None),
        last_error: Set(None),
        last_processed_timestamp: Set(None),
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
        alert_destinations: Set(Some(
            serde_json::to_value(&req.alert_destinations).unwrap_or(serde_json::json!([])),
        )),
        folder_id: Set(folder_pk),
        owner: Set(req.owner.clone()),
        status: Set(0i32), // 0 = waiting
        retries: Set(0),
        last_updated: Set(now_us),
        // Seasonality is auto-determined at training time from training_window_days;
        // initialise to "none" as a placeholder until the first training run.
        seasonality: Set("none".to_string()),
        created_at: Set(now_us),
        updated_at: Set(now_us),
    };

    let result = new_config.insert(db).await?;
    let folder_name_owned = folder_name.to_string();

    // Register a detection trigger in the shared scheduler so it is driven by the
    // same infrastructure as alerts.  The handler will check `is_trained` and skip
    // until training is complete.
    {
        let trigger = crate::service::db::scheduler::Trigger {
            org: org_id.to_string(),
            module: TriggerModule::AnomalyDetection,
            module_key: anomaly_id.clone(),
            next_run_at: now_micros(),
            is_realtime: false,
            is_silenced: false,
            ..Default::default()
        };
        if let Err(e) = crate::service::db::scheduler::push(trigger).await {
            log::warn!("[anomaly_detection {anomaly_id}] failed to push detection trigger: {e}");
        }
    }

    // Immediately kick off training in the background rather than waiting up to
    // `training_check_interval_seconds` (default 1h) for the scheduler tick.
    #[cfg(feature = "enterprise")]
    {
        let anomaly_id_for_training = anomaly_id.clone();
        tokio::spawn(async move {
            if let Err(e) =
                o2_enterprise::enterprise::anomaly_detection::scheduler::trigger_training(
                    &anomaly_id_for_training,
                )
                .await
            {
                log::error!(
                    "[anomaly_detection {}] failed to trigger initial training on create: {}",
                    anomaly_id_for_training,
                    e
                );
            }
        });
    }

    let mut val = serde_json::to_value(result)?;
    if let Some(obj) = val.as_object_mut() {
        obj.insert(
            "folder_id".to_string(),
            serde_json::Value::String(folder_name_owned),
        );
    }
    Ok(val)
}

/// Update an existing anomaly detection configuration
pub async fn update_config(
    org_id: &str,
    anomaly_id: &str,
    req: UpdateAnomalyConfigRequest,
) -> Result<serde_json::Value> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    // Fetch existing config
    let existing = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    let mut active_model: anomaly_detection_config::ActiveModel = existing.into_active_model();

    // Update only provided fields
    // Track whether we need to push a trigger after the DB save (see below).
    let mut push_trigger_after_save = false;
    // Track whether we need to reset (delete + push) an existing trigger after save.
    // Used when schedule_interval changes so next_run_at reflects the new cadence.
    let mut reset_trigger_after_save = false;
    if let Some(enabled) = req.enabled {
        active_model.enabled = Set(enabled);

        if enabled {
            // Defer the push until after active_model.update() so the scheduler
            // always reads enabled=true from the DB when it picks up the trigger.
            // If push() ran before the DB save the scheduler could load enabled=false,
            // hit the skip path, and delay the next run by 60 s.
            push_trigger_after_save = true;
        } else {
            // Do NOT delete the trigger on disable — the scheduler handler already
            // skips and reschedules disabled configs (see handlers.rs). Keeping the
            // trigger row preserves last_detection_run (trigger.start_time) and
            // last_anomaly_detected_at (trigger.data.last_satisfied_at) so they
            // remain visible in the UI after a pause + refresh.
        }
    }
    if let Some(name) = req.name {
        active_model.name = Set(name);
    }
    if let Some(description) = req.description {
        active_model.description = Set(Some(description));
    }
    if let Some(query_mode) = req.query_mode {
        // Clear the opposing field so the DB doesn't hold stale data from the
        // previous mode. query_builder selects the path based on query_mode alone,
        // but stale fields in the DB are confusing when inspecting records.
        match query_mode.as_str() {
            "custom_sql" => {
                active_model.filters = Set(None);
            }
            "filters" => {
                active_model.custom_sql = Set(None);
            }
            _ => {}
        }
        active_model.query_mode = Set(query_mode);
    }
    if let Some(filters) = req.filters {
        active_model.filters = Set(Some(filters));
    }
    if let Some(custom_sql) = req.custom_sql {
        active_model.custom_sql = Set(Some(custom_sql));
    }
    if let Some(detection_function) = req.detection_function {
        active_model.detection_function = Set(combine_detection_fn(
            &detection_function,
            req.detection_function_field.as_deref(),
        ));
    }
    if let Some(histogram_interval) = req.histogram_interval {
        active_model.histogram_interval = Set(histogram_interval);
    }
    if let Some(schedule_interval) = req.schedule_interval {
        active_model.schedule_interval = Set(schedule_interval);
        // Interval changed — reset the trigger so the new cadence takes effect
        // immediately rather than waiting for the old next_run_at to expire.
        reset_trigger_after_save = true;
    }
    if let Some(detection_window_seconds) = req.detection_window_seconds {
        active_model.detection_window_seconds = Set(detection_window_seconds);
    }
    if let Some(percentile) = req.percentile {
        active_model.threshold = Set(percentile.clamp(50.0, 99.9) as i32);
    }
    if let Some(training_window_days) = req.training_window_days {
        active_model.training_window_days = Set(training_window_days.max(1));
    }
    if let Some(retrain_interval_days) = req.retrain_interval_days {
        active_model.retrain_interval_days = Set(retrain_interval_days);
    }
    if let Some(alert_enabled) = req.alert_enabled {
        active_model.alert_enabled = Set(alert_enabled);
    }
    if let Some(destinations) = req.alert_destinations {
        active_model.alert_destinations = Set(Some(
            serde_json::to_value(&destinations).unwrap_or(serde_json::json!([])),
        ));
    }
    if let Some(folder_id_str) = req.folder_id {
        let pk = resolve_folder_pk(org_id, &folder_id_str)
            .await
            .ok_or_else(|| anyhow::anyhow!("Folder '{}' not found", folder_id_str))?;
        active_model.folder_id = Set(pk);
    }
    if let Some(owner) = req.owner {
        active_model.owner = Set(Some(owner));
    }

    active_model.updated_at = Set(Utc::now().timestamp_micros());

    let updated = active_model.update(db).await?;

    // Push the trigger AFTER the DB save so the scheduler always sees enabled=true
    // when it picks up the newly inserted trigger row.
    if push_trigger_after_save {
        let trigger = crate::service::db::scheduler::Trigger {
            org: org_id.to_string(),
            module: TriggerModule::AnomalyDetection,
            module_key: anomaly_id.to_string(),
            next_run_at: now_micros(),
            is_realtime: false,
            is_silenced: false,
            ..Default::default()
        };
        // push() is a no-op if the row already exists (ON CONFLICT DO NOTHING);
        // the existing next_run_at is kept, which is fine — it will fire soon.
        if let Err(e) = crate::service::db::scheduler::push(trigger).await {
            log::warn!("[anomaly_detection {anomaly_id}] failed to push trigger on enable: {e}");
        }
    }

    // When schedule_interval changes, reset the existing trigger's next_run_at to now
    // so the new cadence takes effect immediately (push() alone would be a no-op on an
    // existing row due to ON CONFLICT DO NOTHING).  Only applicable for enabled configs.
    if reset_trigger_after_save && updated.enabled {
        let now = now_micros();
        match crate::service::db::scheduler::get(
            org_id,
            TriggerModule::AnomalyDetection,
            anomaly_id,
        )
        .await
        {
            Ok(mut trigger) => {
                trigger.next_run_at = now;
                if let Err(e) =
                    crate::service::db::scheduler::update_trigger(trigger, false, "").await
                {
                    log::warn!(
                        "[anomaly_detection {anomaly_id}] failed to reset trigger on interval change: {e}"
                    );
                }
            }
            Err(_) => {
                // No trigger row — create one (config is enabled, so one should exist).
                let trigger = crate::service::db::scheduler::Trigger {
                    org: org_id.to_string(),
                    module: TriggerModule::AnomalyDetection,
                    module_key: anomaly_id.to_string(),
                    next_run_at: now,
                    is_realtime: false,
                    is_silenced: false,
                    ..Default::default()
                };
                if let Err(e) = crate::service::db::scheduler::push(trigger).await {
                    log::warn!(
                        "[anomaly_detection {anomaly_id}] failed to push trigger on interval change: {e}"
                    );
                }
            }
        }
    }

    let name = pk_to_name(Some(&updated.folder_id)).await;
    let mut val = serde_json::to_value(updated)?;
    if let Some(obj) = val.as_object_mut() {
        obj.insert("folder_id".to_string(), serde_json::Value::String(name));
    }
    Ok(val)
}

/// Delete an anomaly detection configuration
pub async fn delete_config(org_id: &str, anomaly_id: &str) -> Result<()> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let config = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    config.delete(db).await?;

    // Remove the detection trigger from the shared scheduler.
    {
        if let Err(e) = crate::service::db::scheduler::delete(
            org_id,
            TriggerModule::AnomalyDetection,
            anomaly_id,
        )
        .await
        {
            log::warn!("[anomaly_detection {anomaly_id}] failed to delete detection trigger: {e}");
        }
    }

    // Delete stored model files and clear cache (enterprise only).
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::anomaly_detection::delete_config_models(org_id, anomaly_id).await;

    Ok(())
}

/// Clone an anomaly detection configuration.
///
/// Copies all configuration fields from the source config to a new config with a new
/// KSUID. Runtime/training state is reset: `is_trained=false`, all training timestamps
/// cleared, `status=0` (waiting), and counters zeroed.
///
/// If `new_name` is provided it is used as the cloned config's name; otherwise the
/// source name is suffixed with `"_copy"`.
///
/// If `folder_id` is provided the clone is placed in that folder; otherwise the same
/// folder as the source is used.
pub async fn clone_config(
    org_id: &str,
    anomaly_id: &str,
    new_name: Option<String>,
    folder_id: Option<String>,
) -> Result<serde_json::Value> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let src = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    let new_id = svix_ksuid::Ksuid::new(None, None).to_string();
    let now_us = Utc::now().timestamp_micros();

    // If a new folder name is given, resolve it to the PK; otherwise inherit the
    // source's already-stored PK.
    let resolved_folder_id = if let Some(name) = folder_id {
        resolve_folder_pk(org_id, &name)
            .await
            .unwrap_or_else(|| src.folder_id.clone())
    } else {
        src.folder_id.clone()
    };

    let cloned = anomaly_detection_config::ActiveModel {
        anomaly_id: Set(new_id.clone()),
        org_id: Set(src.org_id.clone()),
        stream_name: Set(src.stream_name.clone()),
        stream_type: Set(src.stream_type.clone()),
        enabled: Set(src.enabled),
        name: Set(new_name.unwrap_or_else(|| format!("{}_copy", src.name))),
        description: Set(src.description.clone()),
        query_mode: Set(src.query_mode.clone()),
        filters: Set(src.filters.clone()),
        custom_sql: Set(src.custom_sql.clone()),
        detection_function: Set(src.detection_function.clone()),
        histogram_interval: Set(src.histogram_interval.clone()),
        schedule_interval: Set(src.schedule_interval.clone()),
        detection_window_seconds: Set(src.detection_window_seconds),
        training_window_days: Set(src.training_window_days),
        retrain_interval_days: Set(src.retrain_interval_days),
        threshold: Set(src.threshold),
        seasonality: Set(src.seasonality.clone()),
        is_trained: Set(false),
        training_started_at: Set(None),
        training_completed_at: Set(None),
        last_error: Set(None),
        last_processed_timestamp: Set(None),
        current_model_version: Set(0),
        rcf_num_trees: Set(src.rcf_num_trees),
        rcf_tree_size: Set(src.rcf_tree_size),
        rcf_shingle_size: Set(src.rcf_shingle_size),
        alert_enabled: Set(src.alert_enabled),
        alert_destinations: Set(src.alert_destinations.clone()),
        folder_id: Set(resolved_folder_id),
        owner: Set(src.owner.clone()),
        status: Set(0i32),
        retries: Set(0),
        last_updated: Set(now_us),
        created_at: Set(now_us),
        updated_at: Set(now_us),
    };

    let result = cloned.insert(db).await?;

    // Register detection trigger for the new config
    {
        let trigger = crate::service::db::scheduler::Trigger {
            org: org_id.to_string(),
            module: TriggerModule::AnomalyDetection,
            module_key: new_id.clone(),
            next_run_at: now_micros(),
            is_realtime: false,
            is_silenced: false,
            ..Default::default()
        };
        if let Err(e) = crate::service::db::scheduler::push(trigger).await {
            log::warn!("[anomaly_detection {new_id}] failed to push detection trigger: {e}");
        }
    }

    let name = pk_to_name(Some(&result.folder_id)).await;
    let mut val = model_to_api_json(serde_json::to_value(result).unwrap_or_default());
    if let Some(obj) = val.as_object_mut() {
        obj.insert("folder_id".to_string(), serde_json::Value::String(name));
    }
    Ok(val)
}

/// Cancel an in-progress training run.
///
/// Resets the config status to `Waiting` and clears `training_started_at` so the
/// enterprise training scheduler stops treating it as an active job.  The background
/// tokio task (if any) will complete on its own but its final `update_config_status`
/// call is idempotent — it will simply overwrite `Waiting` with `Active` if it succeeds,
/// which the user can then re-cancel if needed.  In practice the task will notice the
/// status change and bail early on the next DB write.
pub async fn cancel_training(org_id: &str, anomaly_id: &str) -> Result<()> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    let config = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    let mut active = config.into_active_model();
    // Status 0 = Waiting — back to the queue so the user can re-trigger training.
    active.status = Set(0i32);
    active.training_started_at = Set(None);
    active.last_error = Set(Some("Training cancelled by user.".to_string()));
    active.updated_at = Set(Utc::now().timestamp_micros());
    active.update(db).await?;

    log::info!("[anomaly_detection {anomaly_id}] training cancelled by user");
    Ok(())
}

/// Train a model for a configuration
pub async fn train_model(org_id: &str, anomaly_id: &str) -> Result<serde_json::Value> {
    // Verify the config exists and belongs to this org before delegating.
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;
    anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::anomaly_detection::scheduler::trigger_training(anomaly_id)
            .await?;
        Ok(serde_json::json!({
            "message": "Training started",
            "anomaly_id": anomaly_id,
            "status": "in_progress"
        }))
    }
    #[cfg(not(feature = "enterprise"))]
    anyhow::bail!("Anomaly detection is an enterprise feature")
}

/// Run detection for a configuration
pub async fn detect_anomalies(org_id: &str, anomaly_id: &str) -> Result<serde_json::Value> {
    let db = ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    // Fetch config
    let config = anomaly_detection_config::Entity::find_by_id(anomaly_id)
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
            anomaly_id,
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
            anomaly_id,
            &anomaly_config.stream_type.to_string(),
        )
        .await?;

        log::info!(
            "[anomaly_detection {}] fetched {} data points for detection",
            anomaly_id,
            data_points.len()
        );

        // Initialize detector
        let detector = Detector::new(anomaly_config.clone()).await?;

        // Run detection with fetched data
        let start_time = std::time::Instant::now();
        let result = detector.detect_with_data(&data_points, start_time).await?;

        log::info!(
            "[anomaly_detection {}] detection complete: points_scored={}, anomalies_found={}",
            anomaly_id,
            result.data_points_processed,
            result.anomaly_count
        );

        // Write all scored points to the _anomalies stream (not just anomalous ones).
        // This gives the frontend a continuous score timeline so it can plot every bucket
        // with its score and the threshold line, regardless of whether it was anomalous.
        if !result.scored_points.is_empty() {
            log::info!(
                "[anomaly_detection {}] writing {} scored points ({} anomalies) to _anomalies stream",
                anomaly_id,
                result.scored_points.len(),
                result.anomaly_count,
            );
            let records: Vec<serde_json::Value> = result
                .scored_points
                .iter()
                .map(serde_json::to_value)
                .collect::<Result<Vec<_>, _>>()?;

            write_anomalies_to_stream(org_id, records).await?;
        }

        // Send alert if anomalies found and alert is configured
        if result.anomaly_count > 0 && config.alert_enabled {
            let destinations: Vec<String> = config
                .alert_destinations
                .as_ref()
                .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok())
                .unwrap_or_default();
            if !destinations.is_empty() {
                let anomaly_pts: Vec<_> = result
                    .scored_points
                    .iter()
                    .filter(|p| p.is_anomaly)
                    .collect();
                let max_dev = anomaly_pts
                    .iter()
                    .map(|p| p.deviation_percent)
                    .fold(0.0f64, f64::max);
                let worst_val = anomaly_pts
                    .iter()
                    .max_by(|a, b| {
                        a.deviation_percent
                            .partial_cmp(&b.deviation_percent)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .map(|p| p.actual_value)
                    .unwrap_or(0.0);
                let window_start = result
                    .scored_points
                    .iter()
                    .map(|p| p.timestamp)
                    .min()
                    .unwrap_or(start_time_us);
                let window_end = result
                    .scored_points
                    .iter()
                    .map(|p| p.timestamp)
                    .max()
                    .unwrap_or(end_time_us);

                for dest_id in destinations {
                    if let Err(e) = send_anomaly_alert(
                        org_id.to_string(),
                        dest_id.clone(),
                        config.name.clone(),
                        anomaly_id.to_string(),
                        result.anomaly_count,
                        config.stream_name.clone(),
                        max_dev,
                        worst_val,
                        window_start,
                        window_end,
                    )
                    .await
                    {
                        log::warn!(
                            "[anomaly_detection {}] failed to send alert to '{}': {}",
                            anomaly_id,
                            dest_id,
                            e
                        );
                    }
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
            "anomaly_id": anomaly_id,
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
    _anomaly_id: &str,
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

/// Startup recovery: ensure every enabled anomaly config has a live detection trigger
/// in `scheduled_jobs`.
///
/// Called once at startup (in `job/mod.rs`) before the alert scheduler starts.
/// Handles one failure mode: trigger row missing entirely (e.g. DB was reset, row never
/// created). Processing→Waiting recovery is intentionally NOT done here — the OSS
/// scheduler's `watch_timeout()` job already resets any `Processing` rows whose
/// `end_time` has passed, exactly as it does for alert triggers.
pub async fn recover_detection_triggers_on_startup() {
    let db = match ORM_CLIENT.get() {
        Some(db) => db,
        None => {
            log::warn!("[anomaly_detection] DB not available for startup trigger recovery");
            return;
        }
    };

    let configs = match anomaly_detection_config::Entity::find()
        .filter(anomaly_detection_config::Column::Enabled.eq(true))
        .all(db)
        .await
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!(
                "[anomaly_detection] Failed to query configs for startup trigger recovery: {e}"
            );
            return;
        }
    };

    log::info!(
        "[anomaly_detection] Startup trigger recovery: checking {} enabled config(s)",
        configs.len()
    );

    for config in &configs {
        let org = &config.org_id;
        let key = &config.anomaly_id;

        match crate::service::db::scheduler::get(org, TriggerModule::AnomalyDetection, key).await {
            Ok(_) => {
                // Trigger exists — OSS scheduler will fire it when next_run_at passes.
                // Processing→Waiting recovery is handled by watch_timeout().
            }
            Err(_) => {
                // Row missing — create a fresh trigger due immediately.
                log::info!("[anomaly_detection] Re-creating missing trigger for {key}");
                let trigger = crate::service::db::scheduler::Trigger {
                    org: org.clone(),
                    module: TriggerModule::AnomalyDetection,
                    module_key: key.clone(),
                    next_run_at: now_micros(),
                    is_realtime: false,
                    is_silenced: false,
                    ..Default::default()
                };
                if let Err(e) = crate::service::db::scheduler::push(trigger).await {
                    log::warn!("[anomaly_detection] Failed to re-create trigger for {key}: {e}");
                }
            }
        }
    }
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

    // Validate interval strings
    parse_interval(&req.histogram_interval)?;
    parse_interval(&req.schedule_interval)?;

    Ok(())
}

/// Combine a detection function name and optional field into the DB storage form.
/// E.g. ("avg", Some("cpu_millicores")) → "avg(cpu_millicores)"
///      ("count", _) → "count(*)"
///      ("avg(cpu_millicores)", _) → "avg(cpu_millicores)"  (already combined, pass-through)
fn combine_detection_fn(function: &str, field: Option<&str>) -> String {
    if function.contains('(') {
        return function.to_string();
    }
    match function {
        "count" => "count(*)".to_string(),
        other => match field {
            Some(f) if !f.is_empty() => format!("{}({})", other, f),
            _ => function.to_string(),
        },
    }
}

/// Parse interval string like "1h", "30m" into seconds
fn parse_interval(interval: &str) -> Result<i64> {
    if let Some(interval) = interval.strip_suffix('h') {
        let hours: i64 = interval.parse()?;
        Ok(hours * 3600)
    } else if let Some(interval) = interval.strip_suffix('m') {
        let minutes: i64 = interval.parse()?;
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
        anomaly_id: config.anomaly_id.clone(),
        org_id: config.org_id.clone(),
        stream_name: config.stream_name.clone(),
        stream_type: serde_json::from_str(&format!("\"{}\"", config.stream_type))?,
        enabled: config.enabled,
        name: config.name.clone(),
        description: config.description.clone(),
        query_mode: serde_json::from_str(&format!("\"{}\"", config.query_mode))?,
        filters,
        custom_sql: config.custom_sql.clone(),
        detection_function: {
            use o2_enterprise::enterprise::anomaly_detection::detector::split_detection_function;
            let (fn_name, _) = split_detection_function(&config.detection_function);
            serde_json::from_str(&format!("\"{}\"", fn_name))?
        },
        detection_field: {
            use o2_enterprise::enterprise::anomaly_detection::detector::split_detection_function;
            let (_, field) = split_detection_function(&config.detection_function);
            field
        },
        histogram_interval: config.histogram_interval.clone(),
        schedule_interval: config.schedule_interval.clone(),
        detection_window_seconds: config.detection_window_seconds,
        training_window_days: config.training_window_days as usize,
        retrain_interval_days: config.retrain_interval_days,
        threshold: config.threshold,
        seasonality: serde_json::from_str(&format!("\"{}\"", config.seasonality))
            .unwrap_or_default(),
        is_trained: config.is_trained,
        training_started_at: config.training_started_at,
        training_completed_at: config.training_completed_at,
        last_processed_timestamp: config.last_processed_timestamp,
        current_model_version: Some(config.current_model_version),
        rcf_num_trees: config.rcf_num_trees as usize,
        rcf_tree_size: config.rcf_tree_size as usize,
        rcf_shingle_size: config.rcf_shingle_size as usize,
        alert_enabled: config.alert_enabled,
        alert_destinations: config
            .alert_destinations
            .as_ref()
            .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok())
            .unwrap_or_default(),
        status: o2_enterprise::enterprise::anomaly_detection::types::Status::from_i32(
            config.status,
        ),
        retries: config.retries,
        last_updated: config.last_updated,
        created_at: config.created_at,
        updated_at: config.updated_at,
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
    anomaly_id: &str,
    stream_type: &str,
) -> Result<Vec<o2_enterprise::enterprise::anomaly_detection::types::QueryDataPoint>> {
    log::info!(
        "[anomaly_detection {}] executing query: sql={}, start_time_us={}, end_time_us={}",
        anomaly_id,
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

    let parsed_stream_type = StreamType::from(stream_type);
    let trace_id = config::ider::generate_trace_id();
    let search_result = search::search(&trace_id, org_id, parsed_stream_type, None, &search_req)
        .await
        .map_err(|e| anyhow::anyhow!("[anomaly_detection {}] search failed: {}", anomaly_id, e))?;

    log::info!(
        "[anomaly_detection {}] search returned {} hits (total={})",
        anomaly_id,
        search_result.hits.len(),
        search_result.total
    );

    let data_points = parse_search_results_to_timeseries(&search_result, anomaly_id)?;

    Ok(data_points)
}

/// Parse search results into time-series data points.
///
/// Extracts `timestamp`, `value`, and (when present) `hour` and `dow` from each hit.
/// `hour` and `dow` are included by filter-based queries via `date_part()`; they are
/// absent for custom SQL queries, in which case `QueryDataPoint` carries `None` and
/// `build_feature_vector` falls back to Rust-side extraction from the timestamp.
#[cfg(feature = "enterprise")]
fn parse_search_results_to_timeseries(
    results: &config::meta::search::Response,
    anomaly_id: &str,
) -> Result<Vec<o2_enterprise::enterprise::anomaly_detection::types::QueryDataPoint>> {
    use o2_enterprise::enterprise::anomaly_detection::types::QueryDataPoint;

    let mut data_points = Vec::new();
    let mut skipped = 0usize;

    if let Some(first) = results.hits.first()
        && let Some(obj) = first.as_object()
    {
        let keys: Vec<&str> = obj.keys().map(|s| s.as_str()).collect();
        log::info!(
            "[anomaly_detection {}] result fields: {:?}",
            anomaly_id,
            keys
        );
    }

    for hit in &results.hits {
        let timestamp_us = match extract_timestamp_from_hit(hit) {
            Ok(ts) => ts,
            Err(e) => {
                log::warn!(
                    "[anomaly_detection {}] skipping hit — timestamp parse failed: {} | hit={}",
                    anomaly_id,
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
                    anomaly_id,
                    e,
                    hit
                );
                skipped += 1;
                continue;
            }
        };

        // Extract pre-computed temporal features (present for filter-based queries only).
        let hour = hit
            .get("hour")
            .and_then(|v| v.as_f64())
            .map(|h| h as f32 / 24.0);
        let dow = hit
            .get("dow")
            .and_then(|v| v.as_f64())
            .map(|d| d as f32 / 7.0);

        data_points.push(QueryDataPoint {
            timestamp_us,
            value,
            hour,
            dow,
        });
    }

    if skipped > 0 {
        log::warn!(
            "[anomaly_detection {}] parsed {}/{} hits ({} skipped)",
            anomaly_id,
            data_points.len(),
            results.hits.len(),
            skipped
        );
    }

    data_points.sort_by_key(|p| p.timestamp_us);

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

/// Write anomaly events to the _anomalies stream.
///
/// Uses HTTP POST to an ingester node so this works from any node role
/// (including alert_manager which is not an ingester and cannot call
/// service::logs::ingest::ingest() directly).
#[cfg(feature = "enterprise")]
pub async fn write_anomalies_to_stream(
    org_id: &str,
    anomalies: Vec<serde_json::Value>,
) -> Result<()> {
    if anomalies.is_empty() {
        return Ok(());
    }

    // Pick an online ingester node to forward the write to.
    let ingester = infra::cluster::get_cached_online_ingester_nodes()
        .await
        .and_then(|nodes| nodes.into_iter().next())
        .ok_or_else(|| anyhow::anyhow!("No online ingester node available to write _anomalies"))?;

    let cfg = config::get_config();
    let url = format!(
        "{}{}/api/{org_id}/_anomalies/_json",
        ingester.http_addr, cfg.common.base_uri,
    );

    tracing::info!(
        org_id = %org_id,
        anomaly_count = anomalies.len(),
        ingester = %ingester.name,
        "Writing anomalies to _anomalies stream via ingester HTTP"
    );

    let json_body = serde_json::to_string(&anomalies)?;

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header(
            "Authorization",
            format!(
                "Basic {}",
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    format!(
                        "{}:{}",
                        cfg.auth.root_user_email, cfg.auth.root_user_password
                    )
                )
            ),
        )
        .body(json_body)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("HTTP request to ingester failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Ingester returned {status} writing _anomalies: {body}");
    }

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
#[allow(clippy::too_many_arguments)]
pub async fn send_anomaly_alert(
    org_id: String,
    destination_id: String,
    config_name: String,
    anomaly_id: String,
    anomaly_count: i32,
    stream_name: String,
    // Max deviation above threshold as a percentage (0.0 if no anomalies).
    max_deviation_percent: f64,
    // Actual metric value of the worst-scoring anomalous bucket.
    worst_actual_value: f64,
    // Detection window start (Unix microseconds).
    window_start_us: i64,
    // Detection window end (Unix microseconds).
    window_end_us: i64,
) -> anyhow::Result<()> {
    let dest = match destinations::get(&org_id, &destination_id).await {
        Ok(d) => d,
        Err(e) => {
            log::warn!(
                "[anomaly_detection {}] destination '{}' not found: {}",
                anomaly_id,
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
                anomaly_id,
                destination_id
            );
            return Ok(());
        }
    };

    // Format the detection window as human-readable UTC strings.
    let fmt_us = |us: i64| -> String {
        chrono::DateTime::from_timestamp_micros(us)
            .map(|dt| dt.format("%Y-%m-%d %H:%M UTC").to_string())
            .unwrap_or_else(|| "unknown".to_string())
    };
    let window_start_str = fmt_us(window_start_us);
    let window_end_str = fmt_us(window_end_us);

    let message = format!(
        "Anomaly detected in stream '{}' (anomaly name: '{}'): {} anomalies in window {}\u{2013}{} \
         | worst value: {:.2} | max deviation: {:.1}%",
        stream_name,
        config_name,
        anomaly_count,
        window_start_str,
        window_end_str,
        worst_actual_value,
        max_deviation_percent,
    );
    // Use Slack-compatible format (text field) so the same payload works for
    // Slack incoming webhooks. Other webhook receivers can still use the fields.
    let payload = serde_json::json!({
        "text": message,
        "alert_type": "anomaly_detection",
        "anomaly_id": anomaly_id,
        "config_name": config_name,
        "org_id": org_id,
        "stream_name": stream_name,
        "anomaly_count": anomaly_count,
        "max_deviation_percent": max_deviation_percent,
        "worst_actual_value": worst_actual_value,
        "window_start": window_start_str,
        "window_end": window_end_str,
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
        anomaly_id,
        destination_id,
        status
    );

    Ok(())
}
