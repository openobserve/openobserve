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

//! Reformat search `hits` into a compact string block for agent consumers
//! (`agent_options.output_format`). Runs at the serialization edge only:
//! result cache and the engine always see the original JSON hits.

use config::{
    TIMESTAMP_COL_NAME,
    meta::search::{OutputFormat, Response},
    utils::json,
};

/// A `select *` on a wide stream yields hits where most cells are absent;
/// per-row keys (ndjson) are then cheaper and less error-prone than a mostly
/// empty grid, so we fall back automatically (announced via `advisory`).
const SPARSE_FALLBACK_MIN_COLUMNS: usize = 20;
const SPARSE_FALLBACK_EMPTY_RATIO: f64 = 0.5;

pub fn apply_output_format(res: &mut Response, format: OutputFormat) {
    if format == OutputFormat::Json {
        return;
    }

    let format_name = match format {
        OutputFormat::Csv => "csv",
        OutputFormat::MdTable => "md_table",
        OutputFormat::Json => unreachable!(),
    };

    if res.hits.is_empty() {
        res.format = Some(format_name.to_string());
        res.data = Some(String::new());
        return;
    }

    // Hits are expected to be objects; anything else (scalar rows from exotic
    // queries) can't be laid out as a table, keep them as ndjson.
    if !res.hits.iter().all(|hit| hit.is_object()) {
        fallback_to_ndjson(res, "result rows are not flat objects");
        return;
    }

    let columns = collect_columns(res);

    let total_cells = columns.len() * res.hits.len();
    let empty_cells: usize = res
        .hits
        .iter()
        .map(|hit| {
            let obj = hit.as_object().unwrap();
            columns
                .iter()
                .filter(|col| matches!(obj.get(*col), None | Some(json::Value::Null)))
                .count()
        })
        .sum();
    if columns.len() >= SPARSE_FALLBACK_MIN_COLUMNS
        && (empty_cells as f64) > (total_cells as f64) * SPARSE_FALLBACK_EMPTY_RATIO
    {
        let reason = format!(
            "result is sparse ({} columns, {}% empty cells)",
            columns.len(),
            empty_cells * 100 / total_cells
        );
        fallback_to_ndjson(res, &reason);
        return;
    }

    let data = match format {
        OutputFormat::Csv => render_csv(&columns, &res.hits),
        OutputFormat::MdTable => render_md_table(&columns, &res.hits),
        OutputFormat::Json => unreachable!(),
    };

    res.format = Some(format_name.to_string());
    res.data = Some(data);
    res.columns = columns;
    res.hits.clear();
}

/// Column order: server-provided `columns` first (if any), then remaining
/// keys in first-seen order, with `_timestamp` promoted to the front.
fn collect_columns(res: &Response) -> Vec<String> {
    let derive_order = res.columns.is_empty();
    let mut columns = res.columns.clone();
    let mut seen: hashbrown::HashSet<String> = columns.iter().cloned().collect();
    for hit in &res.hits {
        for key in hit.as_object().unwrap().keys() {
            if seen.insert(key.clone()) {
                columns.push(key.clone());
            }
        }
    }
    if derive_order
        && let Some(pos) = columns.iter().position(|c| c == TIMESTAMP_COL_NAME)
        && pos > 0
    {
        let ts = columns.remove(pos);
        columns.insert(0, ts);
    }
    columns
}

