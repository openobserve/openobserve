use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "trial_quota_usage")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub feature: String,
    pub usage_count: i64,
    pub updated_at: i64,
    pub notified_checkpoint: i16,
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
            org_id: "org".to_string(),
            feature: "ingest".to_string(),
            usage_count: 100,
            updated_at: 1000,
            notified_checkpoint: 0,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.usage_count, 100);
        assert_eq!(m.notified_checkpoint, 0);
    }
}
