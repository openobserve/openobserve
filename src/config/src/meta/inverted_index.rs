// Copyright 2025 OpenObserve Inc.
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

use proto::cluster_rpc;

pub const UNKNOWN_NAME: &str = "__o2__unknown__field__";

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub enum IndexOptimizeMode {
    SimpleSelect(usize, bool),
    SimpleCount,
    SimpleHistogram(i64, u64, usize),
    SimpleTopN(String, usize, bool),
    SimpleDistinct(String, usize, bool),
}

impl IndexOptimizeMode {
    pub fn to_rule_string(&self) -> String {
        match self {
            IndexOptimizeMode::SimpleSelect(limit, ascend) => format!("s(l:{limit},a:{ascend})"),
            IndexOptimizeMode::SimpleCount => "c".to_string(),
            IndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets) => {
                format!("h(m:{min_value},b:{bucket_width},n:{num_buckets})")
            }
            IndexOptimizeMode::SimpleTopN(field, limit, ascend) => {
                format!("t(f{field},l:{limit},a:{ascend})")
            }
            IndexOptimizeMode::SimpleDistinct(field, limit, ascend) => {
                format!("d(f:{field},l:{limit},a:{ascend})")
            }
        }
    }
}

impl std::fmt::Display for IndexOptimizeMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexOptimizeMode::SimpleSelect(limit, ascend) => {
                write!(f, "select(limit: {limit}, ascend: {ascend})")
            }
            IndexOptimizeMode::SimpleCount => write!(f, "count"),
            IndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets) => {
                write!(
                    f,
                    "histogram(min_value: {min_value}, bucket_width: {bucket_width}, num_buckets: {num_buckets})"
                )
            }
            IndexOptimizeMode::SimpleTopN(field, limit, ascend) => {
                write!(f, "topn(field: {field}, limit: {limit}, ascend: {ascend})")
            }
            IndexOptimizeMode::SimpleDistinct(field, limit, ascend) => {
                write!(
                    f,
                    "distinct(field: {field}, limit: {limit}, ascend: {ascend})"
                )
            }
        }
    }
}

impl From<cluster_rpc::IdxOptimizeMode> for IndexOptimizeMode {
    fn from(cluster_rpc_mode: cluster_rpc::IdxOptimizeMode) -> Self {
        match cluster_rpc_mode.mode {
            Some(cluster_rpc::idx_optimize_mode::Mode::SimpleTopn(select)) => {
                IndexOptimizeMode::SimpleTopN(select.field, select.limit as usize, select.asc)
            }
            Some(cluster_rpc::idx_optimize_mode::Mode::SimpleDistinct(select)) => {
                IndexOptimizeMode::SimpleDistinct(select.field, select.limit as usize, select.asc)
            }
            None => panic!("Invalid IndexOptimizeMode"),
        }
    }
}

