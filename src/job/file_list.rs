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

// local mode:
// -- do nothing

// cluster mode:
// -- 1. check if there are old file_list db then compress and upload to s3
// -- 2. metadata server, every minute check s3 if there are new file_list db, download and merge to local db

pub async fn run() -> Result<(), anyhow::Error> {
    Ok(())
}
