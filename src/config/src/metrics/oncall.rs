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

//! On-call paging metrics — chosen to make bad outcomes visible; a dropped signal leaves no trace.

use std::sync::LazyLock as Lazy;

use prometheus::{HistogramOpts, HistogramVec, IntCounterVec, Opts};

use super::{NAMESPACE, create_const_labels};

/// Pages handed to a transport, by priority and channel.
///
/// Counted per (recipient, channel) attempt rather than per rung: a rung that
/// fans out to four people on two channels is eight chances to reach somebody,
/// and collapsing them would hide seven of the eight failing.
pub static ONCALL_PAGES_DISPATCHED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_pages_dispatched_total",
            "On-call pages handed to a notification channel.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority", "channel"],
    )
    .expect("Metric created")
});

/// Page attempts the transport refused or lost, by channel.
///
/// Separate from the dispatch counter rather than a `status` label, so "email
/// is down" is a rate on one series instead of a ratio somebody has to remember
/// to compute. The two together give the ratio anyway.
pub static ONCALL_DELIVERY_FAILURES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_delivery_failures_total",
            "On-call page attempts a notification channel did not accept.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "channel"],
    )
    .expect("Metric created")
});

/// Records somebody took ownership of.
pub static ONCALL_ACKNOWLEDGEMENTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_acknowledgements_total",
            "On-call response records acknowledged by a human.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// Time from the record opening to the first acknowledgement — MTTA.
///
/// Buckets run from ten seconds to two hours, the range the number is argued
/// about in: under a minute is "the page worked", ten minutes is "the first
/// rung did not", past an hour is a ladder that stopped because somebody
/// noticed by other means. Linear buckets would put almost everything in one.
pub static ONCALL_ACK_LATENCY_SECONDS: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "oncall_ack_latency_seconds",
            "Seconds from an on-call record opening to its first acknowledgement.",
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            10.0, 30.0, 60.0, 120.0, 300.0, 600.0, 900.0, 1800.0, 3600.0, 7200.0,
        ])
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// Ladders that ran out of rungs with nobody acknowledging.
///
/// The worst outcome the engine has, and the one it can least tell you about on
/// its own: when the last rung fires there is no next wake-up, so the trigger
/// row is deleted and the record sits there looking open. This is the alertable
/// form of "we paged an entire team and nobody answered".
pub static ONCALL_LADDERS_EXHAUSTED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_escalation_exhausted_total",
            "On-call escalation ladders that reached their last rung with no acknowledgement.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// Signals that matched no team and so opened no record at all.
///
/// Invisible everywhere else by construction: routing that finds nobody returns
/// before a record exists, so there is no row, no timeline and no UI surface. A
/// non-zero rate means alerts are firing into a gap in the ownership rules.
pub static ONCALL_UNROUTED_SIGNALS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_unrouted_signals_total",
            "Signals that matched no on-call team and therefore paged nobody.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "subject_type"],
    )
    .expect("Metric created")
});

/// Signals that no ownership rule claimed and that the org's nominated default
/// team absorbed.
///
/// Deliberately not folded into `oncall_unrouted_signals_total`, which answers
/// "how many pages were never attempted" and has to keep answering it after an
/// org nominates a catch-all. This one answers how much of the paging load
/// rides on a fallback rather than an owner.
pub static ONCALL_DEFAULTED_SIGNALS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_defaulted_signals_total",
            "Signals that matched no ownership rule and paged the org's default team.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "subject_type"],
    )
    .expect("Metric created")
});

/// Rungs whose escalation target resolved to no human.
///
/// Distinct from an unrouted signal: the team was found, the ladder is running,
/// and the rung still notified nobody because the schedule has a hole. The
/// ladder advances silently, which is why the hole needs a counter — `target`
/// says which seat was empty.
pub static ONCALL_COVERAGE_GAPS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_coverage_gaps_total",
            "Escalation rungs whose target resolved to nobody on call.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "target"],
    )
    .expect("Metric created")
});

// L0 — the agent's position in the ladder (07-agent-l0-architecture §8)

/// Verdicts the agent produced, by what it recommended and how sure it was.
///
/// The denominator for everything below, and the mix alone is the first signal
/// of a prompt regression: a model that starts recommending `Suppress` for
/// everything shows up here first.
pub static ONCALL_L0_VERDICTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_verdicts_total",
            "Structured verdicts emitted by the L0 agent.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "action", "confidence"],
    )
    .expect("Metric created")
});

