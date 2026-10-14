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

use config::meta::slack::SlackInstallation;
use sea_orm::ConnectionTrait;

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

pub async fn put(row: &SlackInstallation) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(id: &str) -> Result<Option<SlackInstallation>, Error> {
    get_with(get_orm_client_ro().await, id).await
}

pub async fn get_by_team(
    app_id: &str,
    enterprise_id: &str,
    team_id: &str,
) -> Result<Option<SlackInstallation>, Error> {
    get_by_team_with(get_orm_client_ro().await, app_id, enterprise_id, team_id).await
}

pub async fn list() -> Result<Vec<SlackInstallation>, Error> {
    list_with(get_orm_client_ro().await).await
}

pub async fn list_by_ids(ids: &[String]) -> Result<Vec<SlackInstallation>, Error> {
    list_by_ids_with(get_orm_client_ro().await, ids).await
}

/// Sets `revoked_at` and nulls every `*_enc` column.
pub async fn revoke(id: &str, at: i64) -> Result<(), Error> {
    revoke_with(get_orm_client_rw().await, id, at).await
}

pub async fn delete(id: &str) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, id).await
}

pub async fn put_with<C: ConnectionTrait>(
    _conn: &C,
    _row: &SlackInstallation,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn get_with<C: ConnectionTrait>(
    _conn: &C,
    _id: &str,
) -> Result<Option<SlackInstallation>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn get_by_team_with<C: ConnectionTrait>(
    _conn: &C,
    _app_id: &str,
    _enterprise_id: &str,
    _team_id: &str,
) -> Result<Option<SlackInstallation>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn list_with<C: ConnectionTrait>(_conn: &C) -> Result<Vec<SlackInstallation>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn list_by_ids_with<C: ConnectionTrait>(
    _conn: &C,
    _ids: &[String],
) -> Result<Vec<SlackInstallation>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn revoke_with<C: ConnectionTrait>(_conn: &C, _id: &str, _at: i64) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn delete_with<C: ConnectionTrait>(_conn: &C, _id: &str) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}
