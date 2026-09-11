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

use config::meta::promql::value::{Labels, RangeValue, Sample};

use super::{Accumulate, group_series};
use crate::common::{std_deviation, std_variance};

pub struct DispersionAccumulator<const STDDEV: bool> {
    values: Vec<Vec<f64>>,
}

impl<const STDDEV: bool> DispersionAccumulator<STDDEV> {
    pub(super) fn new(slots: usize) -> Self {
        Self {
            values: vec![Vec::new(); slots],
        }
    }

    fn push(&mut self, slot: usize, value: f64) {
        self.values[slot].push(value);
    }
}

impl<const STDDEV: bool> Accumulate for DispersionAccumulator<STDDEV> {
    fn push_series(
        &mut self,
        values: impl Iterator<Item = (usize, f64)>,
        _labels: impl FnOnce() -> Labels,
    ) {
        for (slot, value) in values {
            self.push(slot, value);
        }
    }

    fn merge(&mut self, other: Self) {
        for (values, other) in self.values.iter_mut().zip(other.values) {
            values.extend(other);
        }
    }

    fn evaluate(self, group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue> {
        let dispersion = if STDDEV { std_deviation } else { std_variance };
        let samples = self
            .values
            .into_iter()
            .enumerate()
            .filter_map(|(slot, values)| {
                dispersion(&values).map(|value| Sample::new(timestamps[slot], value))
            })
            .collect();
        group_series(group_labels, samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dispersion_merge_preserves_slots_and_special_values() {
        fn check<const STDDEV: bool>() {
            let mut left = DispersionAccumulator::<STDDEV>::new(6);
            let mut right = DispersionAccumulator::<STDDEV>::new(6);
            for (slot, a, b) in [
                (0, 1.0, 5.0),
                (1, 7.0, 7.0),
                (2, f64::INFINITY, 1.0),
                (3, f64::NAN, 1.0),
                (4, f64::MAX, f64::MAX),
            ] {
                left.push(slot, a);
                right.push(slot, b);
            }
            left.merge(right);
            let mut series = left.evaluate(Labels::default(), &[1, 2, 3, 4, 5, 6]);
            let samples = series.pop().unwrap().samples;
            assert_eq!(
                samples
                    .iter()
                    .map(|sample| sample.timestamp)
                    .collect::<Vec<_>>(),
                [1, 2, 3, 4, 5]
            );
            assert_eq!(samples[0].value, if STDDEV { 2.0 } else { 4.0 });
            assert_eq!(samples[1].value, 0.0);
            assert!(samples[2].value.is_nan());
            assert!(samples[3].value.is_nan());
            assert_eq!(samples[4].value, f64::INFINITY);
            let empty =
                DispersionAccumulator::<STDDEV>::new(2).evaluate(Labels::default(), &[1, 2]);
            assert!(empty[0].samples.is_empty());
        }
        check::<false>();
        check::<true>();
    }
}
