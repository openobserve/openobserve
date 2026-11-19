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

//! AI memory reads and writes; every write ends in [`publish`] so other regions can follow it.

use config::{
    meta::ai::memory::{
        AgentMemoryWrites, Author, Evidence, MemoryScope, MemorySettings, WriteMode,
        effective_agent_writes, write_mode,
    },
    utils::time::now_micros,
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Result,
    table::{
        ai_memory::{
            self as table, AgentOutcome, AgentWrite, Change, Memory, MemoryKey, Outcome,
            PendingRevision, Revision, ToolsetDelete, Write, WriteMeta,
        },
        cipher,
    },
};

/// One write to a memory, before its write mode is decided; `toolset_id` is set for toolset
/// memory so the write fails once that toolset is deleted.
#[derive(Clone, Debug)]
pub struct Submission {
    pub key: MemoryKey,
    pub toolset_id: Option<String>,
    pub base_rev: i64,
    pub change: Change,
    pub settings: MemorySettings,
    pub author: Author,
    pub is_memory_admin: bool,
    pub reason: Option<String>,
    pub evidence: Option<Vec<Evidence>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Submitted {
    Written(Outcome),
    Refused,
    /// A whole-text change or a setting would wait for approval, which only edits can.
    NeedsMemoryAdmin,
}

pub async fn get(key: &MemoryKey) -> Result<Option<Memory>> {
    let dek = cipher::get_dek(&key.org).await?;
    table::get_with(get_orm_client_ro().await, &dek, key).await
}

pub async fn count_pending(memory_id: &str) -> Result<u64> {
    table::count_pending_with(get_orm_client_ro().await, memory_id).await
}

pub async fn list_revisions(org: &str, memory_id: &str) -> Result<Vec<Revision>> {
    let dek = cipher::get_dek(org).await?;
    table::list_revisions_with(get_orm_client_ro().await, &dek, memory_id).await
}

pub async fn get_revision(
    org: &str,
    memory_id: &str,
    revision_id: &str,
) -> Result<Option<Revision>> {
    let dek = cipher::get_dek(org).await?;
    table::get_revision_with(get_orm_client_ro().await, &dek, memory_id, revision_id).await
}

pub async fn list_pending(org: &str) -> Result<Vec<PendingRevision>> {
    let dek = cipher::get_dek(org).await?;
    table::list_pending_with(get_orm_client_ro().await, &dek, org).await
}

/// The memory id and key of a revision of `org`.
pub async fn revision_memory(org: &str, revision_id: &str) -> Result<Option<(String, MemoryKey)>> {
    table::revision_memory_with(get_orm_client_ro().await, org, revision_id).await
}

/// The agent-write setting in force; a toolset memory without its own follows the org's.
pub async fn effective_writes(
    key: &MemoryKey,
    memory: Option<&Memory>,
) -> Result<AgentMemoryWrites> {
    let setting = memory.and_then(|m| m.settings.agent_memory_writes);
    let org_setting = match key.scope {
        MemoryScope::Toolset if setting.is_none() => get(&MemoryKey::org(&key.org))
            .await?
            .and_then(|org| org.settings.agent_memory_writes),
        MemoryScope::Org | MemoryScope::Toolset | MemoryScope::User => None,
    };
    Ok(effective_agent_writes(key.scope, setting, org_setting))
}

/// Applies, holds or refuses `submission` by its write mode; its settings and text commit
/// together or not at all. [strong]
pub async fn submit(submission: Submission) -> Result<Submitted> {
    let key = &submission.key;
    let memory = get(key).await?;
    let writes = effective_writes(key, memory.as_ref()).await?;
    let mode = write_mode(
        key.scope,
        &submission.author,
        submission.is_memory_admin,
        writes,
    );
    let meta = WriteMeta {
        author: submission.author,
        reason: submission.reason,
        evidence: submission.evidence,
        origin_region: origin_region(),
        now: now_micros(),
    };
    let dek = cipher::get_dek(&key.org).await?;
    let conn = get_orm_client_rw().await;
    let toolset_id = submission.toolset_id.as_deref();
    let outcome = match (mode, submission.change) {
        (WriteMode::Refuse, _) => return Ok(Submitted::Refused),
        (WriteMode::Hold, Change::Content(_)) => return Ok(Submitted::NeedsMemoryAdmin),
        // Only agents' edits are held, through `agent_write`; a person's text needs an admin.
        (WriteMode::Hold, Change::Edits(_)) => return Ok(Submitted::NeedsMemoryAdmin),
        (WriteMode::Apply, change) => {
            let write = Write {
                base_rev: submission.base_rev,
                change,
                settings: submission.settings,
            };
            table::apply_with(conn, &dek, key, toolset_id, &write, &meta).await?
        }
    };
    if matches!(outcome, Outcome::Applied { .. } | Outcome::Pending { .. }) {
        publish(key).await;
    }
    Ok(Submitted::Written(outcome))
}

/// An agent's edit for a running turn, checked and written in one transaction. [strong]
pub async fn agent_write(mut write: AgentWrite) -> Result<AgentOutcome> {
    write.origin_region = origin_region();
    let dek = cipher::get_dek(&write.org).await?;
    let outcome = table::agent_write_with(get_orm_client_rw().await, &dek, &write).await?;
    if let AgentOutcome::Written(key, Outcome::Applied { .. } | Outcome::Pending { .. }) = &outcome
    {
        publish(key).await;
    }
    Ok(outcome)
}

/// Re-applies a pending revision of `key`'s memory to its latest content. [strong]
pub async fn accept(key: &MemoryKey, memory_id: &str, revision_id: &str) -> Result<Outcome> {
    let dek = cipher::get_dek(&key.org).await?;
    let outcome = table::accept_with(
        get_orm_client_rw().await,
        &dek,
        memory_id,
        revision_id,
        now_micros(),
    )
    .await?;
    if matches!(outcome, Outcome::Applied { .. }) {
        publish(key).await;
    }
    Ok(outcome)
}

pub async fn discard(key: &MemoryKey, memory_id: &str, revision_id: &str) -> Result<Outcome> {
    let outcome = table::discard_with(get_orm_client_rw().await, memory_id, revision_id).await?;
    if outcome == Outcome::Discarded {
        publish(key).await;
    }
    Ok(outcome)
}

/// Writes applied revision `rev`'s content as a new revision. [strong]
pub async fn revert(
    key: &MemoryKey,
    toolset_id: Option<&str>,
    rev: i64,
    author: Author,
) -> Result<Outcome> {
    let dek = cipher::get_dek(&key.org).await?;
    let meta = WriteMeta {
        author,
        reason: Some(format!("revert to rev {rev}")),
        evidence: None,
        origin_region: origin_region(),
        now: now_micros(),
    };
    let conn = get_orm_client_rw().await;
    let outcome = table::revert_with(conn, &dek, key, toolset_id, rev, &meta).await?;
    if matches!(outcome, Outcome::Applied { .. }) {
        publish(key).await;
    }
    Ok(outcome)
}

/// The caller validates `settings` for the scope first. [strong]
pub async fn set_settings(
    key: &MemoryKey,
    toolset_id: Option<&str>,
    settings: &MemorySettings,
) -> Result<Outcome> {
    let dek = cipher::get_dek(&key.org).await?;
    let conn = get_orm_client_rw().await;
    let outcome =
        table::set_settings_with(conn, &dek, key, toolset_id, settings, now_micros()).await?;
    if matches!(outcome, Outcome::SettingsSaved { .. }) {
        publish(key).await;
    }
    Ok(outcome)
}

/// Deletes one memory with its history. [strong]
pub async fn delete(key: &MemoryKey) -> Result<()> {
    table::delete_with(get_orm_client_rw().await, key).await?;
    publish(key).await;
    Ok(())
}

/// Deletes a toolset together with its memory, which stays while another toolset of the org
/// still has the same normalized name. [strong]
pub async fn delete_toolset(
    org: &str,
    toolset_id: &str,
    normalize: impl Fn(&str) -> String,
) -> Result<ToolsetDelete> {
    let deleted =
        table::delete_toolset_with(get_orm_client_rw().await, org, toolset_id, normalize).await?;
    if let ToolsetDelete::Deleted { memory: Some(key) } = &deleted {
        publish(key).await;
    }
    Ok(deleted)
}

// Replication (R2) sends the change for `key` from here, behind the super-cluster guard.
async fn publish(_key: &MemoryKey) {}

#[cfg(feature = "enterprise")]
fn origin_region() -> String {
    o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .region
        .clone()
}

#[cfg(not(feature = "enterprise"))]
fn origin_region() -> String {
    String::new()
}
