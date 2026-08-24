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

//! CRUD for `slos` (`alerts_2.md` §6b.8).
//!
//! The one thing this module does that a generic CRUD layer would not: it
//! decides, on update, whether the edit is **computation-affecting**, and if so
//! bumps `definition_generation` in the same transaction as the write (D59).
//!
//! Getting that wrong in either direction is expensive:
//!
//! * bump when you should not, and every `target` tweak throws away up to 90 days of measurement;
//! * fail to bump when you should, and slices computed under two different definitions are averaged
//!   into one number that describes neither — the one corruption eventual consistency does not
//!   repair.

use config::meta::slo::{SliType, Slo, SloDefinition};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, ModelTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait, sea_query::Expr,
};

use super::{
    entity::{slo_status, slos},
    get_lock,
};
use crate::errors::{DbError, Error};

/// What an update did to the writing epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenerationEffect {
    /// Nothing computation-affecting changed. Measurement continues.
    Unchanged(i32),
    /// The definition changed. Every running aggregate was cleared and a new
    /// epoch began.
    Bumped { from: i32, to: i32 },
}

/// Whether two definitions mean the same thing to a slice writer.
///
/// Deliberately compares the WHOLE definition rather than listing fields:
/// a new field added to `SloDefinition` is computation-affecting by default,
/// which is the safe direction to be wrong in. `target` is not part of
/// `SloDefinition` precisely so that it cannot land here (D56).
pub fn definition_changed(before: &SloDefinition, after: &SloDefinition) -> bool {
    // Normalize grouping first: `None` and `Some([])` are both "ungrouped",
    // and a UI that sends the empty array must not look like a redefinition.
    fn normalized(d: &SloDefinition) -> SloDefinition {
        let mut d = d.clone();
        d.group_by = match d.group_by {
            Some(g) if g.is_empty() => None,
            other => other,
        };
        d
    }
    normalized(before) != normalized(after)
}

pub async fn get(db: &DatabaseConnection, org: &str, id: &str) -> Result<Option<Slo>, Error> {
    let Some(model) = slos::Entity::find_by_id(id.to_string())
        .filter(slos::Column::Org.eq(org))
        .one(db)
        .await?
    else {
        return Ok(None);
    };
    Ok(Some(to_slo(model)?))
}

/// Every enabled SLO across all orgs — what the ingest scheduler enumerates.
pub async fn list_enabled(db: &DatabaseConnection) -> Result<Vec<Slo>, Error> {
    slos::Entity::find()
        .filter(slos::Column::Enabled.eq(true))
        .order_by_asc(slos::Column::Id)
        .all(db)
        .await?
        .into_iter()
        .map(to_slo)
        .collect()
}

pub async fn list(
    db: &DatabaseConnection,
    org: &str,
    folder_id: Option<&str>,
) -> Result<Vec<Slo>, Error> {
    let mut q = slos::Entity::find().filter(slos::Column::Org.eq(org));
    if let Some(folder) = folder_id {
        q = q.filter(slos::Column::FolderId.eq(folder));
    }
    q.order_by_asc(slos::Column::Name)
        .all(db)
        .await?
        .into_iter()
        .map(to_slo)
        .collect()
}

/// When the current generation began.
///
/// The incremental writer starts its watermark here and backfill owns
/// strictly before it — the rule that keeps the two writers from ever
/// emitting the same slice (§6b.9).
pub async fn generation_reset_time(
    db: &DatabaseConnection,
    id: &str,
) -> Result<Option<i64>, Error> {
    Ok(slos::Entity::find_by_id(id.to_string())
        .one(db)
        .await?
        .and_then(|m| m.generation_reset_time))
}

pub async fn count_in_org(db: &DatabaseConnection, org: &str) -> Result<u64, Error> {
    Ok(slos::Entity::find()
        .filter(slos::Column::Org.eq(org))
        .count(db)
        .await?)
}

/// Insert a new SLO and seed its status rollup row in the same transaction.
///
/// Seeding here rather than lazily on the first pass is what lets the CAS
/// fence work from the very first write: without a row there is no stored
/// generation to compare against.
pub async fn create(
    db: &DatabaseConnection,
    slo: &Slo,
    now: i64,
    editor: Option<&str>,
) -> Result<(), Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let txn = db.begin().await?;
    let mut model = to_model(slo, now)?;
    model.created_at = Set(now);
    model.updated_at = Set(now);
    model.last_edited_by = Set(editor.map(str::to_string));
    model.generation_reset_time = Set(Some(now));
    model.insert(&txn).await?;

    slo_status::ActiveModel {
        slo_id: Set(slo.id.clone()),
        group_key: Set(slo_status::ROLLUP_GROUP_KEY.to_string()),
        definition_generation: Set(slo.definition_generation),
        ..Default::default()
    }
    .insert(&txn)
    .await?;

    txn.commit().await?;
    Ok(())
}

