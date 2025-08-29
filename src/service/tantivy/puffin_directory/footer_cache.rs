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
    collections::HashMap,
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
};

use byteorder::ByteOrder;
use bytes::Bytes;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tantivy::{Directory, ReloadPolicy, directory::OwnedBytes};

use super::{EMPTY_FILE_EXT, FOOTER_CACHE, caching_directory::CachingDirectory};

const FOOTER_CACHE_VERSION: u32 = 1;
const FOOTER_VERSION_LEN: usize = 4;
const FOOTER_OFFSET_LEN: usize = 8;

pub(crate) struct FooterCache {
    data: RwLock<HashMap<PathBuf, HashMap<Range<usize>, OwnedBytes>>>,
}

impl FooterCache {
    pub(crate) fn new() -> Self {
        Self {
            data: RwLock::new(HashMap::new()),
        }
    }

    pub(crate) fn get_slice(&self, path: &Path, byte_range: Range<usize>) -> Option<OwnedBytes> {
        let r = self.data.read();
        let r = r.get(path)?;
        // fast path: check exactly range
        if let Some(v) = r.get(&byte_range) {
            return Some(v.clone());
        }
        // slow path: find if any range include this range and then return the slice
        for (range, bytes) in r.iter() {
            if range.start <= byte_range.start && range.end >= byte_range.end {
                return Some(
                    bytes.slice(byte_range.start - range.start..byte_range.end - range.start),
                );
            }
        }
        None
    }

    pub(crate) fn put_slice(&self, path: PathBuf, byte_range: Range<usize>, bytes: OwnedBytes) {
        self.data
            .write()
            .entry(path)
            .or_default()
            .insert(byte_range, bytes);
    }

    #[cfg(test)]
    pub(crate) fn file_num(&self) -> usize {
        self.data.read().len()
    }

    pub(crate) fn to_bytes(&self) -> tantivy::Result<Bytes> {
        let mut buf = Vec::new();
        let r = self.data.read();
        let mut metadata = FooterCacheMeta::new();
        // write data
        for (path, slice_data) in r.iter() {
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            if EMPTY_FILE_EXT.contains(&ext) {
                continue;
            }
            for (range, bytes) in slice_data.iter() {
                let offset = buf.len();
                buf.extend_from_slice(bytes);
                metadata.push(path, offset, range);
            }
        }
        // write metadata
        let offset = buf.len() as u64;
        let meta_bytes = serde_json::to_vec(&metadata)?;
        buf.extend_from_slice(&meta_bytes);
        // write footer offset
        buf.extend_from_slice(&offset.to_le_bytes()[..]);
        // write footer version
        buf.extend_from_slice(&FOOTER_CACHE_VERSION.to_le_bytes()[..]);
        Ok(buf.into())
    }

