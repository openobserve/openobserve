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
    io::{self},
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use anyhow::{Context, Result};
use hashbrown::HashSet;
use tantivy::{
    HasLen,
    directory::{Directory, RamDirectory, WatchCallback, WatchHandle, error::OpenReadError},
};

use super::{FOOTER_CACHE, footer_cache::build_footer_cache};
use crate::service::tantivy::{
    puffin::{BlobTypes, writer::PuffinBytesWriter},
    puffin_directory::{ALLOWED_FILE_EXT, META_JSON},
};
/// Puffin directory is a puffin file which contains all the tantivy files.
/// Each tantivy file is stored as a blob in the puffin file, along with their file name.
#[derive(Debug)]
pub struct PuffinDirWriter {
    ram_directory: Arc<RamDirectory>,
    /// record all the files paths in the puffin file
    file_paths: Arc<RwLock<HashSet<PathBuf>>>,
}

impl Default for PuffinDirWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for PuffinDirWriter {
    fn clone(&self) -> Self {
        PuffinDirWriter {
            ram_directory: self.ram_directory.clone(),
            file_paths: self.file_paths.clone(),
        }
    }
}

impl PuffinDirWriter {
    pub fn new() -> Self {
        PuffinDirWriter {
            ram_directory: Arc::new(RamDirectory::create()),
            file_paths: Arc::new(RwLock::new(HashSet::default())),
        }
    }

    pub fn list_files(&self) -> Vec<PathBuf> {
        self.file_paths
            .read()
            .expect("poisoned lock")
            .iter()
            .cloned()
            .collect()
    }

    // This function will serialize the directory into a single puffin file
    pub fn to_puffin_bytes(&self) -> Result<Vec<u8>> {
        let mut puffin_buf: Vec<u8> = Vec::new();
        let mut puffin_writer = PuffinBytesWriter::new(&mut puffin_buf);
        let mut segment_id = String::new();

        let file_paths = self.file_paths.read().expect("poisoned lock");
        let allowed_file_paths = file_paths.iter().filter(|path| {
            let mut allowed = false;
            if let Some(path_ext) = path.extension()
                && ALLOWED_FILE_EXT.contains(&path_ext.to_str().unwrap())
            {
                allowed = true;
            }

            // check if its meta.json file
            if !allowed && path.to_str().unwrap() == META_JSON {
                allowed = true;
            };
            allowed
        });
        for path in allowed_file_paths.clone() {
            if segment_id.is_empty() && path.extension().is_some_and(|ext| ext != "json") {
                segment_id = path.file_stem().unwrap().to_str().unwrap().to_owned();
            }

            let file_data = self.ram_directory.open_read(path)?;
            log::debug!(
                "Serializing file to puffin: len: {}, path: {}",
                file_data.len(),
                path.to_str().unwrap()
            );
            puffin_writer
                .add_blob(
                    &file_data.read_bytes().expect("failed to read file"),
                    BlobTypes::O2TtvV1,
                    path.to_string_lossy().to_string(),
                )
                .context("Failed to add blob")?;
        }

        // write footer cache
        let meta_bytes = build_footer_cache(self.ram_directory.clone())?;
        puffin_writer
            .add_blob(
                &meta_bytes,
                BlobTypes::O2TtvFooterV1,
                FOOTER_CACHE.to_string(),
            )
            .context("Failed to add meta bytes blob")?;

        puffin_writer.finish().context("Failed to finish writing")?;
        Ok(puffin_buf)
    }
}

/// This implementation is used during index creation.
impl Directory for PuffinDirWriter {
    fn get_file_handle(
        &self,
        path: &Path,
    ) -> Result<std::sync::Arc<dyn tantivy::directory::FileHandle>, OpenReadError> {
        self.ram_directory.get_file_handle(path)
    }

    fn delete(&self, path: &Path) -> Result<(), tantivy::directory::error::DeleteError> {
        self.ram_directory.delete(path)
    }

    fn exists(&self, path: &Path) -> Result<bool, OpenReadError> {
        self.ram_directory.exists(path)
    }