/// Update an SLO, bumping the generation iff the edit changed what a slice
/// means. Both happen in one transaction, so a reader can never see the new
/// definition under the old epoch.
pub async fn update(
    db: &DatabaseConnection,
    slo: &Slo,
    now: i64,
    editor: Option<&str>,
) -> Result<GenerationEffect, Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let txn = db.begin().await?;

    let Some(existing) = slos::Entity::find_by_id(slo.id.clone())
        .filter(slos::Column::Org.eq(&slo.org))
        .one(&txn)
        .await?
    else {
        let _ = txn.rollback().await;
        return Err(Error::DbError(DbError::KeyNotExists(slo.id.clone())));
    };

    let before = to_slo(existing.clone())?;
    let bumped = definition_changed(&before.definition, &slo.definition);
    let generation = if bumped {
        existing.definition_generation + 1
    } else {
        existing.definition_generation
    };

    let mut model = to_model(slo, now)?;
    model.created_at = Set(existing.created_at);
    model.updated_at = Set(now);
    model.last_edited_by = Set(editor.map(str::to_string));
    model.definition_generation = Set(generation);
    // The incremental writer starts its watermark here, and backfill owns
    // strictly before it — which is what keeps the two writers off each
    // other's slices (§6b.9).
    model.generation_reset_time = Set(if bumped {
        Some(now)
    } else {
        existing.generation_reset_time
    });
    slos::Entity::update(model).exec(&txn).await?;

    if bumped {
        // Clearing the aggregates is not hygiene: leaving them would mix the
        // old definition's arithmetic into the new epoch's window.
        slo_status::Entity::delete_many()
            .filter(slo_status::Column::SloId.eq(slo.id.clone()))
            .exec(&txn)
            .await?;
        slo_status::ActiveModel {
            slo_id: Set(slo.id.clone()),
            group_key: Set(slo_status::ROLLUP_GROUP_KEY.to_string()),
            definition_generation: Set(generation),
            ..Default::default()
        }
        .insert(&txn)
        .await?;
    }

    txn.commit().await?;
    Ok(if bumped {
        GenerationEffect::Bumped {
            from: existing.definition_generation,
            to: generation,
        }
    } else {
        GenerationEffect::Unchanged(generation)
    })
}

/// Every SLO in `org` whose SLI measures from this alert (S-16 PR 4).
///
/// The reverse of `SliConfig::Alert { alert_id }`, and the mirror of
/// `alerts::list_alerts_by_slo`. There is no `source_alert_id` column to index:
/// the pointer lives inside `sli_config`, so the query narrows on the
/// denormalized `sli_type` — which exists for exactly this kind of filtering —
/// and matches the id in Rust. Alert SLIs are a small minority of a small
/// table, so the residual scan is over a handful of rows.
///
/// Disabled SLOs are included, exactly as `list_alerts_by_slo` includes
/// disabled alerts: a paused SLO is still measuring from that source the moment
/// it resumes, and deleting its source would leave it unrecoverable.
pub async fn list_by_source_alert(
    db: &DatabaseConnection,
    org: &str,
    alert_id: &str,
) -> Result<Vec<Slo>, Error> {
    let rows = slos::Entity::find()
        .filter(slos::Column::Org.eq(org))
        .filter(slos::Column::SliType.eq(SliType::Alert.storage_id()))
        // Ordered by name because this feeds a 409 that names the SLOs; a
        // message whose wording depends on row order is one nobody can write a
        // runbook against.
        .order_by_asc(slos::Column::Name)
        .all(db)
        .await?;
    let mut out = Vec::new();
    for model in rows {
        let slo = to_slo(model)?;
        if matches!(
            &slo.definition.sli_config,
            config::meta::slo::SliConfig::Alert { alert_id: a } if a == alert_id
        ) {
            out.push(slo);
        }
    }
    Ok(out)
}

/// Bump `definition_generation` because something OUTSIDE the SLO changed what
/// a slice means — the source alert's condition (D59, S-16 PR 4).
///
/// Deliberately not routed through [`update`]: that path diffs a caller-supplied
/// definition, and here the definition is untouched. Everything else about the
/// epoch change is identical, and is why this is a transaction rather than a
/// bare UPDATE — leaving the old aggregates would average two definitions into
/// one number that describes neither.
///
/// Returns `(from, to)`, or `None` when the SLO does not exist.
pub async fn bump_generation(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
    now: i64,
) -> Result<Option<(i32, i32)>, Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let txn = db.begin().await?;
    let Some(existing) = slos::Entity::find_by_id(id.to_string())
        .filter(slos::Column::Org.eq(org))
        .one(&txn)
        .await?
    else {
        let _ = txn.rollback().await;
        return Ok(None);
    };

    let from = existing.definition_generation;
    let to = from + 1;
    let mut active = existing.into_active_model();
    active.definition_generation = Set(to);
    // The incremental writer starts its watermark here and backfill owns
    // strictly before it — the same fence `update` sets on a bump (§6b.9).
    active.generation_reset_time = Set(Some(now));
    active.updated_at = Set(now);
    active.update(&txn).await?;

    slo_status::Entity::delete_many()
        .filter(slo_status::Column::SloId.eq(id))
        .exec(&txn)
        .await?;
    slo_status::ActiveModel {
        slo_id: Set(id.to_string()),
        group_key: Set(slo_status::ROLLUP_GROUP_KEY.to_string()),
        definition_generation: Set(to),
        ..Default::default()
    }
    .insert(&txn)
    .await?;

    txn.commit().await?;
    Ok(Some((from, to)))
}

/// Delete an SLO and its status rows together.
///
/// Slices are NOT deleted: they age out with the stream's retention, and the
/// budget charge stays as a residual until they do (S-14c). Deleting an SLO
/// does not instantly free the storage its slices occupy, and pretending
/// otherwise would let an org delete-and-recreate its way past the cap.
pub async fn delete(db: &DatabaseConnection, org: &str, id: &str) -> Result<bool, Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let txn = db.begin().await?;
    let Some(model) = slos::Entity::find_by_id(id.to_string())
        .filter(slos::Column::Org.eq(org))
        .one(&txn)
        .await?
    else {
        let _ = txn.rollback().await;
        return Ok(false);
    };
    slo_status::Entity::delete_many()
        .filter(slo_status::Column::SloId.eq(id))
        .exec(&txn)
        .await?;
    model.delete(&txn).await?;
    txn.commit().await?;
    Ok(true)
}

