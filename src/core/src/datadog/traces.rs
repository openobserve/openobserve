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
//
// Portions ported from opentelemetry-collector-contrib receiver/datadogreceiver (Apache-2.0).

mod idx;

use std::collections::{BTreeMap, HashMap};

use opentelemetry_proto::tonic::{
    collector::trace::v1::ExportTraceServiceRequest,
    common::v1::{AnyValue, ArrayValue, KeyValue, any_value::Value},
    trace::v1::{
        ResourceSpans, ScopeSpans, Span, Status,
        span::{Event, Link, SpanKind},
        status::StatusCode,
    },
};
use prost::Message;
use proto::datadog_trace::{
    AgentPayload, AttributeAnyValue, AttributeArrayValue, Span as DdSpan, SpanEvent, SpanLink,
    TracerPayload, attribute_any_value::AttributeAnyValueType,
    attribute_array_value::AttributeArrayValueType,
};

use super::{
    DatadogError, ExpansionBudget, RECORD_BYTES, resource_bytes,
    tags::{
        DEPLOYMENT_ENVIRONMENT_NAME, HOST_NAME, SERVICE_NAME, key_value, resource, resource_key,
        string_kv,
    },
};

const TID_KEY: &str = "_dd.p.tid";
const BASE_SERVICE_KEY: &str = "_dd.base_service";
const PEER_KEYS: [(&[&str], &str); 3] = [
    (&["peer.hostname", "out.host"], "server.address"),
    (&["db.instance"], "db.namespace"),
    (&["db.type"], "db.system.name"),
];

/// Translates a trace-agent `AgentPayload` into OTLP, one resource per tracer payload and service.
pub fn agent_payload_to_otlp(body: &[u8]) -> Result<ExportTraceServiceRequest, DatadogError> {
    let mut payload =
        AgentPayload::decode(body).map_err(|e| DatadogError::Decode(e.to_string()))?;
    let mut budget = ExpansionBudget::new(body);
    let mut tracers = std::mem::take(&mut payload.tracer_payloads);
    for tracer in &payload.idx_tracer_payloads {
        tracers.push(idx::to_legacy(tracer, &mut budget)?);
    }
    let upper_ids = upper_trace_ids(&tracers);
    let mut resource_spans = Vec::new();
    for tracer in &tracers {
        resource_spans.extend(tracer_payload_to_resource_spans(
            tracer,
            &payload,
            &upper_ids,
            &mut budget,
        )?);
    }
    Ok(ExportTraceServiceRequest { resource_spans })
}

/// Lower to upper trace ID halves, for a partial-flush chunk that carries no `_dd.p.tid`.
fn upper_trace_ids(tracers: &[TracerPayload]) -> HashMap<u64, u64> {
    let mut ids = HashMap::new();
    for chunk in tracers.iter().flat_map(|tracer| &tracer.chunks) {
        if let Some((lower, upper)) = chunk_tid(&chunk.spans) {
            ids.entry(lower).or_insert(upper);
        }
    }
    ids
}

fn tracer_payload_to_resource_spans(
    tracer: &TracerPayload,
    agent: &AgentPayload,
    upper_ids: &HashMap<u64, u64>,
    budget: &mut ExpansionBudget,
) -> Result<Vec<ResourceSpans>, DatadogError> {
    let base = tracer_resource(tracer, agent);
    // Downstream trace ingest merges the resource into every span.
    let spans = tracer.chunks.iter().flat_map(|c| &c.spans);
    budget.charge(RECORD_BYTES + resource_bytes(&base), spans.clone().count())?;
    let nested = spans
        .map(|s| s.span_events.len() + s.span_links.len())
        .sum();
    budget.charge(RECORD_BYTES, nested)?;
    let mut by_service: BTreeMap<String, Vec<Span>> = BTreeMap::new();
    for chunk in &tracer.chunks {
        let own = chunk_tid(&chunk.spans).map(|(_, upper)| upper);
        for span in &chunk.spans {
            let upper = own.or_else(|| upper_ids.get(&span.trace_id).copied());
            let (service, otlp_span) = convert_span(span, upper.unwrap_or(0));
            by_service.entry(service).or_default().push(otlp_span);
        }
    }
    Ok(by_service
        .into_iter()
        .map(|(service, spans)| {
            let mut attributes = base.clone();
            attributes.insert(SERVICE_NAME.to_string(), service);
            ResourceSpans {
                resource: Some(resource(attributes)),
                scope_spans: vec![ScopeSpans {
                    spans,
                    ..Default::default()
                }],
                ..Default::default()
            }
        })
        .collect())
}

