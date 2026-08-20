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

//! Teams and schedules.
//!
//! An on-call team is **not** an RBAC group. A group answers "who may see
//! this"; a team answers "who gets woken". Coupling them would let a
//! permission change silently rewrite a rotation, so the two are deliberately
//! separate objects with no link between them.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rotation::{
    AwayShift, ShiftRule, CoverageSegment, DEFAULT_ROTATION_NAME, GridError, MAX_AWAY_SHIFTS, OnCallPosition,
    Rotation, ScheduleOverride, Unavailability, away_assignments, colliding_rotations,
    everyone_on_call, resolve_on_call, resolve_window,
};

/// A group of people who can be paged together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Team {
    pub id: String,
    pub org_id: String,
    pub name: String,
    /// IANA name, used to render schedules in the team's own working hours.
    /// Stored, not interpreted — resolution is in absolute micros.
    pub timezone: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Alert Destination names this team is talked to on — the room the record
    /// is posted to, as opposed to the people the ladder wakes.
    ///
    /// `None` means never set, which falls back to
    /// `EscalationPolicy::destinations` so stored policies keep working;
    /// `Some([])` means deliberately no channel. Precedence lives in one place,
    /// `config::meta::oncall::policy::team_channel`.
    ///
    /// It is on the team rather than the policy because a team's room is not a
    /// property of its escalation ladder — you want it without ever editing a
    /// rung — and because a whole-row super-cluster snapshot built from `Team`
    /// would otherwise have to carry a column it cannot see.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_destinations: Option<Vec<String>>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Membership — a flat list of who is on the team.
///
/// Deliberately carries no level. Which rung somebody covers is a property of
/// the *rotation* (`Schedule.rotations`), not of belonging to the team: a
/// person is simply on the team, and the schedule says when they are primary,
/// secondary, or neither. Pinning a level here would force one row per level
/// per person and split the same fact across two places.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TeamMember {
    pub id: String,
    pub team_id: String,
    pub user_email: String,
}

/// A team's rotations, one per staffed level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Schedule {
    pub id: String,
    pub org_id: String,
    pub team_id: String,
    pub timezone: String,
    pub rotations: Vec<Rotation>,
    /// Covers in force over this schedule.
    ///
    /// Carried on the schedule rather than fetched separately at each call
    /// site because *every* resolution has to see them. An override that the
    /// page path forgets to load is worse than no override feature at all: the
    /// engineer who arranged cover stops watching, and the page still goes to
    /// them. So the one loader that produces a `Schedule` fills this in, and
    /// nothing downstream can resolve without it.
    ///
    /// Stored in `oncall_overrides`, not in the schedule row — they have their
    /// own lifecycle and their own audit trail.
    #[serde(default)]
    pub overrides: Vec<ScheduleOverride>,
    /// Absences in force over this schedule, for the people on its rotations.
    ///
    /// Carried here for the same reason the covers are, and the reason is the
    /// same failure: a resolution path that loads the schedule and forgets the
    /// absences gets a perfectly plausible answer that pages somebody on a
    /// beach. Stored org-wide in `oncall_unavailability` — an absence is a fact
    /// about a person, not about one of their teams — and narrowed to this
    /// schedule's members by the loader.
    #[serde(default)]
    pub unavailability: Vec<Unavailability>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Where a newly added team member belongs on the team's rotations.
///
/// Membership and the rotation are two different facts — being on the team,
/// and being in the handover order — and they have to be kept in step in both
/// directions. The seeding path only ever ran for a team's *first* members, so
/// anybody added afterwards was on the team and on no rotation: the default
/// ladder's `NextOnCall` rung resolved to nobody, and the second rung of every
/// page went nowhere.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberPlacement {
    /// They are already in the handover order. Nothing to write.
    AlreadyOnRotation,
    /// Appended to the team's single rotation, at the end of the order.
    /// `rotations` is what to store.
    Appended {
        rotation: String,
        rotations: Vec<Rotation>,
    },
    /// The team has no rotation yet. Building one needs an anchor, which needs
    /// a clock, so the caller does it.
    NoRotationYet,
    /// The team runs several rotations — layers, follow-the-sun, a weekend
    /// shift. Which one a new person covers is a real scheduling decision, and
    /// guessing at it would quietly put somebody on call for hours they never
    /// agreed to. The caller says so instead.
    NeedsManualPlacement,
}

/// Decide where `user_email` goes when they join a team that already has
/// rotations.
///
/// A team with exactly one unrestricted rotation is still on the shipped
/// default shape, whatever it has been renamed to or however its shift length
/// has been tuned: appending to the end of the handover order is unambiguous
/// and is what somebody adding a person to the team means. The moment there
/// are layers or restrictions, placement stops being obvious and stops being
/// automatic.
pub fn place_member(rotations: &[Rotation], user_email: &str) -> MemberPlacement {
    let email = user_email.trim().to_ascii_lowercase();
    let names = |r: &Rotation| {
        r.shift_rules
            .iter()
            .any(|s| s.members.iter().any(|m| m.trim().to_ascii_lowercase() == email))
    };
    if rotations.iter().any(names) {
        return MemberPlacement::AlreadyOnRotation;
    }
    // Every rotation that is still on the shipped shape — one unrestricted
    // rule — gets the joiner appended. All of them, not just the first: a team
    // created with Primary and Secondary has two, and adding somebody to one
    // pool and not the other is how the two drift into a collision.
    let simple = |r: &Rotation| {
        matches!(r.shift_rules.as_slice(), [only] if only.restrictions.is_empty() && only.priority == 0)
    };
    match rotations {
        [] => MemberPlacement::NoRotationYet,
        _ if rotations.iter().all(simple) => {
            let appended: Vec<Rotation> = rotations
                .iter()
                .map(|r| {
                    let mut next = r.clone();
                    if let Some(rule) = next.shift_rules.first_mut() {
                        rule.members.push(email.clone());
                    }
                    next
                })
                .collect();
            MemberPlacement::Appended {
                rotation: rotations
                    .iter()
                    .map(|r| r.name.clone())
                    .collect::<Vec<_>>()
                    .join(", "),
                rotations: appended,
            }
        }
        _ => MemberPlacement::NeedsManualPlacement,
    }
}

/// What taking one person off a team did to its rotations.
///
/// Carries the coverage consequences rather than just the new list, because
/// the only thing worse than a rotation with nobody on it is a rotation with
/// nobody on it that nobody was told about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct MemberRemoval {
    /// The rotations as they now stand, ready to be stored.
    pub rotations: Vec<Rotation>,
    /// Rotations this person was the last member of. Each one is a shift that
    /// now has nobody on it.
    pub emptied_rotations: Vec<String>,
    /// Whether anything actually changed. `false` means they were on the team
    /// but on no rotation, and the schedule does not need rewriting.
    pub changed: bool,
    /// The team is left with no rotation at all, so a page for it would reach
    /// nobody.
    pub leaves_no_rotation: bool,
}

