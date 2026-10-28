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

//! Persisted analysis runs and the latest-run summary shown on incidents.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::incidents::AnalysisTriggerType;

/// Number of stages an analysis run reports progress through.
pub const RCA_STAGE_COUNT: u8 = 7;

pub const STALE_GRACE_SECS: u64 = 120;

/// `topology_context` key of the newest report written before analysis runs existed.
pub const V1_REPORT_KEY: &str = "suggested_root_cause";
/// `topology_context` key of the older pre-run reports, newest first.
pub const V1_PREVIOUS_REPORTS_KEY: &str = "previous_analyses";
const V1_RUN_ID_PREFIX: &str = "v1-";
const V1_STARTED_BY: &str = "system";

/// Declares a snake_case string enum with `as_str`, `Display` and `FromStr`.
macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($(#[$vmeta:meta])* $variant:ident => $s:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, ToSchema)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($(#[$vmeta])* $variant),+
        }

        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self {
                    $(Self::$variant => $s),+
                }
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl std::str::FromStr for $name {
            type Err = String;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s {
                    $($s => Ok(Self::$variant),)+
                    other => Err(format!(concat!("unknown ", stringify!($name), ": {}"), other)),
                }
            }
        }
    };
}
pub(super) use string_enum;

string_enum! {
    /// State of one analysis run. `stale` is computed, not a state.
    RunState {
        Running => "running",
        WaitingInput => "waiting_input",
        Completed => "completed",
        Failed => "failed",
        Cancelled => "cancelled",
    }
}

impl RunState {
    /// `running` or `waiting_input`.
    pub fn is_live(&self) -> bool {
        matches!(self, Self::Running | Self::WaitingInput)
    }

    /// A terminal state never changes.
    pub fn is_terminal(&self) -> bool {
        !self.is_live()
    }
}

string_enum! {
    /// What started a run.
    RunTrigger {
        AutoNewIncident => "auto_new_incident",
        AutoNewAlertType => "auto_new_alert_type",
        AutoReopen => "auto_reopen",
        Manual => "manual",
        Reanalyze => "reanalyze",
        OncallPage => "oncall_page",
        Resume => "resume",
        /// A report kept from before analysis runs existed ([ReportFormat::V1]).
        Legacy => "legacy",
    }
}

impl RunTrigger {
    /// The trigger label the `AIAnalysisFailed` event carries.
    pub fn analysis_trigger_type(&self) -> AnalysisTriggerType {
        match self {
            Self::AutoNewIncident => AnalysisTriggerType::AutomaticNewIncident,
            Self::AutoNewAlertType => AnalysisTriggerType::AutomaticReanalysis,
            Self::AutoReopen => AnalysisTriggerType::AutomaticReopened,
            Self::Manual | Self::Reanalyze | Self::OncallPage | Self::Resume | Self::Legacy => {
                AnalysisTriggerType::Manual
            }
        }
    }

    /// Runs a user started; they skip the cooldown and never consult L0.
    pub fn is_user_started(&self) -> bool {
        matches!(self, Self::Manual | Self::Reanalyze | Self::Resume)
    }
}

string_enum! {
    RunMode {
        Fresh => "fresh",
        BuildOnPrevious => "build_on_previous",
    }
}

string_enum! {
    RunSubjectType {
        Incident => "incident",
        Alert => "alert",
    }
}

string_enum! {
    /// Where a report lives: `v1` in pre-run `topology_context`, `v2` in an `rca_runs` row.
    ReportFormat {
        V1 => "v1",
        V2 => "v2",
    }
}

/// `rca_runs.error` of a `failed` run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunError {
    pub code: String,
    pub reason: String,
    #[serde(default)]
    pub details: Option<String>,
    #[serde(default)]
    pub trigger_type: Option<String>,
}

/// `rca_runs.stats`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RunStats {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steered: Option<u32>,
    /// Acks after the first for the same steering row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignored_acks: Option<u32>,
}

/// The newest usable result of an earlier run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct PreviousResult {
    pub run_id: String,
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default)]
    pub confidence: Option<String>,
    pub ended_at: i64,
}

