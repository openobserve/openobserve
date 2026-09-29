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

#[cfg(feature = "enterprise")]
use {
    crate::{
        db::agent_signals::{OFFSET_KEY, get_offset, seed_offset_from_v1, set_offset},
        traces::service_graph::{
            discover_trace_streams, run_graph_search,
            v4::{
                MAX_BACKLOG_MICROS, MAX_WINDOWS_PER_TICK,
                schedule::{
                    ClaimDecision, claim_decision, initial_offset, node_alive, window_ends,
                },
                sql::build_q0,
            },
        },
    },
    config::{
        cluster::LOCAL_NODE,
        meta::stream::StreamType,
        utils::time::{SECOND_MICRO_SECS, now_micros},
    },
    infra::dist_lock,
    o2_enterprise::enterprise::{
        agent_signals::{
            build_cost_sql, build_failure_sql, build_loop_ratio_sql, map_cost_hits,
            map_failure_hits, map_loop_hits,
        },
        common::config::get_config as get_o2_config,
    },
};

use crate::traces::service_graph::v4::sql::{AgentForm, Columns, Q0Row, agent_form};

/// Which passes one stream-window runs, and the ancestor form of R1 and R2.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PassPlan {
    pub form: AgentForm,
    pub loop_ratio: bool,
}

/// Scheduler tick: one global offset held by a single node, one window per processing interval.
#[cfg(feature = "enterprise")]
pub async fn process_agent_signals() -> Result<(), anyhow::Error> {
    seed_offset_from_v1().await?;
    let (offset, node) = get_offset().await?;
    let offset = match claim_decision(&node, &LOCAL_NODE.uuid, node_alive(&node).await) {
        ClaimDecision::Skip => return Ok(()),
        ClaimDecision::Owned => offset,
        ClaimDecision::Claim => match claim_offset().await? {
            Some(offset) => offset,
            None => return Ok(()),
        },
    };

    let interval =
        get_o2_config().agent_signals.processing_interval_secs as i64 * SECOND_MICRO_SECS;
    let horizon = now_micros() - config::get_config().limit.cache_delay_secs * SECOND_MICRO_SECS;
    let (planned, jumped) = initial_offset(offset, horizon, interval, MAX_BACKLOG_MICROS);
    if jumped {
        log::warn!("[AgentSignals] offset {offset} too far behind, skipping [{offset}, {planned})");
    }
    // a zero offset re-aligns to the horizon every tick unless the aligned value is stored
    if planned != offset {
        set_offset(planned, &LOCAL_NODE.uuid).await?;
    }
    let ends = window_ends(planned, horizon, interval, MAX_WINDOWS_PER_TICK);
    let Some(&last_end) = ends.last() else {
        return Ok(());
    };

    let streams = match discover_trace_streams(planned, last_end).await {
        Ok(streams) => streams,
        Err(e) => {
            log::error!(
                "[AgentSignals] Failed to get trace streams from usage, skipping tick: {e}"
            );
            return Ok(());
        }
    };
    log::info!(
        "[AgentSignals] Processing {} windows from {planned} to {last_end} over {} trace streams",
        ends.len(),
        streams.len()
    );
    for end in ends {
        let start = end - interval;
        for (org_id, stream_name) in &streams {
            if let Err(e) = process_agent_signals_stream(org_id, stream_name, start, end).await {
                log::error!("[AgentSignals] Failed for stream {org_id}/{stream_name}: {e}");
            }
        }
        set_offset(end, &LOCAL_NODE.uuid).await?;
    }
    Ok(())
}

/// Failed Q0 (`None`): all passes, Flat. Zero gen_ai spans skips only R2; R1/R4 admit more spans.
pub fn pass_plan(cols: &Columns, q0: Option<Q0Row>) -> PassPlan {
    match q0 {
        Some(row) => PassPlan {
            form: agent_form(
                cols,
                row.orphan_tool_spans.saturating_add(row.orphan_model_spans),
            ),
            loop_ratio: row.gen_ai_spans > 0,
        },
        None => PassPlan {
            form: AgentForm::Flat,
            loop_ratio: true,
        },
    }
}

/// The pre-lock read may be stale, so ownership is decided again on a re-read under the lock.
#[cfg(feature = "enterprise")]
async fn claim_offset() -> Result<Option<i64>, anyhow::Error> {
    let locker = dist_lock::lock(OFFSET_KEY, 0).await?;
    let claimed = claim_locked().await;
    if let Err(e) = dist_lock::unlock(&locker).await {
        log::warn!("[AgentSignals] claim unlock failed: {e}");
    }
    claimed
}

