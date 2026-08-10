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

//! SLO lifecycle — the operations behind the HTTP layer (`alerts_2.md` §6b).
//!
//! Save is the interesting one, because four things have to happen together
//! and the order matters:
//!
//! 1. **validate** the definition (§6b.7) — a bad SLI must never reach the budget;
//! 2. **charge** the org's row budget, which is where a create is actually rejected (S-14);
//! 3. **persist**, bumping the generation if the definition changed (D59);
//! 4. **schedule** the ingest job and, for a fresh generation, the backfill.
//!
//! Charging before persisting is deliberate. The reverse — save, then charge,
//! then roll back on rejection — leaves a window where the SLO exists
//! uncharged, and concurrent creates in that window each see headroom the
//! other has already taken.

use std::str::FromStr as _;

use config::{
    get_config,
    meta::{
        folder::{DEFAULT_FOLDER, FolderType},
        slo::{
            Slo, SloValidationError,
            budget_rows::{groups_reserved, rows_for_reservation},
            validate_query_safety, validate_slo,
        },
    },
    utils::time::now_micros,
};
use infra::table::{
    folders, slo_backfill_jobs as backfill_jobs, slo_budget, slos as slos_table,
    slos::GenerationEffect,
};
use svix_ksuid::Ksuid;

/// Why a save was rejected.
#[derive(Debug)]
pub enum SloError {
    Validation(String),
    Budget(String),
    NotFound,
    /// A name already taken in this folder. Its own variant so the handler can
    /// answer 409 with a sentence, instead of leaking
    /// `UNIQUE constraint failed: slos.org, slos.folder_id, slos.name` from a
    /// 500 — which is what it did before end-to-end testing.
    DuplicateName(String),
    /// The destination folder does not exist. Its own variant so the handler
    /// can answer 404 instead of persisting an SLO into a folder nothing will
    /// ever list — `slos.folder_id` carries no foreign key, so an unchecked
    /// id is accepted by the database and then invisible in the UI.
    FolderNotFound(String),
    /// A move collided with a same-named SLO already in the destination. The
    /// unique index fails the whole statement without naming the loser, so
    /// this carries no name — and nothing moved.
    MoveNameConflict,
    Db(String),
}

impl std::fmt::Display for SloError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(m) | Self::Budget(m) | Self::Db(m) => write!(f, "{m}"),
            Self::NotFound => write!(f, "SLO not found"),
            Self::DuplicateName(n) => {
                write!(f, "an SLO named \"{n}\" already exists in this folder")
            }
            Self::FolderNotFound(id) => write!(f, "folder \"{id}\" not found"),
            Self::MoveNameConflict => write!(
                f,
                "the destination folder already has an SLO with one of these names; nothing was moved"
            ),
        }
    }
}

impl std::error::Error for SloError {}

impl From<SloValidationError> for SloError {
    fn from(e: SloValidationError) -> Self {
        Self::Validation(e.to_string())
    }
}

impl From<infra::errors::Error> for SloError {
    fn from(e: infra::errors::Error) -> Self {
        Self::Db(e.to_string())
    }
}

/// Recognize the unique-index violation across backends.
///
/// Matched on the message because the three supported stores word it
/// differently and none surfaces a portable error code through sea-orm:
/// SQLite says `UNIQUE constraint failed`, Postgres `duplicate key value
/// violates unique constraint`, MySQL `Duplicate entry`.
fn is_duplicate_name(e: &infra::errors::Error) -> bool {
    let m = e.to_string().to_lowercase();
    (m.contains("unique") || m.contains("duplicate")) && m.contains("slos")
}

/// Validate a definition without saving it — shared by create and update so
/// the two cannot drift.
///
/// Async because an `alert` SLI is validated against **facts about its source
/// alert**, and those have to be read. Validation itself stays pure: the
/// lookup happens here and the rules run in [`validate_with_facts`].
pub async fn validate(slo: &Slo) -> Result<(), SloError> {
    validate_with_facts(slo, load_source_alert_facts(slo).await?)
}

/// The pure half of [`validate`]. `source_alert` is `None` when the SLI is not
/// an alert SLI, or when the source could not be loaded — which is itself a
/// rejection (`AlertSliSourceUnknown`), not a pass.
fn validate_with_facts(
    slo: &Slo,
    source_alert: Option<config::meta::slo::SourceAlertFacts>,
) -> Result<(), SloError> {
    validate_slo(&slo.definition, slo.target, source_alert)?;
    let group_by = slo.definition.group_by.clone().unwrap_or_default();
    validate_query_safety(
        &slo.definition.sli_config,
        &group_by,
        slo.definition.slice_interval_secs,
    )
    .map_err(|e| SloError::Validation(e.to_string()))?;
    Ok(())
}

