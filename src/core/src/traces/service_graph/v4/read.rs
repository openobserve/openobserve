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

//! Read side of service graph v4: instant PromQL over the `traces_service_graph_*` metrics.

use std::{
    collections::{BTreeMap, HashMap},
    future::Future,
};

use config::meta::{
    alerts::incidents::EdgeType,
    promql::value::{InstantValue, LabelsExt, Value},
    service_graph::{
        EdgeIdentity, MetricEdge, MetricNode, TopologyInput, TopologyMeta, UnresolvedCounts,
    },
};

use super::{
    PROCESSED_TIMESTAMP_STREAM,
    resolve::{
        CLIENT_TYPE_USER, CLIENT_USER, REASON_AMBIGUOUS, REASON_CARDINALITY, REASON_IP_ONLY,
        REASON_NO_PEER,
    },
    writer::{
        LABEL_TRACE_STREAM, M_AGENT_INSTANCES, M_CLIENT_SECONDS, M_REQUEST_FAILED_TOTAL,
        M_REQUEST_TOTAL, M_SERVER_SECONDS, M_UNRESOLVED_TOTAL,
    },
};

const EDGE_BY: &str = "client, client_type, server, connection_type";
const EDGE_BY_ENV: &str = "client, client_type, server, connection_type, agent_env";
const LABEL_AGENT_ENV: &str = "agent_env";
const QUANTILES: [f64; 3] = [0.5, 0.95, 0.99];
/// The engine ignores `step` on an instant query; any positive value works.
const INSTANT_STEP_MICROS: i64 = 300_000_000;
/// Positions inside a `plan_queries` result; `assemble` reads by these.
const IDX_REQUESTS: usize = 0;
const IDX_FAILED: usize = 1;
const IDX_CLIENT_Q: usize = 2;
const IDX_SERVER_Q: usize = 5;
const IDX_SERVER_COUNT: usize = 8;
const IDX_UNRESOLVED: usize = 9;
const IDX_PROCESSED: usize = 10;
const IDX_INSTANCES: usize = 11;
const IDX_BASELINE_Q: usize = 12;
const IDX_ORG_INBOUND: usize = 15;
const IDX_ORG_SERVER_COUNT: usize = 16;
const PLAN_LEN_UNFILTERED: usize = 15;
const PLAN_LEN_FILTERED: usize = 17;
const PLAN_NAMES: [&str; PLAN_LEN_FILTERED] = [
    "requests",
    "failed",
    "client_p50",
    "client_p95",
    "client_p99",
    "server_p50",
    "server_p95",
    "server_p99",
    "server_count",
    "unresolved",
    "processed",
    "instances",
    "baseline_p50",
    "baseline_p95",
    "baseline_p99",
    "org_inbound",
    "org_server_count",
];
/// The OTel collector's servicegraph connector labels its entry and unresolved edges this way.
const COLLECTOR_VIRTUAL_NODE: &str = "virtual_node";
/// Results read through the edge matcher; an `agent_env` filter is enforced on these rows.
const IDX_EDGE_FAMILY: [usize; 9] = [
    IDX_REQUESTS,
    IDX_FAILED,
    IDX_CLIENT_Q,
    IDX_CLIENT_Q + 1,
    IDX_CLIENT_Q + 2,
    IDX_INSTANCES,
    IDX_BASELINE_Q,
    IDX_BASELINE_Q + 1,
    IDX_BASELINE_Q + 2,
];
const EDGE_QUANTILE_SLOTS: [fn(&mut MetricEdge) -> &mut Option<u64>; 3] =
    [|e| &mut e.p50_ns, |e| &mut e.p95_ns, |e| &mut e.p99_ns];
const NODE_QUANTILE_SLOTS: [fn(&mut MetricNode) -> &mut Option<u64>; 3] =
    [|n| &mut n.p50_ns, |n| &mut n.p95_ns, |n| &mut n.p99_ns];

/// Optional selector narrowing; an empty filter reads the whole org.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReadFilter {
    pub trace_stream: Option<String>,
    pub agent_env: Option<String>,
}

impl ReadFilter {
    pub fn is_empty(&self) -> bool {
        self.trace_stream.is_none() && self.agent_env.is_none()
    }

    fn edge_matcher(&self) -> Result<String, String> {
        let mut parts = Vec::with_capacity(2);
        if let Some(s) = self.trace_stream.as_deref() {
            parts.push(label_eq(LABEL_TRACE_STREAM, s)?);
        }
        if let Some(env) = self.agent_env.as_deref() {
            parts.push(label_eq(LABEL_AGENT_ENV, env)?);
        }
        Ok(parts.join(","))
    }

    /// Node, unresolved and processed series carry no `agent_env` label.
    fn node_matcher(&self) -> Result<String, String> {
        match self.trace_stream.as_deref() {
            None => Ok(String::new()),
            Some(s) => label_eq(LABEL_TRACE_STREAM, s),
        }
    }
}

/// Incidents point query; both names are escaped here so a caller cannot inject a selector.
pub fn q_edge_exists(client: &str, server: &str, range_secs: i64) -> Result<String, String> {
    let matcher = format!(
        "{},{}",
        label_eq("client", client)?,
        label_eq("server", server)?
    );
    Ok(format!(
        "sum(increase({}[{range_secs}s]))",
        selector(M_REQUEST_TOTAL, &matcher)
    ))
}

pub fn edge_type_from(forward: f64) -> EdgeType {
    if forward > 0.0 {
        EdgeType::ServiceDependency
    } else {
        EdgeType::Temporal
    }
}

/// Runs one instant query; the internal call carries no user, so no stream-level RBAC applies.
pub async fn instant(
    org: &str,
    query: &str,
    at_micros: i64,
) -> Result<Vec<InstantValue>, anyhow::Error> {
    let req = promql_service::MetricsQueryRequest {
        query: query.to_string(),
        start: at_micros,
        end: at_micros,
        step: INSTANT_STEP_MICROS,
        query_exemplars: false,
        use_cache: None,
        search_type: None,
        search_event_context: None,
        regions: vec![],
        clusters: vec![],
    };
    #[cfg(not(feature = "enterprise"))]
    let is_super_cluster = false;
    #[cfg(feature = "enterprise")]
    let is_super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    let trace_id = config::ider::generate_trace_id();
    let resp =
        promql_service::search::search(&trace_id, org, &req, "", 0, is_super_cluster).await?;
    match resp {
        Value::Vector(v) => Ok(v),
        Value::Instant(i) => Ok(vec![i]),
        Value::None => Ok(vec![]),
        other => anyhow::bail!(
            "service graph query returned {} instead of a vector: {query}",
            other.get_type()
        ),
    }
}

/// Sum of a scalar-shaped result (`sum(...)`); no rows or NaN read as zero.
pub fn scalar_sum(rows: &[InstantValue]) -> f64 {
    rows.iter().map(|r| count(r.sample.value)).sum()
}

/// Reads the current graph plus the previous same-length range for baselines.
pub async fn fetch_topology(
    org: &str,
    filter: &ReadFilter,
    start: i64,
    end: i64,
) -> Result<(TopologyInput, TopologyMeta), anyhow::Error> {
    fetch_topology_with(filter, start, end, |q, at| async move {
        instant(org, &q, at).await
    })
    .await
}

async fn fetch_topology_with<F, Fut>(
    filter: &ReadFilter,
    start: i64,
    end: i64,
    run: F,
) -> Result<(TopologyInput, TopologyMeta), anyhow::Error>
where
    F: Fn(String, i64) -> Fut,
    Fut: Future<Output = Result<Vec<InstantValue>, anyhow::Error>>,
{
    let range_secs = ((end - start) / 1_000_000).max(1);
    let plan = plan_queries(filter, range_secs, start, end).map_err(anyhow::Error::msg)?;
    let (results, degraded) = settle_plan(run_plan(&plan, run).await)?;
    let (input, mut meta) = assemble(results, filter.agent_env.as_deref())?;
    meta.degraded = degraded;
    Ok((input, meta))
}

