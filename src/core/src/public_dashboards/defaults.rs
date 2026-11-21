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

use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
};

use config::{
    meta::{
        dashboards::{
            Dashboard,
            v8::{FilterCondition, Filters, GroupType, PanelFilter, QueryData, VariableList},
        },
        stream::StreamType,
    },
    utils::sql::quote_identifier,
};
use regex::{Captures, Regex};
use serde_json::Value;

use super::variables::{
    DateSpec, SELECT_ALL_VALUE, escape, js_string, normalize_syntax, placeholder_regex,
};

/// The picker's page size when the variable sets none.
const DEFAULT_VALUES_SIZE: i64 = 10;
/// `CUSTOM_VALUE`: the suffix a typed-in value carries, dropped before it fills a query.
const CUSTOM_VALUE_SUFFIX: &str = "::_o2_custom";

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
            key: self.instances[idx].key.clone(),
            depends_on: self.dependencies(idx),
            query: self.values_query(idx),
        })
    }

    /// The first non-blank value in the picker's order, as the live picker selects on first load.
    pub fn settle(&mut self, pending: Pending, keys: Option<Vec<String>>) {
        let inst = &self.instances[pending.idx];
        let mut keys = keys
            .unwrap_or_default()
            .into_iter()
            .filter(|k| !k.is_empty());
        // A custom query lists options in row order and the picker takes the first; values SQL
        // sorts.
        let first = if pending.query.custom {
            keys.next()
        } else {
            keys.min_by(|a, b| locale_cmp(a, b))
        };
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

    /// Whether any value waits for a values query.
    #[cfg(feature = "enterprise")]
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// The values queries `from` reaches through their stream, field and filter references.
    #[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
    pub fn reachable_queries(
        &self,
        from: &BTreeSet<String>,
    ) -> (BTreeSet<String>, Vec<ValuesQuery>) {
        let mut reached = from.clone();
        let mut queries = Vec::new();
        let mut left = self.pending.clone();
        // Each instance joins at most once, so a cycle ends the walk instead of looping it.
        loop {
            let before = left.len();
            left.retain(|&idx| {
                let key = &self.instances[idx].key;
                let hit = reached.contains(key)
                    || self.dependencies(idx).iter().any(|k| reached.contains(k));
                if hit {
                    reached.insert(key.clone());
                    queries.push(self.values_query(idx));
                }
                !hit
            });
            if left.len() == before {
                return (reached, queries);
            }
        }
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
        let texts = [qd.stream.as_str(), qd.field.as_str()]
            .into_iter()
            .chain(qd.query.as_deref())
            .chain(
                qd.filter
                    .iter()
                    .flatten()
                    .flat_map(|f| [f.name.as_deref().unwrap_or_default(), f.value.as_str()]),
            )
            .chain(qd.filter_group.iter().flat_map(group_texts));
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
        self.visible_instances(idx)
            .into_iter()
            .map(|(name, o)| (name, o.key.clone()))
            .collect()
    }

    /// The instance behind each visible name.
    fn visible_instances(&self, idx: usize) -> BTreeMap<String, &Instance<'a>> {
        let me = &self.instances[idx];
        self.instances
            .iter()
            .filter(|o| o.var.type_field != "dynamic_filters")
            .filter(|o| match (&o.tab, &o.panel) {
                (None, None) => true,
                (Some(tab), None) => me.tab.as_ref() == Some(tab),
                (_, Some(panel)) => me.panel.as_ref() == Some(panel),
            })
            .map(|o| (o.var.name.clone(), o))
            .collect()
    }

    /// `buildQueryContext` plus the server's values SQL, or the custom SQL, for one instance.
    fn values_query(&self, idx: usize) -> ValuesQuery {
        let var = self.instances[idx].var;
        let qd = var.query_data.clone().unwrap_or_default();
        let visible = self.visible_instances(idx);
        let scope: BTreeMap<String, Value> = visible
            .iter()
            .filter_map(|(name, o)| self.values.get(&o.key).map(|v| (name.clone(), v.clone())))
            .collect();
        let dates: BTreeMap<String, DateSpec> = visible
            .iter()
            .filter_map(|(name, o)| Some((name.clone(), DateSpec::of(o.var)?)))
            .collect();
        let stream = resolve_name(&qd.stream, &scope);
        let size = qd
            .max_record_size
            .filter(|s| *s != 0)
            .unwrap_or(DEFAULT_VALUES_SIZE);
        if let Some(query) = custom_sql(&qd) {
            return ValuesQuery {
                stream_type: qd.stream_type,
                stream,
                sql: substitute_query(query, &scope),
                size,
                custom: true,
                value_field: qd.value_field.clone(),
            };
        }
        let field = resolve_name(&qd.field, &scope);
        let conditions = match &qd.filter_group {
            Some(group) => group_where(group, &scope),
            None => qd
                .filter
                .iter()
                .flatten()
                .map(|f| flat_condition(f, &scope))
                .collect::<Vec<_>>()
                .join(" AND "),
        };
        let filter = if conditions.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", substitute_context(&conditions, &scope, &dates))
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
            custom: false,
            value_field: None,
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
    /// The frozen-value key this query fills.
    pub key: String,
    /// Keys whose values the query text was built from.
    pub depends_on: Vec<String>,
    pub query: ValuesQuery,
}

