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

use crate as db;

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
    use infra::errors::{DbError, Error, Result};

    use super::db;

    /// Returns `Ok(None)` only when the instance id is genuinely not stored
    /// yet. Other errors (db unreachable/overloaded) propagate: the caller
    /// must NOT generate a new instance id then.
    pub async fn get() -> Result<Option<String>> {
        let ret = match db::get("/instance/").await {
            Ok(v) => v,
            Err(Error::DbError(DbError::KeyNotExists(_))) => return Ok(None),
            Err(e) => return Err(e),
        };
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
