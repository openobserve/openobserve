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

//! Samples → metrics JSON records → `IngestionRequest` chunks → reply classification.

use config::meta::stream::StreamType;
use proto::cluster_rpc;
use serde_json::{Map, Value, json};

use super::{
    PROCESSED_TIMESTAMP_STREAM,
    resolve::{CLIENT_TYPE_USER, SeriesKey},
    sql::{BUCKET_LE, WindowCounts},
    state::{Batch, Sample},
};

pub const M_REQUEST_TOTAL: &str = "traces_service_graph_request_total";
pub const M_REQUEST_FAILED_TOTAL: &str = "traces_service_graph_request_failed_total";
pub const M_CLIENT_SECONDS: &str = "traces_service_graph_request_client_seconds";
pub const M_SERVER_SECONDS: &str = "traces_service_graph_request_server_seconds";
pub const M_UNRESOLVED_TOTAL: &str = "traces_service_graph_unresolved_total";
pub const M_AGENT_INSTANCES: &str = "traces_service_graph_agent_instances";
pub const LABEL_TRACE_STREAM: &str = "trace_stream";
/// Fraction of the gRPC message limit a request may use; the rest is headers and compression slack.
const REQUEST_FILL_RATIO: f64 = 0.9;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplyClass {
    Ok,
    Partial,
    Rejected,
    Retry,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    Delivered,
    Rejected,
    Failed,
}

pub fn classify(status_code: i32) -> ReplyClass {
    match status_code {
        200 => ReplyClass::Ok,
        207 => ReplyClass::Partial,
        429 | 503 => ReplyClass::Rejected,
        _ => ReplyClass::Retry,
    }
}

pub fn max_request_bytes() -> usize {
    let limit = config::get_config().grpc.max_message_size * 1024 * 1024;
    ((limit as f64) * REQUEST_FILL_RATIO) as usize
}

pub fn render(stream: &str, batch: &Batch) -> Vec<Value> {
    let mut out = Vec::with_capacity(batch.samples.len() * 22 + batch.instances.len() + 1);
    for sample in &batch.samples {
        render_sample(stream, sample, &mut out);
    }
    for (key, instances) in &batch.instances {
        if key.is_edge() {
            let labels = labels_for(stream, key);
            out.push(record(
                M_AGENT_INSTANCES,
                "gauge",
                batch.window_end,
                *instances as f64,
                &labels,
            ));
        }
    }
    let mut labels = Map::new();
    labels.insert(LABEL_TRACE_STREAM.into(), stream.into());
    out.push(record(
        PROCESSED_TIMESTAMP_STREAM,
        "gauge",
        batch.window_end,
        batch.window_end as f64 / 1e6,
        &labels,
    ));
    out
}

pub fn chunk(records: &[Value], max_bytes: usize) -> Vec<Vec<u8>> {
    let mut chunks = vec![];
    let mut cur = b"[".to_vec();
    let mut n = 0;
    for r in records {
        let bytes = serde_json::to_vec(r).unwrap_or_default();
        if n > 0 && cur.len() + bytes.len() + 2 > max_bytes {
            cur.push(b']');
            chunks.push(std::mem::replace(&mut cur, b"[".to_vec()));
            n = 0;
        }
        if n > 0 {
            cur.push(b',');
        }
        cur.extend_from_slice(&bytes);
        n += 1;
    }
    if n > 0 {
        cur.push(b']');
        chunks.push(cur);
    }
    chunks
}

pub async fn write_batch(org: &str, chunks: Vec<Vec<u8>>) -> WriteOutcome {
    let mut partial_warned = false;
    for chunk in chunks {
        let mut retried = false;
        loop {
            match send(org, chunk.clone()).await {
                ReplyClass::Ok => break,
                ReplyClass::Partial => {
                    // 207 = whole pipeline batch failed on the ingester; retry cannot help (§7.1)
                    if !partial_warned {
                        partial_warned = true;
                        log::warn!(
                            "[ServiceGraph] org {org}: metrics batch partially failed (207)"
                        );
                    }
                    break;
                }
                ReplyClass::Rejected => return WriteOutcome::Rejected,
                ReplyClass::Retry if !retried => retried = true,
                ReplyClass::Retry => return WriteOutcome::Failed,
            }
        }
    }
    WriteOutcome::Delivered
}

pub fn request(org: &str, data: Vec<u8>) -> cluster_rpc::IngestionRequest {
    cluster_rpc::IngestionRequest {
        org_id: org.to_string(),
        stream_type: StreamType::Metrics.to_string(),
        stream_name: String::new(),
        data: Some(cluster_rpc::IngestionData { data }),
        ingestion_type: Some(cluster_rpc::IngestionType::Json.into()),
        metadata: None,
    }
}

