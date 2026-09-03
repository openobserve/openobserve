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

//! Who a level of the ladder pages.
//!
//! **Three kinds, and that is the whole vocabulary.** A level names a rotation,
//! or it names people, or it names the team.
//!
//! It was eight. Six of them existed to name a *position* — `OnCallNow` meant
//! "the default slot", `NextOnCall` meant "one handover further along the same
//! roster", and three `_in_slot` variants named a slot as a string. Two of
//! those six could put somebody on call that no rotation had rostered, which is
//! how one team ended up with the schedule screen and the escalation preview
//! naming two different people and both being right.
//!
//! A position is now a [`super::Rotation`] with an id, so a level points at one.
//! Nothing here conjures a person: if a level resolves to somebody, a shift rule
//! put them there. See `architecture/02 §0`.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// How much of a rotation a level pages.
///
/// Mirrors incident.io's `schedule_mode`, and is the reason three kinds are
/// enough: "everyone in this rotation" is a *mode*, not a fourth kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RotationMode {
    /// The one person the rotation puts on call at this instant.
    ///
    /// Absent from the wire when it is this, so every level written before the
    /// mode existed round-trips unchanged.
    #[default]
    OnCall,
    /// Everyone on the rotation's winning shift rule, on shift or not — the
    /// broadcast before the whole team. The away are left out: an absence is
    /// not being there at all, and `WholeTeam` below is the rung that ignores
    /// that on purpose.
    All,
}

impl RotationMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OnCall => "on_call",
            Self::All => "all",
        }
    }

    fn is_default(&self) -> bool {
        matches!(self, Self::OnCall)
    }
}

/// One thing a level pages. A level may hold several, and they fire together.
///
/// Firing together is the *only* mechanism for paging more than one person.
/// There is no stacking, no overlap and no derivation — which is what keeps
/// "who does this level wake" answerable by reading it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EscalationTarget {
    /// A named rotation, by id.
    ///
    /// By id rather than by name because a rotation is renameable and a stored
    /// policy must not start paging a different position because somebody fixed
    /// a typo on a calendar.
    Rotation {
        rotation_id: String,
        #[serde(default, skip_serializing_if = "RotationMode::is_default")]
        mode: RotationMode,
    },
    /// One named person, by email — email is the login, so it is the one
    /// identifier every user is guaranteed to have.
    User { email: String },
    /// Every member of the team. The last resort at the bottom of a ladder.
    ///
    /// Deliberately blind to rotations and to absence: it is what a page falls
    /// back to when every rotation has already failed to produce anybody, and a
    /// last resort that filters itself down to nobody is not one.
    WholeTeam,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetError {
    EmptyUser,
    /// A rotation target with no id. It would resolve to nobody, and a level
    /// that resolves to nobody is a level that pages nobody.
    EmptyRotation,
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyUser => f.write_str("a user target needs an email"),
            Self::EmptyRotation => f.write_str("a rotation target needs a rotation"),
        }
    }
}

impl EscalationTarget {
    pub fn user(email: impl Into<String>) -> Self {
        Self::User {
            email: email.into(),
        }
    }

    /// The common case: whoever this rotation puts on call now.
    pub fn rotation(rotation_id: impl Into<String>) -> Self {
        Self::Rotation {
            rotation_id: rotation_id.into(),
            mode: RotationMode::OnCall,
        }
    }

    /// Everyone on this rotation at once.
    pub fn everyone_in(rotation_id: impl Into<String>) -> Self {
        Self::Rotation {
            rotation_id: rotation_id.into(),
            mode: RotationMode::All,
        }
    }

    /// Which rotation this target resolves against, if any.
    pub fn rotation_id(&self) -> Option<&str> {
        match self {
            Self::Rotation { rotation_id, .. } => Some(rotation_id),
            _ => None,
        }
    }

    pub fn validate(&self) -> Result<(), TargetError> {
        match self {
            Self::User { email } if email.trim().is_empty() => Err(TargetError::EmptyUser),
            Self::Rotation { rotation_id, .. } if rotation_id.trim().is_empty() => {
                Err(TargetError::EmptyRotation)
            }
            _ => Ok(()),
        }
    }

