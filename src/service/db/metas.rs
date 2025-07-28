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

use crate::service::db;

// pub static TANTIVY_INDEX_UPDATED_AT: Lazy<i64> = Lazy::new(get_or_create_idx_updated_at);

pub mod version {
    use super::db;

    pub async fn get() -> Result<String, anyhow::Error> {
        let ret = db::get("/meta/kv/version").await?;
        let version = std::str::from_utf8(&ret).unwrap();
        Ok(version.to_string())
    }

    pub async fn set() -> Result<(), anyhow::Error> {
        db::put(
            "/meta/kv/version",
            bytes::Bytes::from(config::VERSION),
            db::NO_NEED_WATCH,
            None,
        )
        .await?;
        Ok(())
    }
}

pub mod instance {
    use infra::errors::Result;

    use super::db;

    pub async fn get() -> Result<Option<String>> {
        let ret = db::get("/instance/").await?;
        let loc_value = String::from_utf8_lossy(&ret).to_string();
        let loc_value = loc_value.trim().trim_matches('"').to_string();
        let value = Some(loc_value);
        Ok(value)
    }

    pub async fn set(id: &str) -> Result<()> {
        let data = bytes::Bytes::from(id.to_string());
        db::put("/instance/", data, db::NO_NEED_WATCH, None).await
    }
}

pub mod tantivy_index {
    use tokio::sync::OnceCell;

    use super::db;

    static TIMESTAMP_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();
    static SECONDARY_INDEX_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();

    pub async fn get_ttv_timestamp_updated_at() -> i64 {
        TIMESTAMP_UPDATED_AT
            .get_or_init(get_or_create_idx_updated_at)
            .await
            .to_owned()
    }

    async fn get_or_create_idx_updated_at() -> i64 {
        let key = "/tantivy/_timestamp/updated_at";
        match db::get(key).await {
            Ok(ret) if !ret.is_empty() => String::from_utf8_lossy(&ret)
                .to_string()
                .parse::<i64>()
                .unwrap(),
            _ => {
                let timestamp = config::utils::time::now_micros();
                let data = bytes::Bytes::from(timestamp.to_string());
                if let Err(e) = db::put(key, data, db::NO_NEED_WATCH, None).await {
                    log::warn!(
                        "[db::metas] Error storing tantivy _timestamp index updated_at: {e}"
                    );
                }
                timestamp
            }
        }
    }

    pub async fn get_ttv_secondary_index_updated_at() -> i64 {
        SECONDARY_INDEX_UPDATED_AT
            .get_or_init(get_or_create_secondary_index_updated_at)
            .await
            .to_owned()
    }

    async fn get_or_create_secondary_index_updated_at() -> i64 {
        let key = "/tantivy/secondary_index/updated_at";
        match db::get(key).await {
            Ok(ret) if !ret.is_empty() => String::from_utf8_lossy(&ret)
                .to_string()
                .parse::<i64>()
                .unwrap(),
            _ => {
                let timestamp = config::utils::time::now_micros();
                let data = bytes::Bytes::from(timestamp.to_string());
                if let Err(e) = db::put(key, data, db::NO_NEED_WATCH, None).await {
                    log::warn!("[db::metas] Error storing tantivy secondary index updated_at: {e}");
                }
                timestamp
            }
        }
    }
}
