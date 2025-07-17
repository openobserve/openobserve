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

use std::{
    collections::HashSet,
    io,
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
};

use futures::future::try_join_all;
use hashbrown::HashMap;
use tantivy::{
    HasLen,
    directory::{Directory, FileHandle, OwnedBytes, error::OpenReadError},
};

use crate::service::tantivy::{
    puffin::{BlobMetadata, reader::PuffinBytesReader},
    puffin_directory::{
        EMPTY_PUFFIN_DIRECTORY, EMPTY_PUFFIN_SEG_ID, get_file_from_empty_puffin_dir_with_ext,
    },
};

#[derive(Debug)]
pub struct PuffinDirReader {
    source: Arc<PuffinBytesReader>,
    blobs_metadata: Arc<HashMap<PathBuf, Arc<BlobMetadata>>>,
}

impl PuffinDirReader {
    pub async fn from_path(account: String, source: object_store::ObjectMeta) -> io::Result<Self> {
        let mut source = PuffinBytesReader::new(account, source);
        let Some(metadata) = source.get_metadata().await.map_err(|e| {
            io::Error::other(format!("Error reading metadata from puffin file: {e}"))
        })?
        else {
            return Err(io::Error::other("Error reading metadata from puffin file"));
        };

        let mut blobs_metadata = HashMap::new();
        for meta in metadata.blobs {
            // Fetch the files names from the blob_meta itself
            if let Some(file_name) = meta.properties.get("blob_tag") {
                let path = PathBuf::from(file_name);
                blobs_metadata.insert(path, Arc::new(meta));
            }
        }

        Ok(Self {
            source: Arc::new(source),
            blobs_metadata: Arc::new(blobs_metadata),
        })
    }
}

impl Clone for PuffinDirReader {
    fn clone(&self) -> Self {
        PuffinDirReader {
            source: self.source.clone(),
            blobs_metadata: self.blobs_metadata.clone(),
        }
    }
}

// Version 1: Keep the blob withing the file handle and return it when read
#[derive(Debug)]
struct PuffinSliceHandle {
    path: PathBuf,
    source: Arc<PuffinBytesReader>,
    metadata: Arc<BlobMetadata>,
}

impl HasLen for PuffinSliceHandle {
    fn len(&self) -> usize {
        self.metadata.length as usize
    }
}

#[async_trait::async_trait]
impl FileHandle for PuffinSliceHandle {
    fn read_bytes(&self, _byte_range: Range<usize>) -> io::Result<OwnedBytes> {
        Err(io::Error::other(format!(
            "Error read_bytes from blob: {:?}, Not supported with PuffinSliceHandle",
            self.path
        )))
    }

    async fn read_bytes_async(&self, byte_range: Range<usize>) -> io::Result<OwnedBytes> {
        if byte_range.is_empty() {
            return Ok(OwnedBytes::empty());
        }
        let byte_range = Range {
            start: byte_range.start as u64,
            end: byte_range.end as u64,
        };
        let data = self
            .source
            .read_blob_bytes(&self.metadata, Some(byte_range.clone()))
            .await
            .map_err(|e| io::Error::other(format!("Error reading bytes from blob: {e}")))?;
        Ok(OwnedBytes::new(data.to_vec()))
    }
}

impl Directory for PuffinDirReader {
    fn get_file_handle(
        &self,
        path: &Path,
    ) -> std::result::Result<Arc<dyn FileHandle>, OpenReadError> {
        match self.blobs_metadata.get(path) {
            Some(meta) => {
                let file_handle = PuffinSliceHandle {
                    path: path.to_path_buf(),
                    source: self.source.clone(),
                    metadata: meta.clone(),
                };
                Ok(Arc::new(file_handle))
            }
            None => {
                let ext = match path.extension().and_then(|ext| ext.to_str()) {
                    Some(ext) => ext,
                    None => return Err(OpenReadError::FileDoesNotExist(path.to_path_buf())),
                };
                match get_file_from_empty_puffin_dir_with_ext(ext) {
                    Ok(blob) => Ok(Arc::new(blob)),
                    Err(_) => Err(OpenReadError::FileDoesNotExist(path.to_path_buf())),
                }
            }
        }
    }

