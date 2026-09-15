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

//! Pure SQL builders for the v4 rollup queries and typed parsers for their rows.

use arrow_schema::Schema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::LEARN_SAMPLE;

pub const BUCKET_COUNT: usize = 17;
/// `le` strings in bucket order; the last one is the `+Inf` bucket (= requests).
pub const BUCKET_LE: [&str; BUCKET_COUNT + 1] = [
    "0.001", "0.002", "0.004", "0.008", "0.016", "0.032", "0.064", "0.128", "0.256", "0.512", "1",
    "2", "4", "8", "16", "32", "64", "+Inf",
];
const NULL_STR: &str = "CAST(NULL AS VARCHAR)";
const NULL_PORT: &str = "CAST(NULL AS BIGINT)";
const ROOT_PRED: &str = "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')";

/// Missing optional columns become typed NULL constants with the same alias; GROUP BY never moves.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Columns {
    pub infer_self_key: bool,
    pub infer_self_port: bool,
    pub infer_self_ip: bool,
    pub infer_peer_key: bool,
    pub infer_peer_port: bool,
    pub infer_peer_ip: bool,
    pub rpc_service: bool,
    pub messaging_destination_name: bool,
    pub operation_name: bool,
    pub peer_service: bool,
    pub reference_parent_span_id: bool,
    pub trace_id: bool,
    pub span_id: bool,
    pub span_status: bool,
    pub duration: bool,
    pub end_time: bool,
    pub start_time: bool,
    pub infer_service_name: bool,
    pub infer_service_type: bool,
    pub service_name: bool,
    pub span_kind: bool,
}

