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

//! Markdown conversion for the renderers.
//!
//! The content document's body is authored as markdown. Each wire format wants
//! a different dialect of it:
//!
//! * Slack wants **mrkdwn** — `*bold*`, `_italic_`, `` `code` ``, `<url|text>` — with `&`, `<`, `>`
//!   escaped as HTML entities in every text run.
//! * HTML email wants real HTML with injection neutralized.
//! * Plaintext (email alternative, Adaptive Card fallbacks) wants the text runs only.
//!
//! Escaping is applied to TEXT events only, before markup characters are
//! added, so the markup we emit is never itself escaped.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// Undo `resolve.rs`'s `escape_markdown` backslash-escaping for surfaces
/// CommonMark itself never processes escapes in — inline/block code.
///
/// `escape_markdown` puts a `\` before ASCII punctuation so a substituted
/// value can't inject markdown STRUCTURE (e.g. `alert_operator = ">="`
/// wouldn't be parsed as a blockquote). That works for text runs because
/// `pulldown_cmark`'s `Event::Text` un-escapes `\>` back to `>` during
/// parsing. Code spans/blocks are verbatim per the CommonMark spec — escapes
/// are NEVER processed inside them — so `Event::Code`/fenced-code text comes
/// back with the literal backslash still attached. Left alone, users see
/// `\>\=` instead of `>=` in Slack. This strips a backslash immediately
/// preceding ASCII punctuation, mirroring exactly what `escape_markdown`
/// added and nothing else (a user-typed `\n` describing a newline, for
/// instance, is untouched — `n` is not ASCII punctuation).
fn unescape_markdown_source(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\'
            && let Some(&next) = chars.peek()
            && next.is_ascii_punctuation()
        {
            continue; // drop the backslash, keep the punctuation
        }
        out.push(c);
    }
    out
}

/// Escape a raw string for Slack mrkdwn.
///
/// Slack's rule (<https://api.slack.com/reference/surfaces/formatting>): only
/// `&`, `<` and `>` are special in message text and must be HTML-entity
/// encoded. `&` must go first or the other two would be double-encoded.
pub fn escape_mrkdwn(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Guard mrkdwn text against Slack's blockquote trigger.
///
/// Live-verified against a real Slack webhook: `>` as the first character of
/// an mrkdwn text object's content is parsed as blockquote syntax — Slack
/// consumes the `>` as structure and shows only what follows it. This is
/// true even when the `>` has been HTML-entity-encoded (`&gt;`) or
/// backslash-escaped (`\>`); Slack's docs describe entity-encoding as
/// suppressing `>`'s parsing role for *link* syntax, but blockquote
/// detection runs on the raw leading byte regardless. Only a character
/// before the `>` defeats it — a single leading space is enough and Slack
/// trims it visually, so it is invisible in the rendered message.
///
/// Must run on the FINAL mrkdwn text (after [`escape_mrkdwn`]): live-verified
/// against a real Slack webhook that `&gt;` — the entity-encoded form —
/// triggers the blockquote parser exactly like a raw `>` does, so the check
/// below matches both.
pub fn guard_leading_blockquote(s: &str) -> std::borrow::Cow<'_, str> {
    if s.starts_with('>') || s.starts_with("&gt;") {
        std::borrow::Cow::Owned(format!(" {s}"))
    } else {
        std::borrow::Cow::Borrowed(s)
    }
}

