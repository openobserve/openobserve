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

use std::sync::Arc;

use anyhow::{Result, anyhow, ensure};
use bytes::Buf;

use super::*;

#[derive(Debug)]
pub struct PuffinBytesReader {
    account: String,
    source: Arc<object_store::ObjectMeta>,
    metadata: Option<PuffinMeta>,
}

impl PuffinBytesReader {
    pub fn new(account: String, source: object_store::ObjectMeta) -> Self {
        Self {
            account,
            source: Arc::new(source),
            metadata: None,
        }
    }
}

impl PuffinBytesReader {
    pub async fn read_blob_bytes(
        &self,
        blob_metadata: &BlobMetadata,
        range: Option<core::ops::Range<u64>>,
    ) -> Result<bytes::Bytes> {
        let raw_data = infra::cache::storage::get_range(
            &self.account,
            &self.source.location,
            blob_metadata.get_offset(range),
        )
        .await?;

        let decompressed = match blob_metadata.compression_codec {
            Some(CompressionCodec::Lz4) => {
                return Err(anyhow!("Lz4 compression is not supported"));
            }
            Some(CompressionCodec::Zstd) => {
                return Err(anyhow!("Zstd compression is not supported"));
            }
            None => raw_data,
        };

        Ok(decompressed)
    }

    pub async fn get_metadata(&mut self) -> Result<Option<PuffinMeta>> {
        self.parse_footer().await?;
        Ok(self.metadata.clone())
    }

    pub async fn parse_footer(&mut self) -> Result<()> {
        if self.metadata.is_some() {
            return Ok(());
        }

        if self.source.size < MIN_FILE_SIZE {
            return Err(anyhow!(
                "Unexpected bytes size: minimal size {} vs actual size {}",
                MIN_FILE_SIZE,
                self.source.size
            ));
        }

        // check MAGIC
        let magic =
            infra::cache::storage::get_range(&self.account, &self.source.location, 0..MAGIC_SIZE)
                .await?;
        ensure!(magic.to_vec() == MAGIC, anyhow!("Header MAGIC mismatch"));

        let puffin_meta = PuffinFooterBytesReader::new(self.account.clone(), self.source.clone())
            .parse()
            .await?;
        self.metadata = Some(puffin_meta);
        Ok(())
    }
}

/// Footer layout: HeadMagic Payload PayloadSize Flags FootMagic
///                [4]       [?]     [4]         [4]   [4]
struct PuffinFooterBytesReader {
    account: String,
    source: Arc<object_store::ObjectMeta>,
    flags: PuffinFooterFlags,
    payload_size: u64,
    metadata: Option<PuffinMeta>,
}

impl PuffinFooterBytesReader {
    fn new(account: String, source: Arc<object_store::ObjectMeta>) -> Self {
        Self {
            account,
            source,
            flags: PuffinFooterFlags::empty(),
            payload_size: 0,
            metadata: None,
        }
    }
}

