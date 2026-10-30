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

//! AWS SNS plaintext renderer (§4.2, Phase 1b Task 1).
//!
//! SNS `Publish` messages are plain text with no markup dialect, so the body
//! goes through [`markdown_to_plaintext`] (same converter used for the email
//! plaintext alternative) rather than any markdown-preserving path.

use super::{clamp, markdown::markdown_to_plaintext};
use crate::alerts::notifications::resolve::RenderedContent;

/// SNS's documented cap on `Subject`.
const SUBJECT_MAX: usize = 100;

/// Returns `(subject, message)` for [`super::RenderedMessage::Sns`].
pub fn render_sns(c: &RenderedContent) -> (String, String) {
    let subject = clamp(&c.title, SUBJECT_MAX);

    let mut parts = vec![c.title.clone(), markdown_to_plaintext(&c.body_markdown)];

    if !c.fields.is_empty() {
        parts.push(
            c.fields
                .iter()
                .map(|(label, value)| format!("{label}: {value}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    if !c.links.is_empty() {
        // Every link, not just the first — SNS plaintext has no button/embed
        // slot limit the way Discord does, so nothing needs to be dropped.
        parts.push(
            c.links
                .iter()
                .map(|(label, url)| {
                    // Same scheme filter as email's plaintext part: an SNS
                    // subscription fans out to email/SMS clients that
                    // linkify bare URLs, so a hostile scheme must not
                    // survive into the text a human taps.
                    let url = super::safe_url(url);
                    if label.is_empty() {
                        url.to_string()
                    } else {
                        format!("{label}: {url}")
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    let message = parts
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    (subject, message)
}
