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

use config::meta::slack::SlackLinkRequest;
use sea_orm::ConnectionTrait;

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

pub async fn put(row: &SlackLinkRequest) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(id: &str) -> Result<Option<SlackLinkRequest>, Error> {
    get_with(get_orm_client_ro().await, id).await
}

/// Counts discarded requests too, so Not now cannot reset the rate limit.
pub async fn count_created_since(
    installation_id: &str,
    external_user_id: &str,
    since: i64,
) -> Result<u64, Error> {
    count_created_since_with(
        get_orm_client_ro().await,
        installation_id,
        external_user_id,
        since,
    )
    .await
}

pub async fn mark_redeemed(id: &str, at: i64) -> Result<(), Error> {
    mark_redeemed_with(get_orm_client_rw().await, id, at).await
}

pub async fn mark_discarded(id: &str, at: i64) -> Result<(), Error> {
    mark_discarded_with(get_orm_client_rw().await, id, at).await
}

pub async fn clear_nonce(id: &str) -> Result<(), Error> {
    clear_nonce_with(get_orm_client_rw().await, id).await
}

pub async fn delete_finished_before(at: i64) -> Result<u64, Error> {
    delete_finished_before_with(get_orm_client_rw().await, at).await
}

pub async fn put_with<C: ConnectionTrait>(_conn: &C, _row: &SlackLinkRequest) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn get_with<C: ConnectionTrait>(
    _conn: &C,
    _id: &str,
) -> Result<Option<SlackLinkRequest>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn count_created_since_with<C: ConnectionTrait>(
    _conn: &C,
    _installation_id: &str,
    _external_user_id: &str,
    _since: i64,
) -> Result<u64, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn mark_redeemed_with<C: ConnectionTrait>(
    _conn: &C,
    _id: &str,
    _at: i64,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn mark_discarded_with<C: ConnectionTrait>(
    _conn: &C,
    _id: &str,
    _at: i64,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn clear_nonce_with<C: ConnectionTrait>(_conn: &C, _id: &str) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn delete_finished_before_with<C: ConnectionTrait>(
    _conn: &C,
    _at: i64,
) -> Result<u64, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}
