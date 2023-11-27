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

use datafusion::arrow::datatypes::{Field, Schema};
use itertools::Itertools;

use crate::common::utils::schema_ext::SchemaExt;

#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Signature(pub [u8; 32]);

impl From<Signature> for String {
    fn from(sig: Signature) -> Self {
        hex::encode(sig.0)
    }
}

pub fn get_fields_key(fields: &[Field]) -> String {
    let mut hasher = blake3::Hasher::new();
    fields.iter().sorted_by_key(|v| v.name()).for_each(|field| {
        hasher.update(field.name().as_bytes());
        hasher.update(field.data_type().to_string().as_bytes());
    });
    Signature(hasher.finalize().into()).into()
}

pub fn get_schema_key(schema: &Schema) -> String {
    get_fields_key(&schema.to_cloned_fields())
}

pub fn get_schema_key_xxh3(schema: &Schema) -> String {
    get_fields_key_xxh3(&schema.to_cloned_fields())
}

pub fn get_fields_key_xxh3(fields: &[Field]) -> String {
    let mut hasher = xxhash_rust::xxh3::Xxh3::new();
    for field in fields.iter().sorted_by_key(|v| v.name()) {
        hasher.update(field.name().as_bytes());
        hasher.update(field.data_type().to_string().as_bytes());
    }
    let hash = hasher.digest();
    format!("{hash:x}")
}

#[cfg(test)]
mod test {

    use arrow_schema::{DataType, Field};

    use super::*;

    #[actix_web::test]
    async fn test_ingest() {
        let mut schmea_vec = vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
        ];

        for i in 0..30 {
            schmea_vec.push(Field::new(format!("field_{}", i), DataType::Utf8, false));
        }

        let schema = Schema::new(schmea_vec);

        let start1 = std::time::Instant::now();
        for _ in 0..100000 {
            get_schema_key(&schema);
        }
        log::info!("Time taken for blake3: {:?}", start1.elapsed());

        let start2 = std::time::Instant::now();
        for _ in 0..100000 {
            get_schema_key_xxh3(&schema);
        }
        log::info!("Time taken for xxh3: {:?}", start2.elapsed());
    }
}
