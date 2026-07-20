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

//! Service Graph Processor
//!
//! Queries trace streams and builds service graph topology.
//! Called by compactor job - zero impact on ingestion performance.

#[cfg(feature = "enterprise")]
use {
    config::{cluster::LOCAL_NODE, meta::stream::StreamType, utils::time::now_micros},
    infra::cluster::get_node_by_uuid,
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

#[cfg(feature = "enterprise")]
#[derive(serde::Deserialize)]
struct RecentIngestedTraceStream {
    org_id: String,
    stream_name: String,
}

/// Main entry point for service graph processing
/// Called by compactor job
#[cfg(feature = "enterprise")]
pub async fn process_service_graph() -> Result<(), anyhow::Error> {
    // get last offset
    let (mut last_updated_at, node) = crate::db::service_graph::get_offset().await;
    // other node is processing
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(());
    }

    // before starting, set current node to lock the job
    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        crate::db::service_graph::set_offset(last_updated_at, Some(&LOCAL_NODE.uuid.clone()))
            .await?;
    }

    let now = now_micros();
    let window_micros = get_o2_config().service_graph.query_time_range_minutes * 60 * 1_000_000;
    let mut next_updated_at = last_updated_at + window_micros;
    // less than window_micros, no need to process
    if next_updated_at > now {
        return Ok(());
    }
    // set last updated at to now if it's 0
    if last_updated_at == 0 {
        last_updated_at = now - window_micros;
        next_updated_at = now;
    }

    log::info!("[ServiceGraph] Processing traces from {last_updated_at} to {next_updated_at}");

    // Query usage stream to find which streams have recent ingestion activity
    let sql = r#"SELECT org_id, stream_name
        FROM "usage"
        WHERE event = 'Ingestion' AND stream_type = 'traces'
        GROUP BY org_id, stream_name"#
        .to_string();

    let usage_results = match crate::self_reporting::search::get_usage(
        sql,
        last_updated_at,
        next_updated_at,
        false,
    )
    .await
    {
        Ok(v) => v
            .into_iter()
            .filter_map(
                |v| match serde_json::from_value::<RecentIngestedTraceStream>(v) {
                    Ok(usage) => Some(usage),
                    Err(e) => {
                        log::warn!("[ServiceGraph] Failed to deserialize usage row: {e}");
                        None
                    }
                },
            )
            .collect::<Vec<_>>(),
        Err(e) => {
            log::error!(
                "[ServiceGraph] Failed to get last ingestion from usage stream, skipping service graph: {e}"
            );
            return Ok(());
        }
    };

    log::info!(
        "[ServiceGraph] Found {} active trace streams in usage data",
        usage_results.len()
    );

    // Fallback: the usage stream is the primary discovery source, but if it is
    // empty (self-reporting stalled/disabled, or a fresh instance) the service
    // graph would silently go dark. When usage yields nothing, discover trace
    // streams directly from the schema cache across all orgs so the graph keeps
    // working regardless of the usage pipeline's health.
    let discovered: Vec<RecentIngestedTraceStream> = if usage_results.is_empty() {
        let mut fallback = Vec::new();
        match crate::organization::list_all_orgs(None).await {
            Ok(orgs) => {
                for org in orgs {
                    for stream_name in crate::db::schema::list_streams_from_cache(
                        &org.identifier,
                        StreamType::Traces,
                    )
                    .await
                    {
                        fallback.push(RecentIngestedTraceStream {
                            org_id: org.identifier.clone(),
                            stream_name,
                        });
                    }
                }
            }
            Err(e) => log::warn!(
                "[ServiceGraph] usage empty and org list failed, no fallback discovery: {e}"
            ),
        }
        log::info!(
            "[ServiceGraph] Usage empty; discovered {} trace streams via schema cache",
            fallback.len()
        );
        fallback
    } else {
        usage_results
    };

    for RecentIngestedTraceStream {
        org_id,
        stream_name,
    } in discovered
    {
        log::info!("[ServiceGraph] Processing stream {org_id}/{stream_name}");

        if let Err(e) =
            process_stream(&org_id, &stream_name, last_updated_at, next_updated_at).await
        {
            log::error!("[ServiceGraph] Failed to process stream {org_id}/{stream_name}: {e}");
            continue; // Don't fail entire job if one stream fails
        }
    }

    // update last updated at
    crate::db::service_graph::set_offset(next_updated_at, Some(&LOCAL_NODE.uuid.clone())).await?;

    Ok(())
}

