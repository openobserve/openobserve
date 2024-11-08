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
    sync::Arc,
};

use anyhow::Result;
use hashbrown::HashMap;
use tantivy::{
    directory::{error::OpenReadError, Directory, FileHandle, OwnedBytes},
    HasLen,
};
use tokio::{fs::File, sync::Mutex};
use tokio_util::compat::TokioAsyncReadCompatExt;

use crate::meta::{
    puffin::{reader::PuffinBytesReader, BlobMetadata},
    puffin_directory::{EMPTY_PUFFIN_DIRECTORY, EMPTY_PUFFIN_SEG_ID},
};

#[derive(Debug)]
pub struct StdFsReader {
    source: Arc<Mutex<PuffinBytesReader<tokio_util::compat::Compat<File>>>>,
    blob_metadata_map: Arc<std::sync::RwLock<HashMap<PathBuf, BlobMetadata>>>,
}

impl StdFsReader {
    /// Open a puffin direcotry from the given bytes data
    pub async fn from_dir(path: &Path) -> Result<Self> {
        let file = tokio::fs::OpenOptions::new().read(true).open(path).await?;
        let mut puffin_reader = PuffinBytesReader::new(file.compat());
        let puffin_meta = puffin_reader.get_metadata().await?;

        let mut blob_meta_map = HashMap::new();

        for blob_meta in puffin_meta.blob_metadata {
            // Fetch the files names from the blob_meta itself
            if let Some(file_name) = blob_meta.properties.get("file_name") {
                let path = PathBuf::from(file_name);
                blob_meta_map.insert(path, blob_meta);
            }
        }

        let puffin_dir = StdFsReader {
            source: Arc::new(Mutex::new(puffin_reader)),
            blob_metadata_map: Arc::new(std::sync::RwLock::new(blob_meta_map)),
        };

        Ok(puffin_dir)
    }
}

impl Clone for StdFsReader {
    fn clone(&self) -> Self {
        StdFsReader {
            source: self.source.clone(),
            blob_metadata_map: self.blob_metadata_map.clone(),
        }
    }
}

// Version 1: Keep the blob withing the file handle and return it when read
#[derive(Debug)]
struct StdFsPuffinSliceHandle {
    source: Arc<Mutex<PuffinBytesReader<tokio_util::compat::Compat<tokio::fs::File>>>>,
    metadata: BlobMetadata,
}

impl HasLen for StdFsPuffinSliceHandle {
    fn len(&self) -> usize {
        self.metadata.length as usize
    }
}

#[async_trait::async_trait]
impl FileHandle for StdFsPuffinSliceHandle {
    fn read_bytes(&self, _byte_range: core::ops::Range<usize>) -> io::Result<OwnedBytes> {
        let msg = "Unsupported operation for StdFsDirectory";
        Err(io::Error::new(io::ErrorKind::Other, msg))
    }

    async fn read_bytes_async(
        &self,
        byte_range: core::ops::Range<usize>,
    ) -> io::Result<OwnedBytes> {
        let bytes = self
            .source
            .lock()
            .await
            .read_slice(&self.metadata, byte_range)
            .await
            .map_err(|msg| io::Error::new(io::ErrorKind::Other, msg.to_string()))?;
        Ok(OwnedBytes::new(bytes))
    }
}

impl Directory for StdFsReader {
    fn get_file_handle(
        &self,
        path: &Path,
    ) -> std::result::Result<Arc<dyn FileHandle>, OpenReadError> {
        match self.blob_metadata_map.read().unwrap().get(path) {
            Some(blob_meta) => {
                let file_handle = StdFsPuffinSliceHandle {
                    source: self.source.clone(),
                    metadata: blob_meta.clone(),
                };
                Ok(Arc::new(file_handle))
            }
            None => {
                let ext = path.extension().unwrap().to_str().unwrap();
                let empty_puffin_dir = &EMPTY_PUFFIN_DIRECTORY;
                let seg_id = &EMPTY_PUFFIN_SEG_ID;
                let file_path = PathBuf::from(format!("{}.{}", seg_id.as_str(), ext));
                empty_puffin_dir.get_file_handle(&file_path)
            }
        }
    }

    fn exists(&self, path: &Path) -> std::result::Result<bool, OpenReadError> {
        let exists = self.blob_metadata_map.read().unwrap().contains_key(path);

        if !exists {
            let ext = path.extension().unwrap().to_str().unwrap();
            let dir_path = format!("{}.{}", &EMPTY_PUFFIN_SEG_ID.as_str(), ext);
            return EMPTY_PUFFIN_DIRECTORY.exists(&PathBuf::from(dir_path));
        }

        return Ok(exists);
    }

    fn atomic_read(&self, path: &Path) -> std::result::Result<Vec<u8>, OpenReadError> {
        unimplemented!()
        // match self.blob_metadata_map.read().unwrap().get(path) {
        //     Some(blob_meta) => {
        //         let blob = self.source.lock().atomic_read(blob_meta)?;
        //         Ok(blob)
        //     }
        //     None => {
        //         let ext = path.extension().unwrap().to_str().unwrap();
        //         let empty_puffin_dir = &EMPTY_PUFFIN_DIRECTORY;
        //         let seg_id = &EMPTY_PUFFIN_SEG_ID;
        //         let file_path = PathBuf::from(format!("{}.{}", seg_id.as_str(), ext));
        //         empty_puffin_dir.atomic_read(&file_path)
        //     }
        // }
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
