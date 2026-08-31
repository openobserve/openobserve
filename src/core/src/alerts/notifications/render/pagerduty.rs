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

//! PagerDuty Events API v2 renderer (§4.2, Phase 1b Task 1).
//!
//! Emits only the event body — `routing_key` (the integration key) is
//! destination-level auth, not alert content, so it is never part of what
//! this renderer produces; the destination supplies it (as the legacy
//! `prebuilt_pagerduty` custom template does via its own
//! `{routing_key}` context-attribute substitution — see
//! `config/prebuilt-destinations.json`).

use config::meta::alerts::level::AlertLevel;
use serde_json::{Value, json};

use crate::alerts::notifications::{context::NotificationContext, resolve::RenderedContent};

/// PagerDuty Events API v2 `payload.severity` (one of exactly four values the
/// API accepts: critical | error | warning | info).
pub fn pagerduty_severity(level: Option<AlertLevel>) -> &'static str {
    match level {
        Some(AlertLevel::Critical) => "critical",
        Some(AlertLevel::Warning) => "warning",
        Some(AlertLevel::NoData) => "warning",
        Some(AlertLevel::Ok) => "info",
        // Single-level alert: no severity axis; "error" is the closest
        // Events v2 default for an unclassified firing alert.
        None => "error",
    }
}

/// PagerDuty's documented cap on `payload.summary`.
const SUMMARY_MAX: usize = 1024;

pub fn render_pagerduty(c: &RenderedContent, ctx: &NotificationContext) -> Value {
    let mut custom_details = serde_json::Map::new();
    for (label, value) in &c.fields {
        custom_details.insert(label.clone(), Value::String(value.clone()));
    }
    custom_details.insert("body".to_string(), Value::String(c.body_markdown.clone()));

    // PagerDuty validates `links[].href` server-side and 400s the whole event
    // on a malformed one — the same lost-alert failure as #13742 on Slack, so
    // an undispatchable link is dropped rather than emitted.
    let links: Vec<Value> = c
        .links
        .iter()
        .filter_map(|(label, url)| super::dispatchable_url(url).map(|url| (label, url)))
        .map(|(label, url)| {
            let text = if label.is_empty() {
                super::DEFAULT_LINK_LABEL
            } else {
                label.as_str()
            };
            json!({"href": url, "text": text})
        })
        .collect();

    let mut event = json!({
        "event_action": "trigger",
        "payload": {
            "summary": super::clamp(&c.title, SUMMARY_MAX),
            "source": ctx.stream_name,
            "severity": pagerduty_severity(c.severity),
            "custom_details": custom_details,
        },
        "links": links,
    });

    // Metric-history chart (Events API v2 `images` array). PagerDuty fetches
    // the signed render URL when the incident is displayed; after expiry the
    // slot is simply blank.
    if let Some(chart_url) = &ctx.chart_url {
        event["images"] = json!([{
            "src": chart_url,
            "alt": super::clamp(&c.title, SUMMARY_MAX),
        }]);
    }

    event
}