/// Build the `COALESCE(child.agent, p1.agent, …, pN.agent, service_name)`
/// nearest-ancestor-agent expression for the tool/model edge `from`. `depth` is
/// the number of ancestor levels to climb (N). When `has_agent_id`, each level
/// prefers `agent_id` then `agent_name`. This is what lets a tool/LLM span whose
/// agent name lives several levels up the parent chain (real Google ADK:
/// generate_content→chat→execute_tool) still attribute to the owning agent.
#[cfg(feature = "enterprise")]
fn build_agent_or_service(has_agent_id: bool, depth: usize) -> String {
    let level = |alias: &str| -> String {
        if has_agent_id {
            format!("{alias}.gen_ai_agent_id, {alias}.gen_ai_agent_name")
        } else {
            format!("{alias}.gen_ai_agent_name")
        }
    };
    let mut parts = vec![level("c")];
    for k in 1..=depth {
        parts.push(level(&format!("p{k}")));
    }
    parts.push("c.service_name".to_string());
    format!("COALESCE({})", parts.join(", "))
}

/// Build the chained ancestor `LEFT JOIN`s (p1 on child `c`, p2 on p1, …, pN on
/// p(N-1)) joining each span to its parent via `reference_parent_span_id` within
/// the same `trace_id`. Paired with `build_agent_or_service` to realise the
/// multi-level agent inheritance climb.
#[cfg(feature = "enterprise")]
fn build_ancestor_joins(stream_name: &str, depth: usize) -> String {
    (1..=depth)
        .map(|k| {
            let prev = if k == 1 {
                "c".to_string()
            } else {
                format!("p{}", k - 1)
            };
            format!(
                "LEFT JOIN \"{stream_name}\" AS p{k} \
                 ON {prev}.reference_parent_span_id = p{k}.span_id \
                 AND {prev}.trace_id = p{k}.trace_id"
            )
        })
        .collect::<Vec<_>>()
        .join("\n                    ")
}

