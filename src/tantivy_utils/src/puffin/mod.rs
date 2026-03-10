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

use std::collections::HashMap;

use bitflags::bitflags;
use serde::{Deserialize, Serialize};

pub mod reader;
pub mod writer;

/// puffin specs constants
pub const MAGIC: [u8; 4] = [0x50, 0x46, 0x41, 0x31];
pub const MAGIC_SIZE: u64 = MAGIC.len() as u64;
pub const MIN_FILE_SIZE: u64 = MAGIC_SIZE + MIN_DATA_SIZE;
pub const FLAGS_SIZE: u64 = 4;
pub const FOOTER_PAYLOAD_SIZE_SIZE: u64 = 4;
pub const FOOTER_SIZE: u64 = MAGIC_SIZE + FLAGS_SIZE + FOOTER_PAYLOAD_SIZE_SIZE;
pub const MIN_DATA_SIZE: u64 = MAGIC_SIZE + FLAGS_SIZE + FOOTER_PAYLOAD_SIZE_SIZE + MAGIC_SIZE; // without any blobs

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub struct PuffinFooterFlags: u32 {
        const DEFAULT = 0b00000000;
        const COMPRESSED = 0b00000001;
    }
}

/// Metadata of a Puffin file
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PuffinMeta {
    /// Metadata for each blob in the file
    pub blobs: Vec<BlobMetadata>,

    /// Storage for arbitrary meta-information, like writer identification/version
    #[serde(default)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub properties: HashMap<String, String>,
}

/// Puffin Blob metadata. [Puffin specs](https://iceberg.apache.org/puffin-spec/#filemetadata)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub struct BlobMetadata {
    /// Blob type
    #[serde(rename = "type")]
    pub blob_type: BlobTypes,

    /// Required by specs
    #[serde(default)]
    pub fields: Vec<u32>,

    /// Required by specs
    #[serde(default)]
    pub snapshot_id: u64,

    /// Required by specs
    #[serde(default)]
    pub sequence_number: u64,

    /// The offset in the file where the blob contents start
    pub offset: u64,

    /// The length of the blob stored in the file (after compression, if compressed)
    pub length: u64,

    /// Default to ZSTD compression for OpenObserve inverted index
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compression_codec: Option<CompressionCodec>,

    /// Additional meta information of the file.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub properties: HashMap<String, String>,
}

