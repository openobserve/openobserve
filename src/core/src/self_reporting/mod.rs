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

use std::time::Duration;

#[cfg(feature = "enterprise")]
pub use audit::{audit, auditor, flush as flush_audit, run_publish_job as run_audit_publish};
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::self_reporting::{EnqueueError, ReportingData, error::ErrorData, usage::TriggerData},
    metrics,
};
pub use usage_reporting::{http_report_metrics, report_request_usage_stats, report_usage};

#[cfg(feature = "cloud")]
pub mod cloud_events;
#[cfg(feature = "enterprise")]
mod evaluator_schema;
mod ingestion;
#[cfg(feature = "enterprise")]
mod llm_scores_schema;
pub(crate) mod persistence;
pub mod search;
mod triggers_schema;
mod usage_schema;

#[cfg(feature = "enterprise")]
pub use evaluator_schema::ensure_evaluator_stream_initialized;
#[cfg(feature = "cloud")]
pub use ingestion::ingest_data_retention_usages;
#[cfg(feature = "enterprise")]
pub use llm_scores_schema::ensure_llm_scores_stream_initialized;

pub async fn run() {
    #[cfg(not(feature = "enterprise"))]
    {
        let cfg = get_config();
        if !cfg.common.usage_enabled {
            return;
        }
    }

    if let Err(error) = usage_reporting::start().await {
        log::error!("[SELF-REPORTING] Reporting queue initialization failed: {error}");
        return;
    }

    log::debug!("[SELF-REPORTING] successfully initialized reporting queues");
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
    match usage_reporting::try_enqueue(ReportingData::Trigger(Box::new(trigger))) {
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
                .with_label_values(&["usage"])
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
        config::meta::self_reporting::error::ErrorSource::Function(_) => "Function",
        config::meta::self_reporting::error::ErrorSource::Ingestion => "Ingestion",
        config::meta::self_reporting::error::ErrorSource::Pipeline(_) => "Pipeline",
        config::meta::self_reporting::error::ErrorSource::Search => "Search",
        config::meta::self_reporting::error::ErrorSource::Other => "Other",
        config::meta::self_reporting::error::ErrorSource::SsoClaimParser(_) => "SsoClaimParser",
        config::meta::self_reporting::error::ErrorSource::OrgStorage(_) => "OrgStorage",
    };

    log::debug!(
        "[SELF-REPORTING] Publishing error data: org={}, source={}, timeout={:?}",
        org,
        error_source,
        timeout_duration
    );

    let start = std::time::Instant::now();
    match usage_reporting::enqueue_error_with_timeout(
        ReportingData::Error(Box::new(error_data)),
        timeout_duration,
    )
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
                .with_label_values(&["error"])
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

    usage_reporting::shutdown(cfg.limit.usage_reporting_thread_num).await;
}

#[cfg(feature = "enterprise")]
pub fn publish_audit(request: proto::cluster_rpc::IngestionRequest) -> audit::AuditPublishFuture {
    Box::pin(async move {
        crate::service::ingestion::ingestion_service::ingest(request)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))
    })
}
