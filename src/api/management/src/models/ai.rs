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

use o2_enterprise::enterprise::ai::agent::meta::{AiMessage, Role};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

/// Maximum Base64-encoded image size (~2 MB of raw data ≈ 2.8 MB Base64)
const MAX_IMAGE_B64_LEN: usize = 3 * 1024 * 1024;

/// Allowed MIME types for image attachments
const ALLOWED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg"];

/// Context-tray chip kinds an attachment may carry (CT-B1).
const ATTACHMENT_KINDS: [&str; 14] = [
    "time",
    "stream",
    "query",
    "panel",
    "alert",
    "pipeline_node",
    "incident",
    "log_row",
    "cell",
    "field",
    "span",
    "query_error",
    "image",
    "report",
];
const MAX_ATTACHMENTS: usize = 20;
const MAX_ATTACHMENT_DATA_BYTES: usize = 32 * 1024;
const MAX_ATTACHMENT_REF_BYTES: usize = 2 * 1024;
const MAX_ATTACHMENT_LABEL_CHARS: usize = 200;

/// Image attachment for multimodal AI chat
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct ImageAttachment {
    /// Base64-encoded image data (max ~2 MB)
    #[serde(deserialize_with = "deserialize_bounded_b64")]
    pub data: String,
    /// MIME type (image/png or image/jpeg)
    #[serde(deserialize_with = "deserialize_mime_type")]
    pub mime_type: String,
    /// Optional filename
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

impl std::fmt::Debug for ImageAttachment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ImageAttachment")
            .field("data_len", &self.data.len())
            .field("mime_type", &self.mime_type)
            .field("filename", &self.filename)
            .finish()
    }
}

fn deserialize_bounded_b64<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::de::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    if s.len() > MAX_IMAGE_B64_LEN {
        return Err(serde::de::Error::custom(format!(
            "image data exceeds maximum size ({} bytes, limit {})",
            s.len(),
            MAX_IMAGE_B64_LEN
        )));
    }
    Ok(s)
}

fn deserialize_mime_type<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::de::Deserializer<'de>,
{
    let s = String::deserialize(deserializer)?;
    if !ALLOWED_IMAGE_TYPES.contains(&s.as_str()) {
        return Err(serde::de::Error::custom(format!(
            "unsupported image type '{}', allowed: {:?}",
            s, ALLOWED_IMAGE_TYPES
        )));
    }
    Ok(s)
}

/// AI chat request for conversational interactions with the OpenObserve AI assistant.
///
/// # Example
/// ```json
/// {
///   "messages": [{"role": "user", "content": "Find errors in the last hour"}],
///   "context": {
///     "start_time": 1768406781751488,
///     "end_time": 1768496804185872,
///     "stream_name": "default",
///     "stream_type": "logs"
///   }
/// }
/// ```
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PromptRequest {
    /// Chat messages in the conversation.
    #[schema(value_type = Vec<Object>)]
    pub messages: Vec<AiMessage>,
    /// Optional model name override.
    #[serde(default)]
    pub model: String,
    /// Optional provider name override.
    #[serde(default)]
    pub provider: String,
    /// Contextual information for the AI assistant. Should include:
    /// - `start_time`: Start of the time range in microseconds (required for search queries)
    /// - `end_time`: End of the time range in microseconds (required for search queries)
    /// - `stream_name`: Current stream being viewed (optional)
    /// - `stream_type`: Type of stream - logs, metrics, traces (optional)
    ///
    /// The frontend should pass the user's currently selected time range and stream context
    /// to enable the AI assistant to search within the relevant data scope.
    ///
    /// Also accepts `client` (the door envelope, `context.client`) and `locale`, sent on as is.
    #[serde(default)]
    #[schema(value_type = Object, example = json!({"start_time": 1768406781751488, "end_time": 1768496804185872, "stream_name": "default", "stream_type": "logs"}))]
    pub context: Map<String, Value>,
    /// Optional image attachments for multimodal queries (max 2MB each, PNG/JPEG only)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<ImageAttachment>>,
    /// Seconds the agent waits for a tool approval before denying it (capped at 600).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm_timeout_secs: Option<u32>,
    /// A finished turn this one regenerates or edits; the new turn is appended, the original kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaces_turn_id: Option<String>,
    /// `chat` never reaches the autonomous incident agent; `rca` is refused on chat routes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<ChatMode>,
    /// An ephemeral turn is never admitted, stored or titled; it may not name a saved chat.
    #[serde(default)]
    pub ephemeral: bool,
    /// Typed context chips, at most 20 per message and 32 KiB of `data` each.
    #[serde(
        default,
        deserialize_with = "deserialize_attachments",
        skip_serializing_if = "Option::is_none"
    )]
    #[schema(value_type = Option<Vec<Object>>)]
    pub attachments: Option<Vec<Attachment>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChatMode {
    Chat,
    Rca,
    GenerateQuery,
    /// A mode this server does not know; the turn is refused with a typed 400, never run as chat.
    #[serde(other)]
    Unsupported,
}

