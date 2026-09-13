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

use super::{Accumulate, SeriesKey, group_series};

pub struct ExtremaAccumulator<const IS_MAX: bool> {
    values: Vec<f64>,
    present: Vec<bool>,
}

impl<const IS_MAX: bool> ExtremaAccumulator<IS_MAX> {
    pub(super) fn new(slots: usize) -> Self {
        let initial = if IS_MAX {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
        Self {
            values: vec![initial; slots],
            present: vec![false; slots],
        }
    }

    fn observe(&mut self, slot: usize, value: f64) {
        // Strict comparisons preserve the first signed zero and ignore NaN values.
        let replace = if IS_MAX {
            value > self.values[slot]
        } else {
            value < self.values[slot]
        };
        if replace {
            self.values[slot] = value;
        }
        self.present[slot] = true;
    }
}

impl<const IS_MAX: bool> Accumulate for ExtremaAccumulator<IS_MAX> {
    fn push(&mut self, slot: usize, value: f64, _series: &SeriesKey<'_>) {
        self.observe(slot, value);
    }

    fn merge(&mut self, other: Self) {
        for (slot, other_present) in other.present.into_iter().enumerate() {
            if !other_present {
                continue;
            }
            self.observe(slot, other.values[slot]);
        }
    }

    fn evaluate(self, group_labels: Labels, timestamps: &[i64]) -> Vec<RangeValue> {
        let samples = self
            .values
            .into_iter()
            .zip(self.present)
            .enumerate()
            .filter(|(_, (_, present))| *present)
            .map(|(slot, (value, _))| Sample::new(timestamps[slot], value))
            .collect();
        group_series(group_labels, samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_min_and_max_have_distinct_accumulator_types() {
        assert_ne!(
            std::any::TypeId::of::<ExtremaAccumulator<false>>(),
            std::any::TypeId::of::<ExtremaAccumulator<true>>(),
        );
    }
}
