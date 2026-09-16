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

use anyhow::{anyhow, bail};
use prost::Message;
use proto::prometheus_rpc;

/// A remote-write v1 `WriteRequest` whose label strings borrow the decoded body.
#[derive(Debug)]
pub(super) struct WriteRequest<'a> {
    pub timeseries: Vec<TimeSeries<'a>>,
    pub metadata: Vec<prometheus_rpc::MetricMetadata>,
}

#[derive(Debug)]
pub(super) struct TimeSeries<'a> {
    pub labels: Vec<(&'a str, &'a str)>,
    pub samples: Vec<Sample>,
    pub histograms: Vec<prometheus_rpc::Histogram>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Sample {
    pub value: f64,
    pub timestamp: i64,
}

const WIRE_VARINT: u8 = 0;
const WIRE_FIXED64: u8 = 1;
const WIRE_LEN: u8 = 2;
const WIRE_FIXED32: u8 = 5;

/// Decodes the request without copying a label; histograms and metadata still go through prost.
pub(super) fn decode(body: &[u8]) -> anyhow::Result<WriteRequest<'_>> {
    let mut timeseries = Vec::new();
    let mut metadata = Vec::new();
    let mut fields = Fields::new(body);
    while let Some((field, wire)) = fields.next_tag()? {
        match (field, wire) {
            (1, WIRE_LEN) => timeseries.push(decode_timeseries(fields.bytes()?)?),
            (3, WIRE_LEN) => {
                metadata.push(prometheus_rpc::MetricMetadata::decode(fields.bytes()?)?)
            }
            _ => fields.skip(wire)?,
        }
    }
    Ok(WriteRequest {
        timeseries,
        metadata,
    })
}

fn decode_timeseries(body: &[u8]) -> anyhow::Result<TimeSeries<'_>> {
    let mut labels = Vec::new();
    let mut samples = Vec::new();
    let mut histograms = Vec::new();
    let mut fields = Fields::new(body);
    while let Some((field, wire)) = fields.next_tag()? {
        match (field, wire) {
            (1, WIRE_LEN) => labels.push(decode_label(fields.bytes()?)?),
            (2, WIRE_LEN) => samples.push(decode_sample(fields.bytes()?)?),
            (4, WIRE_LEN) => histograms.push(prometheus_rpc::Histogram::decode(fields.bytes()?)?),
            // exemplars (3) are never stored, so they are not even walked
            _ => fields.skip(wire)?,
        }
    }
    Ok(TimeSeries {
        labels,
        samples,
        histograms,
    })
}

fn decode_label(body: &[u8]) -> anyhow::Result<(&str, &str)> {
    let (mut name, mut value) = ("", "");
    let mut fields = Fields::new(body);
    while let Some((field, wire)) = fields.next_tag()? {
        match (field, wire) {
            (1, WIRE_LEN) => name = fields.str()?,
            (2, WIRE_LEN) => value = fields.str()?,
            _ => fields.skip(wire)?,
        }
    }
    Ok((name, value))
}

fn decode_sample(body: &[u8]) -> anyhow::Result<Sample> {
    let mut sample = Sample {
        value: 0.0,
        timestamp: 0,
    };
    let mut fields = Fields::new(body);
    while let Some((field, wire)) = fields.next_tag()? {
        match (field, wire) {
            (1, WIRE_FIXED64) => sample.value = f64::from_bits(fields.fixed64()?),
            (2, WIRE_VARINT) => sample.timestamp = fields.varint()? as i64,
            _ => fields.skip(wire)?,
        }
    }
    Ok(sample)
}

/// A cursor over one message's fields.
struct Fields<'a> {
    body: &'a [u8],
    pos: usize,
}

impl<'a> Fields<'a> {
    fn new(body: &'a [u8]) -> Self {
        Self { body, pos: 0 }
    }

    fn next_tag(&mut self) -> anyhow::Result<Option<(u32, u8)>> {
        if self.pos >= self.body.len() {
            return Ok(None);
        }
        let tag = self.varint()?;
        let field = u32::try_from(tag >> 3).map_err(|_| anyhow!("invalid field number"))?;
        if field == 0 {
            bail!("invalid field number 0");
        }
        Ok(Some((field, (tag & 7) as u8)))
    }