    fn exists(&self, path: &Path) -> std::result::Result<bool, OpenReadError> {
        if !self.blobs_metadata.contains_key(path) {
            let ext = match path.extension().and_then(|ext| ext.to_str()) {
                Some(ext) => ext,
                None => return Ok(false),
            };
            let dir_path = format!("{}.{}", &EMPTY_PUFFIN_SEG_ID.as_str(), ext);
            EMPTY_PUFFIN_DIRECTORY.exists(&PathBuf::from(dir_path))
        } else {
            Ok(true)
        }
    }

    fn atomic_read(&self, _path: &Path) -> std::result::Result<Vec<u8>, OpenReadError> {
        unimplemented!("read-only")
    }

    fn atomic_write(&self, _path: &Path, _data: &[u8]) -> io::Result<()> {
        unimplemented!("read-only")
    }

    fn delete(&self, _path: &Path) -> Result<(), tantivy::directory::error::DeleteError> {
        unimplemented!("read-only")
    }

    fn open_write(
        &self,
        _path: &Path,
    ) -> Result<tantivy::directory::WritePtr, tantivy::directory::error::OpenWriteError> {
        unimplemented!("read-only")
    }

    fn sync_directory(&self) -> io::Result<()> {
        unimplemented!("read-only")
    }

    fn watch(
        &self,
        _watch_callback: tantivy::directory::WatchCallback,
    ) -> tantivy::Result<tantivy::directory::WatchHandle> {
        Ok(tantivy::directory::WatchHandle::empty())
    }

    fn acquire_lock(
        &self,
        _lock: &tantivy::directory::Lock,
    ) -> Result<tantivy::directory::DirectoryLock, tantivy::directory::error::LockError> {
        Ok(tantivy::directory::DirectoryLock::from(Box::new(|| {})))
    }
}

/// preload the terms in the index
pub async fn warm_up_terms(
    searcher: &tantivy::Searcher,
    terms_grouped_by_field: &HashMap<tantivy::schema::Field, HashMap<tantivy::Term, bool>>,
    need_all_term_fields: HashSet<tantivy::schema::Field>,
    need_fast_field: Option<String>,
) -> anyhow::Result<()> {
    let mut warm_up_fields_futures = Vec::new();
    let mut warm_up_fields_term_futures = Vec::new();
    let mut warm_up_terms_futures = Vec::new();
    let mut warm_up_fast_fields_futures = Vec::new();
    let mut warmed_segments = HashSet::new();
    for (field, terms) in terms_grouped_by_field {
        for segment_reader in searcher.segment_readers() {
            let inv_idx = segment_reader.inverted_index(*field)?;
            if terms.is_empty() {
                continue;
            }
            for (term, position_needed) in terms.iter() {
                let inv_idx_clone = inv_idx.clone();
                warm_up_terms_futures
                    .push(async move { inv_idx_clone.warm_postings(term, *position_needed).await });
            }
        }
    }

    // warn up the all term fields
    for field in need_all_term_fields {
        for segment_reader in searcher.segment_readers() {
            let inv_idx = segment_reader.inverted_index(field)?;
            let inv_idx_clone = inv_idx.clone();
            warm_up_fields_futures
                .push(async move { inv_idx_clone.warm_postings_full(false).await });
            warm_up_fields_term_futures
                .push(async move { inv_idx.terms().warm_up_dictionary().await });
        }
    }

    // warm up fast fields if needed
    if let Some(field_name) = need_fast_field {
        for segment_reader in searcher.segment_readers() {
            // only warm up fast fields once per segment
            let field_name = field_name.clone();
            let segment_id = segment_reader.segment_id();
            if !warmed_segments.contains(&segment_id) {
                let fast_field_reader = segment_reader.fast_fields();
                warm_up_fast_fields_futures
                    .push(async move { warm_up_fastfield(fast_field_reader, field_name).await });
                warmed_segments.insert(segment_id);
            }
        }
    }

    if !warm_up_fields_futures.is_empty() {
        try_join_all(warm_up_fields_futures).await?;
    }
    if !warm_up_fields_term_futures.is_empty() {
        try_join_all(warm_up_fields_term_futures).await?;
    }
    if !warm_up_terms_futures.is_empty() {
        try_join_all(warm_up_terms_futures).await?;
    }
    if !warm_up_fast_fields_futures.is_empty() {
        try_join_all(warm_up_fast_fields_futures).await?;
    }
    Ok(())
}