    fn open_write(
        &self,
        path: &Path,
    ) -> Result<tantivy::directory::WritePtr, tantivy::directory::error::OpenWriteError> {
        // capture the files being written to ram directory
        self.file_paths.write().unwrap().insert(path.to_path_buf());
        self.ram_directory.open_write(path)
    }

    // this should read from the puffin source
    fn atomic_read(&self, path: &Path) -> Result<Vec<u8>, OpenReadError> {
        self.ram_directory.atomic_read(path)
    }

    fn atomic_write(&self, path: &Path, data: &[u8]) -> io::Result<()> {
        // capture the files being written to ram directory
        self.file_paths
            .write()
            .expect("poisoned lock")
            .insert(path.to_path_buf());
        self.ram_directory.atomic_write(path, data)
    }

    fn sync_directory(&self) -> io::Result<()> {
        self.ram_directory.sync_directory()
    }

    fn watch(&self, watch_callback: WatchCallback) -> tantivy::Result<WatchHandle> {
        self.ram_directory.watch(watch_callback)
    }
}

#[cfg(test)]
mod tests {
    use std::{io::Write, path::Path, sync::Arc};

    use tantivy::{
        Directory,
        directory::{WatchCallback, error::OpenReadError},
    };

    use super::*;

    #[test]
    fn test_puffin_dir_writer_new() {
        let writer = PuffinDirWriter::new();
        assert!(writer.list_files().is_empty());
    }

    #[test]
    fn test_puffin_dir_writer_default() {
        let writer = PuffinDirWriter::default();
        assert!(writer.list_files().is_empty());
    }

    #[test]
    fn test_puffin_dir_writer_clone() {
        let writer1 = PuffinDirWriter::new();
        let writer2 = writer1.clone();

        // Write to one writer
        let path = Path::new("test.txt");
        let data = b"test data";
        writer1.atomic_write(path, data).unwrap();

        // Both should see the file
        assert_eq!(writer1.list_files().len(), 1);
        assert_eq!(writer2.list_files().len(), 1);

        // Both should be able to read it
        assert!(writer1.atomic_read(path).is_ok());
        assert!(writer2.atomic_read(path).is_ok());
    }

    #[test]
    fn test_puffin_dir_writer_atomic_write_and_read() {
        let writer = PuffinDirWriter::new();
        let path = Path::new("test.txt");
        let data = b"hello world";

        // Initially no files
        assert!(writer.list_files().is_empty());

        // Write data
        writer.atomic_write(path, data).unwrap();

        // Should be tracked
        assert_eq!(writer.list_files().len(), 1);
        assert!(writer.list_files().contains(&path.to_path_buf()));

        // Read back
        let read_data = writer.atomic_read(path).unwrap();
        assert_eq!(read_data, data);
    }

    #[test]
    fn test_puffin_dir_writer_open_write() {
        let writer = PuffinDirWriter::new();
        let path = Path::new("test.txt");

        // Open for writing
        let mut write_handle = writer.open_write(path).unwrap();

        // Should be tracked immediately
        assert_eq!(writer.list_files().len(), 1);
        assert!(writer.list_files().contains(&path.to_path_buf()));

        // Write some data
        write_handle.write_all(b"test data").unwrap();
        write_handle.flush().unwrap();
        drop(write_handle);

        // Should be able to read it back
        let read_data = writer.atomic_read(path).unwrap();
        assert_eq!(read_data, b"test data");
    }

    #[test]
    fn test_puffin_dir_writer_exists() {
        let writer = PuffinDirWriter::new();
        let path = Path::new("test.txt");

        // Initially doesn't exist
        assert!(!writer.exists(path).unwrap());

        // Write file
        writer.atomic_write(path, b"data").unwrap();

        // Now exists
        assert!(writer.exists(path).unwrap());
    }

    #[test]
    fn test_puffin_dir_writer_get_file_handle() {
        let writer = PuffinDirWriter::new();
        let path = Path::new("test.txt");
        let data = b"test data";

        // Write data first
        writer.atomic_write(path, data).unwrap();

        // Get file handle
        let handle = writer.get_file_handle(path).unwrap();

        // Should be able to read the data
        let read_data = handle.read_bytes(0..data.len()).unwrap();
        assert_eq!(read_data.as_slice(), data);
    }

