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

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use config::meta::secret_store::{
    SecretValue,
    external::{
        ExternalSecretBackend, FetchBudget, FetchError, MAX_VALUE_BYTES, Pointer, ResolvedIdentity,
    },
};
use parking_lot::Mutex;
use tokio::{
    sync::{Semaphore, SemaphorePermit},
    time::{Instant as Deadline, timeout_at},
};

const CONCURRENT: usize = 4;
const WAITING: usize = 256;
const BURST: f64 = 20.0;
const RATE: f64 = 10.0;
const COOLDOWN: Duration = Duration::from_secs(30);
const THROTTLED: FetchError = FetchError::Transient {
    reason: "throttled",
};
const TIMEOUT: FetchError = FetchError::Transient { reason: "timeout" };

static BACKENDS: LazyLock<Mutex<BackendLimits>> = LazyLock::new(Default::default);

#[derive(Default)]
struct BackendLimits {
    entries: HashMap<(String, String), Arc<Limits>>,
    next_sweep: Option<Instant>,
}

pub(super) struct Limits {
    capacity: Semaphore,
    active: Semaphore,
    bucket: Mutex<Bucket>,
}

impl Limits {
    pub(super) fn new(now: Instant) -> Self {
        Self {
            capacity: Semaphore::new(CONCURRENT + WAITING),
            active: Semaphore::new(CONCURRENT),
            bucket: Mutex::new(Bucket {
                tokens: BURST,
                last: now,
                consecutive: 0,
                open_until: None,
            }),
        }
    }

    pub(super) fn enter(&self) -> Result<SemaphorePermit<'_>, FetchError> {
        self.capacity.try_acquire().map_err(|_| THROTTLED)
    }

    /// `reached` runs before each provider call, never for an attempt refused locally.
    pub(super) async fn fetch(
        &self,
        provider: &dyn ExternalSecretBackend,
        pointer: &Pointer,
        identity: &ResolvedIdentity,
        mut reached: impl FnMut(),
    ) -> Result<SecretValue, FetchError> {
        let budget = FetchBudget::default();
        let deadline = Deadline::now() + budget.fetch_timeout;
        for attempt in 0..=budget.retry_backoffs.len() {
            let permit = timeout_at(deadline, self.active.acquire())
                .await
                .map_err(|_| THROTTLED)?
                .map_err(|_| THROTTLED)?;
            self.bucket.lock().start(Instant::now())?;
            reached();
            let result = timeout_at(deadline, provider.fetch(pointer, identity, &budget))
                .await
                .unwrap_or(Err(TIMEOUT))
                .and_then(check_size);
            let transient = result.as_ref().is_err_and(FetchError::is_transient);
            self.bucket.lock().finish(transient, Instant::now());
            drop(permit);
            let Some(backoff) = budget.retry_backoffs.get(attempt) else {
                return result;
            };
            let delay = result
                .as_ref()
                .err()
                .and_then(FetchError::retry_after)
                .map_or(*backoff, |wait| wait.max(*backoff));
            if !transient || Deadline::now() + delay >= deadline {
                return result;
            }
            tokio::time::sleep(delay).await;
        }
        unreachable!("the final attempt returns its result")
    }

    #[cfg(test)]
    pub(super) fn open_circuit(&self) {
        self.bucket.lock().open_until = Some(Instant::now() + COOLDOWN);
    }

    #[cfg(test)]
    pub(super) fn fill_queue(&self) -> SemaphorePermit<'_> {
        self.capacity
            .try_acquire_many((CONCURRENT + WAITING) as u32)
            .unwrap()
    }
}

struct Bucket {
    tokens: f64,
    last: Instant,
    consecutive: u8,
    open_until: Option<Instant>,
}

impl Bucket {
    fn start(&mut self, now: Instant) -> Result<(), FetchError> {
        if self.open_until.is_some_and(|deadline| deadline > now) {
            return Err(FetchError::Transient {
                reason: "circuit_open",
            });
        }
        self.open_until = None;
        self.tokens = (self.tokens + now.duration_since(self.last).as_secs_f64() * RATE).min(BURST);
        self.last = now;
        if self.tokens < 1.0 {
            return Err(THROTTLED);
        }
        self.tokens -= 1.0;
        Ok(())
    }

    fn finish(&mut self, transient: bool, now: Instant) {
        if self.open_until.is_some_and(|deadline| now < deadline) {
            return;
        }
        self.consecutive = if transient { self.consecutive + 1 } else { 0 };
        if self.consecutive == 5 {
            self.open_until = Some(now + COOLDOWN);
            self.consecutive = 0;
        }
    }
}

pub(super) fn for_backend(org: &str, backend: &str) -> Arc<Limits> {
    let now = Instant::now();
    let mut backends = BACKENDS.lock();
    if backends.next_sweep.is_none_or(|sweep| now >= sweep) {
        backends.entries.retain(|_, limits| {
            let bucket = limits.bucket.lock();
            Arc::strong_count(limits) > 1
                || bucket.consecutive > 0
                || now.duration_since(bucket.last) < COOLDOWN
                || bucket.open_until.is_some_and(|until| until > now)
        });
        backends.next_sweep = Some(now + COOLDOWN);
    }
    backends
        .entries
        .entry((org.to_owned(), backend.to_owned()))
        .or_insert_with(|| Arc::new(Limits::new(now)))
        .clone()
}

