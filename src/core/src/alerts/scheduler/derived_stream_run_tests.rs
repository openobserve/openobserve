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

//! Window and next-run tests for scheduled pipelines with a delay (o2-enterprise#3553).

use config::meta::alerts::FrequencyType;

use super::*;

/// 2026-11-16 at `h:m:s` UTC, in microseconds.
fn at(h: u32, m: u32, s: u32) -> i64 {
    chrono::NaiveDate::from_ymd_opt(2026, 11, 16)
        .unwrap()
        .and_hms_opt(h, m, s)
        .unwrap()
        .and_utc()
        .timestamp_micros()
}

fn hm(h: u32, m: u32) -> i64 {
    at(h, m, 0)
}

/// An interval pipeline with `align_time` true, frequency and period in minutes.
fn interval(frequency: i64, period: i64, delay: i32) -> DerivedStream {
    DerivedStream {
        trigger_condition: TriggerCondition {
            frequency_type: FrequencyType::Minutes,
            frequency,
            period,
            align_time: true,
            ..Default::default()
        },
        delay: Some(delay),
        ..Default::default()
    }
}

/// A cron pipeline with period 60.
fn cron(expr: &str, delay: i32) -> DerivedStream {
    DerivedStream {
        trigger_condition: TriggerCondition {
            frequency_type: FrequencyType::Cron,
            cron: expr.to_string(),
            period: 60,
            align_time: true,
            ..Default::default()
        },
        delay: Some(delay),
        ..Default::default()
    }
}

/// A run with a stored cursor: (window start, window end, catch-up).
fn window(ds: &DerivedStream, next_run_at: i64, cursor: i64) -> (i64, i64, bool) {
    let plan = plan_derived_stream_run(ds, next_run_at, Some(cursor), false).unwrap();
    assert!(!plan.skip, "unexpected skip");
    (plan.start.unwrap(), plan.end, plan.catch_up)
}

/// The next run after a finished run, with the handler's choice of `CatchUp` or `Normal`.
fn next_after_run(ds: &DerivedStream, next_run_at: i64, plan: &RunPlan) -> i64 {
    let run_end = if plan.catch_up {
        RunEnd::CatchUp { end: plan.end }
    } else {
        RunEnd::Normal
    };
    next_run_after(ds, run_end, next_run_at).unwrap()
}

fn assert_skip(ds: &DerivedStream, next_run_at: i64, cursor: i64) {
    let plan = plan_derived_stream_run(ds, next_run_at, Some(cursor), false).unwrap();
    assert!(plan.skip, "expected a skip: {plan:?}");
}

#[test]
fn t01_delay_runs_after_the_slot_and_searches_the_slot_window() {
    let ds = interval(60, 60, 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 10), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert!(!plan.skip && !plan.catch_up);
    assert_eq!(next_after_run(&ds, hm(10, 10), &plan), hm(11, 10));
}

#[test]
fn t02_delay_0_keeps_the_run_minute() {
    let ds = interval(60, 60, 0);
    let plan = plan_derived_stream_run(&ds, hm(10, 37), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert!(!plan.catch_up);
    assert_eq!(next_after_run(&ds, hm(10, 37), &plan), hm(11, 37));
}

#[test]
fn t03_old_trigger_on_the_hour_moves_to_the_grid() {
    let ds = interval(60, 60, 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 0), Some(hm(8, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(8, 0)), hm(9, 0)));
    assert_eq!(next_after_run(&ds, hm(10, 0), &plan), hm(10, 10));
}

#[test]
fn t04_old_trigger_off_the_hour_moves_to_the_grid() {
    let ds = interval(60, 60, 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 37), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert_eq!(next_after_run(&ds, hm(10, 37), &plan), hm(11, 10));
}

#[test]
fn t05_delay_above_the_period() {
    let ds = interval(60, 60, 90);
    let plan = plan_derived_stream_run(&ds, hm(11, 30), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert_eq!(next_after_run(&ds, hm(11, 30), &plan), hm(12, 30));
}

#[test]
fn t06_changed_save_mid_period_skips_once() {
    let ds = interval(5, 5, 2);
    assert_skip(&ds, at(5, 59, 2), hm(5, 55));
    assert_eq!(
        next_run_after(&ds, RunEnd::Skipped, at(5, 59, 2)).unwrap(),
        hm(6, 2)
    );
}

#[test]
fn t07_catch_up_runs_the_next_window_at_once() {
    let ds = interval(60, 60, 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 10), Some(hm(8, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(8, 0)), hm(9, 0)));
    assert!(plan.catch_up);
    let next = next_after_run(&ds, hm(10, 10), &plan);
    assert_eq!(next, hm(10, 10));
    // Not after the clock of this run, so the scheduler picks it up at once.
    assert!(next <= hm(10, 10));
}

