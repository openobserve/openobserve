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

//! The AI toolset presets, embedded from `config/prebuilt-ai-toolsets.json` and never read from
//! disk.

use std::{collections::HashSet, sync::LazyLock};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

use crate::meta::oncall::confidence::{ToolClassRule, validate_tool_classes};

const PRESETS_JSON: &str = include_str!("../../../config/prebuilt-ai-toolsets.json");
const KINDS: [&str; 2] = ["mcp", "cli"];
const MAX_GLOB_CHARS: usize = 128;

static PRESETS: LazyLock<PrebuiltAiToolsets> = LazyLock::new(|| load(PRESETS_JSON));

/// The shipped presets: the file's revision and every entry that validated.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct PrebuiltAiToolsets {
    pub revision: u32,
    pub presets: Vec<PrebuiltAiToolset>,
}

/// One preset; `fields` holds what it fills in (URL template, headers, tool lists, ...).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PrebuiltAiToolset {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub revision: u32,
    #[serde(flatten)]
    pub fields: Map<String, Value>,
}

impl PrebuiltAiToolset {
    fn validate(&self) -> Result<(), String> {
        if !KINDS.contains(&self.kind.as_str()) {
            return Err(format!("unknown kind '{}'", self.kind));
        }
        for key in ["allowed_tools", "blocked_tools", "write_tools"] {
            for glob in self.strings(key)? {
                let chars = glob.chars().count();
                if chars == 0
                    || chars > MAX_GLOB_CHARS
                    || glob.chars().any(|c| c.is_whitespace() || c.is_control())
                {
                    return Err(format!("`{key}` entry '{glob}' is not a valid tool glob"));
                }
            }
        }
        if let Some(rules) = self.fields.get("tool_classes") {
            let rules: Vec<ToolClassRule> = serde_json::from_value(rules.clone())
                .map_err(|e| format!("`tool_classes`: {e}"))?;
            validate_tool_classes(&rules)?;
        }
        Ok(())
    }

    fn strings(&self, key: &str) -> Result<Vec<String>, String> {
        match self.fields.get(key) {
            None => Ok(Vec::new()),
            Some(v) => serde_json::from_value(v.clone()).map_err(|e| format!("`{key}`: {e}")),
        }
    }
}

// Each entry is read on its own, so one malformed entry can't take the valid ones with it.
#[derive(Deserialize)]
struct RawFile {
    revision: u32,
    presets: Vec<Value>,
}

/// The shipped presets; an entry that fails its checks is left out with an error log.
pub fn prebuilt_ai_toolsets() -> &'static PrebuiltAiToolsets {
    &PRESETS
}

fn load(json: &str) -> PrebuiltAiToolsets {
    let raw: RawFile = match serde_json::from_str(json) {
        Ok(raw) => raw,
        Err(e) => {
            log::error!("[AI_TOOLSETS] prebuilt-ai-toolsets.json is unreadable: {e}");
            return PrebuiltAiToolsets::default();
        }
    };
    let mut seen = HashSet::new();
    let presets = raw
        .presets
        .into_iter()
        .enumerate()
        .filter_map(|(i, entry)| {
            let id = entry.get("id").and_then(Value::as_str).map(str::to_string);
            let checked = serde_json::from_value::<PrebuiltAiToolset>(entry)
                .map_err(|e| e.to_string())
                .and_then(|preset| {
                    if !seen.insert(preset.id.clone()) {
                        return Err("duplicate id".to_string());
                    }
                    preset.validate().map(|_| preset)
                });
            checked
                .map_err(|e| {
                    let name = id.unwrap_or_else(|| format!("#{i}"));
                    log::error!("[AI_TOOLSETS] preset '{name}' skipped: {e}");
                })
                .ok()
        })
        .collect();
    PrebuiltAiToolsets {
        revision: raw.revision,
        presets,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_shipped_preset_is_valid_and_unique() {
        let file: PrebuiltAiToolsets = serde_json::from_str(PRESETS_JSON).unwrap();
        let mut ids = HashSet::new();
        for preset in &file.presets {
            assert!(ids.insert(&preset.id), "duplicate id {}", preset.id);
            preset
                .validate()
                .unwrap_or_else(|e| panic!("{}: {e}", preset.id));
        }
        let loaded = prebuilt_ai_toolsets();
        assert_eq!(loaded.presets.len(), file.presets.len());
        let ids: Vec<&str> = loaded.presets.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["datadog", "dynatrace", "grafana", "kubectl", "gh"]);
    }

    #[test]
    fn an_invalid_or_duplicate_entry_is_skipped_not_fatal() {
        let file = load(
            r#"{"revision": 2, "presets": [
                {"id": "a", "kind": "mcp", "label": "A", "revision": 1},
                {"id": "a", "kind": "mcp", "label": "A again", "revision": 1},
                {"id": "b", "kind": "teleport", "label": "B", "revision": 1},
                {"id": "c", "kind": "mcp", "label": "C", "revision": 1,
                 "tool_classes": [{"tool": "x", "class": "logs", "args": {"q": "("}}]},
                {"id": "d", "kind": "mcp", "label": "D", "revision": 1, "allowed_tools": ["a b"]},
                {"id": "e", "kind": "mcp", "revision": 1},
                {"id": "f", "kind": "mcp", "label": "F", "revision": "2"},
                "not an object",
                {"id": "g", "kind": "cli", "label": "G", "revision": 1}
            ]}"#,
        );
        assert_eq!(file.revision, 2);
        let ids: Vec<&str> = file.presets.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(
            ids,
            ["a", "g"],
            "malformed siblings don't take valid entries with them"
        );
        assert!(load("not json").presets.is_empty());
    }
}
