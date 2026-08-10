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

//! Escalation policy — a team's ladder and its channels.
//!
//! A policy belongs to a team, not to the org: two teams disagreeing about
//! whether P3 should ring a phone is normal, and the disagreement should not
//! require a global setting.
//!
//! Everything here ships as an **editable default**. The point of the
//! defaults is that a newly created team is pageable immediately without
//! anyone designing a policy first; the point of them being editable is that
//! nothing in this file is a rule the product enforces on a team.
//!
//! [`plan`] is the whole decision: given a ladder, how long the record has
//! been open, and who has already been notified, it returns who to notify now
//! and when to wake up next. No clock, no I/O.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    target::{EscalationTarget, TargetError},
    rotation::{MICROS_PER_HOUR, MICROS_PER_MINUTE},
};
use crate::meta::alerts::priority::AlertPriority;

/// How a page reaches a person.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    Email,
    Sms,
    Voice,
    /// Slack, Teams, Google Chat — the team's chat destination.
    Chat,
    /// An existing alert Destination — Slack, Teams, or any HTTP endpoint.
    Webhook,
    /// Mobile push.
    Push,
    /// Shown in the product, never delivered anywhere.
    InApp,
}

impl Channel {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Email => 1,
            Self::Sms => 2,
            Self::Voice => 3,
            Self::Chat => 4,
            Self::Push => 5,
            Self::InApp => 6,
            Self::Webhook => 7,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Email),
            2 => Some(Self::Sms),
            3 => Some(Self::Voice),
            4 => Some(Self::Chat),
            5 => Some(Self::Push),
            6 => Some(Self::InApp),
            7 => Some(Self::Webhook),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Sms => "sms",
            Self::Voice => "voice",
            Self::Chat => "chat",
            Self::Push => "push",
            Self::InApp => "in_app",
            Self::Webhook => "webhook",
        }
    }

    /// Channels that interrupt a sleeping person. Used to decide what a
    /// follow-up update may NOT re-fire: urgent channels are reserved for
    /// "a human is needed", not "news arrived".
    pub fn is_interrupting(&self) -> bool {
        matches!(self, Self::Voice | Self::Sms | Self::Push)
    }

    /// Whether a `Notifier` can actually deliver this channel today.
    ///
    /// The enum carries every channel the design calls for so the stored shape
    /// does not change when providers land, but only Email has an
    /// implementation. Offering the rest in the UI, or shipping them as
    /// defaults, would store a promise that silently delivers nothing — the
    /// worst possible failure for a paging system.
    pub fn is_deliverable(&self) -> bool {
        matches!(self, Self::Email | Self::Webhook)
    }

    /// Every channel a page can actually reach a person on today.
    pub fn deliverable() -> Vec<Self> {
        [
            Self::Email,
            Self::Webhook,
            Self::Sms,
            Self::Voice,
            Self::Chat,
            Self::Push,
            Self::InApp,
        ]
        .into_iter()
        .filter(Self::is_deliverable)
        .collect()
    }
}

/// One rung: when it fires, and everyone it pages.
///
/// The delay identifies the rung. Targets that fire together belong to the
/// same rung by construction, so a ladder can never show three consecutive
/// rows all saying "immediately" and leave a reader guessing at the order.
/// It also gives the delivery ledger a key that survives reordering and
/// renaming, which a positional index would not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct LadderStep {
    /// Delay from `opened_at`, in microseconds. Unique within a rung.
    pub after_micros: i64,
    /// Paged simultaneously. At least one.
    pub targets: Vec<EscalationTarget>,
}

impl LadderStep {
    pub fn new(after_micros: i64, targets: Vec<EscalationTarget>) -> Self {
        Self {
            after_micros,
            targets,
        }
    }
}

/// One priority's ladder and channel set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PriorityRung {
    pub priority: AlertPriority,
    /// Empty means this priority never pages a human.
    pub steps: Vec<LadderStep>,
    /// Applies to everyone paged at this priority — the primary and the
    /// secondary are not treated differently.
    pub channels: Vec<Channel>,
}

