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

//! The trusted recovery probe: OO, not the agent, decides whether traffic recovered before a
//! verdict may page quieter. Thresholds are provisional spike parameters.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{CallCoverage, Num, TimeWindow};
use crate::meta::oncall::{
    agent::RecoveryVerdict,
    confidence::{SignalClass, ToolCallRecord},
    rca_run::EvidenceTarget,
};

/// The recent window ends at finalization and spans this long.
pub const RECOVERY_WINDOW_US: i64 = 15 * 60 * 1_000_000;
/// The baseline is this long, ending at onset.
pub const RECOVERY_BASELINE_US: i64 = 30 * 60 * 1_000_000;
/// Recent requests must be at least this share of the baseline's.
pub const MIN_TRAFFIC_SHARE: f64 = 0.5;
/// Recent error rate may exceed the baseline's by at most one percentage point.
pub const MAX_ERROR_RATE_RISE: f64 = 0.01;
/// Recent p95 may be at most this multiple of the baseline's.
pub const MAX_P95_RATIO: f64 = 1.2;
/// The call id and tool of the probe's retained cited call.
pub const RECOVERY_PROBE_CALL_ID: &str = "o2_recovery_probe";
pub const RECOVERY_PROBE_TOOL: &str = "RecoveryProbe";

/// Requests, errors and p95 of one service's entry spans in one window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct TrafficSample {
    pub requests: u64,
    pub errors: u64,
    /// µs; `None` when there were no requests.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub p95_us: Option<Num>,
    /// The search reported every row (`is_partial: false`).
    pub complete: bool,
}

impl TrafficSample {
    fn error_rate(&self) -> f64 {
        if self.requests == 0 {
            0.0
        } else {
            self.errors as f64 / self.requests as f64
        }
    }
}

/// One affected service's probe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ServiceRecovery {
    pub service: String,
    pub verdict: RecoveryVerdict,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recent: Option<TrafficSample>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline: Option<TrafficSample>,
}

/// The probe of one run, persisted in its record and cited as a call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RecoveryProbe {
    pub verdict: RecoveryVerdict,
    /// Trusted finalization time, µs.
    pub at_us: i64,
    pub window: TimeWindow,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline: Option<TimeWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    /// The SQL each window ran, with `{service}` for the service.
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub services: Vec<ServiceRecovery>,
    /// Why the probe could not run, when it is `unknown` without samples.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl RecoveryProbe {
    /// A probe that could not run; it never lets a verdict page quieter.
    pub fn unknown(at_us: i64, reason: &str) -> Self {
        Self {
            verdict: RecoveryVerdict::Unknown,
            at_us,
            window: recent_window(at_us),
            baseline: None,
            stream: None,
            query: String::new(),
            services: Vec::new(),
            reason: Some(reason.to_string()),
        }
    }

    /// From per-service probes: every service healthy, else the worst finding.
    pub fn of(
        at_us: i64,
        baseline: Option<TimeWindow>,
        stream: Option<String>,
        query: String,
        services: Vec<ServiceRecovery>,
    ) -> Self {
        let verdict = overall(&services);
        Self {
            verdict,
            at_us,
            window: recent_window(at_us),
            baseline,
            stream,
            query,
            services,
            reason: None,
        }
    }

    /// The probe as a retained cited call, so the record shows what OO read.
    pub fn cited_call(&self) -> ToolCallRecord {
        let complete = !self.services.is_empty()
            && self
                .services
                .iter()
                .flat_map(|s| [s.recent, s.baseline])
                .all(|sample| sample.is_some_and(|s| s.complete));
        ToolCallRecord {
            call_id: RECOVERY_PROBE_CALL_ID.to_string(),
            tool: RECOVERY_PROBE_TOOL.to_string(),
            key_arg: self.query.clone(),
            stream_type: Some("traces".to_string()),
            success: self.reason.is_none(),
            result_count: Some(self.services.len() as u64),
            started_at_us: self.at_us,
            duration_ms: 0,
            error_type: self.reason.clone(),
            // Context: the probe gates paging, never the band.
            signal: SignalClass::Context,
            target: EvidenceTarget {
                signal: SignalClass::Context,
                streams: self.stream.iter().cloned().collect(),
                sql: (!self.query.is_empty()).then(|| self.query.clone()),
                promql: None,
                filter: None,
                start_us: Some(self.window.start),
                end_us: Some(self.window.end),
                command: None,
            },
            observed: None,
            result_summary: format!("recovery {}", self.verdict.as_str()),
            coverage: CallCoverage {
                effective_window: Some(self.window),
                is_partial: Some(!complete),
                ..Default::default()
            },
        }
    }
}

/// `[at - 15 min, at]`.
pub fn recent_window(at_us: i64) -> TimeWindow {
    TimeWindow {
        start: at_us.saturating_sub(RECOVERY_WINDOW_US),
        end: at_us,
    }
}

