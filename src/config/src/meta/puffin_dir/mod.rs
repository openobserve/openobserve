use std::{
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, RwLock},
};

use ahash::HashSet;
use anyhow::{Context, Result};
use futures::{AsyncRead, AsyncSeek};
use hashbrown::HashMap;
use itertools::Itertools;
use puffin_dir_writer::PuffinDirWriter;
use tantivy::{
    directory::{
        error::OpenReadError, Directory, FileHandle, RamDirectory, WatchCallback, WatchHandle,
    },
    doc,
    schema::Schema,
    HasLen,
};

use crate::{
    get_config,
    meta::puffin::{reader::PuffinBytesReader, writer::PuffinBytesWriter},
};

pub mod puffin_dir_reader;
pub mod puffin_dir_writer;

// This is an identifier for tantivy blobs inside puffin file.
// Note: Tantivy blobs are not compressed.
const TANTIVY_INDEX_VERSION: &str = "TIIv0.1.0";

// We do not need all of the tantivy files, only the .term and .idx files
// for getting doc IDs and also the meta.json file
// This might change in the future when we add more features to the index
const ALLOWED_FILE_EXT: &[&str] = &["term", "idx", "pos"];
const META_JSON: &str = "meta.json";

// Lazy loaded global instance of RAM directory which will contain
// all the files of an empty tantivy index. This instance will be used to fill the missing files
// from the `.ttv` file, as tantivy needs them regardless of the configuration of a field.
static EMPTY_PUFFIN_DIRECTORY: LazyLock<PuffinDirWriter> = LazyLock::new(|| {
    let puffin_dir = PuffinDirWriter::new();
    let puffin_dir_clone = puffin_dir.clone();
    let schema = Schema::builder().build();
    let mut index_writer = tantivy::IndexBuilder::new()
        .schema(schema)
        .single_segment_index_writer(puffin_dir_clone, 50_000_000)
        .unwrap();
    let _ = index_writer.add_document(doc!());
    index_writer.finalize().unwrap();
    puffin_dir
});

pub fn convert_puffin_dir_to_tantivy_dir(
    mut puffin_dir_path: PathBuf,
    puffin_dir: PuffinDirWriter,
) {
    // create directory
    let cfg = get_config();
    let file_name = puffin_dir_path.file_name().unwrap();
    let mut file_name = file_name.to_os_string();
    file_name.push(".folder");
    puffin_dir_path.set_file_name(file_name);
    let mut tantivy_folder_path = PathBuf::from(&cfg.common.data_stream_dir);
    tantivy_folder_path.push(PathBuf::from(&puffin_dir_path));

    // Check if the folder already exists
    if !tantivy_folder_path.exists() {
        std::fs::create_dir_all(&tantivy_folder_path).unwrap();
        log::info!(
            "Created folder for index at {}",
            tantivy_folder_path.to_str().unwrap()
        );
    } else {
        log::warn!(
            "Folder already exists for index at {}",
            tantivy_folder_path.to_str().unwrap()
        );
    }

    for file in puffin_dir.list_files() {
        let file_data = puffin_dir.open_read(&PathBuf::from(file.clone())).unwrap();
        let mut file_handle = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(tantivy_folder_path.join(&file))
            .unwrap();
        file_handle
            .write_all(&file_data.read_bytes().unwrap())
            .unwrap();
        file_handle.flush().unwrap();
    }
}