/// The ids of every SLO in an org.
///
/// `slo_status` and `slo_backfill_jobs` carry no org column — their only SLO
/// reference is `slo_id` — so their by-org sweeps resolve the org through here.
pub(crate) async fn ids_in_org(db: &DatabaseConnection, org: &str) -> Result<Vec<String>, Error> {
    Ok(slos::Entity::find()
        .filter(slos::Column::Org.eq(org))
        .select_only()
        .column(slos::Column::Id)
        .into_tuple()
        .all(db)
        .await?)
}

/// Delete every SLO in an org — the org-teardown path.
///
/// Only this table. Status rows and backfill jobs are swept by their own
/// modules, which resolve their org through `ids_in_org` and therefore run
/// BEFORE this (`org_cleanup::step_delete_db_resources`).
pub async fn delete_by_org(db: &DatabaseConnection, org: &str) -> Result<(), Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    slos::Entity::delete_many()
        .filter(slos::Column::Org.eq(org))
        .exec(db)
        .await?;
    Ok(())
}

/// Toggle `enabled` without touching the definition — never a generation bump.
pub async fn set_enabled(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
    enabled: bool,
    now: i64,
) -> Result<bool, Error> {
    let Some(model) = slos::Entity::find_by_id(id.to_string())
        .filter(slos::Column::Org.eq(org))
        .one(db)
        .await?
    else {
        return Ok(false);
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let mut active = model.into_active_model();
    active.enabled = Set(enabled);
    active.updated_at = Set(now);
    active.update(db).await?;
    Ok(true)
}

/// Relocate SLOs into another folder.
///
/// Deliberately NOT expressed as an `update()`. That path diffs the definition
/// to decide the writing epoch, and a folder is not part of the definition — so
/// routing a move through it would mean rebuilding a full `Slo` from a request
/// that only names ids, and any drift in that reconstruction would bump the
/// generation and discard up to 90 days of measurement (D59). This writes
/// `folder_id` and the edit stamps, nothing else.
///
/// Returns the number of rows actually moved, which is how the caller detects
/// ids that do not exist or belong to another org.
///
/// The `(org, folder_id, name)` unique index still applies, so a move that
/// would collide with a same-named SLO already in the destination fails the
/// whole statement — no partial move.
pub async fn move_to_folder(
    db: &DatabaseConnection,
    org: &str,
    ids: &[String],
    dst_folder_id: &str,
    now: i64,
    editor: Option<&str>,
) -> Result<u64, Error> {
    if ids.is_empty() {
        return Ok(0);
    }

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let res = slos::Entity::update_many()
        .col_expr(slos::Column::FolderId, Expr::value(dst_folder_id))
        .col_expr(slos::Column::UpdatedAt, Expr::value(now))
        .col_expr(
            slos::Column::LastEditedBy,
            Expr::value(editor.map(str::to_string)),
        )
        .filter(slos::Column::Org.eq(org))
        .filter(slos::Column::Id.is_in(ids.to_vec()))
        .exec(db)
        .await?;
    Ok(res.rows_affected)
}

// ---------------------------------------------------------------------------
// conversion
// ---------------------------------------------------------------------------

fn to_slo(m: slos::Model) -> Result<Slo, Error> {
    let sli_config = serde_json::from_value(m.sli_config)?;
    let group_by = match m.group_by {
        Some(v) => serde_json::from_value(v)?,
        None => None,
    };
    let tags = match m.tags {
        Some(v) => serde_json::from_value(v)?,
        None => Vec::new(),
    };
    // `sli_type` is stored redundantly with `sli_config`'s own tag so a
    // listing can filter without parsing. If they ever disagree the config is
    // authoritative — it is what the evaluator actually runs.
    let _ = SliType::from_storage_id(m.sli_type);
    Ok(Slo {
        id: m.id,
        org: m.org,
        folder_id: m.folder_id,
        name: m.name,
        description: m.description.unwrap_or_default(),
        definition: SloDefinition {
            sli_config,
            group_by,
            window_secs: m.window_secs,
            slice_interval_secs: m.slice_interval_secs as i64,
        },
        target: m.target,
        tags,
        enabled: m.enabled,
        owner: m.owner,
        definition_generation: m.definition_generation,
        groups_estimate: m.groups_estimate,
        groups_reserved: m.groups_reserved,
    })
}

fn to_model(slo: &Slo, _now: i64) -> Result<slos::ActiveModel, Error> {
    Ok(slos::ActiveModel {
        id: Set(slo.id.clone()),
        org: Set(slo.org.clone()),
        folder_id: Set(slo.folder_id.clone()),
        name: Set(slo.name.clone()),
        description: Set(if slo.description.is_empty() {
            None
        } else {
            Some(slo.description.clone())
        }),
        sli_type: Set(slo.definition.sli_config.sli_type().storage_id()),
        sli_config: Set(serde_json::to_value(&slo.definition.sli_config)?),
        target: Set(slo.target),
        window_secs: Set(slo.definition.window_secs),
        slice_interval_secs: Set(slo.definition.slice_interval_secs as i32),
        group_by: Set(match &slo.definition.group_by {
            Some(g) if !g.is_empty() => Some(serde_json::to_value(g)?),
            _ => None,
        }),
        tags: Set(if slo.tags.is_empty() {
            None
        } else {
            Some(serde_json::to_value(&slo.tags)?)
        }),
        enabled: Set(slo.enabled),
        owner: Set(slo.owner.clone()),
        definition_generation: Set(slo.definition_generation),
        groups_estimate: Set(slo.groups_estimate),
        groups_reserved: Set(slo.groups_reserved),
        ..Default::default()
    })
}

/// Register an SLO for sibling modules' tests.
///
/// `slo_status` and `slo_backfill_jobs` carry no org column, so their by-org
/// sweeps resolve through this table — which means their tests need a real
/// `slos` row. Goes through `create`, so the fixture is what production
/// actually writes.
#[cfg(test)]
pub(crate) async fn insert_for_test(db: &DatabaseConnection, org: &str, id: &str) {
    use config::meta::slo::{CountSource, SliConfig};
    let slo = Slo {
        id: id.to_string(),
        org: org.to_string(),
        folder_id: "default".to_string(),
        name: format!("slo {id}"),
        description: String::new(),
        definition: SloDefinition {
            sli_config: SliConfig::Count {
                source: CountSource::SingleQuery {
                    stream: "requests".into(),
                    stream_type: "logs".into(),
                    scope: None,
                    good_expr: "status < 500".into(),
                },
            },
            group_by: None,
            window_secs: 30 * 86_400,
            slice_interval_secs: 60,
        },
        target: 99.9,
        tags: vec![],
        enabled: true,
        owner: None,
        definition_generation: 1,
        groups_estimate: None,
        groups_reserved: 1,
    };
    create(db, &slo, 1_000, None).await.unwrap();
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::Operator,
        slo::{CountSource, QueryLanguage, SliConfig},
    };
    use sea_orm::Database;

    use super::*;
    use crate::table::{migration::create_slo_tables_for_test, slo};

    const ORG: &str = "acme";
    const ID: &str = "slo00000000000000000000000";

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_slo_tables_for_test(&db).await.unwrap();
        db
    }

    fn count_sli(good: &str) -> SliConfig {
        SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: None,
                good_expr: good.to_string(),
            },
        }
    }

    fn slo() -> Slo {
        Slo {
            id: ID.to_string(),
            org: ORG.to_string(),
            folder_id: "default".to_string(),
            name: "checkout availability".to_string(),
            description: String::new(),
            definition: SloDefinition {
                sli_config: count_sli("status < 500"),
                group_by: None,
                window_secs: 30 * 86_400,
                slice_interval_secs: 60,
            },
            target: 99.9,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 1,
        }
    }

    // ===================== round trip =====================================

    #[tokio::test]
    async fn an_slo_round_trips_through_storage() {
        let db = db().await;
        let s = slo();
        create(&db, &s, 1_000, Some("alice")).await.unwrap();
        assert_eq!(get(&db, ORG, ID).await.unwrap().unwrap(), s);
    }

    /// Org scoping is a security boundary, not a convenience filter.
    #[tokio::test]
    async fn another_orgs_slo_is_not_visible() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        assert!(get(&db, "other-org", ID).await.unwrap().is_none());
        assert!(list(&db, "other-org", None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn creating_an_slo_seeds_its_status_rollup_row() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        // Without this row the CAS fence has nothing to compare against on
        // the very first pass.
        let status = slo::load_status(&db, ID, slo_status::ROLLUP_GROUP_KEY)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status.definition_generation, 1);
        assert_eq!(status.good, None, "seeded, not measured");
    }

    #[tokio::test]
    async fn tags_and_group_by_survive_the_json_round_trip() {
        let db = db().await;
        let mut s = slo();
        s.tags = vec!["team:payments".into(), "tier:1".into()];
        s.definition.group_by = Some(vec!["region".into()]);
        s.definition.slice_interval_secs = 300;
        create(&db, &s, 1_000, None).await.unwrap();
        assert_eq!(get(&db, ORG, ID).await.unwrap().unwrap(), s);
    }

    // ===================== the generation rule ============================

    /// D56: the target is applied at read time, so changing it must not throw
    /// away up to 90 days of measurement.
    #[tokio::test]
    async fn editing_the_target_does_not_bump_the_generation() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();

        let mut edited = slo();
        edited.target = 99.95;
        assert_eq!(
            update(&db, &edited, 2_000, None).await.unwrap(),
            GenerationEffect::Unchanged(1)
        );
        assert_eq!(get(&db, ORG, ID).await.unwrap().unwrap().target, 99.95);
    }

    #[tokio::test]
    async fn cosmetic_edits_do_not_bump_the_generation() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();

        let mut edited = slo();
        edited.name = "renamed".into();
        edited.description = "now documented".into();
        edited.tags = vec!["team:payments".into()];
        edited.owner = Some("bob".into());
        edited.enabled = false;
        assert_eq!(
            update(&db, &edited, 2_000, None).await.unwrap(),
            GenerationEffect::Unchanged(1)
        );
    }

    #[tokio::test]
    async fn changing_the_sli_bumps_the_generation() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();

        let mut edited = slo();
        edited.definition.sli_config = count_sli("status < 400");
        assert_eq!(
            update(&db, &edited, 2_000, None).await.unwrap(),
            GenerationEffect::Bumped { from: 1, to: 2 }
        );
    }

    /// Pins the ONE lever an operator has to force an SLO to rebuild its
    /// history, because there is no "recalculate" endpoint, button or CLI
    /// subcommand: for a non-alert SLI, [`update`] is the only route to a
    /// generation bump, and the documented repair for an SLO whose stored
    /// slices were computed by a since-fixed bug is to re-save it with a
    /// whitespace-only edit to its query.
    ///
    /// **Internal** whitespace, not leading or trailing, and that is not a
    /// detail: the Monaco editor behind the SLO query field trims on blur and
    /// rewrites its own model before the save reads it
    /// (`web/src/components/CodeQueryEditor.vue`), so an edit that only adds a
    /// trailing space never reaches this comparison — the operator would get a
    /// successful save that rebuilt nothing. A doubled space between two
    /// tokens survives both that trim and `SloExpressionField`'s newline
    /// collapse.
    ///
    /// Driven through `update` rather than by calling [`definition_changed`]
    /// directly, so that swapping the CALL SITE breaks it too. The comparison
    /// has an unreferenced twin in
    /// `config::meta::slo::generation::requires_new_generation`, whose
    /// `canonicalize` step collapses whitespace inside every string and whose
    /// own tests assert that whitespace-only edits do NOT force a rebuild.
    /// Wiring it in here would look like a tidy-up and would silently turn the
    /// documented repair into a no-op. If that happens, this test fails and
    /// the release note has to change with it.
    #[tokio::test]
    async fn an_internal_whitespace_query_edit_bumps_the_generation() {
        fn time_slice_sli(query: &str) -> SliConfig {
            SliConfig::TimeSlice {
                stream: "requests".into(),
                stream_type: "logs".into(),
                query_language: QueryLanguage::Sql,
                query: query.to_string(),
                scope: None,
                comparator: Operator::LessThan,
                threshold: 300.0,
                absent_is_bad: false,
            }
        }

        let db = db().await;
        let mut original = slo();
        original.definition.sli_config = time_slice_sli("approx_percentile_cont(duration, 0.95)");
        create(&db, &original, 1_000, None).await.unwrap();

        let mut edited = original.clone();
        edited.definition.sli_config = time_slice_sli("approx_percentile_cont(duration,  0.95)");

        assert_eq!(
            update(&db, &edited, 2_000, None).await.unwrap(),
            GenerationEffect::Bumped { from: 1, to: 2 },
            "a doubled space must mint a new generation, or the documented repair is a no-op"
        );

        // The bump is the whole point: the rebuild reads from the re-seeded
        // status row, so a bump that did not reset it would leave the old
        // definition's arithmetic in the new epoch's window.
        let status = slo::load_status(&db, ID, slo_status::ROLLUP_GROUP_KEY)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status.definition_generation, 2);
        assert_eq!(status.good, None, "re-seeded, not carried over");
    }

    /// The control that keeps the repair honest, and the reason it cannot be
    /// stated as "open the SLO and press Save": an unchanged re-save returns
    /// `Unchanged` and rebuilds nothing at all.
    #[tokio::test]
    async fn re_saving_an_identical_definition_rebuilds_nothing() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        assert_eq!(
            update(&db, &slo(), 2_000, None).await.unwrap(),
            GenerationEffect::Unchanged(1)
        );
    }

    #[tokio::test]
    async fn changing_the_window_or_slice_interval_bumps_the_generation() {
        for mutate in [
            (|s: &mut Slo| s.definition.window_secs = 7 * 86_400) as fn(&mut Slo),
            |s: &mut Slo| s.definition.slice_interval_secs = 300,
            |s: &mut Slo| s.definition.group_by = Some(vec!["region".into()]),
        ] {
            let db = db().await;
            create(&db, &slo(), 1_000, None).await.unwrap();
            let mut edited = slo();
            mutate(&mut edited);
            assert!(matches!(
                update(&db, &edited, 2_000, None).await.unwrap(),
                GenerationEffect::Bumped { from: 1, to: 2 }
            ));
        }
    }

    /// A revert is a THIRD definition as far as in-flight passes are
    /// concerned: a pass planned under generation 1 must not commit into a
    /// window that generation 2 has already partly written (D59).
    #[tokio::test]
    async fn reverting_an_edit_bumps_again_rather_than_returning_to_the_old_generation() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();

        let mut edited = slo();
        edited.definition.sli_config = count_sli("status < 400");
        update(&db, &edited, 2_000, None).await.unwrap();

        // Byte-identical to the original definition.
        assert_eq!(
            update(&db, &slo(), 3_000, None).await.unwrap(),
            GenerationEffect::Bumped { from: 2, to: 3 }
        );
    }

    /// `None` and `Some([])` both mean ungrouped. A UI that sends the empty
    /// array must not look like a redefinition.
    #[tokio::test]
    async fn an_empty_group_by_is_not_a_redefinition() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut edited = slo();
        edited.definition.group_by = Some(vec![]);
        assert_eq!(
            update(&db, &edited, 2_000, None).await.unwrap(),
            GenerationEffect::Unchanged(1)
        );
    }

    #[tokio::test]
    async fn a_generation_bump_clears_the_running_aggregate() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        slo::apply_status(
            &db,
            &slo::StatusWrite {
                slo_id: ID.to_string(),
                definition_generation: 1,
                writer: config::meta::slo::slice::Writer::Incremental,
                deltas: vec![slo::GroupDelta {
                    group_key: slo_status::ROLLUP_GROUP_KEY.to_string(),
                    good_delta: 99.0,
                    total_delta: 100.0,
                    covered_slices_delta: 1,
                }],
                watermark_end: Some(9_000),
                trailing_slices: None,
                burn_windows: None,
                computed_at: 1_500,
            },
        )
        .await
        .unwrap();

        let mut edited = slo();
        edited.definition.sli_config = count_sli("status < 400");
        update(&db, &edited, 2_000, None).await.unwrap();

        let status = slo::load_status(&db, ID, slo_status::ROLLUP_GROUP_KEY)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status.definition_generation, 2);
        assert_eq!(
            status.good, None,
            "the old definition's arithmetic survived"
        );
        assert_eq!(status.watermark_end, None);
    }

    /// The incremental writer starts at `reset_time` and backfill owns
    /// strictly before it. A stale reset time would let them collide.
    #[tokio::test]
    async fn a_bump_records_the_new_epochs_reset_time() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();

        let mut edited = slo();
        edited.definition.window_secs = 7 * 86_400;
        update(&db, &edited, 2_000, None).await.unwrap();

        let row = slos::Entity::find_by_id(ID.to_string())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.generation_reset_time, Some(2_000));
    }

    #[tokio::test]
    async fn a_non_bumping_edit_leaves_the_reset_time_alone() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut edited = slo();
        edited.name = "renamed".into();
        update(&db, &edited, 2_000, None).await.unwrap();

        let row = slos::Entity::find_by_id(ID.to_string())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.generation_reset_time, Some(1_000));
    }

    #[tokio::test]
    async fn updating_an_slo_in_another_org_fails() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut other = slo();
        other.org = "other-org".into();
        assert!(update(&db, &other, 2_000, None).await.is_err());
    }

    // ===================== listing & lifecycle ============================

    #[tokio::test]
    async fn listing_is_scoped_to_folder_when_asked() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut other = slo();
        other.id = "slo11111111111111111111111".into();
        other.folder_id = "payments".into();
        create(&db, &other, 1_000, None).await.unwrap();

        assert_eq!(list(&db, ORG, None).await.unwrap().len(), 2);
        assert_eq!(list(&db, ORG, Some("payments")).await.unwrap().len(), 1);
    }

    // ===================== moving between folders =========================

    #[tokio::test]
    async fn move_relocates_the_named_slos_and_reports_the_count() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut other = slo();
        other.id = "slo11111111111111111111111".into();
        other.name = "latency".into();
        create(&db, &other, 1_000, None).await.unwrap();

        let moved = move_to_folder(&db, ORG, &[ID.to_string()], "payments", 2_000, Some("me"))
            .await
            .unwrap();

        assert_eq!(moved, 1);
        assert_eq!(list(&db, ORG, Some("payments")).await.unwrap().len(), 1);
        // The one not named stays put.
        let stayed = list(&db, ORG, Some("default")).await.unwrap();
        assert_eq!(stayed.len(), 1);
        assert_eq!(stayed[0].id, other.id);
    }

    /// The whole reason this is not routed through `update()`: a folder is not
    /// part of the definition, so moving must not start a new writing epoch —
    /// which would discard every slice measured so far (D59).
    #[tokio::test]
    async fn move_does_not_bump_the_generation() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let before = get(&db, ORG, ID).await.unwrap().unwrap();

        move_to_folder(&db, ORG, &[ID.to_string()], "payments", 2_000, Some("me"))
            .await
            .unwrap();

        let after = get(&db, ORG, ID).await.unwrap().unwrap();
        assert_eq!(after.definition_generation, before.definition_generation);
        assert_eq!(after.folder_id, "payments");
        // And the definition itself is untouched.
        assert_eq!(after.name, before.name);
        assert_eq!(after.target, before.target);
    }

    #[tokio::test]
    async fn move_ignores_slos_belonging_to_another_org() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();

        let moved = move_to_folder(
            &db,
            "someone-else",
            &[ID.to_string()],
            "payments",
            2_000,
            None,
        )
        .await
        .unwrap();

        assert_eq!(moved, 0);
        assert_eq!(
            get(&db, ORG, ID).await.unwrap().unwrap().folder_id,
            "default"
        );
    }

    /// `(org, folder_id, name)` is unique, so a colliding move fails whole —
    /// the caller must not be told a partial move succeeded.
    #[tokio::test]
    async fn move_into_a_folder_holding_the_same_name_fails_and_moves_nothing() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut twin = slo();
        twin.id = "slo11111111111111111111111".into();
        twin.folder_id = "payments".into(); // same name, different folder
        create(&db, &twin, 1_000, None).await.unwrap();

        let err = move_to_folder(&db, ORG, &[ID.to_string()], "payments", 2_000, None)
            .await
            .unwrap_err();

        assert!(
            format!("{err}").to_lowercase().contains("unique")
                || format!("{err}").to_lowercase().contains("duplicate"),
            "expected a unique-violation, got: {err}"
        );
        assert_eq!(
            get(&db, ORG, ID).await.unwrap().unwrap().folder_id,
            "default"
        );
    }

    #[tokio::test]
    async fn move_with_no_ids_is_a_no_op() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        assert_eq!(
            move_to_folder(&db, ORG, &[], "payments", 2_000, None)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn only_enabled_slos_are_scheduled() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut off = slo();
        off.id = "slo11111111111111111111111".into();
        off.name = "disabled".into();
        off.enabled = false;
        create(&db, &off, 1_000, None).await.unwrap();

        let enabled = list_enabled(&db).await.unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, ID);
    }

    #[tokio::test]
    async fn toggling_enabled_never_bumps_the_generation() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        assert!(set_enabled(&db, ORG, ID, false, 2_000).await.unwrap());

        let row = slos::Entity::find_by_id(ID.to_string())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert!(!row.enabled);
        assert_eq!(row.definition_generation, 1, "pausing is not redefining");
    }

    #[tokio::test]
    async fn deleting_an_slo_removes_its_status_rows() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        assert!(delete(&db, ORG, ID).await.unwrap());
        assert!(get(&db, ORG, ID).await.unwrap().is_none());
        assert!(
            slo::load_status(&db, ID, slo_status::ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn deleting_from_the_wrong_org_is_a_no_op() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        assert!(!delete(&db, "other-org", ID).await.unwrap());
        assert!(get(&db, ORG, ID).await.unwrap().is_some());
    }

    /// The unique index is the only thing standing between a user and two
    /// SLOs they cannot tell apart in a folder listing.
    #[tokio::test]
    async fn two_slos_cannot_share_a_name_within_a_folder() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut clash = slo();
        clash.id = "slo11111111111111111111111".into();
        assert!(create(&db, &clash, 1_000, None).await.is_err());
    }

    #[tokio::test]
    async fn the_same_name_is_allowed_in_a_different_folder() {
        let db = db().await;
        create(&db, &slo(), 1_000, None).await.unwrap();
        let mut elsewhere = slo();
        elsewhere.id = "slo11111111111111111111111".into();
        elsewhere.folder_id = "payments".into();
        create(&db, &elsewhere, 1_000, None).await.unwrap();
        assert_eq!(count_in_org(&db, ORG).await.unwrap(), 2);
    }

    // ===================== org teardown ===================================

    const OTHER_ORG: &str = "globex";

    /// A distinct SLO, in whichever org — the unique index makes the name
    /// track the id so two fixtures can share a folder.
    fn slo_in(org: &str, id: &str) -> Slo {
        let mut s = slo();
        s.org = org.to_string();
        s.id = id.to_string();
        s.name = format!("slo {id}");
        s
    }

    #[tokio::test]
    async fn delete_by_org_removes_every_slo_in_the_org() {
        let db = db().await;
        create(&db, &slo_in(ORG, ID), 1_000, None).await.unwrap();
        create(&db, &slo_in(ORG, "slo11111111111111111111111"), 1_000, None)
            .await
            .unwrap();

        delete_by_org(&db, ORG).await.unwrap();
        assert_eq!(count_in_org(&db, ORG).await.unwrap(), 0);
    }

    /// Org scoping is a security boundary here too: a teardown must not reach
    /// past the org being deleted.
    #[tokio::test]
    async fn delete_by_org_leaves_other_orgs_slos_alone() {
        let db = db().await;
        create(&db, &slo_in(ORG, ID), 1_000, None).await.unwrap();
        create(
            &db,
            &slo_in(OTHER_ORG, "slo11111111111111111111111"),
            1_000,
            None,
        )
        .await
        .unwrap();

        delete_by_org(&db, ORG).await.unwrap();
        assert_eq!(count_in_org(&db, ORG).await.unwrap(), 0);
        assert_eq!(
            count_in_org(&db, OTHER_ORG).await.unwrap(),
            1,
            "another org's SLO was deleted"
        );
    }

    /// Org cleanup retries steps, so the second run must find nothing and
    /// still succeed.
    #[tokio::test]
    async fn delete_by_org_on_an_org_with_no_slos_is_a_no_op() {
        let db = db().await;
        create(&db, &slo_in(OTHER_ORG, ID), 1_000, None)
            .await
            .unwrap();

        delete_by_org(&db, ORG).await.unwrap();
        delete_by_org(&db, ORG).await.unwrap();
        assert_eq!(count_in_org(&db, OTHER_ORG).await.unwrap(), 1);
    }

    // ===================== the reverse lookup (S-16 PR 4) =================

    const ALERT: &str = "2abcdefghijklmnopqrstuvwxyz";
    const OTHER_ALERT: &str = "2zyxwvutsrqponmlkjihgfedcb";

    fn alert_slo(id: &str, org: &str, alert_id: &str) -> Slo {
        let mut s = slo_in(org, id);
        s.definition.sli_config = SliConfig::Alert {
            alert_id: alert_id.to_string(),
        };
        s
    }

    /// Ordered by name, not by insertion: the 409 this feeds names the SLOs,
    /// and a message whose wording depends on row order is a message nobody
    /// can write a test — or a runbook — against.
    #[tokio::test]
    async fn the_reverse_lookup_finds_the_slos_measuring_from_an_alert() {
        let db = db().await;
        let mut zebra = alert_slo(ID, ORG, ALERT);
        zebra.name = "zebra availability".into();
        let mut alpha = alert_slo("slo11111111111111111111111", ORG, ALERT);
        alpha.name = "alpha availability".into();
        create(&db, &zebra, 1_000, None).await.unwrap();
        create(&db, &alpha, 1_000, None).await.unwrap();

        let found = list_by_source_alert(&db, ORG, ALERT).await.unwrap();
        let names: Vec<&str> = found.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["alpha availability", "zebra availability"]);
    }

    /// The three ways a row can look like a match and not be one. Getting any
    /// of them wrong turns the delete guard into a refusal the user cannot
    /// explain — or, worse, lets a real dependent through.
    #[tokio::test]
    async fn the_reverse_lookup_matches_only_this_alert_in_this_org() {
        let db = db().await;
        // A non-alert SLI, which carries no alert_id at all.
        create(&db, &slo_in(ORG, ID), 1_000, None).await.unwrap();
        // An alert SLI on a DIFFERENT source.
        create(
            &db,
            &alert_slo("slo11111111111111111111111", ORG, OTHER_ALERT),
            1_000,
            None,
        )
        .await
        .unwrap();
        // The same source, in another org.
        create(
            &db,
            &alert_slo("slo22222222222222222222222", OTHER_ORG, ALERT),
            1_000,
            None,
        )
        .await
        .unwrap();

        assert!(
            list_by_source_alert(&db, ORG, ALERT)
                .await
                .unwrap()
                .is_empty()
        );
    }

    /// A paused SLO still measures from that source the moment it resumes, so
    /// deleting its source would leave it unrecoverable — exactly the reason
    /// `list_alerts_by_slo` counts disabled alerts.
    #[tokio::test]
    async fn a_disabled_slo_still_counts_as_a_dependent() {
        let db = db().await;
        let mut s = alert_slo(ID, ORG, ALERT);
        s.enabled = false;
        create(&db, &s, 1_000, None).await.unwrap();
        assert_eq!(
            list_by_source_alert(&db, ORG, ALERT).await.unwrap().len(),
            1
        );
    }

    // ===================== the external bump (S-16 PR 4) ==================

    #[tokio::test]
    async fn an_external_bump_starts_a_new_epoch() {
        let db = db().await;
        create(&db, &alert_slo(ID, ORG, ALERT), 1_000, None)
            .await
            .unwrap();

        assert_eq!(
            bump_generation(&db, ORG, ID, 9_000).await.unwrap(),
            Some((1, 2))
        );
        let after = get(&db, ORG, ID).await.unwrap().unwrap();
        assert_eq!(after.definition_generation, 2);
        // The fence that keeps the incremental writer and backfill off each
        // other's slices has to move with the epoch (§6b.9).
        assert_eq!(generation_reset_time(&db, ID).await.unwrap(), Some(9_000));
        // The definition itself is untouched — the source moved, not the SLO.
        assert_eq!(after.definition, alert_slo(ID, ORG, ALERT).definition);
    }

    /// Leaving the old aggregates would average two definitions into one
    /// number that describes neither — the one corruption eventual
    /// consistency does not repair.
    #[tokio::test]
    async fn an_external_bump_clears_and_reseeds_the_aggregates() {
        let db = db().await;
        create(&db, &alert_slo(ID, ORG, ALERT), 1_000, None)
            .await
            .unwrap();
        let applied = slo::apply_status(
            &db,
            &slo::StatusWrite {
                slo_id: ID.to_string(),
                definition_generation: 1,
                writer: config::meta::slo::slice::Writer::Incremental,
                deltas: vec![slo::GroupDelta {
                    group_key: slo_status::ROLLUP_GROUP_KEY.to_string(),
                    good_delta: 90.0,
                    total_delta: 100.0,
                    covered_slices_delta: 100,
                }],
                watermark_end: Some(5_000),
                trailing_slices: None,
                burn_windows: None,
                computed_at: 5_000,
            },
        )
        .await
        .unwrap();
        // Or the aggregates were never written and the assertions below would
        // hold for a reason that has nothing to do with the bump.
        assert_eq!(applied, slo::WriteOutcome::Applied);
        assert_eq!(
            slo::load_status(&db, ID, slo_status::ROLLUP_GROUP_KEY)
                .await
                .unwrap()
                .unwrap()
                .good,
            Some(90.0)
        );

        bump_generation(&db, ORG, ID, 9_000).await.unwrap();

        let rows = slo::load_all_groups(&db, ID).await.unwrap();
        assert_eq!(rows.len(), 1, "only the rollup seed survives");
        assert_eq!(rows[0].group_key, slo_status::ROLLUP_GROUP_KEY);
        assert_eq!(rows[0].definition_generation, 2);
        assert_eq!(rows[0].good, None, "reseeded, not carried over");
        assert_eq!(rows[0].total, None);
    }

    #[tokio::test]
    async fn bumping_an_slo_that_is_not_there_changes_nothing() {
        let db = db().await;
        create(&db, &alert_slo(ID, ORG, ALERT), 1_000, None)
            .await
            .unwrap();
        assert_eq!(
            bump_generation(&db, "other-org", ID, 9_000).await.unwrap(),
            None
        );
        assert_eq!(
            bump_generation(&db, ORG, "nope", 9_000).await.unwrap(),
            None
        );
        assert_eq!(
            get(&db, ORG, ID)
                .await
                .unwrap()
                .unwrap()
                .definition_generation,
            1
        );
    }
}

