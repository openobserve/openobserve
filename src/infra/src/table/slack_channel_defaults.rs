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

use config::meta::slack::SlackChannelDefault;
use sea_orm::ConnectionTrait;

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

pub async fn put(row: &SlackChannelDefault) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(
    installation_id: &str,
    channel_id: &str,
) -> Result<Option<SlackChannelDefault>, Error> {
    get_with(get_orm_client_ro().await, installation_id, channel_id).await
}

pub async fn list_by_installation(
    installation_id: &str,
) -> Result<Vec<SlackChannelDefault>, Error> {
    list_by_installation_with(get_orm_client_ro().await, installation_id).await
}

pub async fn delete(installation_id: &str, channel_id: &str) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, installation_id, channel_id).await
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn put_with<C: ConnectionTrait>(
    _conn: &C,
    _row: &SlackChannelDefault,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn get_with<C: ConnectionTrait>(
    _conn: &C,
    _installation_id: &str,
    _channel_id: &str,
) -> Result<Option<SlackChannelDefault>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn list_by_installation_with<C: ConnectionTrait>(
    _conn: &C,
    _installation_id: &str,
) -> Result<Vec<SlackChannelDefault>, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn delete_with<C: ConnectionTrait>(
    _conn: &C,
    _installation_id: &str,
    _channel_id: &str,
) -> Result<(), Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    _conn: &C,
    _org_id: &str,
) -> Result<u64, Error> {
    Err(Error::Message("slack phase0: not implemented".to_string()))
}
