// Copyright 2023 Zinc Labs Inc.
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

use std::fs;

use bytes::Bytes;

use crate::{
    cli::data::{cli::Cli, Context},
    common::meta::ingestion::IngestionRequest,
    service::logs,
};

pub struct Import {}

impl Context for Import {
    fn operator(c: Cli) -> Result<bool, anyhow::Error> {
        read_files_in_directory(c.clone(), c.data.as_str())
    }
}

fn read_files_in_directory(c: Cli, dir_path: &str) -> Result<bool, anyhow::Error> {
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let entries = fs::read_dir(dir_path)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                let content = fs::read(&path)?;
                if let Err(e) = logs::ingest::ingest(
                    &c.org,
                    &c.stream_name,
                    IngestionRequest::JSON(&Bytes::from(content)),
                    0,
                )
                .await
                {
                    eprintln!("insert data fail {:?}: {:?}", path, e);
                    return Ok(false);
                }
            } else if path.is_dir() && !read_files_in_directory(c.clone(), &path.to_string_lossy())?
            {
                return Ok(false);
            }
        }
        Ok(true)
    })
}
