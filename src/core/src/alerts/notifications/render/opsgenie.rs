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

//! Opsgenie Alert API renderer (§4.2, Phase 1b Task 1).
//!
//! Opsgenie's `message`/`description`/`details` fields are plain text —
//! Opsgenie does not render markdown in the Alert API, so no markdown
//! escaping applies here (unlike Slack/Discord); values pass through
//! verbatim, matching how `webhook.rs`/`email.rs`'s non-markdown surfaces
//! are handled.

use config::meta::alerts::level::AlertLevel;
use serde_json::{Value, json};

use crate::alerts::notifications::resolve::RenderedContent;

/// Opsgenie's documented cap on `message`.
const MESSAGE_MAX: usize = 130;

/// Opsgenie alert priority (§4.2.1: Critical→P1, Warning→P3, NoData→P3,
/// Ok→P5, None→P2 — a single-level alert is neither "just informational"
/// (P5) nor "must page" (P1), so it lands in the middle).
pub fn opsgenie_priority(level: Option<AlertLevel>) -> &'static str {
    match level {
        Some(AlertLevel::Critical) => "P1",
        Some(AlertLevel::Warning) => "P3",
        Some(AlertLevel::NoData) => "P3",
        Some(AlertLevel::Ok) => "P5",
        None => "P2",
    }
}

pub fn render_opsgenie(c: &RenderedContent) -> Value {
    let details: serde_json::Map<String, Value> = c
        .fields
        .iter()
        .map(|(label, value)| (label.clone(), Value::String(value.clone())))
        .collect();

    json!({
        "message": super::clamp(&c.title, MESSAGE_MAX),
        "description": c.body_markdown,
        "priority": opsgenie_priority(c.severity),
        "details": details,
    })
}
