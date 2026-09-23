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

use axum::{Json, extract::Query};
use config::get_config;
use openobserve_core::self_profiles::{
    dump_cpu_profile, dump_memory_flamegraph, dump_memory_pprof,
    jemalloc_stats as read_jemalloc_stats,
};
use serde::Deserialize;

/// GET /debug/profile/memory
///
/// Generate a memory profile (heap dump) in jeprof format.
/// The profile can be analyzed with jeprof or converted to flamegraph.
///
/// Returns: Binary profile data
pub async fn memory_profile() -> Result<String, String> {
    let pprof_data = dump_memory_pprof().await?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let cfg = get_config();
    let profile_dir = format!("{}profiling", cfg.common.data_cache_dir);
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create profile directory: {e}"))?;
    let filename = format!("{}/memory_profile_{}.pb", profile_dir, timestamp);
    std::fs::write(&filename, pprof_data)
        .map_err(|e| format!("Failed to write profile file: {e}"))?;

    let flamegraph = dump_memory_flamegraph().await?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}/memory_profile_graph_{}.svg", profile_dir, timestamp);
    std::fs::write(&filename, flamegraph)
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
pub async fn jemalloc_stats() -> Result<Json<serde_json::Value>, String> {
    Ok(Json(read_jemalloc_stats()?))
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

    let pprof_data = dump_cpu_profile(params.duration, params.frequency).await?;

    let cfg = get_config();
    let profile_dir = format!("{}profiling", cfg.common.data_cache_dir);
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create profile directory: {e}"))?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("{}/cpu_profile_{}.pb", profile_dir, timestamp);
    std::fs::write(&filename, pprof_data).map_err(|e| format!("Failed to write profile: {e}"))?;

    log::info!("CPU profile dumped to: {}", filename);
    Ok(filename)
}
