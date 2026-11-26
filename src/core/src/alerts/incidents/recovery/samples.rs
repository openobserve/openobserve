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

use config::meta::alerts::recovery::{Observation, Verdict};
use serde::{Deserialize, Serialize};

use super::{ApplyMetadata, Check, micros};

const SAMPLE_LIMIT: usize = 240;

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct Sample {
    pub ts: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    measured_at: Option<i64>,
    pub verdict: Verdict,
    #[serde(default)]
    pub verification_blocked: bool,
    pub value: Option<f64>,
    pub volume_pct: Option<f64>,
    pub cv: u64,
    pub generation: i64,
    pub eligible: bool,
}

impl Sample {
    pub(super) fn measurement_at(&self) -> i64 {
        self.measured_at.unwrap_or(self.ts)
    }
}

pub(in crate::alerts::incidents) fn last_measurement_at(check: &Check) -> Option<i64> {
    let samples = read(check).ok()?;
    let latest = samples.last()?;
    latest.value.map(|_| latest.measurement_at())
}

pub(super) fn read(check: &Check) -> anyhow::Result<Vec<Sample>> {
    Ok(serde_json::from_str(&check.recent_samples)?)
}

pub(super) fn record(
    check: &mut Check,
    mut samples: Vec<Sample>,
    observation: &Observation,
    metadata: ApplyMetadata,
    interval: i64,
) -> anyhow::Result<Vec<Sample>> {
    let timely = samples
        .last()
        .is_none_or(|last| fresh(last.ts, observation.sample_ts, interval));
    let above_floor = check.baseline_volume.is_none_or(|baseline| {
        baseline <= 0.0
            || observation
                .volume_pct
                .is_some_and(|pct| pct >= f64::from(check.volume_floor_pct))
    });
    let eligible = timely && above_floor && observation.verdict.has_signal();
    let verdict = if !above_floor && observation.verdict.has_signal() {
        Verdict::LowTraffic
    } else {
        observation.verdict.clone()
    };
    let measure: serde_json::Value = serde_json::from_str(&check.measure)?;
    samples.push(Sample {
        ts: observation.sample_ts,
        measured_at: metadata.measured_at,
        verdict,
        verification_blocked: metadata.verification_blocked,
        value: observation.value,
        volume_pct: observation.volume_pct,
        cv: measure["cv"].as_u64().unwrap_or(1),
        generation: observation.generation,
        eligible,
    });
    if samples.len() > SAMPLE_LIMIT {
        samples.drain(..samples.len() - SAMPLE_LIMIT);
    }
    check.recent_samples = serde_json::to_string(&samples)?;
    check.last_checked_at = Some(observation.sample_ts);
    check.last_value = observation.value;
    Ok(samples)
}

pub(super) fn fresh(at: i64, now: i64, interval: i64) -> bool {
    at <= now && now.saturating_sub(at) <= 2 * interval
}

pub(super) fn current<'a>(check: &Check, samples: &'a [Sample]) -> Option<&'a Sample> {
    samples
        .last()
        .filter(|sample| sample.generation == check.generation)
}

pub(super) fn breach_pair(check: &Check, samples: &[Sample], interval: i64) -> bool {
    let [.., previous, latest] = samples else {
        return false;
    };
    [previous, latest].into_iter().all(|sample| {
        sample.generation == check.generation
            && sample.eligible
            && sample.verdict == Verdict::Breach
    }) && fresh(previous.ts, latest.ts, interval)
}

pub(super) fn extend_soak(check: &mut Check, samples: &[Sample]) {
    let (Some(until), Some(verified), [.., previous, latest]) =
        (check.soak_until, check.verified_at, samples)
    else {
        return;
    };
    let previous_eligible = previous.eligible || previous.verdict == Verdict::Pass;
    let previous_eligible = previous_eligible && previous.ts <= verified || previous.eligible;
    if !previous_eligible || !latest.eligible {
        check.soak_until = Some(until.saturating_add(latest.ts - previous.ts.max(verified)));
    }
}

pub(super) fn soak_pause(check: &Check, samples: &[Sample], now: i64, interval: i64) -> i64 {
    let (Some(until), Some(verified)) = (check.soak_until, check.verified_at) else {
        return 0;
    };
    let latest = samples.last();
    let latest_at = latest.map_or(verified, |sample| sample.ts.max(verified));
    let ongoing = if latest.is_some_and(|sample| sample.eligible && fresh(sample.ts, now, interval))
    {
        0
    } else {
        now.saturating_sub(latest_at).max(0)
    };
    until - verified - micros(i64::from(check.soak_secs)) + ongoing
}
