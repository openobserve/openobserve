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

use anyhow::Error;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};

use crate::common::infra::cluster;
use crate::common::infra::config::CONFIG;
use crate::handler::grpc::cluster_rpc::{self, UsageResponse};

pub async fn ingest(
    dest_org_id: &str,
    req: cluster_rpc::UsageRequest,
) -> Result<UsageResponse, Error> {
    let mut nodes = cluster::get_cached_online_ingester_nodes().unwrap();
    nodes.sort_by_key(|x| x.id);
    let nodes = nodes;

    if nodes.is_empty() {
        log::error!("no online ingester node found");
        return Err(Error::msg("no online ingester node found"));
    }

    let node = nodes.first();

    if node.is_none() {
        log::error!("no online ingester node found");
        return Err(Error::msg("no online ingester node found"));
    }

    let node = node.unwrap();
    let node_addr = node.grpc_addr.clone();

    let token: MetadataValue<_> = cluster::get_internal_grpc_token()
        .parse()
        .map_err(|_| Error::msg("invalid token".to_string()))?;
    let channel = Channel::from_shared(node_addr)
        .unwrap()
        .connect()
        .await
        .map_err(|err| {
            log::error!("ingest->grpc: node: {}, connect err: {:?}", node.id, err);
            Error::msg("connect ingest node error")
        })?;
    let mut client = cluster_rpc::usage_client::UsageClient::with_interceptor(
        channel,
        move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            req.metadata_mut().insert(
                CONFIG.grpc.org_header_key.as_str(),
                dest_org_id.parse().unwrap(),
            );
            Ok(req)
        },
    );
    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let res: cluster_rpc::UsageResponse = match client.report_usage(req).await {
        Ok(res) => res.into_inner(),
        Err(err) => {
            log::error!("ingest->grpc: node: {}, ingest err: {:?}", node.id, err);
            if err.code() == tonic::Code::Internal {
                return Err(err.into());
            }
            return Err(Error::msg("ingest node error"));
        }
    };
    Ok(res)
}
