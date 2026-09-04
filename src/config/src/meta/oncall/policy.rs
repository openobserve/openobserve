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

//! Escalation policy — a team's ladder and its channels.
//!
//! A policy belongs to a team, not to the org: two teams disagreeing about
//! whether P3 should ring a phone is normal, and the disagreement should not
//! require a global setting.
//!
//! Everything here ships as an **editable default**. The point of the
//! defaults is that a newly created team is pageable immediately without
//! anyone designing a policy first; the point of them being editable is that
//! nothing in this file is a rule the product enforces on a team.
//!
//! [`plan`] is the whole decision: given a ladder, how long the record has
//! been open, and who has already been notified, it returns who to notify now
//! and when to wake up next. No clock, no I/O.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    rotation::MICROS_PER_MINUTE,
    target::{EscalationTarget, TargetError},
};
use crate::meta::alerts::priority::AlertPriority;

/// How loudly a signal pages when nobody said how loudly it should.
///
/// Every producer — the alert scheduler, the incident correlator, anything
/// added later — reads this rather than picking its own default. They used to
/// disagree: the alert path defaulted to P3 and the incident path to P2, so
/// ticking `creates_incident` on an alert silently changed how loudly it woke
/// somebody, with nothing in the UI saying so.
///
/// P2 is the safer of the two. An unset priority means "nobody has decided
/// yet", and the cost of the two mistakes is not symmetric: paging a little
/// too loudly wastes a person's attention for a few minutes, while paging too
/// quietly means a real outage waits for the ladder that P3 walks half an hour
/// more slowly. A team that finds P2 too loud sets the priority on the alert,
/// which is one field.
pub const DEFAULT_PAGING_PRIORITY: AlertPriority = AlertPriority::P2;

/// How a page reaches a person.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    Email,
    Sms,
    Voice,
    /// Slack, Teams, Google Chat — the team's chat destination.
    Chat,
    /// An existing alert Destination — Slack, Teams, or any HTTP endpoint.
    Webhook,
    /// Mobile push.
    Push,
    /// Shown in the product, never delivered anywhere.
    InApp,
}

impl Channel {
    /// Durable storage id. **Never reorder or reuse.**
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Email => 1,
            Self::Sms => 2,
            Self::Voice => 3,
            Self::Chat => 4,
            Self::Push => 5,
            Self::InApp => 6,
            Self::Webhook => 7,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Email),
            2 => Some(Self::Sms),
            3 => Some(Self::Voice),
            4 => Some(Self::Chat),
            5 => Some(Self::Push),
            6 => Some(Self::InApp),
            7 => Some(Self::Webhook),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Sms => "sms",
            Self::Voice => "voice",
            Self::Chat => "chat",
            Self::Push => "push",
            Self::InApp => "in_app",
            Self::Webhook => "webhook",
        }
    }

    /// Channels that interrupt a sleeping person. Used to decide what a
    /// follow-up update may NOT re-fire: urgent channels are reserved for
    /// "a human is needed", not "news arrived".
    pub fn is_interrupting(&self) -> bool {
        matches!(self, Self::Voice | Self::Sms | Self::Push)
    }

    /// Whether a `Notifier` can actually deliver this channel today.
    ///
    /// The enum carries every channel the design calls for so the stored shape
    /// does not change when providers land, but only Email has an
    /// implementation. Offering the rest in the UI, or shipping them as
    /// defaults, would store a promise that silently delivers nothing — the
    /// worst possible failure for a paging system.
    pub fn is_deliverable(&self) -> bool {
        matches!(self, Self::Email | Self::Webhook)
    }

    /// Every channel a page can actually reach a person on today.
    pub fn deliverable() -> Vec<Self> {
        [
            Self::Email,
            Self::Webhook,
            Self::Sms,
            Self::Voice,
            Self::Chat,
            Self::Push,
            Self::InApp,
        ]
        .into_iter()
        .filter(Self::is_deliverable)
        .collect()
    }
}