/// Never drops a running search: its task and search-server registration would leak.
async fn run_plan<F, Fut>(
    plan: &[(String, i64)],
    run: F,
) -> Vec<Result<Vec<InstantValue>, anyhow::Error>>
where
    F: Fn(String, i64) -> Fut,
    Fut: Future<Output = Result<Vec<InstantValue>, anyhow::Error>>,
{
    futures::future::join_all(plan.iter().map(|(q, at)| run(q.clone(), *at))).await
}

/// Only the edge counts are load-bearing; any other failed query is read as empty and reported.
fn settle_plan(
    results: Vec<Result<Vec<InstantValue>, anyhow::Error>>,
) -> Result<(Vec<Vec<InstantValue>>, Vec<String>), anyhow::Error> {
    let mut degraded = vec![];
    let mut settled = Vec::with_capacity(results.len());
    for (i, r) in results.into_iter().enumerate() {
        let name = PLAN_NAMES.get(i).copied().unwrap_or("query");
        match r {
            Ok(rows) => settled.push(rows),
            Err(e) if i == IDX_REQUESTS || i == IDX_FAILED => {
                return Err(anyhow::anyhow!("{name} query failed: {e}"));
            }
            Err(e) => {
                log::warn!("[ServiceGraph] v4 read: {name} query failed, read as empty: {e}");
                degraded.push(name.to_string());
                settled.push(vec![]);
            }
        }
    }
    Ok((settled, degraded))
}

/// Query text and evaluation time in the fixed order `assemble` consumes.
fn plan_queries(
    filter: &ReadFilter,
    range_secs: i64,
    start: i64,
    end: i64,
) -> Result<Vec<(String, i64)>, String> {
    let e = &filter.edge_matcher()?;
    let n = &filter.node_matcher()?;
    let by_env = filter.agent_env.is_some();
    let mut plan = Vec::with_capacity(PLAN_LEN_FILTERED);
    plan.push((q_requests(e, by_env, range_secs), end));
    plan.push((q_failed(e, by_env, range_secs), end));
    plan.extend(QUANTILES.map(|q| (q_client_quantile(q, e, by_env, range_secs), end)));
    plan.extend(QUANTILES.map(|q| (q_server_quantile(q, n, range_secs), end)));
    plan.push((q_server_count(n, range_secs), end));
    plan.push((q_unresolved(n, range_secs), end));
    plan.push((q_processed(n), end));
    plan.push((q_instances(e, by_env, range_secs), end));
    plan.extend(QUANTILES.map(|q| (q_client_quantile(q, e, by_env, range_secs), start)));
    if !filter.is_empty() {
        plan.push((q_org_inbound(range_secs), end));
        plan.push((q_org_server_count(range_secs), end));
    }
    Ok(plan)
}

/// Joins the results of `plan_queries` (same order) into the topology input.
fn assemble(
    mut results: Vec<Vec<InstantValue>>,
    agent_env: Option<&str>,
) -> Result<(TopologyInput, TopologyMeta), anyhow::Error> {
    let filtered = match results.len() {
        PLAN_LEN_UNFILTERED => false,
        PLAN_LEN_FILTERED => true,
        n => anyhow::bail!(
            "service graph read: {n} results for a plan of {PLAN_LEN_UNFILTERED} or {PLAN_LEN_FILTERED}"
        ),
    };
    if let Some(env) = agent_env {
        scope_to_env(&mut results, env);
    }
    let (edges, collector_unresolved) = assemble_edges(&results);
    let nodes = assemble_nodes(&results);
    let (org_inbound, org_requests_server) = if filtered {
        (
            count_map(&inbound_rows(&results[IDX_ORG_INBOUND])),
            count_map(&label_rows(&results[IDX_ORG_SERVER_COUNT], "server")),
        )
    } else {
        org_maps_from(&edges, &nodes)
    };
    let mut unresolved = unresolved_counts(&results[IDX_UNRESOLVED]);
    unresolved.no_peer += collector_unresolved;
    let meta = TopologyMeta {
        source: "v4".to_string(),
        processed_up_to: processed_up_to(&results[IDX_PROCESSED]),
        unresolved,
        degraded: vec![],
    };
    let input = TopologyInput {
        edges,
        nodes,
        baselines: assemble_baselines(&results),
        org_inbound,
        org_requests_server,
        instances: count_map(&label_rows(&results[IDX_INSTANCES], "server")),
        node_only_services: agent_env.is_none(),
    };
    Ok((input, meta))
}

/// PromQL string-literal escaping; control characters other than newline are refused.
fn escape_label_value(v: &str) -> Result<String, String> {
    let mut out = String::with_capacity(v.len());
    for c in v.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            c if c.is_control() => return Err(format!("control character {c:?} in label value")),
            c => out.push(c),
        }
    }
    Ok(out)
}

fn label_eq(label: &str, value: &str) -> Result<String, String> {
    Ok(format!("{label}=\"{}\"", escape_label_value(value)?))
}

fn selector(metric: &str, matcher: &str) -> String {
    if matcher.is_empty() {
        metric.to_string()
    } else {
        format!("{metric}{{{matcher}}}")
    }
}

fn edge_by(by_env: bool) -> &'static str {
    if by_env { EDGE_BY_ENV } else { EDGE_BY }
}

/// Grouped by `trace_stream` too so the per-stream split can pick a node's stream.
fn q_requests(edge_matcher: &str, by_env: bool, range_secs: i64) -> String {
    format!(
        "sum by ({}, {LABEL_TRACE_STREAM}) (increase({}[{range_secs}s]))",
        edge_by(by_env),
        selector(M_REQUEST_TOTAL, edge_matcher)
    )
}

fn q_failed(edge_matcher: &str, by_env: bool, range_secs: i64) -> String {
    format!(
        "sum by ({}) (increase({}[{range_secs}s]))",
        edge_by(by_env),
        selector(M_REQUEST_FAILED_TOTAL, edge_matcher)
    )
}

fn q_client_quantile(q: f64, edge_matcher: &str, by_env: bool, range_secs: i64) -> String {
    format!(
        "histogram_quantile({q}, sum by (le, {}) (rate({}[{range_secs}s])))",
        edge_by(by_env),
        selector(&format!("{M_CLIENT_SECONDS}_bucket"), edge_matcher)
    )
}

fn q_server_quantile(q: f64, node_matcher: &str, range_secs: i64) -> String {
    format!(
        "histogram_quantile({q}, sum by (le, server) (rate({}[{range_secs}s])))",
        selector(&format!("{M_SERVER_SECONDS}_bucket"), node_matcher)
    )
}

fn q_server_count(node_matcher: &str, range_secs: i64) -> String {
    format!(
        "sum by (server, {LABEL_TRACE_STREAM}) (increase({}[{range_secs}s]))",
        selector(&format!("{M_SERVER_SECONDS}_count"), node_matcher)
    )
}

fn q_unresolved(node_matcher: &str, range_secs: i64) -> String {
    format!(
        "sum by (reason) (increase({}[{range_secs}s]))",
        selector(M_UNRESOLVED_TOTAL, node_matcher)
    )
}

fn q_processed(node_matcher: &str) -> String {
    format!(
        "max({})",
        selector(PROCESSED_TIMESTAMP_STREAM, node_matcher)
    )
}

/// The gauge's `server` is the agent of the Q4 edge it rides on.
fn q_instances(edge_matcher: &str, by_env: bool, range_secs: i64) -> String {
    let by = if by_env {
        "server, agent_env"
    } else {
        "server"
    };
    format!(
        "sum by ({by}) (max_over_time({}[{range_secs}s]))",
        selector(M_AGENT_INSTANCES, edge_matcher)
    )
}