#[test]
fn t08_cron_hourly_with_delay() {
    let ds = cron("0 0 * * * *", 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 10), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert!(!plan.catch_up);
    assert_eq!(next_after_run(&ds, hm(10, 10), &plan), hm(11, 10));
}

#[test]
fn t10_stored_negative_delay_reads_as_0() {
    let ds = interval(60, 60, -5);
    assert_eq!(derived_stream_delay_micros(&ds), 0);
    let none = DerivedStream {
        delay: None,
        ..interval(60, 60, 0)
    };
    assert_eq!(derived_stream_delay_micros(&none), 0);
    // The handler then behaves as for delay 0.
    let plan = plan_derived_stream_run(&ds, hm(10, 37), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert_eq!(next_after_run(&ds, hm(10, 37), &plan), hm(11, 37));
}

#[test]
fn t11_retry_at_a_clock_time_searches_the_same_window() {
    let ds = interval(60, 60, 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 12), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert_eq!(next_after_run(&ds, hm(10, 12), &plan), hm(11, 10));
}

#[test]
fn t12_old_cron_trigger_catches_up_then_runs_on_the_grid() {
    let ds = cron("0 37 * * * *", 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 37), Some(hm(9, 27)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 27)), hm(9, 37)));
    assert!(plan.catch_up);
    let next = next_after_run(&ds, hm(10, 37), &plan);
    assert_eq!(next, hm(10, 47));

    let plan = plan_derived_stream_run(&ds, next, Some(hm(9, 37)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 37)), hm(10, 37)));
    assert!(!plan.catch_up);
    assert_eq!(next_after_run(&ds, next, &plan), hm(11, 47));
}

#[test]
fn t13_run_with_no_retries_left_goes_to_the_next_slot_plus_delay() {
    let ds = interval(60, 60, 10);
    assert_eq!(
        next_run_after(&ds, RunEnd::MaxRetries, hm(10, 10)).unwrap(),
        hm(11, 10)
    );
}