/// 03 §6's fallback chain, in the order it is evaluated.
///
/// Most interrupting first, because the chain stops at the first success and
/// the point of a page is to reach somebody now: trying email before a phone
/// call would "succeed" into an inbox nobody is reading at 3am.
///
/// The undeliverable half of the list is carried so the order does not have to
/// be redesigned when a provider lands; [`fallback_chain`] filters it out.
pub const FALLBACK_ORDER: [Channel; 7] = [
    Channel::Push,
    Channel::Sms,
    Channel::Voice,
    Channel::Email,
    Channel::Webhook,
    Channel::Chat,
    Channel::InApp,
];

/// The channels one responder is tried on, in order, for a rung.
///
/// Deduplicated and restricted to what a `Notifier` can actually send, so a
/// policy that names SMS today does not put an unreachable rung at the head of
/// the chain and make every page look like it was attempted.
///
/// §6, verbatim: "On a single-node deployment with just SMTP configured, the
/// chain collapses to email and everything still works" — that is the baseline,
/// not a degenerate case.
pub fn fallback_chain(channels: &[Channel]) -> Vec<Channel> {
    FALLBACK_ORDER
        .into_iter()
        .filter(|c| c.is_deliverable() && channels.contains(c))
        .collect()
}

/// Whether a channel talks to a **room** rather than to a person (G8).
///
/// The fallback chain was designed around one question — "have we reached this
/// human yet" — and stopping at the first success is exactly right for it. It
/// is the wrong question for a team's chat room: a team that ticks email *and*
/// chat means "wake the on-call, and put it in the channel", and the chain read
/// that as "put it in the channel only if the email bounced". `Also post to
/// chat` was not expressible at all, and it is the common case.
///
/// So the two kinds are separated by what they address, not by how loud they
/// are. Chat and Webhook both resolve to a destination the whole team watches;
/// everything else resolves to one person's inbox, handset or screen.
pub fn is_broadcast(channel: Channel) -> bool {
    match channel {
        Channel::Chat | Channel::Webhook => true,
        Channel::Email | Channel::Sms | Channel::Voice | Channel::Push | Channel::InApp => false,
    }
}

/// How one rung's channel set splits into "try until somebody answers" and
/// "always post".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelPlan {
    /// Tried **per recipient**, in [`FALLBACK_ORDER`], stopping at the first
    /// success. Unchanged semantics — this is the chain that was built
    /// deliberately for reaching a person.
    pub chain: Vec<Channel>,
    /// Sent **once per rung**, whatever the chain did.
    ///
    /// Once per rung and not once per recipient, which is the whole difference
    /// between this and the bug that made the chain necessary: a rung fanning
    /// out to six people used to post six identical messages into one room.
    pub broadcast: Vec<Channel>,
}

impl ChannelPlan {
    /// Whether this rung can reach anybody at all.
    pub fn is_empty(&self) -> bool {
        self.chain.is_empty() && self.broadcast.is_empty()
    }
}

/// Split a rung's channels into the person-reaching chain and the broadcasts.
///
/// Both halves are filtered to what a `Notifier` can actually send, for the
/// same reason [`fallback_chain`] is: a channel nothing can deliver makes a
/// rung look attempted when nothing left the process.
pub fn channel_plan(channels: &[Channel]) -> ChannelPlan {
    ChannelPlan {
        chain: fallback_chain(channels)
            .into_iter()
            .filter(|c| !is_broadcast(*c))
            .collect(),
        broadcast: FALLBACK_ORDER
            .into_iter()
            .filter(|c| c.is_deliverable() && is_broadcast(*c) && channels.contains(c))
            .collect(),
    }
}

// ── Where a team's channel lives (Change 1) ──────────────────────────────────

