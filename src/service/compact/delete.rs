use chrono::{TimeZone, Utc};

use crate::common::utils::is_local_disk_storage;
use crate::infra::config::CONFIG;
use crate::meta::StreamType;
use crate::service::db;

pub async fn delete_all(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    println!("delete_all: {}/{}/{}", org_id, stream_type, stream_name);
    if is_local_disk_storage() {
        let data_dir = format!(
            "{}/files/{}/{}/{}",
            CONFIG.common.data_stream_dir, org_id, stream_type, stream_name
        );
        let path = std::path::Path::new(&data_dir);
        if path.exists() {
            std::fs::remove_dir_all(path)?;
        }
    } else {
        // delete files from s3
    }

    // mark delete done
    db::compact::delete::delete_stream_done(org_id, stream_name, stream_type, None).await
}

pub async fn delete_by_date(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    date_range: (&str, &str),
) -> Result<(), anyhow::Error> {
    println!(
        "delete_by_date: {}/{}/{}, {:?}",
        org_id, stream_type, stream_name, date_range
    );
    let mut date_start = Utc.datetime_from_str(
        format!("{}T00:00:00Z", date_range.0).as_str(),
        "%Y-%m-%dT%H:%M:%SZ",
    )?;
    let date_end = Utc.datetime_from_str(
        format!("{}T00:00:00Z", date_range.1).as_str(),
        "%Y-%m-%dT%H:%M:%SZ",
    )?;
    if is_local_disk_storage() {
        while date_start <= date_end {
            let data_dir = format!(
                "{}/files/{}/{}/{}/{}",
                CONFIG.common.data_stream_dir,
                org_id,
                stream_type,
                stream_name,
                date_start.format("%Y/%m/%d")
            );
            let path = std::path::Path::new(&data_dir);
            if path.exists() {
                std::fs::remove_dir_all(path)?;
            }
            date_start = date_start + chrono::Duration::days(1);
        }
    } else {
        // delete files from s3
    }

    // update metadata
    db::schema::update_created_at(
        org_id,
        stream_name,
        stream_type,
        date_end.timestamp_micros(),
    )
    .await?;

    // mark delete done
    db::compact::delete::delete_stream_done(org_id, stream_name, stream_type, Some(date_range))
        .await
}
