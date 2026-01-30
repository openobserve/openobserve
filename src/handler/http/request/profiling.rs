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
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(feature = "jemalloc")]
use axum::{body::Body, http::header};
use config::get_config;

/// GET /api/debug/profile/memory
///
/// Generate a memory profile (heap dump) in jeprof format.
/// The profile can be analyzed with jeprof or converted to flamegraph.
///
/// Returns: Binary profile data
#[cfg(feature = "jemalloc")]
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

#[cfg(not(feature = "jemalloc"))]
pub async fn memory_profile() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Memory profiling is not available"})),
    )
        .into_response()
}

/// GET /api/debug/profile/pprof
///
/// Get a memory profile in pprof format (protobuf).
/// Returns the binary pprof data directly in the response.
///
/// Returns: Binary pprof data (application/octet-stream)
#[cfg(feature = "jemalloc")]
pub async fn memory_pprof() -> Result<impl IntoResponse, (StatusCode, String)> {
    let prof_ctl = jemalloc_pprof::PROF_CTL.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Profiling controller not available".to_string(),
        )
    })?;

    let mut prof_ctl = prof_ctl.lock().await;

    if !prof_ctl.activated() {
        return Err((
            StatusCode::FORBIDDEN,
            "Jemalloc profiling is not activated".to_string(),
        ));
    }

    let pprof_data = prof_ctl.dump_pprof().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to dump pprof: {e}"),
        )
    })?;

    Ok(pprof_data)
}

#[cfg(not(feature = "jemalloc"))]
pub async fn memory_pprof() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Memory profiling is not available"})),
    )
        .into_response()
}

/// GET /api/debug/profile/flamegraph
///
/// Get a memory profile flamegraph in SVG format.
/// Returns the SVG flamegraph directly in the response.
///
/// Returns: SVG image (image/svg+xml)
#[cfg(feature = "jemalloc")]
pub async fn memory_flamegraph() -> Result<impl IntoResponse, (StatusCode, String)> {
    let prof_ctl = jemalloc_pprof::PROF_CTL.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "Profiling controller not available".to_string(),
        )
    })?;

    let mut prof_ctl = prof_ctl.lock().await;

    if !prof_ctl.activated() {
        return Err((
            StatusCode::FORBIDDEN,
            "Jemalloc profiling is not activated".to_string(),
        ));
    }

    let svg_data = prof_ctl.dump_flamegraph().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to dump flamegraph: {e}"),
        )
    })?;

    Response::builder()
        .header(header::CONTENT_TYPE, "image/svg+xml")
        .body(Body::from(svg_data))
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to build response: {e}"),
            )
        })
}

#[cfg(not(feature = "jemalloc"))]
pub async fn memory_flamegraph() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Memory profiling is not available"})),
    )
        .into_response()
}

/// GET /api/debug/profile/stats
///
/// Get current jemalloc memory statistics.
///
/// Returns: JSON with memory statistics including:
/// - allocated: Current allocated memory (bytes)
/// - resident: Current resident memory (bytes)
/// - metadata: Metadata overhead (bytes)
#[cfg(feature = "jemalloc")]
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

#[cfg(not(feature = "jemalloc"))]
pub async fn jemalloc_stats() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Jemalloc statistics not available. "})),
    )
        .into_response()
}
