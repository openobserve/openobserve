// Copyright 2025 OpenObserve Inc.
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

use std::time::Duration;

use chrono::{DateTime, Datelike, Timelike};
#[cfg(feature = "enterprise")]
use config::META_ORG_ID;
#[cfg(feature = "enterprise")]
use config::spawn_pausable_job;
use config::{
    SIZE_IN_MB,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        self_reporting::{
            EnqueueError, ReportingData,
            error::ErrorData,
            usage::{RequestStats, TriggerData, UsageData, UsageEvent, UsageType},
        },
        stream::StreamType,
    },
    metrics,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::auditor;
#[cfg(feature = "enterprise")]
use proto::cluster_rpc;
use tokio::sync::oneshot;

#[cfg(feature = "cloud")]
pub mod cloud_events;
mod ingestion;
mod queues;
pub mod search;
mod triggers_schema;

#[cfg(feature = "cloud")]
pub use ingestion::ingest_data_retention_usages;

pub async fn run() {
    #[cfg(not(feature = "enterprise"))]
    {
        let cfg = get_config();
        if !cfg.common.usage_enabled {
            return;
        }
    }

    // Force initialization usage queue
    let (usage_start_sender, usage_start_receiver) = oneshot::channel();
    if let Err(e) = queues::USAGE_QUEUE.start(usage_start_sender).await {
        log::error!("[SELF-REPORTING] Failed to initialize usage queue: {e}");
        return;
    }

    if let Err(e) = usage_start_receiver.await {
        log::error!("[SELF-REPORTING] Usage queue initialization failed: {e}");
        return;
    }

    // Force initialization error queue
    let (error_start_sender, error_start_receiver) = oneshot::channel();
    if let Err(e) = queues::ERROR_QUEUE.start(error_start_sender).await {
        log::error!("[SELF-REPORTING] Failed to initialize error queue: {e}");
        return;
    }

    if let Err(e) = error_start_receiver.await {
        log::error!("[SELF-REPORTING] Error queue initialization failed: {e}");
        return;
    }

    log::debug!("[SELF-REPORTING] successfully initialized reporting queues");
}

pub async fn report_request_usage_stats(
    stats: RequestStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    usage_type: UsageType,
    num_functions: u16,
    timestamp: i64,
) {
    let event: UsageEvent = usage_type.into();
    if matches!(event, UsageEvent::Ingestion) {
        metrics::INGEST_RECORDS
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc_by(stats.records as u64);
        metrics::INGEST_BYTES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc_by((stats.size * SIZE_IN_MB) as u64);
    }

    #[cfg(not(feature = "enterprise"))]
    if !get_config().common.usage_enabled {
        return;
    }

    let now = DateTime::from_timestamp_micros(timestamp).unwrap();
    let request_body = stats.request_body.unwrap_or(usage_type.to_string());
    let user_email = stats.user_email.unwrap_or("".to_owned());

    let mut usage = vec![];

    if num_functions > 0 {
        usage.push(UsageData {
            _timestamp: timestamp,
            event: UsageEvent::Functions,
            day: now.day(),
            hour: now.hour(),
            month: now.month(),
            year: now.year(),
            event_time_hour: format!(
                "{:04}{:02}{:02}{:02}",
                now.year(),
                now.month(),
                now.day(),
                now.hour()
            ),
            org_id: org_id.to_owned(),
            request_body: request_body.to_owned(),
            function: None,
            size: stats.size,
            scan_files: stats.scan_files,
            unit: "MB".to_owned(),
            user_email: user_email.to_owned(),
            response_time: stats.response_time,
            num_records: stats.records * num_functions as i64,
            dropped_records: stats.dropped_records,
            stream_type,
            stream_name: stream_name.to_owned(),
            min_ts: None,
            max_ts: None,
            cached_ratio: None,
            compressed_size: None,
            search_type: stats.search_type,
            search_event_context: stats.search_event_context.clone(),
            trace_id: None,
            took_wait_in_queue: stats.took_wait_in_queue,
            result_cache_ratio: None,
            is_partial: stats.is_partial,
            work_group: None,
            node_name: stats.node_name.clone(),
            dashboard_info: stats.dashboard_info.clone(),
            peak_memory_usage: stats.peak_memory_usage,
        });
    };

    usage.push(UsageData {
        _timestamp: timestamp,
        event,
        day: now.day(),
        hour: now.hour(),
        month: now.month(),
        year: now.year(),
        event_time_hour: format!(
            "{:04}{:02}{:02}{:02}",
            now.year(),
            now.month(),
            now.day(),
            now.hour()
        ),
        org_id: org_id.to_owned(),
        request_body: request_body.to_owned(),
        size: stats.size,
        scan_files: stats.scan_files,
        unit: "MB".to_owned(),
        user_email,
        response_time: stats.response_time,
        function: stats.function,
        num_records: stats.records,
        dropped_records: stats.dropped_records,
        stream_type,
        stream_name: stream_name.to_owned(),
        min_ts: stats.min_ts,
        max_ts: stats.max_ts,
        cached_ratio: stats.cached_ratio,
        compressed_size: None,
        search_type: stats.search_type,
        search_event_context: stats.search_event_context.clone(),
        trace_id: stats.trace_id,
        took_wait_in_queue: stats.took_wait_in_queue,
        result_cache_ratio: stats.result_cache_ratio,
        is_partial: stats.is_partial,
        work_group: stats.work_group,
        node_name: stats.node_name,
        dashboard_info: stats.dashboard_info,
        peak_memory_usage: stats.peak_memory_usage,
    });
    if !usage.is_empty() {
        publish_usage(usage).await;
    }
}

