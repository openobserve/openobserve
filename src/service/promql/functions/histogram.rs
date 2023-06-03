// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap as HashMap;
use datafusion::error::{DataFusionError, Result};

use crate::{
    meta::prom::{HASH_LABEL, LE_LABEL, NAME_LABEL},
    service::promql::value::{
        signature_without_labels, InstantValue, Labels, Sample, Signature, Value,
    },
};

// https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L33
#[derive(Debug, Clone, Copy, PartialEq)]
struct Bucket {
    upper_bound: f64,
    count: f64,
}

// https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L45
#[derive(Debug)]
struct MetricWithBuckets {
    labels: Labels,
    buckets: Vec<Bucket>,
}

/// TODO: support native histograms; see [`histogramQuantile`]
///
/// [`histogramQuantile`]: https://github.com/prometheus/prometheus/blob/f7c6130ff27a2a12412c02cce223f7a8abc59e49/promql/quantile.go#L146
pub(crate) fn histogram_quantile(sample_time: i64, phi: f64, data: Value) -> Result<Value> {
    let in_vec = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "histogram_quantile: vector argument expected".to_owned(),
            ))
        }
    };

    let mut metrics_with_buckets: HashMap<Signature, MetricWithBuckets> = HashMap::default();
    for InstantValue { mut labels, sample } in in_vec {
        // [https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile]:
        //
        // The conventional float samples in `in_vec` are considered the counts
        // of observations in each bucket of one or more conventional
        // histograms. Each float sample must have a label `le` where the label
        // value denotes the inclusive upper bound of the bucket. *Float samples
        // without such a label are silently ignored.*
        let upper_bound: f64 = match labels
            .iter()
            .find(|v| v.name == "le")
            .map(|s| s.value.parse())
        {
            Some(Ok(u)) => u,
            None | Some(Err(_)) => continue,
        };

        let sig = signature_without_labels(&labels, &[HASH_LABEL, NAME_LABEL, LE_LABEL]);
        let entry = metrics_with_buckets.entry(sig).or_insert_with(|| {
            labels.retain(|l| l.name != HASH_LABEL && l.name != NAME_LABEL && l.name != LE_LABEL);
            MetricWithBuckets {
                labels,
                buckets: Vec::new(),
            }
        });
        entry.buckets.push(Bucket {
            upper_bound,
            count: sample.value,
        });
    }

    let values = metrics_with_buckets
        .into_values()
        .map(|mb| InstantValue {
            labels: mb.labels,
            sample: Sample::new(sample_time, bucket_quantile(phi, mb.buckets)),
        })
        .collect();

    Ok(Value::Vector(values))
}

// cf. https://github.com/prometheus/prometheus/blob/cf1bea344a3c390a90c35ea8764c4a468b345d5e/promql/quantile.go#L76
fn bucket_quantile(phi: f64, mut buckets: Vec<Bucket>) -> f64 {
    if phi.is_nan() {
        return f64::NAN;
    }
    if phi < 0.0 {
        return f64::NEG_INFINITY;
    }
    if phi > 1.0 {
        return f64::INFINITY;
    }
    buckets.sort_by(|a, b| a.upper_bound.partial_cmp(&b.upper_bound).unwrap());
    // The caller of `bucket_quantile` guarantees that `buckets` is non-empty.
    let highest_bucket = buckets[buckets.len() - 1];
    if !(highest_bucket.upper_bound.is_infinite() && highest_bucket.upper_bound.is_sign_positive())
    {
        return f64::NAN;
    }
    let mut buckets = coalesce_buckets(buckets);
    ensure_monotonic(&mut buckets);
    let buckets = buckets;
    if buckets.len() < 2 {
        return f64::NAN;
    }
    let observations = highest_bucket.count;
    if observations == 0.0 {
        return f64::NAN;
    }
    let mut rank = phi * observations;
    let b = match buckets[..buckets.len() - 1]
        .binary_search_by(|b| b.count.partial_cmp(&rank).unwrap())
    {
        Ok(b) => b,
        Err(b) => b,
    };
    if b == buckets.len() - 1 {
        return buckets[buckets.len() - 2].upper_bound;
    }
    if b == 0 && buckets[0].upper_bound <= 0.0 {
        return buckets[0].upper_bound;
    }
    let bucket_end = buckets[b].upper_bound;
    let mut count = buckets[b].count;
    let bucket_start = if b == 0 {
        0.0
    } else {
        count -= buckets[b - 1].count;
        rank -= buckets[b - 1].count;
        buckets[b - 1].upper_bound
    };
    bucket_start + (bucket_end - bucket_start) * rank / count
}

