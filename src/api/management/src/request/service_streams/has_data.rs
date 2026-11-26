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

//! The opt-in `has_data` answer of `_correlate`: one bounded existence query per stream.

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use config::{
    meta::{
        search::{Query as SearchQuery, Request as SearchRequest},
        service_streams::{RelatedStreams, StreamInfo},
        stream::StreamType,
    },
    utils::sql::{quote_identifier, quote_sql_string},
};
use futures::StreamExt;

use super::CorrelationRequest;

/// The whole check's budget; streams still unanswered when it runs out stay unknown.
pub(crate) const BUDGET: Duration = Duration::from_millis(2500);
const MAX_IN_FLIGHT: usize = 8;
// Same last-hour default the spans path uses when the request carries no window.
const DEFAULT_WINDOW_US: i64 = 3_600_000_000;
// The UI's "every value" placeholder; a filter holding it does not narrow the stream.
const SELECT_ALL_VALUE: &str = "_o2_all_";

/// The WHERE clause the UI opens a stream on, and every field that clause reads.
#[derive(Debug, PartialEq)]
pub(crate) struct Predicate {
    pub sql: Option<String>,
    pub fields: Vec<String>,
}

/// The two reads the check makes, behind a trait so tests can count them.
#[async_trait::async_trait]
pub(crate) trait Probe: Sync {
    /// The stream's schema fields; `None` when the schema cannot be read.
    async fn fields(&self, stream_type: StreamType, stream: &str) -> Option<HashSet<String>>;
    /// Whether `sql` returns a row in `window`; `None` when the search failed or was partial.
    async fn exists(
        &self,
        stream_type: StreamType,
        stream: &str,
        sql: &str,
        window: (i64, i64),
    ) -> Option<bool>;
}

/// Reads schemas and runs searches as the caller.
pub(crate) struct LiveProbe<'a> {
    pub org_id: &'a str,
    pub user_id: &'a str,
}

#[async_trait::async_trait]
impl Probe for LiveProbe<'_> {
    async fn fields(&self, stream_type: StreamType, stream: &str) -> Option<HashSet<String>> {
        let schema = infra::schema::get(self.org_id, stream, stream_type)
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
        stream_type: StreamType,
        stream: &str,
        sql: &str,
        (start_time, end_time): (i64, i64),
    ) -> Option<bool> {
        search_service::check_search_allowed(self.org_id, Some((stream, stream_type))).ok()?;
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
            ..Default::default()
        };
        let trace_id = config::ider::generate_trace_id();
        let res = search_service::search(
            &trace_id,
            self.org_id,
            stream_type,
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
}

/// Sets `has_data` on the request's streams when it asked for it; otherwise reads nothing.
pub(crate) async fn annotate_requested(
    req: &CorrelationRequest,
    related: &mut RelatedStreams,
    probe: &dyn Probe,
    now: i64,
    budget: Duration,
) {
    if !req.check_data {
        return;
    }
    let window = window(req.start_time, req.end_time, now);
    annotate(related, window, probe, budget).await;
}

/// Sets `has_data` only from a query that finished; errors and timeouts leave it `None`.
pub(crate) async fn annotate(
    related: &mut RelatedStreams,
    window: (i64, i64),
    probe: &dyn Probe,
    budget: Duration,
) {
    let mut jobs = Vec::new();
    for (list, stream_type, streams) in lists(related) {
        for (index, stream) in streams.iter().enumerate() {
            if !matches!(
                stream_type,
                StreamType::Logs | StreamType::Metrics | StreamType::Traces
            ) {
                continue;
            }
            if let Some(predicate) = stream_predicate(stream) {
                jobs.push((
                    (list, index),
                    stream_type,
                    stream.stream_name.clone(),
                    predicate,
                ));
            }
        }
    }
    let mut answers = futures::stream::iter(jobs)
        .map(|(slot, stream_type, name, predicate)| async move {
            (
                slot,
                check_one(probe, stream_type, &name, &predicate, window).await,
            )
        })
        .buffer_unordered(MAX_IN_FLIGHT);
    let deadline = tokio::time::Instant::now() + budget;
    let mut found = Vec::new();
    while let Ok(Some((slot, answer))) = tokio::time::timeout_at(deadline, answers.next()).await {
        if let Some(answer) = answer {
            found.push((slot, answer));
        }
    }
    let lists = lists(related);
    for ((list, index), answer) in found {
        if let Some(stream) = lists[list].2.get_mut(index) {
            stream.has_data = Some(answer);
        }
    }
}

/// The request's window, or the last hour when it has none.
pub(crate) fn window(start: Option<i64>, end: Option<i64>, now: i64) -> (i64, i64) {
    match (start, end) {
        (Some(start), Some(end)) if start < end => (start, end),
        _ => (now - DEFAULT_WINDOW_US, now),
    }
}