async fn send(org: &str, data: Vec<u8>) -> ReplyClass {
    match crate::ingestion::ingestion_service::ingest(request(org, data)).await {
        Ok(resp) => {
            let class = classify(resp.status_code);
            if class != ReplyClass::Ok {
                log::warn!(
                    "[ServiceGraph] org {org}: metrics write replied {} {}",
                    resp.status_code,
                    resp.message
                );
            }
            class
        }
        Err(e) => {
            log::error!("[ServiceGraph] org {org}: metrics write failed: {e}");
            ReplyClass::Retry
        }
    }
}

fn render_sample(stream: &str, sample: &Sample, out: &mut Vec<Value>) {
    let ts = sample.ts;
    let c = &sample.counts;
    let labels = labels_for(stream, &sample.key);
    match &sample.key {
        SeriesKey::Edge { client_type, .. } => {
            out.push(record(
                M_REQUEST_TOTAL,
                "counter",
                ts,
                c.requests as f64,
                &labels,
            ));
            out.push(record(
                M_REQUEST_FAILED_TOTAL,
                "counter",
                ts,
                c.errors as f64,
                &labels,
            ));
            // entry edges come from Q1's root count alone, which carries no latency
            if client_type != CLIENT_TYPE_USER {
                histogram(M_CLIENT_SECONDS, ts, c, &labels, out);
            }
        }
        SeriesKey::Node { .. } => histogram(M_SERVER_SECONDS, ts, c, &labels, out),
        SeriesKey::Unresolved { .. } => out.push(record(
            M_UNRESOLVED_TOTAL,
            "counter",
            ts,
            c.requests as f64,
            &labels,
        )),
    }
}

/// Optional labels are present only when non-empty, so absent and empty read the same in PromQL.
fn labels_for(stream: &str, key: &SeriesKey) -> Map<String, Value> {
    let mut labels = Map::new();
    labels.insert(LABEL_TRACE_STREAM.into(), stream.into());
    match key {
        SeriesKey::Edge {
            client,
            client_type,
            server,
            connection_type,
            agent_env,
        } => {
            labels.insert("client".into(), client.as_str().into());
            labels.insert("server".into(), server.as_str().into());
            for (name, value) in [
                ("client_type", client_type),
                ("connection_type", connection_type),
                ("agent_env", agent_env),
            ] {
                if !value.is_empty() {
                    labels.insert(name.into(), value.as_str().into());
                }
            }
        }
        SeriesKey::Node { server } => {
            labels.insert("server".into(), server.as_str().into());
        }
        SeriesKey::Unresolved { client, reason } => {
            labels.insert("client".into(), client.as_str().into());
            labels.insert("reason".into(), reason.as_str().into());
        }
    }
    labels
}

/// Classic histogram: cumulative `_bucket{le}` (`+Inf` = requests), `_sum` in seconds, `_count`.
fn histogram(
    prefix: &str,
    ts: i64,
    c: &WindowCounts,
    labels: &Map<String, Value>,
    out: &mut Vec<Value>,
) {
    let bucket_name = format!("{prefix}_bucket");
    for (i, le) in BUCKET_LE.iter().enumerate() {
        let value = c.buckets.get(i).copied().unwrap_or(c.requests) as f64;
        let mut bucket_labels = labels.clone();
        bucket_labels.insert("le".into(), (*le).into());
        out.push(record(&bucket_name, "histogram", ts, value, &bucket_labels));
    }
    out.push(record(
        &format!("{prefix}_sum"),
        "histogram",
        ts,
        c.dur_sum as f64 / 1e6,
        labels,
    ));
    out.push(record(
        &format!("{prefix}_count"),
        "histogram",
        ts,
        c.requests as f64,
        labels,
    ));
}

fn record(name: &str, kind: &str, ts: i64, value: f64, labels: &Map<String, Value>) -> Value {
    let mut rec = labels.clone();
    rec.insert("__name__".into(), name.into());
    rec.insert("__type__".into(), kind.into());
    rec.insert("_timestamp".into(), json!(ts));
    rec.insert("value".into(), json!(value));
    Value::Object(rec)
}

#[cfg(test)]
mod tests {
    use config::utils::time::SECOND_MICRO_SECS;

    use super::*;

    fn counts() -> WindowCounts {
        let mut buckets = [0u64; 17];
        buckets[0] = 1;
        buckets[1] = 3;
        for b in buckets.iter_mut().skip(2) {
            *b = 4;
        }
        WindowCounts {
            requests: 5,
            errors: 2,
            dur_sum: 2_500_000,
            buckets,
        }
    }

