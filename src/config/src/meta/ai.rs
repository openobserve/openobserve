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

use std::fmt::Display;

use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PromptType {
    #[default]
    System,
    User,
}

impl From<&str> for PromptType {
    fn from(value: &str) -> Self {
        match value {
            "system" => Self::System,
            "user" => Self::User,
            _ => Self::default(),
        }
    }
}

impl Display for PromptType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PromptType::System => write!(f, "system"),
            PromptType::User => write!(f, "user"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AIPrompt {
    pub r#type: PromptType,
    pub content: String,
    pub updated_at: i64,
}

impl AIPrompt {
    fn new(r#type: PromptType, content: String) -> Self {
        let updated_at = if r#type == PromptType::System {
            0
        } else {
            Utc::now().timestamp_millis()
        };

        Self {
            r#type,
            content,
            updated_at,
        }
    }

    /// Returns a new user prompt
    pub fn user(content: String) -> Self {
        Self::new(PromptType::User, content)
    }

    /// Returns a new system prompt
    pub fn system(content: String) -> Self {
        Self::new(PromptType::System, content)
    }
}
