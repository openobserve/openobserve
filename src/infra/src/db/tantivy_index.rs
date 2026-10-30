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

use tokio::sync::OnceCell;

static TIMESTAMP_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();
static SECONDARY_INDEX_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();
static DISTINCT_FIELDS_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();

pub async fn get_ttv_timestamp_updated_at() -> i64 {
    *TIMESTAMP_UPDATED_AT
        .get_or_init(|| {
            get_or_create_updated_at(
                "/tantivy/_timestamp/updated_at",
                config::utils::time::BASE_TIME.timestamp_micros(),
            )
        })
        .await
}

pub async fn get_ttv_secondary_index_updated_at() -> i64 {
    *SECONDARY_INDEX_UPDATED_AT
        .get_or_init(|| {
            get_or_create_updated_at(
                "/tantivy/secondary_index/updated_at",
                config::utils::time::BASE_TIME.timestamp_micros(),
            )
        })
        .await
}

/// when distinct value fields started being folded into the tantivy index
pub async fn get_ttv_distinct_fields_updated_at() -> i64 {
    *DISTINCT_FIELDS_UPDATED_AT
        .get_or_init(|| {
            get_or_create_updated_at(
                "/tantivy/distinct_fields/updated_at",
                config::utils::time::now_micros(),
            )
        })
        .await
}

async fn get_or_create_updated_at(key: &str, default_ts: i64) -> i64 {
    let db = super::get_db().await;
    match db.get(key).await {
        Ok(ret) if !ret.is_empty() => String::from_utf8_lossy(&ret).parse::<i64>().unwrap(),
        _ => {
            let data = bytes::Bytes::from(default_ts.to_string());
            if let Err(err) = db.put(key, data, false, None).await {
                log::warn!("[infra::db::tantivy_index] failed to store {key}: {err}");
            }
            default_ts
        }
    }
}
