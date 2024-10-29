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

use core::ops::Range;
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
                unimplemented!()
            }
            Some(CompressionCodec::Zstd) => {
                let mut decompressed = Vec::new();
                let mut decoder = zstd::Decoder::new(&compressed[..])?;
                decoder.read_to_end(&mut decompressed)?;
                decompressed
            }
            None => compressed,
        };
        // decompress bytes since OpenObserve InvertedIndex compresses index data by default
        // This check should be outside the puffin reader logic
        // ensure!(
        //     blob_metadata.compression_codec == Some(CompressionCodec::Zstd),
        //     anyhow!("Unexpected CompressionCodex found in BlobMetadata")
        // );

        Ok(decompressed)
    }

    /// Read the slice of bytes from the blob in a puffin file, given the blob metadata
    // pub async fn read_slice(
    //     &mut self,
    //     blob_metadata: &BlobMetadata,
    //     range: Range<usize>,
    // ) -> Result<Vec<u8>> {
    //     let offset = blob_metadata.offset as usize;
    //     let start = offset + range.start;
    //     let end = offset + range.end;
    //     let slice_len = range.start - range.end;

    //     match blob_metadata.compression_codec {
    //         Some(CompressionCodec::Lz4) => unimplemented!(),
    //         Some(CompressionCodec::Zstd) => {
    //             self.source.seek(SeekFrom::Start(offset as _)).await?;

    //             let mut compressed = vec![0u8; blob_metadata.length as usize];
    //             self.source.read_exact(&mut compressed).await?;

    //             // Read the blob, decompress it, and give slice
    //             let mut decompressed = Vec::new();
    //             let mut decoder = zstd::Decoder::new(&compressed[..])?;
    //             decoder.read_to_end(&mut decompressed)?;
    //             Ok(decompressed[start..end].to_vec())
    //         }
    //         None => {
    //             // Read slice directly using offsets, return vec
    //             self.source.seek(SeekFrom::Start(start as _)).await?;
    //             let mut compressed = vec![0u8; slice_len as usize];
    //             self.source.read_exact(&mut compressed).await?;
    //             Ok(compressed)
    //         }
    //     }
    // }

    pub async fn get_metadata(&mut self) -> Result<PuffinMeta> {
        if let Some(meta) = &self.metadata {
            return Ok(meta.clone());
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
            .await
            .unwrap();
        self.metadata = Some(puffin_meta.clone());

        Ok(puffin_meta)
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
        let mut payload: Vec<u8> = Vec::with_capacity(self.payload_size as usize);
        payload.resize(self.payload_size as usize, 0);
        self.source.read(&mut payload).await?;
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
        if self.flags.contains(PuffinFooterFlags::COMPRESSED_ZSTD) {
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
        for blob in &puffin_metadata.blob_metadata {
            ensure!(
                blob.offset as u64 == offset,
                anyhow!("Blob payload offset mismatch")
            );
            offset += blob.length as u64;
        }

        let payload_ends_at = puffin_metadata
            .blob_metadata
            .last()
            .map_or(MAGIC_SIZE, |blob| (blob.offset + blob.length) as u64);

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
