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

use config::meta::stream::StreamType;
use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter, Set, SqlErr, TransactionTrait};
use serde::{Deserialize, Serialize};

use super::{entity::re_pattern_stream_map::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PatternPolicy {
    DropField,
    Redact,
    Hash,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ApplyPolicy {
    AtIngestion,
    AtSearch,
    Both,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatternAssociationEntry {
    pub id: i64,
    pub org: String,
    pub stream: String,
    pub stream_type: StreamType,
    pub field: String,
    pub pattern_id: String,
    pub policy: PatternPolicy,
    pub apply_at: ApplyPolicy,
}

impl<T> From<T> for PatternPolicy
where
    T: AsRef<str>,
{
    fn from(value: T) -> Self {
        match value.as_ref() {
            "DropField" => Self::DropField,
            "Redact" => Self::Redact,
            "Hash" => Self::Hash,
            _ => Self::Redact,
        }
    }
}

impl std::fmt::Display for PatternPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DropField => write!(f, "DropField"),
            Self::Redact => write!(f, "Redact"),
            Self::Hash => write!(f, "Hash"),
        }
    }
}

impl<T> From<T> for ApplyPolicy
where
    T: AsRef<str>,
{
    fn from(value: T) -> Self {
        match value.as_ref() {
            "AtIngestion" => Self::AtIngestion,
            "AtSearch" => Self::AtSearch,
            "Both" => Self::Both,
            _ => Self::AtIngestion,
        }
    }
}

impl std::fmt::Display for ApplyPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AtIngestion => write!(f, "AtIngestion"),
            Self::AtSearch => write!(f, "AtSearch"),
            Self::Both => write!(f, "Both"),
        }
    }
}

impl From<Model> for PatternAssociationEntry {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            org: value.org,
            stream: value.stream,
            stream_type: StreamType::from(value.stream_type),
            field: value.field,
            pattern_id: value.pattern_id,
            policy: PatternPolicy::from(value.policy),
            apply_at: ApplyPolicy::from(value.apply_at),
        }
    }
}

pub async fn add(entry: PatternAssociationEntry) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org: Set(entry.org),
        stream: Set(entry.stream),
        stream_type: Set(entry.stream_type.to_string()),
        field: Set(entry.field),
        pattern_id: Set(entry.pattern_id),
        policy: Set(entry.policy.to_string()),
        apply_at: Set(entry.apply_at.to_string()),
        ..Default::default()
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => {}
        Err(e) => {
            drop(_lock);
            match e.sql_err() {
                Some(SqlErr::UniqueConstraintViolation(_)) => {
                    return Err(errors::Error::DbError(errors::DbError::UniqueViolation));
                }
                _ => {
                    return Err(e.into());
                }
            }
        }
    }
    drop(_lock);

    Ok(())
}

pub async fn batch_process(
    added: Vec<PatternAssociationEntry>,
    removed: Vec<PatternAssociationEntry>,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    let txn = client.begin().await?;

    // we MUST first remove the entries and then add. This is because
    // the way associations are currently impl in stream settings,
    // for updated to policy etc, we get the old item in removed
    // and same item with the updated fields in added array. For this to work
    // properly, we similarly need to remove the old items first, then add new ones
    for r in removed {
        match Entity::delete_many()
            .filter(Column::Org.eq(r.org))
            .filter(Column::Stream.eq(r.stream))
            .filter(Column::StreamType.eq(r.stream_type.to_string()))
            .filter(Column::Field.eq(r.field))
            .filter(Column::PatternId.eq(r.pattern_id))
            .exec(&txn)
            .await
        {
            Ok(_) | Err(DbErr::RecordNotFound(_)) => {}
            Err(e) => {
                txn.rollback().await?;
                return Err(e.into());
            }
        }
    }

    if !added.is_empty() {
        let models = added.into_iter().map(|a| ActiveModel {
            org: Set(a.org),
            stream: Set(a.stream),
            stream_type: Set(a.stream_type.to_string()),
            field: Set(a.field),
            pattern_id: Set(a.pattern_id),
            policy: Set(a.policy.to_string()),
            apply_at: Set(a.apply_at.to_string()),
            ..Default::default()
        });

        match Entity::insert_many(models).exec(&txn).await {
            Ok(_) => {}
            Err(e) => {
                txn.rollback().await?;
                return Err(e.into());
            }
        }
    }
    txn.commit().await?;
    Ok(())
}

pub async fn get_by_pattern_id(
    pattern_id: &str,
) -> Result<Vec<PatternAssociationEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::PatternId.eq(pattern_id))
        .into_model::<Model>()
        .all(client)
        .await?;
    let ret = res
        .into_iter()
        .map(<Model as Into<PatternAssociationEntry>>::into)
        .collect::<Vec<_>>();
    Ok(ret)
}

