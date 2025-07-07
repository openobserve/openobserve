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

use std::{collections::HashMap, io, mem};

use anyhow::{Context, Result};

use super::*;

pub struct PuffinBytesWriter<W> {
    /// buffer to write to
    writer: W,

    /// The properties of the file.
    properties: HashMap<String, String>,

    /// The metadata of the blobs.
    blobs_metadata: Vec<BlobMetadata>,

    /// The number of bytes written.
    written_bytes: u64,
}

impl<W> PuffinBytesWriter<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            properties: HashMap::new(),
            blobs_metadata: vec![],
            written_bytes: 0,
        }
    }

    fn build_blob_metadata(
        &self,
        blob_type: BlobTypes,
        properties: HashMap<String, String>,
        size: u64,
    ) -> BlobMetadata {
        BlobMetadataBuilder::default()
            .blob_type(blob_type)
            .properties(properties)
            .offset(self.written_bytes as _)
            .length(size)
            .build()
            .expect("Missing required fields")
    }
}

impl<W: io::Write> PuffinBytesWriter<W> {
    pub fn add_blob(
        &mut self,
        raw_data: &[u8],
        blob_type: BlobTypes,
        blob_tag: String,
    ) -> Result<()> {
        self.add_header_if_needed()
            .context("Error writing puffin header")?;

        let data_size = raw_data.len() as u64;
        self.writer.write_all(raw_data)?;
        let properties = {
            let mut properties = HashMap::new();
            properties.insert("blob_tag".to_string(), blob_tag);
            properties
        };

        // add metadata for this blob
        let blob_metadata = self.build_blob_metadata(blob_type, properties, data_size);
        self.blobs_metadata.push(blob_metadata);
        self.written_bytes += data_size;
        Ok(())
    }

    pub fn finish(&mut self) -> Result<u64> {
        self.add_header_if_needed()
            .context("Error writing puffin header")?;
        self.write_footer().context("Error writing puffin footer")?;
        self.writer.flush()?;
        Ok(self.written_bytes)
    }

    fn add_header_if_needed(&mut self) -> Result<()> {
        if self.written_bytes == 0 {
            self.writer.write_all(&MAGIC)?;
            self.written_bytes += MAGIC_SIZE;
        }
        Ok(())
    }

    fn write_footer(&mut self) -> Result<()> {
        let footer_bytes = PuffinFooterWriter::new(
            mem::take(&mut self.blobs_metadata),
            mem::take(&mut self.properties),
        )
        .into_bytes()?;
        self.writer.write_all(&footer_bytes)?;
        self.written_bytes += footer_bytes.len() as u64;
        Ok(())
    }
}

/// Footer layout: HeadMagic Payload PayloadSize Flags FootMagic
///                [4]       [?]     [4]         [4]   [4]
struct PuffinFooterWriter {
    blob_metadata: Vec<BlobMetadata>,
    file_properties: HashMap<String, String>,
}

impl PuffinFooterWriter {
    fn new(blob_metadata: Vec<BlobMetadata>, file_properties: HashMap<String, String>) -> Self {
        Self {
            blob_metadata,
            file_properties,
        }
    }

    fn into_bytes(mut self) -> Result<Vec<u8>> {
        let payload = self.get_payload()?;
        let payload_size = payload.len();

        let capacity = MIN_DATA_SIZE as usize + payload_size;
        let mut buf = Vec::with_capacity(capacity);

        // HeadMagic
        buf.extend_from_slice(&MAGIC);

        // payload + payload size
        buf.extend_from_slice(&payload);
        buf.extend_from_slice(&(payload_size as i32).to_le_bytes());

        // flags
        buf.extend_from_slice(&PuffinFooterFlags::DEFAULT.bits().to_le_bytes());

        // FootMagic
        buf.extend_from_slice(&MAGIC);

        Ok(buf)
    }

    fn get_payload(&mut self) -> Result<Vec<u8>> {
        let file_metdadata = PuffinMeta {
            blobs: mem::take(&mut self.blob_metadata),
            properties: mem::take(&mut self.file_properties),
        };
        serde_json::to_vec(&file_metdadata).context("Error serializing puffin metadata")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_puffin_bytes_writer_new() {
        let buffer: Vec<u8> = Vec::new();
        let writer = PuffinBytesWriter::new(buffer);

        assert_eq!(writer.written_bytes, 0);
        assert!(writer.properties.is_empty());
        assert!(writer.blobs_metadata.is_empty());
    }

    #[test]
    fn test_puffin_bytes_writer_add_single_blob() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        let blob_data = b"test blob data";
        let result = writer.add_blob(blob_data, BlobTypes::O2FstV1, "test_blob".to_string());

        assert!(result.is_ok());
        assert_eq!(writer.written_bytes, MAGIC_SIZE + blob_data.len() as u64);
        assert_eq!(writer.blobs_metadata.len(), 1);

        let blob_metadata = &writer.blobs_metadata[0];
        assert_eq!(blob_metadata.blob_type, BlobTypes::O2FstV1);
        assert_eq!(blob_metadata.offset, MAGIC_SIZE);
        assert_eq!(blob_metadata.length, blob_data.len() as u64);
        assert_eq!(
            blob_metadata.properties.get("blob_tag"),
            Some(&"test_blob".to_string())
        );
    }

