//! `SeaORM` Entity for model_pricing table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "model_pricing")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub name: String,
    pub match_pattern: String,
    pub enabled: bool,
    pub tiers: Json,
    pub valid_from: Option<i64>,
    pub sort_order: i32,
    pub source: String,
    pub provider: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_construction() {
        let m = Model {
            id: "price-1".to_string(),
            org: "org".to_string(),
            name: "gpt-4".to_string(),
            match_pattern: "gpt-4.*".to_string(),
            enabled: true,
            tiers: serde_json::json!([]),
            valid_from: None,
            sort_order: 0,
            source: "manual".to_string(),
            provider: Some("openai".to_string()),
            description: None,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.org, "org");
        assert!(m.enabled);
        assert_eq!(m.sort_order, 0);
    }
}
