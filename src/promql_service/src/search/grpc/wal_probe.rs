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

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use config::{RwAHashMap, meta::cluster::NodeInfo};
use futures::future::join_all;
use infra::{client::grpc::make_grpc_metrics_client, cluster::get_cached_online_ingester_nodes};
use promql::ast::selector_window::SelectorWindow;
use proto::cluster_rpc::WalMinTsRequest;

use super::{wal_floor, wal_head};

/// A late sample arriving after a cached probe stays unseen this long, well inside the result
/// cache delay.
const CACHE_TTL: Duration = Duration::from_secs(10);
const PROBE_TIMEOUT_SECS: u64 = 5;

/// key: `org/stream`, val: the oldest unflushed sample across the ingesters, and when it was probed
static CACHE: LazyLock<RwAHashMap<String, (Option<i64>, Instant)>> =
    LazyLock::new(Default::default);

/// The time from which the streams' groups must read the WAL, 0 when an ingester could not tell.
pub(crate) async fn wal_start_time(trace_id: &str, org_id: &str, streams: &HashSet<String>) -> i64 {
    let mut oldest = None;
    let mut missing = Vec::new();
    {
        let cache = CACHE.read().await;
        for stream in streams {
            match cache.get(&cache_key(org_id, stream)) {
                Some((min_ts, at)) if at.elapsed() < CACHE_TTL => oldest = older(oldest, *min_ts),
                _ => missing.push(stream.clone()),
            }
        }
    }
    if !missing.is_empty() {
        let Some(probed) = probe(trace_id, org_id, &missing).await else {
            return 0;
        };
        let now = Instant::now();
        let mut cache = CACHE.write().await;
        for stream in missing {
            let min_ts = probed.get(&stream).copied();
            oldest = older(oldest, min_ts);
            cache.insert(cache_key(org_id, &stream), (min_ts, now));
        }
    }
    late_floor(oldest, wal_head(), wal_floor())
}

/// Whether some group of `[start, end]` reads the WAL only when it holds late samples.
pub(crate) fn needs_probe(window: &SelectorWindow, start: i64, end: i64) -> bool {
    window.reaches(end, wal_floor()) && !window.reaches(start, wal_head())
}

/// The oldest unflushed sample per stream across all ingesters, `None` when one did not answer.
async fn probe(trace_id: &str, org_id: &str, streams: &[String]) -> Option<HashMap<String, i64>> {
    let nodes = get_cached_online_ingester_nodes().await.unwrap_or_default();
    let tasks = nodes.into_iter().map(|node| async move {
        let node: Arc<dyn NodeInfo> = Arc::new(node);
        let mut request = tonic::Request::new(WalMinTsRequest {
            org_id: org_id.to_string(),
            streams: streams.to_vec(),
        });
        let mut client =
            make_grpc_metrics_client(trace_id, org_id, &mut request, &node, PROBE_TIMEOUT_SECS)
                .await
                .map_err(|e| e.to_string())?;
        client
            .wal_min_ts(request)
            .await
            .map(|resp| resp.into_inner().min_ts)
            .map_err(|e| format!("node {}: {e}", node.get_grpc_addr()))
    });
    let mut answers = Vec::new();
    for result in join_all(tasks).await {
        match result {
            Ok(answer) => answers.push(answer),
            Err(e) => {
                log::warn!(
                    "[trace_id {trace_id}] promql->wal->probe: {e}, reading the whole ingest window"
                );
                return None;
            }
        }
    }
    Some(merge_oldest(answers))
}

fn merge_oldest(answers: Vec<HashMap<String, i64>>) -> HashMap<String, i64> {
    let mut merged: HashMap<String, i64> = HashMap::new();
    for (stream, min_ts) in answers.into_iter().flatten() {
        if min_ts > 0 {
            merged
                .entry(stream)
                .and_modify(|ts| *ts = (*ts).min(min_ts))
                .or_insert(min_ts);
        }
    }
    merged
}

/// Without late samples the WAL is read from its head, as it was before the window widened; never
/// further back than `floor`, the oldest a sample the ingest window accepts can wait.
fn late_floor(oldest: Option<i64>, head: i64, floor: i64) -> i64 {
    oldest
        .filter(|ts| *ts < head)
        .map_or(head, |ts| ts.max(floor))
}

fn older(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

fn cache_key(org_id: &str, stream: &str) -> String {
    format!("{org_id}/{stream}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_late_floor_reads_from_the_head_without_late_samples() {
        assert_eq!(late_floor(None, 100, 10), 100);
        assert_eq!(late_floor(Some(100), 100, 10), 100);
        assert_eq!(late_floor(Some(150), 100, 10), 100);
    }

    #[test]
    fn test_late_floor_reaches_back_to_the_oldest_late_sample() {
        assert_eq!(late_floor(Some(40), 100, 10), 40);
    }

    #[test]
    fn test_late_floor_never_reaches_past_the_ingest_window() {
        assert_eq!(late_floor(Some(5), 100, 10), 10);
    }

    #[test]
    fn test_merge_oldest_takes_the_minimum_and_ignores_empty_streams() {
        let answers = vec![
            HashMap::from([("a".to_string(), 50), ("b".to_string(), 0)]),
            HashMap::from([("a".to_string(), 30), ("c".to_string(), 70)]),
        ];
        let merged = merge_oldest(answers);
        assert_eq!(merged.get("a"), Some(&30));
        assert_eq!(merged.get("b"), None);
        assert_eq!(merged.get("c"), Some(&70));
    }

    #[test]
    fn test_older_keeps_the_known_minimum() {
        assert_eq!(older(None, None), None);
        assert_eq!(older(Some(3), None), Some(3));
        assert_eq!(older(None, Some(4)), Some(4));
        assert_eq!(older(Some(3), Some(4)), Some(3));
    }

    #[test]
    fn test_needs_probe_only_when_groups_end_between_floor_and_head() {
        let window = SelectorWindow::default();
        let head = wal_head();
        let floor = wal_floor();
        // entirely older than the ingest window: never reads the WAL
        assert!(!needs_probe(&window, floor - 20, floor - 10));
        // entirely inside the head: always reads the WAL
        assert!(!needs_probe(&window, head + 1_000_000, head + 2_000_000));
        assert!(needs_probe(&window, floor + 10, head + 1_000_000));
    }
}
