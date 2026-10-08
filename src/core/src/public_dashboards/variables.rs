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

//! Variable substitution ported from the live panel loader, so public snapshots run the same SQL.

use std::collections::BTreeMap;

use config::meta::dashboards::Dashboard;
use regex::{Captures, Regex};

const VARIABLE_FORMATS: &str = "csv|pipe|doublequote|singlequote";
/// What an unset or empty value becomes; the server reads a filter on it as "all".
pub(super) const SELECT_ALL_VALUE: &str = "_o2_all_";
const MIN_PERCENTILE_SAMPLES: f64 = 20.0;
/// The live panel divides the range by its pixel width and falls back to this without one.
const PANEL_WIDTH_PX: f64 = 1000.0;
const DEFAULT_SCRAPE_SECS: f64 = 15.0;

/// A link's frozen values and the dashboard's variables, resolved per panel by scope.
pub struct QueryVars {
    vars: Vec<ScopedVar>,
    frozen: BTreeMap<String, serde_json::Value>,
    scrape_secs: f64,
}

impl QueryVars {
    /// Only the dashboard's own variables are substituted; dynamic filters never apply publicly.
    pub fn new(
        dash: &Dashboard,
        frozen: BTreeMap<String, serde_json::Value>,
        scrape_secs: Option<f64>,
    ) -> Self {
        let vars = dash
            .v8
            .as_ref()
            .and_then(|v8| v8.variables.as_ref())
            .map(|vars| {
                vars.list
                    .iter()
                    .filter(|v| v.type_field != "dynamic_filters")
                    .map(ScopedVar::from)
                    .collect()
            })
            .unwrap_or_default();
        Self {
            vars,
            frozen,
            scrape_secs: scrape_secs.unwrap_or(DEFAULT_SCRAPE_SECS),
        }
    }

    /// The values one panel sees: each variable's global, tab or panel value, as its scope says.
    pub fn for_panel(&self, tab_id: &str, panel_id: &str) -> PanelVars {
        let values = self
            .vars
            .iter()
            .filter_map(|var| {
                let key = var.key_for(tab_id, panel_id)?;
                let value = self.frozen.get(&key)?;
                Some((var.name.clone(), value.clone()))
            })
            .collect();
        PanelVars {
            values,
            scrape_secs: self.scrape_secs,
        }
    }
}

/// A dashboard variable and where it applies.
struct ScopedVar {
    name: String,
    scope: Scope,
}

impl ScopedVar {
    /// The frozen-value key for this panel, in the dashboard URL's form, or None out of scope.
    fn key_for(&self, tab_id: &str, panel_id: &str) -> Option<String> {
        match &self.scope {
            Scope::Global => Some(self.name.clone()),
            Scope::Tabs(tabs) if tabs.iter().any(|t| t == tab_id) => {
                Some(format!("{}.t.{tab_id}", self.name))
            }
            Scope::Panels(panels) if panels.iter().any(|p| p == panel_id) => {
                Some(format!("{}.p.{panel_id}", self.name))
            }
            _ => None,
        }
    }
}

impl From<&config::meta::dashboards::v8::VariableList> for ScopedVar {
    fn from(v: &config::meta::dashboards::v8::VariableList) -> Self {
        let scope = match v.scope.as_deref() {
            Some("tabs") => Scope::Tabs(v.tabs.clone().unwrap_or_default()),
            Some("panels") => Scope::Panels(v.panels.clone().unwrap_or_default()),
            _ => Scope::Global,
        };
        Self {
            name: v.name.clone(),
            scope,
        }
    }
}

enum Scope {
    Global,
    Tabs(Vec<String>),
    Panels(Vec<String>),
}

/// One panel's variable values plus the inputs of `$__interval` and kin.
pub struct PanelVars {
    values: BTreeMap<String, serde_json::Value>,
    scrape_secs: f64,
}