/// A chunk holds one trace: its lower half and the upper half from `_dd.p.tid` on any span.
fn chunk_tid(spans: &[DdSpan]) -> Option<(u64, u64)> {
    for span in spans {
        let Some(tid) = span.meta.get(TID_KEY) else {
            continue;
        };
        match u64::from_str_radix(tid, 16) {
            Ok(upper) => return Some((span.trace_id, upper)),
            Err(_) => log::warn!("[DATADOG] ignoring invalid {TID_KEY} {tid:?}"),
        }
    }
    None
}

/// Resource from the tracer payload over its tags; the Agent's env and host fill only empty fields.
fn tracer_resource(tracer: &TracerPayload, agent: &AgentPayload) -> BTreeMap<String, String> {
    let mut attributes: BTreeMap<String, String> = tracer
        .tags
        .iter()
        .filter(|(_, value)| !value.is_empty())
        .map(|(key, value)| {
            let key = resource_key(&key.to_lowercase()).map_or_else(|| key.clone(), str::to_string);
            (key, value.clone())
        })
        .collect();
    let env = if tracer.env.is_empty() {
        &agent.env
    } else {
        &tracer.env
    };
    let host = if tracer.hostname.is_empty() {
        &agent.host_name
    } else {
        &tracer.hostname
    };
    let fields = [
        (DEPLOYMENT_ENVIRONMENT_NAME, env),
        (HOST_NAME, host),
        ("service.version", &tracer.app_version),
        ("container.id", &tracer.container_id),
        ("telemetry.sdk.language", &tracer.language_name),
    ];
    attributes.extend(
        fields
            .into_iter()
            .filter(|(_, value)| !value.is_empty())
            .map(|(key, value)| (key.to_string(), value.clone())),
    );
    attributes
}

/// Converts one span and returns the service it belongs under.
fn convert_span(span: &DdSpan, upper: u64) -> (String, Span) {
    let mut attributes = span_attributes(span);
    let service = match span.meta.get(BASE_SERVICE_KEY).filter(|s| !s.is_empty()) {
        Some(base) => {
            attributes.push(string_kv("datadog.service", &span.service));
            base.clone()
        }
        None => span.service.clone(),
    };
    let start = span.start.max(0) as u64;
    let status = if span.error > 0 {
        Status {
            code: StatusCode::Error as i32,
            message: span.meta.get("error.message").cloned().unwrap_or_default(),
        }
    } else {
        Status::default()
    };
    let otlp_span = Span {
        trace_id: trace_id_bytes(upper, span.trace_id),
        span_id: span.span_id.to_be_bytes().to_vec(),
        parent_span_id: if span.parent_id == 0 {
            Vec::new()
        } else {
            span.parent_id.to_be_bytes().to_vec()
        },
        name: span.name.clone(),
        kind: span_kind(span) as i32,
        start_time_unix_nano: start,
        end_time_unix_nano: start.saturating_add(span.duration.max(0) as u64),
        attributes,
        events: span.span_events.iter().map(convert_event).collect(),
        links: span.span_links.iter().map(convert_link).collect(),
        status: Some(status),
        ..Default::default()
    };
    (service, otlp_span)
}

