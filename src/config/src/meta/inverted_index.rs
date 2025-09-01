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
}
