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
    fn test_authz_default() {
        let authz = Authz::default();
        assert_eq!(authz.obj_id, "");
        assert_eq!(authz.parent_type, "");
        assert_eq!(authz.parent, "");
    }

    #[test]
    fn test_authz_new() {
        let authz = Authz::new("test-obj");
        assert_eq!(authz.obj_id, "test-obj");
        assert_eq!(authz.parent_type, "");
        assert_eq!(authz.parent, "");
    }

    #[test]
    fn test_authz_serialization() {
        let authz = Authz {
            obj_id: "test-obj".to_string(),
            parent_type: "test-type".to_string(),
            parent: "test-parent".to_string(),
        };

        let serialized = serde_json::to_string(&authz).unwrap();
        let deserialized: Authz = serde_json::from_str(&serialized).unwrap();

        assert_eq!(authz.obj_id, deserialized.obj_id);
        assert_eq!(authz.parent_type, deserialized.parent_type);
        assert_eq!(authz.parent, deserialized.parent);
    }

    #[test]
    fn test_authz_clone() {
        let authz = Authz {
            obj_id: "test-obj".to_string(),
            parent_type: "test-type".to_string(),
            parent: "test-parent".to_string(),
        };

        let cloned = authz.clone();
        assert_eq!(authz.obj_id, cloned.obj_id);
        assert_eq!(authz.parent_type, cloned.parent_type);
        assert_eq!(authz.parent, cloned.parent);
    }

    #[test]
    fn test_authz_debug() {
        let authz = Authz {
            obj_id: "test-obj".to_string(),
            parent_type: "test-type".to_string(),
            parent: "test-parent".to_string(),
        };

        let debug_str = format!("{:?}", authz);
        assert!(debug_str.contains("test-obj"));
        assert!(debug_str.contains("test-type"));
        assert!(debug_str.contains("test-parent"));
    }
}
