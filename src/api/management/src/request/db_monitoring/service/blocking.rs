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

//! `/blocking` — the blocking/waiting session read, its raw-span fallback and
//! the episode de-duplication that collapses repeated polls.

// The models these pull in are named only from enterprise-gated bodies, so the
// glob is genuinely unused on OSS. Keep the import (enterprise needs it) and
// silence the OSS-only lint rather than splitting it behind a cfg.
#[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
use super::{super::models::*, *};

/// The raw BLOCKING columns this stream can be queried for.
///
/// Same gate, same reasoning, different vocabulary — see
/// [`raw_deadlock_columns_in`]. Kept as its own function rather than a parameter
/// on one shared helper because the two vocabularies are consumed by different
/// callers and a shared entry point invites passing the wrong one.
#[cfg(feature = "enterprise")]
fn raw_blocking_columns_in(
    schema: &arrow_schema::Schema,
    uds_fields: &[String],
) -> HashSet<String> {
    queryable_columns(&server_vantage::RAW_BLOCKING_FIELDS, schema, uds_fields)
}

/// Read the raw BLOCKING column gate for one stream.
///
/// Mirror of [`present_raw_deadlock_columns`], including its `Err` discipline.
#[cfg(feature = "enterprise")]
async fn present_raw_blocking_columns(
    org_id: &str,
    stream_name: &str,
) -> Result<HashSet<String>, anyhow::Error> {
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await?;
    let settings = infra::schema::get_settings(org_id, stream_name, StreamType::Logs).await;
    let uds = infra::schema::get_stream_setting_defined_schema_fields(&settings);
    Ok(raw_blocking_columns_in(&schema, &uds))
}

/// The A1 phase-2a read-time fallback for BLOCKING, carrying its schema-gated
/// raw column set.
///
/// A distinct type from [`RawDeadlockFallback`] rather than one generic carrier:
/// the two vocabularies are different arrays and the marker shapes differ (four
/// columns vs one column with four values), so a single type would have to be
/// told which it was holding — and the compiler can enforce that for free by
/// making them different types. It is what stops the activity caller, which
/// shares the builder, from being handed either one.
///
/// NOT `#[cfg]`-gated, for the same reason as its deadlock twin: activity is an
/// OSS-owned ungated page calling the same builder, so the parameter's type must
/// exist in both builds. Inert on OSS — nothing there constructs one.
pub(crate) struct RawBlockingFallback {
    /// Raw columns this stream can actually be queried for.
    pub present: HashSet<String>,
}

impl RawBlockingFallback {
    /// The marker terms for the `WHERE`, gated on the marker COLUMN's presence.
    ///
    /// All four blocking recipes share the single `o2_recipe` column, so unlike
    /// the deadlock markers this is all-or-nothing: either the stream has
    /// `o2_recipe` and all four terms are emitted, or it has none and the
    /// widening cannot fire at all. Naming the column when it is absent is the
    /// same whole-page 400 the projection gate exists to prevent.
    pub(super) fn marker_terms(&self) -> Vec<String> {
        server_vantage::BLOCKING_MARKERS
            .into_iter()
            .filter(|(col, _)| self.present.contains(*col))
            .map(|(col, val)| format!("{col} = '{val}'"))
            .collect()
    }
}

// ─── A1.1 · the canonicalization boundary ────────────────────────────────────
//
// A1 shipped ALWAYS-ON: every deadlocks read widened its SQL with the raw
// markers and the raw projection and branched per row, forever — including on a
// deployment that has been enterprise for a year and has not written a raw
// deadlock row since. The fallback is meant to be TRANSITIONAL: it exists to
// carry a deployment across its OSS→enterprise upgrade, and once the
// pre-upgrade window ages out of retention it should cost nothing.
//
// So the widening is scoped to the window BEFORE this deployment started
// canonicalizing. That makes it SELF-LIMITING — no operator action, no date to
// set, no knob to remember. It narrows on its own as history ages out.
//
// This narrows WHICH READS adapt. It does NOT touch a stored row: adapted
// queries only, permanently (§9). No backfill, no re-canonicalization, no
// materializing canonical columns into stored rows.

/// SQL for ANY raw-marker BLOCKING row inside the window.
///
/// Mirror of [`build_raw_deadlock_presence_sql`] over the blocking markers.
/// `None` when the stream has no `o2_recipe` column: no raw blocking row can
/// exist, so the caller reads that as "no raw rows" without running a query.
#[cfg(feature = "enterprise")]
pub(crate) fn build_raw_blocking_presence_sql(
    stream_name: &str,
    raw: &RawBlockingFallback,
) -> Option<String> {
    let markers = raw.marker_terms();
    if markers.is_empty() {
        return None;
    }
    Some(format!(
        "SELECT _timestamp FROM \"{}\"\nWHERE ({})\nLIMIT 1",
        escape_ident(stream_name),
        markers.join(" OR "),
    ))
}