    fn batch(key: SeriesKey) -> Batch {
        Batch {
            window_end: 60 * SECOND_MICRO_SECS,
            samples: vec![Sample {
                key,
                ts: 60 * SECOND_MICRO_SECS,
                counts: counts(),
            }],
            instances: vec![],
        }
    }

    fn named<'a>(records: &'a [Value], name: &str) -> Vec<&'a Value> {
        records.iter().filter(|r| r["__name__"] == name).collect()
    }

    #[test]
    fn test_edge_records_all_families() {
        let records = render("traces", &batch(SeriesKey::edge("a", "b", "database")));
        assert_eq!(records.len(), 22 + 1);
        let total = named(&records, M_REQUEST_TOTAL);
        assert_eq!(total.len(), 1);
        assert_eq!(total[0]["__type__"], "counter");
        assert_eq!(total[0]["value"], 5.0);
        assert_eq!(total[0]["_timestamp"], 60 * SECOND_MICRO_SECS);
        assert_eq!(total[0]["trace_stream"], "traces");
        assert_eq!(total[0]["client"], "a");
        assert_eq!(total[0]["server"], "b");
        assert_eq!(total[0]["connection_type"], "database");
        assert!(total[0].get("client_type").is_none());
        assert_eq!(named(&records, M_REQUEST_FAILED_TOTAL)[0]["value"], 2.0);
        let buckets = named(&records, &format!("{M_CLIENT_SECONDS}_bucket"));
        assert_eq!(buckets.len(), 18);
        assert_eq!(buckets[0]["le"], "0.001");
        assert_eq!(buckets[0]["value"], 1.0);
        assert_eq!(buckets[1]["value"], 3.0);
        assert_eq!(buckets[17]["le"], "+Inf");
        assert_eq!(buckets[17]["value"], 5.0);
        assert!(buckets.iter().all(|b| b["__type__"] == "histogram"));
        let sum = named(&records, &format!("{M_CLIENT_SECONDS}_sum"));
        assert_eq!(sum[0]["value"], 2.5);
        assert!(sum[0].get("le").is_none());
        assert_eq!(
            named(&records, &format!("{M_CLIENT_SECONDS}_count"))[0]["value"],
            5.0
        );
        let gauge = named(&records, PROCESSED_TIMESTAMP_STREAM);
        assert_eq!(gauge[0]["__type__"], "gauge");
        assert_eq!(gauge[0]["value"], 60.0);
        assert_eq!(gauge[0]["trace_stream"], "traces");
    }

    #[test]
    fn test_queue_entry_node_and_unresolved_records() {
        let records = render("t", &batch(SeriesKey::queue_edge("orders", "fraud")));
        let total = named(&records, M_REQUEST_TOTAL);
        assert_eq!(total[0]["client_type"], "queue");
        assert!(total[0].get("connection_type").is_none());

        let records = render("t", &batch(SeriesKey::entry_edge("frontend")));
        assert_eq!(records.len(), 3);
        assert_eq!(named(&records, M_REQUEST_TOTAL)[0]["client"], "user");
        assert_eq!(named(&records, M_REQUEST_TOTAL)[0]["client_type"], "user");

        let records = render("t", &batch(SeriesKey::node("svc")));
        assert_eq!(records.len(), 21);
        let buckets = named(&records, &format!("{M_SERVER_SECONDS}_bucket"));
        assert_eq!(buckets.len(), 18);
        assert_eq!(buckets[0]["server"], "svc");
        assert!(buckets[0].get("client").is_none());

        let records = render("t", &batch(SeriesKey::unresolved("svc", "ip_only")));
        assert_eq!(records.len(), 2);
        let u = named(&records, M_UNRESOLVED_TOTAL);
        assert_eq!(u[0]["client"], "svc");
        assert_eq!(u[0]["reason"], "ip_only");
        assert_eq!(u[0]["value"], 5.0);
    }

    #[test]
    fn test_agent_env_label_only_when_present() {
        let records = render(
            "t",
            &batch(SeriesKey::agent_edge("o2-ai", "sre-rca", "prod")),
        );
        assert_eq!(records.len(), 22 + 1);
        let total = named(&records, M_REQUEST_TOTAL);
        assert_eq!(total[0]["client"], "o2-ai");
        assert_eq!(total[0]["server"], "sre-rca");
        assert_eq!(total[0]["connection_type"], "agent");
        assert_eq!(total[0]["agent_env"], "prod");
        assert!(total[0].get("client_type").is_none());
        let buckets = named(&records, &format!("{M_CLIENT_SECONDS}_bucket"));
        assert_eq!(buckets[0]["agent_env"], "prod");
        assert!(
            named(&records, PROCESSED_TIMESTAMP_STREAM)[0]
                .get("agent_env")
                .is_none()
        );

        let key = SeriesKey::agent_call_edge(Some("sre-rca"), "o2-ai", "search", "tool", "");
        let records = render("t", &batch(key));
        let total = named(&records, M_REQUEST_TOTAL);
        assert_eq!(total[0]["client"], "sre-rca");
        assert_eq!(total[0]["client_type"], "agent");
        assert_eq!(total[0]["connection_type"], "tool");
        assert!(total[0].get("agent_env").is_none());

        let key = SeriesKey::agent_call_edge(None, "o2-ai", "gpt-4o", "model", "dev");
        let records = render("t", &batch(key));
        let total = named(&records, M_REQUEST_TOTAL);
        assert_eq!(total[0]["client"], "o2-ai");
        assert!(total[0].get("client_type").is_none());
        assert_eq!(total[0]["connection_type"], "model");
        assert_eq!(total[0]["agent_env"], "dev");

        for key in [
            SeriesKey::edge("a", "b", "database"),
            SeriesKey::queue_edge("orders", "fraud"),
            SeriesKey::entry_edge("frontend"),
        ] {
            let records = render("t", &batch(key));
            assert!(records.iter().all(|r| r.get("agent_env").is_none()));
        }
    }

    #[test]
    fn test_instances_gauge_records() {
        let mut b = batch(SeriesKey::agent_edge("o2-ai", "sre-rca", "prod"));
        assert!(named(&render("t", &b), M_AGENT_INSTANCES).is_empty());
        b.instances = vec![
            (SeriesKey::agent_edge("o2-ai", "sre-rca", "prod"), 3),
            (SeriesKey::agent_edge("o2-ai", "planner", ""), 1),
            (SeriesKey::node("ignored"), 9),
        ];
        let records = render("t", &b);
        assert_eq!(records.len(), 22 + 2 + 1);
        let gauges = named(&records, M_AGENT_INSTANCES);
        assert_eq!(gauges.len(), 2);
        assert_eq!(gauges[0]["__type__"], "gauge");
        assert_eq!(gauges[0]["_timestamp"], 60 * SECOND_MICRO_SECS);
        assert_eq!(gauges[0]["value"], 3.0);
        assert_eq!(gauges[0]["trace_stream"], "t");
        assert_eq!(gauges[0]["client"], "o2-ai");
        assert_eq!(gauges[0]["server"], "sre-rca");
        assert_eq!(gauges[0]["connection_type"], "agent");
        assert_eq!(gauges[0]["agent_env"], "prod");
        assert!(gauges[0].get("client_type").is_none());
        assert!(gauges[0].get("le").is_none());
        assert_eq!(gauges[1]["server"], "planner");
        assert_eq!(gauges[1]["value"], 1.0);
        assert!(gauges[1].get("agent_env").is_none());
        let total = named(&records, M_REQUEST_TOTAL);
        assert_eq!(total.len(), 1);
    }

    #[test]
    fn test_chunking_under_limit() {
        let records = render("traces", &batch(SeriesKey::edge("a", "b", "")));
        let one = chunk(&records, usize::MAX);
        assert_eq!(one.len(), 1);
        let parsed: Vec<Value> = serde_json::from_slice(&one[0]).unwrap();
        assert_eq!(parsed.len(), records.len());
        let small = chunk(&records, 400);
        assert!(small.len() > 1);
        let mut total = 0;
        for c in &small {
            assert!(c.len() <= 400, "{}", c.len());
            let parsed: Vec<Value> = serde_json::from_slice(c).unwrap();
            total += parsed.len();
        }
        assert_eq!(total, records.len());
        let tiny = chunk(&records, 1);
        assert_eq!(tiny.len(), records.len());
        assert!(chunk(&[], 100).is_empty());
    }

    #[test]
    fn test_reply_classification() {
        assert_eq!(classify(200), ReplyClass::Ok);
        assert_eq!(classify(207), ReplyClass::Partial);
        assert_eq!(classify(429), ReplyClass::Rejected);
        assert_eq!(classify(503), ReplyClass::Rejected);
        assert_eq!(classify(500), ReplyClass::Retry);
        assert_eq!(classify(0), ReplyClass::Retry);
    }

    #[test]
    fn test_request_shape() {
        let req = request("org", b"[]".to_vec());
        assert_eq!(req.org_id, "org");
        assert_eq!(req.stream_type, "metrics");
        assert_eq!(req.stream_name, "");
        assert_eq!(
            req.ingestion_type,
            Some(cluster_rpc::IngestionType::Json as i32)
        );
        assert_eq!(req.data.unwrap().data, b"[]");
    }
}