/// Grouped, not matched: the writer omits an empty `connection_type` and `=""` skips null rows.
fn q_org_inbound(range_secs: i64) -> String {
    format!("sum by (server, connection_type) (increase({M_REQUEST_TOTAL}[{range_secs}s]))")
}

fn q_org_server_count(range_secs: i64) -> String {
    format!("sum by (server) (increase({M_SERVER_SECONDS}_count[{range_secs}s]))")
}

fn edge_rows(rows: &[InstantValue]) -> Vec<(EdgeIdentity, f64)> {
    rows.iter()
        .map(|r| (edge_identity(r), r.sample.value))
        .collect()
}

fn edge_stream_rows(rows: &[InstantValue]) -> Vec<(EdgeIdentity, String, f64)> {
    rows.iter()
        .map(|r| {
            (
                edge_identity(r),
                r.labels.get_value(LABEL_TRACE_STREAM),
                r.sample.value,
            )
        })
        .collect()
}

fn server_stream_rows(rows: &[InstantValue]) -> Vec<(String, String, f64)> {
    rows.iter()
        .map(|r| {
            (
                r.labels.get_value("server"),
                r.labels.get_value(LABEL_TRACE_STREAM),
                r.sample.value,
            )
        })
        .collect()
}

/// Instrumented inbound per server from `q_org_inbound` rows; a missing label reads as "".
fn inbound_rows(rows: &[InstantValue]) -> Vec<(String, f64)> {
    rows.iter()
        .filter(|r| r.labels.get_value("connection_type").is_empty())
        .map(|r| (r.labels.get_value("server"), r.sample.value))
        .collect()
}

fn label_rows(rows: &[InstantValue], label: &str) -> Vec<(String, f64)> {
    rows.iter()
        .map(|r| (r.labels.get_value(label), r.sample.value))
        .collect()
}

/// A collector `user` virtual node is our entry edge; other virtual-node edges stay marked to be
/// dropped.
fn edge_identity(r: &InstantValue) -> EdgeIdentity {
    let l = &r.labels;
    let client = l.get_value("client");
    let connection_type = l.get_value("connection_type");
    if connection_type == COLLECTOR_VIRTUAL_NODE && client == CLIENT_USER {
        return (
            client,
            CLIENT_TYPE_USER.to_string(),
            l.get_value("server"),
            String::new(),
        );
    }
    (
        client,
        l.get_value("client_type"),
        l.get_value("server"),
        connection_type,
    )
}

