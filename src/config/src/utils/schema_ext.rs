// Copyright 2024 Zinc Labs Inc.
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
};

use arrow_schema::{Field, Schema};

const HASH_MAP_SIZE: usize = std::mem::size_of::<HashMap<String, String>>();

/// SchemaExt helper...
pub trait SchemaExt {
    fn to_cloned_fields(&self) -> Vec<Field>;
    fn cloned_from(&self, schema: &Schema) -> Schema;
    fn hash_key(&self) -> String;
    fn size(&self) -> usize;
    fn simple_fields(&self) -> Vec<(String, String)>;
}

impl SchemaExt for Schema {
    fn to_cloned_fields(&self) -> Vec<Field> {
        self.fields.iter().map(|x| (**x).clone()).collect()
    }

    // ensure schema is compatible
    fn cloned_from(&self, schema: &Schema) -> Schema {
        let schema_latest_map: HashMap<_, _> = schema
            .fields()
            .iter()
            .map(|field| (field.name(), field))
            .collect();
        let fields = self
            .fields()
            .iter()
            .map(|f| match schema_latest_map.get(f.name()) {
                Some(f) => (*f).clone(),
                None => f.clone(),
            })
            .collect::<Vec<_>>();
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

    fn simple_fields(&self) -> Vec<(String, String)> {
        self.fields
            .iter()
            .map(|x| (x.name().to_string(), x.data_type().to_string()))
            .collect()
    }
}
