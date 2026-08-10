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
    OnCallSlot, Rotation, everyone_on_schedule, next_on_call, on_call_now, resolve_on_call,
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
    /// Two rotations equally in force at the same instant; neither is more
    /// specific, so which one wins would be arbitrary.
    AmbiguousRotations,
    InvalidRotation(super::rotation::RotationError),
}

impl Schedule {
    /// The schedule's timezone, or UTC if it names one this build cannot
    /// resolve. Restrictions are expressed in local wall time, so an
    /// unparseable zone must not silently drop every restricted layer.
    pub fn tz(&self) -> chrono_tz::Tz {
        self.timezone.parse().unwrap_or(chrono_tz::UTC)
    }

    /// Everyone on call at `at`, in ladder order.
    pub fn on_call_at(&self, at: i64) -> Vec<OnCallSlot> {
        resolve_on_call(&self.rotations, at, self.tz())
    }

    /// The person on call at `at`.
    pub fn on_call_now(&self, at: i64) -> Option<String> {
        on_call_now(&self.rotations, at, self.tz())
    }

    /// Who the rotation hands over to next — what a "secondary" is, without a
    /// second rotation for somebody to staff.
    pub fn next_on_call(&self, at: i64) -> Option<String> {
        next_on_call(&self.rotations, at, self.tz())
    }

    /// Everyone in the rotation in force, on shift or not.
    pub fn everyone_on_schedule(&self, at: i64) -> Vec<String> {
        everyone_on_schedule(&self.rotations, at, self.tz())
    }

    /// Whether a page would reach anybody at all.
    ///
    /// The one coverage question worth asking now that the ladder no longer
    /// has six slots to leave empty.
    pub fn is_staffed(&self, at: i64) -> bool {
        self.on_call_now(at).is_some()
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
            // Several rotations is follow-the-sun. What cannot be allowed is
            // two at the same priority with the same restrictions, where
            // neither is more specific and the winner would be arbitrary.
            let key = (r.priority, r.restrictions.clone());
            if !seen.insert(key) {
                return Err(TeamError::AmbiguousRotations);
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
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn test_on_call_resolves_the_rotation_in_force() {
        let s = schedule(vec![weekly("Primary", &["ana@o2.ai", "bob@o2.ai"])]);

        let slots = s.on_call_at(ANCHOR);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].user_email, "ana@o2.ai");
        assert_eq!(slots[0].next_user_email.as_deref(), Some("bob@o2.ai"));

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