    /// What a page says it is going to. Read by a woken engineer, so it names
    /// the rotation somebody can go and look at rather than a role word.
    ///
    /// Takes the rotation's name because the target stores an id, and an id in
    /// a page body tells a half-asleep reader nothing. `None` is a rotation the
    /// team has since deleted, which is worth saying rather than hiding.
    pub fn describe(&self, rotation_name: Option<&str>) -> String {
        match self {
            Self::Rotation { mode, .. } => match (rotation_name, mode) {
                (Some(n), RotationMode::OnCall) => format!("whoever is on call in {n}"),
                (Some(n), RotationMode::All) => format!("everyone on {n}"),
                (None, _) => "a rotation that no longer exists".to_string(),
            },
            Self::User { email } => email.clone(),
            Self::WholeTeam => "the whole team".to_string(),
        }
    }

    /// A bounded label for metrics and logs.
    ///
    /// The rotation is *not* folded in: its id is unbounded operator data, and
    /// a metric label taking arbitrary strings is one time series per rotation
    /// anybody ever creates.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Rotation {
                mode: RotationMode::OnCall,
                ..
            } => "rotation_on_call",
            Self::Rotation {
                mode: RotationMode::All,
                ..
            } => "rotation_all",
            Self::User { .. } => "user",
            Self::WholeTeam => "whole_team",
        }
    }

    /// Why the person receiving this page is receiving it. Written into the
    /// page itself, because "why am I being woken" is the first thing read.
    pub fn reason(&self) -> &'static str {
        match self {
            Self::Rotation {
                mode: RotationMode::OnCall,
                ..
            } => "you are on call",
            Self::Rotation {
                mode: RotationMode::All,
                ..
            } => "you are on this rotation",
            Self::User { .. } => "you are named on the escalation policy",
            Self::WholeTeam => "the whole team is being paged",
        }
    }

    /// Whether resolving this target needs the team's rotations loaded.
    pub fn needs_schedule(&self) -> bool {
        matches!(self, Self::Rotation { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_a_user_target_needs_an_email() {
        assert!(EscalationTarget::user("ana@o2.ai").validate().is_ok());
        for blank in ["", "   "] {
            assert_eq!(
                EscalationTarget::user(blank).validate(),
                Err(TargetError::EmptyUser)
            );
        }
    }

    /// A level pointing at nothing would page nobody while looking configured,
    /// which is the failure this whole rewrite exists to stop.
    #[test]
    fn test_a_rotation_target_needs_a_rotation() {
        assert!(EscalationTarget::rotation("3I96D").validate().is_ok());
        for blank in ["", "   "] {
            assert_eq!(
                EscalationTarget::rotation(blank).validate(),
                Err(TargetError::EmptyRotation)
            );
        }
    }

    /// Only a rotation target needs the schedule loaded, so the engine knows
    /// whether to read it before it does.
    #[test]
    fn test_only_rotation_targets_need_a_schedule() {
        assert!(EscalationTarget::rotation("3I96D").needs_schedule());
        assert!(EscalationTarget::everyone_in("3I96D").needs_schedule());

        assert!(!EscalationTarget::user("ana@o2.ai").needs_schedule());
        assert!(!EscalationTarget::WholeTeam.needs_schedule());
    }

    /// A woken engineer's first question.
    #[test]
    fn test_a_target_says_why_the_page_arrived() {
        assert_eq!(EscalationTarget::rotation("r").reason(), "you are on call");
        assert_eq!(
            EscalationTarget::everyone_in("r").reason(),
            "you are on this rotation"
        );
        assert_eq!(
            EscalationTarget::user("ana@o2.ai").reason(),
            "you are named on the escalation policy"
        );
        assert_eq!(
            EscalationTarget::WholeTeam.reason(),
            "the whole team is being paged"
        );
    }

    /// The page names the rotation, because the target stores an id and an id
    /// tells a half-asleep reader nothing.
    #[test]
    fn test_a_target_describes_itself_with_the_rotation_name() {
        assert_eq!(
            EscalationTarget::user("ana@o2.ai").describe(None),
            "ana@o2.ai"
        );
        assert_eq!(
            EscalationTarget::rotation("r").describe(Some("Primary")),
            "whoever is on call in Primary"
        );
        assert_eq!(
            EscalationTarget::everyone_in("r").describe(Some("Primary")),
            "everyone on Primary"
        );
        assert_eq!(EscalationTarget::WholeTeam.describe(None), "the whole team");
    }

    /// A level can outlive the rotation it names. Saying so beats rendering a
    /// ksuid, and beats pretending the level is fine.
    #[test]
    fn test_a_deleted_rotation_is_described_rather_than_hidden() {
        assert_eq!(
            EscalationTarget::rotation("gone").describe(None),
            "a rotation that no longer exists"
        );
    }

    /// Persisted inside the policy JSON, so the tag is a wire format.
    #[test]
    fn test_targets_round_trip_through_json() {
        for target in [
            EscalationTarget::rotation("3I96D"),
            EscalationTarget::everyone_in("3I96D"),
            EscalationTarget::user("ana@o2.ai"),
            EscalationTarget::WholeTeam,
        ] {
            let json = serde_json::to_string(&target).unwrap();
            assert_eq!(
                serde_json::from_str::<EscalationTarget>(&json).unwrap(),
                target
            );
        }

        assert_eq!(
            serde_json::to_string(&EscalationTarget::user("ana@o2.ai")).unwrap(),
            r#"{"kind":"user","email":"ana@o2.ai"}"#
        );
        assert_eq!(
            serde_json::to_string(&EscalationTarget::WholeTeam).unwrap(),
            r#"{"kind":"whole_team"}"#
        );
    }

    /// `on_call` is the mode nearly every level wants, so it is absent from the
    /// wire — a level written before the mode existed reads back unchanged, and
    /// a policy row does not grow a field to say "the usual".
    #[test]
    fn test_the_default_mode_is_absent_from_the_wire() {
        assert_eq!(
            serde_json::to_string(&EscalationTarget::rotation("3I96D")).unwrap(),
            r#"{"kind":"rotation","rotation_id":"3I96D"}"#
        );
        assert_eq!(
            serde_json::to_string(&EscalationTarget::everyone_in("3I96D")).unwrap(),
            r#"{"kind":"rotation","rotation_id":"3I96D","mode":"all"}"#
        );
        // And a stored level with no mode still means the one person.
        let parsed: EscalationTarget =
            serde_json::from_str(r#"{"kind":"rotation","rotation_id":"3I96D"}"#).unwrap();
        assert_eq!(parsed, EscalationTarget::rotation("3I96D"));
    }

    /// The id is what is stored, so renaming a rotation on the calendar cannot
    /// move which position a policy pages.
    #[test]
    fn test_a_level_points_at_an_id_not_a_name() {
        let t = EscalationTarget::rotation("3I96D");
        assert_eq!(t.rotation_id(), Some("3I96D"));
        assert_eq!(EscalationTarget::WholeTeam.rotation_id(), None);
        assert_eq!(EscalationTarget::user("ana@o2.ai").rotation_id(), None);
    }

    /// Metric labels are bounded: the rotation id is operator data and must not
    /// reach the registry.
    #[test]
    fn test_kind_labels_are_bounded() {
        assert_eq!(
            EscalationTarget::rotation("3I96D").kind(),
            "rotation_on_call"
        );
        assert_eq!(
            EscalationTarget::everyone_in("3I96D").kind(),
            "rotation_all"
        );
        assert_eq!(EscalationTarget::user("ana@o2.ai").kind(), "user");
        assert_eq!(EscalationTarget::WholeTeam.kind(), "whole_team");
        for t in [
            EscalationTarget::rotation("3I96D"),
            EscalationTarget::everyone_in("3I96D"),
        ] {
            assert!(!t.kind().contains("3I96D"), "the id reached a metric label");
        }
    }
}
