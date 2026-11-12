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

//! Conversion of v1.0 tracer payloads, whose strings live in one table, into the legacy shape.

use std::collections::HashMap;

use proto::datadog_trace::{
    AttributeAnyValue, AttributeArray, AttributeArrayValue, Span, SpanEvent, SpanLink, TraceChunk,
    TracerPayload,
    attribute_any_value::AttributeAnyValueType,
    attribute_array_value::AttributeArrayValueType,
    idx::{self, SpanKind, any_value::Value},
};

use super::TID_KEY;
use crate::datadog::{DatadogError, ExpansionBudget, entry_bytes};

/// Heap bookkeeping charged for each string cloned out of the table.
const STRING_BYTES: usize = 24;

/// The payload's string table; every lookup clones, so each one is charged to the budget.
struct Strings<'a> {
    table: &'a [String],
    budget: &'a mut ExpansionBudget,
}

/// Rebuilds a legacy tracer payload; a string-table ref out of range fails the whole payload.
pub(super) fn to_legacy(
    payload: &idx::TracerPayload,
    budget: &mut ExpansionBudget,
) -> Result<TracerPayload, DatadogError> {
    let strings = &mut Strings {
        table: &payload.strings,
        budget,
    };
    // String payload attributes are the legacy tracer tags; numbers still reach every span.
    let mut shared = Span::default();
    insert_attributes(&mut shared, &payload.attributes, strings)?;
    let mut chunks = Vec::with_capacity(payload.chunks.len());
    for chunk in &payload.chunks {
        chunks.push(chunk_to_legacy(chunk, &shared.metrics, strings)?);
    }
    Ok(TracerPayload {
        container_id: lookup(strings, payload.container_id_ref)?,
        language_name: lookup(strings, payload.language_name_ref)?,
        language_version: lookup(strings, payload.language_version_ref)?,
        tracer_version: lookup(strings, payload.tracer_version_ref)?,
        runtime_id: lookup(strings, payload.runtime_id_ref)?,
        env: lookup(strings, payload.env_ref)?,
        hostname: lookup(strings, payload.hostname_ref)?,
        app_version: lookup(strings, payload.app_version_ref)?,
        chunks,
        tags: shared.meta,
        ..Default::default()
    })
}

