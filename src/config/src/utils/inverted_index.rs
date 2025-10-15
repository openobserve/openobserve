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

use std::borrow::Cow;

use crate::{FILE_EXT_PARQUET, FILE_EXT_TANTIVY, meta::stream::StreamType};

/// tantivy inverted index solution has a 1:1 mapping between parquet and idx files.
/// This is a helper function to convert the parquet file name to tantivy file name.
/// e.g.
/// from: files/default/logs/quickstart1/2024/02/16/16/7164299619311026293.parquet
/// to:   files/default/index/quickstart1_logs/2024/02/16/16/7164299619311026293.ttv
pub fn convert_parquet_file_name_to_tantivy_file(from: &str) -> Option<String> {
    let mut parts: Vec<Cow<str>> = from.split('/').map(Cow::Borrowed).collect();

    if parts.len() < 4 {
        return None;
    }

    // Replace the stream_type part
    let stream_type_pos = 2;
    let stream_type = match parts[stream_type_pos].as_ref() {
        "logs" => StreamType::Logs,
        "metrics" => StreamType::Metrics,
        "traces" => StreamType::Traces,
        "metadata" => StreamType::Metadata,
        _ => return None,
    };
    parts[stream_type_pos] = Cow::Borrowed("index");

    // Replace the stream_name part
    let stream_name_pos = stream_type_pos + 1;
    parts[stream_name_pos] = Cow::Owned(format!("{}_{}", parts[stream_name_pos], stream_type));

    // Replace the file extension
    let file_name_pos = parts.len() - 1;
    if !parts[file_name_pos].ends_with(FILE_EXT_PARQUET) {
        return None;
    }
    parts[file_name_pos] =
        Cow::Owned(parts[file_name_pos].replace(FILE_EXT_PARQUET, FILE_EXT_TANTIVY));

    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_parquet_file_name_to_tantivy_file() {
        let test_cases = vec![
            (
                "files/default/logs/quickstart1/2024/02/16/16/7164299619311026293.parquet",
                Some(
                    "files/default/index/quickstart1_logs/2024/02/16/16/7164299619311026293.ttv"
                        .to_string(),
                ),
            ),
            (
                "files/default/metrics/quickstart1/2024/02/16/16/7164299619311026293.parquet",
                Some(
                    "files/default/index/quickstart1_metrics/2024/02/16/16/7164299619311026293.ttv"
                        .to_string(),
                ),
            ),
            (
                "files/default/traces/quickstart1/2024/02/16/16/7164299619311026293.parquet",
                Some(
                    "files/default/index/quickstart1_traces/2024/02/16/16/7164299619311026293.ttv"
                        .to_string(),
                ),
            ),
            (
                "files/default/metadata/quickstart1/2024/02/16/16/7164299619311026293.parquet",
                Some(
                    "files/default/index/quickstart1_metadata/2024/02/16/16/7164299619311026293.ttv"
                        .to_string(),
                ),
            ),
            (
                "files/default/index/quickstart1/2024/02/16/16/7164299619311026293.parquet",
                None,
            ),
        ];

        for (input, expected) in test_cases {
            assert_eq!(convert_parquet_file_name_to_tantivy_file(input), expected);
        }
    }
}
