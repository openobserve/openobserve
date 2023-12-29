// Copyright 2023 Zinc Labs Inc.
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

use std::hash::{Hash, Hasher};

use arrow_schema::{Field, Schema};

/// SchemaExt helper...
pub trait SchemaExt {
    fn to_cloned_fields(&self) -> Vec<Field>;
    fn hash_key(&self) -> String;
}

impl SchemaExt for Schema {
    fn to_cloned_fields(&self) -> Vec<Field> {
        self.fields.iter().map(|x| (**x).clone()).collect()
    }

    fn hash_key(&self) -> String {
        let mut hasher = xxhash_rust::xxh3::Xxh3::new();
        self.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }
}
