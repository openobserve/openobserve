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

//! OSS orchestrator for agent-behavior signals.
//!
//! This layer owns only the I/O: it runs the bounded-key SQL (built in
//! `o2_enterprise::enterprise::agent_signals`) via the shared search path and
//! self-ingests the mapped records. All pure transforms (SQL construction,
//! hit→record mapping) live in the enterprise crate — mirroring how the
//! service-graph feature splits compute (enterprise) from I/O (OSS).

#![cfg(feature = "enterprise")]

use o2_enterprise::enterprise::{
    agent_signals::{
        build_cost_sql, build_failure_sql, build_loop_ratio_sql, map_cost_hits, map_failure_hits,
        map_loop_hits,
    },
    common::config::get_config as get_o2_config,
};

/// Run the three bounded passes for one stream+window and self-ingest the results.
/// Early-returns Ok when the feature is disabled (no query issued).
pub async fn process_agent_signals_stream(
    org_id: &str,
    stream_name: &str,
    start_time: i64,
    end_time: i64,
) -> Result<(), anyhow::Error> {
    if !get_o2_config().agent_signals.enabled {
        return Ok(());
    }
    let ts = end_time; // stamp records at window end

    let mut records = Vec::new();

    // R1 failure taxonomy
    let sql = build_failure_sql(stream_name, start_time, end_time);
    match crate::service::traces::service_graph::run_graph_search(org_id, sql, start_time, end_time)
        .await
    {
        Ok(hits) => records.extend(map_failure_hits(org_id, stream_name, ts, &hits)),
        Err(e) => log::warn!("[AgentSignals] failure pass failed for {org_id}/{stream_name}: {e}"),
    }
    // R2 loop ratio
    let sql = build_loop_ratio_sql(stream_name, start_time, end_time);
    match crate::service::traces::service_graph::run_graph_search(org_id, sql, start_time, end_time)
        .await
    {
        Ok(hits) => records.extend(map_loop_hits(org_id, stream_name, ts, &hits)),
        Err(e) => log::warn!("[AgentSignals] loop pass failed for {org_id}/{stream_name}: {e}"),
    }
    // R4 cost/diagnosis
    let sql = build_cost_sql(stream_name, start_time, end_time);
    match crate::service::traces::service_graph::run_graph_search(org_id, sql, start_time, end_time)
        .await
    {
        Ok(hits) => records.extend(map_cost_hits(org_id, stream_name, ts, &hits)),
        Err(e) => log::warn!("[AgentSignals] cost pass failed for {org_id}/{stream_name}: {e}"),
    }

    super::aggregator::write_agent_signals(org_id, records).await
}

#[cfg(all(test, feature = "enterprise"))]
mod test {
    // process_agent_signals_stream must early-return Ok when disabled — no panic, no query.
    #[tokio::test]
    async fn test_process_stream_noop_when_disabled() {
        // enabled defaults to false; the fn must return Ok without attempting a search.
        let r = super::process_agent_signals_stream("default", "nostream", 0, 1).await;
        assert!(r.is_ok());
    }
}
