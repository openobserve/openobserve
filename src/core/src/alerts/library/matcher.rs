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

//! Which library alerts fit one stream: set lookups over derived needs, no values, no searches.

use std::collections::{BTreeSet, HashSet};

use config::meta::stream::StreamType;
use serde::Serialize;
use utoipa::ToSchema;

use super::{
    index::IndexedEntry,
    needs::{QueryKind, normalize},
};

const STREAM_PLACEHOLDER: &str = "__stream__";

/// What the matcher knows about the picked stream.
#[derive(Clone, Debug, Default)]
pub struct StreamFacts {
    pub stream_type: StreamType,
    /// The name as stored.
    pub name: String,
    /// Normalised column names.
    pub columns: HashSet<String>,
    /// The stream received data in the last 24 hours.
    pub fresh: bool,
    /// The org's metric stream names, normalised.
    pub metrics: HashSet<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Fit {
    Fits,
    Likely,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Match {
    pub fit: Fit,
    pub matched: Vec<String>,
    pub missing: Vec<String>,
    /// The entry is offered on a stream other than the one it was written for.
    pub swap: bool,
}

/// Steps 1-3 of the matcher for one entry; `None` when it does not fit.
pub fn match_entry(entry: &IndexedEntry, facts: &StreamFacts) -> Option<Match> {
    if !entry.needs.parsed || entry.entry.stream_type != facts.stream_type.as_str() {
        return None;
    }
    match (facts.stream_type, entry.needs.kind) {
        (StreamType::Metrics, QueryKind::Promql) => match_metric(entry, facts),
        (_, QueryKind::Promql) => None,
        _ => match_fields(entry, facts),
    }
}

fn match_metric(entry: &IndexedEntry, facts: &StreamFacts) -> Option<Match> {
    let needs = &entry.needs;
    let picked = normalize(&facts.name);
    let reads =
        needs.metrics.contains(&picked) || entry.patterns.iter().any(|p| p.is_match(&picked));
    let others_exist = needs.metrics.iter().all(|m| facts.metrics.contains(m))
        && entry
            .patterns
            .iter()
            .all(|p| facts.metrics.iter().any(|m| p.is_match(m)));
    if !reads || !others_exist || !needs.hard_labels.iter().all(|l| facts.columns.contains(l)) {
        return None;
    }
    let missing: Vec<String> = needs
        .soft_labels
        .iter()
        .filter(|l| !facts.columns.contains(*l))
        .cloned()
        .collect();
    let used: BTreeSet<String> = needs
        .metrics
        .iter()
        .chain(needs.hard_labels.iter())
        .chain(
            needs
                .soft_labels
                .iter()
                .filter(|l| facts.columns.contains(*l)),
        )
        .cloned()
        .collect();
    let fit = if missing.is_empty() && facts.fresh {
        Fit::Fits
    } else {
        Fit::Likely
    };
    Some(Match {
        fit,
        matched: used.into_iter().collect(),
        missing,
        swap: false,
    })
}

fn match_fields(entry: &IndexedEntry, facts: &StreamFacts) -> Option<Match> {
    let needs = &entry.needs;
    let picked = normalize(&facts.name);
    let same = needs.streams.contains(&picked);
    // Only a one-stream query can be re-pointed; a field-less one has only its name as evidence.
    let swappable = needs.streams.len() <= 1
        && !needs.fields.is_empty()
        && facts.stream_type != StreamType::Metrics;
    if !(same || swappable) || !needs.fields.iter().all(|f| facts.columns.contains(f)) {
        return None;
    }
    let swap = !same;
    let fit = if facts.fresh && (!swap || needs.fields.len() >= 2) {
        Fit::Fits
    } else {
        Fit::Likely
    };
    Some(Match {
        fit,
        matched: needs.fields.iter().cloned().collect(),
        missing: Vec::new(),
        swap,
    })
}

/// Rank order of step 4: severity, as `severityRank` in the web library facets.
pub fn severity_rank(severity: &str) -> u8 {
    match severity {
        "critical" => 0,
        "warning" => 1,
        "info" => 2,
        _ => 3,
    }
}

/// The query with whitespace and case collapsed and its own stream replaced, for equivalence.
pub fn query_key(query: &str, stream: Option<&str>) -> String {
    let collapsed = query.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut key = collapsed.to_lowercase();
    if let Some(stream) = stream.filter(|s| !s.is_empty()) {
        key = replace_relation(&key, &stream.to_lowercase(), STREAM_PLACEHOLDER)
            .replace(&format!("\"{STREAM_PLACEHOLDER}\""), STREAM_PLACEHOLDER);
    }
    key
}

/// Replaces the FROM/JOIN identifier equal to `from`, quoted or bare, and nothing else.
pub fn replace_relation(sql: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut rest = sql;
    while let Some(pos) = find_relation_keyword(rest) {
        let (head, tail) = rest.split_at(pos.keyword_end);
        out.push_str(head);
        let trimmed = tail.trim_start();
        out.push_str(&tail[..tail.len() - trimmed.len()]);
        let quoted = format!("\"{from}\"");
        let (ident, after) = if trimmed.len() >= quoted.len()
            && trimmed[..quoted.len()].eq_ignore_ascii_case(&quoted)
        {
            (Some(true), &trimmed[quoted.len()..])
        } else if trimmed.len() >= from.len()
            && trimmed[..from.len()].eq_ignore_ascii_case(from)
            && trimmed[from.len()..]
                .chars()
                .next()
                .is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '_'))
        {
            (Some(false), &trimmed[from.len()..])
        } else {
            (None, trimmed)
        };
        match ident {
            Some(quoted) if quoted || !to.bytes().all(is_word) => {
                out.push_str(&format!("\"{to}\""))
            }
            Some(_) => out.push_str(to),
            None => {}
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

struct KeywordPos {
    keyword_end: usize,
}

fn find_relation_keyword(sql: &str) -> Option<KeywordPos> {
    let lower = sql.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut best: Option<usize> = None;
    for keyword in ["from", "join"] {
        let mut start = 0;
        while let Some(found) = lower[start..].find(keyword) {
            let at = start + found;
            let end = at + keyword.len();
            let before_ok = at == 0 || !is_word(bytes[at - 1]);
            let after_ok = end < bytes.len() && bytes[end].is_ascii_whitespace();
            if before_ok && after_ok {
                best = Some(best.map_or(end, |b| b.min(end)));
                break;
            }
            start = end;
        }
    }
    best.map(|keyword_end| KeywordPos { keyword_end })
}

fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::alerts::library::index::ManifestEntry;

    /// (entry, stream, expected (fit, swap, missing)).
    type Case<'a> = (
        &'a IndexedEntry,
        StreamFacts,
        Option<(Fit, bool, Vec<&'a str>)>,
    );

    fn promql(id: &str, stream: &str, query: &str) -> IndexedEntry {
        let entry = ManifestEntry {
            id: id.into(),
            stream: stream.into(),
            stream_type: "metrics".into(),
            ..Default::default()
        };
        let file = json!({"query_condition": {"type": "promql", "promql": query}});
        IndexedEntry::new(entry, false, file)
    }

    fn sql(id: &str, stream_type: &str, stream: &str, query: &str) -> IndexedEntry {
        let entry = ManifestEntry {
            id: id.into(),
            stream: stream.into(),
            stream_type: stream_type.into(),
            ..Default::default()
        };
        let file = json!({"stream_name": stream, "query_condition": {"type": "sql", "sql": query}});
        IndexedEntry::new(entry, false, file)
    }

    fn facts(
        t: StreamType,
        name: &str,
        cols: &[&str],
        fresh: bool,
        metrics: &[&str],
    ) -> StreamFacts {
        StreamFacts {
            stream_type: t,
            name: name.into(),
            columns: cols.iter().map(|c| c.to_string()).collect(),
            fresh,
            metrics: metrics.iter().map(|m| m.to_string()).collect(),
        }
    }

    #[test]
    fn matcher_rules() {
        use Fit::*;
        let ratio = promql(
            "x/ratio",
            "errors_total",
            r#"sum by (instance) (rate(errors_total{code=~"5.."}[5m])) / sum by (instance) (rate(requests_total[5m]))"#,
        );
        let k8s = sql(
            "k8s/oom",
            "logs",
            "k8s_events",
            "SELECT k8s_namespace_name, COUNT(*) AS n FROM k8s_events WHERE reason = 'OOMKilling' GROUP BY k8s_namespace_name",
        );
        let stopped = sql(
            "ci/stopped",
            "logs",
            "ci_logs",
            "SELECT COUNT(*) AS n FROM ci_logs",
        );
        let one_field = sql(
            "x/one",
            "logs",
            "default",
            "SELECT COUNT(*) AS n FROM \"default\" WHERE level = 'error'",
        );
        let metrics = &["errors_total", "requests_total"];
        let logs = StreamType::Logs;
        let cases: Vec<Case> = vec![
            // a ratio is offered on its denominator too, labels decide the confidence
            (
                &ratio,
                facts(
                    StreamType::Metrics,
                    "requests_total",
                    &["code", "instance"],
                    true,
                    metrics,
                ),
                Some((Fits, false, vec![])),
            ),
            (
                &ratio,
                facts(
                    StreamType::Metrics,
                    "errors_total",
                    &["code"],
                    true,
                    metrics,
                ),
                Some((Likely, false, vec!["instance"])),
            ),
            // a hard label or the other metric missing drops it
            (
                &ratio,
                facts(
                    StreamType::Metrics,
                    "errors_total",
                    &["instance"],
                    true,
                    metrics,
                ),
                None,
            ),
            (
                &ratio,
                facts(
                    StreamType::Metrics,
                    "errors_total",
                    &["code", "instance"],
                    true,
                    &["errors_total"],
                ),
                None,
            ),
            (
                &ratio,
                facts(
                    StreamType::Metrics,
                    "other_total",
                    &["code", "instance"],
                    true,
                    metrics,
                ),
                None,
            ),
            // same name, other name by fields (two fields = fits), stale = likely
            (
                &k8s,
                facts(
                    logs,
                    "k8s_events",
                    &["k8s_namespace_name", "reason"],
                    true,
                    &[],
                ),
                Some((Fits, false, vec![])),
            ),
            (
                &k8s,
                facts(
                    logs,
                    "cluster_events",
                    &["k8s_namespace_name", "reason", "x"],
                    true,
                    &[],
                ),
                Some((Fits, true, vec![])),
            ),
            (
                &k8s,
                facts(
                    logs,
                    "cluster_events",
                    &["k8s_namespace_name", "reason"],
                    false,
                    &[],
                ),
                Some((Likely, true, vec![])),
            ),
            (
                &k8s,
                facts(logs, "k8s_events", &["reason"], true, &[]),
                None,
            ),
            (
                &k8s,
                facts(
                    StreamType::Traces,
                    "k8s_events",
                    &["k8s_namespace_name", "reason"],
                    true,
                    &[],
                ),
                None,
            ),
            // a field-less query only fits its own stream; a one-field swap is likely
            (
                &stopped,
                facts(logs, "ci_logs", &[], true, &[]),
                Some((Fits, false, vec![])),
            ),
            (
                &stopped,
                facts(logs, "app_logs", &["level"], true, &[]),
                None,
            ),
            (
                &one_field,
                facts(logs, "app_logs", &["level"], true, &[]),
                Some((Likely, true, vec![])),
            ),
        ];
        for (i, (entry, facts, expected)) in cases.into_iter().enumerate() {
            let got = match_entry(entry, &facts).map(|m| (m.fit, m.swap, m.missing));
            let expected = expected
                .map(|(f, s, m)| (f, s, m.into_iter().map(String::from).collect::<Vec<_>>()));
            assert_eq!(got, expected, "case {i}");
        }
    }

    #[test]
    fn query_keys_ignore_layout_and_the_stream_identifier() {
        let a = query_key(
            "SELECT count(*)  FROM \"k8s_events\"\n WHERE reason = 'x'",
            Some("k8s_events"),
        );
        let b = query_key(
            "select COUNT(*) from app_logs where reason = 'x'",
            Some("app_logs"),
        );
        assert_eq!(a, b);
        assert_eq!(
            replace_relation(
                "select a from x join x_y on 1=1 join \"x\" where from_x = 1",
                "x",
                "z"
            ),
            "select a from z join x_y on 1=1 join \"z\" where from_x = 1"
        );
    }
}
