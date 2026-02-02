// Copyright 2025 OpenObserve Inc.
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

// Import trait for alert notification sending
#[cfg(feature = "enterprise")]
use crate::service::alerts::alert::AlertExt;

/// Background worker that processes expired alert batches
pub async fn process_expired_batches() {
    log::info!("[alert_grouping_worker] Starting alert grouping background worker");

    let mut interval = time::interval(Duration::from_secs(1));

    loop {
        interval.tick().await;

        #[cfg(feature = "enterprise")]
        {
            let batches = crate::service::alerts::grouping::get_expired_batches();

            if !batches.is_empty() {
                log::debug!(
                    "[alert_grouping_worker] Processing {} expired batches",
                    batches.len()
                );

                for batch in batches {
                    if let Err(e) = send_grouped_notification(batch).await {
                        log::error!(
                            "[alert_grouping_worker] Error sending grouped notification: {}",
                            e
                        );
                    }
                }
            }
        }
    }
}

/// Send a grouped notification for a batch of alerts (public wrapper for sync call)
#[cfg(feature = "enterprise")]
pub async fn send_grouped_notification_sync(
    batch: crate::service::alerts::grouping::PendingBatch,
) -> Result<(), anyhow::Error> {
    send_grouped_notification(batch).await
}

/// Send a grouped notification for a batch of alerts
#[cfg(feature = "enterprise")]
async fn send_grouped_notification(
    batch: crate::service::alerts::grouping::PendingBatch,
) -> Result<(), anyhow::Error> {
    use config::meta::alerts::deduplication::SendStrategy;

    let elapsed_seconds =
        (chrono::Utc::now().timestamp_micros() - batch.timer_started_at) / 1_000_000;

    log::info!(
        "[alert_grouping_worker] Sending grouped notification for {} alerts with fingerprint {} (waited {}s)",
        batch.alerts.len(),
        batch.fingerprint,
        elapsed_seconds
    );

    // Record wait time metric
    config::metrics::ALERT_GROUPING_WAIT_TIME
        .with_label_values(&[batch.org_id.as_str()])
        .observe(elapsed_seconds as f64);

    // Get the first alert (primary) and grouping config
    let primary_alert = &batch.alerts[0].alert;
    let grouping_config = primary_alert
        .deduplication
        .as_ref()
        .and_then(|d| d.grouping.as_ref())
        .ok_or_else(|| anyhow::anyhow!("Grouping config not found"))?;

    let send_strategy = &grouping_config.send_strategy;

    // Collect alert details
    let alert_names: Vec<String> = batch.alerts.iter().map(|a| a.alert.name.clone()).collect();

    let alert_count = batch.alerts.len();
    let suppressed_count = alert_count.saturating_sub(1);

    // Build notification context based on strategy
    let notification_context = match send_strategy {
        SendStrategy::FirstWithCount => {
            // "Alert a60 fired (2 others suppressed: a80, a90)"
            if suppressed_count > 0 {
                let suppressed_names = alert_names[1..].join(", ");
                format!(
                    "Alert '{}' fired ({} other{} suppressed: {})",
                    alert_names[0],
                    suppressed_count,
                    if suppressed_count == 1 { "" } else { "s" },
                    suppressed_names
                )
            } else {
                format!("Alert '{}' fired", alert_names[0])
            }
        }
        SendStrategy::Summary => {
            // "3 alerts fired: a60, a80, a90"
            format!(
                "{} alert{} fired: {}",
                alert_count,
                if alert_count == 1 { "" } else { "s" },
                alert_names.join(", ")
            )
        }
        SendStrategy::All => {
            // Full details of each alert
            let mut details = vec![format!("Grouped Alerts ({} total)", alert_count)];
            for (i, batched) in batch.alerts.iter().enumerate() {
                details.push(format!(
                    "\n{}. Alert: '{}'\n   Triggered at: {}\n   Rows matched: {}",
                    i + 1,
                    batched.alert.name,
                    chrono::DateTime::<chrono::Utc>::from_timestamp(
                        batched.timestamp / 1_000_000,
                        0
                    )
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| "unknown".to_string()),
                    batched.rows.len()
                ));
            }
            details.join("\n")
        }
    };

    log::info!(
        "[alert_grouping_worker] Strategy: {:?}, Sending notification with context: {}",
        send_strategy,
        notification_context.chars().take(200).collect::<String>() // Log first 200 chars
    );

    // Prepare combined trigger data based on strategy
    let combined_rows = match send_strategy {
        SendStrategy::FirstWithCount | SendStrategy::Summary => {
            // For FirstWithCount and Summary, just use the first alert's data
            batch.alerts[0].rows.clone()
        }
        SendStrategy::All => {
            // For All, combine all rows from all alerts
            let mut all_rows = Vec::new();
            for batched in &batch.alerts {
                all_rows.extend(batched.rows.clone());
            }
            all_rows
        }
    };

    // Use the primary alert for notification and inject grouped context
    let mut notification_alert = primary_alert.clone();

    // Inject grouped context into context_attributes for template access
    let mut context_attrs = notification_alert.context_attributes.unwrap_or_default();
    context_attrs.insert("grouped_alerts".to_string(), alert_names.join(", "));
    context_attrs.insert("alert_count".to_string(), alert_count.to_string());
    context_attrs.insert("grouped_summary".to_string(), notification_context.clone());
    context_attrs.insert("is_grouped".to_string(), "true".to_string());
    notification_alert.context_attributes = Some(context_attrs);

    // Get the timestamp for notification
    let rows_end_time = batch
        .alerts
        .iter()
        .map(|a| a.timestamp)
        .max()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_micros());

    let start_time = batch.alerts.iter().map(|a| a.timestamp).min();

    let evaluation_timestamp = chrono::Utc::now().timestamp_micros();

    // Send notification using alert's send_notification method
    match notification_alert
        .send_notification(
            &combined_rows,
            rows_end_time,
            start_time,
            evaluation_timestamp,
        )
        .await
    {
        Ok((success_msg, err_msg)) => {
            if !err_msg.is_empty() {
                log::error!(
                    "[alert_grouping_worker] Some destinations failed for grouped notification (fingerprint: {}): {}",
                    batch.fingerprint,
                    err_msg
                );
                // Record error metric
                config::metrics::ALERT_GROUPING_SEND_ERRORS_TOTAL
                    .with_label_values(&[batch.org_id.as_str(), "partial_failure"])
                    .inc();
                return Err(anyhow::anyhow!("Partial failure: {}", err_msg));
            }

            // Record successful send metrics
            let strategy_str = format!("{:?}", send_strategy).to_lowercase();
            let reason = if elapsed_seconds >= grouping_config.group_wait_seconds {
                "expired"
            } else {
                "max_size"
            };

            config::metrics::ALERT_GROUPING_NOTIFICATIONS_SENT_TOTAL
                .with_label_values(&[batch.org_id.as_str(), strategy_str.as_str(), reason])
                .inc();

            config::metrics::ALERT_GROUPING_BATCH_SIZE
                .with_label_values(&[batch.org_id.as_str(), strategy_str.as_str()])
                .observe(alert_count as f64);

            log::info!(
                "[alert_grouping_worker] Successfully sent grouped notification (fingerprint: {}): {}",
                batch.fingerprint,
                success_msg
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[alert_grouping_worker] Failed to send grouped notification (fingerprint: {}): {}",
                batch.fingerprint,
                e
            );
            // Record error metric
            config::metrics::ALERT_GROUPING_SEND_ERRORS_TOTAL
                .with_label_values(&[batch.org_id.as_str(), "send_failed"])
                .inc();
            Err(anyhow::anyhow!("Send failed: {}", e))
        }
    }
}
