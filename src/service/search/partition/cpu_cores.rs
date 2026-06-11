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

use config::{get_config, meta::cluster::RoleGroup};
use infra::{cluster::get_cached_online_querier_nodes, errors::Error};

use super::sql_context::PartitionSqlContext;

/// Resolves the effective CPU core count for the querier nodes that will
/// actually handle this query, then estimates the total seconds required.
///
/// On enterprise, the configured node selection strategy (e.g. "org" or
/// "stream") determines which subset of online querier nodes are used, so
/// only the selected nodes' CPU cores are summed. On community edition, all
/// online querier nodes are summed.
pub(crate) async fn estimated_secs(
    trace_id: &str,
    _ctx: &PartitionSqlContext,
    role_group: Option<RoleGroup>,
    original_size: usize,
) -> Result<usize, Error> {
    let nodes = get_cached_online_querier_nodes(role_group)
        .await
        .unwrap_or_default();
    if nodes.is_empty() {
        log::error!("[trace_id {trace_id}] search_partition: no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    #[cfg(feature = "enterprise")]
    let cpu_cores = {
        let stream_key = _ctx.sql.get_first_stream_key();
        let selected = o2_enterprise::enterprise::search::admission::node_selection::select_nodes(
            &_ctx.sql.org_id,
            &stream_key,
            nodes,
            role_group,
        )
        .await;
        selected.iter().map(|n| n.cpu_num).sum::<u64>() as usize
    };

    #[cfg(not(feature = "enterprise"))]
    let cpu_cores = nodes.iter().map(|n| n.cpu_num).sum::<u64>() as usize;

    let cfg = get_config();
    let mut total_secs = original_size / cfg.limit.query_group_base_speed / cpu_cores;
    if total_secs * cfg.limit.query_group_base_speed * cpu_cores < original_size {
        total_secs += 1;
    }

    log::info!(
        "[trace_id {trace_id}] search_partition: selected {cpu_cores} CPU cores, estimated {total_secs}s"
    );

    Ok(total_secs)
}