/// The distinct values of one field, as the picker fetches them for a query_values variable.
pub struct ValuesQuery {
    pub stream_type: StreamType,
    pub stream: String,
    pub sql: String,
    pub size: i64,
    /// A custom SQL query: options are one result column in row order, not `zo_sql_key`.
    pub custom: bool,
    pub value_field: Option<String>,
}

impl ValuesQuery {
    /// `mapSqlRowsToOptions`: the saved value column, else the first not starting with `_`.
    pub fn value_column<'c>(&'c self, columns: &'c [String]) -> Option<&'c str> {
        if !self.custom {
            return Some("zo_sql_key");
        }
        let saved = self.value_field.as_deref();
        saved
            .filter(|field| columns.iter().any(|c| c == field))
            .or_else(|| {
                columns
                    .iter()
                    .find(|c| !c.starts_with('_'))
                    .or(columns.first())
                    .map(String::as_str)
            })
    }
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
                // The server runs no PromQL picker lookups, so such a variable starts empty, not
                // failed.
                _ if var.query_data.as_ref().is_some_and(is_custom_promql) => Some(empty(var)),
                _ => None,
            }
        }
        _ => Some(empty(var)),
    }
}

fn custom_query(qd: &QueryData) -> Option<&str> {
    qd.query.as_deref().filter(|q| !q.trim().is_empty())
}

fn is_custom_promql(qd: &QueryData) -> bool {
    custom_query(qd).is_some() && qd.query_type.as_deref() == Some("promql")
}

fn custom_sql(qd: &QueryData) -> Option<&str> {
    custom_query(qd).filter(|_| !is_custom_promql(qd))
}

/// One flat `filter` row, `= $list` written as IN like the live picker's `expandMultiValueFilter`.
fn flat_condition(f: &Filters, scope: &BTreeMap<String, Value>) -> String {
    let op = f.operator.as_deref().unwrap_or_default();
    let value = f.value.as_str();
    condition(
        f.name.as_deref().unwrap_or_default(),
        expand_operator(op, value, scope),
        value,
    )
}

/// `labelGroupWhere`: rows joined left to right as written, each nested group in parentheses.
fn group_where(group: &GroupType, scope: &BTreeMap<String, Value>) -> String {
    let mut out = String::new();
    for node in &group.conditions {
        let (sql, connector) = match node {
            PanelFilter::Group(inner) => {
                let sql = group_where(inner, scope);
                (
                    (!sql.is_empty()).then(|| format!("({sql})")),
                    &inner.logical_operator,
                )
            }
            PanelFilter::Condition(leaf) => (leaf_condition(leaf, scope), &leaf.logical_operator),
        };
        let Some(sql) = sql else {
            continue;
        };
        if !out.is_empty() {
            out.push_str(if connector == "OR" { " OR " } else { " AND " });
        }
        out.push_str(&sql);
    }
    out
}

/// `leafToRow`: a list leaf is IN over its values; a leaf without an operator is skipped.
fn leaf_condition(leaf: &FilterCondition, scope: &BTreeMap<String, Value>) -> Option<String> {
    let col = leaf
        .column
        .as_ref()
        .and_then(|c| c.field.as_deref())
        .unwrap_or_default();
    if leaf.typ == "list" {
        return (!leaf.values.is_empty()).then(|| in_list(col, "IN", &leaf.values));
    }
    let op = leaf.operator.as_deref()?;
    let value = leaf.value.as_deref().unwrap_or_default();
    Some(condition(col, expand_operator(op, value, scope), value))
}

