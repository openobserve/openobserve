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

//! The OSS half of the AutoObserve engine: its ports, and its start-up registration.

pub mod incidents;
pub mod ports;

use config::{cluster::LOCAL_NODE, utils::time::now_micros};
use o2_enterprise::enterprise::autoobserve::{self, job};

/// Installs the engine with the OSS ports, then makes sure this region has its engine row.
pub async fn init() -> Result<(), anyhow::Error> {
    if !autoobserve::is_enabled() {
        return Ok(());
    }
    let ports = ports::ports();
    let triggers = ports.triggers.clone();
    autoobserve::init(ports).await?;
    // Made at start-up so the first tick finds it cached; each append looks it up again.
    let writer = crate::ingestion::feature_writer::FeatureWriter::AutoObserve;
    if let Err(e) = crate::ingestion::feature_writer::token(writer, config::META_ORG_ID).await {
        log::warn!("[autoobserve] could not prepare the ingestion token: {e}");
    }
    // Only scheduler nodes claim the row, so only they have a reason to mint it.
    if LOCAL_NODE.is_scheduler()
        && job::ensure_trigger(true, triggers.as_ref(), now_micros()).await?
    {
        log::info!("[autoobserve] created this region's engine row");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::triggers::{Trigger, TriggerModule, TriggerStatus};
    use job::Step;

    use super::*;

    async fn claim(org: &str, lease_secs: i64) -> Trigger {
        infra::scheduler::pull(10, lease_secs, lease_secs, Some(TriggerModule::AutoObserve))
            .await
            .unwrap()
            .into_iter()
            .find(|t| t.org == org)
            .expect("the engine lane claims the row")
    }

    /// The engine is on, so the tick settles; only the fence keeps the stale claim off the row.
    #[tokio::test]
    async fn a_tick_on_a_claim_that_lost_its_lease_leaves_the_new_owners_row_alone() {
        let cfg = config::get_config();
        if cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite" {
            std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
        }
        infra::scheduler::init().await.unwrap();
        let org = format!("ao_tick_{}", now_micros());
        let mut row = job::engine_trigger(1);
        row.org = org.clone();
        infra::scheduler::push(row).await.unwrap();

        let lost = claim(&org, 0).await;
        infra::scheduler::watch_timeout().await.unwrap();
        let owner = claim(&org, 60).await;
        assert_eq!(owner.claim_epoch, lost.claim_epoch + 1);

        assert_eq!(job::tick_as(true, lost).await.unwrap(), Step::NotInstalled);
        let kept = infra::scheduler::get(&org, TriggerModule::AutoObserve, job::MODULE_KEY)
            .await
            .expect("a stale claim cannot delete the row");
        assert_eq!(
            (
                kept.claim_epoch,
                kept.status,
                kept.is_realtime,
                kept.next_run_at
            ),
            (
                owner.claim_epoch,
                TriggerStatus::Processing,
                true,
                owner.next_run_at
            )
        );
        infra::scheduler::delete(&org, TriggerModule::AutoObserve, job::MODULE_KEY)
            .await
            .unwrap();
    }
}
