// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Repairs the eventual-consistency gap between authoritative `_llm_scores`
//! review ingestion and the PostgreSQL QueueItem workflow projection.

use config::{cluster::LOCAL_NODE, spawn_pausable_job};

const RECONCILE_BATCH_SIZE: u64 = 1_000;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[LLM_REVIEW_RECONCILIATION] not a scheduler node, skipping");
        return;
    }
    if !o2_enterprise::enterprise::common::config::get_config()
        .llm_eval_config
        .enabled
    {
        log::debug!("[LLM_REVIEW_RECONCILIATION] LLM evaluations disabled, skipping");
        return;
    }

    spawn_pausable_job!(
        "llm_review_reconciliation",
        o2_enterprise::enterprise::common::config::get_config()
            .llm_eval_config
            .review_reconcile_interval_secs,
        {
            let is_leader = match infra::cluster::get_cached_online_nodes().await {
                Some(mut nodes) => {
                    nodes.retain(|node| node.is_scheduler());
                    nodes.sort_by(|left, right| left.uuid.cmp(&right.uuid));
                    nodes
                        .first()
                        .is_none_or(|leader| leader.uuid == LOCAL_NODE.uuid)
                }
                None => true,
            };
            if !is_leader {
                log::debug!("[LLM_REVIEW_RECONCILIATION] not leader, skipping this pass");
                continue;
            }

            match o2_enterprise::enterprise::llm_evaluations::annotation_queues::reconcile_pending_reviews(
                RECONCILE_BATCH_SIZE,
            )
            .await
            {
                Ok(0) => log::debug!(
                    "[LLM_REVIEW_RECONCILIATION] no QueueItems required repair"
                ),
                Ok(repaired) => log::info!(
                    "[LLM_REVIEW_RECONCILIATION] repaired {repaired} QueueItem(s)"
                ),
                Err(error) => log::error!(
                    "[LLM_REVIEW_RECONCILIATION] reconciliation failed: {error}"
                ),
            }
        }
    );
}