/// A team's escalation policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EscalationPolicy {
    pub id: String,
    pub org_id: String,
    pub team_id: String,
    pub rungs: Vec<PriorityRung>,
    /// Alert Destination names this team pages through when a rung includes
    /// the Webhook channel. Reuses the destinations an org already has rather
    /// than storing URLs a second time.
    #[serde(default)]
    pub destinations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyError {
    NegativeDelay(i64),
    /// Two rungs at the same delay. They would fire together, which is one
    /// rung with both target sets — say that instead.
    DuplicateDelay(i64),
    /// A rung that pages nobody is not a rung. Nothing else in the product
    /// renders an unconfigured step, and neither should this.
    NoTargets(i64),
    BadTarget(TargetError),
    DuplicatePriority(AlertPriority),
    /// A priority that pages has to page somewhere.
    NoChannels(AlertPriority),
}

/// What the engine should do right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LadderAction {
    /// Notify these levels now, then wake up at `next_wakeup_micros` (elapsed,
    /// not absolute) if there is another rung.
    Notify {
        /// The rungs due now, in delay order.
        due: Vec<LadderStep>,
        next_wakeup_micros: Option<i64>,
    },
    /// Nothing due yet; come back at this elapsed offset.
    Wait { next_wakeup_micros: i64 },
    /// The ladder is finished. Nobody left to escalate to.
    Exhausted,
}

impl EscalationPolicy {
    /// The defaults a team is created with.
    ///
    /// P1 pages primary, secondary and L1 together — for a critical page,
    /// staggering the people who can fix it buys nothing. Lower priorities
    /// walk the ladder. P4 and P5 page nobody: they are recorded and shown in
    /// the product, and the agent still investigates them.
    ///
    /// Every paging priority defaults to Email because Email is the only
    /// channel a `Notifier` can deliver ([`Channel::is_deliverable`]). When
    /// SMS and voice land, THIS is the function that changes — the defaults
    /// should never promise a channel that does not send.
    pub fn default_for_team(
        id: impl Into<String>,
        org_id: impl Into<String>,
        team_id: impl Into<String>,
    ) -> Self {
        use AlertPriority::*;
        let m = MICROS_PER_MINUTE;
        // One rotation is enough to be pageable. The ladder walks it — on call
        // now, then whoever it hands over to next — so a "secondary" needs no
        // second schedule to staff, and then falls back to the whole team.
        let ladder = |first: i64, second: i64| {
            vec![
                LadderStep::new(0, vec![EscalationTarget::OnCallNow]),
                LadderStep::new(first, vec![EscalationTarget::NextOnCall]),
                LadderStep::new(second, vec![EscalationTarget::WholeTeam]),
            ]
        };
        Self {
            id: id.into(),
            org_id: org_id.into(),
            team_id: team_id.into(),
            destinations: vec![],
            rungs: vec![
                PriorityRung {
                    priority: P1,
                    steps: ladder(5 * m, 15 * m),
                    channels: vec![Channel::Email],
                },
                PriorityRung {
                    priority: P2,
                    steps: ladder(15 * m, 30 * m),
                    channels: vec![Channel::Email],
                },
                PriorityRung {
                    priority: P3,
                    steps: vec![LadderStep::new(0, vec![EscalationTarget::OnCallNow])],
                    channels: vec![Channel::Email],
                },
                // P4 and P5 are recorded and investigated, never paged.
                PriorityRung {
                    priority: P4,
                    steps: vec![],
                    channels: vec![],
                },
                PriorityRung {
                    priority: P5,
                    steps: vec![],
                    channels: vec![],
                },
            ],
        }
    }

    pub fn rung(&self, priority: AlertPriority) -> Option<&PriorityRung> {
        self.rungs.iter().find(|r| r.priority == priority)
    }

