use std::{
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use ahash::HashSet;
use anyhow::Result;
use futures::{AsyncRead, AsyncSeek};
use tantivy::{
    directory::{error::OpenReadError, Directory, RamDirectory, WatchCallback, WatchHandle},
    HasLen,
};

use crate::meta::puffin::{reader::PuffinBytesReader, writer::PuffinBytesWriter};

// This is an identifier for tantivy blobs inside puffin file.
// Note: Tantivy blobs are not compressed.
const TANTIVY_INDEX_VERSION: &str = "TIIv0.1.0";

// We do not need all of the tantivy files, only the .term and .idx files
// for getting doc IDs and also the meta.json file
const ALLOWED_FILE_EXT: &[&str] = &["term", "idx", "store", "fast"];
const META_JSON: &str = "meta.json";

// TODO(uddhav): we want to add a lazy loaded global instance of RAM directory which will contain
// all the files of an empty tantivy index. This instance will be used to fill the missing files
// from the `.ttv` file, as tantivy needs them regardless of the configuration of a field.

/// Puffin directory is a puffin file which contains all the tantivy files.
/// Each tantivy file is stored as a blob in the puffin file, along with their file name.
#[derive(Debug)]
pub struct PuffinDirectory {
    ram_directory: Arc<RamDirectory>,
    // record all the files paths in the puffin file
    file_paths: Arc<RwLock<HashSet<PathBuf>>>,
}

impl Clone for PuffinDirectory {
    fn clone(&self) -> Self {
        PuffinDirectory {
            ram_directory: self.ram_directory.clone(),
            file_paths: self.file_paths.clone(),
        }
    }
}
impl PuffinDirectory {
    pub fn new() -> Self {
        // start emtpy index with empty store, fast files etc
        PuffinDirectory {
            ram_directory: Arc::new(RamDirectory::create()),
            file_paths: Arc::new(RwLock::new(HashSet::default())),
        }
    }

    pub fn list_files(&self) -> Vec<String> {
        self.file_paths
            .read()
            .expect("poisoned lock")
            .iter()
            .map(|path| path.to_str().unwrap().to_string())
            .collect()
    }

    // this function will serialize the directory into a single puffin file
    pub fn to_puffin_bytes(&self) -> Result<Vec<u8>> {
        let mut puffin_buf: Vec<u8> = Vec::new();
        let mut puffin_writer = PuffinBytesWriter::new(&mut puffin_buf);

        let file_paths = self.file_paths.read().expect("poisoned lock");
        let _filtered_file_paths: Vec<&PathBuf> = file_paths
            .iter()
            .filter(|path| {
                let mut allowed = false;
                if let Some(path_ext) = path.extension() {
                    if ALLOWED_FILE_EXT.contains(&path_ext.to_str().unwrap()) {
                        allowed = true;
                    }
                }

                // check if its meta.json file
                if !allowed && path.to_str().unwrap() == META_JSON {
                    allowed = true;
                };
                allowed
            })
            .collect();
        for path in file_paths.iter() {
            let file_data = self.ram_directory.open_read(path)?;
            dbg!(file_data.len(), path.to_str().unwrap());
            puffin_writer
                .add_blob(
                    file_data
                        .read_bytes()
                        .expect("failed to read file")
                        .to_vec(),
                    TANTIVY_INDEX_VERSION.to_string(),
                    path.to_str().unwrap().to_owned(),
                    false,
                )
                .expect("Failed to add blob");
        }

        puffin_writer.finish().expect("Failed to finish writing");
        Ok(puffin_buf)
    }

    // While read from .ttv
    pub async fn from_bytes<R>(data: R) -> Result<Self>
    where
        R: AsyncRead + AsyncSeek + Unpin + Send,
    {
        let mut puffin_reader = PuffinBytesReader::new(data);
        let ram_directory = RamDirectory::create();
        let mut file_paths = HashSet::default();

        let puffin_meta = puffin_reader
            .get_metadata()
            .await
            .expect("Failed to get blobs meta");

        for blob_meta in puffin_meta.blob_metadata {
            let blob = puffin_reader.read_blob_bytes(&blob_meta).await?;
            // Fetch the files names from the blob_meta itself
            if let Some(file_name) = blob_meta.properties.get("file_name") {
                let path = PathBuf::from(file_name);
                let mut writer = ram_directory
                    .open_write(&path)
                    .expect("Failed to write to RAM directory");
                writer.write_all(&blob)?;
                writer.flush()?;
                file_paths.insert(path);
            }
        }

        Ok(PuffinDirectory {
            ram_directory: Arc::new(ram_directory),
            file_paths: Arc::new(RwLock::new(file_paths)),
        })
    }
}

impl Directory for PuffinDirectory {
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