/// Does this window need the raw BLOCKING widening?
///
/// **This reuses the `has_raw_row` probe, deliberately, and does NOT
/// reintroduce a canonicalization-boundary check.** §11.0 of the design records
/// that the boundary timestamp was falsified during phase 1: it is entirely
/// SUBSUMED by raw-row presence, and consulting it reintroduces A1 under
/// enterprise→OSS→enterprise interleaving, where raw rows appear AFTER canonical
/// ones and a boundary-only verdict says "go fast" and drops them.
///
/// So the question is the same one phase 1 settled on — "does this window
/// contain anything the canonical fast path would miss" — and the answer is
/// exactly raw-row presence. That makes the widening self-limiting: once no raw
/// blocking row remains in retention, no window contains one and the widening
/// stops firing, with no operator action and no date to set.
///
/// Errors degrade to the SAFE direction (widen), matching the house rule that
/// ambiguous cases resolve toward SHOWING data.
#[cfg(feature = "enterprise")]
async fn blocking_window_needs_fallback(
    org_id: &str,
    user_id: Option<&str>,
    stream: &str,
    start_time: i64,
    end_time: i64,
    raw: &RawBlockingFallback,
) -> bool {
    let Some(raw_sql) = build_raw_blocking_presence_sql(stream, raw) else {
        // No marker column on this stream, so no raw row can exist.
        return false;
    };
    match run_events_search(org_id, user_id, stream, raw_sql, start_time, end_time).await {
        Ok(rows) => {
            let needed = !rows.is_empty();
            if needed {
                log::debug!(
                    "[DbMonitoring] blocking widening for {org_id}/{stream}: a raw \
                     blocking row is present in the window"
                );
            }
            needed
        }
        Err(e) => {
            log::warn!(
                "[DbMonitoring] blocking raw-presence probe failed for {org_id}/{stream}, \
                 widening the read: {e:?}"
            );
            true
        }
    }
}

/// Turn ONE stored row into a [`server_vantage::BlockingSample`], whichever
/// shape it is in — the phase-2a row-level branch.
///
/// Same per-ROW discriminator and same dedup argument as
/// [`deadlock_event_for_row`]: a row either has `o2_dbm_kind = 'blocking'` or it
/// does not, and this branches on exactly that, consuming each row once.
///
/// A raw row the canonicalizer refuses yields `None` and is DROPPED.
/// `canonicalize_blocking` requires BOTH pids, so a row whose blocking side
/// never resolved is not a blocking relationship and must not reach the page as
/// a half-empty chain.
///
/// Unlike deadlocks, this needs NO new enterprise entry point:
/// `canonicalize_blocking` is already engine-agnostic (it resolves each field
/// through an alias list rather than dispatching per engine), already returns
/// `Option<BlockingSample>`, and is already re-exported to OSS.
#[cfg(feature = "enterprise")]
fn blocking_sample_for_row(row: &Value) -> Option<server_vantage::BlockingSample> {
    if get_str(row, server_vantage::O2_DBM_KIND) == server_vantage::KIND_BLOCKING {
        return server_vantage::BlockingSample::from_record(row);
    }
    let rec = row.as_object()?;
    server_vantage::canonicalize_blocking(rec)
}

/// Scope narrowing for BLOCKING, applied in Rust for the same reason as
/// [`ScopeNarrowing`] — raw rows carry no `o2_dbm_*` scope column, so pushing
/// `?system=` to SQL drops every one of them.
///
/// A separate type from `ScopeNarrowing` because it matches a different event
/// type; the rule it implements is identical, including "an UNKNOWN field does
/// not match" and "an EMPTY STRING is not a filter".
#[cfg(feature = "enterprise")]
struct BlockingScopeNarrowing {
    system: Option<String>,
    instance: Option<String>,
    database: Option<String>,
}

#[cfg(feature = "enterprise")]
impl BlockingScopeNarrowing {
    fn new(q: &BlockingQuery) -> Self {
        BlockingScopeNarrowing {
            system: q.system.clone(),
            instance: q.instance.clone(),
            database: q.database().map(str::to_string),
        }
    }

    fn matches(&self, s: &server_vantage::BlockingSample) -> bool {
        let ok = |want: &Option<String>, got: &Option<String>| match want
            .as_deref()
            .filter(|s| !s.is_empty())
        {
            None => true,
            Some(w) => got.as_deref() == Some(w),
        };
        ok(&self.system, &s.engine)
            && ok(&self.instance, &s.instance)
            && ok(&self.database, &s.database)
    }
}

/// Free-text match over one blocking sample.
#[cfg(feature = "enterprise")]
fn blocking_matches_search(s: &server_vantage::BlockingSample, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    let hit = |v: &Option<String>| {
        v.as_deref()
            .is_some_and(|x| x.to_lowercase().contains(needle_lower))
    };
    hit(&s.blocked_query)
        || hit(&s.blocking_query)
        || hit(&s.blocked_app)
        || hit(&s.blocking_app)
        || hit(&s.blocked_fingerprint)
        || hit(&s.blocking_fingerprint)
        || hit(&s.wait_event)
        || hit(&s.wait_event_type)
        || hit(&s.database)
        || hit(&s.instance)
}

/// Serialize one blocking sample into the UI-facing DTO.
///
/// Same contract as the deadlock DTO: no `o2_dbm_` prefixes, and `db_system` /
/// `db_instance` / `db_namespace` are the names every other DBM endpoint uses
/// for these three, so the UI reads one vocabulary across the whole feature.
#[cfg(feature = "enterprise")]
fn blocking_sample_to_dto(s: &server_vantage::BlockingSample) -> Value {
    json!({
        "timestamp": s.timestamp.unwrap_or(0),
        "blocked_pid": s.blocked_pid,
        "blocking_pid": s.blocking_pid,
        "blocked_query": s.blocked_query,
        "blocking_query": s.blocking_query,
        "blocked_fingerprint": s.blocked_fingerprint,
        "blocking_fingerprint": s.blocking_fingerprint,
        "blocked_application": s.blocked_app,
        "blocking_application": s.blocking_app,
        "wait_event_type": s.wait_event_type,
        "wait_event": s.wait_event,
        "wait_seconds": s.wait_seconds,
        "db_system": s.engine.clone().unwrap_or_default(),
        "db_instance": s.instance,
        "db_namespace": s.database,
    })
}

