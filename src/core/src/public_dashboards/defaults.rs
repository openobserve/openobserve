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

//! Values a link never froze, picked the way the live dashboard picks a variable's value on load.

use std::{cmp::Ordering, collections::BTreeMap};

use config::{
    meta::{
        dashboards::{
            Dashboard,
            v8::{Filters, VariableList},
        },
        stream::StreamType,
    },
    utils::sql::quote_identifier,
};
use regex::{Captures, Regex};
use serde_json::Value;

use super::variables::{SELECT_ALL_VALUE, escape, js_string, normalize_syntax, placeholder_regex};

/// The picker's page size when the variable sets none.
const DEFAULT_VALUES_SIZE: i64 = 10;

/// A link's values, with each missing scope instance filled in as its dependencies resolve.
pub struct Defaults<'a> {
    instances: Vec<Instance<'a>>,
    values: BTreeMap<String, Value>,
    /// Instances whose value comes from a values query, in dashboard order.
    pending: Vec<usize>,
}

impl<'a> Defaults<'a> {
    /// Frozen values win; a missing one takes its configured default, or waits for a values query.
    pub fn new(dash: &'a Dashboard, frozen: BTreeMap<String, Value>) -> Self {
        let instances = instances(dash);
        let mut values = frozen;
        let mut pending = Vec::new();
        for (idx, inst) in instances.iter().enumerate() {
            if values.contains_key(&inst.key) {
                continue;
            }
            match configured_default(inst.var) {
                Some(value) => {
                    values.insert(inst.key.clone(), value);
                }
                None => pending.push(idx),
            }
        }
        Self {
            instances,
            values,
            pending,
        }
    }

    /// The next values query whose variables are all resolved; a cycle resolves to empty.
    pub fn next_query(&mut self) -> Option<Pending> {
        let ready = self.pending.iter().position(|&idx| {
            self.dependencies(idx)
                .iter()
                .all(|key| !self.is_pending(key))
        });
        let Some(pos) = ready else {
            for idx in std::mem::take(&mut self.pending) {
                let inst = &self.instances[idx];
                self.values.insert(inst.key.clone(), empty(inst.var));
            }
            return None;
        };
        let idx = self.pending.remove(pos);
        Some(Pending {
            idx,
            query: self.values_query(idx),
        })
    }

    /// The first non-blank value in the picker's order, as the live picker selects on first load.
    pub fn settle(&mut self, pending: Pending, keys: Option<Vec<String>>) {
        let inst = &self.instances[pending.idx];
        let first = keys
            .unwrap_or_default()
            .into_iter()
            .filter(|k| !k.is_empty())
            .min_by(|a, b| locale_cmp(a, b));
        let value = match first {
            Some(v) if is_multi(inst.var) => Value::Array(vec![Value::String(v)]),
            Some(v) => Value::String(v),
            None => empty(inst.var),
        };
        self.values.insert(inst.key.clone(), value);
    }

    pub fn into_values(self) -> BTreeMap<String, Value> {
        self.values
    }

    fn is_pending(&self, key: &str) -> bool {
        self.pending
            .iter()
            .any(|&idx| self.instances[idx].key == key)
    }

    /// Keys of the visible variables this instance's stream, field or filters name.
    fn dependencies(&self, idx: usize) -> Vec<String> {
        let Some(qd) = self.instances[idx].var.query_data.as_ref() else {
            return vec![];
        };
        let visible = self.visible(idx);
        let names: Vec<&str> = visible.keys().map(String::as_str).collect();
        let Some(re) = name_regex(&names) else {
            return vec![];
        };
        let texts = [qd.stream.as_str(), qd.field.as_str()].into_iter().chain(
            qd.filter
                .iter()
                .flatten()
                .flat_map(|f| [f.name.as_deref().unwrap_or_default(), f.value.as_str()]),
        );
        let mut keys: Vec<String> = texts
            .flat_map(|t| re.captures_iter(t).collect::<Vec<_>>())
            .filter_map(|c| {
                let name = c.get(1).or_else(|| c.get(2)).or_else(|| c.get(3))?;
                visible.get(name.as_str()).cloned()
            })
            .collect();
        keys.sort();
        keys.dedup();
        keys
    }

