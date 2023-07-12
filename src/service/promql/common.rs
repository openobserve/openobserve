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
