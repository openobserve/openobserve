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

//! o2-ai's opencode 2.x snapshot records, and the 1.x-shaped view the RCA and share readers fold.

use std::borrow::Cow;

use config::utils::json::{Map, Value};
use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;

use super::projection::{obj, py_str, truthy};

pub const SESSION_CREATED: &str = "session.created.2";
pub const SESSION_UPDATED: &str = "session.updated.2";
/// One settled 2.x message, re-recorded whole whenever it changes.
pub const MESSAGE_UPDATED: &str = "message.updated.2";
/// What the user typed, without o2-ai's preamble.
const USER_TEXT_KEY: &str = "o2_user_text";

/// A 2.x message as a 1.x message: its `info` and its parts in content order.
pub struct LegacyMessage {
    pub id: String,
    pub info: Map<String, Value>,
    pub parts: Vec<Map<String, Value>>,
}

impl LegacyMessage {
    /// `None` without an id, or for a kind 1.x has no role for (`idle`, `system`, ...).
    pub fn of(message: &Map<String, Value>, parent_id: Option<&str>) -> Option<Self> {
        let id = message
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())?
            .to_string();
        let role = match message.get("type").and_then(Value::as_str) {
            Some("user") => "user",
            Some("assistant") => "assistant",
            _ => return None,
        };
        let mut info = Map::new();
        info.insert("id".into(), Value::String(id.clone()));
        info.insert("role".into(), Value::String(role.into()));
        if let Some(time) = message.get("time") {
            info.insert("time".into(), time.clone());
        }
        let mut legacy = Self {
            id,
            info,
            parts: Vec::new(),
        };
        if role == "user" {
            let text = Value::String(user_text(message));
            legacy.push_part(format!("{}:text", legacy.id), "text", [("text", text)]);
            return Some(legacy);
        }
        if let Some(parent) = parent_id {
            legacy
                .info
                .insert("parentID".into(), Value::String(parent.into()));
        }
        let content = message.get("content").and_then(Value::as_array);
        for (index, item) in content.into_iter().flatten().enumerate() {
            let Some(item) = item.as_object() else {
                continue;
            };
            let text = || item.get("text").cloned().unwrap_or(Value::Null);
            match item.get("type").and_then(Value::as_str) {
                Some(kind @ ("text" | "reasoning")) => {
                    legacy.push_part(format!("{}:{index}", legacy.id), kind, [("text", text())]);
                }
                Some("tool") => legacy.push_tool(index, item),
                _ => {}
            }
        }
        if let Some(tokens) = message.get("tokens").filter(|t| truthy(t)) {
            let cost = message.get("cost").cloned().unwrap_or(Value::Null);
            let id = format!("{}:step-finish", legacy.id);
            legacy.push_part(
                id,
                "step-finish",
                [("tokens", tokens.clone()), ("cost", cost)],
            );
        }
        Some(legacy)
    }

    fn push_part<const N: usize>(&mut self, id: String, kind: &str, fields: [(&str, Value); N]) {
        let mut part = Map::new();
        part.insert("id".into(), Value::String(id));
        part.insert("messageID".into(), Value::String(self.id.clone()));
        part.insert("type".into(), Value::String(kind.into()));
        for (key, value) in fields {
            part.insert(key.into(), value);
        }
        self.parts.push(part);
    }

    fn push_tool(&mut self, index: usize, item: &Map<String, Value>) {
        let call_id = item
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map_or_else(|| format!("{}:{index}", self.id), str::to_string);
        let empty = Map::new();
        let state = obj(item.get("state")).unwrap_or(&empty);
        let status = state.get("status").cloned().unwrap_or(Value::Null);
        let mut legacy = Map::new();
        legacy.insert("status".into(), status.clone());
        let input = obj(state.get("input")).cloned().unwrap_or_default();
        legacy.insert("input".into(), Value::Object(input));
        if status == "completed"
            && let Some(output) = tool_output_text(state.get("content"))
        {
            legacy.insert("output".into(), Value::String(output));
        }
        if status == "error"
            && let Some(error) = state.get("error")
        {
            legacy.insert("error".into(), error.clone());
        }
        if let Some(metadata) = state.get("metadata") {
            legacy.insert("metadata".into(), metadata.clone());
        }
        if let Some(time) = obj(item.get("time")) {
            let mut span = Map::new();
            for (from, to) in [("created", "start"), ("completed", "end")] {
                if let Some(at) = time.get(from) {
                    span.insert(to.into(), at.clone());
                }
            }
            legacy.insert("time".into(), Value::Object(span));
        }
        let tool = item.get("name").cloned().unwrap_or(Value::Null);
        self.push_part(
            call_id.clone(),
            "tool",
            [
                ("callID", Value::String(call_id)),
                ("tool", tool),
                ("state", Value::Object(legacy)),
            ],
        );
    }
}

