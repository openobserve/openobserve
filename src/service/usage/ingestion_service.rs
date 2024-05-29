// Copyright 2024 Zinc Labs Inc.
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

use anyhow::Error;
use proto::cluster_rpc;
use rand::{rngs::StdRng, seq::SliceRandom, SeedableRng};
use tonic::{
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataValue},
    transport::Channel,
    Request,
};

use crate::common::infra::cluster;

pub async fn ingest(
    dest_org_id: &str,
    req: cluster_rpc::UsageRequest,
) -> Result<cluster_rpc::UsageResponse, Error> {
    let cfg = config::get_config();
    let mut nodes = cluster::get_cached_online_ingester_nodes().await.unwrap();
    nodes.sort_by_key(|x| x.id);

    if nodes.is_empty() {
        log::error!("no online ingester node found");
        return Err(Error::msg("no online ingester node found"));
    }

    // random nodes
    let mut rng = StdRng::from_entropy();
    nodes.shuffle(&mut rng);

    let node = nodes.first();

    if node.is_none() {
        log::error!("no online ingester node found");
        return Err(Error::msg("no online ingester node found"));
    }

    let node = node.unwrap();
    let node_addr = node.grpc_addr.clone();

    let org_header_key: MetadataKey<_> = cfg
        .grpc
        .org_header_key
        .parse()
        .map_err(|_| Error::msg("invalid org_header_key".to_string()))?;
    let token: MetadataValue<_> = cluster::get_internal_grpc_token()
        .parse()
        .map_err(|_| Error::msg("invalid token".to_string()))?;
    let channel = Channel::from_shared(node_addr)
        .unwrap()
        .connect_timeout(std::time::Duration::from_secs(cfg.grpc.connect_timeout))
        .connect()
        .await
        .map_err(|err| {
            log::error!(
                "ingest->grpc: node: {}, connect err: {:?}",
                &node.grpc_addr,
                err
            );
            Error::msg("connect ingest node error")
        })?;
    let mut client = cluster_rpc::usage_client::UsageClient::with_interceptor(
        channel,
        move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            req.metadata_mut()
                .insert(org_header_key.clone(), dest_org_id.parse().unwrap());
            Ok(req)
        },
    );
    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let res: cluster_rpc::UsageResponse = match client.report_usage(req).await {
        Ok(res) => res.into_inner(),
        Err(err) => {
            log::error!(
                "ingest->grpc: node: {}, ingest err: {:?}",
                &node.grpc_addr,
                err
            );
            if err.code() == tonic::Code::Internal {
                return Err(err.into());
            }
            return Err(Error::msg("ingest node error"));
        }
    };
    Ok(res)
}

#[cfg(test)]
mod tests {
    use rand::{rngs::StdRng, seq::SliceRandom, SeedableRng};

    #[test]
    fn test_ingest() {
        let mut nodes = [1, 2];
        let mut count_1 = 0;
        let mut count_2 = 0;
        for _ in 0..10 {
            let mut rng = StdRng::from_entropy();
            nodes.shuffle(&mut rng);
            match nodes.first() {
                Some(1) => count_1 += 1,
                Some(2) => count_2 += 1,
                _ => {}
            }
        }
        println!("{:?} => {:?} ", count_1, count_2)
    }
}