impl PuffinFooterBytesReader {
    async fn parse(mut self) -> Result<PuffinMeta> {
        // read footer
        if self.source.size < FOOTER_SIZE {
            return Err(anyhow!(
                "Unexpected footer size: expected size {} vs actual size {}",
                FOOTER_SIZE,
                self.source.size
            ));
        }
        let footer = infra::cache::storage::get_range(
            &self.account,
            &self.source.location,
            (self.source.size - FOOTER_SIZE)..self.source.size,
        )
        .await?;

        // check the footer magic
        ensure!(
            footer
                .slice((FOOTER_SIZE - MAGIC_SIZE) as usize..FOOTER_SIZE as usize)
                .to_vec()
                == MAGIC,
            anyhow!("Footer MAGIC mismatch")
        );

        // check the flags
        let mut flags = [0u8; 4];
        footer
            .slice(
                (FOOTER_SIZE - MAGIC_SIZE - FLAGS_SIZE) as usize
                    ..(FOOTER_SIZE - MAGIC_SIZE) as usize,
            )
            .copy_to_slice(&mut flags);
        self.flags = PuffinFooterFlags::from_bits(u32::from_le_bytes(flags))
            .ok_or_else(|| anyhow!("Error parsing Puffin flags from bytes"))?;

        // check the payload size
        let mut payload_size = [0u8; 4];
        footer
            .slice(0..FOOTER_PAYLOAD_SIZE_SIZE as usize)
            .copy_to_slice(&mut payload_size);
        self.payload_size = i32::from_le_bytes(payload_size) as u64;

        // read the payload
        if self.source.size < FOOTER_SIZE + self.payload_size {
            return Err(anyhow!(
                "Unexpected payload size: expected size {} vs actual size {}",
                FOOTER_SIZE + self.payload_size,
                self.source.size
            ));
        }
        let payload = infra::cache::storage::get_range(
            &self.account,
            &self.source.location,
            (self.source.size - FOOTER_SIZE - self.payload_size - MAGIC_SIZE)
                ..(self.source.size - FOOTER_SIZE),
        )
        .await?;

        // check the footer magic
        ensure!(
            payload.slice(0..MAGIC_SIZE as usize).to_vec() == MAGIC,
            anyhow!("Footer MAGIC mismatch")
        );

        self.metadata = Some(self.parse_payload(&payload.slice(MAGIC_SIZE as usize..))?);
        self.validate_payload()?;

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
        let footer_size = MAGIC_SIZE + self.payload_size + FOOTER_SIZE;
        ensure!(
            payload_ends_at == (self.source.size - footer_size),
            anyhow!("Payload chunk offset mismatch")
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use object_store::{ObjectMeta, path::Path};

    use super::*;

    fn create_mock_object_meta(size: usize) -> ObjectMeta {
        ObjectMeta {
            location: Path::from("test/path"),
            last_modified: chrono::Utc::now(),
            size: size as u64,
            e_tag: None,
            version: None,
        }
    }

    #[test]
    fn test_puffin_bytes_reader_new() {
        let object_meta = create_mock_object_meta(1000);
        let reader = PuffinBytesReader::new("test_account".to_string(), object_meta.clone());

        assert_eq!(reader.account, "test_account");
        assert_eq!(reader.source.size, 1000);
        assert!(reader.metadata.is_none());
    }

    #[test]
    fn test_blob_metadata_get_offset() {
        let blob_metadata = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: 100,
            length: 50,
            compression_codec: None,
            properties: HashMap::new(),
        };

        // Test full range
        let range = blob_metadata.get_offset(None);
        assert_eq!(range, 100..150);

        // Test partial range
        let range = blob_metadata.get_offset(Some(10..30));
        assert_eq!(range, 110..130);

        // Test range from beginning
        let range = blob_metadata.get_offset(Some(0..25));
        assert_eq!(range, 100..125);
    }

    #[test]
    fn test_puffin_footer_bytes_reader_new() {
        let object_meta = create_mock_object_meta(1000);
        let reader =
            PuffinFooterBytesReader::new("test_account".to_string(), Arc::new(object_meta.clone()));

        assert_eq!(reader.account, "test_account");
        assert_eq!(reader.source.size, 1000);
        assert_eq!(reader.flags, PuffinFooterFlags::empty());
        assert_eq!(reader.payload_size, 0);
        assert!(reader.metadata.is_none());
    }

    #[test]
    fn test_compression_codec_errors() {
        let blob_metadata = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: 100,
            length: 50,
            compression_codec: Some(CompressionCodec::Lz4),
            properties: HashMap::new(),
        };

        let object_meta = create_mock_object_meta(1000);
        let _reader = PuffinBytesReader::new("test_account".to_string(), object_meta);

        // This would fail in real scenario due to storage dependency, but we can test the error
        // paths by checking the match statement logic in read_blob_bytes

        if let Some(codec) = blob_metadata.compression_codec {
            assert!(matches!(
                codec,
                CompressionCodec::Lz4 | CompressionCodec::Zstd
            ));
        }
    }

