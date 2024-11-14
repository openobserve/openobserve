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

use hashbrown::HashMap;
use tantivy::{
    directory::{error::OpenReadError, Directory, FileHandle, OwnedBytes},
    HasLen,
};

use crate::service::search::tantivy::{
    puffin::{reader::PuffinBytesReader, BlobMetadata},
    puffin_directory::{
        get_file_from_empty_puffin_dir_with_ext, EMPTY_PUFFIN_DIRECTORY, EMPTY_PUFFIN_SEG_ID,
    },
};

#[derive(Debug)]
pub struct PuffinDirReader {
    source: Arc<PuffinBytesReader>,
    blobs: Arc<HashMap<PathBuf, OwnedBytes>>,
    blobs_metadata: Arc<HashMap<PathBuf, BlobMetadata>>,
}

impl PuffinDirReader {
    pub async fn from_path(source: object_store::ObjectMeta) -> io::Result<Self> {
        let mut source = PuffinBytesReader::new(source);
        let Some(metadata) = source.get_metadata().await.map_err(|e| {
            io::Error::new(
                io::ErrorKind::Other,
                format!("Error reading metadata from puffin file: {:?}", e),
            )
        })?
        else {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "Error reading metadata from puffin file",
            ));
        };

        let mut blobs = HashMap::new();
        let mut blobs_metadata = HashMap::new();
        for meta in metadata.blobs {
            // Fetch the files names from the blob_meta itself
            if let Some(file_name) = meta.properties.get("blob_tag") {
                let path = PathBuf::from(file_name);
                if file_name == "meta.json" {
                    let data = source.read_blob_bytes(&meta, None).await.map_err(|e| {
                        io::Error::new(
                            io::ErrorKind::Other,
                            format!("Error reading bytes from blob: {:?}", e),
                        )
                    })?;
                    blobs.insert(path.clone(), OwnedBytes::new(data.to_vec()));
                }
                blobs_metadata.insert(path, meta);
            }
        }

        Ok(Self {
            source: Arc::new(source),
            blobs: Arc::new(blobs),
            blobs_metadata: Arc::new(blobs_metadata),
        })
    }
}

impl Clone for PuffinDirReader {
    fn clone(&self) -> Self {
        PuffinDirReader {
            source: self.source.clone(),
            blobs: self.blobs.clone(),
            blobs_metadata: self.blobs_metadata.clone(),
        }
    }
}

// Version 1: Keep the blob withing the file handle and return it when read
#[derive(Debug)]
struct PuffinSliceHandle {
    source: Arc<PuffinBytesReader>,
    metadata: BlobMetadata,
}

impl HasLen for PuffinSliceHandle {
    fn len(&self) -> usize {
        self.metadata.length as usize
    }
}

#[async_trait::async_trait]
impl FileHandle for PuffinSliceHandle {
    fn read_bytes(&self, byte_range: core::ops::Range<usize>) -> io::Result<OwnedBytes> {
        if byte_range.is_empty() {
            return Ok(OwnedBytes::empty());
        }

        tokio::task::block_in_place(move || {
            crate::service::search::DATAFUSION_RUNTIME.block_on(self.read_bytes_async(byte_range))
        })
    }

    async fn read_bytes_async(
        &self,
        byte_range: core::ops::Range<usize>,
    ) -> io::Result<OwnedBytes> {
        if byte_range.is_empty() {
            return Ok(OwnedBytes::empty());
        }
        let data = self
            .source
            .read_blob_bytes(&self.metadata, Some(byte_range))
            .await
            .map_err(|e| {
                io::Error::new(
                    io::ErrorKind::Other,
                    format!("Error reading bytes from blob: {:?}", e),
                )
            })?;
        Ok(OwnedBytes::new(data.to_vec()))
    }
}

impl Directory for PuffinDirReader {
    fn get_file_handle(
        &self,
        path: &Path,
    ) -> std::result::Result<Arc<dyn FileHandle>, OpenReadError> {
        match self.blobs_metadata.get(path) {
            Some(blob) => {
                let file_handle = PuffinSliceHandle {
                    source: self.source.clone(),
                    metadata: blob.clone(),
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
        let exists = self.blobs_metadata.contains_key(path);

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
        if path == Path::new("meta.json") {
            let data = self.blobs.get(path).unwrap();
            return Ok(data.to_vec());
        }
        Err(OpenReadError::FileDoesNotExist(path.to_path_buf()))
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
