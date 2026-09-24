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

//! The firing episode, and the one recovery it can produce.
//!
//! An alert getting better is a state transition, not a level. Asking "is it Ok
//! right now?" answers yes on every evaluation after the first, which is how
//! on-call came to write 11,616 recovery entries for one firing. The episode is
//! the anchor that turns the question into "did it just become Ok?": it opens
//! on the first notification that was actually delivered and is cleared by the
//! same write that emits the recovery, so a second emit has nothing left to
//! reference. Exactly-once is then structural rather than guarded.
//!
//! Opening on the first *delivered* notification rather than the first firing
//! is what answers the suppressed cases without a check in every consumer: a
//! firing held back by the silence window, by `notify_on_warning`, or by the
//! pending period never paged anybody, so there is nothing to recover from and
//! no episode exists to say otherwise.

use serde::{Deserialize, Serialize};

use super::state::AlertState;
use crate::meta::alerts::level::AlertLevel;

/// Microseconds in a second, for `keep_firing_for`.
const MICROS_PER_SECOND: i64 = 1_000_000;

/// A recovery, emitted once per episode by the evaluation that observed it.
///
/// Carries what its consumers need after the state row has already forgotten
/// it: `episode_id` is the PagerDuty `dedup_key` that pairs the resolve with
/// its trigger, and `incident_id` says who owned firing delivery so the resolve
/// goes back to whoever sent it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecoveryEvent {
    pub org_id: String,
    pub alert_id: String,
    /// `""` is the per-alert rollup row; non-empty identifies one grouped series.
    pub group_key: String,
    pub episode_id: String,
    /// `None` = the alert path owned firing delivery.
    pub incident_id: Option<String>,
    pub opened_at: i64,
    /// When the condition cleared — not when `keep_firing_for` expired. The
    /// hold delays the message, it does not move the recovery.
    pub recovered_at: i64,
    pub emitted_at: i64,
    pub last_notified_level: Option<AlertLevel>,
    pub group_labels: Option<String>,
}

impl RecoveryEvent {
    /// How long the episode ran, in microseconds.
    pub fn duration_micros(&self) -> i64 {
        self.recovered_at.saturating_sub(self.opened_at).max(0)
    }
}

/// What one evaluation knows about delivery, for the episode axis.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EpisodeInput {
    /// A notification for this evaluation actually landed somewhere.
    pub delivered: bool,
    /// Set when the incident path owned that delivery.
    pub incident_id: Option<String>,
    /// `keep_firing_for` in seconds; 0 recovers on the first clear evaluation.
    pub keep_firing_for_secs: i64,
}

impl EpisodeInput {
    /// This evaluation delivered nothing — every path that is not a successful
    /// send, including a suppressed or failed one.
    pub fn undelivered(keep_firing_for_secs: i64) -> Self {
        Self {
            delivered: false,
            incident_id: None,
            keep_firing_for_secs,
        }
    }
}

/// The episode a recovery closed, for the caller to turn into a [`RecoveryEvent`].
///
/// Separate from the event because the state row does not know its own
/// `org_id`, and because closing an episode is a decision the caller may make
/// without an org in hand (the reaper).
#[derive(Clone, Debug, PartialEq)]
pub struct ClosedEpisode {
    pub episode_id: String,
    pub incident_id: Option<String>,
    pub opened_at: i64,
    pub recovered_at: i64,
}

/// Advance the episode axis of `state`, and say whether that closed one.
///
/// Runs after [`super::state::apply_outcome`] has folded in the outcome and
/// level axes, so `state` already carries this evaluation's verdict. Pure: the
/// id is minted by `new_episode_id`, which is only called when an episode
/// actually opens.
///
/// `firing` is the *recorded* level's verdict, not the raw match: a frozen
/// evaluation carries the previous level forward and so stays firing, which is
/// what stops a search outage from reading as a recovery.
pub fn apply_episode(
    state: &mut AlertState,
    firing: bool,
    input: &EpisodeInput,
    at: i64,
    new_episode_id: impl FnOnce() -> String,
) -> Option<ClosedEpisode> {
    if firing {
        // A re-fire during the hold is the same episode, so the resolve still
        // pairs with the trigger that opened it. Only a re-fire AFTER the
        // recovery opens a new one — which is also what PagerDuty does with a
        // trigger on a resolved dedup key.
        state.recovering_since = None;
        if input.delivered {
            if state.episode_id.is_none() {
                state.episode_id = Some(new_episode_id());
                state.episode_opened_at = Some(at);
                state.episode_incident_id = input.incident_id.clone();
            } else if state.episode_incident_id.is_none() {
                // Correlation can adopt an episode that began on the alert
                // path; the owner is whoever sent the LAST trigger.
                state.episode_incident_id = input.incident_id.clone();
            }
        }
        return None;
    }

    let Some(episode_id) = state.episode_id.clone() else {
        // Nothing was ever delivered, so there is nothing to recover from.
        state.recovering_since = None;
        return None;
    };

    let recovered_at = *state.recovering_since.get_or_insert(at);
    let hold_micros = input
        .keep_firing_for_secs
        .max(0)
        .saturating_mul(MICROS_PER_SECOND);
    if at < recovered_at.saturating_add(hold_micros) {
        return None;
    }

    let closed = ClosedEpisode {
        episode_id,
        incident_id: state.episode_incident_id.take(),
        opened_at: state.episode_opened_at.unwrap_or(recovered_at),
        recovered_at,
    };
    state.episode_id = None;
    state.episode_opened_at = None;
    state.recovering_since = None;
    Some(closed)
}

