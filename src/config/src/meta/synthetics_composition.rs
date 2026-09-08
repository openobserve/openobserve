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

//! Pure composition helpers shared by save-time validation, the scheduler's step arithmetic and
//! `resolve`.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::Value;

use super::synthetics::is_composition_action;

pub const COMPOSED_ID_DELIMITER: char = '_';
pub const COMPOSED_NAME_SEPARATOR: &str = " › ";
/// The fields the probe substitutes `{{VAR}}` in; the frontend must match this list (§5.2.1).
const PLACEHOLDER_FIELDS: &[&str] = &["value", "url", "key"];

/// A referenced check's identity and stored steps, as the expander needs them.
#[derive(Debug, Clone)]
pub struct ChildJourney {
    pub id: String,
    pub name: String,
    pub steps: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExpansionError {
    MissingChild(String),
    ChildHoldsReference { child: String, step_id: String },
    IdCollision(String),
    CompositionActionLeaked(String),
}

impl std::fmt::Display for ExpansionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingChild(id) => write!(f, "referenced check '{id}' does not exist"),
            Self::ChildHoldsReference { child, step_id } => write!(
                f,
                "referenced check '{child}' contains a subtest step ('{step_id}'); nesting is limited to one level"
            ),
            Self::IdCollision(id) => {
                write!(f, "expanded step id '{id}' collides with another step")
            }
            Self::CompositionActionLeaked(id) => {
                write!(
                    f,
                    "step '{id}' is a composition action that survived expansion"
                )
            }
        }
    }
}

impl std::error::Error for ExpansionError {}

