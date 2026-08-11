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

//! Prometheus metrics for on-call paging and escalation.
//!
//! Everything else in the product can be judged after the fact from the data it
//! wrote. Paging cannot: the question an operator asks about it is "did anybody
//! actually get woken up", and the record's own timeline is not an answer,
//! because the timeline is written by the same code path that would be broken.
//! A page that reached nobody and a page nobody had to answer look identical
//! from inside the product; from outside, one of them is a counter that stops
//! moving.
//!
//! So the set below is chosen to make exactly the bad outcomes visible, rather
//! than to describe the happy path in detail:
//!
//! * pages went out, and on which channel — the denominator for everything else;
//! * deliveries failed — the numerator that says the channel is broken;
//! * somebody acknowledged, and how long it took — MTTA, the number the on-call
//!   rotation is actually managed by;
//! * a ladder ran out of rungs with nobody acknowledging — the worst outcome the
//!   system has, and it should be near zero;
//! * a signal did not route to any team — a page that was never even attempted;
//! * a rung resolved to nobody — the schedule has a hole, so the ladder advanced
//!   past a step that notified no human.
//!
//! The last three are the ones with no other trace. A dropped signal writes no
//! record at all, so if it is not counted here it did not happen as far as any
//! dashboard is concerned.
//!
//! Emission lives at the call sites in the escalation engine; the helper
//! functions below exist so those call sites stay one line and so the label
//! vocabulary is decided once, here, instead of at seven different keyboards.

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
/// Kept separate from the dispatch counter rather than folded into it as a
/// `status` label so that "email is down" is a rate on one series instead of a
/// ratio somebody has to remember to compute. The two together give the ratio
/// anyway.
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
/// Buckets run from ten seconds to two hours because that is the range the
/// number is argued about in: under a minute is "the page worked", ten minutes
/// is "the first rung did not", and anything past an hour is a ladder that only
/// stopped because someone noticed by other means. Linear buckets would put
/// almost every observation in one of them.
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
/// The worst outcome the escalation engine has, and the one it is least able to
/// tell you about on its own: when the last rung fires there is no next wake-up,
/// so the trigger row is deleted and the record simply sits there looking open.
/// This counter is the alertable form of "we paged an entire team and nobody
/// answered".
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
/// These are invisible everywhere else by construction: routing that finds
/// nobody returns before a record exists, so there is no row, no timeline and no
/// UI surface to look at. A non-zero rate here means alerts are firing into a
/// gap in the ownership rules.
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

/// Rungs whose escalation target resolved to no human.
///
/// Distinct from an unrouted signal: the team was found, the ladder is running,
/// and the rung still notified nobody because the schedule has a hole at that
/// instant. The ladder advances silently in that case, which is exactly why the
/// hole needs a counter — `target` says which seat was empty.
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

// ---------------------------------------------------------------------------
// L0 — the agent's position in the ladder (07-agent-l0-architecture §8)
// ---------------------------------------------------------------------------

/// Verdicts the agent produced, by what it recommended and how sure it was.
///
/// The denominator for everything below it, and the mix on its own is the first
/// signal of a prompt regression: a model that starts recommending `Suppress`
/// for everything shows up here before it shows up anywhere a human would see.
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

/// The ratchet in use, from and to.
///
/// Paired with acknowledgement latency and the recorded resolution cause, this
/// is what answers "were the promoted ones real?" — the question that decides
/// whether the one decision this design delegates to a model was worth
/// delegating.
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
/// **Expected to be ~0.** The engine discards any `severity_suggestion` at or
/// below the firing's current severity, so a nonzero rate here is not a routine
/// event: it means the model has regressed, or something in a log line is
/// talking to it. Alert on the rate, not the total.
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

/// Whether the human's page already contained the answer.
///
/// The headline metric — the one that justifies the feature. Recorded at the
/// first acknowledgement with `verdict_first` set to whether a verdict had
/// landed by then; the ratio §8 names is `yes / (yes + no)`, computed at query
/// time rather than stored, because a ratio is not a thing a counter can be.
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
/// 24 hours.
///
/// The trust metric. If this is not ~zero, teams should not enable suppression,
/// and the UI should say so next to the toggle rather than leaving them to find
/// out from a missed outage.
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