    /// Visible variable name → key, global then tab then panel, as the instance's picker sees them.
    fn visible(&self, idx: usize) -> BTreeMap<String, String> {
        let me = &self.instances[idx];
        self.instances
            .iter()
            .filter(|o| o.var.type_field != "dynamic_filters")
            .filter(|o| match (&o.tab, &o.panel) {
                (None, None) => true,
                (Some(tab), None) => me.tab.as_ref() == Some(tab),
                (_, Some(panel)) => me.panel.as_ref() == Some(panel),
            })
            .map(|o| (o.var.name.clone(), o.key.clone()))
            .collect()
    }

    /// `buildQueryContext` plus the server's values SQL, for one instance in its scope.
    fn values_query(&self, idx: usize) -> ValuesQuery {
        let var = self.instances[idx].var;
        let qd = var.query_data.clone().unwrap_or_default();
        let scope: BTreeMap<String, Value> = self
            .visible(idx)
            .into_iter()
            .filter_map(|(name, key)| self.values.get(&key).map(|v| (name, v.clone())))
            .collect();
        let stream = resolve_name(&qd.stream, &scope);
        let field = resolve_name(&qd.field, &scope);
        let conditions = qd
            .filter
            .iter()
            .flatten()
            .map(condition)
            .collect::<Vec<_>>()
            .join(" AND ");
        let size = qd
            .max_record_size
            .filter(|s| *s != 0)
            .unwrap_or(DEFAULT_VALUES_SIZE);
        let filter = if conditions.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", substitute_context(&conditions, &scope))
        };
        let sql = format!(
            "SELECT {} AS zo_sql_key FROM {}{filter} GROUP BY zo_sql_key ORDER BY zo_sql_key ASC LIMIT {size}",
            quote_identifier(&field),
            quote_identifier(&stream),
        );
        ValuesQuery {
            stream_type: qd.stream_type,
            stream,
            sql,
            size,
        }
    }
}

/// One variable at one scope, keyed as the link stores its value.
struct Instance<'a> {
    var: &'a VariableList,
    key: String,
    tab: Option<String>,
    panel: Option<String>,
}

/// A values query handed out by [`Defaults::next_query`], to give back to [`Defaults::settle`].
pub struct Pending {
    idx: usize,
    pub query: ValuesQuery,
}

/// The distinct values of one field, as the picker fetches them for a query_values variable.
pub struct ValuesQuery {
    pub stream_type: StreamType,
    pub stream: String,
    pub sql: String,
    pub size: i64,
}

/// Every scope instance of every variable; a panel instance also knows its panel's tab.
fn instances(dash: &Dashboard) -> Vec<Instance<'_>> {
    let Some(v8) = dash.v8.as_ref() else {
        return vec![];
    };
    let panel_tab: BTreeMap<&str, &str> = v8
        .tabs
        .iter()
        .flat_map(|t| {
            t.panels
                .iter()
                .map(move |p| (p.id.as_str(), t.tab_id.as_str()))
        })
        .collect();
    let Some(list) = v8.variables.as_ref() else {
        return vec![];
    };
    list.list
        .iter()
        .filter(|v| v.type_field != "dynamic_filters")
        .flat_map(|var| match var.scope.as_deref() {
            Some("tabs") => var
                .tabs
                .iter()
                .flatten()
                .map(|t| Instance {
                    var,
                    key: format!("{}.t.{t}", var.name),
                    tab: Some(t.clone()),
                    panel: None,
                })
                .collect::<Vec<_>>(),
            Some("panels") => var
                .panels
                .iter()
                .flatten()
                .map(|p| Instance {
                    var,
                    key: format!("{}.p.{p}", var.name),
                    tab: panel_tab.get(p.as_str()).map(|t| t.to_string()),
                    panel: Some(p.clone()),
                })
                .collect(),
            _ => vec![Instance {
                var,
                key: var.name.clone(),
                tab: None,
                panel: None,
            }],
        })
        .collect()
}

fn is_multi(var: &VariableList) -> bool {
    var.multi_select == Some(true)
}

fn empty(var: &VariableList) -> Value {
    if is_multi(var) {
        Value::Array(vec![])
    } else {
        Value::Null
    }
}