/// Read the source alert an `alert` SLI points at, and reduce it to facts.
///
/// `Ok(None)` means "there is no source to describe": the SLI is not an alert
/// SLI, the id does not parse, or no such alert exists. `validate_slo` turns
/// the last two into `AlertSliSourceUnknown`, and distinguishing "no such
/// alert" from "the id is malformed" would only give the API two ways to say
/// the same thing.
///
/// A **database failure is not that**, and must not be laundered into it. A
/// meta-DB blip would otherwise refuse an edit to a long-standing, still-valid
/// alert SLO with "requires facts about its source alert" — inviting the user
/// to fix a pointer that was never broken. It surfaces as `SloError::Db`,
/// matching how every other read in this module reports one.
async fn load_source_alert_facts(
    slo: &Slo,
) -> Result<Option<config::meta::slo::SourceAlertFacts>, SloError> {
    let config::meta::slo::SliConfig::Alert { alert_id } = &slo.definition.sli_config else {
        return Ok(None);
    };
    let Ok(id) = Ksuid::from_str(alert_id) else {
        return Ok(None);
    };
    match crate::alerts::alert::get_by_id_db(&slo.org, id).await {
        Ok(alert) => Ok(Some(source_alert_facts(&alert))),
        Err(crate::alerts::alert::AlertError::AlertNotFound) => Ok(None),
        Err(e) => Err(SloError::Db(e.to_string())),
    }
}

/// Reduce a source alert to the facts §5.1/§5.4 validate against.
///
/// Pure and separate from the read, so the derivations — which are the subtle
/// part — are testable without a database.
fn source_alert_facts(
    alert: &config::meta::alerts::alert::Alert,
) -> config::meta::slo::SourceAlertFacts {
    let trigger = &alert.trigger_condition;
    // §7.1 / MN-10: an alert with ANY warning source keeps evaluating while
    // silenced and suppresses at delivery instead, so only the others go dark.
    // Read through `is_multi_level` rather than `warning_threshold` alone,
    // because that is what the scheduler itself branches on — checking a
    // subset would have validation believe a source stays dense when the
    // runtime puts it on the legacy silence path.
    let evaluates_through_silence = config::meta::alerts::dispatch::evaluates_through_silence(
        alert.query_condition.multi_alert_enabled(),
        config::meta::alerts::level::is_multi_level(alert),
    );

    config::meta::slo::SourceAlertFacts {
        is_scheduled: !alert.is_real_time,
        // Per-group state, not the column list (§2).
        is_grouped: config::meta::alerts::grouping::maintains_group_state(&alert.query_condition),
        // The domain-level form of the indexed `alerts.slo_id` column, which
        // is derived from exactly this field at write time (D60).
        is_slo_alert: alert.query_condition.slo_condition.is_some(),
        // Composite alerts are deferred (Feature 4) and have no representation
        // on `Alert` yet, so nothing can be one. The fact is wired now so the
        // rule ships whole rather than being remembered later.
        is_composite: false,
        frequency_secs: trigger.frequency,
        is_cron: trigger.frequency_type == config::meta::alerts::FrequencyType::Cron,
        is_silence_gated: trigger.silence > 0 && !evaluates_through_silence,
        silence_minutes: trigger.silence,
    }
}

/// Ensure an SLO's folder exists before anything is written into it.
///
/// SLOs live in **alert** folders — there is no `FolderType::Slos`, because an
/// SLO is alerting configuration and is authorized as `alerts` (§6b, D28). So
/// this asks the same question `alerts::alert::create` asks, of the same rows.
///
/// A missing `default` is created rather than rejected, matching the alert
/// path: a fresh org has no folder rows at all until something is saved, and
/// the handler defaults `folder_id` to `default` — so rejecting here would
/// make the first SLO in a new org impossible to create.
async fn ensure_folder(org: &str, folder_id: &str) -> Result<(), SloError> {
    if folders::exists(org, folder_id, FolderType::Alerts).await? {
        return Ok(());
    }
    if folder_id == DEFAULT_FOLDER {
        crate::alerts::alert::create_default_alerts_folder(org)
            .await
            .map_err(|e| SloError::Db(e.to_string()))?;
        return Ok(());
    }
    Err(SloError::FolderNotFound(folder_id.to_string()))
}

