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
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq, ToSchema)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prompt_type_from_str() {
        assert_eq!(PromptType::from("system"), PromptType::System);
        assert_eq!(PromptType::from("user"), PromptType::User);
        assert_eq!(PromptType::from("invalid"), PromptType::System); // default
        assert_eq!(PromptType::from(""), PromptType::System); // default
    }

    #[test]
    fn test_prompt_type_display() {
        assert_eq!(format!("{}", PromptType::System), "system");
        assert_eq!(format!("{}", PromptType::User), "user");
    }

    #[test]
    fn test_ai_prompt_user() {
        let prompt = AIPrompt::user("Test user message".to_string());
        assert_eq!(prompt.r#type, PromptType::User);
        assert_eq!(prompt.content, "Test user message");
        assert!(prompt.updated_at > 0); // Should have a timestamp
    }

    #[test]
    fn test_ai_prompt_system() {
        let prompt = AIPrompt::system("Test system message".to_string());
        assert_eq!(prompt.r#type, PromptType::System);
        assert_eq!(prompt.content, "Test system message");
        assert_eq!(prompt.updated_at, 0); // System prompts have timestamp 0
    }

    #[test]
    fn test_prompt_type_default() {
        let default_type = PromptType::default();
        assert_eq!(default_type, PromptType::System);
    }

    #[test]
    fn test_prompt_type_equality() {
        assert_eq!(PromptType::System, PromptType::System);
        assert_eq!(PromptType::User, PromptType::User);
        assert_ne!(PromptType::System, PromptType::User);
    }
}
