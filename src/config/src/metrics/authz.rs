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

use std::sync::LazyLock as Lazy;

use prometheus::{HistogramOpts, HistogramVec, IntCounterVec, Opts};

use super::{NAMESPACE, create_const_labels};

pub static AUTHZ_OPENFGA_CALLS_PER_REQUEST: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "authz_openfga_calls_per_request",
            "OpenFGA calls one HTTP request sent.",
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.0, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0, 256.0, 1024.0, 4096.0,
        ])
        .const_labels(create_const_labels()),
        &["route"],
    )
    .expect("Metric created")
});

pub static AUTHZ_OPENFGA_REQUESTS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_openfga_requests_total",
            "OpenFGA requests sent, by operation and outcome.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["op", "outcome"],
    )
    .expect("Metric created")
});

pub static AUTHZ_OPENFGA_REQUEST_DURATION_SECONDS: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "authz_openfga_request_duration_seconds",
            "Duration of one OpenFGA request.",
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
        ])
        .const_labels(create_const_labels()),
        &["op"],
    )
    .expect("Metric created")
});

pub static AUTHZ_STRATEGY_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_strategy_total",
            "How a stream list authorization answered each stream type.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["site", "strategy"],
    )
    .expect("Metric created")
});

pub static AUTHZ_OBJECTS_AUTHORIZED: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "authz_objects_authorized",
            "Objects one stream list authorization was asked about.",
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.0, 1.0, 10.0, 100.0, 500.0, 1000.0, 2500.0, 5000.0, 10000.0, 50000.0,
        ])
        .const_labels(create_const_labels()),
        &["site"],
    )
    .expect("Metric created")
});

pub static AUTHZ_FALLBACK_CHECKS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_fallback_checks_total",
            "Per-object Checks a stream list authorization sent.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["site"],
    )
    .expect("Metric created")
});

pub static AUTHZ_UNAVAILABLE_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_unavailable_total",
            "Requests answered 503 because OpenFGA gave no answer.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["site", "reason"],
    )
    .expect("Metric created")
});

pub static AUTHZ_LIST_SHADOW_MISMATCH_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_list_shadow_mismatch_total",
            "Shadow comparisons where the type-level path disagreed with the per-stream path.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["site", "type", "direction"],
    )
    .expect("Metric created")
});

pub static AUTHZ_LIST_SHADOW_COMPARED_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_list_shadow_compared_total",
            "Shadow comparisons where both paths answered, by stream type strategy.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["site", "strategy"],
    )
    .expect("Metric created")
});

pub static AUTHZ_LIST_SHADOW_SKIPPED_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_list_shadow_skipped_total",
            "Sampled shadow calls that were not compared.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["site", "reason"],
    )
    .expect("Metric created")
});

pub static AUTHZ_CHECK_BUDGET_EXCEEDED_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "authz_check_budget_exceeded_total",
            "HTTP requests that sent more OpenFGA calls than the per-request budget.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["route"],
    )
    .expect("Metric created")
});

pub(super) fn register(registry: &prometheus::Registry) {
    registry
        .register(Box::new(AUTHZ_OPENFGA_CALLS_PER_REQUEST.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_OPENFGA_REQUESTS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_OPENFGA_REQUEST_DURATION_SECONDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_STRATEGY_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_OBJECTS_AUTHORIZED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_FALLBACK_CHECKS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_UNAVAILABLE_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_LIST_SHADOW_MISMATCH_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_LIST_SHADOW_COMPARED_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_LIST_SHADOW_SKIPPED_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(AUTHZ_CHECK_BUDGET_EXCEEDED_TOTAL.clone()))
        .expect("Metric registered");
}

#[cfg(test)]
mod tests {
    use prometheus::{Encoder, Registry, TextEncoder};

    use super::*;

    #[test]
    fn every_authz_metric_registers_under_the_zo_namespace() {
        let registry = Registry::new();
        register(&registry);
        AUTHZ_OPENFGA_CALLS_PER_REQUEST
            .with_label_values(&["/api/{org_id}/service_streams"])
            .observe(12.0);
        AUTHZ_OPENFGA_REQUESTS_TOTAL
            .with_label_values(&["check", "allow"])
            .inc();
        AUTHZ_OPENFGA_REQUEST_DURATION_SECONDS
            .with_label_values(&["list"])
            .observe(0.2);
        AUTHZ_STRATEGY_TOTAL
            .with_label_values(&["service_streams", "list"])
            .inc();
        AUTHZ_OBJECTS_AUTHORIZED
            .with_label_values(&["service_streams"])
            .observe(2858.0);
        AUTHZ_FALLBACK_CHECKS_TOTAL
            .with_label_values(&["service_streams"])
            .inc();
        AUTHZ_UNAVAILABLE_TOTAL
            .with_label_values(&["service_streams", "timeout"])
            .inc();
        AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
            .with_label_values(&["service_streams", "logs", "new_allows_more"])
            .inc();
        AUTHZ_LIST_SHADOW_COMPARED_TOTAL
            .with_label_values(&["service_streams", "list"])
            .inc();
        AUTHZ_LIST_SHADOW_SKIPPED_TOTAL
            .with_label_values(&["service_streams", "busy"])
            .inc();
        AUTHZ_CHECK_BUDGET_EXCEEDED_TOTAL
            .with_label_values(&["/api/{org_id}/service_streams"])
            .inc();

        let mut buffer = vec![];
        TextEncoder::new()
            .encode(&registry.gather(), &mut buffer)
            .unwrap();
        let text = String::from_utf8(buffer).unwrap();
        for name in [
            "zo_authz_openfga_calls_per_request_bucket{",
            "zo_authz_openfga_requests_total{",
            "zo_authz_openfga_request_duration_seconds_bucket{",
            "zo_authz_strategy_total{",
            "zo_authz_objects_authorized_bucket{",
            "zo_authz_fallback_checks_total{",
            "zo_authz_unavailable_total{",
            "zo_authz_list_shadow_mismatch_total{",
            "zo_authz_list_shadow_compared_total{",
            "zo_authz_list_shadow_skipped_total{",
            "zo_authz_check_budget_exceeded_total{",
        ] {
            assert!(text.contains(name), "{name} missing from:\n{text}");
        }
        assert!(text.contains(r#"route="/api/{org_id}/service_streams""#));
        assert!(text.contains(r#"op="list""#));
        assert!(text.contains("le="));
    }
}
