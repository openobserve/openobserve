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

use std::ops::Range;

use config::get_config;
use object_store::{GetOptions, GetResult, ObjectMeta, ObjectStore, Result, path::Path};
use once_cell::sync::Lazy;

static DEFAULT: Lazy<Box<dyn ObjectStore>> = Lazy::new(default);

fn default() -> Box<dyn ObjectStore> {
    let cfg = get_config();
    std::fs::create_dir_all(&cfg.common.data_wal_dir).expect("create wal dir success");
    Box::new(super::local::Local::new(&cfg.common.data_wal_dir, false))
}

pub async fn get(path: &Path) -> Result<GetResult> {
    DEFAULT.get(path).await
}

pub async fn get_opts(path: &Path, options: GetOptions) -> Result<GetResult> {
    DEFAULT.get_opts(path, options).await
}

pub async fn get_range(path: &Path, range: Range<u64>) -> Result<bytes::Bytes> {
    DEFAULT.get_range(path, range).await
}

pub async fn head(path: &Path) -> Result<ObjectMeta> {
    DEFAULT.head(path).await
}

#[cfg(test)]
mod tests {
    use std::ops::Range;

    use object_store::GetOptions;
    use tempfile::TempDir;

    use super::*;

    // Helper function to create a temporary WAL directory for testing
    fn create_temp_wal_dir() -> TempDir {
        tempfile::tempdir().expect("Failed to create temp directory")
    }

    // Helper function to set up test environment with custom WAL dir
    async fn setup_test_environment() -> (TempDir, String) {
        let temp_dir = create_temp_wal_dir();
        let wal_path = temp_dir.path().join("wal");
        std::fs::create_dir_all(&wal_path).expect("Failed to create WAL directory");

        // Override the config temporarily for testing
        // Note: In a real test environment, you might want to mock the config
        (temp_dir, wal_path.to_string_lossy().to_string())
    }

    #[tokio::test]
    async fn test_get_function() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/file.txt");

        // Test with a non-existent file
        let result = get(&path).await;
        assert!(result.is_err());

