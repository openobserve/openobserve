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

//! Data requests counted in memory and flushed once a minute per link, never touching rev (5.5).

use std::sync::LazyLock;

use config::{metrics, utils::time::now_micros};
use dashmap::DashMap;
use infra::{db::get_orm_client_rw, table::public_dashboards as pd_table};

/// How often the counters are written.
pub const FLUSH_INTERVAL_SECS: i64 = 60;

/// Link id to (requests since the last flush, latest request time).
static COUNTS: LazyLock<DashMap<String, (i64, i64)>> = LazyLock::new(DashMap::new);

/// Counts one data request, a 304 included.
pub fn record(link_id: &str, at: i64) {
    let mut entry = COUNTS.entry(link_id.to_string()).or_insert((0, 0));
    entry.0 += 1;
    entry.1 = entry.1.max(at);
}

/// Writes every link's counters; a failed write keeps its counts for the next tick.
pub async fn flush() {
    let db = get_orm_client_rw().await;
    for (id, count, at) in drain() {
        if let Err(e) = pd_table::flush_access(db, &id, at, count).await {
            log::warn!("public link {id} access flush failed: {e}");
            restore(&id, count, at);
        }
    }
    match pd_table::count_by_org_status(db, now_micros()).await {
        Ok(rows) => {
            metrics::PUBLIC_DASHBOARD_LINKS.reset();
            for (org, status, n) in rows {
                metrics::PUBLIC_DASHBOARD_LINKS
                    .with_label_values(&[&org, status])
                    .set(n);
            }
        }
        Err(e) => log::warn!("public link count failed: {e}"),
    }
}

fn drain() -> Vec<(String, i64, i64)> {
    let ids: Vec<String> = COUNTS.iter().map(|e| e.key().clone()).collect();
    ids.into_iter()
        .filter_map(|id| COUNTS.remove(&id))
        .map(|(id, (count, at))| (id, count, at))
        .collect()
}

fn restore(id: &str, count: i64, at: i64) {
    let mut entry = COUNTS.entry(id.to_string()).or_insert((0, 0));
    entry.0 += count;
    entry.1 = entry.1.max(at);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_counted_per_link_and_a_failed_flush_keeps_them() {
        let id = config::ider::uuid();
        record(&id, 10);
        record(&id, 30);
        record(&id, 20);
        let mine = |rows: Vec<(String, i64, i64)>| rows.into_iter().find(|r| r.0 == id);
        let (_, count, at) = mine(drain()).unwrap();
        assert_eq!((count, at), (3, 30));
        assert!(mine(drain()).is_none(), "a flush clears the counters");
        restore(&id, count, at);
        record(&id, 25);
        assert_eq!(mine(drain()).map(|r| (r.1, r.2)), Some((4, 30)));
    }
}