/// `coalesce_buckets` merges buckets with the same upper bound.
/// The input buckets must be sorted.
fn coalesce_buckets(buckets: Vec<Bucket>) -> Vec<Bucket> {
    let mut st = None;
    let mut buckets = buckets
        .into_iter()
        .filter_map(|b| match st {
            None => {
                st = Some(b);
                None
            }
            Some(last) => {
                if b.upper_bound == last.upper_bound {
                    st = Some(Bucket {
                        count: last.count + b.count,
                        ..last
                    });
                    None
                } else {
                    st = Some(b);
                    Some(last)
                }
            }
        })
        .collect::<Vec<_>>();
    if let Some(last) = st {
        buckets.push(last);
    }
    buckets
}

// For the rationale behind this function, see
// https://github.com/prometheus/prometheus/blob/0bf707e288eaa8694105e53c81a102017529793d/promql/quantile.go#L314-L347
fn ensure_monotonic(buckets: &mut [Bucket]) {
    let mut max = buckets[0].count;
    for bucket in &mut buckets[1..] {
        if bucket.count > max {
            max = bucket.count;
        } else if bucket.count < max {
            bucket.count = max;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use expect_test::expect;

    #[test]
    fn test_coalesce_buckets() {
        let buckets = vec![
            Bucket {
                upper_bound: 1.0,
                count: 2.0,
            },
            Bucket {
                upper_bound: 1.0,
                count: 3.0,
            },
            Bucket {
                upper_bound: 2.0,
                count: 4.0,
            },
            Bucket {
                upper_bound: 3.0,
                count: 1.0,
            },
            Bucket {
                upper_bound: 3.0,
                count: 1.0,
            },
        ];

        expect![[r#"
            [
                Bucket {
                    upper_bound: 1.0,
                    count: 5.0,
                },
                Bucket {
                    upper_bound: 2.0,
                    count: 4.0,
                },
                Bucket {
                    upper_bound: 3.0,
                    count: 2.0,
                },
            ]
        "#]]
        .assert_debug_eq(&coalesce_buckets(buckets));
    }

    #[test]
    fn test_ensure_monotonic() {
        let mut buckets = vec![
            Bucket {
                upper_bound: 1.0,
                count: 2.0,
            },
            Bucket {
                upper_bound: 2.0,
                count: 1.0,
            },
            Bucket {
                upper_bound: 3.0,
                count: 4.0,
            },
            Bucket {
                upper_bound: 4.0,
                count: 3.0,
            },
            Bucket {
                upper_bound: 5.0,
                count: 5.0,
            },
        ];
        ensure_monotonic(&mut buckets);
        expect![[r#"
            [
                Bucket {
                    upper_bound: 1.0,
                    count: 2.0,
                },
                Bucket {
                    upper_bound: 2.0,
                    count: 2.0,
                },
                Bucket {
                    upper_bound: 3.0,
                    count: 4.0,
                },
                Bucket {
                    upper_bound: 4.0,
                    count: 4.0,
                },
                Bucket {
                    upper_bound: 5.0,
                    count: 5.0,
                },
            ]
        "#]]
        .assert_debug_eq(&buckets);
    }
}
