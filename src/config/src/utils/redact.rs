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

//! Scrubbing of internal-architecture details from text that leaves the server.

use std::sync::LazyLock;

use regex::{NoExpand, Regex};

// Order matters: paths collapse before the bare-word runtime rule rewrites them.
static INTERNAL_PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"/data/opencode-workspaces[\w./-]*", "[internal path]"),
        (r"/home/appuser[\w./-]*", "[internal path]"),
        (r"~?/\.config/opencode[\w./-]*", "[internal path]"),
        (r"\bnats://[\w.:@-]+", "[internal endpoint]"),
        (
            r"\bhttps?://(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?[\w./-]*",
            "[internal endpoint]",
        ),
        (
            r"(?i)\b(?:the\s+)?opencode(?:\s+(?:runtime|server|agent))?\b",
            "the agent runtime",
        ),
        (r"(?i)\bbubblewrap\b", "the sandbox"),
        (r"(?i)\bbwrap\b", "the sandbox"),
        (r"(?i)\bappuser\b", "the service account"),
        (r"(?i)\bDataFusion\b", "the query engine"),
        (
            r"\b(?:arrow_schema|sqlparser|datafusion)::[\w:]+",
            "the query engine",
        ),
    ]
    .into_iter()
    .map(|(pattern, replacement)| (Regex::new(pattern).expect("valid pattern"), replacement))
    .collect()
});

static URL_AUTHORITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bhttps?://[^\s/?#'"<>(),;]+"#).expect("valid pattern"));

pub fn redact_rca_details(text: &str, agent_url: &str) -> String {
    let mut text = redact_internal_details(text);
    let agent_url = agent_url.trim_end_matches('/');
    if !agent_url.is_empty() {
        text = text.replace(agent_url, "[internal endpoint]");
    }
    URL_AUTHORITY
        .replace_all(&text, NoExpand("[internal endpoint]"))
        .chars()
        .take(500)
        .collect()
}

/// Scrub internal-architecture details (runtime, paths, endpoints) from outbound text.
pub fn redact_internal_details(text: &str) -> String {
    let mut text = text.to_string();
    for (pattern, replacement) in INTERNAL_PATTERNS.iter() {
        if pattern.is_match(&text) {
            text = pattern
                .replace_all(&text, NoExpand(replacement))
                .into_owned();
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_runtime_paths_and_endpoints_are_scrubbed() {
        assert_eq!(
            redact_internal_details("the opencode server at /home/appuser/x"),
            "the agent runtime at [internal path]"
        );
        assert_eq!(
            redact_internal_details(
                "GET http://127.0.0.1:4096/session failed via nats://nats:4222"
            ),
            "GET [internal endpoint] failed via [internal endpoint]"
        );
        assert_eq!(
            redact_internal_details("DataFusion error in bwrap: sqlparser::parser::ParserError"),
            "the query engine error in the sandbox: the query engine"
        );
        assert_eq!(
            redact_internal_details("no internal detail here"),
            "no internal detail here"
        );
    }
}
