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

use bytes::Bytes;
use config::{
    cluster::LOCAL_NODE,
    meta::downtimes::{Downtime, DowntimeWindow, NotificationEvent, Repeat},
    spawn_pausable_job,
    utils::time::now_micros,
};
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    downtimes::{MAX_DURATION_SECS, schedule},
};
use openobserve_core::downtimes::{
    continues_window,
    notify::{self, DueEvent},
};

const INTERVAL_SECS: u64 = 30;
const MIGRATION_ORG: &str = "_migration";
const LAST_TICK_KEY: &str = "downtimes_notifier_last_tick";
const MICROS_PER_SEC: i64 = 1_000_000;
/// A sender that was down longer than this skips the older events instead of sending stale news.
const MAX_CATCH_UP_MICROS: i64 = 3_600 * MICROS_PER_SEC;
/// A window can start this long before the tick and still end inside it; the hour covers DST.
const LOOKBACK_MICROS: i64 = (MAX_DURATION_SECS + 3_600) * MICROS_PER_SEC;
const MAX_WINDOWS_PER_ROW: usize = 64;

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[DOWNTIMES::NOTIFIER] not an alert manager node, skipping");
        return;
    }
    if !get_o2_config().downtimes.enabled {
        return;
    }
    log::info!("[DOWNTIMES::NOTIFIER] initialized with interval: {INTERVAL_SECS}s");
    spawn_pausable_job!("downtimes_notifier", INTERVAL_SECS, {
        if !crate::job::leader::is_alert_manager_leader().await {
            log::debug!("[DOWNTIMES::NOTIFIER] not leader, skipping this pass");
            continue;
        }
        if let Err(e) = tick(now_micros()).await {
            log::error!("[DOWNTIMES::NOTIFIER] pass failed: {e}");
        }
    });
}

/// The persisted tick only moves on when every claim was written, so a failed one is retried.
async fn tick(now: i64) -> Result<(), anyhow::Error> {
    let region = notify::this_region();
    let key = last_tick_key(&region);
    let from = tick_from(load_last_tick(&key).await, now);
    let mut failed = false;
    for rows in db::downtimes::all_cached() {
        for row in rows.iter().filter(|row| notify::sends_here(row, &region)) {
            failed |= !deliver_all(row, &due_in_org(&rows, row, from, now)).await;
        }
    }
    if failed {
        anyhow::bail!("some notifications could not be recorded; retrying from the same tick");
    }
    openobserve_core::kv::set(MIGRATION_ORG, &key, Bytes::from(now.to_string())).await
}

async fn deliver_all(row: &Downtime, dues: &[DueEvent]) -> bool {
    let mut ok = true;
    for due in dues {
        if let Err(e) = notify::deliver(row, due).await {
            log::warn!(
                "[DOWNTIMES::NOTIFIER] {} of {}/{} not sent: {e}",
                due.event.as_str(),
                row.org,
                row.id
            );
            ok = false;
        }
    }
    ok
}

async fn load_last_tick(key: &str) -> Option<i64> {
    let bytes = openobserve_core::kv::get(MIGRATION_ORG, key).await.ok()?;
    std::str::from_utf8(&bytes).ok()?.trim().parse().ok()
}

/// The KV replicates across regions, so each region keeps its own checkpoint.
fn last_tick_key(region: &str) -> String {
    if region.is_empty() {
        LAST_TICK_KEY.to_string()
    } else {
        format!("{LAST_TICK_KEY}_{region}")
    }
}

fn tick_from(last_tick: Option<i64>, now: i64) -> i64 {
    match last_tick {
        Some(last) => last.clamp(now - MAX_CATCH_UP_MICROS, now),
        None => now - INTERVAL_SECS as i64 * MICROS_PER_SEC,
    }
}

fn due_in_org(rows: &[Downtime], row: &Downtime, from: i64, to: i64) -> Vec<DueEvent> {
    let lead = lead_micros(row);
    due_events(row, from, to)
        .into_iter()
        .filter(|due| {
            let at = match due.event {
                NotificationEvent::EndingSoon => (due.window.end - lead).max(due.window.start),
                NotificationEvent::Ended => due.window.end,
                _ => return true,
            };
            !rows
                .iter()
                .any(|other| continues_window(other, row, due.window.end, at))
        })
        .collect()
}

