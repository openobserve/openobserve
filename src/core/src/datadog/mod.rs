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

//! Translation of Datadog Agent payloads into OTLP requests and flat log records.

mod logs;
mod metrics;
mod sketches;
mod tags;
mod traces;

use std::collections::BTreeMap;

pub use logs::logs_to_records;
pub use metrics::{check_runs_to_otlp, series_to_otlp};
use opentelemetry_proto::tonic::common::v1::{KeyValue, any_value::Value};
pub use sketches::sketches_to_otlp;
pub use traces::agent_payload_to_otlp;

/// Bytes a payload may copy or expand into per body byte; captured Agent payloads use under 11.
const EXPANSION_FACTOR: usize = 64;
/// Body size credited to small payloads, so a few tags on many points still translate.
const MIN_BUDGET_BODY: usize = 64 * 1024;
/// Approximate in-memory size of one attribute entry besides its key and value text.
const ENTRY_BYTES: usize = 64;
/// Approximate in-memory size of one translated resource, metric or span besides its attributes.
const RECORD_BYTES: usize = 256;

/// A Datadog payload that cannot be decoded; the caller answers it with 400.
#[derive(Debug, thiserror::Error)]
pub enum DatadogError {
    #[error("invalid Datadog payload: {0}")]
    Decode(String),
}

/// Bytes a translation may copy from shared tags or expand into buckets, charged before allocation.
#[derive(Debug)]
struct ExpansionBudget(usize);

impl ExpansionBudget {
    fn new(body: &[u8]) -> Self {
        Self(
            body.len()
                .max(MIN_BUDGET_BODY)
                .saturating_mul(EXPANSION_FACTOR),
        )
    }

    fn charge(&mut self, bytes: usize, copies: usize) -> Result<(), DatadogError> {
        self.0 = self
            .0
            .checked_sub(bytes.saturating_mul(copies))
            .ok_or_else(|| DatadogError::Decode("payload expands past its size budget".into()))?;
        Ok(())
    }
}

fn entry_bytes(key: &str, value_len: usize) -> usize {
    ENTRY_BYTES + key.len() + value_len
}

fn resource_bytes(resource: &BTreeMap<String, String>) -> usize {
    resource.iter().map(|(k, v)| entry_bytes(k, v.len())).sum()
}

fn attributes_bytes(attributes: &[KeyValue]) -> usize {
    attributes
        .iter()
        .map(|kv| {
            let value_len = match kv.value.as_ref().and_then(|v| v.value.as_ref()) {
                Some(Value::StringValue(s)) => s.len(),
                _ => size_of::<f64>(),
            };
            entry_bytes(&kv.key, value_len)
        })
        .sum()
}