    pub(crate) fn from_bytes(bytes: OwnedBytes) -> tantivy::Result<Self> {
        // parse version
        if bytes.len() < FOOTER_VERSION_LEN + FOOTER_OFFSET_LEN {
            return Err(tantivy::TantivyError::InvalidArgument(format!(
                "Invalid footer cache size: expected size {} vs actual size {}",
                FOOTER_VERSION_LEN + FOOTER_OFFSET_LEN,
                bytes.len()
            )));
        }
        let range = bytes.len() - FOOTER_VERSION_LEN..bytes.len();
        let footer_version = byteorder::LittleEndian::read_u32(&bytes.slice(range));
        if footer_version != FOOTER_CACHE_VERSION {
            return Err(tantivy::TantivyError::InvalidArgument(format!(
                "Invalid footer version: {footer_version}"
            )));
        }
        // parse footer offset
        let range =
            bytes.len() - FOOTER_OFFSET_LEN - FOOTER_VERSION_LEN..bytes.len() - FOOTER_VERSION_LEN;
        let footer_offset = byteorder::LittleEndian::read_u64(&bytes.slice(range));
        // parse metadata
        if bytes.len() < FOOTER_OFFSET_LEN + FOOTER_VERSION_LEN + footer_offset as usize {
            return Err(tantivy::TantivyError::InvalidArgument(format!(
                "Invalid footer offset: {footer_offset}"
            )));
        }
        let range = footer_offset as usize..(bytes.len() - FOOTER_OFFSET_LEN - FOOTER_VERSION_LEN);
        let metadata: FooterCacheMeta = serde_json::from_slice(&bytes.slice(range))?;
        // parse footer data
        let mut data = HashMap::new();
        for (path, items) in metadata.files.iter() {
            let mut slice_data = HashMap::new();
            for item in items.iter() {
                if bytes.len() < item.offset as usize + item.len as usize {
                    return Err(tantivy::TantivyError::InvalidArgument(format!(
                        "Invalid footer data: offset {} + len {} > {}",
                        item.offset,
                        item.len,
                        bytes.len()
                    )));
                }
                let range = item.start as usize..(item.start + item.len) as usize;
                let data = bytes.slice(item.offset as usize..(item.offset + item.len) as usize);
                slice_data.insert(range, data);
            }
            data.insert(PathBuf::from(path), slice_data);
        }
        Ok(Self {
            data: RwLock::new(data),
        })
    }

