// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! The opt-in `has_data` answer of `_correlate`: one bounded existence query per metric stream,
//! under the WHERE the UI's Metrics tab no-data check (`runNoDataCheck`) would run itself.

use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::Mutex,
    time::Duration,
};

use config::{
    meta::{
        correlation::FieldAlias,
        search::{Query as SearchQuery, Request as SearchRequest},
        service_streams::{CorrelationResponse, RelatedStreams, StreamInfo},
        stream::StreamType,
    },
    utils::sql::{quote_identifier, quote_sql_string},
};
use futures::StreamExt;

use super::CorrelationRequest;

/// The whole check's budget; streams still unanswered when it runs out stay unknown.
pub(crate) const BUDGET: Duration = Duration::from_millis(2500);
const MAX_IN_FLIGHT: usize = 8;
// The default `record_services::window` gives the spans path when the request has no window.
const DEFAULT_WINDOW_US: i64 = 3_600_000_000;
// The UI's "every value" placeholder; a filter holding it does not narrow the stream.
const SELECT_ALL_VALUE: &str = "_o2_all_";

/// The WHERE clause of one stream's check, and every field that clause reads.
#[derive(Debug, PartialEq)]
pub(crate) struct Predicate {
    pub sql: Option<String>,
    pub fields: Vec<String>,
}

/// What the UI's no-data check knows besides the stream: unstable dimensions and groups.
pub(crate) struct Scope {
    unstable: HashSet<String>,
    group_of: HashMap<String, String>,
}

impl Scope {
    /// Every dimension any caller passes as unstable, so the check never filters on more than
    /// the UI; span detail passes the first logs stream's filters as its matched dimensions.
    pub(crate) fn of(response: &CorrelationResponse, groups: &[FieldAlias]) -> Self {
        let wildcarded = |dims: &HashMap<String, String>| {
            dims.iter()
                .filter(|(_, v)| v.as_str() == SELECT_ALL_VALUE)
                .map(|(k, _)| k.clone())
                .collect::<Vec<_>>()
        };
        let mut unstable: HashSet<String> =
            response.additional_dimensions.keys().cloned().collect();
        unstable.extend(wildcarded(&response.matched_dimensions));
        if let Some(first) = response.related_streams.logs.first() {
            unstable.extend(wildcarded(&first.filters));
        }
        // Mirrors `buildFieldToGroupIdMap`: lowercased field, first group in declaration order.
        let mut group_of = HashMap::new();
        for group in groups {
            for field in &group.fields {
                group_of
                    .entry(field.to_lowercase())
                    .or_insert_with(|| group.id.clone());
            }
        }
        Self { unstable, group_of }
    }

    fn is_unstable(&self, field: &str) -> bool {
        self.group_of
            .get(&field.to_lowercase())
            .is_some_and(|id| self.unstable.contains(id))
    }
}

/// The reads the check makes, behind a trait so tests can count them.
#[async_trait::async_trait]
pub(crate) trait Probe: Sync {
    /// The metric stream's schema fields; `None` when the schema cannot be read.
    async fn fields(&self, stream: &str) -> Option<HashSet<String>>;
    /// Whether `sql` returns a row in `window`; `None` when the search failed or was partial.
    async fn exists(
        &self,
        trace_id: &str,
        stream: &str,
        sql: &str,
        window: (i64, i64),
    ) -> Option<bool>;
    /// Stops a search the budget gave up on; a dropped future leaves its spawned task running.
    fn cancel(&self, trace_id: &str);
}

/// Reads schemas and runs searches as the caller.
pub(crate) struct LiveProbe<'a> {
    pub org_id: &'a str,
    pub user_id: &'a str,
}

