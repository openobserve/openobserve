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

//! Prompt information extraction

use std::collections::HashMap;

use config::utils::json;

use crate::traces::otel::attributes::{GenAiAttributes, LangfuseAttributes};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PromptAttribution {
    pub name: Option<String>,
    pub version: Option<i64>,
    pub label: Option<String>,
}

pub struct PromptExtractor;

impl PromptExtractor {
    pub fn extract(&self, attributes: &HashMap<String, json::Value>) -> PromptAttribution {
        PromptAttribution {
            name: string_with_fallback(
                attributes,
                GenAiAttributes::PROMPT_NAME,
                LangfuseAttributes::PROMPT_NAME,
            ),
            version: version_with_fallback(
                attributes,
                GenAiAttributes::PROMPT_VERSION,
                LangfuseAttributes::PROMPT_VERSION,
            ),
            label: string_with_fallback(
                attributes,
                GenAiAttributes::PROMPT_LABEL,
                LangfuseAttributes::PROMPT_LABEL,
            ),
        }
    }
}

fn string_with_fallback(
    attributes: &HashMap<String, json::Value>,
    official: &str,
    fallback: &str,
) -> Option<String> {
    match attributes.get(official) {
        Some(value) => value.as_str().map(ToString::to_string),
        None => attributes
            .get(fallback)
            .and_then(json::Value::as_str)
            .map(ToString::to_string),
    }
}

fn version_with_fallback(
    attributes: &HashMap<String, json::Value>,
    official: &str,
    fallback: &str,
) -> Option<i64> {
    match attributes.get(official) {
        Some(value) => parse_version(value),
        None => attributes.get(fallback).and_then(parse_version),
    }
}

fn parse_version(value: &json::Value) -> Option<i64> {
    let version = match value {
        json::Value::Number(value) => value.as_i64()?,
        json::Value::String(value)
            if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            value.parse().ok()?
        }
        _ => return None,
    };
    (version > 0).then_some(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_structured_official_prompt_attribution() {
        let attrs = HashMap::from([
            (
                GenAiAttributes::PROMPT_NAME.to_string(),
                json::json!("support-answer"),
            ),
            (GenAiAttributes::PROMPT_VERSION.to_string(), json::json!(3)),
            (
                GenAiAttributes::PROMPT_LABEL.to_string(),
                json::json!("production"),
            ),
        ]);

        assert_eq!(
            PromptExtractor.extract(&attrs),
            PromptAttribution {
                name: Some("support-answer".to_string()),
                version: Some(3),
                label: Some("production".to_string()),
            }
        );
    }

    #[test]
    fn official_fields_take_precedence_over_langfuse_aliases() {
        let attrs = HashMap::from([
            (
                GenAiAttributes::PROMPT_NAME.to_string(),
                json::json!("official"),
            ),
            (
                LangfuseAttributes::PROMPT_NAME.to_string(),
                json::json!("legacy"),
            ),
            (
                GenAiAttributes::PROMPT_VERSION.to_string(),
                json::json!("4"),
            ),
            (
                LangfuseAttributes::PROMPT_VERSION.to_string(),
                json::json!("2"),
            ),
            (
                GenAiAttributes::PROMPT_LABEL.to_string(),
                json::json!("candidate"),
            ),
            (
                LangfuseAttributes::PROMPT_LABEL.to_string(),
                json::json!("production"),
            ),
        ]);

        assert_eq!(
            PromptExtractor.extract(&attrs),
            PromptAttribution {
                name: Some("official".to_string()),
                version: Some(4),
                label: Some("candidate".to_string()),
            }
        );
    }

    #[test]
    fn falls_back_to_symmetrical_langfuse_aliases() {
        let attrs = HashMap::from([
            (
                LangfuseAttributes::PROMPT_NAME.to_string(),
                json::json!("legacy"),
            ),
            (
                LangfuseAttributes::PROMPT_VERSION.to_string(),
                json::json!("7"),
            ),
            (
                LangfuseAttributes::PROMPT_LABEL.to_string(),
                json::json!("staging"),
            ),
        ]);

        assert_eq!(
            PromptExtractor.extract(&attrs),
            PromptAttribution {
                name: Some("legacy".to_string()),
                version: Some(7),
                label: Some("staging".to_string()),
            }
        );
    }

    #[test]
    fn rejects_malformed_or_non_positive_versions_without_alias_fallback() {
        for value in [
            json::json!(0),
            json::json!(-1),
            json::json!(1.5),
            json::json!("0"),
            json::json!("-2"),
            json::json!("v3"),
        ] {
            let attrs = HashMap::from([
                (GenAiAttributes::PROMPT_VERSION.to_string(), value),
                (
                    LangfuseAttributes::PROMPT_VERSION.to_string(),
                    json::json!("9"),
                ),
            ]);
            assert_eq!(PromptExtractor.extract(&attrs).version, None);
        }
    }
}
