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

//! Microsoft Teams renderers — Adaptive Card (Power Automate / Workflows) and
//! the deprecated O365 MessageCard.

use config::meta::alerts::level::AlertLevel;
use serde_json::{Value, json};

use super::{
    DEFAULT_LINK_LABEL, clamp, dispatchable_url,
    markdown::{escape_html, markdown_to_plaintext},
    severity_color,
};
use crate::alerts::notifications::{NotificationContext, resolve::RenderedContent};

/// Adaptive Cards' text color vocabulary for the title block.
///
/// Exhaustive over `AlertLevel` on purpose — no `_` wildcard — so adding a
/// variant is a compile error here rather than a silent fallthrough to
/// "default". Matches `severity_color`'s discipline.
fn adaptive_color(level: Option<AlertLevel>) -> &'static str {
    match level {
        Some(AlertLevel::Critical) => "attention",
        Some(AlertLevel::Warning) => "warning",
        Some(AlertLevel::Ok) => "good",
        // NoData has no Adaptive Cards equivalent; "default" is deliberate.
        Some(AlertLevel::NoData) => "default",
        // Single-level alert: no severity axis to color by.
        None => "default",
    }
}

/// Adaptive Card TextBlocks render a small markdown subset and are NOT HTML —
/// raw `<`/`&` are shown literally, so the escaping job here is to strip the
/// markdown that Teams would misinterpret rather than to entity-encode.
/// `markdown_to_plaintext` does exactly that: markup characters that came from
/// authored markdown are consumed, and any characters that came from a data
/// value are left as inert text.
fn card_text(s: &str) -> String {
    markdown_to_plaintext(s)
}

pub fn render_teams_adaptive_card(c: &RenderedContent, ctx: &NotificationContext) -> Value {
    let mut body: Vec<Value> = vec![json!({
        "type": "TextBlock",
        "text": card_text(&c.title),
        "weight": "Bolder",
        "size": "Large",
        "wrap": true,
        "color": adaptive_color(c.severity),
    })];

    if !c.body_markdown.is_empty() {
        let text = card_text(&c.body_markdown);
        if !text.is_empty() {
            body.push(json!({"type": "TextBlock", "text": text, "wrap": true}));
        }
    }

    if !c.fields.is_empty() {
        let facts: Vec<Value> = c
            .fields
            .iter()
            .map(|(t, v)| json!({"title": card_text(t), "value": card_text(v)}))
            .collect();
        body.push(json!({"type": "FactSet", "facts": facts}));
    }

    if let Some(lines) = &c.row_lines {
        if !lines.is_empty() {
            body.push(json!({
                "type": "TextBlock",
                "text": lines.iter().map(|l| card_text(l)).collect::<Vec<_>>().join("\n\n"),
                "wrap": true,
            }));
        }
    } else if !c.rows.is_empty() {
        let text = c
            .rows
            .iter()
            .map(|row| {
                row.iter()
                    .map(|(k, v)| format!("{}: {}", card_text(k), card_text(v)))
                    .collect::<Vec<_>>()
                    .join(" · ")
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        if !text.is_empty() {
            body.push(json!({"type": "TextBlock", "text": text, "wrap": true}));
        }
    }

    // Metric-history chart. Teams clients re-fetch image URLs on view, so
    // after the signed URL's expiry the image slot goes blank — accepted in
    // the design (fresh alerts are when the chart matters; the TTL env is
    // the escape hatch).
    if let Some(chart_url) = &ctx.chart_url {
        body.push(json!({
            "type": "Image",
            "url": chart_url,
            "altText": card_text(&c.title),
        }));
    }

    // `Action.OpenUrl` requires an absolute http(s) URL: a relative one or the
    // blocked placeholder makes Teams reject the card (the same failure class
    // as #13742 on Slack), so an undispatchable link is dropped, not emitted.
    let actions: Vec<Value> = c
        .links
        .iter()
        .filter_map(|(label, url)| dispatchable_url(url).map(|url| (label, url)))
        .map(|(label, url)| {
            let is_default_link = label.is_empty();
            let mut action = json!({
                "type": "Action.OpenUrl",
                "title": if is_default_link { DEFAULT_LINK_LABEL.to_string() } else { card_text(label) },
                "url": url,
            });
            // Mirrors the Slack "primary"-style fix: the default
            // "View in OpenObserve" action is the card's primary CTA and
            // gets Adaptive Card's "positive" style (renders filled/green in
            // Teams) so it stands out from author-added links.
            if is_default_link {
                action["style"] = json!("positive");
            }
            action
        })
        .collect();

    json!({
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "contentUrl": Value::Null,
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": body,
                "actions": actions,
            }
        }]
    })
}

pub fn render_teams_message_card(c: &RenderedContent) -> Value {
    // MessageCard `text` and `activityTitle` ARE rendered as HTML-ish markup
    // by the O365 connector, so values must be entity-encoded here.
    let title = escape_html(&card_text(&c.title));

    let mut section = json!({
        "activityTitle": title,
        "markdown": false,
    });

    let mut text_parts: Vec<String> = Vec::new();
    if !c.body_markdown.is_empty() {
        let t = escape_html(&card_text(&c.body_markdown)).replace('\n', "<br>");
        if !t.is_empty() {
            text_parts.push(t);
        }
    }
    if let Some(lines) = &c.row_lines {
        if !lines.is_empty() {
            text_parts.push(
                lines
                    .iter()
                    .map(|l| escape_html(l))
                    .collect::<Vec<_>>()
                    .join("<br>"),
            );
        }
    } else if !c.rows.is_empty() {
        let t = c
            .rows
            .iter()
            .map(|row| {
                row.iter()
                    .map(|(k, v)| format!("{}: {}", escape_html(k), escape_html(v)))
                    .collect::<Vec<_>>()
                    .join(" &middot; ")
            })
            .collect::<Vec<_>>()
            .join("<br>");
        if !t.is_empty() {
            text_parts.push(t);
        }
    }
    section["text"] = json!(text_parts.join("<br><br>"));

    if !c.fields.is_empty() {
        section["facts"] = json!(
            c.fields
                .iter()
                .map(|(n, v)| json!({"name": escape_html(n), "value": escape_html(v)}))
                .collect::<Vec<_>>()
        );
    }

    // `OpenUri` targets must be absolute http(s) URIs — the O365 connector
    // rejects anything else, so undispatchable links are dropped (see the
    // Adaptive Card renderer above and #13742).
    let actions: Vec<Value> = c
        .links
        .iter()
        .filter_map(|(label, url)| dispatchable_url(url).map(|url| (label, url)))
        .map(|(label, url)| {
            json!({
                "@type": "OpenUri",
                "name": if label.is_empty() { DEFAULT_LINK_LABEL.to_string() } else { escape_html(label) },
                "targets": [{"os": "default", "uri": url}],
            })
        })
        .collect();

    json!({
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": severity_color(c.severity).trim_start_matches('#'),
        // `summary` is the notification-toast line; MessageCard rejects a card
        // with neither text nor summary, and it must never be empty.
        "summary": clamp(&title, 200),
        "sections": [section],
        "potentialAction": actions,
    })
}
