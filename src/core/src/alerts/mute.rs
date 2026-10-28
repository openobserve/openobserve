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

//! Alert-scoped quick mutes (§6, Q1): the ack rule decides who may mute, a downtime mutes.

use std::collections::{BTreeMap, BTreeSet};

use config::{
    meta::{
        alerts::{ack::ActRefusal, state::ROLLUP_GROUP_KEY},
        downtimes::{
            AlertGroupRef, AlertMuteConflict, AlertMuteExtendRequest, AlertMuteExtendResponse,
            AlertMuteRequest, AlertMuteResponse, Downtime, DowntimeRequest, DowntimeSchedule,
            DowntimeTarget, EndOnClear, IncidentMode, MAX_ALERT_GROUPS, MuteSource, Repeat,
            TargetFolders, TargetModule,
        },
        folder::DEFAULT_FOLDER,
    },
    utils::time::now_micros,
};
use o2_enterprise::enterprise::downtimes::{MAX_NAME_LEN, schedule};

use crate::{
    alerts::{
        ack::{self, AckTarget, Act},
        lifecycle,
    },
    downtimes::{self, DowntimeError},
};

/// How long "Until it clears" lasts when the alert never clears (AC-P2.4.6).
pub const UNTIL_CLEAR_MICROS: i64 = 24 * 3600 * 1_000_000;
/// The longest timed quick mute, the on-call snooze cap a Slack mute also sets.
pub const MAX_MUTE_MINUTES: u32 = 1440;
const MICROS_PER_MINUTE: i64 = 60 * 1_000_000;
const MICROS_PER_SEC: i64 = 1_000_000;

#[derive(Debug)]
pub enum MuteError {
    Refused(ActRefusal),
    Conflict(AlertMuteConflict),
    Downtime(DowntimeError),
}

impl From<DowntimeError> for MuteError {
    fn from(e: DowntimeError) -> Self {
        Self::Downtime(e)
    }
}

/// Mutes the alert, or the named groups of a multi-alert, with a one-time downtime.
pub async fn mute(
    target: &AckTarget,
    req: &AlertMuteRequest,
    actor: &str,
    source: MuteSource,
) -> Result<AlertMuteResponse, MuteError> {
    downtimes::ensure_enabled()?;
    ack::authorize(target, actor, Act::Mute)
        .await
        .map_err(MuteError::Refused)?;
    authorize_folder(&target.org_id, actor, req).await?;
    let now = now_micros();
    let ends_at = requested_end(req.until_clear, req.minutes, req.ends_at, now)?;
    let groups = requested_groups(target, req).await?;
    let rows = db::downtimes::list_cached(&target.org_id);
    if let Some(live) = covering_mute(&rows, &target.alert_id, groups.as_deref(), now) {
        return Err(MuteError::Conflict(AlertMuteConflict::AlreadyMuted {
            downtime_id: live.id.clone(),
            version: live.version,
            ends_at: end_of(live),
        }));
    }
    if let Some(message) = downtimes::cap_reached(&target.org_id) {
        return Err(MuteError::Conflict(AlertMuteConflict::DowntimeCap {
            message,
        }));
    }
    let end_on_clear = req
        .until_clear
        .then(|| until_clear_of(&target.alert_id, groups.as_deref()));
    let request = quick_mute_request(target, req, now, ends_at, groups, end_on_clear);
    let row = downtimes::create_for_alert(&target.org_id, actor, request, source).await?;
    lifecycle::on_view_changed(&target.org_id, &target.alert_id, single_group(&row)).await;
    Ok(AlertMuteResponse {
        downtime_id: row.id,
        version: row.version,
        ends_at,
        end_on_clear: row.end_on_clear,
        alert_groups: row.alert_groups,
    })
}

