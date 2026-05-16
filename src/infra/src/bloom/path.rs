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

//! `.bf` object-store path layout.
//!
//! ```text
//! files/{org}/bloom/{stream_type}/{stream}/{date}/{hour}/{bloom_ver}.bf
//! ```
//!
//! `bloom_ver` is the microsecond build timestamp the compactor stamps on
//! every parquet file in the bucket via `file_list.bloom_ver`. Files share
//! a `.bf` exactly when they share a `bloom_ver`.

use config::meta::stream::StreamType;

/// Build the `.bf` object-store key for a given hour-bucket.
///
/// `date` is expected in the same `YYYY/MM/DD/HH` format used elsewhere in
/// `file_list.date` — we split on `/` and use the first three components as
/// the date dir and the fourth as the hour. Anything after is ignored.
pub fn bloom_path(
    org: &str,
    stream_type: StreamType,
    stream: &str,
    date: &str,
    bloom_ver: i64,
) -> String {
    // `bloom_ver == 0` is the "no .bf" sentinel and must never appear in
    // a path. Hard-assert in all builds — silently emitting `.../0.bf`
    // in release would produce a path that 404s on read and confuses
    // diagnostics.
    assert!(bloom_ver > 0, "bloom_ver=0 means no .bf — caller bug");
    format!("files/{org}/bloom/{stream_type}/{stream}/{date}/{bloom_ver}.bf")
}

/// Directory prefix for all `.bf` files in a single (stream, date/hour)
/// bucket. Useful for listing / GC of orphaned versions.
pub fn bloom_dir(org: &str, stream_type: StreamType, stream: &str, date: &str) -> String {
    format!("files/{org}/bloom/{stream_type}/{stream}/{date}/")
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;

    use super::*;

    #[test]
    fn test_bloom_path_format() {
        let p = bloom_path(
            "default",
            StreamType::Logs,
            "nginx",
            "2026/05/08/14",
            1_715_169_600_000_000,
        );
        assert_eq!(
            p,
            "files/default/bloom/logs/nginx/2026/05/08/14/1715169600000000.bf"
        );
    }

    #[test]
    fn test_bloom_dir_format() {
        let d = bloom_dir("acme", StreamType::Traces, "frontend", "2026/05/08/14");
        assert_eq!(d, "files/acme/bloom/traces/frontend/2026/05/08/14/");
    }

    #[test]
    fn test_path_under_dir() {
        // sanity: the file path always starts with the dir prefix.
        let dir = bloom_dir("o", StreamType::Logs, "s", "2026/05/08/14");
        let path = bloom_path("o", StreamType::Logs, "s", "2026/05/08/14", 42);
        assert!(path.starts_with(&dir));
    }

    #[test]
    #[should_panic(expected = "bloom_ver=0 means no .bf")]
    fn test_zero_bloom_ver_panics() {
        let _ = bloom_path("o", StreamType::Logs, "s", "2026/05/08/14", 0);
    }
}
