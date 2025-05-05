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

pub async fn get_range(path: &Path, range: Range<usize>) -> Result<bytes::Bytes> {
    DEFAULT.get_range(path, range).await
}

pub async fn head(path: &Path) -> Result<ObjectMeta> {
    DEFAULT.head(path).await
}
