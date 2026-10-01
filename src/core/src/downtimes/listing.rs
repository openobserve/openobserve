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

//! The list endpoint's filters, counts and paging. Pure.

use config::meta::downtimes::{Downtime, DowntimeListItem, DowntimeStatus, Repeat, TargetModule};
pub use config::meta::downtimes::{
    DowntimeStatusCounts as StatusCounts, ListDowntimesQuery as ListQuery,
    ListDowntimesResponse as ListResponse,
};
use o2_enterprise::enterprise::downtimes::scope::{self, TargetItem};

pub const DEFAULT_PAGE_SIZE: usize = 50;
pub const MAX_PAGE_SIZE: usize = 500;

/// Filters, counts and pages already-authorized rows. `alert` is the item behind `alert_id`.
pub fn list_page(
    items: Vec<DowntimeListItem>,
    query: &ListQuery,
    alert: Option<&TargetItem<'_>>,
) -> ListResponse {
    let mut kept: Vec<DowntimeListItem> = items
        .into_iter()
        .filter(|item| keep(item, query, alert))
        .collect();
    let counts = count(&kept);
    kept.sort_by_key(|item| std::cmp::Reverse(item.downtime.updated_at));
    let total = kept.len();
    let size = query
        .page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let page = query.page.unwrap_or(1).max(1);
    let items = kept
        .into_iter()
        .skip((page - 1).saturating_mul(size))
        .take(size)
        .collect();
    ListResponse {
        items,
        total,
        counts,
    }
}

fn keep(item: &DowntimeListItem, query: &ListQuery, alert: Option<&TargetItem<'_>>) -> bool {
    let d = &item.downtime;
    query.folder_id.as_ref().is_none_or(|f| *f == d.folder_id)
        && query
            .status
            .as_deref()
            .is_none_or(|s| status_name(item.status) == s)
        && query
            .repeat
            .as_deref()
            .is_none_or(|r| repeat_matches(d.schedule.repeat, r))
        && query
            .search
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .is_none_or(|s| mentions(d, s))
        && (query.alert_id.is_none() || alert.is_some_and(|a| names_alert(d, a)))
}

fn count(items: &[DowntimeListItem]) -> StatusCounts {
    let mut counts = StatusCounts::default();
    for item in items {
        match item.status {
            DowntimeStatus::Active => counts.active += 1,
            DowntimeStatus::Scheduled => counts.scheduled += 1,
            DowntimeStatus::Ended => counts.ended += 1,
            DowntimeStatus::Cancelled => counts.cancelled += 1,
        }
        if item.downtime.schedule.repeat != Repeat::None {
            counts.recurring += 1;
        }
    }
    counts
}

fn status_name(status: DowntimeStatus) -> &'static str {
    match status {
        DowntimeStatus::Scheduled => "scheduled",
        DowntimeStatus::Active => "active",
        DowntimeStatus::Ended => "ended",
        DowntimeStatus::Cancelled => "cancelled",
    }
}

fn repeat_matches(repeat: Repeat, wanted: &str) -> bool {
    match wanted {
        "recurring" => repeat != Repeat::None,
        "none" | "once" => repeat == Repeat::None,
        "daily" => repeat == Repeat::Daily,
        "weekly" => repeat == Repeat::Weekly,
        _ => false,
    }
}

fn mentions(d: &Downtime, search: &str) -> bool {
    let needle = search.trim().to_lowercase();
    d.name.to_lowercase().contains(&needle)
        || d.reason
            .as_deref()
            .is_some_and(|r| r.to_lowercase().contains(&needle))
}

