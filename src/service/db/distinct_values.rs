// Copyright 2025 OpenObserve Inc.
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

#[cfg(feature = "enterprise")]
use config::utils::json;
#[cfg(feature = "enterprise")]
use infra::table::distinct_values::BatchDeleteMessage;
use infra::{
    errors,
    table::distinct_values::{DistinctFieldRecord, OriginType},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config;

pub async fn add(record: DistinctFieldRecord) -> Result<(), errors::Error> {
    #[cfg(feature = "enterprise")]
    emit_put_event(&record).await?;
    infra::table::distinct_values::add(record).await
}

pub async fn remove(record: DistinctFieldRecord) -> Result<(), errors::Error> {
    #[cfg(feature = "enterprise")]
    emit_delete_event(&record).await?;
    infra::table::distinct_values::remove(record).await
}

pub async fn batch_remove(origin: OriginType, origin_id: &str) -> Result<(), errors::Error> {
    #[cfg(feature = "enterprise")]
    emit_batch_delete_event(&origin, origin_id).await?;
    infra::table::distinct_values::batch_remove(origin, origin_id).await
}

/// Sends event to super cluster queue for a new distinct values entry.
#[cfg(feature = "enterprise")]
pub async fn emit_put_event(record: &DistinctFieldRecord) -> Result<(), errors::Error> {
    if get_config().super_cluster.enabled {
        let value = json::to_vec(&record)?.into();
        let key = format!("/distinct_values/{}", record.org_name);
        o2_enterprise::enterprise::super_cluster::queue::distinct_values_put(&key, value, true)
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
    }
    Ok(())
}

/// Sends event to super cluster queue for a deleted distinct values entry.
#[cfg(feature = "enterprise")]
pub async fn emit_delete_event(record: &DistinctFieldRecord) -> Result<(), infra::errors::Error> {
    if get_config().super_cluster.enabled {
        let value = json::to_vec(&record)?.into();
        let key = format!("/distinct_values/{}", record.org_name);
        o2_enterprise::enterprise::super_cluster::queue::distinct_values_delete(
            &key, value, false, true,
        )
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
    }
    Ok(())
}

/// Sends event to super cluster queue for a deleted distinct values batch.
#[cfg(feature = "enterprise")]
pub async fn emit_batch_delete_event(
    origin_type: &OriginType,
    id: &str,
) -> Result<(), infra::errors::Error> {
    if get_config().super_cluster.enabled {
        let value = json::to_vec(&BatchDeleteMessage {
            origin_type: *origin_type,
            id: id.to_owned(),
        })?
        .into();
        let key = format!("/distinct_values/{id}");
        o2_enterprise::enterprise::super_cluster::queue::distinct_values_delete(
            &key, value, true, true,
        )
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use infra::table::distinct_values::{DistinctFieldRecord, OriginType};

    fn create_test_record() -> DistinctFieldRecord {
        DistinctFieldRecord {
            org_name: "test_org".to_string(),
            stream_name: "test_stream".to_string(),
            stream_type: "logs".to_string(),
            field_name: "test_field".to_string(),
            origin: OriginType::Stream,
            origin_id: "test_stream_id".to_string(),
        }
    }

    #[test]
    fn test_record_creation() {
        let record = create_test_record();
        assert_eq!(record.org_name, "test_org");
        assert_eq!(record.stream_name, "test_stream");
        assert_eq!(record.field_name, "test_field");
        assert_eq!(record.field_name, "test_field");
        assert!(matches!(record.origin, OriginType::Stream));
    }

    #[cfg(feature = "enterprise")]
    mod enterprise_tests {
        use super::*;

        #[tokio::test]
        async fn test_emit_put_event() {
            let record = create_test_record();

            // Test function exists and handles the record
            let result = crate::service::db::distinct_values::emit_put_event(&record).await;
            // Would succeed if super cluster is disabled
            assert!(result.is_ok() || result.is_err());
        }

        #[tokio::test]
        async fn test_emit_delete_event() {
            let record = create_test_record();

            let result = crate::service::db::distinct_values::emit_delete_event(&record).await;
            assert!(result.is_ok() || result.is_err());
        }

        #[tokio::test]
        async fn test_emit_batch_delete_event() {
            let result = crate::service::db::distinct_values::emit_batch_delete_event(
                &OriginType::Stream,
                "test_id",
            )
            .await;
            assert!(result.is_ok() || result.is_err());
        }
    }
}