#[async_trait::async_trait]
impl Probe for LiveProbe<'_> {
    async fn fields(&self, stream: &str) -> Option<HashSet<String>> {
        let schema = infra::schema::get(self.org_id, stream, StreamType::Metrics)
            .await
            .ok()?;
        // An empty schema is a stream that does not exist, which a search would reject.
        if schema.fields().is_empty() {
            return None;
        }
        Some(schema.fields().iter().map(|f| f.name().clone()).collect())
    }

    async fn exists(
        &self,
        trace_id: &str,
        stream: &str,
        sql: &str,
        (start_time, end_time): (i64, i64),
    ) -> Option<bool> {
        search_service::check_search_allowed(self.org_id, Some((stream, StreamType::Metrics)))
            .ok()?;
        // Resolved here rather than by `search`, which would write an audit row per probe.
        let raw_streams = search_service::raw_streams::resolve(
            self.org_id,
            StreamType::Metrics,
            sql,
            Some(self.user_id),
        )
        .await;
        let req = SearchRequest {
            query: SearchQuery {
                sql: sql.to_string(),
                start_time,
                end_time,
                from: 0,
                size: 1,
                track_total_hits: false,
                ..Default::default()
            },
            regions: vec![],
            clusters: vec![],
            timeout: BUDGET.as_secs().max(1) as i64,
            use_cache: false,
            raw_streams: Some(raw_streams),
            ..Default::default()
        };
        let res = search_service::search(
            trace_id,
            self.org_id,
            StreamType::Metrics,
            Some(self.user_id.to_string()),
            &req,
        )
        .await
        .ok()?;
        if !res.hits.is_empty() {
            return Some(true);
        }
        // A partial answer may have skipped the files that hold the row.
        (!res.is_partial).then_some(false)
    }

    fn cancel(&self, trace_id: &str) {
        let (org_id, trace_id) = (self.org_id.to_string(), trace_id.to_string());
        tokio::spawn(async move {
            #[cfg(feature = "enterprise")]
            let _ = search_service::cancel_query(&org_id, &trace_id).await;
            #[cfg(not(feature = "enterprise"))]
            search_service::abort_trace_family(&org_id, &trace_id).await;
        });
    }
}

/// Drops the streams the caller cannot read, then answers `has_data` on what is left, so
/// an unreadable stream is never queried.
pub(crate) async fn filter_then_annotate<F, Fut>(
    req: &CorrelationRequest,
    response: &mut CorrelationResponse,
    groups: &[FieldAlias],
    readable: F,
    probe: &dyn Probe,
    now: i64,
    budget: Duration,
) where
    F: FnOnce(RelatedStreams) -> Fut,
    Fut: Future<Output = RelatedStreams>,
{
    let all = std::mem::replace(
        &mut response.related_streams,
        RelatedStreams {
            logs: vec![],
            traces: vec![],
            metrics: vec![],
            profiles: vec![],
        },
    );
    response.related_streams = readable(all).await;
    if !req.check_data {
        return;
    }
    let scope = Scope::of(response, groups);
    let window = window(req.start_time, req.end_time, now);
    annotate(
        &mut response.related_streams.metrics,
        &scope,
        window,
        probe,
        budget,
    )
    .await;
}

/// Sets `has_data` only from a query that finished; errors and timeouts leave it `None`.
pub(crate) async fn annotate(
    metrics: &mut [StreamInfo],
    scope: &Scope,
    window: (i64, i64),
    probe: &dyn Probe,
    budget: Duration,
) {
    let jobs: Vec<_> = metrics
        .iter()
        .enumerate()
        .filter_map(|(i, s)| Some((i, s.stream_name.clone(), metric_predicate(s, scope)?)))
        .collect();
    let in_flight = Mutex::new(HashSet::new());
    let in_flight = &in_flight;
    let mut answers = futures::stream::iter(jobs)
        .map(|(index, name, predicate)| async move {
            let trace_id = config::ider::generate_trace_id();
            let answer = check_one(probe, &trace_id, &name, &predicate, window, in_flight).await;
            (index, answer)
        })
        .buffer_unordered(MAX_IN_FLIGHT);
    let deadline = tokio::time::Instant::now() + budget;
    while let Ok(Some((index, answer))) = tokio::time::timeout_at(deadline, answers.next()).await {
        if let (Some(answer), Some(stream)) = (answer, metrics.get_mut(index)) {
            stream.has_data = Some(answer);
        }
    }
    drop(answers);
    let abandoned: Vec<String> = in_flight
        .lock()
        .map(|s| s.iter().cloned().collect())
        .unwrap_or_default();
    for trace_id in abandoned {
        probe.cancel(&trace_id);
    }
}

