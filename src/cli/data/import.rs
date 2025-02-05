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

use std::fs;

use async_recursion::async_recursion;
use async_trait::async_trait;
use bytes::Bytes;

use crate::{
    authorization::AuthorizationClientTrait,
    cli::data::{cli::Cli, Context},
    common::meta::ingestion::IngestionRequest,
    service::logs,
};

pub struct Import<A: AuthorizationClientTrait> {
    auth_client: A,
}

impl<A: AuthorizationClientTrait> Import<A> {
    pub fn new(auth_client: A) -> Self {
        Self { auth_client }
    }
}

#[async_trait]
impl<A: AuthorizationClientTrait> Context for Import<A> {
    async fn operator(&self, c: Cli) -> Result<bool, anyhow::Error> {
        read_files_in_directory(&self.auth_client, c.clone(), c.data.as_str()).await
    }
}

#[async_recursion]
async fn read_files_in_directory<A: AuthorizationClientTrait>(
    auth_client: &A,
    c: Cli,
    dir_path: &str,
) -> Result<bool, anyhow::Error> {
    let entries = fs::read_dir(dir_path)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let content = fs::read(&path)?;
            if let Err(e) = logs::ingest::ingest(
                auth_client,
                0,
                &c.org,
                &c.stream_name,
                IngestionRequest::JSON(&Bytes::from(content)),
                "root",
                None,
            )
            .await
            {
                eprintln!("insert data fail {:?}: {:?}", path, e);
                return Ok(false);
            }
        } else if path.is_dir()
            && !read_files_in_directory(auth_client, c.clone(), &path.to_string_lossy()).await?
        {
            return Ok(false);
        }
    }
    Ok(true)
}
