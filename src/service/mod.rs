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

use config::{meta::stream::StreamParams, utils::schema::format_stream_name};
use infra::errors::Result;
use opentelemetry::trace::TraceContextExt;
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub mod alerts;
pub mod cluster_info;
pub mod compact;
pub mod dashboards;
pub mod db;
pub mod enrichment;
pub mod enrichment_table;
pub mod file_list;
pub mod file_list_dump;
pub mod folders;
pub mod functions;
pub mod github;
pub mod grpc;
pub mod ingestion;
pub mod kv;
pub mod logs;
pub mod metadata;
pub mod metrics;
pub mod node;
#[cfg(feature = "cloud")]
pub mod org_usage;
pub mod organization;
pub mod pipeline;
pub mod promql;
#[cfg(feature = "enterprise")]
pub mod ratelimit;
pub mod runtime_metrics;
pub mod schema;
pub mod search;
pub mod tantivy;

#[cfg(feature = "enterprise")]
pub mod search_jobs;
pub mod self_reporting;
pub mod session;
pub mod short_url;
pub mod stream;
pub mod tls;
pub mod traces;
pub mod users;

// format stream name
pub async fn get_formatted_stream_name(params: StreamParams) -> Result<String> {
    let stream_name = params.stream_name.to_string();
    let schema = infra::schema::get_cache(&params.org_id, &stream_name, params.stream_type).await?;
    Ok(if schema.fields_map().is_empty() {
        format_stream_name(stream_name)
    } else {
        stream_name
    })
}

/// Setup tracing with a trace ID
/// This function should be called when the parent span is already active (entered) in the tracing context.
/// It will use the current active span as parent, maintaining the span hierarchy.
/// If no parent span is active, it creates a synthetic parent context with the given trace_id.
pub async fn setup_tracing_with_trace_id(trace_id: &str, span: tracing::Span) -> tracing::Span {
    // Check if there's a current OpenTelemetry context with a valid span
    let current_otel_ctx = opentelemetry::Context::current();

    // Check if the current context has a valid span with matching trace_id
    let has_valid_parent = {
        let span_ref = current_otel_ctx.span();
        let span_context = span_ref.span_context();
        span_context.is_valid() && span_context.trace_id().to_string() == trace_id
    };

    // If there's a valid current span with matching trace_id, use it as parent
    // This happens when this function is called within an entered parent span
    if has_valid_parent {
        // The new span should be a child of the current span
        // Set the current context as parent
        span.set_parent(current_otel_ctx);
        return span;
    }

    // Otherwise, create a synthetic parent context with the trace_id
    // This is used when there's no active parent span or the trace_id doesn't match
    let mut headers: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let traceparent = format!(
        "00-{}-{}-01", /* 01 to indicate that the span is sampled i.e. needs to be
                        * recorded/exported */
        trace_id,
        config::ider::generate_span_id()
    );
    headers.insert("traceparent".to_string(), traceparent);
    let parent_ctx = opentelemetry::global::get_text_map_propagator(|prop| prop.extract(&headers));
    let _ = span.set_parent(parent_ctx);
    span
}
