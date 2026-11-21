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

use std::mem::size_of;

use config::meta::resources::{MatchTier, ResourceRoute, ResourceSummary};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use super::SearchError;

pub(super) struct IndexedRecord {
    pub summary: ResourceSummary,
    pub normalized_name: String,
    normalized_email: Option<String>,
    word_starts: Vec<usize>,
}

impl IndexedRecord {
    pub fn new(summary: ResourceSummary) -> Self {
        let normalized_name = normalize(&summary.name);
        let mut boundary = true;
        let mut word_starts = Vec::new();
        for (offset, ch) in normalized_name.char_indices() {
            let separator = is_word_separator(ch);
            if boundary && !separator {
                word_starts.push(offset);
            }
            boundary = separator;
        }
        Self {
            normalized_email: summary.email.as_deref().map(normalize),
            summary,
            normalized_name,
            word_starts,
        }
    }

    pub fn allocated_bytes(&self) -> usize {
        summary_heap(&self.summary)
            + self.normalized_name.capacity()
            + optional_capacity(&self.normalized_email)
            + self.word_starts.capacity() * size_of::<usize>()
    }
}

pub(super) struct PreparedQuery {
    pub original: String,
    pub normalized: String,
    words: Vec<String>,
}

impl PreparedQuery {
    pub fn new(value: &str) -> Result<Self, SearchError> {
        let normalized = normalize(value);
        if normalized.chars().count() > 256 {
            return Err(SearchError::InvalidQuery(
                "q exceeds 256 normalized characters".into(),
            ));
        }
        Ok(Self {
            original: value.trim().to_owned(),
            words: normalized.split_whitespace().map(String::from).collect(),
            normalized,
        })
    }

    pub fn match_record(&self, row: &IndexedRecord) -> Option<MatchTier> {
        if self.normalized == row.normalized_name {
            return Some(MatchTier::ExactName);
        }
        if self.original == row.summary.id {
            return Some(MatchTier::ExactId);
        }
        if row.normalized_name.starts_with(&self.normalized) {
            return Some(MatchTier::NamePrefix);
        }
        if self.words.iter().all(|word| {
            row.word_starts
                .iter()
                .any(|&start| row.normalized_name[start..].starts_with(word))
        }) {
            return Some(MatchTier::WordPrefix);
        }
        if row.normalized_name.contains(&self.normalized) {
            return Some(MatchTier::NameSubstring);
        }
        if row
            .normalized_email
            .as_ref()
            .is_some_and(|email| email.contains(&self.normalized))
        {
            return Some(MatchTier::EmailSubstring);
        }
        None
    }
}

pub fn normalize(value: &str) -> String {
    value
        .nfd()
        .filter(|ch| !is_combining_mark(*ch))
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn summary_heap(summary: &ResourceSummary) -> usize {
    summary.id.capacity()
        + summary.name.capacity()
        + optional_capacity(&summary.folder_id)
        + optional_capacity(&summary.folder_name)
        + optional_capacity(&summary.email)
        + route_bytes(&summary.route_ref)
}

fn is_word_separator(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '-' | '_' | '.' | '/')
}

fn optional_capacity(value: &Option<String>) -> usize {
    value.as_ref().map_or(0, String::capacity)
}

fn route_bytes(route: &ResourceRoute) -> usize {
    match route {
        ResourceRoute::Dashboard {
            dashboard_id,
            folder_id,
        } => dashboard_id.capacity() + folder_id.capacity(),
        ResourceRoute::Alert {
            alert_id,
            folder_id,
            ..
        } => alert_id.capacity() + folder_id.capacity(),
        ResourceRoute::Stream {
            stream_type,
            stream_name,
        } => stream_type.capacity() + stream_name.capacity(),
        ResourceRoute::Function { function_name } => function_name.capacity(),
        ResourceRoute::Pipeline { pipeline_id } => pipeline_id.capacity(),
        ResourceRoute::Synthetic {
            check_id,
            folder_id,
        } => check_id.capacity() + folder_id.capacity(),
        ResourceRoute::User { email } => email.capacity(),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::resources::{ResourceKind, ResourceRoute};

    use super::*;

    fn record(id: &str, name: &str, email: Option<&str>) -> IndexedRecord {
        IndexedRecord::new(ResourceSummary {
            kind: ResourceKind::Function,
            id: id.into(),
            name: name.into(),
            folder_id: None,
            folder_name: None,
            route_ref: ResourceRoute::Function {
                function_name: id.into(),
            },
            enabled: None,
            email: email.map(String::from),
            is_siem: false,
        })
    }

    #[test]
    fn matching_normalizes_accents_whitespace_and_preserves_chinese() {
        assert_eq!(normalize("  CAFE\u{301}   支付  "), "cafe 支付");
        assert_eq!(normalize("école"), "ecole");
        assert!(PreparedQuery::new(&"支".repeat(256)).is_ok());
        assert!(PreparedQuery::new(&"支".repeat(257)).is_err());
    }

    #[test]
    fn matching_ranks_names_ids_words_substrings_and_emails() {
        let cases = [
            ("x", "Payment", None, "payment", Some(MatchTier::ExactName)),
            ("AbC", "Other", None, "AbC", Some(MatchTier::ExactId)),
            ("AbC", "Other", None, "abc", None),
            (
                "x",
                "Payment logs",
                None,
                "pay",
                Some(MatchTier::NamePrefix),
            ),
            (
                "x",
                "logs_payment",
                None,
                "pay log",
                Some(MatchTier::WordPrefix),
            ),
            (
                "x",
                "支付_生产",
                None,
                "生产 支",
                Some(MatchTier::WordPrefix),
            ),
            (
                "x",
                "repayment",
                None,
                "pay",
                Some(MatchTier::NameSubstring),
            ),
            (
                "x",
                "Engineer",
                Some("eng@payment.invalid"),
                "payment",
                Some(MatchTier::EmailSubstring),
            ),
            ("x", "Payment logs", None, "pay trace", None),
        ];
        for (id, name, email, q, expected) in cases {
            assert_eq!(
                PreparedQuery::new(q)
                    .unwrap()
                    .match_record(&record(id, name, email)),
                expected,
                "{id} {name} {q}"
            );
        }
    }
}
