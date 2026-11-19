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

//! Table ops for `ai_memory` and `ai_memory_revisions`; text is plaintext
//! here and ciphertext under the org DEK in the tables. Never publishes; `src/db` does.

use config::meta::ai::memory::{
    AgentMemoryWrites, Author, ContentError, EditError, EditFlag, Evidence, MemoryEdit,
    MemoryScope, MemorySettings, RevisionState, WriteMode, apply_edits, edit_flags,
    effective_agent_writes, validate_content, write_mode,
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
    sea_query::{Expr, Func, OnConflict},
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::entity::{
    ai_chat_sessions, ai_chat_turns, ai_memory, ai_memory_revisions, org_ai_toolsets, org_users,
    users,
};
use crate::{db::get_orm_client_rw, errors};

/// ENT's `RCA_AGENT_TYPE` (infra can't depend on ENT); an RCA chat has no person behind it.
pub const RCA_CHAT_AGENT_TYPE: &str = "sre-rca";
const PEOPLE_KEPT: usize = 200;
const AGENT_KEPT: usize = 50;
const MICROS_PER_DAY: i64 = 24 * 3600 * 1_000_000;
const PEOPLE_KEPT_MICROS: i64 = 365 * MICROS_PER_DAY;
const DISCARDED_KEPT_MICROS: i64 = 30 * MICROS_PER_DAY;

/// `scope_key` is `''` for org memory, the toolset's normalized name, or the user's `users.id`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryKey {
    pub org: String,
    pub scope: MemoryScope,
    pub scope_key: String,
}

impl MemoryKey {
    pub fn org(org: &str) -> Self {
        Self::new(org, MemoryScope::Org, "")
    }

    pub fn toolset(org: &str, normalized_name: &str) -> Self {
        Self::new(org, MemoryScope::Toolset, normalized_name)
    }

    pub fn user(org: &str, user_id: &str) -> Self {
        Self::new(org, MemoryScope::User, user_id)
    }

    fn new(org: &str, scope: MemoryScope, scope_key: &str) -> Self {
        Self {
            org: org.to_string(),
            scope,
            scope_key: scope_key.to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Memory {
    pub id: String,
    pub key: MemoryKey,
    pub content: String,
    pub rev: i64,
    pub op_id: Option<String>,
    pub updated_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub settings: MemorySettings,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Revision {
    pub id: String,
    pub memory_id: String,
    pub rev: Option<i64>,
    pub state: RevisionState,
    pub base_rev: i64,
    pub edits: Option<Vec<MemoryEdit>>,
    /// An applied snapshot, or a person's proposed whole text; `None` in history lists.
    pub content: Option<String>,
    pub updated_by: String,
    pub reason: Option<String>,
    pub evidence: Option<Vec<Evidence>>,
    pub origin_region: String,
    pub op_id: String,
    pub created_at: i64,
    /// Set on pending agent edits; empty otherwise.
    pub flags: Vec<EditFlag>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingRevision {
    pub key: MemoryKey,
    pub revision: Revision,
}

/// The whole new text, or edits applied to the current one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Change {
    Content(String),
    Edits(Vec<MemoryEdit>),
}

/// Who wrote, why, and from where; `now` is the write time in microseconds.
#[derive(Clone, Debug)]
pub struct WriteMeta {
    pub author: Author,
    pub reason: Option<String>,
    pub evidence: Option<Vec<Evidence>>,
    pub origin_region: String,
    pub now: i64,
}

/// One write: settings to save with it (empty for none) and the text change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Write {
    pub base_rev: i64,
    pub change: Change,
    pub settings: MemorySettings,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Applied {
        rev: i64,
        op_id: String,
    },
    /// The change would leave the text as it is, so no revision was written.
    Unchanged {
        rev: i64,
    },
    SettingsSaved {
        rev: i64,
        op_id: Option<String>,
    },
    Pending {
        revision_id: String,
    },
    Discarded,
    RevConflict {
        rev: i64,
        content: String,
    },
    EditConflict(EditError),
    /// Over the cap, or text that looks like a secret.
    Invalid(ContentError),
    NotFound,
}

/// An agent's edit for a turn; `toolset` is the target toolset's `(normalized name, id)`.
#[derive(Clone, Debug)]
pub struct AgentWrite {
    pub org: String,
    pub session_id: String,
    pub turn_id: String,
    /// Turns started before this (microseconds) died with their node.
    pub running_since: i64,
    pub scope: MemoryScope,
    pub toolset: Option<(String, String)>,
    pub base_rev: i64,
    pub edits: Vec<MemoryEdit>,
    pub reason: Option<String>,
    pub evidence: Vec<Evidence>,
    pub origin_region: String,
    pub now: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentOutcome {
    TurnNotRunning,
    /// An RCA turn has no person whose memory it could write.
    UserScopeRefused,
    WritesOff,
    Written(MemoryKey, Outcome),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolsetDelete {
    NotFound,
    /// `memory` is the key whose memory went with the toolset, if any did.
    Deleted {
        memory: Option<MemoryKey>,
    },
}

/// One applied or discarded revision as history trimming sees it.
struct HistoryRow {
    id: String,
    state: String,
    by_agent: bool,
    created_at: i64,
    op_id: String,
}

/// The new head of a memory.
struct Head<'a> {
    content: &'a str,
    op_id: &'a str,
    updated_by: &'a str,
    now: i64,
}

/// A revision row to insert; `edits` and `content` are plaintext.
struct NewRevision<'a> {
    memory_id: &'a str,
    org: &'a str,
    rev: Option<i64>,
    state: RevisionState,
    base_rev: i64,
    edits: Option<&'a [MemoryEdit]>,
    content: Option<&'a str>,
    op_id: String,
    meta: &'a WriteMeta,
    flags: &'a [EditFlag],
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    key: &MemoryKey,
) -> Result<Option<Memory>, errors::Error> {
    match find_by_key(conn, key).await? {
        Some(model) => to_memory(model, dek).map(Some),
        None => Ok(None),
    }
}

/// The org's shared memories and the user's own, read for delivery with a turn.
pub async fn load_for_turn(
    org: &str,
    user_id: Option<&str>,
) -> Result<(Vec<Memory>, Option<Memory>), errors::Error> {
    let dek = super::cipher::get_dek(org).await?;
    let conn = crate::db::get_orm_client_ro().await;
    let shared = list_shared_with(conn, &dek, org).await?;
    let user = match user_id {
        Some(id) => get_with(conn, &dek, &MemoryKey::user(org, id)).await?,
        None => None,
    };
    Ok((shared, user))
}

/// The org's org and toolset memories, one query.
pub async fn list_shared_with<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    org: &str,
) -> Result<Vec<Memory>, errors::Error> {
    ai_memory::Entity::find()
        .filter(ai_memory::Column::Org.eq(org))
        .filter(ai_memory::Column::Scope.ne(MemoryScope::User.as_str()))
        .all(conn)
        .await?
        .into_iter()
        .map(|model| to_memory(model, dek))
        .collect()
}

pub async fn count_pending_with<C: ConnectionTrait>(
    conn: &C,
    memory_id: &str,
) -> Result<u64, errors::Error> {
    Ok(ai_memory_revisions::Entity::find()
        .filter(ai_memory_revisions::Column::MemoryId.eq(memory_id))
        .filter(ai_memory_revisions::Column::State.eq(RevisionState::Pending.as_str()))
        .count(conn)
        .await?)
}

/// Newest first, without each revision's full content.
pub async fn list_revisions_with<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    memory_id: &str,
) -> Result<Vec<Revision>, errors::Error> {
    ai_memory_revisions::Entity::find()
        .filter(ai_memory_revisions::Column::MemoryId.eq(memory_id))
        .order_by_desc(ai_memory_revisions::Column::CreatedAt)
        .all(conn)
        .await?
        .into_iter()
        .map(|model| {
            to_revision(
                ai_memory_revisions::Model {
                    content: None,
                    ..model
                },
                dek,
            )
        })
        .collect()
}

/// The revision only if it belongs to `memory_id`.
pub async fn get_revision_with<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    memory_id: &str,
    revision_id: &str,
) -> Result<Option<Revision>, errors::Error> {
    match find_revision(conn, memory_id, revision_id, None).await? {
        Some(model) => to_revision(model, dek).map(Some),
        None => Ok(None),
    }
}

/// Every pending revision of the org, oldest first.
pub async fn list_pending_with<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    org: &str,
) -> Result<Vec<PendingRevision>, errors::Error> {
    let pending = ai_memory_revisions::Entity::find()
        .filter(ai_memory_revisions::Column::Org.eq(org))
        .filter(ai_memory_revisions::Column::State.eq(RevisionState::Pending.as_str()))
        .order_by_asc(ai_memory_revisions::Column::CreatedAt)
        .all(conn)
        .await?;
    let memories = ai_memory::Entity::find()
        .filter(ai_memory::Column::Org.eq(org))
        .all(conn)
        .await?;
    let mut out = Vec::with_capacity(pending.len());
    for model in pending {
        let Some(memory) = memories.iter().find(|m| m.id == model.memory_id) else {
            continue;
        };
        out.push(PendingRevision {
            key: key_of(memory)?,
            revision: to_revision(model, dek)?,
        });
    }
    Ok(out)
}

/// The memory a revision of `org` belongs to, for callers that only have the revision id.
pub async fn revision_memory_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    revision_id: &str,
) -> Result<Option<(String, MemoryKey)>, errors::Error> {
    let memory_id = ai_memory_revisions::Entity::find()
        .select_only()
        .column(ai_memory_revisions::Column::MemoryId)
        .filter(ai_memory_revisions::Column::Org.eq(org))
        .filter(ai_memory_revisions::Column::Id.eq(revision_id))
        .into_tuple::<String>()
        .one(conn)
        .await?;
    let Some(memory_id) = memory_id else {
        return Ok(None);
    };
    match ai_memory::Entity::find_by_id(&memory_id).one(conn).await? {
        Some(memory) => Ok(Some((memory_id, key_of(&memory)?))),
        None => Ok(None),
    }
}