fn fallback_to_ndjson(res: &mut Response, reason: &str) {
    let data = res
        .hits
        .iter()
        .map(|hit| hit.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    res.format = Some("ndjson".to_string());
    res.data = Some(data);
    res.advisory = Some(format!("{reason}; returned as ndjson instead"));
    res.hits.clear();
}

/// Stringify one cell. Nested objects/arrays become minified JSON.
fn cell_value(hit: &json::Value, column: &str) -> String {
    match hit.get(column) {
        None | Some(json::Value::Null) => String::new(),
        Some(json::Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
    }
}

/// Newlines become a literal `\n` (never RFC 4180 multi-line quoted cells:
/// models mis-parse records that span lines); commas/quotes still get the
/// standard quoting so the row stays machine-parsable.
fn csv_escape(value: &str) -> String {
    let value = escape_newlines(value);
    if value.contains(',') || value.contains('"') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

fn escape_newlines(value: &str) -> String {
    if value.contains(['\n', '\r']) {
        value.replace("\r\n", "\\n").replace(['\n', '\r'], "\\n")
    } else {
        value.to_string()
    }
}

fn render_csv(columns: &[String], hits: &[json::Value]) -> String {
    let mut out = String::new();
    out.push_str(
        &columns
            .iter()
            .map(|c| csv_escape(c))
            .collect::<Vec<_>>()
            .join(","),
    );
    for hit in hits {
        out.push('\n');
        out.push_str(
            &columns
                .iter()
                .map(|c| csv_escape(&cell_value(hit, c)))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    out
}

fn md_escape(value: &str) -> String {
    escape_newlines(value).replace('|', "\\|")
}

fn render_md_table(columns: &[String], hits: &[json::Value]) -> String {
    let mut out = String::new();
    let header = columns.iter().map(|c| md_escape(c)).collect::<Vec<_>>();
    out.push_str(&format!("| {} |", header.join(" | ")));
    out.push('\n');
    out.push_str(&format!("| {} |", vec!["---"; columns.len()].join(" | ")));
    for hit in hits {
        out.push('\n');
        let row = columns
            .iter()
            .map(|c| md_escape(&cell_value(hit, c)))
            .collect::<Vec<_>>();
        out.push_str(&format!("| {} |", row.join(" | ")));
    }
    out
}

#[cfg(test)]
mod tests {
    use config::utils::json::json;

    use super::*;

    fn response_with_hits(hits: Vec<json::Value>) -> Response {
        Response {
            hits,
            ..Default::default()
        }
    }

    #[test]
    fn json_format_is_noop() {
        let mut res = response_with_hits(vec![json!({"a": 1})]);
        apply_output_format(&mut res, OutputFormat::Json);
        assert_eq!(res.hits.len(), 1);
        assert!(res.format.is_none());
        assert!(res.data.is_none());
    }

    #[test]
    fn csv_basic_with_timestamp_first() {
        let mut res = response_with_hits(vec![
            json!({"_timestamp": 1000, "level": "info", "message": "hello"}),
            json!({"_timestamp": 2000, "level": "error", "message": "boom"}),
        ]);
        apply_output_format(&mut res, OutputFormat::Csv);
        assert_eq!(res.format.as_deref(), Some("csv"));
        assert_eq!(
            res.data.as_deref(),
            Some("_timestamp,level,message\n1000,info,hello\n2000,error,boom")
        );
        assert_eq!(res.columns, vec!["_timestamp", "level", "message"]);
        assert!(res.hits.is_empty());
    }

    #[test]
    fn csv_escapes_newline_comma_quote_and_nested() {
        let mut res = response_with_hits(vec![json!({
            "msg": "line1\nline2",
            "note": "a,b",
            "quoted": "say \"hi\"",
            "k8s": {"pod": "x"},
        })]);
        apply_output_format(&mut res, OutputFormat::Csv);
        let data = res.data.unwrap();
        let mut lines = data.lines();
        lines.next(); // header
        let row = lines.next().unwrap();
        // no record spans multiple physical lines
        assert!(lines.next().is_none());
        assert!(row.contains(r"line1\nline2"));
        assert!(row.contains("\"a,b\""));
        assert!(row.contains(r#""say ""hi""""#));
        assert!(row.contains(r#""{""pod"":""x""}""#));
    }

    #[test]
    fn csv_missing_and_null_cells_are_empty() {
        let mut res = response_with_hits(vec![
            json!({"a": 1, "b": json::Value::Null}),
            json!({"a": 2, "c": "x"}),
        ]);
        apply_output_format(&mut res, OutputFormat::Csv);
        assert_eq!(res.data.as_deref(), Some("a,b,c\n1,,\n2,,x"));
    }

    #[test]
    fn csv_respects_server_columns_order() {
        let mut res = response_with_hits(vec![json!({"a": 1, "z": 2})]);
        res.columns = vec!["z".to_string(), "a".to_string()];
        apply_output_format(&mut res, OutputFormat::Csv);
        assert_eq!(res.data.as_deref(), Some("z,a\n2,1"));
    }

    #[test]
    fn md_table_escapes_pipe() {
        let mut res = response_with_hits(vec![json!({"msg": "a|b"})]);
        apply_output_format(&mut res, OutputFormat::MdTable);
        assert_eq!(res.format.as_deref(), Some("md_table"));
        assert_eq!(res.data.as_deref(), Some("| msg |\n| --- |\n| a\\|b |"));
    }

    #[test]
    fn sparse_result_falls_back_to_ndjson() {
        // 25 columns, each row fills only one of them -> ~96% empty
        let hits: Vec<json::Value> = (0..10)
            .map(|i| json!({format!("field_{}", i % 25): "v"}))
            .collect();
        let mut res = response_with_hits(hits);
        // widen the union past the min-columns threshold
        for i in 10..25 {
            res.hits.push(json!({format!("field_{i}"): "v"}));
        }
        apply_output_format(&mut res, OutputFormat::Csv);
        assert_eq!(res.format.as_deref(), Some("ndjson"));
        assert!(res.advisory.as_deref().unwrap().contains("sparse"));
        assert_eq!(res.data.unwrap().lines().count(), 25);
        assert!(res.hits.is_empty());
    }

    #[test]
    fn non_object_hits_fall_back_to_ndjson() {
        let mut res = response_with_hits(vec![json!(42), json!({"a": 1})]);
        apply_output_format(&mut res, OutputFormat::Csv);
        assert_eq!(res.format.as_deref(), Some("ndjson"));
        assert_eq!(res.data.as_deref(), Some("42\n{\"a\":1}"));
    }

    #[test]
    fn empty_hits_yield_empty_data() {
        let mut res = response_with_hits(vec![]);
        apply_output_format(&mut res, OutputFormat::Csv);
        assert_eq!(res.format.as_deref(), Some("csv"));
        assert_eq!(res.data.as_deref(), Some(""));
    }
}
