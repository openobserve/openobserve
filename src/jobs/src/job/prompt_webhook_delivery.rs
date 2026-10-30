// Copyright 2026 OpenObserve Inc.

use std::time::Duration;

use chrono::{DateTime, Utc};
use config::{cluster::LOCAL_NODE, spawn_pausable_job};
use http::{HeaderName, HeaderValue, header};
#[cfg(test)]
use infra::outbound_http::OutboundError;
use infra::{
    outbound_http::{OutboundClient, OutboundPolicy, OutboundRequest},
    secrets::{self, SecretMaterial, SecretOwnerKind},
    table::{entity::llm_prompt_webhook_deliveries as deliveries, llm_prompts},
};
use rand::RngExt;

const POLL_INTERVAL_SECS: u64 = 1;
const CLAIM_BATCH_SIZE: u64 = 50;
const CLAIM_LEASE_MILLIS: i64 = 60_000;
const MAX_ATTEMPTS: i32 = 8;
const MAX_RETRY_DELAY_SECS: u64 = 3_600;
const RETRY_CAPS_SECS: [u64; 7] = [1, 4, 16, 64, 256, 1_024, 3_600];
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[PROMPT_WEBHOOK] not a scheduler node, skipping");
        return;
    }
    spawn_pausable_job!("prompt_webhook_delivery", POLL_INTERVAL_SECS, {
        if let Err(error) = deliver_due().await {
            log::error!("[PROMPT_WEBHOOK] delivery pass failed: {error}");
        }
    });
}

async fn deliver_due() -> Result<(), anyhow::Error> {
    let now = Utc::now().timestamp_millis();
    let db = infra::db::get_orm_client_rw().await;
    let claimed = llm_prompts::claim_due_deliveries(
        db,
        now,
        CLAIM_BATCH_SIZE,
        now.saturating_add(CLAIM_LEASE_MILLIS),
    )
    .await?;
    for delivery in claimed {
        deliver_one(db, delivery).await?;
    }
    Ok(())
}

async fn deliver_one(
    db: &sea_orm::DatabaseConnection,
    delivery: deliveries::Model,
) -> Result<(), sea_orm::DbErr> {
    let attempt = delivery.attempt_count.saturating_add(1);
    let timestamp = Utc::now().timestamp();
    let raw_body =
        serde_json::to_vec(&delivery.payload).expect("stored prompt webhook payload is valid JSON");
    let secret = resolve_secret(&delivery).await;
    let outcome = match secret {
        Ok(secret) => send(&delivery, &raw_body, &secret, timestamp).await,
        Err(error) => DeliveryOutcome::Retry {
            error,
            retry_after_secs: None,
        },
    };
    let now = Utc::now().timestamp_millis();
    match outcome {
        DeliveryOutcome::Delivered => {
            llm_prompts::update_delivery(db, delivery, "delivered", attempt, now, None, Some(now))
                .await?;
        }
        DeliveryOutcome::Terminal { error } => {
            llm_prompts::update_delivery(
                db,
                delivery,
                "exhausted",
                attempt,
                now,
                Some(truncate_error(error)),
                None,
            )
            .await?;
        }
        DeliveryOutcome::Retry {
            error,
            retry_after_secs,
        } => {
            if attempt >= MAX_ATTEMPTS {
                llm_prompts::update_delivery(
                    db,
                    delivery,
                    "exhausted",
                    attempt,
                    now,
                    Some(truncate_error(error)),
                    None,
                )
                .await?;
            } else {
                let delay = retry_delay_secs(attempt, retry_after_secs);
                llm_prompts::update_delivery(
                    db,
                    delivery,
                    "pending",
                    attempt,
                    now.saturating_add((delay as i64).saturating_mul(1_000)),
                    Some(truncate_error(error)),
                    None,
                )
                .await?;
            }
        }
    }
    Ok(())
}

async fn resolve_secret(delivery: &deliveries::Model) -> Result<Vec<u8>, String> {
    let (_, material) = secrets::resolve_record(
        &delivery.org_id,
        &delivery.secret_ref,
        SecretOwnerKind::PromptWebhook,
        &delivery.org_id,
        secrets::CURRENT,
    )
    .await
    .map_err(|error| format!("signing secret resolution failed: {error}"))?;
    match material {
        SecretMaterial::Token { value } => Ok(value.into_bytes()),
        SecretMaterial::Basic { .. } => Err("signing secret is not a token".to_string()),
    }
}

