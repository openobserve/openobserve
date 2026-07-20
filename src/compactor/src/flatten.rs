// Copyright 2026 OpenObserve Inc.
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

use config::{FileFormat, get_config};

/// Generates the storage key of the flattened version of a data file.
pub fn generate_flatten_file_key(file_key: &str) -> String {
    let key = file_key.strip_prefix("files/").unwrap_or(file_key);
    let key = match FileFormat::from_extension(key) {
        Some(format) => key.strip_suffix(format.extension()).unwrap_or(key),
        None => key,
    };
    format!(
        "files{}/{}{}",
        get_config().common.column_all,
        key,
        FileFormat::Parquet.extension()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flattened_files_always_use_parquet_extension() {
        let column_all = &get_config().common.column_all;
        assert_eq!(
            generate_flatten_file_key("files/default/logs/quickstart/2026/07/02/12/abc.vortex"),
            format!("files{column_all}/default/logs/quickstart/2026/07/02/12/abc.parquet")
        );
    }
}
