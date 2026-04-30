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

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct Authz {
    pub obj_id: String,
    pub parent_type: String,
    pub parent: String,
}

impl Authz {
    pub fn new(obj_id: &str) -> Authz {
        Authz {
            obj_id: obj_id.to_string(),
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_authz_new() {
        let authz = Authz::new("test-obj");
        assert_eq!(authz.obj_id, "test-obj");
        assert_eq!(authz.parent_type, "");
        assert_eq!(authz.parent, "");
    }

    #[test]
    fn test_authz_default_is_empty() {
        let authz = Authz::default();
        assert_eq!(authz.obj_id, "");
        assert_eq!(authz.parent_type, "");
        assert_eq!(authz.parent, "");
    }

    #[test]
    fn test_authz_new_empty_id() {
        let authz = Authz::new("");
        assert_eq!(authz.obj_id, "");
    }

    #[test]
    fn test_authz_field_mutation() {
        let mut authz = Authz::new("obj1");
        authz.parent_type = "dashboard".to_string();
        authz.parent = "folder_id".to_string();
        assert_eq!(authz.obj_id, "obj1");
        assert_eq!(authz.parent_type, "dashboard");
        assert_eq!(authz.parent, "folder_id");
    }
}