impl MemberRemoval {
    /// One line an operator can be shown, or `None` when coverage is intact.
    pub fn coverage_warning(&self) -> Option<String> {
        if self.emptied_rotations.is_empty() {
            return None;
        }
        let names = self.emptied_rotations.join(", ");
        Some(if self.leaves_no_rotation {
            format!(
                "removing this member emptied the last rotation ({names}); the team now pages nobody"
            )
        } else {
            format!("removing this member emptied the rotation(s) {names}, which now staff nobody")
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamError {
    EmptyName,
    /// Two rotations equally in force at the same instant; neither is more
    /// specific, so which one wins would be arbitrary.
    AmbiguousRotations,
    InvalidRotation(super::rotation::RotationError),
    /// Two rotations sharing an id. A level points at one, so the policy would
    /// be ambiguous about which position it pages.
    DuplicateRotationId(String),
}

/// How many instants one coverage sweep will probe for a single schedule.
///
/// A week of hourly steps is 168; the rest of the budget is headroom for a
/// team running several layers with frequent handovers. It is a stop, not a
/// target: hitting it means the walk gave up, and giving up reports no gap
/// rather than a false one.
const MAX_COVERAGE_PROBES: usize = 2_000;

impl Schedule {
    /// The schedule's timezone, or UTC if it names one this build cannot
    /// resolve. Restrictions are expressed in local wall time, so an
    /// unparseable zone must not silently drop every restricted layer.
    pub fn tz(&self) -> chrono_tz::Tz {
        self.timezone.parse().unwrap_or(chrono_tz::UTC)
    }

    /// This team's rotations, in stored order.
    ///
    /// Replaced `slots()`, which reported names from three sources — rotations
    /// that staffed a slot, rotations that *declared* they derived one, and an
    /// implicit append for teams that had said nothing. Two of those three
    /// produced positions with no roster behind them.
    pub fn rotation_names(&self) -> Vec<String> {
        self.rotations
            .iter()
            .filter(|r| r.validate().is_ok())
            .map(|r| r.name.clone())
            .collect()
    }

    /// A rotation by id. What a level of the escalation policy resolves with.
    pub fn rotation(&self, rotation_id: &str) -> Option<&Rotation> {
        self.rotations.iter().find(|r| r.id == rotation_id)
    }

    /// Whether this team staffs more than one position.
    pub fn has_several_rotations(&self) -> bool {
        self.rotations
            .iter()
            .filter(|r| r.validate().is_ok())
            .count()
            > 1
    }

    /// The rotation a team's first level pages when nothing says otherwise:
    /// the one named [`DEFAULT_ROTATION_NAME`], or failing that the first that
    /// validates.
    ///
    /// A *fallback for reads*, not a resolution rule. Levels store an id; this
    /// exists so a screen with nothing selected yet has something to show.
    pub fn primary_rotation(&self) -> Option<&Rotation> {
        self.rotations
            .iter()
            .filter(|r| r.validate().is_ok())
            .find(|r| r.name.eq_ignore_ascii_case(DEFAULT_ROTATION_NAME))
            .or_else(|| self.rotations.iter().find(|r| r.validate().is_ok()))
    }

    /// Everyone on call at `at`, one entry per rotation.
    pub fn on_call_at(&self, at: i64) -> Vec<OnCallPosition> {
        resolve_on_call(
            &self.rotations,
            &self.overrides,
            &self.unavailability,
            at,
            self.tz(),
        )
    }

    /// The person on call at `at` in one rotation.
    pub fn on_call_in(&self, rotation_id: &str, at: i64) -> Option<String> {
        self.rotation(rotation_id)?
            .on_call(&self.overrides, &self.unavailability, at, self.tz())
    }

    /// Everyone on one rotation at `at`, on shift or not.
    pub fn everyone_in(&self, rotation_id: &str, at: i64) -> Vec<String> {
        self.rotation(rotation_id)
            .map(|r| r.everyone(&self.overrides, &self.unavailability, at, self.tz()))
            .unwrap_or_default()
    }

    /// Everybody this team currently has on call, across every rotation.
    pub fn everyone_on_call(&self, at: i64) -> Vec<String> {
        everyone_on_call(
            &self.rotations,
            &self.overrides,
            &self.unavailability,
            at,
            self.tz(),
        )
    }

    /// Rotations that resolve to the same person at `at` — one pager, two
    /// positions. Reported, not prevented; see [`colliding_rotations`].
    pub fn collisions_at(&self, at: i64) -> Vec<(String, Vec<&Rotation>)> {
        colliding_rotations(
            &self.rotations,
            &self.overrides,
            &self.unavailability,
            at,
            self.tz(),
        )
    }

    /// One rotation's resolved schedule across `[from, to)` — §3b's "final
    /// schedule", which is what a human reads instead of the rule maths.
    pub fn resolved_window(
        &self,
        rotation_id: &str,
        from: i64,
        to: i64,
    ) -> Result<Vec<CoverageSegment>, GridError> {
        let Some(rotation) = self.rotation(rotation_id) else {
            return Ok(Vec::new());
        };
        resolve_window(
            rotation,
            &self.overrides,
            &self.unavailability,
            from,
            to,
            self.tz(),
        )
    }

    /// Shifts in `[from, to)` this schedule would hand to somebody who is away.
    ///
    /// The edit-time half of unavailability: the resolver will skip them, and
    /// this is what says so before anybody finds out from the calendar.
    pub fn away_assignments(&self, from: i64, to: i64) -> Vec<AwayShift> {
        away_assignments(
            &self.rotations,
            &self.unavailability,
            from,
            to,
            self.tz(),
            MAX_AWAY_SHIFTS,
        )
    }

    /// Whether a page would reach anybody at all.
    ///
    /// The **primary** rotation is the question, because that is what the first
    /// level of every shipped ladder pages: a team whose secondary is staffed
    /// and whose primary is not still wakes nobody when the alert fires. An
    /// unstaffed rotation further down shows up as its own risk rather than
    /// changing what "covered" means, so adding a rotation can never turn a
    /// covered team into an uncovered one.
    pub fn is_staffed(&self, at: i64) -> bool {
        self.primary_rotation()
            .and_then(|r| r.on_call(&self.overrides, &self.unavailability, at, self.tz()))
            .is_some()
    }

    /// Rotations that resolve to nobody at `at`, ignoring the primary — which
    /// [`Schedule::is_staffed`] already answers for.
    pub fn unstaffed_rotations(&self, at: i64) -> Vec<String> {
        let primary = self.primary_rotation().map(|r| r.id.clone());
        self.rotations
            .iter()
            .filter(|r| r.validate().is_ok())
            .filter(|r| Some(&r.id) != primary.as_ref())
            .filter(|r| {
                r.on_call(&self.overrides, &self.unavailability, at, self.tz())
                    .is_none()
            })
            .map(|r| r.name.clone())
            .collect()
    }

    /// The first instant in `[from, from + horizon)` at which this schedule
    /// pages nobody, or `None` when the whole window is covered (02 §8).
    ///
    /// Walked in shift-sized steps rather than at a fixed cadence: the only
    /// instants at which coverage can change are handovers and the edges of an
    /// override, so stepping to the next handover finds every gap a fixed
    /// cadence would while asking a fraction of the questions. `max_step`
    /// bounds the stride anyway, because a rotation with no handover ahead —
    /// an override window, a one-person layer — would otherwise be sampled
    /// once and declared covered for a week.
    ///
    /// Pure and given `from`, so the sweep that calls it every fifteen minutes
    /// is testable without waiting a week for a gap.
    pub fn first_coverage_gap(&self, from: i64, horizon: i64, max_step: i64) -> Option<i64> {
        let until = from.saturating_add(horizon);
        let step = max_step.max(1);
        let mut at = from;
        // Belt and braces: a pathological rotation that keeps answering "the
        // next handover is one microsecond away" must not spin the sweep.
        let mut visits = 0;
        while at < until && visits < MAX_COVERAGE_PROBES {
            visits += 1;
            if !self.is_staffed(at) {
                return Some(at);
            }
            let capped = at.saturating_add(step);
            at = match self.next_handover(at) {
                Some(next) if next > at => next.min(capped),
                _ => capped,
            };
        }
        None
    }

    /// The soonest handover across every rotation, or `None` if unstaffed.
    pub fn next_handover(&self, at: i64) -> Option<i64> {
        let tz = self.tz();
        self.rotations
            .iter()
            .filter_map(|r| r.winning_rule(at, tz))
            .filter_map(|r| r.next_handover(at, tz))
            .min()
    }

    /// The schedule with `user_email` taken off every rotation.
    ///
    /// Removing somebody from the team has to remove them from the rotations
    /// too, or a departed engineer keeps getting woken by a schedule nobody
    /// remembers they are on. Pure, so the awkward cases are decided here
    /// rather than in the middle of a database write:
    ///
    /// - **On several layers.** They come off all of them; being on two layers
    ///   is a scheduling choice, not two different people.
    /// - **The only person on a rotation.** That rotation now staffs nobody,
    ///   which is not a rotation — it is dropped, and named in
    ///   [`MemberRemoval::emptied_rotations`] so the caller can say so out
    ///   loud. Keeping it with an empty member list would be worse: it fails
    ///   validation, so the team's next schedule edit would be refused for a
    ///   reason nobody could see.
    /// - **The last rotation of all.** Then the team pages nobody, which is a
    ///   coverage gap — [`MemberRemoval::leaves_no_rotation`] says so.
    ///
    /// Matching is case-insensitive: membership is stored lowercased, but a
    /// rotation written by hand through the API may not be.
    /// Whether this schedule still mentions somebody **anywhere** — on a
    /// rotation, holding a cover, or as an absence window.
    ///
    /// The offboarding invariant, stated once as a question the schedule can
    /// answer about itself. Somebody who has left an org must be gone from all
    /// three, and the three are separately stored and separately deleted:
    /// taking a leaver off the rotations while their cover survives leaves them
    /// on call, because an override outranks every layer. Asking "is this
    /// person anywhere in here" is the assertion that does not have to be
    /// updated when a fourth place to hide is added.
    pub fn names_member(&self, user_email: &str) -> bool {
        let email = user_email.trim().to_ascii_lowercase();
        let is = |m: &str| m.trim().to_ascii_lowercase() == email;
        self.rotations
            .iter()
            .any(|r| r.shift_rules.iter().any(|s| s.members.iter().any(|m| is(m))))
            || self.overrides.iter().any(|o| is(&o.user_email))
            || self.unavailability.iter().any(|u| is(&u.user_email))
    }

    pub fn without_member(&self, user_email: &str) -> MemberRemoval {
        let email = user_email.trim().to_ascii_lowercase();
        let mut rotations = Vec::with_capacity(self.rotations.len());
        let mut emptied_rotations = Vec::new();
        let mut changed = false;

        for rotation in &self.rotations {
            let mut kept_rules = Vec::with_capacity(rotation.shift_rules.len());
            for rule in &rotation.shift_rules {
                let kept: Vec<String> = rule
                    .members
                    .iter()
                    .filter(|m| m.trim().to_ascii_lowercase() != email)
                    .cloned()
                    .collect();
                if kept.len() != rule.members.len() {
                    changed = true;
                }
                // A rule nobody is on is not a rule. Dropping it beats keeping
                // it with an empty roster, which fails validation and would
                // make the team's next schedule edit fail for a reason nobody
                // could see.
                if kept.is_empty() {
                    continue;
                }
                kept_rules.push(ShiftRule {
                    members: kept,
                    ..rule.clone()
                });
            }
            if kept_rules.is_empty() {
                emptied_rotations.push(rotation.name.clone());
                continue;
            }
            rotations.push(Rotation {
                shift_rules: kept_rules,
                ..rotation.clone()
            });
        }

        MemberRemoval {
            leaves_no_rotation: changed && rotations.is_empty(),
            rotations,
            emptied_rotations,
            changed,
        }
    }

    pub fn validate(&self) -> Result<(), TeamError> {
        let mut seen_ids = std::collections::HashSet::new();
        for rotation in &self.rotations {
            rotation.validate().map_err(TeamError::InvalidRotation)?;
            // Levels point at an id, so two rotations sharing one would make a
            // policy ambiguous about which position it pages.
            if !seen_ids.insert(rotation.id.trim().to_ascii_lowercase()) {
                return Err(TeamError::DuplicateRotationId(rotation.id.clone()));
            }
            // Several rules in one rotation is follow-the-sun. What cannot be
            // allowed is two at the same priority with the same restrictions,
            // where neither is more specific and the winner would be arbitrary.
            //
            // Scoped to the rotation, because rules in *different* rotations
            // never compete: a primary and a secondary covering the same hours
            // at the same priority is the whole point of having two.
            let mut seen = std::collections::HashSet::new();
            for rule in &rotation.shift_rules {
                let key = (rule.priority, rule.restrictions.clone());
                if !seen.insert(key) {
                    return Err(TeamError::AmbiguousRotations);
                }
            }
        }
        Ok(())
    }
}

impl Team {
    pub fn validate(&self) -> Result<(), TeamError> {
        if self.name.trim().is_empty() {
            return Err(TeamError::EmptyName);
        }
        Ok(())
    }
}

impl std::fmt::Display for TeamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyName => f.write_str("team name cannot be empty"),
            Self::AmbiguousRotations => f.write_str(
                "two rotations apply at the same time with equal priority and restrictions",
            ),
            Self::InvalidRotation(e) => write!(f, "invalid rotation: {e}"),
            Self::DuplicateRotationId(id) => write!(
                f,
                "two rotations share the id `{id}`, so a level naming it would be ambiguous"
            ),
        }
    }
}

impl std::error::Error for TeamError {}

#[cfg(test)]
mod tests {
    use super::{
        super::rotation::{MICROS_PER_WEEK, RotationError, TimeWindow},
        *,
    };