/// Unvalidated while the reminder is off, so it counts only when `ending_soon` is on.
fn lead_micros(row: &Downtime) -> i64 {
    row.notifications
        .as_ref()
        .filter(|n| n.events.ending_soon)
        .map_or(0, |n| {
            n.ending_soon_lead_secs.clamp(0, MAX_DURATION_SECS) * MICROS_PER_SEC
        })
}

fn due_events(row: &Downtime, from: i64, to: i64) -> Vec<DueEvent> {
    let Some(n) = row
        .notifications
        .as_ref()
        .filter(|n| !n.destinations.is_empty())
    else {
        return vec![];
    };
    let lead = lead_micros(row);
    let mut due = Vec::new();
    for window in windows_near(row, from, to, lead) {
        let instants = [
            (NotificationEvent::Started, window.start),
            (
                NotificationEvent::EndingSoon,
                (window.end - lead).max(window.start),
            ),
            (NotificationEvent::Ended, window.end),
        ];
        for (event, at) in instants {
            let in_tick = from <= at && at < to;
            let before_cancel = row.cancelled_at.is_none_or(|cancelled| at < cancelled);
            if n.events.wants(event) && in_tick && before_cancel {
                due.push(DueEvent::of_window(event, window.clone()));
            }
        }
    }
    due
}

