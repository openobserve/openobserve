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
    meta::dashboards::{
        Dashboard,
        v8::{Panel, Tab},
    },
    utils::hash::{Sum64, gxhash},
};
use serde_json::{Value, json};

use super::variables::QueryVars;

/// Panel id to intent for every panel of the dashboard under the link's frozen values.
pub fn intents(dash: &Dashboard, frozen: &BTreeMap<String, Value>) -> BTreeMap<String, String> {
    let Some(v8) = dash.v8.as_ref() else {
        return BTreeMap::new();
    };
    let vars = QueryVars::new(dash, frozen.clone(), None);
    v8.tabs
        .iter()
        .flat_map(|tab| tab.panels.iter().map(move |panel| (tab, panel)))
        .map(|(tab, panel)| {
            (
                panel.id.clone(),
                panel_intent(dash, &vars, frozen, tab, panel),
            )
        })
        .collect()
}

/// Hash of the query definitions as written and the scoped frozen variables they reference.
pub fn panel_intent(
    dash: &Dashboard,
    vars: &QueryVars,
    frozen: &BTreeMap<String, Value>,
    tab: &Tab,
    panel: &Panel,
) -> String {
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
            })
        })
        .collect();
    let texts: Vec<&str> = panel
        .queries
        .iter()
        .flat_map(|q| [q.query.as_deref(), q.vrl_function_query.as_deref()])
        .flatten()
        .collect();
    let definitions = dash
        .v8
        .as_ref()
        .and_then(|v8| v8.variables.as_ref())
        .map(|v| v.list.as_slice())
        .unwrap_or_default();
    let variables: Vec<Value> = vars
        .referenced(&tab.tab_id, &panel.id, &texts)
        .into_iter()
        .map(|(name, key)| {
            json!({
                "key": key,
                "frozen": frozen.get(&key),
                "definition": definitions.iter().find(|v| v.name == name),
            })
        })
        .collect();
    let doc = json!({
        "query_type": panel.query_type,
        "queries": queries,
        "variables": variables,
    });
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
    fn gate05_intent_moves_with_query_vrl_shift_and_referenced_frozen_values_only() {
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
        assert_eq!(
            intents(&base_dash, &unrelated)["p1"],
            base,
            "a variable the panel does not read"
        );
        let mut other_vars = vars();
        other_vars[2]["label"] = json!("Renamed");
        let variable_only = dashboard(json!([panel("p1", sql(), None, None)]), other_vars);
        assert_eq!(
            intents(&variable_only, &frozen)["p1"],
            base,
            "an edit to a variable the panel does not read"
        );
    }
}