    const ANCHOR: i64 = 1_700_000_000_000_000;

    fn schedule(rotations: Vec<Rotation>) -> Schedule {
        Schedule {
            id: "sch_1".into(),
            org_id: "default".into(),
            team_id: "team_1".into(),
            timezone: "Asia/Kolkata".into(),
            rotations,
            overrides: Vec::new(),
            unavailability: Vec::new(),
            created_at: 0,
            updated_at: 0,
        }
    }

    fn weekly(name: &str, members: &[&str]) -> Rotation {
        Rotation::weekly(name, members.iter().map(|s| s.to_string()).collect(), ANCHOR)
    }

    fn team(name: &str) -> Team {
        Team {
            id: "team_1".into(),
            org_id: "default".into(),
            name: name.into(),
            timezone: "UTC".into(),
            description: None,
            // Never set, which is what every team created before the field
            // existed reads as — the escalation policy's list still stands.
            channel_destinations: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn test_on_call_resolves_the_rotation_in_force() {
        let s = schedule(vec![weekly("Primary", &["ana@o2.ai", "bob@o2.ai"])]);

        let slots = s.on_call_at(ANCHOR);
        // Two positions from one roster: the person on shift, and the person
        // after them — the latter derived, stored nowhere, and coverable.
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].user_email, "ana@o2.ai");
        assert_eq!(slots[0].next_user_email.as_deref(), Some("bob@o2.ai"));
        assert_eq!(slots[1].slot, "secondary");
        assert_eq!(slots[1].user_email, "bob@o2.ai");

        let next_week = s.on_call_at(ANCHOR + MICROS_PER_WEEK);
        assert_eq!(next_week[0].user_email, "bob@o2.ai");
    }

