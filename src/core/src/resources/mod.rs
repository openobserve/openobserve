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

mod catalog;
mod cursor;
mod matching;
mod records;
mod scan;

use std::{sync::Arc, time::Instant};

use catalog::{Catalog, Limits, Readers};
use config::meta::resources::{
    ResourceKind, ResourceSummary, SearchQuery, SearchResponse, SourceReason,
};
use cursor::CursorScope;
use matching::PreparedQuery;
pub use matching::normalize;
use scan::{SearchWork, unavailable};
use tokio::sync::OnceCell;
use tokio_util::sync::CancellationToken;

static CATALOG: OnceCell<Arc<Catalog>> = OnceCell::const_new();

pub struct ResourceAccess {
    pub kind: ResourceKind,
    pub predicate: Arc<dyn Fn(&ResourceSummary) -> bool + Send + Sync>,
    pub partial: bool,
    pub unavailable_reason: Option<SourceReason>,
}

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("{0}")]
    InvalidQuery(String),
    #[error("search_changed")]
    SearchChanged,
    #[error("resource search is overloaded")]
    Overloaded,
    #[error("resource search is unavailable")]
    ServiceUnavailable,
}

pub async fn search(
    org: &str,
    subject: &str,
    query: SearchQuery,
    access: Vec<ResourceAccess>,
) -> Result<SearchResponse, SearchError> {
    let start = Instant::now();
    let prepared = validate(&query)?;
    let cursor = if let Some(value) = &query.cursor {
        let scope = CursorScope {
            subject,
            org,
            kind: query.types[0],
            query: &prepared.original,
        };
        Some(cursor::decode(
            value,
            &scope,
            config::utils::time::now_micros(),
        )?)
    } else {
        None
    };
    let enabled = query
        .types
        .iter()
        .copied()
        .filter(|kind| {
            access
                .iter()
                .any(|item| item.kind == *kind && item.unavailable_reason.is_none())
        })
        .collect::<Vec<_>>();
    if enabled.is_empty() {
        return Ok(SearchResponse {
            hits: Vec::new(),
            sources: query
                .types
                .iter()
                .map(|&kind| {
                    unavailable(
                        kind,
                        access
                            .iter()
                            .find(|item| item.kind == kind)
                            .and_then(|item| item.unavailable_reason)
                            .unwrap_or(SourceReason::PermissionDenied),
                    )
                })
                .collect(),
            took_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
        });
    }
    let catalog = CATALOG
        .get_or_try_init(|| async {
            let events = db::resources::subscribe()
                .await
                .map_err(|_| SearchError::ServiceUnavailable)?;
            let limits = Limits {
                max_bytes: config::get_config().limit.resource_catalog_max_bytes,
                ..Limits::default()
            };
            let catalog = Catalog::new(Readers::production(), limits);
            tokio::spawn(catalog::watch(Arc::downgrade(&catalog), events));
            Ok::<_, SearchError>(catalog)
        })
        .await?
        .clone();
    let exhausted = catalog.ensure(org, &enabled).await?;
    let permit = catalog
        .scans
        .clone()
        .try_acquire_owned()
        .map_err(|_| SearchError::Overloaded)?;
    let cancelled = CancellationToken::new();
    let _cancel_on_drop = cancelled.clone().drop_guard();
    let work = SearchWork {
        catalog,
        org: org.into(),
        subject: subject.into(),
        query,
        prepared,
        access,
        cursor,
        exhausted,
        cancelled,
    };
    let mut result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work.execute()
    })
    .await
    .map_err(|_| SearchError::ServiceUnavailable)??;
    result.took_ms = u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(result)
}

fn validate(query: &SearchQuery) -> Result<PreparedQuery, SearchError> {
    if !(1..=100).contains(&query.limit) {
        return Err(SearchError::InvalidQuery(
            "limit must be between 1 and 100".into(),
        ));
    }
    if query.types.is_empty() {
        return Err(SearchError::InvalidQuery(
            "at least one resource type is required".into(),
        ));
    }
    if query
        .types
        .iter()
        .enumerate()
        .any(|(i, kind)| query.types[..i].contains(kind))
    {
        return Err(SearchError::InvalidQuery("duplicate resource type".into()));
    }
    if query.cursor.is_some() && query.types.len() != 1 {
        return Err(SearchError::InvalidQuery(
            "cursor requires exactly one resource type".into(),
        ));
    }
    PreparedQuery::new(&query.q)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn denied_source_returns_unavailable_without_starting_a_catalog() {
        let result = search(
            "org",
            "user@example.invalid",
            SearchQuery {
                q: "payment".into(),
                types: vec![ResourceKind::Function],
                limit: 20,
                cursor: None,
            },
            vec![ResourceAccess {
                kind: ResourceKind::Function,
                predicate: Arc::new(|_| false),
                partial: false,
                unavailable_reason: Some(SourceReason::PermissionDenied),
            }],
        )
        .await
        .unwrap();
        assert!(result.hits.is_empty());
        assert_eq!(
            result.sources[0].reason,
            Some(SourceReason::PermissionDenied)
        );
    }
}