/// Generation semantics for `absent_is_bad` — the property that makes the
/// flag safe to add at all.
#[cfg(test)]
mod absent_is_bad_generation_tests {
    use config::meta::{
        alerts::Operator,
        slo::{QueryLanguage, SliConfig, SloDefinition},
    };

    use super::definition_changed;

    fn ts_def(absent_is_bad: bool) -> SloDefinition {
        SloDefinition {
            sli_config: SliConfig::TimeSlice {
                stream: "s".into(),
                stream_type: "logs".into(),
                query_language: QueryLanguage::Sql,
                query: "count(*)".into(),
                scope: None,
                comparator: Operator::GreaterThanEquals,
                threshold: 1.0,
                absent_is_bad,
            },
            group_by: None,
            window_secs: 30 * 86_400,
            slice_interval_secs: 300,
        }
    }

    /// Toggling the flag changes what every empty slice MEANS — gap versus
    /// downtime — so slices computed under the two rules must never be
    /// averaged into one number (the D59 corruption). A toggle is a
    /// redefinition and starts a new epoch.
    #[test]
    fn toggling_absent_is_bad_is_a_redefinition() {
        assert!(definition_changed(&ts_def(false), &ts_def(true)));
        assert!(definition_changed(&ts_def(true), &ts_def(false)));
    }

    /// The mirror guarantee: a UI round-tripping an old SLO sends an explicit
    /// `false`, the stored row deserializes to `false` — equal, no bump, and
    /// no 90 days of measurement discarded by merely opening the edit form.
    #[test]
    fn an_explicit_false_is_not_a_redefinition() {
        assert!(!definition_changed(&ts_def(false), &ts_def(false)));
    }
}
