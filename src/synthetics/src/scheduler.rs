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

//! Synthetics scheduler — queries `synthetics_checks` directly for due synthetics
//! and fans each one out into `synthetics_jobs`.
//!
//! Runs every 5 seconds on scheduler nodes. For each synthetic whose
//! `next_run_at <= now AND enabled = true` the scheduler:
//!   1. Generates a KSUID `run_id` and inserts a `synthetics_runs` row.
//!   2. Inserts one `synthetics_jobs` row per location (not per device). For browser synthetics,
//!      all engine+device combos are packed as JSON in `browser_devices`, each with a pre-generated
//!      KSUID `execution_id`.
//!   3. Advances `next_run_at` on the synthetic.

use std::time::Duration;

use config::{
    meta::synthetics::{SyntheticFrequency, SyntheticFrequencyType, SyntheticType},
    utils::hash::{Sum64, fnv},
};
use infra::{
    db::get_orm_client_rw,
    table::{synthetics_checks, synthetics_jobs, synthetics_locations, synthetics_runs},
};
use serde::Serialize;
use svix_ksuid::KsuidLike as _;

const TICK: Duration = Duration::from_secs(5);
/// Max synthetics to pull per tick.
const FETCH_LIMIT: u64 = 500;

/// Wire format for one engine+device combo inside `browser_devices` JSON.
#[derive(Serialize)]
struct BrowserDeviceEntry<'a> {
    execution_id: String,
    engine: &'a str,
    device: &'a str,
}