/// Process a single trace stream
#[cfg(feature = "enterprise")]
/// Aggregate one trace stream into service-graph edge hits for a window WITHOUT
/// persisting them. Split out of `process_stream` so the compute step (the
/// query-4 self-joins for instrumented / inferred / GenAI agent-tool-model
/// edges) is isolated from the write step. Returns the raw SQL hits
/// (`client`/`server`/`connection_type`/metrics) the writer consumes.
#[cfg(feature = "enterprise")]
async fn compute_stream_edges(
    org_id: &str,
    stream_name: &str,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    // Build SQL to aggregate service graph edges directly in DataFusion
    // Use CTE to compute client/server first, then aggregate
    log::info!(
        "[ServiceGraph] Querying stream {}/{} from {} to {} (window: {}s)",
        org_id,
        stream_name,
        start_time,
        end_time,
        (end_time - start_time) / 1_000_000
    );

    let exclude_internal = get_o2_config().service_graph.exclude_internal_spans;

    let (server_span_kinds, client_span_kinds) = if exclude_internal {
        ("('2')", "('3')")
    } else {
        ("('1', '2')", "('1', '3')")
    };

    let sql = format!(
        r#"SELECT
            client.service_name AS client,
            server.service_name AS server,
            COUNT(*) AS total_requests,
            COUNT(*) FILTER (WHERE server.span_status = 'ERROR') AS errors,
            CAST(COUNT(*) FILTER (WHERE server.span_status = 'ERROR') * 100.0 / COUNT(*) AS DOUBLE) AS error_rate,
            CAST(approx_median(server.end_time - server.start_time) AS BIGINT) AS p50,
            CAST(approx_percentile_cont(server.end_time - server.start_time, 0.95) AS BIGINT) AS p95,
            CAST(approx_percentile_cont(server.end_time - server.start_time, 0.99) AS BIGINT) AS p99
        FROM "{stream_name}" AS server
        LEFT JOIN "{stream_name}" AS client
            ON server.reference_parent_span_id = client.span_id
            AND server.trace_id = client.trace_id
            AND CAST(client.span_kind AS VARCHAR) IN {client_span_kinds}
        WHERE
            server._timestamp >= {start_time} AND server._timestamp < {end_time}
            AND CAST(server.span_kind AS VARCHAR) IN {server_span_kinds}
            AND (
                client.service_name IS NULL
                OR client.service_name != server.service_name
            )
        GROUP BY client.service_name, server.service_name"#,
    );
    let mut hits = run_graph_search(org_id, sql, start_time, end_time).await?;
    log::info!(
        "[ServiceGraph] Query returned {} instrumented edges from {}/{}",
        hits.len(),
        org_id,
        stream_name
    );

    // Inferred-dependency edges: CLIENT/PRODUCER spans that call an uninstrumented
    // dependency (db/queue/external/rpc), tagged at ingestion via infer_service_*.
    // Such a dependency has no server span, so its latency is the client span's own
    // duration (the time spent waiting on it). The anti-join drops any inferred name
    // that is actually an instrumented service in this window, so it is not
    // Schema-gated: skip only on streams that genuinely lack the field. Use the
    // DB-backed schema lookup (NOT the cache-only variant) so a cold in-memory
    // cache on the compactor node does not silently disable all inferred edges.
    let has_infer = infra::schema::get(org_id, stream_name, StreamType::Traces)
        .await
        .map(|s| {
            s.field_with_name(crate::traces::inferred::INFER_SERVICE_NAME)
                .is_ok()
        })
        .unwrap_or(false);
    if has_infer {
        // Emit ALL inferred-dependency edges. Classification (collision merge,
        // rpc handling) happens downstream in build_topology via classify_entity,
        // so there is no anti-join here: an inferred name that also matches a real
        // service is resolved at topology-build time, not dropped at query time.
        // (The old `NOT IN (subquery)` anti-join was both semantically wrong and
        // unsupported by the query engine.)
        let inferred_sql = format!(
            r#"SELECT
                service_name AS client,
                infer_service_name AS server,
                max(infer_service_type) AS connection_type,
                COUNT(*) AS total_requests,
                COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors,
                CAST(COUNT(*) FILTER (WHERE span_status = 'ERROR') * 100.0 / COUNT(*) AS DOUBLE) AS error_rate,
                CAST(approx_median(end_time - start_time) AS BIGINT) AS p50,
                CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95,
                CAST(approx_percentile_cont(end_time - start_time, 0.99) AS BIGINT) AS p99
            FROM "{stream_name}"
            WHERE
                _timestamp >= {start_time} AND _timestamp < {end_time}
                AND CAST(span_kind AS VARCHAR) IN ('3', '4')
                AND infer_service_name IS NOT NULL AND infer_service_name != ''
            GROUP BY service_name, infer_service_name"#,
        );
        match run_graph_search(org_id, inferred_sql, start_time, end_time).await {
            Ok(mut inferred_hits) => {
                log::info!(
                    "[ServiceGraph] Query returned {} inferred-dependency edges from {}/{}",
                    inferred_hits.len(),
                    org_id,
                    stream_name
                );
                hits.append(&mut inferred_hits);
            }
            // Non-fatal: still write the instrumented edges we already have.
            Err(e) => log::error!(
                "[ServiceGraph] Inferred-edge query failed for {org_id}/{stream_name}: {e}"
            ),
        }

        // Queue CONSUMER edges (span_kind = 5): a consumer reads from a topic, so
        // the edge is topic → service (reverse of the producer's service → topic).
        // Inference does NOT tag consumer spans (only CLIENT/PRODUCER), so we read
        // the raw messaging destination directly. This reconnects async flows
        // (producer → topic → consumer, e.g. checkout → orders → fraud-detection)
        // that the parent/child span join cannot, since consumers run in a
        // separate trace. connection_type = 'queue' marks the topic as inferred.
        let consumer_sql = format!(
            r#"SELECT
                messaging_destination_name AS client,
                service_name AS server,
                'queue' AS connection_type,
                COUNT(*) AS total_requests,
                COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors,
                CAST(COUNT(*) FILTER (WHERE span_status = 'ERROR') * 100.0 / COUNT(*) AS DOUBLE) AS error_rate,
                CAST(approx_median(end_time - start_time) AS BIGINT) AS p50,
                CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95,
                CAST(approx_percentile_cont(end_time - start_time, 0.99) AS BIGINT) AS p99
            FROM "{stream_name}"
            WHERE
                _timestamp >= {start_time} AND _timestamp < {end_time}
                AND CAST(span_kind AS VARCHAR) = '5'
                AND messaging_destination_name IS NOT NULL AND messaging_destination_name != ''
            GROUP BY messaging_destination_name, service_name"#,
        );
        match run_graph_search(org_id, consumer_sql, start_time, end_time).await {
            Ok(mut consumer_hits) => {
                log::info!(
                    "[ServiceGraph] Query returned {} queue-consumer edges from {}/{}",
                    consumer_hits.len(),
                    org_id,
                    stream_name
                );
                hits.append(&mut consumer_hits);
            }
            // Non-fatal: streams without messaging columns simply return an error.
            Err(e) => log::debug!(
                "[ServiceGraph] Consumer-edge query (non-fatal) for {org_id}/{stream_name}: {e}"
            ),
        }
    }

    // ── Agent edges (GenAI topology) ─────────────────────────────────────────
    // Three edge families derived from gen_ai_* columns already on each span, as
    // a flat GROUP BY (no self-join — see design §2.2, avoids window-boundary
    // edge loss). Gated on `gen_ai_operation_name` existing in the schema, which
    // doubles as the LLM gate: it filters out the resource-fallback bleed where a
    // process-wide gen_ai.agent.name would otherwise tag plain HTTP spans (§2.4).
    //
    // Predicates key on COLUMN PRESENCE, not the operation-name string: real data
    // shows an open vocabulary (`chat`, `generate_content`, `span`, …). Model edges
    // COALESCE request/response model because some vendors (Langfuse, OpenInference)
    // populate ONLY response.model — verified live against synthetic vendor traces.
    //
    // Agent identity is COALESCE(agent_id, agent_name); `agent_id` may not exist
    // as a column (verified: real streams lack it), so it is schema-gated
    // independently and dropped from the COALESCE when absent (§6.1 finding 3).
    let has_gen_ai = infra::schema::get(org_id, stream_name, StreamType::Traces)
        .await
        .map(|s| s.field_with_name("gen_ai_operation_name").is_ok())
        .unwrap_or(false);
    if has_gen_ai {
        let has_agent_id = infra::schema::get(org_id, stream_name, StreamType::Traces)
            .await
            .map(|s| s.field_with_name("gen_ai_agent_id").is_ok())
            .unwrap_or(false);
        // Identity expression: prefer id, fall back to name; omit id if the column
        // is absent (referencing a missing column is a hard error, not NULL).
        let agent_ident = if has_agent_id {
            "COALESCE(gen_ai_agent_id, gen_ai_agent_name)"
        } else {
            "gen_ai_agent_name"
        };

        // Stream schema, used to gate optional columns (parent link, model cols).
        let model_schema = infra::schema::get(org_id, stream_name, StreamType::Traces).await;

        // For tool/model, the `from` is the agent that OWNS the span. But most
        // frameworks (OpenInference, traceloop, CrewAI, Google ADK) put the agent
        // name ONLY on an ancestor `invoke_agent`/AGENT span — the child tool and
        // LLM spans carry no agent name. Critically, the agent may be MORE THAN
        // ONE level up: real Google ADK traces nest
        //   generate_content(agent=X) → chat(agent=NULL) → execute_tool(tool)
        // so the tool's agent lives at depth 2, not 1. We therefore climb the
        // parent chain up to AGENT_INHERIT_DEPTH levels and take the NEAREST
        // ancestor (including self) that carries an agent name, falling back to
        // the host service_name:
        //   from = COALESCE(child.agent, p1.agent, …, pN.agent, child.service_name)
        // A recursive CTE would be the general form, but the search engine does
        // not support WITH RECURSIVE here (it panics), and real agent trees are
        // shallow — a bounded chained-join climb is both supported and cheaper.
        // p1..pN are the ancestor aliases in the tool/model queries below.
        const AGENT_INHERIT_DEPTH: usize = 4;
        let has_parent_link = model_schema
            .as_ref()
            .map(|s| s.field_with_name("reference_parent_span_id").is_ok())
            .unwrap_or(false);
        // The nearest-ancestor-agent-or-service `from` for tool/model. With the
        // parent-link column present, COALESCE walks child → p1 → … → pN → service;
        // otherwise it is the flat child-or-service form (no join possible).
        let agent_or_service = if has_parent_link {
            build_agent_or_service(has_agent_id, AGENT_INHERIT_DEPTH)
        } else {
            format!("COALESCE({agent_ident}, service_name)")
        };
        // The chained ancestor LEFT JOINs (p1 on child, p2 on p1, …), shared by
        // the tool and model queries. Empty when the stream has no parent link.
        let ancestor_joins = if has_parent_link {
            build_ancestor_joins(stream_name, AGENT_INHERIT_DEPTH)
        } else {
            String::new()
        };

        // Model identity: prefer request.model, fall back to response.model. Some
        // vendors (Langfuse, OpenInference) populate ONLY response.model, others
        // only request.model. BOTH columns must be schema-gated independently —
        // referencing a column absent from the stream schema is a hard error, so
        // the COALESCE is built from only the columns that actually exist.
        let has_request_model = model_schema
            .as_ref()
            .map(|s| s.field_with_name("gen_ai_request_model").is_ok())
            .unwrap_or(false);
        let has_response_model = model_schema
            .as_ref()
            .map(|s| s.field_with_name("gen_ai_response_model").is_ok())
            .unwrap_or(false);
        let model_expr = match (has_request_model, has_response_model) {
            (true, true) => "COALESCE(gen_ai_request_model, gen_ai_response_model)",
            (true, false) => "gen_ai_request_model",
            (false, true) => "gen_ai_response_model",
            // Neither column exists — no model edges possible; the predicate below
            // will be false-ish and the query still runs (schema-safe).
            (false, false) => "CAST(NULL AS STRING)",
        };
        let model_predicate = format!("{model_expr} IS NOT NULL AND {model_expr} != ''");

        // Metric aggregates shared by every edge query (aliased to child `c`
        // where a join is present, so it works in both flat and joined forms).
        let metrics = |t: &str| {
            format!(
                "COUNT(*) AS total_requests, \
                 COUNT(*) FILTER (WHERE {t}span_status = 'ERROR') AS errors, \
                 CAST(COUNT(*) FILTER (WHERE {t}span_status = 'ERROR') * 100.0 / COUNT(*) AS DOUBLE) AS error_rate, \
                 CAST(approx_median({t}end_time - {t}start_time) AS BIGINT) AS p50, \
                 CAST(approx_percentile_cont({t}end_time - {t}start_time, 0.95) AS BIGINT) AS p95, \
                 CAST(approx_percentile_cont({t}end_time - {t}start_time, 0.99) AS BIGINT) AS p99"
            )
        };

        // 1) service → agent : an invoke_agent span's host service calls the agent.
        // A flat scan — the agent name IS on this span by definition.
        let m = metrics("");
        let agent_sql = format!(
            r#"SELECT service_name AS client, {agent_ident} AS server,
                'agent' AS connection_type, {m}
            FROM "{stream_name}"
            WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
                AND gen_ai_operation_name = 'invoke_agent'
                AND service_name IS NOT NULL AND service_name != ''
                AND ({agent_ident}) IS NOT NULL AND ({agent_ident}) != ''
                AND service_name != ({agent_ident})
            GROUP BY service_name, {agent_ident}"#,
        );

        // 2) agent → tool  and  3) agent → model. These key the `from` on the
        // OWNING agent, inherited from the parent span (parent-agent join) because
        // most frameworks omit agent name on the child tool/LLM span. When the
        // stream lacks the parent-link column, `agent_or_service` is the flat
        // child-or-service form and no join is emitted.
        let mc = metrics("c.");
        let tool_from = &agent_or_service;
        let model_from = &agent_or_service;
        let (tool_sql, model_sql) = if has_parent_link {
            (
                format!(
                    r#"SELECT {tool_from} AS client, c.gen_ai_tool_name AS server,
                        'tool' AS connection_type, {mc}
                    FROM "{stream_name}" AS c
                    {ancestor_joins}
                    WHERE c._timestamp >= {start_time} AND c._timestamp < {end_time}
                        AND c.gen_ai_tool_name IS NOT NULL AND c.gen_ai_tool_name != ''
                        AND ({tool_from}) IS NOT NULL AND ({tool_from}) != ''
                        AND ({tool_from}) != c.gen_ai_tool_name
                    GROUP BY {tool_from}, c.gen_ai_tool_name"#,
                ),
                format!(
                    r#"SELECT {model_from} AS client, {model_expr_c} AS server,
                        'model' AS connection_type, {mc}
                    FROM "{stream_name}" AS c
                    {ancestor_joins}
                    WHERE c._timestamp >= {start_time} AND c._timestamp < {end_time}
                        AND {model_predicate_c}
                        AND ({model_from}) IS NOT NULL AND ({model_from}) != ''
                        AND ({model_from}) != ({model_expr_c})
                    GROUP BY {model_from}, {model_expr_c}"#,
                    model_expr_c = model_expr.replace("gen_ai_", "c.gen_ai_"),
                    model_predicate_c = model_predicate.replace("gen_ai_", "c.gen_ai_"),
                ),
            )
        } else {
            let m = metrics("");
            (
                format!(
                    r#"SELECT {agent_or_service} AS client, gen_ai_tool_name AS server,
                        'tool' AS connection_type, {m}
                    FROM "{stream_name}"
                    WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
                        AND gen_ai_tool_name IS NOT NULL AND gen_ai_tool_name != ''
                        AND ({agent_or_service}) IS NOT NULL AND ({agent_or_service}) != ''
                        AND ({agent_or_service}) != gen_ai_tool_name
                    GROUP BY {agent_or_service}, gen_ai_tool_name"#,
                ),
                format!(
                    r#"SELECT {agent_or_service} AS client, {model_expr} AS server,
                        'model' AS connection_type, {m}
                    FROM "{stream_name}"
                    WHERE _timestamp >= {start_time} AND _timestamp < {end_time}
                        AND {model_predicate}
                        AND ({agent_or_service}) IS NOT NULL AND ({agent_or_service}) != ''
                        AND ({agent_or_service}) != ({model_expr})
                    GROUP BY {agent_or_service}, {model_expr}"#,
                ),
            )
        };

        for (conn_type, agent_sql) in [
            ("agent", agent_sql),
            ("tool", tool_sql),
            ("model", model_sql),
        ] {
            match run_graph_search(org_id, agent_sql, start_time, end_time).await {
                Ok(mut agent_hits) => {
                    log::info!(
                        "[ServiceGraph] Query returned {} {conn_type} edges from {org_id}/{stream_name}",
                        agent_hits.len(),
                    );
                    hits.append(&mut agent_hits);
                }
                // Non-fatal: still write whatever edges we already have.
                Err(e) => log::debug!(
                    "[ServiceGraph] Agent {conn_type}-edge query (non-fatal) for {org_id}/{stream_name}: {e}"
                ),
            }
        }
    }

    Ok(hits)
}