/// Build the outbound event for an episode this evaluation closed.
pub fn recovery_event(
    org_id: &str,
    state: &AlertState,
    closed: ClosedEpisode,
    emitted_at: i64,
) -> RecoveryEvent {
    RecoveryEvent {
        org_id: org_id.to_string(),
        alert_id: state.alert_id.clone(),
        group_key: state.group_key.clone(),
        episode_id: closed.episode_id,
        incident_id: closed.incident_id,
        opened_at: closed.opened_at,
        recovered_at: closed.recovered_at,
        emitted_at,
        last_notified_level: state.last_notified_level,
        group_labels: state.group_labels.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> AlertState {
        AlertState::empty("alert_1", "")
    }

    fn delivered() -> EpisodeInput {
        EpisodeInput {
            delivered: true,
            incident_id: None,
            keep_firing_for_secs: 0,
        }
    }

    #[test]
    fn a_suppressed_firing_opens_no_episode_and_recovers_nothing() {
        let mut s = state();
        assert!(
            apply_episode(&mut s, true, &EpisodeInput::undelivered(0), 10, || "ep"
                .into())
            .is_none()
        );
        assert!(
            s.episode_id.is_none(),
            "nothing was delivered, so nothing paged"
        );
        assert!(
            apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 20, || "ep"
                .into())
            .is_none(),
            "there is nothing to recover from"
        );
    }

    #[test]
    fn an_episode_recovers_exactly_once_however_often_it_is_evaluated() {
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 10, || "ep_1".into());
        assert_eq!(s.episode_id.as_deref(), Some("ep_1"));

        let closed = apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 20, || {
            "ep_2".into()
        })
        .expect("the first clear evaluation recovers");
        assert_eq!(closed.episode_id, "ep_1");
        assert_eq!(closed.opened_at, 10);
        assert_eq!(closed.recovered_at, 20);

        // The id is gone, so the question the scheduler asks every tick has
        // nothing left to answer with.
        for at in [30, 40, 50] {
            assert!(
                apply_episode(&mut s, false, &EpisodeInput::undelivered(0), at, || "ep_3"
                    .into())
                .is_none(),
                "a second emit must be impossible, not merely guarded"
            );
        }
    }

    #[test]
    fn keep_firing_for_holds_the_episode_open_and_keeps_the_clear_time() {
        let hold = EpisodeInput {
            delivered: false,
            incident_id: None,
            keep_firing_for_secs: 60,
        };
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 0, || "ep_1".into());

        assert!(apply_episode(&mut s, false, &hold, 1_000_000, || "x".into()).is_none());
        assert_eq!(s.recovering_since, Some(1_000_000));
        assert!(apply_episode(&mut s, false, &hold, 30_000_000, || "x".into()).is_none());

        let closed = apply_episode(&mut s, false, &hold, 61_000_000, || "x".into())
            .expect("the hold has expired");
        assert_eq!(
            closed.recovered_at, 1_000_000,
            "the hold delays the message, it does not move the recovery"
        );
    }

    #[test]
    fn a_re_fire_during_the_hold_keeps_the_same_episode() {
        let hold = EpisodeInput {
            delivered: false,
            incident_id: None,
            keep_firing_for_secs: 60,
        };
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 0, || "ep_1".into());
        apply_episode(&mut s, false, &hold, 1_000_000, || "x".into());
        assert_eq!(s.recovering_since, Some(1_000_000));

        apply_episode(
            &mut s,
            true,
            &EpisodeInput::undelivered(60),
            2_000_000,
            || "ep_2".into(),
        );
        assert_eq!(
            s.episode_id.as_deref(),
            Some("ep_1"),
            "same firing, same dedup key"
        );
        assert!(s.recovering_since.is_none(), "it is firing again");
    }

    #[test]
    fn the_incident_that_owned_the_firing_owns_the_recovery() {
        let mut s = state();
        apply_episode(&mut s, true, &EpisodeInput::undelivered(0), 0, || {
            "x".into()
        });
        apply_episode(
            &mut s,
            true,
            &EpisodeInput {
                delivered: true,
                incident_id: Some("inc_1".into()),
                keep_firing_for_secs: 0,
            },
            10,
            || "ep_1".into(),
        );

        let closed = apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 20, || {
            "x".into()
        })
        .expect("recovered");
        assert_eq!(closed.incident_id.as_deref(), Some("inc_1"));
    }

    #[test]
    fn a_new_firing_after_a_recovery_is_a_new_episode() {
        let mut s = state();
        apply_episode(&mut s, true, &delivered(), 0, || "ep_1".into());
        apply_episode(&mut s, false, &EpisodeInput::undelivered(0), 10, || {
            "x".into()
        });
        apply_episode(&mut s, true, &delivered(), 20, || "ep_2".into());
        assert_eq!(s.episode_id.as_deref(), Some("ep_2"));
        assert_eq!(s.episode_opened_at, Some(20));
    }
}