fn chunk_to_legacy(
    chunk: &idx::TraceChunk,
    payload_metrics: &HashMap<String, f64>,
    strings: &mut Strings<'_>,
) -> Result<TraceChunk, DatadogError> {
    let (upper, lower) = split_trace_id(&chunk.trace_id);
    let mut spans = chunk
        .spans
        .iter()
        .map(|span| span_to_legacy(span, lower, strings))
        .collect::<Result<Vec<_>, _>>()?;
    // Chunk and payload attributes are tags shared by every span; the most specific level wins.
    let mut common = Span::default();
    insert_attributes(&mut common, &chunk.attributes, strings)?;
    let meta_bytes: usize = common
        .meta
        .iter()
        .map(|(k, v)| entry_bytes(k, v.len()))
        .sum();
    let metrics_bytes: usize = common
        .metrics
        .keys()
        .chain(payload_metrics.keys())
        .map(|k| entry_bytes(k, size_of::<f64>()))
        .sum();
    strings
        .budget
        .charge(meta_bytes + metrics_bytes, spans.len())?;
    for span in &mut spans {
        for (key, value) in &common.meta {
            span.meta
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
        for (key, value) in common.metrics.iter().chain(payload_metrics) {
            span.metrics.entry(key.clone()).or_insert(*value);
        }
    }
    // The legacy path reads a trace ID's upper 64 bits from `_dd.p.tid` on any one span.
    if let Some(first) = spans.first_mut().filter(|_| upper != 0) {
        first
            .meta
            .entry(TID_KEY.to_string())
            .or_insert_with(|| format!("{upper:016x}"));
    }
    Ok(TraceChunk {
        spans,
        ..Default::default()
    })
}

fn span_to_legacy(
    span: &idx::Span,
    trace_id: u64,
    strings: &mut Strings<'_>,
) -> Result<Span, DatadogError> {
    let mut legacy = Span {
        service: lookup(strings, span.service_ref)?,
        name: lookup(strings, span.name_ref)?,
        resource: lookup(strings, span.resource_ref)?,
        r#type: lookup(strings, span.type_ref)?,
        trace_id,
        span_id: span.span_id,
        parent_id: span.parent_id,
        start: i64::try_from(span.start).unwrap_or(i64::MAX),
        duration: i64::try_from(span.duration).unwrap_or(i64::MAX),
        error: i32::from(span.error),
        span_links: span
            .links
            .iter()
            .map(|link| link_to_legacy(link, strings))
            .collect::<Result<_, _>>()?,
        span_events: span
            .events
            .iter()
            .map(|event| event_to_legacy(event, strings))
            .collect::<Result<_, _>>()?,
        ..Default::default()
    };
    insert_attributes(&mut legacy, &span.attributes, strings)?;
    let promoted = [
        ("env", span.env_ref),
        ("version", span.version_ref),
        ("component", span.component_ref),
    ];
    for (key, value_ref) in promoted {
        let value = lookup(strings, value_ref)?;
        if !value.is_empty() {
            legacy.meta.entry(key.to_string()).or_insert(value);
        }
    }
    if let Some(kind) = kind_name(span.kind) {
        legacy
            .meta
            .entry("span.kind".to_string())
            .or_insert_with(|| kind.to_string());
    }
    Ok(legacy)
}

/// Numbers go to `metrics` and everything else to `meta`, as the Agent splits legacy tags.
fn insert_attributes(
    span: &mut Span,
    attributes: &HashMap<u32, idx::AnyValue>,
    strings: &mut Strings<'_>,
) -> Result<(), DatadogError> {
    for (key, value) in attributes {
        let key = lookup(strings, *key)?;
        match &value.value {
            Some(Value::DoubleValue(v)) => {
                span.metrics.insert(key, *v);
            }
            Some(Value::IntValue(v)) => {
                span.metrics.insert(key, *v as f64);
            }
            // Bytes carry legacy `meta_struct`, which the legacy path drops too.
            Some(Value::BytesValue(_)) | None => {}
            Some(other) => {
                span.meta.insert(key, as_string(other, strings)?);
            }
        }
    }
    Ok(())
}

fn link_to_legacy(
    link: &idx::SpanLink,
    strings: &mut Strings<'_>,
) -> Result<SpanLink, DatadogError> {
    let (trace_id_high, trace_id) = split_trace_id(&link.trace_id);
    let mut attributes = HashMap::with_capacity(link.attributes.len());
    for (key, value) in &link.attributes {
        if let Some(value) = &value.value {
            attributes.insert(lookup(strings, *key)?, as_string(value, strings)?);
        }
    }
    Ok(SpanLink {
        trace_id,
        trace_id_high,
        span_id: link.span_id,
        attributes,
        tracestate: lookup(strings, link.tracestate_ref)?,
        flags: link.flags,
    })
}

fn event_to_legacy(
    event: &idx::SpanEvent,
    strings: &mut Strings<'_>,
) -> Result<SpanEvent, DatadogError> {
    let mut attributes = HashMap::with_capacity(event.attributes.len());
    for (key, value) in &event.attributes {
        if let Some(value) = &value.value {
            attributes.insert(lookup(strings, *key)?, event_attribute(value, strings)?);
        }
    }
    Ok(SpanEvent {
        time_unix_nano: event.time,
        name: lookup(strings, event.name_ref)?,
        attributes,
    })
}

fn event_attribute(
    value: &Value,
    strings: &mut Strings<'_>,
) -> Result<AttributeAnyValue, DatadogError> {
    let typed = |r#type: AttributeAnyValueType| AttributeAnyValue {
        r#type: r#type as i32,
        ..Default::default()
    };
    Ok(match value {
        Value::BoolValue(v) => AttributeAnyValue {
            bool_value: *v,
            ..typed(AttributeAnyValueType::BoolValue)
        },
        Value::IntValue(v) => AttributeAnyValue {
            int_value: *v,
            ..typed(AttributeAnyValueType::IntValue)
        },
        Value::DoubleValue(v) => AttributeAnyValue {
            double_value: *v,
            ..typed(AttributeAnyValueType::DoubleValue)
        },
        Value::ArrayValue(array) => AttributeAnyValue {
            array_value: Some(AttributeArray {
                values: array
                    .values
                    .iter()
                    .filter_map(|v| v.value.as_ref())
                    .map(|v| array_element(v, strings))
                    .collect::<Result<_, _>>()?,
            }),
            ..typed(AttributeAnyValueType::ArrayValue)
        },
        other => AttributeAnyValue {
            string_value: as_string(other, strings)?,
            ..typed(AttributeAnyValueType::StringValue)
        },
    })
}