/// Whether o2-ai wrote this record from a 2.x session export.
pub fn is_v2_record(event_type: &str) -> bool {
    // Exact types: a stored 1.x event may carry any version suffix, `.2` included.
    [SESSION_CREATED, SESSION_UPDATED, MESSAGE_UPDATED].contains(&event_type)
}

/// The 2.x message a `message.updated.2` record carries.
pub fn record_message(event: &DurableEvent) -> Option<&Map<String, Value>> {
    if event.event_type != MESSAGE_UPDATED {
        return None;
    }
    event.data.get("message").and_then(Value::as_object)
}

/// The parts one stored event shows: a 1.x part update's part, or a 2.x record's message parts.
pub(crate) fn event_parts(event: &DurableEvent) -> Vec<Cow<'_, Map<String, Value>>> {
    if let Some(message) = record_message(event) {
        return LegacyMessage::of(message, None)
            .map(|legacy| legacy.parts.into_iter().map(Cow::Owned).collect())
            .unwrap_or_default();
    }
    super::rca_thread::updated_part(event)
        .map(Cow::Borrowed)
        .into_iter()
        .collect()
}

/// A user message's text: `metadata.o2_user_text`, else the whole `text`.
pub(crate) fn user_text(message: &Map<String, Value>) -> String {
    let typed = obj(message.get("metadata")).and_then(|m| m.get(USER_TEXT_KEY));
    if let Some(Value::String(typed)) = typed {
        return typed.clone();
    }
    message
        .get("text")
        .filter(|t| truthy(t))
        .map(py_str)
        .unwrap_or_default()
}

/// A 2.x tool `content` array's text items joined by newlines; `None` without any.
pub(crate) fn tool_output_text(content: Option<&Value>) -> Option<String> {
    let texts: Vec<String> = content
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_object)
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .map(|item| {
            item.get("text")
                .filter(|t| truthy(t))
                .map(py_str)
                .unwrap_or_default()
        })
        .collect();
    (!texts.is_empty()).then(|| texts.join("\n"))
}

#[cfg(test)]
pub(crate) mod tests {
    use config::utils::json::json;

    use super::*;
    use crate::ai_chat::projection::{Folded, is_injected};

