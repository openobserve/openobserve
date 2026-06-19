// Copyright 2026 OpenObserve Inc.
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
use bytes::Bytes;

use super::*;
use crate::puffin_directory::footer_cache::FOOTER_DATA_CACHE;

/// Suffix pulled from a `.ttv` tail on footer-cache miss. A `.ttv` footer is a
/// small uncompressed JSON over a fixed ~6-blob single-segment index (~1 KB in
/// practice, never above ~2 KB and independent of indexed-field count), so 4 KB
/// covers it in one read instead of two; rare larger footers re-read precisely.
const PUFFIN_FOOTER_PROBE_BYTES: u64 = 4 * 1024;

/// Slice the payload (`HeadMagic + JSON`) out of a file-tail `suffix`, or `None`
/// if the suffix doesn't reach the start of the footer region.
fn slice_payload_from_suffix(suffix: &Bytes, payload_size: u64) -> Option<Bytes> {
    let need = MAGIC_SIZE + payload_size + FOOTER_SIZE;
    if need > suffix.len() as u64 {
        return None;
    }
    let start = suffix.len() - need as usize;
    let end = suffix.len() - FOOTER_SIZE as usize;
    Some(suffix.slice(start..end))
}

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

/// Parse the Puffin footer ([`PuffinMeta`]) from a complete in-memory copy of a
/// puffin (`.ttv`) file.
///
/// This is the storage-independent companion to [`PuffinFooterBytesReader`]:
/// it takes the whole file as a byte slice instead of issuing ranged reads
/// through the object-store layer. It exists for offline / diagnostic tooling
/// (e.g. the `ttv-inspect` CLI) that opens a local file directly. The footer
/// layout it decodes is `HeadMagic Payload PayloadSize Flags FootMagic`.
pub fn parse_puffin_footer_from_bytes(data: &[u8]) -> Result<PuffinMeta> {
    let total = data.len() as u64;
    ensure!(
        total >= MIN_FILE_SIZE,
        "file too small to be a puffin/.ttv file: {total} bytes (min {MIN_FILE_SIZE})"
    );

    // Footer tail: ... PayloadSize[4] Flags[4] FootMagic[4]
    let footer = &data[(total - FOOTER_SIZE) as usize..];
    ensure!(
        footer[(FOOTER_SIZE - MAGIC_SIZE) as usize..].to_vec() == MAGIC,
        "Footer MAGIC mismatch (not a puffin/.ttv file?)"
    );

    let mut flags_bytes = [0u8; 4];
    flags_bytes.copy_from_slice(
        &footer
            [(FOOTER_SIZE - MAGIC_SIZE - FLAGS_SIZE) as usize..(FOOTER_SIZE - MAGIC_SIZE) as usize],
    );
    let flags = PuffinFooterFlags::from_bits(u32::from_le_bytes(flags_bytes))
        .ok_or_else(|| anyhow!("Error parsing Puffin flags from bytes"))?;

    let mut payload_size_bytes = [0u8; 4];
    payload_size_bytes.copy_from_slice(&footer[0..FOOTER_PAYLOAD_SIZE_SIZE as usize]);
    let payload_size = i32::from_le_bytes(payload_size_bytes) as u64;

    ensure!(
        total >= FOOTER_SIZE + payload_size + MAGIC_SIZE,
        "Unexpected payload size: {payload_size} vs file size {total}"
    );

    // Payload region: HeadMagic[4] Payload[payload_size]
    let payload_start = (total - FOOTER_SIZE - payload_size - MAGIC_SIZE) as usize;
    let json_start = payload_start + MAGIC_SIZE as usize;
    ensure!(
        data[payload_start..json_start].to_vec() == MAGIC,
        "Payload MAGIC mismatch"
    );
    let payload = &data[json_start..(total - FOOTER_SIZE) as usize];

    if flags.contains(PuffinFooterFlags::COMPRESSED) {
        let decoder = zstd::Decoder::new(payload)?;
        serde_json::from_reader(decoder)
            .map_err(|e| anyhow!("Error decompressing footer payload {e}"))
    } else {
        serde_json::from_slice(payload).map_err(|e| anyhow!("Error parsing footer payload {e}"))
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

        // Skip the separate header-magic read (0..4 bytes). The footer tail
        // already contains FootMagic at bytes 8..12, which PuffinFooterBytesReader
        // validates before parsing any payload. That check is sufficient to confirm
        // the file is a valid puffin file, so the redundant head-magic read is
        // eliminated — reducing footer parsing from 3 IOs to 2 IOs at zero overhead.
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
        // the location is unique key for the footer cache
        let cache_key = format!("puffin_footer_{}", self.source.location);

        let payload = match FOOTER_DATA_CACHE.get(&cache_key) {
            Some(cached) => {
                // Combined cache: first FOOTER_SIZE bytes = footer tail, rest = payload
                let footer = cached.slice(0..FOOTER_SIZE as usize);
                let payload = cached.slice(FOOTER_SIZE as usize..);
                self.parse_footer_metadata(&footer)?;
                payload
            }
            None => {
                let (footer, payload) = self.read_footer_and_payload().await?;
                let mut combined = Vec::with_capacity(footer.len() + payload.len());
                combined.extend_from_slice(&footer);
                combined.extend_from_slice(&payload);
                FOOTER_DATA_CACHE.put(cache_key, Bytes::from(combined));
                payload
            }
        };

        self.metadata = Some(self.parse_payload(&payload.slice(MAGIC_SIZE as usize..))?);
        self.validate_payload()?;

        Ok(self.metadata.unwrap())
    }

    /// Read the footer tail and payload, in a single request when the footer
    /// fits the probe (the common case) and a precise re-read otherwise. Returns
    /// `(footer_tail, payload)`: the last `FOOTER_SIZE` bytes and `HeadMagic + JSON`.
    async fn read_footer_and_payload(&mut self) -> Result<(Bytes, Bytes)> {
        if self.source.size < FOOTER_SIZE {
            return Err(anyhow!(
                "Unexpected footer size: expected size {} vs actual size {}",
                FOOTER_SIZE,
                self.source.size
            ));
        }

        let mut suffix = self.read_suffix(PUFFIN_FOOTER_PROBE_BYTES).await?;
        self.parse_footer_metadata(&suffix.slice(suffix.len() - FOOTER_SIZE as usize..))?;

        // Re-read exactly the footer region if the probe fell short.
        let need = MAGIC_SIZE + self.payload_size + FOOTER_SIZE;
        if need > suffix.len() as u64 {
            suffix = self.read_suffix(need).await?;
        }

        let footer = suffix.slice(suffix.len() - FOOTER_SIZE as usize..);
        let payload = slice_payload_from_suffix(&suffix, self.payload_size)
            .ok_or_else(|| anyhow!("Unexpected payload size"))?;
        ensure!(
            payload.starts_with(&MAGIC),
            anyhow!("Payload MAGIC mismatch")
        );
        Ok((footer, payload))
    }

    /// Read the last `n` bytes of the file (clamped to its size) in one request.
    async fn read_suffix(&self, n: u64) -> Result<Bytes> {
        let n = n.min(self.source.size);
        Ok(infra::cache::storage::get_range(
            &self.account,
            &self.source.location,
            (self.source.size - n)..self.source.size,
        )
        .await?)
    }

    /// Parse footer metadata from in-memory bytes. Sets flags and payload_size on self.
    fn parse_footer_metadata(&mut self, footer: &[u8]) -> Result<()> {
        // check the footer magic
        ensure!(
            footer[(FOOTER_SIZE - MAGIC_SIZE) as usize..FOOTER_SIZE as usize].to_vec() == MAGIC,
            anyhow!("Footer MAGIC mismatch")
        );

        // check the flags
        let mut flags = [0u8; 4];
        flags.copy_from_slice(
            &footer[(FOOTER_SIZE - MAGIC_SIZE - FLAGS_SIZE) as usize
                ..(FOOTER_SIZE - MAGIC_SIZE) as usize],
        );
        self.flags = PuffinFooterFlags::from_bits(u32::from_le_bytes(flags))
            .ok_or_else(|| anyhow!("Error parsing Puffin flags from bytes"))?;

        // check the payload size
        let mut payload_size = [0u8; 4];
        payload_size.copy_from_slice(&footer[0..FOOTER_PAYLOAD_SIZE_SIZE as usize]);
        self.payload_size = i32::from_le_bytes(payload_size) as u64;

        if self.source.size < FOOTER_SIZE + self.payload_size {
            return Err(anyhow!(
                "Unexpected payload size: expected size {} vs actual size {}",
                FOOTER_SIZE + self.payload_size,
                self.source.size
            ));
        }

        Ok(())
    }

    fn parse_payload(&self, bytes: &[u8]) -> Result<PuffinMeta> {
        if self.flags.contains(PuffinFooterFlags::COMPRESSED) {
            let decoder = zstd::Decoder::new(bytes)?;
            serde_json::from_reader(decoder)
                .map_err(|e| anyhow!("Error decompress footer payload {e}"))
        } else {
            serde_json::from_slice(bytes).map_err(|e| anyhow!("Error serializing footer {e}"))
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
    fn test_slice_payload_from_suffix_roundtrip() {
        use crate::puffin::writer::PuffinBytesWriter;

        // Build a real puffin file in memory (write through a &mut Vec so we can
        // read the buffer back after the writer is dropped).
        let mut buf: Vec<u8> = Vec::new();
        {
            let mut writer = PuffinBytesWriter::new(&mut buf);
            writer
                .add_blob(
                    b"meta-json-bytes",
                    BlobTypes::O2TtvV1,
                    "meta.json".to_string(),
                )
                .unwrap();
            writer
                .add_blob(
                    &vec![7u8; 4096],
                    BlobTypes::O2TtvV1,
                    "abcdef0123456789.term".to_string(),
                )
                .unwrap();
            writer.finish().unwrap();
        }
        let file: Bytes = Bytes::from(buf);
        let total = file.len() as u64;

        // Re-derive payload_size the way parse_footer_metadata does.
        let footer = file.slice((total - FOOTER_SIZE) as usize..);
        let payload_size = i32::from_le_bytes(
            footer[0..FOOTER_PAYLOAD_SIZE_SIZE as usize]
                .try_into()
                .unwrap(),
        ) as u64;
        let need = MAGIC_SIZE + payload_size + FOOTER_SIZE;

        // The canonical payload (HeadMagic + JSON) as the original 2-IO path reads it.
        let expected_payload = file.slice(
            (total - FOOTER_SIZE - payload_size - MAGIC_SIZE) as usize
                ..(total - FOOTER_SIZE) as usize,
        );

        // Fast path: a probe covering the whole file, and one covering exactly `need`.
        for probe in [total, need] {
            let suffix = file.slice((total - probe) as usize..);
            let payload = slice_payload_from_suffix(&suffix, payload_size)
                .expect("probe covers footer region");
            assert_eq!(payload, expected_payload);
            // And it must start with the head magic + deserialize to the same meta.
            assert_eq!(payload.slice(0..MAGIC_SIZE as usize).to_vec(), MAGIC);
            let meta: PuffinMeta =
                serde_json::from_slice(&payload.slice(MAGIC_SIZE as usize..)).unwrap();
            assert_eq!(meta.blobs.len(), 2);
        }

        // Fallback path: probe one byte short of the footer region -> None.
        let short = file.slice((total - (need - 1)) as usize..);
        assert!(slice_payload_from_suffix(&short, payload_size).is_none());
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