async fn publish_usage(usages: Vec<UsageData>) {
    #[cfg(not(feature = "enterprise"))]
    {
        let cfg = get_config();
        if !cfg.common.usage_enabled {
            return;
        }
    }

    for usage in usages {
        if let Err(e) = queues::USAGE_QUEUE
            .enqueue(ReportingData::Usage(Box::new(usage)))
            .await
        {
            log::error!(
                "[SELF-REPORTING] Failed to send usage data to background ingesting job: {e}"
            );
        }
    }
}

pub fn publish_triggers_usage(trigger: TriggerData) {
    #[cfg(not(feature = "enterprise"))]
    {
        let cfg = get_config();
        if !cfg.common.usage_enabled {
            log::debug!(
                "[SELF-REPORTING] Skipping trigger usage publish - usage reporting disabled"
            );
            return;
        }
    }

    log::debug!(
        "[SELF-REPORTING] Publishing trigger usage: org={}, module={:?}, key={}, status={:?}",
        trigger.org,
        trigger.module,
        trigger.key,
        trigger.status
    );

    // Use non-blocking try_enqueue to prevent scheduler blocking
    match queues::USAGE_QUEUE.try_enqueue(ReportingData::Trigger(Box::new(trigger))) {
        Ok(()) => {
            log::debug!(
                "[SELF-REPORTING] Successfully queued trigger usage data to be ingested (non-blocking)"
            )
        }
        Err(tokio::sync::mpsc::error::TrySendError::Full(msg)) => {
            // Queue is full - system is overloaded, drop the trigger data
            let dropped_info = match msg {
                config::meta::self_reporting::ReportingMessage::Data(ReportingData::Trigger(t)) => {
                    Some((t.org.clone(), t.key.clone()))
                }
                _ => None,
            };

            if let Some((org, key)) = dropped_info {
                log::warn!(
                    "[SELF-REPORTING] Usage queue full, dropping trigger data for org={}, key={}. \
                     System is overloaded. Consider increasing ZO_USAGE_REPORTING_THREAD_NUM or ZO_USAGE_BATCH_SIZE.",
                    org,
                    key
                );
            } else {
                log::warn!(
                    "[SELF-REPORTING] Usage queue full, dropping trigger data. \
                     System is overloaded. Consider increasing ZO_USAGE_REPORTING_THREAD_NUM or ZO_USAGE_BATCH_SIZE."
                );
            }

            // Increment dropped triggers metric
            metrics::SELF_REPORTING_DROPPED_TRIGGERS
                .with_label_values(&[""])
                .inc();
        }
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
            log::error!(
                "[SELF-REPORTING] Usage queue closed, cannot send trigger data. \
                 Self-reporting service may have shut down."
            );
        }
    }
}

