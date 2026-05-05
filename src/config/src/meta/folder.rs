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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::stats::MemorySize;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct Folder {
    pub folder_id: String,
    pub name: String,
    pub description: String,
}

impl MemorySize for Folder {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Folder>()
            + self.folder_id.mem_size()
            + self.name.mem_size()
            + self.description.mem_size()
    }
}

/// Indicates the type of data that the folder can contain.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq, ToSchema)]
pub enum FolderType {
    #[default]
    Dashboards,
    Alerts,
    Reports,
}

pub const DEFAULT_FOLDER: &str = "default";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_folder_constant() {
        assert_eq!(DEFAULT_FOLDER, "default");
    }

    #[test]
    fn test_folder_default_has_empty_fields() {
        let f = Folder::default();
        assert!(f.folder_id.is_empty());
        assert!(f.name.is_empty());
        assert!(f.description.is_empty());
    }

    #[test]
    fn test_folder_equality() {
        let a = Folder {
            folder_id: "id1".to_string(),
            name: "My Folder".to_string(),
            description: "desc".to_string(),
        };
        let b = a.clone();
        assert_eq!(a, b);
    }

    #[test]
    fn test_folder_type_default_is_dashboards() {
        assert_eq!(FolderType::default(), FolderType::Dashboards);
    }

    #[test]
    fn test_folder_mem_size_at_least_struct_size() {
        let f = Folder {
            folder_id: "abc".to_string(),
            name: "n".to_string(),
            description: "d".to_string(),
        };
        assert!(f.mem_size() >= std::mem::size_of::<Folder>());
    }
}
