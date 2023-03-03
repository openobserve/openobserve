use chrono::{DateTime, TimeZone, Utc};

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
        Some(v) => v.parse::<i64>()?,
        None => 0,
    };
    if created_at == 0 {
        return Ok(()); // no created_at, just skip
    }
    let created_at: DateTime<Utc> = Utc.timestamp_nanos(created_at * 1000);
    let lifecycle_start = created_at.format("%Y-%m-%d").to_string();
    let lifecycle_start = lifecycle_start.as_str();
    if lifecycle_start.ge(lifecycle_end) {
        return Ok(()); // created_at is after lifecycle_end, just skip
    }

    // delete files
    db::compact::delete::delete_stream(
        org_id,
        stream_name,
        stream_type,
        Some((lifecycle_start, lifecycle_end)),
    )
    .await
}
