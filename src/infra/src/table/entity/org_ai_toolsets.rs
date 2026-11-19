//! `SeaORM` Entity for the `org_ai_toolsets` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "org_ai_toolsets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub name: String,
    pub kind: String,
    pub description: Option<String>,
    /// Encrypted at rest with the org's DEK. `None` when no config is needed.
    pub data: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Never sent to, nor overwritten from, another region.
    pub region_only: bool,
    /// The region whose write this row holds; `None` for this region's own.
    pub origin_region: Option<String>,
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
            id: "ts-1".to_string(),
            org: "myorg".to_string(),
            name: "My Toolset".to_string(),
            kind: "mcp".to_string(),
            description: Some("test toolset".to_string()),
            data: Some("encrypted-data".to_string()),
            created_by: "admin@example.com".to_string(),
            created_at: 1000,
            updated_at: 2000,
            region_only: false,
            origin_region: None,
        };
        assert_eq!(m.id, "ts-1");
        assert_eq!(m.org, "myorg");
        assert_eq!(m.kind, "mcp");
        assert!(m.description.is_some());
        assert!(m.data.is_some());
    }
}
