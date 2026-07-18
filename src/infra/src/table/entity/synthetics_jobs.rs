//! `SeaORM` Entity for synthetics_jobs table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "synthetics_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub synthetics_id: String,
    pub synthetics_name: String,
    pub org_id: String,
    pub location: String,
    pub pool: String,
    pub scheduled_ts: i64,
    pub valid_until: i64,
    /// 0=Pending, 1=Leased, 2=Dead, 3=Passed, 4=Failed, 5=Warning
    pub status: i32,
    pub claimed_by: Option<String>,
    pub claimed_at: Option<i64>,
    pub lease_expires_at: Option<i64>,
    /// How many times the control plane has tried to *dispatch* this job to a
    /// runner (Lambda invoke failed, or invoked-but-never-acked timeout).
    /// Unrelated to Playwright-level journey retries — see `Synthetic.retries`.
    pub dispatch_attempts: i32,
    /// KSUID of the parent run (all jobs for one scheduled slot share this).
    pub run_id: String,
    /// JSON array of BrowserDevice {execution_id, engine, device} — browser monitors only.
    pub browser_devices: Option<String>,
    /// JSON blob of monitor metadata copied at enqueue time e.g. {"tags": ["prod"]}.
    pub metadata: String,
    /// JSON execution summaries written at ack time (no full step data — that's in the stream).
    pub result: Option<String>,
    /// UTC µs: when Lambda first resolved this job.
    pub started_at: Option<i64>,
    /// UTC µs: when the job was acked (completed or dead-lettered).
    pub completed_at: Option<i64>,
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
            id: "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
            synthetics_id: "mon-1".to_string(),
            synthetics_name: "Login Flow".to_string(),
            org_id: "org1".to_string(),
            location: "aws-us-east-1".to_string(),
            pool: "aws-browser".to_string(),
            scheduled_ts: 1750000000000000,
            valid_until: 1750000300000000,
            status: 0,
            claimed_by: None,
            claimed_at: None,
            lease_expires_at: None,
            dispatch_attempts: 0,
            run_id: "3Fzn001XXXXXXXXXXXXXXXX".to_string(),
            browser_devices: Some(
                r#"[{"execution_id":"3Fze001XX","engine":"chromium","device":"desktop"}]"#
                    .to_string(),
            ),
            metadata: "{}".to_string(),
            result: None,
            started_at: None,
            completed_at: None,
        };
        assert_eq!(m.id, "2MNfNTxePfZ1pnY5gKVLkwsVRXv");
        assert_eq!(m.synthetics_id, "mon-1");
        assert_eq!(m.synthetics_name, "Login Flow");
        assert_eq!(m.status, 0);
        assert_eq!(m.pool, "aws-browser");
        assert!(m.claimed_by.is_none());
    }
}
