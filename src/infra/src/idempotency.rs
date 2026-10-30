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

//! Replayable client requests for the SDK companion APIs.
//!
//! A client that retries a request it never saw the response to must not
//! duplicate its effect. This module owns the whole rule: the key is scoped so
//! it cannot collide across resources, the canonical request hash decides
//! replay from conflict, and the stored response is what a replay returns. The
//! record is written by the same transaction as the effect it describes, so a
//! stored response always corresponds to work that actually committed.

use chrono::Utc;
use config::ider;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, sea_query::OnConflict};
use serde_json::Value;

use crate::{db::get_orm_client_rw, table::entity::llm_idempotency_records as records};

/// How long a key, its request hash, and its response stay replayable.
pub const RETENTION_MILLIS: i64 = 24 * 60 * 60 * 1_000;

/// The namespace a client key is unique within.
///
/// Dataset upsert keys are `(org_id, dataset_id)`-scoped so the same key used
/// against two Datasets is two independent requests.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Scope(String);

impl Scope {
    pub fn dataset(dataset_id: &str) -> Self {
        Self(format!("dataset:{dataset_id}"))
    }
    /// Prompt creation is organization-scoped because names are unique within
    /// an organization and one key must not create two logical prompts.
    pub fn prompt_create() -> Self {
        Self("prompt_create".to_string())
    }

    /// Prompt version keys are scoped to the stable logical prompt identity.
    pub fn prompt_version(entity_id: &str) -> Self {
        Self(format!("prompt_version:{entity_id}"))
    }

    pub fn experiment_create() -> Self {
        Self("experiment_create".to_string())
    }

    /// Clone keys live in their own namespace: a clone request carries the
    /// source Experiment it forked, so the same key against create and against
    /// clone describes two different requests rather than a conflict.
    pub fn experiment_clone() -> Self {
        Self("experiment_clone".to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, thiserror::Error)]
pub enum IdempotencyError {
    #[error(transparent)]
    Database(#[from] sea_orm::DbErr),
    #[error("Idempotency key is already associated with a different request")]
    Conflict,
    #[error("Stored idempotent response is malformed: {0}")]
    MalformedStoredResponse(String),
}

/// Digests a replay lookup accepts for one request.
#[derive(Clone, Debug)]
pub struct RequestHash {
    canonical: String,
    // Insertion-order digest written before keys were sorted; drop after one release.
    legacy: String,
}

impl RequestHash {
    /// The digest stored with new records.
    pub fn as_str(&self) -> &str {
        &self.canonical
    }

    fn matches(&self, stored: &str) -> bool {
        stored == self.canonical || stored == self.legacy
    }
}

/// Hex SHA-256 over JSON with object keys sorted recursively; array order stays significant.
pub fn canonical_sha256(value: &Value) -> String {
    let mut canonical = value.clone();
    canonical.sort_all_objects();
    sha256::digest(canonical.to_string())
}

/// Digests a request for replay lookup while retaining the previous
/// insertion-order digest for one-release compatibility.
pub fn request_hash(request: &Value) -> RequestHash {
    RequestHash {
        canonical: canonical_sha256(request),
        legacy: sha256::digest(request.to_string()),
    }
}

/// What a key lookup found for this request.
#[derive(Clone, Debug, PartialEq)]
pub enum Replay {
    /// No live record: the caller performs the work and then calls [`record`].
    Fresh,
    /// The same request already committed. Return this response verbatim.
    Stored(Value),
}

/// Resolve a key against its stored record.
///
/// An expired record is treated as absent — the retention window is the whole
/// guarantee, and a key is reusable once it lapses.
pub async fn lookup<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    scope: &Scope,
    key: &str,
    request_hash: &RequestHash,
    now: i64,
) -> Result<Replay, IdempotencyError> {
    let Some(existing) = find(db, org_id, scope, key).await? else {
        return Ok(Replay::Fresh);
    };
    if existing.expires_at <= now {
        return Ok(Replay::Fresh);
    }
    if !request_hash.matches(&existing.request_hash) {
        return Err(IdempotencyError::Conflict);
    }
    Ok(Replay::Stored(existing.response))
}

/// Persist the key, its request hash, and the response a replay will return.
///
/// Must run inside the same transaction as the work it describes. An expired
/// row for the same key is overwritten rather than colliding.
pub async fn record<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    scope: &Scope,
    key: &str,
    request_hash: &RequestHash,
    response: Value,
    now: i64,
) -> Result<(), IdempotencyError> {
    let model = records::ActiveModel {
        id: Set(ider::generate()),
        org_id: Set(org_id.to_string()),
        scope: Set(scope.as_str().to_string()),
        idempotency_key: Set(key.to_string()),
        request_hash: Set(request_hash.as_str().to_string()),
        response: Set(response),
        created_at: Set(now),
        expires_at: Set(now.saturating_add(RETENTION_MILLIS)),
    };
    records::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([
                records::Column::OrgId,
                records::Column::Scope,
                records::Column::IdempotencyKey,
            ])
            .update_columns([
                records::Column::RequestHash,
                records::Column::Response,
                records::Column::CreatedAt,
                records::Column::ExpiresAt,
            ])
            .to_owned(),
        )
        .exec(db)
        .await?;
    Ok(())
}