/// What an SLO reserves against its org's row budget.
pub fn reservation(slo: &Slo) -> (i64, i64) {
    let cfg = get_config();
    let groups = groups_reserved(slo.is_grouped(), slo.groups_estimate, cfg.slo.max_groups);
    let rows = rows_for_reservation(
        groups,
        slo.definition.slice_interval_secs,
        cfg.slo.revision_headroom,
    );
    (groups, rows)
}

pub async fn create(slo: &mut Slo) -> Result<(), SloError> {
    let cfg = get_config();
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| SloError::Db("database not initialized".into()))?;

    validate(slo).await?;
    // Before the budget charge: a bad folder should cost nothing, and the
    // charge is the step whose rollback is fiddly.
    ensure_folder(&slo.org, &slo.folder_id).await?;

    let (groups, rows) = reservation(slo);
    slo.groups_reserved = groups;
    slo.definition_generation = 1;

    // Charged BEFORE the row exists. Saving first would leave a window in
    // which the SLO exists uncharged, and concurrent creates in that window
    // each see headroom the other has already taken.
    slo_budget::charge(
        db,
        &slo.org,
        &slo.id,
        slo.definition_generation,
        rows,
        cfg.slo.max_slice_rows_per_org,
    )
    .await
    .map_err(|e| SloError::Budget(e.to_string()))?;

    let now = now_micros() / 1_000_000;
    if let Err(e) = slos_table::create(db, slo, now, slo.owner.as_deref()).await {
        // Release what we just reserved, or a failed save would leak budget
        // that nothing will ever retire.
        let _ = slo_budget::retire(db, &slo.org, &slo.id, slo.definition_generation, now).await;
        if is_duplicate_name(&e) {
            return Err(SloError::DuplicateName(slo.name.clone()));
        }
        return Err(e.into());
    }

    schedule(slo, now).await;
    Ok(())
}

pub async fn update(slo: &mut Slo) -> Result<(), SloError> {
    let cfg = get_config();
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| SloError::Db("database not initialized".into()))?;

    validate(slo).await?;
    // An update carries `folder_id` too, so it is also a move.
    ensure_folder(&slo.org, &slo.folder_id).await?;

    let existing = slos_table::get(db, &slo.org, &slo.id)
        .await?
        .ok_or(SloError::NotFound)?;
    // The caller does not choose the generation; the diff does.
    slo.definition_generation = existing.definition_generation;

    let (groups, rows) = reservation(slo);
    slo.groups_reserved = groups;

    let now = now_micros() / 1_000_000;
    let effect = match slos_table::update(db, slo, now, slo.owner.as_deref()).await {
        Ok(e) => e,
        Err(e) if is_duplicate_name(&e) => {
            return Err(SloError::DuplicateName(slo.name.clone()));
        }
        Err(e) => return Err(e.into()),
    };

    match effect {
        GenerationEffect::Bumped { from, to } => {
            slo.definition_generation = to;
            // The old generation's slices persist to the horizon whether or
            // not anything reads them, so its charge becomes a residual
            // rather than being released (S-14c).
            let expires = now + config::meta::slo::budget_rows::SLICE_HORIZON_SECS;
            let _ = slo_budget::retire(db, &slo.org, &slo.id, from, expires).await;
            if let Err(e) = slo_budget::charge(
                db,
                &slo.org,
                &slo.id,
                to,
                rows,
                cfg.slo.max_slice_rows_per_org,
            )
            .await
            {
                log::warn!(
                    "[slo] {} bumped to generation {to} but its budget charge failed: {e}",
                    slo.id
                );
            }
            schedule(slo, now).await;
        }
        GenerationEffect::Unchanged(g) => {
            slo.definition_generation = g;
            // A pause/resume still has to reach the scheduler.
            sync_ingest_trigger(slo).await;
        }
    }
    Ok(())
}

/// Move SLOs into another (alert) folder.
///
/// Separate from `update` because a move is not an edit of the definition: it
/// must never bump the generation, and the caller only has ids, not full
/// definitions. Returns the number of rows moved so the handler can answer 404
/// when nothing matched.
pub async fn move_to_folder(
    org: &str,
    ids: &[String],
    dst_folder_id: &str,
    editor: Option<&str>,
) -> Result<u64, SloError> {
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| SloError::Db("database not initialized".into()))?;

    ensure_folder(org, dst_folder_id).await?;

    let now = now_micros() / 1_000_000;
    match slos_table::move_to_folder(db, org, ids, dst_folder_id, now, editor).await {
        Ok(n) => Ok(n),
        // The destination already holds an SLO of the same name. Its own
        // variant because the name is not known here — the unique index fails
        // the whole statement without saying which row lost.
        Err(e) if is_duplicate_name(&e) => Err(SloError::MoveNameConflict),
        Err(e) => Err(e.into()),
    }
}

