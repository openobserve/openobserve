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
