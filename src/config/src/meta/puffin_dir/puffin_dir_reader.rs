use std::{
    io::{self},
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
    puffin_dir::{
        get_file_from_empty_puffin_dir_with_ext, EMPTY_PUFFIN_DIRECTORY, EMPTY_PUFFIN_SEG_ID,
    },
};

#[derive(Debug)]
pub struct PuffinDirReader<R> {
    source: Arc<PuffinBytesReader<R>>,
    blob_metadata_map: Arc<RwLock<HashMap<PathBuf, OwnedBytes>>>,
}

impl<R> PuffinDirReader<R>
where
    R: AsyncRead + AsyncSeek + Send + Unpin + Sync + Clone,
{
    /// Open a puffin direcotry from the given bytes data
    pub async fn from_bytes(data: R) -> Result<Self> {
        let mut puffin_reader = PuffinBytesReader::new(data);
        let puffin_meta = puffin_reader
            .get_metadata()
            .await
            .context("Failed to get blobs meta")?;

        let mut blob_meta_map = HashMap::new();

        for blob_meta in puffin_meta.blob_metadata {
            // Fetch the files names from the blob_meta itself
            if let Some(file_name) = blob_meta.properties.get("file_name") {
                let path = PathBuf::from(file_name);
                let blob = puffin_reader.read_blob_bytes(&blob_meta).await?;
                blob_meta_map.insert(path, OwnedBytes::new(blob));
            }
        }

        let puffin_dir = PuffinDirReader {
            source: Arc::new(puffin_reader),
            blob_metadata_map: Arc::new(RwLock::new(blob_meta_map)),
        };

        Ok(puffin_dir)
    }
}

impl<R> Clone for PuffinDirReader<R>
where
    R: Clone,
{
    fn clone(&self) -> Self {
        PuffinDirReader {
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

impl<R> Directory for PuffinDirReader<R>
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
                let ext = path.extension().unwrap().to_str().unwrap();
                if let Some(blob) = get_file_from_empty_puffin_dir_with_ext(ext).ok() {
                    Ok(Arc::new(PuffinSliceHandle { blob }))
                } else {
                    Err(OpenReadError::FileDoesNotExist(path.to_path_buf()))
                }
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
        match self.blob_metadata_map.read().unwrap().get(path) {
            Some(blob) => Ok(blob.to_vec()),
            None => {
                let ext = path.extension().unwrap().to_str().unwrap();
                if let Some(blob) = get_file_from_empty_puffin_dir_with_ext(ext).ok() {
                    Ok(blob.to_vec())
                } else {
                    Err(OpenReadError::FileDoesNotExist(path.to_path_buf()))
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
