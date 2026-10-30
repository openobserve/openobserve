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

use prometheus::{IntCounterVec, IntGaugeVec, Opts};

use super::{NAMESPACE, create_const_labels};

pub static SLACK_SOCKETS_UP: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("slack_sockets_up", "Open Slack Socket Mode connections.")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["installation"],
    )
    .expect("Metric created")
});

pub static SLACK_LAST_EVENT_AGE_SECONDS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "slack_last_event_age_seconds",
            "Seconds since the last Slack event of an installation.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["installation"],
    )
    .expect("Metric created")
});

pub static SLACK_API_429_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "slack_api_429_total",
            "Slack Web API calls answered with HTTP 429.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["method"],
    )
    .expect("Metric created")
});

pub static SLACK_SEND_FAILURES_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "slack_send_failures_total",
            "Messages O2 failed to post or update in Slack.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["reason"],
    )
    .expect("Metric created")
});

pub static SLACK_INBOUND_EVENTS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "slack_inbound_events_total",
            "Slack events, commands and interactions received.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["type", "result"],
    )
    .expect("Metric created")
});

pub static SLACK_TURNS_INFLIGHT: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "slack_turns_inflight",
            "Assistant turns running for Slack questions.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static SLACK_OUTBOUND_DEPTH: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "slack_outbound_depth",
            "Alert messages queued for Slack per installation.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["installation"],
    )
    .expect("Metric created")
});

pub static SLACK_OUTBOUND_OLDEST_AGE_SECONDS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "slack_outbound_oldest_age_seconds",
            "Age of the oldest alert message queued for Slack per installation.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["installation"],
    )
    .expect("Metric created")
});

pub static SLACK_OUTBOUND_DIGEST_CHANNELS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "slack_outbound_digest_channels",
            "Channels currently folding alert messages into a digest per installation.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["installation"],
    )
    .expect("Metric created")
});

pub(super) fn register(registry: &prometheus::Registry) {
    registry
        .register(Box::new(SLACK_SOCKETS_UP.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_LAST_EVENT_AGE_SECONDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_API_429_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_SEND_FAILURES_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_INBOUND_EVENTS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_TURNS_INFLIGHT.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_OUTBOUND_DEPTH.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_OUTBOUND_OLDEST_AGE_SECONDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SLACK_OUTBOUND_DIGEST_CHANNELS.clone()))
        .expect("Metric registered");
}

#[cfg(test)]
mod tests {
    use prometheus::{Encoder, Registry, TextEncoder};

    use super::*;

    #[test]
    fn every_slack_metric_registers_under_the_zo_namespace() {
        let registry = Registry::new();
        register(&registry);
        SLACK_SOCKETS_UP.with_label_values(&["i1"]).set(2);
        SLACK_LAST_EVENT_AGE_SECONDS
            .with_label_values(&["i1"])
            .set(5);
        SLACK_API_429_TOTAL
            .with_label_values(&["chat.postMessage"])
            .inc();
        SLACK_SEND_FAILURES_TOTAL
            .with_label_values(&["rate_limited"])
            .inc();
        SLACK_INBOUND_EVENTS_TOTAL
            .with_label_values(&["event", "accepted"])
            .inc();
        SLACK_TURNS_INFLIGHT.with_label_values(&["acme"]).set(1);
        SLACK_OUTBOUND_DEPTH.with_label_values(&["i1"]).set(3);
        SLACK_OUTBOUND_OLDEST_AGE_SECONDS
            .with_label_values(&["i1"])
            .set(40);
        SLACK_OUTBOUND_DIGEST_CHANNELS
            .with_label_values(&["i1"])
            .set(1);

        let mut buffer = vec![];
        TextEncoder::new()
            .encode(&registry.gather(), &mut buffer)
            .unwrap();
        let text = String::from_utf8(buffer).unwrap();
        for name in [
            "zo_slack_sockets_up{",
            "zo_slack_last_event_age_seconds{",
            "zo_slack_api_429_total{",
            "zo_slack_send_failures_total{",
            "zo_slack_inbound_events_total{",
            "zo_slack_turns_inflight{",
            "zo_slack_outbound_depth{",
            "zo_slack_outbound_oldest_age_seconds{",
            "zo_slack_outbound_digest_channels{",
        ] {
            assert!(text.contains(name), "{name} missing from:\n{text}");
        }
    }
}