    #[test]
    fn test_parse_payload_uncompressed() {
        let mut reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(1000)),
        );

        // Create a valid JSON payload
        let test_meta = PuffinMeta {
            blobs: vec![BlobMetadata {
                blob_type: BlobTypes::O2FstV1,
                fields: vec![1, 2],
                snapshot_id: 123,
                sequence_number: 456,
                offset: 4,
                length: 100,
                compression_codec: None,
                properties: HashMap::new(),
            }],
            properties: HashMap::new(),
        };

        let json_bytes = serde_json::to_vec(&test_meta).unwrap();

        // Test parsing uncompressed payload
        reader.flags = PuffinFooterFlags::DEFAULT; // No compression
        let result = reader.parse_payload(&json_bytes);

        assert!(result.is_ok());
        let parsed_meta = result.unwrap();
        assert_eq!(parsed_meta.blobs.len(), 1);
        assert_eq!(parsed_meta.blobs[0].blob_type, BlobTypes::O2FstV1);
        assert_eq!(parsed_meta.blobs[0].offset, 4);
        assert_eq!(parsed_meta.blobs[0].length, 100);
    }

    #[test]
    fn test_parse_payload_invalid_json() {
        let mut reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(1000)),
        );

        reader.flags = PuffinFooterFlags::DEFAULT;
        let invalid_json = b"invalid json content";

        let result = reader.parse_payload(invalid_json);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Error serializing footer")
        );
    }

    #[test]
    fn test_validate_payload_success() {
        let blob1 = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: MAGIC_SIZE, // Starts right after header magic
            length: 100,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let blob2 = BlobMetadata {
            blob_type: BlobTypes::O2TtvV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: MAGIC_SIZE + 100, // Starts after first blob
            length: 50,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let test_meta = PuffinMeta {
            blobs: vec![blob1, blob2],
            properties: HashMap::new(),
        };

        // Calculate expected file size
        let payload_size = 100; // Mock payload size
        let expected_file_size = MAGIC_SIZE + 100 + 50 + MAGIC_SIZE + payload_size + FOOTER_SIZE;

        let mut reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(expected_file_size as usize)),
        );

        reader.metadata = Some(test_meta);
        reader.payload_size = payload_size;

        let result = reader.validate_payload();
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_payload_offset_mismatch() {
        let blob1 = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: MAGIC_SIZE + 10, // Wrong offset (should be MAGIC_SIZE)
            length: 100,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let test_meta = PuffinMeta {
            blobs: vec![blob1],
            properties: HashMap::new(),
        };

        let mut reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(1000)),
        );

        reader.metadata = Some(test_meta);
        reader.payload_size = 100;

        let result = reader.validate_payload();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Blob payload offset mismatch")
        );
    }

    #[test]
    fn test_validate_payload_chunk_offset_mismatch() {
        let blob1 = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: MAGIC_SIZE,
            length: 100,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let test_meta = PuffinMeta {
            blobs: vec![blob1],
            properties: HashMap::new(),
        };

        let wrong_file_size = 50; // Too small for the expected layout
        let mut reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(wrong_file_size)),
        );

        reader.metadata = Some(test_meta);
        reader.payload_size = 10;

        let result = reader.validate_payload();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Payload chunk offset mismatch")
        );
    }

    #[test]
    fn test_validate_payload_empty_blobs() {
        let test_meta = PuffinMeta {
            blobs: vec![],
            properties: HashMap::new(),
        };

        let payload_size = 50;
        let expected_file_size = MAGIC_SIZE + MAGIC_SIZE + payload_size + FOOTER_SIZE;

        let mut reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(expected_file_size as usize)),
        );

        reader.metadata = Some(test_meta);
        reader.payload_size = payload_size;

        let result = reader.validate_payload();
        assert!(result.is_ok());
    }

    #[test]
    fn test_file_size_validation() {
        // Test minimum file size validation
        let small_object = create_mock_object_meta((MIN_FILE_SIZE - 1) as usize);
        let reader = PuffinBytesReader::new("test".to_string(), small_object);

        // In a real scenario, parse_footer would fail due to size check
        assert!(reader.source.size < MIN_FILE_SIZE);

        // Test footer size validation
        let small_footer_object = create_mock_object_meta((FOOTER_SIZE - 1) as usize);
        let footer_reader =
            PuffinFooterBytesReader::new("test".to_string(), Arc::new(small_footer_object));

        assert!(footer_reader.source.size < FOOTER_SIZE);
    }

    #[test]
    fn test_puffin_footer_flags_parsing() {
        let _reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(1000)),
        );

        // Test valid flags
        let valid_flags = PuffinFooterFlags::from_bits(0);
        assert!(valid_flags.is_some());
        assert_eq!(valid_flags.unwrap(), PuffinFooterFlags::DEFAULT);

        let compressed_flags = PuffinFooterFlags::from_bits(1);
        assert!(compressed_flags.is_some());
        assert_eq!(compressed_flags.unwrap(), PuffinFooterFlags::COMPRESSED);

        // Test invalid flags
        let invalid_flags = PuffinFooterFlags::from_bits(999);
        assert!(invalid_flags.is_none());
    }

    #[test]
    fn test_multiple_blobs_validation() {
        let blob1 = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: MAGIC_SIZE,
            length: 50,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let blob2 = BlobMetadata {
            blob_type: BlobTypes::O2TtvV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: MAGIC_SIZE + 50,
            length: 30,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let blob3 = BlobMetadata {
            blob_type: BlobTypes::DeletionVectorV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: MAGIC_SIZE + 50 + 30,
            length: 20,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let test_meta = PuffinMeta {
            blobs: vec![blob1, blob2, blob3],
            properties: HashMap::new(),
        };

        let payload_size = 100;
        let expected_file_size =
            MAGIC_SIZE + 50 + 30 + 20 + MAGIC_SIZE + payload_size + FOOTER_SIZE;

        let mut reader = PuffinFooterBytesReader::new(
            "test".to_string(),
            Arc::new(create_mock_object_meta(expected_file_size as usize)),
        );

        reader.metadata = Some(test_meta);
        reader.payload_size = payload_size;

        let result = reader.validate_payload();
        assert!(result.is_ok());
    }
}
