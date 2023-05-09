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

use crate::handler::grpc::cluster_rpc;
use crate::infra::errors::Error;
use crate::service::promql::value;

mod cache;
mod storage;

// 1. query on wal
// 2. query on storage by partition
pub async fn search(
    _req: &cluster_rpc::MetricsQueryRequest,
) -> Result<cluster_rpc::MetricsQueryResponse, Error> {
    Err(Error::NotImplemented)
}

impl From<&cluster_rpc::Label> for value::Label {
    fn from(req: &cluster_rpc::Label) -> Self {
        value::Label {
            name: req.name.to_owned(),
            value: req.value.to_owned(),
        }
    }
}

impl From<&cluster_rpc::Sample> for value::Sample {
    fn from(req: &cluster_rpc::Sample) -> Self {
        value::Sample {
            timestamp: req.time,
            value: req.value,
        }
    }
}