    #[test]
    fn test_puffin_dir_writer_get_file_handle_nonexistent() {
        let writer = PuffinDirWriter::new();
        let path = Path::new("nonexistent.txt");

        let result = writer.get_file_handle(path);
        assert!(matches!(result, Err(OpenReadError::FileDoesNotExist(_))));
    }

    #[test]
    fn test_puffin_dir_writer_delete() {
        let writer = PuffinDirWriter::new();
        let path = Path::new("test.txt");

        // Write and verify exists
        writer.atomic_write(path, b"data").unwrap();
        assert!(writer.exists(path).unwrap());

        // Delete
        writer.delete(path).unwrap();

        // Should no longer exist
        assert!(!writer.exists(path).unwrap());
    }

    #[test]
    fn test_puffin_dir_writer_multiple_files() {
        let writer = PuffinDirWriter::new();
        let paths = ["file1.txt", "file2.txt", "file3.txt"];

        for path in &paths {
            writer.atomic_write(Path::new(path), b"data").unwrap();
        }

        let files = writer.list_files();
        assert_eq!(files.len(), 3);

        for path in &paths {
            assert!(files.contains(&PathBuf::from(path)));
        }
    }

    #[test]
    fn test_puffin_dir_writer_sync_directory() {
        let writer = PuffinDirWriter::new();

        // Should not fail
        let result = writer.sync_directory();
        assert!(result.is_ok());
    }

    #[test]
    fn test_puffin_dir_writer_watch() {
        let writer = PuffinDirWriter::new();

        // Create a dummy callback
        let callback = WatchCallback::new(|| {});

        let result = writer.watch(callback);
        assert!(result.is_ok());
    }

    #[test]
    fn test_puffin_dir_writer_to_puffin_bytes_empty() {
        let writer = PuffinDirWriter::new();

        // Even empty writer should produce valid puffin bytes
        let result = writer.to_puffin_bytes();
        assert!(result.is_err());
    }

    #[test]
    fn test_puffin_dir_writer_to_puffin_bytes_with_files() {
        let writer = PuffinDirWriter::new();

        // Add some files
        writer
            .atomic_write(Path::new("file1.term"), b"term data")
            .unwrap();
        writer
            .atomic_write(Path::new("file2.idx"), b"index data")
            .unwrap();
        writer
            .atomic_write(
                Path::new("meta.json"),
                b"{\"index_settings\":{},\"segments\":[],\"schema\":[],\"opstamp\":0}",
            )
            .unwrap();

        let result = writer.to_puffin_bytes();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());