    /// The records of a golden file under `testdata`.
    pub(crate) fn golden_events(name: &str) -> Vec<DurableEvent> {
        let path = format!("{}/src/ai_chat/testdata/{name}", env!("CARGO_MANIFEST_DIR"));
        let body: Value =
            config::utils::json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        body["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| DurableEvent::from_sync_event(e).expect("a durable event"))
            .collect()
    }

    /// A 1.x log as o2-ai would record it on 2.x: one `message.updated.2` per message, in order.
    pub(crate) fn to_v2(events: &[DurableEvent]) -> Vec<DurableEvent> {
        let folded = Folded::fold(events);
        let empty = Map::new();
        let mut records = Vec::new();
        for (msg_id, info) in &folded.infos {
            let parts: Vec<&Map<String, Value>> = folded
                .parts
                .get(msg_id)
                .unwrap_or(&empty)
                .values()
                .filter_map(Value::as_object)
                .collect();
            let message = match info["role"].as_str() {
                Some("user") => user_v2(msg_id, info, &parts),
                Some("assistant") => assistant_v2(msg_id, info, &parts),
                _ => continue,
            };
            records.push(DurableEvent {
                id: format!("evt_{:04}", records.len()),
                aggregate_id: events[0].aggregate_id.clone(),
                seq: records.len() as i64,
                event_type: MESSAGE_UPDATED.to_string(),
                data: json!({"message": message}),
            });
        }
        records
    }

    fn user_v2(id: &str, info: &Value, parts: &[&Map<String, Value>]) -> Value {
        let texts = |injected: Option<bool>| -> String {
            parts
                .iter()
                .filter(|p| p["type"] == "text")
                .filter(|p| injected.is_none_or(|i| is_injected(p) == i))
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n\n")
        };
        json!({
            "id": id, "type": "user", "time": info["time"], "text": texts(None),
            "metadata": {USER_TEXT_KEY: texts(Some(false))},
        })
    }

    fn assistant_v2(id: &str, info: &Value, parts: &[&Map<String, Value>]) -> Value {
        let mut content = Vec::new();
        let mut tokens = [0u64; 4];
        for part in parts {
            let hidden = part.get("synthetic").is_some_and(truthy);
            match part["type"].as_str() {
                Some(kind @ ("text" | "reasoning")) if !hidden => {
                    content.push(json!({"type": kind, "text": part["text"]}));
                }
                Some("tool") => content.push(tool_v2(part)),
                Some("step-finish") => {
                    let t = &part["tokens"];
                    let read = &t["cache"]["read"];
                    for (sum, v) in
                        tokens
                            .iter_mut()
                            .zip([&t["input"], &t["output"], &t["reasoning"], read])
                    {
                        *sum += v.as_u64().unwrap_or(0);
                    }
                }
                _ => {}
            }
        }
        let mut message =
            json!({"id": id, "type": "assistant", "time": info["time"], "content": content});
        if tokens.iter().any(|t| *t > 0) {
            message["tokens"] = json!({
                "input": tokens[0], "output": tokens[1], "reasoning": tokens[2],
                "cache": {"read": tokens[3], "write": 0},
            });
        }
        message
    }

    fn tool_v2(part: &Map<String, Value>) -> Value {
        let state = &part["state"];
        let mut v2 = json!({"status": state["status"], "input": state["input"]});
        match &state["output"] {
            Value::Null => {}
            Value::String(text) => v2["content"] = json!([{"type": "text", "text": text}]),
            other => v2["content"] = json!([{"type": "text", "text": other.to_string()}]),
        }
        match &state["error"] {
            Value::Null => {}
            Value::String(message) => {
                v2["error"] = json!({"type": "tool.execution", "message": message});
            }
            other => v2["error"] = other.clone(),
        }
        if !state["metadata"].is_null() {
            v2["metadata"] = state["metadata"].clone();
        }
        let time = &state["time"];
        json!({
            "type": "tool", "id": part["callID"], "name": part["tool"], "state": v2,
            "time": {"created": time["start"], "completed": time["end"]},
        })
    }

    #[test]
    fn a_recorded_export_reads_as_1x_messages() {
        let events = golden_events("v2_readtool.json");
        assert!(events.iter().all(|e| is_v2_record(&e.event_type)));
        let messages: Vec<&Map<String, Value>> = events.iter().filter_map(record_message).collect();
        assert_eq!(messages.len(), 5);

        let user = LegacyMessage::of(messages[0], None).unwrap();
        assert_eq!(user.info["role"], "user");
        assert_eq!(user.parts.len(), 1);
        assert!(
            user.parts[0]["text"]
                .as_str()
                .unwrap()
                .starts_with("Use the read tool")
        );

        let step = LegacyMessage::of(messages[1], Some(user.id.as_str())).unwrap();
        assert_eq!(step.info["parentID"], json!(user.id));
        assert_eq!(step.info["time"]["completed"], 1_794_478_476_484_i64);
        let tool = &step.parts[0];
        assert_eq!(tool["type"], "tool");
        assert_eq!(tool["tool"], "read");
        assert_eq!(tool["callID"], "call_00_7WDxRCxPs7KzeaiavNBM8514");
        assert_eq!(tool["id"], tool["callID"]);
        assert_eq!(tool["messageID"], json!(step.id));
        assert_eq!(tool["state"]["status"], "completed");
        assert!(
            tool["state"]["output"]
                .as_str()
                .unwrap()
                .ends_with("PELICAN-42.")
        );
        assert_eq!(
            tool["state"]["time"],
            json!({"start": 1_794_478_476_282_i64, "end": 1_794_478_476_470_i64})
        );
        assert_eq!(step.parts[1]["type"], "step-finish");
        assert_eq!(step.parts[1]["tokens"]["input"], 9227);

        let answer = LegacyMessage::of(messages[2], None).unwrap();
        assert_eq!(answer.parts[0]["text"], "PELICAN-42");
        assert!(LegacyMessage::of(messages[3], None).is_none(), "idle");
    }

    #[test]
    fn event_parts_cover_both_generations() {
        let v2 = golden_events("v2_readtool.json");
        let kinds: Vec<String> = v2
            .iter()
            .flat_map(event_parts)
            .map(|p| p["type"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            kinds,
            [
                "text",
                "tool",
                "step-finish",
                "text",
                "step-finish",
                "tool",
                "step-finish"
            ]
        );
        let v1 = golden_events("replay_session.json");
        let parts = v1
            .iter()
            .filter(|e| e.event_type.starts_with("message.part.updated"));
        assert_eq!(v1.iter().flat_map(event_parts).count(), parts.count());
        assert!(v1.iter().all(|e| !is_v2_record(&e.event_type)));
        assert!(!is_v2_record("message.part.updated.2"));
    }

    #[test]
    fn user_text_prefers_what_the_user_typed() {
        let typed = json!({"text": "[Context]\nx\n\nhi", "metadata": {"o2_user_text": "hi"}});
        assert_eq!(user_text(typed.as_object().unwrap()), "hi");
        let plain = json!({"text": "hi there"});
        assert_eq!(user_text(plain.as_object().unwrap()), "hi there");
        assert_eq!(user_text(&Map::new()), "");
        let content =
            json!([{"type": "text", "text": "a"}, {"type": "file"}, {"type": "text", "text": "b"}]);
        assert_eq!(tool_output_text(Some(&content)).as_deref(), Some("a\nb"));
        assert_eq!(tool_output_text(Some(&json!([]))), None);
    }
}