/// The `alert_incidents.rca_summary` JSON: display-only fields of the latest run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
#[serde(default)]
pub struct RunSummaryFields {
    pub stage: Option<String>,
    pub stage_index: Option<u8>,
    pub stage_count: u8,
    pub steps: u32,
    pub tool_calls: u32,
    /// Finished steps a Resume of the ended run keeps; `None` before the run ends.
    pub reusable_steps: Option<u32>,
    /// Up to three users who steered the latest run, newest first.
    pub steered_by: Vec<String>,
    pub unblocked_by: Option<String>,
    /// One short line for the list cell (the failure reason).
    pub detail: Option<String>,
    /// Answer deadline of a `waiting_input` run, µs.
    pub deadline_at: Option<i64>,
    /// Who cancelled the latest run (display only).
    pub cancelled_by: Option<String>,
    pub previous: Option<PreviousResult>,
}

impl Default for RunSummaryFields {
    fn default() -> Self {
        Self {
            stage: None,
            stage_index: None,
            stage_count: RCA_STAGE_COUNT,
            steps: 0,
            tool_calls: 0,
            reusable_steps: None,
            steered_by: Vec::new(),
            unblocked_by: None,
            detail: None,
            deadline_at: None,
            cancelled_by: None,
            previous: None,
        }
    }
}

/// Run summary of an incident's latest run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RcaSummary {
    pub run_id: String,
    pub report_format: ReportFormat,
    pub state: RunState,
    /// Computed by the server.
    pub stale: bool,
    pub started_at: i64,
    pub updated_at: i64,
    pub outcome: Option<String>,
    pub confidence: Option<String>,
    pub summary: RunSummaryFields,
    /// Filled by the detail endpoint only.
    #[serde(flatten, default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<RcaDetailFields>,
}

/// The detail endpoint's run fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RcaDetailFields {
    /// The latest run, without its report.
    pub current_run: Option<RcaRun>,
    /// The newest `completed` run.
    pub report_run: Option<RcaRunItem>,
    pub history: Vec<RcaRunItem>,
    #[serde(default)]
    pub resume_run_id: Option<String>,
}

/// One row of a run history list.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RcaRunItem {
    pub run_id: String,
    pub report_format: ReportFormat,
    pub subject_type: RunSubjectType,
    pub trigger: RunTrigger,
    pub mode: RunMode,
    pub started_by: String,
    pub state: RunState,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub outcome: Option<String>,
    pub confidence: Option<String>,
    pub cancelled_by: Option<String>,
    /// `error.reason` of a failed run.
    pub error_reason: Option<String>,
    /// The run stored a record, so a cancelled or failed run's partial ledger still opens.
    #[serde(default)]
    pub has_record: bool,
}

/// One analysis run (`rca_runs` row).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct RcaRun {
    pub run_id: String,
    pub report_format: ReportFormat,
    pub subject_type: RunSubjectType,
    pub subject_id: String,
    pub incident_id: Option<String>,
    pub trigger: RunTrigger,
    pub mode: RunMode,
    pub started_by: String,
    pub guidance: Option<String>,
    pub state: RunState,
    pub started_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
    pub cancelled_by: Option<String>,
    pub outcome: Option<String>,
    pub confidence: Option<String>,
    /// Absent rather than null while the run has no report.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    pub error: Option<RunError>,
    pub session_id: Option<String>,
    pub stats: Option<RunStats>,
    /// Current stage of the seven-stage protocol.
    #[serde(default)]
    pub stage: Option<String>,
    #[serde(default)]
    pub stage_index: Option<i16>,
    /// `{past_causes: [{id, summary}], skills: [name], toolsets: [name]}`.
    #[serde(default)]
    pub context_used: Option<serde_json::Value>,
    /// Continuation turns the run used.
    #[serde(default)]
    pub continuations: i16,
    /// Serialized `Vec<SubjectRef>` of an alert run's pending on-call records.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oncall_subjects: Option<serde_json::Value>,
    /// Answer deadline of a `waiting_input` run, µs.
    #[serde(default)]
    pub input_deadline_at: Option<i64>,
    /// `callID` of the open question of a `waiting_input` run.
    #[serde(default)]
    pub pending_question_id: Option<String>,
    /// Questions the run asked.
    #[serde(default)]
    pub questions_asked: i32,
    /// When the sweeper closed the answer deadline, µs.
    #[serde(default)]
    pub deadline_closed_at: Option<i64>,
}

