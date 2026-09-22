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

use super::entity::re_pattern_stream_map::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PatternPolicy {
    DropField,
    Redact,
    Hash,
    Detect,
}

impl PatternPolicy {
    /// Strict parse for write paths; `From` stays lenient for reads of existing rows.
    pub fn parse_strict(value: &str) -> Result<Self, UnknownPolicy> {
        Self::parse_strict_with(value, config::get_config().common.sdr_detect_policy_enabled)
    }

    /// False means the lossy read silently coerced this stored value to `Redact`.
    pub fn is_recognised(value: &str) -> bool {
        matches!(value, "DropField" | "Redact" | "Hash" | "Detect")
    }

    fn parse_strict_with(value: &str, detect_enabled: bool) -> Result<Self, UnknownPolicy> {
        match value {
            "DropField" => Ok(Self::DropField),
            "Redact" => Ok(Self::Redact),
            "Hash" => Ok(Self::Hash),
            // The gate is advisory: propagation to other nodes bypasses this check entirely.
            "Detect" if detect_enabled => Ok(Self::Detect),
            "Detect" => Err(UnknownPolicy {
                value: value.to_string(),
                hint: Some(
                    "the Detect policy requires ZO_SDR_DETECT_POLICY_ENABLED=true on every node"
                        .to_string(),
                ),
            }),
            _ => Err(UnknownPolicy {
                value: value.to_string(),
                hint: None,
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ApplyPolicy {
    AtIngestion,
    AtSearch,
    Both,
}

impl ApplyPolicy {
    /// Strict parse for write paths; the lossy `From` stays for reads of existing rows.
    pub fn parse_strict(value: &str) -> Result<Self, UnknownPolicy> {
        match value {
            "AtIngestion" => Ok(Self::AtIngestion),
            "AtSearch" => Ok(Self::AtSearch),
            "Both" => Ok(Self::Both),
            _ => Err(UnknownPolicy {
                value: value.to_string(),
                hint: None,
            }),
        }
    }
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
            // Config-free by design: coercing a stored Detect here would rewrite untouched data.
            "Detect" => Self::Detect,
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
            Self::Detect => write!(f, "Detect"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownPolicy {
    pub value: String,
    pub hint: Option<String>,
}

impl std::fmt::Display for UnknownPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.hint {
            Some(hint) => write!(f, "unsupported value {:?}: {hint}", self.value),
            None => write!(f, "unsupported value {:?}", self.value),
        }
    }
}

impl std::error::Error for UnknownPolicy {}

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

    let client = get_orm_client_rw().await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => {}
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                return Err(errors::Error::DbError(errors::DbError::UniqueViolation));
            }
            _ => {
                return Err(e.into());
            }
        },
    }

    Ok(())
}

pub async fn batch_process(
    added: Vec<PatternAssociationEntry>,
    removed: Vec<PatternAssociationEntry>,
) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
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
    let client = get_orm_client_ro().await;
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
    let client = get_orm_client_ro().await;

    let records = Entity::find().into_model::<Model>().all(client).await?;

    log_unrecognised_policies(&records);

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
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Stream.eq(stream))
        .filter(Column::StreamType.eq(stype.to_string()))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

/// Deletes all re_pattern stream map entries belonging to the given org.
pub async fn delete_by_org(org: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(client)
        .await?;
    Ok(())
}

