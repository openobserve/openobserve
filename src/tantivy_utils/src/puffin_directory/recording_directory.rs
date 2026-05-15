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
    fmt, io,
    ops::Range,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use tantivy::{
    HasLen,
    directory::{
        Directory, DirectoryLock, FileHandle, OwnedBytes, WatchCallback, WatchHandle,
        error::{DeleteError, LockError, OpenReadError, OpenWriteError},
    },
};

/// Records a single read operation performed on a file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadOperation {
    pub path: PathBuf,
    pub offset: usize,
    pub num_bytes: usize,
}

struct RecordingFileHandle {
    inner: Arc<dyn FileHandle>,
    path: PathBuf,
    ops: Arc<Mutex<Vec<ReadOperation>>>,
}

impl fmt::Debug for RecordingFileHandle {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "Recording({:?})", &self.inner)
    }
}

impl HasLen for RecordingFileHandle {
    fn len(&self) -> usize {
        self.inner.len()
    }
}

#[async_trait::async_trait]
impl FileHandle for RecordingFileHandle {
    fn read_bytes(&self, byte_range: Range<usize>) -> io::Result<OwnedBytes> {
        let payload = self.inner.read_bytes(byte_range.clone())?;
        Ok(payload)
    }

    async fn read_bytes_async(&self, byte_range: Range<usize>) -> io::Result<OwnedBytes> {
        let payload = self.inner.read_bytes_async(byte_range.clone()).await?;
        self.ops.lock().unwrap().push(ReadOperation {
            path: self.path.clone(),
            offset: byte_range.start,
            num_bytes: payload.len(),
        });
        Ok(payload)
    }
}

/// A [`Directory`] wrapper that records every read operation (file path, byte offset, byte count).
///
/// Use [`RecordingDirectory::drain_ops`] to collect the recorded operations after a warmup pass.
#[derive(Clone)]
pub struct RecordingDirectory<D: Directory + Clone> {
    inner: D,
    ops: Arc<Mutex<Vec<ReadOperation>>>,
}

impl<D: Directory + Clone> fmt::Debug for RecordingDirectory<D> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "RecordingDirectory({:?})", &self.inner)
    }
}

impl<D: Directory + Clone> RecordingDirectory<D> {
    pub fn new(inner: D) -> Self {
        Self {
            inner,
            ops: Default::default(),
        }
    }

    pub fn drain_ops(&self) -> Vec<ReadOperation> {
        std::mem::take(&mut *self.ops.lock().unwrap())
    }

    pub fn ops(&self) -> Vec<ReadOperation> {
        self.ops.lock().unwrap().clone()
    }
}

impl<D: Directory + Clone + 'static> Directory for RecordingDirectory<D> {
    fn get_file_handle(&self, path: &Path) -> Result<Arc<dyn FileHandle>, OpenReadError> {
        let inner = self.inner.get_file_handle(path)?;
        Ok(Arc::new(RecordingFileHandle {
            inner,
            path: path.to_owned(),
            ops: self.ops.clone(),
        }))
    }

    fn exists(&self, path: &Path) -> Result<bool, OpenReadError> {
        self.inner.exists(path)
    }

    fn atomic_read(&self, path: &Path) -> Result<Vec<u8>, OpenReadError> {
        let data = self.inner.atomic_read(path)?;
        Ok(data)
    }

    fn delete(&self, _path: &Path) -> Result<(), DeleteError> {
        unimplemented!("read-only")
    }

    fn open_write(&self, _path: &Path) -> Result<tantivy::directory::WritePtr, OpenWriteError> {
        unimplemented!("read-only")
    }

    fn atomic_write(&self, _path: &Path, _data: &[u8]) -> io::Result<()> {
        unimplemented!("read-only")
    }

    fn sync_directory(&self) -> io::Result<()> {
        unimplemented!("read-only")
    }

    fn watch(&self, _watch_callback: WatchCallback) -> tantivy::Result<WatchHandle> {
        Ok(WatchHandle::empty())
    }

    fn acquire_lock(&self, _lock: &tantivy::directory::Lock) -> Result<DirectoryLock, LockError> {
        Ok(DirectoryLock::from(Box::new(|| {})))
    }
}