/// The value the live page settles on without a query, or None when the picker must fetch.
fn configured_default(var: &VariableList) -> Option<Value> {
    let multi = is_multi(var);
    let list = |items: Vec<String>| Value::Array(items.into_iter().map(Value::String).collect());
    if let Some(value) = var.value.as_ref().filter(|v| !v.is_empty()) {
        // A multi-select custom picker reads a single saved value as a one-item selection.
        return Some(if multi && var.type_field == "custom" {
            list(vec![value.clone()])
        } else {
            Value::String(value.clone())
        });
    }
    match var.type_field.as_str() {
        "custom" => {
            let options = var.options.as_deref().unwrap_or_default();
            let marked: Vec<String> = options
                .iter()
                .filter(|o| o.selected == Some(true))
                .map(|o| o.value.clone())
                .collect();
            let picked = if marked.is_empty() {
                options.first().map(|o| vec![o.value.clone()])
            } else {
                Some(marked)
            };
            Some(match picked {
                Some(items) if multi => list(items),
                Some(items) => Value::String(items[0].clone()),
                None => empty(var),
            })
        }
        "query_values" => {
            let custom = var
                .custom_multi_select_value
                .as_ref()
                .filter(|c| !c.is_empty());
            match (var.select_all_value_for_multi_select.as_deref(), custom) {
                (Some("custom"), Some(items)) if multi => Some(list(items.clone())),
                (Some("custom"), Some(items)) => Some(Value::String(items[0].clone())),
                (Some("all"), _) if multi => Some(list(vec![SELECT_ALL_VALUE.to_string()])),
                (Some("all"), _) => Some(Value::String(SELECT_ALL_VALUE.to_string())),
                _ => None,
            }
        }
        _ => Some(empty(var)),
    }
}

/// `addLabelToSQlQuery`: one filter as the WHERE condition the picker's SQL parser writes.
fn condition(f: &Filters) -> String {
    let col = f.name.as_deref().unwrap_or_default();
    let op = f.operator.as_deref().unwrap_or_default();
    let quoted_col = quote_identifier(col);
    let value = f.value.as_str();
    match op {
        "match_all" => format!("match_all({})", format_value(value)),
        "str_match" | "Contains" => format!("str_match({col}, {})", format_value(value)),
        "str_match_ignore_case" => {
            format!("str_match_ignore_case({col}, {})", format_value(value))
        }
        "re_match" => format!("re_match({col}, {})", format_value(value)),
        "re_not_match" => format!("re_not_match({col}, {})", format_value(value)),
        "Not Contains" => format!("{quoted_col} NOT LIKE '%{}%'", escape(value)),
        "Starts With" => format!("{quoted_col} LIKE '{}%'", escape(value)),
        "Ends With" => format!("{quoted_col} LIKE '%{}'", escape(value)),
        "Is Null" => format!("{quoted_col} IS NULL"),
        "Is Not Null" => format!("{quoted_col} IS NOT NULL"),
        "IN" | "NOT IN" => {
            let items = split_quoted(value)
                .iter()
                .map(|v| format!("'{}'", escape(v)))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{quoted_col} {op} ({items})")
        }
        "=" | "<>" | "!=" | "<" | ">" | "<=" | ">=" => {
            format!("{quoted_col} {op} '{}'", escape(unquote(value)))
        }
        // The live helper writes an unknown operator through without escaping the value.
        _ => format!("{quoted_col} {op} '{value}'"),
    }
}

/// `formatValue`: drop one pair of surrounding single quotes, escape, re-quote.
fn format_value(value: &str) -> String {
    format!("'{}'", escape(unquote(value)))
}

