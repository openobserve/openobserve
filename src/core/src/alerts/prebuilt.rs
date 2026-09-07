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

//! Seeds the shipped prebuilt alerts into every org, disabled and unwired.
//!
//! The seed decision is per org per alert id, recorded in one org-scoped
//! `prebuilt_alerts_revision` setting holding `{ "<alert id>": <revision> }`,
//! so an alert the operator deletes is never re-planted.

use std::collections::HashMap;

use config::{
    META_ORG_ID, get_config,
    meta::{
        alerts::alert::Alert,
        folder::DEFAULT_FOLDER,
        system_settings::{SettingScope, SystemSetting},
    },
    prebuilt_alerts::{
        PREBUILT_ALERTS_REVISION_KEY, PrebuiltAlert, prebuilt_alert_definitions_for_org,
        prebuilt_alerts, should_seed_prebuilt_alert,
    },
};
use db::system_settings;

const LOCK_KEY: &str = "/system/alerts/prebuilt_seed";

type AppliedRevisions = HashMap<String, u32>;

/// The conditions `self_reporting::persistence` applies before writing a trigger
/// row into the originating org; `_meta` is an unconditional destination and
/// bypasses all of them.
#[derive(Debug, Clone, Copy)]
struct OwnOrgTriggerWrites {
    report_to_own_org: bool,
    mode_is_local: bool,
    within_free_trial: bool,
}

/// The shipped alerts all read `triggers`; seeding an org that never receives a
/// row leaves a permanently silent alert — pure so it's testable.
fn org_receives_trigger_rows(org_id: &str, writes: OwnOrgTriggerWrites) -> bool {
    org_id == META_ORG_ID
        || (writes.report_to_own_org && writes.mode_is_local && writes.within_free_trial)
}

/// Enterprise rewrites the mode to `local`/`both` before use, so `remote` can only
/// suppress the own-org copy in an OSS build.
fn reporting_mode_writes_own_org(mode: &str) -> bool {
    cfg!(feature = "enterprise") || mode != "remote"
}

/// Fail-closed like the write path: an org we cannot classify is not seeded.
async fn within_free_trial(_org_id: &str) -> bool {
    #[cfg(feature = "cloud")]
    {
        crate::organization::is_org_in_free_trial_period(_org_id)
            .await
            .unwrap_or(false)
    }
    #[cfg(not(feature = "cloud"))]
    {
        true
    }
}

/// Read the stored `{ "<alert id>": <revision> }` map, dropping any entry that
/// is not a `u32` — pure so it's testable without a DB.
fn applied_revisions_from_value(value: &serde_json::Value) -> AppliedRevisions {
    let Some(object) = value.as_object() else {
        return AppliedRevisions::new();
    };
    object
        .iter()
        .filter_map(|(id, revision)| Some((id.clone(), u32::try_from(revision.as_u64()?).ok()?)))
        .collect()
}

fn applied_revision(applied: &AppliedRevisions, id: &str) -> u32 {
    applied.get(id).copied().unwrap_or(0)
}

/// Returns whether the map actually changed, so an unchanged org is not rewritten.
fn record_applied_revision(applied: &mut AppliedRevisions, id: &str, revision: u32) -> bool {
    if applied.get(id) == Some(&revision) {
        return false;
    }
    applied.insert(id.to_string(), revision);
    true
}

/// A read failure is propagated rather than defaulted: writing a fresh map over
/// an unread one would drop the ids this org was already seeded.
async fn read_applied_revisions(org_id: &str) -> Result<AppliedRevisions, anyhow::Error> {
    let stored = system_settings::get(
        &SettingScope::Org,
        Some(org_id),
        None,
        PREBUILT_ALERTS_REVISION_KEY,
    )
    .await?;
    Ok(stored
        .map(|s| applied_revisions_from_value(&s.setting_value))
        .unwrap_or_default())
}

async fn write_applied_revisions(
    org_id: &str,
    applied: &AppliedRevisions,
) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let setting = SystemSetting {
        id: None,
        scope: SettingScope::Org,
        org_id: Some(org_id.to_string()),
        user_id: None,
        setting_key: PREBUILT_ALERTS_REVISION_KEY.to_string(),
        setting_category: Some("alerts".to_string()),
        setting_value: serde_json::to_value(applied)?,
        description: Some("Revision of each shipped prebuilt alert seeded into this org".into()),
        created_at: now,
        updated_at: now,
        created_by: None,
        updated_by: None,
    };
    system_settings::set(&setting).await?;
    Ok(())
}

