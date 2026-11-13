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

#[cfg(any(feature = "mimalloc", test))]
use std::time::Duration;

use axum::response::Response;
#[cfg(not(feature = "mimalloc"))]
use axum::{Json, http::StatusCode, response::IntoResponse};
#[cfg(any(feature = "mimalloc", test))]
use serde::Serialize;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[cfg(not(feature = "mimalloc"))]
const NOT_SUPPORTED: &str = "memory release needs a build with the `mimalloc` feature";

#[cfg(any(feature = "mimalloc", test))]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct MemorySnapshot {
    rss: usize,
    commit: usize,
}

#[cfg(any(feature = "mimalloc", test))]
#[derive(Debug, PartialEq, Eq, Serialize)]
struct MemoryReleaseResponse {
    rss_before: usize,
    rss_after: usize,
    rss_released: i64,
    commit_before: usize,
    commit_after: usize,
    commit_released: i64,
    elapsed_ms: u64,
}

#[cfg(any(feature = "mimalloc", test))]
impl MemoryReleaseResponse {
    fn new(before: MemorySnapshot, after: MemorySnapshot, elapsed: Duration) -> Self {
        Self {
            rss_before: before.rss,
            rss_after: after.rss,
            rss_released: before.rss as i64 - after.rss as i64,
            commit_before: before.commit,
            commit_after: after.commit,
            commit_released: before.commit as i64 - after.commit as i64,
            elapsed_ms: elapsed.as_millis() as u64,
        }
    }
}

/// Forces mimalloc to purge freed memory back to the OS and reports RSS/commit before and after.
pub async fn release_memory() -> Response {
    #[cfg(feature = "mimalloc")]
    {
        // A forced collect purges every arena, which can take a while on a large heap.
        match tokio::task::spawn_blocking(collect).await {
            Ok(resp) => MetaHttpResponse::json(resp),
            Err(e) => MetaHttpResponse::internal_error(e),
        }
    }
    #[cfg(not(feature = "mimalloc"))]
    {
        not_supported()
    }
}

#[cfg(feature = "mimalloc")]
fn collect() -> MemoryReleaseResponse {
    let start = std::time::Instant::now();
    let before = snapshot();
    // SAFETY: mi_collect takes no pointers and is safe to call from any thread.
    unsafe { libmimalloc_sys::mi_collect(true) };
    let after = snapshot();
    let resp = MemoryReleaseResponse::new(before, after, start.elapsed());
    log::info!("[NODE] mimalloc forced collect: {resp:?}");
    resp
}

#[cfg(feature = "mimalloc")]
fn snapshot() -> MemorySnapshot {
    MemorySnapshot {
        rss: config::utils::sysinfo::get_memory_usage(),
        commit: mimalloc_current_commit(),
    }
}

// Release mimalloc purges on Unix with madvise and keeps the range counted as committed,
// so this stays flat after a purge; Linux RSS is what drops.
#[cfg(feature = "mimalloc")]
fn mimalloc_current_commit() -> usize {
    let (mut elapsed, mut user, mut system) = (0usize, 0usize, 0usize);
    let (mut rss, mut peak_rss, mut commit, mut peak_commit, mut faults) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    // SAFETY: every out-pointer refers to a live, writable usize on this stack frame.
    unsafe {
        libmimalloc_sys::mi_process_info(
            &mut elapsed,
            &mut user,
            &mut system,
            &mut rss,
            &mut peak_rss,
            &mut commit,
            &mut peak_commit,
            &mut faults,
        );
    }
    commit
}

#[cfg(not(feature = "mimalloc"))]
fn not_supported() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(MetaHttpResponse::error(
            StatusCode::NOT_IMPLEMENTED,
            NOT_SUPPORTED,
        )),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode};

    use super::*;

    #[test]
    fn response_reports_bytes_released_and_growth_as_negative() {
        let before = MemorySnapshot {
            rss: 1_000,
            commit: 800,
        };
        let after = MemorySnapshot {
            rss: 1_200,
            commit: 300,
        };
        let resp = MemoryReleaseResponse::new(before, after, Duration::from_micros(2_500));
        assert_eq!(
            resp,
            MemoryReleaseResponse {
                rss_before: 1_000,
                rss_after: 1_200,
                rss_released: -200,
                commit_before: 800,
                commit_after: 300,
                commit_released: 500,
                elapsed_ms: 2,
            }
        );
    }

    #[test]
    fn response_serializes_flat_fields() {
        let resp = MemoryReleaseResponse::new(
            MemorySnapshot::default(),
            MemorySnapshot::default(),
            Duration::ZERO,
        );
        let value = serde_json::to_value(&resp).unwrap();
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "commit_after",
                "commit_before",
                "commit_released",
                "elapsed_ms",
                "rss_after",
                "rss_before",
                "rss_released",
            ]
        );
    }

    #[cfg(not(feature = "mimalloc"))]
    #[tokio::test]
    async fn without_mimalloc_release_is_not_implemented() {
        let resp = release_memory().await;
        assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], 501);
        assert_eq!(body["message"], NOT_SUPPORTED);
    }

    #[cfg(feature = "mimalloc")]
    #[tokio::test]
    async fn with_mimalloc_release_reports_live_numbers() {
        let resp = release_memory().await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(body["rss_before"].as_u64().unwrap() > 0);
        assert!(body["rss_after"].as_u64().unwrap() > 0);
    }
}