#[cfg(feature = "enterprise")]
async fn claim_locked() -> Result<Option<i64>, anyhow::Error> {
    let (offset, node) = get_offset().await?;
    if claim_decision(&node, &LOCAL_NODE.uuid, node_alive(&node).await) == ClaimDecision::Skip {
        return Ok(None);
    }
    set_offset(offset, &LOCAL_NODE.uuid).await?;
    Ok(Some(offset))
}

/// Run the three bounded passes for one stream+window and self-ingest the results.
///
/// Agent signals are always on (no enable flag); the work self-limits via the
/// stream-level LLM gate below (skip non-gen_ai streams) and the per-span activity
/// gate in the SQL, so a non-LLM instance issues no meaningful queries.
#[cfg(feature = "enterprise")]
async fn process_agent_signals_stream(
    org_id: &str,
    stream_name: &str,
    start_time: i64,
    end_time: i64,
) -> Result<(), anyhow::Error> {
    let ts = end_time; // stamp records at window end

    // Schema-gate each pass: streams from different frameworks carry different
    // columns. Referencing a missing column is a hard search error, so only run a
    // pass when its required columns exist (mirrors the service-graph gating).
    let Ok(schema) = infra::schema::get(org_id, stream_name, StreamType::Traces).await else {
        return Ok(());
    };
    let has_field = |name: &str| schema.field_with_name(name).is_ok();

    // Stream-level LLM gate: skip streams whose schema carries no gen_ai columns at
    // all — they are plain service/HTTP trace streams (e.g. an OTel demo app), not
    // agent telemetry, so none of the three passes can produce a meaningful signal.
    // Mirrors the service-graph's `has_gen_ai` gate (keyed on `gen_ai_operation_name`
    // presence), keeping the two rollups' notion of "is this an LLM stream" in sync
    // and avoiding three wasted searches per window on non-agent streams. This is a
    // coarse schema-level filter; the per-span `gen_ai_activity` predicate in the
    // failure/cost SQL is what removes non-agent spans on a MIXED stream (where the
    // column exists but most spans are infra traffic).
    if !has_field("gen_ai_operation_name") {
        return Ok(());
    }
    let cols = Columns::from_schema(&schema);
    // the gate `build_q0` applies: without an agent, tool or model column no pass runs
    if !cols.has_gen_ai() {
        return Ok(());
    }

    // Failure classification reads the resolved taxonomy (org override → repo file
    // → embedded fallback), not a hardcoded set. Keep ONLY the configured columns
    // that actually exist on this stream — referencing a missing column is a hard
    // search error, so the SQL must COALESCE existing columns only.
    let taxonomy = crate::system_settings::get_agent_signals_taxonomy(org_id).await;
    let detail_fields: Vec<String> = taxonomy
        .error_detail_fields
        .iter()
        .filter(|f| has_field(f))
        .cloned()
        .collect();
    let has_failure_cols = !detail_fields.is_empty();
    let has_tool = has_field("gen_ai_tool_name");
    let has_cost = has_field("gen_ai_usage_cost");
    // The failure/cost passes gate out non-agent (infra) spans via the gen_ai
    // activity predicate, which references gen_ai_agent_id. Frameworks that never
    // emit an agent id don't carry that column, so schema-gate it here — a missing
    // column in the predicate would be a hard search error.
    let has_agent_id = has_field("gen_ai_agent_id");
    // env/version come from optional resource attrs and are absent on many trace
    // streams. Schema-gate them so the signal SQL never SELECTs/GROUP-BYs a missing
    // column (a hard search error that would silently sink the whole pass) — same
    // rationale as `has_agent_id`.
    let has_agent_env = has_field("gen_ai_agent_env");
    let has_agent_version = has_field("gen_ai_agent_version");

    // Q0 only picks the R1/R2 form and gates R2, so a stream where neither can run skips it
    let plan = if has_failure_cols || has_tool {
        window_plan(org_id, stream_name, &cols, start_time, end_time).await
    } else {
        PassPlan {
            form: AgentForm::Flat,
            loop_ratio: false,
        }
    };
    let join = plan.form == AgentForm::Join;
    let mut records = Vec::new();

    // R1 failure taxonomy — classify from the configured error-detail columns,
    // using the configured (evolvable) failure-rule taxonomy.
    if has_failure_cols {
        let sql = build_failure_sql(
            stream_name,
            start_time,
            end_time,
            &detail_fields,
            &taxonomy.failure_rules,
            has_agent_id,
            has_agent_env,
            has_agent_version,
            join,
        );
        match run_graph_search(org_id, sql, start_time, end_time).await {
            Ok(hits) => records.extend(map_failure_hits(org_id, stream_name, ts, &hits)),
            Err(e) => {
                log::warn!("[AgentSignals] failure pass failed for {org_id}/{stream_name}: {e}")
            }
        }
    }
    // R2 loop ratio — needs gen_ai_tool_name.
    if has_tool && plan.loop_ratio {
        let sql = build_loop_ratio_sql(
            stream_name,
            start_time,
            end_time,
            has_agent_env,
            has_agent_version,
            join,
        );
        match run_graph_search(org_id, sql, start_time, end_time).await {
            Ok(hits) => records.extend(map_loop_hits(org_id, stream_name, ts, &hits)),
            Err(e) => log::warn!("[AgentSignals] loop pass failed for {org_id}/{stream_name}: {e}"),
        }
    }
    // R4 cost/diagnosis — needs gen_ai_usage_cost.
    if has_cost {
        let sql = build_cost_sql(
            stream_name,
            start_time,
            end_time,
            has_agent_id,
            has_agent_env,
            has_agent_version,
        );
        match run_graph_search(org_id, sql, start_time, end_time).await {
            Ok(hits) => records.extend(map_cost_hits(org_id, stream_name, ts, &hits)),
            Err(e) => log::warn!("[AgentSignals] cost pass failed for {org_id}/{stream_name}: {e}"),
        }
    }

    super::aggregator::write_agent_signals(org_id, records).await
}