fn span_attributes(span: &DdSpan) -> Vec<KeyValue> {
    let mut attributes: Vec<KeyValue> = span
        .meta
        .iter()
        .map(|(k, v)| string_kv(k.as_str(), v.as_str()))
        .chain(
            span.metrics
                .iter()
                .map(|(k, v)| key_value(k.as_str(), Value::DoubleValue(*v))),
        )
        .collect();
    if !span.resource.is_empty() {
        attributes.push(string_kv("datadog.resource", &span.resource));
    }
    if !span.r#type.is_empty() {
        attributes.push(string_kv("datadog.span.type", &span.r#type));
    }
    for (dd_keys, otel_key) in PEER_KEYS {
        if span.meta.contains_key(otel_key) {
            continue;
        }
        if let Some(value) = dd_keys.iter().find_map(|k| span.meta.get(*k)) {
            attributes.push(string_kv(otel_key, value.as_str()));
        }
    }
    attributes
}

fn span_kind(span: &DdSpan) -> SpanKind {
    match span.meta.get("span.kind").map(String::as_str) {
        Some("server") => SpanKind::Server,
        Some("client") => SpanKind::Client,
        Some("producer") => SpanKind::Producer,
        Some("consumer") => SpanKind::Consumer,
        Some("internal") => SpanKind::Internal,
        _ => match span.r#type.as_str() {
            "web" => SpanKind::Server,
            "http" | "db" | "cache" => SpanKind::Client,
            _ => SpanKind::Unspecified,
        },
    }
}

fn trace_id_bytes(upper: u64, lower: u64) -> Vec<u8> {
    ((u128::from(upper) << 64) | u128::from(lower))
        .to_be_bytes()
        .to_vec()
}

fn convert_link(link: &SpanLink) -> Link {
    Link {
        trace_id: trace_id_bytes(link.trace_id_high, link.trace_id),
        span_id: link.span_id.to_be_bytes().to_vec(),
        trace_state: link.tracestate.clone(),
        attributes: link
            .attributes
            .iter()
            .map(|(k, v)| string_kv(k.as_str(), v.as_str()))
            .collect(),
        flags: link.flags,
        ..Default::default()
    }
}

fn convert_event(event: &SpanEvent) -> Event {
    Event {
        time_unix_nano: event.time_unix_nano,
        name: event.name.clone(),
        attributes: event
            .attributes
            .iter()
            .filter_map(|(k, v)| any_value(v).map(|value| key_value(k.as_str(), value)))
            .collect(),
        ..Default::default()
    }
}

fn any_value(value: &AttributeAnyValue) -> Option<Value> {
    Some(match AttributeAnyValueType::try_from(value.r#type).ok()? {
        AttributeAnyValueType::StringValue => Value::StringValue(value.string_value.clone()),
        AttributeAnyValueType::BoolValue => Value::BoolValue(value.bool_value),
        AttributeAnyValueType::IntValue => Value::IntValue(value.int_value),
        AttributeAnyValueType::DoubleValue => Value::DoubleValue(value.double_value),
        AttributeAnyValueType::ArrayValue => Value::ArrayValue(ArrayValue {
            values: value
                .array_value
                .iter()
                .flat_map(|array| &array.values)
                .filter_map(array_element)
                .map(|v| AnyValue { value: Some(v) })
                .collect(),
        }),
    })
}

fn array_element(value: &AttributeArrayValue) -> Option<Value> {
    Some(
        match AttributeArrayValueType::try_from(value.r#type).ok()? {
            AttributeArrayValueType::StringValue => Value::StringValue(value.string_value.clone()),
            AttributeArrayValueType::BoolValue => Value::BoolValue(value.bool_value),
            AttributeArrayValueType::IntValue => Value::IntValue(value.int_value),
            AttributeArrayValueType::DoubleValue => Value::DoubleValue(value.double_value),
        },
    )
}

#[cfg(test)]
mod tests {
    use proto::datadog_trace::TraceChunk;

    use super::*;

