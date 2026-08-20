// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Removes retired outbound-integration signing keys after their grace period.

use config::{cluster::LOCAL_NODE, spawn_pausable_job};

const CLEANUP_INTERVAL_SECS: u64 = 5 * 60;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[LLM_SECRET_CLEANUP] not a scheduler node, skipping");
        return;
    }
    if !o2_enterprise::enterprise::common::config::get_config()
        .llm_eval_config
        .enabled
    {
        log::debug!("[LLM_SECRET_CLEANUP] LLM evaluations disabled, skipping");
        return;
    }

    spawn_pausable_job!("llm_secret_cleanup", CLEANUP_INTERVAL_SECS, {
        match o2_enterprise::enterprise::llm_evaluations::secrets::sweep_expired().await {
            Ok(0) => log::debug!("[LLM_SECRET_CLEANUP] no expired signing keys"),
            Ok(removed) => {
                log::info!("[LLM_SECRET_CLEANUP] removed {removed} expired signing key(s)")
            }
            Err(error) => log::error!("[LLM_SECRET_CLEANUP] cleanup pass failed: {error}"),
        }
    });
}