/// `GET .../rca/runs` response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct ListRcaRunsResponse {
    pub runs: Vec<RcaRunItem>,
    pub has_more: bool,
}

/// A report kept in `topology_context` from before analysis runs existed.
#[derive(Debug, Clone, PartialEq)]
pub struct V1Report {
    pub run_id: String,
    pub report: String,
    /// When the report was written, µs.
    pub at: i64,
}

impl V1Report {
    pub fn item(&self) -> RcaRunItem {
        RcaRunItem {
            run_id: self.run_id.clone(),
            report_format: ReportFormat::V1,
            subject_type: RunSubjectType::Incident,
            trigger: RunTrigger::Legacy,
            mode: RunMode::Fresh,
            started_by: V1_STARTED_BY.to_string(),
            state: RunState::Completed,
            started_at: self.at,
            ended_at: Some(self.at),
            outcome: None,
            confidence: None,
            cancelled_by: None,
            error_reason: None,
            has_record: false,
        }
    }

    /// The report as a run, without its report text.
    pub fn run(&self, incident_id: &str) -> RcaRun {
        RcaRun {
            run_id: self.run_id.clone(),
            report_format: ReportFormat::V1,
            subject_type: RunSubjectType::Incident,
            subject_id: incident_id.to_string(),
            incident_id: Some(incident_id.to_string()),
            trigger: RunTrigger::Legacy,
            mode: RunMode::Fresh,
            started_by: V1_STARTED_BY.to_string(),
            guidance: None,
            state: RunState::Completed,
            started_at: self.at,
            updated_at: self.at,
            ended_at: Some(self.at),
            cancelled_by: None,
            outcome: None,
            confidence: None,
            report: None,
            result: None,
            error: None,
            session_id: None,
            stats: None,
            stage: None,
            stage_index: None,
            context_used: None,
            continuations: 0,
            oncall_subjects: None,
            input_deadline_at: None,
            pending_question_id: None,
            questions_asked: 0,
            deadline_closed_at: None,
        }
    }

    pub fn summary(&self) -> RcaSummary {
        RcaSummary {
            run_id: self.run_id.clone(),
            report_format: ReportFormat::V1,
            state: RunState::Completed,
            stale: false,
            started_at: self.at,
            updated_at: self.at,
            outcome: None,
            confidence: None,
            summary: RunSummaryFields::default(),
            detail: None,
        }
    }
}

/// `(timeout + 120 s)` in µs: a `running` run with no write for longer is stale.
pub fn stale_threshold_us(rca_timeout_secs: u64) -> i64 {
    let secs = rca_timeout_secs.saturating_add(STALE_GRACE_SECS);
    i64::try_from(secs)
        .unwrap_or(i64::MAX)
        .saturating_mul(1_000_000)
}

/// A `running` run whose last write is older than the stale threshold.
pub fn is_stale(state: RunState, updated_at_us: i64, now_us: i64, rca_timeout_secs: u64) -> bool {
    state == RunState::Running
        && now_us.saturating_sub(updated_at_us) > stale_threshold_us(rca_timeout_secs)
}

/// The latest run blocks a new run: `running` and not stale, or `waiting_input`.
pub fn is_live_blocking(
    state: RunState,
    updated_at_us: i64,
    now_us: i64,
    rca_timeout_secs: u64,
) -> bool {
    match state {
        RunState::Running => !is_stale(state, updated_at_us, now_us, rca_timeout_secs),
        RunState::WaitingInput => true,
        RunState::Completed | RunState::Failed | RunState::Cancelled => false,
    }
}