/// O1 · Collapse repeated poll observations of one wait into its final
/// observation.
///
/// A blocking sample is a POLL SNAPSHOT of a wait, not an event: the sampler
/// re-observes a still-blocked `(blocked_pid, blocking_pid)` pair on every
/// poll for as long as the wait lasts, so a 5-minute wait at a 10 s interval
/// lands ~30 rows. Counting rows counts polls — the badge reported ~30
/// "blocked sessions" for ONE wait, and any duration sum re-added the same
/// wait's growing `wait_seconds` once per poll.
///
/// The identity of one wait is `(engine, instance, database, blocked_pid,
/// blocking_pid)` — pids are per-instance, and every snapshot of one wait
/// carries the same engine/instance/database — split into EPISODES where
/// `wait_seconds` DECREASES between time-ordered observations: within one wait
/// the engine's reported wait time grows monotonically, so a drop means the
/// pids were REUSED for a new wait later in the window. Per episode the LAST
/// observation is kept — the one carrying the wait's maximum observed
/// `wait_seconds` — so summing the kept rows' `wait_seconds` measures time
/// lost without repeat-counting. Observations without `wait_seconds` cannot be
/// episode-split and collapse to the latest observation per pair.
///
/// Output is ordered newest-first, matching the SQL's presentation order.
#[cfg(feature = "enterprise")]
fn dedupe_blocking_waits(
    samples: Vec<server_vantage::BlockingSample>,
) -> Vec<server_vantage::BlockingSample> {
    type WaitKey = (String, String, String, Option<i64>, Option<i64>);
    let mut groups: BTreeMap<WaitKey, Vec<server_vantage::BlockingSample>> = BTreeMap::new();
    for s in samples {
        let key = (
            s.engine.clone().unwrap_or_default(),
            s.instance.clone().unwrap_or_default(),
            s.database.clone().unwrap_or_default(),
            s.blocked_pid,
            s.blocking_pid,
        );
        groups.entry(key).or_default().push(s);
    }
    let mut kept: Vec<server_vantage::BlockingSample> = Vec::new();
    for (_key, mut obs) in groups {
        obs.sort_by_key(|s| s.timestamp.unwrap_or(0));
        let mut prev_wait = f64::MIN;
        let mut episode_last: Option<server_vantage::BlockingSample> = None;
        for s in obs {
            // A small tolerance absorbs float noise in the engine's own
            // wait computation; a genuine new wait restarts near zero.
            let is_new_episode = match (s.wait_seconds, episode_last.is_some()) {
                (Some(w), true) => w + 1e-3 < prev_wait,
                _ => false,
            };
            if is_new_episode && let Some(done) = episode_last.take() {
                kept.push(done);
            }
            if let Some(w) = s.wait_seconds {
                prev_wait = w;
            }
            episode_last = Some(s);
        }
        if let Some(done) = episode_last {
            kept.push(done);
        }
    }
    kept.sort_by_key(|s| std::cmp::Reverse(s.timestamp.unwrap_or(0)));
    kept
}

/// The blocking badge member — the strip reads `total`/`truncated` for the
/// badge and `hits` for its high-impact-blocker rule — the same samples the
/// tab renders; chain assembly and the probe reads are enrichment it never
/// consumes. A callable, like [`server_metrics_envelope`], so the shape is
/// tested for real instead of scraped out of the handler's source text.
///
/// `total` counts DISTINCT WAITS, not poll rows: the caller dedupes the
/// samples through [`dedupe_blocking_waits`] before building either envelope
/// (O1 — a 5-minute wait at 10 s polling is one wait, not ~30 sessions).
#[cfg(feature = "enterprise")]
pub(crate) fn blocking_badge_envelope(hits: &[Value], truncated: bool, stream: &str) -> Value {
    json!({
        "hits": hits,
        "total": hits.len(),
        "truncated": truncated,
        "stream": stream,
    })
}

/// The full blocking response envelope — pure shape assembly (no I/O), same
/// extraction rationale as [`server_metrics_envelope`].
#[cfg(feature = "enterprise")]
pub(crate) fn blocking_envelope(
    hits: &[Value],
    chains: &[Value],
    truncated: bool,
    stream: &str,
    probe: &CollectionProbe,
) -> Value {
    json!({
        "hits": hits,
        "chains": chains,
        "total": hits.len(),
        "truncated": truncated,
        "stream": stream,
        // ── collection diagnostics (empty state) ──────────────────────────
        "not_collecting": hits.is_empty() && probe.not_collecting(),
        // When the lock tables were last read AT ALL. Blocking is a STATE, not
        // an event: the poll that finds nothing is the healthy case and leaves
        // no blocking record, so this is the newest record of ANY kind — the
        // only honest evidence that the sampler ran.
        "sampled_at": probe.newest_record,
        // Inferred from the spacing of observed samples; `null` when too few to
        // infer, and the UI falls back to non-numeric copy.
        "sample_interval_seconds": probe.sample_interval_seconds(),
        "freshness": event_freshness(probe),
    })
}

