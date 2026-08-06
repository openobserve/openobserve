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

//! Rotations — who holds a level, at an instant.
//!
//! A rotation is an ordered list of people and a fixed shift length anchored
//! to a start instant. Resolution is a pure function of `(rotation, at)`: no
//! clock is read here, which is what makes handovers, boundaries and
//! out-of-order replays testable.
//!
//! Layers, restriction windows and overrides land on top of this in a later
//! phase; they change *which* rotations apply to an instant, not how a single
//! rotation resolves.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::level::EscalationLevel;

/// Microseconds in one hour — shift lengths are stored in micros to match the
/// scheduler's unit (`config::utils::time::now_micros`).
pub const MICROS_PER_MINUTE: i64 = 60_000_000;
pub const MICROS_PER_HOUR: i64 = 60 * MICROS_PER_MINUTE;
pub const MICROS_PER_DAY: i64 = 24 * MICROS_PER_HOUR;
pub const MICROS_PER_WEEK: i64 = 7 * MICROS_PER_DAY;

/// One level's rotation within a schedule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Rotation {
    pub level: EscalationLevel,
    /// Participants in handover order. Emails, because email is the login and
    /// therefore the one identifier every user is guaranteed to have.
    pub members: Vec<String>,
    /// Length of one shift, in microseconds. Must be > 0.
    pub shift_micros: i64,
    /// Instant at which `members[0]`'s first shift begins, in microseconds.
    ///
    /// Shifts before this instant resolve too — the sequence extends
    /// backwards — so an anchor set in the future is not an error, it just
    /// means the cycle is counted from there.
    pub anchor_micros: i64,
}

/// Why a rotation was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RotationError {
    NoMembers,
    NonPositiveShift(i64),
    /// A person appears twice in the same rotation, which would silently
    /// double their share of the on-call load.
    DuplicateMember(String),
    /// L0 is the agent's rung; no human is ever scheduled into it.
    NotAHumanSlot(EscalationLevel),
}

impl std::fmt::Display for RotationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoMembers => f.write_str("rotation must have at least one member"),
            Self::NonPositiveShift(v) => {
                write!(f, "shift length must be positive, got {v} micros")
            }
            Self::DuplicateMember(m) => write!(f, "duplicate rotation member `{m}`"),
            Self::NotAHumanSlot(l) => write!(f, "level `{l}` cannot hold a human rotation"),
        }
    }
}

impl std::error::Error for RotationError {}

impl Rotation {
    /// A weekly rotation handing over at `anchor_micros`.
    pub fn weekly(level: EscalationLevel, members: Vec<String>, anchor_micros: i64) -> Self {
        Self {
            level,
            members,
            shift_micros: MICROS_PER_WEEK,
            anchor_micros,
        }
    }

    pub fn validate(&self) -> Result<(), RotationError> {
        if !self.level.is_human_slot() {
            return Err(RotationError::NotAHumanSlot(self.level));
        }
        if self.members.is_empty() {
            return Err(RotationError::NoMembers);
        }
        if self.shift_micros <= 0 {
            return Err(RotationError::NonPositiveShift(self.shift_micros));
        }
        let mut seen = std::collections::HashSet::with_capacity(self.members.len());
        for m in &self.members {
            if !seen.insert(m.to_ascii_lowercase()) {
                return Err(RotationError::DuplicateMember(m.clone()));
            }
        }
        Ok(())
    }

    /// Zero-based index of the shift containing `at`.
    ///
    /// Uses floor division rather than truncating division so that instants
    /// before the anchor land on the shift that actually contains them.
    /// Truncating division maps both `-1` and `+1` micros from the anchor to
    /// shift 0, which would make the same person on call for two consecutive
    /// shifts across the anchor.
    fn shift_index(&self, at: i64) -> i64 {
        let elapsed = at - self.anchor_micros;
        elapsed.div_euclid(self.shift_micros)
    }

    /// Who holds this level at `at`, or `None` if the rotation is unusable.
    ///
    /// Returning `None` rather than a fallback is deliberate: an unstaffed
    /// level must surface as a coverage gap, never as a silently dropped page.
    pub fn member_at(&self, at: i64) -> Option<&str> {
        if self.validate().is_err() {
            return None;
        }
        let idx = self.shift_index(at).rem_euclid(self.members.len() as i64);
        self.members.get(idx as usize).map(|s| s.as_str())
    }