/// Writes `write`'s settings and text as the next revision if `base_rev` is still the head, then
/// trims history; on any refusal nothing is kept. [strong]
pub async fn apply_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    dek: &[u8],
    key: &MemoryKey,
    toolset_id: Option<&str>,
    write: &Write,
    meta: &WriteMeta,
) -> Result<Outcome, errors::Error> {
    let txn = conn.begin().await?;
    let outcome = match open_in(&txn, dek, key, toolset_id, meta.now).await? {
        Some(row) => apply_in(&txn, dek, row, write, meta).await?,
        None => Outcome::NotFound,
    };
    finish(txn, outcome).await
}

/// The whole agent write in one primary transaction: the locked turn must still be running, and
/// the chat, the setting and the cap are read in it, so a takeover or a setting change can't race
/// it. [strong]
pub async fn agent_write_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    dek: &[u8],
    write: &AgentWrite,
) -> Result<AgentOutcome, errors::Error> {
    let txn = conn.begin().await?;
    let outcome = agent_write_in(&txn, dek, write).await?;
    match &outcome {
        AgentOutcome::Written(_, written) => {
            finish(txn, written.clone()).await?;
        }
        AgentOutcome::TurnNotRunning | AgentOutcome::UserScopeRefused | AgentOutcome::WritesOff => {
            txn.rollback().await?
        }
    }
    Ok(outcome)
}

/// Stores `edits` as a pending revision; the memory's content and rev stay as they are. [strong]
pub async fn hold_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    dek: &[u8],
    key: &MemoryKey,
    toolset_id: Option<&str>,
    base_rev: i64,
    edits: &[MemoryEdit],
    meta: &WriteMeta,
) -> Result<Outcome, errors::Error> {
    let txn = conn.begin().await?;
    let Some(memory) = open_in(&txn, dek, key, toolset_id, meta.now).await? else {
        return finish(txn, Outcome::NotFound).await;
    };
    let revision_id = insert_revision(
        &txn,
        dek,
        NewRevision {
            memory_id: &memory.id,
            org: &key.org,
            rev: None,
            state: RevisionState::Pending,
            base_rev,
            edits: Some(edits),
            content: None,
            op_id: new_id(),
            meta,
            flags: &edit_flags(edits),
        },
    )
    .await?;
    finish(txn, Outcome::Pending { revision_id }).await
}

/// Holds a person's whole text for approval; accepting it needs the memory still at `base_rev`.
/// [strong]
pub async fn propose_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    dek: &[u8],
    key: &MemoryKey,
    toolset_id: Option<&str>,
    base_rev: i64,
    content: &str,
    meta: &WriteMeta,
) -> Result<Outcome, errors::Error> {
    let txn = conn.begin().await?;
    let Some(row) = open_in(&txn, dek, key, toolset_id, meta.now).await? else {
        return finish(txn, Outcome::NotFound).await;
    };
    if row.rev != base_rev {
        let current = decrypt(dek, &row.content)?;
        return finish(
            txn,
            Outcome::RevConflict {
                rev: row.rev,
                content: current,
            },
        )
        .await;
    }
    if let Err(e) = check_size(&txn, &row, content).await? {
        return finish(txn, Outcome::Invalid(e)).await;
    }
    let revision_id = insert_revision(
        &txn,
        dek,
        NewRevision {
            memory_id: &row.id,
            org: &key.org,
            rev: None,
            state: RevisionState::Pending,
            base_rev,
            edits: None,
            content: Some(content),
            op_id: new_id(),
            meta,
            flags: &[],
        },
    )
    .await?;
    finish(txn, Outcome::Pending { revision_id }).await
}

/// Re-applies a pending revision's edits to the latest content and makes it the head. [strong]
pub async fn accept_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    dek: &[u8],
    memory_id: &str,
    revision_id: &str,
    now: i64,
) -> Result<Outcome, errors::Error> {
    let txn = conn.begin().await?;
    let outcome = accept_in(&txn, dek, memory_id, revision_id, now).await?;
    finish(txn, outcome).await
}

pub async fn discard_with<C: ConnectionTrait>(
    conn: &C,
    memory_id: &str,
    revision_id: &str,
) -> Result<Outcome, errors::Error> {
    let res = ai_memory_revisions::Entity::update_many()
        .col_expr(
            ai_memory_revisions::Column::State,
            Expr::value(RevisionState::Discarded.as_str()),
        )
        .filter(ai_memory_revisions::Column::Id.eq(revision_id))
        .filter(ai_memory_revisions::Column::MemoryId.eq(memory_id))
        .filter(ai_memory_revisions::Column::State.eq(RevisionState::Pending.as_str()))
        .exec(conn)
        .await?;
    Ok(match res.rows_affected {
        0 => Outcome::NotFound,
        _ => Outcome::Discarded,
    })
}

/// Writes the content of applied revision `rev` as a new revision on top of the head. [strong]
pub async fn revert_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    dek: &[u8],
    key: &MemoryKey,
    toolset_id: Option<&str>,
    rev: i64,
    meta: &WriteMeta,
) -> Result<Outcome, errors::Error> {
    let txn = conn.begin().await?;
    let outcome = match open_in(&txn, dek, key, toolset_id, meta.now).await? {
        Some(row) => match applied_content(&txn, dek, &row.id, rev).await? {
            Some(content) => {
                let write = Write {
                    base_rev: row.rev,
                    change: Change::Content(content),
                    settings: MemorySettings::default(),
                };
                apply_in(&txn, dek, row, &write, meta).await?
            }
            None => Outcome::NotFound,
        },
        None => Outcome::NotFound,
    };
    finish(txn, outcome).await
}

/// Changes the settings that are `Some`; `rev` and content stay. [strong]
pub async fn set_settings_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    dek: &[u8],
    key: &MemoryKey,
    toolset_id: Option<&str>,
    settings: &MemorySettings,
    now: i64,
) -> Result<Outcome, errors::Error> {
    let txn = conn.begin().await?;
    let outcome = match open_in(&txn, dek, key, toolset_id, now).await? {
        Some(row) => {
            let row = save_settings(&txn, row, settings).await?;
            Outcome::SettingsSaved {
                rev: row.rev,
                op_id: row.op_id,
            }
        }
        None => Outcome::NotFound,
    };
    finish(txn, outcome).await
}

/// Deletes one memory and its whole history. [strong]
pub async fn delete_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    key: &MemoryKey,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    delete_in(&txn, key).await?;
    txn.commit().await?;
    Ok(())
}

/// Deletes a toolset, and its memory unless another toolset still has the same normalized name.
/// [strong]
pub async fn delete_toolset_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    toolset_id: &str,
    normalize: impl Fn(&str) -> String,
) -> Result<ToolsetDelete, errors::Error> {
    let txn = conn.begin().await?;
    let toolset = org_ai_toolsets::Entity::find()
        .filter(org_ai_toolsets::Column::Org.eq(org))
        .filter(org_ai_toolsets::Column::Id.eq(toolset_id))
        .lock_exclusive()
        .one(&txn)
        .await?;
    let Some(toolset) = toolset else {
        txn.rollback().await?;
        return Ok(ToolsetDelete::NotFound);
    };
    org_ai_toolsets::Entity::delete_by_id(toolset_id)
        .exec(&txn)
        .await?;
    let key = MemoryKey::toolset(org, &normalize(&toolset.name));
    // Deletes of two toolsets sharing the key queue here, so the second sees the first committed.
    ai_memory::Entity::find()
        .filter(ai_memory::Column::Org.eq(&key.org))
        .filter(ai_memory::Column::Scope.eq(key.scope.as_str()))
        .filter(ai_memory::Column::ScopeKey.eq(&key.scope_key))
        .lock_exclusive()
        .one(&txn)
        .await?;
    let still_owned = super::org_ai_toolsets::list_names_with(&txn, org)
        .await?
        .iter()
        .any(|name| normalize(name) == key.scope_key);
    let memory = if still_owned {
        None
    } else {
        delete_in(&txn, &key).await?;
        Some(key)
    };
    txn.commit().await?;
    Ok(ToolsetDelete::Deleted { memory })
}

/// Deletes the user memories of `user_ids`, in `org` or in every org, on the caller's
/// transaction so they go with the membership or user row.
pub async fn delete_users_memory_on<C: ConnectionTrait>(
    conn: &C,
    org: Option<&str>,
    user_ids: &[String],
) -> Result<(), sea_orm::DbErr> {
    if user_ids.is_empty() {
        return Ok(());
    }
    let mut query = ai_memory::Entity::find()
        .select_only()
        .column(ai_memory::Column::Id)
        .filter(ai_memory::Column::Scope.eq(MemoryScope::User.as_str()))
        .filter(ai_memory::Column::ScopeKey.is_in(user_ids.iter().cloned()));
    if let Some(org) = org {
        query = query.filter(ai_memory::Column::Org.eq(org));
    }
    let ids: Vec<String> = query.into_tuple().all(conn).await?;
    if ids.is_empty() {
        return Ok(());
    }
    ai_memory::Entity::delete_many()
        .filter(ai_memory::Column::Id.is_in(ids.clone()))
        .exec(conn)
        .await?;
    ai_memory_revisions::Entity::delete_many()
        .filter(ai_memory_revisions::Column::MemoryId.is_in(ids))
        .exec(conn)
        .await?;
    Ok(())
}

