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

//! Which live view of the alert list a row belongs to, and the order that view sorts in.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The `state` filter of the alert list; the views overlap, so a row can be in several.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AlertLiveState {
    Firing,
    Acked,
    Muted,
    Failed,
    Recovered,
}

/// How many visible alerts each view holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AlertLiveCounts {
    pub firing: u64,
    pub acked: u64,
    pub muted: u64,
    pub failed: u64,
    pub recovered: u64,
}

impl AlertLiveCounts {
    /// Count one row into every view it belongs to.
    pub fn add(&mut self, facts: &AlertLiveFacts<'_>) {
        self.firing += u64::from(facts.is_in(AlertLiveState::Firing));
        self.acked += u64::from(facts.is_in(AlertLiveState::Acked));
        self.muted += u64::from(facts.is_in(AlertLiveState::Muted));
        self.failed += u64::from(facts.is_in(AlertLiveState::Failed));
        self.recovered += u64::from(facts.is_in(AlertLiveState::Recovered));
    }
}

/// What the views read from one list row.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AlertLiveFacts<'a> {
    pub last_outcome: Option<&'a str>,
    pub firing_started_at: Option<i64>,
    pub priority: Option<u8>,
    pub groups_firing: Option<i32>,
    pub groups_firing_is_lower_bound: Option<bool>,
    pub groups_acked: Option<u32>,
    pub in_downtime: bool,
    /// It left a firing state inside the requested window and is still normal.
    pub recovered: bool,
}