    /// Whether this priority pages a human at all.
    pub fn pages_anyone(&self, priority: AlertPriority) -> bool {
        self.rung(priority).is_some_and(|r| !r.steps.is_empty())
    }

    pub fn validate(&self) -> Result<(), PolicyError> {
        let mut seen_priority = std::collections::HashSet::new();
        for rung in &self.rungs {
            if !seen_priority.insert(rung.priority.to_i32()) {
                return Err(PolicyError::DuplicatePriority(rung.priority));
            }
            if !rung.steps.is_empty() && rung.channels.is_empty() {
                return Err(PolicyError::NoChannels(rung.priority));
            }
            let mut seen_delay = std::collections::HashSet::new();
            for step in &rung.steps {
                if step.after_micros < 0 {
                    return Err(PolicyError::NegativeDelay(step.after_micros));
                }
                if step.targets.is_empty() {
                    return Err(PolicyError::NoTargets(step.after_micros));
                }
                for target in &step.targets {
                    target.validate().map_err(PolicyError::BadTarget)?;
                }
                if !seen_delay.insert(step.after_micros) {
                    return Err(PolicyError::DuplicateDelay(step.after_micros));
                }
            }
        }
        Ok(())
    }
}

/// Decide what happens now.
///
/// `elapsed_micros` is measured from the record's `opened_at`, and
/// `already_notified` is what the delivery ledger says has gone out. Passing
/// the ledger in — rather than tracking a cursor — is what makes replays,
/// retries and a promoted severity safe: re-running with the same inputs
/// notifies nobody twice.
pub fn plan(
    steps: &[LadderStep],
    elapsed_micros: i64,
    already_notified: &[i64],
) -> LadderAction {
    let mut due: Vec<LadderStep> = Vec::new();
    let mut next: Option<i64> = None;

    for step in steps {
        if step.after_micros <= elapsed_micros {
            if !already_notified.contains(&step.after_micros) {
                due.push(step.clone());
            }
        } else {
            // Steps are not required to be stored in order, so take the
            // minimum rather than the first one past the cursor.
            next = Some(next.map_or(step.after_micros, |n: i64| n.min(step.after_micros)));
        }
    }

    if !due.is_empty() {
        due.sort_by_key(|s| s.after_micros);
        return LadderAction::Notify {
            due,
            next_wakeup_micros: next,
        };
    }
    match next {
        Some(n) => LadderAction::Wait {
            next_wakeup_micros: n,
        },
        None => LadderAction::Exhausted,
    }
}

impl std::fmt::Display for Channel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NegativeDelay(v) => write!(f, "escalation delay cannot be negative, got {v}"),
            Self::DuplicateDelay(v) => write!(
                f,
                "two rungs both fire at {v}us; they are one rung with both sets of targets"
            ),
            Self::NoTargets(v) => write!(f, "the rung at {v}us pages nobody"),
            Self::BadTarget(e) => write!(f, "{e}"),
            Self::DuplicatePriority(p) => write!(f, "priority `{p}` is configured twice"),
            Self::NoChannels(p) => {
                write!(f, "priority `{p}` pages somebody but has no channels")
            }
        }
    }
}

