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

//! Escalation policy — a team's ladder and channels, shipped editable so a new team pages.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    rotation::MICROS_PER_MINUTE,
    target::{EscalationTarget, TargetError},
};
use crate::meta::alerts::priority::AlertPriority;

/// How loudly a signal pages when nobody said how loudly it should.
///
/// Every producer reads this rather than picking its own default. They used to
/// disagree — the alert path defaulted to P3, the incident path to P2 — so
/// ticking `creates_incident` silently changed how loudly an alert woke
/// somebody.
///
/// P2 is the safer of the two: paging a little too loudly wastes a few minutes
/// of attention, while paging too quietly leaves a real outage on the ladder
/// P3 walks half an hour more slowly.
pub const DEFAULT_PAGING_PRIORITY: AlertPriority = AlertPriority::P2;

/// How a page reaches a person.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    Email,
    /// An existing alert Destination — Slack, Teams, or any HTTP endpoint.
    Webhook,
}

impl Channel {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Email => 1,
            Self::Webhook => 7,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Email),
            7 => Some(Self::Webhook),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Webhook => "webhook",
        }
    }

    /// Every channel a page can reach a person on.
    pub fn deliverable() -> Vec<Self> {
        vec![Self::Email, Self::Webhook]
    }
}

/// 03 §6's fallback chain, in the order it is evaluated.
///
/// The chain stops at the first success, so the order decides which channel is
/// tried first. When a provider lands, its channel goes in at the position its
/// urgency earns.
pub const FALLBACK_ORDER: [Channel; 2] = [Channel::Email, Channel::Webhook];

/// The channels one responder is tried on, in order, for a rung.
///
/// §6: "on a single-node deployment with just SMTP configured, the chain
/// collapses to email and everything still works" — the baseline, not a
/// degenerate case.
pub fn fallback_chain(channels: &[Channel]) -> Vec<Channel> {
    FALLBACK_ORDER
        .into_iter()
        .filter(|c| channels.contains(c))
        .collect()
}

/// Whether a channel talks to a room rather than to a person (G8).
///
/// The fallback chain answers "have we reached this human yet", and stopping at
/// the first success is right for that. It is the wrong question for a chat
/// room: a team ticking email and chat means "wake the on-call, and put it in
/// the channel", but the chain read that as "post only if the email bounced".
///
/// So the two kinds are separated by what they address, not by how loud they
/// are. A webhook resolves to a destination the whole team watches; email
/// resolves to one person's inbox.
pub fn is_broadcast(channel: Channel) -> bool {
    match channel {
        Channel::Webhook => true,
        Channel::Email => false,
    }
}

/// How one rung's channel set splits into "try until somebody answers" and
/// "always post".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelPlan {
    /// Tried per recipient, in [`FALLBACK_ORDER`], stopping at the first
    /// success — the chain built deliberately for reaching a person.
    pub chain: Vec<Channel>,
    /// Sent once per rung, whatever the chain did.
    ///
    /// Per rung and not per recipient: a rung fanning out to six people used to
    /// post six identical messages into one room.
    pub broadcast: Vec<Channel>,
}

impl ChannelPlan {
    /// Whether this rung can reach anybody at all.
    pub fn is_empty(&self) -> bool {
        self.chain.is_empty() && self.broadcast.is_empty()
    }
}

/// Split a rung's channels into the person-reaching chain and the broadcasts.
pub fn channel_plan(channels: &[Channel]) -> ChannelPlan {
    ChannelPlan {
        chain: fallback_chain(channels)
            .into_iter()
            .filter(|c| !is_broadcast(*c))
            .collect(),
        broadcast: FALLBACK_ORDER
            .into_iter()
            .filter(|c| is_broadcast(*c) && channels.contains(c))
            .collect(),
    }
}

// ── Where a team's channel lives (Change 1) ──────────────────────────────────

/// The destinations a team's own channel posts go to, and what a page's
/// `Webhook` channel resolves to.
///
/// The list used to live only on [`EscalationPolicy::destinations`]. A team's
/// chat room is not a property of its ladder, and having to open the escalation
/// editor to change where the team is talked to is how a channel ends up
/// pointing at a room nobody reads.
///
/// - `None` — the team never set one, so the policy's list is used and every policy stored before
///   the field existed keeps working.
/// - `Some(list)` — the team's list wins, including when it is empty. An empty list means "this
///   team has no channel"; falling back there would make the field impossible to turn off.
pub fn team_channel<'a>(team: Option<&'a [String]>, policy: &'a [String]) -> &'a [String] {
    match team {
        Some(list) => list,
        None => policy,
    }
}

// ── Fanning one firing out to several teams (07 I-D2) ────────────────────────

/// How many teams one firing may wake before it is treated as a grouping
/// mistake rather than as that many outages.
///
/// A `GROUP BY` spanning fifteen teams is somebody's alert definition, not
/// fifteen outages, and paging all fifteen teaches a whole org to ignore the
/// pager. Five is above any real multi-team failure and well below "everyone".
pub const MAX_FANOUT_TEAMS: usize = 5;

/// How many of a team's other groups the timeline names before it stops
/// counting. A `GROUP BY` has no bound, and a timeline entry does.
const NAMED_GROUPS: usize = 5;

/// The line one team's record carries when the firing woke more than one team.
/// A responder has to tell "my team's own page" from "part of something wider"
/// without opening three screens.
pub fn fanout_note(mine: &str, also_mine: &[String], other_teams: usize) -> String {
    let mut note = format!("paged for {mine}");
    if !also_mine.is_empty() {
        let named = also_mine
            .iter()
            .take(NAMED_GROUPS)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        note.push_str(&format!(", and {named}"));
        if also_mine.len() > NAMED_GROUPS {
            note.push_str(&format!(" and {} more", also_mine.len() - NAMED_GROUPS));
        }
        note.push_str(" — all owned by this team, so this is one page");
    }
    if other_teams > 0 {
        note.push_str(&format!(
            "; {other_teams} other team(s) were paged for the same firing"
        ));
    }
    note
}