    /// The whole point of dropping the six-slot vocabulary: one rotation is
    /// enough to be pageable, and "secondary" is its next handover.
    #[test]
    fn test_one_rotation_answers_both_on_call_and_next() {
        let s = schedule(vec![weekly("Primary", &["ana@o2.ai", "bob@o2.ai"])]);

        assert_eq!(s.on_call_now(ANCHOR), Some("ana@o2.ai".into()));
        assert_eq!(s.next_on_call(ANCHOR), Some("bob@o2.ai".into()));
        assert_eq!(
            s.everyone_on_schedule(ANCHOR),
            vec!["ana@o2.ai".to_string(), "bob@o2.ai".to_string()]
        );
        assert!(s.is_staffed(ANCHOR));
    }

    /// The only coverage question left: would a page reach anybody at all.
    /// There are no longer six slots to leave empty and warn about forever.
    #[test]
    fn test_a_schedule_with_no_usable_rotation_is_unstaffed() {
        let empty = schedule(vec![]);
        assert!(!empty.is_staffed(ANCHOR));
        assert_eq!(empty.on_call_now(ANCHOR), None);

        let broken = schedule(vec![weekly("Primary", &[])]);
        assert!(!broken.is_staffed(ANCHOR));
    }

    #[test]
    fn test_next_handover_is_the_soonest_across_rotations() {
        let mut fast = weekly("Secondary", &["cara@o2.ai", "dev@o2.ai"]);
        fast.shift_micros = MICROS_PER_WEEK / 7;
        let s = schedule(vec![
            weekly("Primary", &["ana@o2.ai", "bob@o2.ai"]),
            fast,
        ]);
        assert_eq!(
            s.next_handover(ANCHOR),
            Some(ANCHOR + MICROS_PER_WEEK / 7),
            "the daily rotation hands over before the weekly one"
        );
    }

    #[test]
    fn test_next_handover_is_none_without_usable_rotations() {
        assert_eq!(schedule(vec![]).next_handover(ANCHOR), None);
        assert_eq!(
            schedule(vec![weekly("Primary", &[])]).next_handover(ANCHOR),
            None
        );
    }

    #[test]
    fn test_validate_rejects_two_equally_applicable_rotations() {
        // Same priority, same (empty) restrictions: neither is more specific,
        // so which one staffs the shift would be arbitrary.
        let s = schedule(vec![
            weekly("Day", &["ana@o2.ai"]),
            weekly("Night", &["bob@o2.ai"]),
        ]);
        assert_eq!(s.validate(), Err(TeamError::AmbiguousRotations));
    }

    #[test]
    fn test_validate_propagates_rotation_errors() {
        let s = schedule(vec![weekly("Primary", &[])]);
        assert_eq!(
            s.validate(),
            Err(TeamError::InvalidRotation(RotationError::NoMembers))
        );
    }

    #[test]
    fn test_validate_accepts_a_partially_staffed_team() {
        let s = schedule(vec![weekly("Primary", &["ana@o2.ai"])]);
        s.validate().unwrap();
    }

    /// The small-team case that used to need a trick: a second rotation with
    /// the member list reversed, so that whoever was primary was not also
    /// secondary. Nothing in the product said so, and getting it wrong paged
    /// one person twice. One rotation now answers both, in order.
    #[test]
    fn test_a_small_team_needs_no_second_rotation() {
        let s = schedule(vec![weekly("Primary", &["ana@o2.ai", "bob@o2.ai"])]);
        s.validate().unwrap();

        assert_eq!(s.on_call_now(ANCHOR), Some("ana@o2.ai".into()));
        assert_eq!(s.next_on_call(ANCHOR), Some("bob@o2.ai".into()));

        let later = ANCHOR + MICROS_PER_WEEK;
        assert_eq!(s.on_call_now(later), Some("bob@o2.ai".into()));
        assert_eq!(
            s.next_on_call(later),
            Some("ana@o2.ai".into()),
            "the next handover wraps"
        );
    }

    /// The bug this exists to prevent: only a team's very first members ever
    /// reached its rotation, so a team built one person at a time ended up
    /// with a one-person rotation. `NextOnCall` then resolved to nobody, and
    /// the second rung of every page went nowhere.
    #[test]
    fn test_a_member_added_later_joins_the_existing_rotation() {
        let rotations = vec![weekly("On-call rotation", &["ana@o2.ai"])];
        let placement = place_member(&rotations, "  BOB@o2.ai ");

        let MemberPlacement::Appended { rotation, rotations } = placement else {
            panic!("a later member must still reach the rotation");
        };
        assert_eq!(rotation, "On-call rotation");
        assert_eq!(
            rotations[0].members,
            vec!["ana@o2.ai".to_string(), "bob@o2.ai".to_string()],
            "appended at the end of the handover order, lowercased"
        );

        // And the ladder's second rung now reaches somebody.
        let s = Schedule { rotations, ..schedule(vec![]) };
        assert_eq!(s.on_call_now(ANCHOR).as_deref(), Some("ana@o2.ai"));
        assert_eq!(s.next_on_call(ANCHOR).as_deref(), Some("bob@o2.ai"));
    }

    /// Adding somebody twice must not put them on the rotation twice — a
    /// duplicate fails `Rotation::validate` and would double their share of
    /// the on-call load.
    #[test]
    fn test_adding_a_member_who_is_already_on_the_rotation_changes_nothing() {
        let rotations = vec![weekly("On-call rotation", &["ana@o2.ai", "bob@o2.ai"])];
        assert_eq!(
            place_member(&rotations, "BOB@o2.ai"),
            MemberPlacement::AlreadyOnRotation
        );
    }

