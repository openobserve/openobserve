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

use serde::Deserialize;

const DEFAULT_RELAPSE_INTERVAL_SECS: i32 = 600;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Checking,
    Soaking,
    Held,
    Denied,
    Expired,
    Cancelled,
    Superseded,
    Unverified,
}

impl CheckState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Checking => "checking",
            Self::Soaking => "soaking",
            Self::Held => "held",
            Self::Denied => "denied",
            Self::Expired => "expired",
            Self::Cancelled => "cancelled",
            Self::Superseded => "superseded",
            Self::Unverified => "unverified",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "checking" => Some(Self::Checking),
            "soaking" => Some(Self::Soaking),
            "held" => Some(Self::Held),
            "denied" => Some(Self::Denied),
            "expired" => Some(Self::Expired),
            "cancelled" => Some(Self::Cancelled),
            "superseded" => Some(Self::Superseded),
            "unverified" => Some(Self::Unverified),
            _ => None,
        }
    }

    pub const fn is_live(self) -> bool {
        matches!(self, Self::Checking | Self::Soaking)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Open,
    Mitigated,
    Resolved,
    MergedAway,
}

impl Phase {
    pub fn of(status: &str, mitigated_at: Option<i64>, merged: bool) -> Self {
        if merged {
            Self::MergedAway
        } else if status == "resolved" {
            Self::Resolved
        } else if mitigated_at.is_some() {
            Self::Mitigated
        } else {
            Self::Open
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveryEvent {
    Record,
    ConditionEdit,
    Pass,
    FailureTick,
    ExpiryTick,
    Denied,
    SoakComplete,
    WatchPaused,
    BreachPair,
    Resolve,
    Reopen,
    Retract,
    Cancel,
    Merge,
    Unmerge,
    RollbackObserved,
    Claim,
    Split,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct GuardFacts {
    pub record_allowed: bool,
    pub current_attempt: bool,
    pub safe_threshold: bool,
    pub fresh_observation: bool,
    pub current_generation: bool,
    pub now: i64,
    pub expect_effect_secs: i32,
    pub relapse_interval_secs: Option<i32>,
    pub relapse_budget_full: bool,
    pub due_at: Option<i64>,
    pub fresh_non_pass_at: Option<i64>,
    pub latched: bool,
    pub expiry_reached: bool,
    pub coverage: bool,
    pub has_held_watch: bool,
    pub held_budget: bool,
    pub reopen_allowed: bool,
    pub retract_allowed: bool,
    pub other_watches: bool,
    pub move_allowed: bool,
    pub move_attempt: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Transition {
    pub row: u8,
    pub state: Option<CheckState>,
    pub bump_generation: bool,
    pub reset_passes: bool,
    pub end_held_watch: bool,
    pub incident: IncidentEffect,
    pub timing: Option<CheckTiming>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CheckTiming {
    pub effect_from_at: i64,
    pub recovery_due_at: i64,
    pub deadline_at: i64,
}

impl CheckTiming {
    pub fn from_base(effect_from_at: i64, expect_effect_secs: i32) -> Self {
        let recovery_due_at =
            effect_from_at.saturating_add(i64::from(expect_effect_secs) * 1_000_000);
        Self {
            effect_from_at,
            recovery_due_at,
            deadline_at: recovery_due_at.saturating_add(3_600_000_000),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IncidentEffect {
    Keep,
    RecordAttempt,
    RestartKeepingLatch,
    VerifyAndClearFixTimeDueAndLatch,
    LatchAt(i64),
    SetRecoveredAt,
    RelapseAndClearImpactEnd,
    Resolve,
    ReopenAndClearAttempt,
    RetractOrRevive,
    ClearDueKeepingLatch,
    MoveOrClearAttempt,
    RestoreWithoutAttempt,
    RecomputeDueKeepingPassesAndLatch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Refusal {
    MergedAway,
    Resolved,
    InvalidTransition,
}

pub fn apply(
    prior: (Phase, Option<CheckState>),
    event: RecoveryEvent,
    facts: GuardFacts,
) -> Result<Transition, Refusal> {
    use CheckState::*;
    use IncidentEffect::*;
    use Phase::*;
    use RecoveryEvent as E;

    let (phase, state) = prior;
    let update = |row, state, bump_generation, incident| Transition {
        row,
        state,
        bump_generation,
        reset_passes: row == 2 || (row == 10 && !facts.relapse_budget_full),
        end_held_watch: prior.1 == Some(Held) && (state != Some(Held) || matches!(row, 12 | 13)),
        incident,
        timing: match row {
            2 => Some(CheckTiming::from_base(facts.now, facts.expect_effect_secs)),
            10 if !facts.relapse_budget_full => Some(CheckTiming::from_base(
                facts.now,
                facts
                    .relapse_interval_secs
                    .unwrap_or(DEFAULT_RELAPSE_INTERVAL_SECS),
            )),
            _ => None,
        },
    };
    let move_check = |row, state, bump, effect| update(row, Some(state), bump, effect);
    let watching = matches!(state, Some(Checking | Soaking | Held));
    let live = state.is_some_and(CheckState::is_live);
    let failure_at = facts
        .due_at
        .filter(|due| facts.now >= *due)
        .zip(facts.fresh_non_pass_at)
        .map(|(due, sample)| due.max(sample));
    Ok(match (phase, state, event) {
        (MergedAway, _, E::Unmerge) if facts.move_allowed => {
            update(17, state, false, RestoreWithoutAttempt)
        }
        (MergedAway, ..) => return Err(Refusal::MergedAway),
        (
            Resolved,
            _,
            E::Record | E::Claim | E::ConditionEdit | E::Cancel | E::Retract | E::Merge | E::Split,
        ) => {
            return Err(Refusal::Resolved);
        }
        (Open | Mitigated, _, E::Record) if facts.record_allowed => update(
            1,
            if watching { Some(Superseded) } else { state },
            watching,
            RecordAttempt,
        ),
        (Open | Mitigated, _, E::ConditionEdit)
            if watching && facts.current_attempt && facts.safe_threshold =>
        {
            move_check(2, Checking, true, RestartKeepingLatch)
        }
        (Open, Some(Checking), E::Pass)
            if facts.fresh_observation && facts.current_attempt && facts.current_generation =>
        {
            move_check(3, Soaking, false, VerifyAndClearFixTimeDueAndLatch)
        }
        (Open, Some(Checking), E::FailureTick)
            if facts.current_attempt && facts.current_generation && !facts.latched =>
        {
            let at = failure_at.ok_or(Refusal::InvalidTransition)?;
            move_check(4, Checking, false, LatchAt(at))
        }
        (Open, Some(Checking), E::ExpiryTick) if facts.expiry_reached => {
            move_check(5, Expired, false, Keep)
        }
        (Open, Some(Checking), E::Denied) => move_check(6, Denied, false, Keep),
        (Mitigated | Resolved, Some(Soaking | Held), E::Denied) => {
            move_check(7, Unverified, false, Keep)
        }
        (Mitigated | Resolved, Some(Soaking), E::SoakComplete) if facts.coverage => {
            if phase == Resolved || facts.held_budget {
                move_check(8, Held, true, SetRecoveredAt)
            } else {
                move_check(8, Unverified, false, Keep)
            }
        }
        (Mitigated | Resolved, Some(Soaking | Held), E::WatchPaused)
            if state == Some(Soaking) || facts.has_held_watch =>
        {
            move_check(9, Unverified, false, Keep)
        }
        (Mitigated, Some(Soaking | Held), E::BreachPair) if facts.current_generation => {
            if facts.relapse_budget_full {
                update(10, state, false, Keep)
            } else {
                move_check(10, Checking, true, RelapseAndClearImpactEnd)
            }
        }
        (Resolved, Some(Soaking), E::BreachPair) if facts.current_generation => {
            move_check(11, Cancelled, true, ReopenAndClearAttempt)
        }
        (Open | Mitigated, _, E::Resolve) => {
            let checking = state == Some(Checking);
            update(
                12,
                if checking { Some(Cancelled) } else { state },
                checking,
                Resolve,
            )
        }
        (Resolved, _, E::Reopen) if facts.reopen_allowed => update(
            13,
            if live { Some(Cancelled) } else { state },
            state.is_some(),
            ReopenAndClearAttempt,
        ),
        (Open, _, E::Retract)
            if facts.retract_allowed
                && !facts.latched
                && !matches!(state, Some(Soaking | Held)) =>
        {
            update(
                15,
                state.map(|_| Cancelled),
                state.is_some(),
                RetractOrRevive,
            )
        }
        (Open | Mitigated, Some(Checking | Soaking | Held), E::Cancel) => {
            match (state, facts.other_watches) {
                (Some(Checking), false) => move_check(16, Cancelled, true, ClearDueKeepingLatch),
                (Some(Soaking | Held), false) => move_check(16, Unverified, true, Keep),
                _ => move_check(16, Cancelled, true, Keep),
            }
        }
        (Open | Mitigated, _, E::Merge) if watching && facts.move_allowed => update(
            17,
            if facts.move_attempt {
                state
            } else {
                Some(Cancelled)
            },
            true,
            MoveOrClearAttempt,
        ),
        (Open, Some(Checking), E::RollbackObserved)
        | (Mitigated, Some(Soaking), E::RollbackObserved)
            if facts.current_generation =>
        {
            update(18, state, true, RecomputeDueKeepingPassesAndLatch)
        }
        (Open | Mitigated, _, E::Claim) => update(0, state, false, Keep),
        _ => return Err(Refusal::InvalidTransition),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        CheckState::{Denied as DeniedState, *},
        Phase::*,
        RecoveryEvent::{Denied as DeniedEvent, *},
        *,
    };

    #[test]
    fn recovery_transitions_cover_every_phase_state_event() {
        let states = [
            None,
            Some(Checking),
            Some(Soaking),
            Some(Held),
            Some(DeniedState),
            Some(Expired),
            Some(Cancelled),
            Some(Superseded),
            Some(Unverified),
        ];
        let events = [
            Record,
            ConditionEdit,
            Pass,
            FailureTick,
            ExpiryTick,
            DeniedEvent,
            SoakComplete,
            WatchPaused,
            BreachPair,
            Resolve,
            Reopen,
            Retract,
            Cancel,
            Merge,
            Unmerge,
            RollbackObserved,
            Claim,
            Split,
        ];
        let facts = GuardFacts {
            record_allowed: true,
            current_attempt: true,
            safe_threshold: true,
            fresh_observation: true,
            current_generation: true,
            now: 3,
            expect_effect_secs: 900,
            relapse_interval_secs: None,
            relapse_budget_full: false,
            due_at: Some(2),
            fresh_non_pass_at: Some(3),
            latched: false,
            expiry_reached: true,
            coverage: true,
            has_held_watch: true,
            held_budget: true,
            reopen_allowed: true,
            retract_allowed: true,
            other_watches: true,
            move_allowed: true,
            move_attempt: false,
        };
        let open = &[Open][..];
        let writable = &[Open, Mitigated][..];
        let mitigated = &[Mitigated][..];
        let resolved = &[Resolved][..];
        let verified = &[Mitigated, Resolved][..];
        let merged = &[MergedAway][..];
        let any = &states[..];
        let checking = &[Some(Checking)][..];
        let soaking = &[Some(Soaking)][..];
        let passed = &[Some(Soaking), Some(Held)][..];
        let watching = &[Some(Checking), Some(Soaking), Some(Held)][..];
        let retractable = &[
            None,
            Some(Checking),
            Some(DeniedState),
            Some(Expired),
            Some(Cancelled),
            Some(Superseded),
            Some(Unverified),
        ][..];
        let rows = [
            (Record, writable, any, 1),
            (ConditionEdit, writable, watching, 2),
            (Pass, open, checking, 3),
            (FailureTick, open, checking, 4),
            (ExpiryTick, open, checking, 5),
            (DeniedEvent, open, checking, 6),
            (DeniedEvent, verified, passed, 7),
            (SoakComplete, verified, soaking, 8),
            (WatchPaused, verified, passed, 9),
            (BreachPair, mitigated, passed, 10),
            (BreachPair, resolved, soaking, 11),
            (Resolve, writable, any, 12),
            (Reopen, resolved, any, 13),
            (Retract, open, retractable, 15),
            (Cancel, writable, watching, 16),
            (Merge, writable, watching, 17),
            (Unmerge, merged, any, 17),
            (RollbackObserved, open, checking, 18),
            (RollbackObserved, mitigated, soaking, 18),
            (Claim, writable, any, 0),
        ];
        for phase in [Open, Mitigated, Resolved, MergedAway] {
            for state in states {
                for event in events {
                    let actual = apply((phase, state), event, facts);
                    let row = rows.iter().find(|(e, phases, states, _)| {
                        *e == event && phases.contains(&phase) && states.contains(&state)
                    });
                    if let Some(&(_, _, _, number)) = row {
                        let actual = actual.unwrap();
                        assert_eq!(actual.row, number);
                        assert_eq!(actual.state, expected_state(number, state, event));
                        assert_eq!(
                            actual.timing,
                            match number {
                                2 => Some(CheckTiming {
                                    effect_from_at: 3,
                                    recovery_due_at: 900_000_003,
                                    deadline_at: 4_500_000_003,
                                }),
                                10 => Some(CheckTiming {
                                    effect_from_at: 3,
                                    recovery_due_at: 600_000_003,
                                    deadline_at: 4_200_000_003,
                                }),
                                _ => None,
                            },
                        );
                        use IncidentEffect as I;
                        assert_eq!(
                            actual.incident,
                            match number {
                                1 => I::RecordAttempt,
                                2 => I::RestartKeepingLatch,
                                3 => I::VerifyAndClearFixTimeDueAndLatch,
                                4 => I::LatchAt(3),
                                8 => I::SetRecoveredAt,
                                10 => I::RelapseAndClearImpactEnd,
                                11 | 13 => I::ReopenAndClearAttempt,
                                12 => I::Resolve,
                                15 => I::RetractOrRevive,
                                17 if event == Merge => I::MoveOrClearAttempt,
                                17 => I::RestoreWithoutAttempt,
                                18 => I::RecomputeDueKeepingPassesAndLatch,
                                _ => I::Keep,
                            }
                        );
                        assert_eq!(
                            actual.bump_generation,
                            match number {
                                1 => watching.contains(&state),
                                2 | 8 | 10 | 11 | 16 | 18 => true,
                                12 => state == Some(Checking),
                                13 | 15 => state.is_some(),
                                17 => event == Merge,
                                _ => false,
                            }
                        );
                    } else {
                        let refusal = match (phase, event) {
                            (MergedAway, _) => Refusal::MergedAway,
                            (
                                Resolved,
                                Record | Claim | ConditionEdit | Cancel | Retract | Merge | Split,
                            ) => Refusal::Resolved,
                            _ => Refusal::InvalidTransition,
                        };
                        assert_eq!(actual, Err(refusal), "{phase:?} {state:?} {event:?}");
                    }
                }
            }
        }
    }

    fn expected_state(
        row: u8,
        prior: Option<CheckState>,
        event: RecoveryEvent,
    ) -> Option<CheckState> {
        match row {
            1 if matches!(prior, Some(Checking | Soaking | Held)) => Some(Superseded),
            2 | 10 => Some(Checking),
            3 => Some(Soaking),
            5 => Some(Expired),
            6 => Some(CheckState::Denied),
            7 | 9 => Some(Unverified),
            8 => Some(Held),
            11 | 16 => Some(Cancelled),
            12 if prior == Some(Checking) => Some(Cancelled),
            13 if matches!(prior, Some(Checking | Soaking)) => Some(Cancelled),
            15 if prior.is_some() => Some(Cancelled),
            17 if event == Merge => Some(Cancelled),
            _ => prior,
        }
    }
}
