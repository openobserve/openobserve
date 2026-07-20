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

use std::cmp::max;

use chrono::Duration;
use config::get_config;
use search::sql::visitor::histogram_interval::{
    convert_histogram_interval_to_seconds, generate_histogram_interval,
};

pub struct PartitionSettings {
    pub min_step: i64,
    pub step: i64,
}

/// SQL-derived values needed to calculate partition size without coupling the
/// planner to an application-specific SQL context.
pub struct PartitionSettingsInput {
    pub start_time: i64,
    pub end_time: i64,
    pub histogram_interval: Option<i64>,
    pub is_complex_query: bool,
    pub has_ts_column: bool,
}

pub fn calculate_partition_settings(
    trace_id: &str,
    total_secs: usize,
    input: &PartitionSettingsInput,
    skip_max_query_range: bool,
    max_query_range: i64,
) -> PartitionSettings {
    let cfg = get_config();
    let query_partition_by_secs = cfg.limit.query_partition_by_secs;
    let query_partition_max_num = cfg.limit.query_partition_max_num;
    let mut part_num = max(1, total_secs / query_partition_by_secs);
    if part_num * query_partition_by_secs < total_secs {
        part_num += 1;
    }
    part_num = part_num.min(query_partition_max_num.max(1));

    let mut min_step = Duration::try_seconds(1)
        .unwrap()
        .num_microseconds()
        .unwrap();
    if input.is_complex_query && input.has_ts_column {
        let histogram_seconds = input.histogram_interval.unwrap_or_else(|| {
            let interval = generate_histogram_interval((input.start_time, input.end_time));
            convert_histogram_interval_to_seconds(interval).unwrap_or_else(|error| {
                log::error!(
                    "[trace_id {trace_id}] search_partition: convert_histogram_interval_to_seconds error: {error:?}"
                );
                10
            })
        });
        if histogram_seconds > 0 {
            min_step *= histogram_seconds;
        }
    }

    let mut step = (input.end_time - input.start_time) / part_num as i64;
    if step < min_step {
        step = min_step;
    }
    if min_step > 0 && step % min_step > 0 {
        step -= step % min_step;
    }
    if !skip_max_query_range && max_query_range > 0 && step > max_query_range {
        step = if min_step < max_query_range {
            max_query_range - max_query_range % min_step
        } else {
            max_query_range
        };
    }

    log::info!(
        "[trace_id {trace_id}] search_partition: base_speed: {}, partition_secs: {}, total_secs: {total_secs}, part_num: {part_num}, step: {step}, min_step: {min_step}",
        cfg.limit.query_group_base_speed,
        cfg.limit.query_partition_by_secs,
    );

    PartitionSettings { min_step, step }
}
