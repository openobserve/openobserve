// Copyright 2024 OpenObserve Inc.
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
    io,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use anyhow::{Context, Result};
use futures::{AsyncRead, AsyncSeek};
use hashbrown::HashMap;
use tantivy::{
    directory::{error::OpenReadError, Directory, FileHandle, OwnedBytes},
    HasLen,
};

use crate::meta::{
    puffin::reader::PuffinBytesReader,
    puffin_directory::{
        get_file_from_empty_puffin_dir_with_ext, EMPTY_PUFFIN_DIRECTORY, EMPTY_PUFFIN_SEG_ID,
    },
};

#[derive(Debug)]
pub struct RamDirectoryReader<R> {
    source: Arc<PuffinBytesReader<R>>,
    blob_metadata_map: Arc<RwLock<HashMap<PathBuf, OwnedBytes>>>,
}

impl<R> RamDirectoryReader<R>
where
    R: AsyncRead + AsyncSeek + Send + Unpin + Sync + Clone,
{
    /// Open a puffin direcotry from the given bytes data
    pub async fn from_bytes(data: R) -> Result<Self> {
        let mut puffin_reader = PuffinBytesReader::new(data);
        let puffin_meta = puffin_reader
            .get_metadata()
            .await
            .context("Failed to get blobs meta")?
            .ok_or_else(|| anyhow::anyhow!("Corrupted tantivy index file without blob tag"))?;

        let mut blob_meta_map = HashMap::new();

        for blob in puffin_meta.blobs {
            // Fetch the files names from the blob_meta itself
            if let Some(file_name) = blob.properties.get("blob_tag") {
                let path = PathBuf::from(file_name);
                let blob_bytes = puffin_reader.read_blob_bytes(&blob).await?;
                blob_meta_map.insert(path, OwnedBytes::new(blob_bytes));
            }
        }

        let puffin_dir = RamDirectoryReader {
            source: Arc::new(puffin_reader),
            blob_metadata_map: Arc::new(RwLock::new(blob_meta_map)),
        };

        Ok(puffin_dir)
    }
}

impl<R> Clone for RamDirectoryReader<R>
where
    R: Clone,
{
    fn clone(&self) -> Self {
        RamDirectoryReader {
            source: self.source.clone(),
            blob_metadata_map: self.blob_metadata_map.clone(),
        }
    }
}

// Version 1: Keep the blob withing the file handle and return it when read
#[derive(Debug)]
struct PuffinSliceHandle {
    blob: OwnedBytes,
}

impl HasLen for PuffinSliceHandle {
    fn len(&self) -> usize {
        self.blob.len()
    }
}

#[async_trait::async_trait]
impl FileHandle for PuffinSliceHandle {
    fn read_bytes(&self, byte_range: core::ops::Range<usize>) -> io::Result<OwnedBytes> {
        Ok(self.blob.slice(byte_range))
    }

    async fn read_bytes_async(
        &self,
        byte_range: core::ops::Range<usize>,
    ) -> io::Result<OwnedBytes> {
        Ok(self.blob.slice(byte_range))
    }
}

impl<R> Directory for RamDirectoryReader<R>
where
    R: AsyncRead + AsyncSeek + Send + Unpin + Sync + Clone + std::fmt::Debug + 'static,
{
    fn get_file_handle(
        &self,
        path: &Path,
    ) -> std::result::Result<Arc<dyn FileHandle>, OpenReadError> {
        match self.blob_metadata_map.read().unwrap().get(path) {
            Some(blob) => {
                let file_handle = PuffinSliceHandle { blob: blob.clone() };
                Ok(Arc::new(file_handle))
            }
            None => {
                let ext = match path.extension().and_then(|ext| ext.to_str()) {
                    Some(ext) => ext,
                    None => return Err(OpenReadError::FileDoesNotExist(path.to_path_buf())),
                };
                match get_file_from_empty_puffin_dir_with_ext(ext) {
                    Ok(blob) => Ok(Arc::new(PuffinSliceHandle { blob })),
                    Err(_) => Err(OpenReadError::FileDoesNotExist(path.to_path_buf())),
                }
            }
        }
    }

    fn exists(&self, path: &Path) -> std::result::Result<bool, OpenReadError> {
        let exists = self.blob_metadata_map.read().unwrap().contains_key(path);

        if !exists {
            let ext = match path.extension().and_then(|ext| ext.to_str()) {
                Some(ext) => ext,
                None => return Ok(false),
            };
            let dir_path = format!("{}.{}", &EMPTY_PUFFIN_SEG_ID.as_str(), ext);
            return EMPTY_PUFFIN_DIRECTORY.exists(&PathBuf::from(dir_path));
        }

        Ok(exists)
    }

    fn atomic_read(&self, path: &Path) -> std::result::Result<Vec<u8>, OpenReadError> {
        match self.blob_metadata_map.read().unwrap().get(path) {
            Some(blob) => Ok(blob.to_vec()),
            None => {
                let ext = match path.extension().and_then(|ext| ext.to_str()) {
                    Some(ext) => ext,
                    None => return Err(OpenReadError::FileDoesNotExist(path.to_path_buf())),
                };
                match get_file_from_empty_puffin_dir_with_ext(ext) {
                    Ok(blob) => Ok(blob.to_vec()),
                    Err(_) => Err(OpenReadError::FileDoesNotExist(path.to_path_buf())),
                }
            }
        }
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
