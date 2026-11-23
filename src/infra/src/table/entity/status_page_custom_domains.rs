//! `SeaORM` Entity for the status_page_custom_domains table.

use sea_orm::entity::prelude::*;

#[derive(
    Clone, Default, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize,
)]
#[sea_orm(table_name = "status_page_custom_domains")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub status_page_id: String,
    /// Lowercased/punycode. Several orgs may claim one hostname; only the holder
    /// (`held_domain`) is unique.
    pub domain: String,
    /// CSPRNG ownership-proof value; never serialized outward except to the
    /// owning org admin.
    pub verification_token: String,
    /// 0 pending, 1 verified, 2 failed.
    pub verification_state: i32,
    /// 0 record-missing, 1 value-mismatch, 2 dns-resolution-failed, 3 held by another org,
    /// 4 proof lost. Set only when `verification_state = 2`.
    pub verification_failure_reason: Option<i32>,
    pub verified_at: Option<i64>,
    /// Set on release instead of a row delete; a row is released if this or `release_seal` is set.
    pub released_at: Option<i64>,
    pub last_checked_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Equals `domain` for the holder, NULL otherwise; the unique index lets one claim hold it.
    pub held_domain: Option<String>,
    /// Set on release by this build only, so an older build's whole-row write cannot undo it.
    pub release_seal: Option<i64>,
    /// 1 released by the org, 2 expired without a proof, 3 page deleted.
    pub release_reason: Option<i32>,
    /// First negative answer for a holder; cleared when the proof is found again.
    pub proof_failed_since: Option<i64>,
    /// When a non-holder claim is released; NULL for a holder.
    pub expires_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
