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
pub mod sql_context;
pub mod stream_files;

use config::get_config;
use openobserve_search_service::partition::PartitionSpec;

use crate::service::search::partition::{
    settings::PartitionSettings, sql_context::PartitionSqlContext,
};

pub mod settings {
    pub use openobserve_search_service::partition::PartitionSettings;

    use super::sql_context::PartitionSqlContext;

    pub fn calculate_partition_settings(
        trace_id: &str,
        total_secs: usize,
        ctx: &PartitionSqlContext,
        skip_max_query_range: bool,
        max_query_range: i64,
    ) -> PartitionSettings {
        let input = openobserve_search_service::partition::PartitionSettingsInput {
            start_time: ctx.sql.time_range.0,
            end_time: ctx.sql.time_range.1,
            histogram_interval: ctx.sql.histogram_interval,
            is_complex_query: ctx.is_complex_query,
            has_ts_column: ctx.ts_column.is_some(),
        };
        openobserve_search_service::partition::calculate_partition_settings(
            trace_id,
            total_secs,
            &input,
            skip_max_query_range,
            max_query_range,
        )
    }
}

/// Generate partitions for a time range derived from the SQL context.
///
/// # Returns
/// Vector of [start, end] time ranges in microseconds
pub fn generate_partitions(
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
    openobserve_search_service::partition::generate_partitions(
        &spec,
        partition_settings,
        get_config().limit.search_mini_partition_duration_secs,
    )
}
