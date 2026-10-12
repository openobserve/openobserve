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

use std::time::Duration;

use config::meta::promql::value::{Sample, Value};
use promql_parser::parser::Expr;

use crate::{functions::RangeFunc, utils::offset_micros};

/// `ts_of_*_over_time`: the time, in seconds, of the sample the variant picks from the window.
pub enum TsOfOverTimeFunc {
    /// The last sample holding the minimum.
    Min,
    /// The last sample holding the maximum.
    Max,
    First,
    Last,
}

impl RangeFunc for TsOfOverTimeFunc {
    fn name(&self) -> &'static str {
        match self {
            Self::Min => "ts_of_min_over_time",
            Self::Max => "ts_of_max_over_time",
            Self::First => "ts_of_first_over_time",
            Self::Last => "ts_of_last_over_time",
        }
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        let sample = match self {
            Self::Min => pick(samples, |value, best| value <= best),
            Self::Max => pick(samples, |value, best| value >= best),
            Self::First => samples.first(),
            Self::Last => samples.last(),
        }?;
        Some(sample.timestamp as f64 / 1_000_000.0)
    }

    fn returns_sample_time(&self) -> bool {
        true
    }
}

/// The offset, in microseconds, the engine moved a range argument's samples by.
pub(crate) fn sample_time_offset(range_arg: &Expr) -> i64 {
    match range_arg {
        Expr::Paren(paren) => sample_time_offset(&paren.expr),
        Expr::MatrixSelector(selector) => offset_micros(&selector.vs.offset),
        Expr::Subquery(subquery) => offset_micros(&subquery.offset),
        _ => 0,
    }
}

/// Moves sample times a range function returned back to where they are stored.
pub(crate) fn stored_sample_times(value: Value, offset: i64) -> Value {
    let Value::Matrix(mut matrix) = value else {
        return value;
    };
    if offset != 0 {
        for sample in matrix.iter_mut().flat_map(|series| &mut series.samples) {
            // whole microseconds, so the subtraction is exact
            let micros = (sample.value * 1_000_000.0).round() as i64 - offset;
            sample.value = micros as f64 / 1_000_000.0;
        }
    }
    Value::Matrix(matrix)
}

// a NaN loses to any number that follows it, as in upstream's `compareOverTime`
fn pick(samples: &[Sample], replaces: impl Fn(f64, f64) -> bool) -> Option<&Sample> {
    let mut best = samples.first()?;
    for sample in samples {
        if replaces(sample.value, best.value) || best.value.is_nan() {
            best = sample;
        }
    }
    Some(best)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Samples every 10.053s from 0, as upstream's `load 10s53ms`; `None` is a gap.
    fn load(values: &[Option<f64>]) -> Vec<Sample> {
        values
            .iter()
            .enumerate()
            .filter_map(|(i, v)| v.map(|v| Sample::new(i as i64 * 10_053_000, v)))
            .collect()
    }

    /// The window `(eval - 90s, eval]`, as `metric[90s]` at `eval` reads it.
    fn ts_of(func: TsOfOverTimeFunc, samples: &[Sample], eval_secs: i64) -> Option<f64> {
        let eval = eval_secs * 1_000_000;
        let window: Vec<_> = samples
            .iter()
            .copied()
            .filter(|s| s.timestamp > eval - 90_000_000 && s.timestamp <= eval)
            .collect();
        func.exec(&window, eval, &Duration::from_secs(90))
    }

    /// Cases from upstream `functions.test`.
    #[test]
    fn test_ts_of_over_time() {
        let metric = load(&[1.0, 2.0, 3.0, 0.0, 5.0, 6.0, 2.0, 1.0, 4.0].map(Some));
        assert_eq!(ts_of(TsOfOverTimeFunc::Min, &metric, 90), Some(30.159));
        assert_eq!(ts_of(TsOfOverTimeFunc::Max, &metric, 90), Some(50.265));

        let metric = load(&[Some(1.0), Some(2.0), Some(3.0), None, None]);
        assert_eq!(ts_of(TsOfOverTimeFunc::Last, &metric, 90), Some(20.106));
        assert_eq!(ts_of(TsOfOverTimeFunc::Last, &metric, 95), Some(20.106));

        let metric = load(&[None, None, Some(1.0), Some(2.0), Some(3.0), None, None]);
        assert_eq!(ts_of(TsOfOverTimeFunc::First, &metric, 90), Some(20.106));
        assert_eq!(ts_of(TsOfOverTimeFunc::First, &metric, 95), Some(20.106));
        assert_eq!(ts_of(TsOfOverTimeFunc::First, &metric, 15), None);
    }

    #[test]
    fn test_ts_of_extremes_pick_the_last_tie_and_skip_a_leading_nan() {
        let metric = load(&[
            None,
            Some(f64::NAN),
            Some(1.0),
            Some(3.0),
            Some(1.0),
            Some(3.0),
        ]);
        assert_eq!(ts_of(TsOfOverTimeFunc::Min, &metric, 90), Some(40.212));
        assert_eq!(ts_of(TsOfOverTimeFunc::Max, &metric, 90), Some(50.265));
    }
}
