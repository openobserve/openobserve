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

use std::{io::Write, path::PathBuf, sync::LazyLock};

use anyhow::Result;
use tantivy::{
    directory::{Directory, OwnedBytes},
    doc,
    schema::Schema,
};
use writer::PuffinDirWriter;

use crate::get_config;

pub mod reader;
pub mod writer;

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
        .expect("Failed to create index writer for EMPTY_PUFFIN_DIRECTORY");
    let _ = index_writer.add_document(doc!());
    index_writer
        .finalize()
        .expect("Failed to finalize index writer for EMPTY_PUFFIN_DIRECTORY");
    puffin_dir
});

// Lazy loaded global segment id of the empty puffin directory which will be used to construct the
// path of a file
static EMPTY_PUFFIN_SEG_ID: LazyLock<String> = LazyLock::new(|| {
    EMPTY_PUFFIN_DIRECTORY
        .list_files()
        .iter()
        .find(|path| path.extension().is_some_and(|ext| ext != "json"))
        .unwrap()
        .file_stem()
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned()
});

pub fn get_file_from_empty_puffin_dir_with_ext(file_ext: &str) -> Result<OwnedBytes> {
    let empty_puffin_dir = &EMPTY_PUFFIN_DIRECTORY;
    let seg_id = &EMPTY_PUFFIN_SEG_ID;
    let file_path = format!("{}.{}", seg_id.as_str(), file_ext);
    let file_data = empty_puffin_dir.open_read(&PathBuf::from(file_path))?;
    Ok(file_data.read_bytes()?)
}

pub fn convert_puffin_dir_to_tantivy_dir(
    mut puffin_dir_path: PathBuf,
    puffin_dir: PuffinDirWriter,
) -> Result<()> {
    // create directory
    let cfg = get_config();
    let file_name = puffin_dir_path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("Failed to get file name from path"))?;
    let mut file_name = file_name.to_os_string();
    file_name.push(".folder");
    puffin_dir_path.set_file_name(file_name);
    let mut tantivy_folder_path = PathBuf::from(&cfg.common.data_stream_dir);
    tantivy_folder_path.push(PathBuf::from(&puffin_dir_path));

    // Check if the folder already exists
    if !tantivy_folder_path.exists() {
        std::fs::create_dir_all(&tantivy_folder_path)?;
        log::info!(
            "Created folder for index at {}",
            tantivy_folder_path.to_str().unwrap_or("<invalid path>")
        );
    } else {
        log::warn!(
            "Folder already exists for index at {}",
            tantivy_folder_path.to_str().unwrap_or("<invalid path>")
        );
    }

    for file in puffin_dir.list_files() {
        let file_data = puffin_dir.open_read(&file.clone())?;
        let mut file_handle = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(tantivy_folder_path.join(&file))?;
        file_handle.write_all(&file_data.read_bytes()?)?;
        file_handle.flush()?;
    }

    Ok(())
}
