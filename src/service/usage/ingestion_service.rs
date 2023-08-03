use anyhow::Error;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};

use crate::common::infra::cluster;
use crate::common::infra::config::CONFIG;
use crate::handler::grpc::cluster_rpc;

pub async fn ingest(dest_org_id: &str, req: cluster_rpc::UsageRequest) -> Result<(), Error> {
    // get nodes from cluster
    let mut nodes = cluster::get_cached_online_ingester_nodes().unwrap();
    // sort nodes by node_id this will improve hit cache ratio
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
    let _: cluster_rpc::EmptyResponse = match client.report_usage(req).await {
        Ok(res) => res.into_inner(),
        Err(err) => {
            log::error!("ingest->grpc: node: {}, ingest err: {:?}", node.id, err);
            if err.code() == tonic::Code::Internal {
                return Err(err.into());
            }
            return Err(Error::msg("ingest node error"));
        }
    };
    Ok(())
}