fn unquote(value: &str) -> &str {
    if value.len() > 1 && value.starts_with('\'') && value.ends_with('\'') {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

/// `splitQuotedString`: the items of `a,b` or `('a','b')`, trimmed, empties dropped.
fn split_quoted(input: &str) -> Vec<String> {
    static ITEM: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r#"'([^']*?)'|"([^"]*?)"|([^,()]+)"#).unwrap());
    ITEM.captures_iter(input.trim())
        .filter_map(|c| c.get(1).or_else(|| c.get(2)).or_else(|| c.get(3)))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// `buildQueryContext`'s replacement: lists quoted per item unless the placeholder is quoted.
fn substitute_context(text: &str, scope: &BTreeMap<String, Value>) -> String {
    let text = normalize_syntax(text);
    let mut names: Vec<&str> = scope.keys().map(String::as_str).collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));
    let Some(re) = placeholder_regex(&names) else {
        return text;
    };
    re.replace_all(&text, |c: &Captures| {
        let whole = c.get(0).expect("match");
        let name = c
            .get(1)
            .or_else(|| c.get(3))
            .or_else(|| c.get(5))
            .map_or("", |m| m.as_str());
        let quoted = text[..whole.start()].ends_with('\'') && text[whole.end()..].starts_with('\'');
        match scope.get(name) {
            Some(Value::Array(items)) => {
                let items: Vec<String> = items.iter().map(|v| escape(&js_string(v))).collect();
                if quoted {
                    items.join("', '")
                } else {
                    items
                        .iter()
                        .map(|v| format!("'{v}'"))
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            }
            Some(Value::Null) | None => whole.as_str().to_string(),
            Some(v) => escape(&js_string(v)),
        }
    })
    .into_owned()
}

/// `resolveVariableValue` for a stream or field name: a list gives its first item, null nothing.
fn resolve_name(text: &str, scope: &BTreeMap<String, Value>) -> String {
    static NAME: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r"\$\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*[a-zA-Z]+\s*)?\}|\$([a-zA-Z0-9_-]+)|\{\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*[a-zA-Z]+\s*)?\}\}",
        )
        .unwrap()
    });
    NAME.replace_all(text, |c: &Captures| {
        let name = c
            .get(1)
            .or_else(|| c.get(2))
            .or_else(|| c.get(3))
            .map_or("", |m| m.as_str());
        match scope.get(name) {
            None => c[0].to_string(),
            Some(Value::Null) => String::new(),
            Some(Value::Array(items)) => items.first().map(js_string).unwrap_or_default(),
            Some(v) => js_string(v),
        }
    })
    .into_owned()
}

/// Names as `resolveVariableValue` and the dependency graph find them in a picker's config.
fn name_regex(names: &[&str]) -> Option<Regex> {
    if names.is_empty() {
        return None;
    }
    let mut names = names.to_vec();
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));
    let alt = names
        .iter()
        .map(|n| regex::escape(n))
        .collect::<Vec<_>>()
        .join("|");
    Regex::new(&format!(
        r"\{{\{{\s*({alt})\s*(?::\s*[a-zA-Z]+\s*)?\}}\}}|\$\{{\s*({alt})\s*(?::\s*[a-zA-Z]+\s*)?\}}|\$({alt})"
    ))
    .ok()
}