/// Content is ciphertext under the org DEK, so it must go before the DEK does.
pub async fn delete_by_org(org: &str) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    ai_memory_revisions::Entity::delete_many()
        .filter(ai_memory_revisions::Column::Org.eq(org))
        .exec(conn)
        .await?;
    ai_memory::Entity::delete_many()
        .filter(ai_memory::Column::Org.eq(org))
        .exec(conn)
        .await?;
    Ok(())
}

async fn agent_write_in(
    txn: &DatabaseTransaction,
    dek: &[u8],
    write: &AgentWrite,
) -> Result<AgentOutcome, errors::Error> {
    let Some(chat) = running_chat_in(txn, write).await? else {
        return Ok(AgentOutcome::TurnNotRunning);
    };
    let (key, toolset_id) = match (write.scope, &write.toolset) {
        (MemoryScope::Org, _) => (MemoryKey::org(&write.org), None),
        (MemoryScope::User, _) if chat.agent_type == RCA_CHAT_AGENT_TYPE => {
            return Ok(AgentOutcome::UserScopeRefused);
        }
        (MemoryScope::User, _) => (MemoryKey::user(&write.org, &chat.user_id), None),
        (MemoryScope::Toolset, Some((name, id))) => {
            (MemoryKey::toolset(&write.org, name), Some(id.as_str()))
        }
        (MemoryScope::Toolset, None) => {
            return Ok(AgentOutcome::Written(
                MemoryKey::toolset(&write.org, ""),
                Outcome::NotFound,
            ));
        }
    };
    let Some(row) = open_in(txn, dek, &key, toolset_id, write.now).await? else {
        return Ok(AgentOutcome::Written(key, Outcome::NotFound));
    };
    // The lock makes a concurrent settings update of this row wait for, or precede, this write.
    let row = lock_row(txn, &row.id).await?;
    let author = Author::Agent {
        session_id: write.session_id.clone(),
        turn_id: write.turn_id.clone(),
    };
    let mode = write_mode(
        key.scope,
        &author,
        false,
        effective_writes_in(txn, &row).await?,
    );
    let meta = WriteMeta {
        author,
        reason: write.reason.clone(),
        evidence: Some(write.evidence.clone()),
        origin_region: write.origin_region.clone(),
        now: write.now,
    };
    let outcome = match mode {
        WriteMode::Refuse => return Ok(AgentOutcome::WritesOff),
        WriteMode::Apply => {
            let change = Write {
                base_rev: write.base_rev,
                change: Change::Edits(write.edits.clone()),
                settings: MemorySettings::default(),
            };
            apply_in(txn, dek, row, &change, &meta).await?
        }
        WriteMode::Hold => hold_in(txn, dek, &row, write, &meta).await?,
    };
    Ok(AgentOutcome::Written(key, outcome))
}

/// The turn's chat while the turn, locked until commit, is the chat's running one.
async fn running_chat_in(
    txn: &DatabaseTransaction,
    write: &AgentWrite,
) -> Result<Option<ai_chat_sessions::Model>, errors::Error> {
    let turn = ai_chat_turns::Entity::find()
        .filter(ai_chat_turns::Column::OrgId.eq(&write.org))
        .filter(ai_chat_turns::Column::SessionId.eq(&write.session_id))
        .filter(ai_chat_turns::Column::TurnId.eq(&write.turn_id))
        .lock_exclusive()
        .one(txn)
        .await?;
    if !turn.is_some_and(|t| super::ai_chat_turns::is_running(&t, write.running_since)) {
        return Ok(None);
    }
    Ok(ai_chat_sessions::Entity::find()
        .filter(ai_chat_sessions::Column::OrgId.eq(&write.org))
        .filter(ai_chat_sessions::Column::SessionId.eq(&write.session_id))
        .one(txn)
        .await?)
}

async fn lock_row(txn: &DatabaseTransaction, id: &str) -> Result<ai_memory::Model, errors::Error> {
    ai_memory::Entity::find_by_id(id)
        .lock_exclusive()
        .one(txn)
        .await?
        .ok_or_else(|| errors::Error::Message(format!("ai_memory row {id} vanished")))
}

/// A toolset without its own setting reads the org row's, under a shared lock until commit.
async fn effective_writes_in(
    txn: &DatabaseTransaction,
    row: &ai_memory::Model,
) -> Result<AgentMemoryWrites, errors::Error> {
    let parse = |s: Option<&str>| {
        s.map(str::parse)
            .transpose()
            .map_err(errors::Error::Message)
    };
    let scope: MemoryScope = row.scope.parse().map_err(errors::Error::Message)?;
    let setting = parse(row.agent_memory_writes.as_deref())?;
    let org_setting = match scope {
        MemoryScope::Toolset if setting.is_none() => {
            let org = ai_memory::Entity::find()
                .filter(ai_memory::Column::Org.eq(&row.org))
                .filter(ai_memory::Column::Scope.eq(MemoryScope::Org.as_str()))
                .filter(ai_memory::Column::ScopeKey.eq(""))
                .lock_shared()
                .one(txn)
                .await?;
            parse(org.and_then(|o| o.agent_memory_writes).as_deref())?
        }
        MemoryScope::Org | MemoryScope::Toolset | MemoryScope::User => None,
    };
    Ok(effective_agent_writes(scope, setting, org_setting))
}

/// Holds an agent's edits for review only if they could be accepted now: same rev, they apply,
/// they change something and the result fits the cap.
async fn hold_in(
    txn: &DatabaseTransaction,
    dek: &[u8],
    row: &ai_memory::Model,
    write: &AgentWrite,
    meta: &WriteMeta,
) -> Result<Outcome, errors::Error> {
    let current = decrypt(dek, &row.content)?;
    if write.base_rev != row.rev {
        return Ok(Outcome::RevConflict {
            rev: row.rev,
            content: current,
        });
    }
    let content = match apply_edits(&current, &write.edits) {
        Ok(content) => content,
        Err(e) => return Ok(Outcome::EditConflict(e)),
    };
    if content == current {
        return Ok(Outcome::Unchanged { rev: row.rev });
    }
    if let Err(e) = check_size(txn, row, &content).await? {
        return Ok(Outcome::Invalid(e));
    }
    let revision_id = insert_revision(
        txn,
        dek,
        NewRevision {
            memory_id: &row.id,
            org: &row.org,
            rev: None,
            state: RevisionState::Pending,
            base_rev: write.base_rev,
            edits: Some(&write.edits),
            content: None,
            op_id: new_id(),
            meta,
            flags: &edit_flags(&write.edits),
        },
    )
    .await?;
    Ok(Outcome::Pending { revision_id })
}

async fn finish(txn: DatabaseTransaction, outcome: Outcome) -> Result<Outcome, errors::Error> {
    match outcome {
        Outcome::Applied { .. }
        | Outcome::Pending { .. }
        | Outcome::Discarded
        | Outcome::SettingsSaved { .. } => txn.commit().await?,
        Outcome::Unchanged { .. }
        | Outcome::RevConflict { .. }
        | Outcome::EditConflict(_)
        | Outcome::Invalid(_)
        | Outcome::NotFound => txn.rollback().await?,
    }
    Ok(outcome)
}

/// The memory row, created if missing, or `None` when its toolset is gone.
async fn open_in(
    txn: &DatabaseTransaction,
    dek: &[u8],
    key: &MemoryKey,
    toolset_id: Option<&str>,
    now: i64,
) -> Result<Option<ai_memory::Model>, errors::Error> {
    if let Some(id) = toolset_id
        && !lock_toolset(txn, &key.org, id).await?
    {
        return Ok(None);
    }
    if key.scope == MemoryScope::User && !lock_membership(txn, &key.org, &key.scope_key).await? {
        return Ok(None);
    }
    ensure_with(txn, dek, key, now).await.map(Some)
}

/// A shared lock on the user's membership row makes a removal, which deletes that row before the
/// memory, wait for this write or see it gone; root has no membership rows to remove.
async fn lock_membership(
    txn: &DatabaseTransaction,
    org: &str,
    user_id: &str,
) -> Result<bool, errors::Error> {
    let user: Option<(String, bool)> = users::Entity::find()
        .select_only()
        .columns([users::Column::Email, users::Column::IsRoot])
        .filter(users::Column::Id.eq(user_id))
        .into_tuple()
        .one(txn)
        .await?;
    let Some((email, is_root)) = user else {
        return Ok(false);
    };
    if is_root {
        return Ok(true);
    }
    Ok(org_users::Entity::find()
        .filter(org_users::Column::OrgId.eq(org))
        .filter(
            Expr::expr(Func::lower(Expr::col(org_users::Column::Email))).eq(email.to_lowercase()),
        )
        .lock_shared()
        .one(txn)
        .await?
        .is_some())
}

/// A shared lock until commit makes a concurrent toolset delete wait for this write, or the
/// write see that the toolset is gone.
async fn lock_toolset(
    txn: &DatabaseTransaction,
    org: &str,
    toolset_id: &str,
) -> Result<bool, errors::Error> {
    Ok(org_ai_toolsets::Entity::find()
        .filter(org_ai_toolsets::Column::Org.eq(org))
        .filter(org_ai_toolsets::Column::Id.eq(toolset_id))
        .lock_shared()
        .one(txn)
        .await?
        .is_some())
}

/// The memory row goes first: its lock makes a write in flight finish before the history goes.
async fn delete_in(txn: &DatabaseTransaction, key: &MemoryKey) -> Result<(), errors::Error> {
    if let Some(memory) = find_by_key(txn, key).await? {
        ai_memory::Entity::delete_by_id(&memory.id)
            .exec(txn)
            .await?;
        ai_memory_revisions::Entity::delete_many()
            .filter(ai_memory_revisions::Column::MemoryId.eq(&memory.id))
            .exec(txn)
            .await?;
    }
    Ok(())
}

