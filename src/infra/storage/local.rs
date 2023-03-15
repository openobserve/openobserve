// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use async_trait::async_trait;
use std::{fs, io::Read, path::Path};

use super::FileStorage;
use crate::common::file::put_file_contents;
use crate::infra::config::CONFIG;
use crate::infra::metrics;

pub struct Local {}

#[async_trait]
impl FileStorage for Local {
    async fn list(&self, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
        let prefix = format!("{}{}", CONFIG.common.data_stream_dir, prefix);
        let root_path = Path::new(&CONFIG.common.data_stream_dir).to_str().unwrap();
        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(prefix)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_dir() {
                continue;
            }
            let f_path = entry.path().to_str().unwrap();
            let f_path = f_path[root_path.len()..].to_string();
            files.push(f_path);
        }
        Ok(files)
    }

    async fn get(&self, file: &str) -> Result<bytes::Bytes, anyhow::Error> {
        let columns = file.split('/').collect::<Vec<&str>>();
        let file = format!("{}{}", CONFIG.common.data_stream_dir, file);
        let mut file = fs::File::open(file)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;

        // metrics
        if columns[0].eq("files") {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .inc_by(data.len() as u64);
        }

        Ok(bytes::Bytes::from(data))
    }

    async fn put(&self, file: &str, data: bytes::Bytes) -> Result<(), anyhow::Error> {
        let file = format!("{}{}", CONFIG.common.data_stream_dir, file);
        let file_path = Path::new(&file);
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        let data_size = data.len();
        match put_file_contents(&file, &data) {
            Ok(_) => {
                // metrics
                let columns = file.split('/').collect::<Vec<&str>>();
                if columns[0].eq("files") {
                    metrics::STORAGE_WRITE_BYTES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .inc_by(data_size as u64);
                }
                Ok(())
            }
            Err(e) => Err(anyhow::anyhow!(e)),
        }
    }

    async fn del(&self, files: &[&str]) -> Result<(), anyhow::Error> {
        if files.is_empty() {
            return Ok(());
        }
        for file in files {
            let file = format!("{}{}", CONFIG.common.data_stream_dir, file);
            if let Err(e) = fs::remove_file(file) {
                return Err(anyhow::anyhow!(e));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod test_util {
    use super::*;
    #[actix_web::test]
    async fn test_local_storage() {
        let local = Local {};
        let file_text = "Some text";
        let file_name = "a/b/c/new_file.parquet";

        local
            .put(file_name, bytes::Bytes::from(file_text))
            .await
            .unwrap();
        assert_eq!(
            local.get(file_name).await.unwrap(),
            bytes::Bytes::from(file_text)
        );

        let resp = local.list("").await;
        assert!(resp.unwrap().contains(&file_name.to_string()));

        local.del(&[file_name]).await.unwrap();
    }
}