    #[test]
    fn test_puffin_bytes_writer_add_multiple_blobs() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        let blob1_data = b"first blob";
        let blob2_data = b"second blob data";

        writer
            .add_blob(blob1_data, BlobTypes::O2FstV1, "blob1".to_string())
            .unwrap();
        writer
            .add_blob(blob2_data, BlobTypes::O2TtvV1, "blob2".to_string())
            .unwrap();

        assert_eq!(writer.blobs_metadata.len(), 2);

        // Check first blob
        let blob1_metadata = &writer.blobs_metadata[0];
        assert_eq!(blob1_metadata.blob_type, BlobTypes::O2FstV1);
        assert_eq!(blob1_metadata.offset, MAGIC_SIZE);
        assert_eq!(blob1_metadata.length, blob1_data.len() as u64);
        assert_eq!(
            blob1_metadata.properties.get("blob_tag"),
            Some(&"blob1".to_string())
        );

        // Check second blob
        let blob2_metadata = &writer.blobs_metadata[1];
        assert_eq!(blob2_metadata.blob_type, BlobTypes::O2TtvV1);
        assert_eq!(blob2_metadata.offset, MAGIC_SIZE + blob1_data.len() as u64);
        assert_eq!(blob2_metadata.length, blob2_data.len() as u64);
        assert_eq!(
            blob2_metadata.properties.get("blob_tag"),
            Some(&"blob2".to_string())
        );