/// The destinations a team's own channel posts go to, and what a page's
/// `Webhook` channel resolves to.
///
/// The list used to live only on [`EscalationPolicy::destinations`]. There is
/// one policy per team, so in practice it was already team-scoped — but a
/// team's chat room is not a property of its **ladder**, and having to open the
/// escalation editor to change where the team is talked to is how a channel
/// ends up pointing at a room nobody reads. The team-level field is the one you
/// can set without ever touching a rung.
///
/// Precedence, deliberately explicit:
///
/// - `None` — the team has never set one. The policy's list is used, so every policy stored before
///   the field existed keeps working exactly as it did.
/// - `Some(list)` — the team's list wins, **including when it is empty**. An empty list is somebody
///   saying "this team has no channel"; falling back to the policy there would make the field
///   impossible to turn off, and would silently resurrect a destination they had removed.
pub fn team_channel<'a>(team: Option<&'a [String]>, policy: &'a [String]) -> &'a [String] {
    match team {
        Some(list) => list,
        None => policy,
    }
}

// ── The liaison seat (D-21) ──────────────────────────────────────────────────

/// How many rungs an **impacted** team's record climbs.
///
/// Two: the one that opens it, and exactly one chase. `page_impacted` used to
/// dispatch once and arm no timer at all, so an impacted primary who slept
/// through their page was never chased and the record sat open with nobody on
/// it. The other extreme — the team's full ladder — is worse in a different
/// way: it walks a whole second team up to "everybody" for an outage they
/// cannot fix. One chase is a liaison seat, not a fix-it seat.
pub const IMPACTED_RUNGS: usize = 2;

/// The ladder an impacted record actually runs: the first [`IMPACTED_RUNGS`]
/// rungs of the team's own policy, in delay order.
///
/// Taken from the team's real ladder rather than synthesised, so the chase goes
/// to whoever that team decided should be chased — usually their secondary —
/// at the delay they chose.
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