    pub(crate) async fn from_directory(source: Arc<dyn Directory>) -> tantivy::Result<Self> {
        let path = std::path::Path::new(FOOTER_CACHE);
        let file = source.get_file_handle(path)?;
        let data = file.read_bytes_async(0..file.len()).await?;
        Self::from_bytes(data)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FooterCacheMeta {
    files: HashMap<String, Vec<FooterCacheMetaItem>>,
}

impl FooterCacheMeta {
    fn new() -> Self {
        Self {
            files: HashMap::new(),
        }
    }

    fn push(&mut self, path: &Path, offset: usize, range: &Range<usize>) {
        self.files
            .entry(path.to_string_lossy().to_string())
            .or_default()
            .push(FooterCacheMetaItem {
                offset: offset as u64,
                start: range.start as u64,
                len: (range.end - range.start) as u64,
            });
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FooterCacheMetaItem {
    offset: u64, // offset in the buffer file
    start: u64,  // range start
    len: u64,    // range lenth
}

pub(crate) fn build_footer_cache<D: Directory>(directory: Arc<D>) -> tantivy::Result<bytes::Bytes> {
    let cache_dir = CachingDirectory::new(directory);
    let index = tantivy::Index::open(cache_dir.clone())?;
    let schema = index.schema();
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()?;
    let searcher = reader.searcher();
    for (field, field_entry) in schema.fields() {
        if !field_entry.is_indexed() {
            continue;
        }
        for reader in searcher.segment_readers() {
            let _inv_idx = reader.inverted_index(field)?;
        }
    }

    let buf = cache_dir.cacher().to_bytes()?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use std::{ops::Range, path::PathBuf, sync::Arc};

    use tantivy::{
        directory::RamDirectory,
        schema::{STORED, Schema, TEXT},
        *,
    };

    use super::*;

    #[test]
    fn test_footer_cache_new() {
        let cache = FooterCache::new();
        assert_eq!(cache.file_num(), 0);
    }

    #[test]
    fn test_footer_cache_put_and_get_slice() {
        let cache = FooterCache::new();
        let path = PathBuf::from("test_file.txt");
        let range = 0..10;
        let data = OwnedBytes::new(b"hello world".to_vec());

        // Put data into cache
        cache.put_slice(path.clone(), range.clone(), data.clone());
        assert_eq!(cache.file_num(), 1);

        // Get exact range
        let result = cache.get_slice(&path, range.clone());
        assert!(result.is_some());
        assert_eq!(result.unwrap().as_slice(), data.as_slice());

        // Get non-existent file
        let other_path = PathBuf::from("non_existent.txt");
        let result = cache.get_slice(&other_path, range);
        assert!(result.is_none());
    }

    #[test]
    fn test_footer_cache_get_slice_within_range() {
        let cache = FooterCache::new();
        let path = PathBuf::from("test_file.txt");
        let full_range = 0..20;
        let data = OwnedBytes::new(b"hello world test data".to_vec());

        // Put larger data into cache
        cache.put_slice(path.clone(), full_range, data);

        // Get subset range
        let subset_range = 6..11; // "world"
        let result = cache.get_slice(&path, subset_range);
        assert!(result.is_some());
        assert_eq!(result.unwrap().as_slice(), b"world");

        // Get range that extends beyond cached range
        let extended_range = 15..25;
        let result = cache.get_slice(&path, extended_range);
        assert!(result.is_none());
    }

    #[test]
    fn test_footer_cache_get_slice_exact_and_subset() {
        let cache = FooterCache::new();
        let path = PathBuf::from("test_file.txt");
        let range1 = 0..10;
        let range2 = 15..25;
        let data1 = OwnedBytes::new(b"hello_test".to_vec());
        let data2 = OwnedBytes::new(b"world_data".to_vec());

        // Put multiple ranges
        cache.put_slice(path.clone(), range1.clone(), data1.clone());
        cache.put_slice(path.clone(), range2.clone(), data2.clone());

        // Get exact ranges
        assert_eq!(
            cache.get_slice(&path, range1).unwrap().as_slice(),
            data1.as_slice()
        );
        assert_eq!(
            cache.get_slice(&path, range2).unwrap().as_slice(),
            data2.as_slice()
        );

        // Get subset of first range
        let subset = 2..7; // "llo_t"
        let result = cache.get_slice(&path, subset);
        assert!(result.is_some());
        assert_eq!(result.unwrap().as_slice(), b"llo_t");
    }

    #[test]
    fn test_footer_cache_multiple_files() {
        let cache = FooterCache::new();
        let path1 = PathBuf::from("file1.txt");
        let path2 = PathBuf::from("file2.txt");
        let range = 0..5;
        let data1 = OwnedBytes::new(b"file1".to_vec());
        let data2 = OwnedBytes::new(b"file2".to_vec());

        cache.put_slice(path1.clone(), range.clone(), data1.clone());
        cache.put_slice(path2.clone(), range.clone(), data2.clone());

        assert_eq!(cache.file_num(), 2);
        assert_eq!(
            cache.get_slice(&path1, range.clone()).unwrap().as_slice(),
            data1.as_slice()
        );
        assert_eq!(
            cache.get_slice(&path2, range.clone()).unwrap().as_slice(),
            data2.as_slice()
        );
    }

    #[test]
    fn test_footer_cache_to_bytes_empty() {
        let cache = FooterCache::new();
        let result = cache.to_bytes();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        // Should contain at least version and offset
        assert!(bytes.len() >= FOOTER_VERSION_LEN + FOOTER_OFFSET_LEN);
    }

    #[test]
    fn test_footer_cache_to_bytes_with_data() {
        let cache = FooterCache::new();
        let path = PathBuf::from("test.term");
        let range = 0..10;
        let data = OwnedBytes::new(b"test_data_".to_vec());

        cache.put_slice(path, range, data);

        let result = cache.to_bytes();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(bytes.len() > FOOTER_VERSION_LEN + FOOTER_OFFSET_LEN);
    }

    #[test]
    fn test_footer_cache_from_bytes_empty() {
        let cache = FooterCache::new();
        let bytes = cache.to_bytes().unwrap();

        let reconstructed = FooterCache::from_bytes(OwnedBytes::new(bytes.to_vec()));
        assert!(reconstructed.is_ok());

        let reconstructed_cache = reconstructed.unwrap();
        assert_eq!(reconstructed_cache.file_num(), 0);
    }

    #[test]
    fn test_footer_cache_roundtrip_serialization() {
        let cache = FooterCache::new();
        let path1 = PathBuf::from("test1.term");
        let path2 = PathBuf::from("test2.idx");
        let range1 = 0..10;
        let range2 = 10..21;
        let data1 = OwnedBytes::new(b"test_data1".to_vec());
        let data2 = OwnedBytes::new(b"more_data23".to_vec());

        cache.put_slice(path1.clone(), range1.clone(), data1.clone());
        cache.put_slice(path2.clone(), range2.clone(), data2.clone());

        // Serialize
        let bytes = cache.to_bytes().unwrap();

        // Deserialize
        let reconstructed = FooterCache::from_bytes(OwnedBytes::new(bytes.to_vec())).unwrap();

        // Verify data
        assert_eq!(reconstructed.file_num(), 2);
        assert_eq!(
            reconstructed.get_slice(&path1, range1).unwrap().as_slice(),
            data1.as_slice()
        );
        assert_eq!(
            reconstructed.get_slice(&path2, range2).unwrap().as_slice(),
            data2.as_slice()
        );
    }

    #[test]
    fn test_footer_cache_from_bytes_invalid_size() {
        let invalid_bytes = OwnedBytes::new(vec![1, 2, 3]); // Too small
        let result = FooterCache::from_bytes(invalid_bytes);
        assert!(result.is_err());
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("Invalid footer cache size")
        );
    }

    #[test]
    fn test_footer_cache_from_bytes_invalid_version() {
        let cache = FooterCache::new();
        let mut bytes = cache.to_bytes().unwrap().to_vec();

        // Corrupt the version
        let version_start = bytes.len() - FOOTER_VERSION_LEN;
        bytes[version_start] = 99; // Invalid version

        let result = FooterCache::from_bytes(OwnedBytes::new(bytes));
        assert!(result.is_err());
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("Invalid footer version")
        );
    }

    #[test]
    fn test_footer_cache_from_bytes_invalid_offset() {
        let cache = FooterCache::new();
        let mut bytes = cache.to_bytes().unwrap().to_vec();

        // Set an offset that's too large
        let offset_start = bytes.len() - FOOTER_OFFSET_LEN - FOOTER_VERSION_LEN;
        let offset_end = bytes.len() - FOOTER_VERSION_LEN;
        let large_offset = (bytes.len() + 1000) as u64;
        bytes[offset_start..offset_end].copy_from_slice(&large_offset.to_le_bytes());

        let result = FooterCache::from_bytes(OwnedBytes::new(bytes));
        assert!(result.is_err());
        assert!(
            result
                .err()
                .unwrap()
                .to_string()
                .contains("Invalid footer offset")
        );
    }

    #[test]
    fn test_footer_cache_skips_empty_file_extensions() {
        let cache = FooterCache::new();

        // Add files with allowed and disallowed extensions
        let allowed_path = PathBuf::from("test.term");
        let disallowed_path1 = PathBuf::from("test.fieldnorm");
        let disallowed_path2 = PathBuf::from("test.store");

        let range = 0..10;
        let data = OwnedBytes::new(b"test_data_".to_vec());

        cache.put_slice(allowed_path, range.clone(), data.clone());
        cache.put_slice(disallowed_path1, range.clone(), data.clone());
        cache.put_slice(disallowed_path2, range, data);

        let bytes = cache.to_bytes().unwrap();
        let reconstructed = FooterCache::from_bytes(OwnedBytes::new(bytes.to_vec())).unwrap();

        // Only the allowed file should be in the serialized cache
        assert_eq!(reconstructed.file_num(), 1);
    }

    #[test]
    fn test_footer_cache_meta_new() {
        let meta = FooterCacheMeta::new();
        assert!(meta.files.is_empty());
    }

    #[test]
    fn test_footer_cache_meta_push() {
        let mut meta = FooterCacheMeta::new();
        let path = PathBuf::from("test.term");
        let range = Range { start: 0, end: 10 };

        meta.push(&path, 100, &range);

        assert_eq!(meta.files.len(), 1);
        let items = meta.files.get("test.term").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].offset, 100);
        assert_eq!(items[0].start, 0);
        assert_eq!(items[0].len, 10);
    }

