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

use std::future::Future;

use config::{
    META_ORG_ID,
    utils::{
        encryption::{decrypt_secret_value, encrypt_secret_value},
        json,
    },
};
use sea_orm::{
    DbErr, EntityTrait, SqlErr, UpdateMany,
    sea_query::{Expr, IntoIden},
};
use serde::{Serialize, de::DeserializeOwned};

use crate::{
    errors::{DbError, Error},
    table::cipher,
};

/// The `_meta` DEK when a stored secret needs one and encryption is on, else `None`.
pub(super) async fn secrets_key(needed: bool) -> Result<Option<Vec<u8>>, Error> {
    if !needed {
        return Ok(None);
    }
    key_if_encrypting(cipher::is_encrypting(), cipher::get_dek).await
}

/// The stored form of a secret: `AESenc:` text under `key`, or null without a key.
pub(super) fn seal(key: Option<&[u8]>, value: Option<&str>) -> Result<Option<String>, Error> {
    match (key, value) {
        (Some(key), Some(value)) => encrypt_secret_value(key, value)
            .map(Some)
            .map_err(|e| Error::Message(format!("slack secret encryption failed: {e}"))),
        _ => Ok(None),
    }
}

/// The plaintext of a stored secret, and false when a stored value cannot be decrypted.
pub(super) fn open(key: Option<&[u8]>, stored: Option<&str>) -> (Option<String>, bool) {
    match (key, stored) {
        (_, None) => (None, true),
        (None, Some(_)) => (None, false),
        (Some(key), Some(stored)) => match decrypt_secret_value(key, stored) {
            Ok(value) => (Some(value), true),
            Err(_) => (None, false),
        },
    }
}

pub(super) fn enum_text<T: Serialize>(value: &T) -> Result<String, Error> {
    match json::to_value(value)? {
        json::Value::String(text) => Ok(text),
        other => Err(Error::Message(format!("not a string enum: {other}"))),
    }
}

/// The error names the column only: stored values can be user content and end up in logs.
pub(super) fn parse_enum<T: DeserializeOwned>(column: &str, text: &str) -> Result<T, Error> {
    json::from_value(json::Value::String(text.to_string()))
        .map_err(|_| Error::Message(format!("unknown {column} value")))
}

/// The error names the column only: serde quotes the offending text, such as a bot answer.
pub(super) fn parse_json<T: DeserializeOwned + Default>(
    column: &str,
    text: Option<&str>,
) -> Result<T, Error> {
    match text {
        Some(text) => {
            json::from_str(text).map_err(|_| Error::Message(format!("undecodable {column} json")))
        }
        None => Ok(T::default()),
    }
}

/// Adds `origin_region` to a partial update when the caller knows the writing region.
pub(super) fn with_region<E: EntityTrait>(
    update: UpdateMany<E>,
    column: impl IntoIden,
    origin_region: Option<&str>,
) -> UpdateMany<E> {
    match origin_region {
        Some(region) => update.col_expr(column, Expr::value(region)),
        None => update,
    }
}

/// Keeps the rows this binary can decode, so one value from a newer release never fails a list.
pub(super) fn decode_all<M, T>(
    table: &str,
    rows: Vec<M>,
    key: impl Fn(&M) -> String,
    mut decode: impl FnMut(M) -> Result<T, Error>,
) -> Vec<T> {
    rows.into_iter()
        .filter_map(|row| {
            let row_key = key(&row);
            decode(row)
                .inspect_err(|e| {
                    log::warn!("[SLACK] skipping undecodable {table} row {row_key}: {e}");
                })
                .ok()
        })
        .collect()
}

/// Reads raw pages until `limit` rows decode or a raw page is short, so short still means done.
pub(super) async fn decode_pages<M, T, K, F, Fut>(
    table: &str,
    limit: u64,
    start: Option<K>,
    mut fetch: F,
    cursor_of: impl Fn(&M) -> K,
    key: impl Fn(&M) -> String,
    mut decode: impl FnMut(M) -> Result<T, Error>,
) -> Result<Vec<T>, Error>
where
    F: FnMut(Option<K>, u64) -> Fut,
    Fut: Future<Output = Result<Vec<M>, Error>>,
{
    let mut decoded = Vec::new();
    let mut cursor = start;
    while (decoded.len() as u64) < limit {
        let want = limit - decoded.len() as u64;
        let rows = fetch(cursor.take(), want).await?;
        let short = (rows.len() as u64) < want;
        cursor = rows.last().map(&cursor_of);
        decoded.extend(decode_all(table, rows, &key, &mut decode));
        if short {
            break;
        }
    }
    Ok(decoded)
}

