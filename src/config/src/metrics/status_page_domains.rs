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

//! Gauges and counters of custom domains with built-in TLS. No label carries a hostname or an
//! org: reasons, states and results are the only labels.

use std::sync::{Arc, LazyLock as Lazy, Mutex, PoisonError};

use prometheus::{
    IntCounterVec, IntGaugeVec, Opts, Registry,
    core::{Collector, Desc},
    proto::MetricFamily,
};

use super::{NAMESPACE, create_const_labels};

/// The `reason` of each health state of the domain listener.
pub const LISTENER_REASONS: [&str; 7] = [
    "ready",
    "loading",
    "no_key",
    "key_mismatch",
    "epoch_mismatch",
    "draining",
    "not_listening",
];
/// The serving states the domain manager stores for a holder.
pub const DOMAIN_STATES: [&str; 6] = [
    "setting_up",
    "pending",
    "ready",
    "serving",
    "delayed",
    "not_serving",
];
/// The `state` of a holder the domain manager has not judged, or stored under another name.
pub const STATE_UNKNOWN: &str = "unknown";
pub const PROBE_OK: &str = "ok";
pub const PROBE_MISMATCH: &str = "mismatch";
pub const PROBE_UNREACHABLE: &str = "unreachable";

pub static METRICS: Lazy<Arc<Metrics>> = Lazy::new(|| Arc::new(Metrics::new()));

/// The health state of the listener as one value: the seven series are derived from it when the
/// registry is scraped, so a scrape never sees none or two of them at 1.
struct ListenerReady {
    series: IntGaugeVec,
    current: Mutex<Option<usize>>,
}

impl ListenerReady {
    fn new() -> Self {
        let help = "1 for the health state of this node's domain listener, 0 for every other.";
        Self {
            series: gauge("status_page_domain_listener_ready", help, &["reason"]),
            current: Mutex::new(None),
        }
    }
}

struct ReadyCollector(Arc<ListenerReady>);

impl Collector for ReadyCollector {
    fn desc(&self) -> Vec<&Desc> {
        self.0.series.desc()
    }

    fn collect(&self) -> Vec<MetricFamily> {
        let current = self
            .0
            .current
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let Some(at) = *current else {
            return Vec::new();
        };
        for (index, reason) in LISTENER_REASONS.iter().enumerate() {
            self.0
                .series
                .with_label_values(&[reason])
                .set(i64::from(index == at));
        }
        self.0.series.collect()
    }
}

/// Every series is created by its first write, so a node that writes none exports none: the OSS
/// build, proxy mode and an installation with custom domains off.
pub struct Metrics {
    cert_earliest_expiry: IntGaugeVec,
    store_size: IntGaugeVec,
    store_sync_age: IntGaugeVec,
    key_mismatch: IntGaugeVec,
    listener_ready: Arc<ListenerReady>,
    lease_age: IntGaugeVec,
    oldest_stuck: IntGaugeVec,
    domains: IntGaugeVec,
    order_failures: IntCounterVec,
    probe_results: IntCounterVec,
}

impl Metrics {
    pub fn new() -> Self {
        Self {
            cert_earliest_expiry: gauge(
                "status_page_domain_cert_earliest_expiry_seconds",
                "Unix time of the earliest certificate expiry in this node's store.",
                &[],
            ),
            store_size: gauge(
                "status_page_domain_store_size",
                "Certificates in this node's store.",
                &[],
            ),
            store_sync_age: gauge(
                "status_page_domain_store_sync_age_seconds",
                "Seconds since this node's store last synced with a matching key and epoch.",
                &[],
            ),
            key_mismatch: gauge(
                "status_page_domain_key_mismatch",
                "1 while this node's domain key differs from the stored check value.",
                &[],
            ),
            listener_ready: Arc::new(ListenerReady::new()),
            lease_age: gauge(
                "status_page_domain_lease_age_seconds",
                "Seconds since this node last renewed the domain manager's lease.",
                &[],
            ),
            oldest_stuck: gauge(
                "status_page_domain_oldest_stuck_seconds",
                "Seconds the oldest domain with its DNS record found has waited for a certificate.",
                &[],
            ),
            domains: gauge(
                "status_page_domains",
                "Custom domains that hold their hostname, by serving state.",
                &["state"],
            ),
            order_failures: counter(
                "status_page_domain_order_failures_total",
                "Certificate orders that failed, by reason.",
                &["reason"],
            ),
            probe_results: counter(
                "status_page_domain_probe_results_total",
                "Probe rounds of custom domains, by result.",
                &["result"],
            ),
        }
    }

