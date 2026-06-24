//! `SeaORM` Entity for synthetics_monitors table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "synthetics_monitors")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub name: String,
    pub monitor_type: String,
    pub target: String,
    pub config: Json,
    pub interval_secs: i32,
    pub locations: Json,
    pub enabled: bool,
    pub next_run_at: i64,
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
            id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            folder_id: "default".to_string(),
            name: "Login Flow".to_string(),
            monitor_type: "browser".to_string(),
            target: "https://app.example.com".to_string(),
            config: serde_json::json!({"browsers": ["chromium"], "steps": []}),
            interval_secs: 300,
            locations: serde_json::json!(["aws-us-east-1"]),
            enabled: true,
            next_run_at: 0,
            created_at: 1750000000000000,
            updated_at: 1750000000000000,
        };
        assert_eq!(m.id, "mon-1");
        assert_eq!(m.monitor_type, "browser");
        assert!(m.enabled);
        assert_eq!(m.interval_secs, 300);
    }
}