    /// A team running layers has made a real scheduling decision. Which layer
    /// a new person covers is theirs to make: appending them to whichever
    /// rotation happened to be first could put somebody on call for the
    /// weekend they never agreed to.
    #[test]
    fn test_a_hand_edited_schedule_is_not_rewritten_behind_the_operators_back() {
        let mut weekend = weekly("Weekends", &["bob@o2.ai"]);
        weekend.priority = 10;
        let layered = vec![weekly("Weekdays", &["ana@o2.ai"]), weekend];
        assert_eq!(
            place_member(&layered, "cara@o2.ai"),
            MemberPlacement::NeedsManualPlacement
        );

        // A single rotation with restriction windows is equally deliberate.
        let mut restricted = weekly("Office hours", &["ana@o2.ai"]);
        restricted.restrictions = vec![super::super::rotation::TimeWindow {
            days: vec![0, 1, 2, 3, 4],
            start_minute: 9 * 60,
            end_minute: 17 * 60,
        }];
        assert_eq!(
            place_member(&[restricted], "cara@o2.ai"),
            MemberPlacement::NeedsManualPlacement
        );
    }

    /// A team whose last rotation was emptied by a removal has nowhere to
    /// append to; building one needs an anchor, so the caller does it.
    #[test]
    fn test_a_team_with_no_rotation_yet_asks_the_caller_to_seed_one() {
        assert_eq!(place_member(&[], "ana@o2.ai"), MemberPlacement::NoRotationYet);
    }

    /// The bug this exists to prevent: removing somebody from the team used to
    /// delete the membership row and leave the rotations untouched, so a
    /// departed engineer kept getting woken by a schedule nobody remembered
    /// they were on.
    #[test]
    fn test_removing_a_member_takes_them_off_the_rotation() {
        let s = schedule(vec![weekly(
            "On-call rotation",
            &["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"],
        )]);
        let removal = s.without_member("bob@o2.ai");

        assert!(removal.changed);
        assert_eq!(
            removal.rotations[0].members,
            vec!["ana@o2.ai".to_string(), "cara@o2.ai".to_string()]
        );
        assert!(removal.emptied_rotations.is_empty());
        assert!(!removal.leaves_no_rotation);

        // And they are on call at no instant afterwards.
        let after = Schedule {
            rotations: removal.rotations,
            ..s
        };
        for week in 0..6i64 {
            assert_ne!(
                after.on_call_now(ANCHOR + week * MICROS_PER_WEEK).as_deref(),
                Some("bob@o2.ai"),
                "week {week}"
            );
        }
    }

    /// Being on two layers is a scheduling choice, not two different people:
    /// leaving them on one of them would still page them.
    #[test]
    fn test_removing_a_member_clears_every_layer_they_appear_on() {
        let mut weekday = weekly("Weekdays", &["ana@o2.ai", "bob@o2.ai"]);
        weekday.priority = 10;
        let s = schedule(vec![
            weekly("Catch-all", &["bob@o2.ai", "cara@o2.ai"]),
            weekday,
        ]);
        let removal = s.without_member("bob@o2.ai");

        assert_eq!(removal.rotations.len(), 2);
        for rotation in &removal.rotations {
            assert!(
                !rotation.members.iter().any(|m| m == "bob@o2.ai"),
                "{} still carries the removed member",
                rotation.name
            );
        }
    }

    /// A rotation whose last member leaves is a shift with nobody on it. It is
    /// dropped rather than stored empty — an empty rotation fails validation,
    /// so the team's next schedule edit would be refused for a reason nobody
    /// could see — and the emptying is reported so it can be said out loud.
    #[test]
    fn test_emptying_a_rotation_is_reported_not_stored() {
        let s = schedule(vec![
            weekly("Catch-all", &["ana@o2.ai"]),
            {
                let mut r = weekly("Weekends", &["bob@o2.ai"]);
                r.priority = 10;
                r
            },
        ]);
        let removal = s.without_member("bob@o2.ai");

        assert_eq!(removal.rotations.len(), 1, "the empty rotation is dropped");
        assert_eq!(removal.emptied_rotations, vec!["Weekends".to_string()]);
        assert!(!removal.leaves_no_rotation, "the catch-all still staffs");
        assert!(
            removal.coverage_warning().unwrap().contains("Weekends"),
            "the operator has to be told which shift lost its cover"
        );

        let after = Schedule {
            rotations: removal.rotations,
            ..s
        };
        after.validate().unwrap();
    }

    /// The worst case: the person leaving was the whole rotation. The team now
    /// pages nobody, which must be stated rather than discovered at 3am.
    #[test]
    fn test_removing_the_last_person_leaves_a_named_coverage_gap() {
        let s = schedule(vec![weekly("On-call rotation", &["ana@o2.ai"])]);
        let removal = s.without_member("ANA@o2.ai");

        assert!(removal.changed, "matching is case-insensitive");
        assert!(removal.rotations.is_empty());
        assert!(removal.leaves_no_rotation);
        assert_eq!(removal.emptied_rotations, vec!["On-call rotation".to_string()]);
        assert!(removal.coverage_warning().unwrap().contains("pages nobody"));

        let after = Schedule {
            rotations: removal.rotations,
            ..s
        };
        assert!(!after.is_staffed(ANCHOR));
    }

    /// Somebody on the team but on no rotation costs no write: reporting a
    /// change here would rewrite the schedule for nothing and bump its
    /// `updated_at` every time a name is tidied up.
    #[test]
    fn test_removing_somebody_who_was_never_on_a_rotation_changes_nothing() {
        let s = schedule(vec![weekly("On-call rotation", &["ana@o2.ai"])]);
        let removal = s.without_member("newcomer@o2.ai");

        assert!(!removal.changed);
        assert!(!removal.leaves_no_rotation);
        assert_eq!(removal.rotations, s.rotations);
        assert_eq!(removal.coverage_warning(), None);
    }

    // ── Overrides reach every resolution path ───────────────────────────────
    //
    // The failure worth guarding: a cover that the *resolver* honours but that
    // one caller loads without. The engineer who arranged cover stops watching
    // and the page still goes to them, which is the worst outcome the feature
    // has. So every accessor on `Schedule` is asserted against the same
    // override, and `Schedule` is what every caller — including
    // `escalation::recipients_of` — goes through.
    fn covered(rotations: Vec<Rotation>, o: super::super::rotation::ScheduleOverride) -> Schedule {
        Schedule {
            overrides: vec![o],
            ..schedule(rotations)
        }
    }

    fn a_cover(user: &str, start: i64, end: i64) -> super::super::rotation::ScheduleOverride {
        super::super::rotation::ScheduleOverride {
            slot: None,
            id: "ov_1".into(),
            org_id: "default".into(),
            team_id: "team_1".into(),
            user_email: user.into(),
            start_at: start,
            end_at: end,
            covering_for: None,
            reason: None,
            created_by: "ana@o2.ai".into(),
            created_at: 1,
        }
    }

