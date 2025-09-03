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

use std::collections::HashMap;

use chrono::Utc;
use config::{
    SIZE_IN_MB,
    meta::{self_reporting::usage::RequestStats, stream::StreamType},
};
use tokio::{
    sync::mpsc::Receiver,
    time::{Duration, interval},
};

#[derive(Debug, Clone)]
pub struct PipelineUsageEvent {
    pub idx: usize,
    pub data_size: f64,
}

pub async fn pipeline_usage_tracker(
    org_id: String,
    pipeline_id: String,
    pipeline_name: String,
    stream_name: Option<String>,
    mut usage_receiver: Receiver<PipelineUsageEvent>,
) {
    let mut usage_aggregator: HashMap<usize, f64> = HashMap::new();
    let mut flush_interval = interval(Duration::from_secs(10));
    let stream_name = stream_name.unwrap_or_else(|| "pipeline".to_string());

    log::debug!("[Pipeline Usage Tracker] Started for pipeline {pipeline_id} ({pipeline_name})");

    flush_interval.tick().await;

    loop {
        tokio::select! {
            // Receive usage events
            event = usage_receiver.recv() => {
                match event {
                    Some(usage_event) => {
                        log::trace!(
                            "[Pipeline Usage Tracker] Received event for idx={}, size={:.2} bytes",
                            usage_event.idx,
                            usage_event.data_size
                        );
                        *usage_aggregator.entry(usage_event.idx).or_insert(0.0) += usage_event.data_size;
                    }
                    None => {
                        // Channel closed, flush final data and exit
                        log::debug!(
                            "[Pipeline Usage Tracker] Channel closed for pipeline {pipeline_id}, flushing final data"
                        );
                        flush_usage_data(
                            &org_id,
                            &pipeline_id,
                            &pipeline_name,
                            &stream_name,
                            &mut usage_aggregator,
                        ).await;
                        break;
                    }
                }
            }

            // Periodic flush every 10 seconds
            _ = flush_interval.tick() => {
                if !usage_aggregator.is_empty() {
                    log::debug!(
                        "[Pipeline Usage Tracker] Periodic flush for pipeline {pipeline_id}, {} items aggregated",
                        usage_aggregator.len()
                    );
                    flush_usage_data(
                        &org_id,
                        &pipeline_id,
                        &pipeline_name,
                        &stream_name,
                        &mut usage_aggregator,
                    ).await;
                }
            }
        }
    }

    log::debug!("[Pipeline Usage Tracker] Stopped for pipeline {pipeline_id} ({pipeline_name})");
}

async fn flush_usage_data(
    org_id: &str,
    pipeline_id: &str,
    _pipeline_name: &str,
    stream_name: &str,
    usage_aggregator: &mut HashMap<usize, f64>,
) {
    if usage_aggregator.is_empty() {
        return;
    }

    let total_size: f64 = usage_aggregator.values().sum::<f64>() / SIZE_IN_MB;
    let total_records = usage_aggregator.len() as i64;

    if total_size > 0.0 {
        let req_stats = RequestStats {
            size: total_size,
            records: total_records,
            response_time: 0.0,
            ..RequestStats::default()
        };

        log::debug!(
            "[Pipeline Usage Tracker] Flushing usage for pipeline {pipeline_id}: {:.4} MB, {} records",
            total_size,
            total_records
        );

        crate::service::self_reporting::report_request_usage_stats(
            req_stats,
            org_id,
            stream_name,
            StreamType::Logs, // Default to Logs, could be made configurable
            config::meta::self_reporting::usage::UsageType::Pipeline,
            0, // No additional functions beyond pipeline
            Utc::now().timestamp_micros(),
        )
        .await;
    }

    usage_aggregator.clear();
}
