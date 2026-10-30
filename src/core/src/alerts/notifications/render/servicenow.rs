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

//! ServiceNow Table API (`incident`) renderer (§4.2, Phase 1b Task 1).
//!
//! ServiceNow's `short_description`/`description` are plain text fields —
//! the Table API does not render markdown, so values pass through verbatim
//! (same rationale as `opsgenie.rs`).

use serde_json::{Value, json};

use crate::alerts::notifications::resolve::RenderedContent;

/// ServiceNow's documented cap on `short_description`.
const SHORT_DESCRIPTION_MAX: usize = 160;

pub fn render_servicenow(c: &RenderedContent) -> Value {
    let mut description = c.body_markdown.clone();
    if !c.fields.is_empty() {
        let field_lines = c
            .fields
            .iter()
            .map(|(label, value)| format!("{label}: {value}"))
            .collect::<Vec<_>>()
            .join("\n");
        description = format!("{description}\n\n{field_lines}");
    }

    json!({
        "short_description": super::clamp(&c.title, SHORT_DESCRIPTION_MAX),
        "description": description,
    })
}
