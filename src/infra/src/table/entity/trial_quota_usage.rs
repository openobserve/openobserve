use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "trial_quota_usage")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub feature: String,
    pub usage_count: i64,
    pub usage_limit: Option<i64>,
    pub updated_at: i64,
    pub notified_checkpoint: i16,
    /// `YYYYMM` of the month this counter belongs to; `0` is a lifetime grant that never resets.
    pub period: i32,
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
            usage_limit: Some(1_000),
            updated_at: 1000,
            notified_checkpoint: 0,
            period: 202609,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.usage_count, 100);
        assert_eq!(m.usage_limit, Some(1_000));
        assert_eq!(m.notified_checkpoint, 0);
        assert_eq!(m.period, 202609);
    }

    /// §7.2: `period` in the key gives each month its own row and loses the `usage_limit` override.
    #[test]
    fn period_is_not_part_of_the_primary_key() {
        use sea_orm::Iterable;

        let key: Vec<String> = PrimaryKey::iter()
            .map(|k| k.into_column().as_str().to_string())
            .collect();
        assert_eq!(key, vec!["org_id", "feature"]);
    }
}