pub async fn run() {
    tracing::info!("[synthetics scheduler] started");

    loop {
        tokio::time::sleep(TICK).await;

        let db = get_orm_client_rw().await;

        let now_us = config::utils::time::now_micros();

        // Read per tick, so the kill switch takes effect on a config reload
        // rather than at the next restart.
        let jitter_enabled = config::get_config().synthetics.scheduler_jitter_enabled;

        // Claim and advance in ONE locked pass, then fan out below.
        //
        // `claim_due` locks each due row with FOR UPDATE SKIP LOCKED and
        // advances its schedule inside the same transaction, so a second
        // scheduler node skips the rows this one holds and picks up *different*
        // due checks instead — the replicas self-shard, which is what
        // `designs/synthetics/01-server-architecture.md` §4.2 specifies. Every
        // check returned here is already ours; nothing below needs to re-check.
        let synthetics = match synthetics_checks::claim_due(db, now_us, FETCH_LIMIT, |c| {
            compute_next_run_at(
                &c.frequency,
                c.next_run_at,
                now_us,
                c.tz_offset,
                &c.id,
                jitter_enabled,
            )
        })
        .await
        {
            Ok(m) => m,
            Err(e) => {
                tracing::error!("[synthetics scheduler] claim_due: {e}");
                continue;
            }
        };

        for synthetic in synthetics {
            // The SLOT that made this check due — not the tick that noticed it.
            //
            // `synthetics_jobs_dedup_uq (synthetics_id, location, scheduled_ts)`
            // plus `ON CONFLICT DO NOTHING` exist to make enqueue idempotent, as
            // the design specifies. Stamping `now_us` defeated them completely:
            // every scheduler has its own wall clock at its own tick, so two
            // nodes wrote two different `scheduled_ts` values, never collided,
            // and the constraint never fired. The slot is byte-identical on
            // every node, which is what makes the index a real backstop behind
            // the claim in `claim_due`.
            //
            // It is also the more honest number: queue delay is
            // `started_ts - scheduled_ts`, and against `now_us` that silently
            // excluded up to a full TICK of scheduler lag.
            //
            // `claim_due` maps its rows BEFORE advancing the schedule, so this
            // is the pre-advance value — the slot, not the next one.
            //
            // Falls back to `now_us` when there is no slot: `run_synthetic_now`
            // and re-enable both set `next_run_at = 0` to make a check due
            // immediately (`service.rs:519`, `:389`), and stamping 0 would date
            // the run to the epoch and report a ~56-year queue delay. Dedup does
            // not suffer — `claim_due` has already granted this slot to exactly
            // one node, so the unique index is only a backstop here.
            let scheduled_ts = dedup_slot(synthetic.next_run_at, now_us);

            // `valid_until` stays anchored to NOW, deliberately. Anchoring it to
            // the slot would make a catch-up run after scheduler downtime expire
            // the instant it was created — the TTL is "how long this job stays
            // worth running from the moment it was queued", not "how late it is".
            let valid_until = now_us + synthetic.frequency.interval_secs() * 1_000_000;

            // One job per location; browser_devices JSON carries per-device execution_ids.
            let job_count = synthetic.locations.len() as i32;
            if job_count == 0 {
                tracing::warn!(
                    synthetics_id = %synthetic.id,
                    "[synthetics scheduler] synthetic has no locations — skipping"
                );
                continue;
            }

            // Pre-generate run_id and insert the runs row before any jobs.
            let run_id = svix_ksuid::Ksuid::new(None, None).to_string();
            tracing::info!(
                synthetics_id = %synthetic.id,
                run_id = %run_id,
                job_count = job_count,
                "[synthetics scheduler] firing synthetic"
            );

            if let Err(e) = synthetics_runs::insert_run(
                db,
                synthetics_runs::InsertRunParams {
                    id: &run_id,
                    synthetics_id: &synthetic.id,
                    org_id: &synthetic.org_id,
                    scheduled_ts,
                    trigger_type: "schedule",
                    job_count,
                    created_at: now_us,
                },
            )
            .await
            {
                tracing::error!(
                    synthetics_id = %synthetic.id,
                    run_id = %run_id,
                    "[synthetics scheduler] insert_run: {e}"
                );
                continue;
            }

            let metadata_json = serde_json::to_string(&synthetics_jobs::JobMetadata {
                tags: synthetic.tags.clone(),
                synthetic_type: serde_json::to_value(&synthetic.check_type)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .unwrap_or_default(),
            })
            .unwrap_or_else(|_| "{}".to_string());

            for location in &synthetic.locations {
                let (pool, browser_devices_json) = if synthetic.check_type == SyntheticType::Browser
                {
                    let entries: Vec<BrowserDeviceEntry> = synthetic
                        .browser_devices
                        .iter()
                        .map(|bd| BrowserDeviceEntry {
                            execution_id: svix_ksuid::Ksuid::new(None, None).to_string(),
                            engine: &bd.browser,
                            device: &bd.device,
                        })
                        .collect();
                    let json = match serde_json::to_string(&entries) {
                        Ok(j) => j,
                        Err(e) => {
                            tracing::error!(
                                synthetics_id = %synthetic.id,
                                run_id = %run_id,
                                location = %location,
                                "[synthetics scheduler] browser_devices serialize: {e}"
                            );
                            continue;
                        }
                    };
                    // Private browser locations are served by a self-hosted
                    // browser agent leasing their own private-* pool; public
                    // browser locations use the aws-browser Lambda venue.
                    let pool = match synthetics_locations::get(location).await {
                        Ok(Some(l)) if l.kind == synthetics_locations::KIND_PRIVATE => l.pool,
                        _ => "aws-browser".to_string(),
                    };
                    (pool, Some(json))
                } else {
                    // Protocol types route to the location's pool from the
                    // registry (net-<region> for public rows, private-* for
                    // private locations); "aws" is the legacy fallback for
                    // locations not yet in the table.
                    let pool = match synthetics_locations::get(location).await {
                        Ok(Some(l)) => l.pool,
                        _ => "aws".to_string(),
                    };
                    (pool, None)
                };

                let p = synthetics_jobs::EnqueueParams {
                    synthetics_id: &synthetic.id,
                    synthetics_name: &synthetic.name,
                    org_id: &synthetic.org_id,
                    location,
                    pool: &pool,
                    scheduled_ts,
                    valid_until,
                    run_id: &run_id,
                    browser_devices: browser_devices_json.as_deref(),
                    metadata: &metadata_json,
                };
                match synthetics_jobs::enqueue(db, p).await {
                    Ok(job_id) if !job_id.is_empty() => {
                        tracing::info!(
                            synthetics_id = %synthetic.id,
                            run_id = %run_id,
                            job_id = %job_id,
                            location = %location,
                            "[synthetics scheduler] job enqueued"
                        );
                    }
                    Ok(_) => {} // ON CONFLICT DO NOTHING — already scheduled
                    Err(e) => {
                        tracing::error!(
                            synthetics_id = %synthetic.id,
                            run_id = %run_id,
                            location = %location,
                            "[synthetics scheduler] enqueue: {e}"
                        );
                    }
                }
            }
        }
    }
}

/// Compute a check's next run time, anchored to its SCHEDULED time (`anchor`,
/// i.e. the `next_run_at` that made it due) rather than the tick time (`now_us`).
///
/// Anchoring to `now_us` would re-add the scheduler's tick + fetch lag on every
/// cycle, so the effective interval became `configured + lag` and run times
/// drifted ever later with irregular gaps (fixed-delay). Anchoring to the
/// scheduled time keeps the cadence fixed-rate (12:00, 12:01, 12:02, …) ± the
/// tick granularity, with no accumulating drift.
///
/// If the anchored slot is already in the past — the scheduler fell behind
/// (paused / backlog), or a cron slot after the anchor already passed — skip the
/// missed slots forward to the next slot strictly after `now_us`, so the check
/// fires once and re-anchors instead of firing a catch-up burst. Falls back to a
/// `now`-anchored slot if the frequency can't compute (e.g. invalid cron, which
/// is prevented by create/update validation).
/// The `scheduled_ts` stamped on a run and its jobs: the slot that made the
/// check due, falling back to `now_us` when there is no slot.
///
/// Every node must derive the SAME value for a given slot — that is what makes
/// `synthetics_jobs_dedup_uq (synthetics_id, location, scheduled_ts)` a real
/// backstop rather than a constraint that never fires.
fn dedup_slot(next_run_at: i64, now_us: i64) -> i64 {
    if next_run_at > 0 { next_run_at } else { now_us }
}

