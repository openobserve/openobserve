//! `SeaORM` Entity for synthetics_runs table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "synthetics_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub synthetics_id: String,
    pub org_id: String,
    pub scheduled_ts: i64,
    pub trigger_type: String,
    pub job_count: i32,
    pub jobs_done: i32,
    /// NULL until at least one job completes. Uses SyntheticStatus DB integers: 1=Passed,
    /// 2=Warning, 3=Failed, 4=Error. Tracks worst-case across all jobs.
    pub run_result: Option<i32>,
    pub created_at: i64,
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
            id: "3Fzn001XXXXXXXXXXXXXXXX".to_string(),
            synthetics_id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            scheduled_ts: 1750000000000000,
            trigger_type: "schedule".to_string(),
            job_count: 2,
            jobs_done: 0,
            run_result: None,
            created_at: 1750000000000000,
            completed_at: None,
        };
        assert_eq!(m.id, "3Fzn001XXXXXXXXXXXXXXXX");
        assert_eq!(m.job_count, 2);
        assert_eq!(m.jobs_done, 0);
        assert!(m.run_result.is_none());
        assert!(m.completed_at.is_none());
    }
}
