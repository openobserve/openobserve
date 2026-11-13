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

//! The digest reads of a caller short of org-wide alert read, filtered in the search SQL.

use std::{cmp::Reverse, collections::HashMap, future::Future};

use arrow_schema::Schema;
use config::{meta::search::Response as SearchResponse, utils::sql::quote_sql_string};
use infra::errors::Error as InfraError;
use openobserve_core::{
    alerts::alert_calibration::sink::DIGEST_STREAM, db_monitoring::hits_or_partial_error,
};
use serde_json::{Map, Value};

use super::digests::{Columns, MarkerColumns, RUN_COLUMNS, RunWindow, records_sql};
use crate::request::alert_grants::{AlertVisibility, Probe};

/// A full probe is judged on the whole org's alerts, so the set is never cut (P3-D3).
pub(super) const PROBE_CAP: usize = 10_000;
/// Counted over the whole org, so a scoped reader gets null for each (P3-D5).
const ORG_TOTALS: [&str; 8] = [
    "alerts_in_scope",
    "dismissed_count",
    "omitted_routine_skip_count",
    "coverage_unreadable_definitions",
    "coverage_facts_without_definition",
    "coverage_definitions_without_facts",
    "coverage_error_clusters_unattributed",
    "coverage_error_classes_unassessed",
];
/// The wire mark of every row a reader short of org-wide alert read gets (P3 spec, Scoped totals).
const SCOPED: &str = "scoped";
/// Stamped on every version-2 record (ENT `run_identity`); the web reads them off the run row.
const VERSION_COLUMNS: [&str; 3] = [
    "schema_version",
    "coverage_definition_checks",
    "coverage_definition_checks_truncated",
];
/// The first read plus one for each of the seven `SumColumns` columns, which only ever appear.
const SCHEMA_ROUNDS: usize = 8;

/// Which columns the visible sums name a read's schema holds; a sum over a missing one is 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SumColumns {
    markers: MarkerColumns,
    severity: bool,
    alert_id: bool,
    /// The `VERSION_COLUMNS` the schema holds; a run row selects only those.
    versioned: [bool; 3],
    /// False while the stored schema holds a column this node's cache, and so its planner, lacks.
    current: bool,
}

impl SumColumns {
    pub(super) fn of(schema: &Schema) -> Self {
        Self {
            markers: MarkerColumns::of(schema),
            severity: schema.field_with_name("severity").is_ok(),
            alert_id: schema.field_with_name("alert_id").is_ok(),
            versioned: VERSION_COLUMNS.map(|column| schema.field_with_name(column).is_ok()),
            current: true,
        }
    }

    pub(super) fn markers(self) -> MarkerColumns {
        self.markers
    }

    pub(super) fn holds_every_column(self) -> bool {
        self.markers.both() && self.severity && self.alert_id
    }

    /// Cached columns checked against the stored ones; any difference means this node is behind.
    pub(super) fn against(self, stored: Self) -> Self {
        // A version column the cache lacks is only left unselected, so it never voids the counts.
        let summed = |c: Self| (c.markers, c.severity, c.alert_id);
        Self {
            current: summed(self) == summed(stored),
            ..self
        }
    }

    fn behind(self) -> Self {
        Self {
            current: false,
            ..self
        }
    }

    /// The run columns a scoped run row selects: every base one, then the version ones written.
    fn run_columns(self) -> Vec<&'static str> {
        let versioned = VERSION_COLUMNS
            .iter()
            .zip(self.versioned)
            .filter_map(|(column, written)| written.then_some(*column));
        RUN_COLUMNS
            .split(',')
            .map(str::trim)
            .chain(versioned)
            .collect()
    }
}

/// One emission's findings and skips over the alerts the reader may see.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VisibleCounts {
    findings: i64,
    skips: i64,
}

impl VisibleCounts {
    fn of(row: &Map<String, Value>) -> Option<Self> {
        let count = |key: &str| {
            let value = row.get(key)?;
            value.as_i64().or_else(|| value.as_f64().map(|n| n as i64))
        };
        Some(Self {
            findings: count("visible_findings")?,
            skips: count("visible_skips")?,
        })
    }
}

/// The distinct alerts in the read's range; a stream or column not written yet names none.
pub(super) async fn probe<S, F>(window: Option<(i64, i64)>, search: S) -> Result<Probe, InfraError>
where
    S: FnOnce(String) -> F,
    F: Future<Output = Result<SearchResponse, InfraError>>,
{
    let hits = match search(probe_sql(window)).await {
        Ok(response) => complete(response, "alert visibility probe")?,
        Err(InfraError::ErrorCode(code)) if Columns::Finding.not_written_yet(&code) => Vec::new(),
        Err(e) => return Err(e),
    };
    Ok(Probe {
        full: hits.len() >= PROBE_CAP,
        ids: hits
            .iter()
            .filter_map(|hit| Some(hit.get("alert_id")?.as_str()?.to_string()))
            .collect(),
    })
}

/// Org-wide gets the base SQL; any other the alert clause, or nothing without a search.
pub(super) async fn visible_search<Q, S, F>(
    sql: Q,
    visibility: &AlertVisibility,
    search: S,
) -> Result<Vec<Value>, InfraError>
where
    Q: FnOnce(Option<&str>) -> String,
    S: FnOnce(String) -> F,
    F: Future<Output = Result<SearchResponse, InfraError>>,
{
    if *visibility == AlertVisibility::Org {
        return search(sql(None)).await.map(|response| response.hits);
    }
    if sees_no_alert(visibility) {
        return Ok(Vec::new());
    }
    let response = search(sql(alert_clause(visibility).as_deref())).await?;
    let mut hits = complete(response, "scoped digest")?;
    hits.iter_mut()
        .filter_map(Value::as_object_mut)
        .for_each(mark_scoped);
    Ok(hits)
}

/// One row per emission, counted over the visible rows instead of the run's stamped totals.
pub(super) async fn scoped_runs<S, F>(
    visibility: &AlertVisibility,
    written: SumColumns,
    search: S,
) -> Result<Vec<Value>, InfraError>
where
    S: FnOnce(String) -> F,
    F: Future<Output = Result<SearchResponse, InfraError>>,
{
    let response = search(scoped_runs_sql(written, &visible_sums(visibility, written))).await?;
    let mut hits = complete(response, "scoped run list")?;
    for row in hits.iter_mut().filter_map(Value::as_object_mut) {
        let counts = VisibleCounts::of(row).filter(|_| written.current);
        scope_row(row, counts);
    }
    Ok(hits)
}