impl BlobMetadata {
    pub fn get_offset(&self, range: Option<core::ops::Range<u64>>) -> core::ops::Range<u64> {
        match range {
            None => self.offset..(self.offset + self.length),
            Some(v) => self.offset + v.start..(self.offset + v.end),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompressionCodec {
    Lz4,
    Zstd,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlobTypes {
    #[serde(rename = "apache-datasketches-theta-v1")]
    ApacheDatasketchesThetaV1,
    #[serde(rename = "deletion-vector-v1")]
    DeletionVectorV1,
    #[default]
    #[serde(rename = "o2-fst-v1")]
    O2FstV1,
    #[serde(rename = "o2-ttv-v1")]
    O2TtvV1,
    #[serde(rename = "o2-ttv-footer-v1")]
    O2TtvFooterV1,
}

#[derive(Default)]
pub struct BlobMetadataBuilder {
    blob_type: Option<BlobTypes>,
    fields: Vec<u32>,
    snapshot_id: u64,
    sequence_number: u64,
    offset: Option<u64>,
    length: Option<u64>,
    compression_codec: Option<CompressionCodec>,
    properties: HashMap<String, String>,
}

impl BlobMetadataBuilder {
    pub fn blob_type(mut self, blob_type: BlobTypes) -> Self {
        self.blob_type = Some(blob_type);
        self
    }

    pub fn offset(mut self, offset: u64) -> Self {
        self.offset = Some(offset);
        self
    }

    pub fn length(mut self, length: u64) -> Self {
        self.length = Some(length);
        self
    }

    pub fn properties(mut self, properties: HashMap<String, String>) -> Self {
        self.properties = properties;
        self
    }

    pub fn build(self) -> Result<BlobMetadata, &'static str> {
        Ok(BlobMetadata {
            blob_type: self.blob_type.ok_or("blob_type is required")?,
            fields: self.fields,
            snapshot_id: self.snapshot_id,
            sequence_number: self.sequence_number,
            offset: self.offset.ok_or("offset is required")?,
            length: self.length.unwrap_or_default(),
            compression_codec: self.compression_codec,
            properties: self.properties,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_puffin_footer_flags() {
        let default_flags = PuffinFooterFlags::DEFAULT;
        let compressed_flags = PuffinFooterFlags::COMPRESSED;

        assert_eq!(default_flags.bits(), 0);
        assert_eq!(compressed_flags.bits(), 1);

        // Test flag operations
        let combined = default_flags | compressed_flags;
        assert!(combined.contains(PuffinFooterFlags::COMPRESSED));
        assert_eq!(combined.bits(), 1);

        // Test from_bits
        assert_eq!(
            PuffinFooterFlags::from_bits(0),
            Some(PuffinFooterFlags::DEFAULT)
        );
        assert_eq!(
            PuffinFooterFlags::from_bits(1),
            Some(PuffinFooterFlags::COMPRESSED)
        );
        assert_eq!(PuffinFooterFlags::from_bits(2), None); // Invalid flags
    }

    #[test]
    fn test_compression_codec_serialization() {
        // Test serialization/deserialization
        let lz4 = CompressionCodec::Lz4;
        let zstd = CompressionCodec::Zstd;

        let lz4_json = serde_json::to_string(&lz4).unwrap();
        let zstd_json = serde_json::to_string(&zstd).unwrap();

        assert_eq!(lz4_json, "\"lz4\"");
        assert_eq!(zstd_json, "\"zstd\"");

        let lz4_deserialized: CompressionCodec = serde_json::from_str(&lz4_json).unwrap();
        let zstd_deserialized: CompressionCodec = serde_json::from_str(&zstd_json).unwrap();

        assert_eq!(lz4_deserialized, lz4);
        assert_eq!(zstd_deserialized, zstd);
    }

    #[test]
    fn test_blob_types_serialization() {
        let types = [
            (
                BlobTypes::ApacheDatasketchesThetaV1,
                "\"apache-datasketches-theta-v1\"",
            ),
            (BlobTypes::DeletionVectorV1, "\"deletion-vector-v1\""),
            (BlobTypes::O2FstV1, "\"o2-fst-v1\""),
            (BlobTypes::O2TtvV1, "\"o2-ttv-v1\""),
            (BlobTypes::O2TtvFooterV1, "\"o2-ttv-footer-v1\""),
        ];

        for (blob_type, expected_json) in types {
            let json = serde_json::to_string(&blob_type).unwrap();
            assert_eq!(json, expected_json);

            let deserialized: BlobTypes = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, blob_type);
        }
    }

    #[test]
    fn test_blob_metadata_get_offset() {
        let metadata = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: 100,
            length: 50,
            compression_codec: None,
            properties: HashMap::new(),
        };

        // Test without range
        let range = metadata.get_offset(None);
        assert_eq!(range, 100..150);

        // Test with range
        let range = metadata.get_offset(Some(10..30));
        assert_eq!(range, 110..130);

        // Test with range at the beginning
        let range = metadata.get_offset(Some(0..10));
        assert_eq!(range, 100..110);
    }

    #[test]
    fn test_blob_metadata_serialization() {
        let mut properties = HashMap::new();
        properties.insert("key1".to_string(), "value1".to_string());
        properties.insert("key2".to_string(), "value2".to_string());

        let metadata = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![1, 2, 3],
            snapshot_id: 123,
            sequence_number: 456,
            offset: 1000,
            length: 2000,
            compression_codec: Some(CompressionCodec::Zstd),
            properties,
        };

        let json = serde_json::to_string(&metadata).unwrap();
        let deserialized: BlobMetadata = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized, metadata);
        assert_eq!(deserialized.blob_type, BlobTypes::O2FstV1);
        assert_eq!(deserialized.fields, vec![1, 2, 3]);
        assert_eq!(deserialized.snapshot_id, 123);
        assert_eq!(deserialized.sequence_number, 456);
        assert_eq!(deserialized.offset, 1000);
        assert_eq!(deserialized.length, 2000);
        assert_eq!(deserialized.compression_codec, Some(CompressionCodec::Zstd));
        assert_eq!(deserialized.properties.len(), 2);
        assert_eq!(
            deserialized.properties.get("key1"),
            Some(&"value1".to_string())
        );
        assert_eq!(
            deserialized.properties.get("key2"),
            Some(&"value2".to_string())
        );
    }

    #[test]
    fn test_puffin_meta_serialization() {
        let blob1 = BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![1],
            snapshot_id: 100,
            sequence_number: 200,
            offset: 1000,
            length: 500,
            compression_codec: Some(CompressionCodec::Lz4),
            properties: HashMap::new(),
        };

        let blob2 = BlobMetadata {
            blob_type: BlobTypes::DeletionVectorV1,
            fields: vec![2, 3],
            snapshot_id: 101,
            sequence_number: 201,
            offset: 1500,
            length: 300,
            compression_codec: None,
            properties: HashMap::new(),
        };

        let mut properties = HashMap::new();
        properties.insert("writer".to_string(), "openobserve".to_string());
        properties.insert("version".to_string(), "0.15.0".to_string());

        let meta = PuffinMeta {
            blobs: vec![blob1, blob2],
            properties,
        };

        let json = serde_json::to_string(&meta).unwrap();
        let deserialized: PuffinMeta = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized, meta);
        assert_eq!(deserialized.blobs.len(), 2);
        assert_eq!(deserialized.properties.len(), 2);
        assert_eq!(
            deserialized.properties.get("writer"),
            Some(&"openobserve".to_string())
        );
        assert_eq!(
            deserialized.properties.get("version"),
            Some(&"0.15.0".to_string())
        );
    }