    fn dd_span(trace_id: u64, span_id: u64, parent_id: u64, meta: &[(&str, &str)]) -> DdSpan {
        DdSpan {
            service: "checkout".into(),
            name: "servlet.request".into(),
            resource: "GET /cart".into(),
            trace_id,
            span_id,
            parent_id,
            start: 1_700_000_000_000_000_000,
            duration: 5_000,
            meta: meta
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Default::default()
        }
    }

    fn tracer(env: &str, hostname: &str, spans: Vec<DdSpan>) -> TracerPayload {
        TracerPayload {
            env: env.into(),
            hostname: hostname.into(),
            language_name: "java".into(),
            chunks: vec![TraceChunk {
                spans,
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn translate(payload: AgentPayload) -> ExportTraceServiceRequest {
        agent_payload_to_otlp(&payload.encode_to_vec()).unwrap()
    }

    fn attr<'a>(attrs: &'a [KeyValue], key: &str) -> Option<&'a Value> {
        attrs
            .iter()
            .find(|kv| kv.key == key)
            .and_then(|kv| kv.value.as_ref())
            .and_then(|v| v.value.as_ref())
    }

    fn str_attr<'a>(attrs: &'a [KeyValue], key: &str) -> Option<&'a str> {
        match attr(attrs, key) {
            Some(Value::StringValue(s)) => Some(s),
            _ => None,
        }
    }

    fn all_spans(t: &ExportTraceServiceRequest) -> Vec<&Span> {
        t.resource_spans
            .iter()
            .flat_map(|rs| &rs.scope_spans)
            .flat_map(|ss| &ss.spans)
            .collect()
    }

    #[test]
    fn test_64_bit_ids_and_root_parent() {
        let t = translate(AgentPayload {
            tracer_payloads: vec![tracer("prod", "web-1", vec![dd_span(42, 7, 0, &[])])],
            ..Default::default()
        });
        let span = all_spans(&t)[0];
        assert_eq!(span.trace_id, [vec![0u8; 15], vec![42]].concat());
        assert_eq!(span.span_id, 7u64.to_be_bytes());
        assert!(span.parent_span_id.is_empty());
        assert_eq!(span.end_time_unix_nano - span.start_time_unix_nano, 5_000);
        assert_eq!(span.kind, SpanKind::Unspecified as i32);
        assert_eq!(
            str_attr(&span.attributes, "datadog.resource"),
            Some("GET /cart")
        );
    }

    #[test]
    fn test_128_bit_trace_id_from_tid_on_root_listed_last() {
        let child = dd_span(42, 8, 7, &[("span.kind", "client")]);
        let root = dd_span(42, 7, 0, &[(TID_KEY, "6553f1a400000000")]);
        let mut error_span = dd_span(42, 9, 7, &[("error.message", "boom")]);
        error_span.error = 1;
        let t = translate(AgentPayload {
            tracer_payloads: vec![tracer("prod", "web-1", vec![child, error_span, root])],
            ..Default::default()
        });
        let expected = [0x6553f1a400000000u64.to_be_bytes(), 42u64.to_be_bytes()].concat();
        let spans = all_spans(&t);
        assert_eq!(spans.len(), 3);
        for span in &spans {
            assert_eq!(span.trace_id, expected);
        }
        assert_eq!(spans[0].parent_span_id, 7u64.to_be_bytes());
        assert_eq!(spans[0].kind, SpanKind::Client as i32);
        let status = spans[1].status.as_ref().unwrap();
        assert_eq!(status.code, StatusCode::Error as i32);
        assert_eq!(status.message, "boom");
    }

    #[test]
    fn test_tid_applies_only_to_its_own_chunk() {
        let mut payload = tracer("prod", "web-1", vec![dd_span(42, 7, 0, &[(TID_KEY, "aa")])]);
        payload.chunks.push(TraceChunk {
            spans: vec![dd_span(42, 8, 0, &[(TID_KEY, "bb")])],
            ..Default::default()
        });
        payload.chunks.push(TraceChunk {
            spans: vec![dd_span(43, 9, 0, &[])],
            ..Default::default()
        });
        let t = translate(AgentPayload {
            tracer_payloads: vec![payload],
            ..Default::default()
        });
        let uppers: Vec<_> = all_spans(&t)
            .iter()
            .map(|s| (s.span_id.clone(), s.trace_id[..8].to_vec()))
            .collect();
        assert_eq!(
            uppers,
            [
                (7u64.to_be_bytes().to_vec(), 0xaau64.to_be_bytes().to_vec()),
                (8u64.to_be_bytes().to_vec(), 0xbbu64.to_be_bytes().to_vec()),
                (9u64.to_be_bytes().to_vec(), vec![0u8; 8]),
            ]
        );
    }