impl From<IndexOptimizeMode> for cluster_rpc::IdxOptimizeMode {
    fn from(mode: IndexOptimizeMode) -> Self {
        match mode {
            IndexOptimizeMode::SimpleTopN(field, limit, asc) => cluster_rpc::IdxOptimizeMode {
                mode: Some(cluster_rpc::idx_optimize_mode::Mode::SimpleTopn(
                    cluster_rpc::SimpleTopN {
                        field,
                        limit: limit as u32,
                        asc,
                    },
                )),
            },
            IndexOptimizeMode::SimpleDistinct(field, limit, asc) => cluster_rpc::IdxOptimizeMode {
                mode: Some(cluster_rpc::idx_optimize_mode::Mode::SimpleDistinct(
                    cluster_rpc::SimpleDistinct {
                        field,
                        limit: limit as u32,
                        asc,
                    },
                )),
            },
            other => panic!("Invalid IndexOptimizeMode: {other:?}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_index_optimize_mode_display_formatting() {
        // Test all Display implementations for each variant
        let test_cases = [
            (
                IndexOptimizeMode::SimpleSelect(100, true),
                "select(limit: 100, ascend: true)",
            ),
            (
                IndexOptimizeMode::SimpleSelect(50, false),
                "select(limit: 50, ascend: false)",
            ),
            (IndexOptimizeMode::SimpleCount, "count"),
            (
                IndexOptimizeMode::SimpleHistogram(0, 10, 5),
                "histogram(min_value: 0, bucket_width: 10, num_buckets: 5)",
            ),
            (
                IndexOptimizeMode::SimpleHistogram(-100, 25, 20),
                "histogram(min_value: -100, bucket_width: 25, num_buckets: 20)",
            ),
            (
                IndexOptimizeMode::SimpleTopN("cpu_usage".to_string(), 10, true),
                "topn(field: cpu_usage, limit: 10, ascend: true)",
            ),
            (
                IndexOptimizeMode::SimpleTopN("memory_usage".to_string(), 5, false),
                "topn(field: memory_usage, limit: 5, ascend: false)",
            ),
            (
                IndexOptimizeMode::SimpleDistinct("user_id".to_string(), 100, true),
                "distinct(field: user_id, limit: 100, ascend: true)",
            ),
            (
                IndexOptimizeMode::SimpleDistinct("session_id".to_string(), 25, false),
                "distinct(field: session_id, limit: 25, ascend: false)",
            ),
        ];

        for (mode, expected) in test_cases {
            assert_eq!(mode.to_string(), expected);
        }
    }

    #[test]
    fn test_from_cluster_rpc_to_index_optimize_mode() {
        // Test conversion from cluster_rpc::IdxOptimizeMode to IndexOptimizeMode
        use cluster_rpc::{IdxOptimizeMode, SimpleDistinct, SimpleTopN, idx_optimize_mode::Mode};

        let test_cases = [
            (
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleTopn(SimpleTopN {
                        field: "cpu_usage".to_string(),
                        limit: 10,
                        asc: true,
                    })),
                },
                IndexOptimizeMode::SimpleTopN("cpu_usage".to_string(), 10, true),
            ),
            (
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleTopn(SimpleTopN {
                        field: "memory_usage".to_string(),
                        limit: 5,
                        asc: false,
                    })),
                },
                IndexOptimizeMode::SimpleTopN("memory_usage".to_string(), 5, false),
            ),
            (
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleDistinct(SimpleDistinct {
                        field: "user_id".to_string(),
                        limit: 100,
                        asc: true,
                    })),
                },
                IndexOptimizeMode::SimpleDistinct("user_id".to_string(), 100, true),
            ),
            (
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleDistinct(SimpleDistinct {
                        field: "session_id".to_string(),
                        limit: 25,
                        asc: false,
                    })),
                },
                IndexOptimizeMode::SimpleDistinct("session_id".to_string(), 25, false),
            ),
        ];

        for (cluster_rpc_mode, expected) in test_cases {
            let result: IndexOptimizeMode = cluster_rpc_mode.into();
            assert_eq!(result, expected);
        }
    }

    #[test]
    fn test_from_index_optimize_mode_to_cluster_rpc() {
        // Test conversion from IndexOptimizeMode to cluster_rpc::IdxOptimizeMode
        use cluster_rpc::{IdxOptimizeMode, SimpleDistinct, SimpleTopN, idx_optimize_mode::Mode};

        let test_cases = [
            (
                IndexOptimizeMode::SimpleTopN("cpu_usage".to_string(), 10, true),
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleTopn(SimpleTopN {
                        field: "cpu_usage".to_string(),
                        limit: 10,
                        asc: true,
                    })),
                },
            ),
            (
                IndexOptimizeMode::SimpleTopN("memory_usage".to_string(), 5, false),
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleTopn(SimpleTopN {
                        field: "memory_usage".to_string(),
                        limit: 5,
                        asc: false,
                    })),
                },
            ),
            (
                IndexOptimizeMode::SimpleDistinct("user_id".to_string(), 100, true),
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleDistinct(SimpleDistinct {
                        field: "user_id".to_string(),
                        limit: 100,
                        asc: true,
                    })),
                },
            ),
            (
                IndexOptimizeMode::SimpleDistinct("session_id".to_string(), 25, false),
                IdxOptimizeMode {
                    mode: Some(Mode::SimpleDistinct(SimpleDistinct {
                        field: "session_id".to_string(),
                        limit: 25,
                        asc: false,
                    })),
                },
            ),
        ];

        for (mode, expected) in test_cases {
            let result: IdxOptimizeMode = mode.into();
            assert_eq!(result, expected);
        }
    }

    #[test]
    fn test_round_trip_conversions() {
        // Test that converting from IndexOptimizeMode to cluster_rpc and back preserves the
        // original
        let test_modes = [
            IndexOptimizeMode::SimpleTopN("cpu_usage".to_string(), 10, true),
            IndexOptimizeMode::SimpleTopN("memory_usage".to_string(), 5, false),
            IndexOptimizeMode::SimpleDistinct("user_id".to_string(), 100, true),
            IndexOptimizeMode::SimpleDistinct("session_id".to_string(), 25, false),
        ];

        for original_mode in test_modes {
            let cluster_rpc_mode: cluster_rpc::IdxOptimizeMode = original_mode.clone().into();
            let converted_back: IndexOptimizeMode = cluster_rpc_mode.into();
            assert_eq!(original_mode, converted_back);
        }
    }

    #[test]
    #[should_panic(expected = "Invalid IndexOptimizeMode")]
    fn test_invalid_cluster_rpc_mode_panics() {
        // Test that converting from an invalid cluster_rpc mode panics
        let invalid_mode = cluster_rpc::IdxOptimizeMode { mode: None };
        let _: IndexOptimizeMode = invalid_mode.into();
    }

    #[test]
    fn test_edge_cases_and_boundaries() {
        // Test edge cases and boundary values
        let edge_cases = [
            // Zero values
            IndexOptimizeMode::SimpleTopN("".to_string(), 0, false),
            IndexOptimizeMode::SimpleDistinct("".to_string(), 0, true),
            // Large values (using u32::MAX to avoid overflow in conversion)
            IndexOptimizeMode::SimpleTopN(
                "very_long_field_name_that_might_exceed_normal_lengths".to_string(),
                u32::MAX as usize,
                true,
            ),
            IndexOptimizeMode::SimpleDistinct(
                "another_very_long_field_name".to_string(),
                u32::MAX as usize,
                false,
            ),
        ];

        for mode in edge_cases {
            // Test that Display doesn't panic
            let display_str = mode.to_string();
            assert!(!display_str.is_empty());

            // Test that conversion to cluster_rpc doesn't panic
            let cluster_rpc_mode: cluster_rpc::IdxOptimizeMode = mode.clone().into();
            assert!(cluster_rpc_mode.mode.is_some());

            // Test round-trip conversion
            let converted_back: IndexOptimizeMode = cluster_rpc_mode.into();
            assert_eq!(mode, converted_back);
        }
    }
}