/// A downgrade silently applies an unknown policy as `Redact` and rewrites live data,
/// so the load says so loudly. Returns the number of rows affected.
fn log_unrecognised_policies(records: &[Model]) -> usize {
    let unrecognised: Vec<&Model> = records
        .iter()
        .filter(|record| !PatternPolicy::is_recognised(&record.policy))
        .collect();
    if unrecognised.is_empty() {
        return 0;
    }
    for record in &unrecognised {
        log::error!(
            "[SDR] association {}/{}/{} field {} has policy {:?}, which this build does not recognise; it is being applied as Redact and will rewrite data",
            record.org,
            record.stream_type,
            record.stream,
            record.field,
            record.policy
        );
    }
    log::error!(
        "[SDR] {} pattern association(s) carry an unrecognised policy; delete or convert them before running this build",
        unrecognised.len()
    );
    unrecognised.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pattern_policy_from_str_all_variants() {
        assert_eq!(PatternPolicy::from("DropField"), PatternPolicy::DropField);
        assert_eq!(PatternPolicy::from("Redact"), PatternPolicy::Redact);
        assert_eq!(PatternPolicy::from("Hash"), PatternPolicy::Hash);
        assert_eq!(PatternPolicy::from("Detect"), PatternPolicy::Detect);
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
            PatternPolicy::Detect,
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

    #[test]
    fn test_pattern_policy_parse_strict_accepts_known_values() {
        for policy in [
            PatternPolicy::DropField,
            PatternPolicy::Redact,
            PatternPolicy::Hash,
        ] {
            assert_eq!(
                PatternPolicy::parse_strict(&policy.to_string()).unwrap(),
                policy
            );
        }
    }

    #[test]
    fn test_pattern_policy_parse_strict_rejects_typos_and_wrong_case() {
        for value in ["Hashh", "", "redact", "DROPFIELD", "Unknown"] {
            assert!(PatternPolicy::parse_strict(value).is_err(), "{value}");
        }
    }

    #[test]
    fn test_pattern_policy_parse_strict_detect_follows_the_flag() {
        assert_eq!(
            PatternPolicy::parse_strict_with("Detect", true).unwrap(),
            PatternPolicy::Detect
        );
        let err = PatternPolicy::parse_strict_with("Detect", false).unwrap_err();
        assert!(err.to_string().contains("ZO_SDR_DETECT_POLICY_ENABLED"));
    }

    #[test]
    fn test_pattern_policy_from_detect_survives_the_read_path() {
        assert_eq!(PatternPolicy::from("Detect"), PatternPolicy::Detect);
        assert_eq!(
            PatternPolicy::from(PatternPolicy::Detect.to_string()),
            PatternPolicy::Detect
        );
    }

    #[test]
    fn test_pattern_policy_from_agrees_with_strict_parse_under_either_flag() {
        // The flag gates writes only; a read that consulted it would decode rows two ways.
        for detect_enabled in [true, false] {
            for value in ["DropField", "Redact", "Hash"] {
                assert_eq!(
                    PatternPolicy::from(value),
                    PatternPolicy::parse_strict_with(value, detect_enabled).unwrap(),
                    "{value}/{detect_enabled}"
                );
            }
        }
        assert_eq!(
            PatternPolicy::from("Detect"),
            PatternPolicy::parse_strict_with("Detect", true).unwrap()
        );
        assert!(PatternPolicy::parse_strict_with("Detect", false).is_err());
        assert_eq!(PatternPolicy::from("Detect"), PatternPolicy::Detect);
    }

    #[test]
    fn test_pattern_association_entry_from_model_preserves_detect() {
        let model = Model {
            id: 7,
            org: "org".to_string(),
            stream: "logs".to_string(),
            stream_type: "logs".to_string(),
            field: "message".to_string(),
            pattern_id: "p-detect".to_string(),
            policy: "Detect".to_string(),
            apply_at: "AtIngestion".to_string(),
        };
        assert_eq!(
            PatternAssociationEntry::from(model).policy,
            PatternPolicy::Detect
        );
    }

    #[test]
    fn test_pattern_policy_display_detect() {
        assert_eq!(PatternPolicy::Detect.to_string(), "Detect");
    }

    #[test]
    fn test_pattern_policy_is_recognised() {
        for value in ["DropField", "Redact", "Hash", "Detect"] {
            assert!(PatternPolicy::is_recognised(value), "{value}");
        }
        for value in ["", "redact", "Hashh"] {
            assert!(!PatternPolicy::is_recognised(value), "{value}");
        }
    }

    #[test]
    fn test_unrecognised_policies_are_counted_on_load() {
        let row = |policy: &str| Model {
            id: 1,
            org: "org".to_string(),
            stream: "logs".to_string(),
            stream_type: "logs".to_string(),
            field: "message".to_string(),
            pattern_id: "p1".to_string(),
            policy: policy.to_string(),
            apply_at: "AtIngestion".to_string(),
        };

        assert_eq!(log_unrecognised_policies(&[]), 0);
        assert_eq!(
            log_unrecognised_policies(&[row("Redact"), row("Hash"), row("Detect")]),
            0
        );
        // A build without the Detect variant sees exactly this shape.
        assert_eq!(
            log_unrecognised_policies(&[row("Redact"), row("SomeFuturePolicy")]),
            1
        );
        assert_eq!(
            log_unrecognised_policies(&[row("SomeFuturePolicy"), row("AnotherOne")]),
            2
        );
    }

    #[test]
    fn test_apply_policy_parse_strict() {
        for policy in [
            ApplyPolicy::AtIngestion,
            ApplyPolicy::AtSearch,
            ApplyPolicy::Both,
        ] {
            assert_eq!(
                ApplyPolicy::parse_strict(&policy.to_string()).unwrap(),
                policy
            );
        }
        for value in ["", "atingestion", "AtIngestionn"] {
            assert!(ApplyPolicy::parse_strict(value).is_err(), "{value}");
        }
    }
}