/// Deterministic sub-interval offset for a check, in microseconds.
///
/// Keyed off the check id alone, so every node and restart computes the same
/// value. Load-bearing: the result lands in `next_run_at`, which becomes the
/// `scheduled_ts` feeding `synthetics_jobs_dedup_uq`. A random or per-node
/// offset would make two nodes write different slots for one check, so they
/// would never collide and the duplicate-enqueue backstop would be gone.
///
/// FNV-1a, not `DefaultHasher` (unstable across Rust versions), not `ahash`
/// (randomly seeded per process), not `config::utils::hash::sum64` (gxhash,
/// which falls back to `DefaultHasher` when the feature is off). Changing the
/// hash re-spreads every existing check once; the golden test pins it.
fn jitter_offset_us(synthetics_id: &str, interval_secs: i64) -> i64 {
    if interval_secs <= 0 {
        return 0;
    }
    // A malformed frequency could overflow the microsecond conversion, which
    // panics in debug. This runs inside the claim transaction, so one bad row
    // must not take the scheduler down: treat it as "no jitter".
    let Some(window_us) = interval_secs.checked_mul(1_000_000) else {
        return 0;
    };
    let h = fnv::new().sum64(synthetics_id);
    (h % (window_us as u64)) as i64
}

fn compute_next_run_at(
    freq: &SyntheticFrequency,
    anchor: i64,
    now_us: i64,
    tz_offset: i32,
    synthetics_id: &str,
    jitter_enabled: bool,
) -> i64 {
    let raw = match freq.next_run_at(anchor, tz_offset) {
        // Anchored slot is still in the future — use it as-is (no drift).
        Ok(t) if t > now_us => t,
        // Behind, or cron slot after the anchor already passed — skip forward to
        // the next slot strictly after now (fire once, re-anchor).
        Ok(_) => freq
            .next_run_at(now_us, tz_offset)
            .unwrap_or_else(|_| now_us + freq.interval_secs().max(5) * 1_000_000),
        Err(_) => now_us + freq.interval_secs().max(5) * 1_000_000,
    };

    if !jitter_enabled {
        return raw;
    }
    // A cron slot is a user-stated wall-clock instant: `0 * * * * *` means "on
    // the minute", and shifting it by a hash would break that promise. It is
    // also the divide-by-zero trap — `interval_secs()` is 0 for cron.
    if freq.frequency_type == SyntheticFrequencyType::Cron {
        return raw;
    }
    let interval_secs = freq.interval_secs();
    if interval_secs <= 0 {
        return raw;
    }
    let Some(interval_us) = interval_secs.checked_mul(1_000_000) else {
        return raw;
    };
    let offset = jitter_offset_us(synthetics_id, interval_secs);

    // Snap onto the check's absolute grid (`k * interval + offset`) rather than
    // returning `raw + offset` — that is the difference between jitter and
    // drift. `raw` is `anchor + interval` where `anchor` is the stored
    // `next_run_at`, so adding the offset would bake it into the next cycle's
    // anchor and re-add it every cycle.
    //
    // Snapping is idempotent (on-grid maps to itself, so the steady state is a
    // pure `+ interval`) and self-healing for the writers that bypass this
    // function and store an un-jittered value: `update_synthetic` and `create`
    // with an explicit `start`.
    let mut next = (raw - offset).div_euclid(interval_us) * interval_us + offset;
    // Snapping rounds down, so it can land at or before now; bounded by
    // `offset < interval`, so one interval is always enough.
    if next <= now_us {
        next += interval_us;
    }
    next
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use config::meta::synthetics::{SyntheticFrequency, SyntheticFrequencyType};

    use super::{compute_next_run_at, dedup_slot, jitter_offset_us};

    fn freq(t: SyntheticFrequencyType, interval: i64, cron: &str) -> SyntheticFrequency {
        SyntheticFrequency {
            frequency_type: t,
            interval,
            cron: cron.to_string(),
            timezone: None,
        }
    }

    /// A KSUID-shaped check id, used wherever a test needs *an* id but does not
    /// care which one. Real `synthetics_checks.id` values are 27-char base62
    /// KSUIDs, so tests exercise the hash over the shape it sees in production.
    const ID: &str = "2iRXmH4pQ7bLtVzKcN9sYdFgWjE";

    /// Deterministic KSUID-shaped id generator — an LCG, not an RNG, so the
    /// whole suite is reproducible byte-for-byte on every run and every machine.
    /// Jitter tests must never depend on randomness: the property under test IS
    /// determinism.
    fn ksuid_like(i: u64) -> String {
        const A: u64 = 6364136223846793005;
        const C: u64 = 1442695040888963407;
        const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        let mut x = i.wrapping_mul(A).wrapping_add(C);
        let mut s = String::with_capacity(27);
        for _ in 0..27 {
            x = x.wrapping_mul(A).wrapping_add(C);
            s.push(ALPHABET[((x >> 33) % 62) as usize] as char);
        }
        s
    }

    #[test]
    fn compute_interval_seconds() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Seconds, 30, "");
        assert_eq!(f.next_run_at(now, 0).unwrap(), now + 30_000_000);
    }

    #[test]
    fn compute_interval_minutes() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Minutes, 5, "");
        assert_eq!(f.next_run_at(now, 0).unwrap(), now + 300_000_000);
    }

    #[test]
    fn compute_interval_hours() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Hours, 1, "");
        assert_eq!(f.next_run_at(now, 0).unwrap(), now + 3_600_000_000);
    }

    #[test]
    fn compute_cron_empty_errors() {
        let now = 1_000_000_000_000i64;
        let f = freq(SyntheticFrequencyType::Cron, 0, "");
        assert!(f.next_run_at(now, 0).is_err());
    }

    #[test]
    fn compute_cron_valid() {
        let now_us = 1_000_000_000_000_000i64; // 2001-09-08T21:46:40Z
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *"); // every minute
        let next = f.next_run_at(now_us, 0).unwrap();
        assert!(next > now_us, "next_run_at must be in the future");
        assert!(
            next - now_us <= 120_000_000,
            "next should be within 2 minutes"
        );
    }

    // ── compute_next_run_at: anchoring + skip-missed (the trigger-drift fix) ──

    const MIN_US: i64 = 60_000_000;

    /// On-time cycle: the check fired a little late (now = anchor + 3s tick lag),
    /// but the next run must be anchored to the SCHEDULED time (anchor + 60s),
    /// NOT to now (which would be anchor + 63s → drift).
    #[test]
    fn anchors_to_scheduled_time_not_tick_time() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_000_000_000_000i64; // scheduled due time
        let now = anchor + 3_000_000; // picked up 3s late
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert_eq!(next, anchor + MIN_US, "must anchor to scheduled time");
        assert_ne!(next, now + MIN_US, "must NOT anchor to tick time (drift)");
    }

    /// Repeated cycles never drift: feed each computed next back as the anchor,
    /// with a fresh (varying) tick lag each time — the schedule stays exactly on
    /// the original 1-minute grid.
    #[test]
    fn no_cumulative_drift_across_cycles() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let start = 1_000_000_000_000i64;
        let mut anchor = start;
        for i in 1..=20 {
            let lag = (i % 5) * 1_000_000; // 0..4s of jitter, varies per cycle
            let now = anchor + lag;
            anchor = compute_next_run_at(&f, anchor, now, 0, ID, false);
            assert_eq!(
                anchor,
                start + i * MIN_US,
                "cycle {i} must stay on the fixed grid, no drift"
            );
        }
    }

    /// Skip-missed: scheduler was down long enough that the anchored slot is in
    /// the past — must jump to a single future slot (fire once, re-anchor), NOT
    /// return anchor+interval (still in the past → would burst).
    #[test]
    fn skips_missed_slots_when_behind() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_000_000_000_000i64;
        let now = anchor + 5 * MIN_US + 12_000_000; // ~5 missed minutes + 12s
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert!(next > now, "must be in the future (fire once, not a burst)");
        assert_ne!(
            next,
            anchor + MIN_US,
            "must skip missed slots, not anchor+1"
        );
    }

    /// Cron on-time: anchored slot is in the future → returned as-is.
    #[test]
    fn cron_anchors_forward() {
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *"); // every minute
        let anchor = 1_000_000_000_000_000i64;
        let now = anchor + 2_000_000; // 2s late
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert!(next > now);
        assert!(next - anchor <= 120_000_000);
    }

    /// Cron behind: the slot after the anchor already passed → skip to the next
    /// slot strictly after now.
    #[test]
    fn cron_skips_missed_when_behind() {
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *");
        let anchor = 1_000_000_000_000_000i64;
        let now = anchor + 10 * MIN_US; // 10 minutes behind
        let next = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert!(next > now, "must be after now");
        assert!(
            next - now <= 120_000_000,
            "next slot within ~a minute of now"
        );
    }

    /// Invalid frequency (empty cron) → defensive fallback to a future slot.
    #[test]
    fn invalid_cron_falls_back_to_future() {
        let f = freq(SyntheticFrequencyType::Cron, 0, ""); // errors in next_run_at
        let now = 1_000_000_000_000i64;
        let next = compute_next_run_at(&f, now, now, 0, ID, false);
        assert!(next > now, "fallback must still be in the future");
    }

    /// The dedup key must be the SLOT, so every node computes the same value.
    ///
    /// `synthetics_jobs_dedup_uq (synthetics_id, location, scheduled_ts)` +
    /// `ON CONFLICT DO NOTHING` are the design's idempotent enqueue. Stamping
    /// each node's own tick clock meant two schedulers never collided and the
    /// constraint never fired — present in the schema, inert in practice.
    #[test]
    fn scheduled_ts_is_the_slot_not_the_tick() {
        let slot = 1_750_000_000_000_000i64;
        // Two nodes notice the same slot 4s apart. Both must derive the SAME key.
        for tick_lag in [0i64, 1_000_000, 4_000_000] {
            let now_us = slot + tick_lag;
            let scheduled_ts = dedup_slot(slot, now_us);
            assert_eq!(
                scheduled_ts, slot,
                "tick lag {tick_lag} must not change the dedup key"
            );
        }
    }

    /// `run_synthetic_now` and re-enable set `next_run_at = 0` to fire at once.
    /// Using that verbatim would date the run to the epoch and report a ~56-year
    /// queue delay, since queue delay is `started_ts - scheduled_ts`.
    #[test]
    fn scheduled_ts_falls_back_to_now_when_there_is_no_slot() {
        let now_us = 1_750_000_000_000_000i64;
        let no_slot = 0i64;
        let scheduled_ts = dedup_slot(no_slot, now_us);
        assert_eq!(
            scheduled_ts, now_us,
            "a manual run is scheduled for now, not 1970"
        );
    }

    // ── jitter_offset_us: deterministic per-check spread (P1-2) ──────────────
    //
    // Without jitter every check of a given frequency becomes due in the same
    // tick, so a thousand 1-minute checks fan out into a thousand simultaneous
    // Lambda invocations, every minute. The offset spreads them across the
    // interval — but it MUST stay a pure function of the check id, because
    // `scheduled_ts` feeds `synthetics_jobs_dedup_uq` and a per-node or random
    // offset would make two nodes write different slots for the same check.

    /// The offset is a pure function of (id, interval): no clock, no RNG, no
    /// per-process seed. Everything else in this feature rests on this — a value
    /// that varies between calls varies between scheduler nodes, and then
    /// `synthetics_jobs_dedup_uq` never fires.
    #[test]
    fn jitter_offset_is_deterministic_across_calls() {
        let sixty = jitter_offset_us(ID, 60);
        let three_hundred = jitter_offset_us(ID, 300);
        for i in 0..1000 {
            assert_eq!(
                jitter_offset_us(ID, 60),
                sixty,
                "call {i} must return the same offset"
            );
            assert_eq!(
                jitter_offset_us(ID, 300),
                three_hundred,
                "call {i} must return the same offset"
            );
        }
    }

    /// Spec §3.3: the offset lives in `[0, interval)`. An offset that reached
    /// `interval` would push the check past its *next* slot — i.e. silently skip
    /// a run — and a negative one would schedule it in the past.
    #[test]
    fn jitter_offset_is_within_the_interval_window() {
        for interval_secs in [1i64, 30, 60, 300, 3_600, 86_400] {
            let window_us = interval_secs * 1_000_000;
            for i in 0..500u64 {
                let id = ksuid_like(i);
                let offset = jitter_offset_us(&id, interval_secs);
                assert!(
                    offset >= 0,
                    "offset must never be negative: id={id} interval={interval_secs}s offset={offset}"
                );
                assert!(
                    offset < window_us,
                    "offset must stay inside the window: id={id} interval={interval_secs}s offset={offset}"
                );
            }
        }
    }

    /// The test that proves the feature actually works: 10 000 checks on a
    /// 1-minute frequency must land roughly evenly across the 60 seconds of the
    /// minute, not pile up in a few buckets. A uniform hash gives ~1.67% per
    /// bucket; anything over ~4% means the spread is lumpy and the thundering
    /// herd is only partly broken. Every bucket must also be used — an unused
    /// second is a second of capacity the spread never reaches.
    #[test]
    fn jitter_offset_spreads_evenly_across_the_window() {
        const N: usize = 10_000;
        const BUCKETS: usize = 60;
        let mut hist = [0usize; BUCKETS];
        for i in 0..N as u64 {
            let offset = jitter_offset_us(&ksuid_like(i), 60);
            hist[(offset / 1_000_000) as usize] += 1;
        }
        let cap = N * 4 / 100; // ~4% ceiling; uniform is ~1.67%
        for (second, &count) in hist.iter().enumerate() {
            assert!(
                count > 0,
                "second {second} of the minute got no checks — spread has holes"
            );
            assert!(
                count <= cap,
                "second {second} holds {count} of {N} checks (> {cap}) — spread is lumpy"
            );
        }
    }

    /// GOLDEN TEST — do not "fix" this by updating the numbers.
    ///
    /// Pins the exact hash. Swapping it silently re-spreads every existing
    /// check, and mid-deploy two nodes on different builds would disagree about
    /// `scheduled_ts`, so the dedup index stops firing. A deliberate change here
    /// means a one-time re-spread of the whole fleet — say so in the PR.
    #[test]
    fn jitter_offset_golden_values_pin_the_hash() {
        // FNV-1a("2iRXmH4pQ7bLtVzKcN9sYdFgWjE") = 634995206104941817
        assert_eq!(
            jitter_offset_us("2iRXmH4pQ7bLtVzKcN9sYdFgWjE", 60),
            4_941_817
        );
        assert_eq!(
            jitter_offset_us("2iRXmH4pQ7bLtVzKcN9sYdFgWjE", 300),
            4_941_817
        );

        // FNV-1a("2fN1kQ8ZtYvPbXwLdM3rGh7sJcA") = 9980322736069499633
        assert_eq!(
            jitter_offset_us("2fN1kQ8ZtYvPbXwLdM3rGh7sJcA", 60),
            49_499_633
        );
        assert_eq!(
            jitter_offset_us("2fN1kQ8ZtYvPbXwLdM3rGh7sJcA", 300),
            169_499_633
        );

        // FNV-1a("1hVqB6xTnR4mKdW9zPsLcYfJgE2") = 13330849846794661402
        assert_eq!(
            jitter_offset_us("1hVqB6xTnR4mKdW9zPsLcYfJgE2", 60),
            54_661_402
        );
        assert_eq!(
            jitter_offset_us("1hVqB6xTnR4mKdW9zPsLcYfJgE2", 300),
            294_661_402
        );
    }

    /// `interval_secs()` returns 0 for cron and could be non-positive for a
    /// malformed frequency. The offset is `hash % (interval_secs * 1_000_000)`,
    /// so an unguarded 0 is a divide-by-zero panic inside the scheduler's claim
    /// transaction — one bad row would take the whole scheduler down.
    #[test]
    fn jitter_offset_is_zero_for_non_positive_interval() {
        assert_eq!(
            jitter_offset_us(ID, 0),
            0,
            "cron yields interval_secs() == 0"
        );
        assert_eq!(jitter_offset_us(ID, -1), 0);
        assert_eq!(jitter_offset_us("", 0), 0);
    }

    // ── compute_next_run_at with jitter ──────────────────────────────────────

    /// The jittered run lands on the check's OWN grid — `k * interval + offset`
    /// — and never further than one interval away from now. `next % interval ==
    /// offset` is exactly "inside `[slot, slot + interval)`" with the slot being
    /// the grid cell the run falls in.
    #[test]
    fn jittered_run_lands_on_the_checks_own_grid_slot() {
        let f = freq(SyntheticFrequencyType::Minutes, 5, "");
        let interval_us = 300 * 1_000_000i64;
        let anchor = 1_750_000_000_000_000i64;
        let now = anchor + 3_000_000; // 3s tick lag, the check is due
        let offset = jitter_offset_us(ID, 300);

        let next = compute_next_run_at(&f, anchor, now, 0, ID, true);

        assert_eq!(
            next.rem_euclid(interval_us),
            offset,
            "run must sit exactly `offset` into its grid slot"
        );
        assert!(next > now, "next run must be strictly in the future");
        assert!(
            next - now <= interval_us,
            "jitter must never delay a run by more than one interval"
        );
    }

    /// Cron is a user-stated wall-clock instant: `0 * * * * *` means "on the
    /// minute", and shifting it by a hash would break that promise (spec §3.3).
    /// It is also the divide-by-zero trap — `interval_secs()` is 0 for cron, so
    /// any `% (interval_secs * 1_000_000)` reached by a cron frequency panics.
    #[test]
    fn cron_is_never_jittered() {
        // Valid cron: interval_secs() == 0, so this also proves no divide-by-zero.
        let f = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *");
        assert_eq!(
            f.interval_secs(),
            0,
            "cron has no interval to jitter within"
        );
        let anchor = 1_000_000_000_000_000i64;
        let now = anchor + 2_000_000;
        let jittered = compute_next_run_at(&f, anchor, now, 0, ID, true);
        let plain = compute_next_run_at(&f, anchor, now, 0, ID, false);
        assert_eq!(
            jittered, plain,
            "cron must be byte-identical with jitter on and off"
        );
        assert_eq!(
            jittered % 60_000_000,
            0,
            "`0 * * * * *` must still fire exactly on the minute"
        );

        // Invalid cron: next_run_at errors, interval_secs() is still 0 — the
        // fallback path must not reach a modulo either.
        let bad = freq(SyntheticFrequencyType::Cron, 0, "");
        let now = 1_000_000_000_000i64;
        assert_eq!(
            compute_next_run_at(&bad, now, now, 0, ID, true),
            compute_next_run_at(&bad, now, now, 0, ID, false),
            "the invalid-cron fallback must not be jittered (and must not panic)"
        );
    }

    /// The kill switch (`ZO_SYNTHETICS_SCHEDULER_JITTER_ENABLED=false`) must
    /// restore today's behaviour exactly — not approximately. These literals are
    /// the values the pre-jitter tests above assert, repeated here so the switch
    /// is pinned independently of them.
    #[test]
    fn jitter_disabled_is_byte_identical_to_today() {
        // Interval, on time: anchored to the scheduled time, not the tick.
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_000_000_000_000i64;
        assert_eq!(
            compute_next_run_at(&f, anchor, anchor + 3_000_000, 0, ID, false),
            1_000_060_000_000,
        );

        // Interval, behind: skip the missed slots, re-anchor on now.
        let behind = anchor + 5 * MIN_US + 12_000_000;
        assert_eq!(
            compute_next_run_at(&f, anchor, behind, 0, ID, false),
            behind + MIN_US,
        );

        // Cron, on time: the next stated wall-clock instant.
        let c = freq(SyntheticFrequencyType::Cron, 0, "0 * * * * *");
        let cron_anchor = 1_000_000_000_000_000i64;
        assert_eq!(
            compute_next_run_at(&c, cron_anchor, cron_anchor + 2_000_000, 0, ID, false),
            1_000_000_020_000_000,
        );

        // Invalid cron: defensive `now + 5s` fallback.
        let bad = freq(SyntheticFrequencyType::Cron, 0, "");
        assert_eq!(
            compute_next_run_at(&bad, anchor, anchor, 0, ID, false),
            1_000_005_000_000,
        );
    }

    /// `run_synthetic_now` and re-enable set `next_run_at = 0` so the check is
    /// due on the very next tick (`service.rs:519`, `:389`). Jitter must not
    /// turn "run it now" into "run it up to a whole interval from now" — a user
    /// pressing Run would sit watching nothing happen for a minute.
    #[test]
    fn run_now_anchor_zero_still_fires_promptly() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let now = 1_750_000_000_000_000i64;
        let next = compute_next_run_at(&f, 0, now, 0, ID, true);
        assert!(next > now, "must be strictly in the future");
        assert!(
            next - now <= MIN_US,
            "an explicitly-triggered run must not be pushed out a whole interval"
        );
        assert_eq!(
            next.rem_euclid(MIN_US),
            jitter_offset_us(ID, 60),
            "and it must still land on the check's grid"
        );
    }

    /// THE dedup guarantee. Two nodes see the same check at the same slot but on
    /// their own clocks, up to a TICK apart, and must compute a byte-identical
    /// next slot — that value becomes `scheduled_ts`, and
    /// `synthetics_jobs_dedup_uq` + `ON CONFLICT DO NOTHING` is the last
    /// backstop against duplicate dispatch. If this regresses the two nodes
    /// never collide and that backstop is silently gone.
    #[test]
    fn two_scheduler_nodes_compute_the_same_next_slot() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        // Steady state: the stored slot is already on this check's grid.
        let seed = 1_750_000_000_000_000i64;
        let slot = compute_next_run_at(&f, seed, seed, 0, ID, true);

        let node_a = compute_next_run_at(&f, slot, slot, 0, ID, true);
        let node_b = compute_next_run_at(&f, slot, slot + 1_000_000, 0, ID, true);
        let node_c = compute_next_run_at(&f, slot, slot + 4_000_000, 0, ID, true);

        assert_eq!(node_a, node_b, "1s of tick lag must not change the slot");
        assert_eq!(node_a, node_c, "4s of tick lag must not change the slot");
        assert_eq!(node_a, slot + MIN_US, "and the slot is the next grid point");
    }

    /// Jitter changes the VALUE of `next_run_at`, never the SHAPE of the dedup
    /// key: `dedup_slot` still hands back the stored slot verbatim, so the tuple
    /// `(synthetics_id, location, scheduled_ts)` is the same tuple it was, and
    /// the unique index still suppresses a second enqueue for the same slot.
    /// Modelled with a set rather than a database so the test stays pure.
    #[test]
    fn jitter_does_not_change_the_shape_of_the_dedup_key() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let seed = 1_750_000_000_000_000i64;
        let jittered_slot = compute_next_run_at(&f, seed, seed, 0, ID, true);
        assert_ne!(
            jittered_slot.rem_euclid(MIN_US),
            0,
            "precondition: this check's slot really is off the round minute"
        );

        // A jittered slot flows through `dedup_slot` unchanged, whatever the tick.
        for tick_lag in [0i64, 1_000_000, 4_000_000] {
            assert_eq!(
                dedup_slot(jittered_slot, jittered_slot + tick_lag),
                jittered_slot,
                "the jittered slot IS the dedup key"
            );
        }

        // `ON CONFLICT DO NOTHING`: the second insert of the same tuple is a no-op.
        let mut index: HashSet<(&str, &str, i64)> = HashSet::new();
        let key = (ID, "us-east-1", dedup_slot(jittered_slot, jittered_slot));
        assert!(index.insert(key), "first enqueue wins");
        assert!(
            !index.insert(key),
            "second enqueue for the same slot is dropped"
        );
        // A different location is a different job, not a duplicate.
        assert!(index.insert((ID, "eu-west-1", key.2)));
    }

    /// The acceptance criterion: 100 checks on the same 1-minute frequency must
    /// no longer fire in the same second. Before jitter the answer here was 1 —
    /// every check due at `:00`, one spike per minute into the dispatcher.
    #[test]
    fn distinct_checks_spread_across_the_minute() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let anchor = 1_750_000_000_000_000i64;
        let now = anchor + 3_000_000;

        let seconds: HashSet<i64> = (0..100u64)
            .map(|i| {
                let id = ksuid_like(i);
                let next = compute_next_run_at(&f, anchor, now, 0, &id, true);
                (next / 1_000_000) % 60
            })
            .collect();

        assert!(
            seconds.len() > 45,
            "100 same-frequency checks must span > 45 distinct seconds, got {}",
            seconds.len()
        );
    }

    // ── jitter must not become drift ─────────────────────────────────────────

    /// The failure mode this feature is one line away from: returning
    /// `anchor + interval + offset` bakes the offset into the next cycle's
    /// anchor and re-adds it every cycle, so the check slides later forever.
    /// Snapping onto the absolute grid is idempotent, so the gap stays exactly
    /// the interval.
    #[test]
    fn no_cumulative_drift_across_cycles_with_jitter() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let offset = jitter_offset_us(ID, 60);
        let mut anchor = 1_000_000_000_000i64;
        let mut grid_start = 0i64;
        let mut prev = 0i64;

        for i in 1..=20 {
            let lag = (i % 5) * 1_000_000; // 0..4s of tick lag, varies per cycle
            let now = anchor + lag;
            let next = compute_next_run_at(&f, anchor, now, 0, ID, true);

            assert_eq!(
                next.rem_euclid(MIN_US),
                offset,
                "cycle {i} must stay on the check's jittered grid"
            );
            if i == 1 {
                grid_start = next;
            } else {
                assert_eq!(
                    next - prev,
                    MIN_US,
                    "cycle {i}: gap must be exactly the interval — jitter is not re-added"
                );
                assert_eq!(
                    next,
                    grid_start + (i - 1) * MIN_US,
                    "cycle {i} must stay on the fixed grid, no accumulated drift"
                );
            }
            prev = next;
            anchor = next;
        }
    }

    /// Idempotence, stated directly: an anchor that is already on the grid
    /// advances by exactly one interval and by nothing else. This is what makes
    /// the steady state drift-free.
    #[test]
    fn jitter_is_idempotent_on_an_on_grid_anchor() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let offset = jitter_offset_us(ID, 60);
        let anchor = 29_166_666 * MIN_US + offset; // on-grid by construction
        let now = anchor + 3_000_000;
        assert_eq!(
            compute_next_run_at(&f, anchor, now, 0, ID, true),
            anchor + MIN_US,
            "an on-grid anchor must advance by exactly one interval"
        );
    }

    /// Self-healing. Two writers bypass `compute_next_run_at` entirely and store
    /// an un-jittered `next_run_at`: `update_synthetic` writes a raw
    /// `frequency.next_run_at(now)` (`service.rs:236-242`) and `create` writes
    /// `check.start` (`synthetics_checks.rs:312`). Both land off the check's
    /// grid; the next scheduler pass must pull them back onto it, so an edited
    /// check does not stay unspread forever.
    #[test]
    fn off_grid_anchor_is_pulled_onto_the_grid_in_one_pass() {
        let f = freq(SyntheticFrequencyType::Minutes, 1, "");
        let offset = jitter_offset_us(ID, 60);

        // What `update_synthetic` stores: now + interval, no jitter.
        let edited_at = 1_000_000_000_000i64;
        let anchor = f.next_run_at(edited_at, 0).unwrap();
        assert_ne!(
            anchor.rem_euclid(MIN_US),
            offset,
            "precondition: the stored anchor really is off the grid"
        );

        // The check comes due at that anchor and the scheduler picks it up 2s late.
        let now = anchor + 2_000_000;
        let next = compute_next_run_at(&f, anchor, now, 0, ID, true);
        assert_eq!(
            next.rem_euclid(MIN_US),
            offset,
            "one pass must snap the check onto its grid"
        );
        assert!(next > now, "and still be in the future");
        assert!(
            next - now <= MIN_US,
            "without skipping more than one interval"
        );

        // And it stays there.
        assert_eq!(
            compute_next_run_at(&f, next, next + 1_000_000, 0, ID, true),
            next + MIN_US,
            "subsequent passes are pure fixed-rate advances"
        );
    }
}