    #[test]
    fn test_blob_metadata_builder_success() {
        let mut properties = HashMap::new();
        properties.insert("test".to_string(), "value".to_string());

        let metadata = BlobMetadataBuilder::default()
            .blob_type(BlobTypes::O2FstV1)
            .offset(100)
            .length(50)
            .properties(properties.clone())
            .build()
            .unwrap();

        assert_eq!(metadata.blob_type, BlobTypes::O2FstV1);
        assert_eq!(metadata.offset, 100);
        assert_eq!(metadata.length, 50);
        assert_eq!(metadata.properties, properties);
        assert!(metadata.fields.is_empty());
        assert_eq!(metadata.snapshot_id, 0);
        assert_eq!(metadata.sequence_number, 0);
        assert!(metadata.compression_codec.is_none());
    }

    #[test]
    fn test_blob_metadata_builder_missing_blob_type() {
        let result = BlobMetadataBuilder::default()
            .offset(100)
            .length(50)
            .build();

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "blob_type is required");
    }

    #[test]
    fn test_blob_metadata_builder_missing_offset() {
        let result = BlobMetadataBuilder::default()
            .blob_type(BlobTypes::O2FstV1)
            .length(50)
            .build();

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "offset is required");
    }

    #[test]
    fn test_blob_metadata_builder_default_length() {
        let metadata = BlobMetadataBuilder::default()
            .blob_type(BlobTypes::O2FstV1)
            .offset(100)
            .build()
            .unwrap();

        assert_eq!(metadata.length, 0); // Default length should be 0
    }

    #[test]
    fn test_blob_metadata_builder_chaining() {
        // Test that builder methods can be chained in any order
        let metadata = BlobMetadataBuilder::default()
            .length(50)
            .blob_type(BlobTypes::O2TtvV1)
            .offset(100)
            .build()
            .unwrap();

        assert_eq!(metadata.blob_type, BlobTypes::O2TtvV1);
        assert_eq!(metadata.offset, 100);
        assert_eq!(metadata.length, 50);
    }
}
