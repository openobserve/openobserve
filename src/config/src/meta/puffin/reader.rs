// Copyright 2024 OpenObserve Inc.
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

use std::io::{Read, SeekFrom};

use anyhow::{anyhow, ensure, Result};
use futures::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt};

use super::{
    BlobMetadata, PuffinFooterFlags, PuffinMeta, FLAGS_SIZE, FOOTER_PAYLOAD_SIZE_SIZE, MAGIC,
    MAGIC_SIZE,
};
use crate::meta::puffin::{CompressionCodec, MIN_FILE_SIZE};

#[derive(Debug)]
pub struct PuffinBytesReader<R> {
    source: R,
    metadata: Option<PuffinMeta>,
}

impl<R> PuffinBytesReader<R> {
    pub fn new(source: R) -> Self {
        Self {
            source,
            metadata: None,
        }
    }
}

impl<R: AsyncRead + AsyncSeek + Unpin + Send> PuffinBytesReader<R> {
    pub async fn read_blob_bytes(&mut self, blob_metadata: &BlobMetadata) -> Result<Vec<u8>> {
        // Seek to the start of the blob
        self.source
            .seek(SeekFrom::Start(blob_metadata.offset as _))
            .await?;

        let mut compressed = vec![0u8; blob_metadata.length as usize];
        self.source.read_exact(&mut compressed).await?;

        let decompressed = match blob_metadata.compression_codec {
            Some(CompressionCodec::Lz4) => {
                return Err(anyhow!("Lz4 compression is not supported"));
            }
            Some(CompressionCodec::Zstd) => {
                let mut decompressed = Vec::new();
                let mut decoder = zstd::Decoder::new(&compressed[..])?;
                decoder.read_to_end(&mut decompressed)?;
                decompressed
            }
            None => compressed,
        };

        Ok(decompressed)
    }

    pub async fn get_field(&mut self, field: &str) -> Result<Option<BlobMetadata>> {
        self.parse_footer().await?;
        match self.metadata.as_ref() {
            None => Err(anyhow!("Metadata not found")),
            Some(v) => Ok(v
                .blobs
                .iter()
                .find(|b| b.properties.get("blob_tag").is_some_and(|val| val == field))
                .cloned()),
        }
    }

    pub async fn get_metadata(&mut self) -> Result<Option<PuffinMeta>> {
        self.parse_footer().await?;
        Ok(self.metadata.clone())
    }

    pub async fn parse_footer(&mut self) -> Result<()> {
        if self.metadata.is_some() {
            return Ok(());
        }

        // check MAGIC
        let mut magic = [0u8; MAGIC_SIZE as usize];
        self.source.read_exact(&mut magic).await?;
        ensure!(magic == MAGIC, anyhow!("Header MAGIC mismatch"));

        let end_offset = self.source.seek(SeekFrom::End(0)).await?;
        ensure!(
            end_offset >= MIN_FILE_SIZE,
            anyhow!(
                "Unexpected bytes size: minimal size {} vs actual size {}",
                MIN_FILE_SIZE,
                end_offset
            )
        );

        let puffin_meta = PuffinFooterBytesReader::new(&mut self.source, end_offset)
            .parse()
            .await?;
        self.metadata = Some(puffin_meta);
        Ok(())
    }
}

/// Footer layout: HeadMagic Payload PayloadSize Flags FootMagic
///                [4]       [?]     [4]         [4]   [4]
struct PuffinFooterBytesReader<R> {
    source: R,
    file_size: u64,
    flags: PuffinFooterFlags,
    payload_size: u64,
    metadata: Option<PuffinMeta>,
}

impl<R> PuffinFooterBytesReader<R> {
    fn new(source: R, file_size: u64) -> Self {
        Self {
            source,
            file_size,
            flags: PuffinFooterFlags::empty(),
            payload_size: 0,
            metadata: None,
        }
    }
}

impl<R: AsyncRead + AsyncSeek + Unpin + Send> PuffinFooterBytesReader<R> {
    async fn parse(mut self) -> Result<PuffinMeta> {
        // read the footer magic and
        self.source
            .seek(SeekFrom::Start(self.footer_magic_offset()))
            .await?;
        let mut magic = [0u8; MAGIC_SIZE as usize];
        self.source.read_exact(&mut magic).await?;
        ensure!(magic == MAGIC, anyhow!("Footer MAGIC mismatch"));

        self.source
            .seek(SeekFrom::Start(self.flags_offset()))
            .await?;
        let mut flags = [0u8; FLAGS_SIZE as usize];
        self.source.read_exact(&mut flags).await?;
        self.flags = PuffinFooterFlags::from_bits(u32::from_le_bytes(flags))
            .ok_or_else(|| anyhow!("Error parsing Puffin flags from bytes"))?;

        self.source
            .seek(SeekFrom::Start(self.payload_size_offset()))
            .await?;
        let mut payload_size = [0u8; FOOTER_PAYLOAD_SIZE_SIZE as usize];
        self.source.read_exact(&mut payload_size).await?;
        self.payload_size = i32::from_le_bytes(payload_size) as u64;

        self.source
            .seek(SeekFrom::Start(self.payload_offset()))
            .await?;
        let mut payload: Vec<u8> = vec![0; self.payload_size as usize];
        self.source.read_exact(&mut payload).await?;
        self.metadata = Some(self.parse_payload(&payload)?);
        self.validate_payload()?;

        self.source
            .seek(SeekFrom::Start(self.head_magic_offset()))
            .await?;
        self.source.read_exact(&mut magic).await?;
        ensure!(magic == MAGIC, anyhow!("Footer MAGIC mismatch"));

        Ok(self.metadata.unwrap())
    }

    fn parse_payload(&self, bytes: &[u8]) -> Result<PuffinMeta> {
        if self.flags.contains(PuffinFooterFlags::COMPRESSED) {
            let decoder = zstd::Decoder::new(bytes)?;
            serde_json::from_reader(decoder)
                .map_err(|e| anyhow!("Error decompress footer payload {}", e.to_string()))
        } else {
            serde_json::from_slice(bytes)
                .map_err(|e| anyhow!("Error serializing footer {}", e.to_string()))
        }
    }

    fn validate_payload(&self) -> Result<()> {
        let puffin_metadata = self.metadata.as_ref().expect("metadata is not set");

        let mut offset = MAGIC_SIZE;
        for blob in &puffin_metadata.blobs {
            ensure!(
                blob.offset == offset,
                anyhow!("Blob payload offset mismatch")
            );
            offset += blob.length;
        }

        let payload_ends_at = puffin_metadata
            .blobs
            .last()
            .map_or(MAGIC_SIZE, |blob| blob.offset + blob.length);

        ensure!(
            payload_ends_at == self.head_magic_offset(),
            anyhow!("Payload chunk offset mismatch")
        );
        Ok(())
    }

    fn footer_magic_offset(&self) -> u64 {
        self.file_size - MAGIC_SIZE
    }

    fn flags_offset(&self) -> u64 {
        self.footer_magic_offset() - FLAGS_SIZE
    }

    fn payload_size_offset(&self) -> u64 {
        self.flags_offset() - FOOTER_PAYLOAD_SIZE_SIZE
    }

    fn payload_offset(&self) -> u64 {
        self.payload_size_offset() - self.payload_size
    }

    fn head_magic_offset(&self) -> u64 {
        self.payload_offset() - MAGIC_SIZE
    }
}