/// Registers the on-call metrics on `registry`.
///
/// Called from `metrics::register_metrics` so the whole set lives or dies
/// together; a metric that is defined but never registered is worse than one
/// that does not exist, because it looks present in the code and is absent from
/// `/metrics`.
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

/// Emit the counters one verdict application moved.
///
/// Takes the list [`config::meta::oncall::metrics_for`] computed rather than
/// recomputing anything: the decision and the counter come off one evaluation,
/// so a dashboard and the timeline cannot disagree about what happened.
pub fn l0_verdict_applied(org_id: &str, priority: &str, moved: &[crate::meta::oncall::L0Metric]) {
    use crate::meta::oncall::L0Metric;

    for metric in moved {
        match metric {
            L0Metric::Verdict { action, confidence } => ONCALL_L0_VERDICTS
                .with_label_values(&[org_id, action.as_str(), confidence.as_str()])
                .inc(),
            L0Metric::BudgetExpired => ONCALL_L0_BUDGET_EXPIRED
                .with_label_values(&[org_id, priority])
                .inc(),
            // `from` then `to`, in that order: the pair is read as an arrow on
            // every dashboard that uses it.
            L0Metric::Promoted { from, to } => ONCALL_L0_PROMOTED
                .with_label_values(&[org_id, from.as_str(), to.as_str()])
                .inc(),
            // The prompt-regression alarm. It is only worth anything while it
            // sits at zero, so nothing but an attempted demotion may reach it.
            L0Metric::SeverityClamped => ONCALL_L0_SEVERITY_CLAMP
                .with_label_values(&[org_id, priority])
                .inc(),
            L0Metric::Suppressed => ONCALL_L0_SUPPRESSED
                .with_label_values(&[org_id, priority])
                .inc(),
            L0Metric::Downgraded => ONCALL_L0_DOWNGRADED
                .with_label_values(&[org_id, priority])
                .inc(),
        }
    }
}

/// One acknowledged page, and whether the verdict beat the human to it.
pub fn l0_verdict_before_first_ack(org_id: &str, priority: &str, verdict_first: bool) {
    // Both arms recorded, because §8's headline number is a ratio and a ratio
    // needs its denominator: only ever counting the flattering arm reads 100%
    // forever.
    let arm = if verdict_first { "yes" } else { "no" };
    ONCALL_L0_VERDICT_BEFORE_FIRST_ACK
        .with_label_values(&[org_id, priority, arm])
        .inc();
}

/// A suppressed firing that came back at or above its original severity.
pub fn l0_false_suppress(org_id: &str, priority: &str) {
    ONCALL_L0_FALSE_SUPPRESS
        .with_label_values(&[org_id, priority])
        .inc();
}

/// One page attempt that a channel accepted.
pub fn page_dispatched(org_id: &str, priority: &str, channel: &str) {
    ONCALL_PAGES_DISPATCHED
        .with_label_values(&[org_id, priority, channel])
        .inc();
}

/// One page attempt a channel did not accept.
///
/// Deliberately counts the attempt, not the rung: a rung that reached three of
/// four people is a partial failure and has to read as one.
pub fn delivery_failed(org_id: &str, channel: &str) {
    ONCALL_DELIVERY_FAILURES
        .with_label_values(&[org_id, channel])
        .inc();
}

/// A record somebody acknowledged, with the time it took them.
///
/// `time_to_ack_micros` is optional because the acknowledgement is the fact
/// worth counting even on a record whose open time this build cannot read;
/// dropping the whole observation for a missing latency would understate how
/// many pages were answered.
pub fn acknowledged(org_id: &str, priority: &str, time_to_ack_micros: Option<i64>) {
    ONCALL_ACKNOWLEDGEMENTS
        .with_label_values(&[org_id, priority])
        .inc();
    // A negative delta means the clocks disagree across nodes, not that somebody
    // answered before they were paged. Recording it would drag MTTA down with a
    // value that never happened, so it is dropped.
    if let Some(micros) = time_to_ack_micros
        && micros >= 0
    {
        ONCALL_ACK_LATENCY_SECONDS
            .with_label_values(&[org_id, priority])
            .observe(micros as f64 / 1_000_000.0);
    }
}