/// A run row per emission, so a run with every finding hidden still opens, then its rows.
pub(super) async fn scoped_records<S, F>(
    run: &RunWindow,
    visibility: &AlertVisibility,
    written: SumColumns,
    filters: Vec<String>,
    search: S,
) -> Result<Vec<Value>, InfraError>
where
    S: Fn(String) -> F,
    F: Future<Output = Result<SearchResponse, InfraError>>,
{
    let window = (run.window_start, run.window_end);
    let sums = visible_sums(visibility, written);
    let response = search(run_summary_sql(window, written, &sums)).await?;
    let mut summaries = complete(response, "scoped run summary")?;
    if !written.current {
        summaries
            .iter_mut()
            .filter_map(Value::as_object_mut)
            .for_each(drop_sums);
    }
    let clause = alert_clause(visibility).filter(|_| {
        run.kind.as_deref() != Some("run")
            && written.alert_id
            && written.current
            && !sees_no_alert(visibility)
    });
    let rows = match clause {
        Some(clause) => {
            let mut filters = filters;
            filters.push(clause);
            match search(records_sql(run, &filters)).await {
                Ok(response) => complete(response, "scoped run records")?,
                Err(InfraError::ErrorCode(code)) if Columns::Finding.not_written_yet(&code) => {
                    Vec::new()
                }
                Err(e) => return Err(e),
            }
        }
        None => Vec::new(),
    };
    let with_runs = matches!(run.kind.as_deref(), None | Some("run"))
        && run.rule_id.is_none()
        && run.tier.is_none()
        && run.pattern.is_none()
        && run.alert_id.is_none();
    Ok(emission_rows(&summaries, rows, with_runs, written))
}

/// A column first written mid-read leaves zeros or an empty probe, so the read redoes on it.
pub(super) async fn on_settled_columns<C, CF, V, VF, R, RF, E>(
    mut planned: SumColumns,
    mut visibility: AlertVisibility,
    columns: C,
    resolve: V,
    read: R,
) -> Result<Vec<Value>, E>
where
    C: Fn() -> CF,
    CF: Future<Output = Result<SumColumns, E>>,
    V: Fn() -> VF,
    VF: Future<Output = Result<AlertVisibility, E>>,
    R: Fn(AlertVisibility, SumColumns) -> RF,
    RF: Future<Output = Result<Vec<Value>, E>>,
{
    let mut hits = read(visibility.clone(), planned).await?;
    for _ in 1..SCHEMA_ROUNDS {
        let now = columns().await?;
        if now == planned {
            return Ok(hits);
        }
        planned = now;
        visibility = resolve().await?;
        hits = read(visibility.clone(), planned).await?;
    }
    if columns().await? == planned {
        return Ok(hits);
    }
    // Still changing after every round, so no count is trusted.
    read(visibility, planned.behind()).await
}

/// A partial scan cuts ids or sums without a sign, so a scoped read fails instead of undercounting.
fn complete(response: SearchResponse, read: &str) -> Result<Vec<Value>, InfraError> {
    hits_or_partial_error(response, read).map_err(|e| InfraError::Message(e.to_string()))
}

fn sees_no_alert(visibility: &AlertVisibility) -> bool {
    matches!(visibility, AlertVisibility::Only(ids) if ids.is_empty())
}

/// A row with no alert is cluster-scoped, so every scoped clause leaves it out (P3-D4).
fn alert_clause(visibility: &AlertVisibility) -> Option<String> {
    match visibility {
        AlertVisibility::Org => None,
        AlertVisibility::AnyAlert => Some("alert_id IS NOT NULL".to_string()),
        AlertVisibility::Only(ids) => {
            let quoted: Vec<String> = ids.iter().map(|id| quote_sql_string(id)).collect();
            Some(format!("alert_id IN ({})", quoted.join(", ")))
        }
    }
}

fn probe_sql(window: Option<(i64, i64)>) -> String {
    let mut sql =
        format!("SELECT DISTINCT alert_id FROM \"{DIGEST_STREAM}\" WHERE alert_id IS NOT NULL");
    if let Some((start, end)) = window {
        sql.push_str(&format!(
            " AND window_start = {start} AND window_end = {end}"
        ));
    }
    sql
}

/// A finding is told by its severity and a skip by its kind, as the base reads tell them.
fn visible_sums(visibility: &AlertVisibility, written: SumColumns) -> String {
    let clause = alert_clause(visibility);
    let sum = |column_written: bool, test: &str, name: &str| {
        if !column_written || !written.alert_id || sees_no_alert(visibility) {
            return format!("0 AS {name}");
        }
        match &clause {
            Some(clause) => {
                format!("SUM(CASE WHEN {test} AND {clause} THEN 1 ELSE 0 END) AS {name}")
            }
            None => format!("SUM(CASE WHEN {test} THEN 1 ELSE 0 END) AS {name}"),
        }
    };
    format!(
        "{}, {}",
        sum(written.severity, "severity IS NOT NULL", "visible_findings"),
        sum(written.markers.kind, "kind = 'skip'", "visible_skips"),
    )
}

fn scoped_runs_sql(written: SumColumns, sums: &str) -> String {
    grouped_runs_sql("", written, sums)
}

fn run_summary_sql((start, end): (i64, i64), written: SumColumns, sums: &str) -> String {
    grouped_runs_sql(
        &format!(" WHERE window_start = {start} AND window_end = {end}"),
        written,
        sums,
    )
}

/// Every record of an emission stamps one `_timestamp`, so a group is one emission.
fn grouped_runs_sql(filter: &str, written: SumColumns, sums: &str) -> String {
    let columns = written.run_columns().join(", ");
    format!(
        "SELECT {columns}, _timestamp AS emitted_at, {sums} FROM \"{DIGEST_STREAM}\"{filter} \
         GROUP BY {columns}, _timestamp ORDER BY emitted_at DESC"
    )
}

