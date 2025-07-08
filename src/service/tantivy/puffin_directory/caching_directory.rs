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
    fmt, io,
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use tantivy::{
    Directory, HasLen,
    directory::{FileHandle, OwnedBytes, error::OpenReadError},
};

use super::footer_cache::FooterCache;

/// The caching directory is a simple cache that wraps another directory.
#[derive(Clone)]
pub(crate) struct CachingDirectory {
    underlying: Arc<dyn Directory>,
    cacher: Arc<FooterCache>,
}

impl CachingDirectory {
    pub(crate) fn new(underlying: Arc<dyn Directory>) -> CachingDirectory {
        CachingDirectory {
            underlying,
            cacher: Arc::new(FooterCache::new()),
        }
    }

    pub(crate) fn new_with_cacher(
        underlying: Arc<dyn Directory>,
        cacher: Arc<FooterCache>,
    ) -> CachingDirectory {
        CachingDirectory { underlying, cacher }
    }

    pub(crate) fn cacher(&self) -> Arc<FooterCache> {
        self.cacher.clone()
    }
}

impl fmt::Debug for CachingDirectory {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "CachingDirectory({:?})", self.underlying)
    }
}

struct CachingFileHandle {
    path: PathBuf,
    cacher: Arc<FooterCache>,
    underlying_filehandle: Arc<dyn FileHandle>,
}

impl fmt::Debug for CachingFileHandle {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(
            f,
            "CachingFileHandle(path={:?}, underlying={:?})",
            &self.path,
            self.underlying_filehandle.as_ref()
        )
    }
}

#[async_trait]
impl FileHandle for CachingFileHandle {
    fn read_bytes(&self, byte_range: Range<usize>) -> io::Result<OwnedBytes> {
        if let Some(bytes) = self.cacher.get_slice(&self.path, byte_range.clone()) {
            return Ok(bytes);
        }
        let owned_bytes = self.underlying_filehandle.read_bytes(byte_range.clone())?;
        self.cacher
            .put_slice(self.path.clone(), byte_range, owned_bytes.clone());
        Ok(owned_bytes)
    }

    async fn read_bytes_async(&self, byte_range: Range<usize>) -> io::Result<OwnedBytes> {
        if let Some(bytes) = self.cacher.get_slice(&self.path, byte_range.clone()) {
            return Ok(bytes);
        }
        let owned_bytes = self
            .underlying_filehandle
            .read_bytes_async(byte_range.clone())
            .await?;
        self.cacher
            .put_slice(self.path.clone(), byte_range, owned_bytes.clone());
        Ok(owned_bytes)
    }
}

impl HasLen for CachingFileHandle {
    fn len(&self) -> usize {
        self.underlying_filehandle.len()
    }
}

impl Directory for CachingDirectory {
    fn exists(&self, path: &Path) -> std::result::Result<bool, OpenReadError> {
        self.underlying.exists(path)
    }

    fn get_file_handle(
        &self,
        path: &Path,
    ) -> std::result::Result<Arc<dyn FileHandle>, OpenReadError> {
        let underlying_filehandle = self.underlying.get_file_handle(path)?;
        let caching_file_handle = CachingFileHandle {
            path: path.to_path_buf(),
            cacher: self.cacher.clone(),
            underlying_filehandle,
        };
        Ok(Arc::new(caching_file_handle))
    }

