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

use std::collections::HashSet;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, Set,
};

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::entity::gen_ai_agents::{ActiveModel, Column, Entity, Model},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRecord {
    pub agent_key: String,
    pub org_id: String,
    pub stream_type: String,
    pub stream_name: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub env: Option<String>,
    pub version: Option<String>,
    pub identity_source: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentListFilter {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub source_stream: Option<String>,
    pub source_stream_type: Option<String>,
}

impl From<AgentRecord> for ActiveModel {
    fn from(record: AgentRecord) -> Self {
        Self {
            agent_key: Set(record.agent_key),
            org_id: Set(record.org_id),
            stream_type: Set(record.stream_type),
            stream_name: Set(record.stream_name),
            agent_id: Set(record.agent_id),
            agent_name: Set(record.agent_name),
            env: Set(record.env),
            agent_version: Set(record.version),
            identity_source: Set(record.identity_source),
            first_seen: Set(record.first_seen),
            last_seen: Set(record.last_seen),
            created_at: Set(record.created_at),
            updated_at: Set(record.updated_at),
        }
    }
}

pub async fn existing_keys(
    org_id: &str,
    agent_keys: &[String],
) -> Result<HashSet<String>, errors::Error> {
    if agent_keys.is_empty() {
        return Ok(HashSet::new());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AgentKey.is_in(agent_keys.to_vec()))
        .all(client)
        .await?;

    Ok(rows.into_iter().map(|row| row.agent_key).collect())
}

pub async fn count_by_org(org_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .count(client)
        .await?)
}

pub async fn upsert_many(records: Vec<AgentRecord>) -> Result<usize, errors::Error> {
    if records.is_empty() {
        return Ok(0);
    }

    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut stored = 0;

    for record in records {
        let existing = Entity::find_by_id(&record.agent_key).one(client).await?;
        if let Some(existing) = existing {
            let mut active: ActiveModel = existing.clone().into();
            active.first_seen = Set(existing.first_seen.min(record.first_seen));
            active.last_seen = Set(existing.last_seen.max(record.last_seen));
            active.updated_at = Set(record.updated_at);

            if record.last_seen >= existing.last_seen {
                active.env = Set(record.env.clone());
                active.agent_version = Set(record.version.clone());
            }

            if existing.identity_source == "agent_id"
                && let Some(agent_name) = record.agent_name
                && record.last_seen >= existing.last_seen
            {
                active.agent_name = Set(Some(agent_name));
            }

            active.update(client).await?;
        } else {
            let active: ActiveModel = record.into();
            Entity::insert(active).exec(client).await?;
        }
        stored += 1;
    }

    Ok(stored)
}

pub async fn list(org_id: &str, filter: &AgentListFilter) -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut query = Entity::find().filter(Column::OrgId.eq(org_id));

    if let Some(end_time) = filter.end_time {
        query = query.filter(Column::FirstSeen.lte(end_time));
    }
    if let Some(start_time) = filter.start_time {
        query = query.filter(Column::LastSeen.gte(start_time));
    }
    if let Some(source_stream) = &filter.source_stream {
        query = query.filter(Column::StreamName.eq(source_stream));
    }
    if let Some(source_stream_type) = &filter.source_stream_type {
        query = query.filter(Column::StreamType.eq(source_stream_type));
    }

    Ok(query
        .order_by(Column::LastSeen, Order::Desc)
        .order_by(Column::StreamType, Order::Asc)
        .order_by(Column::StreamName, Order::Asc)
        .order_by(Column::AgentName, Order::Asc)
        .order_by(Column::AgentId, Order::Asc)
        .order_by(Column::AgentKey, Order::Asc)
        .all(client)
        .await?)
}

pub async fn delete(
    org_id: &str,
    source_stream: Option<&str>,
    source_stream_type: Option<&str>,
) -> Result<u64, errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut query = Entity::delete_many().filter(Column::OrgId.eq(org_id));

    if let Some(source_stream) = source_stream {
        query = query.filter(Column::StreamName.eq(source_stream));
    }
    if let Some(source_stream_type) = source_stream_type {
        query = query.filter(Column::StreamType.eq(source_stream_type));
    }

    Ok(query.exec(client).await?.rows_affected)
}

pub async fn delete_for_stream(
    org_id: &str,
    source_stream: &str,
    source_stream_type: &str,
) -> Result<u64, errors::Error> {
    delete(org_id, Some(source_stream), Some(source_stream_type)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_record_maps_env_and_version_into_active_model() {
        let record = AgentRecord {
            agent_key: "k".to_string(),
            org_id: "org".to_string(),
            stream_type: "traces".to_string(),
            stream_name: "s".to_string(),
            agent_id: Some("id-1".to_string()),
            agent_name: Some("a".to_string()),
            env: Some("prod".to_string()),
            version: Some("1.2.0".to_string()),
            identity_source: "agent_id".to_string(),
            first_seen: 1,
            last_seen: 2,
            created_at: 3,
            updated_at: 4,
        };
        let active: ActiveModel = record.into();
        assert_eq!(active.env.into_value(), Some(Some("prod".to_string()).into()));
        assert_eq!(
            active.agent_version.into_value(),
            Some(Some("1.2.0".to_string()).into())
        );
    }

    #[test]
    fn test_agent_list_filter_default_has_no_scope() {
        let filter = AgentListFilter::default();

        assert!(filter.start_time.is_none());
        assert!(filter.source_stream.is_none());
    }
}
