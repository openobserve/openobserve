// Code adopted from https://crates.io/crates/prometheus-json-encoder, and changed to fit the requirements.
// following notice is from the original crate -
// Adapted from : https://docs.rs/prometheus/0.13.0/src/prometheus/encoder/text.rs.html#21
// Copyright 2019 TiKV Project Authors. Licensed under Apache-2.0.

use std::io::{self, Write};

use prometheus::{
    Encoder, Result,
    proto::{self, MetricFamily, MetricType},
};
use serde_json::{Map, Value, json};

/// The text format of metric family.
pub const TEXT_FORMAT: &str = "text/plain; version=0.0.4";

const POSITIVE_INF: &str = "+Inf";

/// An implementation of an [`Encoder`] that converts a [`MetricFamily`] proto message
/// into json format.

#[derive(Debug, Default)]
pub struct JsonEncoder;

impl JsonEncoder {
    /// Create a new json encoder.
    pub fn new() -> JsonEncoder {
        JsonEncoder
    }
    /// Appends metrics to a given `String` buffer.
    ///
    /// This is a convenience wrapper around `<JsonEncoder as Encoder>::encode`.
    pub fn encode_utf8(&self, metric_families: &[MetricFamily], buf: &mut String) -> Result<()> {
        // Note: it's important to *not* re-validate UTF8-validity for the
        // entirety of `buf`. Otherwise, repeatedly appending metrics to the
        // same `buf` will lead to quadratic behavior. That's why we use
        // `WriteUtf8` abstraction to skip the validation.
        self.encode_impl(metric_families, &mut StringBuf(buf))?;
        Ok(())
    }
    /// Converts metrics to `String`.
    ///
    /// This is a convenience wrapper around `<JsonEncoder as Encoder>::encode`.
    pub fn encode_to_string(&self, metric_families: &[MetricFamily]) -> Result<String> {
        let mut buf = String::new();
        self.encode_utf8(metric_families, &mut buf)?;
        Ok(buf)
    }