/// Drop every record whose retention window has closed.
pub async fn purge_expired<C: ConnectionTrait>(db: &C, now: i64) -> Result<u64, IdempotencyError> {
    Ok(records::Entity::delete_many()
        .filter(records::Column::ExpiresAt.lte(now))
        .exec(db)
        .await?
        .rows_affected)
}

fn now_millis() -> i64 {
    Utc::now().timestamp_millis()
}

/// Drop every record whose retention window closed before now.
///
/// Expiry is already enforced on read, so this only reclaims storage — a
/// missed pass changes no behavior.
pub async fn purge_expired_records() -> Result<u64, IdempotencyError> {
    let db = get_orm_client_rw().await;
    purge_expired(db, now_millis()).await
}

async fn find<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    scope: &Scope,
    key: &str,
) -> Result<Option<records::Model>, IdempotencyError> {
    Ok(records::Entity::find()
        .filter(records::Column::OrgId.eq(org_id))
        .filter(records::Column::Scope.eq(scope.as_str()))
        .filter(records::Column::IdempotencyKey.eq(key))
        .one(db)
        .await?)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    async fn setup_db() -> sea_orm::DatabaseConnection {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let schema = sea_orm::Schema::new(sea_orm::DatabaseBackend::Sqlite);
        let statement = schema.create_table_from_entity(records::Entity);
        db.execute(db.get_database_backend().build(&statement))
            .await
            .unwrap();
        db.execute_unprepared(
            "CREATE UNIQUE INDEX uq_llm_idempotency_records_scope_key \
             ON llm_idempotency_records (org_id, scope, idempotency_key)",
        )
        .await
        .unwrap();
        db
    }

    fn stored(replay: Replay) -> Option<Value> {
        match replay {
            Replay::Fresh => None,
            Replay::Stored(value) => Some(value),
        }
    }

    #[test]
    fn field_order_does_not_change_the_request_hash() {
        let left = json!({"items": [{"logical_id": "case-42", "input": "q"}], "trials": 3});
        let right = json!({"trials": 3, "items": [{"input": "q", "logical_id": "case-42"}]});
        assert_eq!(request_hash(&left).as_str(), request_hash(&right).as_str());

        let changed = json!({"trials": 4, "items": [{"input": "q", "logical_id": "case-42"}]});
        assert_ne!(
            request_hash(&left).as_str(),
            request_hash(&changed).as_str()
        );
    }

    #[tokio::test]
    async fn a_record_hashed_before_key_sorting_still_replays() {
        let db = setup_db().await;
        let request = json!({"trials": 3, "items": [{"logical_id": "case-42", "input": "q"}]});
        let legacy = RequestHash {
            canonical: sha256::digest(request.to_string()),
            legacy: String::new(),
        };
        record(
            &db,
            "org-1",
            &Scope::dataset("dataset-1"),
            "key-1",
            &legacy,
            json!({"ok": true}),
            10,
        )
        .await
        .unwrap();

        let replay = lookup(
            &db,
            "org-1",
            &Scope::dataset("dataset-1"),
            "key-1",
            &request_hash(&request),
            11,
        )
        .await
        .unwrap();
        assert_eq!(stored(replay), Some(json!({"ok": true})));
    }

    #[test]
    fn keys_are_scoped_to_their_logical_resource() {
        assert_ne!(Scope::dataset("dataset-1"), Scope::dataset("dataset-2"));
        assert_eq!(Scope::dataset("dataset-1").as_str(), "dataset:dataset-1");
        assert_eq!(Scope::experiment_create().as_str(), "experiment_create");
        assert_eq!(Scope::prompt_create().as_str(), "prompt_create");
        assert_ne!(
            Scope::prompt_version("prompt-1"),
            Scope::prompt_version("prompt-2")
        );
    }

    #[tokio::test]
    async fn an_identical_retry_replays_the_first_response() {
        let db = setup_db().await;
        let hash = request_hash(&json!({"items": []}));

        assert!(
            stored(
                lookup(
                    &db,
                    "org-1",
                    &Scope::dataset("dataset-1"),
                    "key-1",
                    &hash,
                    10
                )
                .await
                .unwrap()
            )
            .is_none()
        );

        record(
            &db,
            "org-1",
            &Scope::dataset("dataset-1"),
            "key-1",
            &hash,
            json!({"accepted": 2}),
            10,
        )
        .await
        .unwrap();

        let replay = lookup(
            &db,
            "org-1",
            &Scope::dataset("dataset-1"),
            "key-1",
            &hash,
            20,
        )
        .await
        .unwrap();
        assert_eq!(stored(replay), Some(json!({"accepted": 2})));
    }

    #[tokio::test]
    async fn different_content_under_the_same_key_conflicts() {
        let db = setup_db().await;
        record(
            &db,
            "org-1",
            &Scope::dataset("dataset-1"),
            "key-1",
            &request_hash(&json!({"items": []})),
            json!({"accepted": 0}),
            10,
        )
        .await
        .unwrap();

        let error = lookup(
            &db,
            "org-1",
            &Scope::dataset("dataset-1"),
            "key-1",
            &request_hash(&json!({"items": [1]})),
            20,
        )
        .await
        .unwrap_err();
        assert!(matches!(error, IdempotencyError::Conflict));
    }

    #[tokio::test]
    async fn the_same_key_against_another_dataset_is_a_separate_request() {
        let db = setup_db().await;
        let hash = request_hash(&json!({"items": []}));
        record(
            &db,
            "org-1",
            &Scope::dataset("dataset-1"),
            "key-1",
            &hash,
            json!({"accepted": 1}),
            10,
        )
        .await
        .unwrap();

        let other_dataset = lookup(
            &db,
            "org-1",
            &Scope::dataset("dataset-2"),
            "key-1",
            &request_hash(&json!({"items": [1]})),
            20,
        )
        .await
        .unwrap();
        assert!(stored(other_dataset).is_none());

        let other_org = lookup(
            &db,
            "org-2",
            &Scope::dataset("dataset-1"),
            "key-1",
            &request_hash(&json!({"items": [1]})),
            20,
        )
        .await
        .unwrap();
        assert!(stored(other_org).is_none());
    }

    #[tokio::test]
    async fn a_lapsed_record_stops_replaying_and_stops_conflicting() {
        let db = setup_db().await;
        let scope = Scope::dataset("dataset-1");
        record(
            &db,
            "org-1",
            &scope,
            "key-1",
            &request_hash(&json!({"items": []})),
            json!({"accepted": 1}),
            10,
        )
        .await
        .unwrap();

        let expired_at = 10 + RETENTION_MILLIS;
        let replay = lookup(
            &db,
            "org-1",
            &scope,
            "key-1",
            &request_hash(&json!({"items": [1]})),
            expired_at,
        )
        .await
        .unwrap();
        assert!(stored(replay).is_none());

        // Reusing the lapsed key overwrites it rather than colliding.
        record(
            &db,
            "org-1",
            &scope,
            "key-1",
            &request_hash(&json!({"items": [1]})),
            json!({"accepted": 9}),
            expired_at,
        )
        .await
        .unwrap();
        let replay = lookup(
            &db,
            "org-1",
            &scope,
            "key-1",
            &request_hash(&json!({"items": [1]})),
            expired_at + 1,
        )
        .await
        .unwrap();
        assert_eq!(stored(replay), Some(json!({"accepted": 9})));
    }

    #[tokio::test]
    async fn purge_removes_only_lapsed_records() {
        let db = setup_db().await;
        for (key, created_at) in [("old", 10_i64), ("fresh", 10 + RETENTION_MILLIS)] {
            record(
                &db,
                "org-1",
                &Scope::dataset("dataset-1"),
                key,
                &request_hash(&json!({})),
                json!({}),
                created_at,
            )
            .await
            .unwrap();
        }

        let removed = purge_expired(&db, 10 + RETENTION_MILLIS).await.unwrap();
        assert_eq!(removed, 1);
        assert!(
            find(&db, "org-1", &Scope::dataset("dataset-1"), "old")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            find(&db, "org-1", &Scope::dataset("dataset-1"), "fresh")
                .await
                .unwrap()
                .is_some()
        );
    }
}
