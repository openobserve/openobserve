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

use opentelemetry::{propagation::Extractor, trace::TraceContextExt};
use tracing_opentelemetry::OpenTelemetrySpanExt;

pub struct MetadataMap<'a>(pub &'a tonic::metadata::MetadataMap);

impl Extractor for MetadataMap<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|metadata| metadata.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0
            .keys()
            .map(|key| match key {
                tonic::metadata::KeyRef::Ascii(value) => value.as_str(),
                tonic::metadata::KeyRef::Binary(value) => value.as_str(),
            })
            .collect()
    }
}

/// Attach `parent_cx` to `span`, falling back to a remote parent built from the logical `trace_id`.
pub fn set_parent_or_trace_id(
    span: &tracing::Span,
    parent_cx: opentelemetry::Context,
    trace_id: &str,
) {
    let cx = if !parent_cx.span().span_context().is_valid()
        && let Some(base) = logical_trace_id_base(trace_id)
    {
        // same synthetic-traceparent trick get_or_create_trace_id uses for RUM headers
        let carrier = std::collections::HashMap::from([(
            "traceparent".to_string(),
            format!("00-{base}-{}-01", config::ider::generate_span_id()),
        )]);
        opentelemetry::global::get_text_map_propagator(|prop| prop.extract(&carrier))
    } else {
        parent_cx
    };
    let _ = span.set_parent(cx);
}

// sub-search ids look like `{base}-{n}-{suffix}`; only the 32-hex base is a trace id
fn logical_trace_id_base(trace_id: &str) -> Option<&str> {
    let base = trace_id.split('-').next().unwrap_or_default();
    (base.len() == 32
        && base.chars().all(|c| c.is_ascii_hexdigit())
        && !base.chars().all(|c| c == '0'))
    .then_some(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_logical_trace_id_base() {
        assert_eq!(
            logical_trace_id_base("01a05c4446cc71ac872a7b594bcdc883"),
            Some("01a05c4446cc71ac872a7b594bcdc883")
        );
        assert_eq!(
            logical_trace_id_base("01a05c4446cc71ac872a7b594bcdc883-7-yQou3Fe"),
            Some("01a05c4446cc71ac872a7b594bcdc883")
        );
        assert_eq!(logical_trace_id_base(""), None);
        assert_eq!(logical_trace_id_base("abc123"), None);
        assert_eq!(
            logical_trace_id_base("00000000000000000000000000000000"),
            None
        );
        assert_eq!(
            logical_trace_id_base("01a05c4446cc71ac872a7b594bcdc88z"),
            None
        );
    }
}