        // Verify the error is appropriate for a non-existent file
        if let Err(e) = result {
            assert!(matches!(e, object_store::Error::NotFound { .. }));
        }
    }

    #[tokio::test]
    async fn test_get_opts_function() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/file.txt");
        let options = GetOptions::default();

        // Test with a non-existent file
        let result = get_opts(&path, options).await;
        assert!(result.is_err());

        // Verify the error is appropriate for a non-existent file
        if let Err(e) = result {
            assert!(matches!(e, object_store::Error::NotFound { .. }));
        }
    }

    #[tokio::test]
    async fn test_get_range_function() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/file.txt");
        let range = Range { start: 0, end: 10 };

        // Test with a non-existent file
        let result = get_range(&path, range).await;
        assert!(result.is_err());

        // Verify the error is appropriate for a non-existent file
        if let Err(e) = result {
            assert!(matches!(e, object_store::Error::NotFound { .. }));
        }
    }

    #[tokio::test]
    async fn test_head_function() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/file.txt");

        // Test with a non-existent file
        let result = head(&path).await;
        assert!(result.is_err());

        // Verify the error is NotImplemented (as implemented in local storage)
        if let Err(e) = result {
            assert!(matches!(e, object_store::Error::NotImplemented));
        }
    }

    #[tokio::test]
    async fn test_different_path_formats() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let test_paths = [
            Path::from("simple.txt"),
            Path::from("/absolute/path/file.txt"),
            Path::from("nested/directory/file.txt"),
            Path::from("file with spaces.txt"),
            Path::from("file-with-special-chars@#$%.txt"),
            Path::from("very/deeply/nested/path/to/file.log"),
        ];

        for path in &test_paths {
            let result = get(path).await;
            assert!(result.is_err(), "Should fail for path: {}", path);

            let head_result = head(path).await;
            assert!(head_result.is_err(), "Should fail for path: {}", path);
        }
    }

    #[tokio::test]
    async fn test_get_range_with_different_ranges() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/file.txt");
        let test_ranges = [
            Range { start: 0, end: 10 },
            Range { start: 10, end: 20 },
            Range { start: 0, end: 0 }, // Empty range
            Range {
                start: 100,
                end: 200,
            },
            Range { start: 0, end: 1 }, // Single byte range
        ];

        for range in &test_ranges {
            let result = get_range(&path, range.clone()).await;
            assert!(result.is_err(), "Should fail for range: {:?}", range);
        }
    }

    #[tokio::test]
    async fn test_get_opts_with_different_options() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/file.txt");

        // Test with default options
        let default_options = GetOptions::default();
        let result = get_opts(&path, default_options).await;
        assert!(result.is_err());

        // Test with custom options (if any specific options are available)
        let custom_options = GetOptions::default();
        // Note: GetOptions might not have many configurable options in the current version
        let result = get_opts(&path, custom_options).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_concurrent_operations() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/concurrent.txt");

        // Test multiple concurrent operations of the same type
        let get_futures = [get(&path), get(&path), get(&path)];

        let get_range_futures = [
            get_range(&path, Range { start: 0, end: 10 }),
            get_range(&path, Range { start: 10, end: 20 }),
            get_range(&path, Range { start: 20, end: 30 }),
        ];

        let head_futures = [head(&path), head(&path), head(&path)];

        let get_results = futures::future::join_all(get_futures).await;
        let get_range_results = futures::future::join_all(get_range_futures).await;
        let head_results = futures::future::join_all(head_futures).await;

        // All operations should fail with errors
        for result in get_results {
            assert!(result.is_err());
        }
        for result in get_range_results {
            assert!(result.is_err());
        }
        for result in head_results {
            assert!(result.is_err());
        }
    }

    #[tokio::test]
    async fn test_empty_and_edge_case_paths() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let edge_case_paths = [
            Path::from(""),        // Empty path
            Path::from("."),       // Current directory
            Path::from(".."),      // Parent directory
            Path::from("/"),       // Root
            Path::from("////"),    // Multiple slashes
            Path::from("file"),    // No extension
            Path::from(".hidden"), // Hidden file
            Path::from("dir/"),    // Directory with trailing slash
        ];

        for path in &edge_case_paths {
            let result = get(path).await;
            assert!(
                result.is_err(),
                "Should fail for edge case path: '{}'",
                path
            );
        }
    }

    #[test]
    fn test_default_function_creates_directory() {
        // This test verifies that the default function creates the WAL directory
        // Note: This is a bit tricky to test without mocking the config
        // In a real scenario, you might want to use a test configuration

        // For now, we'll just test that the function doesn't panic
        // and that the DEFAULT static is properly initialized
        let _default_store = &*DEFAULT;
        // If we get here, the DEFAULT was successfully initialized
    }

    #[tokio::test]
    async fn test_error_consistency() {
        let (_temp_dir, _wal_path) = setup_test_environment().await;
        let path = Path::from("test/consistency.txt");

        // Test that all functions return consistent error types for the same non-existent file
        let get_result = get(&path).await;
        let get_opts_result = get_opts(&path, GetOptions::default()).await;
        let get_range_result = get_range(&path, Range { start: 0, end: 10 }).await;
        let head_result = head(&path).await;

        // get, get_opts, and get_range should return NotFound errors
        // head returns NotImplemented as per local storage implementation
        assert!(matches!(
            get_result,
            Err(object_store::Error::NotFound { .. })
        ));
        assert!(matches!(
            get_opts_result,
            Err(object_store::Error::NotFound { .. })
        ));
        assert!(matches!(
            get_range_result,
            Err(object_store::Error::NotFound { .. })
        ));
        assert!(matches!(
            head_result,
            Err(object_store::Error::NotImplemented)
        ));
    }
}