    pub fn register(&self, registry: &Registry) {
        let gauges = [
            &self.cert_earliest_expiry,
            &self.store_size,
            &self.store_sync_age,
            &self.key_mismatch,
            &self.lease_age,
            &self.oldest_stuck,
            &self.domains,
        ];
        for gauge in gauges {
            registry
                .register(Box::new(gauge.clone()))
                .expect("Metric registered");
        }
        registry
            .register(Box::new(ReadyCollector(self.listener_ready.clone())))
            .expect("Metric registered");
        for counter in [&self.order_failures, &self.probe_results] {
            registry
                .register(Box::new(counter.clone()))
                .expect("Metric registered");
        }
    }

    /// The store after a load. An empty store has no expiry, so that series goes away with it.
    pub fn set_store(&self, size: usize, earliest_expiry_micros: Option<i64>) {
        only(&self.store_size).set(i64::try_from(size).unwrap_or(i64::MAX));
        match earliest_expiry_micros {
            Some(micros) => only(&self.cert_earliest_expiry).set(micros / 1_000_000),
            None => self.cert_earliest_expiry.reset(),
        }
    }

    pub fn set_key_mismatch(&self, mismatch: bool) {
        only(&self.key_mismatch).set(i64::from(mismatch));
    }

    pub fn set_store_sync_age(&self, seconds: i64) {
        only(&self.store_sync_age).set(seconds.max(0));
    }

    /// Exactly one series is 1; a reason outside `LISTENER_REASONS` changes nothing.
    pub fn set_listener_ready(&self, reason: &str) {
        if let Some(at) = LISTENER_REASONS.iter().position(|known| *known == reason) {
            *self
                .listener_ready
                .current
                .lock()
                .unwrap_or_else(PoisonError::into_inner) = Some(at);
        }
    }

    pub fn set_lease_age(&self, seconds: i64) {
        only(&self.lease_age).set(seconds.max(0));
    }

    pub fn set_oldest_stuck(&self, seconds: i64) {
        only(&self.oldest_stuck).set(seconds.max(0));
    }

    /// A node that lost the lease reports none of the manager's series: only the holder does.
    pub fn forget_manager(&self) {
        self.lease_age.reset();
        self.oldest_stuck.reset();
        self.domains.reset();
    }

