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

use std::io::{Cursor, Read};

use actix_web::web::Bytes;
use arrow::datatypes::ToByteSlice;
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};

// TODO: clean up imports
use crate::{common::meta::ingestion::IngestionRequest, service::logs};

// TODO: support other two endpoints
// KinesisFH,
// GCP,
#[derive(Debug, Clone)]
pub enum IngestSource {
    Bulk,
    Multi,
    JSON,
    KinesisFH,
    GCP,
}

// HELP:
// 1. use value or reference to define this struct? which would require static lifetime
// 2. For persisting entries to disk, into_bytes() or serde::Serialize/Deserialize
#[derive(Debug, Clone)]
pub struct IngestEntry {
    pub source: IngestSource,
    pub thread_id: usize,
    pub org_id: String,
    pub user_email: String,
    pub stream_name: Option<String>,
    pub body: Bytes,
}

impl IngestEntry {
    pub fn new(
        source: IngestSource,
        thread_id: usize,
        org_id: String,
        user_email: String,
        stream_name: Option<String>,
        body: Bytes,
    ) -> Self {
        Self {
            source,
            thread_id,
            org_id,
            user_email,
            stream_name,
            body,
        }
    }

    pub async fn ingest(&self) -> Result<(), anyhow::Error> {
        let in_req = match self.source {
            IngestSource::Bulk => {
                return match logs::bulk::ingest(
                    &self.org_id,
                    self.body.clone(),
                    self.thread_id,
                    &self.user_email,
                )
                .await
                {
                    Ok(v) => {
                        println!("ingested: {:?}", v);
                        Ok(())
                    }
                    Err(e) => {
                        println!("error: {:?}", e);
                        Ok(())
                    }
                };
            }
            IngestSource::Multi => IngestionRequest::Multi(&self.body),
            IngestSource::JSON => IngestionRequest::JSON(&self.body),
            _ => unimplemented!("To be supported"),
        };
        let Some(stream_name) = self.stream_name.as_ref() else {
            return Err(anyhow::anyhow!("missing stream name"));
        };
        match logs::ingest::ingest(
            &self.org_id,
            &stream_name,
            in_req,
            self.thread_id,
            &self.user_email,
        )
        .await
        {
            Ok(v) => {
                println!("ingested: {:?}", v);
            }
            Err(e) => {
                println!("error: {:?}", e);
            }
        };
        Ok(())
    }

    // HELP: should the buf be limited in certain size (e.g. 4096)
    pub fn into_bytes(&self) -> Result<Vec<u8>, anyhow::Error> {
        let mut buf = Vec::with_capacity(4096);

        let source = u8::from(&self.source);
        buf.write_u8(source)?;

        let thread_id = self.thread_id.to_be_bytes();
        buf.extend_from_slice(&thread_id);

        let org_id = self.org_id.as_bytes();
        buf.write_u16::<BigEndian>(org_id.len() as u16)?;
        buf.extend_from_slice(org_id);

        let user_email = self.user_email.as_bytes();
        buf.write_u16::<BigEndian>(user_email.len() as u16)?;
        buf.extend_from_slice(user_email);

        match &self.stream_name {
            None => buf.write_u8(0)?,
            Some(stream_name) => {
                buf.write_u8(1)?;
                let stream_name = stream_name.as_bytes();
                buf.write_u16::<BigEndian>(stream_name.len() as u16)?;
                buf.extend_from_slice(stream_name);
            }
        };

        let body = self.body.to_byte_slice();
        buf.write_u16::<BigEndian>(body.len() as u16)?;
        buf.extend_from_slice(body);

        Ok(buf)
    }

    pub fn from_bytes(value: &[u8]) -> Result<Self, anyhow::Error> {
        let mut cursor = Cursor::new(value);
        let mut source = [0u8; 1];
        let mut thread_id = [0u8; 1];
        cursor.read_exact(&mut source)?;
        cursor.read_exact(&mut thread_id)?;
        let source = IngestSource::try_from(source[0])?;
        let thread_id = thread_id[0] as usize;

        let org_id_len = cursor.read_u16::<BigEndian>()?;
        let mut org_id = vec![0; org_id_len as usize];
        cursor.read_exact(&mut org_id)?;
        let org_id = String::from_utf8(org_id)?;

        let user_email_len = cursor.read_u16::<BigEndian>()?;
        let mut user_email = vec![0; user_email_len as usize];
        cursor.read_exact(&mut user_email)?;
        let user_email = String::from_utf8(user_email)?;

        let mut stream_name_op = [0u8; 1];
        cursor.read_exact(&mut stream_name_op)?;

        let stream_name = if stream_name_op[0] == 0 {
            None
        } else {
            let stream_name_len = cursor.read_u16::<BigEndian>()?;
            let mut stream_name = vec![0; stream_name_len as usize];
            cursor.read_exact(&mut stream_name)?;
            Some(String::from_utf8(stream_name)?)
        };

        let body_len = cursor.read_u16::<BigEndian>()?;
        let mut body = vec![0; body_len as usize];
        cursor.read_exact(&mut body)?;
        let body = Bytes::try_from(body)?;

        Ok(Self {
            source,
            thread_id,
            org_id,
            user_email,
            stream_name,
            body,
        })
    }
}

impl std::convert::From<&IngestSource> for u8 {
    fn from(value: &IngestSource) -> Self {
        match value {
            IngestSource::Bulk => 1,
            IngestSource::Multi => 2,
            IngestSource::JSON => 3,
            IngestSource::KinesisFH => 4,
            IngestSource::GCP => 5,
        }
    }
}

impl std::convert::TryFrom<u8> for IngestSource {
    type Error = anyhow::Error;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(IngestSource::Bulk),
            2 => Ok(IngestSource::Multi),
            3 => Ok(IngestSource::JSON),
            4 => Ok(IngestSource::KinesisFH),
            5 => Ok(IngestSource::GCP),
            _ => Err(anyhow::anyhow!("not supported")),
        }
    }
}