/// `Ok(true)` means the alert was created and its revision must be recorded;
/// `Ok(false)` means it was skipped and must NOT be, so a later run retries.
async fn seed_one_prebuilt_alert(
    org_id: &str,
    shipped: &PrebuiltAlert,
    applied_rev: u32,
    definitions: &[Alert],
) -> Result<bool, anyhow::Error> {
    // Cheap half of the gate first: an org already seeded this id needs no lookup at all.
    if applied_rev != 0 {
        return Ok(false);
    }
    // `prepare_alert` rejects an alert whose stream has no schema; this read is cached.
    if !infra::schema::exists(org_id, shipped.stream_type, &shipped.stream_name).await {
        log::debug!(
            "[PREBUILT_ALERTS] org {org_id} has no stream '{}', deferring '{}'",
            shipped.stream_name,
            shipped.name
        );
        return Ok(false);
    }

    let exists = db::alerts::alert::get_by_name(
        org_id,
        shipped.stream_type,
        &shipped.stream_name,
        &shipped.name,
    )
    .await?
    .is_some();
    if !should_seed_prebuilt_alert(applied_rev, exists) {
        return Ok(false);
    }

    let Some(alert) = definitions.iter().find(|a| a.name == shipped.name) else {
        return Err(anyhow::anyhow!(
            "no seed definition for prebuilt alert '{}'",
            shipped.id
        ));
    };
    let conn = infra::db::get_orm_client_rw().await;
    crate::alerts::alert::create(conn, org_id, DEFAULT_FOLDER, alert.clone(), false).await?;
    Ok(true)
}

/// The `triggers` stream is created lazily on an org's first scheduled-job publish,
/// so an org with no alerts yet would never satisfy the schema check that seeding
/// needs — leaving the shipped alerts permanently unseedable.
async fn bootstrap_seed_streams(org_id: &str) {
    if let Err(e) =
        crate::self_reporting::triggers_schema::ensure_triggers_stream_initialized(org_id).await
    {
        log::warn!("[PREBUILT_ALERTS] could not initialise triggers stream for org {org_id}: {e}");
    }
}

/// Seed every shipped prebuilt alert this org has not been seeded before.
pub async fn seed_prebuilt_alerts_for_org(org_id: &str) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let writes = OwnOrgTriggerWrites {
        report_to_own_org: cfg.common.usage_report_to_own_org,
        mode_is_local: reporting_mode_writes_own_org(&cfg.common.usage_reporting_mode),
        within_free_trial: within_free_trial(org_id).await,
    };
    if !org_receives_trigger_rows(org_id, writes) {
        return Ok(());
    }

    let mut applied = read_applied_revisions(org_id).await?;
    let Some(definitions) = prebuilt_alert_definitions_for_org(org_id) else {
        log::warn!("[PREBUILT_ALERTS] org id {org_id} cannot be scoped into SQL, not seeding");
        return Ok(());
    };
    let mut changed = false;

    if prebuilt_alerts()
        .alerts
        .iter()
        .any(|shipped| applied_revision(&applied, &shipped.id) == 0)
    {
        bootstrap_seed_streams(org_id).await;
    }

    for shipped in &prebuilt_alerts().alerts {
        let applied_rev = applied_revision(&applied, &shipped.id);
        match seed_one_prebuilt_alert(org_id, shipped, applied_rev, &definitions).await {
            Ok(true) => {
                changed |= record_applied_revision(&mut applied, &shipped.id, shipped.revision);
                log::info!(
                    "[PREBUILT_ALERTS] seeded '{}' into org {org_id}",
                    shipped.name
                );
            }
            Ok(false) => {}
            Err(e) => log::error!(
                "[PREBUILT_ALERTS] failed to seed '{}' into org {org_id}: {e}",
                shipped.name
            ),
        }
    }

    if changed {
        write_applied_revisions(org_id, &applied).await?;
    }
    Ok(())
}

