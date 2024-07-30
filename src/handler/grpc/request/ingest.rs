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

use async_trait::async_trait;
use config::utils::json;
use proto::cluster_rpc::{
    ingest_server::Ingest, IngestionRequest, IngestionResponse, IngestionType, StreamType,
};
use tonic::{Request, Response, Status};

use crate::{
    common::meta::ingestion::IngestionRequest as LogIngestionReuqest,
    service::ingestion::create_log_ingestion_req,
};

#[derive(Debug, Default)]
pub struct InternalIngestServer;

#[async_trait]
impl Ingest for InternalIngestServer {
    async fn ingest(
        &self,
        request: Request<IngestionRequest>,
    ) -> Result<Response<IngestionResponse>, Status> {
        // let metadata = request.metadata().clone();
        let req = request.into_inner();
        let org_id = req.org_id;
        let stream_name = req.stream_name;
        let in_data = req.data.unwrap_or_default();

        let resp = match StreamType::try_from(req.stream_type) {
            Ok(StreamType::Logs) => {
                let log_ingestion_type = req.ingestion_type.unwrap_or_default();
                let data = actix_web::web::Bytes::from(in_data.data);
                let ingestion_req = create_log_ingestion_req(log_ingestion_type, &data);
                _ = crate::service::logs::ingest::ingest(
                    &org_id,
                    &stream_name,
                    ingestion_req,
                    "",
                    None,
                )
                .await;
            }
            Ok(StreamType::EnrichmentTables) => {
                let json_records: Vec<json::Map<String, json::Value>> =
                    json::from_slice(&in_data.data).unwrap_or({
                        let json_records: json::Map<String, json::Value> =
                            json::from_slice(&in_data.data).unwrap();
                        vec![json_records]
                    });
                _ = crate::service::enrichment_table::save_enrichment_data(
                    &org_id,
                    &stream_name,
                    json_records,
                    true,
                )
                .await?;
            }
            _ => todo!("Future enhancement"),
        };

        let reply = IngestionResponse {
            status_code: 200,
            message: "OK".to_string(),
        };
        Ok(Response::new(reply))

        // match resp {
        //     Ok(_) => {
        //         let reply = IngestionResponse {
        //             status_code: 200,
        //             message: "OK".to_string(),
        //         };
        //         Ok(Response::new(reply))
        //     }
        //     Err(err) => {
        //         let reply = IngestionResponse {
        //             status_code: 500,
        //             message: err.to_string(),
        //         };
        //         Ok(Response::new(reply))
        //     }
        // }
    }
}
