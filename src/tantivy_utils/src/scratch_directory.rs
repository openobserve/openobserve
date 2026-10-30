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

use std::{
    fs::{File, OpenOptions},
    io::{self, BufWriter, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

use tantivy::directory::{
    AntiCallToken, Directory, DirectoryLock, FileHandle, Lock, MmapDirectory, TerminatingWrite,
    WatchCallback, WatchHandle, WritePtr,
    error::{DeleteError, LockError, OpenDirectoryError, OpenReadError, OpenWriteError},
};
use tempfile::TempDir;

/// Temp-dir `MmapDirectory` without fsync: its files are scratch, and fsync stalls all disk writes.
#[derive(Clone, Debug)]
pub struct ScratchDirectory {
    inner: MmapDirectory,
    root: Arc<TempDir>,
}

impl ScratchDirectory {
    pub fn new() -> Result<Self, OpenDirectoryError> {
        let root =
            TempDir::new().map_err(|e| OpenDirectoryError::FailedToCreateTempDir(Arc::new(e)))?;
        let inner = MmapDirectory::open(root.path())?;
        Ok(Self {
            inner,
            root: Arc::new(root),
        })
    }

    fn resolve_path(&self, path: &Path) -> PathBuf {
        self.root.path().join(path)
    }
}

impl Directory for ScratchDirectory {
    fn get_file_handle(&self, path: &Path) -> Result<Arc<dyn FileHandle>, OpenReadError> {
        self.inner.get_file_handle(path)
    }

    fn delete(&self, path: &Path) -> Result<(), DeleteError> {
        self.inner.delete(path)
    }

    fn exists(&self, path: &Path) -> Result<bool, OpenReadError> {
        self.inner.exists(path)
    }

    fn open_write(&self, path: &Path) -> Result<WritePtr, OpenWriteError> {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.resolve_path(path))
            .map_err(|e| {
                if e.kind() == io::ErrorKind::AlreadyExists {
                    OpenWriteError::FileAlreadyExists(path.to_path_buf())
                } else {
                    OpenWriteError::wrap_io_error(e, path.to_path_buf())
                }
            })?;
        Ok(BufWriter::new(Box::new(NoSyncFileWriter(file))))
    }

    fn atomic_read(&self, path: &Path) -> Result<Vec<u8>, OpenReadError> {
        self.inner.atomic_read(path)
    }

    fn atomic_write(&self, path: &Path, data: &[u8]) -> io::Result<()> {
        let full_path = self.resolve_path(path);
        let mut tmp_path = full_path.clone().into_os_string();
        tmp_path.push(".tmp");
        std::fs::write(&tmp_path, data)?;
        std::fs::rename(&tmp_path, &full_path)
    }

    fn acquire_lock(&self, lock: &Lock) -> Result<DirectoryLock, LockError> {
        self.inner.acquire_lock(lock)
    }

    fn sync_directory(&self) -> io::Result<()> {
        Ok(())
    }

    fn watch(&self, watch_callback: WatchCallback) -> tantivy::Result<WatchHandle> {
        self.inner.watch(watch_callback)
    }
}

struct NoSyncFileWriter(File);

impl Write for NoSyncFileWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

impl TerminatingWrite for NoSyncFileWriter {
    fn terminate_ref(&mut self, _: AntiCallToken) -> io::Result<()> {
        self.0.flush()
    }
}

#[cfg(test)]
mod tests {
    use tantivy::{
        Index, IndexWriter, TantivyDocument, doc,
        schema::{STORED, Schema, TEXT},
    };

    use super::*;

    #[test]
    fn test_scratch_directory_round_trip() {
        let dir = ScratchDirectory::new().unwrap();
        let path = Path::new("a.bin");
        let mut w = dir.open_write(path).unwrap();
        w.write_all(b"hello").unwrap();
        w.terminate().unwrap();
        assert!(dir.exists(path).unwrap());
        assert_eq!(
            dir.open_read(path)
                .unwrap()
                .read_bytes()
                .unwrap()
                .as_slice(),
            b"hello"
        );
        assert!(matches!(
            dir.open_write(path),
            Err(OpenWriteError::FileAlreadyExists(_))
        ));

        let meta = Path::new("meta.json");
        dir.atomic_write(meta, b"v1").unwrap();
        dir.atomic_write(meta, b"v2").unwrap();
        assert_eq!(dir.atomic_read(meta).unwrap(), b"v2");
    }

    #[test]
    fn test_scratch_directory_builds_index() {
        let mut builder = Schema::builder();
        let body = builder.add_text_field("body", TEXT | STORED);
        let index = Index::create(
            ScratchDirectory::new().unwrap(),
            builder.build(),
            Default::default(),
        )
        .unwrap();
        let mut writer: IndexWriter<TantivyDocument> = index.writer(15_000_000).unwrap();
        writer.add_document(doc!(body => "hello world")).unwrap();
        writer.commit().unwrap();
        let searcher = index.reader().unwrap().searcher();
        assert_eq!(searcher.num_docs(), 1);
    }

    #[test]
    fn test_scratch_directory_removed_on_drop() {
        let dir = ScratchDirectory::new().unwrap();
        let root = dir.root.path().to_path_buf();
        let clone = dir.clone();
        drop(dir);
        assert!(root.exists());
        drop(clone);
        assert!(!root.exists());
    }
}