/// Escape a raw string for Discord markdown embed fields.
///
/// Discord embed `fields[].name`/`.value` render real markdown (bold,
/// italic, code, links, AND blockquote via a leading `>` — same trigger
/// class live-verified against Slack). Field values come from
/// [`super::super::resolve::substitute_raw`], which is deliberately
/// unescaped (design: escaping is each renderer's own job, see this
/// module's parent doc comment). Discord's markdown parser (unlike Slack's
/// mrkdwn) DOES process a backslash before ASCII punctuation as a literal —
/// the same mechanism `resolve.rs`'s body-only `escape_markdown` uses — so a
/// backslash here is sufficient and needs no additional leading-character
/// guard.
pub fn escape_discord_markdown(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii_punctuation() {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Escape a raw string for HTML text content / attribute values.
pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn parser(md: &str) -> Parser<'_> {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);
    Parser::new_ext(md, opts)
}

/// Convert markdown to Slack mrkdwn.
///
/// Raw HTML in the source (e.g. a `<script>` tag pasted into an alert value)
/// is treated as TEXT and escaped, never passed through as markup.
pub fn markdown_to_mrkdwn(md: &str) -> String {
    let mut out = String::new();
    // Link text is buffered so it can be emitted as `<url|text>`.
    let mut link_stack: Vec<(String, usize)> = Vec::new();
    let mut list_depth = 0usize;
    // Fenced/indented code blocks are verbatim per CommonMark — their `Text`
    // events, like `Code` spans, need `unescape_markdown_source` (see there
    // for why). Paragraph/heading `Text` must NOT get it a second time —
    // `pulldown_cmark` already consumed those escapes during parsing.
    let mut in_code_block = false;

    for event in parser(md) {
        match event {
            Event::Start(Tag::Strong) | Event::End(TagEnd::Strong) => out.push('*'),
            Event::Start(Tag::Emphasis) | Event::End(TagEnd::Emphasis) => out.push('_'),
            Event::Start(Tag::Strikethrough) | Event::End(TagEnd::Strikethrough) => {
                out.push('~');
            }
            Event::Code(code) => {
                out.push('`');
                out.push_str(&escape_mrkdwn(&unescape_markdown_source(&code)));
                out.push('`');
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                link_stack.push((dest_url.to_string(), out.len()));
            }
            Event::End(TagEnd::Link) => {
                if let Some((url, start)) = link_stack.pop() {
                    let text: String = out.split_off(start);
                    out.push('<');
                    out.push_str(&escape_mrkdwn(&url));
                    if !text.is_empty() {
                        out.push('|');
                        out.push_str(&text);
                    }
                    out.push('>');
                }
            }
            // mrkdwn has no heading syntax — every level renders as a bold
            // line, so `level` is intentionally unused.
            Event::Start(Tag::Heading { .. }) => {
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
                out.push('*');
            }
            Event::End(TagEnd::Heading(_)) => out.push('*'),
            Event::Start(Tag::List(_)) => {
                list_depth += 1;
            }
            Event::End(TagEnd::List(_)) => {
                list_depth = list_depth.saturating_sub(1);
            }
            Event::Start(Tag::Item) => {
                if !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                for _ in 1..list_depth {
                    out.push_str("    ");
                }
                out.push_str("• ");
            }
            Event::End(TagEnd::Item) => out.push('\n'),
            Event::Start(Tag::Paragraph) => {
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
            }
            Event::End(TagEnd::Paragraph) => {}
            Event::Start(Tag::BlockQuote(_)) => {
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
                out.push_str("> ");
            }
            Event::Start(Tag::CodeBlock(_)) => {
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
                out.push_str("```\n");
                in_code_block = true;
            }
            Event::End(TagEnd::CodeBlock) => {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("```");
                in_code_block = false;
            }
            // Raw HTML is never markup here — escape it as literal text.
            // A block-level `Html` event is its own block, so it needs the
            // same paragraph separation a `Paragraph` start would get;
            // without it the escaped text runs onto the previous block.
            Event::Html(t) => {
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
                out.push_str(escape_mrkdwn(&t).trim_end());
            }
            Event::Text(t) if in_code_block => {
                out.push_str(&escape_mrkdwn(&unescape_markdown_source(&t)));
            }
            Event::Text(t) | Event::InlineHtml(t) => {
                out.push_str(&escape_mrkdwn(&t));
            }
            Event::SoftBreak | Event::HardBreak => out.push('\n'),
            Event::Rule => {
                trim_trailing_blank(&mut out);
                out.push_str("\n\n───");
            }
            _ => {}
        }
    }
    out.trim().to_string()
}

fn trim_trailing_blank(out: &mut String) {
    while out.ends_with('\n') {
        out.pop();
    }
}

/// Convert markdown to HTML.
///
/// `pulldown_cmark::html::push_html` escapes text runs; raw HTML in the source
/// would ordinarily be passed through verbatim, so this filters `Html` /
/// `InlineHtml` events into escaped text first. That is the injection defense:
/// a `<script>` in an alert value can never reach the mail body as markup.
pub fn markdown_to_html(md: &str) -> String {
    let mut in_code_block = false;
    let events = parser(md).map(move |e| match e {
        Event::Html(t) => Event::Text(t),
        Event::InlineHtml(t) => Event::Text(t),
        // A single newline is a CommonMark *soft* break, which HTML renders as
        // a space — so two authored lines silently join into one. The mrkdwn
        // and plaintext walkers both emit a real newline here, and an alert
        // author pressing Enter means "new line", not "same paragraph". Match
        // the other two targets so what they preview is what gets delivered.
        Event::SoftBreak => Event::HardBreak,
        // Code spans/blocks are verbatim per CommonMark — see
        // unescape_markdown_source's doc comment. pulldown_cmark's own HTML
        // renderer does not strip the backslashes escape_markdown added, so
        // this must, the same as the mrkdwn walker below.
        Event::Code(t) => Event::Code(unescape_markdown_source(&t).into()),
        Event::Start(Tag::CodeBlock(_)) => {
            in_code_block = true;
            e
        }
        Event::End(TagEnd::CodeBlock) => {
            in_code_block = false;
            e
        }
        Event::Text(t) if in_code_block => Event::Text(unescape_markdown_source(&t).into()),
        other => other,
    });
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, events);
    html
}

