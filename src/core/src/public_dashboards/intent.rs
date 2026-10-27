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

//! The panel intent fingerprint (design 4.5), from the dashboard and link rows alone, no search.

use std::collections::BTreeMap;

use config::{
    meta::dashboards::{Dashboard, v8::Panel},
    utils::hash::{Sum64, gxhash},
};
use serde_json::{Value, json};

/// Panel id to intent for every panel of the dashboard under the link's frozen values.
pub fn intents(dash: &Dashboard, frozen: &BTreeMap<String, Value>) -> BTreeMap<String, String> {
    let Some(v8) = dash.v8.as_ref() else {
        return BTreeMap::new();
    };
    let variables = variables_hash(dash, frozen);
    v8.tabs
        .iter()
        .flat_map(|tab| tab.panels.iter())
        .map(|panel| (panel.id.clone(), intent_with(&variables, panel)))
        .collect()
}

/// Hash of the query definitions as written, every variable definition and every frozen value.
pub fn panel_intent(dash: &Dashboard, frozen: &BTreeMap<String, Value>, panel: &Panel) -> String {
    intent_with(&variables_hash(dash, frozen), panel)
}

fn intent_with(variables: &str, panel: &Panel) -> String {
    let queries: Vec<Value> = panel
        .queries
        .iter()
        .map(|q| {
            let cfg = serde_json::to_value(&q.config).unwrap_or_default();
            json!({
                "query": q.query,
                "vrl": q.vrl_function_query,
                "stream_type": q.fields.stream_type,
                "stream": q.fields.stream,
                "limit": cfg.get("limit"),
                "time_shift": cfg.get("time_shift"),
                "hide": cfg.get("hide"),
                "formula": cfg.get("formula"),
                "ref": cfg.get("ref"),
                "query_type": cfg.get("query_type"),
                "step_value": cfg.get("step_value"),
            })
        })
        .collect();
    let panel_cfg = serde_json::to_value(&panel.config).unwrap_or_default();
    let doc = json!({
        "query_type": panel.query_type,
        "heatmap": panel.typ == "heatmap",
        "step_value": panel_cfg.get("step_value"),
        "queries": queries,
        "variables": variables,
    });
    format!("{:016x}", gxhash::new().sum64(&doc.to_string()))
}

