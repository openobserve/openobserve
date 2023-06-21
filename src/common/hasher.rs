use arrow_schema::{Field, Schema};
use itertools::Itertools;

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
    get_fields_key(schema.fields())
}

pub fn get_schema_key_xxh3(schema: &Schema) -> String {
    get_fields_key_xxh3(schema.fields())
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