/// Hourly-job path: aggregate one stream's edges and PERSIST them to the
/// `_o2_service_graph` stream. Thin wrapper over `compute_stream_edges` so the
/// live Agent Graph path can reuse the exact same aggregation without writing.
#[cfg(feature = "enterprise")]
async fn process_stream(
    org_id: &str,
    stream_name: &str,
    start_time: i64,
    end_time: i64,
) -> Result<(), anyhow::Error> {
    let hits = compute_stream_edges(org_id, stream_name, start_time, end_time).await?;
    if hits.is_empty() {
        return Ok(());
    }
    // SQL already aggregated everything - just write directly to _o2_service_graph stream
    crate::traces::service_graph::write_sql_aggregated_edges(org_id, stream_name, hits).await?;
    Ok(())
}

/// Run a pre-aggregated service-graph edge query against a trace stream and return
/// the raw result hits. Shared by the instrumented self-join query and the
/// inferred-dependency query.
#[cfg(feature = "enterprise")]
async fn run_graph_search(
    org_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 100000,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            action_id: None,
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
            timezone: None,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 300, // 5 minute timeout for large queries
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
    };

    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org_id, StreamType::Traces, None, &req).await?;
    Ok(resp.hits)
}

// Stub implementation for non-enterprise builds
#[cfg(not(feature = "enterprise"))]
pub async fn process_service_graph() -> Result<(), anyhow::Error> {
    Ok(())
}

