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

//! Slack Block Kit renderer (§5.2).

use serde_json::{Value, json};

use super::{
    DEFAULT_LINK_LABEL, clamp,
    markdown::{escape_mrkdwn, guard_leading_blockquote, markdown_to_mrkdwn},
    safe_url, severity_color,
};
use crate::alerts::notifications::{NotificationContext, resolve::RenderedContent};

/// Block Kit's hard cap on `fields` per section block.
const MAX_SECTION_FIELDS: usize = 10;
/// Block Kit's hard cap on `plain_text` in a header block.
const HEADER_MAX: usize = 150;
/// Conservative cap on a mrkdwn section's text (Slack's limit is 3000).
const SECTION_TEXT_MAX: usize = 3000;
/// Block Kit's hard cap on elements in an `actions` block.
const MAX_ACTION_ELEMENTS: usize = 5;

pub fn render_slack(c: &RenderedContent, ctx: &NotificationContext) -> Value {
    let mut blocks: Vec<Value> = Vec::new();

    // Datadog-style clickable title: a bold mrkdwn link section that opens
    // the alert (user-picked over the plain header in a live A/B on a real
    // channel). mrkdwn link syntax breaks on `|` (terminates the label) and
    // `>` (terminates the link), so a title containing either — and a
    // missing/blocked alert URL — falls back to the plain `header` block.
    // The label is escape_mrkdwn'd (entity-encoding `&`/`<`/`>`); the URL is
    // scheme-checked via `safe_url`.
    let title_url = safe_url(&ctx.alert_url);
    if !title_url.is_empty()
        && !title_url.contains(['|', '>', '<'])
        && !c.title.contains('|')
        && title_url != super::BLOCKED_URL
    {
        blocks.push(json!({
            "type": "section",
            "text": {"type": "mrkdwn", "text": format!(
                "*<{}|{}>*",
                title_url,
                escape_mrkdwn(&clamp(&c.title, HEADER_MAX)),
            )}
        }));
    } else {
        // `plain_text` is not mrkdwn — Slack renders it literally, so the
        // title's `&`/`<`/`>` need no entity encoding here and must NOT be
        // encoded or the user would see the entities themselves.
        blocks.push(json!({
            "type": "header",
            "text": {"type": "plain_text", "text": clamp(&c.title, HEADER_MAX), "emoji": true}
        }));
    }

    if !c.body_markdown.is_empty() {
        let text = clamp(&markdown_to_mrkdwn(&c.body_markdown), SECTION_TEXT_MAX);
        if !text.is_empty() {
            blocks.push(json!({"type": "section", "text": {"type": "mrkdwn", "text": text}}));
        }
    }

    if !c.fields.is_empty() {
        let fields: Vec<Value> = c
            .fields
            .iter()
            .take(MAX_SECTION_FIELDS)
            .map(|(label, value)| {
                json!({
                    "type": "mrkdwn",
                    "text": format!(
                        "*{}*\n{}",
                        escape_mrkdwn(label),
                        guard_leading_blockquote(&escape_mrkdwn(value))
                    ),
                })
            })
            .collect();
        blocks.push(json!({"type": "section", "fields": fields}));
    }

    if let Some(lines) = &c.row_lines {
        if !lines.is_empty() {
            let text = lines
                .iter()
                .map(|l| guard_leading_blockquote(&escape_mrkdwn(l)).into_owned())
                .collect::<Vec<_>>()
                .join("\n");
            blocks.push(json!({
                "type": "section",
                "text": {"type": "mrkdwn", "text": clamp(&text, SECTION_TEXT_MAX)}
            }));
        }
    } else if !c.rows.is_empty() {
        let text = c
            .rows
            .iter()
            .map(|row| {
                row.iter()
                    .map(|(k, v)| format!("`{}` {}", escape_mrkdwn(k), escape_mrkdwn(v)))
                    .collect::<Vec<_>>()
                    .join(" · ")
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            blocks.push(json!({
                "type": "section",
                "text": {"type": "mrkdwn", "text": clamp(&text, SECTION_TEXT_MAX)}
            }));
        }
    }

    // Buttons and chart live in a SECOND attachment (same severity color):
    // Slack folds any single tall attachment behind "Show more" — with
    // everything in one attachment the fold was live-observed hiding first
    // the buttons, then the chart. Split in two, each half stays under the
    // fold threshold while the stripe still runs beside all of it (the
    // user-picked "full stripe" layout).
    let mut tail_blocks: Vec<Value> = Vec::new();

    if !c.links.is_empty() {
        // The appended "View in OpenObserve" link (empty label, always last —
        // resolve.rs) is the notification's primary action: it must survive
        // the 5-element cap, so author links only fill the remaining slots.
        let default_count = c.links.iter().filter(|(l, _)| l.is_empty()).count();
        let author_cap = MAX_ACTION_ELEMENTS.saturating_sub(default_count.min(MAX_ACTION_ELEMENTS));
        let mut authored_kept = 0usize;
        let elements: Vec<Value> = c
            .links
            .iter()
            .filter(|(label, _)| {
                if label.is_empty() {
                    true
                } else {
                    authored_kept += 1;
                    authored_kept <= author_cap
                }
            })
            .take(MAX_ACTION_ELEMENTS)
            .map(|(label, url)| {
                let is_default_link = label.is_empty();
                let label = if is_default_link {
                    DEFAULT_LINK_LABEL
                } else {
                    label.as_str()
                };
                let mut button = json!({
                    "type": "button",
                    "text": {"type": "plain_text", "text": clamp(label, 75)},
                    "url": safe_url(url),
                });
                // The default "View in OpenObserve" link is the notification's
                // primary action — Slack's "primary" button style renders it
                // green so it stands out from author-added links (e.g. a
                // runbook), which keep the neutral default style.
                if is_default_link {
                    button["style"] = json!("primary");
                }
                button
            })
            .collect();
        tail_blocks.push(json!({"type": "actions", "elements": elements}));
    }

    // Metric-history chart (stateless signed render URL — Slack's image
    // proxy fetches it once within seconds and caches it permanently; the
    // URL itself expires minutes later). Placed LAST, after the action
    // buttons: if the fold ever does engage on this half, it must swallow
    // the (already-seen-shape) chart bottom edge, never the
    // "View in OpenObserve" button.
    if let Some(chart_url) = &ctx.chart_url {
        tail_blocks.push(json!({
            "type": "image",
            "image_url": chart_url,
            "alt_text": clamp(&c.title, HEADER_MAX),
        }));
    }

    // Live-verified against a real Slack webhook: an attachment carrying
    // `color` with an EMPTY `blocks` array renders nothing at all — Slack
    // silently drops a content-less attachment, stripe included. The first
    // attachment always has the title block; the second is only emitted
    // when it has buttons and/or a chart to show.
    let color = severity_color(c.severity);
    let mut attachments = vec![json!({"color": color, "blocks": blocks})];
    if !tail_blocks.is_empty() {
        attachments.push(json!({"color": color, "blocks": tail_blocks}));
    }
    json!({ "attachments": attachments })
}

// ---------------------------------------------------------------------------
// Send-time image fallback (used by `crate::alerts::alert`)
//
// Slack validates every `image` block's URL server-side at post time: if its
// image proxy cannot fetch the URL (VPN-only `ZO_WEB_URL`, private DNS), it
// rejects the ENTIRE message with `400 invalid_attachments` — live-verified
// against a real webhook with both a private IP and an NXDOMAIN host. Without
// recovery the alert is silently lost and every scheduler retry bounces the
// same way.
// ---------------------------------------------------------------------------

/// Epoch-seconds of the last Slack rejection caused by an unfetchable image
/// URL; 0 = never. Process-wide by design: Slack's proxy fetches from the
/// public internet, so whether it can reach this deployment is a property of
/// `ZO_WEB_URL`, not of any one destination — one bounced send proves every
/// Slack send will bounce.
static IMAGES_UNDELIVERABLE_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// How long sends keep pre-stripping images after a rejection before probing
/// with a full payload again. Bounds the cost of an unreachable URL to one
/// wasted POST per hour, and self-heals within the hour once it's fixed.
const IMAGES_RETRY_SECS: u64 = 3600;

/// Record that Slack just rejected a message because it could not fetch our
/// image URL.
pub fn mark_images_undeliverable(now_secs: u64) {
    IMAGES_UNDELIVERABLE_AT.store(now_secs, std::sync::atomic::Ordering::Relaxed);
}

/// True while sends should pre-strip image blocks instead of paying a
/// guaranteed reject-and-resend round trip.
pub fn images_undeliverable(now_secs: u64) -> bool {
    let at = IMAGES_UNDELIVERABLE_AT.load(std::sync::atomic::Ordering::Relaxed);
    at != 0 && now_secs.saturating_sub(at) < IMAGES_RETRY_SECS
}

/// Remove every `image` block from a Slack payload — top-level `blocks` and
/// each attachment's `blocks` — dropping any attachment left with no blocks
/// (an empty-`blocks` attachment renders a bare color stripe fragment).
/// Returns `None` when the payload isn't JSON or has no image block, i.e.
/// when stripping cannot change the outcome.
pub fn strip_image_blocks(msg: &str) -> Option<String> {
    let mut v: Value = serde_json::from_str(msg).ok()?;
    let mut removed = false;
    let mut strip = |blocks: &mut Vec<Value>| {
        let before = blocks.len();
        blocks.retain(|b| b.get("type").and_then(Value::as_str) != Some("image"));
        removed |= blocks.len() != before;
    };
    if let Some(blocks) = v.get_mut("blocks").and_then(Value::as_array_mut) {
        strip(blocks);
    }
    if let Some(attachments) = v.get_mut("attachments").and_then(Value::as_array_mut) {
        for a in attachments.iter_mut() {
            if let Some(blocks) = a.get_mut("blocks").and_then(Value::as_array_mut) {
                strip(blocks);
            }
        }
        // A legacy attachment (no `blocks` key) is its own content — keep it.
        attachments.retain(|a| {
            a.get("blocks")
                .and_then(Value::as_array)
                .is_none_or(|b| !b.is_empty())
        });
    }
    removed.then(|| v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_removes_image_blocks_but_keeps_attachments_with_content() {
        let msg = r##"{"attachments":[
            {"color":"#c00","blocks":[{"type":"section"}]},
            {"color":"#c00","blocks":[{"type":"actions"},{"type":"image","image_url":"http://x/c.png","alt_text":"t"}]}
        ]}"##;
        let out = strip_image_blocks(msg).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let attachments = v["attachments"].as_array().unwrap();
        assert_eq!(attachments.len(), 2, "actions attachment must survive");
        assert_eq!(attachments[1]["blocks"].as_array().unwrap().len(), 1);
        assert!(!out.contains("\"image\""));
    }

    #[test]
    fn strip_drops_attachment_left_empty() {
        let msg = r##"{"attachments":[
            {"color":"#c00","blocks":[{"type":"section"}]},
            {"color":"#c00","blocks":[{"type":"image","image_url":"http://x/c.png","alt_text":"t"}]}
        ]}"##;
        let v: Value = serde_json::from_str(&strip_image_blocks(msg).unwrap()).unwrap();
        assert_eq!(v["attachments"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn strip_handles_top_level_blocks_from_custom_templates() {
        let msg =
            r#"{"blocks":[{"type":"section"},{"type":"image","image_url":"u","alt_text":"t"}]}"#;
        let v: Value = serde_json::from_str(&strip_image_blocks(msg).unwrap()).unwrap();
        assert_eq!(v["blocks"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn strip_returns_none_when_nothing_to_do() {
        assert!(
            strip_image_blocks(r#"{"attachments":[{"blocks":[{"type":"section"}]}]}"#).is_none()
        );
        assert!(strip_image_blocks("not json").is_none());
        assert!(strip_image_blocks(r#"{"text":"plain"}"#).is_none());
    }

    #[test]
    fn undeliverable_flag_trips_then_expires_after_retry_window() {
        assert!(!images_undeliverable(999));
        mark_images_undeliverable(1_000);
        assert!(images_undeliverable(1_000));
        assert!(images_undeliverable(1_000 + IMAGES_RETRY_SECS - 1));
        assert!(!images_undeliverable(1_000 + IMAGES_RETRY_SECS));
    }
}
