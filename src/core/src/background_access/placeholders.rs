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

use std::{
    collections::{BTreeSet, HashMap},
    sync::LazyLock,
};

use config::meta::stream::StreamType;
use regex::Regex;

use crate::authz::{QuerySource, ResolvedSources, resolve_query_sources};

const SENTINEL_PREFIX: &str = "o2ph_";

/// The forms the UI fills: `{{name[:fmt]}}`, `${name[:fmt]}` and `$name`, built-ins included.
static PLACEHOLDER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\{\{\s*([A-Za-z0-9_-]+)\s*(?::\s*[A-Za-z]+\s*)?\}\}|\$\{\s*([A-Za-z0-9_-]+)\s*(?::\s*[A-Za-z]+\s*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)",
    )
    .expect("placeholder regex")
});

static SENTINEL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"o2ph_(\d+)").expect("sentinel regex"));

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueryLanguage {
    Sql,
    PromQl,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Substituted {
    pub text: String,
    /// `(sentinel, variable name)`.
    pub sentinels: Vec<(String, String)>,
}

impl Substituted {
    fn variables_in(&self, name: &str) -> Vec<String> {
        SENTINEL
            .captures_iter(name)
            .filter_map(|caps| caps[1].parse::<usize>().ok())
            .filter_map(|idx| self.sentinels.get(idx).map(|(_, var)| var.clone()))
            .collect()
    }
}

/// Sentinel per placeholder; `1m` in a PromQL duration; `0` unquoted when `numeric_fallback`.
pub fn neutral_substitute(text: &str, lang: QueryLanguage, numeric_fallback: bool) -> Substituted {
    substitute(text, lang, numeric_fallback, &HashMap::new())
}

pub fn panel_query_sources(
    org_id: &str,
    text: &str,
    lang: QueryLanguage,
    default_type: StreamType,
    values: &HashMap<String, String>,
) -> Vec<QuerySource> {
    if text.trim().is_empty() {
        return Vec::new();
    }
    let make = |text: String| match lang {
        QueryLanguage::Sql => QuerySource::Sql {
            org_id: org_id.to_string(),
            sql: text,
            default_type,
        },
        QueryLanguage::PromQl => QuerySource::PromQl {
            org_id: org_id.to_string(),
            query: text,
        },
    };
    let resolve = |sub: &Substituted| resolve_query_sources(&[make(sub.text.clone())]);

    let mut numeric = false;
    let mut sub = neutral_substitute(text, lang, false);
    let mut resolved = resolve(&sub);
    if !resolved.unparseable.is_empty() && lang == QueryLanguage::Sql {
        let retry = neutral_substitute(text, lang, true);
        let retried = resolve(&retry);
        if retried.unparseable.is_empty() {
            (sub, resolved, numeric) = (retry, retried, true);
        }
    }
    if !resolved.unparseable.is_empty() {
        let filled = substitute(text, lang, false, values);
        let filled_resolved = resolve(&filled);
        if !filled_resolved.unparseable.is_empty() {
            return vec![QuerySource::Unparseable {
                source: text.to_string(),
                error: "query does not parse with its variables substituted".to_string(),
            }];
        }
        (sub, resolved) = (filled, filled_resolved);
    }
    stream_position_sources(text, lang, numeric, values, &sub, &resolved, make)
}

/// The error names the first variable `values` cannot fill.
pub(crate) fn fill_stream_name(
    name: &str,
    values: &HashMap<String, String>,
) -> Result<String, String> {
    let sub = substitute(name, QueryLanguage::Sql, false, values);
    match sub.sentinels.into_iter().next() {
        Some((_, variable)) => Err(variable),
        None => Ok(sub.text),
    }
}

fn stream_position_sources(
    text: &str,
    lang: QueryLanguage,
    numeric: bool,
    values: &HashMap<String, String>,
    sub: &Substituted,
    resolved: &ResolvedSources,
    make: impl Fn(String) -> QuerySource,
) -> Vec<QuerySource> {
    let stream_vars: BTreeSet<String> = resolved
        .resource_texts
        .iter()
        .flat_map(|text| sub.variables_in(text))
        .collect();
    if stream_vars.is_empty() {
        return vec![make(sub.text.clone())];
    }
    let missing: Vec<&String> = stream_vars
        .iter()
        .filter(|var| !values.contains_key(*var))
        .collect();
    if missing.is_empty() {
        let fill: HashMap<String, String> = stream_vars
            .iter()
            .filter_map(|var| values.get(var).map(|v| (var.clone(), v.clone())))
            .collect();
        return vec![make(substitute(text, lang, numeric, &fill).text)];
    }
    let mut out: Vec<QuerySource> = resolved
        .streams
        .iter()
        .filter(|s| !SENTINEL.is_match(&s.name))
        .map(|s| QuerySource::Stream {
            org_id: s.org_id.clone(),
            stream_type: s.stream_type,
            name: s.name.clone(),
        })
        .collect();
    out.extend(missing.into_iter().map(|var| QuerySource::Unparseable {
        source: text.to_string(),
        error: format!("unresolved variable {var} in stream position"),
    }));
    out
}

fn substitute(
    text: &str,
    lang: QueryLanguage,
    numeric_fallback: bool,
    values: &HashMap<String, String>,
) -> Substituted {
    let mut out = String::with_capacity(text.len());
    let mut sentinels = Vec::new();
    let mut last = 0;
    for caps in PLACEHOLDER.captures_iter(text) {
        let Some(whole) = caps.get(0) else {
            continue;
        };
        let Some(name) = caps.get(1).or_else(|| caps.get(2)).or_else(|| caps.get(3)) else {
            continue;
        };
        let name = name.as_str();
        let prefix = &text[..whole.start()];
        out.push_str(&text[last..whole.start()]);
        if let Some(value) = values.get(name) {
            out.push_str(value);
        } else if lang == QueryLanguage::PromQl && !in_quotes(prefix) && in_promql_duration(prefix)
        {
            out.push_str("1m");
        } else if numeric_fallback && !in_quotes(prefix) {
            out.push('0');
        } else {
            let sentinel = format!("{SENTINEL_PREFIX}{}", sentinels.len());
            out.push_str(&sentinel);
            sentinels.push((sentinel, name.to_string()));
        }
        last = whole.end();
    }
    out.push_str(&text[last..]);
    Substituted {
        text: out,
        sentinels,
    }
}

fn in_quotes(prefix: &str) -> bool {
    let (mut single, mut double) = (false, false);
    for c in prefix.chars() {
        match c {
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            _ => {}
        }
    }
    single || double
}

/// A range, a subquery step and an offset take a duration, where an identifier will not parse.
fn in_promql_duration(prefix: &str) -> bool {
    let trimmed = prefix.trim_end();
    if trimmed.ends_with('[') {
        return true;
    }
    if trimmed.ends_with(':') {
        return trimmed.rfind('[') > trimmed.rfind(']');
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.strip_suffix("offset").is_some_and(|before| {
        !before
            .chars()
            .next_back()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authz::{Denial, TypedStream};

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn streams_of(sources: &[QuerySource]) -> Vec<String> {
        resolve_query_sources(sources)
            .streams
            .iter()
            .map(|s| format!("{}/{}", s.stream_type, s.name))
            .collect()
    }

    #[test]
    fn every_ui_placeholder_form_is_replaced() {
        let sub = neutral_substitute(
            "SELECT * FROM app WHERE a = '$a' AND b IN (${b}) AND c IN (${c:csv}) AND d = '{{d}}' AND e IN ({{ e : pipe }}) AND f = '${__interval}' AND g = $__range_s",
            QueryLanguage::Sql,
            false,
        );
        assert!(
            !sub.text.contains('$') && !sub.text.contains("{{"),
            "{}",
            sub.text
        );
        let names: Vec<&str> = sub.sentinels.iter().map(|(_, n)| n.as_str()).collect();
        assert_eq!(
            names,
            vec!["a", "b", "c", "d", "e", "__interval", "__range_s"]
        );
    }

    #[test]
    fn numeric_fallback_replaces_only_unquoted_placeholders() {
        let sub = neutral_substitute(
            "SELECT * FROM app WHERE a = '$a' LIMIT $n",
            QueryLanguage::Sql,
            true,
        );
        assert_eq!(sub.text, "SELECT * FROM app WHERE a = 'o2ph_0' LIMIT 0");
    }

    #[test]
    fn promql_durations_become_one_minute() {
        let sub = neutral_substitute(
            r#"rate(http_total{job="$job"}[$__rate_interval]) offset $off + max_over_time(up[5m:${step}])"#,
            QueryLanguage::PromQl,
            false,
        );
        assert_eq!(
            sub.text,
            r#"rate(http_total{job="o2ph_0"}[1m]) offset 1m + max_over_time(up[5m:1m])"#
        );
    }

    #[test]
    fn ordinary_variables_do_not_deny_a_sql_panel() {
        let sources = panel_query_sources(
            "o1",
            "SELECT histogram(_timestamp, '$__interval') AS t, count(*) FROM app WHERE host = '$host' AND code IN (${codes:singlequote}) GROUP BY t",
            QueryLanguage::Sql,
            StreamType::Logs,
            &HashMap::new(),
        );
        let resolved = resolve_query_sources(&sources);
        assert!(resolved.unparseable.is_empty(), "{resolved:?}");
        assert_eq!(streams_of(&sources), vec!["logs/app"]);
    }

    #[test]
    fn ordinary_variables_do_not_deny_a_promql_panel() {
        let sources = panel_query_sources(
            "o1",
            r#"sum by (pod) (rate(http_requests_total{namespace="$ns"}[$__interval]))"#,
            QueryLanguage::PromQl,
            StreamType::Metrics,
            &HashMap::new(),
        );
        assert_eq!(streams_of(&sources), vec!["metrics/http_requests_total"]);
    }

    #[test]
    fn stream_position_variable_takes_the_report_or_default_value() {
        let sources = panel_query_sources(
            "o1",
            r#"SELECT count(*) FROM "$stream" WHERE a = '$a'"#,
            QueryLanguage::Sql,
            StreamType::Logs,
            &values(&[("stream", "orders")]),
        );
        assert_eq!(streams_of(&sources), vec!["logs/orders"]);

        let metric = panel_query_sources(
            "o1",
            r#"sum(${metric}{job="x"})"#,
            QueryLanguage::PromQl,
            StreamType::Metrics,
            &values(&[("metric", "cpu_usage")]),
        );
        assert_eq!(streams_of(&metric), vec!["metrics/cpu_usage"]);
    }

    #[test]
    fn stream_position_variable_without_value_is_unparseable() {
        let sources = panel_query_sources(
            "o1",
            r#"SELECT * FROM "$stream" JOIN other ON true"#,
            QueryLanguage::Sql,
            StreamType::Logs,
            &HashMap::new(),
        );
        let resolved = resolve_query_sources(&sources);
        assert_eq!(
            resolved.streams,
            vec![TypedStream {
                org_id: "o1".to_string(),
                stream_type: StreamType::Logs,
                name: "other".to_string(),
            }]
        );
        assert!(matches!(
            resolved.unparseable.as_slice(),
            [Denial::Unparseable { error, .. }] if error == "unresolved variable stream in stream position"
        ));
    }

    #[test]
    fn text_that_never_parses_is_unparseable() {
        let sources = panel_query_sources(
            "o1",
            "SELEC broken FROM",
            QueryLanguage::Sql,
            StreamType::Logs,
            &HashMap::new(),
        );
        assert_eq!(resolve_query_sources(&sources).unparseable.len(), 1);
        assert!(
            panel_query_sources(
                "o1",
                "  ",
                QueryLanguage::Sql,
                StreamType::Logs,
                &HashMap::new()
            )
            .is_empty()
        );
    }

    #[test]
    fn stream_type_prefix_variable_takes_its_value() {
        let sources = panel_query_sources(
            "o1",
            r#"SELECT * FROM "${kind}".secret WHERE a = '$a'"#,
            QueryLanguage::Sql,
            StreamType::Logs,
            &values(&[("kind", "metrics")]),
        );
        assert_eq!(streams_of(&sources), vec!["metrics/secret"]);
    }

    #[test]
    fn stream_type_prefix_variable_without_value_is_unparseable() {
        let sources = panel_query_sources(
            "o1",
            r#"SELECT * FROM "${kind}".secret"#,
            QueryLanguage::Sql,
            StreamType::Logs,
            &HashMap::new(),
        );
        let resolved = resolve_query_sources(&sources);
        assert!(
            resolved.unparseable.iter().any(|d| matches!(
                d,
                Denial::Unparseable { error, .. } if error == "unresolved variable kind in stream position"
            )),
            "{resolved:?}"
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn cipher_key_variable_takes_its_value() {
        let sources = panel_query_sources(
            "o1",
            "SELECT decrypt(payload, '$key') FROM app WHERE a = '$a'",
            QueryLanguage::Sql,
            StreamType::Logs,
            &values(&[("key", "vault_key")]),
        );
        let resolved = resolve_query_sources(&sources);
        assert_eq!(
            resolved.cipher_keys,
            vec![("o1".to_string(), "vault_key".to_string())]
        );
        assert_eq!(streams_of(&sources), vec!["logs/app"]);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn cipher_key_variable_without_value_is_unparseable() {
        let sources = panel_query_sources(
            "o1",
            "SELECT decrypt(payload, '$key') FROM app",
            QueryLanguage::Sql,
            StreamType::Logs,
            &HashMap::new(),
        );
        let resolved = resolve_query_sources(&sources);
        assert!(resolved.cipher_keys.is_empty(), "{resolved:?}");
        assert!(
            resolved.unparseable.iter().any(|d| matches!(
                d,
                Denial::Unparseable { error, .. } if error == "unresolved variable key in stream position"
            )),
            "{resolved:?}"
        );
    }
}
