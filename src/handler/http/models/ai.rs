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

use o2_enterprise::enterprise::ai::AiMessage;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PromptRequest {
    pub messages: Vec<AiMessage>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub provider: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PromptResponse {
    pub role: String,
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
