// Copyright 2023 Zinc Labs Inc.
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

use actix_web::web::{Bytes, Data};

// TODO: clean up imports
use crate::{common, service::logs};
#[derive(Debug, Clone)]
pub enum IngestEntry {
    Bulk(IngestRequestBulk),
    Multi(IngestRequest),
    JSON(IngestRequest),
    KinesisFH(IngestRequest),
    GCP(IngestRequest),
}

impl IngestEntry {
    // TODO: handle errors
    pub async fn ingest(&self) {
        match self {
            IngestEntry::Bulk(entry) => {
                match logs::bulk::ingest(
                    &entry.org_id,
                    entry.body.clone(),
                    **entry.thread_id,
                    &entry.user_email,
                )
                .await
                {
                    Ok(v) => {
                        println!("ingested: {:?}", v);
                    }
                    Err(e) => {
                        println!("error: {:?}", e);
                    }
                }
            }
            IngestEntry::Multi(entry) => {
                match logs::ingest::ingest(
                    &entry.org_id,
                    &entry.stream_name,
                    common::meta::ingestion::IngestionRequest::Multi(&entry.body),
                    **entry.thread_id,
                    &entry.user_email,
                )
                .await
                {
                    Ok(v) => {
                        println!("ingested: {:?}", v);
                    }
                    Err(e) => {
                        println!("error: {:?}", e);
                    }
                }
            }
            _ => todo!("Implement other type of ingestions"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct IngestRequest {
    pub org_id: String,
    pub stream_name: String,
    pub body: Bytes,
    pub thread_id: Data<usize>,
    pub user_email: String,
}

#[derive(Debug, Clone)]
pub struct IngestRequestBulk {
    pub org_id: String,
    pub body: Bytes,
    pub thread_id: Data<usize>,
    pub user_email: String,
}

impl IngestRequest {
    pub fn new(
        org_id: String,
        stream_name: String,
        body: Bytes,
        thread_id: Data<usize>,
        user_email: String,
    ) -> Self {
        Self {
            org_id,
            stream_name,
            body,
            thread_id,
            user_email,
        }
    }
}
