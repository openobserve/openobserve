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

use crate::meta::stream::StreamType;

pub const DISTINCT_STREAM_PREFIX: &str = "distinct_values";

pub fn zero_or<T>(v: T, def: T) -> T
where
    T: PartialEq + Default,
{
    if v == Default::default() { def } else { v }
}

pub fn is_power_of_two(n: u64) -> bool {
    n == 0 || (n & (n - 1)) == 0
}

pub fn get_distinct_stream_name(st: StreamType, s: &str) -> String {
    format!("{}_{}_{}", DISTINCT_STREAM_PREFIX, st.as_str(), s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zero_or() {
        assert_eq!(zero_or(0, 1), 1);
        assert_eq!(zero_or(2, 1), 2);
        assert_eq!(zero_or(0, 0), 0);
        assert_eq!(zero_or(0.0, 1.1), 1.1);
        assert_eq!(zero_or(2.1, 1.1), 2.1);
        assert_eq!(zero_or("", "v"), "v");
        assert_eq!(zero_or("vv", "v"), "vv");
    }

    #[test]
    fn test_is_power_of_two() {
        assert!(is_power_of_two(0));
        assert!(is_power_of_two(1));
        assert!(is_power_of_two(2));
        assert!(!is_power_of_two(3));
        assert!(is_power_of_two(4));
        assert!(!is_power_of_two(5));
        assert!(!is_power_of_two(6));
        assert!(!is_power_of_two(7));
        assert!(is_power_of_two(8));
    }

    #[test]
    fn test_is_power_of_two_large_values() {
        // u64 max powers of two
        assert!(is_power_of_two(1u64 << 32));
        assert!(is_power_of_two(1u64 << 63));
        assert!(!is_power_of_two((1u64 << 63) - 1));
        assert!(!is_power_of_two(u64::MAX));
    }

    #[test]
    fn test_get_distinct_stream_name_logs() {
        assert_eq!(
            get_distinct_stream_name(StreamType::Logs, "app"),
            "distinct_values_logs_app"
        );
    }

    #[test]
    fn test_get_distinct_stream_name_all_types() {
        let cases = [
            (StreamType::Logs, "distinct_values_logs_x"),
            (StreamType::Metrics, "distinct_values_metrics_x"),
            (StreamType::Traces, "distinct_values_traces_x"),
            (StreamType::Metadata, "distinct_values_metadata_x"),
            (StreamType::Index, "distinct_values_index_x"),
            (StreamType::Filelist, "distinct_values_file_list_x"),
            (
                StreamType::EnrichmentTables,
                "distinct_values_enrichment_tables_x",
            ),
            (StreamType::ServiceGraph, "distinct_values_service_graph_x"),
        ];

        for (st, expected) in cases {
            assert_eq!(get_distinct_stream_name(st, "x"), expected);
        }
    }

    #[test]
    fn test_get_distinct_stream_name_empty_name() {
        // The function does not validate the name; an empty string is stitched in.
        assert_eq!(
            get_distinct_stream_name(StreamType::Logs, ""),
            "distinct_values_logs_"
        );
    }

    #[test]
    fn test_distinct_stream_prefix_constant() {
        assert_eq!(DISTINCT_STREAM_PREFIX, "distinct_values");
    }
}
