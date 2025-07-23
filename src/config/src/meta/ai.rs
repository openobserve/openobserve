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

use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemPrompt {
    pub id: String,
    pub name: String,
    pub content: String,
    pub version: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_active: bool,
    pub tags: Vec<String>,
}


impl SystemPrompt {
    pub fn new_default(content: String) -> Self {
        let now = Utc::now().timestamp_millis();
        const DEFAULT_VERSION: i32 = 0;
        const DEFAULT_ID: &str = "default";
        Self {
            id: DEFAULT_ID.to_string(),
            name: DEFAULT_ID.to_string(),
            content,
            version: DEFAULT_VERSION,
            created_at: now,
            updated_at: now,
            is_active: true,
            tags: vec![DEFAULT_ID.to_string()],
        }
    }
}