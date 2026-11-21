//! `SeaORM` Entity for the `paid_overage_attribution` table (who last turned paid usage on or off).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "paid_overage_attribution")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    /// A `TrialQuotaPool` key; consent is one value per pool, not per feature row.
    #[sea_orm(primary_key, auto_increment = false)]
    pub pool: String,
    pub enabled_by_email: Option<String>,
    pub enabled_at: Option<i64>,
    pub disabled_by_email: Option<String>,
    pub disabled_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
