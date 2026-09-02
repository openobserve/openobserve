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

//! HTTP boundary models for Experiment comparisons.

pub use domain::DEFAULT_COMPARISON_THRESHOLD;
use openobserve_core::llm_evaluations::{
    experiment_comparison as domain, experiment_results::ScoringStatus,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::{IntoParams, ToSchema};

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
    Inconclusive,
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
pub enum ExperimentComparisonScoreDataTypeBody {
    Numeric,
    Categorical,
    Boolean,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentComparisonAssignmentBody {
    Regressed,
    Improved,
    Unchanged,
    Descriptive,
    BaselineOnly,
    CandidateOnly,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonDimensionBody {
    pub name: String,
    pub kind: ExperimentComparisonDimensionKindBody,
    /// Score value type. `null` for cost and latency dimensions.
    pub data_type: Option<ExperimentComparisonScoreDataTypeBody>,
    pub score_config_id: Option<String>,
    pub score_config_name: Option<String>,
    pub score_config_version: Option<String>,
    pub baseline: Option<f64>,
    pub candidate: Option<f64>,
    /// Original category names for categorical dimensions when each side has
    /// one unambiguous label; `null` otherwise.
    pub baseline_label: Option<String>,
    pub candidate_label: Option<String>,
    pub delta: Option<f64>,
    /// Change in the better direction; positive always means improved.
    pub oriented_delta: Option<f64>,
    /// Whether this dimension declares a Comparison Policy and can vote.
    pub gating: bool,
    /// Whether `orientedDelta` is a fraction of the configured range rather
    /// than raw units, which is how the threshold should be read.
    pub normalized: bool,
    pub baseline_sample_count: u64,
    pub candidate_sample_count: u64,
    /// Normalized trial dispersion per side, present only where the side ran
    /// more than one trial and the dimension has a normalized key.
    pub baseline_dispersion: Option<f64>,
    pub candidate_dispersion: Option<f64>,
    /// The delta is smaller than the trial noise on both sides. Render it
    /// de-emphasized with a `~`; the bucket it belongs to is unaffected.
    pub within_noise: bool,
    pub assignment: ExperimentComparisonAssignmentBody,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonRowBody {
    pub logical_id: String,
    pub input: Value,
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
    pub inconclusive: u64,
    pub new: u64,
    pub missing: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentComparisonSummaryDimensionBody {
    pub name: String,
    pub kind: ExperimentComparisonDimensionKindBody,
    /// Score value type. `null` for cost and latency dimensions.
    pub data_type: Option<ExperimentComparisonScoreDataTypeBody>,
    pub score_config_id: Option<String>,
    pub score_config_name: Option<String>,
    pub score_config_version: Option<String>,
    pub baseline: Option<f64>,
    pub candidate: Option<f64>,
    /// Original category names when every value represented by that side's
    /// aggregate has the same label; `null` otherwise.
    pub baseline_label: Option<String>,
    pub candidate_label: Option<String>,
    pub delta: Option<f64>,
    /// Aggregate change in the better direction over comparable rows.
    pub oriented_delta: Option<f64>,
    pub gating: bool,
    pub normalized: bool,
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
    /// One or both sides are still being scored. The comparison is readable,
    /// but it is provisional: it cannot serve as a CI result, and its
    /// Experiments cannot be made a Baseline until scoring is terminal.
    pub partial: bool,
    #[schema(value_type = String)]
    pub baseline_scoring_status: ScoringStatus,
    #[schema(value_type = String)]
    pub candidate_scoring_status: ScoringStatus,
    pub counts: ExperimentComparisonCountsBody,
    pub dimensions: Vec<ExperimentComparisonSummaryDimensionBody>,
    pub rows: Vec<ExperimentComparisonRowBody>,
}

impl From<domain::ExperimentComparisonBucket> for ExperimentComparisonBucketBody {
    fn from(value: domain::ExperimentComparisonBucket) -> Self {
        match value {
            domain::ExperimentComparisonBucket::Regressed => Self::Regressed,
            domain::ExperimentComparisonBucket::Improved => Self::Improved,
            domain::ExperimentComparisonBucket::Unchanged => Self::Unchanged,
            domain::ExperimentComparisonBucket::Inconclusive => Self::Inconclusive,
            domain::ExperimentComparisonBucket::New => Self::New,
            domain::ExperimentComparisonBucket::Missing => Self::Missing,
        }
    }
}

impl From<domain::ExperimentComparisonDimensionKind> for ExperimentComparisonDimensionKindBody {
    fn from(value: domain::ExperimentComparisonDimensionKind) -> Self {
        match value {
            domain::ExperimentComparisonDimensionKind::Score => Self::Score,
            domain::ExperimentComparisonDimensionKind::Cost => Self::Cost,
            domain::ExperimentComparisonDimensionKind::Latency => Self::Latency,
        }
    }
}

impl From<domain::ExperimentComparisonScoreDataType> for ExperimentComparisonScoreDataTypeBody {
    fn from(value: domain::ExperimentComparisonScoreDataType) -> Self {
        match value {
            domain::ExperimentComparisonScoreDataType::Numeric => Self::Numeric,
            domain::ExperimentComparisonScoreDataType::Categorical => Self::Categorical,
            domain::ExperimentComparisonScoreDataType::Boolean => Self::Boolean,
        }
    }
}

impl From<domain::ExperimentComparisonAssignment> for ExperimentComparisonAssignmentBody {
    fn from(value: domain::ExperimentComparisonAssignment) -> Self {
        match value {
            domain::ExperimentComparisonAssignment::Regressed => Self::Regressed,
            domain::ExperimentComparisonAssignment::Improved => Self::Improved,
            domain::ExperimentComparisonAssignment::Unchanged => Self::Unchanged,
            domain::ExperimentComparisonAssignment::Descriptive => Self::Descriptive,
            domain::ExperimentComparisonAssignment::BaselineOnly => Self::BaselineOnly,
            domain::ExperimentComparisonAssignment::CandidateOnly => Self::CandidateOnly,
            domain::ExperimentComparisonAssignment::Unavailable => Self::Unavailable,
        }
    }
}

impl From<domain::ExperimentComparisonDimension> for ExperimentComparisonDimensionBody {
    fn from(value: domain::ExperimentComparisonDimension) -> Self {
        Self {
            name: value.name,
            kind: value.kind.into(),
            data_type: value.data_type.map(Into::into),
            score_config_id: value.score_config_id,
            score_config_name: value.score_config_name,
            score_config_version: value.score_config_version,
            baseline: value.baseline,
            candidate: value.candidate,
            baseline_label: value.baseline_label,
            candidate_label: value.candidate_label,
            delta: value.delta,
            oriented_delta: value.oriented_delta,
            gating: value.gating,
            normalized: value.normalized,
            baseline_sample_count: value.baseline_sample_count,
            candidate_sample_count: value.candidate_sample_count,
            baseline_dispersion: value.baseline_dispersion,
            candidate_dispersion: value.candidate_dispersion,
            within_noise: value.within_noise,
            assignment: value.assignment.into(),
        }
    }
}

impl From<domain::ExperimentComparison> for ExperimentComparisonResponseBody {
    fn from(value: domain::ExperimentComparison) -> Self {
        let counts = ExperimentComparisonCountsBody {
            baseline_rows: value.counts.baseline_rows,
            candidate_rows: value.counts.candidate_rows,
            common_rows: value.counts.common_rows,
            regressed: value.counts.regressed,
            improved: value.counts.improved,
            unchanged: value.counts.unchanged,
            inconclusive: value.counts.inconclusive,
            new: value.counts.new,
            missing: value.counts.missing,
        };
        Self {
            baseline_id: value.baseline_id,
            candidate_id: value.candidate_id,
            dataset_id: value.dataset_id,
            threshold: value.threshold,
            assignment_rule: value.assignment_rule,
            partial: value.partial,
            baseline_scoring_status: value.baseline_scoring_status,
            candidate_scoring_status: value.candidate_scoring_status,
            counts,
            dimensions: value
                .dimensions
                .into_iter()
                .map(|dimension| ExperimentComparisonSummaryDimensionBody {
                    name: dimension.name,
                    kind: dimension.kind.into(),
                    data_type: dimension.data_type.map(Into::into),
                    score_config_id: dimension.score_config_id,
                    score_config_name: dimension.score_config_name,
                    score_config_version: dimension.score_config_version,
                    baseline: dimension.baseline,
                    candidate: dimension.candidate,
                    baseline_label: dimension.baseline_label,
                    candidate_label: dimension.candidate_label,
                    delta: dimension.delta,
                    oriented_delta: dimension.oriented_delta,
                    gating: dimension.gating,
                    normalized: dimension.normalized,
                    baseline_sample_count: dimension.baseline_sample_count,
                    candidate_sample_count: dimension.candidate_sample_count,
                    comparable_row_count: dimension.comparable_row_count,
                    baseline_only_row_count: dimension.baseline_only_row_count,
                    candidate_only_row_count: dimension.candidate_only_row_count,
                    assignment: dimension.assignment.into(),
                })
                .collect(),
            rows: value
                .rows
                .into_iter()
                .map(|row| ExperimentComparisonRowBody {
                    logical_id: row.logical_id,
                    input: row.input,
                    baseline_row_id: row.baseline_row_id,
                    candidate_row_id: row.candidate_row_id,
                    bucket: row.bucket.into(),
                    dimensions: row.dimensions.into_iter().map(Into::into).collect(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn comparison_row_json_exposes_the_dataset_input() {
        let body = ExperimentComparisonRowBody {
            logical_id: "row-1".to_string(),
            input: json!({"question": "What changed?", "tags": ["release", "api"]}),
            baseline_row_id: Some("baseline-row".to_string()),
            candidate_row_id: Some("candidate-row".to_string()),
            bucket: ExperimentComparisonBucketBody::Unchanged,
            dimensions: vec![],
        };

        let value = serde_json::to_value(body).unwrap();
        assert_eq!(
            value["input"],
            json!({"question": "What changed?", "tags": ["release", "api"]})
        );
    }

    #[test]
    fn dimension_json_exposes_score_type_and_categorical_labels() {
        let body = ExperimentComparisonDimensionBody::from(domain::ExperimentComparisonDimension {
            name: "verdict · v1".to_string(),
            kind: domain::ExperimentComparisonDimensionKind::Score,
            data_type: Some(domain::ExperimentComparisonScoreDataType::Categorical),
            score_config_id: Some("verdict-config".to_string()),
            score_config_name: Some("Verdict".to_string()),
            score_config_version: Some("1".to_string()),
            baseline: Some(1.0),
            candidate: Some(0.0),
            baseline_label: Some("good".to_string()),
            candidate_label: Some("poor".to_string()),
            delta: Some(-1.0),
            oriented_delta: Some(-1.0),
            gating: true,
            normalized: false,
            baseline_sample_count: 1,
            candidate_sample_count: 1,
            baseline_dispersion: None,
            candidate_dispersion: None,
            within_noise: false,
            assignment: domain::ExperimentComparisonAssignment::Regressed,
        });

        let value = serde_json::to_value(body).unwrap();
        assert_eq!(value["dataType"], json!("categorical"));
        assert_eq!(value["baselineLabel"], json!("good"));
        assert_eq!(value["candidateLabel"], json!("poor"));
    }

    #[test]
    fn intrinsic_dimension_json_keeps_type_and_labels_null() {
        let body = ExperimentComparisonDimensionBody::from(domain::ExperimentComparisonDimension {
            name: "cost".to_string(),
            kind: domain::ExperimentComparisonDimensionKind::Cost,
            data_type: None,
            score_config_id: None,
            score_config_name: None,
            score_config_version: None,
            baseline: Some(0.1),
            candidate: Some(0.2),
            baseline_label: None,
            candidate_label: None,
            delta: Some(0.1),
            oriented_delta: Some(-0.1),
            gating: true,
            normalized: false,
            baseline_sample_count: 1,
            candidate_sample_count: 1,
            baseline_dispersion: None,
            candidate_dispersion: None,
            within_noise: false,
            assignment: domain::ExperimentComparisonAssignment::Regressed,
        });

        let value = serde_json::to_value(body).unwrap();
        assert_eq!(value["dataType"], serde_json::Value::Null);
        assert_eq!(value["baselineLabel"], serde_json::Value::Null);
        assert_eq!(value["candidateLabel"], serde_json::Value::Null);
    }
}