/// Moves the end of a quick mute of this alert; a stale `version` is a 409 with the current end.
pub async fn extend(
    target: &AckTarget,
    downtime_id: &str,
    req: &AlertMuteExtendRequest,
    actor: &str,
) -> Result<AlertMuteExtendResponse, MuteError> {
    downtimes::ensure_enabled()?;
    ack::authorize(target, actor, Act::Mute)
        .await
        .map_err(MuteError::Refused)?;
    let row = quick_mute_of(target, downtime_id).await?;
    if req.version != row.version {
        return Err(version_changed(&row));
    }
    let (new_end, end_on_clear) = extended_end(&row, req, now_micros())?;
    let after = match downtimes::extend_quick_mute(
        &target.org_id,
        actor,
        &row,
        new_end,
        end_on_clear,
    )
    .await
    {
        Ok(after) => after,
        Err(DowntimeError::Conflict(_)) => {
            let current = quick_mute_of(target, downtime_id).await?;
            return Err(version_changed(&current));
        }
        Err(e) => return Err(e.into()),
    };
    lifecycle::on_view_changed(&target.org_id, &target.alert_id, single_group(&after)).await;
    Ok(AlertMuteExtendResponse {
        version: after.version,
        ends_at: new_end,
        end_on_clear: after.end_on_clear,
    })
}

/// Ends a quick mute of this alert now.
pub async fn unmute(
    target: &AckTarget,
    downtime_id: &str,
    actor: &str,
) -> Result<Downtime, MuteError> {
    downtimes::ensure_enabled()?;
    ack::authorize(target, actor, Act::Mute)
        .await
        .map_err(MuteError::Refused)?;
    let row = quick_mute_of(target, downtime_id).await?;
    let after = downtimes::cancel_quick_mute(&target.org_id, actor, row).await?;
    lifecycle::on_view_changed(&target.org_id, &target.alert_id, single_group(&after)).await;
    Ok(after)
}

/// Cancels the Until-it-clears mutes a clear ends (§6.3), before anything reads downtimes for it.
pub async fn end_on_clear(org_id: &str, alert_id: &str, group_key: &str, cleared_at: i64) {
    if !crate::alerts::downtimes::enabled() {
        return;
    }
    let rows = db::downtimes::list_cached(org_id);
    let candidates: Vec<&Downtime> = rows
        .iter()
        .filter(|row| {
            row.end_on_clear
                .as_ref()
                .is_some_and(|end| end.alert_id == alert_id)
                && downtimes::ends_on_clear(row, cleared_at)
        })
        .collect();
    if candidates.is_empty() {
        return;
    }
    let firing = match firing_after_clear(alert_id, group_key).await {
        Ok(firing) => Some(firing),
        Err(e) => {
            log::error!(
                "[ALERT_MUTE] could not list the firing groups of {org_id}/{alert_id}; only \
                 one-group mutes end on this clear: {e}"
            );
            None
        }
    };
    for row in candidates {
        if !clear_ends(row, alert_id, group_key, firing.as_deref()) {
            continue;
        }
        match downtimes::cancel_on_clear(org_id, &row.id, cleared_at).await {
            Ok(_) => {}
            Err(e) => log::error!(
                "[ALERT_MUTE] could not end {org_id}/{} on the clear of {alert_id}/{group_key:?}: {e}",
                row.id
            ),
        }
    }
}

/// One-time, no condition, and exactly this alert as its only target: what an alert route writes.
pub fn is_quick_mute(row: &Downtime, alert_id: &str) -> bool {
    let [target] = row.targets.as_slice() else {
        return false;
    };
    row.schedule.repeat == Repeat::None
        && row.condition.is_none()
        && target.module == TargetModule::Alerts
        && target.tags.is_empty()
        && target.ids.len() == 1
        && target.ids[0] == alert_id
}

/// The alert-route caller as the downtime row records it; the web app's own calls are OpenObserve.
pub fn source_of(ack_source: config::meta::alerts::ack::AckSource) -> MuteSource {
    use config::meta::alerts::ack::AckSource;
    match ack_source {
        AckSource::Slack => MuteSource::Slack,
        AckSource::Ui => MuteSource::Openobserve,
        _ => MuteSource::Api,
    }
}

/// Whether a clear of `group_key` ends `row`, given the alert's groups still `firing` (`None`
/// when unknown, which ends only a one-group mute). [pure]
fn clear_ends(row: &Downtime, alert_id: &str, group_key: &str, firing: Option<&[String]>) -> bool {
    let Some(end) = row
        .end_on_clear
        .as_ref()
        .filter(|end| end.alert_id == alert_id)
    else {
        return false;
    };
    match (end.group_key.as_deref(), row.alert_groups.as_deref()) {
        (Some(key), _) if !key.is_empty() => key == group_key,
        (_, Some(groups)) if !groups.is_empty() => {
            firing.is_some_and(|firing| !groups.iter().any(|g| firing.contains(&g.group_key)))
        }
        _ => firing.is_some_and(<[String]>::is_empty),
    }
}