fn array_element(
    value: &Value,
    strings: &mut Strings<'_>,
) -> Result<AttributeArrayValue, DatadogError> {
    let typed = |r#type: AttributeArrayValueType| AttributeArrayValue {
        r#type: r#type as i32,
        ..Default::default()
    };
    Ok(match value {
        Value::BoolValue(v) => AttributeArrayValue {
            bool_value: *v,
            ..typed(AttributeArrayValueType::BoolValue)
        },
        Value::IntValue(v) => AttributeArrayValue {
            int_value: *v,
            ..typed(AttributeArrayValueType::IntValue)
        },
        Value::DoubleValue(v) => AttributeArrayValue {
            double_value: *v,
            ..typed(AttributeArrayValueType::DoubleValue)
        },
        other => AttributeArrayValue {
            string_value: as_string(other, strings)?,
            ..typed(AttributeArrayValueType::StringValue)
        },
    })
}

/// Renders a value the way the Agent flattens one into a legacy string tag.
fn as_string(value: &Value, strings: &mut Strings<'_>) -> Result<String, DatadogError> {
    Ok(match value {
        Value::StringValueRef(r) => lookup(strings, *r)?,
        Value::BoolValue(v) => v.to_string(),
        Value::DoubleValue(v) => v.to_string(),
        Value::IntValue(v) => v.to_string(),
        Value::BytesValue(v) => String::from_utf8_lossy(v).into_owned(),
        Value::ArrayValue(array) => {
            let mut parts = Vec::with_capacity(array.values.len());
            for v in array.values.iter().filter_map(|v| v.value.as_ref()) {
                parts.push(as_string(v, strings)?);
            }
            format!("[{}]", parts.join(","))
        }
        Value::KeyValueList(list) => {
            let mut parts = Vec::with_capacity(list.key_values.len());
            for kv in &list.key_values {
                let value = match kv.value.as_ref().and_then(|v| v.value.as_ref()) {
                    Some(v) => as_string(v, strings)?,
                    None => String::new(),
                };
                parts.push(format!("{}={value}", lookup(strings, kv.key)?));
            }
            format!("{{{}}}", parts.join(","))
        }
    })
}

/// The Agent stamps INTERNAL on spans whose tracer set no kind, so it must not mask the type.
fn kind_name(kind: i32) -> Option<&'static str> {
    match SpanKind::try_from(kind).ok()? {
        SpanKind::Unspecified | SpanKind::Internal => None,
        SpanKind::Server => Some("server"),
        SpanKind::Client => Some("client"),
        SpanKind::Producer => Some("producer"),
        SpanKind::Consumer => Some("consumer"),
    }
}

/// Upper and lower halves of a big-endian trace ID; a short ID fills the low-order bytes.
fn split_trace_id(bytes: &[u8]) -> (u64, u64) {
    let id = bytes
        .iter()
        .take(16)
        .fold(0u128, |id, b| (id << 8) | u128::from(*b));
    ((id >> 64) as u64, id as u64)
}

fn lookup(strings: &mut Strings<'_>, r: u32) -> Result<String, DatadogError> {
    let value = strings
        .table
        .get(r as usize)
        .ok_or_else(|| DatadogError::Decode(format!("string table ref {r} out of range")))?;
    strings.budget.charge(STRING_BYTES + value.len(), 1)?;
    Ok(value.clone())
}

#[cfg(test)]
mod tests {
    use idx::{AnyValue, ArrayValue, KeyValue, KeyValueList};

    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    fn unlimited() -> ExpansionBudget {
        ExpansionBudget(usize::MAX)
    }

    fn any(value: Value) -> AnyValue {
        AnyValue { value: Some(value) }
    }

