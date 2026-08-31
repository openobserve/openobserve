// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use sea_orm::{ColumnTrait, EntityTrait, Order, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};

use super::super::entity::search_job_results::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors, orm_err,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobResultOperator {
    Delete { job_id: String },
}

pub async fn get(job_id: &str) -> Result<Vec<Model>, errors::Error> {
    let client = get_orm_client_ro().await;

    let res = Entity::find()
        .filter(Column::JobId.eq(job_id))
        .order_by(Column::StartedAt, Order::Asc)
        .all(client)
        .await;

    match res {
        Ok(res) => Ok(res),
        Err(e) => orm_err!(format!("get_search_job_results failed: {}", e)),
    }
}

pub async fn clean_deleted_job_result(job_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;

    let res = Entity::delete_many()
        .filter(Column::JobId.eq(job_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("delete_search_job_results failed: {}", e));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_result_operator_construction() {
        let op = JobResultOperator::Delete {
            job_id: "abc-123".to_string(),
        };
        let JobResultOperator::Delete { job_id } = op;
        assert_eq!(job_id, "abc-123");
    }

    #[test]
    fn test_job_result_operator_serde_roundtrip() {
        let op = JobResultOperator::Delete {
            job_id: "xyz-456".to_string(),
        };
        let json = serde_json::to_string(&op).unwrap();
        let back: JobResultOperator = serde_json::from_str(&json).unwrap();
        let JobResultOperator::Delete { job_id } = back;
        assert_eq!(job_id, "xyz-456");
    }

    #[test]
    fn test_job_result_operator_clone() {
        let op = JobResultOperator::Delete {
            job_id: "clone-test".to_string(),
        };
        let cloned = op.clone();
        let JobResultOperator::Delete { job_id: j1 } = op;
        let JobResultOperator::Delete { job_id: j2 } = cloned;
        assert_eq!(j1, j2);
    }
}