    pub fn encode_to_json(&self, metric_families: &[MetricFamily]) -> Vec<Value> {
        let mut ret = Vec::with_capacity(metric_families.len());

        for mf in metric_families {
            // Add entry for the metric
            let name: &str = mf.name();

            let mut mf_map = Map::new();

            // Add Help
            let help: &str = mf.help();
            mf_map.insert("help".to_string(), json! {help});
            mf_map.insert("__name__".to_string(), json! {name});

            // Write `# TYPE` header.
            let metric_type: MetricType = mf.get_field_type();
            let lowercase_type = json!(format!("{metric_type:?}").to_lowercase());
            mf_map.insert("__type__".to_string(), lowercase_type);

            for m in mf.get_metric() {
                // Metric
                match metric_type {
                    MetricType::COUNTER => {
                        mf_map.insert("value".to_string(), json!(m.get_counter().value()));
                        extra_info(&mut mf_map, m);
                        // f64
                    }
                    MetricType::GAUGE => {
                        mf_map.insert("value".to_string(), json!(m.get_gauge().value()));
                        extra_info(&mut mf_map, m);
                        // f64
                    }
                    MetricType::HISTOGRAM => {
                        // initial type row
                        ret.push(json!(mf_map.clone()));

                        let h = m.get_histogram();
                        let mut upper_bounds: Vec<Value> = vec![];
                        let mut cumulative_counts: Vec<Value> = vec![];
                        let mut inf_seen = false;

                        for b in h.get_bucket() {
                            let upper_bound = b.upper_bound(); // f64
                            let cumulative_count = b.cumulative_count(); // f64

                            upper_bounds.push(json!(upper_bound));
                            cumulative_counts.push(json!(cumulative_count));

                            if upper_bound.is_sign_positive() && upper_bound.is_infinite() {
                                inf_seen = true;
                            }
                        }
                        if !inf_seen {
                            upper_bounds.push(json!(POSITIVE_INF));
                            cumulative_counts.push(json!(h.get_sample_count()));
                        }
                        // individual buckets
                        let timestamp = crate::utils::time::now_micros();
                        for (bound, value) in
                            upper_bounds.into_iter().zip(cumulative_counts.into_iter())
                        {
                            let mut row = Map::new();
                            row.insert("_timestamp".to_string(), json!(timestamp));
                            row.insert("__name__".to_string(), json!(format!("{}_bucket", name)));
                            row.insert("__type__".to_string(), json!("counter"));
                            row.insert("le".to_string(), json!(bound));
                            row.insert("value".to_string(), json!(value));
                            extra_info(&mut row, m);
                            ret.push(json!(row));
                        }
                        // final two rows for histogram sum and count

                        let count = json!(h.get_sample_count());
                        let sum = json!(h.get_sample_sum());

                        for (ty, val) in ["count", "sum"].into_iter().zip([count, sum].into_iter())
                        {
                            let mut row = Map::new();
                            row.insert("_timestamp".to_string(), json!(timestamp));
                            row.insert("__name__".to_string(), json!(format!("{}_{}", name, ty)));
                            row.insert("__type__".to_string(), json!("counter"));
                            row.insert("value".to_string(), val);
                            extra_info(&mut row, m);
                            ret.push(json!(row));
                        }
                        continue;
                    }

                    MetricType::SUMMARY => {
                        // initial type row
                        ret.push(json!(mf_map.clone()));

                        let s = m.get_summary();
                        let mut quantiles = vec![];
                        let mut values = vec![];

                        for q in s.get_quantile() {
                            quantiles.push(json!(q.quantile()));
                            values.push(q.value());
                        }

                        // individual buckets
                        let timestamp = crate::utils::time::now_micros();
                        for (quantile, value) in quantiles.into_iter().zip(values.into_iter()) {
                            let mut row = Map::new();
                            row.insert("_timestamp".to_string(), json!(timestamp));
                            row.insert("__name__".to_string(), json!(format!("{}_bucket", name)));
                            row.insert("__type__".to_string(), json!("counter"));
                            row.insert("quantile".to_string(), json!(quantile));
                            row.insert("value".to_string(), json!(value));
                            extra_info(&mut row, m);
                            ret.push(json!(row));
                        }

                        let names = ["sum".to_string(), "count".to_string()];

                        let values = [json!(s.sample_sum()), json!(s.sample_count())];
                        for (key, value) in names.into_iter().zip(values.into_iter()) {
                            let mut row = Map::new();
                            row.insert("_timestamp".to_string(), json!(timestamp));
                            row.insert("__name__".to_string(), json!(format!("{name}_{key}")));
                            row.insert("__type__".to_string(), json!("counter"));
                            row.insert("value".to_string(), value);
                            extra_info(&mut row, m);
                            ret.push(json!(row));
                        }
                        continue;
                    }
                    MetricType::UNTYPED => {
                        continue;
                    }
                }
            }
            ret.push(json!(mf_map));
        }
        ret
    }

    fn encode_impl(
        &self,
        metric_families: &[MetricFamily],
        writer: &mut dyn WriteUtf8,
    ) -> Result<()> {
        let values = self.encode_to_json(metric_families);
        let x = serde_json::to_vec(&values).unwrap();
        writer.write_all(&x)?; // String
        Ok(())
    }
}

impl Encoder for JsonEncoder {
    fn encode<W: Write>(&self, metric_families: &[MetricFamily], writer: &mut W) -> Result<()> {
        self.encode_impl(metric_families, &mut *writer)
    }

    fn format_type(&self) -> &str {
        TEXT_FORMAT
    }
}

// Adds into a map m.timestamp and m.LabelPair.
// names and values must be of the same length
fn extra_info(map: &mut Map<String, Value>, mc: &proto::Metric) {
    let timestamp = mc.timestamp_ms();
    if timestamp != 0 {
        map.insert("_timestamp".to_string(), json!(timestamp));
    }

    for lp in mc.get_label() {
        map.insert(lp.name().to_string(), json!(lp.value()));
    }
}

trait WriteUtf8 {
    fn write_all(&mut self, text: &[u8]) -> io::Result<()>;
}

impl<W: Write> WriteUtf8 for W {
    fn write_all(&mut self, text: &[u8]) -> io::Result<()> {
        Write::write_all(self, text)
    }
}

/// Coherence forbids to impl `WriteUtf8` directly on `String`, need this
/// wrapper as a work-around.
struct StringBuf<'a>(&'a mut String);