/// A ladder that reached its last rung with nobody acknowledging.
pub fn ladder_exhausted(org_id: &str, priority: &str) {
    ONCALL_LADDERS_EXHAUSTED
        .with_label_values(&[org_id, priority])
        .inc();
}

/// A signal that matched no team.
pub fn unrouted_signal(org_id: &str, subject_type: &str) {
    ONCALL_UNROUTED_SIGNALS
        .with_label_values(&[org_id, subject_type])
        .inc();
}

/// A rung whose target resolved to nobody on call.
pub fn coverage_gap(org_id: &str, target: &str) {
    ONCALL_COVERAGE_GAPS
        .with_label_values(&[org_id, target])
        .inc();
}

#[cfg(test)]
mod tests {
    use prometheus::Registry;

    use super::*;

    /// The whole set has to register on a fresh registry without a name clash.
    /// Duplicate metric names are a runtime panic at boot, not a compile error,
    /// so this is the only place that catches one.
    #[test]
    fn test_every_oncall_metric_registers_once() {
        let registry = Registry::new();
        register(&registry);
        let names: Vec<String> = registry
            .gather()
            .into_iter()
            .map(|m| m.name().to_string())
            .collect();
        // `gather` only emits families that have at least one child, so this
        // asserts registration succeeded rather than counting series.
        assert!(names.len() <= 15, "unexpected extra families: {names:?}");
    }