pub async fn list_all() -> Result<Vec<PatternAssociationEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find().into_model::<Model>().all(client).await?;

    let records = records
        .into_iter()
        .map(<Model as Into<PatternAssociationEntry>>::into)
        .collect::<Vec<_>>();
    Ok(records)
}

pub async fn remove_associations_by_stream(
    org: &str,
    stream: &str,
    stype: StreamType,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Stream.eq(stream))
        .filter(Column::StreamType.eq(stype.to_string()))
        .exec(client)
        .await?;

    drop(_lock);

    Ok(())
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pattern_policy_from_str_all_variants() {
        assert_eq!(PatternPolicy::from("DropField"), PatternPolicy::DropField);
        assert_eq!(PatternPolicy::from("Redact"), PatternPolicy::Redact);
        assert_eq!(PatternPolicy::from("Hash"), PatternPolicy::Hash);
    }

    #[test]
    fn test_pattern_policy_from_unknown_defaults_to_redact() {
        assert_eq!(PatternPolicy::from("Unknown"), PatternPolicy::Redact);
        assert_eq!(PatternPolicy::from(""), PatternPolicy::Redact);
    }

    #[test]
    fn test_pattern_policy_display() {
        assert_eq!(PatternPolicy::DropField.to_string(), "DropField");
        assert_eq!(PatternPolicy::Redact.to_string(), "Redact");
        assert_eq!(PatternPolicy::Hash.to_string(), "Hash");
    }

    #[test]
    fn test_apply_policy_from_str_all_variants() {
        assert_eq!(ApplyPolicy::from("AtIngestion"), ApplyPolicy::AtIngestion);
        assert_eq!(ApplyPolicy::from("AtSearch"), ApplyPolicy::AtSearch);
        assert_eq!(ApplyPolicy::from("Both"), ApplyPolicy::Both);
    }

    #[test]
    fn test_apply_policy_from_unknown_defaults_to_at_ingestion() {
        assert_eq!(ApplyPolicy::from("unknown"), ApplyPolicy::AtIngestion);
    }

    #[test]
    fn test_apply_policy_display() {
        assert_eq!(ApplyPolicy::AtIngestion.to_string(), "AtIngestion");
        assert_eq!(ApplyPolicy::AtSearch.to_string(), "AtSearch");
        assert_eq!(ApplyPolicy::Both.to_string(), "Both");
    }

    #[test]
    fn test_pattern_policy_roundtrip_via_string() {
        for policy in [
            PatternPolicy::DropField,
            PatternPolicy::Redact,
            PatternPolicy::Hash,
        ] {
            let s = policy.to_string();
            assert_eq!(PatternPolicy::from(s.as_str()), policy);
        }
    }

    #[test]
    fn test_apply_policy_roundtrip_via_string() {
        for policy in [
            ApplyPolicy::AtIngestion,
            ApplyPolicy::AtSearch,
            ApplyPolicy::Both,
        ] {
            let s = policy.to_string();
            assert_eq!(ApplyPolicy::from(s.as_str()), policy);
        }
    }

    #[test]
    fn test_pattern_association_entry_from_model_maps_all_fields() {
        let model = Model {
            id: 42,
            org: "myorg".to_string(),
            stream: "logs".to_string(),
            stream_type: "logs".to_string(),
            field: "email".to_string(),
            pattern_id: "pat-1".to_string(),
            policy: "Redact".to_string(),
            apply_at: "AtIngestion".to_string(),
        };
        let entry = PatternAssociationEntry::from(model);
        assert_eq!(entry.id, 42);
        assert_eq!(entry.org, "myorg");
        assert_eq!(entry.stream, "logs");
        assert_eq!(entry.field, "email");
        assert_eq!(entry.pattern_id, "pat-1");
        assert_eq!(entry.policy, PatternPolicy::Redact);
        assert_eq!(entry.apply_at, ApplyPolicy::AtIngestion);
    }

    #[test]
    fn test_pattern_association_entry_from_model_drop_field_both() {
        let model = Model {
            id: 1,
            org: "org".to_string(),
            stream: "stream".to_string(),
            stream_type: "metrics".to_string(),
            field: "ip".to_string(),
            pattern_id: "p2".to_string(),
            policy: "DropField".to_string(),
            apply_at: "Both".to_string(),
        };
        let entry = PatternAssociationEntry::from(model);
        assert_eq!(entry.policy, PatternPolicy::DropField);
        assert_eq!(entry.apply_at, ApplyPolicy::Both);
    }
}