/// The alert's groups still firing after this clear; a rollup clear leaves none.
async fn firing_after_clear(
    alert_id: &str,
    group_key: &str,
) -> Result<Vec<String>, infra::errors::Error> {
    if group_key == ROLLUP_GROUP_KEY {
        return Ok(vec![]);
    }
    let rows = infra::table::alert_states::firing_groups(alert_id, None).await?;
    Ok(rows.into_iter().map(|(key, _)| key).collect())
}

/// Exactly one of the three ends; Until it clears is a 24 h one-time row that the clear cuts short.
fn requested_end(
    until_clear: bool,
    minutes: Option<u32>,
    ends_at: Option<i64>,
    now: i64,
) -> Result<i64, MuteError> {
    let bad = |m: &str| MuteError::Downtime(DowntimeError::BadRequest(m.to_string()));
    match (until_clear, minutes, ends_at) {
        (true, None, None) => Ok(now + UNTIL_CLEAR_MICROS),
        (false, Some(m), None) if (1..=MAX_MUTE_MINUTES).contains(&m) => {
            Ok(now + i64::from(m) * MICROS_PER_MINUTE)
        }
        (false, Some(_), None) => Err(bad("minutes must be between 1 and 1440.")),
        (false, None, Some(end)) if end > now => Ok(end),
        (false, None, Some(_)) => Err(bad("ends_at must be in the future.")),
        _ => Err(bad("Give exactly one of until_clear, minutes and ends_at.")),
    }
}

/// Minutes count from max(current end, now); from now on an Until-it-clears row.
fn extended_end(
    row: &Downtime,
    req: &AlertMuteExtendRequest,
    now: i64,
) -> Result<(i64, Option<EndOnClear>), MuteError> {
    if req.until_clear && req.minutes.is_none() && req.ends_at.is_none() {
        let end = until_clear_of(&row.targets[0].ids[0], row.alert_groups.as_deref());
        return Ok((now + UNTIL_CLEAR_MICROS, Some(end)));
    }
    let from = if row.end_on_clear.is_some() {
        now
    } else {
        end_of(row).max(now)
    };
    let end = requested_end(req.until_clear, req.minutes, req.ends_at, from)?;
    Ok((end, None))
}

/// The groups a mute names; `None` mutes the whole alert, as `all_groups` asks.
async fn requested_groups(
    target: &AckTarget,
    req: &AlertMuteRequest,
) -> Result<Option<Vec<AlertGroupRef>>, MuteError> {
    let bad = |m: String| MuteError::Downtime(DowntimeError::BadRequest(m));
    let keys: BTreeSet<&str> = req
        .group_keys
        .iter()
        .flatten()
        .map(String::as_str)
        .filter(|k| !k.is_empty())
        .collect();
    if req.all_groups || keys.is_empty() {
        return Ok(None);
    }
    if !target.multi_alert {
        return Err(bad(
            "This alert has no groups; mute it as a whole.".to_string()
        ));
    }
    if keys.len() > MAX_ALERT_GROUPS {
        return Err(bad(format!(
            "A mute can name at most {MAX_ALERT_GROUPS} groups; mute all groups instead."
        )));
    }
    let mut groups = Vec::with_capacity(keys.len());
    for key in keys {
        let state = infra::table::alert_states::get(&target.alert_id, key)
            .await
            .map_err(|e| MuteError::Downtime(e.into()))?
            .ok_or_else(|| bad(format!("Group {key} is not tracked for this alert.")))?;
        groups.push(AlertGroupRef {
            alert_id: target.alert_id.clone(),
            group_key: key.to_string(),
            group_labels: state.group_labels.as_deref().map(parse_labels),
        });
    }
    Ok(Some(groups))
}