/// The request's window, or the last hour when it has none.
pub(crate) fn window(start: Option<i64>, end: Option<i64>, now: i64) -> (i64, i64) {
    match (start, end) {
        (Some(start), Some(end)) if start < end => (start, end),
        _ => (now - DEFAULT_WINDOW_US, now),
    }
}

/// `metricWhereConditions` with no schemas loaded, as `runNoDataCheck` calls it, over the
/// filters `applyUnstableDimensionDefaults` left; `None` when the UI's pick is order-dependent.
pub(crate) fn metric_predicate(stream: &StreamInfo, scope: &Scope) -> Option<Predicate> {
    let mut filters: Vec<(&String, &String)> = stream
        .filters
        .iter()
        .filter(|(field, value)| value.as_str() != SELECT_ALL_VALUE && !scope.is_unstable(field))
        .collect();
    filters.sort();
    let mut conditions = Vec::with_capacity(filters.len());
    let mut fields = Vec::new();
    for (field, value) in filters {
        let group = alias_fields(field, &stream.filter_aliases)?;
        let spellings = group
            .iter()
            .find_map(|f| stream.filter_spellings.get(f.as_str()));
        let matches: Vec<String> = group
            .iter()
            .map(|f| sql_condition(f, value, spellings.map(Vec::as_slice)))
            .collect();
        conditions.push(if matches.len() > 1 {
            format!("({})", matches.join(" OR "))
        } else {
            matches.into_iter().next()?
        });
        for f in group {
            if !fields.contains(&f) {
                fields.push(f);
            }
        }
    }
    Some(Predicate {
        sql: (!conditions.is_empty()).then(|| conditions.join(" AND ")),
        fields,
    })
}

/// Mirrors `metricExistenceSql`: one row under the predicate.
pub(crate) fn existence_sql(stream: &str, predicate: &Predicate) -> String {
    match &predicate.sql {
        Some(clause) => format!(
            "SELECT _timestamp FROM {} WHERE {clause} LIMIT 1",
            quote_identifier(stream)
        ),
        None => format!(
            "SELECT _timestamp FROM {} LIMIT 1",
            quote_identifier(stream)
        ),
    }
}

async fn check_one(
    probe: &dyn Probe,
    trace_id: &str,
    name: &str,
    predicate: &Predicate,
    window: (i64, i64),
    in_flight: &Mutex<HashSet<String>>,
) -> Option<bool> {
    let schema = probe.fields(name).await?;
    // A field missing from the schema fails the UI's own probe, which then reads as unknown.
    if !predicate.fields.iter().all(|f| schema.contains(f)) {
        return None;
    }
    let sql = existence_sql(name, predicate);
    if let Ok(mut set) = in_flight.lock() {
        set.insert(trace_id.to_string());
    }
    let answer = probe.exists(trace_id, name, &sql, window).await;
    if let Ok(mut set) = in_flight.lock() {
        set.remove(trace_id);
    }
    answer
}

/// Mirrors `filterAliasFields`: the field, then its group's key and others; `None` when the
/// field sits in two groups, since the UI then picks by the response's key order.
fn alias_fields(field: &str, aliases: &HashMap<String, Vec<String>>) -> Option<Vec<String>> {
    let mut groups = aliases
        .iter()
        .filter(|(key, others)| key.as_str() == field || others.iter().any(|o| o == field));
    let Some((key, others)) = groups.next() else {
        return Some(vec![field.to_string()]);
    };
    if groups.next().is_some() {
        return None;
    }
    let mut out = vec![field.to_string()];
    for f in std::iter::once(key).chain(others) {
        if !out.contains(f) {
            out.push(f.clone());
        }
    }
    Some(out)
}