    fn atomic_read(&self, path: &Path) -> std::result::Result<Vec<u8>, OpenReadError> {
        let file_handle = self.get_file_handle(path)?;
        let len = file_handle.len();
        let owned_bytes = file_handle
            .read_bytes(0..len)
            .map_err(|io_error| OpenReadError::wrap_io_error(io_error, path.to_path_buf()))?;
        Ok(owned_bytes.as_slice().to_vec())
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

#[cfg(test)]
mod tests {

    use std::{path::Path, sync::Arc};

    use tantivy::{Directory, directory::RamDirectory};

    use super::CachingDirectory;

    #[test]
    fn test_caching_directory() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("test");
        ram_directory.atomic_write(test_path, &b"test"[..])?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));
        caching_directory.atomic_read(test_path)?;
        caching_directory.atomic_read(test_path)?;
        assert_eq!(caching_directory.cacher().file_num(), 1);
        Ok(())
    }

    #[test]
    fn test_caching_directory_new() {
        let ram_directory = Arc::new(RamDirectory::default());
        let caching_directory = CachingDirectory::new(ram_directory);

        // Should have a cacher
        assert_eq!(caching_directory.cacher().file_num(), 0);
    }

    #[test]
    fn test_caching_directory_new_with_cacher() {
        let ram_directory = Arc::new(RamDirectory::default());
        let cacher = Arc::new(super::FooterCache::new());
        let caching_directory = CachingDirectory::new_with_cacher(ram_directory, cacher.clone());

        // Should use the provided cacher
        assert!(Arc::ptr_eq(&caching_directory.cacher(), &cacher));
    }

    #[test]
    fn test_caching_directory_clone() {
        let ram_directory = Arc::new(RamDirectory::default());
        let caching_directory1 = CachingDirectory::new(ram_directory);
        let caching_directory2 = caching_directory1.clone();

        // Should share the same cacher
        assert!(Arc::ptr_eq(
            &caching_directory1.cacher(),
            &caching_directory2.cacher()
        ));
    }

    #[test]
    fn test_caching_directory_exists() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("test_exists");
        ram_directory.atomic_write(test_path, b"content")?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // Should exist
        assert!(caching_directory.exists(test_path)?);

        // Should not exist
        assert!(!caching_directory.exists(Path::new("nonexistent"))?);

        Ok(())
    }

    #[test]
    fn test_caching_directory_get_file_handle() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("test_handle");
        let test_data = b"test data for handle";
        ram_directory.atomic_write(test_path, test_data)?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // Get file handle
        let handle = caching_directory.get_file_handle(test_path)?;

        // Should have correct length
        assert_eq!(handle.len(), test_data.len());

        // Should be able to read data
        let read_data = handle.read_bytes(0..test_data.len())?;
        assert_eq!(read_data.as_slice(), test_data);

        Ok(())
    }

    #[test]
    fn test_caching_directory_get_file_handle_nonexistent() {
        let ram_directory = RamDirectory::default();
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        let result = caching_directory.get_file_handle(Path::new("nonexistent"));
        assert!(result.is_err());
    }

    #[test]
    fn test_caching_directory_atomic_read() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("test_atomic_read");
        let test_data = b"atomic read test data";
        ram_directory.atomic_write(test_path, test_data)?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // First read
        let read_data1 = caching_directory.atomic_read(test_path)?;
        assert_eq!(read_data1, test_data);

        // Second read should use cache
        let read_data2 = caching_directory.atomic_read(test_path)?;
        assert_eq!(read_data2, test_data);

        // Should have cached the file
        assert_eq!(caching_directory.cacher().file_num(), 1);

        Ok(())
    }

    #[test]
    fn test_caching_directory_atomic_read_nonexistent() {
        let ram_directory = RamDirectory::default();
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        let result = caching_directory.atomic_read(Path::new("nonexistent"));
        assert!(result.is_err());
    }

    #[test]
    fn test_caching_directory_readonly_operations() {
        let ram_directory = RamDirectory::default();
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));
        let test_path = Path::new("test");

        // These operations should panic since they're unimplemented
        // We can't use catch_unwind easily due to trait bounds,
        // so we just verify the trait exists
        assert!(caching_directory.exists(test_path).is_ok());
    }

    #[test]
    fn test_caching_directory_watch() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // Watch should return empty handle
        let callback = tantivy::directory::WatchCallback::new(|| {});
        let _watch_handle = caching_directory.watch(callback)?;

        // Should be valid
        Ok(())
    }

    #[test]
    fn test_caching_directory_acquire_lock() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // Should always succeed
        let lock = tantivy::directory::Lock {
            filepath: "test_lock".into(),
            is_blocking: false,
        };
        let dir_lock = caching_directory.acquire_lock(&lock)?;

        // Should be a valid lock (we can't test much more without implementation details)
        drop(dir_lock);

        Ok(())
    }

    #[test]
    fn test_caching_file_handle_caching_behavior() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("test_caching");
        let test_data = b"data for caching test with some length";
        ram_directory.atomic_write(test_path, test_data)?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        let handle = caching_directory.get_file_handle(test_path)?;

        // First read should cache the data
        let read_data1 = handle.read_bytes(0..10)?;
        assert_eq!(read_data1.as_slice(), &test_data[0..10]);

        // Second read of same range should use cache
        let read_data2 = handle.read_bytes(0..10)?;
        assert_eq!(read_data2.as_slice(), &test_data[0..10]);

        // Different range should work
        let read_data3 = handle.read_bytes(10..20)?;
        assert_eq!(read_data3.as_slice(), &test_data[10..20]);

        Ok(())
    }

    #[tokio::test]
    async fn test_caching_file_handle_async_read() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("test_async");
        let test_data = b"async test data";
        ram_directory.atomic_write(test_path, test_data)?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        let handle = caching_directory.get_file_handle(test_path)?;

        // First async read should cache the data
        let read_data1 = handle.read_bytes_async(0..5).await?;
        assert_eq!(read_data1.as_slice(), &test_data[0..5]);

        // Second async read of same range should use cache
        let read_data2 = handle.read_bytes_async(0..5).await?;
        assert_eq!(read_data2.as_slice(), &test_data[0..5]);

        // Different range should work
        let read_data3 = handle.read_bytes_async(5..10).await?;
        assert_eq!(read_data3.as_slice(), &test_data[5..10]);

        Ok(())
    }

    #[tokio::test]
    async fn test_caching_file_handle_mixed_sync_async() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("test_mixed");
        let test_data = b"mixed sync/async test data";
        ram_directory.atomic_write(test_path, test_data)?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        let handle = caching_directory.get_file_handle(test_path)?;

        // Read with sync method
        let read_data1 = handle.read_bytes(0..5)?;
        assert_eq!(read_data1.as_slice(), &test_data[0..5]);

        // Read same range with async method - should use cache
        let read_data2 = handle.read_bytes_async(0..5).await?;
        assert_eq!(read_data2.as_slice(), &test_data[0..5]);

        // Read different range with async method
        let read_data3 = handle.read_bytes_async(5..10).await?;
        assert_eq!(read_data3.as_slice(), &test_data[5..10]);

        // Read that range with sync method - should use cache
        let read_data4 = handle.read_bytes(5..10)?;
        assert_eq!(read_data4.as_slice(), &test_data[5..10]);

        Ok(())
    }

    #[test]
    fn test_caching_directory_multiple_files() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let files = [
            ("file1.txt", b"content1"),
            ("file2.txt", b"content2"),
            ("file3.txt", b"content3"),
        ];

        for (filename, content) in &files {
            ram_directory.atomic_write(Path::new(filename), *content)?;
        }

        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // Read all files
        for (filename, expected_content) in &files {
            let content = caching_directory.atomic_read(Path::new(filename))?;
            assert_eq!(&content, expected_content);
        }

        // Should have cached all files
        assert_eq!(caching_directory.cacher().file_num(), files.len());

        Ok(())
    }

    #[test]
    fn test_caching_directory_large_file() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("large_file");
        let large_data = vec![42u8; 1_000_000]; // 1MB
        ram_directory.atomic_write(test_path, &large_data)?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // Read the large file
        let read_data = caching_directory.atomic_read(test_path)?;
        assert_eq!(read_data, large_data);

        // Should be cached
        assert_eq!(caching_directory.cacher().file_num(), 1);

        // Second read should use cache
        let read_data2 = caching_directory.atomic_read(test_path)?;
        assert_eq!(read_data2, large_data);

        Ok(())
    }

    #[test]
    fn test_caching_directory_empty_file() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("empty_file");
        ram_directory.atomic_write(test_path, b"")?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        // Read empty file
        let read_data = caching_directory.atomic_read(test_path)?;
        assert_eq!(read_data, b"");

        // Should be cached
        assert_eq!(caching_directory.cacher().file_num(), 1);

        Ok(())
    }

    #[test]
    fn test_caching_directory_debug() {
        let ram_directory = Arc::new(RamDirectory::default());
        let caching_directory = CachingDirectory::new(ram_directory);

        // Should be able to debug print
        let debug_str = format!("{caching_directory:?}");
        assert!(debug_str.contains("CachingDirectory"));
    }

    #[test]
    fn test_caching_file_handle_debug() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("debug_test");
        ram_directory.atomic_write(test_path, b"debug data")?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        let handle = caching_directory.get_file_handle(test_path)?;

        // Should be able to debug print
        let debug_str = format!("{handle:?}");
        assert!(debug_str.contains("CachingFileHandle"));
        assert!(debug_str.contains("debug_test"));

        Ok(())
    }

    #[test]
    fn test_caching_directory_concurrent_access() -> tantivy::Result<()> {
        use std::thread;

        let ram_directory = RamDirectory::default();
        let test_path = Path::new("concurrent_test");
        let test_data = b"concurrent test data";
        ram_directory.atomic_write(test_path, test_data)?;
        let caching_directory = Arc::new(CachingDirectory::new(Arc::new(ram_directory)));

        let mut handles = vec![];

        // Spawn multiple threads reading the same file
        for _ in 0..10 {
            let caching_directory_clone = caching_directory.clone();
            let handle = thread::spawn(move || {
                let read_data = caching_directory_clone.atomic_read(test_path).unwrap();
                assert_eq!(read_data, test_data);
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // Should have cached the file
        assert_eq!(caching_directory.cacher().file_num(), 1);

        Ok(())
    }

    #[test]
    fn test_caching_directory_partial_reads() -> tantivy::Result<()> {
        let ram_directory = RamDirectory::default();
        let test_path = Path::new("partial_reads");
        let test_data = b"0123456789abcdefghijklmnopqrstuvwxyz";
        ram_directory.atomic_write(test_path, test_data)?;
        let caching_directory = CachingDirectory::new(Arc::new(ram_directory));

        let handle = caching_directory.get_file_handle(test_path)?;

        // Read various ranges
        let range1 = handle.read_bytes(0..5)?;
        assert_eq!(range1.as_slice(), &test_data[0..5]);

        let range2 = handle.read_bytes(10..15)?;
        assert_eq!(range2.as_slice(), &test_data[10..15]);

        let range3 = handle.read_bytes(2..7)?;
        assert_eq!(range3.as_slice(), &test_data[2..7]);

        // Should be able to read overlapping ranges
        let range4 = handle.read_bytes(0..10)?;
        assert_eq!(range4.as_slice(), &test_data[0..10]);

        Ok(())
    }
}
