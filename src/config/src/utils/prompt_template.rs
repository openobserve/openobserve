// Copyright 2026 OpenObserve Inc.

use std::collections::HashSet;

use serde_json::{Map, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenderResult {
    pub text: String,
    pub missing: Vec<String>,
}

/// Returns template variables in first-appearance order, once each.
pub fn template_variables(template: &str) -> Vec<String> {
    render_template(template, &Map::new()).missing
}

/// Renders known `{{ variable }}` tokens and preserves unresolved tokens.
/// Missing variable names are reported in first-appearance order, once each.
pub fn render_template(template: &str, variables: &Map<String, Value>) -> RenderResult {
    let mut text = String::with_capacity(template.len());
    let mut missing = Vec::new();
    let mut missing_seen = HashSet::new();
    let mut rest = template;

    while let Some(open) = rest.find("{{") {
        text.push_str(&rest[..open]);
        let token = &rest[open..];
        let inner = &token[2..];
        let Some(close) = inner.find("}}") else {
            text.push_str(token);
            rest = "";
            break;
        };
        let token_end = 2 + close + 2;
        let original = &token[..token_end];
        let name = inner[..close].trim();
        if !name.is_empty() {
            if let Some(value) = variables.get(name) {
                text.push_str(&render_value(value));
            } else {
                text.push_str(original);
                if missing_seen.insert(name.to_string()) {
                    missing.push(name.to_string());
                }
            }
        } else {
            text.push_str(original);
        }
        rest = &token[token_end..];
    }
    text.push_str(rest);

    RenderResult { text, missing }
}

fn render_value(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn variables_are_unique_and_keep_first_appearance_order() {
        assert_eq!(
            template_variables("{{ second }} {{first}} {{ second }}"),
            vec!["second", "first"]
        );
    }

    #[test]
    fn rendering_preserves_missing_tokens_and_reports_each_once() {
        let variables = json!({"name": "Ada", "count": 2})
            .as_object()
            .unwrap()
            .clone();
        let result = render_template(
            "Hello {{ name }}: {{count}} {{ missing }} {{missing}}",
            &variables,
        );
        assert_eq!(result.text, "Hello Ada: 2 {{ missing }} {{missing}}");
        assert_eq!(result.missing, vec!["missing"]);
    }

    #[test]
    fn arrays_keep_json_order_when_rendered() {
        let variables = json!({"items": ["a", "b"]}).as_object().unwrap().clone();
        assert_eq!(
            render_template("{{items}}", &variables),
            RenderResult {
                text: "[\"a\",\"b\"]".to_string(),
                missing: vec![],
            }
        );
    }
}