pub async fn delete(org: &str, id: &str) -> Result<bool, SloError> {
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| SloError::Db("database not initialized".into()))?;

    let Some(slo) = slos_table::get(db, org, id).await? else {
        return Ok(false);
    };

    // S-12: the SLO's alerts go with it. An alert whose SLO no longer exists
    // has nothing to evaluate and no way to recover — it would error on every
    // pass forever — so leaving it behind is not a kinder outcome than
    // removing it. Disabled alerts are included for the same reason.
    //
    // Deleted through the alert service rather than by row, so each one takes
    // its scheduler trigger, ofga ownership and run-state with it.
    let dependents = infra::table::alerts::list_alerts_by_slo(db, org, id)
        .await
        .map_err(|e| SloError::Db(e.to_string()))?;
    for (alert_id, name) in plan_alert_cascade(&dependents) {
        if let Err(e) = crate::alerts::alert::delete_by_id(db, org, alert_id).await {
            // Best-effort, matching the rest of this teardown: a stuck alert
            // must not strand the SLO half-deleted.
            log::warn!("[slo] could not delete alert \"{name}\" with SLO {id}: {e}");
        } else {
            log::info!("[slo] deleted alert \"{name}\" along with SLO {id}");
        }
    }

    let now = now_micros() / 1_000_000;

    // Retire, do not release: the slices are still on disk, and instant
    // release would make create-backfill-delete-repeat an unlimited storage
    // loophole (S-14c).
    let expires = now + config::meta::slo::budget_rows::SLICE_HORIZON_SECS;
    let _ = slo_budget::retire(db, org, id, slo.definition_generation, expires).await;

    let _ = backfill_jobs::delete_all(db, id).await;
    let _ = crate::db::scheduler::delete(org, crate::db::scheduler::TriggerModule::Slo, id).await;
    let _ = crate::db::scheduler::delete(org, crate::db::scheduler::TriggerModule::SloBackfill, id)
        .await;

    Ok(slos_table::delete(db, org, id).await?)
}

/// Which dependent alerts a delete will cascade to, as `(id, name)`.
///
/// Split out so the selection is testable without a database. An id that will
/// not parse is skipped rather than aborting the cascade: one unusable row
/// must not strand every other alert pointing at the same SLO.
fn plan_alert_cascade(dependents: &[(String, String)]) -> Vec<(Ksuid, String)> {
    dependents
        .iter()
        .filter_map(|(id, name)| Some((Ksuid::from_str(id).ok()?, name.clone())))
        .collect()
}

pub async fn set_enabled(org: &str, id: &str, enabled: bool) -> Result<bool, SloError> {
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| SloError::Db("database not initialized".into()))?;
    let now = now_micros() / 1_000_000;
    let changed = slos_table::set_enabled(db, org, id, enabled, now).await?;
    if changed && let Some(slo) = slos_table::get(db, org, id).await? {
        sync_ingest_trigger(&slo).await;
    }
    Ok(changed)
}

// ---------------------------------------------------------------------------
// read path
// ---------------------------------------------------------------------------

/// One SLO with its rollup measurement.
pub async fn get_with_status(
    org: &str,
    id: &str,
) -> Result<Option<(Slo, Option<config::meta::slo::SloStatusView>)>, anyhow::Error> {
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("database not initialized"))?;
    let Some(slo) = slos_table::get(db, org, id).await? else {
        return Ok(None);
    };
    let status = rollup_view(db, &slo).await?;
    Ok(Some((slo, status)))
}

/// Every SLO in an org, each with its rollup measurement.
pub async fn list_with_status(
    org: &str,
    folder: Option<&str>,
) -> Result<Vec<(Slo, Option<config::meta::slo::SloStatusView>)>, anyhow::Error> {
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("database not initialized"))?;
    let mut out = Vec::new();
    for slo in slos_table::list(db, org, folder).await? {
        let status = rollup_view(db, &slo).await?;
        out.push((slo, status));
    }
    Ok(out)
}