/// Callers gate on `Columns::has_gen_ai`, so `build_q0` always builds a query here.
#[cfg(feature = "enterprise")]
async fn window_plan(
    org_id: &str,
    stream_name: &str,
    cols: &Columns,
    start_time: i64,
    end_time: i64,
) -> PassPlan {
    let row = match build_q0(cols, stream_name, start_time, end_time) {
        Some(sql) => match run_graph_search(org_id, sql, start_time, end_time).await {
            Ok(hits) => Some(hits.first().map(Q0Row::parse).unwrap_or_default()),
            Err(e) => {
                log::error!(
                    "[AgentSignals] {org_id}/{stream_name}: Q0 failed for window {end_time}: {e}"
                );
                None
            }
        },
        None => None,
    };
    let plan = pass_plan(cols, row);
    log::debug!(
        "[AgentSignals] {org_id}/{stream_name}: window [{start_time}, {end_time}): plan {plan:?}, Q0 {row:?}"
    );
    plan
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::traces::service_graph::v4::sql::build_q0;

    fn q0(gen_ai_spans: u64, orphan_tool_spans: u64, orphan_model_spans: u64) -> Option<Q0Row> {
        Some(Q0Row {
            gen_ai_spans,
            orphan_tool_spans,
            orphan_model_spans,
        })
    }

    #[test]
    fn test_pass_plan_operation_and_cost_only_window_keeps_failure_and_cost() {
        let sql = build_q0(&Columns::all(), "s", 0, 1).unwrap();
        assert!(!sql.contains("gen_ai_operation_name"));
        assert!(!sql.contains("gen_ai_usage_cost"));
        assert_eq!(
            pass_plan(&Columns::all(), q0(0, 0, 0)),
            PassPlan {
                form: AgentForm::Flat,
                loop_ratio: false,
            }
        );
    }

    #[test]
    fn test_pass_plan_failed_q0_runs_all_flat() {
        assert_eq!(
            pass_plan(&Columns::all(), None),
            PassPlan {
                form: AgentForm::Flat,
                loop_ratio: true,
            }
        );
    }

    #[test]
    fn test_pass_plan_orphans_pick_join() {
        let cols = Columns::all();
        assert_eq!(pass_plan(&cols, q0(5, 1, 0)).form, AgentForm::Join);
        assert_eq!(pass_plan(&cols, q0(5, 0, 2)).form, AgentForm::Join);
        assert_eq!(pass_plan(&cols, q0(5, 0, 0)).form, AgentForm::Flat);
        assert_eq!(
            pass_plan(&cols, q0(5, u64::MAX, u64::MAX)).form,
            AgentForm::Join
        );
        assert!(pass_plan(&cols, q0(5, 1, 0)).loop_ratio);
    }

    #[test]
    fn test_pass_plan_join_needs_columns() {
        let no_parent = Columns {
            reference_parent_span_id: false,
            ..Columns::all()
        };
        let no_agent = Columns {
            gen_ai_agent_name: false,
            ..Columns::all()
        };
        for cols in [no_parent, no_agent] {
            assert_eq!(pass_plan(&cols, q0(5, 3, 3)).form, AgentForm::Flat);
        }
    }

    // A stream that doesn't exist (no schema, so no gen_ai columns) must hit the
    // stream-level LLM gate and return Ok without attempting any search — no panic,
    // no query. Agent signals are always on, so the gate (not an enable flag) is
    // what makes this a no-op.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn test_process_stream_noop_for_non_llm_stream() {
        let r = super::process_agent_signals_stream("default", "nostream", 0, 1).await;
        assert!(r.is_ok());
    }
}
