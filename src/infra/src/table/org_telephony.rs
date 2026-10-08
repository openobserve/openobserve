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

//! One telephony account per org, its credentials sealed under the org DEK; region-local.

use config::utils::encryption::Algorithm;
use sea_orm::{ConnectionTrait, EntityTrait, Set, sea_query::OnConflict};
use serde::{Deserialize, Serialize};

use super::{
    cipher,
    entity::org_telephony::{ActiveModel, Column, Entity},
};
use crate::{db::get_orm_client_rw, errors};

/// An org's telephony account in the clear; deliberately neither `Debug` nor `Serialize`.
pub struct StoredAccount {
    pub provider: String,
    pub account_sid: String,
    pub auth_token: String,
    pub from_number: String,
}

/// The encrypted part of a row.
#[derive(Serialize, Deserialize)]
struct Sealed {
    account_sid: String,
    auth_token: String,
    from_number: String,
}

/// Upserts the account; needs a master key. [weak: may leave the org DEK row; a retry reuses it]
pub async fn put(org_id: &str, account: &StoredAccount, now: i64) -> Result<(), errors::Error> {
    require_encryption(cipher::is_encrypting())?;
    let dek = cipher::get_dek(org_id).await?;
    put_in(get_orm_client_rw().await, org_id, account, &dek, now).await
}

/// Reads and decrypts the org's account; an unreadable row is an error.
pub async fn get(org_id: &str) -> Result<Option<StoredAccount>, errors::Error> {
    get_in(get_orm_client_rw().await, org_id, async || {
        cipher::get_dek(org_id).await
    })
    .await
}

/// Removes the org's account; false means there was none. [strong]
pub async fn delete(org_id: &str) -> Result<bool, errors::Error> {
    delete_in(get_orm_client_rw().await, org_id).await
}

/// Refuses unless the DEKs are wrapped under a master key: a DEK alone exists in None mode too.
fn require_encryption(is_encrypting: bool) -> Result<(), errors::Error> {
    if is_encrypting {
        return Ok(());
    }
    Err(errors::Error::Message(
        "org telephony accounts need O2_MASTER_ENCRYPTION_KEY set and stored secrets on"
            .to_string(),
    ))
}

