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

use crate::service_graph::{missing_as_none, parse_v4_offset};

/// Also the claim lock key.
pub const OFFSET_KEY: &str = "/service_signals/offset";

/// Value is `<micros>;<node_uuid>`; a missing key is unset, any other read error propagates.
pub async fn get_offset() -> Result<(i64, String), anyhow::Error> {
    offset_from_read(infra::db::get_db().await.get(OFFSET_KEY).await)
}

pub async fn set_offset(offset: i64, node: &str) -> Result<(), anyhow::Error> {
    let val = format!("{offset};{node}");
    Ok(infra::db::get_db()
        .await
        .put(OFFSET_KEY, val.into(), infra::db::NO_NEED_WATCH, None)
        .await?)
}

pub async fn compare_set_offset(
    expected: (i64, String),
    offset: i64,
    node: &str,
) -> Result<(), anyhow::Error> {
    compare_set_offset_with(infra::db::get_db().await.as_ref(), expected, offset, node).await
}

/// One cursor per org, so a light org never waits behind a heavy org's backlog.
pub async fn get_org_offset(org: &str) -> Result<Option<i64>, anyhow::Error> {
    org_offset_from(
        infra::db::get_db()
            .await
            .get_with_revision(&org_offset_key(org))
            .await?,
    )
}

/// How far the org's rollup reached; an org without its own cursor still follows the shared one.
pub async fn rolled_offset(org: &str) -> Result<i64, anyhow::Error> {
    match get_org_offset(org).await? {
        Some(offset) => Ok(offset),
        None => Ok(get_offset().await?.0),
    }
}

pub async fn advance_org_offset(org: &str, offset: i64) -> Result<(), anyhow::Error> {
    advance_org_offset_with(infra::db::get_db().await.as_ref(), org, offset).await
}

async fn compare_set_offset_with(
    store: &dyn infra::db::Db,
    expected: (i64, String),
    offset: i64,
    node: &str,
) -> Result<(), anyhow::Error> {
    let current = store.get_with_revision(OFFSET_KEY).await?;
    let actual = current
        .as_ref()
        .map(|(value, _)| parse_v4_offset(&String::from_utf8_lossy(value)))
        .unwrap_or_default();
    anyhow::ensure!(
        actual == expected && offset >= actual.0,
        "service signals offset ownership changed"
    );
    let revision = current.map(|(_, revision)| revision);
    let value = Bytes::from(format!("{offset};{node}"));
    anyhow::ensure!(
        store.put_if_revision(OFFSET_KEY, value, revision).await?,
        "service signals offset ownership changed"
    );
    Ok(())
}

fn org_offset_key(org: &str) -> String {
    format!("/service_signals/org_offset/{org}")
}

async fn advance_org_offset_with(
    store: &dyn infra::db::Db,
    org: &str,
    offset: i64,
) -> Result<(), anyhow::Error> {
    let key = org_offset_key(org);
    let current = store.get_with_revision(&key).await?;
    let actual = org_offset_from(current.clone())?;
    anyhow::ensure!(
        actual.is_none_or(|actual| offset >= actual),
        "service signals org offset regressed"
    );
    anyhow::ensure!(
        store
            .put_if_revision(
                &key,
                Bytes::from(offset.to_string()),
                current.map(|(_, revision)| revision),
            )
            .await?,
        "service signals org offset changed"
    );
    Ok(())
}

fn org_offset_from(value: Option<(Bytes, u64)>) -> Result<Option<i64>, anyhow::Error> {
    value
        .map(|(value, _)| Ok(String::from_utf8_lossy(&value).parse::<i64>()?))
        .transpose()
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

    #[tokio::test]
    async fn stale_owner_cannot_claim_or_regress_offset_after_takeover() {
        use infra::db::{Db, sqlite::SqliteDb};
        infra::db::create_table().await.unwrap();
        let store = SqliteDb::default();
        store
            .put(OFFSET_KEY, Bytes::from("100;old"), false, None)
            .await
            .unwrap();
        compare_set_offset_with(&store, (100, "old".into()), 200, "new")
            .await
            .unwrap();
        for (expected, target) in [
            ((100, "old".into()), 100),
            ((100, "old".into()), 150),
            ((200, "new".into()), 150),
        ] {
            assert!(
                compare_set_offset_with(&store, expected, target, "old")
                    .await
                    .is_err()
            );
            assert_eq!(store.get(OFFSET_KEY).await.unwrap(), Bytes::from("200;new"));
        }
    }

    #[tokio::test]
    async fn org_offsets_advance_independently_and_never_regress() {
        use infra::db::{Db, sqlite::SqliteDb};
        infra::db::create_table().await.unwrap();
        let store = SqliteDb::default();
        let (heavy, light) = (
            format!("heavy_{}", config::utils::time::now_micros()),
            format!("light_{}", config::utils::time::now_micros()),
        );
        assert_eq!(
            org_offset_from(
                store
                    .get_with_revision(&org_offset_key(&heavy))
                    .await
                    .unwrap()
            )
            .unwrap(),
            None
        );
        advance_org_offset_with(&store, &heavy, 100).await.unwrap();
        advance_org_offset_with(&store, &light, 900).await.unwrap();
        advance_org_offset_with(&store, &light, 900).await.unwrap();
        assert!(advance_org_offset_with(&store, &heavy, 50).await.is_err());
        for (org, expected) in [(&heavy, 100), (&light, 900)] {
            assert_eq!(
                org_offset_from(store.get_with_revision(&org_offset_key(org)).await.unwrap())
                    .unwrap(),
                Some(expected)
            );
        }
    }

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
        let no_node = Ok(Bytes::from("1700000000000000;"));
        assert_eq!(
            offset_from_read(no_node).unwrap(),
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