/// How long to wait before trying the same channel again, given how many
/// attempts have already failed, or `None` when the channel is spent.
///
/// §9's 1 s → 2 s → 4 s. Pure and in microseconds so the caller owns the sleep:
/// a decision that sleeps cannot be unit-tested, and this one is worth pinning.
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
/// It exists so that one hard-down provider does not stall every ladder on the
/// node: without it each rung pays the full retry budget per recipient per
/// channel, and a team of eight spends minutes discovering the same outage
/// eight times.
///
/// Deliberately per-node and in-memory — §9 again: "a shared breaker needs
/// shared state we do not want to introduce". The cost of being wrong is one
/// node skipping a channel that has come back, and the half-open probe fixes
/// that within a minute.
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

    /// Whether a send may be attempted now.
    ///
    /// An open breaker admits exactly one probe once the cool-down has passed
    /// — half-open — because the alternative is a channel that never recovers
    /// until the process restarts.
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
        // A success is the end of the story: the channel works, so neither the
        // open state nor the failures that produced it mean anything now.
        if delivered {
            self.attempts.clear();
            self.opened_at = None;
            return;
        }
        // A failed half-open probe re-opens for another full cool-down rather
        // than letting every following rung pay for one more probe each.
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
/// The delay identifies the rung. Targets that fire together belong to the
/// same rung by construction, so a ladder can never show three consecutive
/// rows all saying "immediately" and leave a reader guessing at the order.
/// It also gives the delivery ledger a key that survives reordering and
/// renaming, which a positional index would not.
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
    /// Alert Destination names this team pages through when a rung includes
    /// the Webhook channel. Reuses the destinations an org already has rather
    /// than storing URLs a second time.
    #[serde(default)]
    pub destinations: Vec<String>,
    /// §4's L0 block: how the AI SRE agent relates to this team's paging.
    ///
    /// Defaulted on read, because it is the newest column and a row written
    /// before it existed has to behave like a team that never opened the
    /// screen — which is most of them.
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
    /// The policy names a channel no `Notifier` can send on.
    ///
    /// Storing one is the worst failure a pager has: the policy reads as
    /// configured, the rung fires, every recipient lands in `failed`, and
    /// nobody is woken. Refusing it at write time is the only point at which
    /// somebody is still looking at the screen.
    UndeliverableChannels(AlertPriority, Vec<Channel>),
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
    /// The defaults a team is created with, straight off the design's two
    /// tables: the severity/channel matrix in `00-simplified-flow.md` §2 and
    /// the escalation timing table in §3.
    ///
    /// | | t=0 | 5 min | 15 min | 30 min |
    /// |---|---|---|---|---|
    /// | P1 | primary **+** secondary | whole team | whole team | — |
    /// | P2 | primary | secondary | whole team | — |
    /// | P3 | primary | — | secondary | whole team |
    /// | P4, P5 | nobody, ever | | | |
    ///
    /// **The whole team is told twice at most, and never after 15 minutes.**
    /// It used to repeat at 30 and 60 too, which on a twelve-person team meant
    /// one unacknowledged P1 sent fifty notifications and woke the entire
    /// on-call organisation four times. Nobody chose that — it is the policy
    /// every team is created with — and the fourth ring has never reached
    /// anybody the first did not. What it reliably does is teach people to mute
    /// the pager, which costs the *next* incident.
    ///
    /// The repeats were not a design choice either. They existed because a
    /// level could only name the whole team, so there was nowhere else for the
    /// ladder to go; a level can now name any rotation, so a team that wants
    /// depth adds one instead of ringing the same phones again.
    ///
    /// **P1 is parallel.** Everyone who can fix a critical outage is paged at
    /// once; §2 says so in as many words ("no 5-minute delays between primary
    /// and secondary"), and staggering them buys nothing but minutes.
    ///
    /// **The secondary is a rotation, not a derivation.** This function used to
    /// build it from `NextOnCall` — one handover further along the *primary's*
    /// roster — on the argument that "one rotation is enough to be pageable, so
    /// a secondary needs no second schedule to staff". That argument was wrong
    /// in a way that took a live team to see: the position then existed whether
    /// or not anybody staffed it, so a team that *did* staff it had two answers
    /// for one chair and got a different person at the weekend. A level now
    /// names a rotation by id, and `secondary` here is `None` for a team that
    /// only has one.
    ///
    /// The depth beyond the secondary is still the whole team, and that is now
    /// a *choice* rather than a limit: a team with an "Engineering" rotation can
    /// point 15 min at it, which the previous model could not express at all.
    ///
    /// P4 and P5 page nobody at all: they are recorded and shown in the
    /// product, and the agent still investigates them.
    ///
    /// Every paging priority defaults to Email because Email is the only
    /// channel a `Notifier` can deliver ([`Channel::is_deliverable`]). When
    /// SMS and voice land, THIS is the function that changes — the defaults
    /// should never promise a channel that does not send.
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
        // A team with one rotation has no secondary rung at all, rather than a
        // rung that quietly resolves to the person already being paged.
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
            // Ships with every auto-created policy, so nobody has to configure
            // L0 to benefit from it.
            l0: super::agent::L0Policy::defaults(),
            // One pass, then say on the record that nobody answered. §3 allows
            // more; a team that has not asked for more gets what it always got.
            rungs: vec![
                PriorityRung {
                    priority: P1,
                    steps: vec![
                        // §2: primary and secondary together, immediately. Not
                        // two steps five minutes apart — a P1 that waits to
                        // wake the backup has spent the minutes that mattered.
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
                    // A team with one rotation skips the secondary step rather
                    // than filling it with the person already on the pager.
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
    /// rotations: the stored rungs would not parse. Guessing a rotation id
    /// there would be worse than useless — it would name a position that may
    /// not exist and page nobody — so this falls back to the one target that
    /// is always resolvable.
    ///
    /// Loud on purpose: a team whose policy failed to read pages *everybody*,
    /// which somebody will notice and fix, rather than pages nobody, which
    /// nobody notices until an outage.
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
                // Three whole-team steps, not four. There is only one target
                // a team with no rotations has, so every step of this ladder
                // reads identically — and four of the same line is not an
                // escalation, it is the same page sent again on a timer. The
                // rungs that survive are the ones that change something: now,
                // once more in case the first was missed, and a last one
                // before the ladder stops.
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

    /// How many passes of the ladder this policy runs, bounded.
    ///
    /// Read through here rather than off the field, because the field can hold
    /// anything a replicated row or a hand-edit put in it and the engine must
    /// not be the place that discovers a ladder repeating four thousand times.
    pub fn validate(&self) -> Result<(), PolicyError> {
        let mut seen_priority = std::collections::HashSet::new();
        for rung in &self.rungs {
            if !seen_priority.insert(rung.priority.to_i32()) {
                return Err(PolicyError::DuplicatePriority(rung.priority));
            }
            if !rung.steps.is_empty() && rung.channels.is_empty() {
                return Err(PolicyError::NoChannels(rung.priority));
            }
            // Only for a priority that actually pages: a rung that pages
            // nobody may carry whatever a team has ticked in anticipation of
            // SMS landing, because nothing will ever try to send it.
            if !rung.steps.is_empty() {
                let undeliverable: Vec<Channel> = rung
                    .channels
                    .iter()
                    .filter(|c| !c.is_deliverable())
                    .copied()
                    .collect();
                if !undeliverable.is_empty() {
                    return Err(PolicyError::UndeliverableChannels(
                        rung.priority,
                        undeliverable,
                    ));
                }
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
/// retries and a promoted severity safe: re-running with the same inputs
/// notifies nobody twice.
pub fn plan(steps: &[LadderStep], elapsed_micros: i64, already_notified: &[i64]) -> LadderAction {
    let mut due: Vec<LadderStep> = Vec::new();
    let mut next: Option<i64> = None;

    for step in steps {
        if step.after_micros <= elapsed_micros {
            if !already_notified.contains(&step.after_micros) {
                due.push(step.clone());
            }
        } else {
            // Steps are not required to be stored in order, so take the
            // minimum rather than the first one past the cursor.
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
/// Four, which with the backoff below is about seven and a half minutes of
/// trying. Long enough to sit out the transport failures that actually happen
/// — an SMTP restart, a DNS blip, a webhook's proxy cycling — and short enough
/// that a provider which is genuinely gone does not hold the ladder still while
/// the outage it was raised about goes unworked.
pub const MAX_TRANSPORT_ATTEMPTS: u32 = 4;

/// The wait before the first re-send of a rung the transport lost.
///
/// Thirty seconds, not the one second [`retry_delay_micros`] uses: that one is
/// retrying a single send inside a rung, and by the time we are here every
/// channel for every recipient has already spent its own budget. Trying again
/// immediately would only re-discover the same outage.
pub const TRANSPORT_BACKOFF_MICROS: i64 = 30 * 1_000_000;

/// The longest this backs off. Beyond four minutes a re-send stops being a
/// retry and starts being a second ladder running at its own pace.
pub const MAX_TRANSPORT_BACKOFF_MICROS: i64 = 4 * MICROS_PER_MINUTE;

/// What one rung's dispatch achieved, as far as the ladder is concerned.
///
/// The distinction this exists for is the one §9 does not make and the engine
/// needs: a rung that resolved to **nobody** and a rung whose real recipients
/// were all lost to the **transport** are both "nobody was reached", and they
/// want opposite things.
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
    /// §9, verbatim: "if every channel for a responder fails, escalation
    /// advances to the next level immediately rather than waiting out the level
    /// timeout" — which is written about a rung with nobody on it. Waiting five
    /// minutes for a name that will never resolve helps no one, so the next
    /// level is tried inside the same tick.
    AdvanceNow,
    /// Come back at `at` and send this **same** rung again. It is not spent:
    /// the recipients exist and will be reachable when the transport is.
    /// `attempts` is the count to record, so the next failure backs off further.
    RetryRung { at: i64, attempts: u32 },
    /// The transport has had [`MAX_TRANSPORT_ATTEMPTS`] goes at this rung and
    /// is not coming back in time to matter. Give the rung up and let the
    /// ladder carry on **at its configured pace** — the next rung when the
    /// next rung is due, so a dead provider ends at `Exhausted` and whatever
    /// the policy's final action is, rather than looping or collapsing.
    GiveUpRung,
}

/// How long to wait before sending a lost rung again.
///
/// 30 s → 1 m → 2 m → 4 m. Doubling, because the second failure means something
/// the first did not: the first is a blip, the fourth is an outage.
fn transport_backoff_micros(attempts_made: u32) -> i64 {
    TRANSPORT_BACKOFF_MICROS
        .saturating_mul(1i64 << attempts_made.min(16))
        .min(MAX_TRANSPORT_BACKOFF_MICROS)
}

/// What the ladder does next, from what the rung achieved and how many times
/// the transport has already lost it.
///
/// The whole point is that only [`RungOutcome::NoRecipients`] consumes the
/// ladder without pausing. Applying §9's "advance immediately" to a transport
/// failure too is what let thirty seconds of SMTP retire a P1: every rung read
/// as sent, `elapsed` walked forward inside one tick, and the record wrote its
/// own "nobody acknowledged" eleven seconds after it opened.
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
            Self::UndeliverableChannels(p, channels) => {
                let named = channels
                    .iter()
                    .map(Channel::as_str)
                    .collect::<Vec<_>>()
                    .join(", ");
                let deliverable = Channel::deliverable()
                    .iter()
                    .map(Channel::as_str)
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(
                    f,
                    "priority `{p}` pages over {named}, which nothing can deliver yet, so those pages would reach nobody; the channels available today are {deliverable}"
                )
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
        let all = [
            (Channel::Email, 1),
            (Channel::Sms, 2),
            (Channel::Voice, 3),
            (Channel::Chat, 4),
            (Channel::Push, 5),
            (Channel::InApp, 6),
        ];
        for (c, want) in all {
            assert_eq!(c.to_i32(), want, "{c} moved");
            assert_eq!(Channel::from_i32(want), Some(c));
        }
        assert_eq!(Channel::from_i32(0), None);
        assert_eq!(Channel::from_i32(8), None);
        assert_eq!(Channel::Webhook.to_i32(), 7);
    }

    #[test]
    fn test_interrupting_channels_are_the_ones_that_wake_people() {
        for c in [Channel::Voice, Channel::Sms, Channel::Push] {
            assert!(c.is_interrupting(), "{c} wakes a sleeping person");
        }
        for c in [Channel::Email, Channel::Chat, Channel::InApp] {
            assert!(!c.is_interrupting(), "{c} does not wake anyone");
        }
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

        // The whole team, once, and then the ladder is done. It used to say
        // this twice more; repeating the same twelve phones at 30 and 60
        // minutes never reached anybody the first ring had not.
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

    /// The shipped defaults ARE the design's tables — `00-simplified-flow.md`
    /// §2 (who is paged, and that P1 is parallel) and §3 (when the ladder
    /// escalates). They drifted once already: P2's secondary sat at 15 minutes
    /// instead of 5, P3 never escalated at all, and nothing reached 30 or 60,
    /// so a team that never opened the policy screen got a quieter pager than
    /// the product promised. This pins every cell, so the next edit that walks
    /// away from the doc fails here rather than at 3am.
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

    /// §2, verbatim: "For P1, everyone gets notified simultaneously — no
    /// 5-minute delays between primary and secondary." One rung, three
    /// targets, delay zero.
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

    /// §7.4 of the plan: five variants, and a catch-all arm that pages on an
    /// unexpected one is the failure mode. Every priority is listed by name,
    /// and the two that must never page have no steps at any elapsed time.
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

    /// The alert path and the incident path used to default an unset priority
    /// differently — P3 and P2 — so toggling `creates_incident` changed how
    /// loudly the same alert paged. One constant, and it is the louder one,
    /// because silence during a real outage costs more than one wasted page.
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
        // Ten minutes in: the first two rungs were missed and the third is
        // still ahead, which is what makes this a catch-up rather than an end.
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

    /// A policy that names SMS today stores a promise nothing keeps: the rung
    /// fires, every recipient lands in `failed`, and the page reaches nobody
    /// while the screen still says the team is covered. It is refused while
    /// somebody is still looking at the form, and the message says which
    /// channels are the problem and what can be used instead.
    #[test]
    fn test_a_policy_cannot_promise_a_channel_nothing_can_send() {
        let mut p = policy();
        p.rungs[0].channels = vec![Channel::Email, Channel::Sms, Channel::Voice];

        let err = p.validate().unwrap_err();
        assert_eq!(
            err,
            PolicyError::UndeliverableChannels(
                AlertPriority::P1,
                vec![Channel::Sms, Channel::Voice]
            )
        );
        let message = err.to_string();
        assert!(
            message.contains("sms") && message.contains("voice"),
            "{message}"
        );
        assert!(
            message.contains("email"),
            "the message has to say what CAN be used: {message}"
        );

        // Every channel that can be delivered is accepted.
        p.rungs[0].channels = Channel::deliverable();
        p.validate().unwrap();
    }

    /// A priority that pages nobody may carry whatever a team ticked in
    /// anticipation of SMS landing: nothing will ever try to send it.
    #[test]
    fn test_a_non_paging_priority_may_name_a_channel_that_cannot_send_yet() {
        let mut p = policy();
        let idx = p
            .rungs
            .iter()
            .position(|r| r.priority == AlertPriority::P4)
            .unwrap();
        p.rungs[idx].channels = vec![Channel::Sms];
        p.validate().unwrap();
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

    /// A default that names a channel nothing can send stores a promise the
    /// engine silently drops — the worst failure mode a pager has.
    #[test]
    fn test_defaults_only_use_channels_that_can_be_delivered() {
        let p = policy();
        for rung in &p.rungs {
            for channel in &rung.channels {
                assert!(
                    channel.is_deliverable(),
                    "{} defaults to {channel}, which no Notifier can send",
                    rung.priority
                );
            }
        }
    }

    /// Only Email has an implementation today. This test is the reminder to
    /// revisit the defaults when a provider lands, not a statement that the
    /// other channels are wrong to exist.
    #[test]
    fn test_email_is_the_only_deliverable_channel_today() {
        assert_eq!(
            Channel::deliverable(),
            vec![Channel::Email, Channel::Webhook]
        );
        for c in [
            Channel::Sms,
            Channel::Voice,
            Channel::Chat,
            Channel::Push,
            Channel::InApp,
        ] {
            assert!(!c.is_deliverable(), "{c} has no Notifier yet");
        }
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
    /// the order is the whole decision. Email before webhook, because the
    /// person is the target and the team channel is the fallback.
    #[test]
    fn test_the_chain_is_ordered_and_only_holds_channels_that_send() {
        assert_eq!(
            fallback_chain(&[Channel::Webhook, Channel::Email]),
            vec![Channel::Email, Channel::Webhook],
            "the policy's storage order must not decide who is tried first"
        );
        // Everything a team may have ticked in anticipation of a provider is
        // dropped: an unreachable channel at the head of the chain would make
        // every page look attempted and reach nobody.
        assert_eq!(
            fallback_chain(&[Channel::Sms, Channel::Voice, Channel::Push, Channel::Email]),
            vec![Channel::Email]
        );
        assert!(fallback_chain(&[Channel::InApp]).is_empty());
        assert!(fallback_chain(&[]).is_empty());
    }

    /// §6's baseline, in as many words: "on a single-node deployment with just
    /// SMTP configured, the chain collapses to email and everything still
    /// works".
    #[test]
    fn test_the_chain_collapses_to_email_on_an_smtp_only_deployment() {
        assert_eq!(fallback_chain(&[Channel::Email]), vec![Channel::Email]);
    }

    /// The undeliverable half of the published order is carried so the order
    /// does not have to be redesigned when a provider lands.
    #[test]
    fn test_the_published_order_is_the_one_the_design_names() {
        assert_eq!(
            FALLBACK_ORDER,
            [
                Channel::Push,
                Channel::Sms,
                Channel::Voice,
                Channel::Email,
                Channel::Webhook,
                Channel::Chat,
                Channel::InApp,
            ]
        );
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

    /// The engine's loop, with the dispatching replaced by a fixed outcome:
    /// which rungs one tick consumes, and what it leaves the ladder doing.
    ///
    /// Spelled out here rather than described in prose because "how much of the
    /// ladder does one tick eat" is the whole of G2, and it is a property of
    /// [`plan`] and [`after_rung`] together.
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

    /// The coverage case, exactly as it was. A rung that resolved to nobody
    /// must not burn its delay in silence: nobody will appear in five minutes,
    /// so the ladder tries the next level now, and a ladder of them runs out
    /// inside one tick. §9 wrote "advance immediately" about this.
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

    /// G2. The same ladder, the same "nobody was reached" — except the people
    /// were there and SMTP was not. One tick must consume **one** rung, not the
    /// ladder: thirty seconds of a dead transport used to exhaust a five-rung
    /// P1 in eleven milliseconds and delete its timer.
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

    /// The other half of G2: the rung is not consumed either, so when mail
    /// comes back the very people who should have been woken still are. This
    /// is what the engine relies on when it drops an unreached rung from the
    /// ledger before re-planning.
    #[test]
    fn test_the_lost_rung_is_still_pageable_when_the_transport_returns() {
        let p1 = steps(AlertPriority::P1);
        // What the timeline holds after the failed tick, and what the engine
        // plans from: the same list with the rung the transport lost taken back
        // out, because it was attempted rather than sent.
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
    /// at its configured pace — one rung per tick, on to `Exhausted` and
    /// whatever the policy's final action is. A dead provider must land
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

    /// 30 s → 1 m → 2 m → 4 m, and no further. The doubling is the point — the
    /// fourth failure means something the first did not — and the cap is what
    /// stops a retry becoming a second ladder.
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
        // An attempt count from a replicated row can be anything at all, and a
        // backoff that overflows is a page scheduled in the past or never.
        assert_eq!(
            transport_backoff_micros(u32::MAX),
            MAX_TRANSPORT_BACKOFF_MICROS
        );
    }

    /// A rung somebody was woken on never retries, whatever the transport did
    /// to the other recipients. The page landed; the ladder's job is done until
    /// the next level is due.
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
    /// person is still a chain, in fallback order, and the caller stops at the
    /// first success.
    #[test]
    fn test_a_person_reaching_chain_keeps_its_order_and_its_membership() {
        // Every channel ticked, including the ones no transport can send.
        let plan = channel_plan(&[
            Channel::InApp,
            Channel::Email,
            Channel::Sms,
            Channel::Chat,
            Channel::Webhook,
            Channel::Voice,
            Channel::Push,
        ]);
        assert_eq!(
            plan.chain,
            vec![Channel::Email],
            "only the deliverable person-reaching channels, in FALLBACK_ORDER"
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
        assert!(is_broadcast(Channel::Chat));
        assert!(is_broadcast(Channel::Webhook));
        for personal in [
            Channel::Email,
            Channel::Sms,
            Channel::Voice,
            Channel::Push,
            Channel::InApp,
        ] {
            assert!(!is_broadcast(personal), "{personal} reaches one person");
        }
    }

    /// A rung that pages nobody must not look like it had a plan.
    #[test]
    fn test_a_rung_with_nothing_deliverable_plans_nothing() {
        let plan = channel_plan(&[Channel::Sms, Channel::Voice, Channel::Chat]);
        assert!(plan.is_empty(), "{plan:?}");
        assert!(channel_plan(&[]).is_empty());
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