impl WriteUtf8 for StringBuf<'_> {
    fn write_all(&mut self, text: &[u8]) -> io::Result<()> {
        self.0.push_str(std::str::from_utf8(text).unwrap());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use prometheus::{Counter, Gauge, Histogram, HistogramOpts, core::Collector};

    use super::*;

    #[test]
    fn test_encode_counter() {
        let counter = Counter::new("test_counter", "test counter help").unwrap();
        counter.inc();
        counter.inc_by(2.0);

        let encoder = JsonEncoder::new();
        let mut buf = String::new();
        encoder.encode_utf8(&counter.collect(), &mut buf).unwrap();
        let json: Value = serde_json::from_str(&buf).unwrap();

        assert!(json.is_array());
        let metrics = json.as_array().unwrap();
        assert!(!metrics.is_empty());

        let metric = &metrics[0];
        assert_eq!(metric["__name__"], "test_counter");
        assert_eq!(metric["help"], "test counter help");
        assert_eq!(metric["__type__"], "counter");
        assert_eq!(metric["value"], 3.0);
    }

    #[test]
    fn test_encode_gauge() {
        let gauge = Gauge::new("test_gauge", "test gauge help").unwrap();
        gauge.set(42.0);

        let encoder = JsonEncoder::new();
        let mut buf = String::new();
        encoder.encode_utf8(&gauge.collect(), &mut buf).unwrap();
        let json: Value = serde_json::from_str(&buf).unwrap();

        let metrics = json.as_array().unwrap();
        let metric = &metrics[0];
        assert_eq!(metric["__name__"], "test_gauge");
        assert_eq!(metric["help"], "test gauge help");
        assert_eq!(metric["__type__"], "gauge");
        assert_eq!(metric["value"], 42.0);
    }

    #[test]
    fn test_encode_histogram() {
        let histogram = Histogram::with_opts(
            HistogramOpts::new("test_histogram", "test histogram help")
                .buckets(vec![1.0, 2.0, 5.0]),
        )
        .unwrap();
        histogram.observe(1.5);
        histogram.observe(2.5);
        histogram.observe(3.5);

        let encoder = JsonEncoder::new();
        let mut buf = String::new();
        encoder.encode_utf8(&histogram.collect(), &mut buf).unwrap();
        let json: Value = serde_json::from_str(&buf).unwrap();

        let metrics = json.as_array().unwrap();
        assert!(metrics.len() > 1); // Should have multiple entries for buckets, sum, and count

        // Find the sum metric
        let sum_metric = metrics
            .iter()
            .find(|m| m["__name__"] == "test_histogram_sum")
            .unwrap();
        assert_eq!(sum_metric["__type__"], "counter");
        assert!(sum_metric["value"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn test_encode_multiple_metrics() {
        let counter = Counter::new("test_counter", "test counter help").unwrap();
        let gauge = Gauge::new("test_gauge", "test gauge help").unwrap();
        counter.inc();
        gauge.set(42.0);

        let encoder = JsonEncoder::new();
        let mut buf = String::new();
        encoder.encode_utf8(&counter.collect(), &mut buf).unwrap();
        let json: Value = serde_json::from_str(&buf).unwrap();

        let metrics = json.as_array().unwrap();
        assert_eq!(metrics.len(), 1);

        let counter_metric = metrics
            .iter()
            .find(|m| m["__name__"] == "test_counter")
            .unwrap();

        let encoder = JsonEncoder::new();
        let mut buf = String::new();
        encoder.encode_utf8(&gauge.collect(), &mut buf).unwrap();
        let json: Value = serde_json::from_str(&buf).unwrap();

        let metrics = json.as_array().unwrap();
        assert_eq!(metrics.len(), 1);
        let gauge_metric = metrics
            .iter()
            .find(|m| m["__name__"] == "test_gauge")
            .unwrap();

        assert_eq!(counter_metric["value"], 1.0);
        assert_eq!(gauge_metric["value"], 42.0);
    }

    #[test]
    fn test_encode_to_string() {
        let counter = Counter::new("test_counter", "test counter help").unwrap();
        counter.inc();

        let encoder = JsonEncoder::new();
        let result = encoder.encode_to_string(&counter.collect()).unwrap();
        let json: Value = serde_json::from_str(&result).unwrap();

        assert!(json.is_array());
        let metrics = json.as_array().unwrap();
        assert!(!metrics.is_empty());
        assert_eq!(metrics[0]["__name__"], "test_counter");
    }
}