    #[test]
    fn test_every_schedule_accessor_honours_an_override() {
        let s = covered(
            vec![weekly("On-call rotation", &["ana@o2.ai", "bob@o2.ai"])],
            a_cover("sam@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK / 7),
        );

        assert_eq!(s.on_call_now(ANCHOR), Some("sam@o2.ai".into()));
        assert_eq!(s.on_call_at(ANCHOR)[0].user_email, "sam@o2.ai");
        assert_eq!(
            s.on_call_at(ANCHOR)[0].override_id.as_deref(),
            Some("ov_1"),
            "a page has to be able to say why somebody off the roster got it"
        );
        assert_eq!(
            s.next_on_call(ANCHOR),
            Some("bob@o2.ai".into()),
            "the roster's own handover order is untouched"
        );
        assert!(s.everyone_on_schedule(ANCHOR).contains(&"sam@o2.ai".to_string()));
        assert!(s.is_staffed(ANCHOR));
    }

    /// A schedule with nobody rostered but a cover standing over it is
    /// staffed. Reporting it as a coverage gap would send an operator hunting
    /// for a hole somebody already filled.
    #[test]
    fn test_a_cover_over_an_unstaffed_schedule_counts_as_coverage() {
        let s = covered(vec![], a_cover("sam@o2.ai", ANCHOR, ANCHOR + 1_000));
        assert!(s.is_staffed(ANCHOR));
        assert_eq!(s.on_call_now(ANCHOR), Some("sam@o2.ai".into()));
        assert!(!s.is_staffed(ANCHOR + 1_000), "and unstaffed again after it");
    }

    /// §3b's final schedule, off the schedule the UI already holds.
    #[test]
    fn test_the_resolved_window_comes_off_the_schedule() {
        let s = covered(
            vec![weekly("On-call rotation", &["ana@o2.ai"])],
            a_cover("sam@o2.ai", ANCHOR + 1_000, ANCHOR + 2_000),
        );
        let segments = s.resolved_window(ANCHOR, ANCHOR + 3_000).unwrap();
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[1].user_email.as_deref(), Some("sam@o2.ai"));
        assert!(s.resolved_window(ANCHOR + 1, ANCHOR).is_err());
    }

    /// Old rows carry no overrides array; they must load as "no covers"
    /// rather than failing to parse.
    #[test]
    fn test_a_schedule_without_overrides_still_parses() {
        let json = r#"{"id":"s","org_id":"o","team_id":"t","timezone":"UTC",
            "rotations":[],"created_at":0,"updated_at":0}"#;
        let s: Schedule = serde_json::from_str(json).unwrap();
        assert!(s.overrides.is_empty());
    }

    #[test]
    fn test_team_name_must_not_be_blank() {
        assert_eq!(team("  ").validate(), Err(TeamError::EmptyName));
        assert_eq!(team("").validate(), Err(TeamError::EmptyName));
        team("Platform").validate().unwrap();
    }

    #[test]
    fn test_optional_description_is_omitted_when_absent() {
        let t = team("Platform");
        let json = serde_json::to_string(&t).unwrap();
        assert!(!json.contains("description"));
        assert_eq!(serde_json::from_str::<Team>(&json).unwrap(), t);
    }

