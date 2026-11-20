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

use std::{
    cmp::Ordering,
    collections::BTreeSet,
    sync::Arc,
    time::{Duration, Instant},
};

use config::{
    meta::resources::{
        MatchTier, ResourceHit, ResourceKind, SearchQuery, SearchResponse, SourceReason,
        SourceResult, SourceStatus,
    },
    utils::time::now_micros,
};
use tokio_util::sync::CancellationToken;

use super::{
    ResourceAccess, SearchError,
    catalog::{Catalog, Ready, Snapshot},
    cursor::{self, Cursor, CursorScope, SortKey},
    matching::{IndexedRecord, PreparedQuery},
};

pub(super) const SCAN_BUDGET: Duration = Duration::from_millis(150);

pub(super) struct SearchWork {
    pub catalog: Arc<Catalog>,
    pub org: String,
    pub subject: String,
    pub query: SearchQuery,
    pub prepared: PreparedQuery,
    pub access: Vec<ResourceAccess>,
    pub cursor: Option<Cursor>,
    pub snapshots: Vec<(ResourceKind, Snapshot)>,
    pub deadline: Instant,
    pub cancelled: CancellationToken,
}

impl SearchWork {
    pub fn execute(mut self) -> Result<SearchResponse, SearchError> {
        let mut snapshots = std::mem::take(&mut self.snapshots);
        let mut response = SearchResponse {
            hits: Vec::new(),
            sources: Vec::new(),
            took_ms: 0,
        };
        for &kind in &self.query.types {
            let snapshot = snapshots
                .iter()
                .position(|(held, _)| *held == kind)
                .map(|index| snapshots.swap_remove(index).1);
            let Some(access) = self.access.iter().find(|access| access.kind == kind) else {
                response
                    .sources
                    .push(unavailable(kind, SourceReason::PermissionDenied));
                continue;
            };
            if let Some(reason) = access.unavailable_reason {
                response.sources.push(unavailable(kind, reason));
                continue;
            }
            match snapshot.unwrap_or(Snapshot::Unavailable(SourceReason::Loading)) {
                Snapshot::Unavailable(reason) => response.sources.push(unavailable(kind, reason)),
                Snapshot::Busy => response.sources.push(partial(kind)),
                Snapshot::Ready(data) => self.source(&data, access, &mut response)?,
            }
        }
        Ok(response)
    }

    fn source(
        &self,
        ready: &Ready,
        access: &ResourceAccess,
        response: &mut SearchResponse,
    ) -> Result<(), SearchError> {
        let generation = self.catalog.generation(ready.version);
        if self
            .cursor
            .as_ref()
            .is_some_and(|cursor| cursor.generation != generation)
        {
            return Err(SearchError::SearchChanged);
        }
        let mut selected = BTreeSet::new();
        let mut complete = true;
        for (index, row) in ready.records.rows.iter().enumerate() {
            if index % 64 == 0 && (self.cancelled.is_cancelled() || Instant::now() >= self.deadline)
            {
                complete = false;
                break;
            }
            let tier = if self.prepared.normalized.is_empty() {
                None
            } else {
                let Some(tier) = self.prepared.match_record(row) else {
                    continue;
                };
                Some(tier)
            };
            let candidate = Candidate { row, tier };
            if self
                .cursor
                .as_ref()
                .is_some_and(|cursor| candidate.at_or_before(&cursor.last))
                || !(access.predicate)(&row.summary)
            {
                continue;
            }
            selected.insert(candidate);
            if selected.len() > self.query.limit + 1 {
                selected.pop_last();
            }
        }
        let has_more = selected.len() > self.query.limit;
        if has_more {
            selected.pop_last();
        }
        let mut source = SourceResult {
            kind: access.kind,
            status: SourceStatus::Complete,
            has_more: Some(has_more),
            next_cursor: None,
            reason: None,
        };
        if !complete || access.partial {
            source.status = SourceStatus::Partial;
            source.has_more = None;
        }
        if complete
            && !access.partial
            && has_more
            && self.query.types.len() == 1
            && let Some(last) = selected.last()
        {
            let scope = CursorScope {
                subject: &self.subject,
                org: &self.org,
                kind: access.kind,
                query: &self.prepared.original,
            };
            source.next_cursor = Some(cursor::encode(
                &scope,
                &generation,
                last.sort_key(),
                now_micros(),
            )?);
        }
        response
            .hits
            .extend(selected.into_iter().map(|candidate| ResourceHit {
                summary: candidate.row.summary.clone(),
                match_tier: candidate.tier,
            }));
        response.sources.push(source);
        Ok(())
    }
}

struct Candidate<'a> {
    row: &'a IndexedRecord,
    tier: Option<MatchTier>,
}

impl Candidate<'_> {
    fn sort_key(&self) -> SortKey {
        SortKey {
            tier: self.tier,
            name: self.row.normalized_name.clone(),
            kind: self.row.summary.kind,
            id: self.row.summary.id.clone(),
        }
    }

    fn at_or_before(&self, key: &SortKey) -> bool {
        (
            self.tier,
            self.row.normalized_name.as_str(),
            self.row.summary.kind.as_str(),
            self.row.summary.id.as_str(),
        ) <= (
            key.tier,
            key.name.as_str(),
            key.kind.as_str(),
            key.id.as_str(),
        )
    }
}

impl Ord for Candidate<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        (
            self.tier,
            self.row.normalized_name.as_str(),
            self.row.summary.kind.as_str(),
            self.row.summary.id.as_str(),
        )
            .cmp(&(
                other.tier,
                other.row.normalized_name.as_str(),
                other.row.summary.kind.as_str(),
                other.row.summary.id.as_str(),
            ))
    }
}

impl PartialOrd for Candidate<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for Candidate<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Candidate<'_> {}

pub(super) fn unavailable(kind: ResourceKind, reason: SourceReason) -> SourceResult {
    SourceResult {
        kind,
        status: SourceStatus::Unavailable,
        has_more: None,
        next_cursor: None,
        reason: Some(reason),
    }
}

fn partial(kind: ResourceKind) -> SourceResult {
    SourceResult {
        kind,
        status: SourceStatus::Partial,
        has_more: None,
        next_cursor: None,
        reason: None,
    }
}
