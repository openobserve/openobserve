//! `SeaORM` Entity for synthetics_jobs table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "synthetics_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    pub synthetics_id: String,
    pub synthetics_name: String,
    pub org_id: String,
    pub location: String,
    pub pool: String,
    pub browser_engine: Option<String>,
    /// Viewport device preset: "laptop_large" | "tablet" | "mobile_small"
    pub device: Option<String>,
    pub scheduled_ts: i64,
    pub valid_until: i64,
    /// 0 = Pending, 1 = Leased, 2 = Dead
    pub status: i32,
    pub claimed_by: Option<String>,
    pub claimed_at: Option<i64>,
    pub lease_expires_at: Option<i64>,
    pub attempts: i32,
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
            id: 1,
            synthetics_id: "mon-1".to_string(),
            synthetics_name: "Login Flow".to_string(),
            org_id: "org1".to_string(),
            location: "aws-us-east-1".to_string(),
            pool: "aws-browser-chromium".to_string(),
            browser_engine: Some("chromium".to_string()),
            device: Some("laptop_large".to_string()),
            scheduled_ts: 1750000000000000,
            valid_until: 1750000300000000,
            status: 0,
            claimed_by: None,
            claimed_at: None,
            lease_expires_at: None,
            attempts: 0,
        };
        assert_eq!(m.id, 1);
        assert_eq!(m.synthetics_id, "mon-1");
        assert_eq!(m.synthetics_name, "Login Flow");
        assert_eq!(m.status, 0);
        assert_eq!(m.pool, "aws-browser-chromium");
        assert!(m.claimed_by.is_none());
    }
}
