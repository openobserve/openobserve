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

//! The synthetics limits holder must survive being written more than once.
//!
//! `job_lease_secs`, `max_check_budget_secs` and `max_net_timeout_ms` used to
//! live in a `OnceLock`, so the SECOND write — which is what a config reload
//! is — was silently discarded. An operator could edit
//! `O2_SYNTHETICS_MAX_CHECK_BUDGET_SECS`, hit `/config/reload`, see no error,
//! and still have every check validated against the boot-time ceiling until the
//! next restart.
//!
//! These tests live in their own integration binary ON PURPOSE. The holder is
//! process-global, and ~90 unit tests in `config::meta::synthetics` validate
//! check configs against whatever `limits()` returns. If these overwrite tests
//! shared that binary, a check config asserted to be "over the 840s budget"
//! could be validated during the window where a test had installed a 1200s
//! budget, and the suite would fail intermittently for reasons unrelated to the
//! code under test. A separate binary is a separate process: zero interaction.
//! Within THIS binary the tests still share the holder, so they serialise on
//! `MUTATION_LOCK` below.

use std::{
    collections::HashSet,
    sync::{
        Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};

use config::meta::synthetics::{
    DEFAULT_JOB_LEASE_SECS, DEFAULT_MAX_CHECK_BUDGET_SECS, DEFAULT_MAX_NET_TIMEOUT_MS, Synthetic,
    SyntheticFrequency, SyntheticFrequencyType, SyntheticType, SyntheticsLimits, init_limits,
    limits, set_limits,
};

static MUTATION_LOCK: Mutex<()> = Mutex::new(());

/// Holds the mutation lock for the duration of a test and puts the shipped
/// defaults back when it drops, so a panicking test cannot leave a bogus
/// ceiling behind for the next one. Poisoning is ignored deliberately: a
/// failed test should report its own assertion, not turn every later test into
/// a `PoisonError`.
struct LimitsFixture {
    _guard: MutexGuard<'static, ()>,
}

impl LimitsFixture {
    fn acquire() -> Self {
        Self {
            _guard: MUTATION_LOCK.lock().unwrap_or_else(|e| e.into_inner()),
        }
    }
}

impl Drop for LimitsFixture {
    fn drop(&mut self) {
        let _ = set_limits(SyntheticsLimits::default());
    }
}

/// A valid, non-default set — every field differs from the `DEFAULT_*` values,
/// so an assertion cannot pass by accident on an uninstalled holder.
fn tighter() -> SyntheticsLimits {
    SyntheticsLimits {
        job_lease_secs: 600,
        max_check_budget_secs: 540,
        max_net_timeout_ms: 120_000,
    }
}

/// A second valid set, distinct from [`tighter`] in every field.
fn looser() -> SyntheticsLimits {
    SyntheticsLimits {
        job_lease_secs: 800,
        max_check_budget_secs: 700,
        max_net_timeout_ms: 200_000,
    }
}

#[test]
fn job_lease_secs_is_overwritten_without_a_restart() {
    let _fx = LimitsFixture::acquire();

    set_limits(tighter()).expect("a valid set must install");
    assert_eq!(limits().job_lease_secs, 600);

    // The second write is the whole point — under the old OnceLock holder this
    // was a no-op and the assertion below read 600.
    set_limits(looser()).expect("a valid set must install over an existing one");
    assert_eq!(limits().job_lease_secs, 800);
}

#[test]
fn max_check_budget_secs_is_overwritten_without_a_restart() {
    let _fx = LimitsFixture::acquire();

    set_limits(tighter()).expect("a valid set must install");
    assert_eq!(limits().max_check_budget_secs, 540);

    set_limits(looser()).expect("a valid set must install over an existing one");
    assert_eq!(limits().max_check_budget_secs, 700);
}

#[test]
fn max_net_timeout_ms_is_overwritten_without_a_restart() {
    let _fx = LimitsFixture::acquire();

    set_limits(tighter()).expect("a valid set must install");
    assert_eq!(limits().max_net_timeout_ms, 120_000);

    set_limits(looser()).expect("a valid set must install over an existing one");
    assert_eq!(limits().max_net_timeout_ms, 200_000);
}

#[test]
fn one_write_installs_all_three_ceilings() {
    let _fx = LimitsFixture::acquire();

    set_limits(tighter()).unwrap();
    set_limits(looser()).unwrap();
    // One `set_limits` call publishes the whole struct — callers never have to
    // sequence three separate writes. (Whether a CONCURRENT reader can observe
    // a half-applied set is a different property, pinned by
    // `concurrent_readers_only_ever_observe_a_whole_installed_set`.)
    assert_eq!(limits(), looser());
}

#[test]
fn init_limits_no_longer_freezes_the_holder() {
    // Regression for the OnceLock. `init_limits` is what `main.rs` calls at
    // boot; after it has run, a reload must still be able to move the values.
    let _fx = LimitsFixture::acquire();

    init_limits(tighter()).expect("boot-time install must succeed");
    assert_eq!(limits(), tighter());

    set_limits(looser()).expect("a reload after boot must not be rejected");
    assert_eq!(limits(), looser());
}

#[test]
fn an_invalid_set_keeps_the_last_good_value_not_the_defaults() {
    let _fx = LimitsFixture::acquire();

    set_limits(tighter()).unwrap();

    // budget >= lease: a run that uses its full budget cannot report before the
    // reaper requeues it. `SyntheticsLimits::validate` rejects this pair.
    let bad = SyntheticsLimits {
        job_lease_secs: 600,
        max_check_budget_secs: 600,
        max_net_timeout_ms: 120_000,
    };
    assert!(bad.validate().is_err(), "fixture must actually be invalid");

    let err = set_limits(bad).expect_err("an invalid pair must be rejected");
    assert!(
        err.contains("O2_SYNTHETICS_MAX_CHECK_BUDGET_SECS"),
        "the error must name the env var an operator has to fix: {err}"
    );

    // Deliberately NOT the defaults. An operator typo on reload must not
    // silently LOOSEN a ceiling that was correct a second ago — falling back to
    // the 840s/900s defaults from a deployment running 540s/600s would widen
    // what the server accepts without anyone asking for it.
    assert_eq!(
        limits(),
        tighter(),
        "a rejected reload must leave the previously installed limits in place"
    );
}

#[test]
fn an_invalid_set_over_the_defaults_leaves_the_defaults() {
    // "Last good" with no history is the shipped default, which is known to
    // hold together. This is the state a deployment is in at boot, before
    // `init_limits` has run or when it was rejected.
    let _fx = LimitsFixture::acquire();
    set_limits(SyntheticsLimits::default()).unwrap();

    let bad = SyntheticsLimits {
        job_lease_secs: 10,
        max_check_budget_secs: 10,
        max_net_timeout_ms: 1_000,
    };
    assert!(set_limits(bad).is_err());
    assert_eq!(limits(), SyntheticsLimits::default());
}

#[test]
fn a_reload_that_changes_nothing_leaves_the_value_stable() {
    let _fx = LimitsFixture::acquire();

    set_limits(tighter()).unwrap();
    let first = limits();
    set_limits(tighter()).unwrap();
    let second = limits();

    assert_eq!(first, second);
    assert_eq!(second, tighter());
}

// ── the ceilings must reach VALIDATION, not just the holder ──────────────────
//
// Reading the right value back out of `limits()` proves the holder swapped. It
// does not prove the thing an operator actually cares about: that a check
// config the server refused before the reload is accepted after it. The
// consumers are `limits()` calls inside `validate_net_retry_budget`
// (`meta/synthetics.rs`), and hoisting either of them into a `LazyLock` would
// keep every holder test above green while freezing validation forever. That is
// exactly the "a key looks hot but is captured downstream" failure the spec's
// risk table names.

/// A protocol check that passes every validation rule EXCEPT the ones derived
/// from the limits under test, so a failure can only come from a ceiling.
fn tcp_check(timeout_ms: u64, retries: i32) -> Synthetic {
    Synthetic {
        name: "db port".to_string(),
        check_type: SyntheticType::Tcp,
        target: "db.example.com".to_string(),
        frequency: SyntheticFrequency {
            frequency_type: SyntheticFrequencyType::Minutes,
            interval: 5,
            cron: String::new(),
            timezone: None,
        },
        locations: vec!["aws-us-east-1".to_string()],
        enabled: true,
        alert_if_fails: 1,
        retries,
        wait_before_retry_secs: 5,
        config: serde_json::json!({ "port": 5432, "timeout_ms": timeout_ms }),
        ..Default::default()
    }
}

fn allowed_locations() -> Vec<String> {
    vec!["aws-us-east-1".to_string()]
}

#[test]
fn net_timeout_validation_follows_a_reloaded_ceiling() {
    let _fx = LimitsFixture::acquire();
    // 150s sits between tighter's 120s ceiling and looser's 200s one.
    let check = tcp_check(150_000, 0);
    let locs = allowed_locations();

    set_limits(tighter()).unwrap();
    let err = check
        .validate(&locs, &[], &[], true)
        .expect_err("150s must be over the 120s ceiling");
    assert!(err.contains("timeout_ms"), "unexpected rejection: {err}");

    // Same check, no restart, only a reload — now accepted.
    set_limits(looser()).unwrap();
    check
        .validate(&locs, &[], &[], true)
        .expect("a raised O2_SYNTHETICS_MAX_NET_TIMEOUT_MS must take effect without a restart");
}

#[test]
fn check_budget_validation_follows_a_reloaded_ceiling() {
    let _fx = LimitsFixture::acquire();
    // 4 attempts x 120s + 3 gaps x 5s ≈ 495s. Both limit sets below share the
    // SAME net ceiling and differ only in the budget, so this isolates the
    // budget rule from the timeout rule above. (`retries` is capped at 3 for
    // Tcp checks, which bounds how large the worst case can be made.)
    let check = tcp_check(120_000, 3);
    let locs = allowed_locations();

    let budget_too_small = SyntheticsLimits {
        job_lease_secs: 600,
        max_check_budget_secs: 300,
        max_net_timeout_ms: 120_000,
    };
    let budget_big_enough = SyntheticsLimits {
        job_lease_secs: 800,
        max_check_budget_secs: 700,
        max_net_timeout_ms: 120_000,
    };

    set_limits(budget_too_small).unwrap();
    let err = check
        .validate(&locs, &[], &[], true)
        .expect_err("~495s must be over a 300s check budget");
    assert!(err.contains("budget"), "unexpected rejection: {err}");

    set_limits(budget_big_enough).unwrap();
    check
        .validate(&locs, &[], &[], true)
        .expect("a raised O2_SYNTHETICS_MAX_CHECK_BUDGET_SECS must take effect without a restart");
}

#[test]
fn concurrent_readers_only_ever_observe_a_whole_installed_set() {
    // The holder is read on every check-config validation — i.e. on request
    // threads — while a reload writes it. A reader must never observe a value
    // assembled from two different installs (lease from one, budget from the
    // other), which is what three independently-updated cells would produce and
    // what would let `budget >= lease` exist at runtime despite validation.
    let _fx = LimitsFixture::acquire();

    let installed = [SyntheticsLimits::default(), tighter(), looser()];
    set_limits(installed[0]).unwrap();

    let stop = AtomicBool::new(false);

    std::thread::scope(|scope| {
        let readers: Vec<_> = (0..8)
            .map(|_| {
                scope.spawn(|| {
                    let mut seen: HashSet<SyntheticsLimits> = HashSet::new();
                    while !stop.load(Ordering::Relaxed) {
                        let l = limits();
                        assert!(
                            installed.contains(&l),
                            "observed {l:?}, which was never installed as a whole"
                        );
                        // The ordering invariant must hold for every value a
                        // reader can ever observe, not just at rest.
                        assert!(
                            l.max_check_budget_secs < l.job_lease_secs,
                            "observed a set that violates budget < lease: {l:?}"
                        );
                        seen.insert(l);
                        std::hint::spin_loop();
                    }
                    seen
                })
            })
            .collect();

        let writer = scope.spawn(|| {
            for i in 0..2_000 {
                set_limits(installed[i % installed.len()]).unwrap();
            }
        });

        // Stop the readers BEFORE propagating a writer panic. Doing it the
        // other way round means a failing writer leaves 8 threads spinning on a
        // flag that is never set, and `thread::scope` blocks forever on the
        // unwind — the suite hangs until the CI timeout instead of failing.
        let writer_result = writer.join();
        stop.store(true, Ordering::Relaxed);
        writer_result.expect("writer thread must not panic");

        let mut distinct: HashSet<SyntheticsLimits> = HashSet::new();
        for r in readers {
            // `resume_unwind` rather than `.expect`, so a reader's assertion
            // message survives instead of being printed as `Any { .. }`.
            match r.join() {
                Ok(seen) => distinct.extend(seen),
                Err(e) => std::panic::resume_unwind(e),
            }
        }

        // Without this the test passes against a `set_limits` that silently
        // drops every write after the first: readers would see the initial
        // value forever, which IS in `installed` and DOES satisfy
        // `budget < lease`. Observing at least two distinct sets is what proves
        // writes actually land while readers are running.
        assert!(
            distinct.len() >= 2,
            "readers only ever observed {distinct:?} — writes are not landing, so this test \
             proved nothing"
        );
    });
}

#[test]
fn defaults_hold_when_nothing_has_been_installed() {
    // OSS builds and every test binary that never calls into enterprise take
    // this path. The pristine-holder case is asserted in the crate's own unit
    // tests (`limits_fall_back_to_defaults_when_uninitialised`), which run in a
    // process where nothing ever writes the holder; here we can only pin that
    // installing the defaults is a no-op relative to them.
    let _fx = LimitsFixture::acquire();
    set_limits(SyntheticsLimits::default()).unwrap();

    let l = limits();
    assert_eq!(l.job_lease_secs, DEFAULT_JOB_LEASE_SECS);
    assert_eq!(l.max_check_budget_secs, DEFAULT_MAX_CHECK_BUDGET_SECS);
    assert_eq!(l.max_net_timeout_ms, DEFAULT_MAX_NET_TIMEOUT_MS);
}
