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

use std::{
    sync::Mutex,
    time::Duration,
};

use config::metrics::RUNTIME_TASKS;
#[cfg(tokio_unstable)]
use config::metrics::{
    RUNTIME_TASKS_TOTAL, RUNTIME_WORKER_DURATION_SECONDS,
    RUNTIME_WORKER_METRICS, RUNTIME_WORKER_POLL_TIME_SECONDS,
};
use tokio::runtime::Handle;

static RUNTIME_HANDLES: Mutex<Vec<(String, Handle)>> = Mutex::new(Vec::new());

pub fn register_runtime(name: String, handle: Handle) {
    log::info!("Registered runtime '{}' for metrics collection", &name);
    let mut handles = RUNTIME_HANDLES.lock().unwrap();
    handles.push((name, handle));
}

pub async fn collect_runtime_metrics() {
    let handles = {
        let handles = RUNTIME_HANDLES.lock().unwrap();
        handles.clone()
    };

    for (runtime_name, handle) in handles {
        // Try to get runtime metrics if tokio_unstable is available
        #[cfg(tokio_unstable)]
        {
            let metrics = handle.metrics();
            update_runtime_metrics(&runtime_name, &metrics).await;
        }
        
        #[cfg(not(tokio_unstable))]
        {
            // For stable tokio, we can only collect basic information
            update_basic_runtime_info(&runtime_name).await;
            let _ = handle; // Suppress unused variable warning
        }
    }
}

#[cfg(tokio_unstable)]
async fn update_runtime_metrics(runtime_name: &str, metrics: &tokio::runtime::RuntimeMetrics) {
    // Basic runtime task metrics using consolidated metrics with labels
    RUNTIME_TASKS
        .with_label_values(&[runtime_name, "workers"])
        .set(metrics.num_workers() as i64);

    RUNTIME_TASKS
        .with_label_values(&[runtime_name, "alive_tasks"])
        .set(metrics.num_alive_tasks() as i64);

    RUNTIME_TASKS
        .with_label_values(&[runtime_name, "global_queue_depth"])
        .set(metrics.global_queue_depth() as i64);

    RUNTIME_TASKS
        .with_label_values(&[runtime_name, "blocking_queue_depth"])
        .set(metrics.blocking_queue_depth() as i64);

    RUNTIME_TASKS
        .with_label_values(&[runtime_name, "io_driver_fd_registered"])
        .set(metrics.io_driver_fd_registered_count() as i64);

    // Total counters using consolidated metrics
    RUNTIME_TASKS_TOTAL
        .with_label_values(&[runtime_name, "spawned_tasks"])
        .inc_by(metrics.spawned_tasks_count() as u64);

    RUNTIME_TASKS_TOTAL
        .with_label_values(&[runtime_name, "remote_schedule"])
        .inc_by(metrics.remote_schedule_count() as u64);

    RUNTIME_TASKS_TOTAL
        .with_label_values(&[runtime_name, "io_driver_ready"])
        .inc_by(metrics.io_driver_ready_count() as u64);

    // Worker-specific metrics using consolidated metrics
    for worker_id in 0..metrics.num_workers() {
        let worker_id_str = worker_id.to_string();

        // Worker counters
        RUNTIME_WORKER_METRICS
            .with_label_values(&[runtime_name, &worker_id_str, "poll_count"])
            .inc_by(metrics.worker_poll_count(worker_id) as u64);

        RUNTIME_WORKER_METRICS
            .with_label_values(&[runtime_name, &worker_id_str, "steal_count"])
            .inc_by(metrics.worker_steal_count(worker_id) as u64);

        RUNTIME_WORKER_METRICS
            .with_label_values(&[runtime_name, &worker_id_str, "park_count"])
            .inc_by(metrics.worker_park_count(worker_id) as u64);

        RUNTIME_WORKER_METRICS
            .with_label_values(&[runtime_name, &worker_id_str, "local_queue_depth"])
            .inc_by(metrics.worker_local_queue_depth(worker_id) as u64);

        RUNTIME_WORKER_METRICS
            .with_label_values(&[runtime_name, &worker_id_str, "local_schedule_count"])
            .inc_by(metrics.worker_local_schedule_count(worker_id) as u64);

        // Duration metrics (converted from Duration to seconds)
        let busy_duration = metrics.worker_total_busy_duration(worker_id);
        RUNTIME_WORKER_DURATION_SECONDS
            .with_label_values(&[runtime_name, &worker_id_str])
            .inc_by(busy_duration.as_secs_f64());

        // Poll time as histogram
        let mean_poll_time = metrics.worker_mean_poll_time(worker_id);
        RUNTIME_WORKER_POLL_TIME_SECONDS
            .with_label_values(&[runtime_name, &worker_id_str])
            .observe(mean_poll_time.as_secs_f64());
    }
}

#[cfg(not(tokio_unstable))]
async fn update_basic_runtime_info(runtime_name: &str) {
    // For stable tokio, we can only set basic information
    // Set workers to -1 to indicate unknown when tokio_unstable is not available
    RUNTIME_TASKS
        .with_label_values(&[runtime_name, "workers"])
        .set(-1);
    
    // Log that detailed metrics require tokio_unstable
    log::debug!("Runtime '{}' metrics available only with tokio_unstable feature", runtime_name);
}

pub async fn start_metrics_collector() {
    #[cfg(tokio_unstable)]
    log::info!("Starting runtime metrics collector with full tokio_unstable metrics support");
    
    #[cfg(not(tokio_unstable))]
    log::info!("Starting runtime metrics collector (basic mode - compile with --cfg tokio_unstable for detailed metrics)");
    
    tokio::spawn(async {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            collect_runtime_metrics().await;
        }
    });
}