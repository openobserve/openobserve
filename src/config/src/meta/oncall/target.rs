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

//! Who a rung of the ladder pages.
//!
//! This replaces a fixed six-slot vocabulary (`primary`, `secondary`,
//! `l1`..`l4`) in which every slot needed a rotation of its own. That model
//! forced a team to staff six schedules to use a shipped default policy, and
//! reported the ones they had not staffed as coverage gaps forever. It could
//! also not express the ordinary case of paging two named people at once.
//!
//! No comparable product models a "secondary" slot. It falls out of the
//! ladder: either a second, offset rotation, or — far simpler for one team —
//! the ladder walking positions in the same rotation. `NextOnCall` is that.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// One thing a rung pages. A rung may hold several.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EscalationTarget {
    /// Whoever the team's rotation puts on call at this instant.
    OnCallNow,
    /// The person the rotation hands over to next.
    ///
    /// This is what a "secondary" is, without a second rotation to staff: one
    /// schedule, and the ladder walks it.
    NextOnCall,
    /// Everyone in the rotation, on shift or not.
    EveryoneOnSchedule,
    /// One named person, by email — email is the login, so it is the one
    /// identifier every user is guaranteed to have.
    User { email: String },
    /// Every member of the team. The last resort at the bottom of a ladder.
    WholeTeam,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetError {
    EmptyUser,
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyUser => f.write_str("a user target needs an email"),
        }
    }
}

impl EscalationTarget {
    pub fn user(email: impl Into<String>) -> Self {
        Self::User {
            email: email.into(),
        }
    }

    pub fn validate(&self) -> Result<(), TargetError> {
        match self {
            Self::User { email } if email.trim().is_empty() => Err(TargetError::EmptyUser),
            _ => Ok(()),
        }
    }

    /// What a page says it is going to. Read by a woken engineer, so it names
    /// the person where there is one and the role where there is not.
    pub fn describe(&self) -> String {
        match self {
            Self::OnCallNow => "the on-call".to_string(),
            Self::NextOnCall => "the next on-call".to_string(),
            Self::EveryoneOnSchedule => "everyone on the rotation".to_string(),
            Self::User { email } => email.clone(),
            Self::WholeTeam => "the whole team".to_string(),
        }
    }

    /// Why the person receiving this page is receiving it. Written into the
    /// page itself, because "why am I being woken" is the first thing read.
    pub fn reason(&self) -> &'static str {
        match self {
            Self::OnCallNow => "you are on call",
            Self::NextOnCall => "you are next on call",
            Self::EveryoneOnSchedule => "you are on this rotation",
            Self::User { .. } => "you are named on the escalation policy",
            Self::WholeTeam => "the whole team is being paged",
        }
    }

    /// Whether resolving this target needs the team's rotation.
    pub fn needs_schedule(&self) -> bool {
        matches!(self, Self::OnCallNow | Self::NextOnCall | Self::EveryoneOnSchedule)
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

    /// The rotation-derived targets are the ones that can come back empty, so
    /// the engine has to know which need a schedule before it looks for one.
    #[test]
    fn test_only_rotation_targets_need_a_schedule() {
        assert!(EscalationTarget::OnCallNow.needs_schedule());
        assert!(EscalationTarget::NextOnCall.needs_schedule());
        assert!(EscalationTarget::EveryoneOnSchedule.needs_schedule());

        assert!(!EscalationTarget::user("ana@o2.ai").needs_schedule());
        assert!(!EscalationTarget::WholeTeam.needs_schedule());
    }

    /// A woken engineer's first question. A bare role name does not answer it.
    #[test]
    fn test_a_target_says_why_the_page_arrived() {
        assert_eq!(EscalationTarget::OnCallNow.reason(), "you are on call");
        assert_eq!(EscalationTarget::NextOnCall.reason(), "you are next on call");
        assert_eq!(
            EscalationTarget::user("ana@o2.ai").reason(),
            "you are named on the escalation policy"
        );
    }

    /// A page names a person when it has one; "the on-call" is only useful
    /// when the reader cannot be told who that is.
    #[test]
    fn test_a_target_describes_itself_for_the_page() {
        assert_eq!(EscalationTarget::user("ana@o2.ai").describe(), "ana@o2.ai");
        assert_eq!(EscalationTarget::OnCallNow.describe(), "the on-call");
        assert_eq!(EscalationTarget::NextOnCall.describe(), "the next on-call");
    }

    /// Persisted inside the policy JSON, so the tag is a wire format.
    #[test]
    fn test_targets_round_trip_through_json() {
        for target in [
            EscalationTarget::OnCallNow,
            EscalationTarget::NextOnCall,
            EscalationTarget::EveryoneOnSchedule,
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
            serde_json::to_string(&EscalationTarget::OnCallNow).unwrap(),
            r#"{"kind":"on_call_now"}"#
        );
        assert_eq!(
            serde_json::to_string(&EscalationTarget::user("ana@o2.ai")).unwrap(),
            r#"{"kind":"user","email":"ana@o2.ai"}"#
        );
    }
}