pub(super) fn db_err(e: DbErr) -> Error {
    match e.sql_err() {
        Some(SqlErr::UniqueConstraintViolation(_)) => Error::DbError(DbError::UniqueViolation),
        _ => e.into(),
    }
}

async fn key_if_encrypting<F, Fut>(encrypting: bool, fetch: F) -> Result<Option<Vec<u8>>, Error>
where
    F: FnOnce(&'static str) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, Error>>,
{
    // Checked first because `get_dek` mints and stores a DEK even while encryption is off.
    if !encrypting {
        return Ok(None);
    }
    fetch(META_ORG_ID).await.map(Some)
}

#[cfg(test)]
mod tests {
    use config::meta::slack::{BotAnswer, ThreadKind};

    use super::*;

    #[tokio::test]
    async fn no_dek_minted_without_master_key() {
        let key = key_if_encrypting(false, |_| async {
            panic!("a DEK was requested while encryption is off")
        })
        .await
        .unwrap();
        assert_eq!(key, None);
        assert!(!cipher::is_encrypting());
        assert_eq!(secrets_key(true).await.unwrap(), None);
    }

    #[tokio::test]
    async fn secrets_use_the_meta_org_dek_not_the_installing_org() {
        let key = key_if_encrypting(true, |org| async move {
            assert_eq!(org, "_meta");
            Ok(vec![7u8; 64])
        })
        .await
        .unwrap();
        assert_eq!(key, Some(vec![7u8; 64]));
    }

    #[test]
    fn seal_and_open_round_trip_under_one_key() {
        let key = [3u8; 64];
        let sealed = seal(Some(&key), Some("xoxb-1")).unwrap().unwrap();
        assert!(sealed.starts_with("AESenc:"));
        assert_eq!(
            open(Some(&key), Some(&sealed)),
            (Some("xoxb-1".into()), true)
        );
        assert_eq!(open(Some(&[4u8; 64]), Some(&sealed)), (None, false));
        assert_eq!(open(None, Some(&sealed)), (None, false));
        assert_eq!(open(None, None), (None, true));
        assert_eq!(seal(None, Some("xoxb-1")).unwrap(), None);
        assert_eq!(seal(Some(&key), None).unwrap(), None);
    }

    #[test]
    fn enums_are_stored_as_their_snake_case_names() {
        assert_eq!(enum_text(&ThreadKind::Question).unwrap(), "question");
        assert_eq!(
            parse_enum::<ThreadKind>("kind", "link").unwrap(),
            ThreadKind::Link
        );
        assert_eq!(
            parse_enum::<ThreadKind>("kind", "alert").unwrap(),
            ThreadKind::Alert
        );
        assert!(parse_enum::<ThreadKind>("kind", "digest").is_err());
    }

    #[test]
    fn decode_errors_name_the_field_never_the_value() {
        let e = parse_enum::<ThreadKind>("kind", "secret-kind-text").unwrap_err();
        assert!(e.to_string().contains("kind"), "{e}");
        assert!(!e.to_string().contains("secret"), "{e}");
        let e = parse_json::<Vec<BotAnswer>>("bot_answers", Some(r#"["the secret answer"]"#))
            .unwrap_err();
        assert!(e.to_string().contains("bot_answers"), "{e}");
        assert!(!e.to_string().contains("secret"), "{e}");
        let e =
            parse_json::<Vec<BotAnswer>>("bot_answers", Some(r#"[{"ts": "secret"#)).unwrap_err();
        assert!(!e.to_string().contains("secret"), "{e}");
    }

    #[test]
    fn decode_all_skips_rows_that_fail() {
        let rows = vec!["1", "x", "3"];
        let decoded = decode_all(
            "t",
            rows,
            |r| r.to_string(),
            |r| r.parse::<i64>().map_err(|e| Error::Message(e.to_string())),
        );
        assert_eq!(decoded, vec![1, 3]);
    }
}