    fn payload(strings: Vec<String>, span: idx::Span, trace_id: Vec<u8>) -> idx::TracerPayload {
        idx::TracerPayload {
            strings,
            chunks: vec![idx::TraceChunk {
                spans: vec![span],
                trace_id,
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn test_typed_attributes_split_into_meta_and_metrics() {
        let table = strings(&["", "s", "i", "d", "b", "raw", "arr", "kv", "x", "y"]);
        let span = idx::Span {
            attributes: [
                (1, any(Value::StringValueRef(8))),
                (2, any(Value::IntValue(7))),
                (3, any(Value::DoubleValue(1.5))),
                (4, any(Value::BoolValue(true))),
                (5, any(Value::BytesValue(vec![0x81]))),
                (
                    6,
                    any(Value::ArrayValue(ArrayValue {
                        values: vec![any(Value::IntValue(1)), any(Value::StringValueRef(9))],
                    })),
                ),
                (
                    7,
                    any(Value::KeyValueList(KeyValueList {
                        key_values: vec![KeyValue {
                            key: 8,
                            value: Some(any(Value::BoolValue(false))),
                        }],
                    })),
                ),
            ]
            .into(),
            ..Default::default()
        };
        let legacy = to_legacy(&payload(table, span, vec![]), &mut unlimited()).unwrap();
        let span = &legacy.chunks[0].spans[0];
        assert_eq!(span.meta["s"], "x");
        assert_eq!(span.meta["b"], "true");
        assert_eq!(span.meta["arr"], "[1,y]");
        assert_eq!(span.meta["kv"], "{x=false}");
        assert_eq!(span.metrics["i"], 7.0);
        assert_eq!(span.metrics["d"], 1.5);
        assert!(!span.meta.contains_key("raw"));
        assert!(!span.meta.contains_key(TID_KEY));
    }

    #[test]
    fn test_promoted_fields_fill_meta_without_overriding_it() {
        let table = strings(&["", "prod", "1.2", "requests", "env", "staging"]);
        let span = idx::Span {
            env_ref: 1,
            version_ref: 2,
            component_ref: 3,
            kind: SpanKind::Consumer as i32,
            attributes: [(4, any(Value::StringValueRef(5)))].into(),
            ..Default::default()
        };
        let legacy = to_legacy(&payload(table, span, vec![]), &mut unlimited()).unwrap();
        let meta = &legacy.chunks[0].spans[0].meta;
        assert_eq!(meta["env"], "staging");
        assert_eq!(meta["version"], "1.2");
        assert_eq!(meta["component"], "requests");
        assert_eq!(meta["span.kind"], "consumer");
    }

    #[test]
    fn test_shared_attributes_fill_spans_or_tracer_tags_without_overriding_them() {
        let table = strings(&["", "region", "eu", "us", "team", "a", "b", "rate", "span"]);
        let span = idx::Span {
            attributes: [(4, any(Value::StringValueRef(8)))].into(),
            ..Default::default()
        };
        let mut p = payload(table, span, vec![]);
        p.attributes = [
            (1, any(Value::StringValueRef(2))),
            (4, any(Value::StringValueRef(5))),
            (7, any(Value::DoubleValue(0.5))),
        ]
        .into();
        p.chunks[0].attributes = [(1, any(Value::StringValueRef(3)))].into();
        let legacy = to_legacy(&p, &mut unlimited()).unwrap();
        let span = &legacy.chunks[0].spans[0];
        assert_eq!(span.meta["region"], "us");
        assert_eq!(span.meta["team"], "span");
        assert_eq!(span.metrics["rate"], 0.5);
        assert_eq!(legacy.tags["region"], "eu");
        assert_eq!(legacy.tags["team"], "a");
        assert!(!legacy.tags.contains_key("rate"));
    }

    #[test]
    fn test_payload_string_attributes_are_tracer_tags_not_span_meta() {
        let table = strings(&["", "_dd.tags.container", "kube_namespace:shop"]);
        let mut p = payload(table, idx::Span::default(), vec![]);
        p.attributes = [(1, any(Value::StringValueRef(2)))].into();
        let legacy = to_legacy(&p, &mut unlimited()).unwrap();
        assert_eq!(legacy.tags["_dd.tags.container"], "kube_namespace:shop");
        assert!(legacy.chunks[0].spans[0].meta.is_empty());
    }

    #[test]
    fn test_unspecified_kind_adds_no_span_kind() {
        let legacy = to_legacy(
            &payload(strings(&[""]), idx::Span::default(), vec![]),
            &mut unlimited(),
        )
        .unwrap();
        assert!(legacy.chunks[0].spans[0].meta.is_empty());
    }

    #[test]
    fn test_internal_kind_leaves_the_span_type_to_decide() {
        use opentelemetry_proto::tonic::trace::v1::span::SpanKind as OtelKind;

        let table = strings(&["", "db", "web", "span.kind", "server"]);
        let kind_of = |type_ref: u32, attributes: HashMap<u32, idx::AnyValue>| {
            let span = idx::Span {
                kind: SpanKind::Internal as i32,
                type_ref,
                attributes,
                ..Default::default()
            };
            let legacy =
                to_legacy(&payload(table.clone(), span, vec![]), &mut unlimited()).unwrap();
            super::super::span_kind(&legacy.chunks[0].spans[0])
        };
        assert_eq!(kind_of(1, HashMap::new()), OtelKind::Client);
        assert_eq!(kind_of(2, HashMap::new()), OtelKind::Server);
        assert_eq!(kind_of(0, HashMap::new()), OtelKind::Unspecified);
        let explicit = [(3, any(Value::StringValueRef(4)))].into();
        assert_eq!(kind_of(1, explicit), OtelKind::Server);
    }

    #[test]
    fn test_chunk_trace_id_sets_ids_and_tid_on_first_span_only() {
        let trace_id = [0x6af1_2941_0000_0000u64.to_be_bytes(), 42u64.to_be_bytes()].concat();
        let mut p = payload(strings(&[""]), idx::Span::default(), trace_id);
        p.chunks[0].spans.push(idx::Span::default());
        let legacy = to_legacy(&p, &mut unlimited()).unwrap();
        let spans = &legacy.chunks[0].spans;
        assert_eq!(spans[0].trace_id, 42);
        assert_eq!(spans[1].trace_id, 42);
        assert_eq!(spans[0].meta[TID_KEY], "6af1294100000000");
        assert!(!spans[1].meta.contains_key(TID_KEY));
    }

    #[test]
    fn test_short_trace_id_fills_low_bytes() {
        assert_eq!(split_trace_id(&[1, 2]), (0, 0x0102));
        assert_eq!(split_trace_id(&[]), (0, 0));
    }

    #[test]
    fn test_links_and_events_resolve_strings() {
        let table = strings(&["", "dd=s:1", "peer", "svc", "retry", "attempt"]);
        let span = idx::Span {
            links: vec![idx::SpanLink {
                trace_id: [1u64.to_be_bytes(), 5u64.to_be_bytes()].concat(),
                span_id: 6,
                tracestate_ref: 1,
                flags: 1,
                attributes: [(2, any(Value::StringValueRef(3)))].into(),
            }],
            events: vec![idx::SpanEvent {
                time: 99,
                name_ref: 4,
                attributes: [(5, any(Value::IntValue(2)))].into(),
            }],
            ..Default::default()
        };
        let legacy = to_legacy(&payload(table, span, vec![]), &mut unlimited()).unwrap();
        let span = &legacy.chunks[0].spans[0];
        let link = &span.span_links[0];
        assert_eq!((link.trace_id_high, link.trace_id, link.span_id), (1, 5, 6));
        assert_eq!(link.tracestate, "dd=s:1");
        assert_eq!(link.attributes["peer"], "svc");
        let event = &span.span_events[0];
        assert_eq!((event.time_unix_nano, event.name.as_str()), (99, "retry"));
        assert_eq!(event.attributes["attempt"].int_value, 2);
        assert_eq!(
            event.attributes["attempt"].r#type,
            AttributeAnyValueType::IntValue as i32
        );
    }

    #[test]
    fn test_out_of_range_string_ref_is_a_decode_error() {
        let span = idx::Span {
            service_ref: 3,
            ..Default::default()
        };
        assert!(to_legacy(&payload(strings(&[""]), span, vec![]), &mut unlimited()).is_err());
    }
}
