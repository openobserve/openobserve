// Copyright 2026 OpenObserve Inc.

//! HTTP boundary models for Experiment comparisons.

pub use domain::DEFAULT_COMPARISON_THRESHOLD;
use openobserve_core::llm_evaluations::experiment_comparison as domain;
use serde::{Deserialize, Serialize};
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
    pub baseline: Option<f64>,
    pub candidate: Option<f64>,
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
    pub baseline: Option<f64>,
    pub candidate: Option<f64>,
    pub delta: Option<f64>,
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
            baseline: value.baseline,
            candidate: value.candidate,
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
            counts,
            dimensions: value
                .dimensions
                .into_iter()
                .map(|dimension| ExperimentComparisonSummaryDimensionBody {
                    name: dimension.name,
                    kind: dimension.kind.into(),
                    baseline: dimension.baseline,
                    candidate: dimension.candidate,
                    delta: dimension.delta,
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
                    baseline_row_id: row.baseline_row_id,
                    candidate_row_id: row.candidate_row_id,
                    bucket: row.bucket.into(),
                    dimensions: row.dimensions.into_iter().map(Into::into).collect(),
                })
                .collect(),
        }
    }
}
