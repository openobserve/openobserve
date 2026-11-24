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
    time::{Duration, Instant},
};

use config::meta::resources::{
    MatchTier, ResourceHit, ResourceKind, SearchQuery, SearchResponse, SourceReason, SourceResult,
    SourceStatus,
};
use tokio_util::sync::CancellationToken;

use super::{
    ResourceAccess,
    catalog::Snapshot,
    matching::{IndexedRecord, PreparedQuery},
};

pub(super) const SCAN_BUDGET: Duration = Duration::from_millis(150);

pub(super) struct SearchWork {
    pub query: SearchQuery,
    pub prepared: PreparedQuery,
    pub access: Vec<ResourceAccess>,
    pub snapshots: Vec<(ResourceKind, Snapshot)>,
    pub deadline: Instant,
    pub cancelled: CancellationToken,
}

impl SearchWork {
    pub fn execute(mut self) -> SearchResponse {
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
            match snapshot.unwrap_or(Err(SourceReason::Loading)) {
                Err(reason) => response.sources.push(unavailable(kind, reason)),
                Ok(rows) => self.source(&rows, access, &mut response),
            }
        }
        response
    }

    fn source(
        &self,
        rows: &[IndexedRecord],
        access: &ResourceAccess,
        response: &mut SearchResponse,
    ) {
        let keep = self.query.offset + self.query.limit;
        let mut selected = BTreeSet::new();
        let mut complete = true;
        for (index, row) in rows.iter().enumerate() {
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
            if !(access.predicate)(&row.summary) {
                continue;
            }
            selected.insert(Candidate { row, tier });
            if selected.len() > keep + 1 {
                selected.pop_last();
            }
        }
        let has_more = selected.len() > keep;
        if has_more {
            selected.pop_last();
        }
        let partial = !complete || access.partial;
        response.sources.push(SourceResult {
            kind: access.kind,
            status: if partial {
                SourceStatus::Partial
            } else {
                SourceStatus::Complete
            },
            has_more: Some(has_more),
            reason: None,
        });
        response.hits.extend(
            selected
                .into_iter()
                .skip(self.query.offset)
                .map(|candidate| ResourceHit {
                    summary: candidate.row.summary.clone(),
                    match_tier: candidate.tier,
                }),
        );
    }
}

struct Candidate<'a> {
    row: &'a IndexedRecord,
    tier: Option<MatchTier>,
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
        reason: Some(reason),
    }
}