/// Convert markdown to plaintext — text runs only, block structure preserved
/// as blank lines. Also used to make a body safe for the Adaptive Card text
/// subset.
pub fn markdown_to_plaintext(md: &str) -> String {
    let mut out = String::new();
    let mut in_code_block = false;
    for event in parser(md) {
        match event {
            // Block-level raw HTML is its own block — separate it, as above.
            Event::Html(t) => {
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
                out.push_str(t.trim_end());
            }
            // Code spans/blocks are verbatim per CommonMark — see
            // unescape_markdown_source's doc comment. Plaintext has no
            // structure for a backslash to protect against, so this strips
            // it unconditionally on Code; Text arrives already correctly
            // un-escaped by the parser for every OTHER context (paragraphs,
            // headings, etc.) except fenced code blocks, tracked below.
            Event::Code(t) => out.push_str(&unescape_markdown_source(&t)),
            Event::Text(t) if in_code_block => out.push_str(&unescape_markdown_source(&t)),
            Event::Text(t) | Event::InlineHtml(t) => {
                out.push_str(&t);
            }
            Event::SoftBreak | Event::HardBreak => out.push('\n'),
            Event::Start(Tag::Item) => {
                if !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("• ");
            }
            Event::End(TagEnd::Item) => out.push('\n'),
            Event::Start(Tag::CodeBlock(_)) => {
                in_code_block = true;
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
            }
            Event::Start(Tag::Paragraph)
            | Event::Start(Tag::Heading { .. })
            | Event::Start(Tag::BlockQuote(_)) => {
                trim_trailing_blank(&mut out);
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
            }
            _ => {}
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Same class of bug as code_span_does_not_leak_literal_backslash_escapes
    /// below, confirmed at the markdown_to_html layer (what the PREVIEW
    /// panel actually renders — a different function from markdown_to_mrkdwn,
    /// discovered leaking the identical backslash live in the browser).
    #[test]
    fn html_code_span_does_not_leak_literal_backslash_escapes() {
        let md = r#"`observed \>\= 80`"#;
        let html = markdown_to_html(md);
        assert!(
            !html.contains('\\'),
            "html code span must not leak literal backslash escapes, got {html:?}"
        );
    }

    #[test]
    fn a_single_newline_separates_lines_on_every_target() {
        // Reported from the live UI: "it doesnt accept newline". In CommonMark
        // a lone newline is a SOFT break, so HTML joined the lines with a
        // space while Slack and plaintext kept them apart — the preview
        // disagreed with what was actually delivered.
        let md = "Line one\nLine two";

        let html = markdown_to_html(md);
        assert!(
            html.contains("<br"),
            "html must break the line, got {html:?}"
        );
        assert!(
            !html.contains("Line one Line two"),
            "html must not join the lines with a space, got {html:?}"
        );

        assert!(markdown_to_mrkdwn(md).contains("Line one\nLine two"));
        assert!(markdown_to_plaintext(md).contains("Line one\nLine two"));
    }

    #[test]
    fn a_blank_line_still_starts_a_new_paragraph() {
        // The soft-break change must not collapse real paragraph structure.
        let html = markdown_to_html("Para one\n\nPara two");
        assert!(html.contains("<p>Para one</p>"), "got {html:?}");
        assert!(html.contains("<p>Para two</p>"), "got {html:?}");
    }

    #[test]
    fn mrkdwn_escapes_slack_specials() {
        assert_eq!(escape_mrkdwn("a & b < c > d"), "a &amp; b &lt; c &gt; d");
    }

    /// Repro for the reported bug: a value substituted with backslash-escaped
    /// punctuation (see resolve.rs's `escape_markdown` — this is how it makes
    /// substituted values inert as markdown SOURCE) that lands inside an
    /// inline code span renders with LITERAL backslashes in Slack, because
    /// CommonMark code spans are verbatim — backslash escapes are never
    /// processed inside them, so pulldown_cmark's `Event::Code` returns the
    /// raw `\>\=` rather than un-escaping it the way `Event::Text` would.
    #[test]
    fn code_span_does_not_leak_literal_backslash_escapes() {
        // Mirrors what escape_markdown produces for the value ">= 80" landing
        // inside a backtick code span in the author's template.
        let md = r#"`observed \>\= 80`"#;
        let out = markdown_to_mrkdwn(md);
        assert!(
            !out.contains('\\'),
            "code span must not leak literal backslash escapes into Slack, got {out:?}"
        );
        // `>` still goes through Slack's own HTML-entity encoding (escape_mrkdwn)
        // — only the markdown-source backslash is stripped, not Slack's rule.
        assert_eq!(out, "`observed &gt;= 80`");
    }

    #[test]
    fn mrkdwn_ampersand_escaped_first() {
        // &lt; must not become &amp;lt;
        assert_eq!(escape_mrkdwn("<"), "&lt;");
        assert_eq!(escape_mrkdwn("&lt;"), "&amp;lt;");
    }

    #[test]
    fn mrkdwn_bold_code_and_link() {
        let out = markdown_to_mrkdwn(
            "Value **92.5** exceeded `80` — see [runbook](https://rb.example/x)",
        );
        assert_eq!(
            out,
            "Value *92.5* exceeded `80` — see <https://rb.example/x|runbook>"
        );
    }

    #[test]
    fn mrkdwn_raw_html_is_escaped_not_markup() {
        let out = markdown_to_mrkdwn("<script>alert(1)</script>");
        assert!(!out.contains("<script>"));
        assert!(out.contains("&lt;script&gt;"));
    }

    #[test]
    fn html_neutralizes_script() {
        let out = markdown_to_html("hi\n\n<script>alert(1)</script>");
        assert!(!out.contains("<script>"));
        assert!(out.contains("&lt;script&gt;"));
    }

    #[test]
    fn html_keeps_real_markdown_markup() {
        assert!(markdown_to_html("**bold**").contains("<strong>bold</strong>"));
    }

    #[test]
    fn plaintext_drops_markup() {
        let out = markdown_to_plaintext("Value **92.5** exceeded `80`");
        assert_eq!(out, "Value 92.5 exceeded 80");
    }

    #[test]
    fn escape_html_covers_quotes() {
        assert_eq!(
            escape_html(r#"a"b'c&d<e>"#),
            "a&quot;b&#39;c&amp;d&lt;e&gt;"
        );
    }

    #[test]
    fn block_html_does_not_run_onto_previous_paragraph() {
        // Regression: a raw-HTML block is its own block and must be separated
        // from the paragraph before it, not concatenated onto its last word.
        let out = markdown_to_mrkdwn("para\n\n<script>alert(1)</script>");
        assert_eq!(out, "para\n\n&lt;script&gt;alert(1)&lt;/script&gt;");
        let plain = markdown_to_plaintext("para\n\n<script>alert(1)</script>");
        assert_eq!(plain, "para\n\n<script>alert(1)</script>");
    }

    #[test]
    fn mrkdwn_list_items_bullet() {
        let out = markdown_to_mrkdwn("- one\n- two");
        assert_eq!(out, "• one\n• two");
    }
}