impl AlertLiveFacts<'_> {
    pub fn is_in(&self, state: AlertLiveState) -> bool {
        match state {
            AlertLiveState::Firing => {
                self.is_firing() && !self.is_fully_acked() && !self.in_downtime
            }
            AlertLiveState::Acked => self.is_firing() && self.is_fully_acked(),
            AlertLiveState::Muted => self.is_firing() && self.in_downtime,
            AlertLiveState::Failed => self.is_not_delivered(),
            AlertLiveState::Recovered => self.recovered && !self.is_firing(),
        }
    }

    /// Not delivered, then P1..P5 with unset last, then the earliest firing with unknown last.
    pub fn sort_key(&self) -> (bool, bool, Option<u8>, bool, Option<i64>) {
        (
            !self.is_not_delivered(),
            self.priority.is_none(),
            self.priority,
            self.firing_started_at.is_none(),
            self.firing_started_at,
        )
    }

    fn is_not_delivered(&self) -> bool {
        self.last_outcome == Some("notify_failed")
    }

    // An errored run or frozen evaluation observed no recovery, so the open firing still stands.
    fn is_firing(&self) -> bool {
        matches!(self.last_outcome, Some("firing" | "notify_failed"))
            || self.firing_started_at.is_some()
            || (self.last_outcome == Some("error") && self.groups_firing.unwrap_or(0) > 0)
    }

    // Partly acked stays actionable: a page keeps paging while any group is unacked.
    fn is_fully_acked(&self) -> bool {
        let Some(acked) = self.groups_acked.filter(|acked| *acked > 0) else {
            return false;
        };
        match self.groups_firing {
            None => true,
            Some(firing) => {
                self.groups_firing_is_lower_bound != Some(true)
                    && i64::from(acked) >= i64::from(firing)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use AlertLiveState::{Acked, Failed, Firing, Muted, Recovered};

    use super::*;

    fn outcome(outcome: &str) -> AlertLiveFacts<'_> {
        AlertLiveFacts {
            last_outcome: Some(outcome),
            ..Default::default()
        }
    }

    fn views(facts: AlertLiveFacts<'_>) -> Vec<AlertLiveState> {
        [Firing, Acked, Muted, Failed, Recovered]
            .into_iter()
            .filter(|state| facts.is_in(*state))
            .collect()
    }

    #[test]
    fn test_classification_table() {
        let acked = AlertLiveFacts {
            groups_acked: Some(1),
            ..outcome("firing")
        };
        let muted = AlertLiveFacts {
            in_downtime: true,
            ..outcome("firing")
        };
        let cases = [
            ("firing", outcome("firing"), vec![Firing]),
            (
                "not delivered",
                outcome("notify_failed"),
                vec![Firing, Failed],
            ),
            ("normal", outcome("normal"), vec![]),
            ("never ran", AlertLiveFacts::default(), vec![]),
            ("pending", outcome("pending"), vec![]),
            ("error with no firing", outcome("error"), vec![]),
            ("acked", acked, vec![Acked]),
            (
                "acked but not delivered",
                AlertLiveFacts {
                    groups_acked: Some(1),
                    ..outcome("notify_failed")
                },
                vec![Acked, Failed],
            ),
            ("muted", muted, vec![Muted]),
            (
                "muted not delivered",
                AlertLiveFacts {
                    in_downtime: true,
                    ..outcome("notify_failed")
                },
                vec![Muted, Failed],
            ),
            (
                "muted and acked",
                AlertLiveFacts {
                    in_downtime: true,
                    groups_acked: Some(1),
                    ..outcome("firing")
                },
                vec![Acked, Muted],
            ),
            (
                "muted but not firing",
                AlertLiveFacts {
                    in_downtime: true,
                    ..outcome("normal")
                },
                vec![],
            ),
            (
                "recovered",
                AlertLiveFacts {
                    recovered: true,
                    ..outcome("normal")
                },
                vec![Recovered],
            ),
        ];
        for (name, facts, expected) in cases {
            assert_eq!(views(facts), expected, "{name}");
        }
    }

    #[test]
    fn test_an_errored_run_does_not_end_an_open_firing() {
        let single = AlertLiveFacts {
            firing_started_at: Some(10),
            ..outcome("error")
        };
        let multi = AlertLiveFacts {
            groups_firing: Some(2),
            ..outcome("error")
        };
        assert_eq!(views(single), vec![Firing]);
        assert_eq!(views(multi), vec![Firing]);
    }

    #[test]
    fn test_partly_acked_multi_alert_stays_firing() {
        let cases = [
            ("no group acked", None, Some(3), None, vec![Firing]),
            ("one of three", Some(1), Some(3), None, vec![Firing]),
            ("all three", Some(3), Some(3), None, vec![Acked]),
            (
                "more acked than counted",
                Some(4),
                Some(3),
                None,
                vec![Acked],
            ),
            (
                "count is a floor",
                Some(3),
                Some(3),
                Some(true),
                vec![Firing],
            ),
            ("count is exact", Some(3), Some(3), Some(false), vec![Acked]),
        ];
        for (name, groups_acked, groups_firing, lower_bound, expected) in cases {
            let facts = AlertLiveFacts {
                groups_acked,
                groups_firing,
                groups_firing_is_lower_bound: lower_bound,
                ..outcome("firing")
            };
            assert_eq!(views(facts), expected, "{name}");
        }
    }

    #[test]
    fn test_sort_order() {
        let row = |last_outcome, priority, firing_started_at| AlertLiveFacts {
            last_outcome: Some(last_outcome),
            priority,
            firing_started_at,
            ..Default::default()
        };
        let expected = [
            row("notify_failed", Some(5), Some(90)),
            row("notify_failed", None, Some(1)),
            row("firing", Some(1), Some(20)),
            row("firing", Some(1), Some(30)),
            row("firing", Some(1), None),
            row("firing", Some(2), Some(1)),
            row("firing", Some(5), Some(1)),
            row("firing", None, Some(1)),
            row("firing", None, None),
        ];
        let mut sorted = expected;
        sorted.reverse();
        sorted.sort_by_key(AlertLiveFacts::sort_key);
        assert_eq!(sorted, expected);
    }

    #[test]
    fn test_counts_overlap_like_the_views() {
        let mut counts = AlertLiveCounts::default();
        counts.add(&outcome("firing"));
        counts.add(&outcome("notify_failed"));
        counts.add(&outcome("normal"));
        counts.add(&AlertLiveFacts {
            groups_acked: Some(1),
            ..outcome("firing")
        });
        counts.add(&AlertLiveFacts {
            in_downtime: true,
            ..outcome("firing")
        });
        assert_eq!(
            counts,
            AlertLiveCounts {
                firing: 2,
                acked: 1,
                muted: 1,
                failed: 1,
                recovered: 0,
            }
        );
    }
}