impl PanelVars {
    /// The query text with every fixed and dashboard variable replaced for this window.
    pub fn substitute(&self, query: &str, query_type: &str, start: i64, end: i64) -> String {
        let fixed = fixed_vars(start, end, self.scrape_secs);
        let mut names: Vec<&str> = fixed
            .keys()
            .map(String::as_str)
            .chain(self.values.keys().map(String::as_str))
            .collect();
        names.sort_unstable();
        names.dedup();
        // Longest first: the alternation takes the first branch that matches.
        names.sort_by_key(|n| std::cmp::Reverse(n.len()));
        let query = normalize_syntax(query);
        let Some(re) = placeholder_regex(&names) else {
            return query;
        };
        re.replace_all(&query, |caps: &Captures| {
            let name = caps
                .get(1)
                .or_else(|| caps.get(3))
                .or_else(|| caps.get(5))
                .map_or("", |m| m.as_str());
            let format = caps.get(2).or_else(|| caps.get(4)).map(|m| m.as_str());
            if let Some(value) = fixed.get(name) {
                // A format on a fixed variable is not something the live panel resolves.
                return if format.is_some() {
                    caps[0].to_string()
                } else {
                    value.clone()
                };
            }
            self.values.get(name).map_or_else(
                || caps[0].to_string(),
                |v| format_value(v, format, query_type),
            )
        })
        .into_owned()
    }
}

pub(super) fn placeholder_regex(names: &[&str]) -> Option<Regex> {
    if names.is_empty() {
        return None;
    }
    let alt = names
        .iter()
        .map(|n| regex::escape(n))
        .collect::<Vec<_>>()
        .join("|");
    let format = format!(r"(?::\s*({VARIABLE_FORMATS})\s*)?");
    Regex::new(&format!(
        r"\{{\{{\s*({alt})\s*{format}\}}\}}|\$\{{\s*({alt})\s*{format}\}}|\$({alt})"
    ))
    .ok()
}

/// `{{ v : csv }}` → `{{v:csv}}` and `${ v }` → `${v}`, as the live loader does first.
pub(super) fn normalize_syntax(query: &str) -> String {
    static MUSTACHE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"\{\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*([a-zA-Z]+)\s*)?\}\}").unwrap()
    });
    static BRACED: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"\$\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*([a-zA-Z]+)\s*)?\}").unwrap()
    });
    let rebuild = |caps: &Captures, open: &str, close: &str| match caps.get(2) {
        Some(f) => format!("{open}{}:{}{close}", &caps[1], f.as_str()),
        None => format!("{open}{}{close}", &caps[1]),
    };
    let out = MUSTACHE.replace_all(query, |c: &Captures| rebuild(c, "{{", "}}"));
    BRACED
        .replace_all(&out, |c: &Captures| rebuild(c, "${", "}"))
        .into_owned()
}

/// `formatPanelVariableValue`: scalars escaped, lists by format (SQL quoted, else `a|b`).
fn format_value(value: &serde_json::Value, format: Option<&str>, query_type: &str) -> String {
    let serde_json::Value::Array(list) = value else {
        return match value {
            serde_json::Value::Null => SELECT_ALL_VALUE.to_string(),
            other => escape(&js_string(other)),
        };
    };
    let all = [serde_json::Value::String(SELECT_ALL_VALUE.to_string())];
    let values: &[serde_json::Value] = if list.is_empty() { &all } else { list };
    let single_quoted = || {
        values
            .iter()
            .map(|v| format!("'{}'", escape(&js_string(v))))
            .collect::<Vec<_>>()
            .join(",")
    };
    match format {
        Some("csv") => js_join(values, ","),
        Some("pipe") => js_join(values, "|"),
        Some("doublequote") => values
            .iter()
            .map(|v| format!("\"{}\"", js_string(v)))
            .collect::<Vec<_>>()
            .join(","),
        Some("singlequote") => single_quoted(),
        _ if query_type == "sql" => single_quoted(),
        _ => js_join(values, "|"),
    }
}

pub(super) fn escape(s: &str) -> String {
    s.replace('\'', "''")
}

/// JavaScript's `String(value)` for a JSON value.
pub(super) fn js_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Array(items) => js_join(items, ","),
        serde_json::Value::Object(_) => "[object Object]".to_string(),
        other => other.to_string(),
    }
}

