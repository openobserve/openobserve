// Copyright 2023 Zinc Labs Inc.
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

use crate::service::db;

pub async fn load(prefix: &str) -> Result<(), anyhow::Error> {
    db::file_list::remote::cache(prefix, false)
        .await
        .expect("file list migration failed");
    db::file_list::remote::cache_stats()
        .await
        .expect("file list migration stream stats failed");
    Ok(())
}