/// The blocking endpoint's whole body as a callable — same extraction as
/// [`read_databases_body`], auth included. `badge_mode`/`prologue`: see
/// [`read_deadlocks_body`] — the badge member is [`blocking_badge_envelope`],
/// which skips chain assembly and the probe reads.
#[cfg(feature = "enterprise")]
pub(crate) async fn read_blocking_body(
    org_id: &str,
    user_id: &str,
    q: &BlockingQuery,
    badge_mode: bool,
    prologue: Option<&DbmServerPrologue>,
) -> Result<Value, HttpResponse> {
    let (start_time, end_time) = resolve_range(q.start_time, q.end_time);
    if start_time >= end_time {
        return Err(MetaHttpResponse::bad_request(
            "start_time must be before end_time",
        ));
    }
    let stream = q
        .stream
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_SERVER_STREAM);
    let shared_prologue = prologue.filter(|p| p.stream == stream);
    // Logs stream, same reasoning as `get_dbm_deadlocks`.
    if shared_prologue.is_none()
        && !can_read_stream(
            org_id,
            user_id,
            stream,
            required_stream_for(DbmVantage::Server),
        )
        .await
    {
        return Err(unauthorized_response());
    }
    let limit = q
        .limit
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .clamp(1, MAX_EVENTS_LIMIT);
    // Same contract as the deadlocks handler, and here the false verdict is the
    // loud one: an empty set drops the pid columns, `BlockingSample::from_record`
    // then filters out every row, and the page tells the operator
    // `not_collecting: true` — a healthy collector reported as broken.
    let present = match shared_prologue {
        Some(p) => p.present.clone(),
        None => match present_dbm_columns(org_id, stream).await {
            Ok(present) => present,
            Err(e) => {
                log::error!(
                    "[DbMonitoring] blocking schema read failed for {org_id}/{stream}: {e}"
                );
                return Err(MetaHttpResponse::internal_error(e));
            }
        },
    };
    let preds = dbm_event_preds(
        q.system.as_deref(),
        q.instance.as_deref(),
        q.database(),
        &present,
    );
    // A1 phase 2a · the same read-time fallback deadlocks got in phase 1.
    //
    // An OSS build stores a blocking-chain row verbatim and canonicalizes
    // nothing, so an enterprise build reading that history finds no
    // `o2_dbm_kind = 'blocking'` row and renders an empty page over real lock
    // contention — with `not_collecting: true`, a healthy collector reported as
    // broken.
    //
    // A failed raw-schema read degrades to `None` rather than failing the
    // request, the same asymmetry with `present` above that deadlocks documents:
    // `present` failing means the canonical path emits content-free rows, which
    // is a false verdict and must be a 500; the raw gate failing means only that
    // the fallback cannot run, and the canonical path is still correct.
    //
    // TRANSITIONAL, via the same raw-presence probe.
    let raw_fallback = match present_raw_blocking_columns(org_id, stream).await {
        Ok(present) => {
            let candidate = RawBlockingFallback { present };
            if blocking_window_needs_fallback(
                org_id,
                Some(user_id),
                stream,
                start_time,
                end_time,
                &candidate,
            )
            .await
            {
                Some(candidate)
            } else {
                None
            }
        }
        Err(e) => {
            log::warn!(
                "[DbMonitoring] blocking raw-column read failed for {org_id}/{stream}, \
                 serving canonical rows only: {e}"
            );
            None
        }
    };

    // SCOPE FILTERS MUST NOT REACH THE RAW ROWS' SQL — see the deadlocks handler.
    // `dbm_event_preds` names canonical columns a raw row does not have, so
    // appending them to the widened WHERE silently drops EVERY raw row.
    let scope = BlockingScopeNarrowing::new(q);
    let sql_preds = if raw_fallback.is_some() { "" } else { &preds };
    let sql = build_dbm_events_sql(
        stream,
        server_vantage::KIND_BLOCKING,
        sql_preds,
        limit,
        &DbmProjection {
            present: &present,
            raw: raw_fallback.as_ref().map(RawProjection::Blocking),
        },
    );
    let rows =
        match run_events_search(org_id, Some(user_id), stream, sql, start_time, end_time).await {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("[DbMonitoring] blocking read failed for {org_id}/{stream}: {e}");
                return Err(MetaHttpResponse::internal_error(e));
            }
        };

    // The min-wait and search filters are applied in Rust, deliberately: they
    // must filter the SAME rows that feed chain assembly, and a float predicate
    // in SQL over a column that may be stored as text would silently drop rows.
    let min_wait = q.min_wait_seconds.unwrap_or(f64::MIN);
    let needle = q.search.as_deref().unwrap_or("").trim().to_lowercase();
    let samples: Vec<server_vantage::BlockingSample> = rows
        .iter()
        // Per-ROW branch: canonical rows keep the canonical reader, raw rows go
        // to the enterprise canonicalizer, and a raw row it refuses (one with
        // only one end of the edge) is dropped rather than emitted blank.
        .filter_map(blocking_sample_for_row)
        // Scope narrowing in Rust when the fallback moved it off the SQL. A
        // no-op when inactive, because then the SQL predicates already applied.
        .filter(|s| raw_fallback.is_none() || scope.matches(s))
        .filter(|s| s.wait_seconds.unwrap_or(0.0) >= min_wait)
        .filter(|s| blocking_matches_search(s, &needle))
        .collect();
    // O1 · one wait, one row. The rows above are POLL SNAPSHOTS — the sampler
    // re-observes a still-blocked pair every poll — so both the badge and the
    // list must count distinct waits, not polls. Applied BEFORE the DTO map so
    // `hits`, `total`, chain assembly and the UI's time-lost sum all see the
    // deduped population.
    let samples = dedupe_blocking_waits(samples);
    let hits: Vec<Value> = samples.iter().map(blocking_sample_to_dto).collect();

    if badge_mode {
        return Ok(blocking_badge_envelope(&hits, rows.len() >= limit, stream));
    }

    let chains = chains::assemble_chains(&samples);

    // See the deadlocks handler: diagnose only the empty case.
    let probe = if hits.is_empty() {
        probe_collection(
            org_id,
            Some(user_id),
            stream,
            server_vantage::KIND_BLOCKING,
            start_time,
            end_time,
            &preds,
        )
        .await
    } else {
        CollectionProbe::default()
    };

    let chain_hits: Vec<Value> = chains.iter().map(|c| c.to_json()).collect();
    Ok(blocking_envelope(
        &hits,
        &chain_hits,
        rows.len() >= limit,
        stream,
        &probe,
    ))
}

