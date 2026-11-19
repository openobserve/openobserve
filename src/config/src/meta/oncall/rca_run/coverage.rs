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

//! What a call's raw server result says about its own coverage: completeness flags, requested and
//! effective windows, and a native version comparison's adverse metrics.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

use super::{EvidenceTarget, TimeWindow};
use crate::meta::oncall::confidence::COMPARE_SERVICE_VERSIONS;

/// The only interval kind that is a sampling interval; sketch and histogram bands are not.
pub const VARIANCE_CI_KIND: &str = "variance";

/// The RUM stream a comparison's RUM metrics read; as a source, it is a Logs stream.
pub const RUM_SOURCE: &str = "logs/_rumdata";

/// Aggregate trace metrics read some trace stream: they overlap trace items, never Logs items.
pub const TRACES_SOURCE: &str = "traces/*";

/// Completeness keys the server or o2-ai's `_o2_meta` carry.
const META_KEY: &str = "_o2_meta";
const BOUNDS_KEY: &str = "_o2_request_bounds";

/// Trace metrics of a comparison, all "higher is worse".
const TRACE_METRICS: [&str; 3] = ["error_rate", "p95", "p99"];
const ENDPOINT_METRICS: [&str; 2] = ["error_rate", "p95"];
const RUM_METRICS: [&str; 5] = [
    "error_view_rate",
    "loading_time_p75",
    "lcp_p75",
    "inp_p75",
    "cls_p75",
];

/// The window a call asked for; either end may be open.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RequestedWindow {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_us: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_us: Option<i64>,
}

/// An `f64` compared by its bits, so records that hold one stay `Eq`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct Num(pub f64);

impl PartialEq for Num {
    fn eq(&self, other: &Self) -> bool {
        self.0.to_bits() == other.0.to_bits()
    }
}

impl Eq for Num {}

/// One sufficient metric on which the judged version is worse: `lo > 0`, `delta = a - b`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AdverseMetric {
    /// `traces`, `endpoint:<source_stream>/<operation>` or `rum`.
    pub scope: String,
    pub metric: String,
    pub delta: Num,
    pub lo: Num,
    pub hi: Num,
    /// Only [VARIANCE_CI_KIND] earns decisive credit.
    pub ci_kind: String,
    /// `traces/<stream>` or [RUM_SOURCE]; `None` when the response does not name it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// A `CompareServiceVersions` result bound to the arm it resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ComparisonCitation {
    pub service: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<TimeWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_window: Option<TimeWindow>,
    /// Resolved arms of the call with `version`; a reference binds only when this is 1.
    #[serde(default)]
    pub arms_with_version: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub adverse: Vec<AdverseMetric>,
}

impl ComparisonCitation {
    /// The adverse metrics that earn decisive credit.
    pub fn decisive_metrics(&self) -> impl Iterator<Item = &AdverseMetric> {
        self.adverse
            .iter()
            .filter(|m| m.ci_kind == VARIANCE_CI_KIND)
    }

    /// A decisive change: one resolved arm and at least one sufficient adverse sampling interval.
    pub fn is_decisive(&self) -> bool {
        self.arms_with_version == 1 && self.decisive_metrics().next().is_some()
    }

    /// Exactly `service@version` (case kept, no prefix match) and a decisive comparison.
    pub fn names(&self, service: &str, version: &str) -> bool {
        self.service == service && self.version == version && self.is_decisive()
    }
}

/// What the raw result said about its own coverage; every field is absent on legacy records.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CallCoverage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_window: Option<RequestedWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_window: Option<TimeWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_partial: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
    /// The server's cursor, type preserved; `true` when o2-ai cut an oversized cursor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub next_after: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub insufficient: Option<bool>,
    /// A SQL page's `query.from`; only a page from offset 0 can show an absence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_offset: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparison: Option<ComparisonCitation>,
}

impl CallCoverage {
    /// A cursor that is not null, `""`, `[]` or `{}` means rows remain.
    pub fn cursor_remains(&self) -> bool {
        self.next_after.as_ref().is_some_and(|v| match v {
            Value::Null => false,
            Value::String(s) => !s.is_empty(),
            Value::Array(a) => !a.is_empty(),
            Value::Object(o) => !o.is_empty(),
            _ => true,
        })
    }

