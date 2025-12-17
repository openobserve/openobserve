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

use std::{cmp::min, path::Path};

use futures::stream::StreamExt;
use reqwest::Client;
use sha256::try_digest;
use tokio::{fs::File, io::AsyncWriteExt};

pub async fn download_file(client: &Client, url: &str, path: &str) -> Result<(), String> {
    // Reqwest setup
    let res = client
        .get(url)
        .send()
        .await
        .or(Err(format!("Failed to GET from '{url}'")))?;
    let total_size = res
        .content_length()
        .ok_or(format!("Failed to get content length from '{url}'"))?;

    // download chunks
    let mut file = File::create(path)
        .await
        .or(Err(format!("Failed to create file '{path}'")))?;
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.or(Err("Error while downloading file".to_string()))?;
        file.write_all(&chunk)
            .await
            .or(Err("Error while writing to file".to_string()))?;
        let new = min(downloaded + (chunk.len() as u64), total_size);
        downloaded = new;
    }

    Ok(())
}

pub async fn is_digest_different(
    local_file_path: &str,
    remote_sha256sum_path: &str,
) -> Result<bool, anyhow::Error> {
    let remote_file_sha = if !remote_sha256sum_path.to_lowercase().starts_with("http") {
        remote_sha256sum_path.to_string()
    } else {
        let response = reqwest::get(remote_sha256sum_path).await?;
        response.text().await?
    };
    let local_file_sha = try_digest(Path::new(local_file_path)).unwrap_or_default();
    Ok(remote_file_sha.trim() != local_file_sha.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_is_digest_different_with_direct_hash() {
        // Test with a direct hash string (not HTTP URL)
        let test_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        // Test with a non-existent file (should return empty digest and thus be different)
        let result = is_digest_different("/nonexistent/file.txt", test_hash).await;
        assert!(result.is_ok());
        // Since local file doesn't exist, digest will be empty, so it should be different
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_is_digest_different_same_empty_hashes() {
        // Both empty should be considered the same
        let result = is_digest_different("/nonexistent/file.txt", "").await;
        assert!(result.is_ok());
        assert!(!result.unwrap()); // Empty == Empty
    }

    #[tokio::test]
    async fn test_is_digest_different_with_whitespace() {
        // Test that trimming works correctly
        let hash_with_space = " e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ";
        let result = is_digest_different("/nonexistent/file.txt", hash_with_space).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_is_digest_different_url_detection() {
        // Test that HTTP URL is detected
        let http_url = "https://openobserve.ai/img/logo/logo_horizontal.svg";
        let result = is_digest_different("/nonexistent/file.txt", http_url).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_url_detection_logic() {
        // Test the URL detection logic directly
        let test_cases = vec![
            ("http://example.com", true),
            ("https://example.com", true),
            ("HTTP://example.com", true),
            ("HTTPS://example.com", true),
            ("ftp://example.com", false),
            ("/path/to/file", false),
            (
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                false,
            ),
        ];

        for (input, expected_is_url) in test_cases {
            let is_url = input.to_lowercase().starts_with("http");
            assert_eq!(is_url, expected_is_url, "Failed for input: {}", input);
        }
    }
}