/// Idempotent startup backfill: seed every org, under one dist_lock.
///
/// The org-creation hooks seed OUTSIDE that lock and the revision map is
/// read-modify-write, so a concurrent seed of the same org is a check-then-act
/// race whose worst case is a duplicate alert row: nothing below this function
/// enforces alert-name uniqueness. A lost revision write only costs a repeated
/// no-op seed, since an existing alert is never re-planted.
pub async fn seed_prebuilt_alerts() -> Result<(), anyhow::Error> {
    use infra::dist_lock;

    let locker = dist_lock::lock(LOCK_KEY, 0).await?;

    let orgs = crate::organization::list_all_orgs(None)
        .await
        .unwrap_or_default();
    let mut failed = 0;
    for org in &orgs {
        if let Err(e) = seed_prebuilt_alerts_for_org(&org.identifier).await {
            failed += 1;
            log::error!(
                "[PREBUILT_ALERTS] seeding failed for org {}: {e}",
                org.identifier
            );
        }
    }

    dist_lock::unlock(&locker).await?;
    drop(locker);

    log::info!(
        "[PREBUILT_ALERTS] seeding complete: {}/{} orgs processed without error",
        orgs.len() - failed,
        orgs.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn writes(
        report_to_own_org: bool,
        mode_is_local: bool,
        within_free_trial: bool,
    ) -> OwnOrgTriggerWrites {
        OwnOrgTriggerWrites {
            report_to_own_org,
            mode_is_local,
            within_free_trial,
        }
    }

    /// Seeding an alert into an org that can never receive its rows would leave a
    /// permanently silent alert and re-scan that org on every boot.
    #[test]
    fn only_orgs_that_receive_trigger_rows_are_seeded() {
        assert!(org_receives_trigger_rows("acme", writes(true, true, true)));
        assert!(
            !org_receives_trigger_rows("acme", writes(false, true, true)),
            "without own-org reporting a tenant org never sees a trigger row"
        );
    }

    /// `_meta` is an unconditional destination in `self_reporting::persistence`, so
    /// none of the own-org conditions apply to it.
    #[test]
    fn meta_is_seeded_whatever_the_own_org_conditions_say() {
        for w in [
            writes(true, true, true),
            writes(false, false, false),
            writes(false, true, false),
            writes(true, false, false),
        ] {
            assert!(org_receives_trigger_rows(META_ORG_ID, w));
        }
    }

    /// The cloud trial gate skips the own-org write for a past-trial org, so seeding
    /// one ships alerts that can never evaluate to anything.
    #[test]
    fn an_org_past_its_free_trial_is_not_seeded() {
        assert!(!org_receives_trigger_rows(
            "acme",
            writes(true, true, false)
        ));
    }

    /// `ZO_USAGE_REPORTING_MODE=remote` suppresses only the own-org copy.
    #[test]
    fn an_org_reporting_only_remotely_is_not_seeded() {
        assert!(!org_receives_trigger_rows(
            "acme",
            writes(true, false, true)
        ));
        assert!(org_receives_trigger_rows(
            META_ORG_ID,
            writes(true, false, true)
        ));
    }

    #[test]
    fn only_remote_mode_suppresses_the_own_org_copy() {
        assert!(reporting_mode_writes_own_org("local"));
        assert!(reporting_mode_writes_own_org("both"));
        assert_eq!(
            reporting_mode_writes_own_org("remote"),
            cfg!(feature = "enterprise"),
            "enterprise rewrites remote to both, so it never suppresses there"
        );
    }

    #[test]
    fn applied_revisions_parse_a_stored_object() {
        let applied =
            applied_revisions_from_value(&serde_json::json!({"alert_a": 1, "alert_b": 7}));
        assert_eq!(applied_revision(&applied, "alert_a"), 1);
        assert_eq!(applied_revision(&applied, "alert_b"), 7);
    }

    #[test]
    fn a_missing_id_is_applied_revision_zero() {
        let applied = applied_revisions_from_value(&serde_json::json!({"alert_a": 3}));
        assert_eq!(applied_revision(&applied, "never_seeded"), 0);
        assert_eq!(applied_revision(&AppliedRevisions::new(), "alert_a"), 0);
    }

    #[test]
    fn garbled_entries_default_to_zero_without_dropping_good_ones() {
        let applied = applied_revisions_from_value(&serde_json::json!({
            "good": 2,
            "stringy": "3",
            "negative": -1,
            "floaty": 1.5,
            "nully": null,
            "listy": [1],
            "objecty": {"revision": 1},
            "too_big": u64::from(u32::MAX) + 1,
        }));
        assert_eq!(applied_revision(&applied, "good"), 2);
        for id in [
            "stringy", "negative", "floaty", "nully", "listy", "objecty", "too_big",
        ] {
            assert_eq!(applied_revision(&applied, id), 0, "{id} must default to 0");
        }
    }

    #[test]
    fn a_non_object_setting_value_yields_no_applied_revisions() {
        for value in [
            serde_json::json!(null),
            serde_json::json!(1),
            serde_json::json!("1"),
            serde_json::json!([1, 2]),
        ] {
            assert!(applied_revisions_from_value(&value).is_empty());
            assert_eq!(
                applied_revision(&applied_revisions_from_value(&value), "a"),
                0
            );
        }
    }

    #[test]
    fn record_applied_revision_reports_whether_it_changed() {
        let mut applied = AppliedRevisions::new();
        assert!(record_applied_revision(&mut applied, "alert_a", 1));
        assert_eq!(applied_revision(&applied, "alert_a"), 1);
        assert!(!record_applied_revision(&mut applied, "alert_a", 1));
        assert!(record_applied_revision(&mut applied, "alert_a", 2));
        assert_eq!(applied_revision(&applied, "alert_a"), 2);
        assert!(record_applied_revision(&mut applied, "alert_b", 1));
        assert_eq!(applied.len(), 2);
    }

    #[test]
    fn a_recorded_map_round_trips_through_the_stored_value() {
        let mut applied = AppliedRevisions::new();
        record_applied_revision(&mut applied, "alert_a", 4);
        let value = serde_json::to_value(&applied).unwrap();
        assert_eq!(applied_revisions_from_value(&value), applied);
    }

    /// `seed_one_prebuilt_alert` matches shipped alerts to seed definitions by
    /// name, so a name that exists in one and not the other seeds nothing.
    #[test]
    fn every_shipped_alert_has_a_definition_with_the_same_name() {
        let definitions = prebuilt_alert_definitions_for_org("acme").expect("acme is legal");
        for shipped in &prebuilt_alerts().alerts {
            assert!(
                definitions.iter().any(|a| a.name == shipped.name),
                "prebuilt alert {} has no seed definition",
                shipped.id
            );
        }
    }
}
