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

//! Durable storage for AI chat events.
//!
//! Server-side chat persistence itself lives in
//! `o2_enterprise::enterprise::ai::chat` — the background turn task,
//! batching, watermark and leases. This module is the one piece that has to
//! live here: writing to a stream needs OpenObserve's own ingestion and
//! schema plumbing, which sits above the enterprise crate in the dependency
//! graph. It is injected into a turn as a
//! [`ChatStore`](o2_enterprise::enterprise::ai::chat::ChatStore).

use std::sync::LazyLock as Lazy;

use anyhow::Result;
use config::{
    meta::{
        self_reporting::ai_chat::AI_CHAT_EVENTS_STREAM,
        stream::{StreamParams, StreamSettings, StreamType},
    },
    utils::{schema::schema_eq, time::now_micros},
};
use dashmap::DashSet;
use infra::table::ai_chat_sessions;
use o2_enterprise::enterprise::ai::chat::{AiChatEventRecord, Binding, ChatStore};

static INITIALIZED_ORGS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

const SESSION_FIELD: &str = "session_id";

/// The storage a running chat turn writes through: durable events into the
/// org's protected `_o2_ai_chat_events` stream (via the internal ingestion
/// path — directly on an ingester, over gRPC to one otherwise), and the
/// session index in the meta DB.
pub struct StreamChatStore {
    retention_days: i64,
}

impl StreamChatStore {
    pub fn new(retention_days: i64) -> Self {
        Self { retention_days }
    }
}

#[async_trait::async_trait]
impl ChatStore for StreamChatStore {
    async fn write_events(&self, org_id: &str, records: Vec<AiChatEventRecord>) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }
        ensure_stream_initialized(org_id, self.retention_days).await;
        let values = records
            .iter()
            .map(config::utils::json::to_value)
            .collect::<Result<Vec<_>, _>>()?;
        let stream = StreamParams::new(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs);
        crate::self_reporting::ingest_internal_logs(values, stream).await
    }

    async fn bind_opencode_session(
        &self,
        org_id: &str,
        session_id: &str,
        opencode_session_id: &str,
    ) -> Result<Binding> {
        ai_chat_sessions::bind_opencode_session(
            org_id,
            session_id,
            opencode_session_id,
            now_micros(),
        )
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn advance_watermark(
        &self,
        org_id: &str,
        session_id: &str,
        epoch: i64,
        expected_prev_seq: i64,
        new_seq: i64,
        first_event_at: i64,
        last_event_at: i64,
    ) -> Result<bool> {
        ai_chat_sessions::advance_watermark(
            org_id,
            session_id,
            epoch,
            expected_prev_seq,
            new_seq,
            first_event_at,
            last_event_at,
            now_micros(),
        )
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn set_title(&self, org_id: &str, session_id: &str, title: &str) -> Result<()> {
        ai_chat_sessions::set_title(org_id, session_id, title, now_micros())
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
    }
}

fn expected_schema() -> Result<arrow_schema::Schema> {
    let sample = config::utils::json::to_value(AiChatEventRecord::init_for_reflection())?;
    // Ingestion flattens records before inferring a schema; mirror that so
    // every column is initialized the same way it will be written.
    let sample = config::utils::flatten::flatten(sample)?;
    let sample = sample
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("AiChatEventRecord did not serialize to an object"))?;
    Ok(config::utils::schema::infer_json_schema_from_map(
        AI_CHAT_EVENTS_STREAM,
        StreamType::Logs,
        std::iter::once(sample),
    )?)
}

