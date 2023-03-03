use crate::meta::StreamType;
use crate::service::db;

pub async fn delete_by_stream(
    lifecycle_end: &str,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    // get schema
    let schema = db::schema::get(org_id, stream_name, Some(stream_type)).await?;
    let created_at = match schema.metadata.get("created_at") {
        Some(v) => v.to_string(),
        None => "".to_string(),
    };
    if created_at.is_empty() {
        return Ok(()); // no created_at, just skip
    }
    if created_at >= lifecycle_end.to_string() {
        return Ok(()); // created_at is after lifecycle_end, just skip
    }

    // delete files
    let lifecycle_start = created_at[0..10].to_string();
    db::compact::delete::delete_stream(
        org_id,
        stream_name,
        stream_type,
        Some((&lifecycle_start, lifecycle_end)),
    )
    .await
}