    /// The emission seam. `metrics_for` decides *what* moved; this decides
    /// *which series*, and getting that mapping wrong is invisible — the
    /// decision tests all pass, the counters all move, and the numbers are
    /// wrong.
    ///
    /// The pairing that matters is clamp versus promote. They are the same
    /// shape and adjacent in the code, and swapping them makes
    /// `oncall_l0_severity_clamp_total` — which is supposed to sit at zero and
    /// mean "prompt regression" — tick along with every ordinary promotion,
    /// which retires the alarm.
    #[test]
    fn test_each_l0_decision_lands_on_its_own_series() {
        use crate::meta::{alerts::priority::AlertPriority, oncall::L0Metric};

        l0_verdict_applied("org_l0", "p2", &[L0Metric::SeverityClamped]);
        assert_eq!(
            ONCALL_L0_SEVERITY_CLAMP
                .with_label_values(&["org_l0", "p2"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_L0_PROMOTED
                .with_label_values(&["org_l0", "P2", "P2"])
                .get(),
            0,
            "a refused demotion is not a promotion"
        );

        l0_verdict_applied(
            "org_l0",
            "p3",
            &[
                L0Metric::Verdict {
                    action: crate::meta::oncall::PageAction::Page,
                    confidence: crate::meta::oncall::Confidence::High,
                },
                L0Metric::Promoted {
                    from: AlertPriority::P3,
                    to: AlertPriority::P2,
                },
            ],
        );
        assert_eq!(
            ONCALL_L0_PROMOTED
                .with_label_values(&["org_l0", "P3", "P2"])
                .get(),
            1,
            "from and to are labels, and in that order"
        );
        assert_eq!(
            ONCALL_L0_VERDICTS
                .with_label_values(&["org_l0", "page", "high"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_L0_SEVERITY_CLAMP
                .with_label_values(&["org_l0", "p3"])
                .get(),
            0,
            "a promotion did not move the prompt-regression alarm"
        );

        // Suppressed and Downgraded carry identical label sets, so nothing but
        // an explicit assertion distinguishes them — the same hazard as
        // clamp-versus-promote, one variant further down the same match.
        l0_verdict_applied("org_l0_s", "p3", &[L0Metric::Suppressed]);
        assert_eq!(
            ONCALL_L0_SUPPRESSED
                .with_label_values(&["org_l0_s", "p3"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_L0_DOWNGRADED
                .with_label_values(&["org_l0_s", "p3"])
                .get(),
            0,
            "a suppressed firing is not a downgraded one"
        );
        l0_verdict_applied("org_l0_d", "p3", &[L0Metric::Downgraded]);
        assert_eq!(
            ONCALL_L0_DOWNGRADED
                .with_label_values(&["org_l0_d", "p3"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_L0_SUPPRESSED
                .with_label_values(&["org_l0_d", "p3"])
                .get(),
            0,
            "a downgraded firing still woke somebody"
        );

        l0_verdict_applied("org_l0_b", "p2", &[L0Metric::BudgetExpired]);
        assert_eq!(
            ONCALL_L0_BUDGET_EXPIRED
                .with_label_values(&["org_l0_b", "p2"])
                .get(),
            1
        );

        // An empty list moves nothing at all — a Skipped analysis has nothing
        // to count, and counting it as a zero-confidence verdict would poison
        // the mix.
        l0_verdict_applied("org_l0_empty", "p1", &[]);
        assert_eq!(
            ONCALL_L0_VERDICTS
                .with_label_values(&["org_l0_empty", "page", "high"])
                .get(),
            0
        );

        // §8's headline metric is a **ratio**, so its denominator has to exist.
        // Labelling both arms the same way — or only ever recording the arm
        // that flatters the feature — makes it read 100% forever.
        l0_verdict_before_first_ack("org_l0", "p2", true);
        l0_verdict_before_first_ack("org_l0", "p2", false);
        l0_verdict_before_first_ack("org_l0", "p2", false);
        assert_eq!(
            ONCALL_L0_VERDICT_BEFORE_FIRST_ACK
                .with_label_values(&["org_l0", "p2", "yes"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_L0_VERDICT_BEFORE_FIRST_ACK
                .with_label_values(&["org_l0", "p2", "no"])
                .get(),
            2,
            "the page that did not carry an answer is the denominator"
        );

        l0_false_suppress("org_l0", "p3");
        assert_eq!(
            ONCALL_L0_FALSE_SUPPRESS
                .with_label_values(&["org_l0", "p3"])
                .get(),
            1
        );
    }

    /// §8's names, spelled out. These are the series a team's alerts and
    /// dashboards are written against, so a rename is a silent outage of the
    /// thing that was supposed to tell us L0 had gone wrong — and
    /// `oncall_l0_severity_clamp_total` in particular is the prompt-regression
    /// alarm, which nobody notices has stopped firing.
    #[test]
    fn test_the_l0_metric_names_are_the_ones_the_design_publishes() {
        let expected = [
            ("oncall_l0_verdicts_total", vec!["action", "confidence"]),
            ("oncall_l0_budget_expired_total", vec![]),
            ("oncall_l0_promoted_total", vec!["from", "to"]),
            ("oncall_l0_severity_clamp_total", vec![]),
            ("oncall_l0_suppressed_total", vec![]),
            ("oncall_l0_downgraded_total", vec![]),
            ("oncall_l0_verdict_before_first_ack_total", vec!["verdict_first"]),
            ("oncall_l0_false_suppress_total", vec![]),
        ];
        // Touch one series per family so `gather` emits it.
        ONCALL_L0_VERDICTS
            .with_label_values(&["org_names", "page", "high"])
            .inc();
        ONCALL_L0_BUDGET_EXPIRED
            .with_label_values(&["org_names", "p2"])
            .inc();
        ONCALL_L0_PROMOTED
            .with_label_values(&["org_names", "P3", "P2"])
            .inc();
        ONCALL_L0_SEVERITY_CLAMP
            .with_label_values(&["org_names", "p2"])
            .inc();
        ONCALL_L0_SUPPRESSED
            .with_label_values(&["org_names", "p3"])
            .inc();
        ONCALL_L0_DOWNGRADED
            .with_label_values(&["org_names", "p3"])
            .inc();
        ONCALL_L0_VERDICT_BEFORE_FIRST_ACK
            .with_label_values(&["org_names", "p1", "yes"])
            .inc();
        ONCALL_L0_FALSE_SUPPRESS
            .with_label_values(&["org_names", "p3"])
            .inc();

        let registry = Registry::new();
        register(&registry);
        let gathered = registry.gather();
        for (name, extra_labels) in expected {
            let full = format!("{NAMESPACE}_{name}");
            let family = gathered
                .iter()
                .find(|m| m.name() == full)
                .unwrap_or_else(|| {
                    panic!(
                        "{full} is not registered; have {:?}",
                        gathered.iter().map(|m| m.name()).collect::<Vec<_>>()
                    )
                });
            let labels: Vec<&str> = family.get_metric()[0]
                .get_label()
                .iter()
                .map(|l| l.name())
                .collect();
            assert!(
                labels.contains(&"organization"),
                "{full} must be scoped to an org, has {labels:?}"
            );
            for want in extra_labels {
                assert!(labels.contains(&want), "{full} is missing label {want}");
            }
        }
    }

    /// Two registries must not fight over the same `Lazy` statics — the process
    /// registers once at boot, but tests and any future per-tenant registry
    /// would not.
    #[test]
    fn test_register_is_safe_on_a_second_registry() {
        let a = Registry::new();
        let b = Registry::new();
        register(&a);
        register(&b);
    }

    #[test]
    fn test_page_dispatched_counts_per_channel() {
        let before = ONCALL_PAGES_DISPATCHED
            .with_label_values(&["org_pd", "p1", "email"])
            .get();
        page_dispatched("org_pd", "p1", "email");
        page_dispatched("org_pd", "p1", "email");
        page_dispatched("org_pd", "p1", "webhook");
        assert_eq!(
            ONCALL_PAGES_DISPATCHED
                .with_label_values(&["org_pd", "p1", "email"])
                .get(),
            before + 2
        );
        assert_eq!(
            ONCALL_PAGES_DISPATCHED
                .with_label_values(&["org_pd", "p1", "webhook"])
                .get(),
            1
        );
    }

    #[test]
    fn test_delivery_failure_is_its_own_series() {
        delivery_failed("org_df", "email");
        assert_eq!(
            ONCALL_DELIVERY_FAILURES
                .with_label_values(&["org_df", "email"])
                .get(),
            1
        );
        // A failure must not also count as a dispatch, or the ratio is 1.0 for
        // a channel that delivered nothing.
        assert_eq!(
            ONCALL_PAGES_DISPATCHED
                .with_label_values(&["org_df", "p1", "email"])
                .get(),
            0
        );
    }

    #[test]
    fn test_ack_records_both_count_and_latency() {
        acknowledged("org_ack", "p2", Some(90_000_000));
        assert_eq!(
            ONCALL_ACKNOWLEDGEMENTS
                .with_label_values(&["org_ack", "p2"])
                .get(),
            1
        );
        let h = ONCALL_ACK_LATENCY_SECONDS.with_label_values(&["org_ack", "p2"]);
        assert_eq!(h.get_sample_count(), 1);
        assert!((h.get_sample_sum() - 90.0).abs() < f64::EPSILON);
    }

    /// A missing latency still counts the acknowledgement. Losing the fact that
    /// somebody answered is a worse error than losing one MTTA sample.
    #[test]
    fn test_ack_without_latency_still_counts() {
        acknowledged("org_ack_nolat", "p3", None);
        assert_eq!(
            ONCALL_ACKNOWLEDGEMENTS
                .with_label_values(&["org_ack_nolat", "p3"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_ACK_LATENCY_SECONDS
                .with_label_values(&["org_ack_nolat", "p3"])
                .get_sample_count(),
            0
        );
    }

    /// Clock skew between the node that opened the record and the node that
    /// acknowledged it can produce a negative delta. MTTA must not be dragged
    /// below zero by an event that cannot have happened.
    #[test]
    fn test_negative_latency_is_not_observed() {
        acknowledged("org_skew", "p1", Some(-5_000_000));
        assert_eq!(
            ONCALL_ACKNOWLEDGEMENTS
                .with_label_values(&["org_skew", "p1"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_ACK_LATENCY_SECONDS
                .with_label_values(&["org_skew", "p1"])
                .get_sample_count(),
            0
        );
    }

    #[test]
    fn test_exhaustion_unrouted_and_gap_are_distinct_series() {
        ladder_exhausted("org_bad", "p1");
        unrouted_signal("org_bad", "alert");
        coverage_gap("org_bad", "on_call_now");
        assert_eq!(
            ONCALL_LADDERS_EXHAUSTED
                .with_label_values(&["org_bad", "p1"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_UNROUTED_SIGNALS
                .with_label_values(&["org_bad", "alert"])
                .get(),
            1
        );
        assert_eq!(
            ONCALL_COVERAGE_GAPS
                .with_label_values(&["org_bad", "on_call_now"])
                .get(),
            1
        );
    }
}