    #[test]
    fn test_footer_cache_meta_multiple_items() {
        let mut meta = FooterCacheMeta::new();
        let path = PathBuf::from("test.term");
        let range1 = Range { start: 0, end: 10 };
        let range2 = Range { start: 20, end: 30 };

        meta.push(&path, 100, &range1);
        meta.push(&path, 200, &range2);

        let items = meta.files.get("test.term").unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].offset, 100);
        assert_eq!(items[1].offset, 200);
    }

    #[test]
    fn test_build_footer_cache_empty_directory() {
        // Create an empty index
        let schema = Schema::builder().build();
        let ram_directory = RamDirectory::create();
        let index_writer: SingleSegmentIndexWriter<TantivyDocument> = IndexBuilder::new()
            .schema(schema.clone())
            .single_segment_index_writer(ram_directory.clone(), 50_000_000)
            .unwrap();
        index_writer.finalize().unwrap();

        let result = build_footer_cache(ram_directory.into());
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_build_footer_cache_with_data() {
        // Create an index with some data
        let mut schema_builder = Schema::builder();
        let text_field = schema_builder.add_text_field("text", TEXT | STORED);
        let schema = schema_builder.build();

        let ram_directory = RamDirectory::create();
        let mut index_writer = IndexBuilder::new()
            .schema(schema.clone())
            .single_segment_index_writer(ram_directory.clone(), 50_000_000)
            .unwrap();

        // Add some documents
        index_writer
            .add_document(doc!(text_field => "hello world"))
            .unwrap();
        index_writer
            .add_document(doc!(text_field => "test document"))
            .unwrap();
        index_writer.finalize().unwrap();

        let result = build_footer_cache(ram_directory.into());
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());

        // The cache should contain data from reading the index
        assert!(bytes.len() > 100); // Should have meaningful content
    }

    #[test]
    fn test_footer_cache_item_serialization() {
        let item = FooterCacheMetaItem {
            offset: 100,
            start: 50,
            len: 25,
        };

        let serialized = serde_json::to_string(&item).unwrap();
        let deserialized: FooterCacheMetaItem = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.offset, 100);
        assert_eq!(deserialized.start, 50);
        assert_eq!(deserialized.len, 25);
    }

    #[test]
    fn test_footer_cache_concurrent_access() {
        use std::thread;

        let cache = Arc::new(FooterCache::new());
        let mut handles = vec![];

        // Spawn multiple threads to test concurrent access
        for i in 0..10 {
            let cache_clone = cache.clone();
            let handle = thread::spawn(move || {
                let path = PathBuf::from(format!("file_{i}.term"));
                let range = 0..10;
                let data = OwnedBytes::new(format!("data_{i:04}").into_bytes());

                cache_clone.put_slice(path.clone(), range.clone(), data.clone());
                let retrieved = cache_clone.get_slice(&path, range);
                assert!(retrieved.is_some());
                assert_eq!(retrieved.unwrap().as_slice(), data.as_slice());
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(cache.file_num(), 10);
    }

    #[tokio::test]
    async fn test_footer_cache_from_directory_nonexistent() {
        let ram_directory = Arc::new(RamDirectory::create());

        let result = FooterCache::from_directory(ram_directory).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_footer_cache_from_directory_success() {
        let ram_directory = Arc::new(RamDirectory::create());

        // Create and write a footer cache
        let cache = FooterCache::new();
        let path = PathBuf::from("test.term");
        let range = 0..10;
        let data = OwnedBytes::new(b"test_data_".to_vec());
        cache.put_slice(path, range, data);

        let cache_bytes = cache.to_bytes().unwrap();
        ram_directory
            .atomic_write(std::path::Path::new(FOOTER_CACHE), &cache_bytes)
            .unwrap();

        let result = FooterCache::from_directory(ram_directory).await;
        assert!(result.is_ok());

        let loaded_cache = result.unwrap();
        assert_eq!(loaded_cache.file_num(), 1);
    }
}
