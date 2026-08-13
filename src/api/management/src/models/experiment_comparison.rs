// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Honest, deterministic comparison of two Experiment result sets.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use config::meta::self_reporting::{
    llm_experiments::ExperimentExecutionRecord,
    llm_scores::{LlmScoreRecord, LlmScoreStatus},
};
use openobserve_core::llm_evaluations::experiments::ExperimentSlot;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

pub const DEFAULT_COMPARISON_THRESHOLD: f64 = 0.0;
pub const COMPARISON_ASSIGNMENT_RULE: &str = "Rows are joined by stable dataset logical ID. Any shared dimension beyond the threshold in the worse direction makes a row regressed. A row is improved only when at least one shared dimension improves and none regress. One-sided dimensions are reported but do not affect assignment.";

#[derive(Clone, Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonQuery {
    pub baseline_id: String,
    pub candidate_id: String,
    pub threshold: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentComparisonBucketBody {
    Regressed,
    Improved,
    Unchanged,
    New,
    Missing,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentComparisonDimensionKindBody {
    Score,
    Cost,
    Latency,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentComparisonAssignmentBody {
    Regressed,
    Improved,
    Unchanged,
    BaselineOnly,
    CandidateOnly,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonDimensionBody {
    pub name: String,
    pub kind: ExperimentComparisonDimensionKindBody,
    pub baseline: Option<f64>,
    pub candidate: Option<f64>,
    pub delta: Option<f64>,
    pub baseline_sample_count: u64,
    pub candidate_sample_count: u64,
    pub assignment: ExperimentComparisonAssignmentBody,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonRowBody {
    pub logical_id: String,
    pub baseline_row_id: Option<String>,
    pub candidate_row_id: Option<String>,
    pub bucket: ExperimentComparisonBucketBody,
    pub dimensions: Vec<ExperimentComparisonDimensionBody>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonCountsBody {
    pub baseline_rows: u64,
    pub candidate_rows: u64,
    pub common_rows: u64,
    pub regressed: u64,
    pub improved: u64,
    pub unchanged: u64,
    pub new: u64,
    pub missing: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonSummaryDimensionBody {
    pub name: String,
    pub kind: ExperimentComparisonDimensionKindBody,
    pub baseline: Option<f64>,
    pub candidate: Option<f64>,
    pub delta: Option<f64>,
    pub baseline_sample_count: u64,
    pub candidate_sample_count: u64,
    pub comparable_row_count: u64,
    pub baseline_only_row_count: u64,
    pub candidate_only_row_count: u64,
    pub assignment: ExperimentComparisonAssignmentBody,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonResponseBody {
    pub baseline_id: String,
    pub candidate_id: String,
    pub dataset_id: String,
    pub threshold: f64,
    pub assignment_rule: String,
    pub counts: ExperimentComparisonCountsBody,
    pub dimensions: Vec<ExperimentComparisonSummaryDimensionBody>,
    pub rows: Vec<ExperimentComparisonRowBody>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum DimensionKind {
    Cost,
    Latency,
    Score,
}

impl DimensionKind {
    fn body(self) -> ExperimentComparisonDimensionKindBody {
        match self {
            Self::Cost => ExperimentComparisonDimensionKindBody::Cost,
            Self::Latency => ExperimentComparisonDimensionKindBody::Latency,
            Self::Score => ExperimentComparisonDimensionKindBody::Score,
        }
    }

    fn lower_is_better(self) -> bool {
        matches!(self, Self::Cost | Self::Latency)
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct DimensionKey {
    kind: DimensionKind,
    name: String,
}

#[derive(Clone, Debug, Default)]
struct Average {
    sum: f64,
    count: u64,
}

impl Average {
    fn add(&mut self, value: f64) {
        if value.is_finite() {
            self.sum += value;
            self.count = self.count.saturating_add(1);
        }
    }

    fn value(&self) -> Option<f64> {
        (self.count > 0).then(|| self.sum / self.count as f64)
    }
}

#[derive(Clone, Debug, Default)]
struct RowValues {
    row_id: String,
    dimensions: BTreeMap<DimensionKey, Average>,
}

fn comparison_assignment(
    kind: DimensionKind,
    baseline: Option<f64>,
    candidate: Option<f64>,
    threshold: f64,
) -> ExperimentComparisonAssignmentBody {
    let (Some(baseline), Some(candidate)) = (baseline, candidate) else {
        return match (baseline, candidate) {
            (Some(_), None) => ExperimentComparisonAssignmentBody::BaselineOnly,
            (None, Some(_)) => ExperimentComparisonAssignmentBody::CandidateOnly,
            (None, None) => ExperimentComparisonAssignmentBody::Unavailable,
            (Some(_), Some(_)) => unreachable!(),
        };
    };
    let directional_delta = if kind.lower_is_better() {
        baseline - candidate
    } else {
        candidate - baseline
    };
    if directional_delta > threshold {
        ExperimentComparisonAssignmentBody::Improved
    } else if directional_delta < -threshold {
        ExperimentComparisonAssignmentBody::Regressed
    } else {
        ExperimentComparisonAssignmentBody::Unchanged
    }
}

fn collect_rows(
    slots: &[ExperimentSlot],
    executions: &[ExperimentExecutionRecord],
    scores: &[LlmScoreRecord],
) -> BTreeMap<String, RowValues> {
    let row_to_logical = slots
        .iter()
        .map(|slot| (slot.row_id.as_str(), slot.logical_id.as_str()))
        .collect::<HashMap<_, _>>();
    let mut rows = BTreeMap::<String, RowValues>::new();
    for slot in slots {
        rows.entry(slot.logical_id.clone())
            .or_insert_with(|| RowValues {
                row_id: slot.row_id.clone(),
                dimensions: BTreeMap::new(),
            });
    }
    for execution in executions {
        let Some(logical_id) = row_to_logical.get(execution.row_id.as_str()) else {
            continue;
        };
        let row = rows.entry((*logical_id).to_string()).or_default();
        if let Some(cost) = execution.cost {
            row.dimensions
                .entry(DimensionKey {
                    kind: DimensionKind::Cost,
                    name: "cost".to_string(),
                })
                .or_default()
                .add(cost);
        }
        if let Some(latency) = execution.latency_ms {
            row.dimensions
                .entry(DimensionKey {
                    kind: DimensionKind::Latency,
                    name: "latency_ms".to_string(),
                })
                .or_default()
                .add(latency as f64);
        }
    }
    for score in scores {
        if score.status != LlmScoreStatus::Success {
            continue;
        }
        let (Some(row_id), Some(scorer_id)) = (score.row_id.as_deref(), score.scorer_id.as_deref())
        else {
            continue;
        };
        let Some(logical_id) = row_to_logical.get(row_id) else {
            continue;
        };
        let numeric = score
            .value_numeric
            .or_else(|| score.value_boolean.map(|value| f64::from(value as u8)));
        let Some(value) = numeric else {
            continue;
        };
        rows.entry((*logical_id).to_string())
            .or_default()
            .dimensions
            .entry(DimensionKey {
                kind: DimensionKind::Score,
                name: scorer_id.to_string(),
            })
            .or_default()
            .add(value);
    }
    rows
}

fn row_dimensions(
    baseline: Option<&RowValues>,
    candidate: Option<&RowValues>,
    threshold: f64,
) -> Vec<ExperimentComparisonDimensionBody> {
    let keys = baseline
        .into_iter()
        .flat_map(|row| row.dimensions.keys().cloned())
        .chain(
            candidate
                .into_iter()
                .flat_map(|row| row.dimensions.keys().cloned()),
        )
        .collect::<BTreeSet<_>>();
    keys.into_iter()
        .map(|key| {
            let baseline_average = baseline.and_then(|row| row.dimensions.get(&key));
            let candidate_average = candidate.and_then(|row| row.dimensions.get(&key));
            let baseline = baseline_average.and_then(Average::value);
            let candidate = candidate_average.and_then(Average::value);
            ExperimentComparisonDimensionBody {
                name: key.name,
                kind: key.kind.body(),
                baseline,
                candidate,
                delta: baseline.zip(candidate).map(|(left, right)| right - left),
                baseline_sample_count: baseline_average.map_or(0, |average| average.count),
                candidate_sample_count: candidate_average.map_or(0, |average| average.count),
                assignment: comparison_assignment(key.kind, baseline, candidate, threshold),
            }
        })
        .collect()
}

fn summary_dimensions(
    rows: &[ExperimentComparisonRowBody],
) -> Vec<ExperimentComparisonSummaryDimensionBody> {
    #[derive(Default)]
    struct Summary {
        baseline: Average,
        candidate: Average,
        baseline_only_values: Average,
        candidate_only_values: Average,
        baseline_sample_count: u64,
        candidate_sample_count: u64,
        comparable: u64,
        baseline_only: u64,
        candidate_only: u64,
    }
    let mut summaries = BTreeMap::<(String, String), Summary>::new();
    let mut kinds = BTreeMap::<(String, String), ExperimentComparisonDimensionKindBody>::new();
    for row in rows.iter().filter(|row| {
        matches!(
            row.bucket,
            ExperimentComparisonBucketBody::Regressed
                | ExperimentComparisonBucketBody::Improved
                | ExperimentComparisonBucketBody::Unchanged
        )
    }) {
        for dimension in &row.dimensions {
            let kind_name = format!("{:?}", dimension.kind);
            let key = (kind_name, dimension.name.clone());
            kinds.insert(key.clone(), dimension.kind);
            let summary = summaries.entry(key).or_default();
            summary.baseline_sample_count = summary
                .baseline_sample_count
                .saturating_add(dimension.baseline_sample_count);
            summary.candidate_sample_count = summary
                .candidate_sample_count
                .saturating_add(dimension.candidate_sample_count);
            match (dimension.baseline, dimension.candidate) {
                (Some(baseline), Some(candidate)) => {
                    summary.baseline.add(baseline);
                    summary.candidate.add(candidate);
                    summary.comparable = summary.comparable.saturating_add(1);
                }
                (Some(baseline), None) => {
                    summary.baseline_only_values.add(baseline);
                    summary.baseline_only = summary.baseline_only.saturating_add(1);
                }
                (None, Some(candidate)) => {
                    summary.candidate_only_values.add(candidate);
                    summary.candidate_only = summary.candidate_only.saturating_add(1)
                }
                (None, None) => {}
            }
        }
    }
    summaries
        .into_iter()
        .map(|(key, summary)| {
            let kind = kinds[&key];
            // Comparable means are deliberately paired. Only when a dimension
            // has no paired evidence do we show its one-sided mean.
            let baseline = summary
                .baseline
                .value()
                .or_else(|| summary.baseline_only_values.value());
            let candidate = summary
                .candidate
                .value()
                .or_else(|| summary.candidate_only_values.value());
            let assignment = match (baseline, candidate) {
                (Some(_), Some(_)) => ExperimentComparisonAssignmentBody::Unchanged,
                (Some(_), None) => ExperimentComparisonAssignmentBody::BaselineOnly,
                (None, Some(_)) => ExperimentComparisonAssignmentBody::CandidateOnly,
                (None, None) => ExperimentComparisonAssignmentBody::Unavailable,
            };
            ExperimentComparisonSummaryDimensionBody {
                name: key.1,
                kind,
                baseline,
                candidate,
                delta: baseline.zip(candidate).map(|(left, right)| right - left),
                baseline_sample_count: summary.baseline_sample_count,
                candidate_sample_count: summary.candidate_sample_count,
                comparable_row_count: summary.comparable,
                baseline_only_row_count: summary.baseline_only,
                candidate_only_row_count: summary.candidate_only,
                assignment,
            }
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub fn build_experiment_comparison(
    baseline_id: String,
    candidate_id: String,
    dataset_id: String,
    threshold: f64,
    baseline_slots: &[ExperimentSlot],
    baseline_executions: &[ExperimentExecutionRecord],
    baseline_scores: &[LlmScoreRecord],
    candidate_slots: &[ExperimentSlot],
    candidate_executions: &[ExperimentExecutionRecord],
    candidate_scores: &[LlmScoreRecord],
) -> ExperimentComparisonResponseBody {
    let baseline = collect_rows(baseline_slots, baseline_executions, baseline_scores);
    let candidate = collect_rows(candidate_slots, candidate_executions, candidate_scores);
    let logical_ids = baseline
        .keys()
        .chain(candidate.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut counts = ExperimentComparisonCountsBody {
        baseline_rows: baseline.len() as u64,
        candidate_rows: candidate.len() as u64,
        ..Default::default()
    };
    let mut rows = Vec::with_capacity(logical_ids.len());
    for logical_id in logical_ids {
        let baseline_row = baseline.get(&logical_id);
        let candidate_row = candidate.get(&logical_id);
        let dimensions = row_dimensions(baseline_row, candidate_row, threshold);
        let bucket = match (baseline_row, candidate_row) {
            (None, Some(_)) => {
                counts.new = counts.new.saturating_add(1);
                ExperimentComparisonBucketBody::New
            }
            (Some(_), None) => {
                counts.missing = counts.missing.saturating_add(1);
                ExperimentComparisonBucketBody::Missing
            }
            (Some(_), Some(_)) => {
                counts.common_rows = counts.common_rows.saturating_add(1);
                if dimensions.iter().any(|dimension| {
                    dimension.assignment == ExperimentComparisonAssignmentBody::Regressed
                }) {
                    counts.regressed = counts.regressed.saturating_add(1);
                    ExperimentComparisonBucketBody::Regressed
                } else if dimensions.iter().any(|dimension| {
                    dimension.assignment == ExperimentComparisonAssignmentBody::Improved
                }) {
                    counts.improved = counts.improved.saturating_add(1);
                    ExperimentComparisonBucketBody::Improved
                } else {
                    counts.unchanged = counts.unchanged.saturating_add(1);
                    ExperimentComparisonBucketBody::Unchanged
                }
            }
            (None, None) => unreachable!(),
        };
        rows.push(ExperimentComparisonRowBody {
            logical_id,
            baseline_row_id: baseline_row.map(|row| row.row_id.clone()),
            candidate_row_id: candidate_row.map(|row| row.row_id.clone()),
            bucket,
            dimensions,
        });
    }
    let dimensions = summary_dimensions(&rows);
    ExperimentComparisonResponseBody {
        baseline_id,
        candidate_id,
        dataset_id,
        threshold,
        assignment_rule: COMPARISON_ASSIGNMENT_RULE.to_string(),
        counts,
        dimensions,
        rows,
    }
}

#[cfg(test)]
mod tests {
    use config::meta::self_reporting::{
        llm_experiments::ExperimentExecutionStatus, llm_scores::LlmScoreDataType,
    };
    use serde_json::json;

    use super::*;

    fn slot(row_id: &str, logical_id: &str) -> ExperimentSlot {
        ExperimentSlot {
            row_id: row_id.to_string(),
            logical_id: logical_id.to_string(),
            trial_index: 0,
            input: json!({"prompt": logical_id}),
            expected_output: None,
        }
    }

    fn execution(
        row_id: &str,
        logical_id: &str,
        cost: f64,
        latency_ms: u64,
    ) -> ExperimentExecutionRecord {
        ExperimentExecutionRecord {
            experiment_id: "experiment".to_string(),
            item_logical_id: logical_id.to_string(),
            row_id: row_id.to_string(),
            trial_index: 0,
            status: ExperimentExecutionStatus::Ok,
            cost: Some(cost),
            latency_ms: Some(latency_ms),
            ..Default::default()
        }
    }

    fn score(row_id: &str, scorer_id: &str, value: f64) -> LlmScoreRecord {
        LlmScoreRecord {
            row_id: Some(row_id.to_string()),
            scorer_id: Some(scorer_id.to_string()),
            status: LlmScoreStatus::Success,
            data_type: LlmScoreDataType::Numeric,
            value_numeric: Some(value),
            ..Default::default()
        }
    }

    #[test]
    fn joins_by_stable_logical_id_and_reports_five_buckets() {
        let baseline_slots = vec![
            slot("old-a", "a"),
            slot("old-b", "b"),
            slot("old-c", "c"),
            slot("old-d", "d"),
        ];
        let candidate_slots = vec![
            slot("new-a", "a"),
            slot("new-b", "b"),
            slot("new-c", "c"),
            slot("new-e", "e"),
        ];
        let baseline_scores = vec![
            score("old-a", "quality", 0.8),
            score("old-b", "quality", 0.5),
            score("old-c", "quality", 0.5),
        ];
        let candidate_scores = vec![
            score("new-a", "quality", 0.4),
            score("new-b", "quality", 0.9),
            score("new-c", "quality", 0.5),
        ];
        let result = build_experiment_comparison(
            "baseline".into(),
            "candidate".into(),
            "dataset".into(),
            0.01,
            &baseline_slots,
            &[],
            &baseline_scores,
            &candidate_slots,
            &[],
            &candidate_scores,
        );
        assert_eq!(result.counts.common_rows, 3);
        assert_eq!(result.counts.regressed, 1);
        assert_eq!(result.counts.improved, 1);
        assert_eq!(result.counts.unchanged, 1);
        assert_eq!(result.counts.new, 1);
        assert_eq!(result.counts.missing, 1);
        assert_eq!(
            result
                .rows
                .iter()
                .find(|row| row.logical_id == "a")
                .unwrap()
                .baseline_row_id
                .as_deref(),
            Some("old-a")
        );
    }

    #[test]
    fn any_regression_wins_and_one_sided_partial_scores_are_neutral() {
        let slots = vec![slot("row", "shared")];
        let baseline_scores = vec![
            score("row", "quality", 0.5),
            score("row", "baseline-only", 1.0),
        ];
        let candidate_scores = vec![
            score("row", "quality", 0.9),
            score("row", "candidate-only", 1.0),
        ];
        let baseline_executions = vec![execution("row", "shared", 0.1, 10)];
        let candidate_executions = vec![execution("row", "shared", 0.2, 5)];
        let result = build_experiment_comparison(
            "baseline".into(),
            "candidate".into(),
            "dataset".into(),
            0.0,
            &slots,
            &baseline_executions,
            &baseline_scores,
            &slots,
            &candidate_executions,
            &candidate_scores,
        );
        assert_eq!(
            result.rows[0].bucket,
            ExperimentComparisonBucketBody::Regressed,
            "cost regression wins over quality and latency improvements"
        );
        assert!(
            result.rows[0]
                .dimensions
                .iter()
                .any(|dimension| dimension.assignment
                    == ExperimentComparisonAssignmentBody::BaselineOnly)
        );
        assert!(
            result.rows[0]
                .dimensions
                .iter()
                .any(|dimension| dimension.assignment
                    == ExperimentComparisonAssignmentBody::CandidateOnly)
        );
    }

    #[test]
    fn threshold_controls_assignment_and_common_summary_coverage_is_explicit() {
        let slots = vec![slot("row", "shared")];
        let result = build_experiment_comparison(
            "baseline".into(),
            "candidate".into(),
            "dataset".into(),
            0.1,
            &slots,
            &[],
            &[score("row", "quality", 0.5), score("row", "old", 1.0)],
            &slots,
            &[],
            &[score("row", "quality", 0.55)],
        );
        assert_eq!(
            result.rows[0].bucket,
            ExperimentComparisonBucketBody::Unchanged
        );
        let quality = result
            .dimensions
            .iter()
            .find(|dimension| dimension.name == "quality")
            .unwrap();
        assert_eq!(quality.comparable_row_count, 1);
        let old = result
            .dimensions
            .iter()
            .find(|dimension| dimension.name == "old")
            .unwrap();
        assert_eq!(old.baseline_only_row_count, 1);
        assert_eq!(old.candidate_only_row_count, 0);
        assert_eq!(
            old.assignment,
            ExperimentComparisonAssignmentBody::BaselineOnly
        );
    }
}