/// JavaScript's `Array.prototype.join`, which writes null as an empty string.
fn js_join(values: &[serde_json::Value], sep: &str) -> String {
    values
        .iter()
        .map(|v| match v {
            serde_json::Value::Null => String::new(),
            other => js_string(other),
        })
        .collect::<Vec<_>>()
        .join(sep)
}

/// The `$__interval` family, computed as the live panel does for a `PANEL_WIDTH_PX` wide chart.
fn fixed_vars(start: i64, end: i64, scrape: f64) -> BTreeMap<String, String> {
    let range_micros = (end - start) as f64;
    let (value, unit) = format_interval(range_micros / PANEL_WIDTH_PX / 1000.0);
    let interval_secs = seconds_in_unit(value, unit);
    let rate = (interval_secs + scrape).max(4.0 * scrape);
    let range_secs = range_micros / 1_000_000.0;
    let cappable = if range_secs.is_finite() {
        range_secs.max(0.0)
    } else {
        0.0
    };
    let percentile = rate
        .max(MIN_PERCENTILE_SAMPLES * scrape)
        .min(rate.max(cappable / 4.0));
    let range = match format_rate_interval(range_secs) {
        s if s.is_empty() => "1s".to_string(),
        s => s,
    };
    BTreeMap::from([
        (
            "__interval_ms".to_string(),
            format!("{}ms", interval_secs * 1000.0),
        ),
        ("__interval".to_string(), format!("{value}{unit}")),
        ("__rate_interval".to_string(), format_rate_interval(rate)),
        (
            "__percentile_interval".to_string(),
            format_rate_interval(percentile),
        ),
        ("__range".to_string(), range),
        (
            "__range_s".to_string(),
            (range_secs.floor() as i64).to_string(),
        ),
        (
            "__range_ms".to_string(),
            ((range_secs * 1000.0).floor() as i64).to_string(),
        ),
    ])
}

/// `formatInterval`: milliseconds per pixel rounded to a readable step.
fn format_interval(ms: f64) -> (f64, &'static str) {
    const STEPS: [(f64, f64, &str); 31] = [
        (10.0, 1.0, "ms"),
        (15.0, 10.0, "ms"),
        (35.0, 20.0, "ms"),
        (75.0, 50.0, "ms"),
        (150.0, 100.0, "ms"),
        (350.0, 200.0, "ms"),
        (750.0, 500.0, "ms"),
        (1_500.0, 1.0, "s"),
        (3_500.0, 2.0, "s"),
        (7_500.0, 5.0, "s"),
        (12_500.0, 10.0, "s"),
        (17_500.0, 15.0, "s"),
        (25_000.0, 20.0, "s"),
        (45_000.0, 30.0, "s"),
        (90_000.0, 1.0, "m"),
        (210_000.0, 2.0, "m"),
        (450_000.0, 5.0, "m"),
        (750_000.0, 10.0, "m"),
        (1_050_000.0, 15.0, "m"),
        (1_500_000.0, 20.0, "m"),
        (2_700_000.0, 30.0, "m"),
        (5_400_000.0, 1.0, "h"),
        (9_000_000.0, 2.0, "h"),
        (16_200_000.0, 3.0, "h"),
        (32_400_000.0, 6.0, "h"),
        (86_400_000.0, 12.0, "h"),
        (172_800_000.0, 24.0, "h"),
        (604_800_000.0, 24.0, "h"),
        (1_814_400_000.0, 1.0, "w"),
        // The live code's last bound is exclusive.
        (3_628_799_999.999, 30.0, "d"),
        (f64::INFINITY, 1.0, "y"),
    ];
    STEPS
        .iter()
        .find(|(max, ..)| ms <= *max)
        .map_or((1.0, "y"), |(_, value, unit)| (*value, *unit))
}

/// `getTimeInSecondsBasedOnUnit`, including its year of 12 weeks.
fn seconds_in_unit(value: f64, unit: &str) -> f64 {
    match unit {
        "ms" => value / 1000.0,
        "m" => value * 60.0,
        "h" => value * 3600.0,
        "d" => value * 86_400.0,
        "w" => value * 604_800.0,
        "y" => value * 604_800.0 * 12.0,
        _ => value,
    }
}