    #[test]
    fn test_schedule_round_trips_through_json() {
        let s = schedule(vec![
            weekly("Primary", &["ana@o2.ai", "bob@o2.ai"]),
            weekly("Secondary", &["cara@o2.ai"]),
        ]);
        let back: Schedule = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back, s);
    }

    // ── The coverage sweep (02 §8) ──────────────────────────────────────────

    const HOUR: i64 = super::super::rotation::MICROS_PER_HOUR;
    const WEEK: i64 = MICROS_PER_WEEK;

    /// §8: "a page that never reaches a human is the worst failure this system
    /// has". A team with nobody on any rotation is in exactly that state, and
    /// the sweep has to say so from the first instant it looks at.
    #[test]
    fn test_a_team_with_no_rotation_is_a_gap_from_the_first_instant() {
        let s = schedule(vec![]);
        assert_eq!(s.first_coverage_gap(ANCHOR, WEEK, HOUR), Some(ANCHOR));
    }

    /// The normal case, and the one the sweep must not cry wolf about: one
    /// always-on rotation covers every instant of the coming week.
    #[test]
    fn test_a_staffed_rotation_has_no_gap_in_the_coming_week() {
        let s = schedule(vec![weekly("On-call rotation", &["ana@o2.ai", "bob@o2.ai"])]);
        assert_eq!(s.first_coverage_gap(ANCHOR, WEEK, HOUR), None);
    }

    /// The gap §8 says the computed model can still produce: a restricted
    /// layer with nothing underneath it. Weekdays 09:00–17:00 covers the
    /// working day and nobody at all outside it, so the sweep has to find the
    /// first uncovered hour rather than sampling one instant inside the shift
    /// and reporting the team as staffed.
    #[test]
    fn test_a_restricted_layer_with_nothing_underneath_it_is_found() {
        let mut business = weekly("Business hours", &["ana@o2.ai"]);
        business.restrictions = vec![TimeWindow {
            days: vec![0, 1, 2, 3, 4],
            start_minute: 9 * 60,
            end_minute: 17 * 60,
        }];
        let s = schedule(vec![business]);

        let gap = s
            .first_coverage_gap(ANCHOR, WEEK, HOUR)
            .expect("nights and weekends reach nobody");
        assert!(gap >= ANCHOR && gap < ANCHOR + WEEK);
        assert!(!s.is_staffed(gap), "the instant reported has to be a real gap");
    }

    /// The stride is a bound, not the cadence: a rotation that never hands
    /// over must still be probed across the window rather than sampled once
    /// and declared covered.
    #[test]
    fn test_the_walk_is_bounded_and_terminates_on_a_covered_window() {
        let s = schedule(vec![weekly("On-call rotation", &["ana@o2.ai"])]);
        // A stride of zero would be an infinite loop; it is clamped to one.
        assert_eq!(s.first_coverage_gap(ANCHOR, 10, 0), None);
        // A window that is over before it starts asks nothing.
        assert_eq!(s.first_coverage_gap(ANCHOR, 0, HOUR), None);
    }

    /// Membership carries no level: the rotation decides which rung somebody
    /// covers, and duplicating it here would be a second source of truth.
    #[test]
    fn test_member_round_trips_and_carries_no_level() {
        let m = TeamMember {
            id: "mem_1".into(),
            team_id: "team_1".into(),
            user_email: "ana@o2.ai".into(),
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(!json.contains("level"), "membership must not pin a level");
        assert_eq!(serde_json::from_str::<TeamMember>(&json).unwrap(), m);
    }

    // ── Slots and unavailability on the schedule ────────────────────────────

    /// The schedule's own accessors have to agree with the resolver, because
    /// this is what every caller outside `config` actually uses.
    #[test]
    fn test_the_schedule_answers_per_slot() {
        let s = Schedule {
            rotations: vec![
                Rotation::weekly(
                    "Juniors",
                    vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
                    ANCHOR,
                ),
                Rotation::weekly(
                    "Seniors",
                    vec!["eve@o2.ai".into(), "fay@o2.ai".into()],
                    ANCHOR,
                )
                .in_slot("secondary"),
            ],
            ..schedule(vec![])
        };

        assert_eq!(s.slots(), vec!["primary".to_string(), "secondary".to_string()]);
        assert!(s.has_named_slots());
        assert_eq!(s.on_call_now(ANCHOR).as_deref(), Some("ana@o2.ai"));
        assert_eq!(
            s.on_call_in_slot("secondary", ANCHOR).as_deref(),
            Some("eve@o2.ai")
        );
        assert_eq!(s.next_on_call(ANCHOR).as_deref(), Some("bob@o2.ai"));
        assert_eq!(
            s.next_on_call_in_slot("secondary", ANCHOR).as_deref(),
            Some("fay@o2.ai")
        );
        assert_eq!(s.on_call_at(ANCHOR).len(), 2);
        assert!(s.unstaffed_slots(ANCHOR).is_empty());
    }

    /// A team on one rotation still configures nothing — but it **does** get a
    /// secondary, and that is the point.
    ///
    /// This asserted "must not be able to tell that slots exist" until
    /// 2026-08-18. It was the wrong goal: hiding the position is what made it
    /// impossible to write a cover against, since override creation validates
    /// against `slots()`. The team still names no slot, stores no field and
    /// runs one rotation; it simply has somebody it can hand the pager to.
    #[test]
    fn test_a_one_rotation_team_still_gets_a_secondary_it_can_cover() {
        let s = schedule(vec![weekly("On-call rotation", &["ana@o2.ai", "bob@o2.ai"])]);
        assert!(!s.has_named_slots(), "nobody named a slot");
        assert_eq!(s.slots(), vec!["primary".to_string(), "secondary".to_string()]);
        assert_eq!(s.on_call_at(ANCHOR).len(), 2);
        assert_eq!(s.on_call_at(ANCHOR)[0].slot, "primary");
        assert_eq!(s.on_call_at(ANCHOR)[1].slot, "secondary");
        assert!(s.is_staffed(ANCHOR));
        assert!(
            s.unstaffed_slots(ANCHOR).is_empty(),
            "and the derived position is staffed, not a gap"
        );
    }

    /// Two rotations with the same priority and restrictions used to be
    /// ambiguous. In two different slots they are not — they never compete —
    /// and refusing to save them would make a secondary pool unexpressible.
    #[test]
    fn test_equal_layers_in_different_slots_are_not_ambiguous() {
        let primary = weekly("Juniors", &["ana@o2.ai"]);
        let secondary = weekly("Seniors", &["eve@o2.ai"]).in_slot("secondary");
        Schedule {
            rotations: vec![primary.clone(), secondary],
            ..schedule(vec![])
        }
        .validate()
        .unwrap();

        // Within one slot the old rule still holds.
        assert_eq!(
            Schedule {
                rotations: vec![primary.clone(), weekly("Also juniors", &["bob@o2.ai"])],
                ..schedule(vec![])
            }
            .validate(),
            Err(TeamError::AmbiguousRotations)
        );
    }

    /// A joiner goes on the primary or nowhere automatic. Appending them to a
    /// backup pool nobody asked them to join is not what "add member" means.
    #[test]
    fn test_a_joiner_is_not_appended_to_a_non_default_slot() {
        let secondary = vec![weekly("Seniors", &["eve@o2.ai"]).in_slot("secondary")];
        assert_eq!(
            place_member(&secondary, "new@o2.ai"),
            MemberPlacement::NeedsManualPlacement
        );
        // Two slots is several rotations, which was never automatic anyway.
        let both = vec![
            weekly("Juniors", &["ana@o2.ai"]),
            weekly("Seniors", &["eve@o2.ai"]).in_slot("secondary"),
        ];
        assert_eq!(
            place_member(&both, "new@o2.ai"),
            MemberPlacement::NeedsManualPlacement
        );
    }

    /// Leaving takes somebody off every slot. Being on two pools is a
    /// scheduling choice, not two different people.
    #[test]
    fn test_a_leaver_comes_off_every_slot() {
        let s = Schedule {
            rotations: vec![
                weekly("Juniors", &["ana@o2.ai", "bob@o2.ai"]),
                weekly("Seniors", &["bob@o2.ai"]).in_slot("secondary"),
            ],
            ..schedule(vec![])
        };
        let removal = s.without_member("bob@o2.ai");
        assert!(removal.changed);
        assert_eq!(removal.emptied_rotations, vec!["Seniors".to_string()]);
        assert_eq!(removal.rotations.len(), 1);
        assert_eq!(removal.rotations[0].members, vec!["ana@o2.ai".to_string()]);
        assert!(!removal.leaves_no_rotation);
    }

    /// Coverage is still judged on the slot the first rung pages, so adding a
    /// second slot can never turn a covered team into an uncovered one — and
    /// an unstaffed secondary is reported as itself rather than as a gap.
    #[test]
    fn test_an_unstaffed_secondary_is_not_a_coverage_gap() {
        let s = Schedule {
            rotations: vec![
                weekly("Juniors", &["ana@o2.ai"]),
                Rotation {
                    // In force only after the window under test, so the slot
                    // exists and staffs nobody now.
                    starts_at: Some(ANCHOR + MICROS_PER_WEEK),
                    ..weekly("Seniors", &["eve@o2.ai"]).in_slot("secondary")
                },
            ],
            ..schedule(vec![])
        };
        assert!(s.is_staffed(ANCHOR));
        assert_eq!(s.first_coverage_gap(ANCHOR, MICROS_PER_WEEK, MICROS_PER_WEEK / 7), None);
        assert_eq!(s.unstaffed_slots(ANCHOR), vec!["secondary".to_string()]);
    }

    /// The inverse, and the one that matters: a staffed **secondary** over an
    /// unstaffed **primary** is a coverage gap, because the first rung of every
    /// shipped ladder pages the default slot. Somebody is visibly on call and a
    /// page raised now still wakes nobody.
    ///
    /// This is pinned because a "Covered" badge computed as "is anybody on call
    /// in any slot" reads true here, disagreeing with `/coverage-gaps` and
    /// `/config-risks`, which both ask this narrower question.
    #[test]
    fn test_a_staffed_secondary_over_an_unstaffed_primary_is_still_a_gap() {
        let s = Schedule {
            rotations: vec![
                Rotation {
                    // Not in force yet, so the default slot staffs nobody now.
                    starts_at: Some(ANCHOR + MICROS_PER_WEEK),
                    ..weekly("Juniors", &["ana@o2.ai"])
                },
                weekly("Seniors", &["eve@o2.ai"]).in_slot("secondary"),
            ],
            ..schedule(vec![])
        };
        assert!(
            !s.is_staffed(ANCHOR),
            "a page raised now pages the default slot, which nobody staffs"
        );
        assert!(
            !s.on_call_at(ANCHOR).is_empty(),
            "and yet somebody is on call — this is exactly the disagreement"
        );
        assert!(
            s.unstaffed_slots(ANCHOR).is_empty(),
            "the default slot is never reported here — an unstaffed default is the \
             coverage gap itself, which is `is_staffed`'s answer, not a slot nuance"
        );
        assert_eq!(s.first_coverage_gap(ANCHOR, MICROS_PER_WEEK, MICROS_PER_WEEK / 7), Some(ANCHOR));
    }

    /// The schedule carries absences for the same reason it carries covers: a
    /// resolution path that forgets them pages somebody on a beach.
    #[test]
    fn test_the_schedule_skips_an_away_member_and_warns_about_it() {
        let ana_week = ANCHOR;
        let s = Schedule {
            rotations: vec![weekly("On-call rotation", &["ana@o2.ai", "bob@o2.ai"])],
            unavailability: vec![super::super::rotation::Unavailability {
                id: "un_1".into(),
                org_id: "default".into(),
                user_email: "ana@o2.ai".into(),
                start_at: ana_week,
                end_at: ana_week + MICROS_PER_WEEK,
                reason: None,
                created_by: "ana@o2.ai".into(),
                created_at: 1,
            }],
            ..schedule(vec![])
        };

        assert_eq!(s.on_call_now(ANCHOR).as_deref(), Some("bob@o2.ai"));
        assert_eq!(s.everyone_on_schedule(ANCHOR), vec!["bob@o2.ai".to_string()]);

        let warnings = s.away_assignments(ANCHOR, ANCHOR + 2 * MICROS_PER_WEEK);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].user_email, "ana@o2.ai");
        assert_eq!(warnings[0].covered_by.as_deref(), Some("bob@o2.ai"));
    }

    // ── Offboarding: the leaver is gone from everywhere (G6) ────────────────

    fn an_absence(user: &str, start: i64, end: i64) -> super::super::rotation::Unavailability {
        super::super::rotation::Unavailability {
            id: format!("un_{user}"),
            org_id: "default".into(),
            user_email: user.into(),
            start_at: start,
            end_at: end,
            reason: None,
            created_by: user.into(),
            created_at: 1,
        }
    }

    /// A schedule with the leaver in all three places somebody can hide: on
    /// two rotations in two slots, holding a future cover, and down as away.
    fn schedule_with_a_leaver() -> Schedule {
        Schedule {
            rotations: vec![
                weekly("On-call rotation", &["ana@o2.ai", "leaver@o2.ai", "bob@o2.ai"]),
                weekly("Seniors", &["leaver@o2.ai", "eve@o2.ai"]).in_slot("secondary"),
            ],
            overrides: vec![a_cover(
                "leaver@o2.ai",
                ANCHOR + MICROS_PER_WEEK,
                ANCHOR + 2 * MICROS_PER_WEEK,
            )],
            unavailability: vec![an_absence(
                "leaver@o2.ai",
                ANCHOR + 3 * MICROS_PER_WEEK,
                ANCHOR + 4 * MICROS_PER_WEEK,
            )],
            ..schedule(vec![])
        }
    }

    /// The state offboarding leaves behind: rotations rewritten, cover
    /// deleted, absence deleted.
    fn schedule_after_offboarding() -> Schedule {
        let before = schedule_with_a_leaver();
        Schedule {
            rotations: before.without_member("leaver@o2.ai").rotations,
            overrides: Vec::new(),
            unavailability: Vec::new(),
            ..before
        }
    }

    /// Before: they are on a rotation, on a cover and on an absence, and the
    /// schedule says so. This is the assertion the "after" test is worth
    /// nothing without.
    #[test]
    fn test_a_leaver_is_named_by_the_schedule_before_they_are_offboarded() {
        let before = schedule_with_a_leaver();
        assert!(before.names_member("leaver@o2.ai"));
        assert!(before.names_member("LEAVER@o2.ai"), "case-insensitively");
        assert_eq!(
            before.on_call_now(ANCHOR + MICROS_PER_WEEK),
            Some("leaver@o2.ai".into()),
            "their cover puts them on call whatever the rotation says"
        );
    }

    /// After: gone from all three, and from every answer the schedule gives at
    /// any instant in the cycle, in every slot.
    #[test]
    fn test_a_leaver_is_named_nowhere_after_offboarding() {
        let after = schedule_after_offboarding();
        assert!(!after.names_member("leaver@o2.ai"));

        for week in 0..8i64 {
            let at = ANCHOR + week * MICROS_PER_WEEK;
            for slot in ["primary", "secondary"] {
                assert_ne!(
                    after.on_call_in_slot(slot, at).as_deref(),
                    Some("leaver@o2.ai"),
                    "week {week}, slot {slot}"
                );
                assert_ne!(
                    after.next_on_call_in_slot(slot, at).as_deref(),
                    Some("leaver@o2.ai"),
                    "week {week}, slot {slot}"
                );
            }
            assert!(
                !after.everyone_on_schedule(at).iter().any(|m| m == "leaver@o2.ai"),
                "week {week}: not even in the broadcast of last resort"
            );
        }
    }

    /// The cover is the second door into the same bug, and it has to be shut
    /// separately: an override outranks every layer, so taking somebody off
    /// the rotation while their cover survives leaves them on call.
    #[test]
    fn test_dropping_the_rotations_alone_would_leave_the_leaver_on_call() {
        let before = schedule_with_a_leaver();
        let rotations_only = Schedule {
            rotations: before.without_member("leaver@o2.ai").rotations,
            ..before
        };
        assert_eq!(
            rotations_only.on_call_now(ANCHOR + MICROS_PER_WEEK),
            Some("leaver@o2.ai".into()),
            "still on call, through the cover — which is why offboarding drops covers too"
        );
        assert!(rotations_only.names_member("leaver@o2.ai"));
    }

    /// Being the only person on a rotation is a coverage gap, and it has to be
    /// reported rather than becoming a silently empty team.
    #[test]
    fn test_offboarding_the_only_member_reports_a_gap_rather_than_going_quiet() {
        let s = Schedule {
            rotations: vec![weekly("On-call rotation", &["leaver@o2.ai"])],
            ..schedule(vec![])
        };
        let removal = s.without_member("leaver@o2.ai");

        assert!(removal.changed);
        assert_eq!(removal.emptied_rotations, vec!["On-call rotation".to_string()]);
        assert!(removal.leaves_no_rotation);
        assert!(
            removal
                .coverage_warning()
                .expect("an emptied team must warn")
                .contains("pages nobody")
        );

        let after = Schedule { rotations: removal.rotations, ..s };
        assert_eq!(after.on_call_now(ANCHOR), None);
        assert!(!after.is_staffed(ANCHOR));
    }

    /// Mid-shift: the pager moves to the next person immediately and
    /// deterministically, rather than staying with somebody who has left.
    #[test]
    fn test_offboarding_somebody_mid_shift_hands_the_pager_straight_on() {
        let s = Schedule {
            rotations: vec![weekly(
                "On-call rotation",
                &["leaver@o2.ai", "ana@o2.ai", "bob@o2.ai"],
            )],
            ..schedule(vec![])
        };
        let mid_shift = ANCHOR + MICROS_PER_WEEK / 2;
        assert_eq!(s.on_call_now(mid_shift), Some("leaver@o2.ai".into()));

        let after = Schedule {
            rotations: s.without_member("leaver@o2.ai").rotations,
            ..s
        };
        assert_eq!(
            after.on_call_now(mid_shift),
            Some("ana@o2.ai".into()),
            "the shift passes at once; nobody is left holding a pager they cannot answer"
        );
        assert!(after.is_staffed(mid_shift));
    }
}