#[cfg(test)]
mod tests {
    // Used only by enterprise-gated tests below; unused on an OSS build.
    #[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
    use serde_json::json;

    // Used only by enterprise-gated tests below; unused on an OSS build.
    #[cfg_attr(not(feature = "enterprise"), allow(unused_imports))]
    use super::{super::testutil::*, *};

    /// ...and for a BLOCKING read.
    #[cfg(feature = "enterprise")]
    fn proj_blocking<'a>(
        present: &'a HashSet<String>,
        raw: Option<&'a RawBlockingFallback>,
    ) -> DbmProjection<'a> {
        DbmProjection {
            present,
            raw: raw.map(RawProjection::Blocking),
        }
    }

    /// The raw-fallback opts for a blocking stream. Mirror of [`raw_cols`].
    #[cfg(feature = "enterprise")]
    fn raw_blocking_cols(present: &[&str]) -> RawBlockingFallback {
        for f in present {
            assert!(
                server_vantage::RAW_BLOCKING_FIELDS.contains(f),
                "{f} is not a RAW_BLOCKING_FIELDS member — the fixture is testing a \
                 column the gate could never return"
            );
        }
        RawBlockingFallback {
            present: present.iter().map(|f| f.to_string()).collect(),
        }
    }

    /// **The §1.3 regression test, for blocking.** The single most important
    /// test in this phase: naming a column absent from the stream schema fails
    /// the WHOLE page with a 400, so the widened projection must be intersected
    /// with what the stream actually has.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_blocking_projection_names_no_absent_raw_column() {
        // A stream that only ever ran the PG blocking recipe: it has none of the
        // InnoDB alias columns, and naming one takes the page down.
        let schema = schema_of(&[
            "_timestamp",
            "o2_recipe",
            "blocked_pid",
            "blocking_pid",
            "blocked_query",
        ]);
        let present = raw_blocking_columns_in(&schema, &[]);

        for absent in [
            "waiting_thread",
            "blocking_thread",
            "waiting_query",
            "wait_secs",
        ] {
            assert!(
                !present.contains(absent),
                "{absent} is absent from this stream's schema; projecting it 400s the \
                 whole Blocked Queries page"
            );
        }
        assert!(
            present.contains("blocked_pid") && present.contains("o2_recipe"),
            "what IS present must survive the gate, or the fallback can never fire"
        );
    }

    /// The presence gate must be UDS-aware — the quieter variant of the same
    /// 400. A field can be in the stored schema and still be unqueryable.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_blocking_presence_gate_honours_a_user_defined_schema() {
        let schema = schema_of(&["_timestamp", "o2_recipe", "blocked_pid", "blocking_pid"]);
        let uds = vec!["_timestamp".to_string(), "o2_recipe".to_string()];
        let present = raw_blocking_columns_in(&schema, &uds);

        assert!(
            !present.contains("blocked_pid"),
            "blocked_pid is in the stored schema but truncated out of the UDS, so \
             naming it 400s with 'exists in the stream but not in its User-Defined \
             Schema'"
        );
        assert!(
            present.contains("o2_recipe"),
            "a kept field stays queryable"
        );
    }

    /// The marker terms must be gated on presence too — the half of the hazard
    /// that lives in the predicate rather than the projection.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_blocking_marker_terms_are_schema_gated() {
        assert!(
            raw_blocking_cols(&["blocked_pid"])
                .marker_terms()
                .is_empty(),
            "without the o2_recipe column there is no marker term to emit; naming it \
             anyway 400s the page"
        );

        let terms = raw_blocking_cols(&["o2_recipe"]).marker_terms();
        assert_eq!(
            terms.len(),
            4,
            "all four blocking recipes share the one marker column, so the presence \
             of o2_recipe enables all four terms"
        );
        assert!(terms.iter().any(|t| t.contains("mysql_lock_waits")));
        assert!(terms.iter().any(|t| t.contains("mssql_blocking_chain")));
    }

    /// The widened blocking SQL must return BOTH populations from one query.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_widened_blocking_sql_matches_both_shapes() {
        let present = all_cols();
        let raw = raw_blocking_cols(&["o2_recipe", "blocked_pid", "waiting_thread"]);
        let sql = build_dbm_events_sql(
            "_o2_dbm_server",
            server_vantage::KIND_BLOCKING,
            "",
            100,
            &proj_blocking(&present, Some(&raw)),
        );

        assert!(
            sql.contains(&format!(
                "{} = '{}'",
                server_vantage::O2_DBM_KIND,
                server_vantage::KIND_BLOCKING
            )),
            "the canonical predicate must survive — canonical rows are the majority \
             on an upgraded deployment:\n{sql}"
        );
        assert!(
            sql.contains("o2_recipe = 'mysql_lock_waits'"),
            "the raw markers must be OR-ed in, or OSS-ingested rows stay invisible:\n{sql}"
        );
        assert!(
            sql.contains("waiting_thread"),
            "the raw columns must be projected, or the canonicalizer gets a row with \
             no pids and drops it:\n{sql}"
        );
    }

    /// With the fallback OFF, the blocking SQL must be byte-identical to pre-2a.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_blocking_fallback_off_emits_byte_identical_sql() {
        let present = all_cols();
        let off = build_dbm_events_sql(
            "_o2_dbm_server",
            server_vantage::KIND_BLOCKING,
            " AND o2_dbm_engine = 'mysql'",
            100,
            &proj_blocking(&present, None),
        );
        assert!(
            !off.contains("o2_recipe"),
            "with no fallback the blocking read must emit exactly what it emitted \
             before phase 2a — no marker terms, no raw columns:\n{off}"
        );
        assert!(
            off.contains("AND o2_dbm_engine = 'mysql'"),
            "and the scope predicates stay in SQL, where they narrow before the LIMIT"
        );
    }

    /// A RAW blocking row must reach the enterprise canonicalizer.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_raw_blocking_row_is_canonicalized() {
        // An InnoDB lock-wait row, exactly the shape `mysql_lock_waits` emits.
        let sample = blocking_sample_for_row(&json!({
            "_timestamp": 1_786_166_303_139_783i64,
            "o2_recipe": "mysql_lock_waits",
            "waiting_thread": "82",
            "blocking_thread": "79",
            "waiting_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 13",
            "blocking_query": "UPDATE accounts SET balance = balance + 1 WHERE id = 13",
            "wait_secs": "4",
            "db_system_name": "mysql",
        }))
        .expect("a raw lock-wait row must yield a sample");

        assert_eq!(
            sample.blocked_pid,
            Some(82),
            "read via the waiting_thread alias"
        );
        assert_eq!(sample.blocking_pid, Some(79));
        assert_eq!(sample.engine.as_deref(), Some("mysql"));
        assert_eq!(
            sample.wait_seconds,
            Some(4.0),
            "read via the wait_secs alias"
        );
    }

    /// A CANONICAL blocking row must still use the canonical reader.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_canonical_blocking_row_still_uses_the_canonical_reader() {
        let sample = blocking_sample_for_row(&json!({
            "_timestamp": 1_786_166_303_139_783i64,
            server_vantage::O2_DBM_KIND: "blocking",
            server_vantage::O2_DBM_ENGINE: "postgresql",
            server_vantage::O2_DBM_BLOCKED_PID: 41,
            server_vantage::O2_DBM_BLOCKING_PID: 42,
        }))
        .expect("a canonical row yields a sample");
        assert_eq!(sample.blocked_pid, Some(41));
        assert_eq!(sample.engine.as_deref(), Some("postgresql"));
    }

    /// A raw row the canonicalizer refuses must be DROPPED, not emitted blank.
    ///
    /// `canonicalize_blocking` requires BOTH pids — a half-populated row is not
    /// a blocking relationship. The InnoDB recipes `COALESCE(...,0)` the thread
    /// ids, and a row whose blocking side never resolved is exactly that.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_raw_blocking_row_without_both_ends_is_dropped() {
        assert!(
            blocking_sample_for_row(&json!({
                "_timestamp": 1i64,
                "o2_recipe": "mysql_lock_waits",
                "waiting_thread": "82",
                "waiting_query": "SELECT 1",
            }))
            .is_none(),
            "an edge needs both ends; emitting it blank would put a chain on the page \
             with nothing at one end"
        );
    }

    /// Scope narrowing must work on raw-derived BLOCKING samples.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_blocking_scope_narrowing_keeps_raw_samples_that_match() {
        let sample = blocking_sample_for_row(&json!({
            "_timestamp": 1i64,
            "o2_recipe": "mysql_lock_waits",
            "waiting_thread": "82", "blocking_thread": "79",
            "server_address": "db-7.internal:3306",
            "db_system_name": "mysql",
        }))
        .expect("sample");

        assert!(
            BlockingScopeNarrowing {
                system: Some("mysql".into()),
                instance: None,
                database: None,
            }
            .matches(&sample),
            "the engine was DERIVED by the canonicalizer, so ?system=mysql must still \
             find this sample"
        );
        assert!(
            !BlockingScopeNarrowing {
                system: Some("postgresql".into()),
                instance: None,
                database: None,
            }
            .matches(&sample),
            "...and a non-matching filter must exclude it, or the filter is decorative"
        );
    }

    /// **The structural guard.** Phase 1's two mutation survivors were both
    /// WIRING bugs — a handler bypassing the gate — that every behavioural test
    /// passed, because the pure functions stayed perfect. This asserts the
    /// binding itself, which is the only thing that catches that class.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_blocking_read_consults_the_probe() {
        let src = dbm_prod_source();
        let code = src;
        let body = {
            let start = code
                .find("async fn read_blocking_body(")
                .expect("read_blocking_body exists");
            let rest = &code[start..];
            &rest[..rest
                .find("\nasync fn ")
                .or_else(|| rest.find("\npub async fn "))
                .unwrap_or(rest.len())]
        };

        assert!(
            body.contains("blocking_window_needs_fallback"),
            "the blocking read must consult the transitional probe; without it the \
             widening is ALWAYS-ON and every steady-state read pays for it"
        );
        assert!(
            body.contains("raw: raw_fallback.as_ref()") || body.contains("raw_fallback.as_ref()"),
            "the resolved fallback must actually reach the projection — a hardcoded \
             `Some(..)` here restores always-on and every behavioural test still passes"
        );
    }

    /// A FAILED probe must degrade to widening, never to the fast path.
    ///
    /// **This test exists because a mutation survived without it.** Flipping the
    /// probe's error arm from `true` to `false` — "we could not tell, so go
    /// fast" — passed all 492 tests. It is a real defect: an unreadable window
    /// is not an empty one, and resolving that ambiguity toward the fast path
    /// renders an empty Blocked Queries page over real contention, which is
    /// precisely the A1 bug this phase fixes, reintroduced through the error
    /// path. The house rule (`plan_row_to_dto`) is that ambiguous cases resolve
    /// toward SHOWING data.
    ///
    /// Structural rather than behavioural because the error arm needs a failing
    /// search backend, which these tests have no meta store to provide — the
    /// same reason `test_present_dbm_columns_reports_errors_instead_of_empty` is
    /// `#[ignore]`d.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_a_failed_blocking_probe_widens_rather_than_hiding_rows() {
        let src = dbm_prod_source();
        let code = src;
        let start = code
            .find("async fn blocking_window_needs_fallback(")
            .expect("the blocking probe exists");
        let rest = &code[start..];
        let body = &rest[..rest.find("\n/// ").unwrap_or(rest.len())];

        let err_arm = body.find("Err(e) =>").expect("the probe has an error arm");
        let after = &body[err_arm..];
        assert!(
            after.contains("true"),
            "the blocking probe's error arm must return `true` (widen). Returning \
             `false` treats an unreadable window as an empty one and hides real \
             blocking rows — A1 reintroduced through the error path:\n{after}"
        );
        assert!(
            !after.trim_end().ends_with("false"),
            "the error arm must not fall through to the fast path"
        );
    }

    /// Scope predicates must NOT reach the SQL when the blocking fallback is on.
    ///
    /// Raw rows have no `o2_dbm_*` scope column, so an appended predicate drops
    /// every one of them. This asserts the CALL SITE, not the behaviour — the
    /// equivalent deadlocks mutation survived every behavioural test.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_the_blocking_scope_predicates_leave_the_sql_when_widening() {
        let src = dbm_prod_source();
        let code = src;
        let start = code
            .find("async fn read_blocking_body(")
            .expect("read_blocking_body exists");
        let rest = &code[start..];
        let body = &rest[..rest.find("\nasync fn ").unwrap_or(rest.len())];

        assert!(
            body.contains("if raw_fallback.is_some() { \"\" }")
                || body.contains("raw_fallback.is_some()"),
            "when the fallback is on the scope predicates must move OUT of the SQL; \
             leaving them in silently drops every raw row, so the page looks correct \
             with no filter and under-reports with one"
        );
    }

    /// The blocking DTO drops the prefixes too and speaks the same
    /// `db_system`/`db_instance`/`db_namespace` vocabulary.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_blocking_dto_shape() {
        let row = json!({
            "_timestamp": 500,
            "o2_dbm_kind": "blocking",
            "o2_dbm_engine": "postgresql",
            "o2_dbm_instance": "pg1",
            "o2_dbm_database": "dbmlab",
            "o2_dbm_blocked_pid": 101,
            "o2_dbm_blocking_pid": 202,
            "o2_dbm_blocked_query": "SELECT 1",
            "o2_dbm_blocking_query": "UPDATE t SET x = 1",
            "o2_dbm_blocked_app": "cart",
            "o2_dbm_blocking_app": "batch",
            "o2_dbm_blocked_fingerprint": "aaa",
            "o2_dbm_blocking_fingerprint": "bbb",
            "o2_dbm_wait_event_type": "Lock",
            "o2_dbm_wait_event": "transactionid",
            "o2_dbm_wait_seconds": 12.5,
        });
        let s = server_vantage::BlockingSample::from_record(&row).unwrap();
        let dto = blocking_sample_to_dto(&s);

        let obj = dto.as_object().unwrap();
        assert!(obj.keys().all(|k| !k.starts_with("o2_dbm_")));
        assert_eq!(dto["timestamp"], json!(500));
        assert_eq!(dto["blocked_pid"], json!(101));
        assert_eq!(dto["blocking_pid"], json!(202));
        assert_eq!(dto["blocked_application"], json!("cart"));
        assert_eq!(dto["blocking_application"], json!("batch"));
        assert_eq!(dto["wait_event_type"], json!("Lock"));
        assert_eq!(dto["wait_seconds"], json!(12.5));
        assert_eq!(dto["db_system"], json!("postgresql"));
        assert_eq!(dto["db_instance"], json!("pg1"));
        assert_eq!(dto["db_namespace"], json!("dbmlab"));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_blocking_search_matches_both_ends() {
        let row = json!({
            "_timestamp": 500,
            "o2_dbm_engine": "postgresql",
            "o2_dbm_blocked_pid": 101,
            "o2_dbm_blocking_pid": 202,
            "o2_dbm_blocked_query": "SELECT * FROM orders",
            "o2_dbm_blocking_query": "UPDATE inventory SET qty = 1",
            "o2_dbm_blocked_app": "cart",
        });
        let s = server_vantage::BlockingSample::from_record(&row).unwrap();
        assert!(blocking_matches_search(&s, ""));
        assert!(blocking_matches_search(&s, "orders"), "blocked side");
        // The handler lowercases the needle before calling; matching is then
        // case-insensitive against mixed-case STORED text.
        assert!(blocking_matches_search(&s, "inventory"), "blocking side");
        assert!(blocking_matches_search(&s, "cart"), "application");
        assert!(!blocking_matches_search(&s, "shipping"));
    }

    /// O1 fixture: one poll observation of a wait.
    #[cfg(feature = "enterprise")]
    fn wait_obs(
        instance: &str,
        blocked: i64,
        blocking: i64,
        ts: i64,
        wait: Option<f64>,
    ) -> server_vantage::BlockingSample {
        server_vantage::BlockingSample {
            engine: Some("postgresql".into()),
            instance: Some(instance.into()),
            database: Some("dbmlab".into()),
            timestamp: Some(ts),
            blocked_pid: Some(blocked),
            blocking_pid: Some(blocking),
            wait_seconds: wait,
            ..Default::default()
        }
    }

    /// O1 · a wait polled N times is ONE wait, reported at its final (maximal)
    /// observation — so `total` counts waits and summing `wait_seconds` over
    /// the hits measures time lost exactly once.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_dedupe_blocking_waits_collapses_polls_to_the_final_observation() {
        // One 30 s wait observed at 10 s polling: three snapshots, growing wait.
        let polls = vec![
            wait_obs("pg1", 101, 202, 1_000, Some(10.0)),
            wait_obs("pg1", 101, 202, 11_000, Some(20.0)),
            wait_obs("pg1", 101, 202, 21_000, Some(30.0)),
            // A different pair on the same instance is its own wait.
            wait_obs("pg1", 333, 444, 5_000, Some(2.0)),
            // The same pids on ANOTHER instance are unrelated sessions.
            wait_obs("pg2", 101, 202, 9_000, Some(7.0)),
        ];
        let deduped = dedupe_blocking_waits(polls);
        assert_eq!(deduped.len(), 3, "three distinct waits, not five polls");
        let final_obs = deduped
            .iter()
            .find(|s| s.instance.as_deref() == Some("pg1") && s.blocked_pid == Some(101))
            .expect("the polled wait survives");
        assert_eq!(
            (final_obs.timestamp, final_obs.wait_seconds),
            (Some(21_000), Some(30.0)),
            "the kept row is the LAST observation, carrying the max wait"
        );
        let time_lost: f64 = deduped.iter().filter_map(|s| s.wait_seconds).sum();
        assert_eq!(
            time_lost, 39.0,
            "30 + 2 + 7 — never 10+20+30 summed across polls of one wait"
        );
    }

    /// O1 · pid reuse: the same pair appearing later with a RESTARTED (smaller)
    /// wait is a NEW wait, split into its own episode rather than collapsed.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_dedupe_blocking_waits_splits_episodes_on_wait_restart() {
        let polls = vec![
            wait_obs("pg1", 101, 202, 1_000, Some(10.0)),
            wait_obs("pg1", 101, 202, 11_000, Some(20.0)),
            // Hours later the pids recur with a small wait: a fresh wait.
            wait_obs("pg1", 101, 202, 7_200_000, Some(3.0)),
            wait_obs("pg1", 101, 202, 7_210_000, Some(13.0)),
        ];
        let deduped = dedupe_blocking_waits(polls);
        assert_eq!(deduped.len(), 2, "two episodes of the same pid pair");
        // Newest-first ordering, each episode at its own final observation.
        assert_eq!(deduped[0].timestamp, Some(7_210_000));
        assert_eq!(deduped[0].wait_seconds, Some(13.0));
        assert_eq!(deduped[1].timestamp, Some(11_000));
        assert_eq!(deduped[1].wait_seconds, Some(20.0));
    }

    /// O1 · observations without `wait_seconds` cannot be episode-split, so
    /// they collapse to the latest observation per pair — one wait, never one
    /// row per poll.
    #[cfg(feature = "enterprise")]
    #[test]
    fn test_dedupe_blocking_waits_without_wait_seconds_keeps_latest() {
        let polls = vec![
            wait_obs("pg1", 101, 202, 1_000, None),
            wait_obs("pg1", 101, 202, 11_000, None),
            wait_obs("pg1", 101, 202, 21_000, None),
        ];
        let deduped = dedupe_blocking_waits(polls);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].timestamp, Some(21_000));
    }
}