/// Without its emission's sums a row gets null counts, never the stamped org totals.
fn scope_row(row: &mut Map<String, Value>, counts: Option<VisibleCounts>) {
    let (findings, skips) = counts.map_or((Value::Null, Value::Null), |c| {
        (c.findings.into(), c.skips.into())
    });
    row.insert("finding_count".to_string(), findings);
    row.insert("skip_count".to_string(), skips.clone());
    row.insert("written_skip_count".to_string(), skips);
    for total in ORG_TOTALS {
        row.insert(total.to_string(), Value::Null);
    }
    drop_sums(row);
    mark_scoped(row);
}

fn drop_sums(row: &mut Map<String, Value>) {
    row.remove("visible_findings");
    row.remove("visible_skips");
}

fn mark_scoped(row: &mut Map<String, Value>) {
    row.insert("visibility".to_string(), SCOPED.into());
}

/// Built from the run columns alone, so no alert, title or evidence of any record can ride along.
fn synthesized_run(summary: &Map<String, Value>, written: SumColumns) -> Value {
    let mut run = Map::new();
    run.insert(
        "_timestamp".to_string(),
        summary.get("emitted_at").cloned().unwrap_or(Value::Null),
    );
    run.insert("kind".to_string(), "run".into());
    for column in written.run_columns() {
        if let Some(value) = summary.get(column) {
            run.insert(column.to_string(), value.clone());
        }
    }
    scope_row(&mut run, VisibleCounts::of(summary));
    Value::Object(run)
}

/// Newest emission first, each with its run row ahead of its records.
fn emission_rows(
    summaries: &[Value],
    rows: Vec<Value>,
    with_runs: bool,
    written: SumColumns,
) -> Vec<Value> {
    let counts: HashMap<i64, VisibleCounts> = summaries
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|s| Some((micros(s, "emitted_at")?, VisibleCounts::of(s)?)))
        .collect();
    let mut out: Vec<(i64, u8, Value)> = Vec::new();
    if with_runs {
        for summary in summaries.iter().filter_map(Value::as_object) {
            let at = micros(summary, "emitted_at").unwrap_or_default();
            out.push((at, 0, synthesized_run(summary, written)));
        }
    }
    for mut row in rows {
        let Some(fields) = row.as_object_mut() else {
            continue;
        };
        let at = micros(fields, "_timestamp").unwrap_or_default();
        scope_row(fields, counts.get(&at).copied());
        out.push((at, 1, row));
    }
    out.sort_by_key(|(at, rank, _)| (Reverse(*at), *rank));
    out.into_iter().map(|(_, _, row)| row).collect()
}

