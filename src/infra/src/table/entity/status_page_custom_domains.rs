//! `SeaORM` Entity for the status_page_custom_domains table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "status_page_custom_domains")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub status_page_id: String,
    /// Lowercased/punycode. Unique among live (non-tombstoned) rows —
    /// enforced at the app layer, not a DB constraint (see the migration).
    pub domain: String,
    /// CSPRNG ownership-proof value; never serialized outward except to the
    /// owning org admin.
    pub verification_token: String,
    /// 0 pending, 1 verified, 2 failed.
    pub verification_state: i32,
    /// 0 record-missing, 1 value-mismatch, 2 dns-resolution-failed. Set only
    /// when `verification_state = 2`.
    pub verification_failure_reason: Option<i32>,
    pub verified_at: Option<i64>,
    /// Tombstone: set on delete instead of a hard row delete, so a re-claim by
    /// a different org is distinguishable from the original owner returning.
    pub released_at: Option<i64>,
    pub last_checked_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
