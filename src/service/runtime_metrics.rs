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

#[cfg(tokio_unstable)]
use std::collections::HashMap;
use std::{sync::Mutex, time::Duration};

use config::metrics::TOKIO_RUNTIME_TASKS;
#[cfg(tokio_unstable)]
use config::metrics::{
    TOKIO_RUNTIME_TASKS_TOTAL, TOKIO_RUNTIME_WORKER_DURATION_SECONDS, TOKIO_RUNTIME_WORKER_METRICS,
    TOKIO_RUNTIME_WORKER_POLL_TIME_SECONDS,
};
use tokio::runtime::Handle;
#[cfg(tokio_unstable)]
use tokio::sync::RwLock;

static RUNTIME_HANDLES: Mutex<Vec<(String, Handle)>> = Mutex::new(Vec::new());

// Store previous cumulative values to calculate deltas
#[cfg(tokio_unstable)]
static PREV_COUNTERS: std::sync::LazyLock<RwLock<HashMap<String, u64>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));

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

// Helper function to increment counters with delta calculation
#[cfg(tokio_unstable)]
async fn inc_counter_delta(key: &str, current: u64, counter: &prometheus::IntCounter) {
    let mut prev_map = PREV_COUNTERS.write().await;
    let prev = prev_map.get(key).copied().unwrap_or(0);
    if current >= prev {
        counter.inc_by(current - prev);
    } else {
        // Counter reset detected (e.g., runtime restart); add full value
        counter.inc_by(current);
    }
    prev_map.insert(key.to_string(), current);
}