/// `formatRateInterval`: seconds as `1d2h3m4s`, empty for zero.
fn format_rate_interval(secs: f64) -> String {
    let mut out = String::new();
    let days = (secs / 86_400.0).floor();
    if days > 0.0 {
        out.push_str(&format!("{days}d"));
    }
    let hours = ((secs % 86_400.0) / 3600.0).floor();
    if hours > 0.0 {
        out.push_str(&format!("{hours}h"));
    }
    let minutes = ((secs % 3600.0) / 60.0).floor();
    if minutes > 0.0 {
        out.push_str(&format!("{minutes}m"));
    }
    let rest = secs % 60.0;
    if rest > 0.0 {
        out.push_str(&format!("{rest}s"));
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn qv(pairs: &[(&str, serde_json::Value)]) -> PanelVars {
        PanelVars {
            values: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            scrape_secs: 15.0,
        }
    }

    const HOUR: i64 = 3_600_000_000;

    fn sub(vars: &PanelVars, q: &str, query_type: &str) -> String {
        vars.substitute(q, query_type, 0, HOUR)
    }

    #[test]
    fn each_panel_gets_its_variables_by_scope() {
        let dash = Dashboard {
            v8: Some(
                serde_json::from_value(json!({
                    "variables": {
                        "list": [
                            { "type": "custom", "name": "env" },
                            { "type": "custom", "name": "svc", "scope": "tabs", "tabs": ["t1"] },
                            { "type": "custom", "name": "pod", "scope": "panels", "panels": ["p1"] },
                            { "type": "dynamic_filters", "name": "filters" }
                        ],
                        "showDynamicFilters": true
                    }
                }))
                .unwrap(),
            ),
            ..Default::default()
        };
        let frozen = BTreeMap::from([
            ("env".to_string(), json!("prod")),
            ("svc.t.t1".to_string(), json!("api")),
            ("svc.t.t2".to_string(), json!("web")),
            ("pod.p.p1".to_string(), json!("a")),
            (
                "filters".to_string(),
                json!([{ "name": "a", "operator": "=", "value": "1" }]),
            ),
            ("stale".to_string(), json!("x")),
        ]);
        let vars = QueryVars::new(&dash, frozen, None);
        let q = "$env $svc $pod $filters $stale";
        assert_eq!(
            sub(&vars.for_panel("t1", "p1"), q, "promql"),
            "prod api a $filters $stale"
        );
        // svc is scoped to t1 only and pod to p1 only.
        assert_eq!(
            sub(&vars.for_panel("t2", "p2"), q, "promql"),
            "prod $svc $pod $filters $stale"
        );
        assert_eq!(vars.for_panel("t1", "p1").scrape_secs, 15.0);
    }

    #[test]
    fn replaces_every_syntax_including_spaced_ones() {
        let v = qv(&[("svc", json!("api"))]);
        assert_eq!(
            sub(
                &v,
                "a=$svc b=${svc} c={{svc}} d={{ svc }} e=${ svc }",
                "sql"
            ),
            "a=api b=api c=api d=api e=api"
        );
    }

    #[test]
    fn scalar_escapes_quotes_and_null_means_all() {
        let v = qv(&[("n", json!("O'Brien")), ("u", serde_json::Value::Null)]);
        assert_eq!(sub(&v, "x='$n' y='$u'", "sql"), "x='O''Brien' y='_o2_all_'");
        // A format has no effect on a scalar.
        assert_eq!(sub(&v, "${n:csv}", "sql"), "O''Brien");
        assert_eq!(sub(&qv(&[("k", json!(42))]), "$k", "sql"), "42");
    }

    #[test]
    fn lists_follow_the_format_and_query_type() {
        let v = qv(&[("h", json!(["a", "b'c"]))]);
        assert_eq!(sub(&v, "in ($h)", "sql"), "in ('a','b''c')");
        assert_eq!(sub(&v, "$h", "promql"), "a|b'c");
        assert_eq!(sub(&v, "${h:csv}", "sql"), "a,b'c");
        assert_eq!(sub(&v, "{{h:pipe}}", "sql"), "a|b'c");
        assert_eq!(sub(&v, "${h:doublequote}", "sql"), "\"a\",\"b'c\"");
        assert_eq!(sub(&v, "${h : singlequote}", "promql"), "'a','b''c'");
    }

    #[test]
    fn an_empty_list_means_all() {
        let v = qv(&[("h", json!([]))]);
        assert_eq!(sub(&v, "in ($h)", "sql"), "in ('_o2_all_')");
        assert_eq!(sub(&v, "$h", "promql"), "_o2_all_");
    }

    #[test]
    fn longest_name_wins_and_bare_names_have_no_boundary() {
        let v = qv(&[("env", json!("prod")), ("environment", json!("eu"))]);
        assert_eq!(sub(&v, "$environment $env", "sql"), "eu prod");
        // Same as the live loader: a bare `$env` also matches the start of an unknown longer name.
        assert_eq!(sub(&qv(&[("env", json!("p"))]), "$envx", "sql"), "px");
    }

    #[test]
    fn unknown_names_and_formats_stay_literal() {
        let v = qv(&[("a", json!("1"))]);
        assert_eq!(
            sub(&v, "$b ${c} {{ d }} ${a:raw}", "sql"),
            "$b ${c} {{d}} ${a:raw}"
        );
    }

    #[test]
    fn a_dollar_in_a_value_is_not_a_capture_reference() {
        assert_eq!(
            sub(&qv(&[("x", json!("a$1b"))]), "k=$x", "promql"),
            "k=a$1b"
        );
    }

    #[test]
    fn fixed_variables_apply_to_sql_and_promql_and_ignore_formats() {
        let v = qv(&[]);
        assert_eq!(sub(&v, "$__range_s ${__range_ms}", "sql"), "3600 3600000");
        assert_eq!(
            sub(&v, "rate(x[$__rate_interval])", "promql"),
            "rate(x[1m])"
        );
        assert_eq!(sub(&v, "${__range:csv}", "promql"), "${__range:csv}");
    }

    #[test]
    fn fixed_variables_match_the_live_panel_for_one_hour() {
        // 3600 s over 1000 px is 3600 ms a pixel, which rounds to 5 s.
        let m = fixed_vars(0, HOUR, 15.0);
        assert_eq!(m["__interval"], "5s");
        assert_eq!(m["__interval_ms"], "5000ms");
        assert_eq!(m["__rate_interval"], "1m");
        assert_eq!(m["__percentile_interval"], "5m");
        assert_eq!(m["__range"], "1h");
        assert_eq!(m["__range_s"], "3600");
        assert_eq!(m["__range_ms"], "3600000");
    }

    #[test]
    fn fixed_variables_for_a_week_and_a_tiny_range() {
        let week = fixed_vars(0, 7 * 24 * HOUR, 15.0);
        assert_eq!(week["__interval"], "10m");
        assert_eq!(week["__rate_interval"], "10m15s");
        assert_eq!(week["__percentile_interval"], "10m15s");
        assert_eq!(week["__range"], "7d");
        let tiny = fixed_vars(0, 0, 15.0);
        assert_eq!(tiny["__interval"], "1ms");
        assert_eq!(tiny["__interval_ms"], "1ms");
        assert_eq!(tiny["__range"], "1s");
    }

    #[test]
    fn interval_steps_and_units_match_the_live_helpers() {
        assert_eq!(format_interval(10.0), (1.0, "ms"));
        assert_eq!(format_interval(1500.0), (1.0, "s"));
        assert_eq!(format_interval(3_628_800_000.0), (1.0, "y"));
        assert_eq!(seconds_in_unit(1.0, "y"), 7_257_600.0);
        assert_eq!(format_rate_interval(90061.0), "1d1h1m1s");
        assert_eq!(format_rate_interval(0.0), "");
    }
}