/// Whole occurrences in start order, so overlapping windows keep their own start and end.
fn windows_near(row: &Downtime, from: i64, to: i64, lead: i64) -> Vec<DowntimeWindow> {
    let until = to.saturating_add(lead);
    // A one-time window is bounded by its own end, not by the recurrence lookback.
    if row.schedule.repeat == Repeat::None {
        return row
            .schedule
            .ends_at
            .map(|end| DowntimeWindow {
                start: row.schedule.starts_at,
                end,
            })
            .filter(|w| w.start < until && w.end >= from)
            .into_iter()
            .collect();
    }
    let mut after = from.saturating_sub(LOOKBACK_MICROS);
    let mut windows = Vec::new();
    while windows.len() < MAX_WINDOWS_PER_ROW {
        let Some(window) = schedule::next_window(&row.schedule, after) else {
            break;
        };
        if window.start >= until {
            break;
        }
        after = window.start;
        windows.push(window);
    }
    windows
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use config::meta::downtimes::{
        DowntimeNotifications, DowntimeSchedule, DowntimeTarget, NotificationEvents, Repeat,
        TargetFolders, TargetModule,
    };

    use super::*;

    const MIN: i64 = 60 * MICROS_PER_SEC;
    const HOUR: i64 = 60 * MIN;
    const DAY: i64 = 24 * HOUR;

    fn every_event() -> NotificationEvents {
        NotificationEvents {
            started: true,
            ending_soon: true,
            ended: true,
            cancelled: true,
            extended: true,
        }
    }

    fn with_schedule(schedule: DowntimeSchedule) -> Downtime {
        Downtime {
            id: "d1".to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: "Nightly deploy".to_string(),
            reason: None,
            condition: None,
            targets: vec![DowntimeTarget {
                module: TargetModule::Alerts,
                folders: TargetFolders::All,
                tags: vec![],
                ids: vec![],
                slo_mode: None,
                incident_mode: Default::default(),
            }],
            schedule,
            cancelled_at: None,
            cancelled_by: None,
            show_banner: true,
            notifications: Some(DowntimeNotifications {
                destinations: vec!["slack".to_string()],
                events: every_event(),
                ending_soon_lead_secs: 600,
                continues: None,
            }),
            origin_region: None,
            version: 0,
            created_by: "lin".to_string(),
            created_at: 0,
            updated_by: "lin".to_string(),
            updated_at: 0,
        }
    }

    fn nightly() -> Downtime {
        with_schedule(DowntimeSchedule {
            repeat: Repeat::Daily,
            starts_at: 0,
            ends_at: None,
            timezone: "UTC".to_string(),
            start_time_local: Some("02:00".to_string()),
            duration_secs: 3_600,
            weekdays: vec![],
        })
    }

    fn once(start: i64, end: i64) -> Downtime {
        with_schedule(DowntimeSchedule {
            repeat: Repeat::None,
            starts_at: start,
            ends_at: Some(end),
            timezone: "UTC".to_string(),
            start_time_local: None,
            duration_secs: (end - start) / MICROS_PER_SEC,
            weekdays: vec![],
        })
    }

    fn summary(dues: &[DueEvent]) -> Vec<(NotificationEvent, i64)> {
        dues.iter().map(|d| (d.event, d.key)).collect()
    }

    fn run_ticks(
        row: &Downtime,
        from: i64,
        to: i64,
        step: i64,
        ledger: &mut HashSet<(String, i64, &'static str)>,
    ) -> Vec<(NotificationEvent, i64)> {
        let mut sent = Vec::new();
        let mut at = from;
        while at < to {
            let next = (at + step).min(to);
            for due in due_events(row, at, next) {
                if ledger.insert((row.id.clone(), due.key, due.event.as_str())) {
                    sent.push((due.event, due.key));
                }
            }
            at = next;
        }
        sent
    }

    #[test]
    fn a_daily_rule_sends_start_reminder_and_end_once_per_window_across_ticks() {
        let row = nightly();
        let start = DAY + 2 * HOUR;
        let expected = vec![
            (NotificationEvent::Started, start),
            (NotificationEvent::EndingSoon, start),
            (NotificationEvent::Ended, start),
        ];
        let mut ledger = HashSet::new();
        let ticks = run_ticks(
            &row,
            DAY + 2 * HOUR - 17 * MICROS_PER_SEC,
            DAY + 3 * HOUR + 45 * MICROS_PER_SEC,
            30 * MICROS_PER_SEC,
            &mut ledger,
        );
        assert_eq!(ticks, expected);

        let one_pass = due_events(&row, DAY + HOUR, DAY + 4 * HOUR);
        assert_eq!(summary(&one_pass), expected);
        assert_eq!(one_pass[1].window.end, DAY + 3 * HOUR);
        assert_eq!(
            summary(&due_events(
                &row,
                DAY + 2 * HOUR + 50 * MIN,
                DAY + 2 * HOUR + 51 * MIN
            )),
            vec![(NotificationEvent::EndingSoon, start)],
            "the reminder is due at end minus the lead"
        );
    }

    #[test]
    fn two_days_of_ticks_send_each_window_once_and_a_replay_sends_nothing() {
        let row = nightly();
        let mut ledger = HashSet::new();
        let first = run_ticks(&row, DAY, 3 * DAY, 3 * HOUR, &mut ledger);
        assert_eq!(first.len(), 6);
        assert!(run_ticks(&row, DAY, 3 * DAY, 30 * MIN, &mut ledger).is_empty());
    }

    #[test]
    fn a_cancel_inside_the_window_stops_the_reminder_and_the_end() {
        let mut row = once(10 * HOUR, 12 * HOUR);
        row.cancelled_at = Some(11 * HOUR);
        assert_eq!(
            summary(&due_events(&row, 9 * HOUR, 13 * HOUR)),
            vec![(NotificationEvent::Started, 10 * HOUR)]
        );
        row.cancelled_at = Some(9 * HOUR);
        assert!(due_events(&row, 9 * HOUR, 13 * HOUR).is_empty());
        row.cancelled_at = Some(12 * HOUR + MIN);
        assert_eq!(due_events(&row, 9 * HOUR, 13 * HOUR).len(), 3);
    }

    #[test]
    fn a_restart_between_the_reminder_and_the_end_sends_the_end_once() {
        let row = once(10 * HOUR, 12 * HOUR);
        let mut ledger = HashSet::new();
        let before = run_ticks(&row, 9 * HOUR, 11 * HOUR + 55 * MIN, 30 * MIN, &mut ledger);
        assert_eq!(
            before,
            vec![
                (NotificationEvent::Started, 10 * HOUR),
                (NotificationEvent::EndingSoon, 10 * HOUR),
            ]
        );
        let restarted = 12 * HOUR + 20 * MIN;
        let from = tick_from(Some(11 * HOUR + 55 * MIN), restarted);
        assert_eq!(from, 11 * HOUR + 55 * MIN);
        let after = run_ticks(&row, from, restarted, 30 * MIN, &mut ledger);
        assert_eq!(after, vec![(NotificationEvent::Ended, 10 * HOUR)]);
        assert!(run_ticks(&row, from, restarted, 30 * MIN, &mut ledger).is_empty());
    }

    #[test]
    fn the_catch_up_is_at_most_an_hour_and_a_first_pass_looks_back_one_interval() {
        let now = 10 * HOUR;
        assert_eq!(tick_from(Some(now - 3 * HOUR), now), now - HOUR);
        assert_eq!(tick_from(Some(now - MIN), now), now - MIN);
        assert_eq!(
            tick_from(Some(now + MIN), now),
            now,
            "a clock ahead sends nothing"
        );
        assert_eq!(tick_from(None, now), now - 30 * MICROS_PER_SEC);
    }

    #[test]
    fn only_wanted_events_of_a_row_with_destinations_are_due() {
        let mut row = once(10 * HOUR, 12 * HOUR);
        row.notifications.as_mut().unwrap().events = NotificationEvents {
            ended: true,
            ..Default::default()
        };
        assert_eq!(
            summary(&due_events(&row, 9 * HOUR, 13 * HOUR)),
            vec![(NotificationEvent::Ended, 10 * HOUR)]
        );
        row.notifications.as_mut().unwrap().destinations.clear();
        assert!(due_events(&row, 9 * HOUR, 13 * HOUR).is_empty());
        row.notifications = None;
        assert!(due_events(&row, 9 * HOUR, 13 * HOUR).is_empty());
    }

    fn daily_for(duration_secs: i64) -> Downtime {
        let mut row = nightly();
        row.schedule.duration_secs = duration_secs;
        row
    }

    fn follow_up_of(parent: &Downtime, start: i64, end: i64) -> Downtime {
        Downtime {
            id: "d2".to_string(),
            name: format!("{} (extended)", parent.name),
            schedule: DowntimeSchedule {
                repeat: Repeat::None,
                starts_at: start,
                ends_at: Some(end),
                timezone: "UTC".to_string(),
                start_time_local: None,
                duration_secs: (end - start) / MICROS_PER_SEC,
                weekdays: vec![],
            },
            notifications: parent.notifications.clone().map(|n| DowntimeNotifications {
                continues: Some(parent.id.clone()),
                ..n
            }),
            origin_region: Some("eu-west".to_string()),
            ..parent.clone()
        }
    }

    #[test]
    fn a_one_time_window_longer_than_the_lookback_still_ends() {
        let row = once(DAY, 11 * DAY);
        assert_eq!(
            summary(&due_events(&row, 11 * DAY - 10 * MIN, 11 * DAY + MIN)),
            vec![
                (NotificationEvent::EndingSoon, DAY),
                (NotificationEvent::Ended, DAY),
            ]
        );
        assert_eq!(
            summary(&due_events(&row, DAY, DAY + MIN)),
            vec![(NotificationEvent::Started, DAY)]
        );
        assert!(due_events(&row, 12 * DAY, 13 * DAY).is_empty());
    }

    #[test]
    fn a_renamed_and_moved_follow_up_still_stops_the_parents_end() {
        let parent = nightly();
        let follow_up = Downtime {
            name: "Renamed".to_string(),
            folder_id: "planned".to_string(),
            ..follow_up_of(&parent, DAY + 3 * HOUR, DAY + 5 * HOUR)
        };
        let rows = vec![parent.clone(), follow_up];
        assert_eq!(
            summary(&due_in_org(&rows, &parent, DAY + HOUR, DAY + 4 * HOUR)),
            vec![(NotificationEvent::Started, DAY + 2 * HOUR)]
        );
    }

    #[test]
    fn each_region_keeps_its_own_checkpoint() {
        assert_eq!(last_tick_key(""), LAST_TICK_KEY);
        assert_ne!(last_tick_key("us-east"), last_tick_key("eu-west"));

        let mut kv = std::collections::HashMap::new();
        kv.insert(last_tick_key("eu-west"), 12 * HOUR + 20 * MICROS_PER_SEC);
        kv.insert(last_tick_key("us-east"), 12 * HOUR + 30 * MICROS_PER_SEC);
        let east = tick_from(kv.get(&last_tick_key("us-east")).copied(), 12 * HOUR + MIN);
        let west = tick_from(kv.get(&last_tick_key("eu-west")).copied(), 12 * HOUR + MIN);
        assert_eq!(west, 12 * HOUR + 20 * MICROS_PER_SEC);
        assert!(
            east > west,
            "a faster region must not move another region's tick"
        );
    }

    #[test]
    fn an_unchecked_lead_is_ignored_while_the_reminder_is_off() {
        let mut row = nightly();
        let n = row.notifications.as_mut().unwrap();
        n.events.ending_soon = false;
        n.ending_soon_lead_secs = 3_153_600_000_000;
        assert_eq!(lead_micros(&row), 0);
        assert_eq!(
            summary(&due_events(&row, DAY + HOUR, DAY + 4 * HOUR)),
            vec![
                (NotificationEvent::Started, DAY + 2 * HOUR),
                (NotificationEvent::Ended, DAY + 2 * HOUR),
            ]
        );

        let n = row.notifications.as_mut().unwrap();
        n.events.ending_soon = true;
        n.ending_soon_lead_secs = i64::MAX;
        assert_eq!(lead_micros(&row), MAX_DURATION_SECS * MICROS_PER_SEC);
        assert!(windows_near(&row, DAY, DAY + MIN, lead_micros(&row)).len() <= MAX_WINDOWS_PER_ROW);
    }

    #[test]
    fn overlapping_windows_each_send_their_own_end() {
        let row = daily_for(36 * 3_600);
        let ends = summary(&due_events(
            &row,
            DAY + 14 * HOUR - MIN,
            DAY + 14 * HOUR + MIN,
        ));
        assert_eq!(ends, vec![(NotificationEvent::Ended, 2 * HOUR)]);
        let reminder = summary(&due_events(
            &row,
            DAY + 13 * HOUR + 50 * MIN,
            DAY + 13 * HOUR + 51 * MIN,
        ));
        assert_eq!(reminder, vec![(NotificationEvent::EndingSoon, 2 * HOUR)]);
        let starts = summary(&due_events(&row, DAY + 2 * HOUR, DAY + 2 * HOUR + MIN));
        assert_eq!(starts, vec![(NotificationEvent::Started, DAY + 2 * HOUR)]);
    }

    #[test]
    fn an_extension_from_another_region_stops_the_parents_reminder_and_end() {
        let mut parent = nightly();
        parent.origin_region = Some("us-east".to_string());
        let follow_up = follow_up_of(&parent, DAY + 3 * HOUR, DAY + 5 * HOUR);
        let rows = vec![parent.clone(), follow_up.clone()];
        assert_eq!(
            summary(&due_in_org(&rows, &parent, DAY + HOUR, DAY + 4 * HOUR)),
            vec![(NotificationEvent::Started, DAY + 2 * HOUR)]
        );
        assert_eq!(
            summary(&due_in_org(
                &rows,
                &follow_up,
                DAY + 4 * HOUR,
                DAY + 6 * HOUR
            )),
            vec![
                (NotificationEvent::EndingSoon, DAY + 3 * HOUR),
                (NotificationEvent::Ended, DAY + 3 * HOUR),
            ]
        );

        let mut called_off = follow_up.clone();
        called_off.cancelled_at = Some(DAY + 2 * HOUR + 55 * MIN);
        let rows = vec![parent.clone(), called_off];
        assert_eq!(
            summary(&due_in_org(&rows, &parent, DAY + HOUR, DAY + 4 * HOUR)),
            vec![
                (NotificationEvent::Started, DAY + 2 * HOUR),
                (NotificationEvent::Ended, DAY + 2 * HOUR),
            ],
            "a follow-up cancelled before the end lets the parent end"
        );
    }
}
