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

//! The Slack insights feed's read (DEC-4): what the AutoObserve page shows the connecting admin.

use o2_enterprise::enterprise::{
    autoobserve::{
        alert_findings::AlertFindingsRead,
        api::{self, Deps, MAX_LIMIT, Page, SuggestionFilter},
    },
    slack::insights::feed::{
        FeedHooks,
        sweep::{FeedInput, ReadAs},
    },
};

use super::{LiveDigest, decisions, readable_subjects, run_read_by};

/// Registered once at startup, beside the HTTP server.
pub fn hooks() -> FeedHooks {
    FeedHooks {
        read: |at| Box::pin(read(at)),
    }
}

/// The same list call, mask and calibration reader as `GET /v2/{org}/autoobserve/suggestions`.
async fn read(at: ReadAs) -> anyhow::Result<FeedInput> {
    let deps = Deps::live().map_err(|e| anyhow::anyhow!("AutoObserve is not readable: {e:?}"))?;
    let filter = SuggestionFilter {
        sort: Some("priority".into()),
        ..SuggestionFilter::default()
    };
    let (deps, filter) = (&deps, &filter);
    let at = &at;
    let items = every_page(|page| async move {
        let readable = |subjects| readable_subjects(&at.org_id, &at.user_id, subjects);
        let list = api::suggestions(
            deps,
            &at.org_id,
            filter,
            page,
            at.now,
            readable,
            &LiveDigest,
        )
        .await
        .map_err(|e| anyhow::anyhow!("suggestions: {e:?}"))?;
        Ok((list.suggestions, list.total))
    })
    .await?;
    let run = run_read_by(&at.org_id, &at.user_id, at.now).await;
    let calibration_run_at = run.as_ref().map(|run| run.emitted_at);
    let calibration_open = match &run {
        Some(run) => LiveDigest
            .dismissed(&at.org_id, at.now)
            .await
            .ok()
            .map(|dismissed| run.open_count(&dismissed)),
        None => None,
    };
    // A failed read must fail the pass: an empty list would read as every decision undone.
    let decisions = decisions::feed_decisions(&at.org_id, &at.user_id, at.now)
        .await
        .map_err(|e| anyhow::anyhow!("decisions: {e:?}"))?;
    Ok(FeedInput {
        items,
        calibration_run_at,
        calibration_open,
        decisions,
    })
}

/// Every readable row, page by page, so counts and recoveries past the first page are seen.
async fn every_page<T, F, Fut>(mut fetch: F) -> anyhow::Result<Vec<T>>
where
    F: FnMut(Page) -> Fut,
    Fut: Future<Output = anyhow::Result<(Vec<T>, usize)>>,
{
    let mut rows = Vec::new();
    loop {
        let page = Page {
            limit: MAX_LIMIT,
            offset: rows.len(),
        };
        let (next, total) = fetch(page).await?;
        let read = next.len();
        rows.extend(next);
        if read == 0 || rows.len() >= total {
            return Ok(rows);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[tokio::test]
    async fn every_readable_row_is_read_past_the_first_page() {
        let offsets = Mutex::new(Vec::new());
        let rows = every_page(|page| {
            offsets.lock().unwrap().push(page.offset);
            async move {
                let total = 1_234;
                let end = (page.offset + page.limit).min(total);
                Ok(((page.offset..end).collect::<Vec<usize>>(), total))
            }
        })
        .await
        .unwrap();
        assert_eq!(rows, (0..1_234).collect::<Vec<_>>());
        assert_eq!(*offsets.lock().unwrap(), vec![0, 500, 1_000]);
        let shrank = every_page(|page| async move {
            Ok((if page.offset == 0 { vec![1, 2] } else { vec![] }, 900))
        })
        .await
        .unwrap();
        assert_eq!(shrank, vec![1, 2], "a list that shrank mid-read ends");
    }
}
