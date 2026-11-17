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

use config::utils::json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::db::kv;

const KV_KEY: &str = "sample_data";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SampleDataStatus {
    #[default]
    None,
    Loaded,
}

/// The time window the org's sample data was loaded into, in microseconds since the epoch.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
pub struct SampleDataState {
    pub status: SampleDataStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct PutSampleDataRequest {
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum SampleDataError {
    #[error("{0}")]
    Invalid(&'static str),
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

pub async fn get(org_id: &str) -> Result<SampleDataState, anyhow::Error> {
    // The table, not the KV cache, so a store error is not read as "no sample data".
    match infra::table::kv_store::get(org_id, KV_KEY).await? {
        Some(row) => Ok(json::from_slice(&row.value)?),
        None => Ok(SampleDataState::default()),
    }
}

pub async fn put(
    org_id: &str,
    req: PutSampleDataRequest,
) -> Result<SampleDataState, SampleDataError> {
    if req.start_time >= req.end_time {
        return Err(SampleDataError::Invalid(
            "start_time must be lower than end_time",
        ));
    }
    let state = SampleDataState {
        status: SampleDataStatus::Loaded,
        start_time: Some(req.start_time),
        end_time: Some(req.end_time),
    };
    let value = json::to_vec(&state).map_err(anyhow::Error::from)?;
    kv::set(org_id, KV_KEY, value.into()).await?;
    Ok(state)
}

pub async fn delete(org_id: &str) -> Result<(), anyhow::Error> {
    kv::delete(org_id, KV_KEY).await
}

#[cfg(test)]
mod tests {
    use infra::table::entity::kv_store::Entity;
    use sea_orm::{ConnectionTrait, Schema};

    use super::*;

    async fn setup() -> String {
        infra::db::create_table().await.unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        let backend = conn.get_database_backend();
        let mut stmt = Schema::new(backend).create_table_from_entity(Entity);
        conn.execute(backend.build(stmt.if_not_exists()))
            .await
            .unwrap();
        format!("sample_data_{}", config::ider::uuid())
    }

    fn window(start_time: i64, end_time: i64) -> PutSampleDataRequest {
        PutSampleDataRequest {
            start_time,
            end_time,
        }
    }

    #[test]
    fn an_unset_state_serializes_to_status_none_only() {
        let body = json::to_string(&SampleDataState::default()).unwrap();
        assert_eq!(body, r#"{"status":"none"}"#);
    }

    #[tokio::test]
    async fn get_without_a_stored_state_is_status_none() {
        let org = setup().await;
        assert_eq!(get(&org).await.unwrap(), SampleDataState::default());
    }

    #[tokio::test]
    async fn put_refuses_a_window_that_does_not_move_forward() {
        let org = setup().await;
        for (start, end) in [(200, 100), (100, 100)] {
            let err = put(&org, window(start, end)).await.unwrap_err();
            assert!(matches!(err, SampleDataError::Invalid(_)), "{start}..{end}");
        }
        assert_eq!(get(&org).await.unwrap(), SampleDataState::default());
    }

    #[tokio::test]
    async fn get_after_put_returns_the_saved_window() {
        let org = setup().await;
        let saved = put(&org, window(100, 200)).await.unwrap();
        assert_eq!(saved.status, SampleDataStatus::Loaded);
        assert_eq!((saved.start_time, saved.end_time), (Some(100), Some(200)));
        assert_eq!(get(&org).await.unwrap(), saved);
    }

    #[tokio::test]
    async fn get_after_delete_is_status_none_and_delete_is_idempotent() {
        let org = setup().await;
        put(&org, window(100, 200)).await.unwrap();
        delete(&org).await.unwrap();
        assert_eq!(get(&org).await.unwrap(), SampleDataState::default());
        delete(&org).await.unwrap();
        assert_eq!(get(&org).await.unwrap(), SampleDataState::default());
    }
}
