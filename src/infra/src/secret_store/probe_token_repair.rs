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

use std::time::Duration;

use crate::{
    db::get_orm_client_rw,
    dist_lock, errors,
    table::synthetics_probe_tokens::{
        BlankReport, RepairOutcome, blank_plaintext_pass, repair_owned_rows,
    },
};

pub const LOCK_KEY: &str = "/secret_store/maint/probe_token_repair";
pub const INTERVAL: Duration = Duration::from_secs(600);

/// Blanking runs after repair, so a row sealed in this pass loses its plaintext in the same pass;
/// it is a no-op until every live node reports P1-11.
pub async fn run_pass() -> Result<(RepairOutcome, BlankReport), errors::Error> {
    let locker = dist_lock::lock(LOCK_KEY, 0).await?;
    let result = repair_owned_rows(get_orm_client_rw().await).await;
    dist_lock::unlock(&locker).await?;
    let repaired = result?;
    Ok((repaired, blank_plaintext_pass().await?))
}

pub async fn run_forever() {
    loop {
        match run_pass().await {
            Ok((repair, blank)) => {
                if repair.failed > 0 {
                    log::warn!("probe token repair failed for {} rows", repair.failed);
                }
                if blank.blanked + blank.mismatched > 0 {
                    log::info!(
                        "probe token plaintext blanking: blanked={} mismatched={} skipped={}",
                        blank.blanked,
                        blank.mismatched,
                        blank.skipped
                    );
                }
            }
            Err(_) => log::error!("probe token repair pass failed"),
        }
        tokio::time::sleep(INTERVAL).await;
    }
}
