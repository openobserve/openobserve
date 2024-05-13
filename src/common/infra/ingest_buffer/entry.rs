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
use anyhow::{anyhow, Context, Result};
use arrow::datatypes::ToByteSlice;
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use chrono::Utc;

use crate::{common::meta::ingestion::IngestionRequest, service::logs};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestSource {
    Bulk,
    Multi,
    JSON,
    KinesisFH,
    GCP,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IngestEntry {
    pub source: IngestSource,
    pub thread_id: usize,
    pub org_id: String,
    pub user_email: String,
    pub stream_name: Option<String>,
    pub timestamp: i64,
    pub content_length: usize,
    pub body: Bytes,
}

impl IngestEntry {
    pub fn new(
        source: IngestSource,
        thread_id: usize,
        org_id: String,
        user_email: String,
        stream_name: Option<String>,
        content_length: usize,
        body: Bytes,
    ) -> Result<Self> {
        let timestamp = Utc::now().timestamp_micros();
        let entry = Self {
            source,
            thread_id,
            org_id,
            user_email,
            stream_name,
            timestamp,
            content_length,
            body,
        };
        entry.validate()?;
        Ok(entry)
    }

    /// validates self by checking the size
    pub fn validate(&self) -> Result<()> {
        if self.content_length != self.body.len() {
            return Err(anyhow!("Invalid request. Inconsistent body content length"));
        }
        Ok(())
    }

    /// Calls OpenObserve service to ingest data stored in self based on sources.
    /// Error returned by Ingester will be passed along.
    pub async fn ingest(&self) -> Result<bool> {
        let in_req = match self.source {
            IngestSource::Bulk => {
                return logs::bulk::ingest(
                    &self.org_id,
                    self.body.clone(),
                    self.thread_id,
                    &self.user_email,
                )
                .await
                .map(|bk_resp| !bk_resp.errors);
            }
            IngestSource::Multi => IngestionRequest::Multi(&self.body),
            IngestSource::JSON => IngestionRequest::JSON(&self.body),
            _ => unimplemented!("Ingest type {} to be implemented", self.source),
        };
        let Some(stream_name) = self.stream_name.as_ref() else {
            return Err(anyhow!(
                "Ingest type {} requires stream_name but received none",
                self.source
            ));
        };
        logs::ingest::ingest(
            &self.org_id,
            stream_name,
            in_req,
            self.thread_id,
            &self.user_email,
            Some(self.timestamp),
        )
        .await
        .map(|resp| resp.error.is_none())
    }

    pub fn into_bytes(&self) -> Result<Vec<u8>> {
        self.validate()?;
        let mut buf = Vec::new();

        let source = u8::from(&self.source);
        buf.write_u8(source)
            .context("IngestEntry::into_bytes() failed at <source>")?;

        let thread_id = self.thread_id.to_be_bytes();
        buf.extend_from_slice(&thread_id);

        let org_id = self.org_id.as_bytes();
        buf.write_u16::<BigEndian>(org_id.len() as u16)
            .context("IngestEntry::into_bytes() failed at <org_id>")?;
        buf.extend_from_slice(org_id);

        let user_email = self.user_email.as_bytes();
        buf.write_u16::<BigEndian>(user_email.len() as u16)
            .context("IngestEntry::into_bytes() failed at <user_email>")?;
        buf.extend_from_slice(user_email);

        match &self.stream_name {
            None => buf
                .write_u8(0)
                .context("IngestEntry::into_bytes() failed at <stream_name_indicator>")?,
            Some(stream_name) => {
                buf.write_u8(1)
                    .context("IngestEntry::into_bytes() failed at <stream_name_indicator>")?;
                let stream_name = stream_name.as_bytes();
                buf.write_u16::<BigEndian>(stream_name.len() as u16)
                    .context("IngestEntry::into_bytes() failed at <stream_name>")?;
                buf.extend_from_slice(stream_name);
            }
        };

        buf.write_i64::<BigEndian>(self.timestamp)
            .context("IngestEntry::into_bytes() failed at <timestamp>")?;

        let body = self.body.to_byte_slice();
        buf.write_u32::<BigEndian>(self.content_length as u32)
            .context("IngestEntry::into_bytes() failed at <body>")?;
        buf.extend_from_slice(body);

        Ok(buf)
    }

    pub fn from_bytes(value: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(value);
        let mut source = [0u8; 1];
        let mut thread_id = [0u8; 8];
        cursor
            .read_exact(&mut source)
            .context("IngestEntry::from_bytes() failed at reading <source>")?;
        cursor
            .read_exact(&mut thread_id)
            .context("IngestEntry::from_bytes() failed at <thread_id>")?;
        let source = IngestSource::try_from(source[0])
            .context("IngestEntry::from_bytes() failed at converting <source>")?;
        let thread_id = thread_id[0] as usize;

        let org_id_len = cursor
            .read_u16::<BigEndian>()
            .context("IngestEntry::from_bytes() failed at reading <org_id_len>")?;
        let mut org_id = vec![0; org_id_len as usize];
        cursor
            .read_exact(&mut org_id)
            .context("IngestEntry::from_bytes() failed at reading <org_id>")?;
        let org_id = String::from_utf8(org_id)
            .context("IngestEntry::from_bytes() failed at converting <org_id>")?;

        let user_email_len = cursor
            .read_u16::<BigEndian>()
            .context("IngestEntry::from_bytes() failed at reading <user_email_len>")?;
        let mut user_email = vec![0; user_email_len as usize];
        cursor
            .read_exact(&mut user_email)
            .context("IngestEntry::from_bytes() failed at reading <user_email>")?;
        let user_email = String::from_utf8(user_email)
            .context("IngestEntry::from_bytes() failed at converting <user_email>")?;

        let mut stream_name_op = [0u8; 1];
        cursor
            .read_exact(&mut stream_name_op)
            .context("IngestEntry::from_bytes() failed at reading <stream_name_indicator>")?;

        let stream_name = if stream_name_op[0] == 0 {
            None
        } else {
            let stream_name_len = cursor
                .read_u16::<BigEndian>()
                .context("IngestEntry::from_bytes() failed at reading <stream_name_len>")?;
            let mut stream_name = vec![0; stream_name_len as usize];
            cursor
                .read_exact(&mut stream_name)
                .context("IngestEntry::from_bytes() failed at reading <stream_name>")?;
            Some(
                String::from_utf8(stream_name)
                    .context("IngestEntry::from_bytes() failed at converting <stream_name>")?,
            )
        };

        let timestamp = cursor
            .read_i64::<BigEndian>()
            .context("IngestEntry::from_bytes() failed at reading <timestamp>")?;

        let content_length = cursor
            .read_u32::<BigEndian>()
            .context("IngestEntry::from_bytes() failed at reading <content_length>")?
            as usize;
        let mut body = vec![0; content_length];
        cursor
            .read_exact(&mut body)
            .context("IngestEntry::from_bytes() failed at reading <body>")?;
        let body = Bytes::from(body);
        let mut entry = IngestEntry::new(
            source,
            thread_id,
            org_id,
            user_email,
            stream_name,
            content_length,
            body,
        )
        .context("IngestEntry::from_bytes() failed at validating the entry")?;
        entry.timestamp = timestamp;
        Ok(entry)
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

impl std::fmt::Display for IngestSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IngestSource::Bulk => write!(f, "Bulk"),
            IngestSource::Multi => write!(f, "Multi"),
            IngestSource::JSON => write!(f, "JSON"),
            IngestSource::KinesisFH => write!(f, "KinesisFH"),
            IngestSource::GCP => write!(f, "GCP"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entry_w_stream_name_serialization() {
        let body = Bytes::from_static(
            b"\"kubernetes.annotations.kubectl.kubernetes.io/default-container\": \"prometheus\"",
        );
        let entry = IngestEntry::new(
            IngestSource::JSON,
            0,
            "default".to_string(),
            "root@example.com".to_string(),
            Some("default".to_string()),
            body.len(),
            body,
        )
        .unwrap();

        let entry_bytes = entry.into_bytes().unwrap();
        let entry_decoded = IngestEntry::from_bytes(&entry_bytes).unwrap();
        assert_eq!(entry, entry_decoded);
    }

    #[test]
    fn test_entry_wo_stream_name_serialization() {
        let body = Bytes::from_static(
            b"\"kubernetes.annotations.kubectl.kubernetes.io/default-container\": \"prometheus\"",
        );
        let entry = IngestEntry::new(
            IngestSource::JSON,
            0,
            "default".to_string(),
            "root@example.com".to_string(),
            None,
            body.len(),
            body,
        )
        .unwrap();
        let entry_bytes = entry.into_bytes().unwrap();
        let entry_decoded = IngestEntry::from_bytes(&entry_bytes).unwrap();
        assert_eq!(entry, entry_decoded);
    }
}
