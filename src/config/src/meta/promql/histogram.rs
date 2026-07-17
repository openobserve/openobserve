// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Prometheus native (sparse) histogram data model.
//!
//! The persisted form mirrors Prometheus' integer/float histogram split. Integer
//! bucket counts are delta encoded while query-side [`O2FloatHistogram`] bucket
//! counts are absolute. The storage payload is a JSON string so schema-on-write
//! never flattens the histogram into dynamic columns.

use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

use bytes::Bytes;
use datafusion::execution::memory_pool::MemoryReservation;
use serde::{Deserialize, Deserializer, Serialize, Serializer, ser::SerializeSeq};
use thiserror::Error;

pub const STALE_NAN_BITS: u64 = 0x7ff0_0000_0000_0002;
pub const STALE_NAN: f64 = f64::from_bits(STALE_NAN_BITS);
pub const EXPONENTIAL_SCHEMA_MIN: i32 = -4;
pub const EXPONENTIAL_SCHEMA_MAX: i32 = 8;
pub const CUSTOM_BUCKETS_SCHEMA: i32 = -53;

#[derive(Debug, Clone, Error, PartialEq)]
pub enum HistogramError {
    #[error("native histogram payload is too large: {actual} bytes exceeds {limit} bytes")]
    PayloadTooLarge { actual: usize, limit: usize },
    #[error("native histogram has too many buckets: {actual} exceeds {limit}")]
    TooManyBuckets { actual: usize, limit: usize },
    #[error("native histogram has too many spans: {actual} exceeds {limit}")]
    TooManySpans { actual: usize, limit: usize },
    #[error("unsupported native histogram schema {0}")]
    UnsupportedSchema(i32),
    #[error("invalid zero threshold {0}")]
    InvalidZeroThreshold(f64),
    #[error("{side} spans describe {expected} buckets but payload contains {actual}")]
    SpanBucketMismatch {
        side: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("{side} span {span} has negative offset {offset}")]
    NegativeSpanOffset {
        side: &'static str,
        span: usize,
        offset: i32,
    },
    #[error("{side} bucket {bucket} reconstructs to negative count {count}")]
    NegativeBucketCount {
        side: &'static str,
        bucket: usize,
        count: f64,
    },
    #[error("native histogram count {count} does not match bucket total {buckets}")]
    CountMismatch { count: f64, buckets: f64 },
    #[error("native histogram count {count} is smaller than bucket total {buckets}")]
    CountTooSmall { count: f64, buckets: f64 },
    #[error("native histogram count and zero-count variants do not match")]
    CountVariantMismatch,
    #[error("invalid native histogram JSON payload: {0}")]
    Json(String),
    #[error("native histogram has no decoded or encoded representation")]
    EmptyLazyHistogram,
    #[error("presence-only native histogram cannot be decoded")]
    PresenceOnlyAccess,
    #[error("native histogram query memory limit exceeded: {0}")]
    Memory(String),
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum HistogramLoadMode {
    PresenceOnly,
    #[default]
    RawLazy,
    DecodeAfterSelection,
    DecodedOnly,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistogramSpan {
    pub offset: i32,
    pub length: u32,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CounterResetHint {
    #[default]
    Unknown,
    CounterReset,
    NotCounterReset,
    Gauge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NativeHistogramCounts {
    Integer {
        zero_count: u64,
        count: u64,
        positive_buckets: Vec<i64>,
        negative_buckets: Vec<i64>,
    },
    Float {
        #[serde(with = "tagged_f64")]
        zero_count: f64,
        #[serde(with = "tagged_f64")]
        count: f64,
        #[serde(with = "tagged_f64_vec")]
        positive_buckets: Vec<f64>,
        #[serde(with = "tagged_f64_vec")]
        negative_buckets: Vec<f64>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeHistogram {
    pub schema: i32,
    #[serde(with = "tagged_f64")]
    pub zero_threshold: f64,
    #[serde(with = "tagged_f64")]
    pub sum: f64,
    #[serde(default)]
    pub start_time: i64,
    pub positive_spans: Vec<HistogramSpan>,
    pub negative_spans: Vec<HistogramSpan>,
    pub counter_reset_hint: CounterResetHint,
    pub counts: NativeHistogramCounts,
}

impl NativeHistogram {
    pub fn bucket_count(&self) -> usize {
        match &self.counts {
            NativeHistogramCounts::Integer {
                positive_buckets,
                negative_buckets,
                ..
            } => positive_buckets.len() + negative_buckets.len(),
            NativeHistogramCounts::Float {
                positive_buckets,
                negative_buckets,
                ..
            } => positive_buckets.len() + negative_buckets.len(),
        }
    }

    pub fn span_count(&self) -> usize {
        self.positive_spans.len() + self.negative_spans.len()
    }

    pub fn to_payload(&self) -> Result<String, HistogramError> {
        serde_json::to_string(self).map_err(|err| HistogramError::Json(err.to_string()))
    }

    pub fn from_payload(payload: &[u8]) -> Result<Self, HistogramError> {
        serde_json::from_slice(payload).map_err(|err| HistogramError::Json(err.to_string()))
    }

    pub fn validate(&self) -> Result<(), HistogramError> {
        validate_common(
            self.schema,
            self.zero_threshold,
            &self.positive_spans,
            &self.negative_spans,
            self.positive_bucket_len(),
            self.negative_bucket_len(),
        )?;

        match &self.counts {
            NativeHistogramCounts::Integer {
                zero_count,
                count,
                positive_buckets,
                negative_buckets,
            } => {
                let positive = decode_integer_buckets("positive", positive_buckets)?;
                let negative = decode_integer_buckets("negative", negative_buckets)?;
                let bucket_total = positive.iter().sum::<f64>()
                    + negative.iter().sum::<f64>()
                    + *zero_count as f64;
                let count = *count as f64;
                if self.sum.is_nan() {
                    if bucket_total > count {
                        return Err(HistogramError::CountTooSmall {
                            count,
                            buckets: bucket_total,
                        });
                    }
                } else if bucket_total != count {
                    return Err(HistogramError::CountMismatch {
                        count,
                        buckets: bucket_total,
                    });
                }
            }
            NativeHistogramCounts::Float {
                zero_count,
                count,
                positive_buckets,
                negative_buckets,
            } => {
                validate_float_count("zero", 0, *zero_count)?;
                validate_float_count("count", 0, *count)?;
                for (idx, value) in positive_buckets.iter().enumerate() {
                    validate_float_count("positive", idx, *value)?;
                }
                for (idx, value) in negative_buckets.iter().enumerate() {
                    validate_float_count("negative", idx, *value)?;
                }
            }
        }
        Ok(())
    }

    pub fn validate_limits(
        &self,
        payload_bytes: usize,
        max_payload_bytes: usize,
        max_buckets: usize,
        max_spans: usize,
    ) -> Result<(), HistogramError> {
        if payload_bytes > max_payload_bytes {
            return Err(HistogramError::PayloadTooLarge {
                actual: payload_bytes,
                limit: max_payload_bytes,
            });
        }
        if self.bucket_count() > max_buckets {
            return Err(HistogramError::TooManyBuckets {
                actual: self.bucket_count(),
                limit: max_buckets,
            });
        }
        if self.span_count() > max_spans {
            return Err(HistogramError::TooManySpans {
                actual: self.span_count(),
                limit: max_spans,
            });
        }
        Ok(())
    }

    pub fn to_float(&self) -> Result<O2FloatHistogram, HistogramError> {
        self.validate()?;
        let (zero_count, count, positive_buckets, negative_buckets) = match &self.counts {
            NativeHistogramCounts::Integer {
                zero_count,
                count,
                positive_buckets,
                negative_buckets,
            } => (
                *zero_count as f64,
                *count as f64,
                decode_integer_buckets("positive", positive_buckets)?,
                decode_integer_buckets("negative", negative_buckets)?,
            ),
            NativeHistogramCounts::Float {
                zero_count,
                count,
                positive_buckets,
                negative_buckets,
            } => (
                *zero_count,
                *count,
                positive_buckets.clone(),
                negative_buckets.clone(),
            ),
        };
        Ok(O2FloatHistogram {
            schema: self.schema,
            zero_threshold: self.zero_threshold,
            zero_count,
            count,
            sum: self.sum,
            positive_spans: self.positive_spans.clone(),
            negative_spans: self.negative_spans.clone(),
            positive_buckets,
            negative_buckets,
            counter_reset_hint: self.counter_reset_hint,
            start_time: self.start_time,
        })
    }

    fn positive_bucket_len(&self) -> usize {
        match &self.counts {
            NativeHistogramCounts::Integer {
                positive_buckets, ..
            } => positive_buckets.len(),
            NativeHistogramCounts::Float {
                positive_buckets, ..
            } => positive_buckets.len(),
        }
    }

    fn negative_bucket_len(&self) -> usize {
        match &self.counts {
            NativeHistogramCounts::Integer {
                negative_buckets, ..
            } => negative_buckets.len(),
            NativeHistogramCounts::Float {
                negative_buckets, ..
            } => negative_buckets.len(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct O2FloatHistogram {
    pub schema: i32,
    pub zero_threshold: f64,
    pub zero_count: f64,
    pub count: f64,
    pub sum: f64,
    pub positive_spans: Vec<HistogramSpan>,
    pub negative_spans: Vec<HistogramSpan>,
    /// Absolute bucket counts aligned with `positive_spans`.
    pub positive_buckets: Vec<f64>,
    /// Absolute bucket counts aligned with `negative_spans`.
    pub negative_buckets: Vec<f64>,
    pub counter_reset_hint: CounterResetHint,
    pub start_time: i64,
}

impl O2FloatHistogram {
    pub fn empty(schema: i32) -> Self {
        Self {
            schema,
            zero_threshold: 0.0,
            zero_count: 0.0,
            count: 0.0,
            sum: 0.0,
            positive_spans: Vec::new(),
            negative_spans: Vec::new(),
            positive_buckets: Vec::new(),
            negative_buckets: Vec::new(),
            counter_reset_hint: CounterResetHint::Unknown,
            start_time: 0,
        }
    }

    pub fn validate(&self) -> Result<(), HistogramError> {
        validate_common(
            self.schema,
            self.zero_threshold,
            &self.positive_spans,
            &self.negative_spans,
            self.positive_buckets.len(),
            self.negative_buckets.len(),
        )?;
        validate_float_count("zero", 0, self.zero_count)?;
        validate_float_count("count", 0, self.count)?;
        for (idx, value) in self.positive_buckets.iter().enumerate() {
            validate_float_count("positive", idx, *value)?;
        }
        for (idx, value) in self.negative_buckets.iter().enumerate() {
            validate_float_count("negative", idx, *value)?;
        }
        Ok(())
    }

    pub fn is_stale(&self) -> bool {
        self.sum.to_bits() == STALE_NAN_BITS
    }

    pub fn encoded_size(&self) -> usize {
        std::mem::size_of::<Self>()
            + self.positive_spans.len() * std::mem::size_of::<HistogramSpan>()
            + self.negative_spans.len() * std::mem::size_of::<HistogramSpan>()
            + (self.positive_buckets.len() + self.negative_buckets.len())
                * std::mem::size_of::<f64>()
    }

    pub fn has_overflow(&self) -> bool {
        self.zero_count.is_infinite()
            || self.count.is_infinite()
            || self.sum.is_infinite()
            || self
                .positive_buckets
                .iter()
                .any(|value| value.is_infinite())
            || self
                .negative_buckets
                .iter()
                .any(|value| value.is_infinite())
    }

    pub fn to_native_float(&self) -> NativeHistogram {
        NativeHistogram {
            schema: self.schema,
            zero_threshold: self.zero_threshold,
            sum: self.sum,
            start_time: self.start_time,
            positive_spans: self.positive_spans.clone(),
            negative_spans: self.negative_spans.clone(),
            counter_reset_hint: self.counter_reset_hint,
            counts: NativeHistogramCounts::Float {
                zero_count: self.zero_count,
                count: self.count,
                positive_buckets: self.positive_buckets.clone(),
                negative_buckets: self.negative_buckets.clone(),
            },
        }
    }

    pub fn indexed_positive(&self) -> Result<BTreeMap<i32, f64>, HistogramError> {
        indexed_buckets("positive", &self.positive_spans, &self.positive_buckets)
    }

    pub fn indexed_negative(&self) -> Result<BTreeMap<i32, f64>, HistogramError> {
        indexed_buckets("negative", &self.negative_spans, &self.negative_buckets)
    }

    pub fn all_buckets(&self) -> Result<Vec<HistogramBucket>, HistogramError> {
        let mut buckets =
            Vec::with_capacity(self.positive_buckets.len() + self.negative_buckets.len() + 1);
        for (idx, count) in self.indexed_negative()?.into_iter().rev() {
            buckets.push(HistogramBucket {
                lower: -get_bound_exponential(idx, self.schema),
                upper: -get_bound_exponential(idx - 1, self.schema),
                lower_inclusive: true,
                upper_inclusive: false,
                count,
            });
        }
        buckets.push(HistogramBucket {
            lower: -self.zero_threshold,
            upper: self.zero_threshold,
            lower_inclusive: true,
            upper_inclusive: true,
            count: self.zero_count,
        });
        for (idx, count) in self.indexed_positive()? {
            buckets.push(HistogramBucket {
                lower: get_bound_exponential(idx - 1, self.schema),
                upper: get_bound_exponential(idx, self.schema),
                lower_inclusive: false,
                upper_inclusive: true,
                count,
            });
        }
        Ok(buckets)
    }

    pub fn reduce_resolution(&mut self, target_schema: i32) -> Result<(), HistogramError> {
        if !(EXPONENTIAL_SCHEMA_MIN..=EXPONENTIAL_SCHEMA_MAX).contains(&target_schema) {
            return Err(HistogramError::UnsupportedSchema(target_schema));
        }
        if target_schema >= self.schema {
            return Ok(());
        }
        let shift = self.schema - target_schema;
        let reduce = |source: BTreeMap<i32, f64>| {
            let mut target = BTreeMap::new();
            for (idx, count) in source {
                let target_idx = ((idx - 1) >> shift) + 1;
                *target.entry(target_idx).or_insert(0.0) += count;
            }
            target
        };
        let positive = reduce(self.indexed_positive()?);
        let negative = reduce(self.indexed_negative()?);
        (self.positive_spans, self.positive_buckets) = spans_from_indexed(positive);
        (self.negative_spans, self.negative_buckets) = spans_from_indexed(negative);
        self.schema = target_schema;
        Ok(())
    }

    pub fn raise_zero_threshold(&mut self, threshold: f64) -> Result<(), HistogramError> {
        if threshold <= self.zero_threshold {
            return Ok(());
        }
        let mut threshold = threshold;
        for map in [self.indexed_positive()?, self.indexed_negative()?] {
            for (idx, count) in map {
                if count == 0.0 {
                    continue;
                }
                let lower = get_bound_exponential(idx - 1, self.schema);
                let upper = get_bound_exponential(idx, self.schema);
                if lower < threshold && upper > threshold {
                    threshold = upper;
                }
            }
        }
        let fold = |source: BTreeMap<i32, f64>, zero: &mut f64| {
            let mut target = BTreeMap::new();
            for (idx, count) in source {
                if get_bound_exponential(idx, self.schema) <= threshold {
                    *zero += count;
                } else {
                    target.insert(idx, count);
                }
            }
            target
        };
        let mut zero = self.zero_count;
        let positive = fold(self.indexed_positive()?, &mut zero);
        let negative = fold(self.indexed_negative()?, &mut zero);
        (self.positive_spans, self.positive_buckets) = spans_from_indexed(positive);
        (self.negative_spans, self.negative_buckets) = spans_from_indexed(negative);
        self.zero_count = zero;
        self.zero_threshold = threshold;
        Ok(())
    }

    pub fn add_assign(&mut self, other: &Self) -> Result<(), HistogramError> {
        self.combine_assign(other, 1.0)
    }

    /// Add a histogram with Neumaier/Kahan compensation for every scalar and bucket count.
    /// `compensation` is kept as a histogram so schema and zero-threshold reconciliation apply
    /// identically to the running value and its residuals.
    pub fn kahan_add_assign(
        &mut self,
        other: &Self,
        compensation: &mut Self,
    ) -> Result<(), HistogramError> {
        let target_schema = self.schema.min(other.schema).min(compensation.schema);
        self.reduce_resolution(target_schema)?;
        compensation.reduce_resolution(target_schema)?;
        let mut other = other.clone();
        other.reduce_resolution(target_schema)?;

        let threshold = self
            .zero_threshold
            .max(other.zero_threshold)
            .max(compensation.zero_threshold);
        self.raise_zero_threshold(threshold)?;
        compensation.raise_zero_threshold(threshold)?;
        other.raise_zero_threshold(threshold)?;

        let increment = |value: f64, sum: f64, residual: f64| {
            let updated_sum = sum + value;
            if updated_sum.is_infinite() {
                return (updated_sum, 0.0);
            }
            let rounding = if sum.abs() >= value.abs() {
                (sum - updated_sum) + value
            } else {
                (value - updated_sum) + sum
            };
            (updated_sum, residual + rounding)
        };
        let add_maps = |mut sum: BTreeMap<i32, f64>,
                        mut residual: BTreeMap<i32, f64>,
                        values: BTreeMap<i32, f64>| {
            for (index, value) in values {
                let (updated, updated_residual) = increment(
                    value,
                    sum.get(&index).copied().unwrap_or_default(),
                    residual.get(&index).copied().unwrap_or_default(),
                );
                sum.insert(index, updated);
                if updated_residual == 0.0 {
                    residual.remove(&index);
                } else {
                    residual.insert(index, updated_residual);
                }
            }
            (sum, residual)
        };

        let (positive, positive_compensation) = add_maps(
            self.indexed_positive()?,
            compensation.indexed_positive()?,
            other.indexed_positive()?,
        );
        let (negative, negative_compensation) = add_maps(
            self.indexed_negative()?,
            compensation.indexed_negative()?,
            other.indexed_negative()?,
        );
        (self.positive_spans, self.positive_buckets) = spans_from_indexed(positive);
        (self.negative_spans, self.negative_buckets) = spans_from_indexed(negative);
        (compensation.positive_spans, compensation.positive_buckets) =
            spans_from_indexed(positive_compensation);
        (compensation.negative_spans, compensation.negative_buckets) =
            spans_from_indexed(negative_compensation);

        (self.zero_count, compensation.zero_count) =
            increment(other.zero_count, self.zero_count, compensation.zero_count);
        (self.count, compensation.count) = increment(other.count, self.count, compensation.count);
        (self.sum, compensation.sum) = increment(other.sum, self.sum, compensation.sum);
        self.adjust_counter_reset_hint(other.counter_reset_hint);
        self.start_time = self.start_time.max(other.start_time);
        Ok(())
    }

    pub fn sub_assign(&mut self, other: &Self) -> Result<(), HistogramError> {
        self.combine_assign(other, -1.0)
    }

    fn combine_assign(&mut self, other: &Self, factor: f64) -> Result<(), HistogramError> {
        let target_schema = self.schema.min(other.schema);
        self.reduce_resolution(target_schema)?;
        let mut other = other.clone();
        other.reduce_resolution(target_schema)?;

        let threshold = self.zero_threshold.max(other.zero_threshold);
        self.raise_zero_threshold(threshold)?;
        other.raise_zero_threshold(self.zero_threshold)?;
        if other.zero_threshold > self.zero_threshold {
            self.raise_zero_threshold(other.zero_threshold)?;
        }

        let combine = |mut left: BTreeMap<i32, f64>, right: BTreeMap<i32, f64>| {
            for (idx, count) in right {
                *left.entry(idx).or_insert(0.0) += factor * count;
            }
            left.retain(|_, count| *count != 0.0);
            left
        };
        let positive = combine(self.indexed_positive()?, other.indexed_positive()?);
        let negative = combine(self.indexed_negative()?, other.indexed_negative()?);
        (self.positive_spans, self.positive_buckets) = spans_from_indexed(positive);
        (self.negative_spans, self.negative_buckets) = spans_from_indexed(negative);
        self.zero_count += factor * other.zero_count;
        self.count += factor * other.count;
        self.sum += factor * other.sum;
        self.start_time = self.start_time.max(other.start_time);
        self.adjust_counter_reset_hint(other.counter_reset_hint);
        Ok(())
    }

    fn adjust_counter_reset_hint(&mut self, other: CounterResetHint) {
        use CounterResetHint::*;
        self.counter_reset_hint = match (self.counter_reset_hint, other) {
            (left, right) if left == right => left,
            (Gauge, _) | (_, Gauge) => Gauge,
            (Unknown, _) | (_, Unknown) => Unknown,
            (CounterReset, NotCounterReset) | (NotCounterReset, CounterReset) => Unknown,
            _ => Unknown,
        };
    }

    pub fn scale(&mut self, factor: f64) {
        self.zero_count *= factor;
        self.count *= factor;
        self.sum *= factor;
        for bucket in &mut self.positive_buckets {
            *bucket *= factor;
        }
        for bucket in &mut self.negative_buckets {
            *bucket *= factor;
        }
    }

    pub fn detect_reset(&self, previous: &Self) -> Result<bool, HistogramError> {
        if self.counter_reset_hint == CounterResetHint::CounterReset {
            return Ok(true);
        }
        if self.counter_reset_hint == CounterResetHint::NotCounterReset {
            return Ok(false);
        }
        if self.count < previous.count
            || self.schema > previous.schema
            || self.zero_threshold < previous.zero_threshold
        {
            return Ok(true);
        }
        let mut previous = previous.clone();
        previous.reduce_resolution(self.schema)?;
        previous.raise_zero_threshold(self.zero_threshold)?;
        if self.zero_count < previous.zero_count {
            return Ok(true);
        }
        let current_positive = self.indexed_positive()?;
        let current_negative = self.indexed_negative()?;
        for (idx, count) in previous.indexed_positive()? {
            if current_positive.get(&idx).copied().unwrap_or(0.0) < count {
                return Ok(true);
            }
        }
        for (idx, count) in previous.indexed_negative()? {
            if current_negative.get(&idx).copied().unwrap_or(0.0) < count {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HistogramBucket {
    pub lower: f64,
    pub upper: f64,
    pub lower_inclusive: bool,
    pub upper_inclusive: bool,
    pub count: f64,
}

impl HistogramBucket {
    pub fn boundaries_code(&self) -> u8 {
        match (self.lower_inclusive, self.upper_inclusive) {
            (false, true) => 0,
            (true, false) => 1,
            (false, false) => 2,
            (true, true) => 3,
        }
    }
}

/// A histogram sample keeps either encoded or decoded state and memoizes the
/// other representation on demand, including decode failures.
#[derive(Debug)]
pub struct LazyHistogram {
    encoded: OnceLock<Bytes>,
    decoded: OnceLock<Result<O2FloatHistogram, Arc<HistogramError>>>,
    presence_stale: Option<bool>,
    _reservation: Option<MemoryReservation>,
}

impl LazyHistogram {
    pub fn from_payload(payload: Bytes) -> Self {
        Self::from_payload_reserved(payload, None)
    }

    fn from_payload_reserved(payload: Bytes, reservation: Option<MemoryReservation>) -> Self {
        let encoded = OnceLock::new();
        let _ = encoded.set(payload);
        Self {
            encoded,
            decoded: OnceLock::new(),
            presence_stale: None,
            _reservation: reservation,
        }
    }

    pub fn from_decoded(histogram: O2FloatHistogram) -> Self {
        Self::from_decoded_reserved(histogram, None)
    }

    fn from_decoded_reserved(
        histogram: O2FloatHistogram,
        reservation: Option<MemoryReservation>,
    ) -> Self {
        let decoded = OnceLock::new();
        let _ = decoded.set(Ok(histogram));
        Self {
            encoded: OnceLock::new(),
            decoded,
            presence_stale: None,
            _reservation: reservation,
        }
    }

    pub fn from_presence(is_stale: bool) -> Self {
        Self::from_presence_reserved(is_stale, None)
    }

    fn from_presence_reserved(is_stale: bool, reservation: Option<MemoryReservation>) -> Self {
        Self {
            encoded: OnceLock::new(),
            decoded: OnceLock::new(),
            presence_stale: Some(is_stale),
            _reservation: reservation,
        }
    }

    pub fn float(&self) -> Result<&O2FloatHistogram, Arc<HistogramError>> {
        if self.presence_stale.is_some() {
            return Err(Arc::new(HistogramError::PresenceOnlyAccess));
        }
        self.decoded
            .get_or_init(|| {
                let payload = self
                    .encoded
                    .get()
                    .ok_or_else(|| Arc::new(HistogramError::EmptyLazyHistogram))?;
                let limits = &crate::get_config().limit;
                if payload.len() > limits.metrics_nh_max_payload_bytes {
                    return Err(Arc::new(HistogramError::PayloadTooLarge {
                        actual: payload.len(),
                        limit: limits.metrics_nh_max_payload_bytes,
                    }));
                }
                let native = NativeHistogram::from_payload(payload).map_err(Arc::new)?;
                native
                    .validate_limits(
                        payload.len(),
                        limits.metrics_nh_max_payload_bytes,
                        limits.metrics_nh_max_buckets,
                        limits.metrics_nh_max_spans,
                    )
                    .map_err(Arc::new)?;
                native.validate().map_err(Arc::new)?;
                native.to_float().map_err(Arc::new)
            })
            .as_ref()
            .map_err(Arc::clone)
    }

    pub fn payload(&self) -> Result<&Bytes, Arc<HistogramError>> {
        if let Some(payload) = self.encoded.get() {
            return Ok(payload);
        }
        let histogram = self.float()?;
        let payload = histogram
            .to_native_float()
            .to_payload()
            .map(Bytes::from)
            .map_err(Arc::new)?;
        let _ = self.encoded.set(payload);
        self.encoded
            .get()
            .ok_or_else(|| Arc::new(HistogramError::EmptyLazyHistogram))
    }

    pub fn is_stale(&self) -> Result<bool, Arc<HistogramError>> {
        if let Some(is_stale) = self.presence_stale {
            return Ok(is_stale);
        }
        Ok(self.float()?.is_stale())
    }
}

#[derive(Debug, Clone)]
pub struct HistogramSample {
    /// Timestamp in microseconds.
    pub timestamp: i64,
    pub histogram: Arc<LazyHistogram>,
}

impl HistogramSample {
    pub fn from_payload(timestamp: i64, payload: Bytes) -> Self {
        Self {
            timestamp,
            histogram: Arc::new(LazyHistogram::from_payload(payload)),
        }
    }

    pub fn from_decoded(timestamp: i64, histogram: O2FloatHistogram) -> Self {
        Self {
            timestamp,
            histogram: Arc::new(LazyHistogram::from_decoded(histogram)),
        }
    }

    pub fn from_computed(
        timestamp: i64,
        histogram: O2FloatHistogram,
        parent: &LazyHistogram,
    ) -> Result<Self, HistogramError> {
        let reservation = parent
            ._reservation
            .as_ref()
            .map(MemoryReservation::new_empty);
        charge_reservation(reservation.as_ref(), histogram.encoded_size())?;
        Ok(Self {
            timestamp,
            histogram: Arc::new(LazyHistogram::from_decoded_reserved(histogram, reservation)),
        })
    }

    pub fn from_payload_mode(
        timestamp: i64,
        payload: Bytes,
        mode: HistogramLoadMode,
    ) -> Result<Self, HistogramError> {
        Self::from_payload_mode_reserved(timestamp, payload, mode, None)
    }

    pub fn from_payload_mode_reserved(
        timestamp: i64,
        payload: Bytes,
        mode: HistogramLoadMode,
        reservation: Option<MemoryReservation>,
    ) -> Result<Self, HistogramError> {
        let limits = &crate::get_config().limit;
        if payload.len() > limits.metrics_nh_max_payload_bytes {
            return Err(HistogramError::PayloadTooLarge {
                actual: payload.len(),
                limit: limits.metrics_nh_max_payload_bytes,
            });
        }
        match mode {
            HistogramLoadMode::PresenceOnly => {
                #[derive(Deserialize)]
                struct SumOnly {
                    #[serde(with = "tagged_f64")]
                    sum: f64,
                }
                let value = serde_json::from_slice::<SumOnly>(&payload)
                    .map_err(|err| HistogramError::Json(err.to_string()))?;
                charge_reservation(reservation.as_ref(), std::mem::size_of::<LazyHistogram>())?;
                Ok(Self {
                    timestamp,
                    histogram: Arc::new(LazyHistogram::from_presence_reserved(
                        value.sum.to_bits() == STALE_NAN_BITS,
                        reservation,
                    )),
                })
            }
            HistogramLoadMode::RawLazy | HistogramLoadMode::DecodeAfterSelection => {
                charge_reservation(reservation.as_ref(), payload.len())?;
                Ok(Self {
                    timestamp,
                    histogram: Arc::new(LazyHistogram::from_payload_reserved(payload, reservation)),
                })
            }
            HistogramLoadMode::DecodedOnly => {
                let native = NativeHistogram::from_payload(&payload)?;
                native.validate_limits(
                    payload.len(),
                    limits.metrics_nh_max_payload_bytes,
                    limits.metrics_nh_max_buckets,
                    limits.metrics_nh_max_spans,
                )?;
                let float = native.to_float()?;
                charge_reservation(reservation.as_ref(), float.encoded_size())?;
                Ok(Self {
                    timestamp,
                    histogram: Arc::new(LazyHistogram::from_decoded_reserved(float, reservation)),
                })
            }
        }
    }
}

fn charge_reservation(
    reservation: Option<&MemoryReservation>,
    bytes: usize,
) -> Result<(), HistogramError> {
    if let Some(reservation) = reservation {
        reservation
            .try_grow(bytes)
            .map_err(|err| HistogramError::Memory(err.to_string()))?;
    }
    Ok(())
}

fn validate_common(
    schema: i32,
    zero_threshold: f64,
    positive_spans: &[HistogramSpan],
    negative_spans: &[HistogramSpan],
    positive_buckets: usize,
    negative_buckets: usize,
) -> Result<(), HistogramError> {
    if schema == CUSTOM_BUCKETS_SCHEMA
        || !(EXPONENTIAL_SCHEMA_MIN..=EXPONENTIAL_SCHEMA_MAX).contains(&schema)
    {
        return Err(HistogramError::UnsupportedSchema(schema));
    }
    if !zero_threshold.is_finite() || zero_threshold < 0.0 {
        return Err(HistogramError::InvalidZeroThreshold(zero_threshold));
    }
    validate_spans("positive", positive_spans, positive_buckets)?;
    validate_spans("negative", negative_spans, negative_buckets)?;
    Ok(())
}

fn validate_spans(
    side: &'static str,
    spans: &[HistogramSpan],
    buckets: usize,
) -> Result<(), HistogramError> {
    let expected = spans.iter().map(|span| span.length as usize).sum::<usize>();
    if expected != buckets {
        return Err(HistogramError::SpanBucketMismatch {
            side,
            expected,
            actual: buckets,
        });
    }
    for (idx, span) in spans.iter().enumerate().skip(1) {
        if span.offset < 0 {
            return Err(HistogramError::NegativeSpanOffset {
                side,
                span: idx,
                offset: span.offset,
            });
        }
    }
    Ok(())
}

fn validate_float_count(
    side: &'static str,
    bucket: usize,
    count: f64,
) -> Result<(), HistogramError> {
    // Match Prometheus FloatHistogram.Validate: NaN and +Inf pass because
    // IEEE comparisons with NaN are false; only values `< 0` are rejected.
    if count < 0.0 {
        return Err(HistogramError::NegativeBucketCount {
            side,
            bucket,
            count,
        });
    }
    Ok(())
}

fn decode_integer_buckets(side: &'static str, deltas: &[i64]) -> Result<Vec<f64>, HistogramError> {
    let mut current = 0_i128;
    let mut result = Vec::with_capacity(deltas.len());
    for (idx, delta) in deltas.iter().enumerate() {
        current += *delta as i128;
        if current < 0 {
            return Err(HistogramError::NegativeBucketCount {
                side,
                bucket: idx,
                count: current as f64,
            });
        }
        result.push(current as f64);
    }
    Ok(result)
}

fn indexed_buckets(
    side: &'static str,
    spans: &[HistogramSpan],
    buckets: &[f64],
) -> Result<BTreeMap<i32, f64>, HistogramError> {
    validate_spans(side, spans, buckets.len())?;
    let mut result = BTreeMap::new();
    let mut bucket_position = 0;
    let mut current_index = 0_i32;
    for (span_idx, span) in spans.iter().enumerate() {
        if span_idx == 0 {
            current_index = span.offset;
        } else {
            current_index = current_index.saturating_add(1).saturating_add(span.offset);
        }
        for offset in 0..span.length {
            let index = current_index.saturating_add(offset as i32);
            result.insert(index, buckets[bucket_position]);
            bucket_position += 1;
        }
        if span.length > 0 {
            current_index = current_index.saturating_add(span.length as i32 - 1);
        }
    }
    Ok(result)
}

fn spans_from_indexed(indexed: BTreeMap<i32, f64>) -> (Vec<HistogramSpan>, Vec<f64>) {
    let mut spans = Vec::<HistogramSpan>::new();
    let mut buckets = Vec::with_capacity(indexed.len());
    let mut previous = None;
    for (index, count) in indexed {
        match previous {
            None => spans.push(HistogramSpan {
                offset: index,
                length: 1,
            }),
            Some(prev) if index == prev + 1 => {
                spans.last_mut().expect("span exists").length += 1;
            }
            Some(prev) => spans.push(HistogramSpan {
                offset: index - prev - 1,
                length: 1,
            }),
        }
        previous = Some(index);
        buckets.push(count);
    }
    (spans, buckets)
}

/// Prometheus exponential bucket upper bound for `idx` and `schema`.
///
/// The exponent is applied separately from the fractional bucket boundary so
/// the last finite bucket remains `f64::MAX` instead of collapsing into the
/// dedicated infinity bucket.
pub fn get_bound_exponential(idx: i32, schema: i32) -> f64 {
    debug_assert!((EXPONENTIAL_SCHEMA_MIN..=EXPONENTIAL_SCHEMA_MAX).contains(&schema));
    if schema < 0 {
        let exponent = idx.saturating_mul(1_i32 << (-schema));
        if exponent == 1024 {
            return f64::MAX;
        }
        return ldexp(1.0, exponent);
    }
    let buckets_per_power = 1_i32 << schema;
    let fraction_index = idx & (buckets_per_power - 1);
    let fraction = 2.0_f64.powf(fraction_index as f64 / buckets_per_power as f64 - 1.0);
    let exponent = (idx >> schema) + 1;
    if fraction == 0.5 && exponent == 1025 {
        return f64::MAX;
    }
    ldexp(fraction, exponent)
}

fn ldexp(value: f64, exponent: i32) -> f64 {
    if exponent > 1023 {
        value * 2.0_f64.powi(1023) * 2.0_f64.powi(exponent - 1023)
    } else if exponent < -1022 {
        value * 2.0_f64.powi(-1022) * 2.0_f64.powi(exponent + 1022)
    } else {
        value * 2.0_f64.powi(exponent)
    }
}

mod tagged_f64 {
    use super::*;

    pub fn serialize<S>(value: &f64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        TaggedF64(*value).serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<f64, D::Error>
    where
        D: Deserializer<'de>,
    {
        TaggedF64::deserialize(deserializer).map(|value| value.0)
    }
}

mod tagged_f64_vec {
    use super::*;

    pub fn serialize<S>(values: &[f64], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut seq = serializer.serialize_seq(Some(values.len()))?;
        for value in values {
            seq.serialize_element(&TaggedF64(*value))?;
        }
        seq.end()
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<f64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Vec::<TaggedF64>::deserialize(deserializer)
            .map(|values| values.into_iter().map(|value| value.0).collect())
    }
}

#[derive(Debug, Clone, Copy)]
struct TaggedF64(f64);

impl Serialize for TaggedF64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self.0 {
            value if value.is_finite() => serializer.serialize_f64(value),
            value if value.to_bits() == STALE_NAN_BITS => serializer.serialize_str("stale"),
            value if value.is_nan() => serializer.serialize_str("NaN"),
            value if value.is_sign_positive() => serializer.serialize_str("+Inf"),
            _ => serializer.serialize_str("-Inf"),
        }
    }
}

impl<'de> Deserialize<'de> for TaggedF64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Number(serde_json::Number),
            Text(String),
        }

        match Repr::deserialize(deserializer)? {
            Repr::Number(value) => value
                .as_f64()
                .map(TaggedF64)
                .ok_or_else(|| serde::de::Error::custom("number does not fit in f64")),
            Repr::Text(value) => match value.as_str() {
                "stale" => Ok(TaggedF64(STALE_NAN)),
                "NaN" => Ok(TaggedF64(f64::NAN)),
                "+Inf" => Ok(TaggedF64(f64::INFINITY)),
                "-Inf" => Ok(TaggedF64(f64::NEG_INFINITY)),
                _ => Err(serde::de::Error::custom(format!(
                    "invalid tagged f64 value {value}"
                ))),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn integer_histogram() -> NativeHistogram {
        NativeHistogram {
            schema: 0,
            zero_threshold: 0.001,
            sum: 20.0,
            start_time: 0,
            positive_spans: vec![
                HistogramSpan {
                    offset: 0,
                    length: 2,
                },
                HistogramSpan {
                    offset: 1,
                    length: 1,
                },
            ],
            negative_spans: vec![],
            counter_reset_hint: CounterResetHint::Unknown,
            counts: NativeHistogramCounts::Integer {
                zero_count: 0,
                count: 10,
                positive_buckets: vec![3, 1, -1],
                negative_buckets: vec![],
            },
        }
    }

    #[test]
    fn span_delta_decode_matches_prometheus() {
        let histogram = integer_histogram();
        histogram.validate().unwrap();
        let float = histogram.to_float().unwrap();
        assert_eq!(float.positive_buckets, vec![3.0, 4.0, 3.0]);
        assert_eq!(
            float
                .indexed_positive()
                .unwrap()
                .into_iter()
                .collect::<Vec<_>>(),
            vec![(0, 3.0), (1, 4.0), (3, 3.0)]
        );
    }

    #[test]
    fn tagged_non_finite_values_round_trip() {
        assert_eq!(serde_json::from_str::<TaggedF64>("0.0").unwrap().0, 0.0);
        assert_eq!(
            serde_json::from_str::<TaggedF64>(r#""stale""#)
                .unwrap()
                .0
                .to_bits(),
            STALE_NAN_BITS
        );
        let values = [STALE_NAN, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1.5];
        for value in values {
            let histogram = NativeHistogram {
                schema: 0,
                zero_threshold: 0.0,
                sum: value,
                start_time: 0,
                positive_spans: vec![],
                negative_spans: vec![],
                counter_reset_hint: CounterResetHint::Unknown,
                counts: NativeHistogramCounts::Float {
                    zero_count: value,
                    count: value,
                    positive_buckets: vec![],
                    negative_buckets: vec![],
                },
            };
            let payload = histogram.to_payload().unwrap();
            let decoded = NativeHistogram::from_payload(payload.as_bytes()).unwrap();
            if value.to_bits() == STALE_NAN_BITS {
                assert_eq!(decoded.sum.to_bits(), STALE_NAN_BITS);
            } else if value.is_nan() {
                assert!(decoded.sum.is_nan());
                assert_ne!(decoded.sum.to_bits(), STALE_NAN_BITS);
            } else {
                assert_eq!(decoded.sum, value);
            }
        }
    }

    #[test]
    fn exponential_extreme_boundaries_keep_inf_bucket_distinct() {
        for schema in EXPONENTIAL_SCHEMA_MIN..=EXPONENTIAL_SCHEMA_MAX {
            let last = if schema < 0 {
                1024 >> -schema
            } else {
                1024 << schema
            };
            assert_eq!(get_bound_exponential(last, schema), f64::MAX);
            assert_eq!(get_bound_exponential(last + 1, schema), f64::INFINITY);
        }
    }

    #[test]
    fn rejects_custom_bucket_schema() {
        let mut histogram = integer_histogram();
        histogram.schema = CUSTOM_BUCKETS_SCHEMA;
        assert_eq!(
            histogram.validate(),
            Err(HistogramError::UnsupportedSchema(CUSTOM_BUCKETS_SCHEMA))
        );
    }

    #[test]
    fn reduce_resolution_uses_prometheus_index_mapping() {
        let mut histogram = O2FloatHistogram {
            schema: 2,
            zero_threshold: 0.0,
            zero_count: 0.0,
            count: 6.0,
            sum: 6.0,
            positive_spans: vec![HistogramSpan {
                offset: 1,
                length: 3,
            }],
            negative_spans: vec![],
            positive_buckets: vec![1.0, 2.0, 3.0],
            negative_buckets: vec![],
            counter_reset_hint: CounterResetHint::Unknown,
            start_time: 0,
        };
        histogram.reduce_resolution(0).unwrap();
        assert_eq!(histogram.indexed_positive().unwrap().get(&1), Some(&6.0));
    }

    #[test]
    fn histogram_load_modes_preserve_lazy_and_presence_semantics() {
        let payload = Bytes::from(integer_histogram().to_payload().unwrap());

        let presence = HistogramSample::from_payload_mode(
            10,
            payload.clone(),
            HistogramLoadMode::PresenceOnly,
        )
        .unwrap();
        assert!(!presence.histogram.is_stale().unwrap());
        assert_eq!(
            presence.histogram.float().unwrap_err().as_ref(),
            &HistogramError::PresenceOnlyAccess
        );

        let raw =
            HistogramSample::from_payload_mode(10, payload.clone(), HistogramLoadMode::RawLazy)
                .unwrap();
        assert_eq!(raw.histogram.payload().unwrap().as_ref(), payload.as_ref());
        assert_eq!(raw.histogram.float().unwrap().count, 10.0);

        let decoded =
            HistogramSample::from_payload_mode(10, payload, HistogramLoadMode::DecodedOnly)
                .unwrap();
        assert_eq!(decoded.histogram.float().unwrap().count, 10.0);
        assert!(decoded.histogram.payload().unwrap().starts_with(b"{"));
    }

    #[test]
    fn presence_mode_recognizes_stale_marker_without_materializing_histogram() {
        let mut histogram = integer_histogram();
        histogram.sum = STALE_NAN;
        let sample = HistogramSample::from_payload_mode(
            10,
            Bytes::from(histogram.to_payload().unwrap()),
            HistogramLoadMode::PresenceOnly,
        )
        .unwrap();
        assert!(sample.histogram.is_stale().unwrap());
    }
}