impl ChatMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Rca => "rca",
            Self::GenerateQuery => "generate_query",
            Self::Unsupported => "unsupported",
        }
    }
}

/// One typed context chip; `data` is message content, so `Debug` prints only its size.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct Attachment {
    pub kind: String,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub reference: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub data: Value,
}

impl Attachment {
    fn data_bytes(&self) -> usize {
        serde_json::to_vec(&self.data).map_or(0, |bytes| bytes.len())
    }

    fn ref_bytes(&self) -> usize {
        self.reference
            .as_ref()
            .and_then(|reference| serde_json::to_vec(reference).ok())
            .map_or(0, |bytes| bytes.len())
    }
}

impl std::fmt::Debug for Attachment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Attachment")
            .field("kind", &self.kind)
            .field("data_bytes", &self.data_bytes())
            .finish()
    }
}

impl From<Attachment> for o2_enterprise::enterprise::ai::client::Attachment {
    fn from(attachment: Attachment) -> Self {
        Self {
            kind: attachment.kind,
            reference: attachment.reference.map(Value::Object),
            label: attachment.label.map(Value::String),
            data: attachment.data,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PromptResponse {
    pub role: Role,
    pub content: String,
}

impl From<AiMessage> for PromptResponse {
    fn from(message: AiMessage) -> Self {
        Self {
            role: message.role,
            content: message.content,
        }
    }
}

fn deserialize_attachments<'de, D>(deserializer: D) -> Result<Option<Vec<Attachment>>, D::Error>
where
    D: serde::de::Deserializer<'de>,
{
    let attachments = Option::<Vec<Attachment>>::deserialize(deserializer)?;
    if let Some(problem) = attachments.as_deref().and_then(attachments_problem) {
        return Err(serde::de::Error::custom(problem));
    }
    Ok(attachments)
}

/// Why `attachments` breaks the CT-B1 caps, or `None`; never echoes what the client sent.
fn attachments_problem(attachments: &[Attachment]) -> Option<String> {
    if attachments.len() > MAX_ATTACHMENTS {
        return Some(format!("at most {MAX_ATTACHMENTS} attachments per message"));
    }
    attachments.iter().find_map(|attachment| {
        if !ATTACHMENT_KINDS.contains(&attachment.kind.as_str()) {
            Some("unknown attachment kind".to_string())
        } else if attachment.data_bytes() > MAX_ATTACHMENT_DATA_BYTES {
            Some(format!(
                "attachment data exceeds {MAX_ATTACHMENT_DATA_BYTES} bytes"
            ))
        } else if attachment.ref_bytes() > MAX_ATTACHMENT_REF_BYTES {
            Some(format!(
                "attachment ref exceeds {MAX_ATTACHMENT_REF_BYTES} bytes"
            ))
        } else if attachment
            .label
            .as_ref()
            .is_some_and(|label| label.chars().count() > MAX_ATTACHMENT_LABEL_CHARS)
        {
            Some(format!(
                "attachment label exceeds {MAX_ATTACHMENT_LABEL_CHARS} characters"
            ))
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_attachment_filename_absent_when_none() {
        let img = ImageAttachment {
            data: "abc".to_string(),
            mime_type: "image/png".to_string(),
            filename: None,
        };
        let json = serde_json::to_value(&img).unwrap();
        assert!(!json.as_object().unwrap().contains_key("filename"));
    }

    #[test]
    fn test_image_attachment_filename_present_when_some() {
        let img = ImageAttachment {
            data: "abc".to_string(),
            mime_type: "image/jpeg".to_string(),
            filename: Some("photo.jpg".to_string()),
        };
        let json = serde_json::to_value(&img).unwrap();
        assert!(json.as_object().unwrap().contains_key("filename"));
    }

    #[test]
    fn test_deserialize_image_attachment_valid() {
        let json_str = r#"{"data":"aGVsbG8=","mime_type":"image/png"}"#;
        let img: ImageAttachment = serde_json::from_str(json_str).unwrap();
        assert_eq!(img.mime_type, "image/png");
        assert!(img.filename.is_none());
    }

    #[test]
    fn test_deserialize_image_attachment_invalid_mime_type() {
        let json_str = r#"{"data":"abc","mime_type":"image/gif"}"#;
        let result: Result<ImageAttachment, _> = serde_json::from_str(json_str);
        assert!(result.is_err());
    }

    #[test]
    fn a_legacy_prompt_has_no_mode_ephemeral_or_attachments() {
        let body: PromptRequest = serde_json::from_str(r#"{"messages":[],"unknown":1}"#).unwrap();
        assert!(body.mode.is_none() && !body.ephemeral && body.attachments.is_none());
    }

    #[test]
    fn a_query_prompt_reads_mode_ephemeral_and_typed_attachments() {
        let body: PromptRequest = serde_json::from_value(serde_json::json!({
            "messages": [],
            "mode": "generate_query",
            "ephemeral": true,
            "attachments": [{"kind": "log_row", "ref": {"type": "log"}, "label": "row", "data": {"msg": "secret-row"}}]
        }))
        .unwrap();
        assert_eq!(body.mode, Some(ChatMode::GenerateQuery));
        assert!(body.ephemeral);
        let attachments = body.attachments.unwrap();
        assert_eq!(attachments[0].reference.as_ref().unwrap()["type"], "log");
        assert!(!format!("{attachments:?}").contains("secret-row"));
    }

    #[test]
    fn attachment_caps_and_kinds_are_enforced() {
        let row = serde_json::json!({"kind": "log_row", "data": {"a": 1}});
        let parse = |attachments: Value| {
            serde_json::from_value::<PromptRequest>(
                serde_json::json!({"messages": [], "attachments": attachments}),
            )
        };
        assert!(parse(Value::Array(vec![row.clone(); MAX_ATTACHMENTS])).is_ok());
        assert!(parse(Value::Array(vec![row; MAX_ATTACHMENTS + 1])).is_err());
        let big = "x".repeat(MAX_ATTACHMENT_DATA_BYTES);
        assert!(parse(serde_json::json!([{"kind": "cell", "data": big}])).is_err());
        let unknown = parse(serde_json::json!([{"kind": "secret_file", "data": 1}])).unwrap_err();
        assert!(!unknown.to_string().contains("secret_file"));
        assert!(parse(serde_json::json!(null)).is_ok());
    }

    #[test]
    fn ref_must_be_a_small_object_and_label_a_short_string() {
        let parse = |chip: Value| {
            serde_json::from_value::<PromptRequest>(
                serde_json::json!({"messages": [], "attachments": [chip]}),
            )
        };
        assert!(parse(serde_json::json!({"kind": "cell", "ref": "row-1"})).is_err());
        let big_ref = "r".repeat(MAX_ATTACHMENT_REF_BYTES);
        assert!(parse(serde_json::json!({"kind": "cell", "ref": {"id": big_ref}})).is_err());
        let long = "l".repeat(MAX_ATTACHMENT_LABEL_CHARS + 1);
        assert!(parse(serde_json::json!({"kind": "cell", "label": long})).is_err());
        assert!(parse(serde_json::json!({"kind": "cell", "label": {"html": "<b>"}})).is_err());
        let fine =
            serde_json::json!({"kind": "cell", "ref": {"id": "r1"}, "label": "é".repeat(200)});
        assert!(parse(fine).is_ok());
    }

    #[test]
    fn prompt_mode_accepts_chat_rca_and_generate_query() {
        for (raw, mode) in [
            ("chat", ChatMode::Chat),
            ("rca", ChatMode::Rca),
            ("generate_query", ChatMode::GenerateQuery),
        ] {
            let parsed: ChatMode = serde_json::from_value(serde_json::json!(raw)).unwrap();
            assert_eq!(parsed, mode);
            assert_eq!(mode.as_str(), raw);
        }
    }

    #[test]
    fn an_unknown_mode_parses_as_unsupported_and_never_as_chat() {
        let body = serde_json::json!({"messages": [], "mode": "autonomous"});
        let body: PromptRequest = serde_json::from_value(body).unwrap();
        assert_eq!(body.mode, Some(ChatMode::Unsupported));
    }

    #[test]
    fn test_deserialize_image_attachment_data_too_large() {
        let big = "x".repeat(MAX_IMAGE_B64_LEN + 1);
        let json_str = format!(r#"{{"data":"{}","mime_type":"image/png"}}"#, big);
        let result: Result<ImageAttachment, _> = serde_json::from_str(&json_str);
        assert!(result.is_err());
    }
}