    fn varint(&mut self) -> anyhow::Result<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *self
                .body
                .get(self.pos)
                .ok_or_else(|| anyhow!("truncated varint"))?;
            self.pos += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        bail!("varint longer than 10 bytes")
    }

    fn fixed64(&mut self) -> anyhow::Result<u64> {
        let end = self.pos + 8;
        let bytes = self
            .body
            .get(self.pos..end)
            .ok_or_else(|| anyhow!("truncated fixed64"))?;
        self.pos = end;
        Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
    }

    fn bytes(&mut self) -> anyhow::Result<&'a [u8]> {
        let len = usize::try_from(self.varint()?).map_err(|_| anyhow!("invalid length"))?;
        let end = self
            .pos
            .checked_add(len)
            .filter(|end| *end <= self.body.len())
            .ok_or_else(|| anyhow!("truncated length-delimited field"))?;
        let bytes = &self.body[self.pos..end];
        self.pos = end;
        Ok(bytes)
    }

    fn str(&mut self) -> anyhow::Result<&'a str> {
        std::str::from_utf8(self.bytes()?).map_err(|e| anyhow!("invalid utf-8 in label: {e}"))
    }

    fn skip(&mut self, wire: u8) -> anyhow::Result<()> {
        match wire {
            WIRE_VARINT => self.varint().map(drop),
            WIRE_FIXED64 => self.fixed64().map(drop),
            WIRE_LEN => self.bytes().map(drop),
            WIRE_FIXED32 => {
                let end = self.pos + 4;
                if end > self.body.len() {
                    bail!("truncated fixed32");
                }
                self.pos = end;
                Ok(())
            }
            _ => bail!("unsupported wire type {wire}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(name: &str, value: &str) -> prometheus_rpc::Label {
        prometheus_rpc::Label {
            name: name.to_string(),
            value: value.to_string(),
        }
    }

    fn request() -> prometheus_rpc::WriteRequest {
        prometheus_rpc::WriteRequest {
            timeseries: vec![
                prometheus_rpc::TimeSeries {
                    labels: vec![label("__name__", "http_requests"), label("job", "api")],
                    samples: vec![
                        prometheus_rpc::Sample {
                            value: 1.5,
                            timestamp: 1_700_000_000_000,
                        },
                        prometheus_rpc::Sample {
                            value: -2.0,
                            timestamp: -5,
                        },
                    ],
                    exemplars: vec![prometheus_rpc::Exemplar {
                        labels: vec![label("trace_id", "abc")],
                        value: 3.0,
                        timestamp: 7,
                    }],
                    histograms: vec![prometheus_rpc::Histogram {
                        sum: 12.5,
                        schema: 3,
                        timestamp: 1_700_000_000_000,
                        positive_spans: vec![prometheus_rpc::BucketSpan {
                            offset: -1,
                            length: 2,
                        }],
                        positive_deltas: vec![1, 2],
                        ..Default::default()
                    }],
                },
                prometheus_rpc::TimeSeries {
                    labels: vec![label("__name__", "empty_value"), label("v", "")],
                    samples: vec![],
                    exemplars: vec![],
                    histograms: vec![],
                },
            ],
            metadata: vec![prometheus_rpc::MetricMetadata {
                r#type: prometheus_rpc::metric_metadata::MetricType::Counter as i32,
                metric_family_name: "http_requests".to_string(),
                help: "requests".to_string(),
                unit: "1".to_string(),
            }],
        }
    }

    #[test]
    fn test_decode_matches_prost() {
        let expected = request();
        let body = expected.encode_to_vec();
        let decoded = decode(&body).unwrap();

        assert_eq!(decoded.timeseries.len(), 2);
        let first = &decoded.timeseries[0];
        assert_eq!(
            first.labels,
            vec![("__name__", "http_requests"), ("job", "api")]
        );
        assert_eq!(
            first.samples,
            vec![
                Sample {
                    value: 1.5,
                    timestamp: 1_700_000_000_000
                },
                Sample {
                    value: -2.0,
                    timestamp: -5
                }
            ]
        );
        assert_eq!(first.histograms, expected.timeseries[0].histograms);
        let second = &decoded.timeseries[1];
        assert_eq!(second.labels, vec![("__name__", "empty_value"), ("v", "")]);
        assert!(second.samples.is_empty() && second.histograms.is_empty());
        assert_eq!(decoded.metadata, expected.metadata);
    }

    #[test]
    fn test_decode_skips_unknown_fields_and_any_field_order() {
        // samples before labels, then an unknown varint, fixed64, fixed32 and length field
        let mut body = Vec::new();
        let mut ts = Vec::new();
        prost::encoding::message::encode(
            2,
            &prometheus_rpc::Sample {
                value: 4.0,
                timestamp: 9,
            },
            &mut ts,
        );
        prost::encoding::message::encode(1, &label("__name__", "m"), &mut ts);
        prost::encoding::uint64::encode(90, &7u64, &mut ts);
        prost::encoding::fixed64::encode(91, &8u64, &mut ts);
        prost::encoding::fixed32::encode(92, &9u32, &mut ts);
        prost::encoding::bytes::encode(93, &vec![1u8, 2, 3], &mut ts);
        prost::encoding::bytes::encode(1, &ts, &mut body);

        let decoded = decode(&body).unwrap();
        assert_eq!(decoded.timeseries[0].labels, vec![("__name__", "m")]);
        assert_eq!(
            decoded.timeseries[0].samples,
            vec![Sample {
                value: 4.0,
                timestamp: 9
            }]
        );
    }

    #[test]
    fn test_decode_rejects_truncated_and_invalid_input() {
        let body = request().encode_to_vec();
        assert!(decode(&body[..body.len() - 3]).is_err());

        let mut bad_label = Vec::new();
        prost::encoding::bytes::encode(1, &vec![0xffu8, 0xfe], &mut bad_label);
        let mut ts = Vec::new();
        prost::encoding::bytes::encode(1, &bad_label, &mut ts);
        let mut body = Vec::new();
        prost::encoding::bytes::encode(1, &ts, &mut body);
        assert!(decode(&body).unwrap_err().to_string().contains("utf-8"));

        assert!(decode(&[]).unwrap().timeseries.is_empty());
    }
}
