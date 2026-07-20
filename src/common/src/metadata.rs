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

async fn db_get(key: &str) -> infra::errors::Result<bytes::Bytes> {
    infra::db::get_db().await.get(key).await
}

async fn db_put(key: &str, value: bytes::Bytes) -> infra::errors::Result<()> {
    infra::db::get_db()
        .await
        .put(key, value.clone(), false, None)
        .await?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::put(key, value, false, None)
            .await
            .map_err(|error| infra::errors::Error::Message(error.to_string()))?;
    }
    Ok(())
}

// pub static TANTIVY_INDEX_UPDATED_AT: Lazy<i64> = Lazy::new(get_or_create_idx_updated_at);

pub mod version {
    use super::{db_get, db_put};

    pub async fn get() -> Result<String, anyhow::Error> {
        let ret = db_get("/meta/kv/version").await?;
        let version = std::str::from_utf8(&ret).unwrap();
        Ok(version.to_string())
    }

    pub async fn set() -> Result<(), anyhow::Error> {
        db_put("/meta/kv/version", bytes::Bytes::from(config::VERSION)).await?;
        Ok(())
    }
}

pub mod instance {
    use infra::errors::Result;

    use super::{db_get, db_put};

    pub async fn get() -> Result<Option<String>> {
        let ret = db_get("/instance/").await?;
        let loc_value = String::from_utf8_lossy(&ret).to_string();
        let loc_value = loc_value.trim().trim_matches('"').to_string();
        let value = Some(loc_value);
        Ok(value)
    }

    pub async fn set(id: &str) -> Result<()> {
        let data = bytes::Bytes::from(id.to_string());
        db_put("/instance/", data).await
    }
}

pub mod tantivy_index {
    use tokio::sync::OnceCell;

    use super::{db_get, db_put};

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
        match db_get(key).await {
            Ok(ret) if !ret.is_empty() => String::from_utf8_lossy(&ret)
                .to_string()
                .parse::<i64>()
                .unwrap(),
            _ => {
                let timestamp = config::utils::time::BASE_TIME.timestamp_micros();
                let data = bytes::Bytes::from(timestamp.to_string());
                if let Err(e) = db_put(key, data).await {
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
        match db_get(key).await {
            Ok(ret) if !ret.is_empty() => String::from_utf8_lossy(&ret)
                .to_string()
                .parse::<i64>()
                .unwrap(),
            _ => {
                let timestamp = config::utils::time::BASE_TIME.timestamp_micros();
                let data = bytes::Bytes::from(timestamp.to_string());
                if let Err(e) = db_put(key, data).await {
                    log::warn!("[db::metas] Error storing tantivy secondary index updated_at: {e}");
                }
                timestamp
            }
        }
    }
}
