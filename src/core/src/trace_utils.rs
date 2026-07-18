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

use opentelemetry::trace::TraceContextExt;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Set up tracing with a trace ID while preserving an active matching parent span.
pub async fn setup_tracing_with_trace_id(trace_id: &str, span: tracing::Span) -> tracing::Span {
    let current_otel_ctx = opentelemetry::Context::current();
    let has_valid_parent = {
        let span_ref = current_otel_ctx.span();
        let span_context = span_ref.span_context();
        span_context.is_valid() && span_context.trace_id().to_string() == trace_id
    };

    if has_valid_parent {
        let _ = span.set_parent(current_otel_ctx);
        return span;
    }

    let mut headers = std::collections::HashMap::new();
    let traceparent = format!("00-{}-{}-01", trace_id, config::ider::generate_span_id());
    headers.insert("traceparent".to_string(), traceparent);
    let parent_ctx = opentelemetry::global::get_text_map_propagator(|prop| prop.extract(&headers));
    let _ = span.set_parent(parent_ctx);
    span
}
