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

use object_store::path::Path;

pub mod file_list;
pub mod file_statistics_cache;
pub mod memory;
pub mod wal;

const TRACE_ID_SEPARATOR: &str = "$$";
const ACCOUNT_SEPARATOR: &str = "::";

fn format_location(location: &Path) -> (String, Path) {
    let mut path = location.to_string();
    if let Some(p) = path.find("/$$/") {
        path = path[p + 4..].to_string();
    }
    let mut account = String::new();
    if path.starts_with("::/") {
        // the `//` was format to `/`, so we can't find `/::/`, need to check `::/`
        // account is empty, and we need to remove the `::/` as path
        path = path[3..].to_string();
    } else if let Some(p) = path.find("/::/") {
        account = path[..p].to_string();
        path = path[p + 4..].to_string();
    }
    (account.to_string(), path.into())
}
