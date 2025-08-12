// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version).
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{collections::HashSet, sync::Arc};

use anyhow::Result;
use config::{
    cluster::LOCAL_NODE,
    meta::{cluster::Role, stream::StreamType},
};
use infra::storage;
use once_cell::sync::Lazy;

use crate::service::{db, index::cuckoo_filter::CuckooFilterManager};

/// Process a single cuckoo filter file
async fn process_cuckoo_filter_file(
    org_id: &str,
    day_key: &str,
    file: &std::fs::DirEntry,
) -> Option<()> {
    let file_name = file.file_name();
    let file_name_str = file_name.to_string_lossy();

    // Only process hour .cuckoo files
    if !file_name_str.ends_with(".cuckoo") {
        return None;
    }

    // Only handle hour filters now
    let key = file_name_str.trim_end_matches(".cuckoo");

    // Construct S3 key for hour filter
    let s3_key = format!("cuckoo_filters/{org_id}/{day_key}/{key}.cuckoo");

    // Check if exists in S3 and delete if it does
    if (storage::head("", &s3_key).await).is_ok() {
        GLOBAL_CUCKOO_FILTER_MANAGER.delete_hour(org_id, key);
        log::info!(
            "[CUCKOO_FILTER_INGESTER] Removed local and memory filter for org {} key {} as S3 exists",
            org_id,
            key
        );
    }

    Some(())
}

/// Process all files in a day directory
async fn process_day_directory(org_id: String, day_dir: std::fs::DirEntry) -> Option<()> {
    let day_key = day_dir.file_name().to_string_lossy().to_string();
    let day_path = day_dir.path();

    let files = std::fs::read_dir(&day_path).ok()?;

    for file in files.flatten() {
        let _ = process_cuckoo_filter_file(&org_id, &day_key, &file).await;
    }

    Some(())
}

/// Task for ingester to periodically clean up local cuckoo filter files
pub async fn start_ingester_cleanup_job() {
    if !config::cluster::LOCAL_NODE.is_ingester() {
        return;
    }

    tokio::spawn(async move {
        let interval = tokio::time::Duration::from_secs(30 * 60); // 30 minutes

        loop {
            tokio::time::sleep(interval).await;

            // Get all organization directories
            let cfg = config::get_config();
            let base_dir = &cfg.cuckoo_filter.dir;

            let org_dirs = match std::fs::read_dir(base_dir) {
                Ok(dirs) => dirs,
                Err(_) => continue,
            };

            // Process each organization directory
            for org in org_dirs.flatten() {
                let org_id = org.file_name().to_string_lossy().to_string();
                let org_path = org.path();

                let day_dirs = match std::fs::read_dir(&org_path) {
                    Ok(dirs) => dirs,
                    Err(_) => continue,
                };

                // Process each day directory
                for day_dir in day_dirs.flatten() {
                    let _ = process_day_directory(org_id.clone(), day_dir).await;
                }
            }
        }
    });
}

/// Process missing hourly cuckoo filter for a given org/hour
async fn process_missing_hour(
    manager: &Arc<CuckooFilterManager>,
    org_id: &str,
    hour_key: &str,
    now: &chrono::DateTime<chrono::Utc>,
) {
    let day_key = &hour_key[..8];
    let job_state = CuckooFilterJobState {
        org_id: org_id.to_owned(),
        hour_key: hour_key.to_owned(),
        day_key: day_key.to_owned(),
        processed_files: vec![],
        total_files: 0,
        start_time: now.timestamp_micros(),
        status: JobStatus::Running,
        error_message: None,
    };
    log::info!(
        "[CUCKOO_FILTER_JOB] Start processing org {} hour {} (day {})",
        org_id,
        hour_key,
        day_key
    );
    // Actually process the trace data for this hour
    if let Err(e) = manager.process_organization_trace_data(&job_state).await {
        log::error!(
            "[CUCKOO_FILTER_JOB] Failed to process org {} hour {}: {}",
            org_id,
            hour_key,
            e
        );
    } else {
        log::info!(
            "[CUCKOO_FILTER_JOB] Finished processing org {} hour {}",
            org_id,
            hour_key
        );
    }
}

