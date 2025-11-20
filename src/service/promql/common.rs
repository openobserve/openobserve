// Copyright 2025 OpenObserve Inc.
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

use config::{meta::promql::value::Sample, utils::sort::sort_float};

/// Calculate mean over a slice of f64s
pub fn mean(data: &[f64]) -> Option<f64> {
    let sum = data.iter().sum::<f64>();
    let count = data.len();

    match count {
        positive if positive > 0 => Some(sum / count as f64),
        _ => None,
    }
}

/// Calculate std deviation over a slice of f64
pub fn std_deviation(data: &[f64]) -> Option<f64> {
    std_variance(data).map(|var| var.sqrt())
}

/// Calculate std deviation over a slice of f64
pub fn std_deviation2(data: &[f64], mean: f64, length: i64) -> Option<f64> {
    std_variance2(data, mean, length).map(|var| var.sqrt())
}

/// Calculate std variance over a slice of f64
pub fn std_variance(data: &[f64]) -> Option<f64> {
    match (mean(data), data.len()) {
        (Some(data_mean), count) if count > 0 => {
            let variance = data
                .iter()
                .map(|value| {
                    let diff = data_mean - *value;

                    diff * diff
                })
                .sum::<f64>()
                / count as f64;

            Some(variance)
        }
        _ => None,
    }
}

/// Calculate std variance over a slice of f64
pub fn std_variance2(data: &[f64], mean: f64, length: i64) -> Option<f64> {
    match (mean, length) {
        (data_mean, count) if count > 0 => {
            let variance = data
                .iter()
                .map(|value| {
                    let diff = data_mean - *value;

                    diff * diff
                })
                .sum::<f64>()
                / count as f64;

            Some(variance)
        }
        _ => None,
    }
}

pub fn quantile(data: &[f64], quantile: f64) -> Option<f64> {
    if quantile < 0 as f64 || quantile > 1_f64 || quantile.is_nan() {
        let value = match quantile.signum() as i32 {
            1 => f64::INFINITY,
            -1 => f64::NEG_INFINITY,
            _ => f64::NAN,
        };
        return Some(value);
    }
    if data.is_empty() {
        return None;
    }

    let mut sorted_data = data.to_vec();
    sorted_data.sort_by(sort_float);

    let n = sorted_data.len();
    let index = (quantile * (n - 1) as f64) as usize;

    if index == n - 1 {
        return Some(sorted_data[index]);
    }

    let lower = sorted_data[index];
    let upper = sorted_data[index + 1];

    let fraction = quantile * (n - 1) as f64 - index as f64;
    let quantile_value = lower + (upper - lower) * fraction;

    Some(quantile_value)
}

pub fn calculate_trend(
    index: i64,
    trend_factor: f64,
    previous_smoothed: f64,
    current_smoothed: f64,
    previous_trend: f64,
) -> f64 {
    if index == 0 {
        return previous_trend;
    }

    let scaled_trend = trend_factor * (current_smoothed - previous_smoothed);
    let scaled_previous_trend = (1.0 - trend_factor) * previous_trend;

    scaled_trend + scaled_previous_trend
}

pub fn linear_regression(samples: &[Sample], intercept_time: i64) -> Option<(f64, f64)> {
    let mut num_samples = 0.0;
    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut sum_xy = 0.0;
    let mut sum_x2 = 0.0;
    let initial_y = samples.first()?.value;
    let mut constant_y = true;

    for (i, sample) in samples.iter().enumerate() {
        if constant_y && i > 0 && sample.value != initial_y {
            constant_y = false;
        }
        num_samples += 1.0;
        let x = (sample.timestamp / 1000 - intercept_time) as f64 / 1e3;
        sum_x += x;
        sum_y += sample.value;
        sum_xy += x * sample.value;
        sum_x2 += x * x;
    }

    if constant_y {
        if initial_y.is_infinite() {
            return None;
        }
        return Some((0.0, initial_y));
    }

    let cov_xy = sum_xy - (sum_x * sum_y) / num_samples;
    let var_x = sum_x2 - (sum_x * sum_x) / num_samples;

    let slope = cov_xy / var_x;
    let intercept = (sum_y / num_samples) - (slope * sum_x / num_samples);

    Some((slope, intercept))
}

