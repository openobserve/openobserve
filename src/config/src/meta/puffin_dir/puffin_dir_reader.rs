use tantivy::directory::OwnedBytes;

use super::*;

#[derive(Debug)]
pub struct PuffinDirReader<R> {
    source: Arc<PuffinBytesReader<R>>,
    blob_metadata_map: Arc<RwLock<HashMap<PathBuf, Vec<u8>>>>,
}

impl<R> PuffinDirReader<R>
where
    R: AsyncRead + AsyncSeek + Send + Unpin + Sync + Clone,
{
    /// Open a puffin direcotry from the given bytes data
    pub async fn from_bytes(data: R) -> Result<Self> {
        // TODO: Remove the clone
        let mut puffin_reader = PuffinBytesReader::new(data);
        let puffin_meta = puffin_reader
            .get_metadata()
            .await
            .context("Failed to get blobs meta")?;

        let mut blob_meta_map = HashMap::new();

        for blob_meta in puffin_meta.blob_metadata {
            // let blob = puffin_reader.read_blob_bytes(&blob_meta).await?;
            // Fetch the files names from the blob_meta itself
            if let Some(file_name) = blob_meta.properties.get("file_name") {
                let path = PathBuf::from(file_name);
                let blob = puffin_reader.read_blob_bytes(&blob_meta).await?;
                blob_meta_map.insert(path, blob);
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
    blob: Vec<u8>,
}

impl HasLen for PuffinSliceHandle {
    fn len(&self) -> usize {
        self.blob.len()
    }
}

#[async_trait::async_trait]
impl FileHandle for PuffinSliceHandle {
    fn read_bytes(&self, byte_range: core::ops::Range<usize>) -> io::Result<OwnedBytes> {
        let start = byte_range.start;
        let end = byte_range.end;
        let blob = &self.blob[start..end];
        Ok(OwnedBytes::new(blob.to_vec()))
    }

    async fn read_bytes_async(
        &self,
        byte_range: core::ops::Range<usize>,
    ) -> io::Result<OwnedBytes> {
        let start = byte_range.start;
        let end = byte_range.end;
        let blob = &self.blob[start..end];
        Ok(OwnedBytes::new(blob.to_vec()))
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
        if let Some(blob) = self.blob_metadata_map.read().unwrap().get(path) {
            let file_handle = PuffinSliceHandle { blob: blob.clone() };
            Ok(Arc::new(file_handle))
        } else {
            Err(OpenReadError::FileDoesNotExist(path.to_path_buf()))
        }
    }

    fn exists(&self, path: &Path) -> std::result::Result<bool, OpenReadError> {
        Ok(self.blob_metadata_map.read().unwrap().contains_key(path))
    }

    fn atomic_read(&self, path: &Path) -> std::result::Result<Vec<u8>, OpenReadError> {
        if let Some(blob) = self.blob_metadata_map.read().unwrap().get(path) {
            Ok(blob.clone())
        } else {
            Err(OpenReadError::FileDoesNotExist(path.to_path_buf()))
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
