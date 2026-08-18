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

//! Slots arrived later, and they arrived as three **extra** variants rather
//! than as a field on the three that already existed. That is deliberate.
//! `{"kind":"on_call_now"}` is stored inside every policy row that exists, and
//! it means, and must keep meaning, "the default slot" — so the way to name a
//! different one is a target that says so, not a shape change that makes every
//! stored rung ambiguous about which model wrote it.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rotation::DEFAULT_SLOT;

/// One thing a rung pages. A rung may hold several.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EscalationTarget {
    /// Whoever the team's rotation puts on call at this instant, in the default
    /// slot.
    OnCallNow,
    /// The person the default slot's rotation hands over to next.
    ///
    /// This is what a "secondary" is for a team that has not staffed a second
    /// slot: one schedule, and the ladder walks it. It stays a within-slot
    /// question now that slots exist — see [`EscalationTarget::OnCallInSlot`]
    /// for the other reading, which a rung has to ask for by name.
    NextOnCall,
    /// Everyone in force across every slot, on shift or not. The broadcast
    /// before the whole team.
    EveryoneOnSchedule,
    /// Whoever a **named slot** puts on call at this instant.
    ///
    /// This is what makes a secondary a separate pool: a senior rotation with
    /// its own members and its own handover day, pointed at by rung two.
    OnCallInSlot { slot: String },
    /// The person a named slot's rotation hands over to next.
    NextOnCallInSlot { slot: String },
    /// Everyone in one slot's rotation, on shift or not.
    EveryoneInSlot { slot: String },
    /// One named person, by email — email is the login, so it is the one
    /// identifier every user is guaranteed to have.
    User { email: String },
    /// Every member of the team. The last resort at the bottom of a ladder.
    ///
    /// Deliberately blind to both slots and absence: it is what a page falls
    /// back to when the schedule has already failed to produce anybody, and a
    /// last resort that filters itself down to nobody is not one.
    WholeTeam,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetError {
    EmptyUser,
    /// A slot-naming target with no slot. It would resolve to nobody, and a
    /// rung that resolves to nobody is a rung that pages nobody.
    EmptySlot,
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyUser => f.write_str("a user target needs an email"),
            Self::EmptySlot => f.write_str("a slot target needs a slot name"),
        }
    }
}

impl EscalationTarget {
    pub fn user(email: impl Into<String>) -> Self {
        Self::User {
            email: email.into(),
        }
    }

    pub fn on_call_in(slot: impl Into<String>) -> Self {
        Self::OnCallInSlot { slot: slot.into() }
    }

    pub fn next_on_call_in(slot: impl Into<String>) -> Self {
        Self::NextOnCallInSlot { slot: slot.into() }
    }

    pub fn everyone_in(slot: impl Into<String>) -> Self {
        Self::EveryoneInSlot { slot: slot.into() }
    }

    /// Which slot this target resolves against.
    ///
    /// The three older variants answer [`DEFAULT_SLOT`] rather than `None`,
    /// which is the whole compatibility story in one line: a stored rung that
    /// never heard of slots means the primary, and every caller can ask one
    /// question instead of matching on which vocabulary wrote it.
    pub fn slot(&self) -> &str {
        match self {
            Self::OnCallInSlot { slot }
            | Self::NextOnCallInSlot { slot }
            | Self::EveryoneInSlot { slot } => slot,
            _ => DEFAULT_SLOT,
        }
    }

    pub fn validate(&self) -> Result<(), TargetError> {
        match self {
            Self::User { email } if email.trim().is_empty() => Err(TargetError::EmptyUser),
            Self::OnCallInSlot { slot }
            | Self::NextOnCallInSlot { slot }
            | Self::EveryoneInSlot { slot }
                if slot.trim().is_empty() =>
            {
                Err(TargetError::EmptySlot)
            }
            _ => Ok(()),
        }
    }

    /// What a page says it is going to. Read by a woken engineer, so it names
    /// the person where there is one and the role where there is not.
    ///
    /// **`NextOnCall` says "the secondary", not "the next on-call".** The old
    /// wording collided with the calendar's own "Next", which names the person
    /// taking over at the next handover — a different question with a
    /// different answer, on a different tab, and both correct. One word per
    /// concept: the calendar owns "next", the ladder owns "secondary".
    pub fn describe(&self) -> String {
        match self {
            Self::OnCallNow => "the on-call".to_string(),
            Self::NextOnCall => "the secondary".to_string(),
            Self::EveryoneOnSchedule => "everyone on the rotation".to_string(),
            Self::OnCallInSlot { slot } => format!("the {slot} on-call"),
            Self::NextOnCallInSlot { slot } => format!("the {slot} secondary"),
            Self::EveryoneInSlot { slot } => format!("everyone on the {slot} rotation"),
            Self::User { email } => email.clone(),
            Self::WholeTeam => "the whole team".to_string(),
        }
    }