/// Mirrors the UI's `usableFilters` + `buildStreamFilterCondition`; `None` when a filter
/// field sits in more than one alias group, since the UI's pick there depends on key order.
pub(crate) fn stream_predicate(stream: &StreamInfo) -> Option<Predicate> {
    let mut filters: Vec<(&String, &String)> = stream
        .filters
        .iter()
        .filter(|(_, value)| !value.is_empty() && value.as_str() != SELECT_ALL_VALUE)
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

/// The bounded query that answers whether `stream` holds a row matching `predicate`.
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
    stream_type: StreamType,
    name: &str,
    predicate: &Predicate,
    window: (i64, i64),
) -> Option<bool> {
    let schema = probe.fields(stream_type, name).await?;
    // A field missing from the schema makes the query's answer unreliable either way.
    if !predicate.fields.iter().all(|f| schema.contains(f)) {
        return None;
    }
    let sql = existence_sql(name, predicate);
    probe.exists(stream_type, name, &sql, window).await
}

fn lists(related: &mut RelatedStreams) -> [(usize, StreamType, &mut Vec<StreamInfo>); 4] {
    [
        (0, StreamType::Logs, &mut related.logs),
        (1, StreamType::Traces, &mut related.traces),
        (2, StreamType::Metrics, &mut related.metrics),
        (3, StreamType::Profiles, &mut related.profiles),
    ]
}

