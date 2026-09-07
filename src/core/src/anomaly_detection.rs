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
        folder::{DEFAULT_FOLDER, FolderType},
        stream::StreamType,
        triggers::{ScheduledTriggerData, TriggerModule},
    },
    utils::time::now_micros,
};
use db::authz::{remove_ownership, set_ownership};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::anomaly_detection::config as anomaly_config_table,
};
use sea_orm::{ActiveModelTrait, IntoActiveModel, Set};
use search_service as search;
use serde::{Deserialize, Serialize};
use svix_ksuid::KsuidLike;
use utoipa::ToSchema;

use crate::{alerts::destinations, common::meta::authz::Authz};

/// Async training entry points already wired to `ensure_trainable`; each joins as it is gated.
#[allow(dead_code)]
const GUARDED_TRAINING_ENTRY_POINTS: &[&str] = &[];

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateAnomalyConfigRequest {
    pub name: String,
    pub description: Option<String>,
    pub stream_name: String,
    pub stream_type: String,
    pub query_mode: String,
    pub filters: Option<serde_json::Value>,
    pub custom_sql: Option<String>,
    pub detection_function: String,
    pub detection_function_field: Option<String>,
    pub histogram_interval: String,
    pub schedule_interval: String,
    pub detection_window_seconds: i64,
    pub training_window_days: Option<i32>,
    pub retrain_interval_days: Option<i32>,
    pub percentile: Option<f64>,
    pub rcf_num_trees: Option<i32>,
    pub rcf_tree_size: Option<i32>,
    pub rcf_shingle_size: Option<i32>,
    pub alert_enabled: Option<bool>,
    #[serde(default)]
    pub alert_destinations: Vec<String>,
    pub enabled: Option<bool>,
    pub folder_id: Option<String>,
    pub owner: Option<String>,
    /// Triage priority P1..P5 (Feature 2, PT-1). Anomaly configs appear in the
    /// same alert list as scheduled/realtime alerts, so they carry the same
    /// metadata. Absent = unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<u8>, example = 3)]
    pub priority: Option<config::meta::alerts::priority::AlertPriority>,
    /// Selection tags (PT-6), normalized and validated on save exactly as for
    /// alerts — one `normalize_tags` serves both.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Deserializer that keeps "absent" and "explicit null" apart for a
/// `Option<Option<T>>` field.
///
/// Serde's default collapses both to `None`: a plain `Option<Option<T>>`
/// deserializes `null` to the OUTER `None`, so "clear this value" becomes
/// indistinguishable from "field not supplied". That silently made priority
/// unclearable through the direct anomaly endpoint; this restores the
/// distinction (`null` -> `Some(None)`).
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(deserializer).map(Some)
}

#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct UpdateAnomalyConfigRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub query_mode: Option<String>,
    pub filters: Option<serde_json::Value>,
    pub custom_sql: Option<String>,
    pub detection_function: Option<String>,
    pub detection_function_field: Option<String>,
    pub histogram_interval: Option<String>,
    pub schedule_interval: Option<String>,
    pub detection_window_seconds: Option<i64>,
    pub training_window_days: Option<i32>,
    pub percentile: Option<f64>,
    pub retrain_interval_days: Option<i32>,
    pub alert_enabled: Option<bool>,
    pub alert_destinations: Option<Vec<String>>,
    pub enabled: Option<bool>,
    pub folder_id: Option<String>,
    pub owner: Option<String>,
    /// Double-option so "absent" and "explicit null" stay distinguishable
    /// (same shape as `TimedAnnotationUpdate::end_time`):
    ///   * `None`             — field not supplied, leave the stored value
    ///   * `Some(None)`       — clear the priority
    ///   * `Some(Some(p))`    — set it
    ///
    /// A plain `Option` cannot express "clear", which made priority the only
    /// field on an anomaly config that could be set but never unset — and
    /// inconsistent with alerts, where clearing works.
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    #[schema(value_type = Option<u8>, example = 3)]
    pub priority: Option<Option<config::meta::alerts::priority::AlertPriority>>,
    /// `None` leaves stored tags untouched; `Some(vec![])` clears them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

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
        if crate::folders::ensure_default_folder(org_id, FolderType::Alerts)
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

/// Merge the run state the scheduler recorded on the trigger into a config row.
///
/// These key names are the contract `anomaly_config_to_list_item` reads; the
/// alert list has no other source for an anomaly's outcome.
fn merge_trigger_run_state(obj: &mut serde_json::Map<String, serde_json::Value>, data: &str) {
    let Ok(td) = ScheduledTriggerData::from_json_string(data) else {
        return;
    };
    if let Some(sat) = td.last_satisfied_at {
        obj.insert(
            "last_anomaly_detected_at".to_string(),
            serde_json::Value::Number(sat.into()),
        );
    }
    if let Some(outcome) = td.last_outcome {
        obj.insert(
            "last_outcome".to_string(),
            serde_json::Value::String(outcome),
        );
    }
    if let Some(at) = td.last_outcome_at {
        obj.insert(
            "last_outcome_at".to_string(),
            serde_json::Value::Number(at.into()),
        );
    }
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
    let db = get_orm_client_rw().await;

    let configs = anomaly_config_table::list_by_org(db, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Build a map of anomaly_id → trigger for O(1) lookups.
    let trigger_map: std::collections::HashMap<String, _> =
        crate::db::scheduler::list_by_org(org_id, Some(TriggerModule::AnomalyDetection))
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
                merge_trigger_run_state(obj, &trigger.data);
            }
            val
        })
        .collect();

    Ok(result)
}