pub fn next_previous(
    seen_run_id: Option<&str>,
    seen_state: Option<RunState>,
    seen_updated_at: Option<i64>,
    seen_outcome: Option<&str>,
    seen_confidence: Option<&str>,
    seen_summary: Option<&RunSummaryFields>,
) -> Option<PreviousResult> {
    match (seen_run_id, seen_state, seen_updated_at) {
        (Some(run_id), Some(RunState::Completed), Some(ended_at)) => Some(PreviousResult {
            run_id: run_id.to_string(),
            outcome: seen_outcome.map(str::to_string),
            confidence: seen_confidence.map(str::to_string),
            ended_at,
        }),
        _ => seen_summary.and_then(|s| s.previous.clone()),
    }
}

/// The part of an email before `@`, for labels such as "Re-analyze by a.rao".
pub fn user_local_part(email: &str) -> &str {
    email.split_once('@').map_or(email, |(local, _)| local)
}

/// Whether `topology_context` still holds reports from before analysis runs existed.
pub fn has_v1_reports(topology: &serde_json::Value) -> bool {
    v1_entries(topology).next().is_some()
}

/// Pre-run reports, newest first; `completed_at` is the pre-first-run `AIAnalysisComplete` times.
pub fn v1_reports(
    topology: &serde_json::Value,
    completed_at: &[i64],
    created_at: i64,
) -> Vec<V1Report> {
    let entries: Vec<_> = v1_entries(topology).collect();
    entries
        .iter()
        .enumerate()
        .map(|(k, (report, _))| V1Report {
            run_id: format!("{V1_RUN_ID_PREFIX}{k}"),
            report: (*report).to_string(),
            // A report was written when it archived the next older one.
            at: entries
                .get(k + 1)
                .and_then(|(_, archived_at)| *archived_at)
                .or_else(|| completed_at.get(k).copied())
                .unwrap_or(created_at),
        })
        .collect()
}

/// Whether `run_id` names a pre-run report rather than an `rca_runs` row.
pub fn is_v1_run_id(run_id: &str) -> bool {
    run_id
        .strip_prefix(V1_RUN_ID_PREFIX)
        .is_some_and(|k| k.parse::<usize>().is_ok())
}

