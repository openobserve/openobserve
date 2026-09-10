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

use config::meta::promql::value::Sample;
use hashbrown::HashMap;

use super::Accumulate;
use crate::common::std_variance;

pub(super) struct DispersionAccumulator {
    values: HashMap<i64, Vec<f64>>,
    stddev: bool,
}

impl DispersionAccumulator {
    pub(super) fn new(stddev: bool) -> Self {
        Self {
            values: HashMap::new(),
            stddev,
        }
    }
}

impl Accumulate for DispersionAccumulator {
    fn accumulate(&mut self, sample: &Sample) {
        self.values
            .entry(sample.timestamp)
            .or_default()
            .push(sample.value);
    }

    fn merge(&mut self, other: Box<dyn Accumulate>) {
        let other = other.into_any().downcast::<Self>().expect("same type");
        assert_eq!(self.stddev, other.stddev, "same aggregation");
        for (timestamp, values) in other.values {
            self.values.entry(timestamp).or_default().extend(values);
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn std::any::Any> {
        self
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.values
            .into_iter()
            .filter_map(|(timestamp, values)| {
                std_variance(&values).map(|variance| {
                    Sample::new(
                        timestamp,
                        if self.stddev {
                            variance.sqrt()
                        } else {
                            variance
                        },
                    )
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dispersion_merge_preserves_timestamps_and_special_values() {
        for stddev in [false, true] {
            let mut left = DispersionAccumulator::new(stddev);
            let mut right = DispersionAccumulator::new(stddev);
            for (timestamp, a, b) in [
                (1, 1.0, 5.0),
                (2, 7.0, 7.0),
                (3, f64::INFINITY, 1.0),
                (4, f64::NAN, 1.0),
                (5, f64::MAX, f64::MAX),
            ] {
                left.accumulate(&Sample::new(timestamp, a));
                right.accumulate(&Sample::new(timestamp, b));
            }
            left.merge(Box::new(right));
            let mut samples = Box::new(left).evaluate();
            samples.sort_by_key(|sample| sample.timestamp);
            assert_eq!(
                samples
                    .iter()
                    .map(|sample| sample.timestamp)
                    .collect::<Vec<_>>(),
                [1, 2, 3, 4, 5]
            );
            assert_eq!(samples[0].value, if stddev { 2.0 } else { 4.0 });
            assert_eq!(samples[1].value, 0.0);
            assert!(samples[2].value.is_nan());
            assert!(samples[3].value.is_nan());
            assert_eq!(samples[4].value, f64::INFINITY);
            assert!(
                Box::new(DispersionAccumulator::new(stddev))
                    .evaluate()
                    .is_empty()
            );
        }
    }
}
