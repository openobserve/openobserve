// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use tokio::sync::OnceCell;

static TIMESTAMP_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();
static SECONDARY_INDEX_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();

pub async fn get_ttv_timestamp_updated_at() -> i64 {
    *TIMESTAMP_UPDATED_AT
        .get_or_init(|| get_or_create_updated_at("/tantivy/_timestamp/updated_at"))
        .await
}

pub async fn get_ttv_secondary_index_updated_at() -> i64 {
    *SECONDARY_INDEX_UPDATED_AT
        .get_or_init(|| get_or_create_updated_at("/tantivy/secondary_index/updated_at"))
        .await
}

async fn get_or_create_updated_at(key: &str) -> i64 {
    let db = super::get_db().await;
    match db.get(key).await {
        Ok(ret) if !ret.is_empty() => String::from_utf8_lossy(&ret).parse::<i64>().unwrap(),
        _ => {
            let timestamp = config::utils::time::BASE_TIME.timestamp_micros();
            let data = bytes::Bytes::from(timestamp.to_string());
            if let Err(err) = db.put(key, data, false, None).await {
                log::warn!("[infra::db::tantivy_index] failed to store {key}: {err}");
            }
            timestamp
        }
    }
}