    #[test]
    fn test_a_partial_flush_chunk_without_tid_inherits_it_from_its_trace() {
        let mut payload = tracer("prod", "web-1", vec![dd_span(42, 8, 7, &[(TID_KEY, "aa")])]);
        payload.chunks.push(TraceChunk {
            spans: vec![dd_span(42, 7, 0, &[])],
            ..Default::default()
        });
        let t = translate(AgentPayload {
            tracer_payloads: vec![payload],
            ..Default::default()
        });
        for span in all_spans(&t) {
            assert_eq!(
                span.trace_id[..8],
                0xaau64.to_be_bytes(),
                "{:?}",
                span.span_id
            );
        }
    }

    #[test]
    fn test_base_service_becomes_service_name() {
        let mut db = dd_span(42, 8, 7, &[(BASE_SERVICE_KEY, "checkout")]);
        db.service = "postgresql".into();
        let t = translate(AgentPayload {
            tracer_payloads: vec![tracer("prod", "web-1", vec![dd_span(42, 7, 0, &[]), db])],
            ..Default::default()
        });
        assert_eq!(t.resource_spans.len(), 1);
        let rs = &t.resource_spans[0];
        let res = &rs.resource.as_ref().unwrap().attributes;
        assert_eq!(str_attr(res, SERVICE_NAME), Some("checkout"));
        let db_span = &rs.scope_spans[0].spans[1];
        assert_eq!(
            str_attr(&db_span.attributes, "datadog.service"),
            Some("postgresql")
        );
    }

    #[test]
    fn test_two_tracer_payloads_keep_their_own_env_and_host() {
        let mut other = tracer("", "", vec![dd_span(1, 2, 0, &[])]);
        other.chunks[0].spans[0].service = "billing".into();
        let t = translate(AgentPayload {
            host_name: "agent-host".into(),
            env: "agent-env".into(),
            tracer_payloads: vec![tracer("prod", "web-1", vec![dd_span(42, 7, 0, &[])]), other],
            ..Default::default()
        });
        let resources: Vec<_> = t
            .resource_spans
            .iter()
            .map(|rs| &rs.resource.as_ref().unwrap().attributes)
            .collect();
        assert_eq!(resources.len(), 2);
        assert_eq!(
            str_attr(resources[0], DEPLOYMENT_ENVIRONMENT_NAME),
            Some("prod")
        );
        assert_eq!(str_attr(resources[0], HOST_NAME), Some("web-1"));
        assert_eq!(str_attr(resources[0], SERVICE_NAME), Some("checkout"));
        assert_eq!(
            str_attr(resources[1], DEPLOYMENT_ENVIRONMENT_NAME),
            Some("agent-env")
        );
        assert_eq!(str_attr(resources[1], HOST_NAME), Some("agent-host"));
        assert_eq!(str_attr(resources[1], SERVICE_NAME), Some("billing"));
    }