/// `k=v,k=v` as rendered for display; a value holding a separator splits wrongly, display only.
fn parse_labels(rendered: &str) -> BTreeMap<String, String> {
    rendered
        .split(',')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

/// A live quick mute of the alert that already covers every requested group.
fn covering_mute<'a>(
    rows: &'a [Downtime],
    alert_id: &str,
    groups: Option<&[AlertGroupRef]>,
    now: i64,
) -> Option<&'a Downtime> {
    rows.iter().find(|row| {
        is_quick_mute(row, alert_id)
            && row.cancelled_at.is_none_or(|at| at > now)
            && schedule::window_at(&row.schedule, now).is_some()
            && covers(row.alert_groups.as_deref(), groups)
    })
}

fn covers(have: Option<&[AlertGroupRef]>, want: Option<&[AlertGroupRef]>) -> bool {
    let have = have.unwrap_or_default();
    if have.is_empty() {
        return true;
    }
    want.is_some_and(|want| {
        want.iter()
            .all(|w| have.iter().any(|h| h.group_key == w.group_key))
    })
}

/// One group ends on that group's clear; several groups once none of them fires; the whole alert
/// once no group fires.
fn until_clear_of(alert_id: &str, groups: Option<&[AlertGroupRef]>) -> EndOnClear {
    let group_key = match groups {
        Some([one]) => Some(one.group_key.clone()),
        _ => None,
    };
    EndOnClear {
        alert_id: alert_id.to_string(),
        group_key,
    }
}

fn single_group(row: &Downtime) -> Option<&str> {
    match row.alert_groups.as_deref() {
        Some([one]) => Some(one.group_key.as_str()),
        _ => None,
    }
}

fn end_of(row: &Downtime) -> i64 {
    row.schedule.ends_at.unwrap_or_default()
}

fn version_changed(row: &Downtime) -> MuteError {
    MuteError::Conflict(AlertMuteConflict::VersionChanged {
        version: row.version,
        ends_at: end_of(row),
    })
}

async fn quick_mute_of(target: &AckTarget, downtime_id: &str) -> Result<Downtime, MuteError> {
    let row = downtimes::get_row(&target.org_id, downtime_id).await?;
    if !is_quick_mute(&row, &target.alert_id) {
        return Err(MuteError::Conflict(AlertMuteConflict::NotAQuickMute));
    }
    Ok(row)
}

/// The downtime folder the caller names; none files the mute in the default folder. [pure]
fn named_folder(req: &AlertMuteRequest) -> Option<&str> {
    req.folder_id
        .as_deref()
        .map(str::trim)
        .filter(|f| !f.is_empty())
}

/// A named folder needs the write access creating a downtime there needs; the default folder
/// stays open so a responder with no downtime folder can still mute.
async fn authorize_folder(
    org_id: &str,
    actor: &str,
    req: &AlertMuteRequest,
) -> Result<(), MuteError> {
    let Some(folder) = named_folder(req) else {
        return Ok(());
    };
    if crate::auth::check_folder_write_permissions(org_id, actor, "downtime_folders", folder).await
    {
        return Ok(());
    }
    Err(MuteError::Downtime(DowntimeError::Forbidden(
        "You cannot create downtimes in this folder.".to_string(),
    )))
}