    /// Instant at which the shift containing `at` began.
    pub fn shift_start(&self, at: i64) -> Option<i64> {
        if self.validate().is_err() {
            return None;
        }
        Some(self.anchor_micros + self.shift_index(at) * self.shift_micros)
    }

    /// Instant at which the shift containing `at` ends — i.e. the next
    /// handover. Exclusive: the returned instant belongs to the next shift.
    pub fn next_handover(&self, at: i64) -> Option<i64> {
        Some(self.shift_start(at)? + self.shift_micros)
    }
}

/// Everyone on call for a team at an instant, one entry per staffed level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OnCallSlot {
    pub level: EscalationLevel,
    pub user_email: String,
}

/// Resolve every level's holder at `at`, in ladder order.
///
/// Rotations that fail validation are skipped rather than defaulted, so a
/// misconfigured level shows up as an absent rung the caller can report.
pub fn resolve_on_call(rotations: &[Rotation], at: i64) -> Vec<OnCallSlot> {
    let mut slots: Vec<OnCallSlot> = rotations
        .iter()
        .filter_map(|r| {
            r.member_at(at).map(|m| OnCallSlot {
                level: r.level,
                user_email: m.to_string(),
            })
        })
        .collect();
    slots.sort_by_key(|s| s.level.to_i32());
    slots
}

