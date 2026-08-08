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
pub fn validate(slo: &Slo) -> Result<(), SloError> {
    // `Alert` SLIs need facts about the source alert that only the caller can
    // supply; until Phase 5c wires that up, they are rejected rather than
    // half-validated.
    validate_slo(&slo.definition, slo.target, None)?;
    let group_by = slo.definition.group_by.clone().unwrap_or_default();
    validate_query_safety(
        &slo.definition.sli_config,
        &group_by,
        slo.definition.slice_interval_secs,
    )
    .map_err(|e| SloError::Validation(e.to_string()))?;
    Ok(())
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

    validate(slo)?;
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

    validate(slo)?;
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