pub fn kahan_sum_increment(increment: f64, sum: f64, c: f64) -> (f64, f64) {
    let updated_sum = sum + increment;
    let y = if sum.abs() >= increment.abs() {
        (sum - updated_sum) + increment
    } else {
        (increment - updated_sum) + sum
    };
    (updated_sum, c + y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quantile() {
        let data = vec![4.0, 2.0, 1.0, 3.0, 5.0];
        let phi_quantile = 0.5;
        let result = quantile(&data, phi_quantile);
        let expected = 3.0;
        match result {
            Some(got) => assert_eq!(got, expected),
            None => panic!(),
        }
    }

    #[test]
    fn test_quantile_comprehensive() {
        // Test basic quartiles
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(quantile(&data, 0.0), Some(1.0)); // Minimum
        assert_eq!(quantile(&data, 0.25), Some(2.0)); // First quartile
        assert_eq!(quantile(&data, 0.5), Some(3.0)); // Median
        assert_eq!(quantile(&data, 0.75), Some(4.0)); // Third quartile
        assert_eq!(quantile(&data, 1.0), Some(5.0)); // Maximum

        // Test with unsorted data
        let data = vec![5.0, 1.0, 3.0, 2.0, 4.0];
        assert_eq!(quantile(&data, 0.5), Some(3.0));

        // Test edge cases
        let data: Vec<f64> = vec![];
        assert_eq!(quantile(&data, 0.5), None); // Empty data

        let data = vec![42.0];
        assert_eq!(quantile(&data, 0.5), Some(42.0)); // Single element

        // Test invalid quantiles
        let data = vec![1.0, 2.0, 3.0];
        assert_eq!(quantile(&data, -0.5), Some(f64::NEG_INFINITY));
        assert_eq!(quantile(&data, 1.5), Some(f64::INFINITY));
        assert!(quantile(&data, f64::NAN).unwrap().is_nan());

        // Test with duplicates
        let data = vec![1.0, 2.0, 2.0, 2.0, 3.0];
        assert_eq!(quantile(&data, 0.5), Some(2.0));

        // Test interpolation
        let data = vec![10.0, 20.0];
        assert_eq!(quantile(&data, 0.5), Some(15.0)); // Exact midpoint
    }

    #[test]
    fn test_calculate_trend_comprehensive() {
        // Test first index (should return previous trend)
        assert_eq!(calculate_trend(0, 0.3, 100.0, 150.0, 5.0), 5.0);

        // Test normal calculation
        // trend_factor = 0.2, change = 120 - 100 = 20, previous_trend = 3.0
        // Expected: 0.2 * 20 + 0.8 * 3.0 = 4.0 + 2.4 = 6.4
        assert!((calculate_trend(1, 0.2, 100.0, 120.0, 3.0) - 6.4).abs() < 1e-10);

        // Test extreme trend factors
        assert_eq!(calculate_trend(1, 0.0, 100.0, 200.0, 5.0), 5.0); // Only previous trend
        assert_eq!(calculate_trend(1, 1.0, 100.0, 200.0, 5.0), 100.0); // Only current change

        // Test negative changes
        let result = calculate_trend(1, 0.5, 100.0, 80.0, 2.0);
        assert!((result - (-9.0)).abs() < 1e-10); // 0.5 * (-20) + 0.5 * 2 = -9

        // Test zero change
        let result = calculate_trend(1, 0.3, 100.0, 100.0, 5.0);
        assert!((result - 3.5).abs() < 1e-10); // 0.3 * 0 + 0.7 * 5 = 3.5
    }

    #[test]
    fn test_linear_regression_comprehensive() {
        // Test perfect linear relationship y = 2x + 3
        let samples = vec![
            Sample::new(0, 3.0),
            Sample::new(1000, 5.0),
            Sample::new(2000, 7.0),
            Sample::new(3000, 9.0),
        ];
        let result = linear_regression(&samples, 0);
        assert!(result.is_some());
        let (slope, intercept) = result.unwrap();
        assert!((slope - 2000.0).abs() < 1e-6); // 2 per second = 2000 per 1000ms
        assert!((intercept - 3.0).abs() < 1e-6);

        // Test constant values
        let samples = vec![
            Sample::new(1000, 5.0),
            Sample::new(2000, 5.0),
            Sample::new(3000, 5.0),
        ];
        let result = linear_regression(&samples, 0);
        assert!(result.is_some());
        let (slope, intercept) = result.unwrap();
        assert_eq!(slope, 0.0);
        assert_eq!(intercept, 5.0);

        // Test edge cases
        let samples: Vec<Sample> = vec![];
        assert!(linear_regression(&samples, 0).is_none()); // Empty

        let samples = vec![Sample::new(1000, 42.0)];
        let result = linear_regression(&samples, 0);
        assert!(result.is_some());
        let (slope, intercept) = result.unwrap();
        assert_eq!(slope, 0.0);
        assert_eq!(intercept, 42.0);

        // Test infinite values
        let samples = vec![
            Sample::new(1000, f64::INFINITY),
            Sample::new(2000, f64::INFINITY),
        ];
        assert!(linear_regression(&samples, 0).is_none());

        // Test negative slope
        let samples = vec![
            Sample::new(1000, 100.0),
            Sample::new(2000, 80.0),
            Sample::new(3000, 60.0),
        ];
        let result = linear_regression(&samples, 0);
        assert!(result.is_some());
        let (slope, _) = result.unwrap();
        assert!(slope < 0.0);
        assert!((slope - (-20000.0)).abs() < 1e-6); // -20 per second
    }

    #[test]
    fn test_kahan_sum_increment_comprehensive() {
        // Test basic increment
        let (sum, c) = kahan_sum_increment(1.0, 0.0, 0.0);
        assert_eq!(sum, 1.0);
        assert_eq!(c, 0.0);

        // Test increment to existing sum
        let (sum, c) = kahan_sum_increment(2.0, 1.0, 0.0);
        assert_eq!(sum, 3.0);
        assert_eq!(c, 0.0);

        // Test with compensation
        let (sum, c) = kahan_sum_increment(1.0, 1.0, 0.1);
        assert_eq!(sum, 2.0);
        assert_eq!(c, 0.1);

        // Test precision preservation with very small increment
        let (sum, c) = kahan_sum_increment(1e-15, 1.0, 0.0);
        assert!(sum >= 1.0);
        // The compensation term should capture precision loss
        assert!(c != 0.0 || sum > 1.0);

        // Test full Kahan summation
        fn kahan_sum(values: &[f64]) -> f64 {
            let mut sum = 0.0;
            let mut c = 0.0;
            for &value in values {
                let (new_sum, new_c) = kahan_sum_increment(value, sum, c);
                sum = new_sum;
                c = new_c;
            }
            sum + c
        }

        let values = vec![1.0, 2.0, 3.0, 4.0];
        assert_eq!(kahan_sum(&values), 10.0);

        let values = vec![0.1, 0.2, 0.3];
        let result = kahan_sum(&values);
        assert!((result - 0.6).abs() < 1e-15);
    }

    #[test]
    fn test_mean() {
        // Test normal case
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = mean(&data);
        assert_eq!(result, Some(3.0));

        // Test empty slice
        let data: Vec<f64> = vec![];
        let result = mean(&data);
        assert_eq!(result, None);

        // Test single value
        let data = vec![42.0];
        let result = mean(&data);
        assert_eq!(result, Some(42.0));

        // Test negative values
        let data = vec![-1.0, -2.0, -3.0];
        let result = mean(&data);
        assert_eq!(result, Some(-2.0));
    }

    #[test]
    fn test_std_variance() {
        // Test normal case
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = std_variance(&data);
        assert!(result.is_some());
        // Variance should be 2.0 for this data
        assert!((result.unwrap() - 2.0).abs() < 1e-10);

        // Test empty slice
        let data: Vec<f64> = vec![];
        let result = std_variance(&data);
        assert_eq!(result, None);

        // Test single value (variance should be 0)
        let data = vec![42.0];
        let result = std_variance(&data);
        assert_eq!(result, Some(0.0));
    }

    #[test]
    fn test_std_variance2() {
        // Test normal case
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let mean_val = 3.0;
        let length = 5;
        let result = std_variance2(&data, mean_val, length);
        assert!(result.is_some());
        // Variance should be 2.0 for this data
        assert!((result.unwrap() - 2.0).abs() < 1e-10);

        // Test with zero length
        let result = std_variance2(&data, mean_val, 0);
        assert_eq!(result, None);

        // Test with negative length
        let result = std_variance2(&data, mean_val, -1);
        assert_eq!(result, None);
    }

    #[test]
    fn test_std_deviation() {
        // Test normal case
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = std_deviation(&data);
        assert!(result.is_some());
        // Standard deviation should be sqrt(2.0) for this data
        assert!((result.unwrap() - 2.0_f64.sqrt()).abs() < 1e-10);

        // Test empty slice
        let data: Vec<f64> = vec![];
        let result = std_deviation(&data);
        assert_eq!(result, None);
    }

    #[test]
    fn test_std_deviation2() {
        // Test normal case
        let data = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let mean_val = 3.0;
        let length = 5;
        let result = std_deviation2(&data, mean_val, length);
        assert!(result.is_some());
        // Standard deviation should be sqrt(2.0) for this data
        assert!((result.unwrap() - 2.0_f64.sqrt()).abs() < 1e-10);

        // Test with zero length
        let result = std_deviation2(&data, mean_val, 0);
        assert_eq!(result, None);
    }

    #[test]
    fn test_calculate_trend() {
        // Test first iteration (index == 0)
        let result = calculate_trend(0, 0.1, 10.0, 12.0, 1.0);
        assert_eq!(result, 1.0);

        // Test normal case
        let result = calculate_trend(1, 0.1, 10.0, 12.0, 1.0);
        // trend_factor * (current_smoothed - previous_smoothed) + (1.0 - trend_factor) *
        // previous_trend 0.1 * (12.0 - 10.0) + 0.9 * 1.0 = 0.2 + 0.9 = 1.1
        assert!((result - 1.1).abs() < 1e-10);

        // Test with zero trend factor
        let result = calculate_trend(1, 0.0, 10.0, 12.0, 1.0);
        assert_eq!(result, 1.0);

        // Test with one trend factor
        let result = calculate_trend(1, 1.0, 10.0, 12.0, 1.0);
        assert_eq!(result, 2.0);
    }

    #[test]
    fn test_linear_regression() {
        // Test with constant y values
        let samples = vec![
            Sample::new(1000, 5.0),
            Sample::new(2000, 5.0),
            Sample::new(3000, 5.0),
        ];
        let result = linear_regression(&samples, 0);
        assert!(result.is_some());
        let (slope, intercept) = result.unwrap();
        assert_eq!(slope, 0.0);
        assert_eq!(intercept, 5.0);

        // Test with linear relationship
        let samples = vec![
            Sample::new(1000, 1.0),
            Sample::new(2000, 2.0),
            Sample::new(3000, 3.0),
        ];
        let result = linear_regression(&samples, 0);
        assert!(result.is_some());
        let (slope, intercept) = result.unwrap();
        // Slope should be 1000.0 (y increases by 1 for each 0.001 increase in x)
        assert!((slope - 1000.0).abs() < 1e-6);
        assert!((intercept - 0.0).abs() < 1e-6);

        // Test with infinite values
        let samples = vec![
            Sample::new(1000, f64::INFINITY),
            Sample::new(2000, f64::INFINITY),
        ];
        let result = linear_regression(&samples, 0);
        assert!(result.is_none());

        // Test with empty samples
        let samples: Vec<Sample> = vec![];
        let result = linear_regression(&samples, 0);
        assert!(result.is_none());
    }

    #[test]
    fn test_kahan_sum_increment() {
        // Test basic increment
        let (sum, c) = kahan_sum_increment(1.0, 0.0, 0.0);
        assert_eq!(sum, 1.0);
        assert_eq!(c, 0.0);

        // Test increment to existing sum
        let (sum, c) = kahan_sum_increment(2.0, 1.0, 0.0);
        assert_eq!(sum, 3.0);
        assert_eq!(c, 0.0);

        // Test with compensation term
        let (sum, c) = kahan_sum_increment(1.0, 1.0, 0.1);
        assert_eq!(sum, 2.0);
        assert_eq!(c, 0.1);

        // Test with very small increment (tests precision)
        let (sum, c) = kahan_sum_increment(1e-15, 1.0, 0.0);
        // Due to floating point precision, sum might not be exactly 1.0
        assert!((sum - 1.0).abs() < 1e-14);
        // c should capture the precision loss
        assert!(c != 0.0);
    }
}
