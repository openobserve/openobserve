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

//! Fused evaluation of `agg(range_func(...))`: range-function values fold
//! straight into dense per-group accumulators, skipping the generic
//! evaluator's intermediate per-series materialization.

mod accumulator;
mod fold;
pub(crate) mod matrix;
mod op;
pub(crate) mod stream;

pub(crate) use op::FusedAggOp;

#[cfg(test)]
mod test_support {
    use config::meta::promql::value::{EvalContext, Value};
    use promql_parser::parser::LabelModifier;

    pub(super) type CanonicalSeries = (Vec<(String, String)>, Vec<(i64, u64)>);

    pub(super) const SECOND: i64 = 1_000_000;
    pub(super) const BASE: i64 = 1_000 * SECOND;

    pub(super) fn eval_ctx() -> EvalContext {
        EvalContext::new(
            BASE + 60 * SECOND,
            BASE + 180 * SECOND,
            60 * SECOND,
            "test".into(),
        )
    }

    pub(super) fn canonical_matrix(value: Value) -> Vec<CanonicalSeries> {
        let matrix = match value {
            Value::Matrix(matrix) => matrix,
            Value::None => return vec![],
            value => panic!("expected matrix or none, got {}", value.get_type()),
        };
        let mut canonical = matrix
            .into_iter()
            .map(|series| {
                let mut labels = series
                    .labels
                    .iter()
                    .map(|label| (label.name.clone(), label.value.clone()))
                    .collect::<Vec<_>>();
                labels.sort();
                let samples = series
                    .samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value.to_bits()))
                    .collect::<Vec<_>>();
                (labels, samples)
            })
            .collect::<Vec<_>>();
        canonical.sort_by(|a, b| a.0.cmp(&b.0));
        canonical
    }

    pub(super) fn by(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    pub(super) fn without(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Exclude(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    /// Labels and timestamps must match exactly; values may drift in the last bits (fold order
    /// differs).
    pub(super) fn assert_matrix_close(
        expected: Vec<CanonicalSeries>,
        actual: Vec<CanonicalSeries>,
        context: &str,
    ) {
        assert_eq!(expected.len(), actual.len(), "{context}: series count");
        for (expected, actual) in expected.iter().zip(&actual) {
            assert_eq!(expected.0, actual.0, "{context}: labels");
            assert_eq!(expected.1.len(), actual.1.len(), "{context}: sample count");
            for (&(expected_ts, expected_bits), &(actual_ts, actual_bits)) in
                expected.1.iter().zip(&actual.1)
            {
                assert_eq!(expected_ts, actual_ts, "{context}: timestamps");
                if expected_bits == actual_bits {
                    continue;
                }
                let expected_value = f64::from_bits(expected_bits);
                let actual_value = f64::from_bits(actual_bits);
                assert!(
                    expected_value.is_finite() && actual_value.is_finite(),
                    "{context}: non-finite values must match exactly"
                );
                let tolerance = expected_value.abs().max(actual_value.abs()) * 1e-12;
                assert!(
                    (expected_value - actual_value).abs() <= tolerance,
                    "{context}: {expected_value} vs {actual_value}"
                );
            }
        }
    }
}
