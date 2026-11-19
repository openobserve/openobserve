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

use config::meta::folder::FolderType;

use crate::{errors::Error, table::folders::folder_type_into_i16};

pub const FOLDERS_WATCH_PREFIX: &str = "/folders/";

/// The type is the stored i16, so the key matches the `folders.type` column.
pub fn key(org_id: &str, folder_type: FolderType, folder_id: &str) -> String {
    let folder_type = folder_type_into_i16(folder_type);
    format!("{FOLDERS_WATCH_PREFIX}{org_id}/{folder_type}/{folder_id}")
}

/// A folder was created or renamed.
pub async fn emit_put_event(
    org_id: &str,
    folder_type: FolderType,
    folder_id: &str,
) -> Result<(), Error> {
    super::emit_put(&key(org_id, folder_type, folder_id)).await
}

/// A folder was deleted; also removes the key a put left in the coordinator.
pub async fn emit_delete_event(
    org_id: &str,
    folder_type: FolderType,
    folder_id: &str,
) -> Result<(), Error> {
    super::emit_delete(&key(org_id, folder_type, folder_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_names_org_type_and_folder() {
        assert_eq!(
            key("acme", FolderType::Alerts, "ops"),
            "/folders/acme/1/ops"
        );
        assert_eq!(
            key("acme", FolderType::Dashboards, "default"),
            "/folders/acme/0/default"
        );
    }
}
