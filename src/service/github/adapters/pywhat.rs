// Copyright 2025 OpenObserve Inc.
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

//! Generic adapter for regex pattern formats
//!
//! Supports flexible JSON formats including pyWhat, custom patterns, and minimal formats.
//! Only requires 'name' and 'pattern' (or 'regex') fields, all others are optional.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::service::github::types::GitHubError;

/// Generic pattern format - supports multiple field name variations
/// This makes the system flexible to work with different JSON sources
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericPattern {
    // Name field - case insensitive via serde flatten
    #[serde(alias = "name", alias = "title", alias = "Title")]
    #[serde(rename = "Name")]
    pub name: String,

    // Pattern/Regex field - PyWhat uses "Regex", others might use "pattern"
    #[serde(alias = "regex", alias = "pattern", alias = "Pattern")]
    #[serde(rename = "Regex")]
    pub regex: String,

    // Optional fields
    #[serde(alias = "description", alias = "desc")]
    #[serde(rename = "Description")]
    #[serde(default)]
    pub description: Option<String>,

    #[serde(alias = "rarity", alias = "priority")]
    #[serde(rename = "Rarity")]
    #[serde(default = "default_rarity")]
    pub rarity: f64,

    #[serde(alias = "url", alias = "link")]
    #[serde(rename = "URL")]
    #[serde(default)]
    pub url: Option<String>,

    #[serde(alias = "tags", alias = "categories", alias = "category")]
    #[serde(rename = "Tags")]
    #[serde(default)]
    pub tags: Vec<String>,

    #[serde(alias = "examples")]
    #[serde(rename = "Examples")]
    #[serde(default)]
    pub examples: Option<PatternExamples>,

    #[serde(default)]
    pub plural_name: bool,
}

fn default_rarity() -> f64 {
    0.5
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PatternExamples {
    #[serde(alias = "valid")]
    #[serde(rename = "Valid")]
    #[serde(default)]
    pub valid: Vec<String>,

    #[serde(alias = "invalid")]
    #[serde(rename = "Invalid")]
    #[serde(default)]
    pub invalid: Vec<String>,
}

/// OpenObserve built-in pattern format (for API response)
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct BuiltInPatternResponse {
    pub name: String,
    pub pattern: String,
    pub description: String,
    pub tags: Vec<String>,
    pub rarity: f64,
    pub url: Option<String>,
    pub examples: PatternExamples,
}

impl From<GenericPattern> for BuiltInPatternResponse {
    fn from(p: GenericPattern) -> Self {
        Self {
            name: p.name,
            pattern: p.regex,
            description: p.description.unwrap_or_default(),
            tags: p.tags,
            rarity: p.rarity,
            url: p.url,
            examples: p.examples.unwrap_or(PatternExamples {
                valid: vec![],
                invalid: vec![],
            }),
        }
    }
}

/// Adapter for regex patterns - supports multiple formats (PyWhat, custom, minimal)
pub struct PyWhatAdapter;

impl PyWhatAdapter {
    /// Fetch and transform patterns
    /// Used for frontend-only caching flow
    pub async fn fetch_built_in_patterns(
        github_service: &crate::service::github::GitHubDataService,
    ) -> Result<Vec<BuiltInPatternResponse>, GitHubError> {
        let config = config::get_config();
        let url = &config.common.regex_patterns_source_url;

        log::info!("Fetching regex patterns from: {}", url);

        // Fetch raw data without caching
        let data = github_service.fetch_raw(url).await?;

        // Parse JSON
        let patterns: Vec<GenericPattern> =
            serde_json::from_slice(&data).map_err(|e| GitHubError::ParseError(e.to_string()))?;

        log::info!("Successfully fetched {} patterns", patterns.len());

        let transformed = patterns.into_iter().map(|p| p.into()).collect();
        Ok(transformed)
    }

    /// Filter patterns by search query
    pub fn filter_by_search(
        patterns: Vec<BuiltInPatternResponse>,
        query: &str,
    ) -> Vec<BuiltInPatternResponse> {
        if query.is_empty() {
            return patterns;
        }

        let query_lower = query.to_lowercase();
        patterns
            .into_iter()
            .filter(|p| {
                p.name.to_lowercase().contains(&query_lower)
                    || p.description.to_lowercase().contains(&query_lower)
                    || p.tags
                        .iter()
                        .any(|t| t.to_lowercase().contains(&query_lower))
            })
            .collect()
    }

    /// Filter patterns by tags
    pub fn filter_by_tags(
        patterns: Vec<BuiltInPatternResponse>,
        tags: &[String],
    ) -> Vec<BuiltInPatternResponse> {
        if tags.is_empty() {
            return patterns;
        }

        let tags_lower: Vec<String> = tags.iter().map(|t| t.to_lowercase()).collect();
        patterns
            .into_iter()
            .filter(|p| {
                p.tags
                    .iter()
                    .any(|pt| tags_lower.contains(&pt.to_lowercase()))
            })
            .collect()
    }

    /// Get all unique tags from patterns
    pub fn get_all_tags(patterns: &[BuiltInPatternResponse]) -> Vec<String> {
        let mut tags: Vec<String> = patterns
            .iter()
            .flat_map(|p| p.tags.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        tags.sort();
        tags
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_pattern(name: &str, tags: Vec<&str>) -> BuiltInPatternResponse {
        BuiltInPatternResponse {
            name: name.to_string(),
            pattern: "test".to_string(),
            description: "test description".to_string(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            rarity: 1.0,
            url: None,
            examples: PatternExamples {
                valid: vec![],
                invalid: vec![],
            },
        }
    }

    #[test]
    fn test_filter_by_search() {
        let patterns = vec![
            create_test_pattern("SSH Key", vec!["Credentials"]),
            create_test_pattern("Email", vec!["PII"]),
            create_test_pattern("IP Address", vec!["Network"]),
        ];

        let filtered = PyWhatAdapter::filter_by_search(patterns.clone(), "ssh");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].name, "SSH Key");

        let filtered = PyWhatAdapter::filter_by_search(patterns.clone(), "");
        assert_eq!(filtered.len(), 3);
    }

    #[test]
    fn test_filter_by_tags() {
        let patterns = vec![
            create_test_pattern("SSH Key", vec!["Credentials", "SSH"]),
            create_test_pattern("Email", vec!["PII"]),
            create_test_pattern("Password", vec!["Credentials"]),
        ];

        let filtered =
            PyWhatAdapter::filter_by_tags(patterns.clone(), &["Credentials".to_string()]);
        assert_eq!(filtered.len(), 2);

        let filtered = PyWhatAdapter::filter_by_tags(patterns.clone(), &[]);
        assert_eq!(filtered.len(), 3);
    }

    #[test]
    fn test_get_all_tags() {
        let patterns = vec![
            create_test_pattern("SSH Key", vec!["Credentials", "SSH"]),
            create_test_pattern("Email", vec!["PII"]),
            create_test_pattern("Password", vec!["Credentials"]),
        ];

        let tags = PyWhatAdapter::get_all_tags(&patterns);
        assert_eq!(tags.len(), 3);
        assert!(tags.contains(&"Credentials".to_string()));
        assert!(tags.contains(&"SSH".to_string()));
        assert!(tags.contains(&"PII".to_string()));
    }
}