fn micros(row: &Map<String, Value>, key: &str) -> Option<i64> {
    row.get(key)?.as_i64()
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeSet, future::ready, sync::Mutex};

    use serde_json::json;

    use super::{
        super::digests::{
            findings_by_rule_sql, list_runs_sql, record_filters, record_queries, runs_for_alert_sql,
        },
        *,
    };

    const STREAM: &str = "_o2_alert_calibration_digests";

    /// The digest stream as these reads search it: their predicates, over whole records.
    #[derive(Default)]
    struct Digest {
        records: Vec<Value>,
        searches: Mutex<Vec<String>>,
        /// Every answer comes back as a search does when a querier dropped out mid-scan.
        partial: bool,
        /// A projecting read gets only the columns it selects, as a real search returns them.
        projects: bool,
    }

    impl Digest {
        fn new(records: Vec<Value>) -> Self {
            Self {
                records,
                ..Default::default()
            }
        }

        async fn search(&self, sql: String) -> Result<SearchResponse, InfraError> {
            self.searches.lock().unwrap().push(sql.clone());
            let mut hits = self.rows(&sql);
            if self.projects && !sql.starts_with("SELECT * ") {
                let selected = selected(&sql);
                for hit in hits.iter_mut().filter_map(Value::as_object_mut) {
                    hit.retain(|key, _| selected.contains(&key.as_str()));
                }
            }
            Ok(SearchResponse {
                hits,
                is_partial: self.partial,
                ..Default::default()
            })
        }

        fn rows(&self, sql: &str) -> Vec<Value> {
            if sql.contains("AS visible_findings") {
                return self.summaries(sql);
            }
            let rows: Vec<&Value> = self.records.iter().filter(|r| matches(sql, r)).collect();
            if sql.contains("GROUP BY rule_id") {
                return by_rule(&rows);
            }
            if sql.starts_with("SELECT DISTINCT window_start, window_end FROM") {
                let windows: BTreeSet<(i64, i64)> = rows
                    .iter()
                    .map(|r| (int(r, "window_start"), int(r, "window_end")))
                    .collect();
                return windows
                    .into_iter()
                    .map(|(s, e)| json!({"window_start": s, "window_end": e}))
                    .collect();
            }
            rows.into_iter().cloned().collect()
        }

        /// A careless projection: each emission's first whole record, with its sums and emitted_at.
        fn summaries(&self, sql: &str) -> Vec<Value> {
            let mut emissions: Vec<(i64, Vec<&Value>)> = Vec::new();
            for record in self.records.iter().filter(|r| in_window(sql, r)) {
                let at = int(record, "_timestamp");
                match emissions.iter_mut().find(|(t, _)| *t == at) {
                    Some((_, records)) => records.push(record),
                    None => emissions.push((at, vec![record])),
                }
            }
            emissions.sort_by_key(|(at, _)| Reverse(*at));
            let counted = |records: &[&Value], name: &str, is: fn(&Value) -> bool| {
                if sql.contains(&format!("0 AS {name}")) {
                    return 0;
                }
                records
                    .iter()
                    .filter(|r| is(r) && alert_matches(sql, r))
                    .count()
            };
            emissions
                .into_iter()
                .map(|(at, records)| {
                    let mut row = records[0].as_object().unwrap().clone();
                    row.insert("emitted_at".into(), at.into());
                    let findings = counted(&records, "visible_findings", |r| {
                        r.get("severity").is_some()
                    });
                    let skips = counted(&records, "visible_skips", |r| r["kind"] == "skip");
                    row.insert("visible_findings".into(), findings.into());
                    row.insert("visible_skips".into(), skips.into());
                    Value::Object(row)
                })
                .collect()
        }

        fn searched(&self) -> Vec<String> {
            self.searches.lock().unwrap().clone()
        }
    }

    /// The names a SELECT list gives its columns, read just well enough for these run reads.
    fn selected(sql: &str) -> Vec<&str> {
        let list = &sql["SELECT ".len()..sql.find(" FROM ").unwrap()];
        list.split(", ")
            .filter_map(|column| column.rsplit(" AS ").next())
            .collect()
    }

    fn int(row: &Value, key: &str) -> i64 {
        row.get(key).and_then(Value::as_i64).unwrap_or_default()
    }

    fn quoted_after<'a>(sql: &'a str, prefix: &str) -> Option<&'a str> {
        let rest = &sql[sql.find(prefix)? + prefix.len()..];
        rest.strip_prefix('\'')?.split('\'').next()
    }

    fn number_after(sql: &str, prefix: &str) -> Option<i64> {
        let rest = &sql[sql.find(prefix)? + prefix.len()..];
        rest.split(|c: char| !c.is_ascii_digit())
            .next()?
            .parse()
            .ok()
    }

    fn in_window(sql: &str, row: &Value) -> bool {
        number_after(sql, "window_start = ").is_none_or(|s| int(row, "window_start") == s)
            && number_after(sql, "window_end = ").is_none_or(|e| int(row, "window_end") == e)
    }

    fn alert_matches(sql: &str, row: &Value) -> bool {
        let alert = row.get("alert_id").and_then(Value::as_str);
        if let Some(start) = sql.find("alert_id IN (") {
            let list = &sql[start + "alert_id IN (".len()..];
            let list = &list[..list.find(')').unwrap()];
            let ids: Vec<&str> = list.split(", ").map(|q| q.trim_matches('\'')).collect();
            return alert.is_some_and(|a| ids.contains(&a));
        }
        !sql.contains("alert_id IS NOT NULL") || alert.is_some()
    }

    fn matches(sql: &str, row: &Value) -> bool {
        let field = |key: &str| row.get(key).and_then(Value::as_str);
        in_window(sql, row)
            && alert_matches(sql, row)
            && (!sql.contains("severity IS NOT NULL") || row.get("severity").is_some())
            && (!sql.contains("kind = 'skip'") || field("kind") == Some("skip"))
            && quoted_after(sql, "rule_id = ").is_none_or(|rule| field("rule_id") == Some(rule))
            && quoted_after(sql, "alert_id = ").is_none_or(|id| field("alert_id") == Some(id))
            && quoted_after(sql, "str_match_ignore_case(alert_name, ").is_none_or(|name| {
                field("alert_name").is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
    }

    fn by_rule(rows: &[&Value]) -> Vec<Value> {
        let mut rules: Vec<(String, BTreeSet<String>, BTreeSet<i64>)> = Vec::new();
        for row in rows {
            let rule = row["rule_id"].as_str().unwrap().to_string();
            let i = match rules.iter().position(|(r, ..)| *r == rule) {
                Some(i) => i,
                None => {
                    rules.push((rule, BTreeSet::new(), BTreeSet::new()));
                    rules.len() - 1
                }
            };
            if let Some(alert) = row.get("alert_id").and_then(Value::as_str) {
                rules[i].1.insert(alert.to_string());
            }
            rules[i].2.insert(int(row, "window_end"));
        }
        rules
            .into_iter()
            .map(|(rule, alerts, runs)| {
                json!({"rule_id": rule, "alerts_flagged": alerts.len(), "runs_flagging": runs.len()})
            })
            .collect()
    }

    fn only(ids: &[&str]) -> AlertVisibility {
        AlertVisibility::Only(ids.iter().map(|id| id.to_string()).collect())
    }

    fn columns(names: &[&str]) -> SumColumns {
        SumColumns::of(&Schema::new(
            names
                .iter()
                .map(|name| arrow_schema::Field::new(*name, arrow_schema::DataType::Utf8, true))
                .collect::<Vec<_>>(),
        ))
    }

    fn every_column() -> SumColumns {
        columns(&[
            "window_start",
            "window_end",
            "kind",
            "rule_id",
            "severity",
            "alert_id",
        ])
    }

    fn versioned_columns() -> SumColumns {
        let mut names = vec![
            "window_start",
            "window_end",
            "kind",
            "rule_id",
            "severity",
            "alert_id",
        ];
        names.extend(VERSION_COLUMNS);
        columns(&names)
    }

    fn window(kind: Option<&str>, rule_id: Option<&str>) -> RunWindow {
        RunWindow {
            window_start: 1,
            window_end: 2,
            size: None,
            kind: kind.map(str::to_string),
            rule_id: rule_id.map(str::to_string),
            tier: None,
            pattern: None,
            alert_id: None,
        }
    }

    /// The writer's stamp: every record of the emission carries the run's org-wide totals.
    fn record(at: i64, fields: Value) -> Value {
        let mut row = json!({
            "_timestamp": at, "window_start": 1, "window_end": 2, "finding_count": 2,
            "skip_count": 1, "written_skip_count": 1, "omitted_routine_skip_count": 4,
            "alerts_in_scope": 140, "coverage_gap": false, "coverage_unreadable_definitions": 3,
            "coverage_error_classes_unassessed": 2,
        });
        row.as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        row
    }

    /// The version-2 writer stamps the version and the definition checks on every record too.
    fn versioned(mut row: Value) -> Value {
        row.as_object_mut().unwrap().extend(
            json!({"schema_version": 2, "coverage_definition_checks": "checked",
                   "coverage_definition_checks_truncated": false})
            .as_object()
            .unwrap()
            .clone(),
        );
        row
    }

    fn finding(at: i64, alert: &str, rule: &str) -> Value {
        record(
            at,
            json!({"kind": "finding", "rule_id": rule, "severity": "High", "alert_id": alert,
                   "alert_name": format!("{alert}_name"), "title": format!("{alert} is noisy"),
                   "finding_id": format!("f-{alert}")}),
        )
    }

    fn skip(at: i64, alert: &str) -> Value {
        record(
            at,
            json!({"kind": "skip", "rule_id": "silent", "alert_id": alert,
                   "alert_name": format!("{alert}_name"), "skip_reason": "evidence_timeout"}),
        )
    }

    fn cluster_finding(at: i64) -> Value {
        record(
            at,
            json!({"kind": "finding", "rule_id": "scheduler_health", "severity": "Medium",
                   "title": "The alert scheduler fell behind"}),
        )
    }

    async fn records(digest: &Digest, run: &RunWindow, visibility: &AlertVisibility) -> Vec<Value> {
        let filters = record_filters(run, every_column().markers).unwrap();
        scoped_records(run, visibility, every_column(), filters, |sql| {
            digest.search(sql)
        })
        .await
        .unwrap()
    }

    fn values<'a>(rows: &'a [Value], key: &str) -> Vec<&'a Value> {
        rows.iter()
            .map(|r| r.get(key).unwrap_or(&Value::Null))
            .collect()
    }

    #[tokio::test]
    async fn a_scoped_record_read_names_its_alerts_in_the_sql() {
        let digest = Digest::new(vec![finding(5, "a0", "noise")]);
        let visibility = only(&["a2", "a0"]);
        records(&digest, &window(None, Some("noise")), &visibility).await;
        let searched = digest.searched();
        assert_eq!(
            searched[1],
            format!(
                "SELECT * FROM \"{STREAM}\" WHERE window_start = 1 AND window_end = 2 \
                 AND rule_id = 'noise' AND alert_id IN ('a0', 'a2') ORDER BY _timestamp DESC"
            )
        );
        assert_eq!(searched.len(), 2);

        let digest = Digest::new(vec![finding(5, "a0", "noise")]);
        records(&digest, &window(Some("run"), None), &visibility).await;
        let searched = digest.searched();
        assert_eq!(searched.len(), 1, "a run read searches only the summary");
        assert!(
            searched[0].contains("AS visible_findings"),
            "{}",
            searched[0]
        );
        assert_eq!(
            probe_sql(Some((1, 2))),
            format!(
                "SELECT DISTINCT alert_id FROM \"{STREAM}\" WHERE alert_id IS NOT NULL \
                 AND window_start = 1 AND window_end = 2"
            )
        );
    }

    #[tokio::test]
    async fn a_scoped_reader_gets_no_org_dismissed_count() {
        let mut counted = finding(5, "a0", "noise");
        counted["dismissed_count"] = json!(3);
        let digest = Digest::new(vec![counted.clone()]);
        let rows = records(&digest, &window(None, Some("noise")), &only(&["a0"])).await;
        let [scoped] = rows.as_slice() else {
            panic!("one visible finding: {rows:?}");
        };
        assert_eq!(scoped["alert_id"], "a0");
        assert_eq!(scoped["dismissed_count"], Value::Null);
        let org_wide = visible_search(
            |_| "SELECT *".to_string(),
            &AlertVisibility::Org,
            |_| {
                ready(Ok(SearchResponse {
                    hits: vec![counted.clone()],
                    ..Default::default()
                }))
            },
        )
        .await
        .unwrap();
        assert_eq!(org_wide[0]["dismissed_count"], 3);
    }

    #[tokio::test]
    async fn counts_by_rule_exclude_hidden_alerts_in_the_sql() {
        let digest = Digest::new(vec![finding(5, "a0", "noise"), finding(5, "a1", "silent")]);
        let hits = visible_search(findings_by_rule_sql, &only(&["a0"]), |sql| {
            digest.search(sql)
        })
        .await
        .unwrap();
        assert_eq!(
            digest.searched(),
            [format!(
                "SELECT rule_id, COUNT(DISTINCT alert_id) AS alerts_flagged, \
                 COUNT(DISTINCT window_end) AS runs_flagging FROM \"{STREAM}\" \
                 WHERE severity IS NOT NULL AND alert_id IN ('a0') GROUP BY rule_id"
            )]
        );
        assert_eq!(values(&hits, "rule_id"), [&json!("noise")]);
        assert_eq!(values(&hits, "visibility"), [&json!("scoped")]);

        let digest = Digest::new(vec![finding(5, "a0", "noise")]);
        let hits = visible_search(findings_by_rule_sql, &only(&[]), |sql| digest.search(sql))
            .await
            .unwrap();
        assert!(hits.is_empty());
        assert!(digest.searched().is_empty(), "no alert, no search");
    }

    #[tokio::test]
    async fn runs_for_an_alert_name_never_list_a_hidden_alert() {
        let row = |alert: &str, end: i64| {
            json!({"window_start": end - 1, "window_end": end, "alert_id": alert,
                   "alert_name": "cpu", "severity": "High", "rule_id": "noise"})
        };
        let digest = Digest::new(vec![row("a0", 11), row("a1", 22)]);
        let hits = visible_search(
            |clause| runs_for_alert_sql("CPU", clause),
            &only(&["a0"]),
            |sql| digest.search(sql),
        )
        .await
        .unwrap();
        assert_eq!(values(&hits, "window_end"), [&json!(11)]);
    }

    #[tokio::test]
    async fn a_scoped_run_list_counts_visible_rows_and_hides_org_totals() {
        let summary = json!({
            "window_start": 1, "window_end": 2, "emitted_at": 5, "finding_count": 7,
            "skip_count": 2, "alerts_in_scope": 140, "coverage_gap": true,
            "coverage_unreadable_definitions": 3, "coverage_facts_without_definition": 1,
            "coverage_definitions_without_facts": 1, "coverage_error_clusters_unattributed": 1,
            "coverage_counters_truncated": true, "visible_findings": 1, "visible_skips": 0,
        });
        let searched = Mutex::new(Vec::new());
        let hits = scoped_runs(&only(&["a0"]), every_column(), |sql| {
            searched.lock().unwrap().push(sql);
            ready(Ok(SearchResponse {
                hits: vec![summary.clone()],
                ..Default::default()
            }))
        })
        .await
        .unwrap();
        let row = hits[0].as_object().unwrap();
        assert_eq!(row["finding_count"], 1);
        assert_eq!(row["skip_count"], 0);
        assert_eq!(row["written_skip_count"], 0);
        for total in ORG_TOTALS {
            assert_eq!(row[total], Value::Null, "{total}");
        }
        assert_eq!(row["coverage_gap"], true);
        assert_eq!(row["coverage_counters_truncated"], true);
        assert_eq!(row["visibility"], "scoped");
        assert!(!row.contains_key("visible_findings") && !row.contains_key("visible_skips"));
        let sql = &searched.lock().unwrap()[0];
        assert!(
            sql.contains("SUM(CASE WHEN severity IS NOT NULL AND alert_id IN ('a0') THEN 1"),
            "{sql}"
        );
        assert!(sql.ends_with("GROUP BY window_start, window_end, finding_count, skip_count, alerts_in_scope, coverage_gap, coverage_unreadable_definitions, coverage_facts_without_definition, coverage_definitions_without_facts, coverage_transitions_truncated, coverage_counters_truncated, coverage_error_clusters_truncated, coverage_error_clusters_unattributed, coverage_stream_substrate_empty, _timestamp ORDER BY emitted_at DESC"), "{sql}");
    }

    #[tokio::test]
    async fn a_run_whose_findings_are_all_hidden_still_has_one_run_row() {
        let digest = Digest::new(vec![finding(5, "a1", "noise"), finding(5, "a1", "silent")]);
        let hits = records(&digest, &window(None, None), &only(&["a0"])).await;
        assert_eq!(hits.len(), 1, "{hits:?}");
        let run = hits[0].as_object().unwrap();
        assert_eq!(run["kind"], "run");
        assert_eq!(run["_timestamp"], 5);
        assert_eq!(run["finding_count"], 0);
        assert_eq!(run["alerts_in_scope"], Value::Null);
        assert_eq!(run["visibility"], "scoped");
        for hidden in [
            "alert_id",
            "alert_name",
            "title",
            "rule_id",
            "finding_id",
            "severity",
        ] {
            assert!(!run.contains_key(hidden), "{hidden} leaked: {run:?}");
        }
    }

    // The web reads the version and the definition checks off the run row (P3I-D1).
    #[tokio::test]
    async fn a_scoped_reader_of_a_version_2_run_gets_its_version_and_definition_checks() {
        let digest = Digest {
            projects: true,
            ..Digest::new(vec![
                versioned(finding(5, "a0", "noise")),
                versioned(finding(5, "a1", "silent")),
            ])
        };
        let runs = scoped_runs(&only(&["a0"]), versioned_columns(), |sql| {
            digest.search(sql)
        })
        .await
        .unwrap();
        let run = &window(None, None);
        let filters = record_filters(run, versioned_columns().markers).unwrap();
        let records = scoped_records(run, &only(&["a2"]), versioned_columns(), filters, |sql| {
            digest.search(sql)
        })
        .await
        .unwrap();
        assert_eq!(records.len(), 1, "every finding is hidden: {records:?}");
        assert_eq!(records[0]["kind"], "run");
        assert_eq!(runs[0]["finding_count"], 1);
        for row in [&runs[0], &records[0]] {
            assert_eq!(row["schema_version"], 2, "{row}");
            assert_eq!(row["coverage_definition_checks"], "checked", "{row}");
            assert_eq!(row["coverage_definition_checks_truncated"], false, "{row}");
            assert_eq!(row["visibility"], "scoped", "{row}");
            assert_eq!(row["alerts_in_scope"], Value::Null, "{row}");
        }
    }

    #[tokio::test]
    async fn a_scoped_run_row_selects_only_the_version_columns_the_stream_has() {
        let v1 = Digest {
            projects: true,
            ..Digest::new(vec![finding(5, "a0", "noise")])
        };
        let runs = scoped_runs(&only(&["a0"]), every_column(), |sql| v1.search(sql))
            .await
            .unwrap();
        let records = records(&v1, &window(Some("run"), None), &only(&["a0"])).await;
        for row in [&runs[0], &records[0]] {
            for column in VERSION_COLUMNS {
                assert!(row.get(column).is_none(), "{column}: {row}");
            }
        }
        assert_eq!(values(&runs, "finding_count"), [&json!(1)]);
        for sql in v1.searched() {
            for column in VERSION_COLUMNS {
                assert!(!sql.contains(column), "{column}: {sql}");
            }
        }

        // An org with no alerts writes version 2 without any definition checks.
        let no_alerts = Digest {
            projects: true,
            ..Digest::new(vec![record(
                5,
                json!({"kind": "run", "finding_count": 0, "schema_version": 2}),
            )])
        };
        let written = columns(&[
            "window_start",
            "window_end",
            "kind",
            "rule_id",
            "severity",
            "alert_id",
            "schema_version",
        ]);
        let runs = scoped_runs(&only(&[]), written, |sql| no_alerts.search(sql))
            .await
            .unwrap();
        assert_eq!(runs[0]["schema_version"], 2);
        assert!(runs[0].get("coverage_definition_checks").is_none());
        let sql = &no_alerts.searched()[0];
        assert!(
            sql.ends_with("coverage_stream_substrate_empty, schema_version, _timestamp ORDER BY emitted_at DESC"),
            "{sql}"
        );
        assert!(!sql.contains("coverage_definition_checks"), "{sql}");
    }

    // P7c test 22: the id narrows the scoped read, and P3's clause still decides what is seen.
    #[tokio::test]
    async fn a_scoped_reader_gets_no_hidden_alert_by_id() {
        let digest = Digest::new(vec![
            skip(5, "a1"),
            finding(5, "a0", "noise"),
            skip(5, "a0"),
        ]);
        let by_id = |id: &str| RunWindow {
            alert_id: Some(id.to_string()),
            ..window(None, None)
        };
        let visibility = only(&["a0"]);
        let hidden = records(&digest, &by_id("a1"), &visibility).await;
        assert!(hidden.is_empty(), "{hidden:?}");
        assert!(
            digest
                .searched()
                .iter()
                .any(|sql| sql.contains("AND alert_id = 'a1' AND alert_id IN ('a0')")),
            "{:?}",
            digest.searched()
        );
        let seen = records(&digest, &by_id("a0"), &visibility).await;
        let mut kinds: Vec<&Value> = values(&seen, "kind");
        kinds.sort_by_key(|kind| kind.to_string());
        assert_eq!(kinds, [&json!("finding"), &json!("skip")]);
        assert!(seen.iter().all(|row| row["alert_id"] == "a0"), "{seen:?}");
    }

    #[tokio::test]
    async fn a_hidden_alerts_skip_is_neither_returned_nor_counted() {
        let digest = Digest::new(vec![skip(5, "a1"), finding(5, "a0", "noise")]);
        let hits = records(&digest, &window(None, None), &only(&["a0"])).await;
        assert_eq!(values(&hits, "kind"), [&json!("run"), &json!("finding")]);
        assert_eq!(values(&hits, "alert_id"), [&Value::Null, &json!("a0")]);
        for row in &hits {
            assert_eq!(row["finding_count"], 1, "{row}");
            assert_eq!(row["skip_count"], 0, "{row}");
            assert_eq!(row["written_skip_count"], 0, "{row}");
            assert_eq!(row["omitted_routine_skip_count"], Value::Null, "{row}");
            assert_eq!(
                row["coverage_error_classes_unassessed"],
                Value::Null,
                "{row}"
            );
        }
    }

    #[tokio::test]
    async fn a_cluster_finding_reaches_only_an_org_wide_reader() {
        let stream = || Digest::new(vec![cluster_finding(5), finding(5, "a0", "noise")]);
        let rules = |visibility: AlertVisibility| async move {
            let digest = stream();
            let hits = visible_search(findings_by_rule_sql, &visibility, |sql| digest.search(sql))
                .await
                .unwrap();
            let mut rules: Vec<String> = values(&hits, "rule_id")
                .into_iter()
                .map(|r| r.as_str().unwrap().to_string())
                .collect();
            rules.sort();
            rules
        };
        assert_eq!(
            rules(AlertVisibility::Org).await,
            ["noise", "scheduler_health"]
        );
        assert_eq!(rules(AlertVisibility::AnyAlert).await, ["noise"]);
        assert_eq!(rules(only(&["a0"])).await, ["noise"]);
        let digest = stream();
        let hits = records(&digest, &window(None, None), &AlertVisibility::AnyAlert).await;
        assert_eq!(values(&hits, "alert_id"), [&Value::Null, &json!("a0")]);
        assert_eq!(values(&hits, "kind"), [&json!("run"), &json!("finding")]);
    }

    #[tokio::test]
    async fn an_org_wide_read_sends_the_base_sql_and_adds_no_visibility() {
        assert_eq!(
            list_runs_sql(),
            format!(
                "SELECT DISTINCT window_start, window_end, finding_count, skip_count, alerts_in_scope, \
                 coverage_gap, coverage_unreadable_definitions, coverage_facts_without_definition, \
                 coverage_definitions_without_facts, coverage_transitions_truncated, \
                 coverage_counters_truncated, coverage_error_clusters_truncated, \
                 coverage_error_clusters_unattributed, coverage_stream_substrate_empty, \
                 _timestamp AS emitted_at FROM \"{STREAM}\" ORDER BY emitted_at DESC"
            )
        );
        let schema = Schema::new(
            [
                "window_start",
                "window_end",
                "finding_count",
                "kind",
                "rule_id",
            ]
            .into_iter()
            .map(|name| arrow_schema::Field::new(name, arrow_schema::DataType::Utf8, true))
            .collect::<Vec<_>>(),
        );
        let (sql, recheck, _) = record_queries(&window(None, None), &schema).unwrap();
        assert_eq!(
            (sql, recheck),
            (
                format!(
                    "SELECT * FROM \"{STREAM}\" WHERE window_start = 1 AND window_end = 2 \
                     ORDER BY _timestamp DESC"
                ),
                None
            )
        );
        let base_alerts = format!(
            "SELECT DISTINCT window_start, window_end FROM \"{STREAM}\" \
             WHERE severity IS NOT NULL AND str_match_ignore_case(alert_name, 'it''s')"
        );
        let base_rules = format!(
            "SELECT rule_id, COUNT(DISTINCT alert_id) AS alerts_flagged, \
             COUNT(DISTINCT window_end) AS runs_flagging FROM \"{STREAM}\" \
             WHERE severity IS NOT NULL GROUP BY rule_id"
        );
        let digest = Digest::new(vec![cluster_finding(5), finding(5, "a0", "noise")]);
        let alerts = visible_search(
            |clause| runs_for_alert_sql("it's", clause),
            &AlertVisibility::Org,
            |sql| digest.search(sql),
        )
        .await
        .unwrap();
        let rules = visible_search(findings_by_rule_sql, &AlertVisibility::Org, |sql| {
            digest.search(sql)
        })
        .await
        .unwrap();
        assert_eq!(digest.searched(), [base_alerts, base_rules]);
        assert_eq!(rules.len(), 2);
        assert!(
            alerts
                .iter()
                .chain(&rules)
                .all(|r| r.get("visibility").is_none()),
            "{rules:?}"
        );
    }

    #[tokio::test]
    async fn a_run_list_planned_before_severity_existed_is_redone_once_it_appears() {
        let digest = &Digest::new(vec![finding(5, "a0", "noise")]);
        let resolved = Mutex::new(0);
        let hits = on_settled_columns(
            columns(&["window_start", "window_end", "kind", "rule_id", "alert_id"]),
            only(&["a0"]),
            || ready(Ok(every_column())),
            || {
                *resolved.lock().unwrap() += 1;
                ready(Ok(only(&["a0"])))
            },
            |visibility, written| async move {
                scoped_runs(&visibility, written, |sql| digest.search(sql)).await
            },
        )
        .await
        .unwrap();
        assert_eq!(values(&hits, "finding_count"), [&json!(1)]);
        assert_eq!(
            *resolved.lock().unwrap(),
            1,
            "the grown schema resolves visibility again"
        );
        assert_eq!(digest.searched().len(), 2);
    }

    #[tokio::test]
    async fn a_record_read_planned_before_alert_ids_existed_is_redone_once_they_appear() {
        let digest = &Digest::new(vec![finding(5, "a0", "noise")]);
        let run = &window(None, None);
        let hits = on_settled_columns(
            columns(&["window_start", "window_end", "kind", "rule_id", "severity"]),
            only(&[]),
            || ready(Ok(every_column())),
            || ready(Ok(only(&["a0"]))),
            |visibility, written| async move {
                let filters = record_filters(run, written.markers()).unwrap();
                scoped_records(run, &visibility, written, filters, |sql| digest.search(sql)).await
            },
        )
        .await
        .unwrap();
        assert_eq!(values(&hits, "kind"), [&json!("run"), &json!("finding")]);
        assert_eq!(values(&hits, "finding_count"), [&json!(1), &json!(1)]);
    }

    #[tokio::test]
    async fn a_scoped_read_planned_before_the_version_columns_existed_is_redone_once_they_appear() {
        let digest = &Digest {
            projects: true,
            ..Digest::new(vec![versioned(finding(5, "a0", "noise"))])
        };
        let run = &window(None, None);
        let hits = on_settled_columns(
            every_column(),
            only(&["a0"]),
            || ready(Ok(versioned_columns())),
            || ready(Ok(only(&["a0"]))),
            |visibility, written| async move {
                let filters = record_filters(run, written.markers()).unwrap();
                scoped_records(run, &visibility, written, filters, |sql| digest.search(sql)).await
            },
        )
        .await
        .unwrap();
        assert_eq!(values(&hits, "kind"), [&json!("run"), &json!("finding")]);
        assert_eq!(values(&hits, "schema_version"), [&json!(2), &json!(2)]);
        assert_eq!(digest.searched().len(), 4);
    }

    // P3's trust in the counts stays on the summed columns alone.
    #[test]
    fn a_cache_lacking_only_a_version_column_keeps_its_counts() {
        let cached = columns(&["window_start", "window_end", "kind", "rule_id", "alert_id"]);
        let stored = columns(&[
            "window_start",
            "window_end",
            "kind",
            "rule_id",
            "alert_id",
            "schema_version",
        ]);
        assert!(cached.against(stored).current);
        assert!(!cached.against(versioned_columns()).current);
    }

    #[tokio::test]
    async fn a_read_on_a_settled_schema_searches_once() {
        let digest = &Digest::new(vec![finding(5, "a0", "noise")]);
        let resolved = Mutex::new(0);
        on_settled_columns(
            every_column(),
            only(&["a0"]),
            || ready(Ok(every_column())),
            || {
                *resolved.lock().unwrap() += 1;
                ready(Ok(only(&["a0"])))
            },
            |visibility, written| async move {
                scoped_runs(&visibility, written, |sql| digest.search(sql)).await
            },
        )
        .await
        .unwrap();
        assert_eq!(digest.searched().len(), 1);
        assert_eq!(*resolved.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn a_schema_that_never_settles_stops_at_the_round_cap_without_counts() {
        let digest = &Digest::new(vec![finding(5, "a0", "noise")]);
        let looks = Mutex::new(0);
        let flapping = || {
            let mut looks = looks.lock().unwrap();
            *looks += 1;
            ready(Ok(if *looks % 2 == 0 {
                every_column()
            } else {
                columns(&["window_start", "window_end"])
            }))
        };
        let hits = on_settled_columns(
            every_column(),
            only(&["a0"]),
            flapping,
            || ready(Ok(only(&["a0"]))),
            |visibility, written| async move {
                scoped_runs(&visibility, written, |sql| digest.search(sql)).await
            },
        )
        .await
        .unwrap();
        assert_eq!(digest.searched().len(), SCHEMA_ROUNDS + 1);
        assert_eq!(values(&hits, "finding_count"), [&Value::Null]);
        assert_eq!(values(&hits, "skip_count"), [&Value::Null]);
    }

    #[tokio::test]
    async fn a_node_whose_cache_lags_the_stored_schema_reports_no_counts_rather_than_zero() {
        let digest = &Digest::new(vec![finding(5, "a0", "noise"), skip(5, "a0")]);
        let cached = columns(&["window_start", "window_end", "kind", "rule_id"]);
        let lagging = || ready(Ok(cached.against(every_column())));
        let runs = on_settled_columns(
            cached.against(every_column()),
            only(&[]),
            lagging,
            || ready(Ok(only(&[]))),
            |visibility, written| async move {
                scoped_runs(&visibility, written, |sql| digest.search(sql)).await
            },
        )
        .await
        .unwrap();
        assert_eq!(values(&runs, "finding_count"), [&Value::Null]);
        assert_eq!(values(&runs, "skip_count"), [&Value::Null]);
        assert_eq!(
            digest.searched().len(),
            1,
            "an unchanged cache is not read again"
        );

        let run = &window(None, None);
        let records = on_settled_columns(
            cached.against(every_column()),
            AlertVisibility::AnyAlert,
            lagging,
            || ready(Ok(AlertVisibility::AnyAlert)),
            |visibility, written| async move {
                let filters = record_filters(run, written.markers()).unwrap();
                scoped_records(run, &visibility, written, filters, |sql| digest.search(sql)).await
            },
        )
        .await
        .unwrap();
        assert_eq!(values(&records, "kind"), [&json!("run")]);
        assert_eq!(values(&records, "finding_count"), [&Value::Null]);
        assert_eq!(
            digest.searched().len(),
            2,
            "no record search on columns the planner lacks"
        );

        let clean = &Digest::new(vec![record(5, json!({"kind": "run", "finding_count": 0}))]);
        let hits = scoped_runs(&only(&[]), cached.against(cached), |sql| clean.search(sql))
            .await
            .unwrap();
        assert_eq!(values(&hits, "finding_count"), [&json!(0)]);
    }

    #[tokio::test]
    async fn a_partial_probe_below_the_cap_is_an_error_not_a_smaller_set() {
        let response = SearchResponse {
            hits: vec![json!({"alert_id": "a0"})],
            is_partial: true,
            function_error: vec!["querier q1 left the cluster".to_string()],
            ..Default::default()
        };
        let Err(e) = probe(Some((1, 2)), |_| ready(Ok(response))).await else {
            panic!("a partial probe resolved a visibility");
        };
        assert!(e.to_string().contains("partial"), "{e}");
        assert!(e.to_string().contains("querier q1 left the cluster"), "{e}");
    }

    #[tokio::test]
    async fn a_partial_scoped_search_fails_the_read_and_an_org_wide_one_keeps_its_rows() {
        let digest = Digest {
            partial: true,
            ..Digest::new(vec![finding(5, "a0", "noise")])
        };
        let search = |sql| digest.search(sql);
        let visible = only(&["a0"]);
        assert!(scoped_runs(&visible, every_column(), search).await.is_err());
        let run = window(None, None);
        let filters = record_filters(&run, every_column().markers).unwrap();
        let read = scoped_records(&run, &visible, every_column(), filters, search).await;
        assert!(read.is_err());
        let rules = visible_search(findings_by_rule_sql, &visible, search).await;
        assert!(rules.is_err());
        let rules = visible_search(findings_by_rule_sql, &AlertVisibility::Org, search).await;
        assert_eq!(values(&rules.unwrap(), "rule_id"), [&json!("noise")]);
    }
}