/// The per-group breakdown.
///
/// The rollup row is excluded: it is the EXACT overall (S-9), not a group, and
/// listing it alongside the groups would double-count in any client that sums
/// what it is given.
pub async fn group_status(
    org: &str,
    id: &str,
) -> Result<Vec<config::meta::slo::SloStatusView>, anyhow::Error> {
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("database not initialized"))?;
    let Some(slo) = slos_table::get(db, org, id).await? else {
        return Ok(Vec::new());
    };
    let rows = infra::table::slo::load_all_groups(db, &slo.id).await?;
    let cfg = get_config();
    Ok(rows
        .into_iter()
        .filter(|r| !r.group_key.is_empty())
        .map(|r| view_of(&slo, &r, cfg.slo.min_coverage))
        .collect())
}

async fn rollup_view(
    db: &sea_orm::DatabaseConnection,
    slo: &Slo,
) -> Result<Option<config::meta::slo::SloStatusView>, anyhow::Error> {
    let Some(row) = infra::table::slo::load_status(db, &slo.id, "").await? else {
        return Ok(None);
    };
    // A status row from a superseded generation describes a definition that
    // no longer exists. Reporting it would show numbers the current SLO never
    // produced.
    if row.definition_generation != slo.definition_generation {
        return Ok(None);
    }
    Ok(Some(view_of(slo, &row, get_config().slo.min_coverage)))
}

fn view_of(
    slo: &Slo,
    row: &infra::table::entity::slo_status::Model,
    coverage_floor: f64,
) -> config::meta::slo::SloStatusView {
    let expected = config::meta::slo::window::expected_slices(
        0,
        slo.definition.window_secs,
        slo.definition.slice_interval_secs,
    );
    config::meta::slo::SloStatusView::derive(
        row.group_key.clone(),
        row.good,
        row.total,
        row.covered_slices.map(i64::from),
        expected,
        slo.target,
        slo.definition.window_secs,
        coverage_floor,
        row.computed_at,
    )
}

/// Create the ingest job and, for a fresh generation, queue the backfill.
async fn schedule(slo: &Slo, now: i64) {
    sync_ingest_trigger(slo).await;

    let db = match infra::db::ORM_CLIENT.get() {
        Some(db) => db,
        None => return,
    };
    // A new generation has no history, so its window is meaningless until
    // backfill fills it. The range ends where the incremental writer begins,
    // which is what keeps the two writers off each other's slices (§6b.9).
    let (start, end) = super::backfill::backfill_range(
        slo.definition.window_secs,
        now,
        slo.definition.slice_interval_secs,
    );
    if let Err(e) =
        backfill_jobs::queue(db, &slo.id, slo.definition_generation, start, end, now).await
    {
        log::warn!("[slo] could not queue backfill for {}: {e}", slo.id);
        return;
    }
    push_trigger(
        &slo.org,
        &slo.id,
        crate::db::scheduler::TriggerModule::SloBackfill,
        now_micros(),
    )
    .await;
}

/// Add or remove the ingest trigger to match `enabled`.
async fn sync_ingest_trigger(slo: &Slo) {
    let module = crate::db::scheduler::TriggerModule::Slo;
    if !slo.enabled {
        let _ = crate::db::scheduler::delete(&slo.org, module, &slo.id).await;
        return;
    }
    push_trigger(&slo.org, &slo.id, module, now_micros()).await;
}