/// Start a scheduled hourly job to generate cuckoo filters from trace_index_list
pub async fn start_hourly_job(manager: Arc<CuckooFilterManager>) -> Result<()> {
    if !LOCAL_NODE.is_compactor() {
        return Ok(());
    }

    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
        config::get_config().cuckoo_filter.build_index_interval,
    ));
    interval.tick().await;

    loop {
        // Get all organizations
        let orgs = db::schema::list_organizations_from_cache().await;
        let now = chrono::Utc::now();
        log::info!(
            "[CUCKOO_FILTER_JOB] Hourly job tick: found {} organizations, now: {}",
            orgs.len(),
            now.timestamp()
        );

        for org_id in &orgs {
            // Only process streams of type Traces and stream_name == "default"
            let streams = db::schema::list_streams_from_cache(org_id, StreamType::Traces).await;
            log::info!(
                "[CUCKOO_FILTER_JOB] Org {}: found {} streams",
                org_id,
                streams.len()
            );
            for stream_name in &streams {
                if stream_name != "default" {
                    continue;
                }

                // Get data retention days for this stream
                let settings = infra::schema::get_settings(org_id, stream_name, StreamType::Traces)
                    .await
                    .unwrap_or_default();
                let retention_days = if settings.data_retention > 0 {
                    settings.data_retention
                } else {
                    config::get_config().cuckoo_filter.data_lookback_days
                };
                log::info!(
                    "[CUCKOO_FILTER_JOB] Org {} stream {}: retention_days = {}",
                    org_id,
                    stream_name,
                    retention_days
                );

                // Calculate all needed hour keys within retention
                let mut needed_hour_keys = Vec::with_capacity((retention_days * 24) as usize);
                for i in 0..(retention_days * 24) {
                    let t = now - chrono::Duration::hours(i + 1);
                    needed_hour_keys.push(t.format("%Y%m%d%H").to_string());
                }
                log::info!(
                    "[CUCKOO_FILTER_JOB] Org {}: needed_hour_keys={}",
                    org_id,
                    needed_hour_keys.len()
                );

                // Query S3 for existing hour and day cuckoo filter files
                // Check what already exists in S3
                let mut existing_hour_keys = HashSet::new();
                // Get unique day keys from hour keys to check S3
                let day_keys_to_check: HashSet<String> = needed_hour_keys
                    .iter()
                    .map(|h| h[..8].to_string())
                    .collect();

                for day_key in &day_keys_to_check {
                    let s3_prefix = format!("cuckoo_filters/{org_id}/{day_key}/");
                    if let Ok(files) = storage::list("", &s3_prefix).await {
                        for file in files {
                            if let Some(fname) = file.split('/').next_back() {
                                // Only process hourly filter files
                                if fname.ends_with(".cuckoo")
                                    && let Some(hour_key) = fname.strip_suffix(".cuckoo")
                                {
                                    existing_hour_keys.insert(hour_key.to_string());
                                }
                            }
                        }
                    }
                }
                log::info!(
                    "[CUCKOO_FILTER_JOB] Org {}: existing_hour_keys={}",
                    org_id,
                    existing_hour_keys.len()
                );

                // Calculate missing hour keys (those not present in S3)
                let missing_hour_keys: Vec<_> = needed_hour_keys
                    .iter()
                    .filter(|h| !existing_hour_keys.contains(*h))
                    .collect();
                log::info!(
                    "[CUCKOO_FILTER_JOB] Org {}: missing_hour_keys={}",
                    org_id,
                    missing_hour_keys.len()
                );

                // Assign hourly jobs to this node if responsible
                for hour_key in missing_hour_keys {
                    // Use consistent hashing to determine if this node should process this hour
                    let node_name = crate::common::infra::cluster::get_node_from_consistent_hash(
                        hour_key,
                        &Role::Compactor,
                        None,
                    )
                    .await;
                    if node_name.as_deref() != Some(&LOCAL_NODE.name) {
                        continue;
                    }
                    // Process this missing hour
                    process_missing_hour(&manager, org_id, hour_key, &now).await;
                }
            }
        }
        // Wait for the next interval
        interval.tick().await;
    }
}

