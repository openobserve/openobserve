// Copyright 2025 OpenObserve Inc.
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
    #[serde(default)]
    #[schema(value_type = Object, example = json!({"start_time": 1768406781751488, "end_time": 1768496804185872, "stream_name": "default", "stream_type": "logs"}))]
    pub context: Map<String, Value>,
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
