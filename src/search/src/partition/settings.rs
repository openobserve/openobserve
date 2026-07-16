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

use crate::{
    partition::sql_context::PartitionSqlContext,
    sql::visitor::histogram_interval::{
        convert_histogram_interval_to_seconds, generate_histogram_interval,
    },
};

pub struct PartitionSettings {
    pub min_step: i64,
    pub step: i64,
}

pub fn calculate_partition_settings(
    trace_id: &str,
    total_secs: usize,
    ctx: &PartitionSqlContext,
    skip_max_query_range: bool,
    max_query_range: i64,
) -> PartitionSettings {
    let cfg = get_config();
    let query_partition_by_secs = cfg.limit.query_partition_by_secs;
    let query_partition_max_num = cfg.limit.query_partition_max_num;
    let start_time = ctx.sql.time_range.0;
    let end_time = ctx.sql.time_range.1;
    let histogram_interval = ctx.sql.histogram_interval;
    let is_complex_query = ctx.is_complex_query;
    let has_ts_column = ctx.ts_column.is_some();

    let mut part_num = max(1, total_secs / query_partition_by_secs);
    if part_num * query_partition_by_secs < total_secs {
        part_num += 1;
    }
    // if the partition number is too large, we limit it to ENV ZO_QUERY_PARTITION_MAX_NUM
    let max_partition_num = query_partition_max_num.max(1);
    if part_num > max_partition_num {
        part_num = max_partition_num;
    }

    // Calculate step with all constraints
    let mut min_step = Duration::try_seconds(1)
        .unwrap()
        .num_microseconds()
        .unwrap();
    if is_complex_query && has_ts_column {
        let hist_int = if let Some(hist_int) = histogram_interval {
            hist_int
        } else {
            let interval = generate_histogram_interval((start_time, end_time));
            match convert_histogram_interval_to_seconds(interval) {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "[trace_id {trace_id}] search_partition: convert_histogram_interval_to_seconds error: {e:?}",
                    );
                    10
                }
            }
        };
        // add a check if histogram interval is greater than 0 to avoid panic with min_step being 0
        if hist_int > 0 {
            min_step *= hist_int;
        }
    }

    let mut step = (end_time - start_time) / part_num as i64;
    // step must be times of min_step
    if step < min_step {
        step = min_step;
    }
    // Align step with min_step to ensure partition boundaries match histogram intervals
    if min_step > 0 && step % min_step > 0 {
        // If step is not perfectly divisible by min_step, round it down to the nearest multiple
        // Example: If min_step = 5 minutes  and step = 17 minutes
        //   step % min_step = 17 % 5 = 2 (2 minutes)
        //   step = 17 - 2 = 15 (15 minutes, which is divisible by 5)
        step = step - step % min_step;
    }
    // this is to ensure we create partitions less than max_query_range
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
