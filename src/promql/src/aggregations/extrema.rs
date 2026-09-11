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

#[derive(Default)]
pub(super) struct ExtremaAccumulator<const IS_MAX: bool> {
    values: HashMap<i64, f64>,
}

impl<const IS_MAX: bool> Accumulate for ExtremaAccumulator<IS_MAX> {
    fn accumulate(&mut self, sample: &Sample) {
        let initial = if IS_MAX {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
        let entry = self.values.entry(sample.timestamp).or_insert(initial);
        // Strict comparisons preserve the first signed zero and ignore NaN values.
        let replace = if IS_MAX {
            sample.value > *entry
        } else {
            sample.value < *entry
        };
        if replace {
            *entry = sample.value;
        }
    }

    fn merge(&mut self, other: Box<dyn Accumulate>) {
        let other = other.into_any().downcast::<Self>().expect("same type");
        for (timestamp, value) in other.values {
            self.accumulate(&Sample::new(timestamp, value));
        }
    }

    fn into_any(self: Box<Self>) -> Box<dyn std::any::Any> {
        self
    }

    fn evaluate(self: Box<Self>) -> Vec<Sample> {
        self.values
            .into_iter()
            .map(|(timestamp, value)| Sample::new(timestamp, value))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[should_panic(expected = "same type")]
    fn test_min_cannot_merge_max() {
        let mut min = ExtremaAccumulator::<false>::default();
        min.merge(Box::new(ExtremaAccumulator::<true>::default()));
    }
}
