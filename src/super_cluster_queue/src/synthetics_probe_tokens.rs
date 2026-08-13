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

//! Applies `synthetics_probe_tokens` rows replicated from the region they were
//! minted in.
//!
//! `find_global` — the auth middleware's lookup on every probe request — reads
//! the local meta DB, matches on the token value with no org filter, and knows
//! nothing about regions. So a token that exists in one region 401s in every
//! other, and which region holds it depends on nothing more than where the
//! operator's browser landed when they clicked create. This file is what closes
//! that.
//!
//! Everything here goes through `infra::table::synthetics_probe_tokens` on
//! purpose. The publishing wrappers are one layer up — the enterprise synthetics
//! service, the enterprise dispatcher, and the core crate's synthetics module
//! for the org-creation path — and `infra` cannot reach the enterprise crate at
//! all, so applying below them is what stops a region re-broadcasting what it
//! just applied. The `source_cluster` check in `subscribe()` does not cover
//! this: it stops a region re-consuming its *own* message, not region A
//! republishing what it applied from region B. A test greps this file for those
//! layers.
//!
//! Every apply also clears this region's token caches and emits the coordinator
//! event that clears them on every other node here, because the table module's
//! write functions do that themselves. That is what makes a replicated
//! revocation take effect on arrival rather than after a 10 s TTL.

