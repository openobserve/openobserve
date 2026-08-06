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

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::meta::alerts::level::AlertLevel;

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ContentSpec {
    /// Templated one-liner: Slack headline, email subject, PagerDuty summary.
    pub title: String,
    /// Per-channel title overrides keyed by channel family ("slack", "teams",
    /// "email", ...). Unknown keys ignored on read (mixed-version rule).
    pub title_overrides: HashMap<String, String>,
    /// Markdown with {var} placeholders.
    pub body: String,
    pub fields: Vec<ContentField>,
    pub rows: RowsSpec,
    pub links: Vec<ContentLink>,
    /// Phase 2 chart toggle; parsed and stored now, ignored by Phase 1 renderers.
    pub chart: ChartSpec,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ContentField {
    pub label: String,
    pub value: String,
    pub show_when: Option<SeverityFilter>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ContentLink {
    pub label: String,
    pub url: String,
    pub show_when: Option<SeverityFilter>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct RowsSpec {
    /// Whether to render rows in the notification.
    pub enabled: bool,
    /// Maximum number of rows to include in the notification (default 5).
    pub max: u16,
    /// Column names to include; None = all columns in table column order.
    pub columns: Option<Vec<String>>,
    /// Per-row line template over selected row columns; operates on full row regardless of columns
    /// selection.
    pub format: Option<String>,
}

impl Default for RowsSpec {
    fn default() -> Self {
        Self {
            enabled: false,
            max: 5,
            columns: None,
            format: None,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct SeverityFilter {
    pub levels: Vec<AlertLevel>,
}

impl SeverityFilter {
    /// `None` level (single-level alert) matches nothing — design §4.2.1.
    pub fn matches(&self, level: Option<AlertLevel>) -> bool {
        match level {
            Some(l) => self.levels.contains(&l),
            None => false,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default, rename_all = "snake_case")]
pub struct ChartSpec {
    pub enabled: bool,
}

impl ContentSpec {
    pub fn parse(body: &str) -> Result<ContentSpec, serde_json::Error> {
        serde_json::from_str(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_and_ignores_unknown_fields() {
        let spec =
            ContentSpec::parse(r#"{"title":"CPU high","body":"**{alert_name}** fired"}"#).unwrap();
        assert_eq!(spec.rows.max, 5);
        // Tolerant serde: future fields and channel keys must not break parse.
        let future = ContentSpec::parse(
            r#"{"title":"t","body":"b","body_overrides":{"slack":"x"},
                "title_overrides":{"some_future_channel":"y"},"new_field":1,
                "fields":[{"label":"l","value":"v","future":true}]}"#,
        )
        .unwrap();
        assert_eq!(
            future.title_overrides.get("some_future_channel").unwrap(),
            "y"
        );
    }

    #[test]
    fn severity_filter_none_matches_nothing() {
        let f = SeverityFilter {
            levels: vec![AlertLevel::Critical],
        };
        assert!(f.matches(Some(AlertLevel::Critical)));
        assert!(!f.matches(Some(AlertLevel::Warning)));
        assert!(!f.matches(None));
    }

    #[test]
    fn rejects_non_json() {
        assert!(ContentSpec::parse("Slack payload {alert_name}").is_err());
    }
}
