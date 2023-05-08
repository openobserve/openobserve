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

use datafusion::prelude::SessionContext;

use super::value::Value;
use crate::handler::grpc::cluster_rpc;
use crate::infra::errors::{Error, ErrorCodes};
use crate::meta;
use crate::service::file_list;

// 1. create partion
// 2. query on all ingester & 1 on N querier
// 3. merge result
pub async fn exec_for_http(_req: super::MetricsQueryRequest) -> Result<Value, Error> {
    Err(Error::NotImplemented)
}

// 1. query on wal
// 2. query on storage by partition
pub async fn exec_for_grpc(
    _req: &cluster_rpc::MetricsQueryRequest,
) -> Result<cluster_rpc::MetricsQueryResponse, Error> {
    Err(Error::NotImplemented)
}

async fn create_context(
    metric_name: &str,
    time_range: (i64, i64),
) -> Result<SessionContext, Error> {
    let ctx = SessionContext::new();
    Ok(ctx)
}

#[inline]
async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    stream_type: meta::StreamType,
) -> Result<Vec<String>, Error> {
    let (time_min, time_max) = time_range.unwrap();
    let results =
        match file_list::get_file_list(org_id, stream_name, Some(stream_type), time_min, time_max)
            .await
        {
            Ok(results) => results,
            Err(err) => {
                log::error!("get file list error: {}", err);
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    "get file list error".to_string(),
                )));
            }
        };
    Ok(results)
}