#[cfg(all(test, feature = "enterprise"))]
mod test {

    #[test]
    fn test_usage_deser() {
        let value = serde_json::json!({
            "org_id": "random",
            "stream_name": "random-stream"
        });

        let result = serde_json::from_value::<super::RecentIngestedTraceStream>(value);

        assert!(
            result.is_ok_and(|data| {
                data.org_id == "random" && data.stream_name == "random-stream"
            })
        );
    }

    // Multi-level agent inheritance: a tool/LLM span's owning agent may be more
    // than one parent up (real Google ADK: generate_content(agent)→chat→tool),
    // so the `from` COALESCE must walk child → p1 → … → pN → service, and the
    // query must emit one chained LEFT JOIN per level. Regression guard against
    // silently collapsing back to a single parent level.
    #[test]
    fn test_agent_or_service_climbs_all_levels() {
        let expr = super::build_agent_or_service(false, 4);
        assert_eq!(
            expr,
            "COALESCE(c.gen_ai_agent_name, p1.gen_ai_agent_name, \
             p2.gen_ai_agent_name, p3.gen_ai_agent_name, p4.gen_ai_agent_name, \
             c.service_name)"
        );
        // child first (self wins), service_name last (fallback).
        assert!(expr.starts_with("COALESCE(c.gen_ai_agent_name,"));
        assert!(expr.ends_with("c.service_name)"));
        // one agent term per level + child + service.
        assert_eq!(expr.matches("gen_ai_agent_name").count(), 5);
    }