    /// Holders by stored state; a state outside `DOMAIN_STATES` counts as `STATE_UNKNOWN`.
    pub fn set_domains<'a>(&self, counts: impl IntoIterator<Item = (Option<&'a str>, i64)>) {
        let mut by_state = [0_i64; DOMAIN_STATES.len()];
        let mut unknown = 0;
        for (state, count) in counts {
            match state.and_then(|state| DOMAIN_STATES.iter().position(|known| *known == state)) {
                Some(at) => by_state[at] += count,
                None => unknown += count,
            }
        }
        for (state, count) in DOMAIN_STATES.iter().zip(by_state) {
            self.domains.with_label_values(&[state]).set(count);
        }
        self.domains
            .with_label_values(&[STATE_UNKNOWN])
            .set(unknown);
    }

    pub fn order_failed(&self, reason: &str) {
        self.order_failures.with_label_values(&[reason]).inc();
    }

    pub fn probe_result(&self, result: &str) {
        self.probe_results.with_label_values(&[result]).inc();
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

pub(super) fn register(registry: &Registry) {
    METRICS.register(registry);
}

fn opts(name: &str, help: &str) -> Opts {
    Opts::new(name, help)
        .namespace(NAMESPACE)
        .const_labels(create_const_labels())
}

fn gauge(name: &str, help: &str, labels: &[&str]) -> IntGaugeVec {
    IntGaugeVec::new(opts(name, help), labels).expect("Metric created")
}

fn counter(name: &str, help: &str, labels: &[&str]) -> IntCounterVec {
    IntCounterVec::new(opts(name, help), labels).expect("Metric created")
}

/// The one series of a vector without labels, which exists from its first write on.
fn only(vec: &IntGaugeVec) -> prometheus::IntGauge {
    vec.with_label_values::<&str>(&[])
}

#[cfg(test)]
mod tests {
    use prometheus::{Encoder, TextEncoder};

    use super::*;

    const NAMES: [&str; 10] = [
        "zo_status_page_domain_cert_earliest_expiry_seconds",
        "zo_status_page_domain_store_size",
        "zo_status_page_domain_store_sync_age_seconds",
        "zo_status_page_domain_key_mismatch",
        "zo_status_page_domain_listener_ready",
        "zo_status_page_domain_lease_age_seconds",
        "zo_status_page_domain_oldest_stuck_seconds",
        "zo_status_page_domains",
        "zo_status_page_domain_order_failures_total",
        "zo_status_page_domain_probe_results_total",
    ];

    fn registered() -> (Metrics, Registry) {
        let metrics = Metrics::new();
        let registry = Registry::new();
        metrics.register(&registry);
        (metrics, registry)
    }

    fn text(registry: &Registry) -> String {
        let mut buffer = vec![];
        TextEncoder::new()
            .encode(&registry.gather(), &mut buffer)
            .unwrap();
        String::from_utf8(buffer).unwrap()
    }

    /// The value of the series `name` whose labels contain `label`.
    fn value(text: &str, name: &str, label: &str) -> Option<i64> {
        text.lines()
            .filter(|line| line.starts_with(&format!("{name}{{")) && line.contains(label))
            .find_map(|line| line.rsplit(' ').next()?.parse().ok())
    }

    fn write_all(metrics: &Metrics) {
        metrics.set_store(2, Some(1_800_000_000_000_000));
        metrics.set_key_mismatch(false);
        metrics.set_store_sync_age(5);
        metrics.set_listener_ready("ready");
        metrics.set_lease_age(7);
        metrics.set_oldest_stuck(0);
        metrics.set_domains([(Some("serving"), 1)]);
        metrics.order_failed("ca_dns");
        metrics.probe_result(PROBE_OK);
    }

    #[test]
    fn status_page_domain_metrics_export_nothing_until_they_are_written() {
        let (metrics, registry) = registered();
        assert!(!text(&registry).contains("status_page_domain"));

        write_all(&metrics);

        let text = text(&registry);
        for name in NAMES {
            assert!(
                text.contains(&format!("{name}{{")),
                "{name} missing:\n{text}"
            );
        }
    }

    #[test]
    fn status_page_domain_metrics_carry_only_reason_state_and_result_labels() {
        let (metrics, registry) = registered();
        write_all(&metrics);

        let allowed = ["cluster", "instance", "role", "reason", "state", "result"];
        for family in registry.gather() {
            for metric in family.get_metric() {
                for label in metric.get_label() {
                    let name = label.name();
                    assert!(allowed.contains(&name), "{name} on {}", family.name());
                }
            }
        }
    }

    #[test]
    fn a_scrape_during_changes_never_sees_none_or_two_listener_reasons() {
        let (metrics, registry) = registered();
        let metrics = Arc::new(metrics);
        metrics.set_listener_ready("ready");
        let writer = metrics.clone();
        let flipper = std::thread::spawn(move || {
            for round in 0..20_000 {
                writer.set_listener_ready(LISTENER_REASONS[round % LISTENER_REASONS.len()]);
            }
        });

        for _ in 0..2_000 {
            for family in registry.gather() {
                if family.name() != "zo_status_page_domain_listener_ready" {
                    continue;
                }
                let ones = family
                    .get_metric()
                    .iter()
                    .filter(|m| m.get_gauge().value() == 1.0);
                assert_eq!(family.get_metric().len(), 7);
                assert_eq!(ones.count(), 1);
            }
        }
        flipper.join().unwrap();
    }

    #[test]
    fn status_page_domain_listener_ready_has_one_series_at_one_for_each_reason() {
        let (metrics, registry) = registered();
        for reason in LISTENER_REASONS {
            metrics.set_listener_ready(reason);

            let text = text(&registry);
            let name = "zo_status_page_domain_listener_ready";
            let ones: Vec<&str> = LISTENER_REASONS
                .into_iter()
                .filter(|known| value(&text, name, &format!("reason=\"{known}\"")) == Some(1))
                .collect();
            assert_eq!(ones, [reason]);
        }
        metrics.set_listener_ready("status.example.com");
        assert!(!text(&registry).contains("status.example.com"));
    }

    #[test]
    fn status_page_domain_store_gauges_follow_the_store_and_an_empty_store_has_no_expiry() {
        let (metrics, registry) = registered();
        metrics.set_store(3, Some(1_800_000_000_500_000));

        let loaded = text(&registry);
        let expiry = "zo_status_page_domain_cert_earliest_expiry_seconds";
        assert_eq!(
            value(&loaded, "zo_status_page_domain_store_size", ""),
            Some(3)
        );
        assert_eq!(value(&loaded, expiry, ""), Some(1_800_000_000));

        metrics.set_store(0, None);

        let empty = text(&registry);
        assert_eq!(
            value(&empty, "zo_status_page_domain_store_size", ""),
            Some(0)
        );
        assert_eq!(value(&empty, expiry, ""), None);
    }

    #[test]
    fn status_page_domain_lease_age_is_reported_by_the_holder_only() {
        let (metrics, registry) = registered();
        let name = "zo_status_page_domain_lease_age_seconds";
        metrics.set_lease_age(40);
        metrics.set_oldest_stuck(9);
        metrics.set_domains([(Some("serving"), 1)]);
        assert_eq!(value(&text(&registry), name, ""), Some(40));

        metrics.forget_manager();

        let text = text(&registry);
        assert_eq!(value(&text, name, ""), None);
        assert!(!text.contains("zo_status_page_domain_oldest_stuck_seconds"));
        assert!(!text.contains("zo_status_page_domains{"));
    }

    #[test]
    fn status_page_domain_states_sum_to_the_holders_and_drop_to_zero_when_a_state_empties() {
        let (metrics, registry) = registered();
        let name = "zo_status_page_domains";
        let total = |text: &str| -> i64 {
            DOMAIN_STATES
                .into_iter()
                .chain([STATE_UNKNOWN])
                .filter_map(|state| value(text, name, &format!("state=\"{state}\"")))
                .sum()
        };
        metrics.set_domains([
            (Some("serving"), 4),
            (Some("not_serving"), 1),
            (None, 2),
            (Some("waiting_for_dns"), 1),
        ]);

        let first = text(&registry);
        assert_eq!(total(&first), 8);
        assert_eq!(value(&first, name, "state=\"unknown\""), Some(3));

        metrics.set_domains([(Some("serving"), 5)]);

        let second = text(&registry);
        assert_eq!(total(&second), 5);
        assert_eq!(value(&second, name, "state=\"not_serving\""), Some(0));
        assert!(!second.contains("waiting_for_dns"));
    }

    #[test]
    fn status_page_domain_counters_count_each_failure_and_each_probe_result() {
        let (metrics, registry) = registered();
        metrics.order_failed("ca_dns");
        metrics.order_failed("ca_dns");
        for result in [PROBE_OK, PROBE_MISMATCH, PROBE_UNREACHABLE] {
            metrics.probe_result(result);
        }

        let text = text(&registry);
        let failures = "zo_status_page_domain_order_failures_total";
        assert_eq!(value(&text, failures, "reason=\"ca_dns\""), Some(2));
        for result in [PROBE_OK, PROBE_MISMATCH, PROBE_UNREACHABLE] {
            let label = format!("result=\"{result}\"");
            let results = "zo_status_page_domain_probe_results_total";
            assert_eq!(value(&text, results, &label), Some(1));
        }
    }
}
