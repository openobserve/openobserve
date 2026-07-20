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

pub mod aggregate;
pub mod cpu_cores;
mod histogram;
mod regular_partition;
pub mod settings;
pub mod sql_context;
pub mod stream_files;

use config::{
    get_config,
    meta::{sql::OrderBy, stream::StreamType},
};
use histogram::generate_partitions_aligned_with_histogram_interval;
use infra::{errors::Error, file_list::FileId};
use regular_partition::generate_partitions_with_mini_partition;
pub use settings::{PartitionSettings, PartitionSettingsInput, calculate_partition_settings};

use self::sql_context::PartitionSqlContext;
use crate::cache::CacheRuntime;

#[async_trait::async_trait]
pub trait PartitionRuntime: CacheRuntime {
    async fn query_file_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<FileId>, Error>;

    async fn settings_max_query_range(
        &self,
        stream_max_query_range: i64,
        org_id: &str,
        user_id: Option<&str>,
    ) -> i64;
}

pub struct PartitionSpec {
    pub start_time: i64,
    pub end_time: i64,
    pub histogram_interval: Option<i64>,
    pub is_complex_query: bool,
    pub order_by: OrderBy,
}

pub fn generate_partitions(
    spec: &PartitionSpec,
    settings: &PartitionSettings,
    mini_partition_duration_secs: u64,
) -> Vec<[i64; 2]> {
    if spec.histogram_interval.is_some() {
        generate_partitions_aligned_with_histogram_interval(
            spec.start_time,
            spec.end_time,
            settings.step,
            spec.order_by,
            settings.min_step,
        )
    } else if spec.is_complex_query {
        vec![[spec.start_time, spec.end_time]]
    } else {
        generate_partitions_with_mini_partition(
            spec.start_time,
            spec.end_time,
            settings.step,
            spec.order_by,
            mini_partition_duration_secs,
        )
    }
}

pub fn calculate_partition_settings_for_context(
    trace_id: &str,
    total_secs: usize,
    ctx: &PartitionSqlContext,
    skip_max_query_range: bool,
    max_query_range: i64,
) -> PartitionSettings {
    let input = PartitionSettingsInput {
        start_time: ctx.sql.time_range.0,
        end_time: ctx.sql.time_range.1,
        histogram_interval: ctx.sql.histogram_interval,
        is_complex_query: ctx.is_complex_query,
        has_ts_column: ctx.ts_column.is_some(),
    };
    calculate_partition_settings(
        trace_id,
        total_secs,
        &input,
        skip_max_query_range,
        max_query_range,
    )
}

pub fn generate_partitions_for_context(
    ctx: &PartitionSqlContext,
    partition_settings: &PartitionSettings,
) -> Vec<[i64; 2]> {
    let spec = PartitionSpec {
        start_time: ctx.sql.time_range.0,
        end_time: ctx.sql.time_range.1,
        histogram_interval: ctx.sql.histogram_interval,
        is_complex_query: ctx.is_complex_query,
        order_by: ctx.sql_order_by,
    };
    generate_partitions(
        &spec,
        partition_settings,
        get_config().limit.search_mini_partition_duration_secs,
    )
}