/// The line the one record carries when a firing spanned more teams than
/// [`MAX_FANOUT_TEAMS`].
pub fn fanout_capped_note(teams: usize) -> String {
    format!(
        "this firing spans {teams} teams, which is a grouping mistake rather than {teams} \
         outages; one page was sent instead of {teams}, and the alert's grouping needs a look"
    )
}

// ── The liaison seat (D-21) ──────────────────────────────────────────────────

/// How many rungs an impacted team's record climbs.
///
/// Two: the one that opens it, and exactly one chase. Dispatching once and
/// arming no timer left an impacted primary who slept through their page never
/// chased. The team's full ladder is worse the other way — it walks a second
/// team up to "everybody" for an outage they cannot fix.
pub const IMPACTED_RUNGS: usize = 2;

/// The ladder an impacted record runs: the first [`IMPACTED_RUNGS`] rungs of the
/// team's own policy, in delay order. Taken from the real ladder rather than
/// synthesised, so the chase goes to whoever that team decided should be chased.
pub fn impacted_ladder(steps: &[LadderStep]) -> Vec<LadderStep> {
    let mut ordered = steps.to_vec();
    ordered.sort_by_key(|s| s.after_micros);
    ordered.truncate(IMPACTED_RUNGS);
    ordered
}

// ── Retries and the circuit breaker (03 §9) ──────────────────────────────────

/// Attempts one channel gets before the chain moves on. §9's "max 3 attempts
/// per channel, then move down the fallback chain".
pub const MAX_SEND_ATTEMPTS: u32 = 3;

/// How long to wait before trying the same channel again, or `None` when the
/// channel is spent. §9's 1 s → 2 s → 4 s. Pure and in microseconds so the
/// caller owns the sleep: a decision that sleeps cannot be unit-tested.
pub fn retry_delay_micros(attempts_made: u32) -> Option<i64> {
    if attempts_made == 0 || attempts_made >= MAX_SEND_ATTEMPTS {
        return None;
    }
    Some(1_000_000i64 << (attempts_made - 1))
}

/// The window §9 measures a channel's failure ratio over.
pub const BREAKER_WINDOW_MICROS: i64 = MICROS_PER_MINUTE;
/// How long an open breaker stays open before it admits one probe.
pub const BREAKER_OPEN_MICROS: i64 = MICROS_PER_MINUTE;
/// Attempts needed before a ratio means anything. Two failures out of two is
/// not a hard-down provider, it is a team with one bad address.
pub const BREAKER_MIN_ATTEMPTS: usize = 4;

/// §9's per-channel circuit breaker, as a pure state machine.
///
/// Without it, one hard-down provider stalls every ladder on the node: each
/// rung pays the full retry budget per recipient per channel, and a team of
/// eight discovers the same outage eight times.
///
/// Per-node and in-memory — §9: "a shared breaker needs shared state we do not
/// want to introduce". Being wrong costs one node skipping a channel that has
/// come back, and the half-open probe fixes that within a minute.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelBreaker {
    /// `(at, delivered)` for the attempts still inside the window.
    attempts: Vec<(i64, bool)>,
    /// When it tripped, if it is open.
    opened_at: Option<i64>,
}

impl ChannelBreaker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a send may be attempted now. An open breaker admits exactly one
    /// probe once the cool-down has passed — half-open — because the
    /// alternative is a channel that never recovers until the process restarts.
    pub fn allows(&self, now: i64) -> bool {
        match self.opened_at {
            None => true,
            Some(at) => now - at >= BREAKER_OPEN_MICROS,
        }
    }

    pub fn is_open(&self, now: i64) -> bool {
        !self.allows(now)
    }

    /// Folds one attempt's outcome in.
    pub fn record(&mut self, now: i64, delivered: bool) {
        // A success ends the story: the channel works, so open state and past failures are moot.
        if delivered {
            self.attempts.clear();
            self.opened_at = None;
            return;
        }
        // A failed half-open probe re-opens for a full cool-down, else every rung pays a probe.
        if self.opened_at.is_some() {
            self.opened_at = Some(now);
            self.attempts.clear();
            return;
        }
        self.attempts
            .retain(|(at, _)| now - *at < BREAKER_WINDOW_MICROS);
        self.attempts.push((now, false));
        let failures = self.attempts.iter().filter(|(_, ok)| !ok).count();
        if self.attempts.len() >= BREAKER_MIN_ATTEMPTS && failures * 2 >= self.attempts.len() {
            self.opened_at = Some(now);
        }
    }
}