/// Filed in the request's folder, else the default downtimes folder, created on first use.
fn quick_mute_request(
    target: &AckTarget,
    req: &AlertMuteRequest,
    now: i64,
    ends_at: i64,
    alert_groups: Option<Vec<AlertGroupRef>>,
    end_on_clear: Option<EndOnClear>,
) -> DowntimeRequest {
    let folder_id = named_folder(req).unwrap_or(DEFAULT_FOLDER).to_string();
    DowntimeRequest {
        folder_id,
        name: Some(
            format!("Quick mute · {}", target.name)
                .chars()
                .take(MAX_NAME_LEN)
                .collect(),
        ),
        reason: req
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(str::to_string),
        condition: None,
        targets: vec![DowntimeTarget {
            module: TargetModule::Alerts,
            folders: TargetFolders::All,
            tags: vec![],
            ids: vec![target.alert_id.clone()],
            slo_mode: None,
            incident_mode: IncidentMode::default(),
        }],
        schedule: DowntimeSchedule {
            repeat: Repeat::None,
            starts_at: now,
            ends_at: Some(ends_at),
            timezone: "UTC".to_string(),
            start_time_local: None,
            duration_secs: (ends_at - now) / MICROS_PER_SEC,
            weekdays: vec![],
        },
        show_banner: false,
        notifications: None,
        version: None,
        alert_groups,
        end_on_clear,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000_000;
    const HOUR: i64 = 3600 * 1_000_000;

    fn target(multi: bool) -> AckTarget {
        AckTarget {
            org_id: "default".to_string(),
            alert_id: "a1".to_string(),
            name: "checkout errors".to_string(),
            folder_id: "default".to_string(),
            multi_alert: multi,
            composite: false,
            silence_micros: 0,
            evaluates_through_silence: false,
        }
    }

    fn group(key: &str) -> AlertGroupRef {
        AlertGroupRef {
            alert_id: "a1".to_string(),
            group_key: key.to_string(),
            group_labels: None,
        }
    }

    fn row(groups: Option<Vec<AlertGroupRef>>, end: Option<EndOnClear>) -> Downtime {
        let req = quick_mute_request(
            &target(true),
            &AlertMuteRequest::default(),
            NOW,
            NOW + HOUR,
            groups,
            end,
        );
        Downtime {
            id: "d1".to_string(),
            org: "default".to_string(),
            folder_id: req.folder_id,
            name: req.name.unwrap_or_default(),
            reason: None,
            condition: None,
            targets: req.targets,
            alert_groups: req.alert_groups,
            end_on_clear: req.end_on_clear,
            source: Some(MuteSource::Slack),
            schedule: req.schedule,
            cancelled_at: None,
            cancelled_by: None,
            show_banner: false,
            notifications: None,
            origin_region: None,
            version: 1,
            created_by: "u".to_string(),
            created_at: NOW,
            updated_by: "u".to_string(),
            updated_at: NOW,
        }
    }

    #[tokio::test]
    async fn a_named_folder_needs_write_access_and_no_folder_needs_none() {
        let named = AlertMuteRequest {
            folder_id: Some("prod-oncall".to_string()),
            ..Default::default()
        };
        assert!(matches!(
            authorize_folder("default", "nobody@example.com", &named).await,
            Err(MuteError::Downtime(DowntimeError::Forbidden(_)))
        ));
        let blank = AlertMuteRequest {
            folder_id: Some(" ".to_string()),
            ..Default::default()
        };
        assert!(
            authorize_folder("default", "nobody@example.com", &blank)
                .await
                .is_ok()
        );
        assert!(
            authorize_folder(
                "default",
                "nobody@example.com",
                &AlertMuteRequest::default()
            )
            .await
            .is_ok()
        );
    }

    #[test]
    fn until_it_clears_lasts_24_hours_when_nothing_clears_it() {
        assert_eq!(
            requested_end(true, None, None, NOW).unwrap(),
            NOW + 24 * HOUR
        );
        assert_eq!(
            requested_end(false, Some(30), None, NOW).unwrap(),
            NOW + HOUR / 2
        );
        assert!(requested_end(false, Some(1441), None, NOW).is_err());
        assert!(requested_end(false, Some(0), None, NOW).is_err());
        assert!(requested_end(true, Some(30), None, NOW).is_err());
        assert!(requested_end(false, None, Some(NOW), NOW).is_err());
        assert!(requested_end(false, None, None, NOW).is_err());
    }

    #[test]
    fn a_quick_mute_is_one_time_and_names_only_its_alert() {
        let r = row(None, None);
        assert_eq!(r.name, "Quick mute · checkout errors");
        assert_eq!(
            r.folder_id, DEFAULT_FOLDER,
            "filed in the default folder when none is given"
        );
        assert!(is_quick_mute(&r, "a1"));
        assert!(!is_quick_mute(&r, "a2"));
        let mut two = r.clone();
        two.targets[0].ids.push("a2".to_string());
        assert!(!is_quick_mute(&two, "a1"));
        let mut daily = r.clone();
        daily.schedule.repeat = Repeat::Daily;
        assert!(!is_quick_mute(&daily, "a1"));
    }

    #[test]
    fn a_clear_ends_only_the_until_it_clears_mute_of_its_own_group() {
        let one = row(
            Some(vec![group("k1")]),
            Some(until_clear_of("a1", Some(&[group("k1")]))),
        );
        let still = ["k2".to_string()];
        assert!(clear_ends(&one, "a1", "k1", Some(&still)));
        assert!(
            !clear_ends(&one, "a1", "k2", Some(&still)),
            "another group's clear leaves it"
        );
        assert!(!clear_ends(&one, "a2", "k1", Some(&[])));
        assert!(
            clear_ends(&one, "a1", "k1", None),
            "its own clear ends it even when the firing groups cannot be read"
        );
        let whole = row(None, Some(until_clear_of("a1", None)));
        assert!(
            !clear_ends(&whole, "a1", "k1", Some(&still)),
            "a group clears while another fires"
        );
        assert!(clear_ends(&whole, "a1", "k1", Some(&[])));
        assert!(clear_ends(&whole, "a1", ROLLUP_GROUP_KEY, Some(&[])));
        let timed = row(None, None);
        assert!(
            !clear_ends(&timed, "a1", ROLLUP_GROUP_KEY, Some(&[])),
            "a timed mute outlives the clear"
        );
    }

    #[test]
    fn a_mute_of_several_groups_ends_once_none_of_them_fires() {
        let groups = vec![group("a"), group("b")];
        let both = row(
            Some(groups.clone()),
            Some(until_clear_of("a1", Some(&groups))),
        );
        let c = "c".to_string();
        assert!(
            !clear_ends(&both, "a1", "a", Some(&["b".to_string(), c.clone()])),
            "b still fires"
        );
        assert!(
            clear_ends(&both, "a1", "b", Some(&[c])),
            "an unmuted group firing does not hold the mute"
        );
        assert!(
            !clear_ends(&both, "a1", "b", None),
            "unknown firing groups keep it to its 24 h end"
        );
    }

    #[test]
    fn a_whole_alert_mute_covers_any_group_and_a_group_mute_only_its_own() {
        let whole = row(None, None);
        let rows = [whole];
        assert!(covering_mute(&rows, "a1", None, NOW + 1).is_some());
        assert!(covering_mute(&rows, "a1", Some(&[group("k1")]), NOW + 1).is_some());
        assert!(
            covering_mute(&rows, "a1", None, NOW + 2 * HOUR).is_none(),
            "ended"
        );
        let rows = [row(Some(vec![group("k1")]), None)];
        assert!(covering_mute(&rows, "a1", Some(&[group("k1")]), NOW + 1).is_some());
        assert!(covering_mute(&rows, "a1", Some(&[group("k2")]), NOW + 1).is_none());
        assert!(covering_mute(&rows, "a1", None, NOW + 1).is_none());
    }

    #[test]
    fn extending_an_until_it_clears_mute_by_minutes_counts_from_now_and_drops_the_clear() {
        let until = row(None, Some(until_clear_of("a1", None)));
        let req = AlertMuteExtendRequest {
            version: 1,
            minutes: Some(60),
            until_clear: false,
            ends_at: None,
        };
        let (end, on_clear) = extended_end(&until, &req, NOW + 10).unwrap();
        assert_eq!((end, on_clear), (NOW + 10 + HOUR, None));
        let timed = row(None, None);
        let (end, _) = extended_end(&timed, &req, NOW + 10).unwrap();
        assert_eq!(end, NOW + 2 * HOUR, "minutes are added to the current end");
        let to_clear = AlertMuteExtendRequest {
            minutes: None,
            until_clear: true,
            ..req
        };
        let (end, on_clear) = extended_end(&timed, &to_clear, NOW + 10).unwrap();
        assert_eq!(end, NOW + 10 + 24 * HOUR);
        assert_eq!(on_clear, Some(until_clear_of("a1", None)));
    }

    #[test]
    fn labels_parse_into_a_map_and_sources_map_the_web_app_to_openobserve() {
        assert_eq!(
            parse_labels("city=pune,env=prod"),
            BTreeMap::from([
                ("city".to_string(), "pune".to_string()),
                ("env".to_string(), "prod".to_string()),
            ])
        );
        use config::meta::alerts::ack::AckSource;
        assert_eq!(source_of(AckSource::Ui), MuteSource::Openobserve);
        assert_eq!(source_of(AckSource::Slack), MuteSource::Slack);
        assert_eq!(source_of(AckSource::Api), MuteSource::Api);
    }
}
