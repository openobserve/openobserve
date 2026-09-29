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

use pprof::{ProfilerGuard, protos::Message};

/// Sample CPU for `duration_secs` at `frequency` Hz and return pprof protobuf bytes.
pub async fn dump_cpu_profile(duration_secs: u64, frequency: i32) -> Result<Vec<u8>, String> {
    let guard = ProfilerGuard::new(frequency).map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_secs(duration_secs)).await;
    let report = guard
        .report()
        .build()
        .map_err(|e| format!("Failed to build CPU report: {e}"))?;
    let mut buf = Vec::new();
    report
        .pprof()
        .map_err(|e| format!("Failed to convert CPU profile to pprof: {e}"))?
        .write_to_vec(&mut buf)
        .map_err(|e| format!("Failed to encode CPU pprof: {e}"))?;
    Ok(buf)
}

/// Dump jemalloc heap profile as pprof protobuf bytes.
pub async fn dump_memory_pprof() -> Result<Vec<u8>, String> {
    let prof_ctl = jemalloc_pprof::PROF_CTL
        .as_ref()
        .ok_or_else(|| {
            "Profiling controller not available (jemalloc prof disabled; on macOS ensure _rjem_malloc_conf is linked)"
                .to_string()
        })?;
    let mut prof_ctl = prof_ctl.lock().await;
    if !prof_ctl.activated() {
        prof_ctl
            .activate()
            .map_err(|e| format!("Failed to activate jemalloc profiling: {e}"))?;
    }
    prof_ctl
        .dump_pprof()
        .map_err(|e| format!("Failed to dump memory pprof: {e}"))
}

/// Dump jemalloc heap flamegraph SVG bytes (for `/debug/profile/memory`).
pub async fn dump_memory_flamegraph() -> Result<Vec<u8>, String> {
    let prof_ctl = jemalloc_pprof::PROF_CTL
        .as_ref()
        .ok_or_else(|| {
            "Profiling controller not available (jemalloc prof disabled; on macOS ensure _rjem_malloc_conf is linked)"
                .to_string()
        })?;
    let mut prof_ctl = prof_ctl.lock().await;
    if !prof_ctl.activated() {
        prof_ctl
            .activate()
            .map_err(|e| format!("Failed to activate jemalloc profiling: {e}"))?;
    }
    prof_ctl
        .dump_flamegraph()
        .map_err(|e| format!("Failed to dump memory flamegraph: {e}"))
}

/// Read current jemalloc stats (for `/debug/profile/stats`).
pub fn jemalloc_stats() -> Result<serde_json::Value, String> {
    tikv_jemalloc_ctl::epoch::mib()
        .map_err(|e| format!("Failed to get jemalloc epoch mib: {e}"))?
        .advance()
        .map_err(|e| format!("Failed to advance jemalloc epoch: {e}"))?;

    let allocated = tikv_jemalloc_ctl::stats::allocated::mib()
        .map_err(|e| format!("Failed to get allocated mib: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read allocated: {e}"))?;
    let resident = tikv_jemalloc_ctl::stats::resident::mib()
        .map_err(|e| format!("Failed to get resident mib: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read resident: {e}"))?;
    let metadata = tikv_jemalloc_ctl::stats::metadata::mib()
        .map_err(|e| format!("Failed to get metadata mib: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read metadata: {e}"))?;

    Ok(serde_json::json!({
        "allocated": allocated,
        "resident": resident,
        "metadata": metadata,
        "allocated_mb": allocated as f64 / 1024.0 / 1024.0,
        "resident_mb": resident as f64 / 1024.0 / 1024.0,
        "metadata_mb": metadata as f64 / 1024.0 / 1024.0,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}
