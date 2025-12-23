// Copyright 2025 OpenObserve Inc.
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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, sea_query::OnConflict};

use super::entity::sessions::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// Gets a session by session_id
pub async fn get(session_id: &str) -> Result<Option<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let session = Entity::find()
        .filter(Column::SessionId.eq(session_id))
        .one(client)
        .await?;
    Ok(session)
}

/// Creates or updates a session atomically using upsert
/// expires_at: expiry time in microseconds since epoch
pub async fn set(
    session_id: &str,
    access_token: &str,
    expires_at: i64,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    // Use atomic upsert to avoid race conditions
    let active_model = ActiveModel {
        session_id: Set(session_id.to_string()),
        access_token: Set(access_token.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        expires_at: Set(expires_at),
    };

    Entity::insert(active_model)
        .on_conflict(
            OnConflict::column(Column::SessionId)
                .update_columns([Column::AccessToken, Column::UpdatedAt, Column::ExpiresAt])
                .to_owned(),
        )
        .exec(client)
        .await?;

    Ok(())
}

/// Deletes a session by session_id
pub async fn delete(session_id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::SessionId.eq(session_id))
        .exec(client)
        .await?;
    Ok(())
}

/// Lists all sessions
pub async fn list() -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let sessions = Entity::find().all(client).await?;
    Ok(sessions)
}

/// Checks if a session has expired
pub fn is_expired(session: &Model) -> bool {
    let now = chrono::Utc::now().timestamp_micros();
    session.expires_at <= now
}

/// Deletes all expired sessions from the database
/// Returns the number of sessions deleted
pub async fn delete_expired() -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    let result = Entity::delete_many()
        .filter(Column::ExpiresAt.lte(now))
        .exec(client)
        .await?;

    Ok(result.rows_affected)
}