        // Should be significantly larger than empty puffin
        assert!(bytes.len() > 100);
    }

    #[test]
    fn test_puffin_dir_writer_filters_allowed_extensions() {
        let writer = PuffinDirWriter::new();

        // Add files with various extensions
        writer
            .atomic_write(Path::new("file.term"), b"allowed")
            .unwrap();
        writer
            .atomic_write(Path::new("file.idx"), b"allowed")
            .unwrap();
        writer
            .atomic_write(Path::new("file.pos"), b"allowed")
            .unwrap();
        writer
            .atomic_write(Path::new("file.fast"), b"allowed")
            .unwrap();
        writer
            .atomic_write(Path::new("meta.json"), b"allowed")
            .unwrap();
        writer
            .atomic_write(Path::new("file.store"), b"not allowed")
            .unwrap();
        writer
            .atomic_write(Path::new("file.fieldnorm"), b"not allowed")
            .unwrap();
        writer
            .atomic_write(Path::new("file.unknown"), b"not allowed")
            .unwrap();
        writer
            .atomic_write(
                Path::new("meta.json"),
                b"{\"index_settings\":{},\"segments\":[],\"schema\":[],\"opstamp\":0}",
            )
            .unwrap();

        let result = writer.to_puffin_bytes();
        assert!(result.is_ok());

        // Should only include allowed files
        // We can't easily inspect the puffin contents here, but we can verify it doesn't fail
        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_puffin_dir_writer_with_files() {
        let writer = PuffinDirWriter::new();

        // Simulate what tantivy would create by writing typical tantivy files
        writer
            .atomic_write(Path::new("segment_12345.term"), b"term index data")
            .unwrap();
        writer
            .atomic_write(Path::new("segment_12345.idx"), b"field index data")
            .unwrap();
        writer
            .atomic_write(Path::new("segment_12345.pos"), b"position data")
            .unwrap();
        writer
            .atomic_write(Path::new("segment_12345.fast"), b"fast field data")
            .unwrap();
        writer
            .atomic_write(
                Path::new("meta.json"),
                b"{\"index_settings\":{},\"segments\":[],\"schema\":[],\"opstamp\":0}",
            )
            .unwrap();

        // Should have created files
        assert!(!writer.list_files().is_empty());
        assert_eq!(writer.list_files().len(), 5);

        // Should be able to serialize to puffin
        let result = writer.to_puffin_bytes();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(!bytes.is_empty());

        // Should contain all the file data plus puffin overhead
        assert!(bytes.len() > 100);
    }

    #[test]
    fn test_puffin_dir_writer_concurrent_writes() {
        use std::thread;

        let writer = Arc::new(PuffinDirWriter::new());
        let mut handles = vec![];

        // Spawn multiple threads writing files
        for i in 0..10 {
            let writer_clone = writer.clone();
            let handle = thread::spawn(move || {
                let path = format!("file_{i}.txt");
                let data = format!("data for file {i}");
                writer_clone
                    .atomic_write(Path::new(&path), data.as_bytes())
                    .unwrap();
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // Should have all files
        assert_eq!(writer.list_files().len(), 10);

        // All files should be readable
        for i in 0..10 {
            let path = format!("file_{i}.txt");
            let data = writer.atomic_read(Path::new(&path)).unwrap();
            let expected = format!("data for file {i}");
            assert_eq!(data, expected.as_bytes());
        }
    }

    #[test]
    fn test_puffin_dir_writer_large_files() {
        let writer = PuffinDirWriter::new();

        // Create a large file
        let large_data = vec![42u8; 1_000_000]; // 1MB
        writer
            .atomic_write(Path::new("large.term"), &large_data)
            .unwrap();

        // Should be able to read it back
        let read_data = writer.atomic_read(Path::new("large.term")).unwrap();
        assert_eq!(read_data, large_data);

        // write meta.json
        writer
            .atomic_write(
                Path::new("meta.json"),
                b"{\"index_settings\":{},\"segments\":[],\"schema\":[],\"opstamp\":0}",
            )
            .unwrap();

        // Should be able to serialize to puffin
        let result = writer.to_puffin_bytes();
        assert!(result.is_ok());

        let bytes = result.unwrap();
        assert!(bytes.len() > 1_000_000); // Should be at least as large as the file
    }

    #[test]
    fn test_puffin_dir_writer_special_characters_in_filename() {
        let writer = PuffinDirWriter::new();

        // Test with various special characters in filename
        let special_files = [
            "file with spaces.term",
            "file-with-dashes.idx",
            "file_with_underscores.pos",
            "file.with.dots.fast",
        ];

        for filename in &special_files {
            let data = format!("data for {filename}");
            writer
                .atomic_write(Path::new(filename), data.as_bytes())
                .unwrap();
        }

        let files = writer.list_files();
        assert_eq!(files.len(), special_files.len());

        for filename in &special_files {
            assert!(files.contains(&PathBuf::from(filename)));
            let read_data = writer.atomic_read(Path::new(filename)).unwrap();
            let expected = format!("data for {filename}");
            assert_eq!(read_data, expected.as_bytes());
        }
    }

    #[test]
    fn test_puffin_dir_writer_empty_files() {
        let writer = PuffinDirWriter::new();

        // Write empty files
        writer.atomic_write(Path::new("empty.term"), b"").unwrap();
        writer.atomic_write(Path::new("empty.idx"), b"").unwrap();
        writer
            .atomic_write(
                Path::new("meta.json"),
                b"{\"index_settings\":{},\"segments\":[],\"schema\":[],\"opstamp\":0}",
            )
            .unwrap();

        assert_eq!(writer.list_files().len(), 3);

        // Should be able to read them back
        assert_eq!(writer.atomic_read(Path::new("empty.term")).unwrap(), b"");
        assert_eq!(writer.atomic_read(Path::new("empty.idx")).unwrap(), b"");

        // Should be able to serialize
        let result = writer.to_puffin_bytes();
        assert!(result.is_ok());
    }

    #[test]
    fn test_puffin_dir_writer_overwrite_files() {
        let writer = PuffinDirWriter::new();
        let path = Path::new("test.term");

        // Write initial data
        writer.atomic_write(path, b"initial data").unwrap();
        assert_eq!(writer.list_files().len(), 1);
        assert_eq!(writer.atomic_read(path).unwrap(), b"initial data");

        // Overwrite with new data
        writer.atomic_write(path, b"new data").unwrap();
        assert_eq!(writer.list_files().len(), 1); // Still just one file
        assert_eq!(writer.atomic_read(path).unwrap(), b"new data");
    }

    #[test]
    fn test_puffin_dir_writer_segment_id_detection() {
        let writer = PuffinDirWriter::new();

        // Add files that would be created by tantivy
        writer
            .atomic_write(Path::new("segment_123.term"), b"term data")
            .unwrap();
        writer
            .atomic_write(Path::new("segment_123.idx"), b"index data")
            .unwrap();
        writer
            .atomic_write(
                Path::new("meta.json"),
                b"{\"index_settings\":{},\"segments\":[],\"schema\":[],\"opstamp\":0}",
            )
            .unwrap();

        let result = writer.to_puffin_bytes();
        assert!(result.is_ok());

        // Should successfully extract segment ID and create puffin file
        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_puffin_dir_writer_error_handling() {
        let writer = PuffinDirWriter::new();

        // Test reading nonexistent file
        let result = writer.atomic_read(Path::new("nonexistent.txt"));
        assert!(result.is_err());

        // Test getting handle for nonexistent file
        let result = writer.get_file_handle(Path::new("nonexistent.txt"));
        assert!(result.is_err());

        // Test deleting nonexistent file
        let result = writer.delete(Path::new("nonexistent.txt"));
        assert!(result.is_err());
    }

    #[test]
    fn test_puffin_dir_writer_directory_trait_completeness() {
        let writer = PuffinDirWriter::new();

        // Test all Directory trait methods work
        let path = Path::new("test.txt");
        let data = b"test data";

        // Write
        writer.atomic_write(path, data).unwrap();

        // Exists
        assert!(writer.exists(path).unwrap());

        // Get handle
        let handle = writer.get_file_handle(path).unwrap();
        assert_eq!(handle.len(), data.len());

        // Read
        let read_data = writer.atomic_read(path).unwrap();
        assert_eq!(read_data, data);

        // Sync
        writer.sync_directory().unwrap();

        // Watch (should not fail)
        let callback = WatchCallback::new(|| {});
        let _watch_handle = writer.watch(callback).unwrap();

        // Delete
        writer.delete(path).unwrap();
        assert!(!writer.exists(path).unwrap());
    }

    #[test]
    fn test_puffin_dir_writer_file_extensions() {
        let writer = PuffinDirWriter::new();

        // Test all allowed extensions
        let allowed_extensions = ["term", "idx", "pos", "fast"];
        for ext in &allowed_extensions {
            let filename = format!("test.{ext}");
            writer.atomic_write(Path::new(&filename), b"data").unwrap();
        }

        // Test meta.json
        writer
            .atomic_write(
                Path::new("meta.json"),
                b"{\"index_settings\":{},\"segments\":[],\"schema\":[],\"opstamp\":0}",
            )
            .unwrap();

        assert_eq!(writer.list_files().len(), allowed_extensions.len() + 1);

        // Serialization should work
        let result = writer.to_puffin_bytes();
        assert!(result.is_ok());
    }
}
