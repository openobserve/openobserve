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

use super::{
    level::EscalationLevel,
    rotation::{OnCallSlot, Rotation, resolve_level, resolve_on_call},
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
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamError {
    EmptyName,
    /// Two rotations claiming the same level; which one wins would be
    /// arbitrary.
    DuplicateLevel(EscalationLevel),
    InvalidRotation(super::rotation::RotationError),
}

impl Schedule {
    /// Everyone on call at `at`, in ladder order.
    pub fn on_call_at(&self, at: i64) -> Vec<OnCallSlot> {
        resolve_on_call(&self.rotations, at)
    }

    /// Who holds one specific level at `at`.
    pub fn holder_of(&self, level: EscalationLevel, at: i64) -> Option<String> {
        resolve_level(&self.rotations, level, at)
    }

    /// Levels the policy wants to page that nobody is scheduled for.
    ///
    /// Returned rather than silently dropped: an unstaffed rung is a coverage
    /// gap the team has to see, not a page that quietly goes nowhere.
    pub fn coverage_gaps(&self, wanted: &[EscalationLevel], at: i64) -> Vec<EscalationLevel> {
        wanted
            .iter()
            .filter(|l| self.holder_of(**l, at).is_none())
            .copied()
            .collect()
    }

    /// The soonest handover across every rotation, or `None` if unstaffed.
    pub fn next_handover(&self, at: i64) -> Option<i64> {
        self.rotations
            .iter()
            .filter_map(|r| r.next_handover(at))
            .min()
    }

    pub fn validate(&self) -> Result<(), TeamError> {
        let mut seen = std::collections::HashSet::new();
        for r in &self.rotations {
            r.validate().map_err(TeamError::InvalidRotation)?;
            if !seen.insert(r.level) {
                return Err(TeamError::DuplicateLevel(r.level));
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
            Self::DuplicateLevel(l) => {
                write!(f, "level `{l}` has more than one rotation")
            }
            Self::InvalidRotation(e) => write!(f, "invalid rotation: {e}"),
        }
    }
}

impl std::error::Error for TeamError {}

#[cfg(test)]
mod tests {
    use super::{
        super::rotation::{MICROS_PER_WEEK, RotationError},
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
            created_at: 0,
            updated_at: 0,
        }
    }

    fn weekly(level: EscalationLevel, members: &[&str]) -> Rotation {
        Rotation::weekly(
            level,
            members.iter().map(|s| s.to_string()).collect(),
            ANCHOR,
        )
    }

    fn team(name: &str) -> Team {
        Team {
            id: "team_1".into(),
            org_id: "default".into(),
            name: name.into(),
            timezone: "UTC".into(),
            description: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn test_on_call_resolves_every_staffed_level() {
        let s = schedule(vec![
            weekly(EscalationLevel::Primary, &["ana@o2.ai", "bob@o2.ai"]),
            weekly(EscalationLevel::Secondary, &["cara@o2.ai"]),
        ]);
        let slots = s.on_call_at(ANCHOR);
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].user_email, "ana@o2.ai");
        assert_eq!(slots[1].user_email, "cara@o2.ai");

        let next_week = s.on_call_at(ANCHOR + MICROS_PER_WEEK);
        assert_eq!(next_week[0].user_email, "bob@o2.ai");
        assert_eq!(
            next_week[1].user_email, "cara@o2.ai",
            "a single-member rotation does not rotate"
        );
    }

    #[test]
    fn test_holder_of_reads_one_level() {
        let s = schedule(vec![
            weekly(EscalationLevel::Primary, &["ana@o2.ai"]),
            weekly(EscalationLevel::L1, &["dev@o2.ai"]),
        ]);
        assert_eq!(
            s.holder_of(EscalationLevel::L1, ANCHOR),
            Some("dev@o2.ai".into())
        );
        assert_eq!(s.holder_of(EscalationLevel::Secondary, ANCHOR), None);
    }

    /// An unstaffed rung has to be visible. A page that goes nowhere because
    /// nobody filled L2 is the failure this exists to prevent.
    #[test]
    fn test_coverage_gaps_name_the_unstaffed_levels() {
        let s = schedule(vec![weekly(EscalationLevel::Primary, &["ana@o2.ai"])]);
        let wanted = [
            EscalationLevel::Primary,
            EscalationLevel::Secondary,
            EscalationLevel::L1,
        ];
        assert_eq!(
            s.coverage_gaps(&wanted, ANCHOR),
            vec![EscalationLevel::Secondary, EscalationLevel::L1]
        );
    }

    #[test]
    fn test_no_gaps_when_every_wanted_level_is_staffed() {
        let s = schedule(vec![
            weekly(EscalationLevel::Primary, &["ana@o2.ai"]),
            weekly(EscalationLevel::Secondary, &["bob@o2.ai"]),
        ]);
        assert!(
            s.coverage_gaps(
                &[EscalationLevel::Primary, EscalationLevel::Secondary],
                ANCHOR
            )
            .is_empty()
        );
    }

    /// A rotation that fails validation staffs nobody, so it must surface as
    /// a gap rather than as coverage.
    #[test]
    fn test_an_empty_rotation_counts_as_a_gap() {
        let s = schedule(vec![weekly(EscalationLevel::Primary, &[])]);
        assert_eq!(
            s.coverage_gaps(&[EscalationLevel::Primary], ANCHOR),
            vec![EscalationLevel::Primary]
        );
    }

    #[test]
    fn test_next_handover_is_the_soonest_across_rotations() {
        let mut fast = weekly(EscalationLevel::Secondary, &["cara@o2.ai", "dev@o2.ai"]);
        fast.shift_micros = MICROS_PER_WEEK / 7;
        let s = schedule(vec![
            weekly(EscalationLevel::Primary, &["ana@o2.ai", "bob@o2.ai"]),
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
            schedule(vec![weekly(EscalationLevel::Primary, &[])]).next_handover(ANCHOR),
            None
        );
    }

    #[test]
    fn test_validate_rejects_two_rotations_for_one_level() {
        let s = schedule(vec![
            weekly(EscalationLevel::Primary, &["ana@o2.ai"]),
            weekly(EscalationLevel::Primary, &["bob@o2.ai"]),
        ]);
        assert_eq!(
            s.validate(),
            Err(TeamError::DuplicateLevel(EscalationLevel::Primary))
        );
    }

    #[test]
    fn test_validate_propagates_rotation_errors() {
        let s = schedule(vec![weekly(EscalationLevel::Primary, &[])]);
        assert_eq!(
            s.validate(),
            Err(TeamError::InvalidRotation(RotationError::NoMembers))
        );
    }

    #[test]
    fn test_validate_accepts_a_partially_staffed_team() {
        let s = schedule(vec![weekly(EscalationLevel::Primary, &["ana@o2.ai"])]);
        s.validate().unwrap();
    }

    /// A person may hold two levels of the same team; small teams do this
    /// constantly.
    #[test]
    fn test_one_person_may_hold_two_levels() {
        let s = schedule(vec![
            weekly(EscalationLevel::Primary, &["ana@o2.ai", "bob@o2.ai"]),
            weekly(EscalationLevel::Secondary, &["bob@o2.ai", "ana@o2.ai"]),
        ]);
        s.validate().unwrap();
        let slots = s.on_call_at(ANCHOR);
        assert_eq!(slots[0].user_email, "ana@o2.ai");
        assert_eq!(slots[1].user_email, "bob@o2.ai");
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
            weekly(EscalationLevel::Primary, &["ana@o2.ai", "bob@o2.ai"]),
            weekly(EscalationLevel::Secondary, &["cara@o2.ai"]),
        ]);
        let back: Schedule = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back, s);
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
}
