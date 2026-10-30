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

//! HTML email renderer, plus the auto-generated plaintext alternative.
//!
//! Constraints: table-based layout, inline styles only (no `<style>` block, no
//! external CSS — Gmail strips both), and dark-mode-safe (no forced `body`
//! background; every color set explicitly on the element that needs it so a
//! dark client's inversion cannot produce black-on-black).

use super::{DEFAULT_LINK_LABEL, markdown, safe_url, severity_color, severity_label};
use crate::alerts::notifications::{NotificationContext, resolve::RenderedContent};

const TEXT_COLOR: &str = "#202124";
const MUTED_COLOR: &str = "#5F6368";
const BORDER_COLOR: &str = "#DADCE0";

/// Escape a URL for use in an `href` attribute.
///
/// Two layers: the shared [`safe_url`] scheme filter (applied by every
/// renderer) plus HTML-escaping for the attribute context, which is specific
/// to this format.
fn safe_href(url: &str) -> String {
    markdown::escape_html(safe_url(url))
}

/// Content-ID of the inline chart image. The `<img src="cid:...">` here and
/// the attachment's ContentId header in `send_email_notification` (alert.rs)
/// must stay in lockstep.
pub const CHART_CONTENT_ID: &str = "alert-chart";

pub fn render_email(c: &RenderedContent, ctx: &NotificationContext) -> (String, String, String) {
    (
        c.title.clone(),
        html_part(c, ctx.chart_png.is_some()),
        text_part(c),
    )
}

