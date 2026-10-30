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

//! Online eval job health as run state, folded per pass like `alerts::state`.

use serde::{Deserialize, Serialize};

/// How an online eval job is running, as of the last health pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalJobHealth {
    Healthy,
    /// More than 20% of at least 5 recent scorer runs failed.
    Degraded,
    /// The newest scorer outcome is a `provider_auth` error.
    WaitingForCredentials,
    /// No scorer ran in the recent window.
    NoRecentRuns,
}

impl EvalJobHealth {
    /// Persisted in `eval_job_states`; never reorder or reuse these ids.
    pub const fn to_i32(self) -> i32 {
        match self {
            Self::Healthy => 0,
            Self::Degraded => 1,
            Self::WaitingForCredentials => 2,
            Self::NoRecentRuns => 3,
        }
    }

    pub const fn from_i32(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::Healthy),
            1 => Some(Self::Degraded),
            2 => Some(Self::WaitingForCredentials),
            3 => Some(Self::NoRecentRuns),
            _ => None,
        }
    }
}

/// The newest failed scorer run a health pass saw.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvalJobLastError {
    /// `EvalErrorKind` wire string, e.g. `provider_auth`.
    pub kind: String,
    pub message: String,
    /// `_timestamp` of the error span, in microseconds.
    pub at: i64,
}

/// What one health pass measured for one job.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvalJobHealthObservation {
    pub health: EvalJobHealth,
    /// Scorer runs in the recent window.
    pub recent_runs: u64,
    /// Failed scorer runs in the recent window.
    pub recent_errors: u64,
    /// Successful scorer runs over the lookback.
    pub scores_24h: u64,
    /// `_timestamp` of the newest successful scorer span, in microseconds.
    pub last_success_at: Option<i64>,
    pub last_error: Option<EvalJobLastError>,
}

impl EvalJobHealthObservation {
    /// A job the pass found no scorer spans for.
    pub fn no_runs() -> Self {
        Self {
            health: EvalJobHealth::NoRecentRuns,
            recent_runs: 0,
            recent_errors: 0,
            scores_24h: 0,
            last_success_at: None,
            last_error: None,
        }
    }
}

/// Current health of one job. No row means the job was never measured.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvalJobState {
    pub job_id: String,
    pub org_id: String,
    pub health: EvalJobHealth,
    /// When `health` last changed, not when it was last measured.
    pub since: i64,
    /// When the last health pass measured this job.
    pub evaluated_at: i64,
    pub recent_runs: u64,
    pub recent_errors: u64,
    pub scores_24h: u64,
    pub last_success_at: Option<i64>,
    pub last_error: Option<EvalJobLastError>,
}

/// An append-only health change, written to `eval_job_state_transitions`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvalJobStateTransition {
    pub job_id: String,
    pub org_id: String,
    /// `None` on a job's first measurement.
    pub from_health: Option<EvalJobHealth>,
    pub to_health: EvalJobHealth,
    pub at: i64,
}

/// What [`apply_health`] decided to write.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvalJobStateUpdate {
    pub state: EvalJobState,
    /// Emitted only when the health changed.
    pub transition: Option<EvalJobStateTransition>,
}

/// Moves `since` and emits a transition only when health changes, so transitions grow with changes,
/// not passes.
pub fn apply_health(
    job_id: &str,
    org_id: &str,
    prev: Option<&EvalJobState>,
    observation: EvalJobHealthObservation,
    at: i64,
) -> EvalJobStateUpdate {
    let previous = prev.map(|p| p.health);
    let changed = previous != Some(observation.health);
    let since = match prev {
        Some(p) if !changed => p.since,
        _ => at,
    };
    let transition = changed.then(|| EvalJobStateTransition {
        job_id: job_id.to_string(),
        org_id: org_id.to_string(),
        from_health: previous,
        to_health: observation.health,
        at,
    });
    EvalJobStateUpdate {
        state: EvalJobState {
            job_id: job_id.to_string(),
            org_id: org_id.to_string(),
            health: observation.health,
            since,
            evaluated_at: at,
            recent_runs: observation.recent_runs,
            recent_errors: observation.recent_errors,
            scores_24h: observation.scores_24h,
            last_success_at: observation.last_success_at,
            last_error: observation.last_error,
        },
        transition,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observed(health: EvalJobHealth, recent_runs: u64) -> EvalJobHealthObservation {
        EvalJobHealthObservation {
            health,
            recent_runs,
            ..EvalJobHealthObservation::no_runs()
        }
    }

    #[test]
    fn first_measurement_starts_the_clock_and_records_a_transition() {
        let update = apply_health(
            "job-1",
            "org",
            None,
            observed(EvalJobHealth::Healthy, 10),
            100,
        );
        assert_eq!(update.state.since, 100);
        assert_eq!(update.state.evaluated_at, 100);
        assert_eq!(
            update.transition,
            Some(EvalJobStateTransition {
                job_id: "job-1".to_string(),
                org_id: "org".to_string(),
                from_health: None,
                to_health: EvalJobHealth::Healthy,
                at: 100,
            })
        );
    }

    #[test]
    fn repeated_health_keeps_since_and_writes_no_transition() {
        let prev = apply_health(
            "job-1",
            "org",
            None,
            observed(EvalJobHealth::Degraded, 10),
            100,
        )
        .state;
        let update = apply_health(
            "job-1",
            "org",
            Some(&prev),
            observed(EvalJobHealth::Degraded, 12),
            200,
        );
        assert_eq!(update.state.since, 100);
        assert_eq!(update.state.evaluated_at, 200);
        assert_eq!(update.state.recent_runs, 12);
        assert!(update.transition.is_none());
    }

    #[test]
    fn changed_health_moves_since_and_records_where_it_came_from() {
        let prev = apply_health(
            "job-1",
            "org",
            None,
            observed(EvalJobHealth::Healthy, 10),
            100,
        )
        .state;
        let update = apply_health(
            "job-1",
            "org",
            Some(&prev),
            observed(EvalJobHealth::WaitingForCredentials, 3),
            300,
        );
        assert_eq!(update.state.since, 300);
        let transition = update.transition.expect("health changed");
        assert_eq!(transition.from_health, Some(EvalJobHealth::Healthy));
        assert_eq!(transition.to_health, EvalJobHealth::WaitingForCredentials);
        assert_eq!(transition.at, 300);
    }

    #[test]
    fn storage_ids_are_pinned() {
        for (health, id) in [
            (EvalJobHealth::Healthy, 0),
            (EvalJobHealth::Degraded, 1),
            (EvalJobHealth::WaitingForCredentials, 2),
            (EvalJobHealth::NoRecentRuns, 3),
        ] {
            assert_eq!(health.to_i32(), id);
            assert_eq!(EvalJobHealth::from_i32(id), Some(health));
        }
        assert_eq!(EvalJobHealth::from_i32(4), None);
    }
}