async fn push_trigger(
    org: &str,
    id: &str,
    module: crate::db::scheduler::TriggerModule,
    next_run_at: i64,
) {
    let trigger = crate::db::scheduler::Trigger {
        org: org.to_string(),
        module,
        module_key: id.to_string(),
        next_run_at,
        is_realtime: false,
        is_silenced: false,
        ..Default::default()
    };
    if let Err(e) = crate::db::scheduler::push(trigger).await {
        log::warn!("[slo] could not schedule {id}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deleting an SLO CASCADES to its alerts: an alert whose SLO is gone can
    /// only ever error — it has no data to evaluate and no way to recover.
    /// Only alerts pointing at THIS SLO go.
    #[test]
    fn the_cascade_targets_exactly_the_alerts_of_this_slo() {
        use svix_ksuid::KsuidLike as _;
        let a = svix_ksuid::Ksuid::new(None, None);
        let b = svix_ksuid::Ksuid::new(None, None);
        let dependents = vec![
            (a.to_string(), "checkout burn".to_string()),
            (b.to_string(), "budget 90%".to_string()),
        ];
        let plan = plan_alert_cascade(&dependents);
        assert_eq!(plan.len(), 2);
        assert!(
            plan.iter()
                .any(|(id, name)| *id == a && name == "checkout burn")
        );
        assert!(
            plan.iter()
                .any(|(id, name)| *id == b && name == "budget 90%")
        );
    }

    /// An SLO nobody alerts on deletes with no cascade at all — and, more to
    /// the point, with no alert lookups turning into deletions.
    #[test]
    fn an_slo_with_no_alerts_cascades_to_nothing() {
        assert!(plan_alert_cascade(&[]).is_empty());
    }

    // ---- validation wiring --------------------------------------------------

    mod validation {
        use config::meta::slo::{
            SliConfig, SloDefinition, SourceAlertFacts, WINDOW_30D_SECS, validate_slo,
        };

        use super::*;

        fn alert_slo() -> Slo {
            Slo {
                id: "slo-1".into(),
                org: "myorg".into(),
                folder_id: "default".into(),
                name: "checkout alert uptime".into(),
                description: String::new(),
                definition: SloDefinition {
                    sli_config: SliConfig::Alert {
                        alert_id: "alert-1".into(),
                    },
                    group_by: None,
                    window_secs: WINDOW_30D_SECS,
                    slice_interval_secs: 60,
                },
                target: 99.9,
                tags: Vec::new(),
                enabled: true,
                owner: None,
                definition_generation: 1,
                groups_estimate: None,
                groups_reserved: 1,
            }
        }

        fn eligible_facts() -> SourceAlertFacts {
            SourceAlertFacts {
                is_scheduled: true,
                is_grouped: false,
                is_slo_alert: false,
                is_composite: false,
                frequency_secs: 60,
                is_cron: false,
                is_silence_gated: false,
                silence_minutes: 0,
            }
        }

        /// The "Phase 5c" gap, closed: the facts must actually reach
        /// `validate_slo`. With `None` hardcoded there — as it was — every
        /// alert SLO is rejected with `AlertSliSourceUnknown` however eligible
        /// its source is, and nothing else in this suite would notice.
        #[test]
        fn an_alert_slo_with_an_eligible_source_validates() {
            assert!(
                validate_with_facts(&alert_slo(), Some(eligible_facts())).is_ok(),
                "the source facts never reached validate_slo"
            );
        }

        /// A source that could not be loaded is not a source. The SLO is
        /// refused rather than half-validated.
        #[test]
        fn an_alert_slo_whose_source_is_unknown_is_rejected() {
            let err = validate_with_facts(&alert_slo(), None).unwrap_err();
            assert_eq!(
                err.to_string(),
                config::meta::slo::SloValidationError::AlertSliSourceUnknown.to_string()
            );
        }

        /// A rejection from the facts is surfaced verbatim, not flattened into
        /// a generic message — the picker and the API both depend on it.
        #[test]
        fn a_source_fact_rejection_reaches_the_caller() {
            let cron = SourceAlertFacts {
                is_cron: true,
                ..eligible_facts()
            };
            let err = validate_with_facts(&alert_slo(), Some(cron)).unwrap_err();
            assert_eq!(
                err.to_string(),
                config::meta::slo::SloValidationError::AlertSliSourceIsCron.to_string()
            );
        }

        /// Non-alert SLIs must not have gained a source requirement.
        #[test]
        fn a_count_slo_still_validates_without_any_facts() {
            let mut slo = alert_slo();
            slo.definition.sli_config = SliConfig::Count {
                source: config::meta::slo::CountSource::SingleQuery {
                    stream: "requests".into(),
                    stream_type: "logs".into(),
                    scope: None,
                    good_expr: "status_code < 500".into(),
                },
            };
            assert!(validate_with_facts(&slo, None).is_ok());
            // And the underlying rule is unchanged.
            assert_eq!(validate_slo(&slo.definition, slo.target, None), Ok(()));
        }
    }

    // ---- source-alert facts (§5.1, §5.4) -----------------------------------

    mod source_facts {
        use config::meta::{
            alerts::{
                AggFunction, Aggregation, Condition, FrequencyType, Operator, QueryCondition,
                QueryType, TriggerCondition, alert::Alert,
            },
            slo::condition::{SloAlertKind, SloCondition},
        };

        use super::*;

        /// A plain scheduled SQL alert on a 1-minute cadence: the eligible
        /// shape every other case is a one-field deviation from.
        fn eligible() -> Alert {
            // Built by mutation rather than a struct literal: `Alert` has
            // private fields, so it cannot be spread from outside its module.
            let mut alert = Alert::default();
            alert.is_real_time = false;
            alert.trigger_condition = TriggerCondition {
                frequency: 60,
                frequency_type: FrequencyType::Minutes,
                silence: 0,
                ..Default::default()
            };
            alert.query_condition = QueryCondition {
                query_type: QueryType::SQL,
                ..Default::default()
            };
            alert
        }

        fn aggregation(group_by: Option<Vec<String>>, multi_alert: bool) -> Aggregation {
            Aggregation {
                group_by,
                function: AggFunction::Count,
                having: Condition {
                    column: "x".into(),
                    operator: Operator::GreaterThanEquals,
                    value: serde_json::json!(1),
                    ignore_case: false,
                },
                warning_value: None,
                multi_alert,
            }
        }

        #[test]
        fn an_ordinary_scheduled_alert_is_an_eligible_source() {
            let facts = source_alert_facts(&eligible());
            assert!(facts.is_scheduled);
            assert!(!facts.is_grouped);
            assert!(!facts.is_slo_alert);
            assert!(!facts.is_composite);
            assert!(!facts.is_cron);
            assert!(!facts.is_silence_gated);
            assert_eq!(facts.frequency_secs, 60);
        }

        /// Real-time alerts evaluate at ingest, per cluster, and carry no
        /// durable level state (C-7, D12).
        #[test]
        fn a_real_time_alert_is_not_scheduled() {
            let mut a = eligible();
            a.is_real_time = true;
            assert!(!source_alert_facts(&a).is_scheduled);
        }

        /// "Grouped" is **maintains per-group state**, not the column list.
        #[test]
        fn a_group_by_column_list_makes_the_source_grouped() {
            let mut a = eligible();
            a.query_condition.aggregation = Some(aggregation(Some(vec!["host".into()]), false));
            assert!(source_alert_facts(&a).is_grouped);
        }

        /// The case the column-list test gets wrong: a PromQL multi-alert has
        /// no `group_by` list at all — the returned series' labels are the
        /// group — yet it never reaches the single-row path where the ledger
        /// writes. Treating it as ungrouped would let it save cleanly and
        /// measure nothing forever.
        #[test]
        fn a_promql_multi_alert_is_grouped_despite_having_no_group_by_list() {
            let mut a = eligible();
            a.query_condition.query_type = QueryType::PromQL;
            a.query_condition.promql_multi_alert = true;
            assert!(a.query_condition.aggregation.is_none());
            assert!(
                source_alert_facts(&a).is_grouped,
                "a PromQL multi-alert maintains per-group state"
            );
        }

        #[test]
        fn a_sql_multi_alert_is_grouped() {
            let mut a = eligible();
            a.query_condition.aggregation = Some(aggregation(Some(vec!["host".into()]), true));
            assert!(source_alert_facts(&a).is_grouped);
        }

        /// An empty column list is not grouping.
        #[test]
        fn an_empty_group_by_list_does_not_make_the_source_grouped() {
            let mut a = eligible();
            a.query_condition.aggregation = Some(aggregation(Some(vec![]), false));
            assert!(!source_alert_facts(&a).is_grouped);
        }

        fn slo_condition(warning: Option<f64>) -> SloCondition {
            SloCondition {
                slo_id: "slo-1".into(),
                kind: SloAlertKind::ErrorBudget,
                operator: Operator::GreaterThanEquals,
                critical: 90.0,
                warning,
                long_window_secs: None,
                short_window_secs: None,
                multi_alert: false,
            }
        }

        /// Excluding SLO alerts is what prevents SLO -> alert -> SLO cycles
        /// without a cycle checker.
        ///
        /// The fact is read from `query_condition.slo_condition`, which is the
        /// domain-level truth: the indexed `alerts.slo_id` column the design
        /// note names is *derived* from exactly this field at write time (D60,
        /// `infra::table::alerts::…`), and `Alert` itself carries no `slo_id`.
        #[test]
        fn an_slo_alert_is_recognised_by_its_slo_condition() {
            let mut a = eligible();
            a.query_condition.query_type = QueryType::Slo;
            a.query_condition.slo_condition = Some(slo_condition(None));
            assert!(source_alert_facts(&a).is_slo_alert);
        }

        #[test]
        fn a_cron_source_is_recognised() {
            let mut a = eligible();
            a.trigger_condition.frequency_type = FrequencyType::Cron;
            a.trigger_condition.cron = "0 9 * * 1-5".into();
            assert!(source_alert_facts(&a).is_cron);
        }

        #[test]
        fn the_cadence_is_the_alerts_frequency_in_seconds() {
            let mut a = eligible();
            a.trigger_condition.frequency = 300;
            assert_eq!(source_alert_facts(&a).frequency_secs, 300);
        }

        /// A single-level alert with silence stops evaluating for the whole
        /// silence window, and silence engages after a firing — missingness
        /// correlated with badness (§5.4).
        #[test]
        fn a_single_level_alert_with_silence_is_silence_gated() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            let facts = source_alert_facts(&a);
            assert!(facts.is_silence_gated);
            assert_eq!(facts.silence_minutes, 10);
        }

        #[test]
        fn silence_of_zero_is_never_gated() {
            let facts = source_alert_facts(&eligible());
            assert!(!facts.is_silence_gated);
            assert_eq!(facts.silence_minutes, 0);
        }

        /// A warning threshold keeps the alert evaluating through silence —
        /// only delivery is suppressed — so the ledger stays dense.
        #[test]
        fn a_warning_threshold_defuses_silence() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            a.trigger_condition.warning_threshold = Some(1);
            let facts = source_alert_facts(&a);
            assert!(!facts.is_silence_gated);
            assert_eq!(
                facts.silence_minutes, 10,
                "the minutes are still reported; only the gate is off"
            );
        }

        /// The warning axis has four sources, not just `warning_threshold` —
        /// checking only that one would leave aggregation- and PromQL-warning
        /// alerts on the legacy silence path in the runtime while validation
        /// believed otherwise. (The fourth, `slo_condition.warning`, cannot
        /// reach this rule: an SLO alert is refused as a source outright.)
        #[test]
        fn every_reachable_warning_source_defuses_silence() {
            let mut agg = eligible();
            agg.trigger_condition.silence = 10;
            let mut a = aggregation(Some(vec![]), false);
            a.warning_value = Some(1.0);
            agg.query_condition.aggregation = Some(a);
            assert!(!source_alert_facts(&agg).is_silence_gated);

            let mut promql = eligible();
            promql.trigger_condition.silence = 10;
            promql.query_condition.query_type = QueryType::PromQL;
            promql.query_condition.promql_warning_value = Some(1.0);
            assert!(!source_alert_facts(&promql).is_silence_gated);
        }

        /// The fourth family, pinned anyway: the fact must be derived from the
        /// same `is_multi_level` the scheduler uses, not from a subset of it.
        #[test]
        fn an_slo_warning_also_defuses_silence() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            a.query_condition.query_type = QueryType::Slo;
            a.query_condition.slo_condition = Some(slo_condition(Some(50.0)));
            assert!(!source_alert_facts(&a).is_silence_gated);
        }

        /// `evaluates_through_silence`'s multi-alert arm: it is irrelevant to
        /// eligibility, because a multi-alert is rejected by `is_grouped`
        /// first. Pinned so nobody "simplifies" the grouping fact away on the
        /// grounds that silence already covers it.
        #[test]
        fn a_multi_alert_is_rejected_by_grouping_not_by_silence() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            a.query_condition.aggregation = Some(aggregation(Some(vec!["host".into()]), true));
            let facts = source_alert_facts(&a);
            assert!(
                !facts.is_silence_gated,
                "a multi-alert evaluates through silence"
            );
            assert!(
                facts.is_grouped,
                "and is refused for maintaining per-group state"
            );
        }

        /// Composite alerts are a deferred feature with no representation on
        /// `Alert` yet. The fact stays wired so the rule ships with the rest.
        #[test]
        fn no_alert_is_composite_yet() {
            assert!(!source_alert_facts(&eligible()).is_composite);
        }
    }

    /// A malformed id cannot be deleted and must not silently abort the
    /// cascade of its siblings — it is skipped, and the caller logs it.
    #[test]
    fn an_unparseable_alert_id_is_skipped_rather_than_aborting_the_cascade() {
        use svix_ksuid::KsuidLike as _;
        let dependents = vec![
            ("not-a-ksuid".to_string(), "broken".to_string()),
            (
                svix_ksuid::Ksuid::new(None, None).to_string(),
                "fine".to_string(),
            ),
        ];
        let plan = plan_alert_cascade(&dependents);
        assert_eq!(plan.len(), 1, "the good alert must still be deleted");
        assert_eq!(plan[0].1, "fine");
    }
}
