// Copyright 2023 Openobserve.ai and Contributors
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

use crate::service::promql::value::{InstantValue, LabelsExt, Sample, Value};
use datafusion::error::{DataFusionError, Result};
use strum::EnumIter;

#[derive(Debug, EnumIter)]
pub enum MathOperationsType {
    Abs,
    Ceil,
    Floor,
    Exp,
    Sqrt,
    Ln,
    Log2,
    Log10,
    Round,
}

impl MathOperationsType {
    /// Apply a given simple match function to a float type
    pub fn apply(&self, input: f64) -> f64 {
        match self {
            Self::Abs => input.abs(),
            Self::Ceil => input.ceil(),
            Self::Floor => input.floor(),
            Self::Exp => input.exp(),
            Self::Sqrt => input.sqrt(),
            Self::Ln => input.ln(),
            Self::Log2 => input.log2(),
            Self::Log10 => input.log10(),
            Self::Round => input.round(),
        }
    }
}

pub(crate) fn abs(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Abs)
}

pub(crate) fn ceil(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Ceil)
}

pub(crate) fn floor(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Floor)
}

pub(crate) fn exp(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Exp)
}

pub(crate) fn ln(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Ln)
}

pub(crate) fn log2(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Log2)
}

pub(crate) fn log10(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Log10)
}

pub(crate) fn sqrt(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Sqrt)
}

pub(crate) fn round(data: &Value) -> Result<Value> {
    exec(data, &MathOperationsType::Round)
}

fn exec(data: &Value, op: &MathOperationsType) -> Result<Value> {
    match &data {
        Value::Vector(v) => {
            let out = v
                .iter()
                .map(|instant| {
                    let val = op.apply(instant.sample.value);
                    InstantValue {
                        labels: instant.labels.without_metric_name(),
                        sample: Sample::new(instant.sample.timestamp, val),
                    }
                })
                .collect();
            Ok(Value::Vector(out))
        }
        Value::None => Ok(Value::None),
        _ => Err(DataFusionError::NotImplemented(format!(
            "Invalid input for minute value: {:?}",
            data
        ))),
    }
}