fn html_part(c: &RenderedContent, has_chart: bool) -> String {
    let esc = markdown::escape_html;
    let mut h = String::new();

    h.push_str(&format!(
        r#"<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:{TEXT_COLOR};"><tr><td style="padding:16px;">"#
    ));

    // Severity stripe + badge + title. The stripe alone (a 4px color bar) is
    // easy to miss — especially on mobile or in a client's preview pane, where
    // it can be scrolled out of view or rendered too thin to register as a
    // deliberate signal rather than a layout artifact. The badge is the
    // primary severity cue; the stripe stays as a secondary accent.
    let badge = severity_label(c.severity)
        .map(|label| {
            format!(
                r#"<span style="display:inline-block;margin:0 0 8px 0;padding:2px 8px;border-radius:3px;background-color:{};color:#FFFFFF;font-size:11px;font-weight:700;letter-spacing:0.03em;">{label}</span><br/>"#,
                severity_color(c.severity),
            )
        })
        .unwrap_or_default();
    h.push_str(&format!(
        r#"<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr><td width="4" style="width:4px;background-color:{};"></td><td style="padding:0 0 0 12px;">{badge}<h2 style="margin:0 0 8px 0;font-size:20px;line-height:1.3;color:{TEXT_COLOR};">{}</h2></td></tr></table>"#,
        severity_color(c.severity),
        esc(&c.title),
    ));

    if !c.body_markdown.is_empty() {
        let body = markdown::markdown_to_html(&c.body_markdown);
        if !body.trim().is_empty() {
            h.push_str(&format!(
                r#"<div style="margin:16px 0;color:{TEXT_COLOR};">{}</div>"#,
                body.trim()
            ));
        }
    }

    if !c.fields.is_empty() {
        h.push_str(
            r#"<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:16px 0;">"#,
        );
        for (label, value) in &c.fields {
            h.push_str(&format!(
                r#"<tr><td style="padding:4px 16px 4px 0;color:{MUTED_COLOR};vertical-align:top;white-space:nowrap;">{}</td><td style="padding:4px 0;color:{TEXT_COLOR};">{}</td></tr>"#,
                esc(label),
                esc(value),
            ));
        }
        h.push_str("</table>");
    }

    if let Some(lines) = &c.row_lines {
        if !lines.is_empty() {
            h.push_str(&format!(
                r#"<div style="margin:16px 0;color:{TEXT_COLOR};">{}</div>"#,
                lines
                    .iter()
                    .map(|l| esc(l))
                    .collect::<Vec<_>>()
                    .join("<br>")
            ));
        }
    } else if !c.rows.is_empty() {
        // Column order comes from the first row — `resolve` already ordered
        // every row identically per RowsSpec.columns.
        let headers: Vec<&String> = c.rows[0].iter().map(|(k, _)| k).collect();
        h.push_str(
            r#"<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:16px 0;">"#,
        );
        h.push_str("<tr>");
        for head in &headers {
            h.push_str(&format!(
                r#"<th align="left" style="padding:6px 12px 6px 0;border-bottom:1px solid {BORDER_COLOR};color:{MUTED_COLOR};font-weight:600;">{}</th>"#,
                esc(head)
            ));
        }
        h.push_str("</tr>");
        for row in &c.rows {
            h.push_str("<tr>");
            for (_, value) in row {
                h.push_str(&format!(
                    r#"<td style="padding:6px 12px 6px 0;border-bottom:1px solid {BORDER_COLOR};color:{TEXT_COLOR};">{}</td>"#,
                    esc(value)
                ));
            }
            h.push_str("</tr>");
        }
        h.push_str("</table>");
    }

    // Metric-history chart, embedded as a CID inline attachment — the bytes
    // travel in this same email, so it renders even in clients that block
    // remote images, and nothing is hosted anywhere.
    if has_chart {
        h.push_str(&format!(
            r#"<div style="margin:16px 0;"><img src="cid:{CHART_CONTENT_ID}" width="800" alt="Alert metric chart" style="max-width:100%;height:auto;border:1px solid {BORDER_COLOR};border-radius:4px;"/></div>"#
        ));
    }

    if !c.links.is_empty() {
        h.push_str(r#"<div style="margin:16px 0;">"#);
        for (label, url) in &c.links {
            let is_default_link = label.is_empty();
            let label = if is_default_link {
                DEFAULT_LINK_LABEL
            } else {
                label.as_str()
            };
            // The default "View in OpenObserve" link is the email's primary
            // CTA — mirrors the Slack/Teams fix (filled green button) rather
            // than the outlined-blue-link style used for author-added links,
            // which reads as low-contrast and easy to miss in email clients.
            let style = if is_default_link {
                "display:inline-block;margin:0 8px 8px 0;padding:8px 16px;background-color:#2EB67D;border-radius:4px;color:#FFFFFF;font-weight:600;text-decoration:none;".to_string()
            } else {
                format!(
                    "display:inline-block;margin:0 8px 8px 0;padding:8px 16px;border:1px solid {BORDER_COLOR};border-radius:4px;color:#1A73E8;text-decoration:none;"
                )
            };
            h.push_str(&format!(
                r#"<a href="{}" style="{style}">{}</a>"#,
                safe_href(url),
                esc(label),
            ));
        }
        h.push_str("</div>");
    }

    h.push_str(&format!(
        r#"<div style="margin:24px 0 0 0;padding-top:12px;border-top:1px solid {BORDER_COLOR};color:{MUTED_COLOR};font-size:12px;">Sent by OpenObserve.</div>"#
    ));
    h.push_str("</td></tr></table>");
    h
}

fn text_part(c: &RenderedContent) -> String {
    // Plaintext has no color at all, so the severity label is the ONLY
    // signal available here — not secondary to a stripe as in the HTML part.
    let title = match severity_label(c.severity) {
        Some(label) => format!("[{label}] {}", c.title),
        None => c.title.clone(),
    };
    let mut parts: Vec<String> = vec![title];

    if !c.body_markdown.is_empty() {
        let body = markdown::markdown_to_plaintext(&c.body_markdown);
        if !body.is_empty() {
            parts.push(body);
        }
    }

    if !c.fields.is_empty() {
        parts.push(
            c.fields
                .iter()
                .map(|(l, v)| format!("{l}: {v}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    if let Some(lines) = &c.row_lines {
        if !lines.is_empty() {
            parts.push(lines.join("\n"));
        }
    } else if !c.rows.is_empty() {
        parts.push(
            c.rows
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|(k, v)| format!("{k}: {v}"))
                        .collect::<Vec<_>>()
                        .join(" | ")
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    if !c.links.is_empty() {
        parts.push(
            c.links
                .iter()
                .map(|(label, url)| {
                    let label = if label.is_empty() {
                        DEFAULT_LINK_LABEL
                    } else {
                        label.as_str()
                    };
                    // Same scheme filter as the HTML part — a mail client
                    // linkifies plaintext URLs too.
                    format!("{label}: {}", safe_url(url))
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    parts.push("Sent by OpenObserve.".to_string());
    parts.join("\n\n")
}