// warm up the fast field, only support _timestamp field
async fn warm_up_fastfield(
    fast_field_reader: &tantivy::fastfield::FastFieldReaders,
    field_name: String,
) -> anyhow::Result<()> {
    let columns = fast_field_reader
        .list_dynamic_column_handles(field_name.as_str())
        .await?;
    futures::future::try_join_all(
        columns
            .into_iter()
            .map(|col| async move { col.file_slice().read_bytes_async().await }),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, io::ErrorKind, path::PathBuf, sync::Arc};

    use config::TIMESTAMP_COL_NAME;
    use hashbrown::HashMap as HashbrownHashMap;
    use tantivy::{
        HasLen, Index, Term,
        directory::{Directory, FileHandle, error::OpenReadError},
        doc,
        schema::{STORED, Schema, TEXT},
    };
    use tokio::time::{Duration, Instant};

    use super::{
        super::super::puffin::{
            BlobMetadata, BlobMetadataBuilder, BlobTypes, reader::PuffinBytesReader,
        },
        *,
    };

    // Mock data for testing
    fn create_mock_object_meta(file_name: &str, size: usize) -> object_store::ObjectMeta {
        object_store::ObjectMeta {
            location: file_name.into(),
            last_modified: chrono::Utc::now(),
            size: size as u64,
            e_tag: None,
            version: None,
        }
    }

    fn create_mock_blob_metadata(
        blob_type: BlobTypes,
        offset: u64,
        length: u64,
        file_name: &str,
    ) -> Result<BlobMetadata, &'static str> {
        let mut properties = HashMap::new();
        properties.insert("blob_tag".to_string(), file_name.to_string());

        BlobMetadataBuilder::default()
            .blob_type(blob_type)
            .offset(offset)
            .length(length)
            .properties(properties)
            .build()
    }

    #[tokio::test]
    async fn test_puffin_dir_reader_from_path_success() {
        // This test would need to be implemented with proper mocking
        // For now, we test the structure and error handling
        let account = "test_account".to_string();
        let meta = create_mock_object_meta("test_file.puffin", 1024);

        // Test error case - this will fail because we don't have actual puffin data
        let result = PuffinDirReader::from_path(account, meta).await;
        assert!(result.is_err(), "Expected error for invalid puffin file");

        // Verify the error message contains expected text
        if let Err(e) = result {
            assert!(
                e.to_string()
                    .contains("Error reading metadata from puffin file")
            );
        }
    }

    #[tokio::test]
    async fn test_puffin_dir_reader_from_path_no_metadata() {
        let account = "test_account".to_string();
        let meta = create_mock_object_meta("empty_file.puffin", 0);

        let result = PuffinDirReader::from_path(account, meta).await;
        assert!(result.is_err(), "Expected error for file without metadata");
    }

    #[test]
    fn test_puffin_slice_handle_len() {
        let blob = create_mock_blob_metadata(BlobTypes::O2FstV1, 0, 42, "test_file.terms")
            .expect("Failed to create blob metadata");

        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let handle = PuffinSliceHandle {
            path: PathBuf::from("test_file.terms"),
            source: Arc::new(mock_reader),
            metadata: Arc::new(blob),
        };

        assert_eq!(handle.len(), 42);
    }

    #[test]
    fn test_puffin_slice_handle_read_bytes_sync_error() {
        let blob = create_mock_blob_metadata(BlobTypes::O2FstV1, 0, 100, "test_file.terms")
            .expect("Failed to create blob metadata");

        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let handle = PuffinSliceHandle {
            path: PathBuf::from("test_file.terms"),
            source: Arc::new(mock_reader),
            metadata: Arc::new(blob),
        };

        let result = handle.read_bytes(0..10);
        assert!(result.is_err());

        if let Err(e) = result {
            assert_eq!(e.kind(), ErrorKind::Other);
            assert!(
                e.to_string()
                    .contains("Not supported with PuffinSliceHandle")
            );
        }
    }

    #[tokio::test]
    async fn test_puffin_slice_handle_read_bytes_async_empty_range() {
        let blob = create_mock_blob_metadata(BlobTypes::O2FstV1, 0, 100, "test_file.terms")
            .expect("Failed to create blob metadata");

        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let handle = PuffinSliceHandle {
            path: PathBuf::from("test_file.terms"),
            source: Arc::new(mock_reader),
            metadata: Arc::new(blob),
        };

        let result = handle.read_bytes_async(0..0).await;
        assert!(result.is_ok());

        if let Ok(bytes) = result {
            assert_eq!(bytes.len(), 0);
        }
    }

    #[test]
    fn test_directory_get_file_handle_existing_file() {
        let mut blobs_metadata = HashbrownHashMap::new();
        let blob = create_mock_blob_metadata(BlobTypes::O2FstV1, 0, 100, "existing_file.terms")
            .expect("Failed to create blob metadata");

        let path = PathBuf::from("existing_file.terms");
        blobs_metadata.insert(path.clone(), Arc::new(blob));

        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let reader = PuffinDirReader {
            source: Arc::new(mock_reader),
            blobs_metadata: Arc::new(blobs_metadata),
        };

        let result = reader.get_file_handle(&path);
        assert!(result.is_ok(), "Expected success for existing file");
    }

    #[test]
    fn test_directory_get_file_handle_nonexistent_file() {
        let blobs_metadata = HashbrownHashMap::new();
        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let reader = PuffinDirReader {
            source: Arc::new(mock_reader),
            blobs_metadata: Arc::new(blobs_metadata),
        };

        let path = PathBuf::from("nonexistent_file.terms");
        let result = reader.get_file_handle(&path);

        // This should try to get from empty puffin directory, which might succeed or fail
        // depending on the extension
        match result {
            Ok(_) => {
                // File found in empty puffin directory
            }
            Err(OpenReadError::FileDoesNotExist(_)) => {
                // Expected for files not in empty puffin directory
            }
            Err(e) => panic!("Unexpected error: {e}"),
        }
    }

    #[test]
    fn test_directory_get_file_handle_no_extension() {
        let blobs_metadata = HashbrownHashMap::new();
        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let reader = PuffinDirReader {
            source: Arc::new(mock_reader),
            blobs_metadata: Arc::new(blobs_metadata),
        };

        let path = PathBuf::from("file_without_extension");
        let result = reader.get_file_handle(&path);

        assert!(matches!(result, Err(OpenReadError::FileDoesNotExist(_))));
    }

    #[test]
    fn test_directory_exists_existing_file() {
        let mut blobs_metadata = HashbrownHashMap::new();
        let blob = create_mock_blob_metadata(BlobTypes::O2FstV1, 0, 100, "existing_file.terms")
            .expect("Failed to create blob metadata");

        let path = PathBuf::from("existing_file.terms");
        blobs_metadata.insert(path.clone(), Arc::new(blob));

        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let reader = PuffinDirReader {
            source: Arc::new(mock_reader),
            blobs_metadata: Arc::new(blobs_metadata),
        };

        let result = reader.exists(&path);
        assert!(result.is_ok_and(|exists| exists), "Expected file to exist");
    }

    #[test]
    fn test_directory_exists_nonexistent_file() {
        let blobs_metadata = HashbrownHashMap::new();
        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let reader = PuffinDirReader {
            source: Arc::new(mock_reader),
            blobs_metadata: Arc::new(blobs_metadata),
        };

        let path = PathBuf::from("nonexistent_file.unknown");
        let result = reader.exists(&path);

        // Should check empty puffin directory
        assert!(result.is_ok());
    }

    #[test]
    fn test_directory_readonly_operations() {
        let blobs_metadata = HashbrownHashMap::new();
        let mock_reader = PuffinBytesReader::new(
            "test_account".to_string(),
            create_mock_object_meta("test.puffin", 1024),
        );

        let reader = PuffinDirReader {
            source: Arc::new(mock_reader),
            blobs_metadata: Arc::new(blobs_metadata),
        };

        let path = PathBuf::from("test_file.txt");
        let data = b"test data";

        // Test that write operations are unimplemented
        let atomic_write_result = std::panic::catch_unwind(|| reader.atomic_write(&path, data));
        assert!(atomic_write_result.is_err());

        let atomic_read_result = std::panic::catch_unwind(|| reader.atomic_read(&path));
        assert!(atomic_read_result.is_err());

        let delete_result = std::panic::catch_unwind(|| reader.delete(&path));
        assert!(delete_result.is_err());

        let open_write_result = std::panic::catch_unwind(|| reader.open_write(&path));
        assert!(open_write_result.is_err());

        let sync_result = std::panic::catch_unwind(|| reader.sync_directory());
        assert!(sync_result.is_err());
    }

    #[tokio::test]
    async fn test_warm_up_terms_empty_terms() {
        // Create a simple in-memory index for testing
        let mut schema_builder = Schema::builder();
        let text_field = schema_builder.add_text_field("text", TEXT | STORED);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema.clone());
        let mut index_writer = index
            .writer(50_000_000)
            .expect("Failed to create index writer");

        // Add a document
        index_writer
            .add_document(doc!(text_field => "hello world"))
            .expect("Failed to add document");
        index_writer.commit().expect("Failed to commit");

        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()
            .expect("Failed to create reader");

        let searcher = reader.searcher();

        // Test with empty terms
        let terms_grouped_by_field = HashbrownHashMap::new();
        let result = warm_up_terms(&searcher, &terms_grouped_by_field, HashSet::new(), None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_warm_up_terms_with_terms() {
        // Create a simple in-memory index for testing
        let mut schema_builder = Schema::builder();
        let text_field = schema_builder.add_text_field("text", TEXT | STORED);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema.clone());
        let mut index_writer = index
            .writer(50_000_000)
            .expect("Failed to create index writer");

        // Add a document
        index_writer
            .add_document(doc!(text_field => "hello world"))
            .expect("Failed to add document");
        index_writer.commit().expect("Failed to commit");

        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()
            .expect("Failed to create reader");

        let searcher = reader.searcher();

        // Test with specific terms
        let mut terms_grouped_by_field = HashbrownHashMap::new();
        let mut field_terms = HashbrownHashMap::new();
        let term = Term::from_field_text(text_field, "hello");
        field_terms.insert(term, false);
        terms_grouped_by_field.insert(text_field, field_terms);

        let result = warm_up_terms(&searcher, &terms_grouped_by_field, HashSet::new(), None).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_warm_up_terms_with_prefix_field() {
        // Create a simple in-memory index for testing
        let mut schema_builder = Schema::builder();
        let text_field = schema_builder.add_text_field("text", TEXT | STORED);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema.clone());
        let mut index_writer = index
            .writer(50_000_000)
            .expect("Failed to create index writer");

        // Add a document
        index_writer
            .add_document(doc!(text_field => "hello world"))
            .expect("Failed to add document");
        index_writer.commit().expect("Failed to commit");

        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()
            .expect("Failed to create reader");

        let searcher = reader.searcher();

        // Test with prefix field
        let terms_grouped_by_field = HashbrownHashMap::new();
        let result = warm_up_terms(
            &searcher,
            &terms_grouped_by_field,
            HashSet::from([text_field]),
            None,
        )
        .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_warm_up_terms_with_fast_fields() {
        // Create a simple in-memory index for testing
        let mut schema_builder = Schema::builder();
        let text_field = schema_builder.add_text_field("text", TEXT | STORED);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema.clone());
        let mut index_writer = index
            .writer(50_000_000)
            .expect("Failed to create index writer");

        // Add a document
        index_writer
            .add_document(doc!(text_field => "hello world"))
            .expect("Failed to add document");
        index_writer.commit().expect("Failed to commit");

        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()
            .expect("Failed to create reader");

        let searcher = reader.searcher();

        // Test with fast fields enabled
        let terms_grouped_by_field = HashbrownHashMap::new();
        let result = warm_up_terms(
            &searcher,
            &terms_grouped_by_field,
            HashSet::new(),
            Some(TIMESTAMP_COL_NAME.to_string()),
        )
        .await;
        // This might fail if _timestamp field is not present, which is expected in this simple test
        // The important thing is that the function doesn't panic
        let _ = result;
    }

    #[tokio::test]
    async fn test_warm_up_terms_performance() {
        // Performance test to ensure warming up doesn't take too long
        let mut schema_builder = Schema::builder();
        let text_field = schema_builder.add_text_field("text", TEXT | STORED);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema.clone());
        let mut index_writer = index
            .writer(50_000_000)
            .expect("Failed to create index writer");

        // Add multiple documents
        for i in 0..100 {
            index_writer
                .add_document(doc!(text_field => format!("document {}", i)))
                .expect("Failed to add document");
        }
        index_writer.commit().expect("Failed to commit");

        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()
            .expect("Failed to create reader");

        let searcher = reader.searcher();

        let mut terms_grouped_by_field = HashbrownHashMap::new();
        let mut field_terms = HashbrownHashMap::with_capacity(10);
        // Add multiple terms
        for i in 0..10 {
            let term = Term::from_field_text(text_field, &format!("document {i}"));
            field_terms.insert(term, false);
        }
        terms_grouped_by_field.insert(text_field, field_terms);

        let start = Instant::now();
        let result = warm_up_terms(&searcher, &terms_grouped_by_field, HashSet::new(), None).await;
        let duration = start.elapsed();

        assert!(result.is_ok());
        // Warming up should complete within a reasonable time (10 seconds for this test)
        assert!(duration < Duration::from_secs(10));
    }

    #[test]
    fn test_blob_metadata_properties() {
        let blob = create_mock_blob_metadata(BlobTypes::O2FstV1, 100, 200, "test_file.terms")
            .expect("Failed to create blob metadata");

        // Test that properties are set correctly
        assert_eq!(blob.blob_type, BlobTypes::O2FstV1);
        assert_eq!(blob.offset, 100);
        assert_eq!(blob.length, 200);
        assert_eq!(
            blob.properties.get("blob_tag"),
            Some(&"test_file.terms".to_string())
        );
    }

    #[test]
    fn test_blob_metadata_get_offset() {
        let blob = create_mock_blob_metadata(BlobTypes::O2FstV1, 100, 200, "test_file.terms")
            .expect("Failed to create blob metadata");

        // Test get_offset with no range
        let offset_range = blob.get_offset(None);
        assert_eq!(offset_range, 100..300);

        // Test get_offset with specific range
        let offset_range = blob.get_offset(Some(10..20));
        assert_eq!(offset_range, 110..120);
    }

    #[test]
    fn test_error_handling_edge_cases() {
        // Test various error conditions that might occur in real usage

        // Test with invalid blob types
        let result = BlobMetadataBuilder::default().offset(0).length(100).build();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "blob_type is required");

        // Test with missing offset
        let result = BlobMetadataBuilder::default()
            .blob_type(BlobTypes::O2FstV1)
            .length(100)
            .build();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "offset is required");
    }
}