/// Triage holds that ran out before the agent answered.
///
/// The gate is fail-open, so this is not an error — it is the number a team
/// tunes `triage_budget_seconds` or `mode` by. A rate near 1 means the gate is
/// buying 90 seconds of latency and nothing else.
pub static ONCALL_L0_BUDGET_EXPIRED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_budget_expired_total",
            "Triage holds that expired with no verdict and paged anyway.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// The ratchet in use, from and to. Paired with acknowledgement latency and the
/// recorded resolution cause, this answers "were the promoted ones real?" — the
/// question that decides whether delegating this decision was worth it.
pub static ONCALL_L0_PROMOTED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_promoted_total",
            "Firings whose severity a verdict raised.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "from", "to"],
    )
    .expect("Metric created")
});

/// Suggested demotions, refused.
///
/// Expected to be ~0: the engine discards any suggestion at or below the
/// current severity, so a nonzero rate means the model has regressed or
/// something in a log line is talking to it. Alert on the rate, not the total.
pub static ONCALL_L0_SEVERITY_CLAMP: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_severity_clamp_total",
            "Severity suggestions at or below the firing's own severity, discarded.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// Firings a verdict silenced. Only ever nonzero for teams that opted in.
pub static ONCALL_L0_SUPPRESSED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_suppressed_total",
            "Firings a verdict suppressed for a team that enabled suppression.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// Firings a verdict moved onto quieter channels. The recorded severity is
/// untouched; this counts notifications, not facts about the failure.
pub static ONCALL_L0_DOWNGRADED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_downgraded_total",
            "Firings a verdict notified on a quieter channel set.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// Whether the human's page already contained the answer — the headline metric.
///
/// Recorded at the first acknowledgement with `verdict_first` set to whether a
/// verdict had landed by then. §8's ratio is `yes / (yes + no)`, computed at
/// query time, because a ratio is not a thing a counter can be.
pub static ONCALL_L0_VERDICT_BEFORE_FIRST_ACK: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_verdict_before_first_ack_total",
            "Acknowledged pages, by whether the verdict had landed before the acknowledgement.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority", "verdict_first"],
    )
    .expect("Metric created")
});

/// A suppressed firing that came back at or above its original severity within
/// 24 hours — the trust metric. If this is not ~zero, teams should not enable
/// suppression, and the UI should say so next to the toggle.
///
/// It has no producer yet: deciding that a suppressed firing came back needs a
/// watcher over the next 24 hours of firings for the same subject, and that is
/// not built. Until it is, this reads a permanent zero, indistinguishable from
/// "suppression has never once been wrong" — so nothing may render it beside
/// the `allow_suppress` toggle as evidence.
pub static ONCALL_L0_FALSE_SUPPRESS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "oncall_l0_false_suppress_total",
            "Suppressed firings that re-fired at or above their original severity within 24h.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "priority"],
    )
    .expect("Metric created")
});

/// Registers the on-call metrics on `registry`. Called from
/// `metrics::register_metrics` so the whole set lives or dies together: a
/// metric defined but never registered is worse than one that does not exist,
/// because it looks present in the code and is absent from `/metrics`.
pub(super) fn register(registry: &prometheus::Registry) {
    registry
        .register(Box::new(ONCALL_PAGES_DISPATCHED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_DELIVERY_FAILURES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_ACKNOWLEDGEMENTS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_ACK_LATENCY_SECONDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_LADDERS_EXHAUSTED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_UNROUTED_SIGNALS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_DEFAULTED_SIGNALS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_COVERAGE_GAPS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_VERDICTS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_BUDGET_EXPIRED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_PROMOTED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_SEVERITY_CLAMP.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_SUPPRESSED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_DOWNGRADED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_VERDICT_BEFORE_FIRST_ACK.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ONCALL_L0_FALSE_SUPPRESS.clone()))
        .expect("Metric registered");
}

#[cfg(test)]
mod tests {
    use prometheus::Registry;

    use super::*;

    /// The whole set has to register on a fresh registry without a name clash.
    /// Duplicate metric names are a runtime panic at boot, not a compile error.
    #[test]
    fn test_every_oncall_metric_registers_once() {
        let registry = Registry::new();
        register(&registry);
        let names: Vec<String> = registry
            .gather()
            .into_iter()
            .map(|m| m.name().to_string())
            .collect();
        // `gather` only emits families with a child, so this asserts registration, not a count.
        assert!(names.len() <= 16, "unexpected extra families: {names:?}");
    }
}