use infra::{
    errors::{Error, Result},
    table::synthetics_probe_tokens,
};
use o2_enterprise::enterprise::super_cluster::queue::{
    Message, MessageType, SyntheticsProbeTokenPayload, SyntheticsProbeTokensMessage,
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SyntheticsProbeTokensTable => {
            process_msg(msg.try_into()?).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

async fn process_msg(msg: SyntheticsProbeTokensMessage) -> Result<()> {
    match msg {
        SyntheticsProbeTokensMessage::Create { payload } => {
            insert(payload).await?;
        }
        SyntheticsProbeTokensMessage::Rotate { payload } => {
            // A rotate is mint-then-promote, and it arrives as one message so
            // the two cannot be separated. `set_default` runs even when the
            // insert was a no-op: a redelivery must still leave the org with
            // this token as its sole default, and running it twice is the same
            // as running it once.
            let (org_id, name) = (payload.org_id.clone(), payload.name.clone());
            insert(payload).await?;
            // Clears `is_default` on every other row of the org in the same
            // transaction, exactly as the origin region's rotate did — so the
            // previous default is demoted here too, and stays enabled for the
            // overlap window.
            synthetics_probe_tokens::set_default(&org_id, &name).await?;
        }
        SyntheticsProbeTokensMessage::SetEnabled {
            org_id,
            name,
            enabled,
        } => {
            // Addressed by the `(org_id, name)` natural key the way the origin
            // region addressed it. `set_enabled` reports "no such row" as
            // success, so a revocation that outran its create would be acked
            // and lost — and a token that stays enabled in one region is the
            // whole point of revoking it. Error instead, and let the
            // redelivery land after the create.
            if synthetics_probe_tokens::get_by_name(&org_id, &name)
                .await?
                .is_none()
            {
                return Err(Error::Message(format!(
                    "synthetics probe token {org_id}/{name} not found for enable/disable"
                )));
            }
            synthetics_probe_tokens::set_enabled(&org_id, &name, enabled).await?;
        }
    }
    Ok(())
}

/// Inserts a replicated token, tolerating the two ways the row can already be
/// here.
async fn insert(payload: SyntheticsProbeTokenPayload) -> Result<()> {
    let record = payload.into_record();
    // `(org_id, name)` is UNIQUE, so a redelivery would fail the constraint and
    // redeliver again until it dead-lettered.
    if let Some(existing) =
        synthetics_probe_tokens::get_by_name(&record.org_id, &record.name).await?
    {
        if existing.id != record.id {
            // Two regions minted a token under the same name before either
            // message crossed — realistically only `default`, from an org
            // created in one region while another lazily minted one for it.
            // Both values authenticate (`find_global` matches ANY enabled
            // token), so keeping the local row costs nothing here; what it
            // costs is that agents holding the *other* region's value still
            // 401 here. Loud rather than silent, because nothing else reports
            // it.
            log::warn!(
                "[SUPER_CLUSTER:DB] synthetics probe token {}/{} arrived as {} but this region \
                 already has {}; keeping the local row — agents holding the remote value will \
                 not authenticate here",
                record.org_id,
                record.name,
                record.id,
                existing.id
            );
        }
        return Ok(());
    }
    synthetics_probe_tokens::add(&record).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::{
        Message, MessageType, SyntheticsProbeTokensMessage,
    };

    use super::*;

    #[tokio::test]
    async fn a_message_from_another_table_is_rejected() {
        // The payload is a perfectly good probe-token write, so only the type
        // check can reject it — a processor that decoded first and asked
        // questions later would apply it.
        let payload = config::utils::json::to_vec(&SyntheticsProbeTokensMessage::SetEnabled {
            org_id: "org1".to_string(),
            name: "default".to_string(),
            enabled: false,
        })
        .unwrap();
        let msg = Message::new(
            "/synthetics_probe_tokens/".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::SyntheticsTable,
        );
        let err = process(msg).await.unwrap_err();
        assert!(
            err.to_string().contains("Invalid message type"),
            "expected the type check to reject it, got: {err}"
        );
    }

    #[tokio::test]
    async fn a_malformed_payload_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/synthetics_probe_tokens/".to_string(),
            Some(b"not json".to_vec().into()),
            None,
            false,
            MessageType::SyntheticsProbeTokensTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[tokio::test]
    async fn a_payload_less_message_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/synthetics_probe_tokens/".to_string(),
            None,
            None,
            false,
            MessageType::SyntheticsProbeTokensTable,
        );
        assert!(process(msg).await.is_err());
    }

    /// Spec test 7, consumer half.
    ///
    /// `find_global` filters on the exact token value AND `enabled = true`, so
    /// those two fields are what decide whether an agent that registered in the
    /// origin region authenticates here. A payload that lost either produces
    /// the same 401 as one that never arrived — the failure this whole file
    /// exists to remove — so the conversion is asserted rather than assumed.
    #[test]
    fn the_row_written_is_one_find_global_would_match() {
        let payload = SyntheticsProbeTokenPayload {
            id: "tok-1".to_string(),
            org_id: "org1".to_string(),
            name: "default".to_string(),
            token: "o2syn_abcdef0123456789".to_string(),
            is_default: true,
            enabled: true,
            created_by: "alice@example.com".to_string(),
            created_at: 1,
            updated_at: 2,
        };
        let record = payload.into_record();

        assert_eq!(record.token, "o2syn_abcdef0123456789");
        assert!(record.enabled, "a token that lands disabled still 401s");
        assert!(
            record
                .token
                .starts_with(synthetics_probe_tokens::SYNTHETICS_PROBE_TOKEN_PREFIX),
            "the validator routes on the prefix before it ever queries"
        );
        // The primary key is the origin region's, so a later SetEnabled that
        // addresses `(org_id, name)` reaches the same row everywhere.
        assert_eq!(record.id, "tok-1");
        assert_eq!(
            (record.org_id.as_str(), record.name.as_str()),
            ("org1", "default")
        );
    }

    /// The one hazard this file exists to avoid.
    ///
    /// The publishes live one layer up — `infra` cannot reach the enterprise
    /// crate (`o2_enterprise` depends on `infra`, so the reverse edge would be a
    /// cycle). Applying a replicated write through any of those layers would
    /// publish it straight back out and the regions would hand the same token
    /// around forever.
    #[test]
    fn the_processor_applies_below_the_publishing_layer() {
        let source = include_str!("synthetics_probe_tokens.rs");
        // Assembled at runtime; spelling these out as literals would put them
        // in this file and make the assertions fail on themselves.
        for layer in [
            ["synthetics", "service"].join("::"),
            ["synthetics", "dispatcher"].join("::"),
            ["core", "synthetics"].join("::"),
            ["queue", "synthetics_probe_token_"].join("::"),
            // The crate the service now lives in, not just the module path.
            // `openobserve-synthetics` is deliberately absent from this crate's
            // dependencies, so this can only ever fire if someone adds it — at
            // which point the loop-prevention guarantee has stopped being a
            // property of the crate graph and become a convention.
            ["openobserve", "synthetics"].join("_"),
        ] {
            assert!(
                !source.contains(&layer),
                "{layer} publishes what it writes; applying through it loops"
            );
        }
    }

    /// The runtime tables are region-owned: `synthetics_jobs` is a lease queue,
    /// `synthetics_runs` holds a counter, `synthetics_agents` is liveness for
    /// agents that long-poll one region. Two regions holding copies is a
    /// correctness failure, not a cost one.
    #[test]
    fn the_processor_never_writes_a_runtime_table() {
        let source = include_str!("synthetics_probe_tokens.rs");
        for table in ["jobs", "runs", "agents"] {
            let path = ["table", &["synthetics_", table].concat()].join("::");
            assert!(
                !source.contains(&path),
                "{path} is region-owned and must never be applied from a message"
            );
        }
    }
}
