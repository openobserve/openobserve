use sea_orm::{entity::prelude::*, FromQueryResult};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "short_urls")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub short_id: String,
    #[sea_orm(column_type = "Text")]
    pub original_url: String,
    pub created_ts: i64,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[allow(dead_code)]
#[derive(FromQueryResult, Debug)]
pub struct ShortUrlRecord {
    #[allow(dead_code)]
    pub short_id: String,
    pub original_url: String,
}

impl ShortUrlRecord {
    pub fn new(short_id: &str, original_url: &str) -> Self {
        Self {
            short_id: short_id.to_string(),
            original_url: original_url.to_string(),
        }
    }
}

#[allow(dead_code)]
#[derive(FromQueryResult, Debug)]
pub struct ShortId {
    #[allow(dead_code)]
    pub short_id: String,
}