pub fn subtest_refs(steps: &[Value]) -> Vec<String> {
    steps
        .iter()
        .filter(|s| action_of(s).is_some_and(is_composition_action))
        .filter_map(|s| s.pointer("/subtest/id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

pub fn expanded_step_count(
    own: usize,
    refs: &[String],
    child_counts: &HashMap<String, usize>,
) -> usize {
    // An unreadable or missing child floors at 1, following `DueCheck::try_from`.
    let children: usize = refs
        .iter()
        .map(|id| child_counts.get(id).copied().unwrap_or(1).max(1))
        .sum();
    own.saturating_sub(refs.len()) + children
}

pub fn composed_step_id(ref_step_id: &str, child_step_id: &str) -> String {
    format!("{ref_step_id}{COMPOSED_ID_DELIMITER}{child_step_id}")
}

pub fn composed_step_name(
    ref_name: Option<&str>,
    child_test_name: &str,
    child_step_name: Option<&str>,
) -> String {
    let prefix = ref_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or(child_test_name);
    let step = child_step_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or("step");
    format!("{prefix}{COMPOSED_NAME_SEPARATOR}{step}")
}

pub fn expand_steps(
    parent: &[Value],
    children: &HashMap<String, ChildJourney>,
) -> Result<Vec<Value>, ExpansionError> {
    let mut out = Vec::with_capacity(parent.len());
    let mut seen: HashSet<String> = HashSet::new();
    for step in parent {
        if !action_of(step).is_some_and(is_composition_action) {
            push_unique(&mut out, &mut seen, step.clone())?;
            continue;
        }
        let ref_id = id_of(step);
        let child_id = step
            .pointer("/subtest/id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let child = children
            .get(child_id)
            .ok_or_else(|| ExpansionError::MissingChild(child_id.to_owned()))?;
        for child_step in &child.steps {
            if action_of(child_step).is_some_and(is_composition_action) {
                return Err(ExpansionError::ChildHoldsReference {
                    child: child.id.clone(),
                    step_id: id_of(child_step).to_owned(),
                });
            }
            let mut spliced = child_step.clone();
            spliced["id"] = Value::String(composed_step_id(ref_id, id_of(child_step)));
            spliced["name"] = Value::String(composed_step_name(
                step.get("name").and_then(Value::as_str),
                &child.name,
                child_step.get("name").and_then(Value::as_str),
            ));
            push_unique(&mut out, &mut seen, spliced)?;
        }
    }
    if let Some(id) = leaked_composition_action(&out) {
        return Err(ExpansionError::CompositionActionLeaked(id));
    }
    Ok(out)
}

pub fn leaked_composition_action(steps: &[Value]) -> Option<String> {
    steps
        .iter()
        .find(|s| action_of(s).is_some_and(is_composition_action))
        .map(|leaked| id_of(leaked).to_owned())
}

pub fn placeholders_in(steps: &[Value]) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for step in steps {
        for field in PLACEHOLDER_FIELDS {
            if let Some(text) = step.get(*field).and_then(Value::as_str) {
                collect_placeholders(text, &mut found);
            }
        }
    }
    found
}

fn action_of(step: &Value) -> Option<&str> {
    step.get("action").and_then(Value::as_str)
}

fn id_of(step: &Value) -> &str {
    step.get("id").and_then(Value::as_str).unwrap_or_default()
}

fn push_unique(
    out: &mut Vec<Value>,
    seen: &mut HashSet<String>,
    step: Value,
) -> Result<(), ExpansionError> {
    let id = id_of(&step).to_owned();
    if !seen.insert(id.clone()) {
        return Err(ExpansionError::IdCollision(id));
    }
    out.push(step);
    Ok(())
}

fn collect_placeholders(text: &str, into: &mut BTreeSet<String>) {
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let Some(len) = rest[start + 2..].find("}}") else {
            break;
        };
        let name = rest[start + 2..start + 2 + len].trim();
        if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            into.insert(name.to_owned());
        }
        rest = &rest[start + 2 + len + 2..];
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::*;

    fn nav(id: &str) -> serde_json::Value {
        json!({ "id": id, "action": "navigate", "url": "https://example.com" })
    }

    fn click(id: &str, name: &str) -> serde_json::Value {
        json!({ "id": id, "action": "click", "name": name,
                "locator": { "candidates": [ { "kind": "css", "value": "#x" } ] } })
    }

    fn subtest(id: &str, child: &str) -> serde_json::Value {
        json!({ "id": id, "action": "subtest", "name": "Log in (shared)",
                "subtest": { "id": child } })
    }

    fn login() -> ChildJourney {
        ChildJourney {
            id: "login-test".into(),
            name: "Login".into(),
            steps: vec![nav("c1"), click("c2", "fill email"), click("c3", "submit")],
        }
    }

    fn children() -> HashMap<String, ChildJourney> {
        HashMap::from([("login-test".to_string(), login())])
    }

    #[test]
    fn subtest_refs_keeps_journey_order_and_multiplicity() {
        let steps = [
            nav("s1"),
            subtest("s2", "a"),
            click("s3", "x"),
            subtest("s4", "a"),
            subtest("s5", "b"),
        ];
        assert_eq!(subtest_refs(&steps), vec!["a", "a", "b"]);
    }

    #[test]
    fn expanded_count_is_own_minus_placeholders_plus_children() {
        let counts = HashMap::from([("login-test".to_string(), 13usize)]);
        assert_eq!(
            expanded_step_count(4, &["login-test".to_string()], &counts),
            16
        );
    }

    #[test]
    fn expanded_count_counts_a_twice_referenced_child_twice() {
        let counts = HashMap::from([("goto".to_string(), 3usize)]);
        let refs = ["goto".to_string(), "goto".to_string()];
        assert_eq!(expanded_step_count(5, &refs, &counts), 5 - 2 + 6);
    }

    #[test]
    fn an_unknown_child_floors_at_one_step() {
        assert_eq!(
            expanded_step_count(4, &["missing".to_string()], &HashMap::new()),
            4
        );
    }

    #[test]
    fn composed_ids_join_with_an_underscore() {
        assert_eq!(composed_step_id("s2", "c7"), "s2_c7");
    }

    #[test]
    fn composed_names_prefix_the_reference_name_and_fall_back_to_the_child_test_name() {
        assert_eq!(
            composed_step_name(Some("Log in (shared)"), "Login", Some("fill password")),
            "Log in (shared) › fill password"
        );
        assert_eq!(
            composed_step_name(None, "Login", Some("fill password")),
            "Login › fill password"
        );
        assert_eq!(composed_step_name(None, "Login", None), "Login › step");
    }

    #[test]
    fn expansion_splices_the_child_literally_and_rewrites_ids_and_names() {
        let parent = [nav("s1"), subtest("s2", "login-test"), click("s3", "Logs")];
        let out = expand_steps(&parent, &children()).unwrap();
        let ids: Vec<&str> = out.iter().map(|s| s["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["s1", "s2_c1", "s2_c2", "s2_c3", "s3"]);
        assert_eq!(out[1]["action"], "navigate");
        assert_eq!(out[2]["name"], "Log in (shared) › fill email");
        assert_eq!(out[2]["locator"], login().steps[1]["locator"]);
        assert!(out.iter().all(|s| s.get("subtest").is_none()));
    }

    #[test]
    fn the_same_child_referenced_twice_yields_unique_ids() {
        let parent = [
            nav("s1"),
            subtest("s2", "login-test"),
            subtest("s4", "login-test"),
        ];
        let out = expand_steps(&parent, &children()).unwrap();
        let ids: Vec<&str> = out.iter().map(|s| s["id"].as_str().unwrap()).collect();
        assert_eq!(
            ids,
            ["s1", "s2_c1", "s2_c2", "s2_c3", "s4_c1", "s4_c2", "s4_c3"]
        );
    }

    #[test]
    fn child_step_flags_survive_the_splice() {
        let mut child = login();
        child.steps[1]["optional"] = json!(true);
        let map = HashMap::from([("login-test".to_string(), child)]);
        let out = expand_steps(&[nav("s1"), subtest("s2", "login-test")], &map).unwrap();
        assert_eq!(out[2]["optional"], json!(true));
    }

    #[test]
    fn a_missing_child_is_an_expansion_error() {
        let err = expand_steps(&[nav("s1"), subtest("s2", "nope")], &children()).unwrap_err();
        assert!(matches!(err, ExpansionError::MissingChild(id) if id == "nope"));
    }

    #[test]
    fn a_child_holding_a_reference_is_a_depth_violation() {
        let mut child = login();
        child.steps.push(subtest("c9", "other"));
        let map = HashMap::from([("login-test".to_string(), child)]);
        let err = expand_steps(&[nav("s1"), subtest("s2", "login-test")], &map).unwrap_err();
        assert!(
            matches!(err, ExpansionError::ChildHoldsReference { step_id, .. } if step_id == "c9")
        );
    }

    #[test]
    fn a_composed_id_colliding_with_an_authored_id_is_an_error() {
        let parent = [
            nav("s1"),
            subtest("s2", "login-test"),
            click("s2_c1", "clash"),
        ];
        let err = expand_steps(&parent, &children()).unwrap_err();
        assert!(matches!(err, ExpansionError::IdCollision(id) if id == "s2_c1"));
    }

    #[test]
    fn the_boundary_assertion_names_the_leaked_step() {
        assert_eq!(
            leaked_composition_action(&[nav("s1"), subtest("s2", "x")]),
            Some("s2".to_string())
        );
        assert_eq!(leaked_composition_action(&[nav("s1")]), None);
    }

    #[test]
    fn placeholders_are_collected_from_the_fields_the_probe_substitutes() {
        let steps = [
            json!({ "id": "a", "action": "navigate", "url": "https://{{HOST}}/login" }),
            json!({ "id": "b", "action": "fill", "value": "{{ PASSWORD }}", "name": "{{IGNORED}}" }),
            json!({ "id": "c", "action": "press", "key": "{{KEY}}" }),
        ];
        let found: Vec<String> = placeholders_in(&steps).into_iter().collect();
        assert_eq!(found, ["HOST", "KEY", "PASSWORD"]);
    }
}