async fn send(
    delivery: &deliveries::Model,
    raw_body: &[u8],
    secret: &[u8],
    timestamp: i64,
) -> DeliveryOutcome {
    let client = OutboundClient::new(
        "Prompt webhook",
        OutboundPolicy::new(MAX_RESPONSE_BYTES, CONNECT_TIMEOUT),
    );
    let url = match client.validate_endpoint(&delivery.endpoint) {
        Ok(url) => url,
        Err(error) => {
            return DeliveryOutcome::Terminal {
                error: error.to_string(),
            };
        }
    };
    let signature = format!(
        "v1={}",
        infra::outbound_http::hmac_sha256_hex(secret, timestamp, raw_body)
    );
    let headers = [
        (
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        ),
        (
            HeaderName::from_static("x-openobserve-event"),
            HeaderValue::from_str(&delivery.event_type).expect("event type is a header"),
        ),
        (
            HeaderName::from_static("x-openobserve-delivery"),
            HeaderValue::from_str(&delivery.id).expect("generated id is a header"),
        ),
        (
            HeaderName::from_static("x-openobserve-timestamp"),
            HeaderValue::from_str(&timestamp.to_string()).expect("integer timestamp is a header"),
        ),
        (
            HeaderName::from_static("x-openobserve-signature"),
            HeaderValue::from_str(&signature).expect("hex signature is a header"),
        ),
    ]
    .into_iter()
    .collect();
    let body = String::from_utf8(raw_body.to_vec()).expect("JSON serialization is UTF-8");
    let response = match client
        .send(OutboundRequest {
            method: "POST".to_string(),
            url,
            headers,
            body: Some(body),
            timeout: REQUEST_TIMEOUT,
        })
        .await
    {
        Ok(response) => response,
        Err(error) if error.is_retryable() => {
            return DeliveryOutcome::Retry {
                error: error.to_string(),
                retry_after_secs: None,
            };
        }
        Err(error) => {
            return DeliveryOutcome::Terminal {
                error: error.to_string(),
            };
        }
    };
    if response.status.is_success() {
        return DeliveryOutcome::Delivered;
    }
    let error = format!(
        "webhook returned HTTP {}: {}",
        response.status, response.body
    );
    if response.status == http::StatusCode::REQUEST_TIMEOUT
        || response.status == http::StatusCode::TOO_MANY_REQUESTS
        || response.status.is_server_error()
    {
        return DeliveryOutcome::Retry {
            error,
            retry_after_secs: response
                .headers
                .get(header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(retry_after_secs),
        };
    }
    DeliveryOutcome::Terminal { error }
}

#[derive(Debug, PartialEq, Eq)]
enum DeliveryOutcome {
    Delivered,
    Retry {
        error: String,
        retry_after_secs: Option<u64>,
    },
    Terminal {
        error: String,
    },
}

fn retry_delay_secs(attempt: i32, retry_after: Option<u64>) -> u64 {
    let index = usize::try_from(attempt.saturating_sub(1)).unwrap_or(0);
    let cap = RETRY_CAPS_SECS
        .get(index)
        .copied()
        .unwrap_or(MAX_RETRY_DELAY_SECS);
    let jitter = rand::rng().random_range(0..=cap);
    jitter.max(retry_after.unwrap_or(0).min(MAX_RETRY_DELAY_SECS))
}

fn retry_after_secs(value: &str) -> Option<u64> {
    if let Ok(seconds) = value.trim().parse::<u64>() {
        return Some(seconds.min(MAX_RETRY_DELAY_SECS));
    }
    let retry_at = DateTime::parse_from_rfc2822(value)
        .ok()?
        .with_timezone(&Utc);
    let seconds = retry_at
        .signed_duration_since(Utc::now())
        .num_seconds()
        .max(0) as u64;
    Some(seconds.min(MAX_RETRY_DELAY_SECS))
}

fn truncate_error(error: String) -> String {
    const MAX_CHARS: usize = 1_000;
    let mut chars = error.chars();
    let truncated = chars.by_ref().take(MAX_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_after_is_capped_at_one_hour() {
        assert_eq!(retry_after_secs("120"), Some(120));
        assert_eq!(retry_after_secs("7200"), Some(3_600));
        assert_eq!(retry_after_secs("not-a-date"), None);
    }

    #[test]
    fn terminal_errors_are_bounded_for_storage() {
        assert_eq!(truncate_error("short".to_string()), "short");
        let error = truncate_error("x".repeat(1_100));
        assert_eq!(error.chars().count(), 1_001);
        assert!(error.ends_with('…'));
    }

    #[test]
    fn outbound_error_retryability_drives_transport_retries() {
        assert!(OutboundError::Timeout.is_retryable());
        assert!(!OutboundError::Policy("blocked".to_string()).is_retryable());
    }
}
