// Copyright 2025 OpenObserve Inc.
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

use std::{path::PathBuf, sync::LazyLock};

use anyhow::Result;
use tantivy::{
    directory::{Directory, OwnedBytes},
    doc,
    schema::Schema,
};
use writer::PuffinDirWriter;

pub mod caching_directory;
pub mod footer_cache;
pub mod reader;
pub mod writer;

// We do not need all of the tantivy files, only specific ones:
// - .term and .idx files for getting doc IDs
// - .pos files for position information
// - .fast files for fast fields
// - meta.json file for index metadata
// This might change in the future when we add more features to the index
const ALLOWED_FILE_EXT: &[&str] = &["term", "idx", "pos", "fast"];
const EMPTY_FILE_EXT: &[&str] = &["fieldnorm", "store"];
const META_JSON: &str = "meta.json";
const FOOTER_CACHE: &str = "footer_cache";

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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tantivy::{directory::Directory, schema::Schema};

    use super::*;

    #[test]
    fn test_allowed_file_extensions() {
        // Test that we have the expected file extensions
        assert!(ALLOWED_FILE_EXT.contains(&"term"));
        assert!(ALLOWED_FILE_EXT.contains(&"idx"));
        assert!(ALLOWED_FILE_EXT.contains(&"pos"));
        assert!(ALLOWED_FILE_EXT.contains(&"fast"));
    }

    #[test]
    fn test_empty_file_extensions() {
        // Test that we have the expected empty file extensions
        assert!(EMPTY_FILE_EXT.contains(&"fieldnorm"));
        assert!(EMPTY_FILE_EXT.contains(&"store"));
    }

    #[test]
    fn test_no_overlap_between_allowed_and_empty() {
        // Ensure allowed and empty extensions don't overlap
        for allowed in ALLOWED_FILE_EXT {
            assert!(!EMPTY_FILE_EXT.contains(allowed));
        }
        for empty in EMPTY_FILE_EXT {
            assert!(!ALLOWED_FILE_EXT.contains(empty));
        }
    }

    #[test]
    fn test_empty_puffin_directory_lazy_initialization() {
        // Test that the lazy static is initialized correctly
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;
        let files = empty_dir.list_files();

        // Should contain some files from the empty index
        assert!(!files.is_empty());

        // Should contain meta.json
        assert!(files.iter().any(|f| f.file_name().unwrap() == "meta.json"));
    }

    #[test]
    fn test_empty_puffin_seg_id_lazy_initialization() {
        // Test that the segment ID is extracted correctly
        let seg_id = &*EMPTY_PUFFIN_SEG_ID;

        // Should be a non-empty string
        assert!(!seg_id.is_empty());

        // Should be a valid segment ID format (typically hexadecimal)
        assert!(seg_id.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_empty_puffin_directory_contains_expected_files() {
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;
        let files = empty_dir.list_files();

        // Should contain meta.json
        assert!(files.iter().any(|f| f.file_name().unwrap() == "meta.json"));

        // Should contain at least one file with an extension from ALLOWED_FILE_EXT or
        // EMPTY_FILE_EXT
        let has_tantivy_files = files.iter().any(|f| {
            if let Some(ext) = f.extension() {
                let ext_str = ext.to_str().unwrap();
                ALLOWED_FILE_EXT.contains(&ext_str) || EMPTY_FILE_EXT.contains(&ext_str)
            } else {
                false
            }
        });
        assert!(has_tantivy_files);
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_with_ext_term() {
        let result = get_file_from_empty_puffin_dir_with_ext("term");
        assert!(result.is_ok());

        let data = result.unwrap();
        assert!(!data.is_empty()); // Should have some data
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_with_ext_idx() {
        let result = get_file_from_empty_puffin_dir_with_ext("idx");
        assert!(result.is_ok());

        let data = result.unwrap();
        assert!(!data.is_empty()); // Should have some data
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_with_ext_pos() {
        let result = get_file_from_empty_puffin_dir_with_ext("pos");
        assert!(result.is_ok());

        let data = result.unwrap();
        assert!(!data.is_empty()); // Should have some data
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_with_ext_fast() {
        let result = get_file_from_empty_puffin_dir_with_ext("fast");
        assert!(result.is_ok());

        let data = result.unwrap();
        assert!(!data.is_empty()); // Should have some data
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_with_ext_fieldnorm() {
        let result = get_file_from_empty_puffin_dir_with_ext("fieldnorm");
        assert!(result.is_ok());

        let data = result.unwrap();
        // fieldnorm files are typically empty or very small
        assert!(!data.is_empty());
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_with_ext_store() {
        let result = get_file_from_empty_puffin_dir_with_ext("store");
        assert!(result.is_ok());

        let data = result.unwrap();
        // store files might be empty since we added an empty document
        assert!(!data.is_empty());
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_nonexistent_ext() {
        let result = get_file_from_empty_puffin_dir_with_ext("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_empty_ext() {
        let result = get_file_from_empty_puffin_dir_with_ext("");
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_puffin_directory_is_functional() {
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;
        let _seg_id = &*EMPTY_PUFFIN_SEG_ID;

        // Test that we can read files from the empty directory
        let files = empty_dir.list_files();
        for file in files {
            if let Some(ext) = file.extension() {
                let ext_str = ext.to_str().unwrap();
                if ALLOWED_FILE_EXT.contains(&ext_str) || EMPTY_FILE_EXT.contains(&ext_str) {
                    let data = empty_dir.open_read(&file);
                    assert!(data.is_ok());
                }
            }
        }
    }

    #[test]
    fn test_empty_puffin_directory_segment_id_consistency() {
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;
        let seg_id = &*EMPTY_PUFFIN_SEG_ID;

        // Find files that should have the segment ID prefix
        let files = empty_dir.list_files();
        let non_meta_files: Vec<_> = files
            .iter()
            .filter(|f| f.extension().is_some_and(|ext| ext != "json"))
            .collect();

        // All non-meta files should have the same segment ID
        for file in non_meta_files {
            let file_stem = file.file_stem().unwrap().to_str().unwrap();
            assert_eq!(file_stem, seg_id.as_str());
        }
    }

    #[test]
    fn test_empty_puffin_directory_meta_json_exists() {
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;
        let meta_path = PathBuf::from("meta.json");

        // meta.json should exist
        assert!(empty_dir.exists(&meta_path).unwrap());

        // Should be able to read it
        let meta_data = empty_dir.open_read(&meta_path);
        assert!(meta_data.is_ok());

        // Should contain valid JSON
        let data = meta_data.unwrap().read_bytes().unwrap();
        let json_str = std::str::from_utf8(&data).unwrap();
        let _: serde_json::Value = serde_json::from_str(json_str).unwrap();
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_with_different_extensions() {
        let test_extensions = ["term", "idx", "pos", "fast", "fieldnorm", "store"];

        for ext in test_extensions {
            let result = get_file_from_empty_puffin_dir_with_ext(ext);
            assert!(result.is_ok(), "Failed to get file with extension: {ext}");

            let data = result.unwrap();
            // Data should be valid OwnedBytes
            assert!(!data.is_empty());
        }
    }

    #[test]
    fn test_empty_puffin_directory_thread_safety() {
        use std::thread;

        let mut handles = vec![];

        // Access the lazy static from multiple threads
        for i in 0..10 {
            let handle = thread::spawn(move || {
                let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;
                let seg_id = &*EMPTY_PUFFIN_SEG_ID;

                // Should be able to access from any thread
                assert!(!empty_dir.list_files().is_empty());
                assert!(!seg_id.is_empty());

                // Should be able to get files
                let result = get_file_from_empty_puffin_dir_with_ext("term");
                assert!(result.is_ok());

                i // Return thread id for verification
            });
            handles.push(handle);
        }

        for handle in handles {
            let thread_id = handle.join().unwrap();
            assert!(thread_id < 10);
        }
    }

    #[test]
    fn test_empty_puffin_directory_lazy_static_initialization_order() {
        // Test that EMPTY_PUFFIN_SEG_ID depends on EMPTY_PUFFIN_DIRECTORY
        let seg_id = &*EMPTY_PUFFIN_SEG_ID;
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;

        // Should be able to find a file with the segment ID
        let files = empty_dir.list_files();
        let found_file = files.iter().find(|f| {
            f.file_stem()
                .and_then(|stem| stem.to_str())
                .map(|s| s == seg_id.as_str())
                .unwrap_or(false)
        });

        assert!(found_file.is_some());
    }

    #[test]
    fn test_file_extension_logic() {
        // Test the logic that would be used to filter files
        let test_files = [
            "segment_123.term",
            "segment_123.idx",
            "segment_123.pos",
            "segment_123.fast",
            "segment_123.fieldnorm",
            "segment_123.store",
            "meta.json",
            "footer_cache",
            "unknown.ext",
        ];

        for filename in test_files {
            let path = PathBuf::from(filename);
            let ext = path.extension().and_then(|e| e.to_str());

            match ext {
                Some(ext_str) => {
                    if ALLOWED_FILE_EXT.contains(&ext_str) {
                        // This file should be included in puffin
                        assert!(["term", "idx", "pos", "fast"].contains(&ext_str));
                    } else if EMPTY_FILE_EXT.contains(&ext_str) {
                        // This file should be skipped in puffin serialization
                        assert!(["fieldnorm", "store"].contains(&ext_str));
                    } else if ext_str == "json" {
                        // meta.json should be handled specially
                        assert_eq!(filename, "meta.json");
                    }
                }
                None => {
                    // Files without extensions like "footer_cache"
                    assert!(filename == "footer_cache");
                }
            }
        }
    }

    #[test]
    fn test_empty_puffin_directory_produces_valid_schema() {
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;

        // Should be able to create an index from the empty directory
        let _schema = Schema::builder().build();
        let index = tantivy::Index::open(empty_dir.clone());

        // Even though it's empty, it should be a valid tantivy index
        assert!(index.is_ok());
    }

    #[test]
    fn test_get_file_from_empty_puffin_dir_data_consistency() {
        // Test that getting the same file multiple times returns the same data
        let ext = "term";

        let data1 = get_file_from_empty_puffin_dir_with_ext(ext).unwrap();
        let data2 = get_file_from_empty_puffin_dir_with_ext(ext).unwrap();

        assert_eq!(data1.as_slice(), data2.as_slice());
    }

    #[test]
    fn test_module_integration() {
        // Test that all the components work together
        let empty_dir = &*EMPTY_PUFFIN_DIRECTORY;
        let seg_id = &*EMPTY_PUFFIN_SEG_ID;

        // Should be able to get files using the utility function
        for ext in ALLOWED_FILE_EXT {
            let data = get_file_from_empty_puffin_dir_with_ext(ext).unwrap();
            assert!(!data.is_empty());
        }

        for ext in EMPTY_FILE_EXT {
            let data = get_file_from_empty_puffin_dir_with_ext(ext).unwrap();
            assert!(!data.is_empty());
        }

        // The directory should contain files with our segment ID
        let files = empty_dir.list_files();
        let has_segment_files = files.iter().any(|f| {
            f.file_stem()
                .and_then(|stem| stem.to_str())
                .map(|s| s == seg_id.as_str())
                .unwrap_or(false)
        });
        assert!(has_segment_files);
    }
}