    /// The result says it is complete and nothing remains; legacy (missing) flags are unknown.
    pub fn is_complete(&self) -> bool {
        let signalled = self.is_partial == Some(false) || self.has_more == Some(false);
        signalled
            && self.is_partial != Some(true)
            && self.has_more != Some(true)
            && !self.cursor_remains()
            && self.insufficient != Some(true)
            && self.page_offset.unwrap_or(0) == 0
            && self.effective_window.is_some()
    }
}

/// The JSON object that carries completeness: the body itself, or (spilled) its `_o2_meta`.
fn meta_of(body: &Value) -> Option<Map<String, Value>> {
    if let Some(meta) = body.get(META_KEY).and_then(Value::as_object) {
        return Some(meta.clone());
    }
    // A spill pointer is text; o2-ai keeps `{"_o2_meta": ..}` on a line of its own beside it.
    let text = body
        .as_str()
        .or_else(|| body.get("output").and_then(Value::as_str))?;
    text.lines().find_map(|line| {
        let value: Value = serde_json::from_str(line.trim()).ok()?;
        value.get(META_KEY)?.as_object().cloned()
    })
}

fn as_i64(v: Option<&Value>) -> Option<i64> {
    v.and_then(Value::as_i64)
}

fn window_of(v: Option<&Value>) -> Option<TimeWindow> {
    let v = v?;
    let start = as_i64(v.get("start_us"))?;
    let end = as_i64(v.get("end_us"))?;
    (start <= end).then_some(TimeWindow { start, end })
}

