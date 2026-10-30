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

//! Server-side masking on every serve, before rev and the 304 decision (design 4.3 step 7).

use std::collections::BTreeMap;

use config::meta::public_dashboards::{
    NotAvailableReason, PanelResult, PanelState, PublicVariable, ResultBody,
};

use super::store::{Header, PanelSummary};

/// The panels a reader may see now: withheld, changed and too-old panels masked, removed dropped.
pub fn mask(
    body: &ResultBody,
    header: &Header,
    intents: &BTreeMap<String, String>,
    now: i64,
    max_age_micros: i64,
) -> BTreeMap<String, PanelResult> {
    body.panels
        .iter()
        .filter_map(|(id, panel)| {
            let current = intents.get(id)?;
            let reason = masked(
                id,
                &panel.intent,
                &panel.state,
                panel.built_at,
                header,
                current,
                now,
                max_age_micros,
            );
            let out = match reason {
                Some(reason) => {
                    let mut p = PanelResult::not_available(reason);
                    p.intent = current.clone();
                    p
                }
                None => panel.clone(),
            };
            Some((id.clone(), out))
        })
        .collect()
}

/// The visible state of each panel from the header alone, the same as [`mask`] gives.
pub fn visible_states(
    header: &Header,
    intents: &BTreeMap<String, String>,
    now: i64,
    max_age_micros: i64,
) -> Vec<(String, PanelState)> {
    header
        .panels
        .iter()
        .filter_map(
            |PanelSummary {
                 id,
                 intent,
                 state,
                 built_at,
             }| {
                let current = intents.get(id)?;
                let state = match masked(
                    id,
                    intent,
                    state,
                    *built_at,
                    header,
                    current,
                    now,
                    max_age_micros,
                ) {
                    Some(reason) => PanelState::NotAvailable { reason },
                    None => state.clone(),
                };
                Some((id.clone(), state))
            },
        )
        .collect()
}

/// The variables a reader may see: a value from a values query the publisher lost is nulled.
pub fn variables(body: &ResultBody, header: &Header) -> Vec<PublicVariable> {
    body.variables
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let withheld = body
                .variable_keys
                .get(i)
                .is_some_and(|key| header.withheld_variables.contains(key));
            let mut v = v.clone();
            if withheld {
                v.value = serde_json::Value::Null;
            }
            v
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn masked(
    id: &str,
    intent: &str,
    state: &PanelState,
    built_at: Option<i64>,
    header: &Header,
    current: &str,
    now: i64,
    max_age_micros: i64,
) -> Option<NotAvailableReason> {
    if let Some(w) = header.withheld_panels.iter().find(|w| w.panel_id == id) {
        return Some(w.reason);
    }
    if intent != current {
        return Some(NotAvailableReason::Changed);
    }
    let retained = matches!(state, PanelState::Ok { retained: true, .. });
    (retained && built_at.is_none_or(|at| at < now - max_age_micros))
        .then_some(NotAvailableReason::TooOld)
}

#[cfg(test)]
mod tests {
    use config::meta::public_dashboards::{Window, WithheldPanel};
    use serde_json::json;

    use super::*;

    const HOUR: i64 = 3_600_000_000;

    fn ok(intent: &str, built_at: i64, retained: bool) -> PanelResult {
        PanelResult {
            state: PanelState::Ok {
                retained,
                error_since: retained.then_some(built_at),
                partial: false,
                truncated: false,
            },
            intent: intent.into(),
            built_at: Some(built_at),
            window: Some(Window { start: 0, end: 1 }),
            data: vec![json!([{ "secret": 1 }])],
            result_meta_data: vec![],
            metadata: json!({ "queries": [] }),
        }
    }

    fn reason(p: &PanelResult) -> Option<NotAvailableReason> {
        match p.state {
            PanelState::NotAvailable { reason } => Some(reason),
            PanelState::Ok { .. } => None,
        }
    }

    #[test]
    fn gate12_withheld_removed_changed_and_too_old_panels_never_reach_a_reader() {
        let now = 100 * HOUR;
        let mut panels = BTreeMap::new();
        panels.insert("fresh".to_string(), ok("i1", now, false));
        panels.insert("withheld".to_string(), ok("i2", now, false));
        panels.insert("removed".to_string(), ok("i3", now, false));
        panels.insert("changed".to_string(), ok("old", now, false));
        panels.insert("old".to_string(), ok("i5", now - 25 * HOUR, true));
        panels.insert("young".to_string(), ok("i6", now - 23 * HOUR, true));
        // An absolute file's fresh panel never ages out; only retained data does.
        panels.insert("absolute".to_string(), ok("i7", now - 400 * HOUR, false));
        let summaries = panels
            .iter()
            .map(|(id, p)| PanelSummary {
                id: id.clone(),
                intent: p.intent.clone(),
                state: p.state.clone(),
                built_at: p.built_at,
            })
            .collect();
        let body = ResultBody {
            panels,
            ..Default::default()
        };
        let header = Header {
            withheld_panels: vec![WithheldPanel {
                panel_id: "withheld".into(),
                reason: NotAvailableReason::Unauthorized,
            }],
            panels: summaries,
            ..Default::default()
        };
        let intents: BTreeMap<String, String> = [
            ("fresh", "i1"),
            ("withheld", "i2"),
            ("changed", "new"),
            ("old", "i5"),
            ("young", "i6"),
            ("absolute", "i7"),
        ]
        .into_iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();
        let out = mask(&body, &header, &intents, now, 24 * HOUR);
        assert!(!out.contains_key("removed"));
        assert_eq!(reason(&out["fresh"]), None);
        assert_eq!(reason(&out["absolute"]), None);
        assert_eq!(reason(&out["young"]), None);
        assert_eq!(
            reason(&out["withheld"]),
            Some(NotAvailableReason::Unauthorized)
        );
        assert_eq!(reason(&out["changed"]), Some(NotAvailableReason::Changed));
        assert_eq!(reason(&out["old"]), Some(NotAvailableReason::TooOld));
        for id in ["withheld", "changed", "old"] {
            assert!(out[id].data.is_empty(), "{id} leaks data");
        }
        // The header alone gives the same states, so a 304 needs no body.
        let from_body: Vec<(String, PanelState)> =
            out.into_iter().map(|(id, p)| (id, p.state)).collect();
        assert_eq!(visible_states(&header, &intents, now, 24 * HOUR), from_body);
    }

    #[test]
    fn gate02_a_variable_from_a_lost_values_stream_is_nulled() {
        let var = |label: &str, value| PublicVariable {
            name: label.into(),
            label: label.into(),
            value,
            tab_id: None,
            panel_id: None,
        };
        let body = ResultBody {
            variables: vec![var("svc", json!("checkout")), var("env", json!("prod"))],
            variable_keys: vec!["svc".into(), "env".into()],
            ..Default::default()
        };
        let header = Header {
            withheld_variables: vec!["svc".into()],
            ..Default::default()
        };
        let out = variables(&body, &header);
        assert_eq!(out[0].value, serde_json::Value::Null);
        assert_eq!(out[1].value, json!("prod"));
    }
}