        let expected_written = MAGIC_SIZE + blob1_data.len() as u64 + blob2_data.len() as u64;
        assert_eq!(writer.written_bytes, expected_written);
    }

    #[test]
    fn test_puffin_bytes_writer_finish_empty() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        let result = writer.finish();
        assert!(result.is_ok());

        let total_bytes = result.unwrap();
        // Should write header + footer even with no blobs
        assert!(total_bytes >= MAGIC_SIZE + MIN_DATA_SIZE);
    }

    #[test]
    fn test_puffin_bytes_writer_finish_with_blobs() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        let blob_data = b"test data";
        writer
            .add_blob(blob_data, BlobTypes::O2FstV1, "test".to_string())
            .unwrap();

        let result = writer.finish();
        assert!(result.is_ok());

        let total_bytes = result.unwrap();
        assert!(total_bytes > MAGIC_SIZE + blob_data.len() as u64);
    }

    #[test]
    fn test_puffin_bytes_writer_complete_file_structure() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        let blob1_data = b"first blob content";
        let blob2_data = b"second blob content";

        writer
            .add_blob(blob1_data, BlobTypes::O2FstV1, "blob1".to_string())
            .unwrap();
        writer
            .add_blob(blob2_data, BlobTypes::O2TtvV1, "blob2".to_string())
            .unwrap();

        let total_bytes = writer.finish().unwrap();
        let final_buffer = writer.writer;

        // Verify the file starts with MAGIC
        assert_eq!(&final_buffer[0..MAGIC_SIZE as usize], &MAGIC);

        // Verify the total size
        assert_eq!(final_buffer.len() as u64, total_bytes);

        // Verify blobs are written after header
        let blob1_start = MAGIC_SIZE as usize;
        let blob1_end = blob1_start + blob1_data.len();
        assert_eq!(&final_buffer[blob1_start..blob1_end], blob1_data);

        let blob2_start = blob1_end;
        let blob2_end = blob2_start + blob2_data.len();
        assert_eq!(&final_buffer[blob2_start..blob2_end], blob2_data);

        // Verify the file ends with MAGIC
        let footer_magic_start = final_buffer.len() - MAGIC_SIZE as usize;
        assert_eq!(&final_buffer[footer_magic_start..], &MAGIC);
    }

    #[test]
    fn test_puffin_bytes_writer_empty_blob() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        let empty_blob = b"";
        let result = writer.add_blob(empty_blob, BlobTypes::O2FstV1, "empty".to_string());

        assert!(result.is_ok());
        assert_eq!(writer.blobs_metadata.len(), 1);

        let blob_metadata = &writer.blobs_metadata[0];
        assert_eq!(blob_metadata.length, 0);
        assert_eq!(blob_metadata.offset, MAGIC_SIZE);
    }

    #[test]
    fn test_build_blob_metadata() {
        let buffer: Vec<u8> = Vec::new();
        let writer = PuffinBytesWriter::new(buffer);

        let mut properties = HashMap::new();
        properties.insert("key".to_string(), "value".to_string());

        let metadata = writer.build_blob_metadata(BlobTypes::O2TtvV1, properties.clone(), 1000);

        assert_eq!(metadata.blob_type, BlobTypes::O2TtvV1);
        assert_eq!(metadata.offset, 0); // writer.written_bytes is 0
        assert_eq!(metadata.length, 1000);
        assert_eq!(metadata.properties, properties);
    }

    #[test]
    fn test_puffin_footer_writer_empty() {
        let footer_writer = PuffinFooterWriter::new(vec![], HashMap::new());
        let result = footer_writer.into_bytes();

        assert!(result.is_ok());
        let footer_bytes = result.unwrap();

        // Should contain: header magic + payload + payload_size + flags + footer magic
        assert!(footer_bytes.len() >= MIN_DATA_SIZE as usize);

        // Check header magic
        assert_eq!(&footer_bytes[0..MAGIC_SIZE as usize], &MAGIC);

        // Check footer magic (last 4 bytes)
        let footer_end = footer_bytes.len();
        assert_eq!(&footer_bytes[footer_end - MAGIC_SIZE as usize..], &MAGIC);
    }

    #[test]
    fn test_puffin_footer_writer_with_metadata() {
        let blob_metadata = vec![BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![1, 2],
            snapshot_id: 123,
            sequence_number: 456,
            offset: 100,
            length: 200,
            compression_codec: Some(CompressionCodec::Zstd),
            properties: HashMap::new(),
        }];

        let mut file_properties = HashMap::new();
        file_properties.insert("writer".to_string(), "test".to_string());

        let footer_writer = PuffinFooterWriter::new(blob_metadata, file_properties);
        let result = footer_writer.into_bytes();

        assert!(result.is_ok());
        let footer_bytes = result.unwrap();

        // Should be larger than minimum size due to payload
        assert!(footer_bytes.len() > MIN_DATA_SIZE as usize);

        // Check structure
        assert_eq!(&footer_bytes[0..MAGIC_SIZE as usize], &MAGIC);
        let footer_end = footer_bytes.len();
        assert_eq!(&footer_bytes[footer_end - MAGIC_SIZE as usize..], &MAGIC);
    }

    #[test]
    fn test_puffin_footer_writer_json_serialization() {
        let blob_metadata = vec![BlobMetadata {
            blob_type: BlobTypes::O2FstV1,
            fields: vec![],
            snapshot_id: 0,
            sequence_number: 0,
            offset: 4,
            length: 10,
            compression_codec: None,
            properties: HashMap::new(),
        }];

        let file_properties = HashMap::new();
        let mut footer_writer = PuffinFooterWriter::new(blob_metadata.clone(), file_properties);

        let payload = footer_writer.get_payload().unwrap();

        // Verify that payload is valid JSON and can be deserialized back
        let parsed: PuffinMeta = serde_json::from_slice(&payload).unwrap();
        assert_eq!(parsed.blobs.len(), 1);
        assert_eq!(parsed.blobs[0].blob_type, BlobTypes::O2FstV1);
        assert_eq!(parsed.blobs[0].offset, 4);
        assert_eq!(parsed.blobs[0].length, 10);
    }

    #[test]
    fn test_add_header_if_needed_multiple_calls() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        // First call should add header
        writer.add_header_if_needed().unwrap();
        assert_eq!(writer.written_bytes, MAGIC_SIZE);

        let bytes_after_first = writer.written_bytes;

        // Second call should not add header again
        writer.add_header_if_needed().unwrap();
        assert_eq!(writer.written_bytes, bytes_after_first);
    }

    #[test]
    fn test_writer_with_different_blob_types() {
        let buffer: Vec<u8> = Vec::new();
        let mut writer = PuffinBytesWriter::new(buffer);

        let blob_types = [
            BlobTypes::O2FstV1,
            BlobTypes::O2TtvV1,
            BlobTypes::O2TtvFooterV1,
            BlobTypes::DeletionVectorV1,
            BlobTypes::ApacheDatasketchesThetaV1,
        ];

        for (i, blob_type) in blob_types.iter().enumerate() {
            let blob_data = format!("blob data {i}").into_bytes();
            let blob_tag = format!("blob_{i}");

            writer
                .add_blob(&blob_data, blob_type.clone(), blob_tag.clone())
                .unwrap();
        }

        assert_eq!(writer.blobs_metadata.len(), blob_types.len());

        for (i, expected_type) in blob_types.iter().enumerate() {
            assert_eq!(writer.blobs_metadata[i].blob_type, *expected_type);
            assert_eq!(
                writer.blobs_metadata[i].properties.get("blob_tag"),
                Some(&format!("blob_{i}"))
            );
        }

        let result = writer.finish();
        assert!(result.is_ok());
    }
}
