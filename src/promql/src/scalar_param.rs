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

//! Scalar parameters of functions and aggregations, which may differ at every evaluation step.

use std::{fmt, sync::Arc};

use config::meta::promql::value::{EvalContext, Value};

/// A scalar parameter such as clamp's bound or topk's k, read at the step it applies to.
#[derive(Clone, PartialEq)]
pub(crate) enum ScalarParam {
    Const(f64),
    /// One value per step of the evaluation grid `start + i * step`.
    PerStep {
        start: i64,
        step: i64,
        values: Arc<[f64]>,
    },
}

impl ScalarParam {
    /// The parameter a scalar-typed expression evaluated to: a `Float`, or the one label-less
    /// series a range evaluation gives a scalar; `None` for any other value.
    pub(crate) fn from_value(value: Value, eval_ctx: &EvalContext) -> Option<Self> {
        let series = match value {
            Value::Float(value) => return Some(Self::Const(value)),
            Value::Matrix(matrix) if matrix.len() == 1 => matrix.into_iter().next()?,
            _ => return None,
        };
        let timestamps = eval_ctx.timestamps();
        // a scalar has a value at every step, so a step without a sample reads NaN
        let mut values = vec![f64::NAN; timestamps.len()];
        for sample in &series.samples {
            if let Ok(slot) = timestamps.binary_search(&sample.timestamp) {
                values[slot] = sample.value;
            }
        }
        let first = values.first().copied().unwrap_or(f64::NAN);
        if values
            .iter()
            .all(|value| value.to_bits() == first.to_bits())
        {
            return Some(Self::Const(first));
        }
        Some(Self::PerStep {
            start: eval_ctx.start,
            step: eval_ctx.step,
            values: values.into(),
        })
    }

    /// The value at an evaluation timestamp; NaN off the grid.
    pub(crate) fn at(&self, timestamp: i64) -> f64 {
        match self {
            Self::Const(value) => *value,
            Self::PerStep { start, step, .. } => {
                let offset = timestamp - start;
                match usize::try_from(offset / step) {
                    Ok(slot) if offset % step == 0 => self.at_slot(slot),
                    _ => f64::NAN,
                }
            }
        }
    }

    /// The value at the `slot`-th evaluation timestamp; NaN past the grid.
    pub(crate) fn at_slot(&self, slot: usize) -> f64 {
        match self {
            Self::Const(value) => *value,
            Self::PerStep { values, .. } => values.get(slot).copied().unwrap_or(f64::NAN),
        }
    }
}

// the timing logs print parameters, and a long range would dump every step
impl fmt::Debug for ScalarParam {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Const(value) => write!(f, "{value}"),
            Self::PerStep { values, .. } => write!(f, "per-step({} steps)", values.len()),
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{Labels, RangeValue, Sample};

    use super::*;

    fn range_scalar(samples: &[(i64, f64)]) -> Value {
        Value::Matrix(vec![RangeValue::new(
            Labels::default(),
            samples.iter().map(|&(t, v)| Sample::new(t, v)),
        )])
    }

    #[test]
    fn test_step_invariant_range_scalar_collapses_to_a_constant() {
        let eval_ctx = EvalContext::new(10, 30, 10, "test".into());
        let value = range_scalar(&[(10, 2.0), (20, 2.0), (30, 2.0)]);
        assert_eq!(
            ScalarParam::from_value(value, &eval_ctx),
            Some(ScalarParam::Const(2.0))
        );
        let nan = range_scalar(&[]);
        let param = ScalarParam::from_value(nan, &eval_ctx).unwrap();
        assert!(matches!(param, ScalarParam::Const(value) if value.is_nan()));
    }

    #[test]
    fn test_varying_range_scalar_reads_each_step() {
        let eval_ctx = EvalContext::new(10, 40, 10, "test".into());
        let value = range_scalar(&[(10, 1.0), (20, 2.0), (40, 4.0)]);
        let param = ScalarParam::from_value(value, &eval_ctx).unwrap();
        assert_eq!(param.at(10), 1.0);
        assert_eq!(param.at(20), 2.0);
        assert!(param.at(30).is_nan());
        assert_eq!(param.at(40), 4.0);
        assert_eq!(param.at_slot(3), 4.0);
        for off_grid in [0, 15, 50] {
            assert!(param.at(off_grid).is_nan(), "{off_grid}");
        }
        assert!(param.at_slot(4).is_nan());
        assert_eq!(format!("{param:?}"), "per-step(4 steps)");
    }

    #[test]
    fn test_only_scalars_are_parameters() {
        let eval_ctx = EvalContext::new(10, 10, 0, "test".into());
        assert_eq!(
            ScalarParam::from_value(Value::Float(0.5), &eval_ctx),
            Some(ScalarParam::Const(0.5))
        );
        assert_eq!(
            ScalarParam::from_value(range_scalar(&[(10, 3.0)]), &eval_ctx),
            Some(ScalarParam::Const(3.0))
        );
        for value in [
            Value::None,
            Value::String("k".into()),
            Value::Matrix(vec![]),
        ] {
            assert_eq!(ScalarParam::from_value(value, &eval_ctx), None);
        }
    }
}
