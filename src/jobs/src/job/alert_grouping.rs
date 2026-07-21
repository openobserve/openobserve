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

//! Background job to process expired alert batches

use std::time::Duration;

use tokio::time;

/// Background worker that processes expired alert batches
pub async fn process_expired_batches() {
    log::info!("[alert_grouping_worker] Starting alert grouping background worker");

    let mut interval = time::interval(Duration::from_secs(1));

    loop {
        interval.tick().await;

        #[cfg(feature = "enterprise")]
        {
            let batches = crate::service::alerts::grouping::get_expired_batches();
            let trace_id = config::ider::generate_trace_id();
            let trace_id = format!("expired_batched_{trace_id}");

            if !batches.is_empty() {
                log::debug!(
                    "[alert_grouping_worker] Processing {} expired batches with trace_id {trace_id}",
                    batches.len()
                );

                for batch in batches {
                    if let Err(e) = crate::service::alerts::grouping::send_grouped_notification(
                        &trace_id, batch,
                    )
                    .await
                    {
                        log::error!(
                            "[alert_grouping_worker] Error sending grouped notification trace_id {trace_id} : {} ",
                            e
                        );
                    }
                }
            }
        }
    }
}