impl std::error::Error for PolicyError {}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = MICROS_PER_MINUTE;

    fn policy() -> EscalationPolicy {
        EscalationPolicy::default_for_team("pol_1", "default", "team_1")
    }

    fn steps(priority: AlertPriority) -> Vec<LadderStep> {
        policy().rung(priority).unwrap().steps.clone()
    }

    #[test]
    fn test_channel_storage_ids_are_pinned() {
        let all = [
            (Channel::Email, 1),
            (Channel::Sms, 2),
            (Channel::Voice, 3),
            (Channel::Chat, 4),
            (Channel::Push, 5),
            (Channel::InApp, 6),
        ];
        for (c, want) in all {
            assert_eq!(c.to_i32(), want, "{c} moved");
            assert_eq!(Channel::from_i32(want), Some(c));
        }
        assert_eq!(Channel::from_i32(0), None);
        assert_eq!(Channel::from_i32(8), None);
        assert_eq!(Channel::Webhook.to_i32(), 7);
    }

    #[test]
    fn test_interrupting_channels_are_the_ones_that_wake_people() {
        for c in [Channel::Voice, Channel::Sms, Channel::Push] {
            assert!(c.is_interrupting(), "{c} wakes a sleeping person");
        }
        for c in [Channel::Email, Channel::Chat, Channel::InApp] {
            assert!(!c.is_interrupting(), "{c} does not wake anyone");
        }
    }

    #[test]
    fn test_defaults_are_valid_and_cover_every_priority() {
        let p = policy();
        p.validate().unwrap();
        for pr in [
            AlertPriority::P1,
            AlertPriority::P2,
            AlertPriority::P3,
            AlertPriority::P4,
            AlertPriority::P5,
        ] {
            assert!(p.rung(pr).is_some(), "{pr} has no configuration");
        }
    }

    fn delays(action: &LadderAction) -> Vec<i64> {
        match action {
            LadderAction::Notify { due, .. } => due.iter().map(|s| s.after_micros).collect(),
            other => panic!("expected a page, got {other:?}"),
        }
    }

    fn targets_of(action: &LadderAction) -> Vec<EscalationTarget> {
        match action {
            LadderAction::Notify { due, .. } => {
                due.iter().flat_map(|s| s.targets.clone()).collect()
            }
            other => panic!("expected a page, got {other:?}"),
        }
    }

    /// One rotation is enough to be pageable. A "secondary" is the ladder
    /// walking that rotation, not a second schedule somebody has to staff.
    #[test]
    fn test_the_default_ladder_needs_only_one_rotation() {
        let action = plan(&steps(AlertPriority::P1), 0, &[]);
        assert_eq!(targets_of(&action), vec![EscalationTarget::OnCallNow]);

        let later = plan(&steps(AlertPriority::P1), 5 * MIN, &[0]);
        assert_eq!(targets_of(&later), vec![EscalationTarget::NextOnCall]);

        let last = plan(&steps(AlertPriority::P1), 15 * MIN, &[0, 5 * MIN]);
        assert_eq!(targets_of(&last), vec![EscalationTarget::WholeTeam]);
    }

    /// P4 and P5 are recorded and investigated, but page nobody.
    #[test]
    fn test_lowest_priorities_page_nobody() {
        let p = policy();
        for pr in [AlertPriority::P4, AlertPriority::P5] {
            assert!(!p.pages_anyone(pr), "{pr} must not page");
            assert_eq!(plan(&steps(pr), 0, &[]), LadderAction::Exhausted);
            assert_eq!(
                plan(&steps(pr), 99 * MICROS_PER_HOUR, &[]),
                LadderAction::Exhausted,
                "{pr} must still page nobody later"
            );
        }
        for pr in [AlertPriority::P1, AlertPriority::P2, AlertPriority::P3] {
            assert!(p.pages_anyone(pr), "{pr} must page");
        }
    }

    /// The whole reason the ledger is an input: re-running the same decision
    /// must not page anyone a second time.
    #[test]
    fn test_replaying_with_the_same_ledger_notifies_nobody_twice() {
        let s = steps(AlertPriority::P1);
        let first = plan(&s, 0, &[]);
        match plan(&s, 0, &delays(&first)) {
            LadderAction::Wait { next_wakeup_micros } => assert_eq!(next_wakeup_micros, 5 * MIN),
            other => panic!("replay must not re-page, got {other:?}"),
        }
    }

    #[test]
    fn test_ladder_advances_as_time_passes() {
        let s = steps(AlertPriority::P1);
        let mut notified: Vec<i64> = vec![];
        let mut fired: Vec<(i64, EscalationTarget)> = vec![];

        for elapsed in [0, 5 * MIN, 15 * MIN, MICROS_PER_HOUR] {
            if let LadderAction::Notify { due, .. } = plan(&s, elapsed, &notified) {
                for step in due {
                    for target in &step.targets {
                        fired.push((elapsed, target.clone()));
                    }
                    notified.push(step.after_micros);
                }
            }
        }
        assert_eq!(
            fired,
            vec![
                (0, EscalationTarget::OnCallNow),
                (5 * MIN, EscalationTarget::NextOnCall),
                (15 * MIN, EscalationTarget::WholeTeam),
            ]
        );
        assert_eq!(
            plan(&s, 2 * MICROS_PER_HOUR, &notified),
            LadderAction::Exhausted,
            "a fully walked ladder must terminate"
        );
    }

    /// The rung fires at its delay, not after it.
    #[test]
    fn test_a_step_is_due_exactly_at_its_delay() {
        let s = steps(AlertPriority::P1);
        assert!(matches!(
            plan(&s, 5 * MIN - 1, &[0]),
            LadderAction::Wait { .. }
        ));
        assert!(matches!(
            plan(&s, 5 * MIN, &[0]),
            LadderAction::Notify { .. }
        ));
    }

    /// A worker that slept through several rungs must catch up in one pass
    /// rather than paging one rung per wakeup.
    #[test]
    fn test_a_late_wakeup_fires_every_missed_rung_at_once() {
        let s = steps(AlertPriority::P1);
        match plan(&s, 40 * MIN, &[]) {
            LadderAction::Notify {
                due,
                next_wakeup_micros,
            } => {
                assert_eq!(
                    due.iter().map(|s| s.after_micros).collect::<Vec<_>>(),
                    vec![0, 5 * MIN, 15 * MIN]
                );
                assert_eq!(next_wakeup_micros, None, "the ladder is fully walked");
            }
            other => panic!("expected a catch-up page, got {other:?}"),
        }
    }

    /// A rung pages everyone on it at once — the case a six-slot vocabulary
    /// could not express: two named people, together, at one delay.
    #[test]
    fn test_one_rung_pages_several_people_together() {
        let rung = vec![LadderStep::new(
            0,
            vec![
                EscalationTarget::user("manager@o2.ai"),
                EscalationTarget::user("lead@o2.ai"),
            ],
        )];
        assert_eq!(
            targets_of(&plan(&rung, 0, &[])),
            vec![
                EscalationTarget::user("manager@o2.ai"),
                EscalationTarget::user("lead@o2.ai")
            ]
        );
    }

    /// Two rungs at one delay would fire together, which IS one rung with both
    /// target sets. Allowing both spellings is how a ladder ends up showing
    /// three consecutive rows that all say "immediately".
    #[test]
    fn test_two_rungs_cannot_share_a_delay() {
        let mut p = policy();
        p.rungs[0].steps = vec![
            LadderStep::new(0, vec![EscalationTarget::OnCallNow]),
            LadderStep::new(0, vec![EscalationTarget::WholeTeam]),
        ];
        assert_eq!(p.validate(), Err(PolicyError::DuplicateDelay(0)));
    }

    /// Nothing else in the product renders an unconfigured step, and a rung
    /// that pages nobody is exactly that.
    #[test]
    fn test_a_rung_must_page_somebody() {
        let mut p = policy();
        p.rungs[0].steps = vec![LadderStep::new(0, vec![])];
        assert_eq!(p.validate(), Err(PolicyError::NoTargets(0)));

        p.rungs[0].steps = vec![LadderStep::new(0, vec![EscalationTarget::user("  ")])];
        assert!(matches!(p.validate(), Err(PolicyError::BadTarget(_))));
    }

    #[test]
    fn test_due_rungs_come_back_in_delay_order() {
        let unordered = vec![
            LadderStep::new(30 * MIN, vec![EscalationTarget::WholeTeam]),
            LadderStep::new(0, vec![EscalationTarget::OnCallNow]),
            LadderStep::new(5 * MIN, vec![EscalationTarget::NextOnCall]),
        ];
        assert_eq!(
            delays(&plan(&unordered, MICROS_PER_HOUR, &[])),
            vec![0, 5 * MIN, 30 * MIN]
        );
    }

    /// Steps are stored as JSON and may come back in any order; the next
    /// wakeup must be the soonest one, not the first one encountered.
    #[test]
    fn test_next_wakeup_is_the_soonest_pending_step() {
        let unordered = vec![
            LadderStep::new(30 * MIN, vec![EscalationTarget::WholeTeam]),
            LadderStep::new(5 * MIN, vec![EscalationTarget::NextOnCall]),
            LadderStep::new(15 * MIN, vec![EscalationTarget::EveryoneOnSchedule]),
        ];
        assert_eq!(
            plan(&unordered, 0, &[]),
            LadderAction::Wait {
                next_wakeup_micros: 5 * MIN
            }
        );
    }

    #[test]
    fn test_an_empty_ladder_is_exhausted_not_waiting() {
        assert_eq!(plan(&[], 0, &[]), LadderAction::Exhausted);
    }

    #[test]
    fn test_validate_rejects_broken_policies() {
        let mut p = policy();
        p.rungs[0].steps[0].after_micros = -1;
        assert_eq!(p.validate(), Err(PolicyError::NegativeDelay(-1)));

        p = policy();
        p.rungs.push(p.rungs[0].clone());
        assert_eq!(
            p.validate(),
            Err(PolicyError::DuplicatePriority(AlertPriority::P1))
        );

        p = policy();
        p.rungs[0].channels.clear();
        assert_eq!(
            p.validate(),
            Err(PolicyError::NoChannels(AlertPriority::P1)),
            "a priority that pages must page somewhere"
        );
    }

    /// A priority that pages nobody is allowed to have no channels beyond the
    /// in-app surface — that is P4, not a misconfiguration.
    #[test]
    fn test_a_non_paging_priority_needs_no_paging_channels() {
        let mut p = policy();
        let idx = p
            .rungs
            .iter()
            .position(|r| r.priority == AlertPriority::P4)
            .unwrap();
        p.rungs[idx].channels.clear();
        p.validate().unwrap();
    }

    /// A default that names a channel nothing can send stores a promise the
    /// engine silently drops — the worst failure mode a pager has.
    #[test]
    fn test_defaults_only_use_channels_that_can_be_delivered() {
        let p = policy();
        for rung in &p.rungs {
            for channel in &rung.channels {
                assert!(
                    channel.is_deliverable(),
                    "{} defaults to {channel}, which no Notifier can send",
                    rung.priority
                );
            }
        }
    }

    /// Only Email has an implementation today. This test is the reminder to
    /// revisit the defaults when a provider lands, not a statement that the
    /// other channels are wrong to exist.
    #[test]
    fn test_email_is_the_only_deliverable_channel_today() {
        assert_eq!(
            Channel::deliverable(),
            vec![Channel::Email, Channel::Webhook]
        );
        for c in [
            Channel::Sms,
            Channel::Voice,
            Channel::Chat,
            Channel::Push,
            Channel::InApp,
        ] {
            assert!(!c.is_deliverable(), "{c} has no Notifier yet");
        }
    }

    /// A priority that pages nobody needs no delivery channel; its record is
    /// still visible in the product.
    #[test]
    fn test_non_paging_priorities_carry_no_channels() {
        let p = policy();
        for pr in [AlertPriority::P4, AlertPriority::P5] {
            assert!(p.rung(pr).unwrap().channels.is_empty());
        }
        p.validate().unwrap();
    }

    #[test]
    fn test_policy_round_trips_through_json() {
        let p = policy();
        let back: EscalationPolicy =
            serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(back, p);
    }
}