/// The column and value texts of a group, for the dependency scan.
fn group_texts(group: &GroupType) -> Vec<&str> {
    group
        .conditions
        .iter()
        .flat_map(|node| match node {
            PanelFilter::Group(inner) => group_texts(inner),
            PanelFilter::Condition(leaf) => leaf
                .column
                .as_ref()
                .and_then(|c| c.field.as_deref())
                .into_iter()
                .chain(leaf.value.as_deref())
                .chain(leaf.values.iter().map(String::as_str))
                .collect(),
        })
        .collect()
}

/// `expandMultiValueFilter`: `= $list` and `!= $list` become IN and NOT IN.
fn expand_operator<'o>(op: &'o str, value: &str, scope: &BTreeMap<String, Value>) -> &'o str {
    static SINGLE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r"^'?(?:\$\{\s*([a-zA-Z0-9_-]+)\s*\}|\$([a-zA-Z0-9_-]+)|\{\{\s*([a-zA-Z0-9_-]+)\s*\}\})'?$",
        )
        .unwrap()
    });
    let negated = op == "!=" || op == "<>";
    if op != "=" && !negated {
        return op;
    }
    let name = SINGLE.captures(value.trim()).and_then(|c| {
        c.get(1)
            .or_else(|| c.get(2))
            .or_else(|| c.get(3))
            .map(|m| m.as_str())
    });
    match name.and_then(|name| scope.get(name)) {
        Some(Value::Array(_)) if negated => "NOT IN",
        Some(Value::Array(_)) => "IN",
        _ => op,
    }
}

/// `addLabelToSQlQuery`: one filter as the WHERE condition the picker's SQL parser writes.
fn condition(col: &str, op: &str, value: &str) -> String {
    let quoted_col = quote_identifier(col);
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
        "IN" | "NOT IN" => in_list(col, op, &split_quoted(value)),
        "=" | "<>" | "!=" | "<" | ">" | "<=" | ">=" => {
            format!("{quoted_col} {op} '{}'", escape(unquote(value)))
        }
        // The live helper writes an unknown operator through without escaping the value.
        _ => format!("{quoted_col} {op} '{value}'"),
    }
}

fn in_list(col: &str, op: &str, items: &[String]) -> String {
    let items = items
        .iter()
        .map(|v| format!("'{}'", escape(v)))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{} {op} ({items})", quote_identifier(col))
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

/// `buildQueryContext`'s replacement: lists quoted per item unless the placeholder is quoted, and a
/// date in its format.
fn substitute_context(
    text: &str,
    scope: &BTreeMap<String, Value>,
    dates: &BTreeMap<String, DateSpec>,
) -> String {
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
        let format = c.get(2).or_else(|| c.get(4)).map(|m| m.as_str());
        let date = scope
            .get(name)
            .zip(dates.get(name))
            .and_then(|(v, spec)| spec.format(v, format));
        if let Some(date) = date {
            return escape(&date);
        }
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

/// `substituteQueryVariables` for SQL: a custom query's `$var` filled as the live loader fills it.
fn substitute_query(text: &str, scope: &BTreeMap<String, Value>) -> String {
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
        let format = c.get(2).or_else(|| c.get(4)).map(|m| m.as_str());
        let value = scope.get(name);
        let text_of = |v: &Value| {
            let text = js_string(v);
            text.strip_suffix(CUSTOM_VALUE_SUFFIX)
                .map_or(text.clone(), str::to_string)
        };
        let values: Vec<String> = match value {
            Some(Value::Array(items)) => {
                items.iter().filter(|v| !v.is_null()).map(text_of).collect()
            }
            Some(Value::Null) | None => vec![],
            Some(v) => vec![text_of(v)],
        };
        if values.is_empty() {
            return whole.as_str().to_string();
        }
        sql_values(
            &values,
            matches!(value, Some(Value::Array(_))),
            quoted,
            format,
        )
    })
    .into_owned()
}