fn check_size(value: SecretValue) -> Result<SecretValue, FetchError> {
    if value.len() > MAX_VALUE_BYTES {
        return Err(FetchError::Invalid {
            reason: "value_too_large",
        });
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn five_consecutive_transients_open_for_thirty_seconds() {
        let now = Instant::now();
        let limits = Limits::new(now);
        let mut bucket = limits.bucket.lock();
        for _ in 0..4 {
            bucket.finish(true, now);
        }
        bucket.finish(false, now);
        for _ in 0..5 {
            bucket.start(now).unwrap();
            bucket.finish(true, now);
        }
        assert_eq!(
            bucket.start(now + COOLDOWN - Duration::from_millis(1)),
            Err(FetchError::Transient {
                reason: "circuit_open"
            })
        );
        bucket.start(now + COOLDOWN).unwrap();
    }

    #[test]
    fn bucket_refills_ten_tokens_per_second() {
        let now = Instant::now();
        let limits = Limits::new(now);
        let mut bucket = limits.bucket.lock();
        for _ in 0..20 {
            bucket.start(now).unwrap();
        }
        assert_eq!(bucket.start(now), Err(THROTTLED));
        bucket.start(now + Duration::from_millis(100)).unwrap();
        assert_eq!(
            bucket.start(now + Duration::from_millis(100)),
            Err(THROTTLED)
        );
    }

    #[tokio::test]
    async fn saturated_backend_queues_256_fills_and_runs_four() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use config::meta::secret_store::external::{BackendKind, VersionSelector};

        struct Delayed(AtomicUsize);
        #[async_trait::async_trait]
        impl ExternalSecretBackend for Delayed {
            fn kind(&self) -> BackendKind {
                BackendKind::AwsSm
            }
            async fn fetch(
                &self,
                _: &Pointer,
                _: &ResolvedIdentity,
                _: &FetchBudget,
            ) -> Result<SecretValue, FetchError> {
                self.0.fetch_add(1, Ordering::SeqCst);
                std::future::pending().await
            }
        }

        let limits = Limits::new(Instant::now());
        let provider = Delayed(AtomicUsize::new(0));
        let pointer = Pointer {
            backend_id: "b".into(),
            locator: "l".into(),
            version_selector: VersionSelector::Latest,
            json_key: None,
        };
        let identity = ResolvedIdentity::Static {
            credential_rev: "rev".into(),
        };
        let mut pending = Vec::new();
        for _ in 0..(CONCURRENT + WAITING) {
            let mut fill = Box::pin(async {
                let _permit = limits.enter()?;
                limits.fetch(&provider, &pointer, &identity, || {}).await
            });
            assert!(futures::poll!(&mut fill).is_pending());
            pending.push(fill);
        }
        assert!(matches!(
            limits.enter(),
            Err(FetchError::Transient {
                reason: "throttled"
            })
        ));
        assert_eq!(provider.0.load(Ordering::SeqCst), 4);
        drop(pending);
        assert!(limits.enter().is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn throttled_retries_wait_for_the_provider_retry_after() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use config::meta::secret_store::external::{BackendKind, VersionSelector};

        struct Throttling {
            calls: AtomicUsize,
            wait: Duration,
        }
        #[async_trait::async_trait]
        impl ExternalSecretBackend for Throttling {
            fn kind(&self) -> BackendKind {
                BackendKind::AzureKv
            }
            async fn fetch(
                &self,
                _: &Pointer,
                _: &ResolvedIdentity,
                _: &FetchBudget,
            ) -> Result<SecretValue, FetchError> {
                if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    return Err(FetchError::Throttled {
                        reason: "provider_unavailable",
                        retry_after: self.wait,
                    });
                }
                Ok(SecretValue::new("v".into()))
            }
        }

        let pointer = Pointer {
            backend_id: "b".into(),
            locator: "l".into(),
            version_selector: VersionSelector::Latest,
            json_key: None,
        };
        let identity = ResolvedIdentity::Static {
            credential_rev: "rev".into(),
        };
        let short = Throttling {
            calls: AtomicUsize::new(0),
            wait: Duration::from_secs(3),
        };
        let started = Deadline::now();
        let limits = Limits::new(Instant::now());
        assert!(
            limits
                .fetch(&short, &pointer, &identity, || {})
                .await
                .is_ok()
        );
        assert!(started.elapsed() >= Duration::from_secs(3));

        let long = Throttling {
            calls: AtomicUsize::new(0),
            wait: Duration::from_secs(60),
        };
        let started = Deadline::now();
        let result = Limits::new(Instant::now())
            .fetch(&long, &pointer, &identity, || {})
            .await;
        assert_eq!(
            result.unwrap_err().retry_after(),
            Some(Duration::from_secs(60))
        );
        assert_eq!(long.calls.load(Ordering::SeqCst), 1);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn value_limit_counts_bytes() {
        for (size, ok) in [(MAX_VALUE_BYTES, true), (MAX_VALUE_BYTES + 1, false)] {
            assert_eq!(check_size(SecretValue::new("x".repeat(size))).is_ok(), ok);
        }
    }
}