/// `localeCompare` approximated: symbols, digits, then letters ignoring case, lower case first.
fn locale_cmp(a: &str, b: &str) -> Ordering {
    let key = |s: &str| -> Vec<(u8, String)> {
        s.chars()
            .map(|c| {
                let class = if c.is_numeric() {
                    1
                } else if c.is_alphabetic() {
                    2
                } else {
                    0
                };
                (class, c.to_lowercase().collect())
            })
            .collect()
    };
    let case = |s: &str| -> Vec<bool> { s.chars().map(char::is_uppercase).collect() };
    key(a)
        .cmp(&key(b))
        .then_with(|| case(a).cmp(&case(b)))
        .then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn dashboard(variables: Value) -> Dashboard {
        Dashboard {
            v8: Some(
                serde_json::from_value(json!({
                    "tabs": [
                        { "tabId": "t1", "name": "One", "panels": [ {
                            "id": "p1", "type": "bar", "title": "", "description": "",
                            "config": { "show_legends": false, "legends_position": null },
                            "queries": []
                        } ] },
                        { "tabId": "t2", "name": "Two", "panels": [] }
                    ],
                    "variables": { "list": variables }
                }))
                .unwrap(),
            ),
            ..Default::default()
        }
    }

    fn filter(name: &str, operator: &str, value: &str) -> Filters {
        Filters {
            name: Some(name.to_string()),
            operator: Some(operator.to_string()),
            value: value.to_string(),
        }
    }

    #[test]
    fn frozen_values_win_and_missing_ones_take_their_configured_default() {
        let dash = dashboard(json!([
            { "type": "custom", "name": "env", "options": [
                { "label": "a", "value": "a" }, { "label": "b", "value": "b", "selected": true }
            ] },
            { "type": "custom", "name": "first", "multiSelect": true, "options": [
                { "label": "x", "value": "x" }, { "label": "y", "value": "y" }
            ] },
            { "type": "constant", "name": "c", "value": "k" },
            { "type": "textbox", "name": "tb" },
            { "type": "textbox", "name": "tbm", "multiSelect": true },
            { "type": "query_values", "name": "all", "multiSelect": true,
              "selectAllValueForMultiSelect": "all", "query_data": { "stream": "s", "field": "f" } },
            { "type": "query_values", "name": "pick", "selectAllValueForMultiSelect": "custom",
              "customMultiSelectValue": ["v1", "v2"], "query_data": { "stream": "s", "field": "f" } },
            { "type": "custom", "name": "svc", "scope": "tabs", "tabs": ["t1", "t2"], "options": [
                { "label": "api", "value": "api" }
            ] }
        ]));
        let frozen = BTreeMap::from([
            ("env".to_string(), json!("frozen")),
            ("svc.t.t1".to_string(), json!("web")),
        ]);
        let mut d = Defaults::new(&dash, frozen);
        assert!(d.next_query().is_none());
        assert_eq!(
            d.into_values(),
            BTreeMap::from([
                ("env".to_string(), json!("frozen")),
                ("first".to_string(), json!(["x"])),
                ("c".to_string(), json!("k")),
                ("tb".to_string(), Value::Null),
                ("tbm".to_string(), json!([])),
                ("all".to_string(), json!(["_o2_all_"])),
                ("pick".to_string(), json!("v1")),
                ("svc.t.t1".to_string(), json!("web")),
                ("svc.t.t2".to_string(), json!("api")),
            ])
        );
    }

    #[test]
    fn a_values_query_waits_for_its_parent_and_reads_it_in_scope() {
        let dash = dashboard(json!([
            { "type": "query_values", "name": "pod", "scope": "panels", "panels": ["p1"],
              "multiSelect": true,
              "query_data": { "stream": "logs", "field": "pod", "max_record_size": 5,
                "filter": [ { "name": "ns", "operator": "=", "value": "$ns" } ] } },
            { "type": "query_values", "name": "ns", "scope": "tabs", "tabs": ["t1"],
              "query_data": { "stream": "logs", "field": "ns" } }
        ]));
        let mut d = Defaults::new(&dash, BTreeMap::new());
        let ns = d.next_query().expect("parent first");
        assert_eq!(
            ns.query.sql,
            r#"SELECT "ns" AS zo_sql_key FROM "logs" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC LIMIT 10"#
        );
        d.settle(
            ns,
            Some(vec![
                "Zeta".into(),
                "".into(),
                "alpha".into(),
                "Beta".into(),
            ]),
        );
        let pod = d.next_query().expect("then the child");
        assert_eq!(
            pod.query.sql,
            r#"SELECT "pod" AS zo_sql_key FROM "logs" WHERE "ns" = 'alpha' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC LIMIT 5"#
        );
        d.settle(pod, Some(vec![]));
        assert!(d.next_query().is_none());
        let values = d.into_values();
        assert_eq!(values["ns.t.t1"], json!("alpha"));
        assert_eq!(values["pod.p.p1"], json!([]));
    }

    #[test]
    fn a_failed_values_query_leaves_the_variable_empty_and_its_child_unresolved() {
        let dash = dashboard(json!([
            { "type": "query_values", "name": "a", "query_data": { "stream": "s", "field": "a" } },
            { "type": "query_values", "name": "b", "query_data": { "stream": "s", "field": "b",
                "filter": [ { "name": "a", "operator": "IN", "value": "$a" } ] } }
        ]));
        let mut d = Defaults::new(&dash, BTreeMap::new());
        let a = d.next_query().unwrap();
        d.settle(a, None);
        let b = d.next_query().unwrap();
        assert!(
            b.query.sql.contains(r#"WHERE "a" IN ('$a')"#),
            "{}",
            b.query.sql
        );
    }

    #[test]
    fn a_dependency_cycle_resolves_to_empty() {
        let dash = dashboard(json!([
            { "type": "query_values", "name": "a", "query_data": { "stream": "s", "field": "a",
                "filter": [ { "name": "b", "operator": "=", "value": "$b" } ] } },
            { "type": "query_values", "name": "b", "multiSelect": true,
              "query_data": { "stream": "s", "field": "b",
                "filter": [ { "name": "a", "operator": "=", "value": "$a" } ] } }
        ]));
        let mut d = Defaults::new(&dash, BTreeMap::new());
        assert!(d.next_query().is_none());
        let values = d.into_values();
        assert_eq!(values["a"], Value::Null);
        assert_eq!(values["b"], json!([]));
    }

    #[test]
    fn conditions_match_the_live_sql_helper() {
        let cases = [
            ("=", "$ns", r#""k8s_ns" = '$ns'"#),
            ("=", "'$ns'", r#""k8s_ns" = '$ns'"#),
            ("!=", "O'Brien", r#""k8s_ns" != 'O''Brien'"#),
            ("<>", "a,b", r#""k8s_ns" <> 'a,b'"#),
            (">=", "('x','y')", r#""k8s_ns" >= '(''x'',''y'')'"#),
            ("IN", "$ns", r#""k8s_ns" IN ('$ns')"#),
            ("IN", "a,b", r#""k8s_ns" IN ('a', 'b')"#),
            ("NOT IN", "('x','y')", r#""k8s_ns" NOT IN ('x', 'y')"#),
            ("IN", "O'Brien", r#""k8s_ns" IN ('O''Brien')"#),
            ("Contains", "'$ns'", "str_match(k8s_ns, '$ns')"),
            (
                "str_match_ignore_case",
                "O'Brien",
                "str_match_ignore_case(k8s_ns, 'O''Brien')",
            ),
            ("re_not_match", "a,b", "re_not_match(k8s_ns, 'a,b')"),
            ("match_all", "('x','y')", "match_all('(''x'',''y'')')"),
            ("Not Contains", "'$ns'", r#""k8s_ns" NOT LIKE '%''$ns''%'"#),
            ("Starts With", "O'Brien", r#""k8s_ns" LIKE 'O''Brien%'"#),
            ("Ends With", "'$ns'", r#""k8s_ns" LIKE '%''$ns'''"#),
            ("Is Null", "x", r#""k8s_ns" IS NULL"#),
            ("Is Not Null", "x", r#""k8s_ns" IS NOT NULL"#),
        ];
        for (op, value, want) in cases {
            assert_eq!(
                condition(&filter("k8s_ns", op, value)),
                want,
                "{op} {value}"
            );
        }
    }

    #[test]
    fn context_substitution_matches_the_live_picker() {
        let scope = BTreeMap::from([
            ("x".to_string(), json!("O'B")),
            ("y".to_string(), json!(["p", "q'r"])),
            ("z".to_string(), Value::Null),
        ]);
        assert_eq!(
            substitute_context(r#""a" = '$x' AND "b" IN ('$y') AND "c" != 'z'"#, &scope),
            r#""a" = 'O''B' AND "b" IN ('p', 'q''r') AND "c" != 'z'"#
        );
        assert_eq!(
            substitute_context(
                "a = '$y' AND b IN ($y) AND c = '${x}' AND d = '{{z}}' AND e = $x",
                &scope
            ),
            "a = 'p', 'q''r' AND b IN ('p', 'q''r') AND c = 'O''B' AND d = '{{z}}' AND e = O''B"
        );
    }

    #[test]
    fn stream_and_field_names_take_a_list_s_first_item() {
        let scope = BTreeMap::from([
            ("s".to_string(), json!(["one", "two"])),
            ("n".to_string(), Value::Null),
        ]);
        assert_eq!(resolve_name("${s}_logs", &scope), "one_logs");
        assert_eq!(resolve_name("x$n", &scope), "x");
        assert_eq!(resolve_name("$other", &scope), "$other");
    }

    #[test]
    fn locale_order_puts_symbols_then_digits_then_letters_ignoring_case() {
        let mut v = vec!["b", "B", "a", "10", "9", "_x", "Apple"];
        v.sort_by(|a, b| locale_cmp(a, b));
        assert_eq!(v, vec!["_x", "10", "9", "a", "Apple", "b", "B"]);
    }
}