    #[test]
    fn test_agent_or_service_prefers_agent_id_when_present() {
        let expr = super::build_agent_or_service(true, 2);
        assert_eq!(
            expr,
            "COALESCE(c.gen_ai_agent_id, c.gen_ai_agent_name, \
             p1.gen_ai_agent_id, p1.gen_ai_agent_name, \
             p2.gen_ai_agent_id, p2.gen_ai_agent_name, c.service_name)"
        );
    }

    #[test]
    fn test_ancestor_joins_chain_parent_links() {
        let joins = super::build_ancestor_joins("mystream", 3);
        // p1 joins the child c; p2 joins p1; p3 joins p2 — a true chain.
        assert!(
            joins.contains(
                "LEFT JOIN \"mystream\" AS p1 ON c.reference_parent_span_id = p1.span_id"
            )
        );
        assert!(
            joins.contains(
                "LEFT JOIN \"mystream\" AS p2 ON p1.reference_parent_span_id = p2.span_id"
            )
        );
        assert!(
            joins.contains(
                "LEFT JOIN \"mystream\" AS p3 ON p2.reference_parent_span_id = p3.span_id"
            )
        );
        // trace_id is part of every join key (no cross-trace leakage).
        assert_eq!(joins.matches("trace_id = p").count(), 3);
        // exactly `depth` joins.
        assert_eq!(joins.matches("LEFT JOIN").count(), 3);
    }
}