#[cfg(tokio_unstable)]
async fn update_runtime_metrics(runtime_name: &str, metrics: &tokio::runtime::RuntimeMetrics) {
    // Basic runtime task metrics - these are instantaneous values (gauges)
    TOKIO_RUNTIME_TASKS
        .with_label_values(&[runtime_name, "workers"])
        .set(metrics.num_workers() as i64);

    TOKIO_RUNTIME_TASKS
        .with_label_values(&[runtime_name, "alive_tasks"])
        .set(metrics.num_alive_tasks() as i64);

    TOKIO_RUNTIME_TASKS
        .with_label_values(&[runtime_name, "global_queue_depth"])
        .set(metrics.global_queue_depth() as i64);

    TOKIO_RUNTIME_TASKS
        .with_label_values(&[runtime_name, "blocking_queue_depth"])
        .set(metrics.blocking_queue_depth() as i64);

    TOKIO_RUNTIME_TASKS
        .with_label_values(&[runtime_name, "io_driver_fd_registered"])
        .set(metrics.io_driver_fd_registered_count() as i64);

    // Cumulative counters - use delta calculation to avoid double counting
    let spawned_counter =
        TOKIO_RUNTIME_TASKS_TOTAL.with_label_values(&[runtime_name, "spawned_tasks"]);
    inc_counter_delta(
        &format!("{runtime_name}:spawned_tasks"),
        metrics.spawned_tasks_count() as u64,
        &spawned_counter,
    )
    .await;

    let remote_counter =
        TOKIO_RUNTIME_TASKS_TOTAL.with_label_values(&[runtime_name, "remote_schedule"]);
    inc_counter_delta(
        &format!("{runtime_name}:remote_schedule"),
        metrics.remote_schedule_count() as u64,
        &remote_counter,
    )
    .await;

    let io_counter =
        TOKIO_RUNTIME_TASKS_TOTAL.with_label_values(&[runtime_name, "io_driver_ready"]);
    inc_counter_delta(
        &format!("{runtime_name}:io_driver_ready"),
        metrics.io_driver_ready_count() as u64,
        &io_counter,
    )
    .await;

    // Worker-specific metrics
    for worker_id in 0..metrics.num_workers() {
        let worker_id_str = worker_id.to_string();

        // Worker counters - cumulative values need delta calculation
        let poll_counter = TOKIO_RUNTIME_WORKER_METRICS.with_label_values(&[
            runtime_name,
            &worker_id_str,
            "poll_count",
        ]);
        inc_counter_delta(
            &format!("{runtime_name}:{worker_id}:poll_count"),
            metrics.worker_poll_count(worker_id) as u64,
            &poll_counter,
        )
        .await;

        let steal_counter = TOKIO_RUNTIME_WORKER_METRICS.with_label_values(&[
            runtime_name,
            &worker_id_str,
            "steal_count",
        ]);
        inc_counter_delta(
            &format!("{runtime_name}:{worker_id}:steal_count"),
            metrics.worker_steal_count(worker_id) as u64,
            &steal_counter,
        )
        .await;

        let park_counter = TOKIO_RUNTIME_WORKER_METRICS.with_label_values(&[
            runtime_name,
            &worker_id_str,
            "park_count",
        ]);
        inc_counter_delta(
            &format!("{runtime_name}:{worker_id}:park_count"),
            metrics.worker_park_count(worker_id) as u64,
            &park_counter,
        )
        .await;

        let local_schedule_counter = TOKIO_RUNTIME_WORKER_METRICS.with_label_values(&[
            runtime_name,
            &worker_id_str,
            "local_schedule_count",
        ]);
        inc_counter_delta(
            &format!("{runtime_name}:{worker_id}:local_schedule_count"),
            metrics.worker_local_schedule_count(worker_id) as u64,
            &local_schedule_counter,
        )
        .await;

        // Duration metrics - cumulative, needs delta calculation
        let busy_duration = metrics.worker_total_busy_duration(worker_id);
        let duration_counter = TOKIO_RUNTIME_WORKER_DURATION_SECONDS
            .with_label_values(&[runtime_name, &worker_id_str]);

        // Convert duration to microseconds for integer storage, then back to seconds
        let duration_micros = busy_duration.as_micros() as u64;
        let duration_key = format!("{runtime_name}:{worker_id}:busy_duration_micros");

        // Helper to track duration deltas
        {
            let mut prev_map = PREV_COUNTERS.write().await;
            let prev_micros = prev_map.get(&duration_key).copied().unwrap_or(0);
            if duration_micros >= prev_micros {
                let delta_micros = duration_micros - prev_micros;
                let delta_seconds = delta_micros as f64 / 1_000_000.0;
                duration_counter.inc_by(delta_seconds);
            } else {
                // Reset detected
                duration_counter.inc_by(busy_duration.as_secs_f64());
            }
            prev_map.insert(duration_key, duration_micros);
        }

        // Poll time as histogram - this is an instantaneous measurement
        let mean_poll_time = metrics.worker_mean_poll_time(worker_id);
        TOKIO_RUNTIME_WORKER_POLL_TIME_SECONDS
            .with_label_values(&[runtime_name, &worker_id_str])
            .observe(mean_poll_time.as_secs_f64());
    }
}

#[cfg(not(tokio_unstable))]
async fn update_basic_runtime_info(runtime_name: &str) {
    // For stable tokio, we can only set basic information
    // Set workers to -1 to indicate unknown when tokio_unstable is not available
    TOKIO_RUNTIME_TASKS
        .with_label_values(&[runtime_name, "workers"])
        .set(-1);

    // Log that detailed metrics require tokio_unstable
    log::debug!(
        "Runtime '{}' metrics available only with tokio_unstable feature",
        runtime_name
    );
}

pub async fn start_metrics_collector() {
    #[cfg(tokio_unstable)]
    log::info!("Starting runtime metrics collector with full tokio_unstable metrics support");

    #[cfg(not(tokio_unstable))]
    log::info!(
        "Starting runtime metrics collector (basic mode - compile with --cfg tokio_unstable for detail)"
    );

    tokio::spawn(async {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            collect_runtime_metrics().await;
        }
    });
}