async fn put_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    account: &StoredAccount,
    dek: &[u8],
    now: i64,
) -> Result<(), errors::Error> {
    let sealed = serde_json::to_string(&Sealed {
        account_sid: account.account_sid.clone(),
        auth_token: account.auth_token.clone(),
        from_number: account.from_number.clone(),
    })?;
    let data = Algorithm::Aes256Siv
        .encrypt(dek, &sealed)
        .map_err(|e| errors::Error::Message(format!("org_telephony {org_id}: {e}")))?;
    let model = ActiveModel {
        org_id: Set(org_id.to_string()),
        provider: Set(account.provider.clone()),
        data: Set(data),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Entity::insert(model)
        .on_conflict(
            OnConflict::column(Column::OrgId)
                .update_columns([Column::Provider, Column::Data, Column::UpdatedAt])
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

/// Calls `dek` only for a stored row: with secrets off it errors, and no row must mean `None`.
async fn get_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    dek: impl AsyncFnOnce() -> Result<Vec<u8>, errors::Error>,
) -> Result<Option<StoredAccount>, errors::Error> {
    let Some(row) = Entity::find_by_id(org_id).one(conn).await? else {
        return Ok(None);
    };
    let dek = dek().await?;
    let plaintext = Algorithm::Aes256Siv
        .decrypt(&dek, &row.data)
        .map_err(|e| errors::Error::Message(format!("org_telephony {org_id}: {e}")))?;
    // serde's message can quote the decrypted value, so only its position is kept.
    let sealed: Sealed = serde_json::from_str(&plaintext).map_err(|e| {
        errors::Error::Message(format!(
            "org_telephony {org_id}: stored account unreadable ({:?} at line {} column {})",
            e.classify(),
            e.line(),
            e.column()
        ))
    })?;
    Ok(Some(StoredAccount {
        provider: row.provider,
        account_sid: sealed.account_sid,
        auth_token: sealed.auth_token,
        from_number: sealed.from_number,
    }))
}

async fn delete_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<bool, errors::Error> {
    let deleted = Entity::delete_by_id(org_id).exec(conn).await?.rows_affected;
    Ok(deleted == 1)
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema, Statement};

    use super::*;
    use crate::table::entity::org_telephony::Model;

    const ORG: &str = "acme";
    const SID: &str = "ACtestaccountsid000000000001";
    const TOKEN: &str = "s3cr3t-auth-token";

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(Entity)))
            .await
            .unwrap();
        db
    }

    fn dek(byte: u8) -> Vec<u8> {
        vec![byte; 64]
    }

    fn account(from_number: &str) -> StoredAccount {
        StoredAccount {
            provider: "twilio".into(),
            account_sid: SID.into(),
            auth_token: TOKEN.into(),
            from_number: from_number.into(),
        }
    }

    fn fields(account: &StoredAccount) -> [&str; 4] {
        [
            &account.provider,
            &account.account_sid,
            &account.auth_token,
            &account.from_number,
        ]
    }

    async fn row(db: &DatabaseConnection) -> Option<Model> {
        Entity::find_by_id(ORG).one(db).await.unwrap()
    }

    /// Every later write to the table aborts, as a lost connection would.
    async fn fail_writes(db: &DatabaseConnection) {
        for event in ["INSERT", "UPDATE", "DELETE"] {
            db.execute(Statement::from_string(
                db.get_database_backend(),
                format!(
                    "CREATE TRIGGER fail_{event} BEFORE {event} ON org_telephony \
                     BEGIN SELECT RAISE(ABORT, 'forced'); END"
                ),
            ))
            .await
            .unwrap();
        }
    }

    #[test]
    fn test_put_refuses_unless_encrypting() {
        assert!(require_encryption(false).is_err());
        assert!(require_encryption(true).is_ok());
    }

    #[tokio::test]
    async fn test_put_stores_neither_the_token_nor_the_sid_readably() {
        let db = db().await;
        put_in(&db, ORG, &account("+15550100"), &dek(7), 100)
            .await
            .unwrap();

        let stored = row(&db).await.unwrap();
        let plaintext = serde_json::json!({
            "account_sid": SID,
            "auth_token": TOKEN,
            "from_number": "+15550100",
        })
        .to_string();
        assert_eq!(stored.provider, "twilio");
        assert_ne!(stored.data, plaintext);
        assert_ne!(stored.data, BASE64_STANDARD.encode(&plaintext));
        assert!(!stored.data.contains(TOKEN), "{}", stored.data);
        assert!(!stored.data.contains(SID), "{}", stored.data);
    }

    #[tokio::test]
    async fn test_get_round_trips_the_account() {
        let db = db().await;
        put_in(&db, ORG, &account("+15550100"), &dek(7), 100)
            .await
            .unwrap();

        let got = get_in(&db, ORG, async || Ok(dek(7)))
            .await
            .unwrap()
            .unwrap();

        assert_eq!(fields(&got), fields(&account("+15550100")));
    }

    #[tokio::test]
    async fn test_get_without_a_row_is_none_and_never_asks_for_the_dek() {
        let db = db().await;
        let got = get_in(&db, ORG, async || {
            Err(errors::Error::Message("secrets are off".into()))
        })
        .await
        .unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn test_get_that_cannot_decrypt_is_an_error() {
        let db = db().await;
        put_in(&db, ORG, &account("+15550100"), &dek(7), 100)
            .await
            .unwrap();

        assert!(get_in(&db, ORG, async || Ok(dek(8))).await.is_err());
        assert!(
            get_in(&db, ORG, async || {
                Err(errors::Error::Message("secrets are off".into()))
            })
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn test_put_again_replaces_the_account_and_keeps_created_at() {
        let db = db().await;
        put_in(&db, ORG, &account("+15550100"), &dek(7), 100)
            .await
            .unwrap();

        put_in(&db, ORG, &account("+15550199"), &dek(7), 200)
            .await
            .unwrap();

        let stored = row(&db).await.unwrap();
        assert_eq!((stored.created_at, stored.updated_at), (100, 200));
        let got = get_in(&db, ORG, async || Ok(dek(7)))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got.from_number, "+15550199");
    }

    #[tokio::test]
    async fn test_a_failed_put_leaves_the_row() {
        let db = db().await;
        put_in(&db, ORG, &account("+15550100"), &dek(7), 100)
            .await
            .unwrap();
        let before = row(&db).await;
        fail_writes(&db).await;

        assert!(
            put_in(&db, ORG, &account("+15550199"), &dek(7), 200)
                .await
                .is_err()
        );

        assert_eq!(row(&db).await, before);
    }

    #[tokio::test]
    async fn test_delete_removes_the_row() {
        let db = db().await;
        put_in(&db, ORG, &account("+15550100"), &dek(7), 100)
            .await
            .unwrap();

        assert!(delete_in(&db, ORG).await.unwrap());

        assert_eq!(row(&db).await, None);
        assert!(
            !delete_in(&db, ORG).await.unwrap(),
            "nothing left to delete"
        );
    }

    #[tokio::test]
    async fn test_a_failed_delete_leaves_the_row() {
        let db = db().await;
        put_in(&db, ORG, &account("+15550100"), &dek(7), 100)
            .await
            .unwrap();
        let before = row(&db).await;
        fail_writes(&db).await;

        assert!(delete_in(&db, ORG).await.is_err());

        assert_eq!(row(&db).await, before);
    }
}