/// Read once from the raw decoded result, before any summary consumes it.
pub fn call_coverage(
    tool: &str,
    input: &Value,
    body: &Value,
    target: &EvidenceTarget,
) -> CallCoverage {
    let server = body.as_object().filter(|b| !b.contains_key("output"));
    let meta = meta_of(body);
    let flag = |key: &str| {
        server
            .and_then(|b| b.get(key))
            .or_else(|| meta.as_ref().and_then(|m| m.get(key)))
    };
    let bool_flag = |key: &str| flag(key).and_then(Value::as_bool);
    let cut = ["rows_cut", "series_cut"].iter().any(|k| {
        meta.as_ref()
            .and_then(|m| m.get(*k))
            .and_then(Value::as_bool)
            == Some(true)
    });
    let mut next_after = flag("next_after").cloned();
    if meta
        .as_ref()
        .and_then(|m| m.get("next_after_truncated"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        next_after = Some(Value::Bool(true));
    }
    let bounds = flag(BOUNDS_KEY);
    let requested_window =
        bounds
            .and_then(|b| b.get("requested_window"))
            .map(|w| RequestedWindow {
                start_us: as_i64(w.get("start_us")),
                end_us: as_i64(w.get("end_us")),
            });
    let server_bounds = server.and_then(|b| {
        let start = as_i64(b.get("new_start_time"))?;
        let end = as_i64(b.get("new_end_time"))?;
        (start <= end).then_some(TimeWindow { start, end })
    });
    let asked = match (target.start_us, target.end_us) {
        (Some(start), Some(end)) if start <= end && server.is_some() => {
            Some(TimeWindow { start, end })
        }
        _ => None,
    };
    let effective_window = bounds
        .and_then(|b| window_of(b.get("effective_window")))
        .or(server_bounds)
        .or(asked);
    let page_offset = input
        .pointer("/request_body/query/from")
        .and_then(Value::as_i64);
    let comparison = (tool == COMPARE_SERVICE_VERSIONS)
        .then(|| server.and_then(|b| comparison_of(input, b)))
        .flatten();
    let insufficient = bool_flag("insufficient").or_else(|| {
        server
            .filter(|_| tool == COMPARE_SERVICE_VERSIONS)
            .and_then(sections_insufficient)
    });
    CallCoverage {
        requested_window,
        effective_window,
        is_partial: if cut {
            Some(true)
        } else {
            bool_flag("is_partial")
        },
        has_more: bool_flag("has_more"),
        next_after,
        insufficient,
        page_offset,
        comparison,
    }
}

/// `Some(true)` when every section the comparison returned is insufficient.
fn sections_insufficient(body: &Map<String, Value>) -> Option<bool> {
    let flags: Vec<bool> = ["traces", "rum"]
        .iter()
        .filter_map(|k| body.get(*k)?.get("insufficient")?.as_bool())
        .collect();
    (!flags.is_empty()).then(|| flags.iter().all(|f| *f))
}

/// One adverse metric of a delta object, else `None`.
fn adverse(
    scope: &str,
    metric: &str,
    delta: &Value,
    source: Option<&str>,
) -> Option<AdverseMetric> {
    let num = |k: &str| delta.get(k).and_then(Value::as_f64);
    let flag = |k: &str| delta.get(k).and_then(Value::as_bool);
    let lo = num("lo")?;
    let worse =
        flag("insufficient") == Some(false) && flag("straddles_zero") == Some(false) && lo > 0.0;
    worse.then(|| AdverseMetric {
        scope: scope.to_string(),
        metric: metric.to_string(),
        delta: Num(num("delta").unwrap_or_default()),
        lo: Num(lo),
        hi: Num(num("hi").unwrap_or_default()),
        ci_kind: delta
            .get("ci_kind")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        source: source.map(str::to_string),
    })
}

fn arm_window(arm: &Value) -> Option<TimeWindow> {
    let start = as_i64(arm.get("start_time"))?;
    let end = as_i64(arm.get("end_time"))?;
    (start <= end).then_some(TimeWindow { start, end })
}

/// The comparison of a `CompareServiceVersions` response; `None` without a judged arm.
fn comparison_of(input: &Value, body: &Map<String, Value>) -> Option<ComparisonCitation> {
    let text = |v: Option<&Value>| {
        v.and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let a = body.get("arms").and_then(|arms| arms.get("a"))?;
    let b = body.get("arms").and_then(|arms| arms.get("b"));
    let version = text(a.get("version"))?;
    let service =
        text(body.get("service")).or_else(|| text(input.pointer("/request_body/service")))?;
    let baseline_version = b.and_then(|b| text(b.get("version")));
    let arms_with_version = 1 + u32::from(baseline_version.as_deref() == Some(version.as_str()));

    let mut adverse_metrics = Vec::new();
    if let Some(traces) = body
        .get("traces")
        .filter(|t| t.get("insufficient") == Some(&Value::Bool(false)))
    {
        for metric in TRACE_METRICS {
            if let Some(m) = traces
                .get(metric)
                .and_then(|d| adverse("traces", metric, d, Some(TRACES_SOURCE)))
            {
                adverse_metrics.push(m);
            }
        }
        for endpoint in traces
            .get("endpoints")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let stream = text(endpoint.get("source_stream"));
            let operation = text(endpoint.get("operation")).unwrap_or_default();
            let scope = format!(
                "endpoint:{}/{operation}",
                stream.as_deref().unwrap_or_default()
            );
            let source = stream.map(|s| format!("traces/{s}"));
            for metric in ENDPOINT_METRICS {
                if let Some(m) = endpoint
                    .get(metric)
                    .and_then(|d| adverse(&scope, metric, d, source.as_deref()))
                {
                    adverse_metrics.push(m);
                }
            }
        }
    }
    if let Some(rum) = body
        .get("rum")
        .filter(|r| r.get("insufficient") == Some(&Value::Bool(false)))
    {
        for metric in RUM_METRICS {
            if let Some(m) = rum
                .get(metric)
                .and_then(|d| adverse("rum", metric, d, Some(RUM_SOURCE)))
            {
                adverse_metrics.push(m);
            }
        }
    }
    Some(ComparisonCitation {
        service,
        version,
        baseline_version,
        version_key: text(a.get("version_key")),
        image: text(a.get("image")),
        window: arm_window(a),
        baseline_window: b.and_then(arm_window),
        arms_with_version,
        adverse: adverse_metrics,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::meta::oncall::rca_run::evidence_target;

    const SQL: &str = "SearchSQL";

    fn sql_input(from: i64) -> Value {
        json!({"type": "logs", "request_body": {"query": {"sql": "SELECT 1", "start_time": 10, "end_time": 20, "from": from}}})
    }

    fn coverage(tool: &str, input: &Value, body: Value) -> CallCoverage {
        call_coverage(tool, input, &body, &evidence_target(tool, input))
    }

    fn delta(lo: f64, straddles: bool, insufficient: bool, ci_kind: &str) -> Value {
        json!({"a": 2.0, "b": 1.0, "delta": 1.0, "lo": lo, "hi": 1.5, "straddles_zero": straddles, "insufficient": insufficient, "ci_kind": ci_kind})
    }

    fn compare_body(traces: Value) -> Value {
        json!({
            "service": "payments",
            "arms": {
                "a": {"version": "v1.4.2", "version_key": "vk-a", "image": "img:a", "start_time": 100, "end_time": 200},
                "b": {"version": "v1.4.1", "start_time": 0, "end_time": 100},
            },
            "traces": traces,
            "notes": [],
        })
    }

    #[test]
    fn completeness_flags_and_cursor_types_are_read_from_the_raw_body() {
        let input = sql_input(0);
        let c = coverage(
            SQL,
            &input,
            json!({"hits": [], "total": 0, "is_partial": false}),
        );
        assert_eq!(c.is_partial, Some(false));
        assert_eq!(c.effective_window, Some(TimeWindow { start: 10, end: 20 }));
        assert!(c.is_complete());

        for cursor in [json!(17), json!("tok"), json!({"k": 1}), json!([1])] {
            let c = coverage(
                "ListThings",
                &json!({}),
                json!({"has_more": false, "next_after": cursor.clone(), "items": []}),
            );
            assert_eq!(
                c.next_after,
                Some(cursor.clone()),
                "the cursor keeps its type"
            );
            assert!(c.cursor_remains(), "{cursor}");
            assert!(!c.is_complete(), "{cursor}");
        }
        let c = coverage(SQL, &input, json!({"hits": [], "is_partial": true}));
        assert!(!c.is_complete());
        // Legacy or silent results are unknown coverage, never complete.
        let c = coverage(SQL, &input, json!({"hits": []}));
        assert_eq!(c.is_partial, None);
        assert!(!c.is_complete());
        // A page after offset 0 cannot show an absence.
        let c = coverage(
            SQL,
            &sql_input(500),
            json!({"hits": [], "is_partial": false}),
        );
        assert_eq!(c.page_offset, Some(500));
        assert!(!c.is_complete());
        let c = coverage(
            SQL,
            &input,
            json!({"hits": [], "is_partial": false, "insufficient": true}),
        );
        assert!(!c.is_complete());
    }

    #[test]
    fn request_bounds_and_server_bounds_set_the_effective_window() {
        let input = sql_input(0);
        let c = coverage(
            SQL,
            &input,
            json!({"hits": [], "is_partial": false, "new_start_time": 12, "new_end_time": 18}),
        );
        assert_eq!(c.effective_window, Some(TimeWindow { start: 12, end: 18 }));
        let c = coverage(
            SQL,
            &input,
            json!({"hits": [], "is_partial": false, "_o2_request_bounds": {
                "requested_window": {"start_us": null, "end_us": 20},
                "effective_window": {"start_us": 15, "end_us": 20},
                "clamped": true, "source": "proxy"}}),
        );
        assert_eq!(
            c.requested_window,
            Some(RequestedWindow {
                start_us: None,
                end_us: Some(20)
            })
        );
        assert_eq!(c.effective_window, Some(TimeWindow { start: 15, end: 20 }));
    }

    /// A spill pointer keeps only `_o2_meta`; a pointer without it is unknown coverage.
    #[test]
    fn a_spilled_result_is_read_from_its_meta() {
        let input = sql_input(0);
        let pointer = "This result was 90000 bytes, so it was written to /w/x.json (3 lines).\nRead that file.";
        let meta = json!({"_o2_meta": {"is_partial": true, "rows_cut": true, "_o2_request_bounds": {"effective_window": {"start_us": 10, "end_us": 20}}}});
        let body = json!({"output": format!("{pointer}\n{meta}")});
        let c = coverage(SQL, &input, body);
        assert_eq!(c.is_partial, Some(true));
        assert_eq!(c.effective_window, Some(TimeWindow { start: 10, end: 20 }));
        assert!(!c.is_complete());
        let c = coverage(SQL, &input, json!({"output": pointer}));
        assert_eq!((c.is_partial, c.effective_window), (None, None));
        assert!(!c.is_complete());
        let truncated = json!({"_o2_meta": {"has_more": false, "next_after_truncated": true}});
        let c = coverage(
            "ListThings",
            &json!({}),
            Value::String(truncated.to_string()),
        );
        assert!(c.cursor_remains());
    }

    /// Review D7 vectors, D'6 sources and D'7 resolved arm and `ci_kind`.
    #[test]
    fn only_sufficient_adverse_variance_metrics_make_a_comparison_decisive() {
        let input = json!({"request_body": {"service": "payments", "a": {"version": "v1.4.2"}}});
        let tool = COMPARE_SERVICE_VERSIONS;
        let decisive = |traces: Value| {
            coverage(tool, &input, compare_body(traces))
                .comparison
                .is_some_and(|c| c.is_decisive())
        };
        let improvement =
            json!({"insufficient": false, "error_rate": delta(-0.2, false, false, "variance")});
        let crosses =
            json!({"insufficient": false, "error_rate": delta(-0.1, true, false, "variance")});
        let all_insufficient = json!({"insufficient": false, "error_rate": delta(0.1, false, true, "variance"), "p95": delta(0.1, false, true, "variance")});
        let mixed = json!({"insufficient": false, "error_rate": delta(0.1, false, false, "variance"), "p95": delta(0.1, false, true, "variance")});
        let sketch = json!({"insufficient": false, "p95": delta(0.1, false, false, "sketch_band")});
        let top_insufficient =
            json!({"insufficient": true, "error_rate": delta(0.1, false, false, "variance")});
        assert!(!decisive(improvement));
        assert!(!decisive(crosses));
        assert!(!decisive(all_insufficient));
        assert!(decisive(mixed.clone()), "error_rate alone counts");
        assert!(!decisive(sketch), "a sketch band is a lead");
        assert!(!decisive(top_insufficient.clone()));
        assert_eq!(
            coverage(tool, &input, compare_body(top_insufficient)).insufficient,
            Some(true)
        );

        let c = coverage(tool, &input, compare_body(mixed.clone()))
            .comparison
            .unwrap();
        assert_eq!(
            (c.version_key.as_deref(), c.image.as_deref(), c.window),
            (
                Some("vk-a"),
                Some("img:a"),
                Some(TimeWindow {
                    start: 100,
                    end: 200
                })
            )
        );
        assert!(c.names("payments", "v1.4.2"));
        assert!(!c.names("payments", "v1.4.20"));
        assert!(!c.names("Payments", "v1.4.2"));

        // Two images under one version keep the reference a lead.
        let mut same_version = compare_body(mixed);
        same_version["arms"]["b"]["version"] = json!("v1.4.2");
        let c = coverage(tool, &input, same_version).comparison.unwrap();
        assert_eq!(c.arms_with_version, 2);
        assert!(!c.is_decisive());

        let endpoints = json!({"insufficient": false, "endpoints": [{"operation": "GET /pay", "source_stream": "default", "error_rate": delta(0.2, false, false, "variance"), "p95": delta(-1.0, false, false, "variance")}]});
        let c = coverage(tool, &input, compare_body(endpoints))
            .comparison
            .unwrap();
        assert_eq!(c.adverse.len(), 1);
        assert_eq!(c.adverse[0].scope, "endpoint:default/GET /pay");
        assert_eq!(c.adverse[0].source.as_deref(), Some("traces/default"));

        let mut rum = compare_body(json!({"insufficient": true}));
        rum["rum"] =
            json!({"insufficient": false, "error_view_rate": delta(0.3, false, false, "variance")});
        let c = coverage(tool, &input, rum).comparison.unwrap();
        assert_eq!(c.adverse[0].source.as_deref(), Some(RUM_SOURCE));
        assert!(c.is_decisive());
    }
}
