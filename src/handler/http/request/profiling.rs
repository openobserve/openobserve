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

//! HTTP handlers for profiling endpoints

use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::get_config;
use pprof::{ProfilerGuard, protos::Message};
use serde::Deserialize;

/// GET /debug/profile/memory
///
/// Generate a memory profile (heap dump) in jeprof format.
/// The profile can be analyzed with jeprof or converted to flamegraph.
///
/// Returns: Binary profile data
pub async fn memory_profile() -> Result<String, String> {
    let prof_ctl = jemalloc_pprof::PROF_CTL
        .as_ref()
        .ok_or_else(|| "Profiling controller not available".to_string())?;

    let mut prof_ctl = prof_ctl.lock().await;

    if !prof_ctl.activated() {
        return Err("Jemalloc profiling is not activated".to_string());
    }

    let pprof_data = prof_ctl
        .dump_pprof()
        .map_err(|e| format!("Failed to dump pprof: {e}"))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");

    // Use the configured cache directory with a profiling subdirectory
    let cfg = get_config();
    let profile_dir = format!("{}/profiling", cfg.common.data_cache_dir);

    // Ensure the profiling directory exists
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create profile directory: {e}"))?;

    let filename = format!("{}/memory_profile_{}.pb", profile_dir, timestamp);

    std::fs::write(&filename, pprof_data)
        .map_err(|e| format!("Failed to write profile file: {e}"))?;

    // dump flamegraph
    let pprof_data = prof_ctl
        .dump_flamegraph()
        .map_err(|e| format!("Failed to dump pprof: {e}"))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}/memory_profile_graph_{}.svg", profile_dir, timestamp);

    std::fs::write(&filename, pprof_data)
        .map_err(|e| format!("Failed to write profile file: {e}"))?;

    log::info!("Memory profile dumped to: {}", filename);
    Ok(filename)
}

/// GET /debug/profile/stats
///
/// Get current jemalloc memory statistics.
///
/// Returns: JSON with memory statistics including:
/// - allocated: Current allocated memory (bytes)
/// - resident: Current resident memory (bytes)
/// - metadata: Metadata overhead (bytes)
pub async fn jemalloc_stats() -> Response {
    tikv_jemalloc_ctl::epoch::mib().unwrap().advance().unwrap();

    let allocated_mib = tikv_jemalloc_ctl::stats::allocated::mib().unwrap();
    let resident_mib = tikv_jemalloc_ctl::stats::resident::mib().unwrap();
    let metadata_mib = tikv_jemalloc_ctl::stats::metadata::mib().unwrap();

    let allocated = allocated_mib.read().unwrap();
    let resident = resident_mib.read().unwrap();
    let metadata = metadata_mib.read().unwrap();

    let stats = serde_json::json!({
        "allocated": allocated,
        "resident": resident,
        "metadata": metadata,
        "allocated_mb": allocated as f64 / 1024.0 / 1024.0,
        "resident_mb": resident as f64 / 1024.0 / 1024.0,
        "metadata_mb": metadata as f64 / 1024.0 / 1024.0,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    (StatusCode::OK, Json(stats)).into_response()
}

/// Query parameters for CPU profiling
#[derive(Deserialize)]
pub struct CpuProfileQuery {
    /// Duration in seconds to sample the CPU (default: 60)
    #[serde(default = "default_duration")]
    pub duration: u64,
    /// Sampling frequency in Hz (default: 100)
    #[serde(default = "default_frequency")]
    pub frequency: i32,
}

fn default_duration() -> u64 {
    60
}

fn default_frequency() -> i32 {
    100
}

/// GET /debug/profile/cpu?duration=60&frequency=100
///
/// Generate a CPU profile by sampling the program for the specified duration.
/// The profile is saved in pprof format for analysis with pprof tools.
///
/// Query Parameters:
/// - duration: Sampling duration in seconds (default: 60)
/// - frequency: Sampling frequency in Hz (default: 100)
///
/// Returns: Path to the generated profile file
pub async fn cpu_profile(Query(params): Query<CpuProfileQuery>) -> Result<String, String> {
    log::info!(
        "Starting CPU profiling for {} seconds at {} Hz...",
        params.duration,
        params.frequency
    );

    // Create CPU profiler with the specified sampling frequency
    let guard = ProfilerGuard::new(params.frequency).map_err(|e| e.to_string())?;

    // Sample for the specified duration
    tokio::time::sleep(std::time::Duration::from_secs(params.duration)).await;

    // Build the report
    let report = guard
        .report()
        .build()
        .map_err(|e| format!("Failed to build report: {e}"))?;

    // Use the configured cache directory with a profiling subdirectory
    let cfg = get_config();
    let profile_dir = format!("{}/profiling", cfg.common.data_cache_dir);

    // Ensure the profiling directory exists
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create profile directory: {e}"))?;

    // Generate filename with timestamp
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}/cpu_profile_{}.pb", profile_dir, timestamp);

    // Create file and write pprof data
    let mut file =
        std::fs::File::create(&filename).map_err(|e| format!("Failed to create file: {e}"))?;

    report
        .pprof()
        .map_err(|e| format!("Failed to convert to pprof: {e}"))?
        .write_to_writer(&mut file)
        .map_err(|e| format!("Failed to write profile: {e}"))?;

    log::info!("CPU profile dumped to: {}", filename);
    Ok(filename)
}
