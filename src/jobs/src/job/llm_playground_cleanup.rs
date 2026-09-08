// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Expires shared Playground snapshots.
//!
//! Snapshots are kept on a sliding window: opening one renews it, and one that
//! nobody has opened for the retention period is removed. A per-organization
//! cap bounds the store when links are shared faster than they fall out of use,
//! taking the least recently opened first.
//!
//! Each pass is bounded and idempotent. A missed or failed pass changes nothing
//! a user can see; the next pass repeats exactly the same work.

use config::{cluster::LOCAL_NODE, spawn_pausable_job};

const CLEANUP_INTERVAL_SECS: u64 = 60 * 60;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[LLM_PLAYGROUND_CLEANUP] not a scheduler node, skipping");
        return;
    }
    if !o2_enterprise::enterprise::common::config::get_config()
        .llm_eval_config
        .enabled
    {
        log::debug!("[LLM_PLAYGROUND_CLEANUP] LLM evaluations disabled, skipping");
        return;
    }

    spawn_pausable_job!("llm_playground_cleanup", CLEANUP_INTERVAL_SECS, {
        let now = chrono::Utc::now().timestamp_millis();
        match o2_enterprise::enterprise::llm_evaluations::playground::purge(now).await {
            Ok(outcome) if outcome.total() == 0 => {
                log::debug!("[LLM_PLAYGROUND_CLEANUP] no snapshots to remove")
            }
            Ok(outcome) => log::info!(
                "[LLM_PLAYGROUND_CLEANUP] removed {} expired and {} over-cap snapshot(s)",
                outcome.expired,
                outcome.over_cap
            ),
            Err(error) => {
                log::error!("[LLM_PLAYGROUND_CLEANUP] cleanup pass failed: {error}")
            }
        }
    });
}