fn names_alert(d: &Downtime, alert: &TargetItem<'_>) -> bool {
    let Some(target) = scope::target_for(&d.targets, TargetModule::Alerts) else {
        return false;
    };
    if target.ids.iter().any(|id| id == alert.id) {
        return true;
    }
    d.condition.as_ref().is_some_and(|cond| {
        target.ids.is_empty()
            && scope::matches(target, None, alert)
            && scope::eval_condition(cond, alert.dimensions)
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::meta::downtimes::{
        DimensionCondition, DowntimeSchedule, DowntimeTarget, PairOperator, TargetFolders,
    };

    use super::*;

    fn item(id: &str, status: DowntimeStatus, repeat: Repeat, updated_at: i64) -> DowntimeListItem {
        DowntimeListItem {
            downtime: Downtime {
                id: id.to_string(),
                org: "acme".to_string(),
                folder_id: if id.starts_with('p') {
                    "planned"
                } else {
                    "default"
                }
                .to_string(),
                name: format!("{id} maintenance"),
                reason: Some("CHG-4471".to_string()),
                condition: Some(DimensionCondition::Pair {
                    key: "service".to_string(),
                    operator: PairOperator::Eq,
                    value: "payments".to_string(),
                }),
                targets: vec![DowntimeTarget {
                    module: TargetModule::Alerts,
                    folders: TargetFolders::All,
                    tags: vec![],
                    ids: vec![],
                    slo_mode: None,
                }],
                schedule: DowntimeSchedule {
                    repeat,
                    starts_at: 0,
                    ends_at: None,
                    timezone: "UTC".to_string(),
                    start_time_local: None,
                    duration_secs: 60,
                    weekdays: vec![],
                },
                cancelled_at: None,
                cancelled_by: None,
                show_banner: true,
                created_by: "lin".to_string(),
                created_at: 0,
                updated_by: "lin".to_string(),
                updated_at,
            },
            status,
            current_window: None,
            next_window: None,
            matched_alerts: 0,
            matched_anomalies: 0,
            matched_synthetics: 0,
            matched_slos: 0,
        }
    }

    fn rows() -> Vec<DowntimeListItem> {
        vec![
            item("a", DowntimeStatus::Active, Repeat::None, 5),
            item("p1", DowntimeStatus::Scheduled, Repeat::Weekly, 4),
            item("p2", DowntimeStatus::Scheduled, Repeat::None, 3),
            item("e", DowntimeStatus::Ended, Repeat::None, 2),
            item("c", DowntimeStatus::Cancelled, Repeat::Daily, 1),
        ]
    }

    fn ids(resp: &ListResponse) -> Vec<&str> {
        resp.items.iter().map(|i| i.downtime.id.as_str()).collect()
    }

    #[test]
    fn counts_cover_the_filtered_rows_and_recurring_overlaps() {
        let resp = list_page(rows(), &ListQuery::default(), None);
        assert_eq!(resp.total, 5);
        assert_eq!(
            resp.counts,
            StatusCounts {
                active: 1,
                scheduled: 2,
                recurring: 2,
                ended: 1,
                cancelled: 1,
            }
        );
        assert_eq!(ids(&resp), ["a", "p1", "p2", "e", "c"]);
    }

    #[test]
    fn filters_by_folder_status_repeat_and_search() {
        let q = |f: fn(&mut ListQuery)| {
            let mut query = ListQuery::default();
            f(&mut query);
            list_page(rows(), &query, None)
        };
        assert_eq!(
            ids(&q(|q| q.folder_id = Some("planned".into()))),
            ["p1", "p2"]
        );
        assert_eq!(
            ids(&q(|q| q.status = Some("scheduled".into()))),
            ["p1", "p2"]
        );
        assert_eq!(
            ids(&q(|q| q.repeat = Some("recurring".into()))),
            ["p1", "c"]
        );
        assert_eq!(
            ids(&q(|q| q.repeat = Some("none".into()))),
            ["a", "p2", "e"]
        );
        assert_eq!(ids(&q(|q| q.search = Some("P1 MAINT".into()))), ["p1"]);
        assert_eq!(q(|q| q.search = Some("chg-4471".into())).total, 5);
    }

    #[test]
    fn pages_are_one_based_and_capped() {
        let query = ListQuery {
            page: Some(2),
            page_size: Some(2),
            ..Default::default()
        };
        let resp = list_page(rows(), &query, None);
        assert_eq!(ids(&resp), ["p2", "e"]);
        assert_eq!(resp.total, 5);
        let huge = ListQuery {
            page_size: Some(10_000),
            ..Default::default()
        };
        assert_eq!(list_page(rows(), &huge, None).items.len(), 5);
    }

    #[test]
    fn the_alert_filter_reads_ids_and_the_condition() {
        let dims = HashMap::from([("service".to_string(), "payments".to_string())]);
        let alert = TargetItem {
            id: "al1",
            folder_id: "default",
            dimensions: &dims,
            tags: &[],
        };
        let query = ListQuery {
            alert_id: Some("al1".into()),
            ..Default::default()
        };
        assert_eq!(list_page(rows(), &query, Some(&alert)).total, 5);
        let other = HashMap::from([("service".to_string(), "checkout".to_string())]);
        let unrelated = TargetItem {
            dimensions: &other,
            ..alert
        };
        assert_eq!(list_page(rows(), &query, Some(&unrelated)).total, 0);
        assert_eq!(list_page(rows(), &query, None).total, 0);
    }
}