/// A counter value; the engine yields NaN for an empty range, which is "no requests".
fn count(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

/// Quantile seconds to whole nanoseconds; NaN means the histogram had no samples.
fn secs_to_ns(v: f64) -> Option<u64> {
    v.is_finite().then(|| (v * 1e9).round() as u64)
}

/// The engine skips a matcher on a label the stream never stored, so the filter is re-applied here.
fn scope_to_env(results: &mut [Vec<InstantValue>], env: &str) {
    for idx in IDX_EDGE_FAMILY {
        results[idx].retain(|r| {
            r.labels
                .iter()
                .find(|l| l.name == LABEL_AGENT_ENV)
                .map_or("", |l| l.value.as_str())
                == env
        });
    }
}

fn count_map(rows: &[(String, f64)]) -> HashMap<String, f64> {
    let mut m: HashMap<String, f64> = HashMap::new();
    for (k, v) in rows {
        *m.entry(k.clone()).or_default() += count(*v);
    }
    m
}

/// A series without a `trace_stream` label has no stream to link to, so it adds none.
fn add_stream(streams: &mut Vec<(String, f64)>, stream: String, v: f64) {
    if stream.is_empty() {
        return;
    }
    match streams.iter_mut().find(|(s, _)| *s == stream) {
        Some((_, total)) => *total += v,
        None => streams.push((stream, v)),
    }
}

/// Without a filter the org-scope operands are the filtered rows themselves.
fn org_maps_from(
    edges: &[MetricEdge],
    nodes: &[MetricNode],
) -> (HashMap<String, f64>, HashMap<String, f64>) {
    let mut inbound: HashMap<String, f64> = HashMap::new();
    for e in edges.iter().filter(|e| e.connection_type.is_empty()) {
        *inbound.entry(e.server.clone()).or_default() += e.requests;
    }
    let servers = nodes
        .iter()
        .map(|n| (n.server.clone(), n.requests_server))
        .collect();
    (inbound, servers)
}

/// Counts create the edge; a quantile row without a count row is ignored.
/// Edges plus the requests of collector edges to `unknown`, which have no server to draw.
fn assemble_edges(results: &[Vec<InstantValue>]) -> (Vec<MetricEdge>, u64) {
    let mut edges: BTreeMap<EdgeIdentity, MetricEdge> = BTreeMap::new();
    for (id, stream, v) in edge_stream_rows(&results[IDX_REQUESTS]) {
        let e = edges.entry(id).or_default();
        e.requests += count(v);
        add_stream(&mut e.streams, stream, count(v));
    }
    for (id, v) in edge_rows(&results[IDX_FAILED]) {
        edges.entry(id).or_default().errors += count(v);
    }
    for (i, pick) in EDGE_QUANTILE_SLOTS.into_iter().enumerate() {
        for (id, v) in edge_rows(&results[IDX_CLIENT_Q + i]) {
            if let Some(e) = edges.get_mut(&id) {
                *pick(e) = secs_to_ns(v);
            }
        }
    }
    let mut unresolved = 0.0;
    let edges = edges
        .into_iter()
        .filter(|((_, _, _, connection_type), e)| {
            if connection_type == COLLECTOR_VIRTUAL_NODE {
                unresolved += e.requests;
            }
            connection_type != COLLECTOR_VIRTUAL_NODE
        })
        .map(|((client, client_type, server, connection_type), mut e)| {
            e.streams.sort_by(|a, b| a.0.cmp(&b.0));
            MetricEdge {
                client,
                client_type,
                server,
                connection_type,
                ..e
            }
        })
        .collect();
    (edges, unresolved.round() as u64)
}

fn assemble_nodes(results: &[Vec<InstantValue>]) -> Vec<MetricNode> {
    let mut nodes: BTreeMap<String, MetricNode> = BTreeMap::new();
    for (server, stream, v) in server_stream_rows(&results[IDX_SERVER_COUNT]) {
        let n = nodes.entry(server).or_default();
        n.requests_server += count(v);
        add_stream(&mut n.streams, stream, count(v));
    }
    for (i, pick) in NODE_QUANTILE_SLOTS.into_iter().enumerate() {
        for (server, v) in label_rows(&results[IDX_SERVER_Q + i], "server") {
            if let Some(n) = nodes.get_mut(&server) {
                *pick(n) = secs_to_ns(v);
            }
        }
    }
    nodes
        .into_iter()
        .map(|(server, mut n)| {
            n.streams.sort_by(|a, b| a.0.cmp(&b.0));
            MetricNode { server, ..n }
        })
        .collect()
}

/// A baseline needs all three quantiles; a partially NaN histogram yields none.
fn assemble_baselines(results: &[Vec<InstantValue>]) -> HashMap<EdgeIdentity, (u64, u64, u64)> {
    let mut acc: HashMap<EdgeIdentity, [Option<u64>; 3]> = HashMap::new();
    for i in 0..QUANTILES.len() {
        for (id, v) in edge_rows(&results[IDX_BASELINE_Q + i]) {
            acc.entry(id).or_default()[i] = secs_to_ns(v);
        }
    }
    acc.into_iter()
        .filter_map(|(id, q)| Some((id, (q[0]?, q[1]?, q[2]?))))
        .collect()
}

fn processed_up_to(rows: &[InstantValue]) -> Option<i64> {
    rows.iter()
        .map(|r| r.sample.value)
        .filter(|v| v.is_finite())
        .reduce(f64::max)
        .map(|v| v as i64)
}

fn unresolved_counts(rows: &[InstantValue]) -> UnresolvedCounts {
    let mut u = UnresolvedCounts::default();
    for (reason, v) in label_rows(rows, "reason") {
        let n = count(v).round().max(0.0) as u64;
        match reason.as_str() {
            REASON_NO_PEER => u.no_peer += n,
            REASON_IP_ONLY => u.ip_only += n,
            REASON_AMBIGUOUS => u.ambiguous += n,
            REASON_CARDINALITY => u.cardinality += n,
            _ => {}
        }
    }
    u
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use arrow::{
        array::{ArrayRef, Float64Array, Int64Array, StringArray, UInt64Array},
        datatypes::{DataType, Field, Schema},
        record_batch::RecordBatch,
    };
    use config::meta::{
        promql::{
            HASH_LABEL, NAME_LABEL, VALUE_LABEL,
            value::{Label, QueryContext, Sample},
        },
        search::ScanStats,
    };
    use datafusion::{datasource::MemTable, prelude::SessionContext};
    use promql::exec::PromqlContext;

    use super::*;

    const M: &str = "trace_stream=\"default\"";
    const ENV: &str = "agent_env=\"prod\"";
    const BOTH: &str = "trace_stream=\"default\",agent_env=\"prod\"";
    const SECOND: i64 = 1_000_000;
    const BASE: i64 = 1_000 * SECOND;

    /// One `request_total` series per `(client, agent_env)`; `None` env writes a null label cell.
    struct RequestTotalProvider {
        ctx: SessionContext,
        schema: Arc<Schema>,
    }

    impl RequestTotalProvider {
        fn new(with_env_column: bool, series: &[(&str, Option<&str>)]) -> Self {
            let mut fields = vec![
                Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new(HASH_LABEL, DataType::UInt64, false),
                Field::new(VALUE_LABEL, DataType::Float64, false),
                Field::new(NAME_LABEL, DataType::Utf8, true),
                Field::new("client", DataType::Utf8, true),
                Field::new("server", DataType::Utf8, true),
                Field::new("trace_stream", DataType::Utf8, true),
            ];
            if with_env_column {
                fields.push(Field::new("agent_env", DataType::Utf8, true));
            }
            let schema = Arc::new(Schema::new(fields));
            let rows: Vec<(usize, i64)> = (0..series.len())
                .flat_map(|i| (0..10).map(move |step| (i, step)))
                .collect();
            let text = |f: &dyn Fn(usize) -> Option<String>| -> ArrayRef {
                Arc::new(StringArray::from_iter(rows.iter().map(|(i, _)| f(*i))))
            };
            let mut columns: Vec<ArrayRef> = vec![
                Arc::new(Int64Array::from_iter_values(
                    rows.iter().map(|(_, step)| BASE + step * 20 * SECOND),
                )),
                Arc::new(UInt64Array::from_iter_values(
                    rows.iter().map(|(i, _)| *i as u64 + 1),
                )),
                Arc::new(Float64Array::from_iter_values(
                    rows.iter().map(|(_, step)| (step * 3) as f64),
                )),
                text(&|_| Some(M_REQUEST_TOTAL.to_string())),
                text(&|i| Some(series[i].0.to_string())),
                text(&|_| Some("b".to_string())),
                text(&|_| Some("default".to_string())),
            ];
            if with_env_column {
                columns.push(text(&|i| series[i].1.map(str::to_string)));
            }
            let batch = RecordBatch::try_new(schema.clone(), columns).unwrap();
            let ctx = SessionContext::new();
            let table = MemTable::try_new(schema.clone(), vec![vec![batch]]).unwrap();
            ctx.register_table(M_REQUEST_TOTAL, Arc::new(table))
                .unwrap();
            Self { ctx, schema }
        }
    }

    #[async_trait::async_trait]
    impl promql::TableProvider for RequestTotalProvider {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            _matchers: promql_parser::label::Matchers,
            _label_selector: hashbrown::HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
        ) -> datafusion::error::Result<Vec<(SessionContext, Arc<Schema>, ScanStats, bool)>>
        {
            Ok(vec![(
                self.ctx.clone(),
                self.schema.clone(),
                ScanStats::default(),
                true,
            )])
        }
    }

    fn row(labels: &[(&str, &str)], value: f64) -> InstantValue {
        InstantValue {
            labels: labels
                .iter()
                .map(|(k, v)| Arc::new(Label::new(*k, *v)))
                .collect(),
            sample: Sample {
                timestamp: 0,
                value,
            },
        }
    }

    fn edge(client: &str, server: &str, ct: &str, v: f64) -> InstantValue {
        row(
            &[
                ("client", client),
                ("server", server),
                ("connection_type", ct),
            ],
            v,
        )
    }

    fn edge_in(client: &str, server: &str, stream: &str, v: f64) -> InstantValue {
        row(
            &[
                ("client", client),
                ("server", server),
                ("trace_stream", stream),
            ],
            v,
        )
    }

    fn empty_results(n: usize) -> Vec<Vec<InstantValue>> {
        vec![vec![]; n]
    }

    fn filter(trace_stream: Option<&str>, agent_env: Option<&str>) -> ReadFilter {
        ReadFilter {
            trace_stream: trace_stream.map(str::to_string),
            agent_env: agent_env.map(str::to_string),
        }
    }

    async fn engine_rows(provider: RequestTotalProvider, query: &str) -> Vec<InstantValue> {
        let at =
            std::time::UNIX_EPOCH + std::time::Duration::from_micros((BASE + 180 * SECOND) as u64);
        let query_ctx = Arc::new(QueryContext {
            trace_id: "sg_read_test".to_string(),
            org_id: "org".to_string(),
            query_exemplars: false,
            query_data: false,
            need_wal: false,
            use_cache: false,
            timeout: 30,
            search_event_type: None,
            regions: vec![],
            clusters: vec![],
            is_super_cluster: false,
            search_event_context: None,
        });
        let stmt = promql_parser::parser::EvalStmt {
            expr: promql_parser::parser::parse(query).unwrap(),
            start: at,
            end: at,
            interval: std::time::Duration::from_micros(INSTANT_STEP_MICROS as u64),
            lookback_delta: std::time::Duration::from_secs(300),
        };
        let mut ctx = PromqlContext::new(query_ctx, provider, vec![]);
        match ctx.exec("sg_read_test", stmt).await.unwrap().0 {
            Value::Vector(v) => v,
            other => panic!("expected a vector, got {}", other.get_type()),
        }
    }

    async fn assemble_requests_via_engine(
        provider: RequestTotalProvider,
        agent_env: &str,
    ) -> (usize, TopologyInput) {
        let f = filter(None, Some(agent_env));
        let query = q_requests(&f.edge_matcher().unwrap(), true, 60);
        let rows = engine_rows(provider, &query).await;
        let raw = rows.len();
        let mut r = empty_results(PLAN_LEN_FILTERED);
        r[IDX_REQUESTS] = rows;
        (raw, assemble(r, f.agent_env.as_deref()).unwrap().0)
    }

    async fn issued(f: &ReadFilter) -> (Vec<(String, i64)>, TopologyInput) {
        let seen = Mutex::new(vec![]);
        let seen_ref = &seen;
        let (input, _) = fetch_topology_with(f, 1_000_000_000, 1_060_000_000, |q, at| async move {
            seen_ref.lock().unwrap().push((q, at));
            Ok(vec![])
        })
        .await
        .unwrap();
        (seen.into_inner().unwrap(), input)
    }

    #[test]
    fn test_escape_label_value() {
        assert_eq!(escape_label_value(r#"a\b"c"#).unwrap(), r#"a\\b\"c"#);
        assert_eq!(escape_label_value("a\nb").unwrap(), "a\\nb");
        assert_eq!(
            escape_label_value("plain-name.svc").unwrap(),
            "plain-name.svc"
        );
        assert!(escape_label_value("a\tb").is_err());
        assert!(escape_label_value("a\u{7}b").is_err());
    }

    #[test]
    fn test_read_filter_matchers() {
        let empty = ReadFilter::default();
        assert!(empty.is_empty());
        assert_eq!(empty.edge_matcher().unwrap(), "");
        assert_eq!(empty.node_matcher().unwrap(), "");

        let stream = filter(Some("de\"f"), None);
        assert!(!stream.is_empty());
        assert_eq!(stream.edge_matcher().unwrap(), "trace_stream=\"de\\\"f\"");
        assert_eq!(stream.node_matcher().unwrap(), "trace_stream=\"de\\\"f\"");

        let env = filter(None, Some("prod"));
        assert!(!env.is_empty());
        assert_eq!(env.edge_matcher().unwrap(), ENV);
        assert_eq!(env.node_matcher().unwrap(), "");

        let both = filter(Some("default"), Some("prod"));
        assert_eq!(both.edge_matcher().unwrap(), BOTH);
        assert_eq!(both.node_matcher().unwrap(), M);

        assert!(filter(Some("a\u{1}"), None).edge_matcher().is_err());
        assert!(filter(Some("a\u{1}"), None).node_matcher().is_err());
        assert!(filter(None, Some("a\u{1}")).edge_matcher().is_err());
    }

    #[test]
    fn test_builders_without_matcher() {
        assert_eq!(
            q_requests("", false, 60),
            "sum by (client, client_type, server, connection_type, trace_stream) (increase(traces_service_graph_request_total[60s]))"
        );
        assert_eq!(
            q_failed("", false, 60),
            "sum by (client, client_type, server, connection_type) (increase(traces_service_graph_request_failed_total[60s]))"
        );
        assert_eq!(
            q_client_quantile(0.5, "", false, 60),
            "histogram_quantile(0.5, sum by (le, client, client_type, server, connection_type) (rate(traces_service_graph_request_client_seconds_bucket[60s])))"
        );
        assert_eq!(
            q_server_quantile(0.99, "", 60),
            "histogram_quantile(0.99, sum by (le, server) (rate(traces_service_graph_request_server_seconds_bucket[60s])))"
        );
        assert_eq!(
            q_server_count("", 60),
            "sum by (server, trace_stream) (increase(traces_service_graph_request_server_seconds_count[60s]))"
        );
        assert_eq!(
            q_unresolved("", 60),
            "sum by (reason) (increase(traces_service_graph_unresolved_total[60s]))"
        );
        assert_eq!(
            q_processed(""),
            "max(traces_service_graph_processed_timestamp)"
        );
        assert_eq!(
            q_instances("", false, 60),
            "sum by (server) (max_over_time(traces_service_graph_agent_instances[60s]))"
        );
        assert_eq!(
            q_org_inbound(60),
            "sum by (server, connection_type) (increase(traces_service_graph_request_total[60s]))"
        );
        assert_eq!(
            q_org_server_count(60),
            "sum by (server) (increase(traces_service_graph_request_server_seconds_count[60s]))"
        );
    }

    #[test]
    fn test_builders_with_trace_stream_matcher() {
        assert_eq!(
            q_requests(M, false, 3600),
            "sum by (client, client_type, server, connection_type, trace_stream) (increase(traces_service_graph_request_total{trace_stream=\"default\"}[3600s]))"
        );
        assert_eq!(
            q_failed(M, false, 3600),
            "sum by (client, client_type, server, connection_type) (increase(traces_service_graph_request_failed_total{trace_stream=\"default\"}[3600s]))"
        );
        assert_eq!(
            q_client_quantile(0.95, M, false, 3600),
            "histogram_quantile(0.95, sum by (le, client, client_type, server, connection_type) (rate(traces_service_graph_request_client_seconds_bucket{trace_stream=\"default\"}[3600s])))"
        );
        assert_eq!(
            q_server_quantile(0.5, M, 3600),
            "histogram_quantile(0.5, sum by (le, server) (rate(traces_service_graph_request_server_seconds_bucket{trace_stream=\"default\"}[3600s])))"
        );
        assert_eq!(
            q_server_count(M, 3600),
            "sum by (server, trace_stream) (increase(traces_service_graph_request_server_seconds_count{trace_stream=\"default\"}[3600s]))"
        );
        assert_eq!(
            q_unresolved(M, 3600),
            "sum by (reason) (increase(traces_service_graph_unresolved_total{trace_stream=\"default\"}[3600s]))"
        );
        assert_eq!(
            q_processed(M),
            "max(traces_service_graph_processed_timestamp{trace_stream=\"default\"})"
        );
        assert_eq!(
            q_instances(M, false, 3600),
            "sum by (server) (max_over_time(traces_service_graph_agent_instances{trace_stream=\"default\"}[3600s]))"
        );
    }

    #[test]
    fn test_edge_builders_with_agent_env_and_both_matchers() {
        assert_eq!(
            q_requests(ENV, true, 60),
            "sum by (client, client_type, server, connection_type, agent_env, trace_stream) (increase(traces_service_graph_request_total{agent_env=\"prod\"}[60s]))"
        );
        assert_eq!(
            q_failed(ENV, true, 60),
            "sum by (client, client_type, server, connection_type, agent_env) (increase(traces_service_graph_request_failed_total{agent_env=\"prod\"}[60s]))"
        );
        assert_eq!(
            q_client_quantile(0.99, ENV, true, 60),
            "histogram_quantile(0.99, sum by (le, client, client_type, server, connection_type, agent_env) (rate(traces_service_graph_request_client_seconds_bucket{agent_env=\"prod\"}[60s])))"
        );
        assert_eq!(
            q_instances(ENV, true, 60),
            "sum by (server, agent_env) (max_over_time(traces_service_graph_agent_instances{agent_env=\"prod\"}[60s]))"
        );
        assert_eq!(
            q_requests(BOTH, true, 60),
            "sum by (client, client_type, server, connection_type, agent_env, trace_stream) (increase(traces_service_graph_request_total{trace_stream=\"default\",agent_env=\"prod\"}[60s]))"
        );
        assert_eq!(
            q_failed(BOTH, true, 60),
            "sum by (client, client_type, server, connection_type, agent_env) (increase(traces_service_graph_request_failed_total{trace_stream=\"default\",agent_env=\"prod\"}[60s]))"
        );
        assert_eq!(
            q_client_quantile(0.5, BOTH, true, 60),
            "histogram_quantile(0.5, sum by (le, client, client_type, server, connection_type, agent_env) (rate(traces_service_graph_request_client_seconds_bucket{trace_stream=\"default\",agent_env=\"prod\"}[60s])))"
        );
        assert_eq!(
            q_instances(BOTH, true, 60),
            "sum by (server, agent_env) (max_over_time(traces_service_graph_agent_instances{trace_stream=\"default\",agent_env=\"prod\"}[60s]))"
        );
    }

    #[test]
    fn test_q_edge_exists() {
        assert_eq!(
            q_edge_exists("frontend", "checkout", 3600).unwrap(),
            "sum(increase(traces_service_graph_request_total{client=\"frontend\",server=\"checkout\"}[3600s]))"
        );
        assert_eq!(
            q_edge_exists("a\"b", "c\\d", 3600).unwrap(),
            "sum(increase(traces_service_graph_request_total{client=\"a\\\"b\",server=\"c\\\\d\"}[3600s]))"
        );
        assert!(q_edge_exists("a\tb", "c", 3600).is_err());
        assert!(q_edge_exists("a", "c\u{7}", 3600).is_err());
    }

    #[test]
    fn test_edge_type_from() {
        assert!(matches!(edge_type_from(3.0), EdgeType::ServiceDependency));
        assert!(matches!(edge_type_from(0.2), EdgeType::ServiceDependency));
        assert!(matches!(edge_type_from(0.0), EdgeType::Temporal));
        assert!(matches!(edge_type_from(-1.0), EdgeType::Temporal));
    }

    #[test]
    fn test_row_parsing() {
        let rows = vec![
            row(&[("client", "a"), ("server", "b")], 10.0),
            row(
                &[
                    ("client", "q"),
                    ("client_type", "queue"),
                    ("server", "b"),
                    ("connection_type", "database"),
                ],
                f64::NAN,
            ),
        ];
        let parsed = edge_rows(&rows);
        assert_eq!(
            parsed[0].0,
            (
                "a".to_string(),
                String::new(),
                "b".to_string(),
                String::new()
            )
        );
        assert_eq!(parsed[0].1, 10.0);
        assert_eq!(
            parsed[1].0,
            (
                "q".to_string(),
                "queue".to_string(),
                "b".to_string(),
                "database".to_string()
            )
        );
        assert!(parsed[1].1.is_nan());
        let with_stream = edge_stream_rows(&[edge_in("a", "b", "s1", 4.0), rows[0].clone()]);
        assert_eq!(with_stream[0].1, "s1");
        assert_eq!(with_stream[1].1, "");
        assert_eq!(
            label_rows(&[row(&[("server", "s")], 2.0)], "server"),
            vec![("s".to_string(), 2.0)]
        );
        assert_eq!(
            server_stream_rows(&[row(&[("server", "s"), ("trace_stream", "x")], 2.0)]),
            vec![("s".to_string(), "x".to_string(), 2.0)]
        );
        assert_eq!(
            label_rows(&[row(&[("reason", "no_peer")], 7.0)], "reason"),
            vec![("no_peer".to_string(), 7.0)]
        );
        assert_eq!(scalar_sum(&[row(&[], 1.5), row(&[], f64::NAN)]), 1.5);
        assert_eq!(scalar_sum(&[]), 0.0);
    }

    #[test]
    fn test_inbound_rows_take_missing_and_empty_connection_type_only() {
        let rows = vec![
            row(&[("server", "b")], 100.0),
            row(&[("server", "b"), ("connection_type", "")], 5.0),
            row(&[("server", "db1"), ("connection_type", "database")], 40.0),
            row(&[("server", "b"), ("connection_type", "rpc")], 7.0),
        ];
        assert_eq!(
            inbound_rows(&rows),
            vec![("b".to_string(), 100.0), ("b".to_string(), 5.0)]
        );
        assert_eq!(count_map(&inbound_rows(&rows))["b"], 105.0);
        assert!(!count_map(&inbound_rows(&rows)).contains_key("db1"));
    }

    #[test]
    fn test_value_conversions() {
        assert_eq!(count(f64::NAN), 0.0);
        assert_eq!(count(f64::INFINITY), 0.0);
        assert_eq!(count(3.2), 3.2);
        assert_eq!(secs_to_ns(f64::NAN), None);
        assert_eq!(secs_to_ns(f64::NEG_INFINITY), None);
        assert_eq!(secs_to_ns(0.0015), Some(1_500_000));
        assert_eq!(secs_to_ns(1.2345678915), Some(1_234_567_892));
    }

    #[test]
    fn test_plan_queries_count_and_times() {
        let plan = plan_queries(&ReadFilter::default(), 60, 1_000_000_000, 1_060_000_000).unwrap();
        assert_eq!(plan.len(), PLAN_LEN_UNFILTERED);
        assert!(
            plan[..IDX_BASELINE_Q]
                .iter()
                .all(|(_, at)| *at == 1_060_000_000)
        );
        assert!(
            plan[IDX_BASELINE_Q..]
                .iter()
                .all(|(_, at)| *at == 1_000_000_000)
        );
        assert_eq!(plan[IDX_REQUESTS].0, q_requests("", false, 60));
        assert_eq!(plan[IDX_PROCESSED].0, q_processed(""));
        assert_eq!(plan[IDX_INSTANCES].0, q_instances("", false, 60));
        assert_eq!(
            plan[IDX_BASELINE_Q].0,
            q_client_quantile(0.5, "", false, 60)
        );
        assert_eq!(
            plan[IDX_BASELINE_Q + 2].0,
            q_client_quantile(0.99, "", false, 60)
        );

        let both = filter(Some("default"), Some("prod"));
        let plan = plan_queries(&both, 60, 1_000_000_000, 1_060_000_000).unwrap();
        assert_eq!(plan.len(), PLAN_LEN_FILTERED);
        assert_eq!(plan[IDX_SERVER_Q].0, q_server_quantile(0.5, M, 60));
        assert_eq!(plan[IDX_SERVER_COUNT].0, q_server_count(M, 60));
        assert_eq!(plan[IDX_UNRESOLVED].0, q_unresolved(M, 60));
        assert_eq!(plan[IDX_INSTANCES].0, q_instances(BOTH, true, 60));
        assert_eq!(
            plan[IDX_BASELINE_Q + 1].0,
            q_client_quantile(0.95, BOTH, true, 60)
        );
        assert_eq!(plan[IDX_ORG_INBOUND].0, q_org_inbound(60));
        assert_eq!(plan[IDX_ORG_SERVER_COUNT].0, q_org_server_count(60));
        assert!(!plan[IDX_ORG_SERVER_COUNT].0.contains("trace_stream"));
    }

    #[test]
    fn test_edge_family_indices_match_edge_matcher_queries() {
        for f in [
            filter(None, Some("prod")),
            filter(Some("default"), Some("prod")),
        ] {
            let plan = plan_queries(&f, 60, 1_000_000_000, 1_060_000_000).unwrap();
            for (idx, (query, _)) in plan.iter().enumerate() {
                assert_eq!(
                    IDX_EDGE_FAMILY.contains(&idx),
                    query.contains(ENV),
                    "plan[{idx}] = {query}"
                );
            }
        }
    }

    #[tokio::test]
    async fn test_fetch_issues_15_unfiltered_and_17_filtered() {
        let (queries, input) = issued(&ReadFilter::default()).await;
        assert_eq!(queries.len(), 15);
        assert!(input.node_only_services);
        assert!(queries.iter().all(|(q, _)| !q.contains('{')));
        assert_eq!(
            queries
                .iter()
                .filter(|(_, at)| *at == 1_000_000_000)
                .count(),
            3
        );
        assert!(queries.contains(&(q_requests("", false, 60), 1_060_000_000)));

        let (queries, input) = issued(&filter(Some("default"), None)).await;
        assert_eq!(queries.len(), 17);
        assert!(input.node_only_services);
        assert!(queries.contains(&(q_server_count(M, 60), 1_060_000_000)));
        assert!(queries.contains(&(q_org_server_count(60), 1_060_000_000)));

        let (queries, input) = issued(&filter(None, Some("prod"))).await;
        assert_eq!(queries.len(), 17);
        assert!(!input.node_only_services);
        assert!(queries.contains(&(q_requests(ENV, true, 60), 1_060_000_000)));
        assert!(queries.contains(&(q_server_count("", 60), 1_060_000_000)));
        assert!(queries.contains(&(q_org_inbound(60), 1_060_000_000)));
        assert!(queries.contains(&(q_client_quantile(0.5, ENV, true, 60), 1_000_000_000)));

        let (queries, input) = issued(&filter(Some("default"), Some("prod"))).await;
        assert_eq!(queries.len(), 17);
        assert!(!input.node_only_services);
        assert!(queries.contains(&(q_instances(BOTH, true, 60), 1_060_000_000)));
        assert!(queries.contains(&(q_processed(M), 1_060_000_000)));

        assert!(
            fetch_topology_with(&filter(Some("a\u{1}"), None), 0, 1, |_, _| async {
                Ok(vec![])
            })
            .await
            .is_err()
        );
    }

    #[test]
    fn test_assemble_rejects_wrong_length() {
        assert!(assemble(empty_results(14), None).is_err());
        assert!(assemble(empty_results(16), None).is_err());
        let (input, meta) = assemble(empty_results(15), Some("prod")).unwrap();
        assert_eq!(input, TopologyInput::default());
        assert_eq!(meta.source, "v4");
        assert_eq!(meta.processed_up_to, None);
        assert_eq!(meta.unresolved, UnresolvedCounts::default());
        assert!(
            assemble(empty_results(17), None)
                .unwrap()
                .0
                .node_only_services
        );
    }

    #[test]
    fn test_assemble_edges_nodes_and_meta() {
        let mut r = empty_results(15);
        r[IDX_REQUESTS] = vec![
            edge("a", "b", "", 100.0),
            edge("b", "db1", "database", 40.0),
            row(
                &[("client", "user"), ("client_type", "user"), ("server", "a")],
                30.0,
            ),
        ];
        r[IDX_FAILED] = vec![edge("a", "b", "", 5.0), edge("ghost", "x", "", 1.0)];
        r[IDX_CLIENT_Q] = vec![edge("a", "b", "", 0.001), edge("nobody", "b", "", 0.5)];
        r[IDX_CLIENT_Q + 1] = vec![edge("a", "b", "", f64::NAN)];
        r[IDX_CLIENT_Q + 2] = vec![edge("a", "b", "", 0.01)];
        r[IDX_SERVER_COUNT] = vec![
            row(&[("server", "b")], 100.0),
            row(&[("server", "lonely")], 7.0),
        ];
        r[IDX_SERVER_Q] = vec![
            row(&[("server", "b")], 0.002),
            row(&[("server", "nope")], 1.0),
        ];
        r[IDX_SERVER_Q + 2] = vec![row(&[("server", "b")], f64::NAN)];
        r[IDX_UNRESOLVED] = vec![
            row(&[("reason", "no_peer")], 3.4),
            row(&[("reason", "ip_only")], 1.0),
            row(&[("reason", "ambiguous")], 2.0),
            row(&[("reason", "cardinality")], f64::NAN),
            row(&[("reason", "other")], 9.0),
        ];
        r[IDX_PROCESSED] = vec![row(&[], 1_700_000_000.0)];
        r[IDX_INSTANCES] = vec![
            row(&[("server", "planner")], 2.0),
            row(&[("server", "planner")], 3.0),
            row(&[("server", "helper")], f64::NAN),
        ];
        r[IDX_BASELINE_Q] = vec![edge("a", "b", "", 0.001), edge("b", "db1", "database", 0.1)];
        r[IDX_BASELINE_Q + 1] = vec![
            edge("a", "b", "", 0.002),
            edge("b", "db1", "database", f64::NAN),
        ];
        r[IDX_BASELINE_Q + 2] = vec![edge("a", "b", "", 0.003), edge("b", "db1", "database", 0.3)];

        let (input, meta) = assemble(r, None).unwrap();
        assert!(input.node_only_services);
        assert_eq!(input.edges.len(), 4);
        let ab = &input.edges[0];
        assert_eq!((ab.client.as_str(), ab.server.as_str()), ("a", "b"));
        assert_eq!(ab.requests, 100.0);
        assert_eq!(ab.errors, 5.0);
        assert_eq!(ab.p50_ns, Some(1_000_000));
        assert_eq!(ab.p95_ns, None);
        assert_eq!(ab.p99_ns, Some(10_000_000));
        assert!(ab.streams.is_empty());
        let bdb = &input.edges[1];
        assert_eq!(bdb.connection_type, "database");
        assert_eq!(bdb.requests, 40.0);
        assert_eq!(bdb.p50_ns, None);
        let ghost = &input.edges[2];
        assert_eq!(
            (ghost.client.as_str(), ghost.requests, ghost.errors),
            ("ghost", 0.0, 1.0)
        );
        let entry = &input.edges[3];
        assert_eq!(
            (entry.client_type.as_str(), entry.server.as_str()),
            ("user", "a")
        );
        assert!(!input.edges.iter().any(|e| e.client == "nobody"));

        assert_eq!(input.nodes.len(), 2);
        assert_eq!(input.nodes[0].server, "b");
        assert_eq!(input.nodes[0].requests_server, 100.0);
        assert_eq!(input.nodes[0].p50_ns, Some(2_000_000));
        assert_eq!(input.nodes[0].p95_ns, None);
        assert_eq!(input.nodes[0].p99_ns, None);
        assert_eq!(input.nodes[1].server, "lonely");

        let key = (
            "a".to_string(),
            String::new(),
            "b".to_string(),
            String::new(),
        );
        assert_eq!(
            input.baselines.get(&key),
            Some(&(1_000_000, 2_000_000, 3_000_000))
        );
        assert_eq!(input.baselines.len(), 1);

        assert_eq!(input.org_inbound.get("b"), Some(&100.0));
        assert_eq!(input.org_inbound.get("a"), Some(&30.0));
        assert_eq!(input.org_inbound.get("db1"), None);
        assert_eq!(input.org_requests_server.get("b"), Some(&100.0));
        assert_eq!(input.org_requests_server.get("lonely"), Some(&7.0));

        assert_eq!(input.instances.get("planner"), Some(&5.0));
        assert_eq!(input.instances.get("helper"), Some(&0.0));

        assert_eq!(meta.source, "v4");
        assert_eq!(meta.processed_up_to, Some(1_700_000_000));
        assert_eq!(
            meta.unresolved,
            UnresolvedCounts {
                no_peer: 3,
                ip_only: 1,
                ambiguous: 2,
                cardinality: 0
            }
        );
    }

    #[test]
    fn test_assemble_env_filter_keeps_only_rows_carrying_that_env() {
        let env = |client: &str, env: Option<&str>, v: f64| {
            let mut labels = vec![("client", client), ("server", "agent-a")];
            if let Some(e) = env {
                labels.push(("agent_env", e));
            }
            row(&labels, v)
        };
        let mut r = empty_results(PLAN_LEN_FILTERED);
        r[IDX_REQUESTS] = vec![
            env("svc", None, 50.0),
            env("svc", Some("prod"), 10.0),
            env("svc", Some("dev"), 7.0),
            env("other", Some(""), 3.0),
        ];
        r[IDX_FAILED] = vec![env("svc", Some("prod"), 1.0), env("svc", None, 9.0)];
        r[IDX_CLIENT_Q] = vec![
            env("svc", Some("dev"), 0.5),
            env("svc", Some("prod"), 0.001),
        ];
        r[IDX_INSTANCES] = vec![
            row(&[("server", "agent-a"), ("agent_env", "prod")], 2.0),
            row(&[("server", "agent-a")], 40.0),
        ];
        r[IDX_BASELINE_Q] = vec![env("svc", None, 0.1), env("svc", Some("prod"), 0.001)];
        r[IDX_BASELINE_Q + 1] = vec![env("svc", Some("prod"), 0.002)];
        r[IDX_BASELINE_Q + 2] = vec![env("svc", Some("prod"), 0.003)];
        r[IDX_SERVER_COUNT] = vec![row(&[("server", "svc")], 70.0)];
        r[IDX_ORG_INBOUND] = vec![row(&[("server", "agent-a")], 67.0)];

        let (input, _) = assemble(r.clone(), Some("prod")).unwrap();
        assert!(!input.node_only_services);
        assert_eq!(input.edges.len(), 1);
        let e = &input.edges[0];
        assert_eq!(
            (e.client.as_str(), e.requests, e.errors),
            ("svc", 10.0, 1.0)
        );
        assert_eq!(e.p50_ns, Some(1_000_000));
        assert_eq!(input.instances.get("agent-a"), Some(&2.0));
        assert_eq!(input.baselines.len(), 1);
        assert_eq!(input.nodes.len(), 1);
        assert_eq!(input.org_inbound.get("agent-a"), Some(&67.0));

        let (unfiltered, _) = assemble(r, None).unwrap();
        assert!(unfiltered.node_only_services);
        assert_eq!(unfiltered.edges.len(), 2);
        assert_eq!(unfiltered.instances.get("agent-a"), Some(&42.0));
    }

    #[tokio::test]
    async fn test_env_filter_through_engine_when_schema_lacks_agent_env() {
        let provider = RequestTotalProvider::new(false, &[("svc", None), ("agent", None)]);
        let (raw, input) = assemble_requests_via_engine(provider, "prod").await;
        assert_eq!(
            raw, 2,
            "the engine skips a matcher on a column the schema lacks"
        );
        assert!(input.edges.is_empty());
        assert!(!input.node_only_services);
    }

    #[tokio::test]
    async fn test_env_filter_through_engine_when_schema_has_agent_env() {
        let provider = RequestTotalProvider::new(
            true,
            &[
                ("svc", None),
                ("agent", Some("prod")),
                ("agent2", Some("dev")),
            ],
        );
        let (raw, input) = assemble_requests_via_engine(provider, "prod").await;
        assert_eq!(raw, 1);
        assert_eq!(input.edges.len(), 1);
        assert_eq!(input.edges[0].client, "agent");
        assert!(input.edges[0].requests > 0.0);
        assert_eq!(
            input.edges[0].streams.first().map(|s| s.0.as_str()),
            Some("default")
        );
    }

    #[test]
    fn test_assemble_sums_per_stream_split_into_one_identity() {
        let mut r = empty_results(15);
        r[IDX_REQUESTS] = vec![
            edge_in("a", "b", "zeta", 30.0),
            edge_in("a", "b", "alpha", 70.0),
            edge_in("a", "b", "", 1.0),
            edge_in("a", "b", "mid", f64::NAN),
        ];
        r[IDX_SERVER_COUNT] = vec![
            row(&[("server", "b"), ("trace_stream", "zeta")], 20.0),
            row(&[("server", "b"), ("trace_stream", "alpha")], 5.0),
        ];
        let (input, _) = assemble(r, None).unwrap();
        assert_eq!(input.edges.len(), 1);
        let ab = &input.edges[0];
        assert_eq!(ab.requests, 101.0);
        assert_eq!(
            ab.streams,
            vec![
                ("alpha".to_string(), 70.0),
                ("mid".to_string(), 0.0),
                ("zeta".to_string(), 30.0)
            ]
        );
        assert_eq!(input.nodes.len(), 1);
        assert_eq!(input.nodes[0].requests_server, 25.0);
        assert_eq!(
            input.nodes[0].streams,
            vec![("alpha".to_string(), 5.0), ("zeta".to_string(), 20.0)]
        );
    }

    #[test]
    fn test_assemble_cross_stream_case_unfiltered() {
        let mut r = empty_results(15);
        r[IDX_REQUESTS] = vec![edge_in("A", "B", "X", 100.0)];
        r[IDX_SERVER_COUNT] = vec![row(&[("server", "B"), ("trace_stream", "Y")], 100.0)];
        let (input, _) = assemble(r, None).unwrap();
        let unattributed = input.org_requests_server["B"] - input.org_inbound["B"];
        assert_eq!(unattributed, 0.0);
    }

    #[test]
    fn test_assemble_cross_stream_case_filtered() {
        let org_inbound = vec![
            row(&[("server", "B")], 100.0),
            row(&[("server", "B"), ("connection_type", "database")], 30.0),
        ];
        let mut r = empty_results(17);
        r[IDX_REQUESTS] = vec![edge_in("A", "B", "X", 100.0)];
        r[IDX_ORG_INBOUND] = org_inbound.clone();
        r[IDX_ORG_SERVER_COUNT] = vec![row(&[("server", "B")], 100.0)];
        let (input, _) = assemble(r, None).unwrap();
        assert_eq!(input.edges.len(), 1);
        assert!(input.nodes.is_empty());
        assert_eq!(input.org_inbound["B"], 100.0);
        assert_eq!(input.org_requests_server["B"] - input.org_inbound["B"], 0.0);

        let mut r = empty_results(17);
        r[IDX_SERVER_COUNT] = vec![row(&[("server", "B"), ("trace_stream", "Y")], 100.0)];
        r[IDX_ORG_INBOUND] = org_inbound;
        r[IDX_ORG_SERVER_COUNT] = vec![row(&[("server", "B")], 100.0)];
        let (input, _) = assemble(r, None).unwrap();
        assert!(input.edges.is_empty());
        assert_eq!(input.nodes.len(), 1);
        assert_eq!(input.org_requests_server["B"] - input.org_inbound["B"], 0.0);
    }

    #[tokio::test]
    async fn test_run_plan_lets_siblings_finish_before_failing() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let plan: Vec<(String, i64)> = (0..4).map(|i| (format!("q{i}"), 0)).collect();
        let completed = AtomicUsize::new(0);
        let completed = &completed;
        let ret = run_plan(&plan, |q, _| async move {
            if q == "q0" {
                return Err(anyhow::anyhow!("boom"));
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            completed.fetch_add(1, Ordering::SeqCst);
            Ok(vec![])
        })
        .await;
        assert!(ret[0].is_err());
        assert!(ret[1..].iter().all(Result::is_ok));
        assert_eq!(completed.load(Ordering::SeqCst), 3);

        let ok = run_plan(&plan, |_, _| async move { Ok(vec![row(&[], 1.0)]) }).await;
        assert_eq!(ok.len(), 4);
        assert_eq!(ok[3].as_ref().unwrap()[0].sample.value, 1.0);
    }

    #[test]
    fn test_settle_plan_degrades_optional_queries_only() {
        let mut results: Vec<Result<Vec<InstantValue>, anyhow::Error>> =
            (0..PLAN_LEN_UNFILTERED).map(|_| Ok(vec![])).collect();
        results[IDX_INSTANCES] = Err(anyhow::anyhow!("boom"));
        results[IDX_BASELINE_Q] = Err(anyhow::anyhow!("boom"));
        let (settled, degraded) = settle_plan(results).unwrap();
        assert_eq!(settled.len(), PLAN_LEN_UNFILTERED);
        assert_eq!(degraded, vec!["instances", "baseline_p50"]);

        let mut results: Vec<Result<Vec<InstantValue>, anyhow::Error>> =
            (0..PLAN_LEN_UNFILTERED).map(|_| Ok(vec![])).collect();
        results[IDX_FAILED] = Err(anyhow::anyhow!("boom"));
        assert!(
            settle_plan(results)
                .unwrap_err()
                .to_string()
                .starts_with("failed query failed")
        );
    }

    #[test]
    fn test_collector_virtual_node_edges() {
        let mut r = empty_results(PLAN_LEN_UNFILTERED);
        r[IDX_REQUESTS] = vec![
            row(
                &[
                    ("client", "user"),
                    ("connection_type", "virtual_node"),
                    ("server", "gateway"),
                ],
                7.0,
            ),
            row(
                &[
                    ("client", "gateway"),
                    ("connection_type", "virtual_node"),
                    ("server", "unknown"),
                ],
                5.0,
            ),
            row(&[("client", "gateway"), ("server", "api")], 3.0),
        ];
        let (edges, dropped) = assemble_edges(&r);
        assert_eq!(dropped, 5);
        let ids: Vec<(&str, &str, &str, &str)> = edges
            .iter()
            .map(|e| {
                (
                    e.client.as_str(),
                    e.client_type.as_str(),
                    e.server.as_str(),
                    e.connection_type.as_str(),
                )
            })
            .collect();
        assert_eq!(
            ids,
            vec![("gateway", "", "api", ""), ("user", "user", "gateway", "")]
        );
        let (_, meta) = assemble(r, None).unwrap();
        assert_eq!(meta.unresolved.no_peer, 5);
    }

    #[test]
    fn test_processed_up_to_takes_max_and_skips_nan() {
        let rows = vec![row(&[], 5.0), row(&[], f64::NAN), row(&[], 9.0)];
        assert_eq!(processed_up_to(&rows), Some(9));
        assert_eq!(processed_up_to(&[row(&[], f64::NAN)]), None);
    }
}