/// Build cuckoo filters for traces default stream within specified time range
pub async fn build_cuckoo_filters_for_time_range(
    start_time: chrono::DateTime<chrono::Utc>,
    end_time: chrono::DateTime<chrono::Utc>,
    org_id: Option<String>,
    stream_name: &str,
    force: bool,
) -> Result<()> {
    let manager = GLOBAL_CUCKOO_FILTER_MANAGER.clone();

    log::info!(
        "[CUCKOO_FILTER_BUILD] Starting cuckoo filter build for time range: {} to {}",
        start_time.format("%Y-%m-%d %H:%M:%S UTC"),
        end_time.format("%Y-%m-%d %H:%M:%S UTC")
    );

    log::info!("[CUCKOO_FILTER_BUILD] Target stream: {stream_name}");

    if force {
        log::info!("[CUCKOO_FILTER_BUILD] Force mode enabled - will rebuild existing filters");
    }

    // Initialize stream schemas cache
    log::info!("[CUCKOO_FILTER_BUILD] Initializing stream schemas cache...");
    db::schema::cache()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to initialize stream schemas: {}", e))?;

    // Get organizations to process
    let orgs = if let Some(org) = org_id {
        vec![org]
    } else {
        db::schema::list_organizations_from_cache().await
    };

    log::info!(
        "[CUCKOO_FILTER_BUILD] Found {} organizations to process",
        orgs.len()
    );

    let mut total_processed = 0;
    let mut total_failed = 0;
    let mut total_skipped = 0;

    for (org_idx, org_id) in orgs.iter().enumerate() {
        log::info!(
            "[CUCKOO_FILTER_BUILD] Processing organization {}/{}: {}",
            org_idx + 1,
            orgs.len(),
            org_id
        );

        // Only process streams of type Traces and specified stream_name
        let streams = db::schema::list_streams_from_cache(org_id, StreamType::Traces).await;
        let target_streams: Vec<_> = streams.iter().filter(|s| *s == stream_name).collect();

        if target_streams.is_empty() {
            log::info!(
                "[CUCKOO_FILTER_BUILD] Org {org_id}: No '{stream_name}' traces stream found, skipping",
            );
            continue;
        }

        log::info!(
            "[CUCKOO_FILTER_BUILD] Org {org_id}: Found {} '{}' traces streams",
            target_streams.len(),
            stream_name
        );

        // Calculate all needed hour keys within the specified time range
        let mut needed_hour_keys = Vec::new();
        let mut current_time = start_time;

        while current_time <= end_time {
            needed_hour_keys.push(current_time.format("%Y%m%d%H").to_string());
            current_time += chrono::Duration::hours(1);
        }

        if needed_hour_keys.is_empty() {
            log::info!(
                "[CUCKOO_FILTER_BUILD] Org {org_id}: No hours to process in the specified range",
            );
            continue;
        }

        log::info!(
            "[CUCKOO_FILTER_BUILD] Org {}: Need to process {} hours",
            org_id,
            needed_hour_keys.len()
        );

        // Query S3 for existing hour cuckoo filter files
        let mut existing_hour_keys = HashSet::new();
        let day_keys_to_check: HashSet<String> = needed_hour_keys
            .iter()
            .map(|h| h[..8].to_string())
            .collect();

        if !force {
            log::info!("[CUCKOO_FILTER_BUILD] Org {org_id}: Checking existing filters in S3... ",);
            std::io::Write::flush(&mut std::io::stdout()).unwrap();

            for day_key in &day_keys_to_check {
                let s3_prefix = format!("cuckoo_filters/{org_id}/{day_key}/");
                if let Ok(files) = storage::list("", &s3_prefix).await {
                    for file in files {
                        if let Some(fname) = file.split('/').next_back()
                            && fname.ends_with(".cuckoo")
                            && let Some(hour_key) = fname.strip_suffix(".cuckoo")
                        {
                            existing_hour_keys.insert(hour_key.to_string());
                        }
                    }
                }
            }
            log::info!("found {} existing filters", existing_hour_keys.len());
        } else {
            log::info!(
                "[CUCKOO_FILTER_BUILD] Org {org_id}: Force mode - skipping existing filter check",
            );
        }

        // Calculate missing hour keys (or all keys if force mode)
        let missing_hour_keys: Vec<_> = if force {
            needed_hour_keys.iter().collect()
        } else {
            needed_hour_keys
                .iter()
                .filter(|h| !existing_hour_keys.contains(*h))
                .collect()
        };

        if missing_hour_keys.is_empty() && !force {
            log::info!("[CUCKOO_FILTER_BUILD] Org {org_id}: All filters already exist, skipping",);
            total_skipped += needed_hour_keys.len();
            continue;
        }

        if force {
            log::info!(
                "[CUCKOO_FILTER_BUILD] Org {org_id}: Force rebuilding {} filters",
                missing_hour_keys.len()
            );
        } else {
            log::info!(
                "[CUCKOO_FILTER_BUILD] Org {org_id}: Need to build {} missing filters",
                missing_hour_keys.len()
            );
        }

        // Process each missing hour (or all hours if force mode)
        for (hour_idx, hour_key) in missing_hour_keys.iter().enumerate() {
            let progress = (hour_idx + 1) as f32 / missing_hour_keys.len() as f32 * 100.0;
            let action = if force && existing_hour_keys.contains(*hour_key) {
                "Rebuilding"
            } else {
                "Building"
            };
            log::info!(
                "[CUCKOO_FILTER_BUILD] Org {}: {} hour {}/{} ({:.1}%) - {} ... ",
                org_id,
                action,
                hour_idx + 1,
                missing_hour_keys.len(),
                progress,
                hour_key
            );
            std::io::Write::flush(&mut std::io::stdout()).unwrap();

            let day_key = &hour_key[..8];
            let job_state = CuckooFilterJobState {
                org_id: org_id.to_owned(),
                hour_key: hour_key.to_string(),
                day_key: day_key.to_string(),
                processed_files: vec![],
                total_files: 0,
                start_time: chrono::Utc::now().timestamp_micros(),
                status: JobStatus::Running,
                error_message: None,
            };

            match manager.process_organization_trace_data(&job_state).await {
                Ok(_) => {
                    log::info!("✓");
                    total_processed += 1;
                }
                Err(e) => {
                    log::info!("✗ Error: {e}");
                    total_failed += 1;
                }
            }
        }

        log::info!("[CUCKOO_FILTER_BUILD] Org {org_id}: Completed processing");
    }

    log::info!("\n[CUCKOO_FILTER_BUILD] Build completed!");
    log::info!("  Total processed: {total_processed}");
    log::info!("  Total failed: {total_failed}");
    if !force && total_skipped > 0 {
        log::info!("  Total skipped (already existed): {total_skipped}");
    }
    log::info!(
        "  Success rate: {:.1}%",
        if total_processed + total_failed > 0 {
            total_processed as f32 / (total_processed + total_failed) as f32 * 100.0
        } else {
            0.0
        }
    );

    Ok(())
}

pub static GLOBAL_CUCKOO_FILTER_MANAGER: Lazy<Arc<CuckooFilterManager>> =
    Lazy::new(CuckooFilterManager::new);

// Job state for tracking progress and fault tolerance
#[derive(Debug, Clone)]
pub struct CuckooFilterJobState {
    pub org_id: String,
    pub hour_key: String,
    pub day_key: String,
    pub processed_files: Vec<String>,
    pub total_files: usize,
    pub start_time: i64,
    pub status: JobStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum JobStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}