/// The filter's field, then its alias group's key and others, in the UI's order.
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
    use std::sync::Mutex;

    use super::*;

    struct FakeProbe {
        fields: HashMap<String, HashSet<String>>,
        answers: HashMap<String, Option<bool>>,
        slow: HashSet<String>,
        queried: Mutex<Vec<String>>,
    }

    impl FakeProbe {
        fn new() -> Self {
            Self {
                fields: HashMap::new(),
                answers: HashMap::new(),
                slow: HashSet::new(),
                queried: Mutex::new(Vec::new()),
            }
        }

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
        async fn fields(&self, _: StreamType, stream: &str) -> Option<HashSet<String>> {
            self.fields.get(stream).cloned()
        }

        async fn exists(
            &self,
            _: StreamType,
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
    }

    fn stream(name: &str, filters: &[(&str, &str)]) -> StreamInfo {
        StreamInfo::with_filters(
            name.to_string(),
            filters
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    fn related(logs: Vec<StreamInfo>, metrics: Vec<StreamInfo>) -> RelatedStreams {
        RelatedStreams {
            logs,
            traces: vec![],
            metrics,
            profiles: vec![],
        }
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

    #[test]
    fn predicate_exact_match_per_filter_sorted() {
        let s = stream("s", &[("service", "api"), ("env", "prod")]);
        let p = stream_predicate(&s).unwrap();
        assert_eq!(
            p.sql.as_deref(),
            Some(r#""env" = 'prod' AND "service" = 'api'"#)
        );
        assert_eq!(p.fields, vec!["env", "service"]);
    }

    #[test]
    fn predicate_skips_empty_and_wildcard_values() {
        let s = stream("s", &[("a", ""), ("b", SELECT_ALL_VALUE), ("c", "x")]);
        let p = stream_predicate(&s).unwrap();
        assert_eq!(p.sql.as_deref(), Some(r#""c" = 'x'"#));
        let none = stream_predicate(&stream("s", &[("a", "")])).unwrap();
        assert_eq!(none.sql, None);
        assert_eq!(
            existence_sql("s", &none),
            r#"SELECT _timestamp FROM "s" LIMIT 1"#
        );
    }

    #[test]
    fn predicate_uses_spellings_only_when_value_is_one() {
        let mut s = stream("s", &[("env", " Prod ")]);
        s.filter_spellings
            .insert("env".into(), vec!["prod".into(), "production".into()]);
        assert_eq!(
            stream_predicate(&s).unwrap().sql.as_deref(),
            Some(r#"lower(trim("env")) IN ('prod', 'production')"#)
        );
        s.filters.insert("env".into(), "staging".into());
        assert_eq!(
            stream_predicate(&s).unwrap().sql.as_deref(),
            Some(r#""env" = 'staging'"#)
        );
    }

    #[test]
    fn predicate_ors_alias_fields_under_the_group_spellings() {
        let mut s = stream("s", &[("k8s_namespace", "prod")]);
        s.filter_aliases.insert(
            "namespace".into(),
            vec!["k8s_namespace".into(), "ns".into()],
        );
        assert_eq!(
            stream_predicate(&s).unwrap().sql.as_deref(),
            Some(r#"("k8s_namespace" = 'prod' OR "namespace" = 'prod' OR "ns" = 'prod')"#)
        );
        s.filter_spellings
            .insert("namespace".into(), vec!["prod".into()]);
        let p = stream_predicate(&s).unwrap();
        assert_eq!(
            p.sql.as_deref(),
            Some(concat!(
                r#"(lower(trim("k8s_namespace")) IN ('prod') OR "#,
                r#"lower(trim("namespace")) IN ('prod') OR lower(trim("ns")) IN ('prod'))"#
            ))
        );
        assert_eq!(p.fields, vec!["k8s_namespace", "namespace", "ns"]);
    }

    #[test]
    fn predicate_unknown_when_field_sits_in_two_alias_groups() {
        let mut s = stream("s", &[("ns", "prod")]);
        s.filter_aliases
            .insert("namespace".into(), vec!["ns".into()]);
        s.filter_aliases.insert("other".into(), vec!["ns".into()]);
        assert_eq!(stream_predicate(&s), None);
    }

    #[test]
    fn predicate_quotes_identifiers_and_escapes_values() {
        let s = stream("s", &[(r#"we"ird"#, "o'brien")]);
        assert_eq!(
            stream_predicate(&s).unwrap().sql.as_deref(),
            Some(r#""we""ird" = 'o''brien'"#)
        );
        assert_eq!(
            existence_sql(r#"a"b"#, &stream_predicate(&stream("x", &[])).unwrap()),
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
        let probe = FakeProbe::new().with("app", &["service"], Some(true));
        let mut rel = related(vec![stream("app", &[("service", "api")])], vec![]);
        annotate_requested(&request(false), &mut rel, &probe, 0, BUDGET).await;
        assert!(probe.queried().is_empty());
        assert_eq!(rel.logs[0].has_data, None);
        assert!(!serde_json::to_string(&rel).unwrap().contains("has_data"));
    }

    #[tokio::test]
    async fn sets_true_false_and_leaves_errors_unknown() {
        let probe = FakeProbe::new()
            .with("full", &["service"], Some(true))
            .with("empty", &["service"], Some(false))
            .with("broken", &["service"], None)
            .with("cpu", &["service"], Some(false));
        let mut rel = related(
            vec![
                stream("full", &[("service", "api")]),
                stream("empty", &[("service", "api")]),
                stream("broken", &[("service", "api")]),
                stream("no_schema", &[("service", "api")]),
                stream("missing_field", &[("pod", "p1")]),
            ],
            vec![stream("cpu", &[("service", "api")])],
        );
        let probe = probe.with("missing_field", &["service"], Some(false));
        annotate_requested(&request(true), &mut rel, &probe, 0, BUDGET).await;
        let got: Vec<_> = rel.logs.iter().map(|s| s.has_data).collect();
        assert_eq!(got, vec![Some(true), Some(false), None, None, None]);
        assert_eq!(rel.metrics[0].has_data, Some(false));
        let queried = probe.queried();
        assert!(queried.contains(
            &r#"cpu|SELECT _timestamp FROM "cpu" WHERE "service" = 'api' LIMIT 1"#.to_string()
        ));
        assert!(!queried.iter().any(|q| q.starts_with("missing_field|")));
        assert!(!queried.iter().any(|q| q.starts_with("no_schema|")));
    }

    #[tokio::test]
    async fn profiles_are_never_queried() {
        let probe = FakeProbe::new().with("prof", &[], Some(true));
        let mut rel = related(vec![], vec![]);
        rel.profiles.push(stream("prof", &[]));
        annotate(&mut rel, (0, 1), &probe, BUDGET).await;
        assert!(probe.queried().is_empty());
        assert_eq!(rel.profiles[0].has_data, None);
    }

    #[tokio::test]
    async fn only_streams_left_after_the_read_filter_are_queried() {
        let probe = FakeProbe::new()
            .with("readable", &["service"], Some(true))
            .with("secret", &["service"], Some(true));
        let mut rel = related(
            vec![
                stream("readable", &[("service", "api")]),
                stream("secret", &[("service", "api")]),
            ],
            vec![],
        );
        rel.logs.retain(|s| s.stream_name != "secret");
        annotate(&mut rel, (0, 1), &probe, BUDGET).await;
        let queried = probe.queried();
        assert_eq!(queried.len(), 1);
        assert!(queried[0].starts_with("readable|"));
    }

    #[tokio::test]
    async fn budget_keeps_finished_answers_and_leaves_the_rest_unknown() {
        let mut probe = FakeProbe::new()
            .with("fast", &["service"], Some(false))
            .with("slow", &["service"], Some(true));
        probe.slow.insert("slow".into());
        let mut rel = related(
            vec![
                stream("fast", &[("service", "api")]),
                stream("slow", &[("service", "api")]),
            ],
            vec![],
        );
        annotate(&mut rel, (0, 1), &probe, Duration::from_millis(100)).await;
        assert_eq!(rel.logs[0].has_data, Some(false));
        assert_eq!(rel.logs[1].has_data, None);
    }
}