async fn applied_content(
    txn: &DatabaseTransaction,
    dek: &[u8],
    memory_id: &str,
    rev: i64,
) -> Result<Option<String>, errors::Error> {
    let target = ai_memory_revisions::Entity::find()
        .filter(ai_memory_revisions::Column::MemoryId.eq(memory_id))
        .filter(ai_memory_revisions::Column::State.eq(RevisionState::Applied.as_str()))
        .filter(ai_memory_revisions::Column::Rev.eq(rev))
        .one(txn)
        .await?;
    target
        .and_then(|t| t.content)
        .map(|c| decrypt(dek, &c))
        .transpose()
}

async fn save_settings(
    txn: &DatabaseTransaction,
    mut row: ai_memory::Model,
    settings: &MemorySettings,
) -> Result<ai_memory::Model, errors::Error> {
    if settings.is_empty() {
        return Ok(row);
    }
    let mut update = ai_memory::Entity::update_many().filter(ai_memory::Column::Id.eq(&row.id));
    if settings.clear_agent_memory_writes {
        row.agent_memory_writes = None;
        update = update.col_expr(
            ai_memory::Column::AgentMemoryWrites,
            Expr::value(Option::<String>::None),
        );
    }
    if let Some(writes) = settings.agent_memory_writes {
        row.agent_memory_writes = Some(writes.as_str().to_string());
        update = update.col_expr(
            ai_memory::Column::AgentMemoryWrites,
            Expr::value(Some(writes.as_str())),
        );
    }
    if let Some(max_bytes) = settings.max_bytes {
        row.max_bytes = Some(max_bytes);
        update = update.col_expr(ai_memory::Column::MaxBytes, Expr::value(Some(max_bytes)));
    }
    if let Some(user_max_bytes) = settings.user_max_bytes {
        row.user_max_bytes = Some(user_max_bytes);
        update = update.col_expr(
            ai_memory::Column::UserMaxBytes,
            Expr::value(Some(user_max_bytes)),
        );
    }
    update.exec(txn).await?;
    Ok(row)
}

/// Settings are saved first, so the size check sees the cap this same write sets.
async fn apply_in(
    txn: &DatabaseTransaction,
    dek: &[u8],
    row: ai_memory::Model,
    write: &Write,
    meta: &WriteMeta,
) -> Result<Outcome, errors::Error> {
    let row = save_settings(txn, row, &write.settings).await?;
    let (memory_id, base_rev) = (row.id.as_str(), write.base_rev);
    let current = decrypt(dek, &row.content)?;
    if row.rev != base_rev {
        return Ok(Outcome::RevConflict {
            rev: row.rev,
            content: current,
        });
    }
    let (content, edits) = match &write.change {
        Change::Content(content) => (content.clone(), None),
        Change::Edits(edits) => match apply_edits(&current, edits) {
            Ok(content) => (content, Some(edits.as_slice())),
            Err(e) => return Ok(Outcome::EditConflict(e)),
        },
    };
    // Only an agent's edit can be a no-op; a person's save or revert is always a revision.
    if edits.is_some() && content == current && write.settings.is_empty() {
        return Ok(Outcome::Unchanged { rev: row.rev });
    }
    if let Err(e) = check_size(txn, &row, &content).await? {
        return Ok(Outcome::Invalid(e));
    }
    let op_id = new_id();
    let author = meta.author.to_string();
    let head = Head {
        content: &content,
        op_id: &op_id,
        updated_by: &author,
        now: meta.now,
    };
    if !advance_head(txn, dek, &row, head).await? {
        return head_moved(txn, dek, memory_id).await;
    }
    insert_revision(
        txn,
        dek,
        NewRevision {
            memory_id,
            org: &row.org,
            rev: Some(row.rev + 1),
            state: RevisionState::Applied,
            base_rev,
            edits,
            content: Some(&content),
            op_id: op_id.clone(),
            meta,
            flags: &[],
        },
    )
    .await?;
    trim_history(txn, memory_id, &op_id, meta.now).await?;
    Ok(Outcome::Applied {
        rev: row.rev + 1,
        op_id,
    })
}

async fn accept_in(
    txn: &DatabaseTransaction,
    dek: &[u8],
    memory_id: &str,
    revision_id: &str,
    now: i64,
) -> Result<Outcome, errors::Error> {
    let Some(pending) =
        find_revision(txn, memory_id, revision_id, Some(RevisionState::Pending)).await?
    else {
        return Ok(Outcome::NotFound);
    };
    let Some(row) = find_row(txn, memory_id).await? else {
        return Ok(Outcome::NotFound);
    };
    let current = decrypt(dek, &row.content)?;
    let content = match (&pending.edits, &pending.content) {
        // A proposed whole text replaces only the text it was written against.
        (None, Some(_)) if row.rev != pending.base_rev => {
            return Ok(Outcome::RevConflict {
                rev: row.rev,
                content: current,
            });
        }
        (None, Some(proposed)) => decrypt(dek, proposed)?,
        (edits, _) => {
            let edits = edits
                .as_deref()
                .map(|e| decode_edits(dek, e))
                .transpose()?
                .unwrap_or_default();
            match apply_edits(&current, &edits) {
                Ok(content) => content,
                Err(e) => return Ok(Outcome::EditConflict(e)),
            }
        }
    };
    if let Err(e) = check_size(txn, &row, &content).await? {
        return Ok(Outcome::Invalid(e));
    }
    let head = Head {
        content: &content,
        op_id: &pending.op_id,
        updated_by: &pending.updated_by,
        now,
    };
    if !advance_head(txn, dek, &row, head).await? {
        return head_moved(txn, dek, memory_id).await;
    }
    // A discard that committed since the read leaves no pending row; the caller rolls back.
    if !mark_applied(txn, dek, revision_id, row.rev + 1, &content).await? {
        return Ok(Outcome::NotFound);
    }
    trim_history(txn, memory_id, &pending.op_id, now).await?;
    Ok(Outcome::Applied {
        rev: row.rev + 1,
        op_id: pending.op_id,
    })
}