/// One rung: when it fires, and everyone it pages.
///
/// The delay identifies the rung, so targets that fire together belong to the
/// same rung by construction and a ladder cannot show three consecutive rows
/// all saying "immediately". It also gives the delivery ledger a key that
/// survives reordering and renaming.
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
    /// Alert Destination names this team pages through when a rung includes the
    /// Webhook channel. Reuses the destinations an org already has rather than
    /// storing URLs twice.
    #[serde(default)]
    pub destinations: Vec<String>,
    /// §4's L0 block: how the AI SRE agent relates to this team's paging.
    /// Defaulted on read, because a row written before the column existed has
    /// to behave like a team that never opened the screen.
    #[serde(default = "super::agent::L0Policy::defaults")]
    pub l0: super::agent::L0Policy,
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
    /// The defaults a team is created with, from `00-simplified-flow.md` §2's
    /// severity/channel matrix and §3's escalation timing table.
    ///
    /// | | t=0 | 5 min | 15 min | 30 min |
    /// |---|---|---|---|---|
    /// | P1 | primary **+** secondary | whole team | whole team | — |
    /// | P2 | primary | secondary | whole team | — |
    /// | P3 | primary | — | secondary | whole team |
    /// | P4, P5 | nobody, ever | | | |
    ///
    /// The whole team is told twice at most, and never after 15 minutes. It
    /// used to repeat at 30 and 60 too, so on a twelve-person team one
    /// unacknowledged P1 sent fifty notifications. The fourth ring never
    /// reached anybody the first did not; what it reliably does is teach people
    /// to mute the pager, which costs the next incident.
    ///
    /// P1 is parallel: §2 says "no 5-minute delays between primary and
    /// secondary", and staggering them buys nothing but minutes.
    ///
    /// The secondary is a rotation, not a derivation. Building it from
    /// `NextOnCall` made the position exist whether or not anybody staffed it,
    /// so a team that did staff it had two answers for one chair. `secondary`
    /// is `None` for a team that only has one rotation.
    ///
    /// P4 and P5 page nobody: they are recorded and shown, and the agent still
    /// investigates them.
    ///
    /// Every paging priority defaults to Email. When SMS and voice land, THIS
    /// is the function that changes — the defaults must never promise a channel
    /// that does not send.
    pub fn default_for_team(
        id: impl Into<String>,
        org_id: impl Into<String>,
        team_id: impl Into<String>,
        primary_rotation_id: impl Into<String>,
        secondary_rotation_id: Option<String>,
    ) -> Self {
        use AlertPriority::*;
        let m = MICROS_PER_MINUTE;
        let primary_id = primary_rotation_id.into();
        let primary = || vec![EscalationTarget::rotation(primary_id.clone())];
        // One rotation means no secondary rung; it would resolve to the person already paged.
        let secondary = || {
            secondary_rotation_id
                .as_ref()
                .map(|r| vec![EscalationTarget::rotation(r.clone())])
        };
        let deeper = || vec![EscalationTarget::WholeTeam];
        Self {
            id: id.into(),
            org_id: org_id.into(),
            team_id: team_id.into(),
            destinations: vec![],
            // Ships with every auto-created policy, so nobody configures L0 to benefit from it.
            l0: super::agent::L0Policy::defaults(),
            // One pass, then record that nobody answered; §3 allows more, but only if asked for.
            rungs: vec![
                PriorityRung {
                    priority: P1,
                    steps: vec![
                        // §2: a P1 that waits to wake the backup spends the minutes that mattered.
                        LadderStep::new(
                            0,
                            primary()
                                .into_iter()
                                .chain(secondary().unwrap_or_default())
                                .collect(),
                        ),
                        LadderStep::new(5 * m, deeper()),
                        LadderStep::new(15 * m, deeper()),
                    ],
                    channels: vec![Channel::Email],
                },
                PriorityRung {
                    priority: P2,
                    // One rotation skips this step; filling it would re-page the same person.
                    steps: [
                        Some(LadderStep::new(0, primary())),
                        secondary().map(|s| LadderStep::new(5 * m, s)),
                        Some(LadderStep::new(15 * m, deeper())),
                    ]
                    .into_iter()
                    .flatten()
                    .collect(),
                    channels: vec![Channel::Email],
                },
                PriorityRung {
                    priority: P3,
                    steps: [
                        Some(LadderStep::new(0, primary())),
                        secondary().map(|s| LadderStep::new(15 * m, s)),
                        Some(LadderStep::new(30 * m, deeper())),
                    ]
                    .into_iter()
                    .flatten()
                    .collect(),
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

    /// A ladder that pages the whole team, on the shipped timings.
    ///
    /// For the one caller that needs a policy and cannot know the team's
    /// rotations, because the stored rungs would not parse. Guessing a rotation
    /// id there would name a position that may not exist and page nobody.
    ///
    /// Loud on purpose: a team whose policy failed to read pages everybody,
    /// which somebody notices and fixes, rather than nobody, which nobody
    /// notices until an outage.
    pub fn whole_team_fallback(
        id: impl Into<String>,
        org_id: impl Into<String>,
        team_id: impl Into<String>,
    ) -> Self {
        use AlertPriority::*;
        let m = MICROS_PER_MINUTE;
        let everybody = |delays: &[i64]| PriorityRung {
            priority: P1,
            steps: delays
                .iter()
                .map(|d| LadderStep::new(*d, vec![EscalationTarget::WholeTeam]))
                .collect(),
            channels: vec![Channel::Email],
        };
        Self {
            id: id.into(),
            org_id: org_id.into(),
            team_id: team_id.into(),
            destinations: vec![],
            l0: super::agent::L0Policy::defaults(),
            rungs: vec![
                // Three, not four: with one target they read alike; a repeat is not escalation.
                PriorityRung {
                    priority: P1,
                    ..everybody(&[0, 5 * m, 15 * m])
                },
                PriorityRung {
                    priority: P2,
                    ..everybody(&[0, 15 * m])
                },
                PriorityRung {
                    priority: P3,
                    ..everybody(&[0, 30 * m])
                },
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

    /// How many passes of the ladder this policy runs, bounded. Read through
    /// here rather than off the field: the field can hold anything a replicated
    /// row or a hand-edit put in it, and the engine must not be where a ladder
    /// repeating four thousand times is discovered.
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
/// retries and a promoted severity safe.
pub fn plan(steps: &[LadderStep], elapsed_micros: i64, already_notified: &[i64]) -> LadderAction {
    let mut due: Vec<LadderStep> = Vec::new();
    let mut next: Option<i64> = None;

    for step in steps {
        if step.after_micros <= elapsed_micros {
            if !already_notified.contains(&step.after_micros) {
                due.push(step.clone());
            }
        } else {
            // Steps need not be stored in order: take the minimum, not the first past the cursor.
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

// ── A rung that woke nobody (03 §9) ──────────────────────────────────────────

/// How many times one rung is sent again when every channel errored.
///
/// Four, which with the backoff below is about seven and a half minutes. Long
/// enough to sit out an SMTP restart or a DNS blip, short enough that a
/// provider which is genuinely gone does not hold the ladder still.
pub const MAX_TRANSPORT_ATTEMPTS: u32 = 4;

/// The wait before the first re-send of a rung the transport lost.
///
/// Thirty seconds, not the one second [`retry_delay_micros`] uses: that retries
/// a single send inside a rung, and by the time we are here every channel for
/// every recipient has spent its own budget.
pub const TRANSPORT_BACKOFF_MICROS: i64 = 30 * 1_000_000;

/// The longest this backs off. Beyond four minutes a re-send stops being a
/// retry and starts being a second ladder running at its own pace.
pub const MAX_TRANSPORT_BACKOFF_MICROS: i64 = 4 * MICROS_PER_MINUTE;

/// What one rung's dispatch achieved, as far as the ladder is concerned.
///
/// The distinction §9 does not make and the engine needs: a rung that resolved
/// to nobody and a rung whose real recipients were all lost to the transport
/// are both "nobody was reached", and they want opposite things.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RungOutcome {
    /// At least one person was reached on at least one channel.
    Reached,
    /// The rung's targets resolved to no human at all.
    NoRecipients,
    /// Real recipients, and every channel errored for every one of them.
    DeliveryFailed,
}

/// The ladder's next move once a rung has gone out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AfterRung {
    /// Somebody was woken. Come back when the next rung is due.
    NextRung,
    /// §9: "if every channel for a responder fails, escalation advances to the
    /// next level immediately rather than waiting out the level timeout" —
    /// written about a rung with nobody on it. Waiting five minutes for a name
    /// that will never resolve helps no one.
    AdvanceNow,
    /// Come back at `at` and send this same rung again. It is not spent: the
    /// recipients exist and will be reachable when the transport is. `attempts`
    /// is the count to record, so the next failure backs off further.
    RetryRung { at: i64, attempts: u32 },
    /// The transport has had [`MAX_TRANSPORT_ATTEMPTS`] goes and is not coming
    /// back in time to matter. Give the rung up and let the ladder carry on at
    /// its configured pace, so a dead provider ends at `Exhausted` rather than
    /// looping or collapsing.
    GiveUpRung,
}

/// How long to wait before sending a lost rung again: 30 s → 1 m → 2 m → 4 m.
/// Doubling, because the fourth failure means something the first did not — the
/// first is a blip, the fourth is an outage.
fn transport_backoff_micros(attempts_made: u32) -> i64 {
    TRANSPORT_BACKOFF_MICROS
        .saturating_mul(1i64 << attempts_made.min(16))
        .min(MAX_TRANSPORT_BACKOFF_MICROS)
}

/// What the ladder does next, from what the rung achieved and how many times
/// the transport has already lost it.
///
/// Only [`RungOutcome::NoRecipients`] consumes the ladder without pausing.
/// Applying §9's "advance immediately" to a transport failure too is what let
/// thirty seconds of SMTP retire a P1: every rung read as sent, `elapsed`
/// walked forward inside one tick, and the record wrote its own "nobody
/// acknowledged" eleven seconds after it opened.
pub fn after_rung(outcome: RungOutcome, attempts_made: u32, now: i64) -> AfterRung {
    match outcome {
        RungOutcome::Reached => AfterRung::NextRung,
        RungOutcome::NoRecipients => AfterRung::AdvanceNow,
        RungOutcome::DeliveryFailed if attempts_made >= MAX_TRANSPORT_ATTEMPTS => {
            AfterRung::GiveUpRung
        }
        RungOutcome::DeliveryFailed => AfterRung::RetryRung {
            at: now + transport_backoff_micros(attempts_made),
            attempts: attempts_made + 1,
        },
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
    use super::{super::rotation::MICROS_PER_HOUR, *};

    const MIN: i64 = MICROS_PER_MINUTE;

    fn policy() -> EscalationPolicy {
        EscalationPolicy::default_for_team(
            "pol_1",
            "default",
            "team_1",
            "rot_primary",
            Some("rot_secondary".into()),
        )
    }

    fn steps(priority: AlertPriority) -> Vec<LadderStep> {
        policy().rung(priority).unwrap().steps.clone()
    }

    #[test]
    fn test_channel_storage_ids_are_pinned() {
        let all = [(Channel::Email, 1), (Channel::Webhook, 7)];
        for (c, want) in all {
            assert_eq!(c.to_i32(), want, "{c} moved");
            assert_eq!(Channel::from_i32(want), Some(c));
        }
        assert_eq!(Channel::from_i32(0), None);
        assert_eq!(Channel::from_i32(8), None);
        assert_eq!(Channel::Webhook.to_i32(), 7);
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
        let action = plan(&steps(AlertPriority::P2), 0, &[]);
        assert_eq!(
            targets_of(&action),
            vec![EscalationTarget::rotation("rot_primary")]
        );

        let later = plan(&steps(AlertPriority::P2), 5 * MIN, &[0]);
        assert_eq!(
            targets_of(&later),
            vec![EscalationTarget::rotation("rot_secondary")]
        );

        // The whole team, once: the same twelve phones at 30 and 60 minutes reach nobody new.
        let l1 = plan(&steps(AlertPriority::P2), 15 * MIN, &[0, 5 * MIN]);
        assert_eq!(targets_of(&l1), vec![EscalationTarget::WholeTeam]);

        assert!(
            matches!(
                plan(&steps(AlertPriority::P2), 30 * MIN, &[0, 5 * MIN, 15 * MIN]),
                LadderAction::Exhausted
            ),
            "nothing is left after the whole team has been told"
        );
    }

    /// The shipped defaults ARE the design's tables — §2 (who is paged, and
    /// that P1 is parallel) and §3 (when the ladder escalates). They drifted
    /// once: P2's secondary sat at 15 minutes instead of 5 and P3 never
    /// escalated, so a team that never opened the screen got a quieter pager
    /// than the product promised. Every cell is pinned here.
    #[test]
    #[allow(clippy::type_complexity)]
    fn test_default_ladders_match_the_published_timing_table() {
        let expected: &[(AlertPriority, &[(i64, &[EscalationTarget])])] = &[
            (
                AlertPriority::P1,
                &[
                    // §2: primary + secondary + L1, in parallel, at t=0.
                    (
                        0,
                        &[
                            EscalationTarget::rotation("rot_primary"),
                            EscalationTarget::rotation("rot_secondary"),
                        ],
                    ),
                    (5 * MIN, &[EscalationTarget::WholeTeam]),
                    (15 * MIN, &[EscalationTarget::WholeTeam]),
                ],
            ),
            (
                AlertPriority::P2,
                &[
                    (0, &[EscalationTarget::rotation("rot_primary")]),
                    (5 * MIN, &[EscalationTarget::rotation("rot_secondary")]),
                    (15 * MIN, &[EscalationTarget::WholeTeam]),
                ],
            ),
            (
                AlertPriority::P3,
                &[
                    (0, &[EscalationTarget::rotation("rot_primary")]),
                    (15 * MIN, &[EscalationTarget::rotation("rot_secondary")]),
                    (30 * MIN, &[EscalationTarget::WholeTeam]),
                ],
            ),
            (AlertPriority::P4, &[]),
            (AlertPriority::P5, &[]),
        ];

        let p = policy();
        assert_eq!(
            p.rungs.len(),
            expected.len(),
            "every priority is configured explicitly, and only once"
        );
        for (priority, rows) in expected {
            let rung = p
                .rung(*priority)
                .unwrap_or_else(|| panic!("{priority} missing"));
            let got: Vec<(i64, Vec<EscalationTarget>)> = rung
                .steps
                .iter()
                .map(|s| (s.after_micros, s.targets.clone()))
                .collect();
            let want: Vec<(i64, Vec<EscalationTarget>)> = rows
                .iter()
                .map(|(at, targets)| (*at, targets.to_vec()))
                .collect();
            assert_eq!(got, want, "{priority} does not match the design's table");
        }
    }

    /// §2: "for P1, everyone gets notified simultaneously — no 5-minute delays
    /// between primary and secondary." One rung, three targets, delay zero.
    #[test]
    fn test_p1_pages_primary_secondary_and_l1_together_at_t0() {
        let action = plan(&steps(AlertPriority::P1), 0, &[]);
        match &action {
            LadderAction::Notify { due, .. } => {
                assert_eq!(due.len(), 1, "one rung, not three staggered ones");
                assert_eq!(due[0].after_micros, 0);
            }
            other => panic!("P1 must page immediately, got {other:?}"),
        }
        assert_eq!(
            targets_of(&action),
            vec![
                EscalationTarget::rotation("rot_primary"),
                EscalationTarget::rotation("rot_secondary"),
            ]
        );
    }

    /// §7.4: five variants, and a catch-all arm that pages on an unexpected one
    /// is the failure mode. Every priority is listed by name, and the two that
    /// must never page have no steps at any elapsed time.
    #[test]
    fn test_every_priority_is_configured_by_name_and_p4_p5_never_page() {
        let p = policy();
        let all = [
            AlertPriority::P1,
            AlertPriority::P2,
            AlertPriority::P3,
            AlertPriority::P4,
            AlertPriority::P5,
        ];
        assert_eq!(
            p.rungs.len(),
            all.len(),
            "no priority may fall to a default"
        );
        for pr in all {
            assert!(p.rung(pr).is_some(), "{pr} is not configured");
        }
        for pr in [AlertPriority::P4, AlertPriority::P5] {
            assert!(
                p.rung(pr).unwrap().steps.is_empty(),
                "{pr} must page nobody"
            );
            assert!(!p.pages_anyone(pr));
            for elapsed in [0, 60 * MIN, 24 * MICROS_PER_HOUR] {
                assert_eq!(
                    plan(&steps(pr), elapsed, &[]),
                    LadderAction::Exhausted,
                    "{pr} paged somebody at {elapsed}us"
                );
            }
        }
    }

    /// The alert and incident paths used to default an unset priority
    /// differently — P3 and P2 — so toggling `creates_incident` changed how
    /// loudly the same alert paged. One constant, and it is the louder one.
    #[test]
    fn test_the_default_paging_priority_is_the_safer_of_the_two() {
        assert_eq!(DEFAULT_PAGING_PRIORITY, AlertPriority::P2);
        assert!(
            DEFAULT_PAGING_PRIORITY.to_i32() < AlertPriority::P3.to_i32(),
            "lower integer is more urgent; the default must not be the quieter one"
        );
        assert!(
            policy().pages_anyone(DEFAULT_PAGING_PRIORITY),
            "a signal with no priority still has to reach a human"
        );
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
        let s = steps(AlertPriority::P3);
        let mut notified: Vec<i64> = vec![];
        let mut fired: Vec<(i64, EscalationTarget)> = vec![];

        for elapsed in [0, 15 * MIN, 30 * MIN, 60 * MIN] {
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
                (0, EscalationTarget::rotation("rot_primary")),
                (15 * MIN, EscalationTarget::rotation("rot_secondary")),
                (30 * MIN, EscalationTarget::WholeTeam),
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
        // Ten minutes in: the first two rungs were missed, the third is still ahead — a catch-up.
        match plan(&s, 10 * MIN, &[]) {
            LadderAction::Notify {
                due,
                next_wakeup_micros,
            } => {
                assert_eq!(
                    due.iter().map(|s| s.after_micros).collect::<Vec<_>>(),
                    vec![0, 5 * MIN]
                );
                assert_eq!(
                    next_wakeup_micros,
                    Some(15 * MIN),
                    "the last rung is still ahead"
                );
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
            LadderStep::new(0, vec![EscalationTarget::rotation("rot_primary")]),
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
            LadderStep::new(0, vec![EscalationTarget::rotation("rot_primary")]),
            LadderStep::new(5 * MIN, vec![EscalationTarget::rotation("rot_secondary")]),
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
            LadderStep::new(5 * MIN, vec![EscalationTarget::rotation("rot_secondary")]),
            LadderStep::new(15 * MIN, vec![EscalationTarget::everyone_in("rot_primary")]),
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

    /// The vocabulary holds only channels something can send. A variant added
    /// without a transport behind it stores a promise the engine silently drops
    /// — the worst failure mode a pager has.
    #[test]
    fn test_every_channel_in_the_vocabulary_can_be_delivered() {
        assert_eq!(
            Channel::deliverable(),
            vec![Channel::Email, Channel::Webhook]
        );
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

    // ── The fallback chain (03 §6/§9) ───────────────────────────────────────

    /// §9: the chain is evaluated in order and stops at the first success, so
    /// the order is the whole decision. Email before webhook, because the person
    /// is the target and the team channel is the fallback.
    #[test]
    fn test_the_chain_is_ordered_and_only_holds_channels_that_send() {
        assert_eq!(
            fallback_chain(&[Channel::Webhook, Channel::Email]),
            vec![Channel::Email, Channel::Webhook],
            "the policy's storage order must not decide who is tried first"
        );
        assert!(fallback_chain(&[]).is_empty());
    }

    /// §6's baseline: "on a single-node deployment with just SMTP configured,
    /// the chain collapses to email and everything still works".
    #[test]
    fn test_the_chain_collapses_to_email_on_an_smtp_only_deployment() {
        assert_eq!(fallback_chain(&[Channel::Email]), vec![Channel::Email]);
    }

    /// The order is the whole decision, so it is pinned rather than left to
    /// whatever order the variants happen to be declared in.
    #[test]
    fn test_the_published_order_is_the_one_the_design_names() {
        assert_eq!(FALLBACK_ORDER, [Channel::Email, Channel::Webhook]);
    }

    // ── Retries and the breaker (03 §9) ─────────────────────────────────────

    /// §9's 1 s → 2 s → 4 s, bounded at three attempts. The bound matters more
    /// than the curve: an unbounded retry inside a rung holds the lane.
    #[test]
    fn test_retries_back_off_and_then_give_up() {
        assert_eq!(retry_delay_micros(1), Some(1_000_000));
        assert_eq!(retry_delay_micros(2), Some(2_000_000));
        assert_eq!(
            retry_delay_micros(3),
            None,
            "three attempts, then the chain moves on"
        );
        assert_eq!(retry_delay_micros(9), None);
        // Nothing has failed yet, so there is nothing to wait for.
        assert_eq!(retry_delay_micros(0), None);
    }

    /// A handful of failures is a bad address, not a hard-down provider. The
    /// breaker must not open on the first thing that goes wrong, or one team
    /// with a typo silences a channel for everybody on the node.
    #[test]
    fn test_the_breaker_needs_evidence_before_it_opens() {
        let mut b = ChannelBreaker::new();
        for i in 0..(BREAKER_MIN_ATTEMPTS as i64 - 1) {
            b.record(i, false);
            assert!(b.allows(i), "opened after {} failures", i + 1);
        }
        b.record(BREAKER_MIN_ATTEMPTS as i64, false);
        assert!(
            b.is_open(BREAKER_MIN_ATTEMPTS as i64),
            "a channel failing every attempt has to stop being tried"
        );
    }

    /// Half-open: one probe once the cool-down has passed. Without it a
    /// channel never comes back until the process restarts.
    #[test]
    fn test_an_open_breaker_admits_one_probe_and_a_success_closes_it() {
        let mut b = ChannelBreaker::new();
        for i in 0..BREAKER_MIN_ATTEMPTS as i64 {
            b.record(i, false);
        }
        let opened = BREAKER_MIN_ATTEMPTS as i64 - 1;
        assert!(!b.allows(opened + BREAKER_OPEN_MICROS - 1));
        assert!(b.allows(opened + BREAKER_OPEN_MICROS), "half-open probe");

        // The probe fails: another full cool-down, not a probe per rung.
        let probe = opened + BREAKER_OPEN_MICROS;
        b.record(probe, false);
        assert!(!b.allows(probe + 1));
        assert!(b.allows(probe + BREAKER_OPEN_MICROS));

        // And a success is the end of it.
        b.record(probe + BREAKER_OPEN_MICROS, true);
        assert!(b.allows(probe + BREAKER_OPEN_MICROS));
        assert_eq!(
            b,
            ChannelBreaker::new(),
            "a working channel carries no history"
        );
    }

    /// The ratio is measured over a window, so failures spread across an hour
    /// never add up to an outage.
    #[test]
    fn test_failures_outside_the_window_do_not_count() {
        let mut b = ChannelBreaker::new();
        for i in 0..10 {
            let at = i * BREAKER_WINDOW_MICROS * 2;
            b.record(at, false);
            assert!(
                b.allows(at),
                "an hourly failure is not a hard-down provider"
            );
        }
    }

    /// The engine's loop with dispatching replaced by a fixed outcome: which
    /// rungs one tick consumes, and what it leaves the ladder doing.
    ///
    /// Spelled out here because "how much of the ladder does one tick eat" is
    /// the whole of G2, and it is a property of [`plan`] and [`after_rung`]
    /// together.
    fn one_tick(
        steps: &[LadderStep],
        already_sent: &[i64],
        outcome: RungOutcome,
        attempts_made: u32,
        now: i64,
    ) -> (Vec<i64>, Option<AfterRung>) {
        let mut notified = already_sent.to_vec();
        let mut this_tick: Vec<i64> = Vec::new();
        let mut elapsed = 0;
        loop {
            match plan(steps, elapsed, &notified) {
                LadderAction::Exhausted | LadderAction::Wait { .. } => return (this_tick, None),
                LadderAction::Notify {
                    due,
                    next_wakeup_micros,
                } => {
                    for step in &due {
                        this_tick.push(step.after_micros);
                        notified.push(step.after_micros);
                    }
                    match after_rung(outcome, attempts_made, now) {
                        // The one move that keeps walking inside the same tick.
                        AfterRung::AdvanceNow => elapsed = next_wakeup_micros.unwrap_or(elapsed),
                        other => return (this_tick, Some(other)),
                    }
                }
            }
        }
    }

    /// A rung that resolved to nobody must not burn its delay in silence:
    /// nobody will appear in five minutes, so the ladder tries the next level
    /// now, and a ladder of them runs out inside one tick. §9 wrote "advance
    /// immediately" about this.
    #[test]
    fn test_a_rung_that_reached_nobody_still_advances_inside_the_tick() {
        let p1 = steps(AlertPriority::P1);
        let (sent, ended) = one_tick(&p1, &[], RungOutcome::NoRecipients, 0, 1_000);
        assert_eq!(
            sent,
            vec![0, 5 * MIN, 15 * MIN],
            "a ladder that resolves to nobody at every level is finished, and waiting to say so helps no one"
        );
        assert_eq!(ended, None, "and the ladder is spent");
    }

    /// G2. The same ladder and the same "nobody was reached" — except the
    /// people were there and SMTP was not. One tick must consume one rung, not
    /// the ladder: thirty seconds of a dead transport used to exhaust a
    /// five-rung P1 in eleven milliseconds and delete its timer.
    #[test]
    fn test_a_transport_failure_consumes_one_rung_not_the_ladder() {
        let p1 = steps(AlertPriority::P1);
        let now = 1_000_000;
        let (sent, ended) = one_tick(&p1, &[], RungOutcome::DeliveryFailed, 0, now);
        assert_eq!(sent, vec![0], "only the rung that was actually tried");
        assert_eq!(
            ended,
            Some(AfterRung::RetryRung {
                at: now + TRANSPORT_BACKOFF_MICROS,
                attempts: 1,
            }),
            "and the tick ends on a short backoff rather than on the next level"
        );
    }

    /// The other half of G2: the rung is not consumed either, so when mail comes
    /// back the people who should have been woken still are. This is what the
    /// engine relies on when it drops an unreached rung from the ledger before
    /// re-planning.
    #[test]
    fn test_the_lost_rung_is_still_pageable_when_the_transport_returns() {
        let p1 = steps(AlertPriority::P1);
        // The rung the transport lost was attempted, not sent, so the timeline plans without it.
        let timeline = vec![0];
        let unreached = [0];
        let ledger: Vec<i64> = timeline
            .iter()
            .copied()
            .filter(|r| !unreached.contains(r))
            .collect();

        assert_eq!(
            one_tick(&p1, &timeline, RungOutcome::Reached, 0, 2_000),
            (vec![], None),
            "counting it as sent is what leaves the primary on-call never woken"
        );
        assert_eq!(
            one_tick(&p1, &ledger, RungOutcome::Reached, 0, 2_000),
            (vec![0], Some(AfterRung::NextRung)),
            "so the retry sends that same rung, and the ladder then resumes at its own pace"
        );
    }

    /// It has to end. Four attempts of a doubling backoff is about seven and a
    /// half minutes; after that the rung is given up and the ladder carries on
    /// at its configured pace, on to `Exhausted`. A dead provider must land
    /// somewhere honest, not loop.
    #[test]
    fn test_a_dead_transport_gives_the_rung_up_rather_than_retrying_forever() {
        let now = 5_000;
        let mut at = now;
        for attempt in 0..MAX_TRANSPORT_ATTEMPTS {
            match after_rung(RungOutcome::DeliveryFailed, attempt, at) {
                AfterRung::RetryRung { at: next, attempts } => {
                    assert_eq!(attempts, attempt + 1);
                    assert!(next > at, "each attempt is later than the last");
                    at = next;
                }
                other => panic!("attempt {attempt} gave up early: {other:?}"),
            }
        }
        assert!(
            at - now <= 10 * MICROS_PER_MINUTE,
            "the whole budget is minutes, not hours: {}us",
            at - now
        );
        assert_eq!(
            after_rung(RungOutcome::DeliveryFailed, MAX_TRANSPORT_ATTEMPTS, at),
            AfterRung::GiveUpRung
        );

        // And giving up still costs the ladder exactly one rung per tick.
        let p1 = steps(AlertPriority::P1);
        let (sent, ended) = one_tick(
            &p1,
            &[],
            RungOutcome::DeliveryFailed,
            MAX_TRANSPORT_ATTEMPTS,
            at,
        );
        assert_eq!(sent, vec![0]);
        assert_eq!(ended, Some(AfterRung::GiveUpRung));
    }

    /// 30 s → 1 m → 2 m → 4 m, and no further. The doubling is the point, and
    /// the cap is what stops a retry becoming a second ladder.
    #[test]
    fn test_the_backoff_doubles_and_is_capped() {
        let waits: Vec<i64> = (0..6).map(transport_backoff_micros).collect();
        assert_eq!(
            waits,
            vec![
                30 * 1_000_000,
                MICROS_PER_MINUTE,
                2 * MICROS_PER_MINUTE,
                MAX_TRANSPORT_BACKOFF_MICROS,
                MAX_TRANSPORT_BACKOFF_MICROS,
                MAX_TRANSPORT_BACKOFF_MICROS,
            ]
        );
        // A replicated attempt count can be anything; an overflowing backoff pages in the past.
        assert_eq!(
            transport_backoff_micros(u32::MAX),
            MAX_TRANSPORT_BACKOFF_MICROS
        );
    }

    /// A rung somebody was woken on never retries, whatever the transport did to
    /// the other recipients. The page landed; the ladder's job is done until the
    /// next level is due.
    #[test]
    fn test_a_rung_that_woke_somebody_never_retries() {
        for attempts in [0, 1, MAX_TRANSPORT_ATTEMPTS, u32::MAX] {
            assert_eq!(
                after_rung(RungOutcome::Reached, attempts, 7),
                AfterRung::NextRung
            );
        }
    }

    // ── Broadcast beside the chain (G8) ─────────────────────────────────────

    /// The bug, stated: a team that ticks email **and** chat wants both, and
    /// the fallback chain gave them chat only when email failed.
    #[test]
    fn test_chat_fires_alongside_email_rather_than_only_on_its_failure() {
        let plan = channel_plan(&[Channel::Email, Channel::Webhook]);
        assert_eq!(
            plan.chain,
            vec![Channel::Email],
            "the person is reached once"
        );
        assert_eq!(
            plan.broadcast,
            vec![Channel::Webhook],
            "and the room is posted to regardless of what the chain did"
        );
        assert!(!plan.is_empty());
    }

    /// The half that was built deliberately and must not be lost: reaching one
    /// person is still a chain, in fallback order, stopping at the first
    /// success.
    #[test]
    fn test_a_person_reaching_chain_keeps_its_order_and_its_membership() {
        let plan = channel_plan(&[Channel::Webhook, Channel::Email]);
        assert_eq!(
            plan.chain,
            vec![Channel::Email],
            "only the person-reaching channels, in FALLBACK_ORDER"
        );
        assert!(
            plan.chain.iter().all(|c| !is_broadcast(*c)),
            "a room is not a link in a chain that asks whether a human answered"
        );
        assert_eq!(plan.broadcast, vec![Channel::Webhook]);
    }

    /// A room is addressed by the rung, a person by their address. Getting this
    /// backwards is how six people on one rung became six identical posts.
    #[test]
    fn test_only_the_room_channels_are_broadcasts() {
        assert!(is_broadcast(Channel::Webhook));
        assert!(!is_broadcast(Channel::Email), "email reaches one person");
    }

    /// A rung that pages nobody must not look like it had a plan.
    #[test]
    fn test_a_rung_with_no_channels_plans_nothing() {
        assert!(channel_plan(&[]).is_empty());
    }

    // ── Fanning one firing out to several teams (07 I-D2) ───────────────────

    /// A responder has to tell their team's own page from part of something
    /// wider, and to know their team's other broken groups are on this record
    /// rather than one nobody opened.
    #[test]
    fn test_the_fanout_note_says_whose_page_this_is_and_how_wide_it_is() {
        let alone = fanout_note("k8s-namespace=payments", &[], 0);
        assert_eq!(alone, "paged for k8s-namespace=payments");

        let wider = fanout_note("k8s-namespace=payments", &[], 2);
        assert!(wider.contains("2 other team(s)"));

        let mine = fanout_note(
            "k8s-namespace=payments",
            &["k8s-namespace=billing".to_string()],
            1,
        );
        assert!(mine.contains("k8s-namespace=billing"));
        assert!(mine.contains("one page"), "{mine}");
        assert!(mine.contains("1 other team(s)"));
    }

    /// A `GROUP BY` has no bound and a timeline entry does, so a team owning
    /// fifty broken groups gets a line somebody can read rather than fifty
    /// paths.
    #[test]
    fn test_the_fanout_note_stops_counting_groups() {
        let many: Vec<String> = (0..50).map(|i| format!("k8s-namespace=ns{i}")).collect();
        let note = fanout_note("k8s-namespace=payments", &many, 0);
        assert!(note.contains("and 45 more"), "{note}");
        assert!(note.contains("k8s-namespace=ns4"));
        assert!(!note.contains("k8s-namespace=ns6"), "{note}");
    }

    /// Fifteen teams is somebody's alert definition, not fifteen outages. The
    /// note has to say so, because the fix is to the grouping and nobody finds
    /// that from a page that simply arrived.
    #[test]
    fn test_the_capped_note_blames_the_grouping_not_the_estate() {
        let note = fanout_capped_note(15);
        assert!(note.contains("15 teams"));
        assert!(note.contains("grouping"));
        // A cap outside this range is either useless or is itself the noise.
        const { assert!(MAX_FANOUT_TEAMS > 1 && MAX_FANOUT_TEAMS < 10) };
    }

    // ── Where the team's channel lives (Change 1) ───────────────────────────

    /// A policy stored before the team-level field existed keeps working. That
    /// is the whole of the back-compatibility promise.
    #[test]
    fn test_a_team_that_never_set_a_channel_falls_back_to_its_policy() {
        let policy = vec!["slack-platform".to_string()];
        assert_eq!(team_channel(None, &policy), policy.as_slice());
    }

    /// Set on the team, the team wins — that is the point of moving it, so a
    /// channel can be changed without opening the escalation editor.
    #[test]
    fn test_the_team_field_outranks_the_policy_list() {
        let policy = vec!["slack-old".to_string()];
        let team = vec!["slack-new".to_string()];
        assert_eq!(team_channel(Some(&team), &policy), team.as_slice());
    }

    /// The case that decides whether the field can be turned off at all. An
    /// empty team list means "no channel"; falling back here would resurrect a
    /// destination somebody had just removed.
    #[test]
    fn test_clearing_the_team_channel_does_not_resurrect_the_policy_list() {
        let policy = vec!["slack-old".to_string()];
        assert!(team_channel(Some(&[]), &policy).is_empty());
    }

    // ── One chase for an impacted team (D-21) ───────────────────────────────

    /// Exactly one rung after the one that opened the record: an impacted
    /// primary who never answers is chased once, and never walked up somebody
    /// else's ladder.
    #[test]
    fn test_an_impacted_record_climbs_its_first_rung_and_exactly_one_more() {
        let m = MICROS_PER_MINUTE;
        let full = vec![
            LadderStep::new(0, vec![EscalationTarget::rotation("rot_primary")]),
            LadderStep::new(5 * m, vec![EscalationTarget::rotation("rot_secondary")]),
            LadderStep::new(15 * m, vec![EscalationTarget::everyone_in("rot_primary")]),
            LadderStep::new(30 * m, vec![EscalationTarget::WholeTeam]),
        ];
        let cut = impacted_ladder(&full);

        assert_eq!(cut.len(), IMPACTED_RUNGS);
        assert_eq!(cut[0].after_micros, 0);
        assert_eq!(
            cut[1].after_micros,
            5 * m,
            "one chase, at the team's own delay"
        );
        assert!(
            !cut.iter()
                .any(|s| s.targets.contains(&EscalationTarget::WholeTeam)),
            "an impacted team is never walked up to everybody"
        );
    }

    /// Steps are not required to be stored in delay order, and truncating an
    /// unsorted list would pick an arbitrary chase.
    #[test]
    fn test_the_chase_is_the_soonest_rung_not_the_next_one_stored() {
        let m = MICROS_PER_MINUTE;
        let jumbled = vec![
            LadderStep::new(30 * m, vec![EscalationTarget::WholeTeam]),
            LadderStep::new(0, vec![EscalationTarget::rotation("rot_primary")]),
            LadderStep::new(5 * m, vec![EscalationTarget::rotation("rot_secondary")]),
        ];
        let cut = impacted_ladder(&jumbled);
        assert_eq!(
            cut.iter().map(|s| s.after_micros).collect::<Vec<_>>(),
            vec![0, 5 * m]
        );
    }

    /// A team whose ladder has only one rung gets one rung. Inventing a second
    /// would page somebody their own policy never names.
    #[test]
    fn test_a_one_rung_policy_gives_an_impacted_team_one_rung() {
        let one = vec![LadderStep::new(
            0,
            vec![EscalationTarget::rotation("rot_primary")],
        )];
        assert_eq!(impacted_ladder(&one).len(), 1);
        assert!(impacted_ladder(&[]).is_empty());
    }
}