/// The 30 minutes before onset, floored at the epoch.
pub fn baseline_window(onset_us: i64) -> TimeWindow {
    TimeWindow {
        start: onset_us.saturating_sub(RECOVERY_BASELINE_US).max(0),
        end: onset_us,
    }
}

/// One service: healthy needs complete samples, recent requests at least half the baseline's,
/// error rate at most one point higher and p95 at most 1.2 times the baseline's.
pub fn judge(recent: Option<&TrafficSample>, baseline: Option<&TrafficSample>) -> RecoveryVerdict {
    let (Some(recent), Some(baseline)) = (recent, baseline) else {
        return RecoveryVerdict::Unknown;
    };
    if !recent.complete || !baseline.complete || baseline.requests == 0 {
        return RecoveryVerdict::Unknown;
    }
    if (recent.requests as f64) < MIN_TRAFFIC_SHARE * baseline.requests as f64 {
        return RecoveryVerdict::NoTraffic;
    }
    let errors_ok = recent.error_rate() <= baseline.error_rate() + MAX_ERROR_RATE_RISE;
    let latency_ok = match (recent.p95_us, baseline.p95_us) {
        (Some(now), Some(before)) => now.0 <= MAX_P95_RATIO * before.0,
        _ => false,
    };
    if errors_ok && latency_ok {
        RecoveryVerdict::Healthy
    } else {
        RecoveryVerdict::Failing
    }
}

/// Every service healthy; else failing, then no traffic, then unknown wins.
fn overall(services: &[ServiceRecovery]) -> RecoveryVerdict {
    if services.is_empty() {
        return RecoveryVerdict::Unknown;
    }
    let any = |v: RecoveryVerdict| services.iter().any(|s| s.verdict == v);
    if any(RecoveryVerdict::Failing) {
        RecoveryVerdict::Failing
    } else if any(RecoveryVerdict::NoTraffic) {
        RecoveryVerdict::NoTraffic
    } else if any(RecoveryVerdict::Unknown) {
        RecoveryVerdict::Unknown
    } else {
        RecoveryVerdict::Healthy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(requests: u64, errors: u64, p95_ms: f64, complete: bool) -> TrafficSample {
        TrafficSample {
            requests,
            errors,
            p95_us: (requests > 0).then_some(Num(p95_ms * 1000.0)),
            complete,
        }
    }

    /// Otherwise identical healthy, still-failing and zero-traffic probes; partial is unknown.
    #[test]
    fn the_probe_tells_recovery_from_failing_and_absent_traffic() {
        let baseline = sample(1000, 10, 200.0, true);
        let healthy = sample(900, 12, 220.0, true);
        let failing = sample(900, 300, 220.0, true);
        let slow = sample(900, 12, 900.0, true);
        let idle = sample(0, 0, 0.0, true);
        let thin = sample(400, 0, 200.0, true);
        let partial = sample(900, 12, 220.0, false);
        use RecoveryVerdict::*;
        assert_eq!(judge(Some(&healthy), Some(&baseline)), Healthy);
        assert_eq!(judge(Some(&failing), Some(&baseline)), Failing);
        assert_eq!(judge(Some(&slow), Some(&baseline)), Failing);
        assert_eq!(judge(Some(&idle), Some(&baseline)), NoTraffic);
        assert_eq!(judge(Some(&thin), Some(&baseline)), NoTraffic);
        assert_eq!(judge(Some(&partial), Some(&baseline)), Unknown);
        assert_eq!(judge(Some(&healthy), None), Unknown);
        assert_eq!(judge(Some(&healthy), Some(&idle)), Unknown, "no baseline");
    }

    #[test]
    fn the_run_is_healthy_only_when_every_service_is() {
        let svc = |name: &str, verdict| ServiceRecovery {
            service: name.into(),
            verdict,
            recent: None,
            baseline: None,
        };
        use RecoveryVerdict::*;
        let of = |services| RecoveryProbe::of(100, None, None, String::new(), services).verdict;
        assert_eq!(of(vec![svc("a", Healthy), svc("b", Healthy)]), Healthy);
        assert_eq!(of(vec![svc("a", Healthy), svc("b", Unknown)]), Unknown);
        assert_eq!(of(vec![svc("a", NoTraffic), svc("b", Unknown)]), NoTraffic);
        assert_eq!(of(vec![svc("a", NoTraffic), svc("b", Failing)]), Failing);
        assert_eq!(of(vec![]), Unknown, "traceless or no trusted services");

        let probe = RecoveryProbe::unknown(RECOVERY_WINDOW_US * 2, "no traces stream");
        let call = probe.cited_call();
        assert_eq!(call.call_id, RECOVERY_PROBE_CALL_ID);
        assert!(!call.success);
        assert_eq!(call.coverage.is_partial, Some(true));
        assert_eq!(
            call.coverage.effective_window,
            Some(TimeWindow {
                start: RECOVERY_WINDOW_US,
                end: RECOVERY_WINDOW_US * 2
            })
        );
    }
}
