//! `SeaORM` Entity for pipeline_last_errors table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "pipeline_last_errors")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub pipeline_id: String,
    pub org_id: String,
    pub pipeline_name: String,
    pub last_error_timestamp: i64,
    pub error_summary: Option<String>,
    pub node_errors: Option<Json>,
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
            pipeline_id: "pipe-1".to_string(),
            org_id: "myorg".to_string(),
            pipeline_name: "my-pipeline".to_string(),
            last_error_timestamp: 1000,
            error_summary: Some("connection refused".to_string()),
            node_errors: Some(serde_json::json!([{"node": "n1", "error": "timeout"}])),
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.pipeline_id, "pipe-1");
        assert_eq!(m.org_id, "myorg");
        assert_eq!(m.pipeline_name, "my-pipeline");
        assert!(m.error_summary.is_some());
        assert!(m.node_errors.is_some());
    }
}