    /// Why the person receiving this page is receiving it. Written into the
    /// page itself, because "why am I being woken" is the first thing read.
    /// A bounded label for metrics and logs.
    ///
    /// Separate from [`Self::describe`] and [`Self::reason`] on purpose: those
    /// name a *person* and so carry an email, which as a metric label would put
    /// one time series per engineer into the registry.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::OnCallNow => "on_call_now",
            Self::NextOnCall => "next_on_call",
            Self::EveryoneOnSchedule => "everyone_on_schedule",
            // The slot is *not* folded into the label: it is operator-chosen
            // text, and a metric label taking arbitrary strings is one time
            // series per typo.
            Self::OnCallInSlot { .. } => "on_call_in_slot",
            Self::NextOnCallInSlot { .. } => "next_on_call_in_slot",
            Self::EveryoneInSlot { .. } => "everyone_in_slot",
            Self::User { .. } => "user",
            Self::WholeTeam => "whole_team",
        }
    }

    pub fn reason(&self) -> &'static str {
        match self {
            Self::OnCallNow | Self::OnCallInSlot { .. } => "you are on call",
            Self::NextOnCall | Self::NextOnCallInSlot { .. } => "you are next on call",
            Self::EveryoneOnSchedule | Self::EveryoneInSlot { .. } => "you are on this rotation",
            Self::User { .. } => "you are named on the escalation policy",
            Self::WholeTeam => "the whole team is being paged",
        }
    }

    /// Whether resolving this target needs the team's rotation.
    pub fn needs_schedule(&self) -> bool {
        matches!(
            self,
            Self::OnCallNow
                | Self::NextOnCall
                | Self::EveryoneOnSchedule
                | Self::OnCallInSlot { .. }
                | Self::NextOnCallInSlot { .. }
                | Self::EveryoneInSlot { .. }
        )
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
        assert_eq!(EscalationTarget::NextOnCall.describe(), "the secondary");
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

    /// The compatibility promise in one test: the three older variants mean
    /// the default slot, and the three new ones say which.
    #[test]
    fn test_every_target_names_a_slot() {
        assert_eq!(EscalationTarget::OnCallNow.slot(), DEFAULT_SLOT);
        assert_eq!(EscalationTarget::NextOnCall.slot(), DEFAULT_SLOT);
        assert_eq!(EscalationTarget::EveryoneOnSchedule.slot(), DEFAULT_SLOT);
        assert_eq!(EscalationTarget::user("ana@o2.ai").slot(), DEFAULT_SLOT);
        assert_eq!(EscalationTarget::WholeTeam.slot(), DEFAULT_SLOT);

        assert_eq!(EscalationTarget::on_call_in("secondary").slot(), "secondary");
        assert_eq!(
            EscalationTarget::next_on_call_in("secondary").slot(),
            "secondary"
        );
        assert_eq!(EscalationTarget::everyone_in("seniors").slot(), "seniors");
    }

    /// A rung naming a slot has to travel, and a stored rung that never heard
    /// of slots has to keep parsing.
    #[test]
    fn test_slot_targets_round_trip_and_the_old_ones_are_unchanged() {
        assert_eq!(
            serde_json::to_string(&EscalationTarget::on_call_in("secondary")).unwrap(),
            r#"{"kind":"on_call_in_slot","slot":"secondary"}"#
        );
        assert_eq!(
            serde_json::to_string(&EscalationTarget::OnCallNow).unwrap(),
            r#"{"kind":"on_call_now"}"#,
            "a stored rung is not rewritten by the arrival of slots"
        );
        for target in [
            EscalationTarget::on_call_in("secondary"),
            EscalationTarget::next_on_call_in("secondary"),
            EscalationTarget::everyone_in("seniors"),
        ] {
            let json = serde_json::to_string(&target).unwrap();
            assert_eq!(
                serde_json::from_str::<EscalationTarget>(&json).unwrap(),
                target
            );
            assert!(target.needs_schedule(), "a slot is resolved by the schedule");
            target.validate().unwrap();
        }
    }

    /// A slot target with no slot resolves to nobody, so it is refused where
    /// it is written rather than discovered at 3am.
    #[test]
    fn test_a_slot_target_needs_a_slot() {
        for blank in ["", "   "] {
            assert_eq!(
                EscalationTarget::on_call_in(blank).validate(),
                Err(TargetError::EmptySlot)
            );
        }
    }

    /// A woken engineer reads `describe`, and "the secondary on-call" is a
    /// better answer than "the on-call" when there are two of them.
    #[test]
    fn test_a_slot_target_describes_which_pool_it_paged() {
        assert_eq!(
            EscalationTarget::on_call_in("secondary").describe(),
            "the secondary on-call"
        );
        assert_eq!(
            EscalationTarget::on_call_in("secondary").reason(),
            "you are on call"
        );
        // The metric label stays bounded: the slot is operator text.
        assert_eq!(
            EscalationTarget::on_call_in("whatever they typed").kind(),
            "on_call_in_slot"
        );
    }

}