/// Creates the row with empty content and default settings unless it exists.
async fn ensure_with<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    key: &MemoryKey,
    now: i64,
) -> Result<ai_memory::Model, errors::Error> {
    if let Some(model) = find_by_key(conn, key).await? {
        return Ok(model);
    }
    let row = ai_memory::ActiveModel {
        id: Set(new_id()),
        org: Set(key.org.clone()),
        scope: Set(key.scope.as_str().to_string()),
        scope_key: Set(key.scope_key.clone()),
        content: Set(encrypt(dek, "")?),
        rev: Set(0),
        op_id: Set(None),
        updated_by: Set(Author::System.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        agent_memory_writes: Set(None),
        max_bytes: Set(None),
        user_max_bytes: Set(None),
    };
    // A concurrent first write may insert the same key; either row is the one to use.
    ai_memory::Entity::insert(row)
        .on_conflict(
            OnConflict::columns([
                ai_memory::Column::Org,
                ai_memory::Column::Scope,
                ai_memory::Column::ScopeKey,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    find_by_key(conn, key)
        .await?
        .ok_or_else(|| errors::Error::Message(format!("ai_memory row for {key:?} vanished")))
}

async fn find_by_key<C: ConnectionTrait>(
    conn: &C,
    key: &MemoryKey,
) -> Result<Option<ai_memory::Model>, errors::Error> {
    Ok(ai_memory::Entity::find()
        .filter(ai_memory::Column::Org.eq(&key.org))
        .filter(ai_memory::Column::Scope.eq(key.scope.as_str()))
        .filter(ai_memory::Column::ScopeKey.eq(&key.scope_key))
        .one(conn)
        .await?)
}

async fn find_row<C: ConnectionTrait>(
    conn: &C,
    memory_id: &str,
) -> Result<Option<ai_memory::Model>, errors::Error> {
    Ok(ai_memory::Entity::find_by_id(memory_id).one(conn).await?)
}

/// Moves a revision from pending to applied; `false` means it was no longer pending.
async fn mark_applied<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    revision_id: &str,
    rev: i64,
    content: &str,
) -> Result<bool, errors::Error> {
    let res = ai_memory_revisions::Entity::update_many()
        .col_expr(
            ai_memory_revisions::Column::State,
            Expr::value(RevisionState::Applied.as_str()),
        )
        .col_expr(ai_memory_revisions::Column::Rev, Expr::value(Some(rev)))
        .col_expr(
            ai_memory_revisions::Column::Content,
            Expr::value(Some(encrypt(dek, content)?)),
        )
        .filter(ai_memory_revisions::Column::Id.eq(revision_id))
        .filter(ai_memory_revisions::Column::State.eq(RevisionState::Pending.as_str()))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

async fn find_revision<C: ConnectionTrait>(
    conn: &C,
    memory_id: &str,
    revision_id: &str,
    state: Option<RevisionState>,
) -> Result<Option<ai_memory_revisions::Model>, errors::Error> {
    let mut query = ai_memory_revisions::Entity::find()
        .filter(ai_memory_revisions::Column::Id.eq(revision_id))
        .filter(ai_memory_revisions::Column::MemoryId.eq(memory_id));
    if let Some(state) = state {
        query = query.filter(ai_memory_revisions::Column::State.eq(state.as_str()));
    }
    Ok(query.one(conn).await?)
}

/// A user memory's cap is the org row's `user_max_bytes`; the others carry their own.
async fn check_size<C: ConnectionTrait>(
    conn: &C,
    row: &ai_memory::Model,
    content: &str,
) -> Result<Result<(), ContentError>, errors::Error> {
    let scope: MemoryScope = row.scope.parse().map_err(errors::Error::Message)?;
    let cap = match scope {
        MemoryScope::User => find_by_key(conn, &MemoryKey::org(&row.org))
            .await?
            .and_then(|org| org.user_max_bytes),
        MemoryScope::Org | MemoryScope::Toolset => row.max_bytes,
    };
    Ok(validate_content(scope, content, cap))
}

/// Moves the head only if nobody did since `row` was read; `false` means someone did.
async fn advance_head<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    row: &ai_memory::Model,
    head: Head<'_>,
) -> Result<bool, errors::Error> {
    let res = ai_memory::Entity::update_many()
        .col_expr(
            ai_memory::Column::Content,
            Expr::value(encrypt(dek, head.content)?),
        )
        .col_expr(ai_memory::Column::Rev, Expr::value(row.rev + 1))
        .col_expr(
            ai_memory::Column::OpId,
            Expr::value(Some(head.op_id.to_string())),
        )
        .col_expr(ai_memory::Column::UpdatedBy, Expr::value(head.updated_by))
        .col_expr(
            ai_memory::Column::UpdatedAt,
            Expr::value(head.now.max(row.updated_at)),
        )
        .filter(ai_memory::Column::Id.eq(&row.id))
        .filter(ai_memory::Column::Rev.eq(row.rev))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

async fn head_moved<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    memory_id: &str,
) -> Result<Outcome, errors::Error> {
    Ok(match find_row(conn, memory_id).await? {
        Some(row) => Outcome::RevConflict {
            rev: row.rev,
            content: decrypt(dek, &row.content)?,
        },
        None => Outcome::NotFound,
    })
}

async fn insert_revision<C: ConnectionTrait>(
    conn: &C,
    dek: &[u8],
    new: NewRevision<'_>,
) -> Result<String, errors::Error> {
    let id = new_id();
    let edits = new
        .edits
        .map(|e| encrypt(dek, &serde_json::to_string(e)?))
        .transpose()?;
    let evidence = new
        .meta
        .evidence
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let row = ai_memory_revisions::ActiveModel {
        id: Set(id.clone()),
        memory_id: Set(new.memory_id.to_string()),
        org: Set(new.org.to_string()),
        rev: Set(new.rev),
        state: Set(new.state.as_str().to_string()),
        base_rev: Set(new.base_rev),
        edits: Set(edits),
        content: Set(new.content.map(|c| encrypt(dek, c)).transpose()?),
        updated_by: Set(new.meta.author.to_string()),
        reason: Set(new.meta.reason.clone()),
        evidence: Set(evidence),
        origin_region: Set(new.meta.origin_region.clone()),
        op_id: Set(new.op_id),
        created_at: Set(new.meta.now),
        flags: Set((!new.flags.is_empty())
            .then(|| serde_json::to_string(new.flags))
            .transpose()?),
    };
    ai_memory_revisions::Entity::insert(row)
        .exec_without_returning(conn)
        .await?;
    Ok(id)
}

async fn trim_history<C: ConnectionTrait>(
    conn: &C,
    memory_id: &str,
    head_op_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    let rows: Vec<(String, String, String, i64, String)> = ai_memory_revisions::Entity::find()
        .select_only()
        .columns([
            ai_memory_revisions::Column::Id,
            ai_memory_revisions::Column::State,
            ai_memory_revisions::Column::UpdatedBy,
            ai_memory_revisions::Column::CreatedAt,
            ai_memory_revisions::Column::OpId,
        ])
        .filter(ai_memory_revisions::Column::MemoryId.eq(memory_id))
        .filter(ai_memory_revisions::Column::State.ne(RevisionState::Pending.as_str()))
        .order_by_desc(ai_memory_revisions::Column::CreatedAt)
        .into_tuple()
        .all(conn)
        .await?;
    let rows: Vec<HistoryRow> = rows
        .into_iter()
        .map(|(id, state, updated_by, created_at, op_id)| HistoryRow {
            id,
            state,
            by_agent: updated_by
                .parse::<Author>()
                .is_ok_and(|author| author.is_agent()),
            created_at,
            op_id,
        })
        .collect();
    let doomed = trim_plan(&rows, head_op_id, now);
    if !doomed.is_empty() {
        ai_memory_revisions::Entity::delete_many()
            .filter(ai_memory_revisions::Column::Id.is_in(doomed))
            .exec(conn)
            .await?;
    }
    Ok(())
}

/// Ids history no longer keeps: people's beyond the last 200 and older than a year, the agent's
/// beyond the last 50, and discarded ones after 30 days. `rows` is newest first.
fn trim_plan(rows: &[HistoryRow], head_op_id: &str, now: i64) -> Vec<String> {
    let (mut people, mut agent) = (0usize, 0usize);
    let mut doomed = Vec::new();
    for row in rows {
        let drop = if row.state == RevisionState::Discarded.as_str() {
            row.created_at < now - DISCARDED_KEPT_MICROS
        } else if row.by_agent {
            agent += 1;
            agent > AGENT_KEPT
        } else {
            people += 1;
            people > PEOPLE_KEPT && row.created_at < now - PEOPLE_KEPT_MICROS
        };
        if drop && row.op_id != head_op_id {
            doomed.push(row.id.clone());
        }
    }
    doomed
}

fn key_of(model: &ai_memory::Model) -> Result<MemoryKey, errors::Error> {
    Ok(MemoryKey {
        org: model.org.clone(),
        scope: model.scope.parse().map_err(errors::Error::Message)?,
        scope_key: model.scope_key.clone(),
    })
}

fn to_memory(model: ai_memory::Model, dek: &[u8]) -> Result<Memory, errors::Error> {
    let agent_memory_writes = model
        .agent_memory_writes
        .as_deref()
        .map(str::parse)
        .transpose()
        .map_err(errors::Error::Message)?;
    Ok(Memory {
        key: key_of(&model)?,
        content: decrypt(dek, &model.content)?,
        id: model.id,
        rev: model.rev,
        op_id: model.op_id,
        updated_by: model.updated_by,
        created_at: model.created_at,
        updated_at: model.updated_at,
        settings: MemorySettings {
            agent_memory_writes,
            max_bytes: model.max_bytes,
            user_max_bytes: model.user_max_bytes,
            clear_agent_memory_writes: false,
        },
    })
}

fn to_revision(model: ai_memory_revisions::Model, dek: &[u8]) -> Result<Revision, errors::Error> {
    Ok(Revision {
        state: model.state.parse().map_err(errors::Error::Message)?,
        edits: model
            .edits
            .as_deref()
            .map(|e| decode_edits(dek, e))
            .transpose()?,
        content: model
            .content
            .as_deref()
            .map(|c| decrypt(dek, c))
            .transpose()?,
        evidence: model
            .evidence
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?,
        id: model.id,
        memory_id: model.memory_id,
        rev: model.rev,
        base_rev: model.base_rev,
        updated_by: model.updated_by,
        reason: model.reason,
        origin_region: model.origin_region,
        op_id: model.op_id,
        created_at: model.created_at,
        flags: model
            .flags
            .as_deref()
            .map(serde_json::from_str)
            .transpose()?
            .unwrap_or_default(),
    })
}

fn decode_edits(dek: &[u8], ciphertext: &str) -> Result<Vec<MemoryEdit>, errors::Error> {
    Ok(serde_json::from_str(&decrypt(dek, ciphertext)?)?)
}

fn encrypt(dek: &[u8], plaintext: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .encrypt(dek, plaintext)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

fn decrypt(dek: &[u8], ciphertext: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .decrypt(dek, ciphertext)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

/// Creates the org, user and membership tables a private memory write checks, plus `user_id` as a
/// member of `org`.
#[cfg(test)]
pub(crate) async fn add_member_for_test<C: ConnectionTrait>(conn: &C, org: &str, user_id: &str) {
    use sea_orm::{ActiveModelTrait, Schema};

    use super::entity::organizations;
    let backend = conn.get_database_backend();
    let schema = Schema::new(backend);
    for stmt in [
        schema
            .create_table_from_entity(organizations::Entity)
            .if_not_exists()
            .to_owned(),
        schema
            .create_table_from_entity(users::Entity)
            .if_not_exists()
            .to_owned(),
        schema
            .create_table_from_entity(org_users::Entity)
            .if_not_exists()
            .to_owned(),
    ] {
        conn.execute(backend.build(&stmt)).await.unwrap();
    }
    if organizations::Entity::find_by_id(org)
        .one(conn)
        .await
        .unwrap()
        .is_none()
    {
        organizations::ActiveModel {
            identifier: Set(org.to_string()),
            org_name: Set(org.to_string()),
            org_type: Set(0),
            status: Set("active".to_string()),
            created_at: Set(0),
            updated_at: Set(0),
            deleted_at: Set(None),
            #[cfg(feature = "cloud")]
            trial_ends_at: Set(0),
        }
        .insert(conn)
        .await
        .unwrap();
    }
    let email = format!("{user_id}@example.com");
    if users::Entity::find_by_id(user_id)
        .one(conn)
        .await
        .unwrap()
        .is_none()
    {
        users::ActiveModel {
            id: Set(user_id.to_string()),
            email: Set(email.clone()),
            first_name: Set(String::new()),
            last_name: Set(String::new()),
            password: Set(String::new()),
            salt: Set(String::new()),
            is_root: Set(false),
            password_ext: Set(None),
            user_type: Set(0),
            created_at: Set(0),
            updated_at: Set(0),
            must_reset_password: Set(false),
            password_reset_reason: Set(None),
            flagged_at: Set(None),
            password_updated_at: Set(None),
        }
        .insert(conn)
        .await
        .unwrap();
    }
    org_users::ActiveModel {
        id: Set(new_id()),
        email: Set(email),
        org_id: Set(org.to_string()),
        role: Set(0),
        token: Set(String::new()),
        rum_token: Set(None),
        created_at: Set(0),
        updated_at: Set(0),
        allow_static_token: Set(false),
    }
    .insert(conn)
    .await
    .unwrap();
}

/// A user memory with one revision, written without the membership check the write path does.
#[cfg(test)]
pub(crate) async fn insert_user_memory_for_test<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    user_id: &str,
) -> ai_memory::Model {
    let dek = config::utils::rand::random_bytes(64);
    let memory = ensure_with(conn, &dek, &MemoryKey::user(org, user_id), 1)
        .await
        .unwrap();
    let meta = WriteMeta {
        author: Author::User(user_id.to_string()),
        reason: None,
        evidence: None,
        origin_region: String::new(),
        now: 1,
    };
    let revision = NewRevision {
        memory_id: &memory.id,
        org,
        rev: Some(1),
        state: RevisionState::Applied,
        base_rev: 0,
        edits: None,
        content: Some("notes"),
        op_id: new_id(),
        meta: &meta,
        flags: &[],
    };
    insert_revision(conn, &dek, revision).await.unwrap();
    memory
}

fn new_id() -> String {
    Ksuid::new(None, None).to_string()
}

#[cfg(test)]
mod tests {
    use config::{
        meta::ai::memory::{AgentMemoryWrites, TOOLSET_DEFAULT_MAX_BYTES},
        utils::rand::random_bytes,
    };
    use sea_orm::{DatabaseConnection, Schema, TransactionTrait};

    use super::*;
    use crate::table::migration::{create_ai_memory_tables, sqlite_and_postgres_for_test};

    async fn apply(
        db: &DatabaseConnection,
        dek: &[u8],
        key: &MemoryKey,
        base_rev: i64,
        change: &Change,
        meta: &WriteMeta,
    ) -> Result<Outcome, errors::Error> {
        let write = Write {
            base_rev,
            change: change.clone(),
            settings: MemorySettings::default(),
        };
        apply_with(db, dek, key, None, &write, meta).await
    }

    async fn hold(
        db: &DatabaseConnection,
        dek: &[u8],
        key: &MemoryKey,
        base_rev: i64,
        edits: &[MemoryEdit],
        meta: &WriteMeta,
    ) -> Result<Outcome, errors::Error> {
        hold_with(db, dek, key, None, base_rev, edits, meta).await
    }

    async fn revert(
        db: &DatabaseConnection,
        dek: &[u8],
        key: &MemoryKey,
        rev: i64,
        meta: &WriteMeta,
    ) -> Result<Outcome, errors::Error> {
        revert_with(db, dek, key, None, rev, meta).await
    }

    async fn set(
        db: &DatabaseConnection,
        dek: &[u8],
        key: &MemoryKey,
        settings: &MemorySettings,
        now: i64,
    ) -> Result<Outcome, errors::Error> {
        set_settings_with(db, dek, key, None, settings, now).await
    }

    async fn databases(label: &str) -> Vec<DatabaseConnection> {
        let dbs = sqlite_and_postgres_for_test(label).await;
        for db in &dbs {
            create_ai_memory_tables(db).await.unwrap();
            let backend = db.get_database_backend();
            let stmt = Schema::new(backend).create_table_from_entity(org_ai_toolsets::Entity);
            db.execute(backend.build(&stmt)).await.unwrap();
            for user in ["u1", "u2"] {
                add_member_for_test(db, "o1", user).await;
            }
        }
        dbs
    }

    fn person(now: i64) -> WriteMeta {
        WriteMeta {
            author: Author::User("u1".to_string()),
            reason: None,
            evidence: None,
            origin_region: "us-1".to_string(),
            now,
        }
    }

    fn agent(now: i64) -> WriteMeta {
        WriteMeta {
            author: Author::Agent {
                session_id: "s".to_string(),
                turn_id: "t".to_string(),
            },
            evidence: Some(vec![Evidence {
                turn_id: Some("t".to_string()),
                call_ref: "user".to_string(),
                tool: None,
            }]),
            ..person(now)
        }
    }

    fn content(text: &str) -> Change {
        Change::Content(text.to_string())
    }

    fn add(text: &str) -> Vec<MemoryEdit> {
        vec![MemoryEdit::Add {
            section: "Quirks".to_string(),
            text: text.to_string(),
        }]
    }

    fn toolset() -> MemoryKey {
        MemoryKey::toolset("o1", "datadog-prod")
    }

    async fn head(db: &DatabaseConnection, dek: &[u8], key: &MemoryKey) -> (i64, String) {
        let memory = get_with(db, dek, key).await.unwrap().unwrap();
        (memory.rev, memory.content)
    }

    #[tokio::test]
    async fn first_write_creates_the_row_and_a_stale_base_rev_conflicts() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_first_write").await {
            let key = toolset();
            assert!(get_with(&db, &dek, &key).await.unwrap().is_none());
            let applied = apply(&db, &dek, &key, 0, &content("a\n"), &person(10))
                .await
                .unwrap();
            assert!(
                matches!(applied, Outcome::Applied { rev: 1, .. }),
                "{applied:?}"
            );
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            assert_eq!((memory.rev, memory.content.as_str()), (1, "a\n"));
            assert_eq!(memory.updated_by, "user:u1");
            let stale = apply(&db, &dek, &key, 0, &content("b\n"), &person(11))
                .await
                .unwrap();
            assert_eq!(
                stale,
                Outcome::RevConflict {
                    rev: 1,
                    content: "a\n".to_string()
                }
            );
            assert_eq!(head(&db, &dek, &key).await, (1, "a\n".to_string()));
        }
    }

    #[tokio::test]
    async fn concurrent_applies_against_one_rev_have_one_winner() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_concurrent").await {
            let key = MemoryKey::org("o1");
            let (change_a, change_b, meta) = (content("a"), content("b"), person(10));
            let (a, b) = tokio::join!(
                apply(&db, &dek, &key, 0, &change_a, &meta),
                apply(&db, &dek, &key, 0, &change_b, &meta),
            );
            let outcomes = [a.unwrap(), b.unwrap()];
            let won = outcomes
                .iter()
                .filter(|o| matches!(o, Outcome::Applied { rev: 1, .. }))
                .count();
            let lost = outcomes
                .iter()
                .filter(|o| matches!(o, Outcome::RevConflict { rev: 1, .. }))
                .count();
            assert_eq!((won, lost), (1, 1), "{outcomes:?}");
        }
    }

    #[tokio::test]
    async fn a_pending_edit_waits_then_is_reapplied_on_newer_content_or_conflicts() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_pending").await {
            let key = toolset();
            apply(
                &db,
                &dek,
                &key,
                0,
                &content("## Quirks\n- a\n"),
                &person(10),
            )
            .await
            .unwrap();
            let Outcome::Pending { revision_id } =
                hold(&db, &dek, &key, 1, &add("- b"), &agent(11))
                    .await
                    .unwrap()
            else {
                panic!("not held");
            };
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            assert_eq!(
                (memory.rev, memory.content.as_str()),
                (1, "## Quirks\n- a\n")
            );
            assert_eq!(count_pending_with(&db, &memory.id).await.unwrap(), 1);

            apply(
                &db,
                &dek,
                &key,
                1,
                &content("## Quirks\n- z\n"),
                &person(12),
            )
            .await
            .unwrap();
            let accepted = accept_with(&db, &dek, &memory.id, &revision_id, 13)
                .await
                .unwrap();
            assert!(
                matches!(accepted, Outcome::Applied { rev: 3, .. }),
                "{accepted:?}"
            );
            assert_eq!(
                head(&db, &dek, &key).await,
                (3, "## Quirks\n- z\n- b\n".to_string())
            );
            let revision = get_revision_with(&db, &dek, &memory.id, &revision_id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(revision.state, RevisionState::Applied);
            assert_eq!(revision.rev, Some(3));
            assert_eq!(count_pending_with(&db, &memory.id).await.unwrap(), 0);

            let replace = vec![MemoryEdit::Replace {
                old: "- a".to_string(),
                new: "- c".to_string(),
            }];
            let Outcome::Pending { revision_id } = hold(&db, &dek, &key, 3, &replace, &agent(14))
                .await
                .unwrap()
            else {
                panic!("not held");
            };
            assert_eq!(
                accept_with(&db, &dek, &memory.id, &revision_id, 15)
                    .await
                    .unwrap(),
                Outcome::EditConflict(EditError::NoMatch { index: 0 })
            );
            assert_eq!(head(&db, &dek, &key).await.0, 3);
            assert_eq!(
                discard_with(&db, &memory.id, &revision_id).await.unwrap(),
                Outcome::Discarded
            );
            assert_eq!(
                discard_with(&db, &memory.id, &revision_id).await.unwrap(),
                Outcome::NotFound
            );
            assert_eq!(
                accept_with(&db, &dek, &memory.id, &revision_id, 16)
                    .await
                    .unwrap(),
                Outcome::NotFound
            );
        }
    }

    #[tokio::test]
    async fn a_proposed_text_is_stored_pending_and_applies_only_on_its_base_rev() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_propose").await {
            let key = toolset();
            apply(&db, &dek, &key, 0, &content("a\n"), &person(1))
                .await
                .unwrap();
            let memory_id = get_with(&db, &dek, &key).await.unwrap().unwrap().id;
            let stale = propose_with(&db, &dek, &key, None, 0, "x\n", &person(2))
                .await
                .unwrap();
            assert!(
                matches!(stale, Outcome::RevConflict { rev: 1, .. }),
                "{stale:?}"
            );
            let mut ids = Vec::new();
            for (text, now) in [("b\n", 3), ("c\n", 4)] {
                match propose_with(&db, &dek, &key, None, 1, text, &person(now))
                    .await
                    .unwrap()
                {
                    Outcome::Pending { revision_id } => ids.push(revision_id),
                    other => panic!("not held: {other:?}"),
                }
            }
            let stored = ai_memory_revisions::Entity::find_by_id(ids[0].clone())
                .one(&db)
                .await
                .unwrap()
                .unwrap();
            assert_ne!(stored.content.as_deref(), Some("b\n"), "stored encrypted");
            let held = get_revision_with(&db, &dek, &memory_id, &ids[0])
                .await
                .unwrap();
            assert_eq!(held.unwrap().content.as_deref(), Some("b\n"));
            assert_eq!(get_with(&db, &dek, &key).await.unwrap().unwrap().rev, 1);

            let first = accept_with(&db, &dek, &memory_id, &ids[0], 5)
                .await
                .unwrap();
            assert!(
                matches!(first, Outcome::Applied { rev: 2, .. }),
                "{first:?}"
            );
            let second = accept_with(&db, &dek, &memory_id, &ids[1], 6)
                .await
                .unwrap();
            assert_eq!(
                second,
                Outcome::RevConflict {
                    rev: 2,
                    content: "b\n".to_string()
                }
            );
            assert_eq!(
                get_with(&db, &dek, &key).await.unwrap().unwrap().content,
                "b\n"
            );
        }
    }

    #[tokio::test]
    async fn accept_and_discard_of_one_edit_never_both_win() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_accept_discard").await {
            let key = toolset();
            apply(&db, &dek, &key, 0, &content("## Quirks\n"), &person(1))
                .await
                .unwrap();
            let memory_id = get_with(&db, &dek, &key).await.unwrap().unwrap().id;
            let edits = add("- b");
            let mut ids = Vec::new();
            for now in [2, 3] {
                match hold(&db, &dek, &key, 1, &edits, &agent(now)).await.unwrap() {
                    Outcome::Pending { revision_id } => ids.push(revision_id),
                    other => panic!("not held: {other:?}"),
                }
            }
            let (first, second) = (ids[0].clone(), ids[1].clone());

            let accepted = accept_with(&db, &dek, &memory_id, &first, 4).await.unwrap();
            assert!(
                matches!(accepted, Outcome::Applied { rev: 2, .. }),
                "{accepted:?}"
            );
            let late_discard = discard_with(&db, &memory_id, &first).await.unwrap();
            assert_eq!(late_discard, Outcome::NotFound);

            assert_eq!(
                discard_with(&db, &memory_id, &second).await.unwrap(),
                Outcome::Discarded
            );
            let late_accept = accept_with(&db, &dek, &memory_id, &second, 5)
                .await
                .unwrap();
            assert_eq!(late_accept, Outcome::NotFound);
            assert_eq!(
                head(&db, &dek, &key).await,
                (2, "## Quirks\n- b\n".to_string())
            );

            // The transition itself is conditional, so a discard that commits between accept's
            // read and its write leaves accept nothing to apply and its transaction rolls back.
            let txn = db.begin().await.unwrap();
            assert!(!mark_applied(&txn, &dek, &second, 3, "x").await.unwrap());
            txn.rollback().await.unwrap();
            let stored = find_revision(&db, &memory_id, &second, None)
                .await
                .unwrap()
                .unwrap();
            assert_eq!((stored.state.as_str(), stored.rev), ("discarded", None));
        }
    }

    #[tokio::test]
    async fn toolset_memory_writes_need_the_toolset_and_its_delete_takes_the_memory() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_toolset_delete").await {
            let key = toolset();
            org_ai_toolsets::Entity::insert(org_ai_toolsets::ActiveModel {
                id: Set("t1".to_string()),
                org: Set("o1".to_string()),
                name: Set("datadog-prod".to_string()),
                kind: Set("mcp".to_string()),
                description: Set(None),
                data: Set(None),
                created_by: Set("u".to_string()),
                created_at: Set(1),
                updated_at: Set(1),
                region_only: Set(false),
                origin_region: Set(None),
            })
            .exec(&db)
            .await
            .unwrap();
            let write = Write {
                base_rev: 0,
                change: content("x"),
                settings: MemorySettings::default(),
            };
            let applied = apply_with(&db, &dek, &key, Some("t1"), &write, &person(1))
                .await
                .unwrap();
            assert!(matches!(applied, Outcome::Applied { .. }), "{applied:?}");
            let deleted = delete_toolset_with(&db, "o1", "t1", str::to_string)
                .await
                .unwrap();
            assert_eq!(
                deleted,
                ToolsetDelete::Deleted {
                    memory: Some(key.clone())
                }
            );
            assert!(get_with(&db, &dek, &key).await.unwrap().is_none());
            assert!(
                ai_memory_revisions::Entity::find()
                    .all(&db)
                    .await
                    .unwrap()
                    .is_empty()
            );
            let late = apply_with(&db, &dek, &key, Some("t1"), &write, &person(2))
                .await
                .unwrap();
            assert_eq!(late, Outcome::NotFound);
            let held = hold_with(&db, &dek, &key, Some("t1"), 0, &add("- b"), &agent(3))
                .await
                .unwrap();
            assert_eq!(held, Outcome::NotFound);
            assert!(get_with(&db, &dek, &key).await.unwrap().is_none());
            assert_eq!(
                delete_toolset_with(&db, "o1", "t1", str::to_string)
                    .await
                    .unwrap(),
                ToolsetDelete::NotFound
            );
        }
    }

    #[tokio::test]
    async fn a_refused_write_keeps_the_settings_it_carried_out() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_combined").await {
            let key = MemoryKey::org("o1");
            apply(&db, &dek, &key, 0, &content("a"), &person(1))
                .await
                .unwrap();
            let auto = MemorySettings {
                agent_memory_writes: Some(AgentMemoryWrites::Auto),
                ..Default::default()
            };
            let stale = Write {
                base_rev: 0,
                change: content("b"),
                settings: auto.clone(),
            };
            let outcome = apply_with(&db, &dek, &key, None, &stale, &person(2))
                .await
                .unwrap();
            assert!(
                matches!(outcome, Outcome::RevConflict { rev: 1, .. }),
                "{outcome:?}"
            );
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            assert_eq!(memory.settings, MemorySettings::default());
            let fresh = Write {
                base_rev: 1,
                ..stale
            };
            let outcome = apply_with(&db, &dek, &key, None, &fresh, &person(3))
                .await
                .unwrap();
            assert!(
                matches!(outcome, Outcome::Applied { rev: 2, .. }),
                "{outcome:?}"
            );
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            assert_eq!(memory.settings, auto);
        }
    }

    #[tokio::test]
    async fn a_private_memory_is_written_only_while_its_user_is_a_member() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_member").await {
            let key = MemoryKey::user("o1", "u2");
            org_users::Entity::delete_many()
                .filter(org_users::Column::Email.eq("u2@example.com"))
                .exec(&db)
                .await
                .unwrap();
            let refused = apply(&db, &dek, &key, 0, &content("x"), &person(1)).await;
            assert_eq!(refused.unwrap(), Outcome::NotFound);
            let refused = set(&db, &dek, &key, &MemorySettings::default(), 2).await;
            assert_eq!(refused.unwrap(), Outcome::NotFound);
            assert!(get_with(&db, &dek, &key).await.unwrap().is_none());
            let stranger = MemoryKey::user("o1", "nobody");
            let refused = apply(&db, &dek, &stranger, 0, &content("x"), &person(3)).await;
            assert_eq!(refused.unwrap(), Outcome::NotFound);
            users::Entity::update_many()
                .col_expr(users::Column::IsRoot, Expr::value(true))
                .filter(users::Column::Id.eq("u2"))
                .exec(&db)
                .await
                .unwrap();
            let root = apply(&db, &dek, &key, 0, &content("x"), &person(4)).await;
            assert!(matches!(root.unwrap(), Outcome::Applied { .. }));
        }
    }

    #[tokio::test]
    async fn a_change_that_leaves_the_text_as_it_is_writes_no_revision() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_unchanged").await {
            let key = toolset();
            apply(&db, &dek, &key, 0, &content("## Quirks\n- a\n"), &person(1))
                .await
                .unwrap();
            let same = vec![MemoryEdit::Replace {
                old: "- a".to_string(),
                new: "- a".to_string(),
            }];
            let outcome = apply(&db, &dek, &key, 1, &Change::Edits(same), &agent(2))
                .await
                .unwrap();
            assert_eq!(outcome, Outcome::Unchanged { rev: 1 });
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            assert_eq!(memory.rev, 1);
            let history = list_revisions_with(&db, &dek, &memory.id).await.unwrap();
            assert_eq!(history.len(), 1);
        }
    }

    #[tokio::test]
    async fn shared_memories_are_listed_without_user_ones() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_shared").await {
            for key in [MemoryKey::org("o1"), toolset(), MemoryKey::user("o1", "u1")] {
                apply(&db, &dek, &key, 0, &content("x"), &person(1))
                    .await
                    .unwrap();
            }
            apply(
                &db,
                &dek,
                &MemoryKey::org("o2"),
                0,
                &content("x"),
                &person(1),
            )
            .await
            .unwrap();
            let mut scopes: Vec<_> = list_shared_with(&db, &dek, "o1")
                .await
                .unwrap()
                .into_iter()
                .map(|m| m.key.scope)
                .collect();
            scopes.sort_by_key(|s| s.as_str());
            assert_eq!(scopes, [MemoryScope::Org, MemoryScope::Toolset]);
        }
    }

    #[tokio::test]
    async fn a_revision_is_found_only_under_its_own_memory() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_wrong_memory").await {
            let Outcome::Pending { revision_id } =
                hold(&db, &dek, &toolset(), 0, &add("- b"), &agent(10))
                    .await
                    .unwrap()
            else {
                panic!("not held");
            };
            apply(
                &db,
                &dek,
                &MemoryKey::org("o1"),
                0,
                &content("x"),
                &person(11),
            )
            .await
            .unwrap();
            let org = get_with(&db, &dek, &MemoryKey::org("o1"))
                .await
                .unwrap()
                .unwrap();
            assert!(
                get_revision_with(&db, &dek, &org.id, &revision_id)
                    .await
                    .unwrap()
                    .is_none()
            );
            assert_eq!(
                accept_with(&db, &dek, &org.id, &revision_id, 12)
                    .await
                    .unwrap(),
                Outcome::NotFound
            );
            assert_eq!(
                discard_with(&db, &org.id, &revision_id).await.unwrap(),
                Outcome::NotFound
            );
        }
    }

    #[tokio::test]
    async fn revert_writes_the_old_content_as_a_new_revision() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_revert").await {
            let key = MemoryKey::user("o1", "u1");
            apply(&db, &dek, &key, 0, &content("one"), &person(10))
                .await
                .unwrap();
            apply(&db, &dek, &key, 1, &content("two"), &person(11))
                .await
                .unwrap();
            let reverted = revert(&db, &dek, &key, 1, &person(12)).await.unwrap();
            assert!(
                matches!(reverted, Outcome::Applied { rev: 3, .. }),
                "{reverted:?}"
            );
            assert_eq!(head(&db, &dek, &key).await, (3, "one".to_string()));
            assert_eq!(
                revert(&db, &dek, &key, 9, &person(13)).await.unwrap(),
                Outcome::NotFound
            );
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            let history = list_revisions_with(&db, &dek, &memory.id).await.unwrap();
            let revs: Vec<_> = history.iter().map(|r| r.rev).collect();
            assert_eq!(revs, [Some(3), Some(2), Some(1)]);
            assert!(history.iter().all(|r| r.content.is_none()));
        }
    }

    #[tokio::test]
    async fn the_cap_is_checked_on_apply_and_again_on_accept_and_can_be_raised() {
        let dek = random_bytes(64);
        let big = "x".repeat(TOOLSET_DEFAULT_MAX_BYTES as usize);
        for db in databases("ai_memory_cap").await {
            let key = toolset();
            let too_large = apply(
                &db,
                &dek,
                &key,
                0,
                &content(&format!("{big}y")),
                &person(10),
            )
            .await
            .unwrap();
            assert!(matches!(too_large, Outcome::Invalid(_)), "{too_large:?}");
            let start = format!("## Quirks\n{}", &big[20..]);
            apply(&db, &dek, &key, 0, &content(&start), &person(11))
                .await
                .unwrap();
            let Outcome::Pending { revision_id } =
                hold(&db, &dek, &key, 1, &add(&"z".repeat(100)), &agent(12))
                    .await
                    .unwrap()
            else {
                panic!("pending edits are not capped");
            };
            let memory_id = get_with(&db, &dek, &key).await.unwrap().unwrap().id;
            let refused = accept_with(&db, &dek, &memory_id, &revision_id, 13)
                .await
                .unwrap();
            assert_eq!(
                refused,
                Outcome::Invalid(ContentError::TooLarge {
                    size_bytes: (start.len() + "\n".len() + 100 + "\n".len()) as i64,
                    max_bytes: TOOLSET_DEFAULT_MAX_BYTES
                })
            );
            let raised = MemorySettings {
                max_bytes: Some(2 * TOOLSET_DEFAULT_MAX_BYTES),
                ..Default::default()
            };
            set(&db, &dek, &key, &raised, 14).await.unwrap();
            let accepted = accept_with(&db, &dek, &memory_id, &revision_id, 15)
                .await
                .unwrap();
            assert!(
                matches!(accepted, Outcome::Applied { rev: 2, .. }),
                "{accepted:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_user_memory_is_capped_by_the_org_rows_user_max_bytes() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_user_cap").await {
            let key = MemoryKey::user("o1", "u1");
            let text = content(&"x".repeat(3000));
            let refused = apply(&db, &dek, &key, 0, &text, &person(10)).await.unwrap();
            assert!(matches!(refused, Outcome::Invalid(_)), "{refused:?}");
            let raised = MemorySettings {
                user_max_bytes: Some(4096),
                ..Default::default()
            };
            set(&db, &dek, &MemoryKey::org("o1"), &raised, 11)
                .await
                .unwrap();
            let applied = apply(&db, &dek, &key, 0, &text, &person(12)).await.unwrap();
            assert!(matches!(applied, Outcome::Applied { .. }), "{applied:?}");
        }
    }

    #[tokio::test]
    async fn settings_create_the_row_and_never_bump_rev() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_settings").await {
            let key = MemoryKey::org("o1");
            let settings = MemorySettings {
                agent_memory_writes: Some(AgentMemoryWrites::Auto),
                max_bytes: Some(32 * 1024),
                user_max_bytes: None,
                clear_agent_memory_writes: false,
            };
            set(&db, &dek, &key, &settings, 10).await.unwrap();
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            assert_eq!((memory.rev, memory.content.as_str()), (0, ""));
            assert_eq!(memory.settings, settings);
            let more = MemorySettings {
                user_max_bytes: Some(4096),
                ..Default::default()
            };
            set(&db, &dek, &key, &more, 11).await.unwrap();
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            assert_eq!(memory.rev, 0);
            assert_eq!(
                memory.settings.agent_memory_writes,
                Some(AgentMemoryWrites::Auto)
            );
            assert_eq!(memory.settings.user_max_bytes, Some(4096));
        }
    }

    #[tokio::test]
    async fn content_and_edits_are_stored_encrypted() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_encrypted").await {
            let key = toolset();
            apply(
                &db,
                &dek,
                &key,
                0,
                &content("## Quirks\nsecret-ish\n"),
                &person(10),
            )
            .await
            .unwrap();
            hold(&db, &dek, &key, 1, &add("- held"), &agent(11))
                .await
                .unwrap();
            let row = find_by_key(&db, &key).await.unwrap().unwrap();
            assert!(!row.content.contains("secret-ish"));
            assert_eq!(
                decrypt(&dek, &row.content).unwrap(),
                "## Quirks\nsecret-ish\n"
            );
            let revisions = ai_memory_revisions::Entity::find().all(&db).await.unwrap();
            for revision in &revisions {
                for stored in [&revision.content, &revision.edits].into_iter().flatten() {
                    assert!(!stored.contains("secret-ish") && !stored.contains("held"));
                    decrypt(&dek, stored).unwrap();
                }
            }
            assert!(revisions.iter().any(|r| r.edits.is_some()));
            assert_eq!(revisions[0].origin_region, "us-1");
        }
    }

    #[tokio::test]
    async fn delete_removes_one_memory_and_its_history_only() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_delete").await {
            let gone = MemoryKey::user("o1", "u1");
            let kept = MemoryKey::user("o1", "u2");
            for key in [&gone, &kept] {
                apply(&db, &dek, key, 0, &content("x"), &person(10))
                    .await
                    .unwrap();
            }
            delete_with(&db, &gone).await.unwrap();
            assert!(get_with(&db, &dek, &gone).await.unwrap().is_none());
            let kept = get_with(&db, &dek, &kept).await.unwrap().unwrap();
            let all = ai_memory_revisions::Entity::find().all(&db).await.unwrap();
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].memory_id, kept.id);
        }
    }

    #[tokio::test]
    async fn applying_trims_the_agents_history_but_keeps_pending_edits() {
        let dek = random_bytes(64);
        for db in databases("ai_memory_trim").await {
            let key = toolset();
            hold(&db, &dek, &key, 0, &add("- held"), &agent(1))
                .await
                .unwrap();
            for rev in 0..(AGENT_KEPT as i64 + 3) {
                let applied = apply(
                    &db,
                    &dek,
                    &key,
                    rev,
                    &content(&rev.to_string()),
                    &agent(10 + rev),
                )
                .await
                .unwrap();
                assert!(matches!(applied, Outcome::Applied { .. }), "{applied:?}");
            }
            let memory = get_with(&db, &dek, &key).await.unwrap().unwrap();
            let history = list_revisions_with(&db, &dek, &memory.id).await.unwrap();
            let applied = history
                .iter()
                .filter(|r| r.state == RevisionState::Applied)
                .count();
            assert_eq!(applied, AGENT_KEPT);
            assert_eq!(count_pending_with(&db, &memory.id).await.unwrap(), 1);
        }
    }

    #[test]
    fn trim_keeps_people_a_year_or_200_deep_the_agent_50_and_discards_30_days() {
        let now = 400 * MICROS_PER_DAY;
        let row = |id: &str, state: RevisionState, by_agent, age_days: i64| HistoryRow {
            id: id.to_string(),
            state: state.as_str().to_string(),
            by_agent,
            created_at: now - age_days * MICROS_PER_DAY,
            op_id: format!("op-{id}"),
        };
        let mut rows = vec![row("head", RevisionState::Applied, true, 400)];
        rows.extend(
            (0..AGENT_KEPT + 1).map(|i| row(&format!("a{i}"), RevisionState::Applied, true, 0)),
        );
        rows.extend(
            (0..PEOPLE_KEPT).map(|i| row(&format!("p{i}"), RevisionState::Applied, false, 0)),
        );
        rows.push(row("old-person", RevisionState::Applied, false, 366));
        rows.push(row("recent-person", RevisionState::Applied, false, 300));
        rows.push(row("new-discard", RevisionState::Discarded, true, 29));
        rows.push(row("old-discard", RevisionState::Discarded, true, 31));
        rows.sort_by_key(|r| std::cmp::Reverse(r.created_at));
        let mut doomed = trim_plan(&rows, "op-head", now);
        doomed.sort();
        assert_eq!(doomed, ["a50", "old-discard", "old-person"]);
    }
}
