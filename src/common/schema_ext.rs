use arrow_schema::{Field, Schema};
/// SchemaExt helper...
pub trait SchemaExt {
    fn to_cloned_fields(&self) -> Vec<Field>;
}

impl SchemaExt for Schema {
    fn to_cloned_fields(&self) -> Vec<Field> {
        self.fields.iter().map(|x| (**x).clone()).collect()
    }
}