/// `formatSqlValues`: a format joins the values its way; a list is quoted unless `'$var'` is.
fn sql_values(values: &[String], list: bool, quoted: bool, format: Option<&str>) -> String {
    let escaped: Vec<String> = values.iter().map(|v| escape(v)).collect();
    let wrap = |items: &[String], mark: &str, sep: &str| {
        items
            .iter()
            .map(|v| format!("{mark}{v}{mark}"))
            .collect::<Vec<_>>()
            .join(sep)
    };
    match format {
        Some("csv") => values.join(","),
        Some("pipe") => values.join("|"),
        Some("doublequote") => wrap(values, "\"", ","),
        Some("singlequote") => wrap(&escaped, "'", ","),
        _ if !list => escaped[0].clone(),
        _ if quoted => escaped.join("', '"),
        _ => wrap(&escaped, "'", ", "),
    }
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
    fn a_changed_value_reaches_every_values_query_built_from_it_through_a_cycle() {
        let dash = dashboard(json!([
            { "type": "custom", "name": "a", "value": "x" },
            { "type": "query_values", "name": "b", "query_data": { "stream": "s_$a", "field": "b" } },
            { "type": "query_values", "name": "c", "query_data": { "stream": "s", "field": "c",
                "filter": [ { "name": "b", "operator": "=", "value": "$b" },
                            { "name": "d", "operator": "=", "value": "$d" } ] } },
            { "type": "query_values", "name": "d", "query_data": { "stream": "s", "field": "d",
                "filter": [ { "name": "c", "operator": "=", "value": "$c" } ] } },
            { "type": "query_values", "name": "e", "query_data": { "stream": "other", "field": "e" } },
            { "type": "query_values", "name": "f", "query_data": { "stream": "s", "field": "f",
                "filter": [ { "name": "b", "operator": "=", "value": "$b" } ] } }
        ]));
        let frozen = BTreeMap::from([
            ("a".to_string(), json!("new")),
            ("f".to_string(), json!("v")),
        ]);
        let d = Defaults::new(&dash, frozen);
        let (reached, queries) = d.reachable_queries(&BTreeSet::from(["a".to_string()]));
        assert_eq!(
            reached,
            BTreeSet::from(["a", "b", "c", "d"].map(String::from)),
            "a frozen f stops the walk and e reads nothing changed"
        );
        let streams: Vec<&str> = queries.iter().map(|q| q.stream.as_str()).collect();
        assert_eq!(streams, ["s_new", "s", "s"]);
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
                flat_condition(&filter("k8s_ns", op, value), &BTreeMap::new()),
                want,
                "{op} {value}"
            );
        }
    }

    #[test]
    fn a_custom_sql_variable_runs_its_own_query_and_takes_its_first_row() {
        let dash = dashboard(json!([
            { "type": "custom", "name": "env", "multiSelect": true, "options": [
                { "label": "a", "value": "prod" }, { "label": "b", "value": "o'k" }
            ] },
            { "type": "query_values", "name": "svc", "query_data": {
                "stream_type": "logs", "stream": "", "field": "",
                "query": "SELECT svc, name FROM logs WHERE env IN ($env) OR tier = '$env'",
                "value_field": "svc" } }
        ]));
        let frozen = BTreeMap::from([("env".to_string(), json!(["prod", "o'k"]))]);
        let mut d = Defaults::new(&dash, frozen);
        let svc = d.next_query().expect("custom query");
        assert_eq!(svc.depends_on, vec!["env".to_string()]);
        assert_eq!(
            svc.query.sql,
            "SELECT svc, name FROM logs WHERE env IN ('prod', 'o''k') OR tier = 'prod', 'o''k'"
        );
        assert!(svc.query.custom);
        let columns = [
            "_timestamp".to_string(),
            "name".to_string(),
            "svc".to_string(),
        ];
        assert_eq!(svc.query.value_column(&columns), Some("svc"));
        d.settle(svc, Some(vec!["".into(), "zeta".into(), "alpha".into()]));
        assert_eq!(d.into_values()["svc"], json!("zeta"));
    }

    #[test]
    fn a_custom_query_value_column_falls_back_past_internal_columns() {
        let q = |value_field: Option<&str>| ValuesQuery {
            stream_type: StreamType::Logs,
            stream: String::new(),
            sql: String::new(),
            size: 10,
            custom: true,
            value_field: value_field.map(str::to_string),
        };
        let columns = ["_timestamp".to_string(), "svc".to_string()];
        assert_eq!(q(None).value_column(&columns), Some("svc"));
        assert_eq!(q(Some("gone")).value_column(&columns), Some("svc"));
        assert_eq!(q(None).value_column(&columns[..1]), Some("_timestamp"));
        assert_eq!(q(None).value_column(&[]), None);
        let auto = ValuesQuery {
            custom: false,
            ..q(Some("svc"))
        };
        assert_eq!(auto.value_column(&columns), Some("zo_sql_key"));
    }

    #[test]
    fn a_custom_promql_variable_starts_empty_without_a_values_query() {
        let dash = dashboard(json!([
            { "type": "query_values", "name": "ns", "query_data": { "stream_type": "metrics",
                "stream": "", "field": "", "query_type": "promql",
                "query": "label_values(up, namespace)" } },
            { "type": "query_values", "name": "nsm", "multiSelect": true, "query_data": {
                "stream_type": "metrics", "stream": "", "field": "", "query_type": "promql",
                "query": "label_values(up, namespace)" } },
            { "type": "query_values", "name": "job", "query_data": { "stream_type": "metrics",
                "stream": "up", "field": "job", "query_type": "promql" } }
        ]));
        let mut d = Defaults::new(&dash, BTreeMap::new());
        let job = d
            .next_query()
            .expect("auto PromQL still reads the metric stream");
        assert_eq!(
            job.query.sql,
            r#"SELECT "job" AS zo_sql_key FROM "up" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC LIMIT 10"#
        );
        d.settle(job, Some(vec!["kubelet".into()]));
        assert!(d.next_query().is_none());
        let values = d.into_values();
        assert_eq!(values["ns"], Value::Null);
        assert_eq!(values["nsm"], json!([]));
    }

    #[test]
    fn a_filter_group_writes_its_or_tree_and_waits_for_the_variables_it_names() {
        let leaf = |field: &str, op: &str, value: &str, connector: &str| {
            json!({ "type": "condition", "filterType": "condition", "column": { "field": field },
                "operator": op, "value": value, "values": [], "logicalOperator": connector })
        };
        let group = json!({ "filterType": "group", "logicalOperator": "AND", "conditions": [
            leaf("level", "=", "error", "AND"),
            { "filterType": "group", "logicalOperator": "AND", "conditions": [
                leaf("cluster", "=", "$cl", "AND"),
                leaf("ns", "!=", "$cl", "OR"),
                { "type": "list", "filterType": "condition", "column": { "field": "zone" },
                  "operator": null, "value": null, "values": ["a", "b'c"], "logicalOperator": "OR" },
                leaf("skipped", "", "", "OR")
            ] },
            leaf("pod", "=", "$one", "OR")
        ] });
        let mut skipped = group.clone();
        skipped["conditions"][1]["conditions"][3]["operator"] = Value::Null;
        let dash = dashboard(json!([
            { "type": "custom", "name": "cl", "multiSelect": true, "options": [
                { "label": "x", "value": "x", "selected": true },
                { "label": "y", "value": "y", "selected": true }
            ] },
            { "type": "query_values", "name": "one", "query_data": { "stream": "s", "field": "one" } },
            { "type": "query_values", "name": "svc", "query_data": { "stream": "s",
                "field": "svc", "filter_group": skipped } }
        ]));
        let mut d = Defaults::new(&dash, BTreeMap::new());
        let one = d
            .next_query()
            .expect("the parent named only inside the group runs first");
        assert_eq!(one.key, "one");
        d.settle(one, Some(vec!["p1".into()]));
        let svc = d.next_query().expect("then the grouped variable");
        assert_eq!(svc.depends_on, vec!["cl".to_string(), "one".to_string()]);
        assert_eq!(
            svc.query.sql,
            concat!(
                r#"SELECT "svc" AS zo_sql_key FROM "s" WHERE "level" = 'error' AND "#,
                r#"("cluster" IN ('x', 'y') OR "ns" NOT IN ('x', 'y') OR "zone" IN ('a', 'b''c')) "#,
                r#"OR "pod" = 'p1' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC LIMIT 10"#
            )
        );
    }

    #[test]
    fn a_flat_equals_on_a_multi_select_parent_becomes_in() {
        let dash = dashboard(json!([
            { "type": "custom", "name": "cl", "multiSelect": true, "options": [
                { "label": "x", "value": "x", "selected": true },
                { "label": "y", "value": "y", "selected": true }
            ] },
            { "type": "query_values", "name": "ns", "query_data": { "stream": "s", "field": "ns",
                "filter": [ { "name": "cluster", "operator": "=", "value": "$cl" },
                            { "name": "region", "operator": "<>", "value": "'${cl}'" } ] } }
        ]));
        let mut d = Defaults::new(&dash, BTreeMap::new());
        let ns = d.next_query().unwrap();
        assert!(
            ns.query
                .sql
                .contains(r#"WHERE "cluster" IN ('x', 'y') AND "region" NOT IN ('x', 'y')"#),
            "{}",
            ns.query.sql
        );
    }

    #[test]
    fn custom_query_substitution_matches_the_live_loader() {
        let scope = BTreeMap::from([
            ("s".to_string(), json!("O'B::_o2_custom")),
            ("l".to_string(), json!(["p", "q'r", null])),
            ("e".to_string(), json!([])),
            ("n".to_string(), Value::Null),
        ]);
        let cases = [
            ("x = '$s'", "x = 'O''B'"),
            ("x IN ($l)", "x IN ('p', 'q''r')"),
            ("x IN ('$l')", "x IN ('p', 'q''r')"),
            ("${l:csv} ${l:pipe}", "p,q'r p|q'r"),
            ("${l:doublequote}", r#""p","q'r""#),
            ("{{l:singlequote}}", "'p','q''r'"),
            ("x IN ($e) AND y = $n", "x IN ($e) AND y = $n"),
            ("$missing", "$missing"),
        ];
        for (text, want) in cases {
            assert_eq!(substitute_query(text, &scope), want, "{text}");
        }
    }

    #[test]
    fn context_substitution_matches_the_live_picker() {
        let none = BTreeMap::new();
        let scope = BTreeMap::from([
            ("x".to_string(), json!("O'B")),
            ("y".to_string(), json!(["p", "q'r"])),
            ("z".to_string(), Value::Null),
        ]);
        assert_eq!(
            substitute_context(
                r#""a" = '$x' AND "b" IN ('$y') AND "c" != 'z'"#,
                &scope,
                &none
            ),
            r#""a" = 'O''B' AND "b" IN ('p', 'q''r') AND "c" != 'z'"#
        );
        assert_eq!(
            substitute_context(
                "a = '$y' AND b IN ($y) AND c = '${x}' AND d = '{{z}}' AND e = $x",
                &scope,
                &none
            ),
            "a = 'p', 'q''r' AND b IN ('p', 'q''r') AND c = 'O''B' AND d = '{{z}}' AND e = O''B"
        );
    }

    #[test]
    fn a_date_variable_reaches_a_values_query_in_its_format() {
        let dash = dashboard(json!([
            { "type": "date", "name": "day", "dateFormat": "epochus" },
            { "type": "query_values", "name": "pod",
              "query_data": { "stream": "logs", "field": "pod", "filter": [
                { "name": "_timestamp", "operator": ">=", "value": "$day" },
                { "name": "d", "operator": "=", "value": "${day:dmy}" } ] } }
        ]));
        let frozen = BTreeMap::from([("day".to_string(), json!("2026-07-01"))]);
        let mut d = Defaults::new(&dash, frozen);
        let pod = d.next_query().expect("pod");
        assert_eq!(
            pod.query.sql,
            r#"SELECT "pod" AS zo_sql_key FROM "logs" WHERE "_timestamp" >= '1782864000000000' AND "d" = '01/07/2026' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC LIMIT 10"#
        );
    }

    #[test]
    fn context_substitution_prints_a_date_in_its_format() {
        let spec = |format: &str| {
            DateSpec::of(&VariableList {
                type_field: "date".to_string(),
                date_format: Some(format.to_string()),
                ..Default::default()
            })
            .unwrap()
        };
        let scope = BTreeMap::from([
            ("d".to_string(), json!("2026-07-01")),
            ("e".to_string(), json!("")),
        ]);
        let dates = BTreeMap::from([
            ("d".to_string(), spec("epochus")),
            ("e".to_string(), spec("dmy")),
        ]);
        assert_eq!(
            substitute_context("a >= $d AND b = '${d:iso}' AND c = '$e'", &scope, &dates),
            "a >= 1782864000000000 AND b = '2026-07-01' AND c = ''"
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