/// The parsed `<M>` block; also the per-window counts carried by every series.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowCounts {
    pub requests: u64,
    pub errors: u64,
    pub dur_sum: i64,
    pub buckets: [u64; BUCKET_COUNT],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Q1Row {
    pub service_name: String,
    pub root_requests: u64,
    pub counts: WindowCounts,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelfIdentityRow {
    pub service_name: String,
    pub infer_self_key: Option<String>,
    pub infer_self_port: Option<u16>,
    pub infer_self_ip: Option<String>,
    pub rpc_service: Option<String>,
    pub server_requests: u64,
    pub requests: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairingRow {
    pub client: String,
    pub peer_key: Option<String>,
    pub peer_port: Option<u16>,
    pub peer_ip: Option<String>,
    pub peer_rpc: Option<String>,
    pub peer_sig: Option<String>,
    pub callee: String,
    pub n: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Q2Row {
    pub client: String,
    pub infer_peer_key: Option<String>,
    pub infer_peer_port: Option<u16>,
    pub infer_peer_ip: Option<String>,
    pub rpc_service: Option<String>,
    pub op_sig: Option<String>,
    pub infer_service_name: Option<String>,
    pub infer_service_type: Option<String>,
    pub explicit_peer: bool,
    pub counts: WindowCounts,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Q3Row {
    pub client: String,
    pub server: String,
    pub counts: WindowCounts,
}

impl Columns {
    pub fn from_schema(schema: &Schema) -> Self {
        let has = |name: &str| schema.field_with_name(name).is_ok();
        Self {
            infer_self_key: has("infer_self_key"),
            infer_self_port: has("infer_self_port"),
            infer_self_ip: has("infer_self_ip"),
            infer_peer_key: has("infer_peer_key"),
            infer_peer_port: has("infer_peer_port"),
            infer_peer_ip: has("infer_peer_ip"),
            rpc_service: has("rpc_service"),
            messaging_destination_name: has("messaging_destination_name"),
            operation_name: has("operation_name"),
            peer_service: has("peer_service"),
            reference_parent_span_id: has("reference_parent_span_id"),
            trace_id: has("trace_id"),
            span_id: has("span_id"),
            span_status: has("span_status"),
            duration: has("duration"),
            end_time: has("end_time"),
            start_time: has("start_time"),
            infer_service_name: has("infer_service_name"),
            infer_service_type: has("infer_service_type"),
            service_name: has("service_name"),
            span_kind: has("span_kind"),
        }
    }

    pub fn all() -> Self {
        Self {
            infer_self_key: true,
            infer_self_port: true,
            infer_self_ip: true,
            infer_peer_key: true,
            infer_peer_port: true,
            infer_peer_ip: true,
            rpc_service: true,
            messaging_destination_name: true,
            operation_name: true,
            peer_service: true,
            reference_parent_span_id: true,
            trace_id: true,
            span_id: true,
            span_status: true,
            duration: true,
            end_time: true,
            start_time: true,
            infer_service_name: true,
            infer_service_type: true,
            service_name: true,
            span_kind: true,
        }
    }

    pub fn has_required(&self) -> bool {
        self.service_name && self.span_kind
    }

    pub fn supports_join(&self) -> bool {
        self.trace_id && self.span_id && self.reference_parent_span_id
    }

    fn duration_expr(&self) -> Option<&'static str> {
        if self.duration {
            Some("duration")
        } else if self.end_time && self.start_time {
            Some("(end_time - start_time) / 1000")
        } else {
            None
        }
    }
}

impl WindowCounts {
    pub fn add(&mut self, other: &WindowCounts) {
        self.requests += other.requests;
        self.errors += other.errors;
        self.dur_sum += other.dur_sum;
        for (a, b) in self.buckets.iter_mut().zip(other.buckets.iter()) {
            *a += b;
        }
    }

    pub fn parse(v: &Value) -> Self {
        let mut buckets = [0u64; BUCKET_COUNT];
        for (i, b) in buckets.iter_mut().enumerate() {
            *b = u64_field(v, &format!("le_{i}"));
        }
        Self {
            requests: u64_field(v, "requests"),
            errors: u64_field(v, "errors"),
            dur_sum: i64_field(v, "dur_sum"),
            buckets,
        }
    }
}

impl Q1Row {
    pub fn parse(v: &Value) -> Option<Self> {
        Some(Self {
            service_name: str_field(v, "service_name")?,
            root_requests: u64_field(v, "root_requests"),
            counts: WindowCounts::parse(v),
        })
    }
}

impl SelfIdentityRow {
    pub fn parse(v: &Value) -> Option<Self> {
        Some(Self {
            service_name: str_field(v, "service_name")?,
            infer_self_key: str_field(v, "infer_self_key"),
            infer_self_port: port_field(v, "infer_self_port"),
            infer_self_ip: str_field(v, "infer_self_ip"),
            rpc_service: str_field(v, "rpc_service"),
            server_requests: u64_field(v, "server_requests"),
            requests: u64_field(v, "requests"),
        })
    }
}

impl PairingRow {
    pub fn parse(v: &Value) -> Option<Self> {
        Some(Self {
            client: str_field(v, "client")?,
            peer_key: str_field(v, "peer_key"),
            peer_port: port_field(v, "peer_port"),
            peer_ip: str_field(v, "peer_ip"),
            peer_rpc: str_field(v, "peer_rpc"),
            peer_sig: str_field(v, "peer_sig"),
            callee: str_field(v, "callee")?,
            n: u64_field(v, "n"),
        })
    }
}

impl Q2Row {
    pub fn parse(v: &Value) -> Option<Self> {
        Some(Self {
            client: str_field(v, "client")?,
            infer_peer_key: str_field(v, "infer_peer_key"),
            infer_peer_port: port_field(v, "infer_peer_port"),
            infer_peer_ip: str_field(v, "infer_peer_ip"),
            rpc_service: str_field(v, "rpc_service"),
            op_sig: str_field(v, "op_sig"),
            infer_service_name: str_field(v, "infer_service_name"),
            infer_service_type: str_field(v, "infer_service_type"),
            explicit_peer: bool_field(v, "explicit_peer"),
            counts: WindowCounts::parse(v),
        })
    }
}

impl Q3Row {
    pub fn parse(v: &Value) -> Option<Self> {
        Some(Self {
            client: str_field(v, "client")?,
            server: str_field(v, "server")?,
            counts: WindowCounts::parse(v),
        })
    }
}

/// Stream names are the only non-numeric input spliced into SQL; only `[A-Za-z0-9_-]` passes.
pub fn validate_stream_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 1…512 ms then 1…64 s: the threshold must equal the `le` string for `histogram_quantile`.
pub fn bucket_threshold_micros(i: usize) -> i64 {
    if i < 10 {
        1000i64 << i
    } else {
        1_000_000i64 << (i - 10)
    }
}

pub fn sample_suffixes(sample: u32) -> Vec<String> {
    let sample = sample.max(1);
    (0u32..256)
        .filter(|v| v % sample == 0)
        .map(|v| format!("{v:02x}"))
        .collect()
}

pub fn build_q1(cols: &Columns, stream: &str, start: i64, end: i64) -> String {
    let root_requests = if cols.reference_parent_span_id {
        format!("COUNT(*) FILTER (WHERE {ROOT_PRED}) AS root_requests")
    } else {
        "0 AS root_requests".to_string()
    };
    format!(
        "SELECT service_name, {root_requests}, {m} FROM \"{stream}\" WHERE {range} AND ({kind}) GROUP BY service_name",
        m = metrics_block(cols),
        range = time_range(start, end),
        kind = kind_pred(cols, "('2','5')"),
    )
}

/// Self-identity learner (design §4.2 "Q1k"): how SERVER/CONSUMER spans name themselves.
pub fn build_self_identity_query(cols: &Columns, stream: &str, start: i64, end: i64) -> String {
    format!(
        "SELECT service_name, {self_key}, {self_port}, {self_ip}, {rpc}, \
         COUNT(*) FILTER (WHERE CAST(span_kind AS VARCHAR) IN ('2','5')) AS server_requests, COUNT(*) AS requests \
         FROM \"{stream}\" WHERE {range} AND ({kind}) GROUP BY 1,2,3,4,5",
        self_key = opt_str(cols.infer_self_key, "infer_self_key"),
        self_port = opt_port(cols.infer_self_port, "infer_self_port"),
        self_ip = opt_str(cols.infer_self_ip, "infer_self_ip"),
        rpc = opt_str(cols.rpc_service, "rpc_service"),
        range = time_range(start, end),
        kind = kind_pred(cols, "('2','3','4','5')"),
    )
}

/// Pairing learner (design §4.2 "QL"); `None` when a join column is missing (a hard SQL error).
pub fn build_pairing_query(cols: &Columns, stream: &str, start: i64, end: i64) -> Option<String> {
    if !cols.supports_join() {
        return None;
    }
    let suffixes = sample_suffixes(LEARN_SAMPLE)
        .iter()
        .map(|s| format!("'{s}'"))
        .collect::<Vec<_>>()
        .join(",");
    Some(format!(
        "SELECT p.service_name AS client, {peer_key} AS peer_key, {peer_port} AS peer_port, {peer_ip} AS peer_ip, \
         {peer_rpc} AS peer_rpc, {sig} AS peer_sig, c.service_name AS callee, COUNT(*) AS n \
         FROM \"{stream}\" c JOIN \"{stream}\" p ON c.trace_id = p.trace_id AND c.reference_parent_span_id = p.span_id \
         WHERE c._timestamp >= {start} AND c._timestamp < {end} AND p._timestamp >= {start} AND p._timestamp < {end} \
         AND right(c.trace_id, 2) IN ({suffixes}) AND right(p.trace_id, 2) IN ({suffixes}) \
         AND CAST(c.span_kind AS VARCHAR) IN ('1','2','5') AND CAST(p.span_kind AS VARCHAR) IN ('3','4') \
         AND c.service_name != p.service_name GROUP BY 1,2,3,4,5,6,7",
        peer_key = opt_col(cols.infer_peer_key, "p.infer_peer_key", NULL_STR),
        peer_port = opt_col(cols.infer_peer_port, "p.infer_peer_port", NULL_PORT),
        peer_ip = opt_col(cols.infer_peer_ip, "p.infer_peer_ip", NULL_STR),
        peer_rpc = opt_col(cols.rpc_service, "p.rpc_service", NULL_STR),
        sig = sig_expr(cols, "p."),
    ))
}

pub fn build_q2(cols: &Columns, stream: &str, start: i64, end: i64) -> String {
    let explicit_peer = if cols.peer_service {
        "(peer_service IS NOT NULL AND peer_service != '')"
    } else {
        "false"
    };
    format!(
        "SELECT service_name AS client, {peer_key}, {peer_port}, {peer_ip}, {rpc}, {sig} AS op_sig, \
         {svc_name}, {svc_type}, {explicit_peer} AS explicit_peer, {m} \
         FROM \"{stream}\" WHERE {range} AND CAST(span_kind AS VARCHAR) IN ('3','4') GROUP BY 1,2,3,4,5,6,7,8,9",
        peer_key = opt_str(cols.infer_peer_key, "infer_peer_key"),
        peer_port = opt_port(cols.infer_peer_port, "infer_peer_port"),
        peer_ip = opt_str(cols.infer_peer_ip, "infer_peer_ip"),
        rpc = opt_str(cols.rpc_service, "rpc_service"),
        sig = sig_expr(cols, ""),
        svc_name = opt_str(cols.infer_service_name, "infer_service_name"),
        svc_type = opt_str(cols.infer_service_type, "infer_service_type"),
        m = metrics_block(cols),
        range = time_range(start, end),
    )
}

pub fn build_q3(cols: &Columns, stream: &str, start: i64, end: i64) -> Option<String> {
    if !cols.messaging_destination_name {
        return None;
    }
    Some(format!(
        "SELECT messaging_destination_name AS client, service_name AS server, {m} FROM \"{stream}\" \
         WHERE {range} AND CAST(span_kind AS VARCHAR) = '5' \
         AND messaging_destination_name IS NOT NULL AND messaging_destination_name != '' GROUP BY 1, 2",
        m = metrics_block(cols),
        range = time_range(start, end),
    ))
}

pub fn metrics_block(cols: &Columns) -> String {
    let errors = if cols.span_status {
        "COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors"
    } else {
        "0 AS errors"
    };
    let dur = cols.duration_expr();
    let dur_sum = match dur {
        Some(d) => format!("SUM({d}) AS dur_sum"),
        None => "0 AS dur_sum".to_string(),
    };
    let buckets = (0..BUCKET_COUNT)
        .map(|i| match dur {
            Some(d) => format!(
                "COUNT(*) FILTER (WHERE {d} <= {}) AS le_{i}",
                bucket_threshold_micros(i)
            ),
            None => format!("0 AS le_{i}"),
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("COUNT(*) AS requests, {errors}, {dur_sum}, {buckets}")
}

fn time_range(start: i64, end: i64) -> String {
    format!("_timestamp >= {start} AND _timestamp < {end}")
}

/// Without `reference_parent_span_id` there is no root, so the INTERNAL-root branch is dropped.
fn kind_pred(cols: &Columns, kinds: &str) -> String {
    if cols.reference_parent_span_id {
        format!(
            "CAST(span_kind AS VARCHAR) IN {kinds} OR (CAST(span_kind AS VARCHAR) = '1' AND {ROOT_PRED})"
        )
    } else {
        format!("CAST(span_kind AS VARCHAR) IN {kinds}")
    }
}

fn opt_col(present: bool, col: &str, null: &str) -> String {
    if present {
        col.to_string()
    } else {
        null.to_string()
    }
}

fn opt_str(present: bool, col: &str) -> String {
    if present {
        col.to_string()
    } else {
        format!("{NULL_STR} AS {col}")
    }
}

fn opt_port(present: bool, col: &str) -> String {
    if present {
        col.to_string()
    } else {
        format!("{NULL_PORT} AS {col}")
    }
}

fn sig_expr(cols: &Columns, prefix: &str) -> String {
    if !cols.operation_name {
        return NULL_STR.to_string();
    }
    format!(
        "CASE WHEN {pk} IS NULL AND {pip} IS NULL AND {rpc} IS NULL THEN {prefix}operation_name END",
        pk = opt_col(
            cols.infer_peer_key,
            &format!("{prefix}infer_peer_key"),
            NULL_STR
        ),
        pip = opt_col(
            cols.infer_peer_ip,
            &format!("{prefix}infer_peer_ip"),
            NULL_STR
        ),
        rpc = opt_col(cols.rpc_service, &format!("{prefix}rpc_service"), NULL_STR),
    )
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn i64_field(v: &Value, key: &str) -> i64 {
    match v.get(key) {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f as i64))
            .unwrap_or(0),
        Some(Value::String(s)) => s.parse::<f64>().map(|f| f as i64).unwrap_or(0),
        _ => 0,
    }
}

fn u64_field(v: &Value, key: &str) -> u64 {
    i64_field(v, key).max(0) as u64
}

fn port_field(v: &Value, key: &str) -> Option<u16> {
    match v.get(key) {
        Some(Value::Number(_) | Value::String(_)) => u16::try_from(i64_field(v, key)).ok(),
        _ => None,
    }
}

fn bool_field(v: &Value, key: &str) -> bool {
    match v.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(s)) => s == "true",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn group_by(sql: &str) -> &str {
        sql.rsplit("GROUP BY").next().unwrap().trim()
    }

    fn select_aliases(sql: &str) -> Vec<String> {
        let list = sql
            .trim_start_matches("SELECT ")
            .split(" FROM ")
            .next()
            .unwrap();
        let mut depth = 0;
        let mut cur = String::new();
        let mut out = vec![];
        for c in list.chars() {
            match c {
                '(' => depth += 1,
                ')' => depth -= 1,
                ',' if depth == 0 => {
                    out.push(std::mem::take(&mut cur));
                    continue;
                }
                _ => {}
            }
            cur.push(c);
        }
        out.push(cur);
        out.into_iter()
            .map(|e| e.trim().rsplit(' ').next().unwrap().to_string())
            .collect()
    }

    #[test]
    fn test_validate_stream_name() {
        assert!(validate_stream_name("default"));
        assert!(validate_stream_name("my-stream_01"));
        assert!(!validate_stream_name(""));
        assert!(!validate_stream_name("a b"));
        assert!(!validate_stream_name("a\"; DROP"));
        assert!(!validate_stream_name("a.b"));
    }

    #[test]
    fn test_bucket_thresholds_and_le_strings() {
        assert_eq!(bucket_threshold_micros(0), 1000);
        assert_eq!(bucket_threshold_micros(9), 512_000);
        assert_eq!(bucket_threshold_micros(10), 1_000_000);
        assert_eq!(bucket_threshold_micros(16), 64_000_000);
        assert_eq!(BUCKET_LE.len(), BUCKET_COUNT + 1);
        assert_eq!(BUCKET_LE[0], "0.001");
        assert_eq!(BUCKET_LE[10], "1");
        assert_eq!(BUCKET_LE[16], "64");
        assert_eq!(BUCKET_LE[17], "+Inf");
        for (i, le) in BUCKET_LE.iter().take(BUCKET_COUNT).enumerate() {
            let secs: f64 = le.parse().unwrap();
            assert_eq!((secs * 1e6).round() as i64, bucket_threshold_micros(i));
        }
        assert_eq!("+Inf".parse::<f64>().unwrap(), f64::INFINITY);
    }

    #[test]
    fn test_sample_suffixes() {
        assert_eq!(sample_suffixes(64), vec!["00", "40", "80", "c0"]);
        let s16 = sample_suffixes(16);
        assert_eq!(s16.len(), 16);
        assert_eq!(s16[0], "00");
        assert_eq!(s16[1], "10");
        assert_eq!(s16[15], "f0");
    }

    #[test]
    fn test_metrics_block_variants() {
        let full = metrics_block(&Columns::all());
        assert!(full.contains("SUM(duration) AS dur_sum"));
        assert!(full.contains("COUNT(*) FILTER (WHERE duration <= 1000) AS le_0"));
        assert!(full.contains("COUNT(*) FILTER (WHERE duration <= 64000000) AS le_16"));
        assert!(full.contains("span_status = 'ERROR'"));

        let derived = Columns {
            duration: false,
            span_status: false,
            ..Columns::all()
        };
        let m = metrics_block(&derived);
        assert!(m.contains("SUM((end_time - start_time) / 1000) AS dur_sum"));
        assert!(m.contains("0 AS errors"));

        let none = Columns {
            duration: false,
            end_time: false,
            ..Columns::all()
        };
        let m = metrics_block(&none);
        assert!(m.contains("0 AS dur_sum"));
        assert!(m.contains("0 AS le_0"));
        assert!(m.contains("0 AS le_16"));
        assert!(!m.contains("duration"));
    }

    #[test]
    fn test_q1_with_and_without_parent_column() {
        let with = build_q1(&Columns::all(), "t", 1, 2);
        assert!(with.contains("AS root_requests"));
        assert!(with.contains("IN ('2','5') OR (CAST(span_kind AS VARCHAR) = '1'"));
        assert!(with.contains("_timestamp >= 1 AND _timestamp < 2"));
        assert!(with.contains("FROM \"t\""));
        let cols = Columns {
            reference_parent_span_id: false,
            ..Columns::all()
        };
        let without = build_q1(&cols, "t", 1, 2);
        assert!(without.contains("0 AS root_requests"));
        assert!(!without.contains("reference_parent_span_id"));
        assert!(without.contains("IN ('2','5'))"));
        assert_eq!(group_by(with.as_str()), group_by(without.as_str()));
    }

    #[test]
    fn test_self_identity_substitution_keeps_positions() {
        let full = build_self_identity_query(&Columns::all(), "t", 1, 2);
        let cols = Columns {
            infer_self_key: false,
            infer_self_port: false,
            infer_self_ip: false,
            rpc_service: false,
            reference_parent_span_id: false,
            ..Columns::all()
        };
        let bare = build_self_identity_query(&cols, "t", 1, 2);
        assert_eq!(select_aliases(&full), select_aliases(&bare));
        assert_eq!(group_by(&full), "1,2,3,4,5");
        assert_eq!(group_by(&bare), "1,2,3,4,5");
        assert!(bare.contains("CAST(NULL AS VARCHAR) AS infer_self_key"));
        assert!(bare.contains("CAST(NULL AS BIGINT) AS infer_self_port"));
        assert!(bare.contains("IN ('2','3','4','5'))"));
        assert!(full.contains("IN ('2','3','4','5') OR (CAST(span_kind AS VARCHAR) = '1'"));
    }

    #[test]
    fn test_q2_substitution_keeps_positions() {
        let full = build_q2(&Columns::all(), "t", 1, 2);
        let cols = Columns {
            infer_peer_key: false,
            infer_peer_port: false,
            infer_peer_ip: false,
            rpc_service: false,
            operation_name: false,
            infer_service_name: false,
            infer_service_type: false,
            peer_service: false,
            duration: false,
            end_time: false,
            span_status: false,
            ..Columns::all()
        };
        let bare = build_q2(&cols, "t", 1, 2);
        assert_eq!(select_aliases(&full), select_aliases(&bare));
        assert_eq!(group_by(&full), "1,2,3,4,5,6,7,8,9");
        assert_eq!(group_by(&bare), "1,2,3,4,5,6,7,8,9");
        assert!(
            full.contains("(peer_service IS NOT NULL AND peer_service != '') AS explicit_peer")
        );
        assert!(bare.contains("false AS explicit_peer"));
        assert!(bare.contains("CAST(NULL AS VARCHAR) AS op_sig"));
        assert!(full.contains(
            "CASE WHEN infer_peer_key IS NULL AND infer_peer_ip IS NULL AND rpc_service IS NULL THEN operation_name END AS op_sig"
        ));
        let partial = Columns {
            infer_peer_ip: false,
            ..Columns::all()
        };
        let sql = build_q2(&partial, "t", 1, 2);
        assert!(sql.contains("CAST(NULL AS VARCHAR) AS infer_peer_ip"));
        assert!(sql.contains("CASE WHEN infer_peer_key IS NULL AND CAST(NULL AS VARCHAR) IS NULL"));
    }

    #[test]
    fn test_ql_requires_join_columns() {
        for missing in ["trace_id", "span_id", "reference_parent_span_id"] {
            let mut cols = Columns::all();
            match missing {
                "trace_id" => cols.trace_id = false,
                "span_id" => cols.span_id = false,
                _ => cols.reference_parent_span_id = false,
            }
            assert!(build_pairing_query(&cols, "t", 1, 2).is_none(), "{missing}");
        }
        let sql = build_pairing_query(&Columns::all(), "t", 1, 2).unwrap();
        assert!(sql.contains("right(c.trace_id, 2) IN ('00','40','80','c0')"));
        assert!(sql.contains("right(p.trace_id, 2) IN ('00','40','80','c0')"));
        assert!(
            sql.contains("ON c.trace_id = p.trace_id AND c.reference_parent_span_id = p.span_id")
        );
        assert!(sql.contains("c.service_name != p.service_name"));
        assert_eq!(group_by(&sql), "1,2,3,4,5,6,7");
        let no_op = Columns {
            operation_name: false,
            ..Columns::all()
        };
        let sql = build_pairing_query(&no_op, "t", 1, 2).unwrap();
        assert!(sql.contains("CAST(NULL AS VARCHAR) AS peer_sig"));
    }

    #[test]
    fn test_q3_needs_messaging_column() {
        let cols = Columns {
            messaging_destination_name: false,
            ..Columns::all()
        };
        assert!(build_q3(&cols, "t", 1, 2).is_none());
        let sql = build_q3(&Columns::all(), "t", 1, 2).unwrap();
        assert!(sql.contains("messaging_destination_name AS client, service_name AS server"));
        assert!(sql.contains("CAST(span_kind AS VARCHAR) = '5'"));
        assert_eq!(group_by(&sql), "1, 2");
    }

    #[test]
    fn test_columns_from_schema() {
        use arrow_schema::{DataType, Field};
        let schema = Schema::new(vec![
            Field::new("service_name", DataType::Utf8, true),
            Field::new("span_kind", DataType::Utf8, true),
            Field::new("infer_peer_key", DataType::Utf8, true),
        ]);
        let cols = Columns::from_schema(&schema);
        assert!(cols.has_required());
        assert!(cols.infer_peer_key);
        assert!(!cols.infer_peer_ip);
        assert!(!cols.supports_join());
        let empty = Columns::from_schema(&Schema::empty());
        assert!(!empty.has_required());
    }

    #[test]
    fn test_row_parsing_treats_null_as_none_and_zero() {
        let row = json!({
            "client": "a", "infer_peer_key": null, "infer_peer_port": 8080, "infer_peer_ip": "",
            "rpc_service": "svc.Rpc", "explicit_peer": true, "requests": 5, "errors": 1.0,
            "dur_sum": 12345, "le_0": 1, "le_16": 5
        });
        let q2 = Q2Row::parse(&row).unwrap();
        assert_eq!(q2.client, "a");
        assert_eq!(q2.infer_peer_key, None);
        assert_eq!(q2.infer_peer_port, Some(8080));
        assert_eq!(q2.infer_peer_ip, None);
        assert_eq!(q2.rpc_service.as_deref(), Some("svc.Rpc"));
        assert!(q2.explicit_peer);
        assert_eq!(q2.counts.requests, 5);
        assert_eq!(q2.counts.errors, 1);
        assert_eq!(q2.counts.dur_sum, 12345);
        assert_eq!(q2.counts.buckets[0], 1);
        assert_eq!(q2.counts.buckets[1], 0);
        assert_eq!(q2.counts.buckets[16], 5);
        assert!(Q2Row::parse(&json!({"client": null})).is_none());
        let q1 = Q1Row::parse(&json!({"service_name": "s", "requests": 3})).unwrap();
        assert_eq!(q1.root_requests, 0);
        assert_eq!(q1.counts.requests, 3);
        let pairing =
            PairingRow::parse(&json!({"client": "a", "callee": "b", "n": 7, "peer_port": "443"}))
                .unwrap();
        assert_eq!(pairing.peer_port, Some(443));
        assert_eq!(pairing.n, 7);
        assert!(Q3Row::parse(&json!({"client": "topic"})).is_none());
        let self_identity =
            SelfIdentityRow::parse(&json!({"service_name": "s", "infer_self_port": 70000}))
                .unwrap();
        assert_eq!(self_identity.infer_self_port, None);
    }
}
