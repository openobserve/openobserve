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

use crate::{
    self as db,
    service_graph::{missing_as_none, mk_key as v1_offset_key, parse_v4_offset, put_once},
};

/// Also the claim lock key, so a claim and the seed never interleave.
pub const OFFSET_KEY: &str = "/agent_signals/offset";

/// Value is `<micros>;<node_uuid>`; a missing key is unset, any other read error propagates.
pub async fn get_offset() -> Result<(i64, String), anyhow::Error> {
    offset_from_read(db::get(OFFSET_KEY).await)
}

pub async fn set_offset(offset: i64, node: &str) -> Result<(), anyhow::Error> {
    let val = format!("{offset};{node}");
    Ok(db::put(OFFSET_KEY, val.into(), db::NO_NEED_WATCH, None).await?)
}

/// Write-once: resumes where the pass inside the v1 tick stopped instead of jumping to the present.
pub async fn seed_offset_from_v1() -> Result<(), anyhow::Error> {
    if missing_as_none(db::get(OFFSET_KEY).await)?.is_some() {
        return Ok(());
    }
    let (v1_offset, _) = offset_from_read(db::get(&v1_offset_key()).await)?;
    if v1_offset > 0 {
        // no node travels with the seed, so the first ticking scheduler claims it
        put_once(OFFSET_KEY, format!("{v1_offset};")).await?;
    }
    Ok(())
}

/// A failed read must not look like a fresh install, which would jump the cursor to the present.
fn offset_from_read(ret: infra::errors::Result<Bytes>) -> Result<(i64, String), anyhow::Error> {
    Ok(match missing_as_none(ret)? {
        Some(value) => parse_v4_offset(&String::from_utf8_lossy(&value)),
        None => (0, String::new()),
    })
}

#[cfg(test)]
mod tests {
    use infra::errors::{DbError, Error};

    use super::*;

    #[test]
    fn test_offset_from_read_missing_key_is_unset() {
        let missing = Err(Error::DbError(DbError::KeyNotExists(
            OFFSET_KEY.to_string(),
        )));
        assert_eq!(offset_from_read(missing).unwrap(), (0, String::new()));
    }

    #[test]
    fn test_offset_from_read_existing_cursor() {
        let stored = Ok(Bytes::from("1700000000000000;node-a"));
        assert_eq!(
            offset_from_read(stored).unwrap(),
            (1_700_000_000_000_000, "node-a".to_string())
        );
        let seeded = Ok(Bytes::from("1700000000000000;"));
        assert_eq!(
            offset_from_read(seeded).unwrap(),
            (1_700_000_000_000_000, String::new())
        );
    }

    #[test]
    fn test_offset_from_read_db_error_is_not_a_fresh_install() {
        let failed = Err(Error::DbError(DbError::DBOperError(
            "pool timed out".to_string(),
            OFFSET_KEY.to_string(),
        )));
        assert!(offset_from_read(failed).is_err());
    }
}
