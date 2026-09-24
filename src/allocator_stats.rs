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

//! jemalloc statistics as `zo_allocator_bytes{allocator,stat}`.
//!
//! `resident` minus `allocated` is what the allocator holds beyond live objects;
//! without it, RSS growth cannot be told apart from a growing cache.

#[cfg(feature = "jemalloc")]
const INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);

pub fn start() {
    #[cfg(feature = "jemalloc")]
    tokio::spawn(async {
        let mut interval = tokio::time::interval(INTERVAL);
        loop {
            interval.tick().await;
            for (stat, bytes) in read() {
                config::metrics::ALLOCATOR_BYTES
                    .with_label_values(&["jemalloc", stat])
                    .set(bytes as i64);
            }
        }
    });
}

#[cfg(feature = "jemalloc")]
fn read() -> Vec<(&'static str, usize)> {
    use tikv_jemalloc_ctl::{epoch, stats};
    if epoch::advance().is_err() {
        return Vec::new();
    }
    [
        ("allocated", stats::allocated::read()),
        ("active", stats::active::read()),
        ("resident", stats::resident::read()),
        ("mapped", stats::mapped::read()),
        ("retained", stats::retained::read()),
        ("metadata", stats::metadata::read()),
    ]
    .into_iter()
    .filter_map(|(stat, value)| value.ok().map(|v| (stat, v)))
    .collect()
}
