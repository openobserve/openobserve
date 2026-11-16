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

use std::str::FromStr;

use config::meta::resources::{ResourceKind, SearchQuery};
use serde::Deserialize;

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchParams {
    pub q: Option<String>,
    pub types: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

impl SearchParams {
    pub fn into_query(self) -> Result<SearchQuery, &'static str> {
        let q = self.q.unwrap_or_default();
        let normalized = openobserve_core::resources::normalize(&q);
        if normalized.chars().count() > 256 {
            return Err("query exceeds 256 characters");
        }
        let explicit = self.types.is_some();
        let types = match self.types {
            None => ResourceKind::ALL.into(),
            Some(types) => {
                let mut parsed = Vec::new();
                for value in types.split(',') {
                    let kind = ResourceKind::from_str(value.trim())?;
                    if !parsed.contains(&kind) {
                        parsed.push(kind);
                    }
                }
                parsed
            }
        };
        if normalized.is_empty() && !explicit {
            return Err("an empty query requires an explicit resource type");
        }
        let limit = self.limit.unwrap_or(20);
        if !(1..=100).contains(&limit) {
            return Err("limit must be between 1 and 100");
        }
        if self.cursor.is_some() && types.len() != 1 {
            return Err("a cursor requires exactly one resource type");
        }
        if self
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.len() > 8 * 1024)
        {
            return Err("cursor exceeds 8 KiB");
        }
        Ok(SearchQuery {
            q,
            types,
            limit,
            cursor: self.cursor,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_unscoped_query_is_rejected_but_scoped_query_is_allowed() {
        assert!(SearchParams::default().into_query().is_err());
        assert!(
            SearchParams {
                q: Some(" \n ".into()),
                ..Default::default()
            }
            .into_query()
            .is_err()
        );
        let scoped = SearchParams {
            types: Some("dashboard".into()),
            ..Default::default()
        }
        .into_query()
        .unwrap();
        assert_eq!(scoped.types, vec![ResourceKind::Dashboard]);
    }

    #[test]
    fn unknown_types_limits_and_multi_type_cursors_fail() {
        for types in ["unknown", "", "dashboard,unknown"] {
            assert!(
                SearchParams {
                    types: Some(types.into()),
                    ..Default::default()
                }
                .into_query()
                .is_err()
            );
        }
        for limit in [0, 101] {
            assert!(
                SearchParams {
                    q: Some("item".into()),
                    limit: Some(limit),
                    ..Default::default()
                }
                .into_query()
                .is_err()
            );
        }
        assert!(
            SearchParams {
                q: Some("item".into()),
                cursor: Some("cursor".into()),
                ..Default::default()
            }
            .into_query()
            .is_err()
        );
    }

    #[test]
    fn oversized_cursor_is_rejected_before_authorization_or_catalog_loading() {
        assert!(
            SearchParams {
                q: Some("item".into()),
                types: Some("dashboard".into()),
                cursor: Some("a".repeat(8 * 1024 + 1)),
                ..Default::default()
            }
            .into_query()
            .is_err()
        );
    }

    #[test]
    fn validation_preserves_original_id_case_and_counts_normalized_unicode_scalars() {
        let query = SearchParams {
            q: Some("CaseSensitiveID".into()),
            ..Default::default()
        }
        .into_query()
        .unwrap();
        assert_eq!(query.q, "CaseSensitiveID");
        assert!(
            SearchParams {
                q: Some("é".repeat(256)),
                ..Default::default()
            }
            .into_query()
            .is_ok()
        );
        assert!(
            SearchParams {
                q: Some("中".repeat(257)),
                ..Default::default()
            }
            .into_query()
            .is_err()
        );
    }
}
