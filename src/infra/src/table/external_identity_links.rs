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

use config::meta::slack::{ExternalIdentityLink, RevokedReason};
use sea_orm::ConnectionTrait;

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

/// Upserts on (provider, installation_id, external_user_id).
pub async fn put(row: &ExternalIdentityLink) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(id: &str) -> Result<Option<ExternalIdentityLink>, Error> {
    get_with(get_orm_client_ro().await, id).await
}

pub async fn get_by_slack_user(
    installation_id: &str,
    external_user_id: &str,
) -> Result<Option<ExternalIdentityLink>, Error> {
    get_by_slack_user_with(get_orm_client_ro().await, installation_id, external_user_id).await
}

pub async fn list_by_installation(
    installation_id: &str,
    cursor: Option<&str>,
    limit: u64,
) -> Result<Vec<ExternalIdentityLink>, Error> {
    list_by_installation_with(get_orm_client_ro().await, installation_id, cursor, limit).await
}

pub async fn list_by_email(email: &str) -> Result<Vec<ExternalIdentityLink>, Error> {
    list_by_email_with(get_orm_client_ro().await, email).await
}

pub async fn revoke(id: &str, reason: RevokedReason, at: i64) -> Result<(), Error> {
    revoke_with(get_orm_client_rw().await, id, reason, at).await
}

/// Column-only update that leaves `updated_at`, so it never overwrites a concurrent revoke.
pub async fn touch_last_used(id: &str, at: i64) -> Result<(), Error> {
    touch_last_used_with(get_orm_client_rw().await, id, at).await
}

pub async fn delete(id: &str) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, id).await
}

/// Keeps `unlinked` rows: they are the record that suppresses automatic linking.
pub async fn delete_revoked_before(at: i64) -> Result<u64, Error> {
    delete_revoked_before_with(get_orm_client_rw().await, at).await
}

pub async fn put_with<C: ConnectionTrait>(
    _conn: &C,
    _row: &ExternalIdentityLink,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn get_with<C: ConnectionTrait>(
    _conn: &C,
    _id: &str,
) -> Result<Option<ExternalIdentityLink>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn get_by_slack_user_with<C: ConnectionTrait>(
    _conn: &C,
    _installation_id: &str,
    _external_user_id: &str,
) -> Result<Option<ExternalIdentityLink>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn list_by_installation_with<C: ConnectionTrait>(
    _conn: &C,
    _installation_id: &str,
    _cursor: Option<&str>,
    _limit: u64,
) -> Result<Vec<ExternalIdentityLink>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn list_by_email_with<C: ConnectionTrait>(
    _conn: &C,
    _email: &str,
) -> Result<Vec<ExternalIdentityLink>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn revoke_with<C: ConnectionTrait>(
    _conn: &C,
    _id: &str,
    _reason: RevokedReason,
    _at: i64,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn touch_last_used_with<C: ConnectionTrait>(
    _conn: &C,
    _id: &str,
    _at: i64,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn delete_with<C: ConnectionTrait>(_conn: &C, _id: &str) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn delete_revoked_before_with<C: ConnectionTrait>(
    _conn: &C,
    _at: i64,
) -> Result<u64, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}