    #[test]
    fn test_jdbc_meta_keys_get_otel_peer_names() {
        let mut jdbc = dd_span(
            42,
            8,
            7,
            &[
                ("db.type", "postgresql"),
                ("db.instance", "orders"),
                ("peer.hostname", "pg.internal"),
                ("span.kind", "client"),
            ],
        );
        jdbc.r#type = "sql".into();
        let mut redis = dd_span(
            42,
            9,
            7,
            &[
                ("out.host", "cache.internal"),
                ("server.address", "redis:6379"),
            ],
        );
        redis.r#type = "cache".into();
        let t = translate(AgentPayload {
            tracer_payloads: vec![tracer("prod", "web-1", vec![jdbc, redis])],
            ..Default::default()
        });
        let spans = all_spans(&t);
        let attrs = &spans[0].attributes;
        assert_eq!(str_attr(attrs, "server.address"), Some("pg.internal"));
        assert_eq!(str_attr(attrs, "db.namespace"), Some("orders"));
        assert_eq!(str_attr(attrs, "db.system.name"), Some("postgresql"));
        assert_eq!(str_attr(attrs, "db.type"), Some("postgresql"));
        assert_eq!(str_attr(attrs, "datadog.span.type"), Some("sql"));
        assert_eq!(spans[1].kind, SpanKind::Client as i32);
        let server_addresses = spans[1]
            .attributes
            .iter()
            .filter(|kv| kv.key == "server.address")
            .count();
        assert_eq!(server_addresses, 1);
        assert_eq!(
            str_attr(&spans[1].attributes, "server.address"),
            Some("redis:6379")
        );
    }

    #[test]
    fn test_native_span_links_and_events() {
        let mut span = dd_span(42, 7, 0, &[]);
        span.span_links = vec![SpanLink {
            trace_id: 5,
            trace_id_high: 1,
            span_id: 6,
            tracestate: "dd=s:1".into(),
            flags: 1,
            ..Default::default()
        }];
        span.span_events = vec![SpanEvent {
            time_unix_nano: 99,
            name: "retry".into(),
            attributes: [(
                "attempt".to_string(),
                AttributeAnyValue {
                    r#type: AttributeAnyValueType::IntValue as i32,
                    int_value: 2,
                    ..Default::default()
                },
            )]
            .into(),
        }];
        span.metrics = [("_sampling_priority_v1".to_string(), 1.0)].into();
        let t = translate(AgentPayload {
            tracer_payloads: vec![tracer("prod", "web-1", vec![span])],
            ..Default::default()
        });
        let span = all_spans(&t)[0];
        assert_eq!(
            span.links[0].trace_id,
            [1u64.to_be_bytes(), 5u64.to_be_bytes()].concat()
        );
        assert_eq!(span.links[0].trace_state, "dd=s:1");
        assert_eq!(span.events[0].name, "retry");
        assert_eq!(
            attr(&span.events[0].attributes, "attempt"),
            Some(&Value::IntValue(2))
        );
        assert_eq!(
            attr(&span.attributes, "_sampling_priority_v1"),
            Some(&Value::DoubleValue(1.0))
        );
    }