pub async fn publish_error(error_data: ErrorData) {
    let cfg = get_config();
    #[cfg(not(feature = "enterprise"))]
    {
        if !cfg.common.usage_enabled {
            log::debug!("[SELF-REPORTING] Skipping error publish - usage reporting disabled");
            return;
        }
    }

    // Important data - use shorter timeout than usage to prevent indefinite blocking
    let timeout_duration = Duration::from_secs(cfg.common.error_publish_timeout_secs);

    // Extract org for logging
    let org = error_data.stream_params.org_id.clone();
    let error_source = match &error_data.error_source {
        config::meta::self_reporting::error::ErrorSource::Alert => "Alert",
        config::meta::self_reporting::error::ErrorSource::Dashboard => "Dashboard",
        config::meta::self_reporting::error::ErrorSource::Ingestion => "Ingestion",
        config::meta::self_reporting::error::ErrorSource::Pipeline(_) => "Pipeline",
        config::meta::self_reporting::error::ErrorSource::Search => "Search",
        config::meta::self_reporting::error::ErrorSource::Other => "Other",
        config::meta::self_reporting::error::ErrorSource::SsoClaimParser(_) => "SsoClaimParser",
    };

    log::debug!(
        "[SELF-REPORTING] Publishing error data: org={}, source={}, timeout={:?}",
        org,
        error_source,
        timeout_duration
    );

    let start = std::time::Instant::now();
    match queues::ERROR_QUEUE
        .enqueue_with_timeout(ReportingData::Error(Box::new(error_data)), timeout_duration)
        .await
    {
        Ok(()) => {
            let elapsed = start.elapsed();
            log::debug!(
                "[SELF-REPORTING] Successfully queued error data to be ingested (took {:?}, timeout-based)",
                elapsed
            );
        }
        Err(EnqueueError::Timeout) => {
            log::warn!(
                "[SELF-REPORTING] Timeout ({:?}) queueing error data for org={}, source={}. \
                 System overloaded, error reporting degraded. \
                 Consider increasing ZO_USAGE_REPORTING_THREAD_NUM or ZO_USAGE_BATCH_SIZE.",
                timeout_duration,
                org,
                error_source
            );
            metrics::SELF_REPORTING_TIMEOUT_ERRORS
                .with_label_values(&[""])
                .inc();
        }
        Err(EnqueueError::SendFailed(e)) => {
            log::error!(
                "[SELF-REPORTING] Failed to send error data for org={}, source={}: {e}",
                org,
                error_source
            );
        }
    }
}

pub async fn flush() {
    // flush audit data
    #[cfg(feature = "enterprise")]
    flush_audit().await;

    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    let usage_enabled = true;
    #[cfg(not(feature = "enterprise"))]
    let usage_enabled = cfg.common.usage_enabled;

    // only ingester and querier nodes report usage
    if !usage_enabled || (!LOCAL_NODE.is_ingester() && !LOCAL_NODE.is_querier()) {
        return;
    }

    // shutdown usage_queuer
    for _ in 0..cfg.limit.usage_reporting_thread_num {
        let (res_sender, res_receiver) = oneshot::channel();
        if let Err(e) = queues::USAGE_QUEUE.shutdown(res_sender).await {
            log::error!("[SELF-REPORTING] Error shutting down USAGE_QUEUER: {e}");
        }
        // wait for flush ingestion job
        res_receiver.await.ok();

        let (error_sender, error_receiver) = oneshot::channel();
        if let Err(e) = queues::ERROR_QUEUE.shutdown(error_sender).await {
            log::error!("[SELF-REPORTING] Error shutting down ERROR_QUEUE: {e}");
        }
        // wait for flush ingestion job
        error_receiver.await.ok();
    }
}

// Cron job to frequently publish auditted events
#[cfg(feature = "enterprise")]
pub fn run_audit_publish() -> Option<tokio::task::JoinHandle<()>> {
    let o2cfg = o2_enterprise::enterprise::common::config::get_config();
    if !o2cfg.common.audit_enabled {
        return None;
    }

    Some(spawn_pausable_job!(
        "audit_publish",
        o2cfg.common.audit_publish_interval,
        {
            log::debug!("Audit ingestion loop running");
            o2_enterprise::enterprise::common::auditor::publish_existing_audits(
                META_ORG_ID,
                publish_audit,
            )
            .await;
        },
        pause_if: o2cfg.common.audit_publish_interval == 0 || !o2_enterprise::enterprise::common::config::get_config().common.audit_enabled
    ))
}

#[cfg(feature = "enterprise")]
pub async fn audit(msg: auditor::AuditMessage) {
    auditor::audit(META_ORG_ID, msg, publish_audit).await;
}

#[cfg(feature = "enterprise")]
pub async fn flush_audit() {
    auditor::flush_audit(META_ORG_ID, publish_audit).await;
}

#[cfg(feature = "enterprise")]
async fn publish_audit(
    req: cluster_rpc::IngestionRequest,
) -> Result<cluster_rpc::IngestionResponse, anyhow::Error> {
    crate::service::ingestion::ingestion_service::ingest(req)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

#[inline]
pub fn http_report_metrics(
    start: std::time::Instant,
    org_id: &str,
    stream_type: StreamType,
    code: &str,
    uri: &str,
    search_type: &str,
    search_group: &str,
) {
    let time = start.elapsed().as_secs_f64();
    let uri = format!("/api/org/{uri}");
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            uri.as_str(),
            code,
            org_id,
            stream_type.as_str(),
            search_type,
            search_group,
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            uri.as_str(),
            code,
            org_id,
            stream_type.as_str(),
            search_type,
            search_group,
        ])
        .inc();
}