/// One hash over all variables and frozen values: a chained variable can reach any panel.
fn variables_hash(dash: &Dashboard, frozen: &BTreeMap<String, Value>) -> String {
    let definitions = dash.v8.as_ref().and_then(|v8| v8.variables.as_ref());
    let doc = json!({ "definitions": definitions, "frozen": frozen });
    format!("{:016x}", gxhash::new().sum64(&doc.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dashboard(panels: Value, variables: Value) -> Dashboard {
        Dashboard {
            version: 8,
            v8: Some(
                serde_json::from_value(json!({
                    "tabs": [{ "tabId": "t1", "name": "", "panels": panels }],
                    "variables": { "list": variables }
                }))
                .unwrap(),
            ),
            ..Default::default()
        }
    }

    fn panel(id: &str, sql: &str, vrl: Option<&str>, shift: Option<&str>) -> Value {
        let mut config = json!({ "promql_legend": "" });
        if let Some(off) = shift {
            config["time_shift"] = json!([{ "offSet": off }]);
        }
        json!({
            "id": id, "type": "line", "title": id, "description": "",
            "config": { "show_legends": false, "legends_position": null },
            "queryType": "sql",
            "queries": [{
                "query": sql, "vrlFunctionQuery": vrl, "customQuery": true,
                "fields": { "stream": "s", "stream_type": "logs", "x": [], "y": [],
                            "filter": { "filterType": "group", "logicalOperator": "AND", "conditions": [] } },
                "config": config
            }]
        })
    }

    fn vars() -> Value {
        json!([
            { "type": "custom", "name": "env", "label": "Env" },
            { "type": "query_values", "name": "svc", "label": "Svc", "scope": "panels", "panels": ["p1"],
              "query_data": { "stream_type": "logs", "stream": "s", "field": "svc" } },
            { "type": "custom", "name": "unused", "label": "U" }
        ])
    }

    fn sql() -> &'static str {
        "SELECT histogram(_timestamp, '$__interval') AS t, count(*) FROM s \
         WHERE env = '$env' AND svc = '${svc}' AND _timestamp > $__range GROUP BY t"
    }

    #[test]
    fn gate05_intent_is_stable_across_ranges_and_unset_values_query_defaults() {
        let dash = dashboard(json!([panel("p1", sql(), None, None)]), vars());
        let frozen: BTreeMap<String, Value> =
            serde_json::from_value(json!({ "env": "prod" })).unwrap();
        let a = intents(&dash, &frozen);
        // Computed twice, with no window and no values query: the same answer.
        assert_eq!(a, intents(&dash, &frozen));
        assert_eq!(a.len(), 1);
        assert_eq!(a["p1"].len(), 16);
    }

    #[test]
    fn gate05_intent_moves_with_query_vrl_shift_and_any_variable_or_frozen_value() {
        let base_dash = dashboard(json!([panel("p1", sql(), None, None)]), vars());
        let frozen: BTreeMap<String, Value> =
            serde_json::from_value(json!({ "env": "prod" })).unwrap();
        let base = intents(&base_dash, &frozen)["p1"].clone();

        let vrl = dashboard(json!([panel("p1", sql(), Some(".x = 1"), None)]), vars());
        assert_ne!(intents(&vrl, &frozen)["p1"], base, "a VRL-only edit");
        let shifted = dashboard(json!([panel("p1", sql(), None, Some("1d"))]), vars());
        assert_ne!(intents(&shifted, &frozen)["p1"], base, "a time shift");
        let edited = dashboard(
            json!([panel("p1", "SELECT count(*) FROM other", None, None)]),
            vars(),
        );
        assert_ne!(intents(&edited, &frozen)["p1"], base, "a query edit");

        let narrowed: BTreeMap<String, Value> =
            serde_json::from_value(json!({ "env": "staging" })).unwrap();
        assert_ne!(
            intents(&base_dash, &narrowed)["p1"],
            base,
            "a narrowed filter"
        );
        let panel_scoped: BTreeMap<String, Value> =
            serde_json::from_value(json!({ "env": "prod", "svc.p.p1": "api" })).unwrap();
        assert_ne!(
            intents(&base_dash, &panel_scoped)["p1"],
            base,
            "a panel-scoped value"
        );
        let unrelated: BTreeMap<String, Value> =
            serde_json::from_value(json!({ "env": "prod", "unused": "x" })).unwrap();
        // Any frozen value can feed a panel through a chained variable.
        assert_ne!(
            intents(&base_dash, &unrelated)["p1"],
            base,
            "a variable the panel does not read"
        );
        let mut other_vars = vars();
        other_vars[2]["label"] = json!("Renamed");
        let variable_only = dashboard(json!([panel("p1", sql(), None, None)]), other_vars);
        assert_ne!(
            intents(&variable_only, &frozen)["p1"],
            base,
            "an edit to a variable the panel does not read"
        );
    }

    #[test]
    fn intent_moves_with_hide_formula_ref_query_type_and_steps() {
        let frozen = BTreeMap::new();
        let base = intents(
            &dashboard(json!([panel("p1", sql(), None, None)]), vars()),
            &frozen,
        );
        for (key, value) in [
            ("hide", json!(true)),
            ("formula", json!("A * 2")),
            ("ref", json!("B")),
            ("query_type", json!("instant")),
            ("step_value", json!("30s")),
        ] {
            let mut p = panel("p1", sql(), None, None);
            p["queries"][0]["config"][key] = value;
            let changed = intents(&dashboard(json!([p]), vars()), &frozen);
            assert_ne!(changed["p1"], base["p1"], "{key}");
        }
        let mut p = panel("p1", sql(), None, None);
        p["config"]["step_value"] = json!("1m");
        let changed = intents(&dashboard(json!([p]), vars()), &frozen);
        assert_ne!(changed["p1"], base["p1"], "the panel step");
    }
}
