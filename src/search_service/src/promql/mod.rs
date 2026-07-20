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

use config::meta::promql::value;
use proto::cluster_rpc;

pub mod cache;

pub(crate) fn add_value(resp: &mut cluster_rpc::MetricsQueryResponse, value: value::Value) {
    match value {
        value::Value::None => {}
        value::Value::Instant(value) => {
            resp.series.push(cluster_rpc::Series {
                metric: value
                    .labels
                    .iter()
                    .map(|label| label.as_ref().into())
                    .collect(),
                sample: Some((&value.sample).into()),
                ..Default::default()
            });
        }
        value::Value::Range(value) => {
            resp.series.push(cluster_rpc::Series {
                metric: value
                    .labels
                    .iter()
                    .map(|label| label.as_ref().into())
                    .collect(),
                samples: value.samples.iter().map(|sample| sample.into()).collect(),
                ..Default::default()
            });
        }
        value::Value::Vector(values) => values.iter().for_each(|value| {
            resp.series.push(cluster_rpc::Series {
                metric: value
                    .labels
                    .iter()
                    .map(|label| label.as_ref().into())
                    .collect(),
                sample: Some((&value.sample).into()),
                ..Default::default()
            });
        }),
        value::Value::Matrix(values) => values.iter().for_each(|value| {
            let samples = value
                .samples
                .iter()
                .map(|sample| sample.into())
                .collect::<Vec<_>>();
            let exemplars = value
                .exemplars
                .as_ref()
                .map(|values| cluster_rpc::Exemplars {
                    exemplars: values.iter().map(|value| value.as_ref().into()).collect(),
                });
            if !samples.is_empty() || exemplars.is_some() {
                resp.series.push(cluster_rpc::Series {
                    metric: value
                        .labels
                        .iter()
                        .map(|label| label.as_ref().into())
                        .collect(),
                    samples,
                    exemplars,
                    ..Default::default()
                });
            }
        }),
        value::Value::Sample(value) => {
            resp.series.push(cluster_rpc::Series {
                sample: Some((&value).into()),
                ..Default::default()
            });
        }
        value::Value::Float(value) => {
            resp.series.push(cluster_rpc::Series {
                scalar: Some(value),
                ..Default::default()
            });
        }
        value::Value::String(value) => {
            resp.series.push(cluster_rpc::Series {
                stringliteral: Some(value),
                ..Default::default()
            });
        }
    }
}
