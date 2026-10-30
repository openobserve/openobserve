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

use bytes::Bytes;
use tokio::sync::OnceCell;

use crate::errors::{DbError, Error, Result};

pub const COVERAGE_MARKER_KEY: &str = "/traces/time_index/updated_at";

static COVERAGE_START: OnceCell<i64> = OnceCell::const_new();

pub async fn initialize(enabled: bool) -> Result<Option<i64>> {
    if !enabled {
        let db = super::get_db().await;
        db.delete_if_exists(COVERAGE_MARKER_KEY, false, false)
            .await?;
        return Ok(None);
    }

    get_or_create_coverage_start().await.map(Some)
}

pub async fn get_coverage_start() -> Result<Option<i64>> {
    let db = super::get_db().await;
    let value = match db.get(COVERAGE_MARKER_KEY).await {
        Ok(value) => value,
        Err(Error::DbError(DbError::KeyNotExists(_))) => return Ok(None),
        Err(error) => return Err(error),
    };
    if value.is_empty() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&value);
    value
        .parse::<i64>()
        .map(Some)
        .map_err(|e| Error::Message(format!("invalid trace time index coverage marker: {e}")))
}

pub async fn get_or_create_coverage_start() -> Result<i64> {
    let coverage_start = COVERAGE_START
        .get_or_try_init(load_or_create_coverage_start)
        .await?;
    Ok(*coverage_start)
}

async fn load_or_create_coverage_start() -> Result<i64> {
    if let Some(value) = get_coverage_start().await? {
        return Ok(value);
    }

    let cfg = config::get_config();
    let coverage_start = config::utils::time::now_micros() - cfg.limit.ingest_allowed_upto_micro;
    let db = super::get_db().await;
    db.put(
        COVERAGE_MARKER_KEY,
        Bytes::from(coverage_start.to_string()),
        false,
        None,
    )
    .await?;
    Ok(coverage_start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_coverage_start_cache() {
        super::super::create_table().await.unwrap();
        initialize(false).await.unwrap();

        let db = super::super::get_db().await;
        db.put(COVERAGE_MARKER_KEY, Bytes::from_static(b"123"), false, None)
            .await
            .unwrap();
        assert_eq!(get_or_create_coverage_start().await.unwrap(), 123);

        db.put(COVERAGE_MARKER_KEY, Bytes::from_static(b"456"), false, None)
            .await
            .unwrap();
        assert_eq!(get_coverage_start().await.unwrap(), Some(456));
        assert_eq!(get_or_create_coverage_start().await.unwrap(), 123);

        db.delete_if_exists(COVERAGE_MARKER_KEY, false, false)
            .await
            .unwrap();
    }
}
