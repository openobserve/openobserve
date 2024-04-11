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

use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    sync::Arc,
};

use arrow_schema::{Field, Schema};

const HASH_MAP_SIZE: usize = std::mem::size_of::<HashMap<String, String>>();

/// SchemaExt helper...
pub trait SchemaExt {
    fn to_cloned_fields(&self) -> Vec<Field>;
    fn cloned_from(&self, schema: &Schema) -> Schema;
    fn hash_key(&self) -> String;
    fn size(&self) -> usize;
}

impl SchemaExt for Schema {
    fn to_cloned_fields(&self) -> Vec<Field> {
        self.fields.iter().map(|x| (**x).clone()).collect()
    }

    // ensure schema is compatible
    fn cloned_from(&self, schema: &Schema) -> Schema {
        let mut schema_latest_map = HashMap::with_capacity(schema.fields().len());
        for field in schema.fields() {
            schema_latest_map.insert(field.name(), field.clone());
        }

        let mut fields = Vec::with_capacity(self.fields().len());
        for field in self.fields() {
            match schema_latest_map.get(field.name()) {
                Some(f) => {
                    fields.push(f.clone());
                }
                None => {
                    fields.push(field.clone());
                }
            }
        }
        Schema::new(fields)
    }

    fn hash_key(&self) -> String {
        let mut hasher = gxhash::GxHasher::with_seed(0);
        self.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    fn size(&self) -> usize {
        let mut size = self.fields.iter().fold(0, |acc, field| acc + field.size()) + HASH_MAP_SIZE;
        size += std::mem::size_of::<HashMap<String, String>>();
        for (key, val) in self.metadata.iter() {
            size += std::mem::size_of::<String>() * 2;
            size += key.len() + val.len();
        }
        size
    }
}