/// Get a specific anomaly detection configuration
pub async fn get_config(org_id: &str, anomaly_id: &str) -> Result<Option<serde_json::Value>> {
    let db = get_orm_client_rw().await;

    let config = anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

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
    mut req: CreateAnomalyConfigRequest,
) -> Result<serde_json::Value> {
    req.filters = normalize_request_filters(req.filters).map_err(validation_error)?;
    validate_config_request(&req).map_err(validation_error)?;

    // Feature 2 (PT-7): same normalization the alerts path uses, so a tag
    // means the same thing on both. Kept typed, not stringified, so the API
    // layer can downcast it to a 400.
    let normalized_tags =
        config::meta::alerts::tags::normalize_tags(&req.tags).map_err(anyhow::Error::new)?;

    let db = get_orm_client_rw().await;

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

    use infra::table::entity::anomaly_detection_config::Model as ConfigModel;
    let new_config = ConfigModel {
        anomaly_id: anomaly_id.clone(),
        org_id: org_id.to_string(),
        stream_name: req.stream_name.clone(),
        stream_type: req.stream_type.clone(),
        enabled: req.enabled.unwrap_or(true),
        name: req.name.clone(),
        description: req.description.clone(),
        query_mode: req.query_mode.clone(),
        filters: req.filters.clone(),
        custom_sql: req.custom_sql.clone(),
        detection_function: combine_detection_fn(
            &req.detection_function,
            req.detection_function_field.as_deref(),
        ),
        histogram_interval: req.histogram_interval.clone(),
        schedule_interval: req.schedule_interval.clone(),
        detection_window_seconds: req.detection_window_seconds,
        training_window_days: req.training_window_days.unwrap_or(7),
        retrain_interval_days: req.retrain_interval_days.unwrap_or(7),
        // Whole-number percentiles suffice; the model clamps to 50–99.9 regardless.
        threshold: req.percentile.unwrap_or(97.0).clamp(50.0, 99.9) as i32,
        is_trained: false,
        training_started_at: None,
        training_completed_at: None,
        last_error: None,
        last_processed_timestamp: None,
        current_model_version: 0,
        rcf_num_trees: req.rcf_num_trees.unwrap_or(
            o2_enterprise::enterprise::common::config::get_config()
                .anomaly_detection
                .rcf_num_trees as i32,
        ),
        rcf_tree_size: req.rcf_tree_size.unwrap_or(
            o2_enterprise::enterprise::common::config::get_config()
                .anomaly_detection
                .rcf_tree_size as i32,
        ),
        // shingle_size default comes from O2_ANOMALY_RCF_SHINGLE_SIZE env var (default=4).
        // 4 consecutive time-buckets gives the RCF model enough temporal context.
        rcf_shingle_size: req.rcf_shingle_size.unwrap_or(
            o2_enterprise::enterprise::common::config::get_config()
                .anomaly_detection
                .rcf_shingle_size as i32,
        ),
        alert_enabled: req.alert_enabled.unwrap_or(true),
        alert_destinations: Some(
            serde_json::to_value(&req.alert_destinations).unwrap_or(serde_json::json!([])),
        ),
        folder_id: folder_pk,
        owner: req.owner.clone(),
        // Feature 2. Tags are NORMALIZED here, not merely validated, so the
        // stored form matches what the alerts table stores and one filter
        // compares like with like. NULL rather than 0/[] when unset, so an
        // existing config's row is unchanged.
        priority: req.priority.map(|p| p.to_i32()),
        tags: if normalized_tags.is_empty() {
            None
        } else {
            Some(serde_json::json!(normalized_tags))
        },
        status: 0i32, // 0 = waiting
        retries: 0,
        last_failed_at: None,
        last_alert_fired_at: None,
        last_updated: now_us,
        // Seasonality is auto-determined at training time from training_window_days;
        // initialise to "none" as a placeholder until the first training run.
        seasonality: "none".to_string(),
        created_at: now_us,
        updated_at: now_us,
    };

    #[cfg(feature = "enterprise")]
    let created_enabled = new_config.enabled;
    let result = anomaly_config_table::create(db, new_config)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    set_ownership(
        org_id,
        "alerts",
        Authz {
            obj_id: result.anomaly_id.clone(),
            parent_type: "alert_folders".to_owned(),
            parent: folder_name.to_owned(),
        },
    )
    .await;

    // Broadcast config creation to all super cluster regions for API-read consistency.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::anomaly_config_create(result.clone())
                .await
    {
        log::warn!(
            "[anomaly_detection {}] failed to broadcast ConfigCreate to super cluster: {e}",
            result.anomaly_id
        );
    }

    let folder_name_owned = folder_name.to_string();

    // Register a detection trigger in the shared scheduler so it is driven by the
    // same infrastructure as alerts.  The handler will check `is_trained` and skip
    // until training is complete.
    {
        let trigger = crate::db::scheduler::Trigger {
            org: org_id.to_string(),
            module: TriggerModule::AnomalyDetection,
            module_key: anomaly_id.clone(),
            next_run_at: now_micros(),
            is_realtime: false,
            is_silenced: false,
            ..Default::default()
        };
        if let Err(e) = crate::db::scheduler::push(trigger).await {
            log::warn!("[anomaly_detection {anomaly_id}] failed to push detection trigger: {e}");
        }
    }

    // Immediately kick off training in the background rather than waiting up to
    // `training_check_interval_seconds` (default 1h) for the scheduler tick.
    #[cfg(feature = "enterprise")]
    if initial_training_allowed(
        created_enabled,
        o2_enterprise::enterprise::common::config::get_config()
            .anomaly_detection
            .disabled,
    ) {
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
    let db = get_orm_client_rw().await;

    // Fetch existing config — into_active_model() on a DB-fetched model sets the PK as
    // Unchanged, which is required for SeaORM to generate UPDATE … WHERE anomaly_id = ?
    let existing = anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    // Remember the pre-update threshold so we can detect an actual change below and, if so,
    // recompute the trained model's cutoff in place without a retrain.
    let previous_threshold = existing.threshold;
    let previous = existing.clone();
    // Only a field that could plausibly fix a failure clears the backoff, so that a bulk
    // folder move or tag edit cannot reset the counter on dozens of configs at once.
    let mut retryable_change = false;

    validated_intervals(&req, &existing).map_err(validation_error)?;

    let mut active_model = existing.into_active_model();

    // Update only provided fields
    // Track whether we need to push a trigger after the DB save (see below).
    let mut push_trigger_after_save = false;
    // Track whether we need to reset (delete + push) an existing trigger after save.
    // Used when schedule_interval changes so next_run_at reflects the new cadence.
    let mut reset_trigger_after_save = false;
    // Track whether the threshold (percentile) actually changed, so we recompute the trained
    // model's baked cutoff in place after the DB save — no retrain required. Only read behind
    // the enterprise cfg below; in an OSS build it is assigned but unused (no recompute path).
    #[cfg_attr(
        not(feature = "enterprise"),
        allow(unused_assignments, unused_variables)
    )]
    let mut new_threshold: Option<i32> = None;
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
        retryable_change |= previous.query_mode != query_mode;
        active_model.query_mode = Set(query_mode);
    }
    if let Some(filters) = normalize_request_filters(req.filters).map_err(validation_error)? {
        // Compared as rows so NULL, `{}` and `[]` all read as the same "no filters".
        let rows = |v: Option<&serde_json::Value>| {
            v.and_then(|v| v.as_array()).cloned().unwrap_or_default()
        };
        retryable_change |= rows(previous.filters.as_ref()) != rows(Some(&filters));
        active_model.filters = Set(Some(filters));
    }
    if let Some(custom_sql) = req.custom_sql {
        retryable_change |= previous.custom_sql.as_deref() != Some(custom_sql.as_str());
        active_model.custom_sql = Set(Some(custom_sql));
    }
    if let Some(detection_function) = req.detection_function {
        let combined =
            combine_detection_fn(&detection_function, req.detection_function_field.as_deref());
        retryable_change |= previous.detection_function != combined;
        active_model.detection_function = Set(combined);
    }
    if let Some(histogram_interval) = req.histogram_interval {
        retryable_change |= previous.histogram_interval != histogram_interval;
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
        let clamped = percentile.clamp(50.0, 99.9) as i32;
        active_model.threshold = Set(clamped);
        if clamped != previous_threshold {
            new_threshold = Some(clamped);
        }
    }
    if let Some(training_window_days) = req.training_window_days {
        let clamped = training_window_days.max(1);
        retryable_change |= previous.training_window_days != clamped;
        active_model.training_window_days = Set(clamped);
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
    // Feature 2. `None` means "not supplied, leave as-is"; an explicit value
    // replaces it. Tags go through the same normalization as the alerts path,
    // so an edit cannot smuggle in a form the filter will never match.
    // `Some(None)` clears, `Some(Some(_))` sets, `None` leaves alone — so a
    // partial update (e.g. enable/disable) cannot wipe the priority.
    if let Some(priority) = req.priority {
        active_model.priority = Set(priority.map(|p| p.to_i32()));
    }
    if let Some(tags) = req.tags {
        // Typed for the same reason as on create: the API downcasts to 400.
        let normalized =
            config::meta::alerts::tags::normalize_tags(&tags).map_err(anyhow::Error::new)?;
        active_model.tags = Set(if normalized.is_empty() {
            None // an explicit empty list clears the tags
        } else {
            Some(serde_json::json!(normalized))
        });
    }

    // A repaired config must not sit out the inherited backoff before it is retried.
    if retryable_change {
        active_model.retries = Set(0);
    }

    active_model.updated_at = Set(Utc::now().timestamp_micros());

    let updated = active_model.update(db).await?;

    // Evict any cached model for this config — training params may have changed,
    // so the next detection run should load a fresh model from S3.
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::anomaly_detection::cache::invalidate_config(&updated.anomaly_id)
        .await;

    // If the threshold (percentile) changed on a trained config, recompute the model's baked
    // cutoff in place from its persisted training-score distribution — no retrain needed. This
    // runs AFTER invalidate_config so the fresh re-cache inside recompute wins. If the model is
    // legacy (no sidecar) or recompute fails, fall back to forcing a one-time retrain so the
    // change is never silently dropped. Training/detection (and thus the model + sidecar) live
    // only on the scheduler node, so this recompute happens where the model is; other
    // super-cluster regions hold no model and only sync the config row for API reads.
    // Skip while a (re)train is in flight (status == Training): the running trainer already
    // reads `config.threshold` live and will bake the new percentile into the model it is about
    // to produce, so recomputing the outgoing model would be wasted work and the fallback would
    // clobber the in-progress retrain.
    #[cfg(feature = "enterprise")]
    if let Some(threshold) = new_threshold
        && updated.is_trained
        && updated.current_model_version > 0
        && updated.status
            != o2_enterprise::enterprise::anomaly_detection::types::Status::Training.to_i32()
    {
        let recomputed =
            o2_enterprise::enterprise::anomaly_detection::threshold::recompute_threshold(
                org_id,
                &updated.anomaly_id,
                updated.current_model_version,
                threshold as f64,
            )
            .await;
        match recomputed {
            Ok(true) => {
                log::info!(
                    "[anomaly_detection {}] threshold recomputed in place (no retrain)",
                    updated.anomaly_id
                );
            }
            Ok(false) | Err(_) => {
                if let Err(e) = recomputed.as_ref() {
                    log::warn!(
                        "[anomaly_detection {}] threshold recompute failed ({e}); forcing retrain",
                        updated.anomaly_id
                    );
                } else {
                    log::info!(
                        "[anomaly_detection {}] no training-score sidecar; forcing one-time retrain to apply new threshold",
                        updated.anomaly_id
                    );
                }
                if let Err(e) = force_retrain_for_threshold(org_id, &updated.anomaly_id).await {
                    log::warn!(
                        "[anomaly_detection {}] failed to force retrain after threshold change: {e}",
                        updated.anomaly_id
                    );
                }
            }
        }
    }

    // Broadcast config update to all super cluster regions.
    #[cfg(feature = "enterprise")]
    {
        let sc_enabled = o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled;
        let local_mode = config::get_config().common.local_mode;
        if sc_enabled && !local_mode {
            log::debug!(
                "[anomaly_detection {}] ConfigUpdate broadcast check: super_cluster.enabled={sc_enabled} local_mode={local_mode}",
                updated.anomaly_id
            );
            if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::anomaly_config_update(
                updated.clone(),
            )
            .await
            {
                log::warn!(
                    "[anomaly_detection {}] failed to broadcast ConfigUpdate to super cluster: {e}",
                    updated.anomaly_id
                );
            }
        }
    }

    // Push the trigger AFTER the DB save so the scheduler always sees enabled=true
    // when it picks up the newly inserted trigger row.
    if push_trigger_after_save {
        let trigger = crate::db::scheduler::Trigger {
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
        if let Err(e) = crate::db::scheduler::push(trigger).await {
            log::warn!("[anomaly_detection {anomaly_id}] failed to push trigger on enable: {e}");
        }
    }

    // When schedule_interval changes, reset the existing trigger's next_run_at to now
    // so the new cadence takes effect immediately (push() alone would be a no-op on an
    // existing row due to ON CONFLICT DO NOTHING).  Only applicable for enabled configs.
    if reset_trigger_after_save && updated.enabled {
        let now = now_micros();
        match crate::db::scheduler::get(org_id, TriggerModule::AnomalyDetection, anomaly_id).await {
            Ok(mut trigger) => {
                trigger.next_run_at = now;
                if let Err(e) = crate::db::scheduler::update_trigger(trigger, false, "").await {
                    log::warn!(
                        "[anomaly_detection {anomaly_id}] failed to reset trigger on interval change: {e}"
                    );
                }
            }
            Err(_) => {
                // No trigger row — create one (config is enabled, so one should exist).
                let trigger = crate::db::scheduler::Trigger {
                    org: org_id.to_string(),
                    module: TriggerModule::AnomalyDetection,
                    module_key: anomaly_id.to_string(),
                    next_run_at: now,
                    is_realtime: false,
                    is_silenced: false,
                    ..Default::default()
                };
                if let Err(e) = crate::db::scheduler::push(trigger).await {
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
    let db = get_orm_client_rw().await;

    // Verify the config exists before deleting (returns 404 if missing).
    let existing = anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    anomaly_config_table::delete(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Clean up FGA ownership tuple so stale grants don't linger.
    let folder_name = pk_to_name(Some(&existing.folder_id)).await;
    remove_ownership(
        org_id,
        "alerts",
        Authz {
            obj_id: anomaly_id.to_string(),
            parent_type: "alert_folders".to_owned(),
            parent: folder_name,
        },
    )
    .await;

    // Broadcast config deletion to all super cluster regions.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::anomaly_config_delete(
            org_id, anomaly_id,
        )
        .await
    {
        log::warn!(
            "[anomaly_detection {anomaly_id}] failed to broadcast ConfigDelete to super cluster: {e}"
        );
    }

    // Remove the detection trigger from the shared scheduler.
    {
        if let Err(e) =
            crate::db::scheduler::delete(org_id, TriggerModule::AnomalyDetection, anomaly_id).await
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
    let db = get_orm_client_rw().await;

    let src = anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
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

    use infra::table::entity::anomaly_detection_config::Model as ConfigModel;
    let cloned = ConfigModel {
        anomaly_id: new_id.clone(),
        org_id: src.org_id.clone(),
        stream_name: src.stream_name.clone(),
        stream_type: src.stream_type.clone(),
        enabled: src.enabled,
        name: new_name.unwrap_or_else(|| format!("{}_copy", src.name)),
        description: src.description.clone(),
        query_mode: src.query_mode.clone(),
        filters: src.filters.clone(),
        custom_sql: src.custom_sql.clone(),
        detection_function: src.detection_function.clone(),
        histogram_interval: src.histogram_interval.clone(),
        schedule_interval: src.schedule_interval.clone(),
        detection_window_seconds: src.detection_window_seconds,
        training_window_days: src.training_window_days,
        retrain_interval_days: src.retrain_interval_days,
        threshold: src.threshold,
        seasonality: src.seasonality.clone(),
        is_trained: false,
        training_started_at: None,
        training_completed_at: None,
        last_error: None,
        last_processed_timestamp: None,
        current_model_version: 0,
        rcf_num_trees: src.rcf_num_trees,
        rcf_tree_size: src.rcf_tree_size,
        rcf_shingle_size: src.rcf_shingle_size,
        alert_enabled: src.alert_enabled,
        alert_destinations: src.alert_destinations.clone(),
        folder_id: resolved_folder_id,
        owner: src.owner.clone(),
        // Feature 2: a clone inherits the original's triage metadata —
        // copying an alert that is P1/tagged and silently dropping both
        // would hand back something that looks configured but is not.
        priority: src.priority,
        tags: src.tags.clone(),
        status: 0i32,
        retries: 0,
        last_failed_at: None,
        last_alert_fired_at: None,
        last_updated: now_us,
        created_at: now_us,
        updated_at: now_us,
    };

    let result = anomaly_config_table::create(db, cloned)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Set FGA ownership so non-root users can access the config they just cloned.
    let folder_name = pk_to_name(Some(&result.folder_id)).await;
    set_ownership(
        org_id,
        "alerts",
        Authz {
            obj_id: result.anomaly_id.clone(),
            parent_type: "alert_folders".to_owned(),
            parent: folder_name,
        },
    )
    .await;

    // Broadcast cloned config to all super cluster regions for API-read consistency.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::anomaly_config_create(result.clone())
                .await
    {
        log::warn!(
            "[anomaly_detection {}] failed to broadcast ConfigCreate (clone) to super cluster: {e}",
            result.anomaly_id
        );
    }

    // Register detection trigger for the new config
    {
        let trigger = crate::db::scheduler::Trigger {
            org: org_id.to_string(),
            module: TriggerModule::AnomalyDetection,
            module_key: new_id.clone(),
            next_run_at: now_micros(),
            is_realtime: false,
            is_silenced: false,
            ..Default::default()
        };
        if let Err(e) = crate::db::scheduler::push(trigger).await {
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

/// Force a one-time retrain so a threshold change takes effect on a config whose model cannot
/// be recomputed in place (legacy model with no training-score sidecar, or a recompute error).
///
/// Marks the config `Waiting` + `is_trained = false` — either condition makes the enterprise
/// training scheduler pick it up on its next tick — and nudges the scheduler so it fires
/// promptly. After that first retrain the training-score sidecar is persisted and all future
/// threshold changes are recomputed in place with no retrain.
#[cfg(feature = "enterprise")]
async fn force_retrain_for_threshold(org_id: &str, anomaly_id: &str) -> Result<()> {
    let db = get_orm_client_rw().await;

    let config = anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    // Don't clobber an in-flight (re)train: a training run already bakes the latest
    // `config.threshold`, so the new percentile will land in the model it produces. Resetting
    // status/is_trained here would interrupt it for no benefit.
    if config.status
        == o2_enterprise::enterprise::anomaly_detection::types::Status::Training.to_i32()
    {
        log::info!(
            "[anomaly_detection {anomaly_id}] retrain already in progress; new threshold will be applied by it"
        );
        return Ok(());
    }

    let mut active = config.into_active_model();
    // Status 0 = Waiting; is_trained = false — both route the config into the retrain queue.
    active.status = Set(0i32);
    active.is_trained = Set(false);
    active.updated_at = Set(Utc::now().timestamp_micros());
    active.update(db).await?;

    // Nudge the training scheduler so the retrain fires promptly rather than on its next
    // periodic sweep.
    o2_enterprise::enterprise::anomaly_detection::scheduler::trigger_training(anomaly_id).await?;

    Ok(())
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
    let db = get_orm_client_rw().await;

    let config = anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

    let mut active = config.into_active_model();
    // Status 0 = Waiting — back to the queue so the user can re-trigger training.
    active.status = Set(0i32);
    // The scheduler's queued fast-path needs retries == 0, so without this it never re-queues.
    active.retries = Set(0);
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
    let db = get_orm_client_ro().await;
    anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
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
    let db = get_orm_client_ro().await;

    // Fetch config
    let config = anomaly_config_table::get_by_id(db, org_id, anomaly_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
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
        if dispatch_allowed(result.anomaly_count, config.alert_enabled) {
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
    let db = get_orm_client_ro().await;

    let configs = match anomaly_config_table::list_all_enabled(db).await {
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

        match crate::db::scheduler::get(org, TriggerModule::AnomalyDetection, key).await {
            Ok(_) => {
                // Trigger exists — OSS scheduler will fire it when next_run_at passes.
                // Processing→Waiting recovery is handled by watch_timeout().
            }
            Err(_) => {
                // Row missing — create a fresh trigger due immediately.
                log::info!("[anomaly_detection] Re-creating missing trigger for {key}");
                let trigger = crate::db::scheduler::Trigger {
                    org: org.clone(),
                    module: TriggerModule::AnomalyDetection,
                    module_key: key.clone(),
                    next_run_at: now_micros(),
                    is_realtime: false,
                    is_silenced: false,
                    ..Default::default()
                };
                if let Err(e) = crate::db::scheduler::push(trigger).await {
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

    // Delegated so create and update cannot drift to two differently-worded rules.
    validate_interval_pair(&req.schedule_interval, &req.histogram_interval)
}

/// Marks a rejected request with the prefix the API layer matches to answer 400, not 500.
fn validation_error(e: anyhow::Error) -> anyhow::Error {
    anyhow::anyhow!("validation error: {e}")
}

/// P0.6 TDD stub: only `enabled` gates training, never `alert_enabled` or `status`.
#[allow(dead_code)]
fn ensure_trainable(_config: &infra::table::entity::anomaly_detection_config::Model) -> Result<()> {
    unimplemented!("P0.6: manual-training enabled guard not implemented yet")
}

/// The one place `alert_enabled` is allowed to decide anything: dispatch, never training.
fn dispatch_allowed(anomaly_count: i32, alert_enabled: bool) -> bool {
    anomaly_count > 0 && alert_enabled
}

/// Create-time training gate: the config's own `enabled`, not just the global kill-switch.
fn initial_training_allowed(enabled: bool, globally_disabled: bool) -> bool {
    enabled && !globally_disabled
}

/// The pure interval rule create and update share, so the two cannot drift apart.
fn validate_interval_pair(schedule_interval: &str, histogram_interval: &str) -> Result<()> {
    let schedule_secs = parse_interval(schedule_interval)?;
    let histogram_secs = parse_interval(histogram_interval)?;

    // Must precede the `%` below, which panics on a zero divisor.
    if schedule_secs <= 0 || histogram_secs <= 0 {
        anyhow::bail!(
            "schedule_interval ({}) and histogram_interval ({}) must both be positive",
            schedule_interval,
            histogram_interval
        );
    }

    // A short schedule scores a partial bucket against a full-bucket baseline, forever.
    if schedule_secs < histogram_secs {
        anyhow::bail!(
            "schedule_interval ({}) must not be shorter than histogram_interval ({}): each run \
             would score a partial bucket against a full-bucket baseline",
            schedule_interval,
            histogram_interval
        );
    }
    if schedule_secs % histogram_secs != 0 {
        anyhow::bail!(
            "schedule_interval ({}) must be a whole multiple of histogram_interval ({}): \
             otherwise runs straddle bucket boundaries and rescore partial data",
            schedule_interval,
            histogram_interval
        );
    }
    Ok(())
}

/// The pair a partial update lands on: a submitted field wins, an absent one keeps the row's.
fn merged_interval_pair(
    req: &UpdateAnomalyConfigRequest,
    existing: &infra::table::entity::anomaly_detection_config::Model,
) -> (String, String) {
    (
        req.schedule_interval
            .clone()
            .unwrap_or_else(|| existing.schedule_interval.clone()),
        req.histogram_interval
            .clone()
            .unwrap_or_else(|| existing.histogram_interval.clone()),
    )
}

/// Validates the merged pair only when it differs from the persisted one, in parsed seconds:
/// the full-body PUT resends unchanged intervals, and rejecting those would strand the rows
/// already broken on disk.
fn validated_intervals(
    req: &UpdateAnomalyConfigRequest,
    existing: &infra::table::entity::anomaly_detection_config::Model,
) -> Result<()> {
    let (schedule, histogram) = merged_interval_pair(req, existing);
    // An unparseable value never matches, so it reaches the rule instead of being skipped.
    if let (Ok(schedule_secs), Ok(histogram_secs), Ok(stored_schedule), Ok(stored_histogram)) = (
        parse_interval(&schedule),
        parse_interval(&histogram),
        parse_interval(&existing.schedule_interval),
        parse_interval(&existing.histogram_interval),
    ) && (schedule_secs, histogram_secs) == (stored_schedule, stored_histogram)
    {
        return Ok(());
    }
    validate_interval_pair(&schedule, &histogram)
}

/// Collapses the `filters` shapes that mean "no filters" to `[]`; rejects any other non-array.
fn normalize_request_filters(
    filters: Option<serde_json::Value>,
) -> Result<Option<serde_json::Value>> {
    let Some(value) = filters else {
        return Ok(None);
    };
    match value {
        serde_json::Value::Array(_) => Ok(Some(value)),
        serde_json::Value::Null => Ok(Some(serde_json::json!([]))),
        serde_json::Value::Object(ref map) if map.is_empty() => Ok(Some(serde_json::json!([]))),
        // The value itself is never echoed back: it is caller-controlled JSON.
        other => anyhow::bail!(
            "filters must be a JSON array, got a JSON {}",
            json_type(&other)
        ),
    }
}

/// Names a JSON value's type for an error message, without disclosing the value.
fn json_type(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
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
    if let Some(stripped) = interval.strip_suffix('h') {
        let hours: i64 = stripped.parse()?;
        // A positive wrap lands on a plausible schedule that clears every downstream guard.
        hours
            .checked_mul(3600)
            .ok_or_else(|| anyhow::anyhow!("interval '{interval}' is out of range"))
    } else if let Some(stripped) = interval.strip_suffix('m') {
        let minutes: i64 = stripped.parse()?;
        minutes
            .checked_mul(60)
            .ok_or_else(|| anyhow::anyhow!("interval '{interval}' is out of range"))
    } else {
        anyhow::bail!("Invalid interval format. Use '1h' or '30m'");
    }
}

#[cfg(feature = "enterprise")]
pub fn config_to_training_config(
    config: &infra::table::entity::anomaly_detection_config::Model,
) -> Result<o2_enterprise::enterprise::anomaly_detection::types::AnomalyConfig> {
    use o2_enterprise::enterprise::anomaly_detection::types::AnomalyConfig;

    let filters = o2_enterprise::enterprise::anomaly_detection::types::parse_filters(
        config.filters.as_ref(),
    )?;

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
        agent_options: None,
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
/// (including scheduler nodes, which are not ingesters and cannot call
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

    // SSRF protection: validate the URL (incl. DNS) before sending and build the
    // client through `build_safe_client` so redirects + connect-time resolution
    // are re-validated.
    if let Err(e) =
        common::utils::ssrf_guard::SsrfGuard::validate_url_with_config_async(&endpoint.url).await
    {
        return Err(anyhow::anyhow!("Webhook URL blocked by SSRF guard: {e}"));
    }
    let builder = if endpoint.skip_tls_verify {
        reqwest::Client::builder().danger_accept_invalid_certs(true)
    } else {
        reqwest::Client::builder()
    };
    let client = common::utils::ssrf_guard::build_safe_client(builder)?;

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

#[cfg(test)]
mod tests {
    // ── Feature 2: priority & tags on anomaly configs ───────────────────────

    /// Tags round-trip through the create request, and an absent `tags` key
    /// yields an empty list rather than failing — every pre-Feature-2 client
    /// omits it.
    #[test]
    fn test_create_request_tags_default_to_empty() {
        let without: CreateAnomalyConfigRequest = serde_json::from_str(
            r#"{"name":"a","stream_name":"s","stream_type":"logs","query_mode":"filters",
                "detection_function":"count","histogram_interval":"5m",
                "schedule_interval":"15m","detection_window_seconds":3600}"#,
        )
        .unwrap();
        assert!(without.tags.is_empty());
        assert_eq!(without.priority, None);
    }

    /// The create path must store the NORMALIZED form, so a tag means the same
    /// thing on an anomaly config as on an alert and one filter matches both.
    #[test]
    fn test_anomaly_tags_normalize_exactly_like_alert_tags() {
        let raw = vec![
            "  PROD  ".to_string(),
            "Service:Checkout".to_string(),
            "prod".to_string(),
            "".to_string(),
        ];
        let normalized = config::meta::alerts::tags::normalize_tags(&raw).unwrap();
        assert_eq!(normalized, vec!["prod", "service:checkout"]);
    }

    /// Invalid tags are rejected on anomaly configs too, naming the offender —
    /// the same contract the alerts path has.
    #[test]
    fn test_anomaly_invalid_tag_is_rejected_and_named() {
        let err = config::meta::alerts::tags::normalize_tags(&["1bad".to_string()]).unwrap_err();
        assert!(err.to_string().contains("1bad"), "got: {err}");
    }

    /// Priority ids must be the SAME as the alerts table's, since one column
    /// mapping and one enum serve both. If these ever diverge, a P2 anomaly
    /// and a P2 alert would store different integers.
    #[test]
    fn test_anomaly_priority_ids_match_the_alert_scale() {
        use config::meta::alerts::priority::AlertPriority;
        for (p, id) in [
            (AlertPriority::P1, 1),
            (AlertPriority::P2, 2),
            (AlertPriority::P3, 3),
            (AlertPriority::P4, 4),
            (AlertPriority::P5, 5),
        ] {
            assert_eq!(p.to_i32(), id);
        }
    }

    /// PROBE: does serde distinguish "absent" from "explicit null" for the
    /// double option? Written first because the answer decides whether the
    /// clear-via-null path works, or whether only the Rust-constructed
    /// `Some(None)` from the v2 handler does.
    #[test]
    fn test_update_request_priority_absent_vs_null() {
        let absent: UpdateAnomalyConfigRequest = serde_json::from_str("{}").unwrap();
        let null: UpdateAnomalyConfigRequest =
            serde_json::from_str(r#"{"priority": null}"#).unwrap();
        let set: UpdateAnomalyConfigRequest = serde_json::from_str(r#"{"priority": 3}"#).unwrap();
        assert_eq!(absent.priority, None, "absent must leave the value alone");
        assert_eq!(
            null.priority,
            Some(None),
            "explicit null must mean CLEAR, distinct from absent"
        );
        assert_eq!(
            set.priority,
            Some(Some(config::meta::alerts::priority::AlertPriority::P3))
        );
    }

    use super::*;
    // ── combine_detection_fn ────────────────────────────────────────────────

    #[test]
    fn test_combine_already_has_parens() {
        assert_eq!(combine_detection_fn("avg(cpu)", None), "avg(cpu)");
    }

    #[test]
    fn test_combine_count_returns_star() {
        assert_eq!(combine_detection_fn("count", None), "count(*)");
        assert_eq!(combine_detection_fn("count", Some("ignored")), "count(*)");
    }

    #[test]
    fn test_combine_other_with_field() {
        assert_eq!(combine_detection_fn("avg", Some("cpu")), "avg(cpu)");
        assert_eq!(combine_detection_fn("sum", Some("bytes")), "sum(bytes)");
    }

    #[test]
    fn test_combine_other_no_field() {
        assert_eq!(combine_detection_fn("avg", None), "avg");
    }

    #[test]
    fn test_combine_other_empty_field() {
        assert_eq!(combine_detection_fn("avg", Some("")), "avg");
    }

    // ── parse_interval ──────────────────────────────────────────────────────

    #[test]
    fn test_parse_interval_hours() {
        assert_eq!(parse_interval("1h").unwrap(), 3600);
        assert_eq!(parse_interval("2h").unwrap(), 7200);
        assert_eq!(parse_interval("0h").unwrap(), 0);
    }

    #[test]
    fn test_parse_interval_minutes() {
        assert_eq!(parse_interval("30m").unwrap(), 1800);
        assert_eq!(parse_interval("5m").unwrap(), 300);
    }

    #[test]
    fn test_parse_interval_invalid_suffix() {
        assert!(parse_interval("10s").is_err());
        assert!(parse_interval("10d").is_err());
        assert!(parse_interval("abc").is_err());
    }

    #[test]
    fn test_parse_interval_invalid_number() {
        assert!(parse_interval("xh").is_err());
        assert!(parse_interval("xm").is_err());
    }

    // ── validate_config_request ─────────────────────────────────────────────

    fn make_valid_filters_req() -> CreateAnomalyConfigRequest {
        CreateAnomalyConfigRequest {
            name: "test".to_string(),
            description: None,
            stream_name: "logs".to_string(),
            stream_type: "logs".to_string(),
            query_mode: "filters".to_string(),
            filters: Some(serde_json::json!([])),
            custom_sql: None,
            detection_function: "count".to_string(),
            detection_function_field: None,
            histogram_interval: "5m".to_string(),
            schedule_interval: "1h".to_string(),
            detection_window_seconds: 3600,
            training_window_days: Some(7),
            retrain_interval_days: Some(7),
            percentile: Some(97.0),
            rcf_num_trees: None,
            rcf_tree_size: None,
            rcf_shingle_size: None,
            alert_enabled: None,
            alert_destinations: vec![],
            enabled: None,
            folder_id: None,
            owner: None,
            priority: None,
            tags: vec![],
        }
    }

    #[test]
    fn test_validate_valid_filters_mode() {
        assert!(validate_config_request(&make_valid_filters_req()).is_ok());
    }

    /// The HTTP layer selects 400 by matching this marker, so both must move together.
    #[test]
    fn test_validation_error_is_recognisable_to_the_http_layer() {
        let err = normalize_request_filters(Some(serde_json::json!({"action": "login"})))
            .map_err(validation_error)
            .unwrap_err()
            .to_string();
        assert!(err.contains("validation error"), "unexpected error: {err}");
        assert!(err.contains("must be a JSON array"), "detail lost: {err}");
    }

    /// A row already holding `{}` would otherwise 400 the moment anything re-saved it.
    #[test]
    fn test_normalize_request_filters_collapses_the_no_filter_shapes() {
        let empty = serde_json::json!([]);
        assert_eq!(
            normalize_request_filters(Some(serde_json::json!({}))).unwrap(),
            Some(empty.clone())
        );
        assert_eq!(
            normalize_request_filters(Some(serde_json::Value::Null)).unwrap(),
            Some(empty)
        );
        assert_eq!(normalize_request_filters(None).unwrap(), None);
    }

    #[test]
    fn test_normalize_request_filters_passes_arrays_through_untouched() {
        for value in [
            serde_json::json!([]),
            serde_json::json!([{"field": "action", "operator": "=", "value": "login"}]),
        ] {
            assert_eq!(
                normalize_request_filters(Some(value.clone())).unwrap(),
                Some(value)
            );
        }
    }

    /// Refused rather than dropped, and the caller-controlled value is never echoed back.
    #[test]
    fn test_normalize_request_filters_rejects_any_other_shape() {
        let err = normalize_request_filters(Some(serde_json::json!({"action": "login"})))
            .unwrap_err()
            .to_string();
        assert!(err.contains("a JSON object"), "unexpected error: {err}");
        assert!(!err.contains("login"), "error echoed the value: {err}");

        assert!(normalize_request_filters(Some(serde_json::json!("a = b"))).is_err());
        assert!(normalize_request_filters(Some(serde_json::json!(7))).is_err());
        assert!(normalize_request_filters(Some(serde_json::json!(true))).is_err());
    }

    #[test]
    fn test_json_type_names_every_variant() {
        assert_eq!(json_type(&serde_json::Value::Null), "null");
        assert_eq!(json_type(&serde_json::json!(true)), "boolean");
        assert_eq!(json_type(&serde_json::json!(1)), "number");
        assert_eq!(json_type(&serde_json::json!("s")), "string");
        assert_eq!(json_type(&serde_json::json!([])), "array");
        assert_eq!(json_type(&serde_json::json!({})), "object");
    }

    #[test]
    fn test_validate_valid_custom_sql_mode() {
        let mut req = make_valid_filters_req();
        req.query_mode = "custom_sql".to_string();
        req.filters = None;
        req.custom_sql = Some("SELECT count(*) FROM logs".to_string());
        assert!(validate_config_request(&req).is_ok());
    }

    #[test]
    fn test_validate_invalid_query_mode() {
        let mut req = make_valid_filters_req();
        req.query_mode = "invalid".to_string();
        assert!(validate_config_request(&req).is_err());
    }

    #[test]
    fn test_validate_filters_mode_missing_filters() {
        let mut req = make_valid_filters_req();
        req.filters = None;
        assert!(validate_config_request(&req).is_err());
    }

    #[test]
    fn test_validate_custom_sql_mode_missing_sql() {
        let mut req = make_valid_filters_req();
        req.query_mode = "custom_sql".to_string();
        req.filters = None;
        req.custom_sql = None;
        assert!(validate_config_request(&req).is_err());
    }

    #[test]
    fn test_validate_invalid_histogram_interval() {
        let mut req = make_valid_filters_req();
        req.histogram_interval = "10d".to_string();
        assert!(validate_config_request(&req).is_err());
    }

    #[test]
    fn test_validate_invalid_schedule_interval() {
        let mut req = make_valid_filters_req();
        req.schedule_interval = "bad".to_string();
        assert!(validate_config_request(&req).is_err());
    }

    // ── model_to_api_json ───────────────────────────────────────────────────

    #[test]
    fn test_model_to_api_json_replaces_integer_status() {
        let val = serde_json::json!({"name": "test", "status": 0i64});
        let result = model_to_api_json(val);
        assert!(result["status"].is_string());
    }

    #[test]
    fn test_model_to_api_json_no_status_field_unchanged() {
        let val = serde_json::json!({"name": "test"});
        let result = model_to_api_json(val);
        assert!(result.get("status").is_none());
        assert_eq!(result["name"], "test");
    }

    #[test]
    fn test_model_to_api_json_non_object_unchanged() {
        let val = serde_json::json!("just a string");
        let result = model_to_api_json(val.clone());
        assert_eq!(result, val);
    }

    // ── extract_timestamp_from_hit ──────────────────────────────────────────

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_timestamp_numeric_underscore_field() {
        let hit = serde_json::json!({"_timestamp": 1_700_000_000_000_000i64});
        assert_eq!(
            extract_timestamp_from_hit(&hit).unwrap(),
            1_700_000_000_000_000i64
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_timestamp_rfc3339_string() {
        let hit = serde_json::json!({"timestamp": "2026-02-20T13:15:00Z"});
        let ts = extract_timestamp_from_hit(&hit).unwrap();
        assert!(ts > 0);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_timestamp_naive_datetime_string() {
        let hit = serde_json::json!({"time_bucket": "2026-02-20T13:15:00"});
        let ts = extract_timestamp_from_hit(&hit).unwrap();
        assert!(ts > 0);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_timestamp_fractional_seconds() {
        let hit = serde_json::json!({"time": "2026-02-20T13:15:00.000"});
        let ts = extract_timestamp_from_hit(&hit).unwrap();
        assert!(ts > 0);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_timestamp_no_field_returns_error() {
        let hit = serde_json::json!({"value": 42.0});
        assert!(extract_timestamp_from_hit(&hit).is_err());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_timestamp_non_numeric_non_string_value() {
        let hit = serde_json::json!({"_timestamp": true});
        assert!(extract_timestamp_from_hit(&hit).is_err());
    }

    // ── extract_value_from_hit ──────────────────────────────────────────────

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_value_from_hit_value_field_f64() {
        let hit = serde_json::json!({"value": 3.25});
        assert!((extract_value_from_hit(&hit).unwrap() - 3.25).abs() < f64::EPSILON);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_value_from_hit_count_field_integer() {
        let hit = serde_json::json!({"count": 42});
        assert!((extract_value_from_hit(&hit).unwrap() - 42.0).abs() < f64::EPSILON);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_value_from_hit_underscore_count_field() {
        let hit = serde_json::json!({"_count": 7});
        assert!((extract_value_from_hit(&hit).unwrap() - 7.0).abs() < f64::EPSILON);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_value_from_hit_metric_field() {
        let hit = serde_json::json!({"metric": 100.5});
        assert!((extract_value_from_hit(&hit).unwrap() - 100.5).abs() < f64::EPSILON);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_value_from_hit_result_field() {
        let hit = serde_json::json!({"result": 0.0});
        assert!((extract_value_from_hit(&hit).unwrap() - 0.0).abs() < f64::EPSILON);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_value_from_hit_no_value_field_returns_error() {
        let hit = serde_json::json!({"other_field": 99.0});
        assert!(extract_value_from_hit(&hit).is_err());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_value_from_hit_non_numeric_value_field_returns_error() {
        let hit = serde_json::json!({"value": "not_a_number"});
        assert!(extract_value_from_hit(&hit).is_err());
    }

    /// The key names here are a cross-crate contract:
    /// `anomaly_config_to_list_item` reads them by these exact strings, and a
    /// rename on either side silently blanks the list's Last Outcome column.
    mod merge_trigger_run_state_tests {
        use config::meta::triggers::ScheduledTriggerData;

        use super::*;

        #[test]
        fn emits_the_keys_the_api_layer_reads() {
            let td = ScheduledTriggerData {
                last_satisfied_at: Some(900),
                last_outcome: Some("firing".to_string()),
                last_outcome_at: Some(1_000),
                ..Default::default()
            };

            let mut obj = serde_json::Map::new();
            merge_trigger_run_state(&mut obj, &td.to_json_string());

            assert_eq!(obj["last_anomaly_detected_at"], serde_json::json!(900));
            assert_eq!(obj["last_outcome"], serde_json::json!("firing"));
            assert_eq!(obj["last_outcome_at"], serde_json::json!(1_000));
        }

        /// A config that has not run since the upgrade has no recorded outcome;
        /// absent keys are what make the list render an em dash.
        #[test]
        fn omits_what_was_never_recorded() {
            let mut obj = serde_json::Map::new();
            merge_trigger_run_state(&mut obj, "{}");

            assert!(!obj.contains_key("last_outcome"));
            assert!(!obj.contains_key("last_outcome_at"));
        }

        #[test]
        fn ignores_an_unparseable_blob() {
            let mut obj = serde_json::Map::new();
            merge_trigger_run_state(&mut obj, "{not json");

            assert!(obj.is_empty());
        }
    }

    /// Both directions of interval mismatch are live production faults, so both
    /// must be rejected at creation rather than producing silently wrong scores.
    #[test]
    fn test_validate_rejects_schedule_shorter_than_histogram() {
        // default/ingester_health: 1m schedule, 5m buckets -> scores 0.2 of a bucket.
        let mut req = make_valid_filters_req();
        req.schedule_interval = "1m".to_string();
        req.histogram_interval = "5m".to_string();
        let err = validate_config_request(&req).unwrap_err().to_string();
        assert!(err.contains("must not be shorter"), "got: {err}");
    }

    #[test]
    fn test_validate_rejects_schedule_not_a_multiple_of_histogram() {
        // default/ingester_offline: 5m schedule, 1m buckets is a clean multiple and
        // allowed; 7m against 5m straddles boundaries and is not.
        let mut req = make_valid_filters_req();
        req.schedule_interval = "7m".to_string();
        req.histogram_interval = "5m".to_string();
        let err = validate_config_request(&req).unwrap_err().to_string();
        assert!(err.contains("whole multiple"), "got: {err}");
    }

    #[test]
    fn test_validate_accepts_matching_and_multiple_intervals() {
        for (sched, hist) in [("5m", "5m"), ("1h", "5m"), ("10m", "5m"), ("5m", "1m")] {
            let mut req = make_valid_filters_req();
            req.schedule_interval = sched.to_string();
            req.histogram_interval = hist.to_string();
            assert!(
                validate_config_request(&req).is_ok(),
                "{sched} against {hist} must be accepted"
            );
        }
    }

    // ── P0.4: the interval rule as a shared pure seam ───────────────────────

    mod interval_pair_rule {
        use super::*;

        #[test]
        fn accepts_equal_intervals() {
            assert!(validate_interval_pair("5m", "5m").is_ok());
            assert!(validate_interval_pair("1h", "1h").is_ok());
        }

        #[test]
        fn accepts_whole_multiples() {
            assert!(validate_interval_pair("10m", "5m").is_ok(), "2x");
            assert!(validate_interval_pair("1h", "5m").is_ok(), "12x");
            assert!(validate_interval_pair("5m", "1m").is_ok(), "5x");
        }

        /// default/ingester_health, live: 1m schedule against 5m buckets scores a fifth of
        /// a bucket against a full-bucket baseline -- a permanent apparent 80% drop.
        #[test]
        fn rejects_prod_shape_ingester_health() {
            let err = validate_interval_pair("1m", "5m").unwrap_err().to_string();
            assert!(err.contains("must not be shorter"), "got: {err}");
        }

        /// default/ingester_offline, live: 5m against 1m is a clean multiple and must stay
        /// allowed, so the case that pins its class is the non-multiple 7m/5m.
        #[test]
        fn rejects_non_multiples() {
            let err = validate_interval_pair("7m", "5m").unwrap_err().to_string();
            assert!(err.contains("whole multiple"), "got: {err}");
            assert!(validate_interval_pair("7m", "2m").is_err());
        }

        /// Pinned to the parse contract's own wording: an impl that swallowed the parse
        /// error and substituted its own text would otherwise satisfy a bare `is_err()`.
        #[test]
        fn rejects_unparseable_intervals_rather_than_ignoring_them() {
            for bad in ["bad", "10d", "", "5"] {
                let err = validate_interval_pair(bad, "5m").unwrap_err().to_string();
                assert!(err.contains("Invalid interval format"), "{bad}: {err}");
            }
            let err = validate_interval_pair("5m", "10d").unwrap_err().to_string();
            assert!(err.contains("Invalid interval format"), "got: {err}");
        }

        /// `%` by a zero divisor panics, so a zero histogram must be refused BEFORE the
        /// multiple check -- `0m` clears the `schedule < histogram` guard and reaches it.
        #[test]
        fn rejects_zero_histogram_without_panicking() {
            assert!(validate_interval_pair("5m", "0m").is_err());
            assert!(validate_interval_pair("0h", "0m").is_err());
        }

        /// `"-5m"` parses to -300 via i64, so a signed interval reaches the rule and would
        /// otherwise pass `schedule >= histogram` against a negative bucket width.
        #[test]
        fn rejects_negative_intervals() {
            assert!(validate_interval_pair("-5m", "5m").is_err());
            assert!(validate_interval_pair("5m", "-5m").is_err());
        }

        /// `hours * 3600` is unguarded. A NEGATIVE wrap is already caught by the positivity
        /// guard, so the real threat is a POSITIVE wrap: 384307168202282400h lands on exactly
        /// 268800s (74h), which clears `schedule >= histogram` AND divides 300 evenly, so a
        /// wrapping multiply accepts it as a plausible schedule. Only `checked_mul` rejects it.
        #[test]
        fn rejects_intervals_that_overflow_the_seconds_conversion() {
            // Pins the debug-build panic; in release this one wraps negative.
            assert!(validate_interval_pair("9223372036854775807h", "5m").is_err());

            for (schedule, histogram) in
                [("384307168202282400h", "5m"), ("5m", "384307168202282400h")]
            {
                let err = validate_interval_pair(schedule, histogram)
                    .unwrap_err()
                    .to_string();
                assert!(
                    err.contains("out of range"),
                    "{schedule}/{histogram} must be refused as overflow, not merely as \
                     non-positive -- the two are indistinguishable otherwise: {err}"
                );
            }
        }
    }

    // ── P0.4: partial updates validate the MERGED row, not just the payload ──

    mod update_interval_validation {
        use super::*;

        /// The persisted side of a partial update: 1h schedule against 5m buckets, valid.
        fn stored_config() -> infra::table::entity::anomaly_detection_config::Model {
            infra::table::entity::anomaly_detection_config::Model {
                anomaly_id: "a1".to_string(),
                org_id: "default".to_string(),
                stream_name: "logs".to_string(),
                stream_type: "logs".to_string(),
                enabled: true,
                name: "test".to_string(),
                description: None,
                query_mode: "filters".to_string(),
                filters: Some(serde_json::json!([])),
                custom_sql: None,
                detection_function: "count(*)".to_string(),
                histogram_interval: "5m".to_string(),
                schedule_interval: "1h".to_string(),
                detection_window_seconds: 3600,
                training_window_days: 7,
                retrain_interval_days: 7,
                threshold: 97,
                seasonality: "none".to_string(),
                is_trained: false,
                training_started_at: None,
                training_completed_at: None,
                last_error: None,
                last_processed_timestamp: None,
                current_model_version: 0,
                rcf_num_trees: 50,
                rcf_tree_size: 256,
                rcf_shingle_size: 8,
                alert_enabled: false,
                alert_destinations: None,
                folder_id: "f1".to_string(),
                owner: None,
                priority: None,
                tags: None,
                status: 0,
                retries: 0,
                last_failed_at: None,
                last_alert_fired_at: None,
                last_updated: 0,
                created_at: 1000,
                updated_at: 1000,
            }
        }

        /// The ingester_health shape, as already persisted: a row that create would now
        /// refuse but that exists in production and must stay administrable.
        fn broken_legacy_config() -> infra::table::entity::anomaly_detection_config::Model {
            let mut stored = stored_config();
            stored.schedule_interval = "1m".to_string();
            stored.histogram_interval = "5m".to_string();
            stored
        }

        /// The other live broken row, ingester_offline: 5m schedule over 1m buckets is a
        /// clean multiple, so what is wrong with it is the skipped buckets, not the ratio.
        fn ingester_offline_config() -> infra::table::entity::anomaly_detection_config::Model {
            let mut stored = stored_config();
            stored.schedule_interval = "5m".to_string();
            stored.histogram_interval = "1m".to_string();
            stored
        }

        /// A full-body PUT replay: every interval resent at exactly its persisted value.
        fn full_body_replay(
            existing: &infra::table::entity::anomaly_detection_config::Model,
        ) -> UpdateAnomalyConfigRequest {
            UpdateAnomalyConfigRequest {
                name: Some("renamed in the UI".to_string()),
                schedule_interval: Some(existing.schedule_interval.clone()),
                histogram_interval: Some(existing.histogram_interval.clone()),
                ..Default::default()
            }
        }

        /// Targets the same fn `update_config` calls, so tests cannot drift from the product.
        fn update_result(req: UpdateAnomalyConfigRequest) -> Result<()> {
            validated_intervals(&req, &stored_config()).map_err(validation_error)
        }

        /// Structural proof that create DELEGATES rather than keeping a copy: a `0m`
        /// histogram panics on `% 0` in the old inline rule, so only a create path routed
        /// through the shared guard can return Err here. Copy-paste cannot satisfy this.
        #[test]
        fn create_delegates_so_the_zero_histogram_panic_is_gone() {
            let mut req = make_valid_filters_req();
            req.schedule_interval = "5m".to_string();
            req.histogram_interval = "0m".to_string();
            assert!(validate_config_request(&req).is_err());
        }

        /// Update must reuse the create rule verbatim, otherwise update could drift to a
        /// second, differently-worded rule saying the same thing.
        #[test]
        fn shares_the_create_paths_wording_for_the_same_pair() {
            for (schedule, histogram) in [("1m", "5m"), ("7m", "5m")] {
                let mut req = make_valid_filters_req();
                req.schedule_interval = schedule.to_string();
                req.histogram_interval = histogram.to_string();
                let from_create = validate_config_request(&req).unwrap_err().to_string();
                let from_rule = validate_interval_pair(schedule, histogram)
                    .unwrap_err()
                    .to_string();
                assert_eq!(from_create, from_rule, "{schedule}/{histogram} diverged");
            }
        }

        #[test]
        fn absent_intervals_fall_back_to_the_persisted_values() {
            let stored = stored_config();
            let (schedule, histogram) =
                merged_interval_pair(&UpdateAnomalyConfigRequest::default(), &stored);
            assert_eq!(schedule, "1h");
            assert_eq!(histogram, "5m");
        }

        #[test]
        fn a_submitted_interval_overrides_the_persisted_one() {
            let stored = stored_config();
            let req = UpdateAnomalyConfigRequest {
                schedule_interval: Some("10m".to_string()),
                ..Default::default()
            };
            let (schedule, histogram) = merged_interval_pair(&req, &stored);
            assert_eq!(schedule, "10m");
            assert_eq!(histogram, "5m", "unchanged field keeps the stored value");
        }

        /// Mutation shape 1: schedule alone, conflicting with the UNCHANGED stored histogram.
        /// Validating only the submitted field would miss this entirely.
        #[test]
        fn rejects_changing_schedule_alone_into_a_conflict() {
            let req = UpdateAnomalyConfigRequest {
                schedule_interval: Some("1m".to_string()),
                ..Default::default()
            };
            let err = update_result(req).unwrap_err().to_string();
            assert!(err.contains("validation error"), "got: {err}");
            assert!(err.contains("must not be shorter"), "got: {err}");
        }

        /// Mutation shape 2: histogram alone, conflicting with the UNCHANGED stored schedule.
        #[test]
        fn rejects_changing_histogram_alone_into_a_conflict() {
            let req = UpdateAnomalyConfigRequest {
                histogram_interval: Some("7m".to_string()),
                ..Default::default()
            };
            let err = update_result(req).unwrap_err().to_string();
            assert!(err.contains("validation error"), "got: {err}");
            assert!(err.contains("whole multiple"), "got: {err}");
        }

        /// Mutation shape 3: both fields at once, recreating the live ingester_health row.
        #[test]
        fn rejects_changing_both_into_the_ingester_health_shape() {
            let req = UpdateAnomalyConfigRequest {
                schedule_interval: Some("1m".to_string()),
                histogram_interval: Some("5m".to_string()),
                ..Default::default()
            };
            let err = update_result(req).unwrap_err().to_string();
            assert!(err.contains("validation error"), "got: {err}");
            assert!(err.contains("must not be shorter"), "got: {err}");
        }

        /// A histogram larger than the stored 1h schedule: valid read on its own, broken
        /// against the row it lands in. Only merged-state validation catches it.
        #[test]
        fn rejects_a_lone_field_that_only_conflicts_once_merged() {
            let req = UpdateAnomalyConfigRequest {
                histogram_interval: Some("2h".to_string()),
                ..Default::default()
            };
            let err = update_result(req).unwrap_err().to_string();
            assert!(err.contains("must not be shorter"), "got: {err}");
        }

        #[test]
        fn accepts_a_valid_interval_change() {
            for (schedule, histogram) in [
                (Some("10m"), Some("5m")),
                (Some("30m"), None),
                (None, Some("1m")),
            ] {
                let req = UpdateAnomalyConfigRequest {
                    schedule_interval: schedule.map(str::to_string),
                    histogram_interval: histogram.map(str::to_string),
                    ..Default::default()
                };
                assert!(
                    update_result(req).is_ok(),
                    "{schedule:?}/{histogram:?} must be accepted"
                );
            }
        }

        /// Grandfathering case 1 of 4, split so always-validate fails four separate tests
        /// rather than one: a folder move must not re-litigate a row broken on disk.
        #[test]
        fn a_broken_row_can_still_be_moved_between_folders() {
            let req = UpdateAnomalyConfigRequest {
                folder_id: Some("other".to_string()),
                ..Default::default()
            };
            assert!(validated_intervals(&req, &broken_legacy_config()).is_ok());
        }

        /// The case that matters most operationally: ingester_health is Slack-wired at a
        /// ceiling of 1440 alerts/day, and validating here would make it undisableable.
        #[test]
        fn a_broken_row_can_still_be_disabled() {
            let req = UpdateAnomalyConfigRequest {
                enabled: Some(false),
                ..Default::default()
            };
            assert!(validated_intervals(&req, &broken_legacy_config()).is_ok());
        }

        /// Bulk enable reaches `update_config` with no 400 path at all, so a rejection here
        /// surfaces as a 500 on a row the operator never asked to change.
        #[test]
        fn a_broken_row_can_still_be_bulk_enabled() {
            let req = UpdateAnomalyConfigRequest {
                enabled: Some(true),
                ..Default::default()
            };
            assert!(validated_intervals(&req, &broken_legacy_config()).is_ok());
        }

        #[test]
        fn the_other_broken_prod_row_is_equally_administrable() {
            let req = UpdateAnomalyConfigRequest {
                enabled: Some(false),
                ..Default::default()
            };
            assert!(validated_intervals(&req, &ingester_offline_config()).is_ok());
        }

        /// The alerts v2 PUT replays the FULL body, so a rename resends both intervals at
        /// their stored values. Keyed on presence this reads as "touching both" and blocks
        /// the edit through the primary UI path; keyed on change it is correctly a no-op.
        #[test]
        fn a_full_body_replay_of_unchanged_intervals_is_not_a_change() {
            for broken in [broken_legacy_config(), ingester_offline_config()] {
                let req = full_body_replay(&broken);
                assert!(
                    validated_intervals(&req, &broken).is_ok(),
                    "a UI rename must not be rejected by resent-but-identical intervals"
                );
            }
        }

        /// The single-field twin of the replay: resending one interval at its stored value.
        #[test]
        fn resubmitting_one_interval_unchanged_is_not_a_change() {
            let broken = broken_legacy_config();
            let req = UpdateAnomalyConfigRequest {
                schedule_interval: Some(broken.schedule_interval.clone()),
                ..Default::default()
            };
            assert!(validated_intervals(&req, &broken).is_ok());
        }

        /// Compared in parsed seconds, not strings: the UI re-spelling an interval is not an
        /// edit. A string compare would re-validate here and make the broken row uneditable
        /// again -- precisely what grandfathering exists to prevent.
        #[test]
        fn a_respelled_interval_of_equal_length_is_not_a_change() {
            let mut stored = broken_legacy_config();
            stored.schedule_interval = "1h".to_string();
            stored.histogram_interval = "5m".to_string();
            // 1h and 60m are the same duration, so this row is untouched, not repaired.
            let req = UpdateAnomalyConfigRequest {
                schedule_interval: Some("60m".to_string()),
                ..Default::default()
            };
            assert!(validated_intervals(&req, &stored).is_ok());

            let broken = broken_legacy_config();
            let zero_padded = UpdateAnomalyConfigRequest {
                schedule_interval: Some("01m".to_string()),
                ..Default::default()
            };
            assert!(validated_intervals(&zero_padded, &broken).is_ok());
        }

        /// An empty interval must reach the rule and be refused, not be mistaken for
        /// "unchanged" by an implementation that filters blanks before comparing.
        #[test]
        fn an_empty_interval_string_is_refused_not_grandfathered() {
            let req = UpdateAnomalyConfigRequest {
                schedule_interval: Some(String::new()),
                ..Default::default()
            };
            let err = validated_intervals(&req, &broken_legacy_config())
                .unwrap_err()
                .to_string();
            assert!(err.contains("Invalid interval format"), "got: {err}");
        }

        /// Grandfathering does not extend to a genuine edit: changing one interval on a
        /// broken row is validated against the persisted other, so it can only improve.
        #[test]
        fn genuinely_changing_one_interval_on_a_broken_row_is_still_validated() {
            let broken = broken_legacy_config();
            let worse = UpdateAnomalyConfigRequest {
                schedule_interval: Some("2m".to_string()),
                ..Default::default()
            };
            let err = validated_intervals(&worse, &broken)
                .unwrap_err()
                .to_string();
            assert!(err.contains("must not be shorter"), "got: {err}");
        }

        #[test]
        fn repairing_a_broken_row_from_either_side_is_allowed() {
            let broken = broken_legacy_config();
            let by_schedule = UpdateAnomalyConfigRequest {
                schedule_interval: Some("10m".to_string()),
                ..Default::default()
            };
            assert!(validated_intervals(&by_schedule, &broken).is_ok());

            // The symmetric repair: 1m buckets under the stored 1m schedule is 1:1.
            let by_histogram = UpdateAnomalyConfigRequest {
                histogram_interval: Some("1m".to_string()),
                ..Default::default()
            };
            assert!(validated_intervals(&by_histogram, &broken).is_ok());
        }

        /// The boundary of the `<` comparison, reached through a merge rather than the
        /// pure rule: equal intervals are the tightest pair that must still be accepted.
        #[test]
        fn a_merge_landing_on_equal_intervals_is_accepted() {
            let req = UpdateAnomalyConfigRequest {
                schedule_interval: Some("5m".to_string()),
                ..Default::default()
            };
            assert!(validated_intervals(&req, &stored_config()).is_ok());
        }
    }

    // ── P0.6: `enabled` gates training on EVERY entry point, not just the SELECT ──

    mod training_flag_hygiene {
        use super::*;

        /// An enabled, never-trained config: the row every manual entry point starts from.
        fn trainable_config() -> infra::table::entity::anomaly_detection_config::Model {
            infra::table::entity::anomaly_detection_config::Model {
                anomaly_id: "a1".to_string(),
                org_id: "default".to_string(),
                stream_name: "logs".to_string(),
                stream_type: "logs".to_string(),
                enabled: true,
                name: "test".to_string(),
                description: None,
                query_mode: "filters".to_string(),
                filters: Some(serde_json::json!([])),
                custom_sql: None,
                detection_function: "count(*)".to_string(),
                histogram_interval: "5m".to_string(),
                schedule_interval: "1h".to_string(),
                detection_window_seconds: 3600,
                training_window_days: 7,
                retrain_interval_days: 7,
                threshold: 97,
                seasonality: "none".to_string(),
                is_trained: false,
                training_started_at: None,
                training_completed_at: None,
                last_error: None,
                last_processed_timestamp: None,
                current_model_version: 0,
                rcf_num_trees: 50,
                rcf_tree_size: 256,
                rcf_shingle_size: 8,
                alert_enabled: true,
                alert_destinations: None,
                folder_id: "f1".to_string(),
                owner: None,
                priority: None,
                tags: None,
                status: 0,
                retries: 0,
                last_failed_at: None,
                last_alert_fired_at: None,
                last_updated: 0,
                created_at: 1000,
                updated_at: 1000,
            }
        }

        /// The gap this task closes: the automatic SELECT filters `Enabled.eq(true)` but the
        /// manual path does not, so a disabled config can still be retrained by hand.
        #[test]
        fn a_disabled_config_is_refused_by_the_manual_training_guard() {
            let mut disabled = trainable_config();
            disabled.enabled = false;
            assert!(ensure_trainable(&disabled).is_err());
        }

        /// The guard must not become a second obstacle for the normal path.
        #[test]
        fn an_enabled_config_is_accepted() {
            assert!(ensure_trainable(&trainable_config()).is_ok());
        }

        /// The exact conflation this task exists to prevent: an implementation that reads
        /// `alert_enabled` where `enabled` was meant passes every other test but fails here.
        #[test]
        fn the_guard_reads_enabled_and_never_alert_enabled() {
            let mut alerts_off = trainable_config();
            alerts_off.alert_enabled = false;
            assert!(
                ensure_trainable(&alerts_off).is_ok(),
                "alert_enabled gates dispatch, never training"
            );

            let mut disabled_but_alerting = trainable_config();
            disabled_but_alerting.enabled = false;
            disabled_but_alerting.alert_enabled = true;
            assert!(ensure_trainable(&disabled_but_alerting).is_err());
        }

        /// Pinned policy: `default/test` sat at 44,572 retries with `alert_enabled=false`.
        /// Turning alerts off is not a training kill switch and must not become one.
        #[test]
        fn alert_enabled_false_does_not_stop_a_failing_config_from_retraining() {
            let mut burning = trainable_config();
            burning.alert_enabled = false;
            burning.retries = 44_572;
            burning.last_failed_at = Some(1_700_000_000_000_000);
            assert!(ensure_trainable(&burning).is_ok());
        }

        /// `alert_enabled=false` DOES suppress dispatch — the other half of the same policy.
        /// Targets the predicate `detect_anomalies` calls, so the test cannot drift from it.
        #[test]
        fn alert_enabled_false_suppresses_dispatch() {
            assert!(!dispatch_allowed(7, false));
            assert!(dispatch_allowed(7, true));
        }

        /// Dispatch still needs anomalies: `alert_enabled` alone must not fire an empty run.
        #[test]
        fn dispatch_needs_both_anomalies_and_the_alert_flag() {
            assert!(!dispatch_allowed(0, true));
            assert!(!dispatch_allowed(0, false));
        }

        /// `Status::Disabled` (4) is dead: nothing writes it, and the guard keys off
        /// `enabled`, so a row carrying it is still trainable. Documents current reality.
        #[test]
        fn status_disabled_is_dead_and_does_not_gate_the_guard() {
            let mut odd = trainable_config();
            odd.status = 4;
            assert!(ensure_trainable(&odd).is_ok());

            let mut disabled_and_status_four = trainable_config();
            disabled_and_status_four.enabled = false;
            disabled_and_status_four.status = 4;
            assert!(ensure_trainable(&disabled_and_status_four).is_err());
        }

        /// A config created with `enabled: Some(false)` must not train on create. The spawn
        /// at the create site is gated only on the global kill-switch, so a disabled config
        /// trains immediately today.
        #[test]
        fn a_config_created_disabled_does_not_train_on_create() {
            assert!(!initial_training_allowed(false, false));
        }

        /// The create-time gate keeps its existing kill-switch behaviour for enabled configs.
        #[test]
        fn create_time_training_respects_both_the_flag_and_the_kill_switch() {
            assert!(initial_training_allowed(true, false));
            assert!(!initial_training_allowed(true, true));
            assert!(!initial_training_allowed(false, true));
        }

        // ── Reachability: the guard must be CALLED, not merely defined ──

        /// The three async entry points reach the enterprise `trigger_training`, which has no
        /// `enabled` check of its own. Each must consult `ensure_trainable` first. Wiring them
        /// requires adding an `enabled` read inside an async DB path, so it belongs to the
        /// implementation phase; this fails until all three are wired.
        #[test]
        fn every_async_training_entry_point_consults_the_guard() {
            let mut wired = GUARDED_TRAINING_ENTRY_POINTS.to_vec();
            wired.sort_unstable();
            assert_eq!(
                wired,
                [
                    "force_retrain_for_threshold",
                    "train_model",
                    "trigger_training"
                ],
                "each entry point joins this list when it calls ensure_trainable"
            );
        }
    }
}