/// `(report, archived_at)` of each non-empty pre-run report, newest first.
fn v1_entries(topology: &serde_json::Value) -> impl Iterator<Item = (&str, Option<i64>)> {
    let current = topology
        .get(V1_REPORT_KEY)
        .and_then(serde_json::Value::as_str)
        .map(|report| (report, None));
    let previous = topology
        .get(V1_PREVIOUS_REPORTS_KEY)
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let report = item.get("content")?.as_str()?;
            Some((
                report,
                item.get("archived_at").and_then(serde_json::Value::as_i64),
            ))
        });
    current
        .into_iter()
        .chain(previous)
        .filter(|(report, _)| !report.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEC: i64 = 1_000_000;
    const TIMEOUT: u64 = 600;
    const NOW: i64 = 10_000 * SEC;

    #[test]
    fn rr9_live_blocking_boundary() {
        assert_eq!(stale_threshold_us(TIMEOUT), 720 * SEC);
        assert!(is_live_blocking(
            RunState::Running,
            NOW - 719 * SEC,
            NOW,
            TIMEOUT
        ));
        assert!(!is_live_blocking(
            RunState::Running,
            NOW - 721 * SEC,
            NOW,
            TIMEOUT
        ));
        for age in [0, 719 * SEC, 721 * SEC, 9_999 * SEC] {
            assert!(is_live_blocking(
                RunState::WaitingInput,
                NOW - age,
                NOW,
                TIMEOUT
            ));
        }
        for state in [RunState::Completed, RunState::Failed, RunState::Cancelled] {
            assert!(!is_live_blocking(state, NOW, NOW, TIMEOUT));
        }
    }

    /// Stale means strictly older than the threshold, and only for `running`.
    #[test]
    fn rr9_stale_boundary() {
        assert!(!is_stale(RunState::Running, NOW - 720 * SEC, NOW, TIMEOUT));
        assert!(is_stale(
            RunState::Running,
            NOW - 720 * SEC - 1,
            NOW,
            TIMEOUT
        ));
        assert!(!is_stale(RunState::Running, NOW - 719 * SEC, NOW, TIMEOUT));
        for state in [
            RunState::WaitingInput,
            RunState::Completed,
            RunState::Failed,
            RunState::Cancelled,
        ] {
            assert!(!is_stale(state, NOW - 9_999 * SEC, NOW, TIMEOUT));
        }
    }

    fn summary_with_previous(run_id: &str, ended_at: i64) -> RunSummaryFields {
        RunSummaryFields {
            previous: Some(PreviousResult {
                run_id: run_id.to_string(),
                outcome: Some("root_cause".to_string()),
                confidence: Some("high".to_string()),
                ended_at,
            }),
            ..Default::default()
        }
    }

    #[test]
    fn rr41_next_previous() {
        // A completed seen run becomes `previous`, ended at its `rca_updated_at`.
        let older = summary_with_previous("R0", 5);
        assert_eq!(
            next_previous(
                Some("R1"),
                Some(RunState::Completed),
                Some(42),
                Some("root_cause"),
                Some("medium"),
                Some(&older),
            ),
            Some(PreviousResult {
                run_id: "R1".to_string(),
                outcome: Some("root_cause".to_string()),
                confidence: Some("medium".to_string()),
                ended_at: 42,
            })
        );

        // A failed, cancelled or live seen run keeps the seen summary's `previous`.
        for state in [
            RunState::Failed,
            RunState::Cancelled,
            RunState::Running,
            RunState::WaitingInput,
        ] {
            assert_eq!(
                next_previous(Some("R2"), Some(state), Some(50), None, None, Some(&older)),
                older.previous,
                "{state}"
            );
        }
        assert_eq!(
            next_previous(
                Some("R2"),
                Some(RunState::Failed),
                Some(50),
                None,
                None,
                Some(&RunSummaryFields::default()),
            ),
            None
        );

        // First run: nothing seen.
        assert_eq!(next_previous(None, None, None, None, None, None), None);
    }

    #[test]
    fn summary_fields_default_and_partial_json() {
        let decoded: RunSummaryFields = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(decoded, RunSummaryFields::default());
        assert_eq!(decoded.stage_count, RCA_STAGE_COUNT);
    }

    #[test]
    fn enums_round_trip_as_snake_case() {
        for state in [
            RunState::Running,
            RunState::WaitingInput,
            RunState::Completed,
            RunState::Failed,
            RunState::Cancelled,
        ] {
            let json = serde_json::to_value(state).unwrap();
            assert_eq!(json, serde_json::Value::String(state.as_str().to_string()));
            assert_eq!(state.as_str().parse::<RunState>().unwrap(), state);
            assert_eq!(state.is_live(), !state.is_terminal());
        }
        assert_eq!(RunState::WaitingInput.as_str(), "waiting_input");
        assert!("stale".parse::<RunState>().is_err());
    }

    #[test]
    fn trigger_mapping_and_user_started() {
        assert!(matches!(
            RunTrigger::AutoNewIncident.analysis_trigger_type(),
            AnalysisTriggerType::AutomaticNewIncident
        ));
        assert!(matches!(
            RunTrigger::AutoNewAlertType.analysis_trigger_type(),
            AnalysisTriggerType::AutomaticReanalysis
        ));
        assert!(matches!(
            RunTrigger::AutoReopen.analysis_trigger_type(),
            AnalysisTriggerType::AutomaticReopened
        ));
        assert!(matches!(
            RunTrigger::Reanalyze.analysis_trigger_type(),
            AnalysisTriggerType::Manual
        ));
        let user_started: Vec<RunTrigger> = [
            RunTrigger::AutoNewIncident,
            RunTrigger::AutoNewAlertType,
            RunTrigger::AutoReopen,
            RunTrigger::Manual,
            RunTrigger::Reanalyze,
            RunTrigger::OncallPage,
            RunTrigger::Resume,
            RunTrigger::Legacy,
        ]
        .into_iter()
        .filter(RunTrigger::is_user_started)
        .collect();
        assert_eq!(
            user_started,
            vec![
                RunTrigger::Manual,
                RunTrigger::Reanalyze,
                RunTrigger::Resume
            ]
        );
    }

    #[test]
    fn user_local_part_strips_domain() {
        assert_eq!(user_local_part("a.rao@acme.io"), "a.rao");
        assert_eq!(user_local_part("system"), "system");
    }

    /// The list form has no detail keys; the detail form flattens them.
    #[test]
    fn rca_summary_detail_is_flattened_and_skipped_when_none() {
        let mut summary = RcaSummary {
            run_id: "R1".to_string(),
            report_format: ReportFormat::V2,
            state: RunState::Running,
            stale: false,
            started_at: 1,
            updated_at: 2,
            outcome: None,
            confidence: None,
            summary: RunSummaryFields::default(),
            detail: None,
        };
        let json = serde_json::to_value(&summary).unwrap();
        assert!(json.get("history").is_none());
        assert!(json.get("current_run").is_none());

        summary.detail = Some(RcaDetailFields {
            current_run: None,
            report_run: None,
            history: Vec::new(),
            resume_run_id: None,
        });
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["history"], serde_json::json!([]));
        let back: RcaSummary = serde_json::from_value(json).unwrap();
        assert_eq!(back, summary);
    }

    #[test]
    fn v1_reports_are_newest_first_and_timed_by_the_report_they_replaced() {
        let topology = serde_json::json!({
            "nodes": [],
            V1_REPORT_KEY: "current",
            V1_PREVIOUS_REPORTS_KEY: [
                {"content": "older", "archived_at": 300},
                {"content": "   ", "archived_at": 250},
                {"content": "oldest", "archived_at": 200},
                {"archived_at": 150},
            ],
        });
        assert!(has_v1_reports(&topology));
        let reports = v1_reports(&topology, &[90, 80, 70], 5);
        let got: Vec<_> = reports
            .iter()
            .map(|r| (r.run_id.as_str(), r.report.as_str(), r.at))
            .collect();
        // Blank entries are skipped; the oldest has no archive time, so it pairs with the third.
        assert_eq!(
            got,
            vec![
                ("v1-0", "current", 300),
                ("v1-1", "older", 200),
                ("v1-2", "oldest", 70)
            ]
        );
        assert_eq!(v1_reports(&topology, &[], 5)[2].at, 5);
    }

    #[test]
    fn a_topology_without_pre_run_reports_has_none() {
        for topology in [
            serde_json::json!({"nodes": [], "edges": []}),
            serde_json::json!({V1_REPORT_KEY: "", V1_PREVIOUS_REPORTS_KEY: []}),
            serde_json::json!(null),
        ] {
            assert!(!has_v1_reports(&topology));
            assert!(v1_reports(&topology, &[1], 0).is_empty());
        }
    }

    #[test]
    fn v1_ids_are_told_apart_from_run_ids() {
        assert!(is_v1_run_id("v1-0"));
        assert!(is_v1_run_id("v1-12"));
        assert!(!is_v1_run_id("v1-"));
        assert!(!is_v1_run_id("v1-x"));
        assert!(!is_v1_run_id("2abcDEFghiJKLmnoPQRstuVWXyz"));
    }

    #[test]
    fn a_v1_report_serializes_as_a_completed_legacy_run() {
        let report = V1Report {
            run_id: "v1-0".to_string(),
            report: "## RCA".to_string(),
            at: 42,
        };
        let item = serde_json::to_value(report.item()).unwrap();
        assert_eq!(item["report_format"], "v1");
        assert_eq!(item["trigger"], "legacy");
        assert_eq!(item["state"], "completed");
        assert_eq!(item["ended_at"], 42);
        let run = report.run("inc-1");
        assert_eq!((run.report_format, run.report), (ReportFormat::V1, None));
        assert_eq!(run.incident_id.as_deref(), Some("inc-1"));
        assert_eq!(report.summary().report_format, ReportFormat::V1);
    }
}
