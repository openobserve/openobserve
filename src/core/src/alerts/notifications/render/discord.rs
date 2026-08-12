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

//! Discord webhook embed renderer (§4.2, Phase 1b Task 1).
//!
//! Discord embeds render real markdown in `description` and
//! `fields[].name`/`.value` — including a leading `>` as blockquote syntax,
//! the same trigger class live-verified against Slack's mrkdwn in this
//! session. Unlike Slack, Discord's markdown parser DOES treat a backslash
//! before ASCII punctuation as a literal, so [`markdown::escape_discord_markdown`]
//! (a backslash escape, not entity-encoding) is sufficient with no extra
//! leading-character guard.

use serde_json::{Value, json};

use super::{
    DEFAULT_LINK_LABEL, clamp, dispatchable_url, markdown::escape_discord_markdown, safe_url,
    severity_color,
};
use crate::alerts::notifications::{NotificationContext, resolve::RenderedContent};

/// Discord embed hard caps (<https://discord.com/developers/docs/resources/message#embed-object-embed-limits>).
const TITLE_MAX: usize = 256;
const DESCRIPTION_MAX: usize = 4096;
const FIELD_NAME_MAX: usize = 256;
const FIELD_VALUE_MAX: usize = 1024;
const MAX_FIELDS: usize = 25;

/// Parse a `#RRGGBB` [`severity_color`] string into Discord's decimal color
/// integer. Infallible: the hex strings are our own constants.
fn severity_color_decimal(level: Option<config::meta::alerts::level::AlertLevel>) -> u32 {
    let hex = severity_color(level).trim_start_matches('#');
    u32::from_str_radix(hex, 16).unwrap_or(0)
}

/// Row data, formatted as one more embed field — mirrors how Slack/Teams/
/// Email all surface `rows`/`row_lines` rather than silently dropping them.
fn row_data_field(c: &RenderedContent) -> Option<Value> {
    let text = if let Some(lines) = &c.row_lines {
        lines
            .iter()
            .map(|l| escape_discord_markdown(l))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        c.rows
            .iter()
            .map(|row| {
                row.iter()
                    .map(|(k, v)| {
                        format!(
                            "`{}` {}",
                            escape_discord_markdown(k),
                            escape_discord_markdown(v)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(" · ")
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    if text.is_empty() {
        return None;
    }
    Some(json!({
        "name": "Data",
        "value": clamp(&text, FIELD_VALUE_MAX),
        "inline": false,
    }))
}

pub fn render_discord(c: &RenderedContent, ctx: &NotificationContext) -> Value {
    // Discord's `description` renders real markdown, same dialect risk as
    // Slack's mrkdwn (leading `>` = blockquote) — but the body already comes
    // from `resolve_content` with values backslash-escaped by
    // `escape_markdown` (a CommonMark-compliant escape Discord DOES honor),
    // so no additional escaping runs on the body itself, only on raw field
    // values below (see `escape_discord_markdown`'s doc comment).
    let mut description = clamp(&c.body_markdown, DESCRIPTION_MAX);

    // The first link (design §4.1: `resolve` always appends the alert URL)
    // becomes the embed's `url` — Discord embeds have one clickable title
    // link, not a button list. Any further author-added links have no embed
    // slot to render into and are appended to the description as markdown
    // links instead.
    // Discord validates `embed.url` and rejects the message when it is not an
    // absolute http(s) URL, so an undispatchable first link yields NO embed
    // url rather than an invalid one (#13742's failure class). The markdown
    // links appended to the description below are inert TEXT, so they keep
    // `safe_url`'s neutralize-in-place behaviour instead.
    let embed_url = c
        .links
        .first()
        .and_then(|(_, url)| dispatchable_url(url))
        .map(str::to_string);
    let extra_links = if c.links.is_empty() {
        &c.links[..]
    } else {
        &c.links[1..]
    };
    if !extra_links.is_empty() {
        let extra_text = extra_links
            .iter()
            .map(|(label, url)| {
                let label = if label.is_empty() {
                    DEFAULT_LINK_LABEL
                } else {
                    label.as_str()
                };
                format!("[{}]({})", escape_discord_markdown(label), safe_url(url))
            })
            .collect::<Vec<_>>()
            .join(" · ");
        description = clamp(&format!("{description}\n\n{extra_text}"), DESCRIPTION_MAX);
    }

    let mut fields: Vec<Value> = c
        .fields
        .iter()
        .take(MAX_FIELDS)
        .map(|(name, value)| {
            json!({
                "name": clamp(&escape_discord_markdown(name), FIELD_NAME_MAX),
                "value": clamp(&escape_discord_markdown(value), FIELD_VALUE_MAX),
                "inline": true,
            })
        })
        .collect();
    if fields.len() < MAX_FIELDS
        && let Some(row_field) = row_data_field(c)
    {
        fields.push(row_field);
    }

    let mut embed = json!({
        "title": clamp(&c.title, TITLE_MAX),
        "description": description,
        "color": severity_color_decimal(c.severity),
        "fields": fields,
    });
    if let Some(url) = embed_url {
        embed["url"] = json!(url);
    }

    // Metric-history chart. Preferred: bytes uploaded in the same webhook
    // POST (multipart, `attachment://` reference) — true zero-storage, no
    // URL fetch involved. Fallback: the signed render URL (Discord's proxy
    // fetches once and re-serves from its CDN).
    if ctx.chart_png.is_some() {
        embed["image"] = json!({"url": format!("attachment://{CHART_ATTACHMENT_NAME}")});
    } else if let Some(chart_url) = &ctx.chart_url {
        embed["image"] = json!({"url": chart_url});
    }

    json!({ "embeds": [embed] })
}

/// Filename referenced by the embed's `attachment://` image URL — must match
/// the multipart part filename in `send_discord_with_attachment` (alert.rs).
pub const CHART_ATTACHMENT_NAME: &str = "chart.png";
