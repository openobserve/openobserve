use config::utils::json;
use infra::{
    errors,
    table::distinct_values::{BatchDeleteMessage, DistinctFieldRecord, OriginType},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config;

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
        let key = format!("/distinct_values/{}", id);
        o2_enterprise::enterprise::super_cluster::queue::distinct_values_delete(
            &key, value, true, true,
        )
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
    }
    Ok(())
}