/// Mirrors `buildSqlCondition`.
fn sql_condition(field: &str, value: &str, spellings: Option<&[String]>) -> String {
    let normalized = value.trim().to_lowercase();
    match spellings {
        Some(spellings) if spellings.contains(&normalized) => format!(
            "lower(trim({})) IN ({})",
            quote_identifier(field),
            spellings
                .iter()
                .map(|s| quote_sql_string(s))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        _ => format!("{} = {}", quote_identifier(field), quote_sql_string(value)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Groups<'a> = &'a [(&'a str, &'a [&'a str])];

    #[derive(Default)]
    struct FakeProbe {
        fields: HashMap<String, HashSet<String>>,
        answers: HashMap<String, Option<bool>>,
        slow: HashSet<String>,
        queried: Mutex<Vec<String>>,
        cancelled: Mutex<Vec<String>>,
    }

    impl FakeProbe {
        fn with(mut self, stream: &str, fields: &[&str], answer: Option<bool>) -> Self {
            self.fields.insert(
                stream.to_string(),
                fields.iter().map(|f| f.to_string()).collect(),
            );
            self.answers.insert(stream.to_string(), answer);
            self
        }

        fn queried(&self) -> Vec<String> {
            let mut q = self.queried.lock().unwrap().clone();
            q.sort();
            q
        }
    }

    #[async_trait::async_trait]
    impl Probe for FakeProbe {
        async fn fields(&self, stream: &str) -> Option<HashSet<String>> {
            self.fields.get(stream).cloned()
        }

        async fn exists(
            &self,
            _trace_id: &str,
            stream: &str,
            sql: &str,
            _: (i64, i64),
        ) -> Option<bool> {
            self.queried.lock().unwrap().push(format!("{stream}|{sql}"));
            if self.slow.contains(stream) {
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
            self.answers.get(stream).copied().flatten()
        }

        fn cancel(&self, trace_id: &str) {
            self.cancelled.lock().unwrap().push(trace_id.to_string());
        }
    }

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn metric(name: &str, filters: &[(&str, &str)]) -> StreamInfo {
        StreamInfo::with_type_and_filters(name.to_string(), StreamType::Metrics, map(filters))
    }

    fn response(metrics: Vec<StreamInfo>) -> CorrelationResponse {
        CorrelationResponse::new(
            "svc".to_string(),
            HashMap::new(),
            HashMap::new(),
            RelatedStreams {
                logs: vec![],
                traces: vec![],
                metrics,
                profiles: vec![],
            },
        )
    }

    fn no_scope() -> Scope {
        Scope::of(&response(vec![]), &[])
    }

    fn where_of(stream: &StreamInfo, scope: &Scope) -> Option<String> {
        metric_predicate(stream, scope).unwrap().sql
    }

    fn request(check_data: bool) -> CorrelationRequest {
        serde_json::from_value(serde_json::json!({
            "source_stream": "src",
            "source_type": "logs",
            "available_dimensions": {},
            "check_data": check_data,
        }))
        .unwrap()
    }

    async fn keep_all(streams: RelatedStreams) -> RelatedStreams {
        streams
    }

    // useMetricsCorrelationDashboard.spec.ts:54 "should create panels with correct query structure"
    #[test]
    fn ui_spec_panel_query_structure() {
        let s = metric("cpu_usage", &[("service", "api"), ("k8s-cluster", "prod")]);
        assert_eq!(
            where_of(&s, &no_scope()).as_deref(),
            Some(r#""k8s-cluster" = 'prod' AND "service" = 'api'"#)
        );
    }

    // useMetricsCorrelationDashboard.spec.ts:83 "filters metrics ... on every spelling of the
    // service key"
    #[test]
    fn ui_spec_every_spelling_of_the_service_key() {
        let mut s = metric("checkout_metric", &[("service_name", "checkout")]);
        s.filter_spellings.insert(
            "service_name".into(),
            vec!["checkout".into(), "checkout.service".into()],
        );
        assert_eq!(
            where_of(&s, &no_scope()).as_deref(),
            Some(r#"lower(trim("service_name")) IN ('checkout', 'checkout.service')"#)
        );
    }

    // useMetricsCorrelationDashboard.spec.ts:106 "should handle special characters in filter
    // values"
    #[test]
    fn ui_spec_special_characters_in_values() {
        let s = metric("test_metric", &[("description", "it's a test")]);
        assert_eq!(
            where_of(&s, &no_scope()).as_deref(),
            Some(r#""description" = 'it''s a test'"#)
        );
    }

    // telemetryCorrelation.spec.ts:326 and :336, `buildSqlCondition` spellings in and out
    #[test]
    fn ui_spec_build_sql_condition_spellings() {
        let spellings = ["checkout".to_string(), "checkout.service".to_string()];
        let both = r#"lower(trim("service_name")) IN ('checkout', 'checkout.service')"#;
        assert_eq!(
            sql_condition("service_name", "checkout", Some(&spellings)),
            both
        );
        assert_eq!(
            sql_condition("service_name", "Checkout.Service ", Some(&spellings)),
            both
        );
        assert_eq!(
            sql_condition("service_name", "cart", Some(&["checkout".to_string()])),
            r#""service_name" = 'cart'"#
        );
    }

    // telemetryCorrelation.spec.ts:322 and :342, escaping and identifier quoting
    #[test]
    fn ui_spec_build_sql_condition_quoting() {
        assert_eq!(sql_condition("svc", "a'b", None), r#""svc" = 'a''b'"#);
        assert_eq!(
            sql_condition("k8s-pod.name", "web-1", None),
            r#""k8s-pod.name" = 'web-1'"#
        );
        assert_eq!(sql_condition(r#"we"ird"#, "x", None), r#""we""ird" = 'x'"#);
    }

    // telemetryCorrelation.spec.ts:346-375, the four `buildStreamFilterCondition` cases
    #[test]
    fn ui_spec_build_stream_filter_condition() {
        let cases: [(&str, Groups, Groups, &str, &str); 4] = [
            ("no alias", &[], &[], "namespace", r#""namespace" = 'kube'"#),
            (
                "each alias the stream holds",
                &[("namespace", &["k8s_namespace_name"])],
                &[],
                "namespace",
                r#"("namespace" = 'kube' OR "k8s_namespace_name" = 'kube')"#,
            ),
            (
                "an edit landed on an alias",
                &[("namespace", &["k8s_namespace_name"])],
                &[],
                "k8s_namespace_name",
                r#"("k8s_namespace_name" = 'kube' OR "namespace" = 'kube')"#,
            ),
            (
                "each alias under the filter's spellings",
                &[("service_name", &["service"])],
                &[("service_name", &["kube", "kube.service"])],
                "service_name",
                concat!(
                    r#"(lower(trim("service_name")) IN ('kube', 'kube.service') OR "#,
                    r#"lower(trim("service")) IN ('kube', 'kube.service'))"#
                ),
            ),
        ];
        let owned = |pairs: Groups| -> HashMap<String, Vec<String>> {
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect()))
                .collect()
        };
        for (case, aliases, spellings, field, sql) in cases {
            let mut s = metric("m", &[(field, "kube")]);
            s.filter_aliases = owned(aliases);
            s.filter_spellings = owned(spellings);
            assert_eq!(where_of(&s, &no_scope()).as_deref(), Some(sql), "{case}");
        }
    }

    // metricWhereConditions (useMetricsCorrelationDashboard.ts:88) skips only the wildcard
    #[test]
    fn ui_where_keeps_empty_values_and_skips_wildcards() {
        let s = metric("m", &[("a", ""), ("b", SELECT_ALL_VALUE), ("c", "x")]);
        assert_eq!(
            where_of(&s, &no_scope()).as_deref(),
            Some(r#""a" = '' AND "c" = 'x'"#)
        );
        let all = metric("m", &[("b", SELECT_ALL_VALUE)]);
        let p = metric_predicate(&all, &no_scope()).unwrap();
        // metricDataCheck.spec.ts:27, the existence SQL with and without a WHERE
        assert_eq!(
            existence_sql("cpu", &p),
            r#"SELECT _timestamp FROM "cpu" LIMIT 1"#
        );
    }

    // applyUnstableDimensionDefaults (TelemetryCorrelationDashboard.vue:1522): a filter whose
    // group is an additional or wildcarded matched dimension is dropped, case-insensitively.
    #[test]
    fn ui_unstable_dimensions_are_wildcarded() {
        let groups = [
            FieldAlias::new("k8s-pod", "Pod", &["k8s_pod_name", "pod"]),
            FieldAlias::new("k8s-node", "Node", &["k8s_node_name"]),
            FieldAlias::new("service", "Service", &["service_name"]),
        ];
        let mut r = response(vec![]);
        r.additional_dimensions = map(&[("k8s-pod", "web-1")]);
        r.matched_dimensions = map(&[("service", "api"), ("k8s-node", SELECT_ALL_VALUE)]);
        let scope = Scope::of(&r, &groups);
        let s = metric(
            "m",
            &[
                ("K8S_POD_NAME", "web-1"),
                ("k8s_node_name", "n1"),
                ("service_name", "api"),
            ],
        );
        assert_eq!(
            where_of(&s, &scope).as_deref(),
            Some(r#""service_name" = 'api'"#)
        );
    }

    // buildFieldToGroupIdMap (telemetryCorrelation.ts:103): the first group declaring a field wins
    #[test]
    fn ui_first_declared_group_wins() {
        let groups = [
            FieldAlias::new("host", "Host", &["node"]),
            FieldAlias::new("k8s-node", "Node", &["node"]),
        ];
        let mut r = response(vec![]);
        r.additional_dimensions = map(&[("k8s-node", "n1")]);
        let s = metric("m", &[("node", "n1")]);
        assert_eq!(
            where_of(&s, &Scope::of(&r, &groups)).as_deref(),
            Some(r#""node" = 'n1'"#)
        );
    }

    // TraceDetailsSidebar passes the first logs stream's filters as matched dimensions.
    #[test]
    fn span_detail_wildcards_from_the_first_logs_stream_count() {
        let groups = [FieldAlias::new("pod", "Pod", &["pod"])];
        let mut r = response(vec![]);
        r.related_streams.logs = vec![StreamInfo::with_filters(
            "app".into(),
            map(&[("pod", SELECT_ALL_VALUE)]),
        )];
        let s = metric("m", &[("pod", "p1")]);
        assert_eq!(where_of(&s, &Scope::of(&r, &groups)), None);
    }

    #[test]
    fn predicate_unknown_when_field_sits_in_two_alias_groups() {
        let mut s = metric("m", &[("ns", "prod")]);
        s.filter_aliases
            .insert("namespace".into(), vec!["ns".into()]);
        s.filter_aliases.insert("other".into(), vec!["ns".into()]);
        assert_eq!(metric_predicate(&s, &no_scope()), None);
    }

    #[test]
    fn existence_sql_quotes_the_stream() {
        let p = metric_predicate(&metric("x", &[]), &no_scope()).unwrap();
        assert_eq!(
            existence_sql(r#"a"b"#, &p),
            r#"SELECT _timestamp FROM "a""b" LIMIT 1"#
        );
    }

    #[test]
    fn window_defaults_to_last_hour() {
        assert_eq!(window(Some(10), Some(20), 99), (10, 20));
        assert_eq!(
            window(None, None, DEFAULT_WINDOW_US + 5),
            (5, DEFAULT_WINDOW_US + 5)
        );
        assert_eq!(
            window(Some(20), Some(10), DEFAULT_WINDOW_US),
            (0, DEFAULT_WINDOW_US)
        );
    }

    #[tokio::test]
    async fn check_data_false_runs_no_query_and_sets_no_field() {
        let probe = FakeProbe::default().with("cpu", &["service"], Some(true));
        let mut r = response(vec![metric("cpu", &[("service", "api")])]);
        filter_then_annotate(&request(false), &mut r, &[], keep_all, &probe, 0, BUDGET).await;
        assert!(probe.queried().is_empty());
        assert_eq!(r.related_streams.metrics[0].has_data, None);
        assert!(!serde_json::to_string(&r).unwrap().contains("has_data"));
    }

    #[tokio::test]
    async fn sets_true_false_and_leaves_errors_unknown() {
        let probe = FakeProbe::default()
            .with("full", &["service"], Some(true))
            .with("empty", &["service"], Some(false))
            .with("broken", &["service"], None)
            .with("missing_field", &["service"], Some(false));
        let mut r = response(vec![
            metric("full", &[("service", "api")]),
            metric("empty", &[("service", "api")]),
            metric("broken", &[("service", "api")]),
            metric("no_schema", &[("service", "api")]),
            metric("missing_field", &[("pod", "p1")]),
        ]);
        r.related_streams.logs = vec![StreamInfo::new("logs1".into())];
        filter_then_annotate(&request(true), &mut r, &[], keep_all, &probe, 0, BUDGET).await;
        let got: Vec<_> = r
            .related_streams
            .metrics
            .iter()
            .map(|s| s.has_data)
            .collect();
        assert_eq!(got, vec![Some(true), Some(false), None, None, None]);
        assert_eq!(
            r.related_streams.logs[0].has_data, None,
            "only metrics are checked"
        );
        let queried = probe.queried();
        assert!(queried.contains(
            &r#"empty|SELECT _timestamp FROM "empty" WHERE "service" = 'api' LIMIT 1"#.to_string()
        ));
        assert!(!queried.iter().any(|q| q.starts_with("missing_field|")));
        assert!(!queried.iter().any(|q| q.starts_with("no_schema|")));
        assert!(!queried.iter().any(|q| q.starts_with("logs1|")));
    }

    #[tokio::test]
    async fn unreadable_streams_are_dropped_before_any_query() {
        let probe = FakeProbe::default()
            .with("readable", &["service"], Some(true))
            .with("secret", &["service"], Some(true));
        let mut r = response(vec![
            metric("readable", &[("service", "api")]),
            metric("secret", &[("service", "api")]),
        ]);
        let probe_ref = &probe;
        let readable = |mut streams: RelatedStreams| async move {
            assert!(probe_ref.queried().is_empty(), "the read filter runs first");
            streams.metrics.retain(|s| s.stream_name != "secret");
            streams
        };
        filter_then_annotate(&request(true), &mut r, &[], readable, &probe, 0, BUDGET).await;
        let queried = probe.queried();
        assert_eq!(queried.len(), 1);
        assert!(queried[0].starts_with("readable|"));
        assert_eq!(r.related_streams.metrics.len(), 1);
    }

    #[tokio::test]
    async fn budget_keeps_finished_answers_and_cancels_the_rest() {
        let mut probe = FakeProbe::default()
            .with("fast", &["service"], Some(false))
            .with("slow", &["service"], Some(true));
        probe.slow.insert("slow".into());
        let mut metrics = vec![
            metric("fast", &[("service", "api")]),
            metric("slow", &[("service", "api")]),
        ];
        annotate(
            &mut metrics,
            &no_scope(),
            (0, 1),
            &probe,
            Duration::from_millis(100),
        )
        .await;
        assert_eq!(metrics[0].has_data, Some(false));
        assert_eq!(metrics[1].has_data, None);
        assert_eq!(probe.cancelled.lock().unwrap().len(), 1);
    }
}