    #[test]
    fn test_tracer_payload_tags_become_resource_attributes_below_payload_fields() {
        let mut t = tracer("prod", "web-1", vec![dd_span(1, 1, 0, &[])]);
        t.tags = [
            ("_dd.tags.container", "kube_namespace:shop,pod_name:web-1"),
            ("kube_namespace", "shop"),
            ("env", "from-tag"),
            ("empty", ""),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let req = translate(AgentPayload {
            tracer_payloads: vec![t],
            ..Default::default()
        });
        let res = &req.resource_spans[0].resource.as_ref().unwrap().attributes;
        assert_eq!(
            str_attr(res, "_dd.tags.container"),
            Some("kube_namespace:shop,pod_name:web-1")
        );
        assert_eq!(str_attr(res, "k8s.namespace.name"), Some("shop"));
        assert_eq!(str_attr(res, DEPLOYMENT_ENVIRONMENT_NAME), Some("prod"));
        assert_eq!(str_attr(res, "empty"), None);
    }

    #[test]
    fn test_tracer_tags_on_many_services_past_the_size_budget_are_rejected() {
        let spans = (0..5000)
            .map(|i| DdSpan {
                service: format!("s{i}"),
                ..Default::default()
            })
            .collect();
        let mut t = tracer("prod", "web-1", spans);
        t.tags = (0..50)
            .map(|i| (format!("tag{i}"), "v".repeat(50)))
            .collect();
        let body = AgentPayload {
            tracer_payloads: vec![t],
            ..Default::default()
        }
        .encode_to_vec();
        let err = agent_payload_to_otlp(&body).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_many_empty_spans_past_the_size_budget_are_rejected() {
        let mut t = tracer("", "", vec![DdSpan::default(); 200_000]);
        t.language_name = String::new();
        let body = AgentPayload {
            tracer_payloads: vec![t],
            ..Default::default()
        }
        .encode_to_vec();
        let err = agent_payload_to_otlp(&body).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_compact_spans_sharing_many_tracer_tags_fit_the_budget() {
        let spans = (0..5000).map(|i| dd_span(i, i, 0, &[])).collect();
        let mut t = tracer("prod", "web-1", spans);
        t.tags = (0..20)
            .map(|i| (format!("tag{i}"), "v".repeat(50)))
            .collect();
        let body = AgentPayload {
            tracer_payloads: vec![t],
            ..Default::default()
        }
        .encode_to_vec();
        assert!(body.len() > 64 * 1024);
        assert!(agent_payload_to_otlp(&body).is_ok());
    }

    #[test]
    fn test_many_empty_span_events_past_the_size_budget_are_rejected() {
        let span = DdSpan {
            span_events: vec![SpanEvent::default(); 200_000],
            ..Default::default()
        };
        let mut t = tracer("", "", vec![span]);
        t.language_name = String::new();
        let body = AgentPayload {
            tracer_payloads: vec![t],
            ..Default::default()
        }
        .encode_to_vec();
        let err = agent_payload_to_otlp(&body).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_tracer_tags_on_many_spans_of_one_service_past_the_size_budget_are_rejected() {
        let spans = (0..5000)
            .map(|i| DdSpan {
                service: "web".into(),
                span_id: i,
                ..Default::default()
            })
            .collect();
        let mut t = tracer("prod", "web-1", spans);
        t.tags = (0..50)
            .map(|i| (format!("tag{i}"), "v".repeat(50)))
            .collect();
        let body = AgentPayload {
            tracer_payloads: vec![t],
            ..Default::default()
        }
        .encode_to_vec();
        let err = agent_payload_to_otlp(&body).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_idx_chunk_attributes_on_many_spans_past_the_size_budget_are_rejected() {
        use proto::datadog_trace::idx as v1;

        let mut strings = vec![String::new(), "v".repeat(50)];
        strings.extend((0..50).map(|i| format!("tag{i}")));
        let value = v1::AnyValue {
            value: Some(v1::any_value::Value::StringValueRef(1)),
        };
        let chunk = v1::TraceChunk {
            spans: vec![v1::Span::default(); 5000],
            attributes: (2..52).map(|r| (r, value.clone())).collect(),
            ..Default::default()
        };
        let body = AgentPayload {
            idx_tracer_payloads: vec![v1::TracerPayload {
                strings,
                chunks: vec![chunk],
                ..Default::default()
            }],
            ..Default::default()
        }
        .encode_to_vec();
        let err = agent_payload_to_otlp(&body).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_a_large_string_referenced_by_many_idx_spans_past_the_size_budget_is_rejected() {
        use proto::datadog_trace::idx as v1;

        let span = v1::Span {
            service_ref: 1,
            ..Default::default()
        };
        let body = AgentPayload {
            idx_tracer_payloads: vec![v1::TracerPayload {
                strings: vec![String::new(), "x".repeat(64 * 1024)],
                chunks: vec![v1::TraceChunk {
                    spans: vec![span; 2000],
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
        .encode_to_vec();
        let result = agent_payload_to_otlp(&body);
        let rejected = matches!(&result, Err(e) if e.to_string().contains("size budget"));
        assert!(rejected, "payload was not rejected by the size budget");
    }

    #[test]
    fn test_garbage_is_a_decode_error() {
        assert!(agent_payload_to_otlp(b"\xff\xff\xff\xff").is_err());
    }
}
