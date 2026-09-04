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

use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
};

use arrow_schema::{Field, Schema};
use hashbrown::HashSet;

/// SchemaExt helper...
pub trait SchemaExt {
    fn to_cloned_fields(&self) -> Vec<Field>;
    fn cloned_from(&self, schema: &Schema) -> Schema;
    fn retain(&self, fields: HashSet<String>) -> Schema;
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
        let latest_schema_map: HashMap<_, _> = schema
            .fields()
            .iter()
            .map(|field| (field.name(), field))
            .collect();
        let fields = self
            .fields()
            .iter()
            .map(|f| match latest_schema_map.get(f.name()) {
                Some(f) => (*f).clone(),
                None => f.clone(),
            })
            .collect::<Vec<_>>();
        Schema::new(fields)
    }

    // create a new schema with only the fields in the set and keep the order
    fn retain(&self, fields: HashSet<String>) -> Schema {
        let fields = self
            .fields()
            .iter()
            .filter(|f| fields.contains(f.name()))
            .cloned()
            .collect::<Vec<_>>();
        Schema::new(fields)
    }

    #[cfg(feature = "gxhash")]
    fn hash_key(&self) -> String {
        let mut hasher = gxhash::GxHasher::with_seed(0);
        self.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    #[cfg(not(feature = "gxhash"))]
    fn hash_key(&self) -> String {
        let mut hasher = std::hash::DefaultHasher::new();
        self.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    fn size(&self) -> usize {
        let mut size = std::mem::size_of::<arrow_schema::Fields>();
        size += self.fields.iter().fold(0, |acc, field| acc + field.size());
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

#[cfg(test)]
mod tests {
    use arrow_schema::DataType;

    use super::*;

    #[test]
    fn test_schema_hash() {
        let schema1 = Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("address", DataType::Utf8, false),
            Field::new("priority", DataType::UInt8, false),
        ]);
        let schema2 = Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("address", DataType::Utf8, false),
            Field::new("priority", DataType::UInt8, false),
            Field::new("flag", DataType::UInt8, false),
        ]);
        assert_ne!(schema1.hash_key(), schema2.hash_key());
        assert_eq!(schema1.hash_key().len(), 16);
        assert_eq!(schema2.hash_key().len(), 16);
    }

    #[test]
    fn test_schema_hash_is_deterministic() {
        let schema = Schema::new(vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, true),
        ]);
        assert_eq!(schema.hash_key(), schema.hash_key());
    }

    #[test]
    fn test_schema_hash_field_order_matters() {
        let s1 = Schema::new(vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, false),
        ]);
        let s2 = Schema::new(vec![
            Field::new("b", DataType::Utf8, false),
            Field::new("a", DataType::Int64, false),
        ]);
        assert_ne!(s1.hash_key(), s2.hash_key());
    }

    #[test]
    fn test_to_cloned_fields() {
        let fields = vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, true),
        ];
        let schema = Schema::new(fields.clone());
        let cloned = schema.to_cloned_fields();
        assert_eq!(cloned.len(), fields.len());
        for (orig, got) in fields.iter().zip(cloned.iter()) {
            assert_eq!(orig.name(), got.name());
            assert_eq!(orig.data_type(), got.data_type());
            assert_eq!(orig.is_nullable(), got.is_nullable());
        }
    }

    #[test]
    fn test_to_cloned_fields_empty() {
        let schema = Schema::new(Vec::<Field>::new());
        assert!(schema.to_cloned_fields().is_empty());
    }

    #[test]
    fn test_cloned_from_overrides_with_latest_types() {
        // `self` has Utf8 for `priority`; `latest` upgrades it to UInt8.
        // cloned_from should prefer the latest schema's field definition.
        let original = Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("priority", DataType::Utf8, false),
        ]);
        let latest = Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("priority", DataType::UInt8, false),
            Field::new("extra", DataType::Int32, true),
        ]);
        let merged = original.cloned_from(&latest);

        // Field count follows `self`, not `latest`.
        assert_eq!(merged.fields().len(), 2);
        let priority = merged.field_with_name("priority").unwrap();
        assert_eq!(priority.data_type(), &DataType::UInt8);
        assert!(merged.field_with_name("extra").is_err());
    }

    #[test]
    fn test_cloned_from_keeps_self_field_when_missing_in_latest() {
        let original = Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("legacy", DataType::Int32, true),
        ]);
        let latest = Schema::new(vec![Field::new("name", DataType::Utf8, false)]);
        let merged = original.cloned_from(&latest);

        assert_eq!(merged.fields().len(), 2);
        let legacy = merged.field_with_name("legacy").unwrap();
        assert_eq!(legacy.data_type(), &DataType::Int32);
    }

    #[test]
    fn test_retain_keeps_only_named_fields_in_original_order() {
        let schema = Schema::new(vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, false),
            Field::new("c", DataType::Boolean, true),
        ]);
        let mut keep = HashSet::new();
        keep.insert("c".to_string());
        keep.insert("a".to_string());

        let result = schema.retain(keep);
        let names: Vec<&str> = result.fields().iter().map(|f| f.name().as_str()).collect();
        // Order should follow the original schema, not the HashSet insertion order.
        assert_eq!(names, vec!["a", "c"]);
    }

    #[test]
    fn test_retain_with_unknown_names_is_ignored() {
        let schema = Schema::new(vec![Field::new("a", DataType::Int64, false)]);
        let mut keep = HashSet::new();
        keep.insert("does_not_exist".to_string());
        let result = schema.retain(keep);
        assert!(result.fields().is_empty());
    }

    #[test]
    fn test_retain_empty_set_returns_empty_schema() {
        let schema = Schema::new(vec![Field::new("a", DataType::Int64, false)]);
        let result = schema.retain(HashSet::new());
        assert!(result.fields().is_empty());
    }

    #[test]
    fn test_simple_fields() {
        let schema = Schema::new(vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, true),
        ]);
        let simple = schema.simple_fields();
        assert_eq!(
            simple,
            vec![
                ("a".to_string(), "Int64".to_string()),
                ("b".to_string(), "Utf8".to_string()),
            ]
        );
    }

    #[test]
    fn test_simple_fields_empty() {
        let schema = Schema::new(Vec::<Field>::new());
        assert!(schema.simple_fields().is_empty());
    }

    #[test]
    fn test_size_grows_with_fields_and_metadata() {
        let small = Schema::new(vec![Field::new("a", DataType::Int64, false)]);
        let larger = Schema::new(vec![
            Field::new("a", DataType::Int64, false),
            Field::new("b", DataType::Utf8, false),
        ]);
        assert!(larger.size() > small.size());

        let mut metadata = HashMap::new();
        metadata.insert("k".to_string(), "v".to_string());
        let with_meta =
            Schema::new(vec![Field::new("a", DataType::Int64, false)]).with_metadata(metadata);
        assert!(with_meta.size() > small.size());
    }
}
