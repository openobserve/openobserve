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

use bytes::Bytes;
use crate::storage::{get, put};

pub async fn test_s3_config() -> Result<(), anyhow::Error> {
    let test_file = "test/test2/s3_test.txt";
    // Test download
    if let Err(e) = get(test_file).await {
        if !e.to_string().contains("404") {
            return Err(anyhow::anyhow!("S3 download test failed: {:?}", e));
        } else {
            let test_content = Bytes::from("Hello, S3!");
            // Test upload
            if let Err(e) = put(test_file, test_content.clone()).await {
                return Err(anyhow::anyhow!("S3 upload test failed: {:?}", e));
            }
        }
    }

    Ok(())
}