/// The holder of one specific level at `at`.
pub fn resolve_level(rotations: &[Rotation], level: EscalationLevel, at: i64) -> Option<String> {
    rotations
        .iter()
        .find(|r| r.level == level)
        .and_then(|r| r.member_at(at))
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANCHOR: i64 = 1_700_000_000_000_000;

    fn weekly(members: &[&str]) -> Rotation {
        Rotation::weekly(
            EscalationLevel::Primary,
            members.iter().map(|s| s.to_string()).collect(),
            ANCHOR,
        )
    }

    #[test]
    fn test_first_shift_belongs_to_the_first_member() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_DAY), Some("ana@o2.ai"));
    }

    /// The handover instant belongs to the INCOMING person. An inclusive
    /// upper bound would leave the outgoing engineer on call for one extra
    /// microsecond, and both of them paged for the same alert.
    #[test]
    fn test_handover_boundary_is_exclusive() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_WEEK - 1), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_WEEK), Some("bob@o2.ai"));
    }

    #[test]
    fn test_rotation_wraps_around() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"]);
        let expected = ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"];
        for week in 0..9i64 {
            assert_eq!(
                r.member_at(ANCHOR + week * MICROS_PER_WEEK),
                Some(expected[(week % 3) as usize]),
                "week {week}"
            );
        }
    }

    /// Truncating division would map -1 micros and +1 micros to the same
    /// shift, putting one person on call for two consecutive shifts.
    #[test]
    fn test_instants_before_the_anchor_walk_backwards() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR - 1), Some("bob@o2.ai"));
        assert_eq!(r.member_at(ANCHOR - MICROS_PER_WEEK), Some("bob@o2.ai"));
        assert_eq!(r.member_at(ANCHOR - MICROS_PER_WEEK - 1), Some("ana@o2.ai"));
    }

    #[test]
    fn test_single_member_is_always_on_call() {
        let r = weekly(&["ana@o2.ai"]);
        for offset in [-MICROS_PER_WEEK, 0, MICROS_PER_DAY, 99 * MICROS_PER_WEEK] {
            assert_eq!(r.member_at(ANCHOR + offset), Some("ana@o2.ai"));
        }
    }

    #[test]
    fn test_shift_start_and_next_handover_bracket_the_instant() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let at = ANCHOR + MICROS_PER_WEEK + 3 * MICROS_PER_HOUR;
        let start = r.shift_start(at).unwrap();
        let end = r.next_handover(at).unwrap();
        assert_eq!(start, ANCHOR + MICROS_PER_WEEK);
        assert_eq!(end, ANCHOR + 2 * MICROS_PER_WEEK);
        assert!(start <= at && at < end);
    }

    #[test]
    fn test_next_handover_hands_over_to_the_next_member() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let at = ANCHOR + MICROS_PER_DAY;
        let handover = r.next_handover(at).unwrap();
        assert_eq!(r.member_at(handover - 1), Some("ana@o2.ai"));
        assert_eq!(r.member_at(handover), Some("bob@o2.ai"));
    }

    #[test]
    fn test_arbitrary_shift_lengths_resolve() {
        let r = Rotation {
            level: EscalationLevel::Primary,
            members: vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            shift_micros: 8 * MICROS_PER_HOUR,
            anchor_micros: ANCHOR,
        };
        assert_eq!(r.member_at(ANCHOR), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + 8 * MICROS_PER_HOUR), Some("bob@o2.ai"));
        assert_eq!(
            r.member_at(ANCHOR + 16 * MICROS_PER_HOUR),
            Some("ana@o2.ai")
        );
    }

    #[test]
    fn test_validate_rejects_unusable_rotations() {
        let mut r = weekly(&[]);
        assert_eq!(r.validate(), Err(RotationError::NoMembers));

        r = weekly(&["ana@o2.ai"]);
        r.shift_micros = 0;
        assert_eq!(r.validate(), Err(RotationError::NonPositiveShift(0)));
        r.shift_micros = -1;
        assert_eq!(r.validate(), Err(RotationError::NonPositiveShift(-1)));

        r = weekly(&["ana@o2.ai", "ANA@o2.ai"]);
        assert_eq!(
            r.validate(),
            Err(RotationError::DuplicateMember("ANA@o2.ai".into())),
            "duplicates must be caught case-insensitively"
        );

        r = weekly(&["ana@o2.ai"]);
        r.level = EscalationLevel::L0;
        assert_eq!(
            r.validate(),
            Err(RotationError::NotAHumanSlot(EscalationLevel::L0))
        );
    }

    /// An unusable rotation must resolve to nobody. Falling back to
    /// `members[0]` would page a person the schedule never selected.
    #[test]
    fn test_invalid_rotation_resolves_to_nobody() {
        let empty = weekly(&[]);
        assert_eq!(empty.member_at(ANCHOR), None);
        assert_eq!(empty.shift_start(ANCHOR), None);
        assert_eq!(empty.next_handover(ANCHOR), None);

        let mut zero = weekly(&["ana@o2.ai"]);
        zero.shift_micros = 0;
        assert_eq!(zero.member_at(ANCHOR), None, "must not divide by zero");
    }

    #[test]
    fn test_resolve_on_call_returns_levels_in_ladder_order() {
        let rotations = vec![
            Rotation::weekly(EscalationLevel::L2, vec!["eve@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::Primary, vec!["ana@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::Secondary, vec!["bob@o2.ai".into()], ANCHOR),
        ];
        let slots = resolve_on_call(&rotations, ANCHOR);
        assert_eq!(
            slots.iter().map(|s| s.level).collect::<Vec<_>>(),
            vec![
                EscalationLevel::Primary,
                EscalationLevel::Secondary,
                EscalationLevel::L2
            ]
        );
        assert_eq!(slots[0].user_email, "ana@o2.ai");
    }

    /// A team that only staffs Primary is valid — the unstaffed rungs are
    /// absent from the result, not filled with a placeholder.
    #[test]
    fn test_unstaffed_levels_are_absent_not_defaulted() {
        let rotations = vec![
            Rotation::weekly(EscalationLevel::Primary, vec!["ana@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::L1, vec![], ANCHOR),
        ];
        let slots = resolve_on_call(&rotations, ANCHOR);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].level, EscalationLevel::Primary);
    }

    #[test]
    fn test_resolve_level_picks_the_matching_rotation() {
        let rotations = vec![
            Rotation::weekly(EscalationLevel::Primary, vec!["ana@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::Secondary, vec!["bob@o2.ai".into()], ANCHOR),
        ];
        assert_eq!(
            resolve_level(&rotations, EscalationLevel::Secondary, ANCHOR),
            Some("bob@o2.ai".to_string())
        );
        assert_eq!(resolve_level(&rotations, EscalationLevel::L4, ANCHOR), None);
    }

    #[test]
    fn test_round_trips_through_json() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let json = serde_json::to_string(&r).unwrap();
        let back: Rotation = serde_json::from_str(&json).unwrap();
        assert_eq!(back, r);
    }
}