/// Create the org's chat-events stream with the expected schema and settings.
/// Idempotent and cheap after the first call per org; a failure is logged and
/// retried on the next write (ingestion can infer the schema on its own, so
/// persistence does not depend on this succeeding).
pub async fn ensure_stream_initialized(org_id: &str, retention_days: i64) {
    if !INITIALIZED_ORGS.insert(org_id.to_string()) {
        return;
    }
    let schema_ok = initialize_schema(org_id)
        .await
        .inspect_err(|e| {
            log::warn!(
                "[AI-CHAT] Failed to initialize {AI_CHAT_EVENTS_STREAM} schema for org {org_id}: {e}"
            )
        })
        .is_ok();
    let settings_ok = initialize_settings(org_id, retention_days)
        .await
        .inspect_err(|e| {
            log::warn!(
                "[AI-CHAT] Failed to apply {AI_CHAT_EVENTS_STREAM} settings for org {org_id}: {e}"
            )
        })
        .is_ok();
    if !(schema_ok && settings_ok) {
        INITIALIZED_ORGS.remove(org_id);
    }
}

async fn initialize_schema(org_id: &str) -> Result<()> {
    let expected = expected_schema()?;
    if infra::schema::get(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected))
    {
        return Ok(());
    }
    crate::db::schema::merge(
        org_id,
        AI_CHAT_EVENTS_STREAM,
        StreamType::Logs,
        &expected,
        Some(now_micros()),
    )
    .await
    .map(|_| {
        log::info!(
            "[AI-CHAT] Created {AI_CHAT_EVENTS_STREAM} schema for org {org_id} ({} fields)",
            expected.fields().len()
        );
    })
    .map_err(|e| anyhow::anyhow!("schema merge failed: {e}"))
}

async fn initialize_settings(org_id: &str, retention_days: i64) -> Result<()> {
    let mut settings = infra::schema::get_settings(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs)
        .await
        .map(|settings| (*settings).clone())
        .unwrap_or_default();
    if !apply_settings(&mut settings, retention_days, now_micros()) {
        return Ok(());
    }
    schema::save_stream_settings(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs, settings).await?;
    Ok(())
}

/// A bloom filter and a secondary index on `session_id` make the per-session
/// reads the Chat API does cheap; retention is applied only when configured.
/// Returns whether anything changed.
fn apply_settings(settings: &mut StreamSettings, retention_days: i64, now: i64) -> bool {
    let mut changed = false;
    if !settings
        .bloom_filter_fields
        .iter()
        .any(|f| f == SESSION_FIELD)
    {
        settings.bloom_filter_fields.push(SESSION_FIELD.to_string());
        changed = true;
    }
    if !settings.index_fields.iter().any(|f| f == SESSION_FIELD) {
        settings.index_fields.push(SESSION_FIELD.to_string());
        settings
            .index_fields_updated_at
            .insert(SESSION_FIELD.to_string(), now);
        changed = true;
    }
    if retention_days > 0 && settings.data_retention != retention_days {
        settings.data_retention = retention_days;
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_schema_has_a_text_payload_and_every_column() {
        let schema = expected_schema().unwrap();
        for field in [
            "_timestamp",
            "org_id",
            "user_id",
            "session_id",
            "opencode_session_id",
            "session_epoch",
            "turn_id",
            "seq",
            "event_id",
            "event_type",
            "event_hash",
            "payload",
            "payload_bytes",
        ] {
            assert!(schema.field_with_name(field).is_ok(), "{field}");
        }
        // A JSON *string*: flattening a nested object here would create a
        // column per message/part field the model ever emits.
        assert_eq!(
            schema.field_with_name("payload").unwrap().data_type(),
            &arrow_schema::DataType::Utf8
        );
        assert_eq!(schema.fields().len(), 13);
    }

    #[test]
    fn settings_are_applied_once_and_retention_only_when_configured() {
        let mut settings = StreamSettings::default();
        assert!(apply_settings(&mut settings, 0, 5));
        assert_eq!(settings.bloom_filter_fields, vec![SESSION_FIELD]);
        assert_eq!(settings.index_fields, vec![SESSION_FIELD]);
        assert_eq!(
            settings.index_fields_updated_at.get(SESSION_FIELD),
            Some(&5)
        );
        assert!(!apply_settings(&mut settings, 0, 6));

        assert!(apply_settings(&mut settings, 30, 7));
        assert_eq!(settings.data_retention, 30);
        assert!(!apply_settings(&mut settings, 30, 8));
    }
}
