// Copyright 2025 OpenObserve Inc.
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

use config::meta::cluster::get_internal_grpc_token;
use infra::errors::{Error, Result};
use proto::cluster_rpc;
use tonic::{Request, codec::CompressionEncoding, metadata::MetadataValue};

use crate::service::grpc::get_ingester_channel;

pub async fn ingest(req: cluster_rpc::IngestionRequest) -> Result<cluster_rpc::IngestionResponse> {
    let cfg = config::get_config();
    let token: MetadataValue<_> = get_internal_grpc_token()
        .parse()
        .map_err(|_| Error::IngestionError("invalid token".to_string()))?;
    let (addr, channel) = get_ingester_channel()
        .await
        .map_err(|e| Error::IngestionError(e.to_string()))?;
    let mut client = cluster_rpc::ingest_client::IngestClient::with_interceptor(
        channel,
        move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            Ok(req)
        },
    );

    // set ingestion timeout
    let mut request = tonic::Request::new(req);
    request.set_timeout(std::time::Duration::from_secs(
        cfg.limit.grpc_ingest_timeout,
    ));

    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let res: cluster_rpc::IngestionResponse = match client.ingest(request).await {
        Ok(r) => r.into_inner(),
        Err(e) => {
            log::error!("[InternalIngestion] export partial_success node: {addr}, response: {e}");
            return Err(Error::IngestionError(format!(
                "Ingest node {addr}, response error: {e}"
            )));
        }
    };
    Ok(res)
}