#[test]
fn t14_align_time_false_catch_up_adds_the_delay() {
    let mut ds = interval(60, 60, 10);
    ds.trigger_condition.align_time = false;
    let plan = plan_derived_stream_run(&ds, hm(12, 37), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert!(plan.catch_up);
    assert_eq!(next_after_run(&ds, hm(12, 37), &plan), hm(11, 10));
}

#[test]
fn t16_delay_change_to_90_skips_twice_then_runs() {
    let ds = interval(60, 60, 90);
    assert_skip(&ds, hm(10, 37), hm(10, 0));
    let next = next_run_after(&ds, RunEnd::Skipped, hm(10, 37)).unwrap();
    assert_eq!(next, hm(11, 30));
    assert_skip(&ds, next, hm(10, 0));
    let next = next_run_after(&ds, RunEnd::Skipped, next).unwrap();
    assert_eq!(next, hm(12, 30));
    assert_eq!(window(&ds, next, hm(10, 0)), (hm(10, 0), hm(11, 0), false));
}

#[test]
fn t17_rename_with_delay_change_skips_once() {
    let ds = interval(60, 60, 20);
    assert_skip(&ds, hm(11, 10), hm(10, 0));
    let next = next_run_after(&ds, RunEnd::Skipped, hm(11, 10)).unwrap();
    assert_eq!(next, hm(11, 20));
    assert_eq!(window(&ds, next, hm(10, 0)), (hm(10, 0), hm(11, 0), false));
}

#[test]
fn t18_period_below_frequency_catches_up() {
    let ds = interval(60, 5, 10);
    assert_eq!(
        window(&ds, hm(10, 10), hm(9, 0)),
        (hm(9, 0), hm(9, 5), true)
    );
}

#[test]
fn t19_delay_0_next_run_matches_the_code_before_the_fix() {
    let mut cases = vec![
        interval(60, 60, 0),
        interval(5, 5, 0),
        cron("0 0 * * * *", 0),
    ];
    let mut not_aligned = interval(60, 60, 0);
    not_aligned.trigger_condition.align_time = false;
    cases.push(not_aligned);
    for ds in cases {
        let tc = &ds.trigger_condition;
        for next_run_at in [hm(10, 0), hm(10, 37), at(10, 37, 12)] {
            let before = tc
                .get_next_trigger_time(false, 0, false, Some(next_run_at))
                .unwrap();
            assert_eq!(
                next_run_after(&ds, RunEnd::Skipped, next_run_at).unwrap(),
                before
            );
            assert_eq!(
                next_run_after(&ds, RunEnd::MaxRetries, next_run_at).unwrap(),
                before
            );
            let end = hm(9, 0);
            assert_eq!(
                next_run_after(&ds, RunEnd::CatchUp { end }, next_run_at).unwrap(),
                tc.get_next_trigger_time(false, 0, false, Some(end))
                    .unwrap()
            );
            assert_eq!(
                next_run_after(&ds, RunEnd::Normal, next_run_at).unwrap(),
                tc.get_next_trigger_time_non_aligned(false, 0, false, Some(next_run_at))
                    .unwrap()
            );
        }
    }
}

#[test]
fn t20_delay_0_cron_hourly() {
    let ds = cron("0 0 * * * *", 0);
    let plan = plan_derived_stream_run(&ds, hm(10, 0), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert_eq!(next_after_run(&ds, hm(10, 0), &plan), hm(11, 0));
}

#[test]
fn t21_no_cursor_after_a_parked_state() {
    let ds = interval(60, 60, 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 15), None, false).unwrap();
    assert_eq!(plan.start, None);
    assert_eq!(plan.end, hm(10, 0));
    // The handler searches one period that ends at `end`.
    assert_eq!(plan.end - hour_micros(1), hm(9, 0));
    assert!(!plan.skip && !plan.catch_up);
    assert_eq!(next_after_run(&ds, hm(10, 15), &plan), hm(11, 10));
}

#[test]
fn t22_failure_on_the_last_retry_takes_the_normal_path() {
    let ds = interval(60, 60, 0);
    assert_eq!(
        next_run_after(&ds, RunEnd::Normal, hm(10, 37)).unwrap(),
        hm(11, 37)
    );
}

#[test]
fn t23_frequency_below_the_period() {
    let ds = interval(5, 60, 10);
    let plan = plan_derived_stream_run(&ds, hm(10, 15), Some(hm(9, 0)), false).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(9, 0)), hm(10, 0)));
    assert!(!plan.catch_up);
    assert_eq!(next_after_run(&ds, hm(10, 15), &plan), hm(10, 20));
}

#[test]
fn t24_tolerance_is_drawn_after_the_alignment_with_a_delay() {
    let mut ds = interval(60, 60, 10);
    ds.trigger_condition.tolerance_in_secs = Some(30);
    let mut seen = std::collections::HashSet::new();
    for _ in 0..500 {
        let next = next_run_after(&ds, RunEnd::Normal, hm(10, 10)).unwrap();
        assert!(
            (hm(11, 10)..hm(11, 10) + second_micros(30)).contains(&next),
            "{next}"
        );
        // The next run still has slot 11:00 and searches 10:00 to 11:00.
        let plan = plan_derived_stream_run(&ds, next, Some(hm(10, 0)), false).unwrap();
        assert_eq!((plan.start, plan.end), (Some(hm(10, 0)), hm(11, 0)));
        assert!(!plan.skip && !plan.catch_up);
        seen.insert(next);
    }
    // The random seconds are kept, so pipelines with the same delay do not all run at once.
    assert!(seen.len() > 1);
}

#[test]
fn t25_first_run_with_start_at() {
    let mut ds = interval(60, 60, 10);
    ds.start_at = Some(hm(7, 37));
    let plan = plan_derived_stream_run(&ds, hm(10, 10), None, true).unwrap();
    assert_eq!((plan.start, plan.end), (Some(hm(7, 37)), hm(10, 0)));
    assert!(!plan.skip && !plan.catch_up);
    assert_eq!(next_after_run(&ds, hm(10, 10), &plan), hm(11, 10));
}
